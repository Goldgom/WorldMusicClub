use super::*;
pub(super) struct Container {
    pub ppq: u16,
    pub master_name: String,
    pub master_end: u64,
    pub tempo: Vec<VsqTempo>,
    pub meters: Vec<VsqMeter>,
    pub tracks: Vec<ProjectTrack>,
}
pub(super) struct ProjectTrack {
    pub index: u16,
    pub name: String,
    pub joined_text: Vec<u8>,
    pub controllers: Vec<VsqControllerEvent>,
    pub end: u64,
}
struct Cursor<'a> {
    data: &'a [u8],
    pos: usize,
}
impl<'a> Cursor<'a> {
    fn take(&mut self, n: usize) -> Result<&'a [u8], String> {
        let end = self.pos.checked_add(n).ok_or("VSQ byte offset overflow")?;
        let b = self
            .data
            .get(self.pos..end)
            .ok_or("Truncated VSQ container/event")?;
        self.pos = end;
        Ok(b)
    }
    fn byte(&mut self) -> Result<u8, String> {
        Ok(self.take(1)?[0])
    }
    fn vlq(&mut self) -> Result<u32, String> {
        let mut n = 0;
        for _ in 0..4 {
            let b = self.byte()?;
            n = (n << 7) | u32::from(b & 127);
            if b < 128 {
                return Ok(n);
            }
        }
        Err("VSQ VLQ exceeds four bytes".into())
    }
}
pub(super) fn decode(bytes: &[u8]) -> Result<Container, String> {
    if bytes.len() > MAX_SOURCE_BYTES {
        return Err("VSQ exceeds5MiB source limit".into());
    }
    let mut c = Cursor {
        data: bytes,
        pos: 0,
    };
    let h = c.take(14)?;
    if &h[..8] != b"MThd\0\0\0\x06" || h[8..10] != [0, 1] {
        return Err("VSQ requires SMF format1 six-byte PPQ header".into());
    }
    let count = u16::from_be_bytes([h[10], h[11]]);
    let ppq = u16::from_be_bytes([h[12], h[13]]);
    if !(2..=128).contains(&count) || ppq == 0 || ppq & 0x8000 != 0 {
        return Err("VSQ requires2–128 tracks and nonzero PPQ".into());
    }
    let mut out = Container {
        ppq,
        master_name: String::new(),
        master_end: 0,
        tempo: vec![],
        meters: vec![],
        tracks: vec![],
    };
    let mut total = 0;
    for ti in 0..count {
        let h = c.take(8)?;
        if &h[..4] != b"MTrk" {
            return Err("VSQ requires declared MTrk chunks".into());
        }
        let len = u32::from_be_bytes(h[4..].try_into().unwrap()) as usize;
        let mut t = Cursor {
            data: c.take(len)?,
            pos: 0,
        };
        let (mut tick, mut order) = (0_u64, 0_u32);
        let mut running = None;
        let mut ended = false;
        let mut name = None;
        let mut joined = Vec::new();
        let mut chunk = 0_u32;
        let mut nrpn = (None, None);
        let mut controllers = Vec::new();
        while t.pos < t.data.len() {
            if ended {
                return Err("VSQ bytes follow EOT".into());
            }
            total += 1;
            if total > MAX_EVENTS {
                return Err("VSQ event limit exceeded".into());
            }
            tick = tick
                .checked_add(u64::from(t.vlq()?))
                .ok_or("VSQ clock overflow")?;
            if tick > MAX_TICK {
                return Err("VSQ clock outside bounds".into());
            }
            let first = *t.data.get(t.pos).ok_or("VSQ missing status")?;
            let status = if first >= 128 {
                t.pos += 1;
                first
            } else {
                running.ok_or("VSQ missing running status")?
            };
            match status {
                0xb0 if ti != 0 => {
                    running = Some(status);
                    let cc = t.byte()?;
                    let value = t.byte()?;
                    if cc >= 128 {
                        return Err("VSQ controller number high bit".into());
                    }
                    let special =
                        cc == 6 && value == 255 && nrpn == (Some(85), Some(3)) && chunk > 0;
                    if value > 127 && !special {
                        return Err(
                            "VSQ high data allowed only for proven DM NRPN55:03 CC6=255".into()
                        );
                    }
                    let controller = match cc {
                        99 => {
                            nrpn.0 = Some(value);
                            VsqController::NrpnMsb
                        }
                        98 => {
                            nrpn.1 = Some(value);
                            VsqController::NrpnLsb
                        }
                        6 => VsqController::DataEntryMsb,
                        38 => VsqController::DataEntryLsb,
                        _ => return Err(format!("Unsupported VSQ controller {cc}")),
                    };
                    if matches!(
                        controller,
                        VsqController::DataEntryMsb | VsqController::DataEntryLsb
                    ) && (nrpn.0.is_none() || nrpn.1.is_none())
                    {
                        return Err("VSQ data entry before complete NRPN selection".into());
                    }
                    controllers.push(VsqControllerEvent {
                        tick,
                        event_order: order,
                        controller,
                        value,
                    });
                }
                0xff => {
                    running = None;
                    let kind = t.byte()?;
                    let n = t.vlq()? as usize;
                    let data = t.take(n)?;
                    match kind {
                        3 if tick == 0 && name.is_none() => name = Some(decode_cp932(data)?),
                        1 if ti != 0 && tick == 0 && controllers.is_empty() => {
                            if !data.starts_with(b"DM:") {
                                return Err("VSQ text is not DM project chunk".into());
                            }
                            let colon = data[3..]
                                .iter()
                                .position(|b| *b == b':')
                                .map(|p| p + 3)
                                .ok_or("VSQ malformed DM prefix")?;
                            let digits = &data[3..colon];
                            if digits.is_empty()
                                || digits.len() > 8
                                || digits.len() % 4 != 0
                                || !digits.iter().all(u8::is_ascii_digit)
                            {
                                return Err(
                                    "VSQ DM number requires four/eight decimal digits".into()
                                );
                            }
                            let number: u32 = std::str::from_utf8(digits)
                                .unwrap()
                                .parse()
                                .map_err(|_| "VSQ DM index overflow")?;
                            if number != chunk {
                                return Err(
                                    "VSQ DM chunks must be unique consecutive fromzero".into()
                                );
                            }
                            joined.extend_from_slice(&data[colon + 1..]);
                            chunk += 1;
                        }
                        0x51 if ti == 0 && data.len() == 3 => {
                            let value = u32::from_be_bytes([0, data[0], data[1], data[2]]);
                            if value == 0 || out.tempo.last().is_some_and(|x| x.tick >= tick) {
                                return Err("Invalid or unordered VSQ tempo".into());
                            }
                            out.tempo.push(VsqTempo {
                                tick,
                                event_order: order,
                                microseconds_per_quarter: value,
                            });
                        }
                        0x58 if ti == 0 && data.len() == 4 => {
                            if data[0] == 0
                                || data[1] > 10
                                || out.meters.last().is_some_and(|x| x.tick >= tick)
                            {
                                return Err("Invalid or unordered VSQ meter".into());
                            }
                            out.meters.push(VsqMeter {
                                tick,
                                event_order: order,
                                numerator: data[0],
                                denominator_power: data[1],
                                clocks_per_click: data[2],
                                thirty_seconds_per_quarter: data[3],
                            });
                        }
                        0x2f if data.is_empty() => ended = true,
                        _ => return Err(format!("Unsupported/misplaced VSQ metadata {kind:02x}")),
                    }
                }
                _ => return Err(format!("Unsupported VSQ status {status:02x}")),
            }
            order += 1;
        }
        if !ended {
            return Err("VSQ missing EOT".into());
        }
        let name = name.ok_or("VSQ missing track name")?;
        if ti == 0 {
            out.master_name = name;
            out.master_end = tick;
        } else {
            if chunk == 0 {
                return Err("VSQ track has no proven DM project".into());
            }
            out.tracks.push(ProjectTrack {
                index: ti,
                name,
                joined_text: joined,
                controllers,
                end: tick,
            });
        }
    }
    if c.pos != bytes.len() {
        return Err("VSQ trailing bytes or track count mismatch".into());
    }
    if out.tempo.first().is_none_or(|x| x.tick != 0)
        || out.meters.first().is_none_or(|x| x.tick != 0)
    {
        return Err("VSQ requires explicit tempo/meter at0".into());
    }
    Ok(out)
}
pub(super) fn decode_cp932(bytes: &[u8]) -> Result<String, String> {
    let mut result = String::new();
    let (mut start, mut i) = (0, 0);
    while i < bytes.len() {
        let b = bytes[i];
        if matches!(b,0x81..=0x9f|0xe0..=0xfc) {
            if i + 1 >= bytes.len() || !matches!(bytes[i+1],0x40..=0x7e|0x80..=0xfc) {
                return Err("Invalid CP932 byte sequence".into());
            }
            i += 2;
        } else if matches!(b, 0xa0 | 0xfd..=0xff) {
            let s = encoding_rs::SHIFT_JIS
                .decode_without_bom_handling_and_without_replacement(&bytes[start..i])
                .ok_or("Invalid CP932 byte sequence")?;
            result.push_str(&s);
            result.push(
                char::from_u32(if b == 0xa0 {
                    0xf8f0
                } else {
                    0xf8f1 + u32::from(b - 0xfd)
                })
                .unwrap(),
            );
            i += 1;
            start = i;
        } else {
            i += 1;
        }
    }
    let s = encoding_rs::SHIFT_JIS
        .decode_without_bom_handling_and_without_replacement(&bytes[start..])
        .ok_or("Invalid CP932 byte sequence")?;
    result.push_str(&s);
    Ok(result)
}

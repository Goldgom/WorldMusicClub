use super::*;
use std::collections::{BTreeMap, BTreeSet};
type Fields = Vec<(String, String)>;
pub(super) struct Decoded {
    pub track: VsqTrack,
    pub premeasure: Option<u32>,
    pub mixer: Option<VsqMixer>,
}
fn take(f: &mut Fields, k: &str) -> Result<String, String> {
    let i = f
        .iter()
        .position(|(key, _)| key == k)
        .ok_or_else(|| format!("VSQ required field {k} missing"))?;
    Ok(f.remove(i).1)
}
fn optional(f: &mut Fields, k: &str) -> Option<String> {
    f.iter()
        .position(|(key, _)| key == k)
        .map(|i| f.remove(i).1)
}
fn done(f: Fields) -> Result<(), String> {
    if f.is_empty() {
        Ok(())
    } else {
        Err(format!("Unknown VSQ field {}; conversion held", f[0].0))
    }
}
fn integer(s: &str) -> Result<i64, String> {
    let d = s
        .strip_prefix('-')
        .or_else(|| s.strip_prefix('+'))
        .unwrap_or(s);
    if d.is_empty() || !d.bytes().all(|b| b.is_ascii_digit()) {
        return Err("VSQ field is not a strict integer".into());
    }
    s.parse().map_err(|_| "VSQ integer overflow".into())
}
fn num(f: &mut Fields, k: &str) -> Result<i32, String> {
    i32::try_from(integer(&take(f, k)?)?).map_err(|_| "VSQ integer outside range".into())
}
fn ticks(s: &str) -> Result<u64, String> {
    let n = integer(s)?;
    if !(0..=MAX_TICK as i64).contains(&n) {
        return Err("VSQ tick outside bounded range".into());
    }
    Ok(n as u64)
}
fn flag(f: &mut Fields, k: &str) -> Result<bool, String> {
    match num(f, k)? {
        0 => Ok(false),
        1 => Ok(true),
        _ => Err("VSQ flag must be zero or one".into()),
    }
}
fn index_id(s: &str, p: &str) -> bool {
    s.strip_prefix(p).is_some_and(|t| {
        !t.is_empty() && t.len() <= 8 && t.len() % 4 == 0 && t.bytes().all(|b| b.is_ascii_digit())
    })
}
fn section(s: &mut BTreeMap<String, Fields>, k: &str) -> Result<Fields, String> {
    s.remove(k)
        .ok_or_else(|| format!("VSQ missing, reused or invalid section {k}"))
}
fn handle(s: &mut BTreeMap<String, Fields>, k: &str) -> Result<Fields, String> {
    if !index_id(k, "h#") {
        return Err("Invalid VSQ handle ID".into());
    }
    section(s, k)
}
fn icon(f: &mut Fields) -> Result<String, String> {
    let s = take(f, "IconID")?;
    if !s
        .strip_prefix('$')
        .is_some_and(|t| t.len() == 8 && t.bytes().all(|b| b.is_ascii_hexdigit()))
    {
        return Err("Invalid VSQ IconID".into());
    }
    Ok(s)
}
fn decimal(s: &str) -> Result<VsqDecimal, String> {
    let neg = s.starts_with('-');
    let u = s
        .strip_prefix('-')
        .or_else(|| s.strip_prefix('+'))
        .unwrap_or(s);
    let (a, b) = u.split_once('.').unwrap_or((u, ""));
    if a.is_empty()
        || !a.bytes().all(|b| b.is_ascii_digit())
        || !b.bytes().all(|b| b.is_ascii_digit())
        || b.len() > 12
        || a.len() + b.len() > 18
    {
        return Err("Invalid bounded VSQ decimal".into());
    }
    let n = format!("{a}{b}")
        .parse::<i64>()
        .map_err(|_| "VSQ decimal overflow")?;
    Ok(VsqDecimal {
        coefficient: if neg { -n } else { n },
        scale: b.len() as u8,
    })
}
fn csv(s: &str) -> Result<Vec<String>, String> {
    let mut out = Vec::new();
    let mut field = String::new();
    let mut chars = s.chars().peekable();
    let (mut quoted, mut closed) = (false, false);
    while let Some(c) = chars.next() {
        if quoted {
            if c == '"' {
                if chars.peek() == Some(&'"') {
                    chars.next();
                    field.push('"');
                } else {
                    quoted = false;
                    closed = true;
                }
            } else {
                field.push(c);
            }
        } else if c == ',' {
            out.push(std::mem::take(&mut field));
            closed = false;
        } else if c == '"' && field.is_empty() && !closed {
            quoted = true;
        } else if c == '"' || closed {
            return Err("Malformed VSQ lyric CSV".into());
        } else {
            field.push(c);
        }
    }
    if quoted {
        return Err("Unterminated VSQ lyric CSV".into());
    }
    out.push(field);
    Ok(out)
}
fn lyrics(f: Fields) -> Result<Vec<VsqLyric>, String> {
    let mut out = Vec::new();
    for (k, v) in f {
        let index = k
            .strip_prefix('L')
            .and_then(|s| s.parse::<u32>().ok())
            .ok_or("Unknown VSQ lyric field")?;
        if k != format!("L{index}") || index != out.len() as u32 {
            return Err("VSQ lyrics must be consecutive from L0".into());
        }
        let mut fields = csv(&v)?.into_iter();
        let lyric = fields.next().ok_or("Missing lyric")?;
        let phonetic = fields.next().ok_or("Missing phonetic field")?;
        let numeric_fields = fields.map(|s| decimal(&s)).collect::<Result<Vec<_>, _>>()?;
        if !(3..=4).contains(&numeric_fields.len()) {
            return Err("Unsupported lyric numeric field count".into());
        }
        out.push(VsqLyric {
            index,
            lyric,
            phonetic,
            numeric_fields,
        });
    }
    if out.is_empty() {
        return Err("Empty lyric handle".into());
    }
    Ok(out)
}
fn envelope(f: &mut Fields, p: &str) -> Result<VsqEnvelope, String> {
    let start = num(f, &format!("Start{p}"))?;
    let count = num(f, &format!("{p}BPNum"))?;
    if !(0..=100_000).contains(&count) {
        return Err("VSQ envelope count outside bounds".into());
    }
    let xs = optional(f, &format!("{p}BPX"));
    let ys = optional(f, &format!("{p}BPY"));
    if count == 0 {
        if xs.is_some() || ys.is_some() {
            return Err("Empty envelope has point fields".into());
        }
        return Ok(VsqEnvelope {
            start,
            points: vec![],
        });
    }
    let xs = xs.ok_or("Missing envelope X")?;
    let ys = ys.ok_or("Missing envelope Y")?;
    let positions = xs.split(',').map(decimal).collect::<Result<Vec<_>, _>>()?;
    let values = ys
        .split(',')
        .map(|s| i32::try_from(integer(s)?).map_err(|_| "Envelope value overflow".into()))
        .collect::<Result<Vec<_>, String>>()?;
    if positions.len() != count as usize || values.len() != positions.len() {
        return Err("Envelope count disagrees with points".into());
    }
    let mut prev = (0_i128, 1_i128);
    let mut points = Vec::new();
    for (position, value) in positions.into_iter().zip(values) {
        let den = 10_i128.pow(u32::from(position.scale));
        let n = i128::from(position.coefficient);
        if n < 0 || n > den || n * prev.1 < prev.0 * den {
            return Err("Envelope positions must be ordered within0..1".into());
        }
        prev = (n, den);
        points.push(VsqEnvelopePoint { position, value });
    }
    Ok(VsqEnvelope { start, points })
}
fn vibrato(mut f: Fields, handle_id: String, delay_ticks: u64) -> Result<VsqVibrato, String> {
    let v = VsqVibrato {
        handle_id,
        delay_ticks,
        icon_id: icon(&mut f)?,
        ids: take(&mut f, "IDS")?,
        original: num(&mut f, "Original")?,
        caption: take(&mut f, "Caption")?,
        length_ticks: ticks(&take(&mut f, "Length")?)?,
        depth: envelope(&mut f, "Depth")?,
        rate: envelope(&mut f, "Rate")?,
    };
    done(f)?;
    Ok(v)
}
fn mixer(mut f: Fields) -> Result<VsqMixer, String> {
    let master_fader = num(&mut f, "MasterFeder")?;
    let master_panpot = num(&mut f, "MasterPanpot")?;
    let master_mute = flag(&mut f, "MasterMute")?;
    let output_mode = num(&mut f, "OutputMode")?;
    let count = num(&mut f, "Tracks")?;
    if !(1..128).contains(&count) {
        return Err("Mixer track count outside bounds".into());
    }
    let mut tracks = Vec::new();
    for i in 0..count {
        tracks.push(VsqMixerTrack {
            fader: num(&mut f, &format!("Feder{i}"))?,
            panpot: num(&mut f, &format!("Panpot{i}"))?,
            mute: flag(&mut f, &format!("Mute{i}"))?,
            solo: flag(&mut f, &format!("Solo{i}"))?,
        });
    }
    done(f)?;
    Ok(VsqMixer {
        master_fader,
        master_panpot,
        master_mute,
        output_mode,
        tracks,
    })
}
fn parameter(s: &str) -> Option<VsqCurveParameter> {
    use VsqCurveParameter::*;
    Some(match s {
        "PitchBendBPList" => PitchBend,
        "PitchBendSensBPList" => PitchBendSensitivity,
        "DynamicsBPList" => Dynamics,
        "EpRResidualBPList" => Breathiness,
        "EpRESlopeBPList" => Brightness,
        "EpRESlopeDepthBPList" => Clearness,
        "Reso1FreqBPList" => Resonance1Frequency,
        "Reso2FreqBPList" => Resonance2Frequency,
        "Reso3FreqBPList" => Resonance3Frequency,
        "Reso4FreqBPList" => Resonance4Frequency,
        "Reso1BWBPList" => Resonance1Bandwidth,
        "Reso2BWBPList" => Resonance2Bandwidth,
        "Reso3BWBPList" => Resonance3Bandwidth,
        "Reso4BWBPList" => Resonance4Bandwidth,
        "Reso1AmpBPList" => Resonance1Amplitude,
        "Reso2AmpBPList" => Resonance2Amplitude,
        "Reso3AmpBPList" => Resonance3Amplitude,
        "Reso4AmpBPList" => Resonance4Amplitude,
        "GenderFactorBPList" => GenderFactor,
        "PortamentoTimingBPList" => PortamentoTiming,
        "OpeningBPList" => Opening,
        _ => return None,
    })
}
pub(super) fn decode(source: container::ProjectTrack) -> Result<Decoded, String> {
    let text = container::decode_cp932(&source.joined_text)?;
    let mut sections = BTreeMap::new();
    let mut section_order = Vec::new();
    let mut current = String::new();
    let mut keys = BTreeSet::new();
    for line in text.lines() {
        if line.is_empty() {
            continue;
        }
        if let Some(name) = line.strip_prefix('[').and_then(|x| x.strip_suffix(']')) {
            if name.is_empty() || sections.contains_key(name) {
                return Err("Duplicate or empty VSQ section".into());
            }
            sections.insert(name.to_string(), vec![]);
            section_order.push(name.to_string());
            current = name.into();
            keys.clear();
        } else {
            let (k, v) = line.split_once('=').ok_or("Unparsed VSQ project line")?;
            if k.is_empty() || !keys.insert(k.to_string()) {
                return Err("Duplicate or empty VSQ field key".into());
            }
            sections
                .get_mut(&current)
                .ok_or("VSQ field before first section")?
                .push((k.into(), v.into()));
        }
    }
    let mut common = section(&mut sections, "Common")?;
    let version = take(&mut common, "Version")?;
    if version != "DSB301" {
        return Err("Unsupported VSQ project version".into());
    }
    let name = take(&mut common, "Name")?;
    let colors = take(&mut common, "Color")?
        .split(',')
        .map(|s| u8::try_from(integer(s)?).map_err(|_| "Invalid color component".into()))
        .collect::<Result<Vec<_>, String>>()?;
    let common_value = VsqCommon {
        version,
        name,
        color_components: colors
            .try_into()
            .map_err(|_| "Color needs three components")?,
        dynamics_mode: num(&mut common, "DynamicsMode")?,
        play_mode: num(&mut common, "PlayMode")?,
    };
    done(common)?;
    let premeasure = if let Some(mut f) = sections.remove("Master") {
        let n = num(&mut f, "PreMeasure")?;
        done(f)?;
        Some(u32::try_from(n).map_err(|_| "Negative PreMeasure")?)
    } else {
        None
    };
    let mixer = sections.remove("Mixer").map(mixer).transpose()?;
    if (source.index == 1) != (premeasure.is_some() && mixer.is_some())
        || premeasure.is_some() != mixer.is_some()
    {
        return Err("Master and Mixer must occur together in first project track".into());
    }
    let eventlist = section(&mut sections, "EventList")?;
    let mut notes = Vec::new();
    let mut singers = Vec::new();
    let mut eos = None;
    let mut last_tick = 0;
    let mut order = 0_u32;
    for (clock, refs) in eventlist {
        let tick = ticks(&clock)?;
        if tick < last_tick {
            return Err("Unordered EventList clocks".into());
        }
        last_tick = tick;
        for id in refs.split(',') {
            if id == "EOS" {
                if eos.replace(tick).is_some() {
                    return Err("Repeated EOS".into());
                }
                continue;
            }
            if eos.is_some() || !index_id(id, "ID#") {
                return Err("Invalid event reference or event after EOS".into());
            }
            let mut f = section(&mut sections, id)?;
            let kind = take(&mut f, "Type")?;
            if kind == "Singer" {
                let handle_id = take(&mut f, "IconHandle")?;
                done(f)?;
                let mut h = handle(&mut sections, &handle_id)?;
                let voice = VsqVoice {
                    icon_id: icon(&mut h)?,
                    ids: take(&mut h, "IDS")?,
                    original: num(&mut h, "Original")?,
                    caption: take(&mut h, "Caption")?,
                    length: ticks(&take(&mut h, "Length")?)?,
                    language: num(&mut h, "Language")?,
                    program: num(&mut h, "Program")?,
                };
                done(h)?;
                if singers.last().is_some_and(|s: &VsqSinger| s.tick == tick) {
                    return Err("Competing same-clock singers are unverified".into());
                }
                singers.push(VsqSinger {
                    id: id.into(),
                    event_order: order,
                    tick,
                    handle_id,
                    voice,
                });
            } else if kind == "Anote" {
                let length_ticks = ticks(&take(&mut f, "Length")?)?;
                if length_ticks == 0
                    || tick
                        .checked_add(length_ticks)
                        .is_none_or(|end| end > MAX_TICK)
                {
                    return Err("VSQ note length outside bounds".into());
                }
                let note_number = u8::try_from(num(&mut f, "Note#")?)
                    .ok()
                    .filter(|n| *n <= 127)
                    .ok_or("VSQ pitch outside MIDI range")?;
                let dynamics = u8::try_from(num(&mut f, "Dynamics")?)
                    .ok()
                    .filter(|n| *n <= 127)
                    .ok_or("VSQ Dynamics outside range")?;
                let expression = VsqNoteExpression {
                    bend_depth: num(&mut f, "PMBendDepth")?,
                    bend_length: num(&mut f, "PMBendLength")?,
                    portamento_use: num(&mut f, "PMbPortamentoUse")?,
                    decay_gain_rate: num(&mut f, "DEMdecGainRate")?,
                    accent: num(&mut f, "DEMaccent")?,
                };
                let lyric_handle_id = take(&mut f, "LyricHandle")?;
                let lyrics = lyrics(handle(&mut sections, &lyric_handle_id)?)?;
                let vib = optional(&mut f, "VibratoHandle");
                let delay = optional(&mut f, "VibratoDelay");
                let vibrato = match (vib, delay) {
                    (Some(h), Some(d)) => {
                        let delay = ticks(&d)?;
                        if delay > length_ticks {
                            return Err("Vibrato delay exceeds note duration".into());
                        }
                        Some(vibrato(handle(&mut sections, &h)?, h, delay)?)
                    }
                    (None, None) => None,
                    _ => return Err("Vibrato handle and delay must be paired".into()),
                };
                done(f)?;
                notes.push(VsqNote {
                    id: id.into(),
                    event_order: order,
                    tick,
                    length_ticks,
                    note_number,
                    dynamics,
                    singer_event_id: String::new(),
                    expression,
                    lyric_handle_id,
                    lyrics,
                    vibrato,
                });
                if notes.len() > 100_000 {
                    return Err("VSQ note limit exceeded".into());
                }
            } else {
                return Err(format!("Unknown VSQ event type {kind}"));
            }
            order += 1;
        }
    }
    let eos_tick = eos.ok_or("Missing VSQ EOS")?;
    if singers.first().is_none_or(|s| s.tick != 0) {
        return Err("Initial VSQ singer must be at zero".into());
    }
    for n in &mut notes {
        let si = singers
            .partition_point(|s| s.tick <= n.tick)
            .checked_sub(1)
            .ok_or("Note has no singer")?;
        if (si > 0 && singers[si].tick == n.tick)
            || singers
                .get(si + 1)
                .is_some_and(|s| s.tick < n.tick + n.length_ticks)
        {
            return Err("Note touches or spans later singer change; semantics unverified".into());
        }
        n.singer_event_id = singers[si].id.clone();
        if n.tick + n.length_ticks > eos_tick {
            return Err("Note ends after EOS".into());
        }
    }
    let mut curves = Vec::new();
    for name in section_order {
        if let Some(f) = sections.remove(&name) {
            let parameter = parameter(&name)
                .ok_or_else(|| format!("Unknown or unreferenced section {name}"))?;
            let mut points = Vec::new();
            for (k, v) in f {
                let tick = ticks(&k)?;
                let value = i32::try_from(integer(&v)?).map_err(|_| "Curve value overflow")?;
                if points
                    .last()
                    .is_some_and(|p: &VsqCurvePoint| p.tick >= tick)
                {
                    return Err("Curve clocks must strictly increase".into());
                }
                points.push(VsqCurvePoint { tick, value });
            }
            curves.push(VsqCurve { parameter, points });
        }
    }
    Ok(Decoded {
        premeasure,
        mixer,
        track: VsqTrack {
            source_track_index: source.index,
            smf_track_name: source.name,
            project_text_sha256: format!("{:x}", Sha256::digest(&source.joined_text)),
            common: common_value,
            end_tick: source.end,
            eos_tick,
            singers,
            notes,
            curves,
            controller_events: source.controllers,
        },
    })
}

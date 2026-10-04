//! This probe identifies bounded, framed DM project text, not file extensions
//! or substrings in arbitrary binary data. It grants no conversion validity.
//! The authoritative VSQ decoder/validator still accepts or rejects everything.
use super::*;
use crate::vsq_clean;

pub(super) fn contains_project(bytes: &[u8], source_sha256: &str) -> bool {
    let mut project_text = Vec::new();
    let _ = scan(bytes, source_sha256, &mut project_text);
    project_text.iter().any(|text| common_version(text))
}

pub(super) fn prepare(bytes: &[u8], draft: &mut Draft) -> Result<bool, String> {
    let mut project_text = Vec::new();
    let raw = scan(bytes, &draft.source.sha256, &mut project_text);
    if !project_text.iter().any(|text| common_version(text)) {
        return Ok(false);
    }
    draft.source.format = "vsq".into();
    let converted = raw.and_then(|inventory| {
        draft.inventory = Some(inventory);
        vsq_clean::convert_vsq(bytes, &draft.title)
    });
    let score = match converted {
        Ok(score) => score,
        Err(error) => {
            draft.diagnostics.push(diagnostic(
                "vsq_source_rejected", error,
                "Keep the complete original VSQ and resolve the reported project or engine meaning; recognized VSQ never falls back to generic MIDI or a partial song.",
            ));
            return Ok(true);
        }
    };
    let inventory = draft.inventory.as_mut().expect("scanned VSQ container");
    inventory.tracks[0].name = score.authoring.master_track_name.clone();
    for track in &score.authoring.tracks {
        inventory.tracks[usize::from(track.source_track_index)].name = track.smf_track_name.clone();
    }
    // source_track_index is the authoritative decoder's actual zero-based SMF
    // chunk index, not the position in the logical vocal-track vector.
    inventory.parts = score
        .authoring
        .tracks
        .iter()
        .zip(&score.authoring.mixer.tracks)
        .map(|(track, mix)| PartInventory {
            id: format!("vsq-track-{}", track.source_track_index),
            track_id: format!("track-{}", track.source_track_index + 1),
            channel: None,
            notation_available: true,
            vsq: Some(VsqPartInventory {
                name: track.common.name.clone(),
                source_track_index: track.source_track_index,
                notes: track.notes.len(),
                singers: track.singers.len(),
                lyrics: track.notes.iter().map(|note| note.lyrics.len()).sum(),
                curves: track.curves.len(),
                curve_points: track.curves.iter().map(|curve| curve.points.len()).sum(),
                mute: mix.mute,
                solo: mix.solo,
                master_mute: score.authoring.mixer.master_mute,
            }),
        })
        .collect();
    let score_bytes = match vsq_clean::encode_json(&score) {
        Ok(bytes) => bytes,
        Err(error) => {
            draft.diagnostics.push(diagnostic(
                "vsq_complete_conversion_rejected",
                error,
                "Keep the complete original VSQ; no partial package was produced.",
            ));
            return Ok(true);
        }
    };
    if reject_package_size(draft, score_bytes.len(), 0) {
        return Ok(true);
    }
    let metadata = vsq_clean::package_metadata(&score, &score_bytes)?;
    let package = Package {
        metadata_json: serde_json::to_string_pretty(&metadata).map_err(|e| e.to_string())?,
        score_json: String::from_utf8(score_bytes).map_err(|e| e.to_string())?,
    };
    draft.state = State::VsqAuthoringCandidate;
    draft.diagnostics.push(diagnostic("vsq_authoring_only",
        "All authored vocal parts, mixer flags, lyrics, singer descriptors, curves and named engine dispatch are retained. This candidate does not establish receiver admission or human-voice synthesis.".into(),
        "Review the complete project. Instrumental practice requires the receiver's explicit base_notes_instrumental choice; vocal synthesis and expression rendering remain unavailable."));
    install_package(draft, package);
    Ok(true)
}

pub(super) fn common_version(text: &[u8]) -> bool {
    let mut common = false;
    for line in text.split(|b| *b == b'\n') {
        let line = line.trim_ascii();
        if line.starts_with(b"[") {
            common = line == b"[Common]";
        } else if common && line.starts_with(b"Version=") {
            // Empty/unsupported versions still identify a project that the
            // authoritative VSQ decoder must reject, never MIDI-fallback.
            return true;
        }
    }
    false
}

struct Cursor<'a> {
    bytes: &'a [u8],
    at: usize,
}
impl<'a> Cursor<'a> {
    fn take(&mut self, n: usize) -> Result<&'a [u8], String> {
        let end = self.at.checked_add(n).ok_or("SMF byte offset overflow")?;
        let value = self
            .bytes
            .get(self.at..end)
            .ok_or("Truncated SMF container/event")?;
        self.at = end;
        Ok(value)
    }
    fn byte(&mut self) -> Result<u8, String> {
        Ok(self.take(1)?[0])
    }
    fn vlq(&mut self) -> Result<u32, String> {
        let mut value = 0;
        for _ in 0..4 {
            let byte = self.byte()?;
            value = (value << 7) | u32::from(byte & 127);
            if byte < 128 {
                return Ok(value);
            }
        }
        Err("SMF VLQ exceeds four bytes".into())
    }
}
// Bounds come from the independent VSQ source reader. Never raise the generic
// MIDI event/data-byte limits to accommodate VSQ engine packets.
pub(super) fn scan(bytes: &[u8], sha: &str, texts: &mut Vec<Vec<u8>>) -> Result<Inventory, String> {
    let mut file = Cursor { bytes, at: 0 };
    let header = file.take(14)?;
    if &header[..8] != b"MThd\0\0\0\x06" {
        return Err("Invalid SMF header".into());
    }
    let count = u16::from_be_bytes([header[10], header[11]]);
    let ppq = u16::from_be_bytes([header[12], header[13]]);
    if count == 0 || count > 128 || ppq == 0 || ppq & 0x8000 != 0 {
        return Err("SMF track count or PPQ outside VSQ probe bounds".into());
    }
    let mut tracks = vec![];
    let mut total = 0;
    for index in 0..count {
        let header = file.take(8)?;
        if &header[..4] != b"MTrk" {
            return Err("SMF requires declared MTrk chunks".into());
        }
        let size = u32::from_be_bytes(header[4..].try_into().unwrap()) as usize;
        let mut events = Cursor {
            bytes: file.take(size)?,
            at: 0,
        };
        texts.push(vec![]);
        let text = texts.last_mut().unwrap();
        let mut track = TrackInventory {
            source_index: index,
            track_id: format!("track-{}", index + 1),
            name: format!("Track {}", index + 1),
            source_event_count: 0,
            channels: vec![],
            key_attacks: 0,
            key_releases: 0,
            first_event_id: None,
            last_event_id: None,
            end: Beat::ZERO,
        };
        let mut channels: BTreeMap<u8, ChannelInventory> = BTreeMap::new();
        let (mut tick, mut running, mut ended) = (0_u64, None, false);
        let mut nrpn = [(None, None); 16];
        while events.at < events.bytes.len() {
            if ended {
                return Err("SMF bytes follow EOT".into());
            }
            total += 1;
            if total > crate::vsq::MAX_EVENTS {
                return Err("VSQ event limit exceeded".into());
            }
            tick = tick
                .checked_add(u64::from(events.vlq()?))
                .ok_or("SMF clock overflow")?;
            if tick > crate::vsq::MAX_TICK {
                return Err("VSQ clock outside bounds".into());
            }
            let first = *events
                .bytes
                .get(events.at)
                .ok_or("SMF missing event status")?;
            let status = if first >= 128 {
                events.at += 1;
                first
            } else {
                running.ok_or("SMF missing running status")?
            };
            match status {
                0x80..=0xef => {
                    running = Some(status);
                    let channel = status & 15;
                    let kind = status & 0xf0;
                    let data = events.take(if matches!(kind, 0xc0 | 0xd0) { 1 } else { 2 })?;
                    let selector = &mut nrpn[usize::from(channel)];
                    let special = kind == 0xb0
                        && data == [6, 255]
                        && *selector == (Some(85), Some(3))
                        && !text.is_empty();
                    if data[0] > 127 || (data.len() == 2 && data[1] > 127 && !special) {
                        return Err(
                            "SMF high data byte outside proven VSQ NRPN55:03 CC6=255".into()
                        );
                    }
                    if kind == 0xb0 {
                        match data[0] {
                            99 => selector.0 = Some(data[1]),
                            98 => selector.1 = Some(data[1]),
                            100 | 101 | 121 => *selector = (None, None),
                            _ => {}
                        }
                    }
                    let route = channels.entry(channel).or_insert(ChannelInventory {
                        channel,
                        source_event_count: 0,
                        key_attacks: 0,
                        key_releases: 0,
                    });
                    route.source_event_count += 1;
                    if kind == 0x90 && data[1] > 0 {
                        route.key_attacks += 1;
                        track.key_attacks += 1;
                    }
                    if kind == 0x80 || (kind == 0x90 && data[1] == 0) {
                        route.key_releases += 1;
                        track.key_releases += 1;
                    }
                }
                0xff => {
                    running = None;
                    let kind = events.byte()?;
                    let size = events.vlq()? as usize;
                    let data = events.take(size)?;
                    if kind == 1 {
                        if let Some(rest) = data.strip_prefix(b"DM:") {
                            if let Some(colon) = rest.iter().position(|b| *b == b':') {
                                let digits = &rest[..colon];
                                if !digits.is_empty()
                                    && digits.len() <= 8
                                    && digits.iter().all(u8::is_ascii_digit)
                                {
                                    text.extend_from_slice(&rest[colon + 1..]);
                                }
                            }
                        }
                    } else if kind == 3 {
                        // The authoritative decoded CP932 name replaces this
                        // provisional display name after successful conversion.
                        if let Ok(name) = std::str::from_utf8(data) {
                            track.name =
                                name.chars().filter(|c| !c.is_control()).take(200).collect();
                        }
                    } else if kind == 0x2f {
                        if !data.is_empty() {
                            return Err("SMF EOT payload must be empty".into());
                        }
                        ended = true;
                    }
                }
                0xf0 | 0xf7 => {
                    running = None;
                    let size = events.vlq()? as usize;
                    events.take(size)?;
                }
                _ => return Err("Unsupported SMF status in bounded VSQ probe".into()),
            }
            let id = format!("vsq:{sha}:t{index}:e{}", track.source_event_count);
            track.first_event_id.get_or_insert_with(|| id.clone());
            track.last_event_id = Some(id);
            track.source_event_count += 1;
        }
        if !ended {
            return Err("SMF missing EOT".into());
        }
        track.end = crate::vsq::beat(tick, ppq)?;
        track.channels = channels.into_values().collect();
        tracks.push(track);
    }
    if file.at != bytes.len() {
        return Err("SMF trailing bytes or track count mismatch".into());
    }
    Ok(Inventory {
        source_tracks: tracks.len(),
        source_events: total,
        ppq,
        key_attacks: tracks.iter().map(|t| t.key_attacks).sum(),
        key_releases: tracks.iter().map(|t| t.key_releases).sum(),
        tracks,
        parts: vec![],
    })
}

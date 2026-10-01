//! Maintainer-only raw SMF observation. This is not an application importer or player.
//! Controllers and SysEx are reported, never applied or removed from a playable score.
use midly::{Format, MetaMessage, MidiMessage, Smf, Timing, TrackEventKind};
use serde_json::{json, Value};
use std::{collections::BTreeMap, io::Read};

fn inspect(bytes: &[u8]) -> Result<Value, String> {
    if bytes.len() > 4 * 1024 * 1024 {
        return Err("Reference file exceeds 4 MiB".into());
    }
    let smf = Smf::parse(bytes).map_err(|e| e.to_string())?;
    if smf.header.format == Format::Sequential {
        return Err("Independent type-2 sequences require separate comparison".into());
    }
    let ppqn = match smf.header.timing {
        Timing::Metrical(value) if value.as_int() > 0 => value.as_int(),
        _ => return Err("Reference comparison requires positive metrical timing".into()),
    };
    let mut tempos = BTreeMap::new();
    let mut notes = Vec::new();
    let mut other = Vec::new();
    let mut count = 0usize;
    let mut final_tick = 0u64;
    for (track, events) in smf.tracks.iter().enumerate() {
        let mut tick = 0u64;
        let mut port = 0u8;
        for (ordinal, event) in events.iter().enumerate() {
            count += 1;
            if count > 100_000 {
                return Err("Reference exceeds 100,000 events".into());
            }
            tick = tick
                .checked_add(event.delta.as_int().into())
                .ok_or("Tick overflow")?;
            final_tick = final_tick.max(tick);
            let base = json!({"tick":tick,"track":track,"ordinal":ordinal,"port":port});
            match event.kind {
                TrackEventKind::Meta(MetaMessage::Tempo(value)) => {
                    let value = value.as_int();
                    if value == 0 || tempos.insert(tick, value).is_some_and(|old| old != value) {
                        return Err("Zero or conflicting reference tempo".into());
                    }
                }
                TrackEventKind::Meta(MetaMessage::MidiPort(value)) => {
                    port = value.as_int();
                    let mut item = base;
                    item["kind"] = json!("midi_port");
                    item["value"] = json!(port);
                    other.push(item);
                }
                TrackEventKind::Midi { channel, message } => {
                    let mut item = base;
                    item["channel"] = json!(channel.as_int());
                    match message {
                        MidiMessage::NoteOn { key, vel } => {
                            item["kind"] = json!(if vel.as_int() == 0 { "off" } else { "on" });
                            item["midi"] = json!(key.as_int());
                            item["velocity"] = json!(vel.as_int());
                            notes.push(item);
                        }
                        MidiMessage::NoteOff { key, vel } => {
                            item["kind"] = json!("off");
                            item["midi"] = json!(key.as_int());
                            item["velocity"] = json!(vel.as_int());
                            notes.push(item);
                        }
                        _ => {
                            item["kind"] = json!("channel_message_not_interpreted");
                            item["message"] = json!(format!("{message:?}"));
                            if let MidiMessage::Controller { controller, value } = message {
                                item["controller"] = json!(controller.as_int());
                                item["value"] = json!(value.as_int());
                            }
                            other.push(item);
                        }
                    }
                }
                TrackEventKind::SysEx(data) | TrackEventKind::Escape(data) => {
                    let mut item = base;
                    item["kind"] = json!("system_bytes_not_interpreted");
                    item["byte_count"] = json!(data.len());
                    other.push(item);
                }
                _ => {}
            }
        }
    }
    tempos.entry(0).or_insert(500_000);
    notes.sort_by_key(|n| {
        (
            n["tick"].as_u64(),
            n["track"].as_u64(),
            n["ordinal"].as_u64(),
        )
    });
    Ok(
        json!({"version":1,"ticks_per_quarter":ppqn,"final_tick":final_tick,
        "tempo_events":tempos.into_iter().map(|(tick,us)|json!({"tick":tick,"microseconds_per_quarter":us})).collect::<Vec<_>>(),
        "note_messages":notes,"non_note_messages":other,
        "interpretation":"Raw written MIDI key messages only. Controllers, pitch bend, tuning, patches, pedals and SysEx are not applied. This report is not a playable canonical import or an acoustic performance model."}),
    )
}

fn main() -> Result<(), String> {
    let args: Vec<_> = std::env::args_os().skip(1).collect();
    if args.len() != 1 {
        return Err("Usage: inspect_reference_midi reference.mid".into());
    }
    let file = std::fs::File::open(&args[0]).map_err(|e| e.to_string())?;
    let mut bytes = Vec::new();
    file.take(4 * 1024 * 1024 + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    println!("{}", inspect(&bytes)?);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn file(events: &[u8]) -> Vec<u8> {
        let mut raw = b"MThd\0\0\0\x06\0\0\0\x01\x01\xe0MTrk".to_vec();
        raw.extend_from_slice(&(events.len() as u32).to_be_bytes());
        raw.extend_from_slice(events);
        raw
    }
    #[test]
    fn controllers_remain_visible_without_making_reference_playable() {
        let raw = file(&[
            0, 0xb0, 121, 0, 0, 0x90, 60, 100, 0x83, 0x60, 0x90, 60, 0, 0, 0xff, 0x2f, 0,
        ]);
        assert!(score_core::import_midi(&raw).unwrap_err().contains("121"));
        let report = inspect(&raw).unwrap();
        assert_eq!(report["note_messages"].as_array().unwrap().len(), 2);
        assert_eq!(report["note_messages"][1]["tick"], 480);
        assert_eq!(report["note_messages"][1]["kind"], "off");
        assert!(report["non_note_messages"][0]["message"]
            .as_str()
            .unwrap()
            .contains("121"));
        assert_eq!(
            report["tempo_events"][0]["microseconds_per_quarter"],
            500_000
        );
    }
    #[test]
    fn conflicting_tempos_are_not_guessed() {
        let raw = file(&[
            0, 0xff, 0x51, 3, 7, 0xa1, 0x20, 0, 0xff, 0x51, 3, 6, 0, 0, 0, 0xff, 0x2f, 0,
        ]);
        assert!(inspect(&raw).unwrap_err().contains("conflicting"));
    }
    #[test]
    fn format_two_and_truncated_data_are_not_compared() {
        let mut raw = file(&[0, 0xff, 0x2f, 0]);
        raw[9] = 2;
        assert!(inspect(&raw).unwrap_err().contains("type-2"));
        assert!(inspect(b"MThd").is_err());
    }
}

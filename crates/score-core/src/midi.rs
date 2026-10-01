//! Bounded local Standard MIDI File import. MIDI records performance events, not
//! original sheet music: spelling, voices, staves and bar lines are inferred.
//!
//! Note durations mean key-down to key-release. Pedal, tuning, channel-mode and
//! other unsupported timing/pitch semantics are rejected, never guessed. The
//! complete original binary is retained as RFC 4648 standard base64.
use crate::{
    Beat, Diagnostic, Key, Measure, Meter, Note, Part, Pitch, Provenance, Score, Source, Tempo,
};
use base64::{engine::general_purpose::STANDARD, Engine};
use midly::{MetaMessage, MidiMessage, Timing, TrackEventKind};
use std::collections::{BTreeMap, BTreeSet};

const MAX_SOURCE_BYTES: usize = 5 * 1024 * 1024;
const MAX_TRACKS: usize = 128;
const MAX_PARTS: usize = 128;
const MAX_EVENTS: usize = 1_000_000;
const MAX_NOTES: usize = 100_000;
const MAX_METADATA: usize = 100_000;

#[derive(Default)]
struct Warnings {
    entries: Vec<Diagnostic>,
    seen: BTreeSet<&'static str>,
}
impl Warnings {
    fn add(&mut self, code: &'static str, message: &str) {
        if self.seen.insert(code) {
            self.entries.push(Diagnostic::warning(code, message, None));
        }
    }
}

#[derive(Clone, Copy)]
struct NoteEvent {
    tick: u64,
    track: usize,
    index: usize,
    channel: u8,
    key: u8,
    velocity: u8,
    on: bool,
}

/// Reject structural truncation and mismatched counts before allocating events.
/// Only plain SMF is supported, not RIFF-wrapped MIDI or unknown chunk types.
fn check_container(bytes: &[u8]) -> Result<usize, String> {
    if bytes.len() > MAX_SOURCE_BYTES {
        return Err("MIDI exceeds the 5 MiB local import limit".into());
    }
    if bytes.len() < 14 || &bytes[..4] != b"MThd" {
        return Err("Expected a Standard MIDI File with an MThd header".into());
    }
    if bytes[4..8] != [0, 0, 0, 6] {
        return Err("Unsupported MIDI header length; expected the standard six-byte header".into());
    }
    // midly 0.5.3 negates an i8 SMPTE field while parsing its header; 0x80
    // overflows in debug builds. This importer supports PPQ only, so reject all
    // timecode divisions before reaching that upstream code path.
    if bytes[12] & 0x80 != 0 {
        return Err("SMPTE-timed MIDI is unsupported; export a PPQ-timed MIDI file".into());
    }
    let format = u16::from_be_bytes([bytes[8], bytes[9]]);
    match format {
        0 | 1 => {}
        2 => return Err("MIDI type 2 contains independent sequences; import a type 0 or type 1 PPQ file instead".into()),
        _ => return Err("Unsupported MIDI file format; expected type 0 or type 1".into()),
    }
    let tracks = usize::from(u16::from_be_bytes([bytes[10], bytes[11]]));
    if !(1..=MAX_TRACKS).contains(&tracks) || (format == 0 && tracks != 1) {
        return Err("MIDI must contain 1–128 tracks; type 0 must contain exactly one track".into());
    }
    let mut offset = 14;
    for _ in 0..tracks {
        let header = bytes
            .get(offset..offset + 8)
            .ok_or("Truncated MIDI track header")?;
        if &header[..4] != b"MTrk" {
            return Err("Expected MTrk; unknown MIDI chunks are unsupported".into());
        }
        let length = u32::from_be_bytes([header[4], header[5], header[6], header[7]]) as usize;
        offset = offset
            .checked_add(8)
            .and_then(|n| n.checked_add(length))
            .ok_or("MIDI track length overflow")?;
        if offset > bytes.len() {
            return Err("Truncated MIDI track payload".into());
        }
    }
    if offset != bytes.len() {
        return Err("MIDI track count disagrees with the file, or trailing data is present".into());
    }
    Ok(tracks)
}

fn beat(ticks: u64, ppq: u16) -> Result<Beat, String> {
    let divisor = crate::gcd(u128::from(ticks), u128::from(ppq)) as u64;
    let value = Beat::new(
        i64::try_from(ticks / divisor).map_err(|_| "MIDI timing overflow")?,
        i64::from(ppq) / divisor as i64,
    );
    if !value.valid() {
        return Err("MIDI timing exceeds supported exact rational limits".into());
    }
    Ok(value)
}

fn metadata<T: PartialEq>(
    map: &mut BTreeMap<u64, T>,
    tick: u64,
    value: T,
    name: &str,
) -> Result<(), String> {
    if let Some(previous) = map.get(&tick) {
        if previous != &value {
            return Err(format!(
                "Conflicting MIDI {name} events at tick {tick}; no ordering is inferred"
            ));
        }
    } else {
        if map.len() == MAX_METADATA {
            return Err(format!("MIDI {name} exceeds 100,000-event limit"));
        }
        map.insert(tick, value);
    }
    Ok(())
}

// midly's strict mode checks framing but accepts surplus bytes in known meta
// events and coerces every nonzero key-mode value to minor. Check these bytes
// explicitly so malformed metadata cannot be silently reinterpreted.
fn check_meta_bytes(raw: &[u8]) -> Result<(), String> {
    if raw.first() != Some(&0xff) {
        return Ok(());
    }
    let kind = *raw.get(1).ok_or("Truncated MIDI meta event")?;
    let mut offset = 2;
    let mut length = 0_usize;
    loop {
        let value = *raw.get(offset).ok_or("Truncated MIDI meta length")?;
        offset += 1;
        if offset > 6 {
            return Err("MIDI meta length exceeds four bytes".into());
        }
        length = (length << 7) | usize::from(value & 0x7f);
        if value & 0x80 == 0 {
            break;
        }
    }
    let data = raw.get(offset..).ok_or("Truncated MIDI meta payload")?;
    if length != data.len() {
        return Err("MIDI metadata length disagrees with its payload".into());
    }
    let expected = match kind {
        0x00 if length == 0 || length == 2 => None,
        0x00 => Some(2),
        0x20 | 0x21 => Some(1),
        0x2f => Some(0),
        0x51 => Some(3),
        0x54 => Some(5),
        0x58 => Some(4),
        0x59 => Some(2),
        _ => None,
    };
    if expected.is_some_and(|n| n != length) {
        return Err(format!(
            "Malformed MIDI metadata 0x{kind:02x}: unexpected payload length"
        ));
    }
    if kind == 0x59 && data[1] > 1 {
        return Err("MIDI key mode must be 0 (major) or 1 (minor)".into());
    }
    Ok(())
}

fn display_name(bytes: &[u8], warnings: &mut Warnings) -> String {
    // MIDI text has no universal encoding. Decode a bounded prefix for a label;
    // preserve the entire original bytes, including arbitrary text, in Source.
    let raw = &bytes[..bytes.len().min(512)];
    let decoded = String::from_utf8_lossy(raw);
    let mut name = String::new();
    for ch in decoded.trim().chars().filter(|c| !c.is_control()) {
        if name.len() + ch.len_utf8() > 200 {
            break;
        }
        name.push(ch);
    }
    if std::str::from_utf8(bytes).is_err()
        || bytes.len() > 200
        || bytes.iter().any(|b| b.is_ascii_control())
    {
        warnings.add("midi_text_display", "MIDI text encoding or length required a shortened/sanitized display label; all original text bytes remain in the retained source.");
    }
    name
}

fn pitch(key: u8) -> Pitch {
    let (step, alter) = match key % 12 {
        0 => ("C", 0),
        1 => ("C", 1),
        2 => ("D", 0),
        3 => ("D", 1),
        4 => ("E", 0),
        5 => ("F", 0),
        6 => ("F", 1),
        7 => ("G", 0),
        8 => ("G", 1),
        9 => ("A", 0),
        10 => ("A", 1),
        _ => ("B", 0),
    };
    Pitch {
        step: step.into(),
        alter,
        octave: (key / 12) as i8 - 1,
    }
}

fn infer_measures(meters: &[Meter], end: Beat) -> Result<Vec<Measure>, String> {
    let mut at = Beat::ZERO;
    let mut meter_index = 0;
    let mut measures = Vec::new();
    while at.compare(end).is_lt() {
        if measures.len() == MAX_METADATA {
            return Err("MIDI would require more than 100,000 inferred measures".into());
        }
        while meter_index + 1 < meters.len() && meters[meter_index + 1].at.compare(at).is_le() {
            meter_index += 1;
        }
        let meter = &meters[meter_index];
        let full = Beat::new(i64::from(meter.numerator) * 4, i64::from(meter.denominator));
        let mut next = at
            .checked_add(full)
            .ok_or("MIDI measure timing exceeds rational limits")?;
        if next.compare(end).is_gt() {
            next = end;
        }
        if let Some(change) = meters.get(meter_index + 1) {
            if change.at.compare(next).is_lt() {
                next = change.at;
            }
        }
        let length = next
            .checked_add(Beat::new(-at.numerator, at.denominator))
            .ok_or("MIDI measure length exceeds rational limits")?;
        if length.numerator <= 0 {
            return Err("MIDI inferred measure has no duration".into());
        }
        measures.push(Measure {
            number: measures.len() as u32 + 1,
            at,
            length,
        });
        at = next;
    }
    Ok(measures)
}

/// Import type 0/1 PPQ MIDI without file/network access or rhythm quantization.
/// Unsupported pitch, pedal and note-release semantics return an actionable
/// error. Non-timing presentation/expression features produce explicit warnings.
pub fn import_midi(bytes: &[u8]) -> Result<(Score, Vec<Diagnostic>), String> {
    let expected_tracks = check_container(bytes)?;
    let (header, tracks) = midly::parse(bytes).map_err(|e| format!("Invalid MIDI header: {e}"))?;
    let ppq = match header.timing {
        Timing::Metrical(value) if value.as_int() > 0 => value.as_int(),
        Timing::Metrical(_) => return Err("MIDI PPQ division must be nonzero".into()),
        Timing::Timecode(_, _) => {
            return Err("SMPTE-timed MIDI is unsupported; export a PPQ-timed MIDI file".into())
        }
    };
    let mut warnings = Warnings::default();
    warnings.add("midi_notation_inferred", "MIDI is a performance recording, not original sheet music. Pitch spelling, voices, staff assignment and measure boundaries are inferred; timings remain exact and are not quantized. Silence is implicit, and no original rests, ties, articulations or layout can be recovered.");
    warnings.add("midi_key_release_timing", "Note durations preserve note-on to note-off key-release timing, not acoustic decay. Sustain/sostenuto and other unsupported pedal or note-release controls are rejected rather than converted into guessed notation.");
    let mut names = Vec::with_capacity(expected_tracks);
    let mut note_events = Vec::new();
    let mut tempo_map = BTreeMap::new();
    let mut meter_map = BTreeMap::new();
    let mut key_map = BTreeMap::new();
    let mut total_events = 0;
    let mut note_count = 0;
    let mut end_tick = 0;
    for (track_index, events) in tracks.enumerate() {
        if track_index >= expected_tracks {
            return Err("MIDI parsed track count exceeds its header".into());
        }
        let events = events.map_err(|e| format!("Invalid MIDI track {}: {e}", track_index + 1))?;
        let mut name = String::new();
        let mut tick = 0_u64;
        let mut ended = false;
        for (index, event) in events.bytemapped().enumerate() {
            total_events += 1;
            if total_events > MAX_EVENTS {
                return Err("MIDI exceeds 1,000,000-event import limit".into());
            }
            let (raw, event) = event
                .map_err(|e| format!("Invalid MIDI event in track {}: {e}", track_index + 1))?;
            check_meta_bytes(raw)?;
            if ended {
                return Err(format!(
                    "MIDI track {} has events after EndOfTrack",
                    track_index + 1
                ));
            }
            tick = tick
                .checked_add(u64::from(event.delta.as_int()))
                .ok_or("MIDI tick overflow")?;
            beat(tick, ppq)?;
            end_tick = end_tick.max(tick);
            match event.kind {
                TrackEventKind::Midi { channel, message } => {
                    let channel = channel.as_int();
                    let note = match message {
                        MidiMessage::NoteOn { key, vel } => Some((key.as_int(), vel.as_int(), vel.as_int() != 0)),
                        MidiMessage::NoteOff { key, vel } => {
                            if vel.as_int() != 0 {
                                warnings.add("midi_release_velocity_source_only", "MIDI note-off release velocities are retained in the original source only; the canonical score preserves note-on velocity and exact key-release timing.");
                            }
                            Some((key.as_int(), vel.as_int(), false))
                        }
                        MidiMessage::PitchBend { .. } => return Err("MIDI pitch-bend events are unsupported; rendering fixed pitches would change the performance".into()),
                        MidiMessage::Controller { controller, .. } => {
                            match controller.as_int() {
                                64 | 66 | 69 => return Err("MIDI sustain, sostenuto or hold-pedal controls are unsupported. Key release and pedal release are different events; remove/resolve pedal data explicitly before importing".into()),
                                0 | 7 | 10 | 11 | 32 | 91 | 93 => warnings.add("midi_controller_source_only", "MIDI bank selection, volume, pan, expression and effect controllers are retained in the original source only; playback uses note-on velocities and does not reproduce these controller changes."),
                                number => return Err(format!("MIDI controller {number} is unsupported; it may change pitch, timing or note-release behavior. Its effects cannot be inferred safely")),
                            }
                            None
                        }
                        MidiMessage::ProgramChange { .. } => {
                            warnings.add("midi_program_source_only", "MIDI program changes are retained in the original source only. No General MIDI instrument or original sound is assumed; choose the practice instrument explicitly.");
                            None
                        }
                        MidiMessage::Aftertouch { .. } | MidiMessage::ChannelAftertouch { .. } => {
                            warnings.add("midi_aftertouch_source_only", "MIDI key/channel pressure is retained in the original source only; its expressive effect is not reproduced.");
                            None
                        }
                    };
                    if let Some((key, velocity, on)) = note {
                        if channel == 9 {
                            return Err("MIDI channel 10 percussion is unsupported; percussion keys cannot be interpreted as pitched notation".into());
                        }
                        if on {
                            note_count += 1;
                            if note_count > MAX_NOTES {
                                return Err("MIDI exceeds 100,000-note import limit".into());
                            }
                        }
                        if note_events.len() >= MAX_NOTES * 2 {
                            return Err("MIDI exceeds 200,000 note-on/off events or contains unmatched releases".into());
                        }
                        note_events.push(NoteEvent { tick, track: track_index, index, channel, key, velocity, on });
                    }
                }
                TrackEventKind::Meta(meta) => match meta {
                    MetaMessage::Tempo(value) => {
                        let value = value.as_int();
                        if !(100_000..=6_000_000).contains(&value) {
                            return Err("MIDI tempo must be positive and within the supported 10–600 BPM range".into());
                        }
                        metadata(&mut tempo_map, tick, value, "tempo")?;
                    }
                    MetaMessage::TimeSignature(numerator, power, clocks, thirty_seconds) => {
                        if numerator == 0 || power > 15 || thirty_seconds != 8 {
                            return Err("Unsupported MIDI time signature: expected a positive numerator, denominator at most 32768 and eight 32nd notes per MIDI quarter note".into());
                        }
                        if clocks != 24 {
                            warnings.add("midi_metronome_source_only", "MIDI metronome-click grouping is retained only in the original source; the practice click uses the displayed meter.");
                        }
                        metadata(&mut meter_map, tick, (u16::from(numerator), 1_u16 << power), "time signature")?;
                    }
                    MetaMessage::KeySignature(fifths, minor) => {
                        if !(-7..=7).contains(&fifths) {
                            return Err("MIDI key signature is outside −7 to +7 fifths".into());
                        }
                        metadata(&mut key_map, tick, (fifths, minor), "key signature")?;
                    }
                    MetaMessage::TrackName(bytes) if name.is_empty() => name = display_name(bytes, &mut warnings),
                    MetaMessage::EndOfTrack => ended = true,
                    MetaMessage::SmpteOffset(_) => return Err("MIDI SMPTE offset is unsupported; absolute track offsets must be resolved before import".into()),
                    MetaMessage::MidiPort(_) => return Err("MIDI port routing is unsupported; export a single-port MIDI file to avoid conflating independent channels".into()),
                    MetaMessage::Unknown(_, _) => return Err("Unknown or malformed MIDI metadata is unsupported; it may contain performance semantics".into()),
                    MetaMessage::SequencerSpecific(_) => return Err("Sequencer-specific MIDI metadata is unsupported; tuning and playback semantics cannot be inferred safely".into()),
                    _ => warnings.add("midi_metadata_source_only", "MIDI text, lyrics, copyright notices, instrument labels and other non-timing metadata are retained in the original source only. Copyright text is not treated as a license grant."),
                },
                TrackEventKind::SysEx(_) | TrackEventKind::Escape(_) => return Err("MIDI SysEx/escape events are unsupported; they can change tuning, drum modes or playback and cannot be silently ignored".into()),
            }
        }
        if !ended {
            return Err(format!(
                "MIDI track {} is missing EndOfTrack",
                track_index + 1
            ));
        }
        names.push(name);
    }
    if names.len() != expected_tracks {
        return Err("MIDI parsed track count disagrees with its header".into());
    }
    // MIDI channels are shared across type-1 tracks. Match across tracks rather
    // than closing every track independently or treating tracks as MIDI ports.
    note_events.sort_by_key(|e| (e.tick, e.channel, e.key, e.track, e.index));
    let mut active = BTreeMap::<(u8, u8), NoteEvent>::new();
    let mut parts = BTreeMap::<(usize, u8), Part>::new();
    let mut prior: Option<NoteEvent> = None;
    for event in note_events {
        if prior.is_some_and(|p| {
            p.tick == event.tick
                && p.channel == event.channel
                && p.key == event.key
                && p.track != event.track
        }) {
            return Err(format!("Ambiguous simultaneous MIDI events for channel {} pitch {} across tracks; no cross-track note order is inferred", event.channel + 1, event.key));
        }
        prior = Some(event);
        let key = (event.channel, event.key);
        if event.on {
            if active.insert(key, event).is_some() {
                return Err(format!("Ambiguous overlapping MIDI note-ons for channel {} pitch {}; distinct releases cannot be matched safely", event.channel + 1, event.key));
            }
            continue;
        }
        let start = active.remove(&key).ok_or_else(|| {
            format!(
                "Unmatched MIDI note-off on channel {} pitch {} at tick {}",
                event.channel + 1,
                event.key,
                event.tick
            )
        })?;
        if start.tick == event.tick {
            return Err(format!(
                "MIDI pitch {} has zero key-down duration; cannot invent a notated duration",
                event.key
            ));
        }
        let part_key = (start.track, start.channel);
        if !parts.contains_key(&part_key) && parts.len() == MAX_PARTS {
            return Err("MIDI exceeds 128 track/channel parts".into());
        }
        let part = parts.entry(part_key).or_insert_with(|| {
            let label = if names[start.track].is_empty() {
                format!("Track {}", start.track + 1)
            } else {
                names[start.track].clone()
            };
            Part {
                id: format!("midi-t{}-c{}", start.track + 1, start.channel + 1),
                name: format!("{label} · channel {}", start.channel + 1),
                instrument: format!("MIDI channel {}", start.channel + 1),
                notes: Vec::new(),
            }
        });
        part.notes.push(Note {
            id: format!(
                "midi-t{}-c{}-e{}",
                start.track + 1,
                start.channel + 1,
                start.index + 1
            ),
            at: beat(start.tick, ppq)?,
            duration: beat(event.tick - start.tick, ppq)?,
            pitch: Some(pitch(start.key)),
            voice: "inferred-1".into(),
            staff: 1,
            velocity: start.velocity,
            tie_start: false,
            tie_stop: false,
        });
    }
    if let Some(((channel, key), _)) = active.first_key_value() {
        return Err(format!(
            "Unclosed MIDI note-on on channel {} pitch {key}; no note-off was found",
            channel + 1
        ));
    }
    if note_count == 0 {
        return Err("MIDI contains no pitched notes to import".into());
    }
    if let std::collections::btree_map::Entry::Vacant(entry) = tempo_map.entry(0) {
        entry.insert(500_000);
        warnings.add("midi_default_tempo", "No tempo is specified at tick zero; MIDI's standard default of 120 BPM is used until the first tempo event.");
    }
    if let std::collections::btree_map::Entry::Vacant(entry) = meter_map.entry(0) {
        entry.insert((4, 4));
        warnings.add("midi_default_meter", "No meter is specified at tick zero; 4/4 is inferred until the first time-signature event.");
    }
    let tempo = tempo_map
        .into_iter()
        .map(|(tick, micros)| {
            Ok(Tempo {
                at: beat(tick, ppq)?,
                bpm: 60_000_000.0 / f64::from(micros),
            })
        })
        .collect::<Result<Vec<_>, String>>()?;
    let meters = meter_map
        .into_iter()
        .map(|(tick, (numerator, denominator))| {
            Ok(Meter {
                at: beat(tick, ppq)?,
                numerator,
                denominator,
            })
        })
        .collect::<Result<Vec<_>, String>>()?;
    let keys = key_map
        .into_iter()
        .map(|(tick, (fifths, minor))| {
            Ok(Key {
                at: beat(tick, ppq)?,
                fifths,
                mode: if minor { "minor" } else { "major" }.into(),
            })
        })
        .collect::<Result<Vec<_>, String>>()?;
    let measures = infer_measures(&meters, beat(end_tick, ppq)?)?;
    let mut parts: Vec<_> = parts.into_values().collect();
    for part in &mut parts {
        part.notes
            .sort_by(|a, b| a.at.compare(b.at).then(a.id.cmp(&b.id)));
    }
    // A stable, non-security content identifier. Source retains authoritative bytes.
    let fingerprint = bytes.iter().fold(0xcbf29ce484222325_u64, |hash, byte| {
        (hash ^ u64::from(*byte)).wrapping_mul(0x100000001b3)
    });
    let title = names
        .first()
        .filter(|n| !n.is_empty())
        .cloned()
        .unwrap_or_else(|| "Imported MIDI performance".into());
    let score = Score { format_metadata: Some(crate::FormatMetadata::current()),
        version: 1, id: format!("midi-{fingerprint:016x}"), title, composer: String::new(),
        provenance: Provenance { kind: "user_import".into(), attribution: "User-supplied MIDI performance; ownership and usage rights are not verified. Notation is inferred, not original sheet music.".into(), source_url: None, license: None },
        parts, tempo, meters, keys, measures, repeats: Vec::new(),
        source: Some(Source { import_diagnostics: Some(warnings.entries.clone()), format: "midi-base64".into(), filename: None, content: STANDARD.encode(bytes) }),
    };
    crate::validate(&score)?;
    Ok((score, warnings.entries))
}

#[cfg(test)]
mod tests {
    use super::*;

    // Every fixture is synthetic, authored for this importer. No third-party
    // melody, recording, copyrighted score or downloaded MIDI asset is used.
    fn varlen(mut value: u32) -> Vec<u8> {
        let mut bytes = vec![(value & 0x7f) as u8];
        value >>= 7;
        while value != 0 {
            bytes.push(((value & 0x7f) | 0x80) as u8);
            value >>= 7;
        }
        bytes.reverse();
        bytes
    }
    fn event(delta: u32, payload: &[u8]) -> Vec<u8> {
        let mut bytes = varlen(delta);
        bytes.extend_from_slice(payload);
        bytes
    }
    fn track(events: &[(u32, &[u8])]) -> Vec<u8> {
        events
            .iter()
            .flat_map(|(delta, payload)| event(*delta, payload))
            .collect()
    }
    fn smf(format: u16, division: u16, tracks: &[Vec<u8>]) -> Vec<u8> {
        let mut bytes = b"MThd\0\0\0\x06".to_vec();
        bytes.extend_from_slice(&format.to_be_bytes());
        bytes.extend_from_slice(&(tracks.len() as u16).to_be_bytes());
        bytes.extend_from_slice(&division.to_be_bytes());
        for track in tracks {
            bytes.extend_from_slice(b"MTrk");
            bytes.extend_from_slice(&(track.len() as u32).to_be_bytes());
            bytes.extend_from_slice(track);
        }
        bytes
    }
    fn simple() -> Vec<u8> {
        smf(
            0,
            480,
            &[track(&[
                (0, &[0x90, 60, 93]),
                (480, &[0x80, 60, 0]),
                (0, &[0xff, 0x2f, 0]),
            ])],
        )
    }
    fn with_prefix(payload: &[u8]) -> Vec<u8> {
        smf(
            0,
            480,
            &[track(&[
                (0, payload),
                (0, &[0x90, 60, 93]),
                (480, &[0x80, 60, 0]),
                (0, &[0xff, 0x2f, 0]),
            ])],
        )
    }
    fn error(bytes: &[u8], needle: &str) {
        let err = import_midi(bytes).unwrap_err();
        assert!(err.contains(needle), "expected {needle:?}, got {err:?}");
    }

    #[test]
    fn midi_type_zero_preserves_pitch_velocity_and_exact_original_source() {
        let bytes = simple();
        let (score, warnings) = import_midi(&bytes).unwrap();
        let note = &score.parts[0].notes[0];
        assert_eq!(note.pitch.as_ref().unwrap().midi(), Some(60));
        assert_eq!(note.velocity, 93);
        assert!(note.at.equivalent(Beat::ZERO));
        assert!(note.duration.equivalent(Beat::new(1, 1)));
        assert_eq!(score.tempo[0].bpm, 120.0);
        assert_eq!(score.provenance.kind, "user_import");
        assert_eq!(score.provenance.license, None);
        assert!(warnings.iter().any(|w| w.code == "midi_notation_inferred"));
        assert!(warnings.iter().any(|w| w.code == "midi_key_release_timing"));
        let source = score.source.as_ref().unwrap();
        assert_eq!(source.format, "midi-base64");
        assert_eq!(STANDARD.decode(&source.content).unwrap(), bytes);
        let json = serde_json::to_string(&score).unwrap();
        let copy: Score = serde_json::from_str(&json).unwrap();
        assert_eq!(
            STANDARD.decode(copy.source.unwrap().content).unwrap(),
            bytes
        );
        assert_eq!(
            serde_json::to_string(&import_midi(&bytes).unwrap().0).unwrap(),
            json
        );
    }

    #[test]
    fn midi_original_browser_fixture_imports_three_synthetic_notes() {
        let bytes = include_bytes!("../../../tests/fixtures/midi-original-ppq.mid");
        let (score, _) = import_midi(bytes).unwrap();
        assert_eq!(score.title, "Original MIDI fixture");
        assert_eq!(score.parts.len(), 1);
        assert_eq!(score.parts[0].notes.len(), 3);
        assert_eq!(score.tempo.len(), 2);
        assert_eq!(score.meters[0].numerator, 3);
        assert_eq!(
            STANDARD.decode(score.source.unwrap().content).unwrap(),
            bytes
        );
    }

    #[test]
    fn midi_type_one_preserves_channels_tracks_and_tempo_change_inside_note() {
        let bytes = smf(
            1,
            480,
            &[
                track(&[
                    (
                        0,
                        &[
                            0xff, 3, 9, b'S', b'y', b'n', b't', b'h', b'e', b't', b'i', b'c',
                        ],
                    ),
                    (0, &[0xff, 0x51, 3, 7, 0xa1, 0x20]),
                    (240, &[0xff, 0x51, 3, 0x0f, 0x42, 0x40]),
                    (240, &[0xff, 0x2f, 0]),
                ]),
                track(&[
                    (1, &[0x90, 60, 90]),
                    (0, &[0x91, 67, 70]),
                    (479, &[0x80, 60, 0]),
                    (0, &[0x81, 67, 0]),
                    (0, &[0xff, 0x2f, 0]),
                ]),
            ],
        );
        let (score, _) = import_midi(&bytes).unwrap();
        assert_eq!(score.title, "Synthetic");
        assert_eq!(score.parts.len(), 2);
        assert_eq!(score.parts[0].id, "midi-t2-c1");
        assert_eq!(score.parts[1].id, "midi-t2-c2");
        assert!(score.parts[0].notes[0].at.equivalent(Beat::new(1, 480)));
        assert!(score.parts[0].notes[0]
            .duration
            .equivalent(Beat::new(479, 480)));
        let timeline = crate::compile(score).unwrap().timeline;
        assert!((timeline.notes[0].start_ms - 500.0 / 480.0).abs() < 1e-8);
        assert!((timeline.notes[0].duration_ms - (750.0 - 500.0 / 480.0)).abs() < 1e-8);
    }

    #[test]
    fn midi_running_status_and_velocity_zero_release_are_supported() {
        let bytes = smf(
            0,
            7,
            &[track(&[
                (1, &[0x90, 61, 117]),
                (2, &[61, 0]),
                (0, &[0xff, 0x2f, 0]),
            ])],
        );
        let score = import_midi(&bytes).unwrap().0;
        let note = &score.parts[0].notes[0];
        assert!(note.at.equivalent(Beat::new(1, 7)));
        assert!(note.duration.equivalent(Beat::new(2, 7)));
        assert_eq!(note.velocity, 117);
        assert_eq!(note.pitch.as_ref().unwrap().midi(), Some(61));
    }

    #[test]
    fn midi_all_pitches_including_extremes_survive_without_transposition() {
        let mut events = Vec::new();
        for key in 0..=127 {
            events.extend(event(0, &[0x90, key, 100]));
            events.extend(event(1, &[0x80, key, 0]));
        }
        events.extend(event(0, &[0xff, 0x2f, 0]));
        let score = import_midi(&smf(0, 128, &[events])).unwrap().0;
        let keys: Vec<_> = score.parts[0]
            .notes
            .iter()
            .map(|n| n.pitch.as_ref().unwrap().midi().unwrap())
            .collect();
        assert_eq!(keys, (0..=127).collect::<Vec<_>>());
    }

    #[test]
    fn midi_polyphonic_notes_are_not_discarded_or_quantized() {
        let bytes = smf(
            0,
            960,
            &[track(&[
                (0, &[0x90, 60, 90]),
                (3, &[0x90, 64, 80]),
                (2, &[0x90, 67, 70]),
                (7, &[0x80, 64, 0]),
                (8, &[0x80, 60, 0]),
                (15, &[0x80, 67, 0]),
                (0, &[0xff, 0x2f, 0]),
            ])],
        );
        let score = import_midi(&bytes).unwrap().0;
        assert_eq!(score.parts[0].notes.len(), 3);
        assert!(score.parts[0].notes[1].at.equivalent(Beat::new(1, 320)));
        assert!(score.parts[0].notes[1]
            .duration
            .equivalent(Beat::new(3, 320)));
    }

    #[test]
    fn midi_cross_track_release_uses_shared_channel_state() {
        let bytes = smf(
            1,
            96,
            &[
                track(&[(0, &[0x90, 64, 72]), (0, &[0xff, 0x2f, 0])]),
                track(&[(96, &[0x80, 64, 0]), (0, &[0xff, 0x2f, 0])]),
            ],
        );
        let score = import_midi(&bytes).unwrap().0;
        assert_eq!(score.parts[0].id, "midi-t1-c1");
        assert!(score.parts[0].notes[0].duration.equivalent(Beat::new(1, 1)));
    }

    #[test]
    fn midi_maps_meter_and_key_changes_without_inventing_original_bars() {
        let bytes = smf(
            0,
            480,
            &[track(&[
                (0, &[0xff, 0x58, 4, 3, 2, 24, 8]),
                (0, &[0xff, 0x59, 2, 0xfe, 1]),
                (0, &[0x90, 62, 88]),
                (960, &[0xff, 0x58, 4, 5, 3, 36, 8]),
                (0, &[0xff, 0x59, 2, 1, 0]),
                (1200, &[0x80, 62, 0]),
                (0, &[0xff, 0x2f, 0]),
            ])],
        );
        let (score, warnings) = import_midi(&bytes).unwrap();
        assert_eq!(score.meters.len(), 2);
        assert_eq!(score.meters[1].numerator, 5);
        assert_eq!(score.meters[1].denominator, 8);
        assert_eq!(score.keys[0].fifths, -2);
        assert_eq!(score.keys[0].mode, "minor");
        assert_eq!(score.keys[1].mode, "major");
        assert_eq!(score.measures.len(), 2);
        assert!(score.measures[0].length.equivalent(Beat::new(2, 1)));
        assert!(score.measures[1].length.equivalent(Beat::new(5, 2)));
        assert!(warnings
            .iter()
            .any(|w| w.code == "midi_metronome_source_only"));
    }

    #[test]
    fn midi_metadata_duplicates_agree_and_conflicts_are_errors() {
        let prefix = [0xff, 0x51, 3, 7, 0xa1, 0x20];
        let mut bytes = smf(
            1,
            480,
            &[
                track(&[(0, &prefix), (0, &[0xff, 0x2f, 0])]),
                track(&[
                    (0, &prefix),
                    (0, &[0x90, 60, 90]),
                    (480, &[0x80, 60, 0]),
                    (0, &[0xff, 0x2f, 0]),
                ]),
            ],
        );
        assert_eq!(import_midi(&bytes).unwrap().0.tempo.len(), 1);
        // Change only the second tempo, keeping a structurally valid file.
        let last = bytes.windows(6).rposition(|b| b == prefix).unwrap();
        bytes[last + 5] += 1;
        error(&bytes, "Conflicting MIDI tempo");
    }

    #[test]
    fn midi_rejects_ambiguous_overlap_missing_releases_and_zero_durations() {
        for (events, needle) in [
            (
                vec![
                    (0, vec![0x90, 60, 90]),
                    (1, vec![0x90, 60, 80]),
                    (1, vec![0x80, 60, 0]),
                ],
                "overlapping",
            ),
            (vec![(0, vec![0x80, 60, 0])], "Unmatched"),
            (vec![(0, vec![0x90, 60, 90])], "Unclosed"),
            (
                vec![(0, vec![0x90, 60, 90]), (0, vec![0x80, 60, 0])],
                "zero key-down",
            ),
        ] {
            let mut raw: Vec<_> = events
                .iter()
                .flat_map(|(delta, bytes)| event(*delta, bytes))
                .collect();
            raw.extend(event(0, &[0xff, 0x2f, 0]));
            error(&smf(0, 480, &[raw]), needle);
        }
    }

    #[test]
    fn midi_rejects_ambiguous_cross_track_simultaneous_events() {
        let bytes = smf(
            1,
            480,
            &[
                track(&[
                    (0, &[0x90, 60, 90]),
                    (480, &[0x80, 60, 0]),
                    (0, &[0xff, 0x2f, 0]),
                ]),
                track(&[
                    (480, &[0x90, 60, 90]),
                    (480, &[0x80, 60, 0]),
                    (0, &[0xff, 0x2f, 0]),
                ]),
            ],
        );
        error(&bytes, "simultaneous");
    }

    #[test]
    fn midi_rejects_unsupported_performance_semantics_explicitly() {
        for (prefix, needle) in [
            (vec![0xb0, 64, 127], "sustain"),
            (vec![0xb0, 64, 0], "sustain"),
            (vec![0xb0, 66, 127], "sostenuto"),
            (vec![0xb0, 123, 0], "controller 123"),
            (vec![0xb0, 101, 0], "controller 101"),
            (vec![0xe0, 0, 64], "pitch-bend"),
            (vec![0xf0, 1, 0xf7], "SysEx"),
            (vec![0xf7, 1, 0xf7], "SysEx"),
            (vec![0xff, 0x21, 1, 0], "port routing"),
            (vec![0xff, 0x7f, 0], "Sequencer-specific"),
        ] {
            error(&with_prefix(&prefix), needle);
        }
        error(
            &smf(
                0,
                480,
                &[track(&[
                    (0, &[0x99, 35, 90]),
                    (480, &[0x89, 35, 0]),
                    (0, &[0xff, 0x2f, 0]),
                ])],
            ),
            "percussion",
        );
    }

    #[test]
    fn midi_expression_metadata_is_warned_and_original_source_is_retained() {
        for (prefix, code) in [
            (vec![0xb0, 7, 100], "midi_controller_source_only"),
            (vec![0xc0, 24], "midi_program_source_only"),
            (vec![0xa0, 60, 30], "midi_aftertouch_source_only"),
            (
                vec![0xff, 2, 3, b'M', b'I', b'T'],
                "midi_metadata_source_only",
            ),
        ] {
            let bytes = with_prefix(&prefix);
            let (score, warnings) = import_midi(&bytes).unwrap();
            assert!(warnings.iter().any(|w| w.code == code));
            assert_eq!(score.provenance.license, None);
            assert_eq!(
                STANDARD.decode(score.source.unwrap().content).unwrap(),
                bytes
            );
        }
    }

    #[test]
    fn midi_rejects_type_two_smpte_and_zero_ppq() {
        let mut bytes = simple();
        bytes[9] = 2;
        error(&bytes, "type 2");
        bytes[9] = 0;
        bytes[12] = 0xe7;
        bytes[13] = 40;
        error(&bytes, "SMPTE");
        bytes[12] = 0;
        bytes[13] = 0;
        error(&bytes, "nonzero");
    }

    #[test]
    fn midi_rejects_malformed_container_and_events_without_partial_import() {
        let bytes = simple();
        for end in 0..bytes.len() {
            assert!(import_midi(&bytes[..end]).is_err(), "truncated at {end}");
        }
        let mut extra = bytes.clone();
        extra.push(0);
        error(&extra, "trailing data");
        let mut count = bytes;
        count[11] = 2;
        error(&count, "type 0");
        error(
            &smf(0, 480, &[track(&[(0, &[0x90, 60, 90])])]),
            "missing EndOfTrack",
        );
        error(
            &smf(
                0,
                480,
                &[track(&[(0, &[0xff, 0x2f, 0]), (0, &[0x90, 60, 90])])],
            ),
            "after EndOfTrack",
        );
        error(&with_prefix(&[0x90, 0xff, 90]), "Invalid MIDI event");
        error(
            &with_prefix(&[0xff, 0x51, 2, 7, 0xa1]),
            "Malformed MIDI metadata",
        );
    }

    #[test]
    fn midi_checks_known_meta_lengths_modes_and_tempo_range() {
        for (prefix, needle) in [
            (vec![0xff, 0x2f, 1, 0], "payload length"),
            (vec![0xff, 0x51, 4, 7, 0xa1, 0x20, 0], "payload length"),
            (vec![0xff, 0x59, 2, 0, 2], "key mode"),
            (vec![0xff, 0x59, 2, 8, 0], "fifths"),
            (vec![0xff, 0x51, 3, 0, 0, 0], "tempo"),
            (vec![0xff, 0x58, 4, 0, 2, 24, 8], "time signature"),
            (vec![0xff, 0x58, 4, 4, 16, 24, 8], "time signature"),
            (vec![0xff, 0x58, 4, 4, 2, 24, 4], "time signature"),
        ] {
            error(&with_prefix(&prefix), needle);
        }
    }

    #[test]
    fn midi_text_labels_are_bounded_and_do_not_claim_licenses() {
        let mut prefix = vec![0xff, 3];
        prefix.extend(varlen(1024));
        prefix.extend(vec![0xff; 1024]);
        let (score, warnings) = import_midi(&with_prefix(&prefix)).unwrap();
        assert!(score.title.len() <= 200);
        assert!(score.parts[0].name.len() <= 256);
        assert!(warnings.iter().any(|w| w.code == "midi_text_display"));
        assert_eq!(score.provenance.license, None);
    }

    #[test]
    fn midi_limits_input_tracks_notes_events_and_timing() {
        error(&vec![0; MAX_SOURCE_BYTES + 1], "5 MiB");
        error(
            &smf(1, 480, &vec![event(0, &[0xff, 0x2f, 0]); 129]),
            "1–128 tracks",
        );
        let mut notes = Vec::new();
        for _ in 0..=MAX_NOTES {
            notes.extend(event(0, &[0x90, 60, 90]));
            notes.extend(event(1, &[0x80, 60, 0]));
        }
        notes.extend(event(0, &[0xff, 0x2f, 0]));
        error(&smf(0, 480, &[notes]), "100,000-note");
        let mut events = vec![0, 0xc0, 0];
        for _ in 0..MAX_EVENTS {
            events.extend_from_slice(&[0, 0]);
        }
        events.extend(event(0, &[0xff, 0x2f, 0]));
        error(&smf(0, 480, &[events]), "1,000,000-event");
        let huge = smf(
            0,
            1,
            &[track(&[
                (0x0fffffff, &[0xff, 1, 0]),
                (0x0fffffff, &[0xff, 1, 0]),
                (0x0fffffff, &[0xff, 1, 0]),
                (0x0fffffff, &[0xff, 0x2f, 0]),
            ])],
        );
        error(&huge, "rational limits");
    }

    #[test]
    fn midi_limits_track_channel_parts_and_inferred_measures() {
        let mut tracks = Vec::new();
        for i in 0..9 {
            let mut raw = Vec::new();
            for channel in (0..16).filter(|c| *c != 9) {
                raw.extend(event(0, &[0x90 + channel, 40 + i, 90]));
            }
            for channel in (0..16).filter(|c| *c != 9) {
                raw.extend(event(1, &[0x80 + channel, 40 + i, 0]));
            }
            raw.extend(event(0, &[0xff, 0x2f, 0]));
            tracks.push(raw);
        }
        error(&smf(1, 480, &tracks), "128 track/channel parts");
        let bytes = smf(
            0,
            1,
            &[track(&[
                (0, &[0x90, 60, 90]),
                (400_001, &[0x80, 60, 0]),
                (0, &[0xff, 0x2f, 0]),
            ])],
        );
        error(&bytes, "100,000 inferred measures");
    }

    #[test]
    fn midi_mutated_synthetic_files_never_panic() {
        let source = simple();
        for offset in 0..source.len() {
            for value in [0, 1, 0x7f, 0x80, 0xff] {
                let mut changed = source.clone();
                changed[offset] = value;
                assert!(
                    std::panic::catch_unwind(|| import_midi(&changed)).is_ok(),
                    "panic at byte {offset} = {value}"
                );
            }
        }
    }
}

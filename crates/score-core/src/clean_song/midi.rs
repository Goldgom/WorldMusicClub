use super::*;
use crate::midi_events::{ChannelMessage, DiagnosticCode, EventKind};

fn coordinate(event: &crate::midi_events::RawEvent) -> Coordinate {
    Coordinate {
        track: event.id().track_index(),
        event: event.id().event_index(),
    }
}
fn exact_end(tick: u64, ppq: u16) -> Result<Beat, String> {
    let divisor = crate::gcd(tick as u128, ppq as u128) as u64;
    let result = Beat::new((tick / divisor) as i64, ppq as i64 / divisor as i64);
    result
        .valid()
        .then_some(result)
        .ok_or_else(|| "Sequence clock exceeds exact rational bounds".into())
}
fn text_command(meta_type: u8, data: &[u8]) -> Result<Command, String> {
    let role = match meta_type {
        1 => TextRole::Text,
        2 => TextRole::Copyright,
        3 => TextRole::TrackName,
        4 => TextRole::InstrumentName,
        5 => TextRole::Lyric,
        6 => TextRole::Marker,
        7 => TextRole::Cue,
        8 => TextRole::ProgramName,
        9 => TextRole::DeviceName,
        _ => return Err(format!("Unknown text role {meta_type}")),
    };
    let text = std::str::from_utf8(data).map_err(|_| "MIDI text requires an explicit encoding decision before clean conversion; no replacement characters were introduced")?.to_string();
    Ok(Command::Text { role, text })
}

fn initial_pitch_bend_sensitivity(
    channel: u8,
    controller: u8,
    value: u8,
) -> Result<Command, String> {
    use InitialPitchBendSensitivityStep::*;
    let step = match (controller, value) {
        (101, 0) => SelectMostSignificantZero,
        (100, 0) => SelectLeastSignificantZero,
        (6, 24) => SetSemitones24,
        (38, 0) => SetCentsZero,
        (101, 127) => DeselectMostSignificant,
        (100, 127) => DeselectLeastSignificant,
        _ => return Err("Unreviewed initial pitch-bend sensitivity selector or value".into()),
    };
    Ok(Command::InitialPitchBendSensitivity { channel, step })
}

/// All-track conversion: either a complete validated semantic score or an error.
/// Does not write files, silently skip a track, or retain the original input.
pub fn convert_midi(bytes: &[u8]) -> Result<CompleteScore, String> {
    // Reuse the exact, conservative importer for note matching and notation.
    let (mut notation, _) = crate::import_midi(bytes)?;
    let timeline = crate::midi_events::parse_midi_events(bytes, None).map_err(|e| e.to_string())?;
    if !timeline.relative_clock_available() {
        return Err("A unique source performance clock is unavailable".into());
    }
    for diagnostic in timeline.diagnostics() {
        if matches!(
            diagnostic.code(),
            DiagnosticCode::CrossTrackChannelOrder
                | DiagnosticCode::CrossTrackTempoOrder
                | DiagnosticCode::RoutingUninterpreted
        ) {
            return Err(format!(
                "Clean conversion requires resolved source semantics: {}",
                diagnostic.code().message()
            ));
        }
    }
    let mut tracks: Vec<_> = (0..timeline.track_count())
        .map(|index| Track {
            id: format!("track-{}", index + 1),
            name: format!("Track {}", index + 1),
            source_index: index,
            source_event_count: 0,
            end: Beat::ZERO,
        })
        .collect();
    // Source validation has proved the entire grammar. Select its closed command
    // vocabulary without coalescing any of the original selector/value writes.
    let sensitivity12_channels: BTreeSet<_> = timeline
        .events()
        .iter()
        .filter_map(|event| match event.kind() {
            EventKind::Channel {
                channel,
                message:
                    ChannelMessage::Controller {
                        controller: 6,
                        value: 12,
                    },
            } => Some(*channel),
            _ => None,
        })
        .collect();
    let mut part_channels = BTreeMap::new();
    let mut notes = Vec::new();
    let mut events = Vec::new();
    let mut held = BTreeMap::<(u8, u8), (String, String, Coordinate)>::new();
    for event in timeline.events() {
        let origin = coordinate(event);
        let track = &mut tracks[origin.track as usize];
        track.source_event_count += 1;
        track.end = event.beat();
        let command = match event.kind() {
            EventKind::Channel { channel, message } => match message {
                ChannelMessage::NoteOn { key, velocity } if *velocity > 0 => {
                    let part_id = format!("midi-t{}-c{}", origin.track + 1, channel + 1);
                    let note_id = format!("midi-t{}-c{}-e{}", origin.track + 1, channel + 1, origin.event + 1);
                    part_channels.insert(part_id.clone(), (origin.track, *channel));
                    if held.insert((*channel, *key), (note_id, part_id, origin)).is_some() { return Err("Ambiguous same-pitch note overlap".into()); }
                    continue;
                },
                ChannelMessage::NoteOn { key, velocity } | ChannelMessage::NoteOff { key, velocity } => {
                    let (note_id, part_id, attack) = held.remove(&(*channel, *key)).ok_or("Unmatched key release")?;
                    notes.push(PerformanceNote { note_id, part_id, attack, release: origin, release_velocity: *velocity });
                    continue;
                },
                ChannelMessage::ProgramChange { program } => Command::InstrumentProgram { channel: *channel, program: *program },
                ChannelMessage::KeyPressure { key, pressure } => Command::KeyPressure { channel: *channel, key: *key, pressure: *pressure },
                ChannelMessage::ChannelPressure { pressure } => Command::ChannelPressure { channel: *channel, pressure: *pressure },
                ChannelMessage::Controller { controller, value } => match controller {
                    0 => Command::BankSelect { channel: *channel, component: BankComponent::MostSignificant, value: *value },
                    32 => Command::BankSelect { channel: *channel, component: BankComponent::LeastSignificant, value: *value },
                    7 => Command::Volume { channel: *channel, value: *value },
                    10 => Command::Pan { channel: *channel, value: *value },
                    11 => Command::Expression { channel: *channel, value: *value },
                    91 => Command::ReverbSend { channel: *channel, value: *value },
                    93 => Command::ChorusSend { channel: *channel, value: *value },
                    121 if *value == 0 && event.tick() == 0 => Command::InitialControllerReset { channel: *channel },
                    64 if *value == 0 && event.tick() == 0 => Command::InitialSustainOff { channel: *channel },
                    6 | 38 | 100 | 101 if sensitivity12_channels.contains(channel) => Command::InitialPitchBendSensitivity12 {
                        channel: *channel, step: InitialPitchBendSensitivity12Step::from_controller(*controller, *value)?,
                    },
                    6 | 38 | 100 | 101 if event.tick() == 0 => initial_pitch_bend_sensitivity(*channel, *controller, *value)?,
                    _ => return Err(format!("Controller {controller} has no supported complete semantic conversion")),
                },
                ChannelMessage::PitchBend { .. } => return Err("Pitch bend requires a reviewed tuning semantic profile".into()),
            },
            EventKind::Tempo { microseconds_per_quarter } => Command::Tempo { microseconds_per_quarter: *microseconds_per_quarter },
            EventKind::TimeSignature { numerator, denominator_power, clocks_per_click, thirty_seconds_per_quarter } => {
                if *denominator_power > 15 { return Err("Meter denominator exceeds semantic bounds".into()); }
                Command::Meter { numerator: *numerator, denominator: 1u16 << denominator_power, clocks_per_click: *clocks_per_click, thirty_seconds_per_quarter: *thirty_seconds_per_quarter }
            },
            EventKind::Meta { meta_type, data } => match meta_type {
                0 if data.is_empty() => Command::SequenceNumber { number: None },
                0 if data.len() == 2 => Command::SequenceNumber { number: Some(u16::from_be_bytes([data[0], data[1]])) },
                1..=9 => text_command(*meta_type, data)?,
                47 if data.is_empty() => Command::TrackEnd,
                84 => Command::SmpteOffset { timecode: crate::midi_timecode::Timecode::decode(data)? },
                89 if data.len() == 2 && data[1] <= 1 => Command::KeySignature { fifths: data[0] as i8, mode: if data[1] == 0 { KeyMode::Major } else { KeyMode::Minor } },
                _ => return Err(format!("Metadata type {meta_type} has no supported complete semantic conversion")),
            },
            EventKind::SysEx { .. } | EventKind::Escape { .. } => return Err("Device/system messages require a reviewed semantic conversion; no bytes are hidden in this format".into()),
        };
        if let Command::Text {
            role: TextRole::TrackName,
            text,
        } = &command
        {
            // A display summary only; the complete decoded text remains the cue.
            track.name = text.chars().filter(|c| !c.is_control()).take(200).collect();
        }
        command.validate(event.beat())?;
        events.push(Event {
            at: event.beat(),
            origin,
            command,
        });
    }
    if !held.is_empty() {
        return Err("Missing key releases".into());
    }
    let parts = notation
        .parts
        .iter()
        .map(|part| {
            let (track, channel) = part_channels
                .get(&part.id)
                .ok_or("Canonical part has no complete source route")?;
            Ok(Part {
                id: part.id.clone(),
                track_id: format!("track-{}", track + 1),
                channel: *channel,
                notation_origin: "inferred".into(),
                target: "key_release".into(),
            })
        })
        .collect::<Result<Vec<_>, String>>()?;
    notation.source = None;
    let result = CompleteScore {
        format: FORMAT.into(),
        version: 1,
        source: SourceEvidence {
            format: "midi".into(),
            bytes: bytes.len(),
            sha256: timeline.source_sha256().hex(),
        },
        notation,
        coverage: Coverage {
            status: "complete".into(),
            notation: "inferred".into(),
            source_tracks: tracks.len(),
            source_events: timeline.events().len(),
            represented_events: events.len() + notes.len() * 2,
            pitched_notes: notes.len(),
        },
        performance: Performance {
            profile: PROFILE.into(),
            end: exact_end(timeline.end_tick(), timeline.ppq())?,
            tracks,
            parts,
            notes,
            events,
        },
    };
    validate(&result)?;
    Ok(result)
}

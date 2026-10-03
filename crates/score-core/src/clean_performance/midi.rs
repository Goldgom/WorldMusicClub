use super::*;
use crate::midi_events::{ChannelMessage, DiagnosticCode, EventKind};
fn text_command(kind: u8, data: &[u8]) -> Result<Command, String> {
    let role = match kind {
        1 => TextRole::Text,
        2 => TextRole::Copyright,
        3 => TextRole::TrackName,
        4 => TextRole::InstrumentName,
        5 => TextRole::Lyric,
        6 => TextRole::Marker,
        7 => TextRole::Cue,
        8 => TextRole::ProgramName,
        9 => TextRole::DeviceName,
        _ => return Err("Unsupported text role".into()),
    };
    let text = std::str::from_utf8(data)
        .map_err(|_| {
            "Text requires an explicit encoding decision; no replacement characters were introduced"
        })?
        .to_owned();
    Ok(Command::Text { role, text })
}
/// All source tracks or a hold. Does not invoke the canonical note importer,
/// pair notes, retain source bytes, or choose a renderer/sound set.
pub fn convert_midi(bytes: &[u8], id: &str, title: &str) -> Result<CompletePerformance, String> {
    let timeline = crate::midi_events::parse_midi_events(bytes, None).map_err(|e| e.to_string())?;
    if !timeline.relative_clock_available() {
        return Err("A unique relative clock is unavailable".into());
    }
    for diagnostic in timeline.diagnostics() {
        if matches!(
            diagnostic.code(),
            DiagnosticCode::CrossTrackChannelOrder
                | DiagnosticCode::CrossTrackTempoOrder
                | DiagnosticCode::RoutingUninterpreted
                | DiagnosticCode::SmpteOffsetUninterpreted
        ) {
            return Err(format!(
                "Performance conversion requires resolved semantics: {}",
                diagnostic.message()
            ));
        }
    }
    let hash = timeline.source_sha256().hex();
    let mut tracks: Vec<_> = (0..timeline.track_count())
        .map(|index| Track {
            id: format!("track-{}", index + 1),
            name: format!("Track {}", index + 1),
            source_index: index,
            source_event_count: 0,
            end: Beat::ZERO,
        })
        .collect();
    let mut routes = BTreeSet::new();
    let mut events = Vec::with_capacity(timeline.events().len());
    for event in timeline.events() {
        let origin = Coordinate {
            track: event.id().track_index(),
            event: event.id().event_index(),
        };
        let track = &mut tracks[origin.track as usize];
        track.source_event_count += 1;
        track.end = event.beat();
        let command = match event.kind() {
            EventKind::Channel { channel, message } => {
                routes.insert((origin.track, *channel));
                match message {
                    ChannelMessage::NoteOn { key, velocity } if *velocity > 0 => Command::KeyAttack {
                        part_id: part_id(origin.track, *channel), channel: *channel, key: *key, velocity: *velocity,
                    },
                    ChannelMessage::NoteOn { key, velocity } | ChannelMessage::NoteOff { key, velocity } => Command::KeyRelease {
                        part_id: part_id(origin.track, *channel), channel: *channel, key: *key, velocity: *velocity,
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
                        64 => Command::Sustain { channel: *channel, value: *value },
                        121 if *value == 0 => Command::InitialControllerReset { channel: *channel },
                        91 => Command::ReverbSend { channel: *channel, value: *value },
                        93 => Command::ChorusSend { channel: *channel, value: *value },
                        _ => return Err(format!("Controller {controller} at t{}:e{} has no reviewed semantic conversion", origin.track, origin.event)),
                    },
                    ChannelMessage::PitchBend { .. } => return Err("Pitch bend requires a reviewed tuning profile".into()),
                }
            }
            EventKind::Tempo {
                microseconds_per_quarter,
            } => Command::Tempo {
                microseconds_per_quarter: *microseconds_per_quarter,
            },
            EventKind::TimeSignature {
                numerator,
                denominator_power,
                clocks_per_click,
                thirty_seconds_per_quarter,
            } => {
                if *denominator_power > 15 {
                    return Err("Meter denominator exceeds semantic bounds".into());
                }
                Command::Meter {
                    numerator: *numerator,
                    denominator: 1u16 << denominator_power,
                    clocks_per_click: *clocks_per_click,
                    thirty_seconds_per_quarter: *thirty_seconds_per_quarter,
                }
            }
            EventKind::Meta { meta_type, data } => match meta_type {
                0 if data.is_empty() => Command::SequenceNumber { number: None },
                0 if data.len() == 2 => Command::SequenceNumber {
                    number: Some(u16::from_be_bytes([data[0], data[1]])),
                },
                1..=9 => text_command(*meta_type, data)?,
                47 if data.is_empty() => Command::TrackEnd,
                89 if data.len() == 2 && data[1] <= 1 => Command::KeySignature {
                    fifths: data[0] as i8,
                    mode: if data[1] == 0 {
                        KeyMode::Major
                    } else {
                        KeyMode::Minor
                    },
                },
                _ => {
                    return Err(format!(
                        "Metadata type {meta_type} requires a reviewed semantic profile"
                    ))
                }
            },
            EventKind::SysEx { .. } | EventKind::Escape { .. } => {
                return Err("Device/system messages cannot be hidden in a clean performance".into())
            }
        };
        command.validate()?;
        if let Command::Text {
            role: TextRole::TrackName,
            text,
        } = &command
        {
            track.name = text.chars().filter(|c| !c.is_control()).take(200).collect();
        }
        events.push(Event {
            event_id: event_id(&hash, origin),
            at: event.beat(),
            origin,
            command,
        });
    }
    let parts = routes
        .into_iter()
        .map(|(track, channel)| Part {
            id: part_id(track, channel),
            track_id: format!("track-{}", track + 1),
            channel,
            sound_identity: SoundIdentity::UnspecifiedMidiRoute,
        })
        .collect();
    let performance = Performance {
        profile: PROFILE.into(),
        end: timeline
            .events()
            .last()
            .ok_or("Missing source events")?
            .beat(),
        tracks,
        parts,
        events,
    };
    let result = CompletePerformance {
        format: FORMAT.into(),
        version: 2,
        id: id.into(),
        title: title.into(),
        source: crate::clean_song::SourceEvidence {
            format: "midi".into(),
            bytes: bytes.len(),
            sha256: hash,
        },
        notation: None,
        coverage: calculated_coverage(&performance),
        performance,
    };
    validate(&result)?;
    Ok(result)
}

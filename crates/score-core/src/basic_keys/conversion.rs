use super::*;
use crate::midi_events::{ChannelMessage, EventKind, RawEvent, RawMidiTimeline};

fn coordinate(event: &RawEvent) -> Coordinate {
    Coordinate {
        track: event.id().track_index(),
        event: event.id().event_index(),
    }
}
fn position(event: &RawEvent) -> Position {
    Position {
        tick: event.tick(),
        beat: event.beat(),
        relative_microseconds: event.relative_microseconds().map(|time| ExactMicroseconds {
            numerator: time.numerator().to_string(),
            denominator: time.denominator(),
        }),
    }
}
fn beat(tick: u64, ppq: u16) -> Beat {
    let divisor = crate::gcd(tick.into(), ppq.into()) as u64;
    Beat::new((tick / divisor) as i64, (u64::from(ppq) / divisor) as i64)
}
fn nominal_pitch(key: u8) -> crate::Pitch {
    let steps = ["C", "C", "D", "D", "E", "F", "F", "G", "G", "A", "A", "B"];
    let alters = [0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0];
    crate::Pitch {
        step: steps[usize::from(key % 12)].into(),
        alter: alters[usize::from(key % 12)],
        octave: (key / 12) as i8 - 1,
    }
}
fn pack(event: &RawEvent, timeline: &RawMidiTimeline) -> EventRecord {
    let mut data = Vec::new();
    match event.kind() {
        EventKind::Channel { channel, message } => match message {
            ChannelMessage::NoteOn { key, velocity } => {
                data.extend([0x90 | channel, *key, *velocity])
            }
            ChannelMessage::NoteOff { key, velocity } => {
                data.extend([0x80 | channel, *key, *velocity])
            }
            ChannelMessage::KeyPressure { key, pressure } => {
                data.extend([0xa0 | channel, *key, *pressure])
            }
            ChannelMessage::Controller { controller, value } => {
                data.extend([0xb0 | channel, *controller, *value])
            }
            ChannelMessage::ProgramChange { program } => data.extend([0xc0 | channel, *program]),
            ChannelMessage::ChannelPressure { pressure } => {
                data.extend([0xd0 | channel, *pressure])
            }
            ChannelMessage::PitchBend { value } => {
                data.extend([0xe0 | channel, (value & 0x7f) as u8, (value >> 7) as u8])
            }
        },
        EventKind::Tempo {
            microseconds_per_quarter,
        } => {
            data.extend([0xff, 0x51]);
            data.extend(&microseconds_per_quarter.to_be_bytes()[1..]);
        }
        EventKind::TimeSignature {
            numerator,
            denominator_power,
            clocks_per_click,
            thirty_seconds_per_quarter,
        } => {
            data.extend([
                0xff,
                0x58,
                *numerator,
                *denominator_power,
                *clocks_per_click,
                *thirty_seconds_per_quarter,
            ]);
        }
        EventKind::Meta {
            meta_type,
            data: payload,
        } => {
            data.extend([0xff, *meta_type]);
            data.extend(payload);
        }
        EventKind::SysEx { data: payload } => {
            data.push(0xf0);
            data.extend(payload);
        }
        EventKind::Escape { data: payload } => {
            data.push(0xf7);
            data.extend(payload);
        }
    }
    let original = &timeline.original_bytes()[event.source_range()];
    let delta_length = original
        .iter()
        .position(|byte| byte & 128 == 0)
        .expect("parsed delta")
        + 1;
    let omitted_status = original[delta_length] < 128;
    EventRecord(event.delta_ticks(), data, omitted_status)
}

pub fn convert_midi(bytes: &[u8], title: &str) -> Result<CompleteBasicKeys, ConversionError> {
    let timeline = midi_events::parse_midi_events_compatible(bytes, None)?;
    let source = SourceEvidence {
        format: "midi".into(),
        bytes: bytes.len(),
        sha256: timeline.source_sha256().hex(),
    };
    derive(&timeline, source, title).map_err(Into::into)
}

#[derive(Default)]
struct Component {
    held: usize,
    attacks: Vec<(usize, usize)>,
    releases: Vec<(Coordinate, Position)>,
}
impl Component {
    fn finish(&mut self, notes: &mut [KeyNote], closed: bool) {
        for &(note_index, first_rank) in &self.attacks {
            let candidates = &self.releases[first_rank..];
            let note = &mut notes[note_index];
            let first = candidates.first();
            let last = candidates.last();
            let same_time = closed && first.zip(last).is_some_and(|(a, b)| a.1.tick == b.1.tick);
            if same_time {
                note.end = last.map(|(_, at)| at.clone());
            }
            note.release = ReleaseEvidence {
                status: if !closed {
                    if candidates.is_empty() {
                        ReleaseStatus::MissingRelease
                    } else {
                        ReleaseStatus::PossiblyUnreleased
                    }
                } else if candidates.len() == 1 {
                    ReleaseStatus::UniqueRelease
                } else if same_time {
                    ReleaseStatus::EquivalentReleaseTime
                } else {
                    ReleaseStatus::AmbiguousReleaseTime
                },
                first: first.map(|(origin, _)| *origin),
                last: last.map(|(origin, _)| *origin),
                candidate_count: candidates.len(),
                may_be_unreleased: !closed,
            };
        }
        self.attacks.clear();
        self.releases.clear();
    }
}

pub(super) fn derive(
    timeline: &RawMidiTimeline,
    source: SourceEvidence,
    title: &str,
) -> Result<CompleteBasicKeys, String> {
    if title.trim().is_empty() || title.len() > 1000 || title.chars().any(char::is_control) {
        return Err(
            "Basic-key title must be nonempty, control-free and at most 1000 UTF-8 bytes".into(),
        );
    }
    // The complete VSQ profile is authoritative for project text; never turn a
    // VSQ MIDI carrier with few/no channel notes into an apparently empty song.
    if timeline.events().iter().any(|event| matches!(event.kind(), EventKind::Meta { meta_type: 1, data } if data.starts_with(b"DM:"))) {
        return Err("VSQ project text requires the existing exact VSQ complete-score converter".into());
    }
    let mut tracks: Vec<_> = (0..timeline.track_count())
        .map(|index| Track {
            id: format!("track-{}", index + 1),
            name: format!("Track {}", index + 1),
            source_index: index,
            end_tick: 0,
            events: vec![],
        })
        .collect();
    let mut route_state = vec![
        Route {
            port: None,
            device_name_bytes: None
        };
        tracks.len()
    ];
    let mut route_indexes = BTreeMap::new();
    let mut routes = vec![];
    let mut part_indexes = BTreeMap::new();
    let mut parts = vec![];
    let mut notes = vec![];
    let mut streams: BTreeMap<(usize, u8, u8), Component> = BTreeMap::new();
    let mut unmatched_releases = 0;
    let mut key_releases = 0;
    let mut tempo_events = 0;
    let mut meter_events = 0;
    let mut tempos = BTreeMap::new();
    let mut meters = BTreeMap::<u64, BTreeSet<(u8, u8, u8, u8)>>::new();
    let mut meter_invalid = false;
    for event in timeline.events() {
        let origin = coordinate(event);
        let track_index = origin.track as usize;
        let track = &mut tracks[track_index];
        // The global order preserves each original track's source order.
        track.events.push(pack(event, timeline));
        track.end_tick = event.tick();
        match event.kind() {
            EventKind::Meta { meta_type: 3, data } => {
                if let Ok(name) = std::str::from_utf8(data) {
                    let display: String =
                        name.chars().filter(|c| !c.is_control()).take(200).collect();
                    if !display.trim().is_empty() {
                        track.name = display;
                    }
                }
            }
            EventKind::Meta {
                meta_type: 0x21,
                data,
            } if data.len() == 1 => route_state[track_index].port = Some(data[0]),
            EventKind::Meta { meta_type: 9, data } => {
                route_state[track_index].device_name_bytes = Some(data.clone())
            }
            EventKind::Tempo {
                microseconds_per_quarter,
            } => {
                tempo_events += 1;
                tempos.insert(event.tick(), *microseconds_per_quarter);
            }
            EventKind::TimeSignature {
                numerator,
                denominator_power,
                clocks_per_click,
                thirty_seconds_per_quarter,
            } => {
                meter_events += 1;
                meter_invalid |=
                    *numerator == 0 || *denominator_power > 15 || *thirty_seconds_per_quarter != 8;
                meters.entry(event.tick()).or_default().insert((
                    *numerator,
                    *denominator_power,
                    *clocks_per_click,
                    *thirty_seconds_per_quarter,
                ));
            }
            EventKind::Channel { channel, message } => {
                let route = route_state[track_index].clone();
                let route_index = *route_indexes.entry(route.clone()).or_insert_with(|| {
                    let index = routes.len();
                    routes.push(route);
                    index
                });
                let part_index = *part_indexes
                    .entry((origin.track, *channel, route_index))
                    .or_insert_with(|| {
                        let index = parts.len();
                        parts.push(Part {
                            id: format!(
                                "midi-t{}-c{}-r{}",
                                origin.track + 1,
                                channel + 1,
                                route_index
                            ),
                            track_id: track.id.clone(),
                            channel: *channel,
                            route: route_index,
                            key_semantics: if *channel == 9 {
                                KeySemantics::Channel10KeyNumberPercussionUnresolved
                            } else {
                                KeySemantics::MidiKeyNumber
                            },
                        });
                        index
                    });
                match message {
                    ChannelMessage::NoteOn { key, velocity } if *velocity > 0 => {
                        let component = streams.entry((route_index, *channel, *key)).or_default();
                        component
                            .attacks
                            .push((notes.len(), component.releases.len()));
                        component.held += 1;
                        notes.push(KeyNote {
                            note_id: format!("midi-t{}-e{}", origin.track + 1, origin.event + 1),
                            part_id: parts[part_index].id.clone(),
                            key: *key,
                            velocity: *velocity,
                            attack: origin,
                            start: position(event),
                            end: None,
                            release: ReleaseEvidence {
                                status: ReleaseStatus::MissingRelease,
                                first: None,
                                last: None,
                                candidate_count: 0,
                                may_be_unreleased: true,
                            },
                        });
                    }
                    ChannelMessage::NoteOn { key, .. } | ChannelMessage::NoteOff { key, .. } => {
                        key_releases += 1;
                        let component = streams.entry((route_index, *channel, *key)).or_default();
                        if component.held == 0 {
                            unmatched_releases += 1;
                        } else {
                            component.releases.push((origin, position(event)));
                            component.held -= 1;
                            if component.held == 0 {
                                component.finish(&mut notes, true);
                            }
                        }
                    }
                    _ => {}
                }
            }
            _ => {}
        }
    }
    for component in streams.values_mut() {
        if component.held > 0 {
            component.finish(&mut notes, false);
        }
    }
    // Unspecified destinations must not prove ownership by artificial route
    // separation. A channel/key active on potentially aliasing declarations
    // needs an explicit receiver-route binding. This conservative check is
    // linearithmic in route activity, not quadratic in attacks or route names.
    let mut key_routes: BTreeMap<(u8, u8), BTreeSet<usize>> = BTreeMap::new();
    for &(route, channel, key) in streams.keys() {
        key_routes.entry((channel, key)).or_default().insert(route);
    }
    let mut uncertain = BTreeSet::new();
    for ((channel, key), route_ids) in key_routes {
        let mut ports = BTreeMap::<Option<u8>, usize>::new();
        let mut devices = BTreeMap::<Option<&[u8]>, usize>::new();
        let mut pairs = BTreeSet::new();
        for &id in &route_ids {
            let route = &routes[id];
            *ports.entry(route.port).or_default() += 1;
            *devices
                .entry(route.device_name_bytes.as_deref())
                .or_default() += 1;
            pairs.insert((route.port, route.device_name_bytes.as_deref()));
        }
        for &id in &route_ids {
            let route = &routes[id];
            let p = route.port;
            let d = route.device_name_bytes.as_deref();
            let aliases = match (p, d) {
                (None, None) => route_ids.len() > 1,
                (Some(_), None) => ports.get(&None).copied().unwrap_or(0) > 0 || ports[&p] > 1,
                (None, Some(_)) => devices.get(&None).copied().unwrap_or(0) > 0 || devices[&d] > 1,
                (Some(_), Some(_)) => {
                    pairs.contains(&(None, None))
                        || pairs.contains(&(p, None))
                        || pairs.contains(&(None, d))
                }
            };
            if aliases {
                uncertain.insert((id, channel, key));
            }
        }
    }
    let part_routes: BTreeMap<_, _> = parts
        .iter()
        .map(|part| (part.id.as_str(), (part.route, part.channel)))
        .collect();
    let mut unresolved_route_ends = 0;
    for note in &mut notes {
        let (route, channel) = part_routes[note.part_id.as_str()];
        if uncertain.contains(&(route, channel, note.key)) {
            unresolved_route_ends += 1;
            note.end = None;
            note.release = ReleaseEvidence {
                status: ReleaseStatus::UnresolvedRouteOwnership,
                first: None,
                last: None,
                candidate_count: 0,
                may_be_unreleased: true,
            };
        }
    }
    let meter_ambiguous = meter_invalid || meters.values().any(|entries| entries.len() > 1);
    let mut canonical_parts: Vec<_> = parts
        .iter()
        .map(|part| {
            let track = tracks
                .iter()
                .find(|track| track.id == part.track_id)
                .expect("created part track");
            crate::Part {
                id: part.id.clone(),
                name: format!("{} / ch {}", track.name, part.channel + 1),
                instrument: if part.channel == 9 {
                    "midi-percussion-key-number"
                } else {
                    "midi-key-number"
                }
                .into(),
                notes: vec![],
            }
        })
        .collect();
    let indexes: BTreeMap<_, _> = parts
        .iter()
        .enumerate()
        .map(|(index, part)| (part.id.as_str(), index))
        .collect();
    for note in &notes {
        if let Some(end) = &note.end {
            if end.tick > note.start.tick {
                canonical_parts[indexes[note.part_id.as_str()]]
                    .notes
                    .push(crate::Note {
                        id: note.note_id.clone(),
                        at: note.start.beat,
                        duration: beat(end.tick - note.start.tick, timeline.ppq()),
                        pitch: Some(nominal_pitch(note.key)),
                        voice: "1".into(),
                        staff: 1,
                        velocity: note.velocity,
                        tie_start: false,
                        tie_stop: false,
                    });
            }
        }
    }
    let determined_ends = notes.iter().filter(|note| note.end.is_some()).count();
    let zero_length_attacks = notes
        .iter()
        .filter(|note| {
            note.end
                .as_ref()
                .is_some_and(|end| end.tick == note.start.tick)
        })
        .count();
    let notation_notes = canonical_parts.iter().map(|part| part.notes.len()).sum();
    let projected_melodic_targets = canonical_parts
        .iter()
        .zip(&parts)
        .filter(|(_, part)| part.channel != 9)
        .map(|(part, _)| part.notes.len())
        .sum();
    let coverage = Coverage {
        source_tracks: tracks.len(),
        source_events: timeline.events().len(),
        represented_events: timeline.events().len(),
        key_attacks: notes.len(),
        key_releases,
        determined_ends,
        zero_length_attacks,
        unresolved_ends: notes.len() - determined_ends,
        unmatched_releases,
        notation_notes,
        projected_melodic_targets,
        unresolved_route_ends,
    };
    let timing = Timing {
        event_order: "tick_track_index_event_index".into(),
        relative_clock_available: timeline.relative_clock_available(),
        end_relative_microseconds: timeline
            .events()
            .last()
            .and_then(|event| position(event).relative_microseconds),
        smf_default_tempo_used: timeline
            .diagnostics()
            .iter()
            .any(|d| d.code() == midi_events::DiagnosticCode::DefaultTempo),
        source_tempo_events: tempo_events,
        source_meter_events: meter_events,
        meter: if meter_events == 0 {
            "unspecified"
        } else if meter_ambiguous {
            "ambiguous_or_unconventional"
        } else {
            "source_declared"
        }
        .into(),
        legacy_running_status_events: timeline
            .diagnostics()
            .iter()
            .filter(|d| d.code() == midi_events::DiagnosticCode::LegacyRunningStatusAcrossMeta)
            .map(|d| d.occurrences())
            .sum(),
        invalid_program_events: timeline
            .diagnostics()
            .iter()
            .filter(|d| d.code() == midi_events::DiagnosticCode::InvalidProgramData)
            .map(|d| d.occurrences())
            .sum(),
    };
    let notation = Score {
        format_metadata: Some(crate::FormatMetadata::current()),
        version: 1,
        id: format!("midi-basic-{}", source.sha256),
        title: title.into(),
        composer: String::new(),
        provenance: crate::Provenance {
            kind: "user_supplied_unverified".into(),
            attribution:
                "User-supplied MIDI; source rights unverified; nominal MIDI key-number projection"
                    .into(),
            source_url: None,
            license: None,
        },
        parts: canonical_parts,
        tempo: if timeline.relative_clock_available() {
            tempos
                .into_iter()
                .filter(|(_, us)| *us > 0)
                .map(|(tick, us)| crate::Tempo {
                    at: beat(tick, timeline.ppq()),
                    bpm: 60_000_000.0 / f64::from(us),
                })
                .collect()
        } else {
            vec![]
        },
        meters: if meter_ambiguous {
            vec![]
        } else {
            meters
                .into_iter()
                .map(|(tick, values)| {
                    let value = values.into_iter().next().expect("meter event");
                    crate::Meter {
                        at: beat(tick, timeline.ppq()),
                        numerator: u16::from(value.0),
                        denominator: 1u16 << value.1,
                    }
                })
                .collect()
        },
        keys: vec![],
        measures: vec![],
        repeats: vec![],
        source: None,
    };
    Ok(CompleteBasicKeys {
        format: FORMAT.into(),
        version: 1,
        source,
        notation,
        capabilities: Capabilities {
            source_events: "complete".into(),
            basic_keys: if coverage.unresolved_ends == 0 {
                "complete"
            } else {
                "unresolved_ends"
            }
            .into(),
            score_projection: if coverage.notation_notes == coverage.key_attacks {
                "complete_positive_duration_keys"
            } else {
                "partial_positive_duration_keys"
            }
            .into(),
            source_rendition: "requires_explicit_receiver_mapping".into(),
            acoustic_pitch: "not_inferred_from_key_numbers".into(),
        },
        performance: Performance {
            profile: PROFILE.into(),
            source_format: timeline.format(),
            ppq: timeline.ppq(),
            end_tick: timeline.end_tick(),
            tracks,
            routes,
            parts,
            notes,
            timing,
        },
        coverage,
    })
}

fn vlq(mut value: u32, bytes: &mut Vec<u8>) {
    let mut buffer = [0u8; 4];
    let mut index = 3;
    buffer[index] = (value & 127) as u8;
    value >>= 7;
    while value > 0 {
        index -= 1;
        buffer[index] = (value as u8 & 127) | 128;
        value >>= 7;
    }
    bytes.extend(&buffer[index..]);
}
/// A semantic normalization solely for validating/re-deriving the profile.
/// This generated SMF is never delivered as a source or stored in the package.
pub(super) fn timeline_from_records(performance: &Performance) -> Result<RawMidiTimeline, String> {
    if performance.tracks.len() > midi_events::MAX_TRACKS
        || performance.tracks.is_empty()
        || performance.source_format > 1
        || performance.ppq == 0
        || performance.ppq > 32767
    {
        return Err("Invalid basic-key source tracks, format or PPQ".into());
    }
    let mut bytes = b"MThd\0\0\0\x06".to_vec();
    bytes.extend(performance.source_format.to_be_bytes());
    bytes.extend((performance.tracks.len() as u16).to_be_bytes());
    bytes.extend(performance.ppq.to_be_bytes());
    let mut events = 0;
    for (index, track) in performance.tracks.iter().enumerate() {
        if usize::from(track.source_index) != index {
            return Err("Source track indexes must be complete and ordered".into());
        }
        let mut body = vec![];
        for EventRecord(delta, message, omitted_status) in &track.events {
            events += 1;
            if events > midi_events::MAX_EVENTS || *delta > 0x0fff_ffff {
                return Err("Source event count or delta exceeds supported bounds".into());
            }
            vlq(*delta, &mut body);
            match message.as_slice() {
                [status @ 0x80..=0xef, data @ ..] => {
                    let expected = if status & 0xf0 == 0xc0 || status & 0xf0 == 0xd0 {
                        1
                    } else {
                        2
                    };
                    if data.len() != expected
                        || (status & 0xf0 != 0xc0 && data.iter().any(|byte| *byte > 127))
                    {
                        return Err("Invalid compact channel message".into());
                    }
                    if *omitted_status {
                        body.extend(data);
                    } else {
                        body.extend(message);
                    }
                }
                [0xff, kind, data @ ..] => {
                    if *omitted_status {
                        return Err("Metadata cannot omit status".into());
                    }
                    if data.len() > 0x0fff_ffff {
                        return Err("Metadata exceeds MIDI length range".into());
                    }
                    body.extend([0xff, *kind]);
                    vlq(data.len() as u32, &mut body);
                    body.extend(data);
                }
                [status @ (0xf0 | 0xf7), data @ ..] => {
                    if *omitted_status {
                        return Err("System message cannot omit status".into());
                    }
                    if data.len() > 0x0fff_ffff {
                        return Err("System message exceeds MIDI length range".into());
                    }
                    body.push(*status);
                    vlq(data.len() as u32, &mut body);
                    body.extend(data);
                }
                _ => return Err("Invalid compact source event status".into()),
            }
        }
        bytes.extend(b"MTrk");
        bytes.extend((body.len() as u32).to_be_bytes());
        bytes.extend(body);
        if bytes.len() > MAX_JSON_BYTES {
            return Err("Normalized source events exceed the 16 MiB validation bound".into());
        }
    }
    midi_events::parse_normalized_midi_events(&bytes).map_err(|e| e.to_string())
}

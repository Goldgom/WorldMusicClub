//! Explicit compatibility dialects for complete basic-key preservation. No
//! heuristic byte skipping, value masking or note-message repair is performed.
use super::*;

pub fn parse_midi_events_compatible(
    bytes: &[u8],
    expected_sha256: Option<&[u8; 32]>,
) -> Result<RawMidiTimeline, MidiEventError> {
    parse(bytes, expected_sha256, LIMITS)
}
pub(crate) fn parse_normalized_midi_events(
    bytes: &[u8],
) -> Result<RawMidiTimeline, MidiEventError> {
    // Explicit status and minimal VLQs can be larger than the original running
    // status encoding. This bound belongs to generated validation records only.
    parse(
        bytes,
        None,
        Limits {
            bytes: 16 * 1024 * 1024,
            ..LIMITS
        },
    )
}
fn read_vlq(bytes: &[u8], cursor: &mut usize) -> Result<u32, MidiEventError> {
    let mut value = 0u32;
    for _ in 0..4 {
        let byte = *bytes
            .get(*cursor)
            .ok_or_else(|| error(ErrorCode::InvalidEvent, "Truncated event VLQ"))?;
        *cursor += 1;
        value = (value << 7) | u32::from(byte & 127);
        if byte & 128 == 0 {
            return Ok(value);
        }
    }
    Err(error(
        ErrorCode::InvalidEvent,
        "Event VLQ exceeds four bytes",
    ))
}
fn payload<'a>(
    bytes: &'a [u8],
    cursor: &mut usize,
    len: usize,
) -> Result<&'a [u8], MidiEventError> {
    let end = cursor
        .checked_add(len)
        .filter(|end| *end <= bytes.len())
        .ok_or_else(|| error(ErrorCode::InvalidEvent, "Truncated event payload"))?;
    let data = &bytes[*cursor..end];
    *cursor = end;
    Ok(data)
}
fn parse(
    bytes: &[u8],
    expected: Option<&[u8; 32]>,
    limits: Limits,
) -> Result<RawMidiTimeline, MidiEventError> {
    if bytes.len() > limits.bytes {
        return Err(error(
            ErrorCode::SourceLimit,
            "MIDI exceeds the bounded source-byte limit",
        ));
    }
    let source_sha256 = SourceDigest(Sha256::digest(bytes).into());
    if expected.is_some_and(|value| value != source_sha256.bytes()) {
        return Err(error(
            ErrorCode::SourceDigestMismatch,
            "Original MIDI bytes do not match expected SHA-256",
        ));
    }
    let (format, ppq, tracks) = container(bytes, limits)?;
    let mut events = Vec::new();
    let mut diagnostics = Diagnostics::new();
    diagnostic(&mut diagnostics, DiagnosticCode::RawEventsOnly, None);
    let mut end_tick = 0;
    for (track_index, range) in tracks.iter().enumerate() {
        let track = &bytes[range.clone()];
        let mut cursor = 0;
        let mut tick = 0u64;
        let mut event_index = 0u32;
        let mut running = None;
        let mut legacy = None;
        let mut ended = false;
        while cursor < track.len() {
            if ended {
                return Err(error(
                    ErrorCode::EventsAfterEndOfTrack,
                    format!("Track {track_index} has events after EndOfTrack"),
                ));
            }
            if events.len() >= limits.events {
                return Err(error(
                    ErrorCode::EventLimit,
                    "MIDI exceeds bounded event-count limit",
                ));
            }
            let start = cursor;
            let delta = read_vlq(track, &mut cursor)?;
            tick = tick
                .checked_add(u64::from(delta))
                .filter(|tick| *tick <= limits.tick)
                .ok_or_else(|| {
                    error(
                        ErrorCode::TickLimit,
                        "MIDI exceeds bounded absolute-tick limit",
                    )
                })?;
            let id = EventId {
                source_sha256,
                track_index: track_index as u16,
                event_index,
            };
            let next = *track
                .get(cursor)
                .ok_or_else(|| error(ErrorCode::InvalidEvent, "Missing event status"))?;
            let status = if next >= 128 {
                cursor += 1;
                next
            } else if let Some(status) = running {
                status
            } else if let Some(status) = legacy {
                diagnostic(
                    &mut diagnostics,
                    DiagnosticCode::LegacyRunningStatusAcrossMeta,
                    Some(id),
                );
                status
            } else {
                return Err(error(ErrorCode::InvalidEvent,format!("Data event without a preceding channel status at track {track_index} event {event_index}")));
            };
            let kind = match status {
                0x80..=0xef => {
                    let arity = if matches!(status & 0xf0, 0xc0 | 0xd0) {
                        1
                    } else {
                        2
                    };
                    let data = payload(track, &mut cursor, arity)?;
                    running = Some(status);
                    legacy = Some(status);
                    if status & 0xf0 == 0xc0 && data[0] >= 128 {
                        diagnostic(
                            &mut diagnostics,
                            DiagnosticCode::InvalidProgramData,
                            Some(id),
                        );
                        EventKind::Channel {
                            channel: status & 15,
                            message: ChannelMessage::ProgramChange { program: data[0] },
                        }
                    } else {
                        if data.iter().any(|b| *b >= 128) {
                            return Err(error(ErrorCode::InvalidEvent,format!("High-bit channel data at track {track_index} event {event_index}; no value or framing guessed")));
                        }
                        let mut canonical = vec![0, status];
                        canonical.extend(data);
                        let event = midly::EventIter::new(&canonical)
                            .next()
                            .expect("constructed event")
                            .map_err(|e| error(ErrorCode::InvalidEvent, e.to_string()))?;
                        decode(event.kind, &canonical[1..], id, &mut diagnostics)?
                    }
                }
                0xff => {
                    let raw_start = cursor - 1;
                    let _meta_type = payload(track, &mut cursor, 1)?[0];
                    let length = read_vlq(track, &mut cursor)?;
                    payload(track, &mut cursor, length as usize)?;
                    running = None;
                    // decode reads original framed metadata bytes, not the
                    // placeholder enum (so unknown and invalid text survives).
                    decode(
                        TrackEventKind::Meta(midly::MetaMessage::EndOfTrack),
                        &track[raw_start..cursor],
                        id,
                        &mut diagnostics,
                    )?
                }
                0xf0 | 0xf7 => {
                    let length = read_vlq(track, &mut cursor)?;
                    let data = payload(track, &mut cursor, length as usize)?;
                    running = None;
                    legacy = None;
                    if status == 0xf0 {
                        decode(TrackEventKind::SysEx(data), &[], id, &mut diagnostics)?
                    } else {
                        decode(TrackEventKind::Escape(data), &[], id, &mut diagnostics)?
                    }
                }
                _ => {
                    return Err(error(
                        ErrorCode::InvalidEvent,
                        format!(
                        "Unsupported SMF event status {status:02x}; no resynchronization attempted"
                    ),
                    ))
                }
            };
            ended = matches!(
                kind,
                EventKind::Meta {
                    meta_type: 0x2f,
                    ..
                }
            );
            let divisor = crate::gcd(tick.into(), ppq.into()) as u64;
            events.push(RawEvent {
                id,
                tick,
                delta_ticks: delta,
                beat: Beat::new((tick / divisor) as i64, (u64::from(ppq) / divisor) as i64),
                relative_microseconds: None,
                source_range: (range.start + start)..(range.start + cursor),
                kind,
            });
            end_tick = end_tick.max(tick);
            event_index += 1;
        }
        if !ended {
            return Err(error(
                ErrorCode::MissingEndOfTrack,
                format!("Track {track_index} is missing EndOfTrack"),
            ));
        }
    }
    events.sort_by_key(|event| (event.tick, event.id.track_index, event.id.event_index));
    let relative_clock_available = annotate_clock(&mut events, ppq, &mut diagnostics);
    Ok(RawMidiTimeline {
        original_bytes: bytes.into(),
        source_sha256,
        format,
        track_count: tracks.len() as u16,
        ppq,
        end_tick,
        relative_clock_available,
        events,
        diagnostics: diagnostics.into_values().collect(),
    })
}

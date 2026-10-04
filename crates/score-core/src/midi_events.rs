//! Lossless, bounded SMF event inspection, separate from MIDI-to-Score import.
//!
//! Original bytes are the immutable authority. Records are derived, read-only
//! output, never a deserializable playback or grading plan. No note pairing,
//! sound mapping, quantization, notation, or acoustic duration is inferred.
use crate::Beat;
use midly::{MidiMessage, TrackEventKind};
use serde::{Serialize, Serializer};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::ops::Range;
mod compatible;
pub use compatible::parse_midi_events_compatible;
pub(crate) use compatible::parse_normalized_midi_events;

pub const MAX_SOURCE_BYTES: usize = 5 * 1024 * 1024;
pub const MAX_TRACKS: usize = 128;
pub const MAX_EVENTS: usize = 250_000;
pub const MAX_TICK: u64 = 1_000_000_000;
const DEFAULT_TEMPO: u32 = 500_000;

/// Computed from every byte of the original SMF, including metadata/encoding.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct SourceDigest([u8; 32]);
impl SourceDigest {
    pub fn bytes(&self) -> &[u8; 32] {
        &self.0
    }
    pub fn hex(&self) -> String {
        self.0.iter().map(|b| format!("{b:02x}")).collect()
    }
}
impl Serialize for SourceDigest {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.hex())
    }
}

/// Zero-based source coordinates, independent of pitch, channel, or sorting.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
pub struct EventId {
    source_sha256: SourceDigest,
    track_index: u16,
    event_index: u32,
}
impl EventId {
    pub fn source_sha256(&self) -> SourceDigest {
        self.source_sha256
    }
    pub fn track_index(&self) -> u16 {
        self.track_index
    }
    pub fn event_index(&self) -> u32 {
        self.event_index
    }
    pub fn stable_id(&self) -> String {
        format!(
            "midi:{}:t{}:e{}",
            self.source_sha256.hex(),
            self.track_index,
            self.event_index
        )
    }
}

/// Exact rational microseconds from tick zero. JSON numerator is a decimal
/// string, so large values cannot be rounded by a JavaScript JSON consumer.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
pub struct ExactMicroseconds {
    #[serde(serialize_with = "decimal_u64")]
    numerator: u64,
    denominator: u16,
}
fn decimal_u64<S: Serializer>(value: &u64, serializer: S) -> Result<S::Ok, S::Error> {
    serializer.serialize_str(&value.to_string())
}
impl ExactMicroseconds {
    fn new(microsecond_ticks: u64, ppq: u16) -> Self {
        let divisor = crate::gcd(microsecond_ticks.into(), ppq.into()) as u64;
        Self {
            numerator: microsecond_ticks / divisor,
            denominator: (u64::from(ppq) / divisor) as u16,
        }
    }
    pub fn numerator(&self) -> u64 {
        self.numerator
    }
    pub fn denominator(&self) -> u16 {
        self.denominator
    }
}

/// MIDI values are zero-based. NoteOn velocity zero stays a NoteOn record;
/// consumers may recognize release semantics but must not invent a pairing.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ChannelMessage {
    NoteOn {
        key: u8,
        velocity: u8,
    },
    NoteOff {
        key: u8,
        velocity: u8,
    },
    KeyPressure {
        key: u8,
        pressure: u8,
    },
    Controller {
        controller: u8,
        value: u8,
    },
    ProgramChange {
        program: u8,
    },
    ChannelPressure {
        pressure: u8,
    },
    /// Original unsigned 14-bit value, with center 8192.
    PitchBend {
        value: u16,
    },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum EventKind {
    Channel {
        channel: u8,
        message: ChannelMessage,
    },
    Tempo {
        microseconds_per_quarter: u32,
    },
    TimeSignature {
        numerator: u8,
        denominator_power: u8,
        clocks_per_click: u8,
        thirty_seconds_per_quarter: u8,
    },
    /// Includes track names, EOT, key/port/channel metadata, and unknown types.
    /// Text bytes are never decoded, sanitized, or treated as a license grant.
    Meta {
        meta_type: u8,
        data: Vec<u8>,
    },
    /// Data excludes the F0 status and SMF length, and retains a trailing F7.
    SysEx {
        data: Vec<u8>,
    },
    /// An F7 escape or continuation packet; not merged with neighboring events.
    Escape {
        data: Vec<u8>,
    },
}

#[derive(Clone, Debug, Serialize)]
pub struct RawEvent {
    id: EventId,
    tick: u64,
    delta_ticks: u32,
    beat: Beat,
    relative_microseconds: Option<ExactMicroseconds>,
    /// The complete original encoding, including delta VLQ and running status.
    source_range: Range<usize>,
    kind: EventKind,
}
impl RawEvent {
    pub fn id(&self) -> EventId {
        self.id
    }
    pub fn tick(&self) -> u64 {
        self.tick
    }
    pub fn delta_ticks(&self) -> u32 {
        self.delta_ticks
    }
    pub fn beat(&self) -> Beat {
        self.beat
    }
    pub fn relative_microseconds(&self) -> Option<ExactMicroseconds> {
        self.relative_microseconds
    }
    pub fn source_range(&self) -> Range<usize> {
        self.source_range.clone()
    }
    pub fn kind(&self) -> &EventKind {
        &self.kind
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum DiagnosticCode {
    LegacyRunningStatusAcrossMeta,
    InvalidProgramData,
    RawEventsOnly,
    DefaultTempo,
    CrossTrackChannelOrder,
    CrossTrackTempoOrder,
    ZeroTempo,
    PercussionMappingUnresolved,
    ProgramMappingUnresolved,
    ControllerSemanticsUninterpreted,
    PressureOrBendUninterpreted,
    SysExUninterpreted,
    EscapeUninterpreted,
    MetadataUninterpreted,
    RoutingUninterpreted,
    SmpteOffsetUninterpreted,
    UnconventionalMeter,
}
impl DiagnosticCode {
    pub fn message(self) -> &'static str {
        match self {
            Self::LegacyRunningStatusAcrossMeta => "A data-only channel event reuses the preceding channel status across metadata. This explicitly recorded legacy dialect changes no event, key, value or tick; strict SMF import remains unchanged.",
            Self::InvalidProgramData => "A program-change data slot contains a high-bit byte. Fixed-arity framing and the complete remaining track were decoded without resynchronization; the exact invalid byte is retained and is not a valid program or inferred sound.",
            Self::RawEventsOnly => "All events and original bytes are retained. This is not playable notation, a synthesizer schedule, or a gradeable target set; no notes are paired and no instrument sounds are inferred.",
            Self::DefaultTempo => "The relative PPQ clock uses the SMF default 500000 microseconds per quarter until the first tempo event. No tempo event was inserted into the source records.",
            Self::CrossTrackChannelOrder => "Same-channel events at the same tick occur in different tracks. Tick/track/event sorting is deterministic source order, not a claim about original hardware dispatch order; routing metadata remains uninterpreted.",
            Self::CrossTrackTempoOrder => "Different tempo values at the same tick occur in different tracks. All events remain present; a single relative clock is unavailable because the source does not specify cross-track order.",
            Self::ZeroTempo => "A zero tempo is retained unchanged. A valid single relative clock cannot be derived.",
            Self::PercussionMappingUnresolved => "Channel 10 events and keys are retained unchanged. No percussion kit, pitched instrument, or General MIDI interpretation is assumed.",
            Self::ProgramMappingUnresolved => "Program numbers are retained as zero-based MIDI values. Bank, sound set, and program-to-instrument mapping are not resolved.",
            Self::ControllerSemanticsUninterpreted => "Controller events are retained unchanged. Pedal, channel mode, bank, tuning, expression, and release effects are not interpreted.",
            Self::PressureOrBendUninterpreted => "Pressure and pitch-bend events are retained unchanged; their effect on sound or note targets is not interpreted.",
            Self::SysExUninterpreted => "SysEx bytes are retained unchanged; device state, tuning, routing, and sound effects are not interpreted.",
            Self::EscapeUninterpreted => "Escape/continuation packets are retained independently; packet assembly and hardware effects are not interpreted.",
            Self::MetadataUninterpreted => "Other metadata is retained byte-for-byte, including text and unknown/sequencer-specific metadata; its semantics are not inferred.",
            Self::RoutingUninterpreted => "Port/channel-prefix metadata is retained. Tracks are not assumed to be independent MIDI ports or instruments.",
            Self::SmpteOffsetUninterpreted => "SMPTE offset metadata is retained. The optional PPQ clock is relative to tick zero and does not apply absolute offsets.",
            Self::UnconventionalMeter => "Time-signature bytes are retained exactly; zero or unusually encoded meter values are not converted to notation or inferred bar lines.",
        }
    }
}

#[derive(Clone, Debug, Serialize)]
pub struct EventDiagnostic {
    code: DiagnosticCode,
    message: &'static str,
    occurrences: usize,
    first_event: Option<EventId>,
}
impl EventDiagnostic {
    pub fn code(&self) -> DiagnosticCode {
        self.code
    }
    pub fn occurrences(&self) -> usize {
        self.occurrences
    }
    pub fn first_event(&self) -> Option<EventId> {
        self.first_event
    }
    pub fn message(&self) -> &'static str {
        self.message
    }
}

/// Format 0 or 1 with nonzero PPQ. Format 2 and SMPTE divisions are rejected
/// explicitly; they are not silently converted to a single PPQ timeline.
///
/// Serialized records cannot be reintroduced as trusted source events:
/// ```compile_fail
/// let _: score_core::midi_events::RawMidiTimeline =
///     serde_json::from_str("{}").unwrap();
/// ```
#[derive(Debug, Serialize)]
pub struct RawMidiTimeline {
    #[serde(skip)]
    original_bytes: Box<[u8]>,
    source_sha256: SourceDigest,
    format: u16,
    track_count: u16,
    ppq: u16,
    end_tick: u64,
    relative_clock_available: bool,
    events: Vec<RawEvent>,
    diagnostics: Vec<EventDiagnostic>,
}
impl RawMidiTimeline {
    pub fn original_bytes(&self) -> &[u8] {
        &self.original_bytes
    }
    pub fn source_sha256(&self) -> SourceDigest {
        self.source_sha256
    }
    pub fn format(&self) -> u16 {
        self.format
    }
    pub fn track_count(&self) -> u16 {
        self.track_count
    }
    pub fn ppq(&self) -> u16 {
        self.ppq
    }
    pub fn end_tick(&self) -> u64 {
        self.end_tick
    }
    pub fn relative_clock_available(&self) -> bool {
        self.relative_clock_available
    }
    pub fn events(&self) -> &[RawEvent] {
        &self.events
    }
    pub fn diagnostics(&self) -> &[EventDiagnostic] {
        &self.diagnostics
    }
    /// Resolve source coordinates only when the content hash belongs here.
    pub fn event(&self, id: EventId) -> Option<&RawEvent> {
        (id.source_sha256 == self.source_sha256)
            .then(|| self.events.iter().find(|event| event.id == id))
            .flatten()
    }
    pub fn encoded_event(&self, id: EventId) -> Option<&[u8]> {
        self.event(id)
            .map(|event| &self.original_bytes[event.source_range.clone()])
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ErrorCode {
    SourceLimit,
    TrackLimit,
    EventLimit,
    TickLimit,
    InvalidContainer,
    UnsupportedFormat,
    UnsupportedSmpte,
    InvalidPpq,
    InvalidEvent,
    MissingEndOfTrack,
    EventsAfterEndOfTrack,
    SourceDigestMismatch,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct MidiEventError {
    pub code: ErrorCode,
    pub message: String,
}
impl std::fmt::Display for MidiEventError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.message)
    }
}
impl std::error::Error for MidiEventError {}
fn error(code: ErrorCode, message: impl Into<String>) -> MidiEventError {
    MidiEventError {
        code,
        message: message.into(),
    }
}

#[derive(Clone, Copy)]
struct Limits {
    bytes: usize,
    tracks: usize,
    events: usize,
    tick: u64,
}
const LIMITS: Limits = Limits {
    bytes: MAX_SOURCE_BYTES,
    tracks: MAX_TRACKS,
    events: MAX_EVENTS,
    tick: MAX_TICK,
};
type Diagnostics = BTreeMap<DiagnosticCode, EventDiagnostic>;
fn diagnostic(diagnostics: &mut Diagnostics, code: DiagnosticCode, event: Option<EventId>) {
    let value = diagnostics.entry(code).or_insert(EventDiagnostic {
        code,
        message: code.message(),
        occurrences: 0,
        first_event: event,
    });
    value.occurrences += 1;
}

/// Derive read-only records from original bytes, computing SHA-256 locally.
/// An optional previously recorded digest is checked before parsing. Persist
/// original_bytes(), then reparse on reload; serialized records are not input.
pub fn parse_midi_events(
    bytes: &[u8],
    expected_sha256: Option<&[u8; 32]>,
) -> Result<RawMidiTimeline, MidiEventError> {
    parse_with_limits(bytes, expected_sha256, LIMITS)
}

fn parse_with_limits(
    bytes: &[u8],
    expected_sha256: Option<&[u8; 32]>,
    limits: Limits,
) -> Result<RawMidiTimeline, MidiEventError> {
    if bytes.len() > limits.bytes {
        return Err(error(
            ErrorCode::SourceLimit,
            "MIDI exceeds the bounded source-byte limit",
        ));
    }
    let source_sha256 = SourceDigest(Sha256::digest(bytes).into());
    if expected_sha256.is_some_and(|expected| expected != source_sha256.bytes()) {
        return Err(error(
            ErrorCode::SourceDigestMismatch,
            "Original MIDI bytes do not match the expected SHA-256 digest",
        ));
    }
    let (format, ppq, tracks) = container(bytes, limits)?;
    let mut events = Vec::new();
    let mut diagnostics = Diagnostics::new();
    diagnostic(&mut diagnostics, DiagnosticCode::RawEventsOnly, None);
    let mut end_tick = 0;
    for (track_index, track) in tracks.iter().enumerate() {
        let mut reader = midly::EventIter::new(&bytes[track.clone()]).bytemapped();
        let mut tick = 0_u64;
        let mut ended = false;
        let mut event_index = 0;
        while !reader.unread().is_empty() {
            if ended {
                return Err(error(
                    ErrorCode::EventsAfterEndOfTrack,
                    format!("Track {track_index} has events after EndOfTrack"),
                ));
            }
            if events.len() == limits.events {
                return Err(error(
                    ErrorCode::EventLimit,
                    "MIDI exceeds the bounded event-count limit",
                ));
            }
            let start = track.end - reader.unread().len();
            let (raw, event) = reader.next().expect("unread event bytes").map_err(|e| {
                error(
                    ErrorCode::InvalidEvent,
                    format!("Invalid MIDI track {track_index} event {event_index}: {e}"),
                )
            })?;
            let end = track.end - reader.unread().len();
            tick = tick
                .checked_add(u64::from(event.delta.as_int()))
                .filter(|tick| *tick <= limits.tick)
                .ok_or_else(|| {
                    error(
                        ErrorCode::TickLimit,
                        "MIDI exceeds the bounded absolute-tick limit",
                    )
                })?;
            let id = EventId {
                source_sha256,
                track_index: track_index as u16,
                event_index,
            };
            let kind = decode(event.kind, raw, id, &mut diagnostics)?;
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
                delta_ticks: event.delta.as_int(),
                beat: Beat::new((tick / divisor) as i64, (u64::from(ppq) / divisor) as i64),
                relative_microseconds: None,
                source_range: start..end,
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

fn container(
    bytes: &[u8],
    limits: Limits,
) -> Result<(u16, u16, Vec<Range<usize>>), MidiEventError> {
    let invalid = |message| error(ErrorCode::InvalidContainer, message);
    if bytes.len() < 14 || &bytes[..4] != b"MThd" || bytes[4..8] != [0, 0, 0, 6] {
        return Err(invalid("Expected plain SMF with a six-byte MThd header; wrapped/extended containers are unsupported"));
    }
    let format = u16::from_be_bytes([bytes[8], bytes[9]]);
    if format > 1 {
        return Err(error(ErrorCode::UnsupportedFormat, "Only SMF formats 0 and 1 have a supported single timeline; format 2 independent sequences are unsupported"));
    }
    if bytes[12] & 0x80 != 0 {
        // Do not pass 0x80 SMPTE fields to midly's signed-negation header path.
        return Err(error(
            ErrorCode::UnsupportedSmpte,
            "SMPTE divisions are unsupported; no PPQ or relative tempo clock was inferred",
        ));
    }
    let ppq = u16::from_be_bytes([bytes[12], bytes[13]]);
    if ppq == 0 {
        return Err(error(ErrorCode::InvalidPpq, "MIDI PPQ must be nonzero"));
    }
    let count = u16::from_be_bytes([bytes[10], bytes[11]]) as usize;
    if count == 0 || count > limits.tracks || (format == 0 && count != 1) {
        return Err(error(
            ErrorCode::TrackLimit,
            "MIDI track count exceeds supported bounds; format 0 requires exactly one track",
        ));
    }
    let mut offset = 14_usize;
    let mut tracks = Vec::with_capacity(count);
    for _ in 0..count {
        let header = bytes
            .get(offset..offset + 8)
            .ok_or_else(|| invalid("Truncated MIDI track header"))?;
        if &header[..4] != b"MTrk" {
            return Err(invalid("Unknown MIDI chunk; expected MTrk"));
        }
        let length = u32::from_be_bytes(header[4..8].try_into().expect("four bytes")) as usize;
        let start = offset + 8;
        offset = start
            .checked_add(length)
            .filter(|end| *end <= bytes.len())
            .ok_or_else(|| invalid("Truncated or overflowing MIDI track payload"))?;
        tracks.push(start..offset);
    }
    if offset != bytes.len() {
        return Err(invalid(
            "Trailing bytes or track count mismatch in MIDI container",
        ));
    }
    Ok((format, ppq, tracks))
}

fn decode(
    kind: TrackEventKind<'_>,
    raw: &[u8],
    id: EventId,
    diagnostics: &mut Diagnostics,
) -> Result<EventKind, MidiEventError> {
    let mut warn = |code| diagnostic(diagnostics, code, Some(id));
    Ok(match kind {
        TrackEventKind::Midi { channel, message } => {
            let channel = channel.as_int();
            if channel == 9 {
                warn(DiagnosticCode::PercussionMappingUnresolved);
            }
            let message = match message {
                MidiMessage::NoteOn { key, vel } => ChannelMessage::NoteOn {
                    key: key.as_int(),
                    velocity: vel.as_int(),
                },
                MidiMessage::NoteOff { key, vel } => ChannelMessage::NoteOff {
                    key: key.as_int(),
                    velocity: vel.as_int(),
                },
                MidiMessage::Aftertouch { key, vel } => {
                    warn(DiagnosticCode::PressureOrBendUninterpreted);
                    ChannelMessage::KeyPressure {
                        key: key.as_int(),
                        pressure: vel.as_int(),
                    }
                }
                MidiMessage::ChannelAftertouch { vel } => {
                    warn(DiagnosticCode::PressureOrBendUninterpreted);
                    ChannelMessage::ChannelPressure {
                        pressure: vel.as_int(),
                    }
                }
                MidiMessage::PitchBend { bend } => {
                    warn(DiagnosticCode::PressureOrBendUninterpreted);
                    ChannelMessage::PitchBend {
                        value: bend.0.as_int(),
                    }
                }
                MidiMessage::Controller { controller, value } => {
                    warn(DiagnosticCode::ControllerSemanticsUninterpreted);
                    ChannelMessage::Controller {
                        controller: controller.as_int(),
                        value: value.as_int(),
                    }
                }
                MidiMessage::ProgramChange { program } => {
                    warn(DiagnosticCode::ProgramMappingUnresolved);
                    ChannelMessage::ProgramChange {
                        program: program.as_int(),
                    }
                }
            };
            EventKind::Channel { channel, message }
        }
        TrackEventKind::SysEx(data) => {
            warn(DiagnosticCode::SysExUninterpreted);
            EventKind::SysEx { data: data.into() }
        }
        TrackEventKind::Escape(data) => {
            warn(DiagnosticCode::EscapeUninterpreted);
            EventKind::Escape { data: data.into() }
        }
        TrackEventKind::Meta(_) => {
            // Read metadata from original bytes, never midly's normalized value.
            // In particular key-mode, channel-prefix, and surplus fields must
            // not be silently coerced or lost in the derived event record.
            let meta_type = raw[1];
            let mut offset = 2;
            let mut length = 0_usize;
            loop {
                let byte = *raw
                    .get(offset)
                    .ok_or_else(|| error(ErrorCode::InvalidEvent, "Truncated meta length"))?;
                offset += 1;
                if offset > 6 {
                    return Err(error(
                        ErrorCode::InvalidEvent,
                        "Meta length exceeds four-byte VLQ",
                    ));
                }
                length = (length << 7) | usize::from(byte & 0x7f);
                if byte & 0x80 == 0 {
                    break;
                }
            }
            let data = &raw[offset..];
            if length != data.len() {
                return Err(error(
                    ErrorCode::InvalidEvent,
                    "Meta payload length mismatch",
                ));
            }
            let expected = match meta_type {
                0x00 if data.is_empty() => None,
                0x00 | 0x59 => Some(2),
                0x20 | 0x21 => Some(1),
                0x2f => Some(0),
                0x51 => Some(3),
                0x54 => Some(5),
                0x58 => Some(4),
                _ => None,
            };
            if expected.is_some_and(|size| size != data.len()) {
                return Err(error(
                    ErrorCode::InvalidEvent,
                    format!(
                        "Malformed metadata 0x{meta_type:02x}: unexpected fixed payload length"
                    ),
                ));
            }
            match meta_type {
                0x51 => EventKind::Tempo {
                    microseconds_per_quarter: u32::from_be_bytes([0, data[0], data[1], data[2]]),
                },
                0x58 => {
                    if data[0] == 0 || data[1] > 15 || data[3] != 8 {
                        warn(DiagnosticCode::UnconventionalMeter);
                    }
                    EventKind::TimeSignature {
                        numerator: data[0],
                        denominator_power: data[1],
                        clocks_per_click: data[2],
                        thirty_seconds_per_quarter: data[3],
                    }
                }
                _ => {
                    match meta_type {
                        0x2f => {}
                        0x20 | 0x21 => warn(DiagnosticCode::RoutingUninterpreted),
                        0x54 => warn(DiagnosticCode::SmpteOffsetUninterpreted),
                        _ => warn(DiagnosticCode::MetadataUninterpreted),
                    }
                    EventKind::Meta {
                        meta_type,
                        data: data.into(),
                    }
                }
            }
        }
    })
}

fn annotate_clock(events: &mut [RawEvent], ppq: u16, diagnostics: &mut Diagnostics) -> bool {
    let mut valid = true;
    let mut previous_tick = None;
    let mut channels = [None; 16];
    let mut first_tempo: Option<(u16, u32)> = None;
    let mut tempo_tracks_differ = false;
    let mut tempo_values_differ = false;
    let mut first_tempo_tick = None;
    for event in events.iter() {
        if previous_tick != Some(event.tick) {
            previous_tick = Some(event.tick);
            channels = [None; 16];
            first_tempo = None;
            tempo_tracks_differ = false;
            tempo_values_differ = false;
        }
        match event.kind {
            EventKind::Channel { channel, .. } => {
                let prior = &mut channels[channel as usize];
                if prior.is_some_and(|track| track != event.id.track_index) {
                    diagnostic(
                        diagnostics,
                        DiagnosticCode::CrossTrackChannelOrder,
                        Some(event.id),
                    );
                }
                prior.get_or_insert(event.id.track_index);
            }
            EventKind::Tempo {
                microseconds_per_quarter: tempo,
            } => {
                first_tempo_tick.get_or_insert(event.tick);
                if tempo == 0 {
                    diagnostic(diagnostics, DiagnosticCode::ZeroTempo, Some(event.id));
                    valid = false;
                }
                // Keep all same-track changes, but no relative order between
                // unequal tempo values on different tracks is defined by SMF.
                if let Some((track, value)) = first_tempo {
                    tempo_tracks_differ |= track != event.id.track_index;
                    tempo_values_differ |= value != tempo;
                }
                if tempo_tracks_differ && tempo_values_differ {
                    diagnostic(
                        diagnostics,
                        DiagnosticCode::CrossTrackTempoOrder,
                        Some(event.id),
                    );
                    valid = false;
                }
                first_tempo.get_or_insert((event.id.track_index, tempo));
            }
            _ => {}
        }
    }
    if first_tempo_tick != Some(0) {
        diagnostic(diagnostics, DiagnosticCode::DefaultTempo, None);
    }
    if !valid {
        return false;
    }
    let mut tick = 0;
    let mut elapsed = 0_u64;
    let mut tempo = DEFAULT_TEMPO;
    for event in events {
        // MAX_TICK * maximum 24-bit tempo < u64::MAX. No float conversion,
        // BPM round trip, per-segment rounding, or notation limits are applied.
        elapsed += (event.tick - tick) * u64::from(tempo);
        tick = event.tick;
        event.relative_microseconds = Some(ExactMicroseconds::new(elapsed, ppq));
        if let EventKind::Tempo {
            microseconds_per_quarter,
        } = event.kind
        {
            tempo = microseconds_per_quarter;
        }
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    // Every fixture below is newly authored synthetic event data. No imported
    // song, melody, private source, or copyrighted transcription is embedded.
    fn smf(format: u16, ppq: u16, tracks: &[Vec<u8>]) -> Vec<u8> {
        let mut bytes = b"MThd\0\0\0\x06".to_vec();
        bytes.extend(format.to_be_bytes());
        bytes.extend((tracks.len() as u16).to_be_bytes());
        bytes.extend(ppq.to_be_bytes());
        for track in tracks {
            bytes.extend(b"MTrk");
            bytes.extend((track.len() as u32).to_be_bytes());
            bytes.extend(track);
        }
        bytes
    }
    fn vlq(value: u32) -> Vec<u8> {
        let mut bytes = vec![(value & 0x7f) as u8];
        let mut value = value >> 7;
        while value > 0 {
            bytes.push((value & 0x7f) as u8 | 0x80);
            value >>= 7;
        }
        bytes.reverse();
        bytes
    }
    fn event(track: &mut Vec<u8>, delta: u32, bytes: &[u8]) {
        track.extend(vlq(delta));
        track.extend(bytes);
    }
    fn eot(track: &mut Vec<u8>, delta: u32) {
        event(track, delta, &[0xff, 0x2f, 0]);
    }
    fn tempo(track: &mut Vec<u8>, delta: u32, value: u32) {
        let bytes = value.to_be_bytes();
        event(track, delta, &[0xff, 0x51, 3, bytes[1], bytes[2], bytes[3]]);
    }
    fn parse(bytes: &[u8]) -> RawMidiTimeline {
        parse_midi_events(bytes, None).unwrap()
    }
    fn has(timeline: &RawMidiTimeline, code: DiagnosticCode) -> bool {
        timeline
            .diagnostics()
            .iter()
            .any(|diagnostic| diagnostic.code() == code)
    }
    fn error_code(bytes: &[u8]) -> ErrorCode {
        parse_midi_events(bytes, None).unwrap_err().code
    }

    #[test]
    fn source_digest_matches_independent_known_sha256_vector() {
        let bytes = smf(0, 96, &[vec![0, 0xff, 0x2f, 0]]);
        assert_eq!(
            parse(&bytes).source_sha256().hex(),
            "64454629ee0b60f0d39ccbd48a551d4c267a53371af7e51b1ada65ec3d13007a"
        );
    }

    #[test]
    fn retains_independent_repeated_unmatched_and_percussion_events() {
        let mut tracks = Vec::new();
        for channel in 0..11 {
            let mut track = vec![];
            event(&mut track, 0, &[0xff, 3, 1, b'A' + channel]);
            event(&mut track, 0, &[0xc0 | channel, 17 + channel]);
            event(&mut track, 0, &[0x90 | channel, 70 + channel, 80]);
            event(&mut track, 2, &[0x90 | channel, 70 + channel, 99]);
            event(&mut track, 1, &[0x80 | channel, 70 + channel, 47]);
            event(&mut track, 1, &[0x90 | channel, 70 + channel, 0]);
            // Unmatched release and unclosed on are independent raw events.
            event(&mut track, 0, &[0x80 | channel, 10, 127]);
            event(&mut track, 0, &[0x90 | channel, 20, 50]);
            eot(&mut track, 1);
            tracks.push(track);
        }
        let bytes = smf(1, 480, &tracks);
        let timeline = parse(&bytes);
        assert_eq!(timeline.events().len(), 99);
        assert_eq!(timeline.track_count(), 11);
        assert_eq!(timeline.end_tick(), 5);
        assert_eq!(timeline.original_bytes(), bytes);
        assert!(has(&timeline, DiagnosticCode::PercussionMappingUnresolved));
        let drum = timeline
            .events()
            .iter()
            .find(|event| event.id().track_index() == 9 && event.id().event_index() == 4)
            .unwrap();
        assert_eq!(
            drum.kind(),
            &EventKind::Channel {
                channel: 9,
                message: ChannelMessage::NoteOff {
                    key: 79,
                    velocity: 47
                }
            }
        );
        let repeated: Vec<_> = timeline
            .events()
            .iter()
            .filter(|event| {
                event.id().track_index() == 0
                    && matches!(
                        event.kind(),
                        EventKind::Channel {
                            message: ChannelMessage::NoteOn { key: 70, .. },
                            ..
                        }
                    )
            })
            .collect();
        assert_eq!(repeated.len(), 3);
        assert_ne!(repeated[0].id(), repeated[1].id());
        assert!(!has(&timeline, DiagnosticCode::CrossTrackChannelOrder));
        assert!(crate::import_midi(&bytes).is_err());
    }

    #[test]
    fn source_bytes_identity_and_running_status_are_exact() {
        let track = vec![0x80, 0, 0x90, 60, 80, 1, 60, 81, 0, 60, 0, 0, 0xff, 0x2f, 0];
        let mut bytes = smf(0, 3, std::slice::from_ref(&track));
        let timeline = parse(&bytes);
        let reparse = parse_midi_events(&bytes, Some(timeline.source_sha256().bytes())).unwrap();
        assert_eq!(timeline.source_sha256(), reparse.source_sha256());
        assert_eq!(timeline.events()[1].id(), reparse.events()[1].id());
        assert_eq!(
            timeline.encoded_event(timeline.events()[0].id()).unwrap(),
            [0x80, 0, 0x90, 60, 80]
        );
        assert_eq!(
            timeline.encoded_event(timeline.events()[1].id()).unwrap(),
            [1, 60, 81]
        );
        let reconstructed: Vec<u8> = timeline
            .events()
            .iter()
            .flat_map(|event| timeline.encoded_event(event.id()).unwrap())
            .copied()
            .collect();
        assert_eq!(reconstructed, track);
        // An original encoding-only change changes source identity, despite
        // identical musical ticks and channel messages.
        bytes.remove(22);
        bytes[21] -= 1;
        let other = parse(&bytes);
        assert_eq!(timeline.events()[0].tick(), other.events()[0].tick());
        assert_eq!(timeline.events()[0].kind(), other.events()[0].kind());
        assert_ne!(timeline.source_sha256(), other.source_sha256());
        assert!(other.event(timeline.events()[0].id()).is_none());
        assert_eq!(
            parse_midi_events(&bytes, Some(timeline.source_sha256().bytes()))
                .unwrap_err()
                .code,
            ErrorCode::SourceDigestMismatch
        );
        assert_eq!(timeline.original_bytes()[22], 0x80);
        assert!(timeline.events()[0].id().stable_id().ends_with(":t0:e0"));
    }

    #[test]
    fn preserves_all_channel_message_values() {
        let track = vec![
            0, 0x8f, 127, 125, 0, 0x9f, 126, 0, 0, 0xaf, 125, 124, 0, 0xbf, 64, 127, 0, 0xcf, 127,
            0, 0xdf, 126, 0, 0xef, 127, 127, 0, 0xff, 0x2f, 0,
        ];
        let timeline = parse(&smf(0, 1, &[track]));
        let messages: Vec<_> = timeline
            .events()
            .iter()
            .filter_map(|event| match event.kind() {
                EventKind::Channel {
                    channel: 15,
                    message,
                } => Some(message.clone()),
                _ => None,
            })
            .collect();
        assert_eq!(
            messages,
            vec![
                ChannelMessage::NoteOff {
                    key: 127,
                    velocity: 125
                },
                ChannelMessage::NoteOn {
                    key: 126,
                    velocity: 0
                },
                ChannelMessage::KeyPressure {
                    key: 125,
                    pressure: 124
                },
                ChannelMessage::Controller {
                    controller: 64,
                    value: 127
                },
                ChannelMessage::ProgramChange { program: 127 },
                ChannelMessage::ChannelPressure { pressure: 126 },
                ChannelMessage::PitchBend { value: 16383 },
            ]
        );
        assert!(has(
            &timeline,
            DiagnosticCode::ControllerSemanticsUninterpreted
        ));
        assert!(has(&timeline, DiagnosticCode::PressureOrBendUninterpreted));
        assert!(has(&timeline, DiagnosticCode::ProgramMappingUnresolved));
    }

    #[test]
    fn retains_opaque_metadata_sysex_escape_and_uninterpreted_values() {
        let track = vec![
            0, 0xff, 3, 3, 0xff, 0, 0xfe, 0, 0xff, 0x59, 2, 0x80, 2, 0, 0xff, 0x20, 1, 15, 0, 0xff,
            0x21, 1, 127, 0, 0xff, 0x54, 5, 0, 0, 0, 0, 0, 0, 0xff, 0x7f, 2, 0xaa, 0xbb, 0, 0xff,
            0x70, 2, 0xfe, 0xff, 0, 0xf0, 3, 0x7d, 0x11, 0xf7, 0, 0xf7, 2, 0xab, 0xcd, 0, 0xff,
            0x2f, 0,
        ];
        let timeline = parse(&smf(0, 96, &[track]));
        assert_eq!(timeline.events().len(), 10);
        assert_eq!(
            timeline.events()[0].kind(),
            &EventKind::Meta {
                meta_type: 3,
                data: vec![0xff, 0, 0xfe]
            }
        );
        assert_eq!(
            timeline.events()[1].kind(),
            &EventKind::Meta {
                meta_type: 0x59,
                data: vec![0x80, 2]
            }
        );
        assert_eq!(
            timeline.events()[2].kind(),
            &EventKind::Meta {
                meta_type: 0x20,
                data: vec![15]
            }
        );
        assert_eq!(
            timeline.events()[7].kind(),
            &EventKind::SysEx {
                data: vec![0x7d, 0x11, 0xf7]
            }
        );
        assert_eq!(
            timeline.events()[8].kind(),
            &EventKind::Escape {
                data: vec![0xab, 0xcd]
            }
        );
        for code in [
            DiagnosticCode::MetadataUninterpreted,
            DiagnosticCode::RoutingUninterpreted,
            DiagnosticCode::SmpteOffsetUninterpreted,
            DiagnosticCode::SysExUninterpreted,
            DiagnosticCode::EscapeUninterpreted,
        ] {
            assert!(has(&timeline, code));
        }
    }

    #[test]
    fn timing_is_exact_across_tempo_changes_and_meter_bytes_are_unaltered() {
        let mut track = vec![];
        event(&mut track, 0, &[0xff, 0x58, 4, 7, 3, 36, 8]);
        tempo(&mut track, 0, 500_001);
        event(&mut track, 1, &[0x90, 30, 90]);
        tempo(&mut track, 1, 400_001);
        event(&mut track, 1, &[0x80, 30, 77]);
        eot(&mut track, 1);
        let timeline = parse(&smf(0, 3, &[track]));
        assert_eq!(
            timeline.events()[0].kind(),
            &EventKind::TimeSignature {
                numerator: 7,
                denominator_power: 3,
                clocks_per_click: 36,
                thirty_seconds_per_quarter: 8
            }
        );
        assert!(timeline.events()[2].beat().equivalent(Beat::new(1, 3)));
        assert_eq!(
            timeline.events()[2].relative_microseconds(),
            Some(ExactMicroseconds {
                numerator: 166667,
                denominator: 1
            })
        );
        assert_eq!(
            timeline.events()[4].relative_microseconds(),
            Some(ExactMicroseconds {
                numerator: 1_400_003,
                denominator: 3
            })
        );
        assert_eq!(
            timeline.events()[5].relative_microseconds(),
            Some(ExactMicroseconds {
                numerator: 1_800_004,
                denominator: 3
            })
        );
        assert!(!has(&timeline, DiagnosticCode::DefaultTempo));
    }

    #[test]
    fn defaults_do_not_insert_events_and_duplicate_tempos_are_not_deduplicated() {
        let mut track = vec![];
        tempo(&mut track, 2, 300_001);
        tempo(&mut track, 0, 300_001);
        eot(&mut track, 2);
        let timeline = parse(&smf(0, 7, &[track]));
        assert_eq!(timeline.events().len(), 3);
        assert_eq!(timeline.events()[0].tick(), 2);
        assert_eq!(
            timeline.events()[2].relative_microseconds(),
            Some(ExactMicroseconds {
                numerator: 1_600_002,
                denominator: 7
            })
        );
        assert!(has(&timeline, DiagnosticCode::DefaultTempo));
    }

    #[test]
    fn deterministic_ties_preserve_source_order_and_disclose_ambiguity() {
        let bytes = smf(
            1,
            96,
            &[
                vec![0, 0xc0, 15, 0, 0x90, 66, 90, 0, 0xff, 0x2f, 0],
                vec![0, 0x80, 66, 40, 0, 0xc0, 25, 0, 0xff, 0x2f, 0],
            ],
        );
        let timeline = parse(&bytes);
        let indices: Vec<_> = timeline
            .events()
            .iter()
            .map(|event| (event.id().track_index(), event.id().event_index()))
            .collect();
        assert_eq!(
            indices,
            vec![(0, 0), (0, 1), (0, 2), (1, 0), (1, 1), (1, 2)]
        );
        assert!(has(&timeline, DiagnosticCode::CrossTrackChannelOrder));
        assert!(timeline.relative_clock_available());
        assert_eq!(
            serde_json::to_string(&timeline).unwrap(),
            serde_json::to_string(&parse(&bytes)).unwrap()
        );
    }

    #[test]
    fn unequal_cross_track_tempos_disable_clock_even_after_equal_tempo_prefixes() {
        for second_track_values in [[200_001, 400_001], [400_001, 200_001]] {
            let mut first = vec![];
            tempo(&mut first, 0, 200_001);
            eot(&mut first, 4);
            let mut second = vec![];
            for value in second_track_values {
                tempo(&mut second, 0, value);
            }
            eot(&mut second, 4);
            let timeline = parse(&smf(1, 120, &[first, second]));
            assert_eq!(timeline.events().len(), 5);
            assert!(has(&timeline, DiagnosticCode::CrossTrackTempoOrder));
            assert!(!timeline.relative_clock_available());
            assert!(timeline
                .events()
                .iter()
                .all(|event| event.relative_microseconds().is_none()));
        }
    }

    #[test]
    fn same_track_tempo_order_is_defined_and_identical_cross_track_tempos_work() {
        let mut track = vec![];
        tempo(&mut track, 0, 200_001);
        tempo(&mut track, 0, 400_001);
        eot(&mut track, 3);
        let timeline = parse(&smf(0, 3, &[track]));
        assert!(timeline.relative_clock_available());
        assert_eq!(
            timeline.events()[2]
                .relative_microseconds()
                .unwrap()
                .numerator(),
            400_001
        );
        let mut track = vec![];
        tempo(&mut track, 0, 400_001);
        eot(&mut track, 3);
        let timeline = parse(&smf(1, 3, &[track.clone(), track]));
        assert!(timeline.relative_clock_available());
        assert!(!has(&timeline, DiagnosticCode::CrossTrackTempoOrder));
        assert_eq!(timeline.events().len(), 4);
    }

    #[test]
    fn zero_tempo_and_unconventional_meter_are_retained_without_guessing() {
        let mut track = vec![];
        tempo(&mut track, 0, 0);
        event(&mut track, 0, &[0xff, 0x58, 4, 0, 255, 0, 0]);
        eot(&mut track, 1);
        let timeline = parse(&smf(0, 1, &[track]));
        assert_eq!(timeline.events().len(), 3);
        assert!(!timeline.relative_clock_available());
        assert!(has(&timeline, DiagnosticCode::ZeroTempo));
        assert!(has(&timeline, DiagnosticCode::UnconventionalMeter));
        assert_eq!(
            timeline.events()[1].kind(),
            &EventKind::TimeSignature {
                numerator: 0,
                denominator_power: 255,
                clocks_per_click: 0,
                thirty_seconds_per_quarter: 0
            }
        );
    }

    #[test]
    fn bounds_are_inclusive_and_checked_before_unbounded_allocation() {
        let track = vec![1, 0x90, 20, 30, 0, 0xff, 0x2f, 0];
        let bytes = smf(0, 1, &[track]);
        let exact = Limits {
            bytes: bytes.len(),
            tracks: 1,
            events: 2,
            tick: 1,
        };
        assert!(parse_with_limits(&bytes, None, exact).is_ok());
        for (limits, code) in [
            (
                Limits {
                    bytes: bytes.len() - 1,
                    ..exact
                },
                ErrorCode::SourceLimit,
            ),
            (Limits { tracks: 0, ..exact }, ErrorCode::TrackLimit),
            (Limits { events: 1, ..exact }, ErrorCode::EventLimit),
            (Limits { tick: 0, ..exact }, ErrorCode::TickLimit),
        ] {
            assert_eq!(
                parse_with_limits(&bytes, None, limits).unwrap_err().code,
                code
            );
        }
        assert_eq!(
            error_code(&vec![0; MAX_SOURCE_BYTES + 1]),
            ErrorCode::SourceLimit
        );
        let mut track = vec![];
        for _ in 0..4 {
            event(&mut track, 250_000_000, &[0x90, 0, 1]);
        }
        eot(&mut track, 0);
        assert_eq!(parse(&smf(0, 32767, &[track.clone()])).end_tick(), MAX_TICK);
        track.truncate(track.len() - 4);
        eot(&mut track, 1);
        assert_eq!(error_code(&smf(0, 1, &[track])), ErrorCode::TickLimit);
    }

    #[test]
    fn large_exact_clock_serializes_without_json_number_rounding() {
        let mut track = vec![];
        tempo(&mut track, 0, 0xff_ffff);
        for _ in 0..4 {
            event(&mut track, 250_000_000, &[0x90, 0, 1]);
        }
        eot(&mut track, 0);
        let timeline = parse(&smf(0, 1, &[track]));
        let time = timeline
            .events()
            .last()
            .unwrap()
            .relative_microseconds()
            .unwrap();
        assert_eq!(time.numerator(), 16_777_215_000_000_000);
        let json = serde_json::to_value(time).unwrap();
        assert_eq!(json["numerator"], "16777215000000000");
        assert_eq!(json["denominator"], 1);
        let json = serde_json::to_value(&timeline).unwrap();
        assert!(json.get("original_bytes").is_none());
        assert_eq!(json["source_sha256"], timeline.source_sha256().hex());
    }

    #[test]
    fn unsupported_headers_have_explicit_errors_without_ppq_fallback() {
        let track = vec![0, 0xff, 0x2f, 0];
        assert_eq!(
            error_code(&smf(2, 96, std::slice::from_ref(&track))),
            ErrorCode::UnsupportedFormat
        );
        assert_eq!(
            error_code(&smf(0, 0, std::slice::from_ref(&track))),
            ErrorCode::InvalidPpq
        );
        for high in 0x80_u8..=0xff {
            assert_eq!(
                error_code(&smf(
                    0,
                    u16::from(high) << 8 | 80,
                    std::slice::from_ref(&track)
                )),
                ErrorCode::UnsupportedSmpte
            );
        }
        assert_eq!(
            error_code(&smf(0, 96, &[track.clone(), track])),
            ErrorCode::TrackLimit
        );
        assert_eq!(error_code(&smf(1, 96, &[])), ErrorCode::TrackLimit);
    }

    #[test]
    fn malformed_framing_and_fixed_metadata_fail_without_partial_success() {
        let good = smf(0, 96, &[vec![0, 0xff, 0x2f, 0]]);
        for end in 0..good.len() {
            assert!(parse_midi_events(&good[..end], None).is_err());
        }
        let mut trailing = good.clone();
        trailing.push(0);
        assert_eq!(error_code(&trailing), ErrorCode::InvalidContainer);
        assert_eq!(
            error_code(&smf(0, 96, &[vec![0, 0x90, 20, 90]])),
            ErrorCode::MissingEndOfTrack
        );
        assert_eq!(
            error_code(&smf(0, 96, &[vec![0, 0xff, 0x2f, 0, 0, 0x90, 20, 90]])),
            ErrorCode::EventsAfterEndOfTrack
        );
        for track in [
            vec![0, 0xff, 0x2f, 1, 0],
            vec![0, 0xff, 0x51, 4, 7, 0, 0, 0, 0, 0xff, 0x2f, 0],
            vec![0, 0xff, 0x58, 3, 4, 2, 24, 0, 0xff, 0x2f, 0],
            vec![0, 0x90, 20, 0xff],
            vec![0, 20, 90],
        ] {
            assert_eq!(error_code(&smf(0, 96, &[track])), ErrorCode::InvalidEvent);
        }
    }
}

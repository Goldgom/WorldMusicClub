//! Read-only instrument evidence, never an instrument assignment or sound map.
//!
//! Supported inputs are the current canonical MIDI projection with retained
//! bytes and complete Basic MIDI event metadata. Every name and selection below
//! is a source declaration, not proof of a physical instrument or a GM bank.
//! Output is deliberately not deserializable and is not accepted by playback,
//! adaptation, ownership, scoring or pitch projection. Apply Mods separately.
use crate::{basic_keys, clean_song::Coordinate, practice_source, Beat, Score};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;

pub const DISCLOSURE_REVISION: u32 = 1;
pub const MAX_DISCLOSURE_BYTES: usize = 32 * 1024 * 1024;

#[derive(Debug, Serialize)]
pub struct DisclosureError {
    pub code: &'static str,
    pub message: String,
}
impl std::fmt::Display for DisclosureError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.code, self.message)
    }
}
impl std::error::Error for DisclosureError {}
fn error(code: &'static str, message: impl Into<String>) -> DisclosureError {
    DisclosureError {
        code,
        message: message.into(),
    }
}

#[derive(Debug, Serialize)]
/// Informational output cannot be supplied as a native source or receipt.
/// ```compile_fail
/// let _: score_core::source_instrument::SourceInstrumentDetails =
///     serde_json::from_str("{}").unwrap();
/// ```
pub struct SourceInstrumentDetails {
    pub revision: u32,
    pub source_profile: &'static str,
    /// Match the complete binding before reusing these details. Basic's domain
    /// hashes validated compact package JSON, not a practice runtime receipt.
    pub source_binding: practice_source::PracticeSourceBinding,
    pub original_midi_sha256: String,
    pub original_midi_bytes: usize,
    pub original_bytes_verification: OriginalBytesVerification,
    pub source_format: u16,
    pub ppq: u16,
    /// No guessed or renderer-derived wall-clock conversion is supplied.
    pub clock: DisclosureClock,
    pub tracks: Vec<TrackDetails>,
    pub routes: Vec<RouteDetails>,
    pub channels: Vec<ChannelDetails>,
    pub parts: Vec<PartDetails>,
    /// SysEx, escape and sequencer-specific messages can change a receiver's
    /// sound state. Their meaning is not inferred, including apparent GM resets.
    pub uninterpreted_sound_events: Vec<EventPosition>,
    pub instrument_namespace: InstrumentNamespace,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum OriginalBytesVerification {
    VerifiedRetainedBytes,
    /// Complete Basic validates event/projection consistency, not a supplied
    /// provenance hash against absent private original bytes.
    DeclaredProvenanceOnly,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum InstrumentNamespace {
    Unknown,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum DisclosureClock {
    SourcePpqTicksAndBeatsOnly,
}

#[derive(Clone, Debug, Serialize)]
pub struct EventPosition {
    pub event_id: String,
    pub origin: Coordinate,
    pub tick: u64,
    /// Exact source PPQ time; never a renderer's rounded milliseconds.
    pub beat: Beat,
}

#[derive(Debug, Serialize)]
pub struct TrackDetails {
    pub id: String,
    pub source_track_index: u16,
    pub names: Vec<DeclaredName>,
    pub routing_events: Vec<RoutingEvent>,
}
#[derive(Debug, Serialize)]
pub struct DeclaredName {
    pub at: EventPosition,
    pub role: NameRole,
    pub bytes: Vec<u8>,
    /// Only exact UTF-8, never replacement characters or guessed legacy text.
    /// Treat as plain untrusted text at the presentation boundary.
    pub utf8: Option<String>,
    /// Only valid 0..15 associations. Inspect scope before treating None as
    /// unscoped: an invalid raw prefix is not a channel and is never clamped.
    pub channel_prefix: Option<u8>,
    pub channel_prefix_scope: ChannelPrefixScope,
    pub channel_prefix_declaration: Option<Coordinate>,
    /// Route-table index when that declaration is used by any channel message.
    /// The exact preceding routing declarations also remain available when no
    /// channel ever uses this metadata-only route; no route bytes are duplicated.
    pub source_route_index: Option<usize>,
    pub port_declaration: Option<Coordinate>,
    pub device_name_declaration: Option<Coordinate>,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum NameRole {
    TrackName,
    InstrumentName,
    ProgramName,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ChannelPrefixScope {
    Unscoped,
    DeclaredChannel,
    InvalidDeclaration,
}

#[derive(Debug, Serialize)]
pub struct RoutingEvent {
    pub at: EventPosition,
    pub declaration: RoutingDeclaration,
}
#[derive(Debug, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum RoutingDeclaration {
    Port { value: u8 },
    DeviceName { bytes: Vec<u8> },
    ChannelPrefix { channel: u8 },
    InvalidChannelPrefix { byte: u8 },
}
#[derive(Debug, Serialize)]
pub struct RouteDetails {
    pub id: String,
    pub source_route_index: usize,
    /// These are logical declarations, never verified physical destinations.
    pub declaration: basic_keys::Route,
}
#[derive(Debug, Serialize)]
pub struct ChannelDetails {
    pub id: String,
    pub route_id: String,
    /// Zero-based MIDI channel, including channel 9 with unresolved percussion.
    pub channel: u8,
    /// All tracks on this logical route/channel contribute here. Sorting by
    /// (tick, track, event) is for display only; cross-track ties are unordered.
    pub selection_timeline: Vec<SelectionEvent>,
    pub ambiguous_ticks: Vec<u64>,
}
#[derive(Clone, Debug, Serialize)]
pub struct SelectionEvent {
    pub at: EventPosition,
    pub declaration: SelectionDeclaration,
}
#[derive(Clone, Copy, Debug, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum SelectionDeclaration {
    Program {
        value: u8,
    },
    BankMostSignificant {
        value: u8,
    },
    BankLeastSignificant {
        value: u8,
    },
    /// The compatible Basic dialect retains malformed program slots verbatim.
    InvalidProgram {
        byte: u8,
    },
}

#[derive(Debug, Serialize)]
pub struct PartDetails {
    /// Existing canonical/Basic part identifier, suitable for looking up a row.
    pub part_id: String,
    pub id: String,
    /// Presentation only; never evidence for the performed instrument.
    pub display_name: String,
    pub track_id: String,
    pub route_id: String,
    pub channel_id: String,
    pub key_semantics: basic_keys::KeySemantics,
    pub source_attack_count: usize,
    /// Basic can contain zero-duration/unresolved attacks absent from notation.
    pub notated_note_count: usize,
    /// Source MIDI key numbers, not verified acoustic pitches or sounding range.
    pub key_range: Option<KeyRange>,
    pub first_attack: Option<EventPosition>,
    pub last_attack: Option<EventPosition>,
    pub selection_summary: SelectionSummary,
}
#[derive(Debug, Serialize)]
pub struct KeyRange {
    pub lowest: u8,
    pub highest: u8,
}

#[derive(Debug, Serialize)]
pub struct SelectionSummary {
    pub status: SelectionStatus,
    /// Unique explicit numeric selections sampled at this part's attacks.
    /// This never names an acoustic instrument. Missing banks remain unknown.
    pub observed_selections: Vec<NumericSelection>,
    pub attacks_without_declared_program: usize,
    pub attacks_with_ambiguous_selection: usize,
    /// True only for distinct known selections observed at attacks, not merely
    /// duplicate program messages or a bank change pending a program message.
    pub changes: bool,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SelectionStatus {
    Unknown,
    /// Known numeric declaration, not a known original sound or GM identity.
    Known,
    Changes,
    /// Some attacks have a declaration and some precede any program declaration.
    Mixed,
    Ambiguous,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize)]
pub struct NumericSelection {
    pub program: u8,
    /// Bank selectors captured at the program declaration, not later pending CCs.
    pub bank_most_significant: Option<u8>,
    pub bank_least_significant: Option<u8>,
}

/// Verify retained MIDI bytes and the unmodified musical projection before
/// disclosing evidence. Display names/title may be edited, but never pitches,
/// source note IDs, timing, navigation or event-to-part correspondence.
/// Other canonical formats and unsupported MIDI profiles fail explicitly.
pub fn describe_canonical_midi(score: &Score) -> Result<SourceInstrumentDetails, DisclosureError> {
    let source = score.source.as_ref().filter(|s| s.format == "midi-base64")
        .ok_or_else(|| error("unsupported_source_profile", "Instrument disclosure requires retained canonical MIDI bytes or complete Basic MIDI metadata"))?;
    if source.content.len() > crate::midi_events::MAX_SOURCE_BYTES.div_ceil(3) * 4 {
        return Err(error(
            "source_disclosure_limit",
            "Retained MIDI exceeds the disclosure byte bound",
        ));
    }
    crate::validate(score).map_err(|e| error("invalid_canonical_source", e))?;
    let bytes = STANDARD
        .decode(&source.content)
        .map_err(|e| error("invalid_midi_source", e.to_string()))?;
    let (expected, _) =
        crate::import_midi(&bytes).map_err(|e| error("unsupported_canonical_midi", e))?;
    fn projection(score: &Score) -> Result<Vec<u8>, serde_json::Error> {
        let parts: Vec<_> = score.parts.iter().map(|p| (&p.id, &p.notes)).collect();
        serde_json::to_vec(&(
            parts,
            &score.tempo,
            &score.meters,
            &score.keys,
            &score.measures,
            &score.repeats,
        ))
    }
    if projection(score).map_err(|e| error("source_projection_mismatch", e.to_string()))?
        != projection(&expected).map_err(|e| error("source_projection_mismatch", e.to_string()))?
    {
        return Err(error("source_projection_mismatch", "Canonical musical projection differs from the retained MIDI source; do not supply a Mod-transformed score"));
    }
    let basic = basic_keys::convert_midi(&bytes, "Source instrument disclosure")
        .map_err(|e| error("unsupported_disclosure_profile", e.message))?;
    let digest = practice_source::hash(score)
        .map_err(|e| error("source_disclosure_limit", e.to_string()))?;
    let binding = binding("wmc-canonical-score-serde-json", digest);
    bounded(
        build(
            &basic,
            Some(score),
            binding,
            OriginalBytesVerification::VerifiedRetainedBytes,
        )?,
        MAX_DISCLOSURE_BYTES,
    )
}

/// Revalidate every complete event and derived claim. The original MIDI SHA is
/// provenance only; this does not claim possession or verification of its bytes.
pub fn describe_basic(
    score: &basic_keys::CompleteBasicKeys,
) -> Result<SourceInstrumentDetails, DisclosureError> {
    let wire = basic_keys::encode_json(score).map_err(|e| error("invalid_basic_source", e))?;
    let binding = binding(
        "wmc-basic-complete-wire-json",
        format!("{:x}", Sha256::digest(&wire)),
    );
    bounded(
        build(
            score,
            None,
            binding,
            OriginalBytesVerification::DeclaredProvenanceOnly,
        )?,
        MAX_DISCLOSURE_BYTES,
    )
}
fn bounded(
    details: SourceInstrumentDetails,
    limit: usize,
) -> Result<SourceInstrumentDetails, DisclosureError> {
    struct Budget(usize);
    impl std::io::Write for Budget {
        fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
            self.0 = self
                .0
                .checked_sub(bytes.len())
                .ok_or_else(|| std::io::Error::other("disclosure byte limit"))?;
            Ok(bytes.len())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }
    serde_json::to_writer(Budget(limit), &details)
        .map_err(|_| error("source_disclosure_limit", "Complete informational disclosure exceeds its byte limit; no declarations were dropped and the source remains unchanged"))?;
    Ok(details)
}
fn binding(domain: &str, digest: String) -> practice_source::PracticeSourceBinding {
    practice_source::PracticeSourceBinding {
        domain: domain.into(),
        serialization_revision: 1,
        digest,
    }
}

#[derive(Clone)]
enum Action {
    Select(SelectionDeclaration),
    Attack { part: usize, key: u8 },
}
#[derive(Clone)]
struct StreamEvent {
    at: EventPosition,
    action: Action,
}

fn build(
    score: &basic_keys::CompleteBasicKeys,
    canonical: Option<&Score>,
    source_binding: practice_source::PracticeSourceBinding,
    original_bytes_verification: OriginalBytesVerification,
) -> Result<SourceInstrumentDetails, DisclosureError> {
    let p = &score.performance;
    // IDs are scoped by the validated content binding, so a Basic provenance
    // claim cannot create cache aliases for different complete event metadata.
    let root = format!("source-instrument:{}", source_binding.digest);
    let track_id = |index| format!("{root}:t{index}");
    let route_id = |index| format!("{root}:r{index}");
    let channel_id = |route, channel| format!("{root}:r{route}:c{channel}");
    let position = |track, event, tick| EventPosition {
        event_id: basic_keys::source_event_id(&score.source.sha256, Coordinate { track, event }),
        origin: Coordinate { track, event },
        tick,
        beat: Beat::new(tick as i64, i64::from(p.ppq)),
    };
    let routes = p
        .routes
        .iter()
        .enumerate()
        .map(|(index, route)| RouteDetails {
            id: route_id(index),
            source_route_index: index,
            declaration: route.clone(),
        })
        .collect();
    let route_indexes: BTreeMap<_, _> = p
        .routes
        .iter()
        .enumerate()
        .map(|(i, r)| (r.clone(), i))
        .collect();
    let track_indexes: BTreeMap<_, _> = p
        .tracks
        .iter()
        .map(|t| (t.id.as_str(), t.source_index))
        .collect();
    let mut parts = vec![];
    let mut part_indexes = BTreeMap::new();
    let notation = canonical.unwrap_or(&score.notation);
    let notation_parts: BTreeMap<_, _> =
        notation.parts.iter().map(|p| (p.id.as_str(), p)).collect();
    for part in &p.parts {
        let track = track_indexes[part.track_id.as_str()];
        let canonical_id = format!("midi-t{}-c{}", track + 1, part.channel + 1);
        let id = if canonical.is_some() {
            &canonical_id
        } else {
            &part.id
        };
        let Some(notated) = notation_parts.get(id.as_str()) else {
            continue;
        };
        part_indexes.insert((track, part.route, part.channel), parts.len());
        parts.push(PartDetails {
            part_id: id.clone(),
            id: format!("{root}:part:{id}"),
            display_name: notated.name.clone(),
            track_id: track_id(track),
            route_id: route_id(part.route),
            channel_id: channel_id(part.route, part.channel),
            key_semantics: part.key_semantics.clone(),
            source_attack_count: 0,
            notated_note_count: notated.notes.len(),
            key_range: None,
            first_attack: None,
            last_attack: None,
            selection_summary: SelectionSummary {
                status: SelectionStatus::Unknown,
                observed_selections: vec![],
                attacks_without_declared_program: 0,
                attacks_with_ambiguous_selection: 0,
                changes: false,
            },
        });
    }
    let mut tracks = vec![];
    let mut streams: BTreeMap<(usize, u8), Vec<StreamEvent>> = BTreeMap::new();
    let mut uninterpreted_sound_events = vec![];
    for track in &p.tracks {
        let mut details = TrackDetails {
            id: track_id(track.source_index),
            source_track_index: track.source_index,
            names: vec![],
            routing_events: vec![],
        };
        let mut route = basic_keys::Route {
            port: None,
            device_name_bytes: None,
        };
        let mut current_route_index = route_indexes.get(&route).copied();
        let mut port_declaration = None;
        let mut device_name_declaration = None;
        let mut prefix = None;
        let mut prefix_scope = ChannelPrefixScope::Unscoped;
        let mut prefix_declaration = None;
        let mut tick = 0;
        for (index, record) in track.events.iter().enumerate() {
            tick += u64::from(record.0);
            let at = position(track.source_index, index as u32, tick);
            let data = &record.1;
            match data.as_slice() {
                [255, kind @ (3 | 4 | 8), bytes @ ..] => details.names.push(DeclaredName {
                    at,
                    role: match kind {
                        3 => NameRole::TrackName,
                        4 => NameRole::InstrumentName,
                        _ => NameRole::ProgramName,
                    },
                    bytes: bytes.to_vec(),
                    utf8: std::str::from_utf8(bytes).ok().map(str::to_owned),
                    channel_prefix: prefix,
                    channel_prefix_scope: prefix_scope,
                    channel_prefix_declaration: prefix_declaration,
                    source_route_index: current_route_index,
                    port_declaration,
                    device_name_declaration,
                }),
                [255, 0x20, channel] => {
                    prefix = (*channel < 16).then_some(*channel);
                    prefix_scope = if prefix.is_some() {
                        ChannelPrefixScope::DeclaredChannel
                    } else {
                        ChannelPrefixScope::InvalidDeclaration
                    };
                    prefix_declaration = Some(at.origin);
                    details.routing_events.push(RoutingEvent {
                        at,
                        declaration: if prefix.is_some() {
                            RoutingDeclaration::ChannelPrefix { channel: *channel }
                        } else {
                            RoutingDeclaration::InvalidChannelPrefix { byte: *channel }
                        },
                    });
                }
                [255, 0x21, value] => {
                    route.port = Some(*value);
                    current_route_index = route_indexes.get(&route).copied();
                    port_declaration = Some(at.origin);
                    details.routing_events.push(RoutingEvent {
                        at,
                        declaration: RoutingDeclaration::Port { value: *value },
                    });
                }
                [255, 9, bytes @ ..] => {
                    route.device_name_bytes = Some(bytes.to_vec());
                    current_route_index = route_indexes.get(&route).copied();
                    device_name_declaration = Some(at.origin);
                    details.routing_events.push(RoutingEvent {
                        at,
                        declaration: RoutingDeclaration::DeviceName {
                            bytes: bytes.to_vec(),
                        },
                    });
                }
                [0xf0 | 0xf7, ..] | [255, 0x7f, ..] => uninterpreted_sound_events.push(at),
                [status, rest @ ..] if (0x80..=0xef).contains(status) => {
                    prefix = None; // SMF channel prefix ends at the next channel message.
                    prefix_scope = ChannelPrefixScope::Unscoped;
                    prefix_declaration = None;
                    let channel = status & 15;
                    let route_index = current_route_index.ok_or_else(|| {
                        error(
                            "source_route_mismatch",
                            "Validated source channel has no logical route",
                        )
                    })?;
                    let stream = streams.entry((route_index, channel)).or_default();
                    let declaration = match (status & 0xf0, rest) {
                        (0xc0, [value]) if *value < 128 => {
                            Some(SelectionDeclaration::Program { value: *value })
                        }
                        (0xc0, [byte]) => {
                            Some(SelectionDeclaration::InvalidProgram { byte: *byte })
                        }
                        (0xb0, [0, value]) => {
                            Some(SelectionDeclaration::BankMostSignificant { value: *value })
                        }
                        (0xb0, [32, value]) => {
                            Some(SelectionDeclaration::BankLeastSignificant { value: *value })
                        }
                        _ => None,
                    };
                    if let Some(declaration) = declaration {
                        stream.push(StreamEvent {
                            at,
                            action: Action::Select(declaration),
                        });
                    } else if let (0x90, [key, velocity]) = (status & 0xf0, rest) {
                        if *velocity > 0 {
                            let part = *part_indexes
                                .get(&(track.source_index, route_index, channel))
                                .ok_or_else(|| {
                                    error(
                                        "source_part_mismatch",
                                        "Source attack has no verified notation part",
                                    )
                                })?;
                            stream.push(StreamEvent {
                                at,
                                action: Action::Attack { part, key: *key },
                            });
                        }
                    }
                }
                _ => {}
            }
        }
        tracks.push(details);
    }
    let mut channels = vec![];
    let system_boundary = SystemBoundary::new(&uninterpreted_sound_events);
    for ((route, channel), mut stream) in streams {
        stream.sort_by_key(|e| (e.at.tick, e.at.origin));
        let mut details = ChannelDetails {
            id: channel_id(route, channel),
            route_id: route_id(route),
            channel,
            selection_timeline: vec![],
            ambiguous_ticks: vec![],
        };
        summarize(&stream, &mut details, &mut parts, system_boundary.as_ref());
        channels.push(details);
    }
    for part in &mut parts {
        let s = &mut part.selection_summary;
        s.observed_selections.sort();
        s.observed_selections.dedup();
        s.changes = s.observed_selections.len() > 1;
        s.status = if s.attacks_with_ambiguous_selection > 0 {
            SelectionStatus::Ambiguous
        } else if s.observed_selections.is_empty() {
            SelectionStatus::Unknown
        } else if s.attacks_without_declared_program > 0 {
            SelectionStatus::Mixed
        } else if s.changes {
            SelectionStatus::Changes
        } else {
            SelectionStatus::Known
        };
    }
    Ok(SourceInstrumentDetails {
        revision: DISCLOSURE_REVISION,
        source_profile: if canonical.is_some() {
            practice_source::CANONICAL_PROFILE
        } else {
            basic_keys::PROFILE
        },
        source_binding,
        original_midi_sha256: score.source.sha256.clone(),
        original_midi_bytes: score.source.bytes,
        original_bytes_verification,
        source_format: p.source_format,
        ppq: p.ppq,
        clock: DisclosureClock::SourcePpqTicksAndBeatsOnly,
        tracks,
        routes,
        channels,
        parts,
        uninterpreted_sound_events,
        instrument_namespace: InstrumentNamespace::Unknown,
    })
}

/// Abstract numeric evidence. Undeclared and ambiguous are distinct: a later
/// program can replace program ambiguity, but cannot resolve a conflicting bank.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
enum Value {
    #[default]
    Undeclared,
    Known(u8),
    Ambiguous,
}
impl Value {
    fn join(self, other: Self) -> Self {
        if self == other {
            self
        } else {
            Self::Ambiguous
        }
    }
    fn known(self) -> Option<u8> {
        if let Self::Known(value) = self {
            Some(value)
        } else {
            None
        }
    }
}
#[derive(Clone, Copy, Debug, Default)]
struct SelectionState {
    program: Value,
    banks: [Value; 2],
}
impl SelectionState {
    fn join(self, other: Self) -> Self {
        Self {
            program: self.program.join(other.program),
            banks: [
                self.banks[0].join(other.banks[0]),
                self.banks[1].join(other.banks[1]),
            ],
        }
    }
    fn ambiguous(self) -> bool {
        self.program == Value::Ambiguous
            || (self.program.known().is_some() && self.banks.contains(&Value::Ambiguous))
    }
    fn numeric(self) -> Option<NumericSelection> {
        if self.ambiguous() {
            return None;
        }
        Some(NumericSelection {
            program: self.program.known()?,
            bank_most_significant: self.banks[0].known(),
            bank_least_significant: self.banks[1].known(),
        })
    }
}
#[derive(Default)]
struct TickTrack {
    all_banks: [Option<Value>; 2],
    final_banks: [Option<Value>; 2],
    all_programs: Option<SelectionState>,
    final_program: Option<SelectionState>,
}
fn bank_change(declaration: SelectionDeclaration) -> Option<(usize, Value)> {
    match declaration {
        SelectionDeclaration::BankMostSignificant { value } => Some((0, Value::Known(value))),
        SelectionDeclaration::BankLeastSignificant { value } => Some((1, Value::Known(value))),
        _ => None,
    }
}

/// The first uncertain system boundary retains every track's exact position at
/// that tick. Same-track earlier attacks are proved earlier; cross-track ties
/// remain unordered. Later system messages cannot move this boundary backward.
struct SystemBoundary {
    tick: u64,
    tracks: BTreeMap<u16, u32>,
}
impl SystemBoundary {
    fn new(events: &[EventPosition]) -> Option<Self> {
        let tick = events.iter().map(|e| e.tick).min()?;
        let mut tracks = BTreeMap::new();
        for event in events.iter().filter(|e| e.tick == tick) {
            tracks
                .entry(event.origin.track)
                .and_modify(|index: &mut u32| *index = (*index).min(event.origin.event))
                .or_insert(event.origin.event);
        }
        Some(Self { tick, tracks })
    }
    fn affects(&self, at: &EventPosition) -> bool {
        self.tick < at.tick
            || (self.tick == at.tick
                && (self.tracks.len() > 1
                    || self.tracks.keys().next() != Some(&at.origin.track)
                    || self
                        .tracks
                        .get(&at.origin.track)
                        .is_some_and(|index| *index < at.origin.event)))
    }
}

fn summarize(
    stream: &[StreamEvent],
    channel: &mut ChannelDetails,
    parts: &mut [PartDetails],
    system_boundary: Option<&SystemBoundary>,
) {
    let mut pending = [Value::Undeclared; 2];
    let mut incoming = SelectionState::default();
    let mut start = 0;
    while start < stream.len() {
        let tick = stream[start].at.tick;
        let end = start + stream[start..].partition_point(|e| e.at.tick == tick);
        let group = &stream[start..end];
        let mut tracks: BTreeMap<u16, TickTrack> = BTreeMap::new();
        for event in group {
            let track = tracks.entry(event.at.origin.track).or_default();
            if let Action::Select(declaration) = event.action {
                channel.selection_timeline.push(SelectionEvent {
                    at: event.at.clone(),
                    declaration,
                });
                if let Some((component, value)) = bank_change(declaration) {
                    track.all_banks[component] =
                        Some(track.all_banks[component].map_or(value, |old| old.join(value)));
                    track.final_banks[component] = Some(value);
                }
            }
        }
        // Foreign events can interleave at this tick; each track's own source
        // prefix remains ordered. Pending bank-only updates do not touch the
        // already latched program. At most 128 tracks are visited per event.
        let mut program_states = BTreeMap::new();
        let track_ids: Vec<_> = tracks.keys().copied().collect();
        for &id in &track_ids {
            let mut foreign_banks = [None; 2];
            for (&other, track) in &tracks {
                if other == id {
                    continue;
                }
                for (component, combined) in foreign_banks.iter_mut().enumerate() {
                    if let Some(value) = track.all_banks[component] {
                        *combined = Some(combined.map_or(value, |old: Value| old.join(value)));
                    }
                }
            }
            let mut local_pending = pending;
            let own = tracks.get_mut(&id).expect("group track");
            for event in group.iter().filter(|e| e.at.origin.track == id) {
                if let Action::Select(declaration) = event.action {
                    if let Some((component, value)) = bank_change(declaration) {
                        local_pending[component] = value;
                        continue;
                    }
                    let program = match declaration {
                        SelectionDeclaration::Program { value } => Value::Known(value),
                        SelectionDeclaration::InvalidProgram { .. } => Value::Ambiguous,
                        _ => unreachable!("bank handled above"),
                    };
                    let mut banks = local_pending;
                    for (component, bank) in banks.iter_mut().enumerate() {
                        if let Some(foreign) = foreign_banks[component] {
                            *bank = bank.join(foreign);
                        }
                    }
                    let state = SelectionState { program, banks };
                    program_states.insert(event.at.origin, state);
                    own.all_programs = Some(own.all_programs.map_or(state, |old| old.join(state)));
                    own.final_program = Some(state);
                }
            }
        }
        let mut ambiguous_tick = false;
        for &id in &track_ids {
            let foreign = tracks
                .iter()
                .filter(|(other, _)| **other != id)
                .filter_map(|(_, t)| t.all_programs)
                .reduce(SelectionState::join);
            let mut local = incoming;
            for event in group.iter().filter(|e| e.at.origin.track == id) {
                if let Some(state) = program_states.get(&event.at.origin) {
                    local = *state;
                }
                if let Action::Attack { part, key } = event.action {
                    let state = foreign.map_or(local, |other| local.join(other));
                    ambiguous_tick |= state.ambiguous();
                    record_attack(
                        &mut parts[part],
                        key,
                        &event.at,
                        state,
                        system_boundary.is_some_and(|boundary| boundary.affects(&event.at)),
                    );
                }
            }
        }
        // Only each track's final write can survive the tick. Overwritten
        // ambiguity does not contaminate future attacks or unrelated bank fields.
        for (component, value) in pending.iter_mut().enumerate() {
            if let Some(final_value) = tracks
                .values()
                .filter_map(|t| t.final_banks[component])
                .reduce(Value::join)
            {
                *value = final_value;
            }
        }
        if let Some(final_program) = tracks
            .values()
            .filter_map(|t| t.final_program)
            .reduce(SelectionState::join)
        {
            incoming = final_program;
        }
        ambiguous_tick |= incoming.ambiguous() || pending.contains(&Value::Ambiguous);
        if ambiguous_tick {
            channel.ambiguous_ticks.push(tick);
        }
        start = end;
    }
}

fn record_attack(
    part: &mut PartDetails,
    key: u8,
    at: &EventPosition,
    state: SelectionState,
    system_uncertain: bool,
) {
    part.source_attack_count += 1;
    let range = part.key_range.get_or_insert(KeyRange {
        lowest: key,
        highest: key,
    });
    range.lowest = range.lowest.min(key);
    range.highest = range.highest.max(key);
    part.first_attack.get_or_insert_with(|| at.clone());
    part.last_attack = Some(at.clone());
    let summary = &mut part.selection_summary;
    if state.ambiguous() || system_uncertain {
        summary.attacks_with_ambiguous_selection += 1;
    } else if let Some(selection) = state.numeric() {
        summary.observed_selections.push(selection);
    } else {
        summary.attacks_without_declared_program += 1;
    }
}

#[cfg(test)]
mod tests;

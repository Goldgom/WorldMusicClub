//! Complete source-event preservation and basic MIDI-key projection, independent
//! of a synthesizer's rendition capabilities. This is a versioned profile of
//! the existing complete-score envelope, not an alternate canonical score.
//!
//! A MIDI key number is not an acoustic pitch. Durations describe explicit key
//! messages, never sustain-pedal, channel-mode, envelope or reverb tails. The
//! canonical Score is the positive-duration projection; every attack, including
//! zero-length and unresolved attacks, remains in `performance.notes`.
use crate::{clean_song::SourceEvidence, midi_events, Beat, Score};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

mod conversion;
mod notation;
pub use notation::{
    notation_page, DisplayMeter, NotationCoverage, NotationMeasure, NotationPage, NotationRequest,
    PageAttack, PageContinuation,
};
#[cfg(test)]
mod notation_tests;
#[cfg(test)]
mod tests;
pub use crate::clean_song::Coordinate;
pub use conversion::convert_midi;

pub const FORMAT: &str = "worldmusichub-complete-score";
pub const PROFILE: &str = "wmh-basic-keys-midi1-v1";
pub const MAX_JSON_BYTES: usize = 16 * 1024 * 1024;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CompleteBasicKeys {
    pub format: String,
    pub version: u32,
    pub source: SourceEvidence,
    pub notation: Score,
    pub performance: Performance,
    pub coverage: Coverage,
    pub capabilities: Capabilities,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Performance {
    pub profile: String,
    pub source_format: u16,
    pub ppq: u16,
    pub end_tick: u64,
    pub tracks: Vec<Track>,
    pub routes: Vec<Route>,
    pub parts: Vec<Part>,
    /// Derived in memory by the core decoder. The compact package omits these
    /// duplicated facts; source event records and the canonical projection are
    /// validated together before reconstructing every attack here.
    #[serde(skip_deserializing, skip_serializing_if = "Vec::is_empty")]
    pub notes: Vec<KeyNote>,
    pub timing: Timing,
}
/// Each record is `[delta_ticks, [status, payload...], true?]`. Status is stored
/// explicitly; an optional trailing true retains its omission in the source
/// running-status encoding, including the declared legacy metadata dialect.
/// Meta messages are `[255, meta_type, data...]`, without the derived length;
/// F0/F7 messages retain every packet byte. Array indexes are original event
/// indexes, including metadata, controls, SysEx and EndOfTrack.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct EventRecord(
    pub u32,
    pub Vec<u8>,
    #[serde(default, skip_serializing_if = "is_false")] pub bool,
);
fn is_false(value: &bool) -> bool {
    !*value
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Track {
    pub id: String,
    pub name: String,
    pub source_index: u16,
    pub end_tick: u64,
    pub events: Vec<EventRecord>,
}
/// Logical routing declarations, not a claim about a physical device mapping.
/// Unnamed tracks share the default logical route. Track-local Port and
/// DeviceName changes take effect at their source-order position. Channel
/// Prefix associates non-channel metadata; it never rewrites channel statuses.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Route {
    pub port: Option<u8>,
    pub device_name_bytes: Option<Vec<u8>>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Part {
    pub id: String,
    pub track_id: String,
    pub channel: u8,
    pub route: usize,
    pub key_semantics: KeySemantics,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum KeySemantics {
    MidiKeyNumber,
    Channel10KeyNumberPercussionUnresolved,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Position {
    pub tick: u64,
    pub beat: Beat,
    pub relative_microseconds: Option<ExactMicroseconds>,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ExactMicroseconds {
    /// Decimal integer string, so JSON/JavaScript never rounds a numerator.
    pub numerator: String,
    pub denominator: u16,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct KeyNote {
    pub note_id: String,
    pub part_id: String,
    pub key: u8,
    pub velocity: u8,
    pub attack: Coordinate,
    pub start: Position,
    pub end: Option<Position>,
    pub release: ReleaseEvidence,
}
/// All possible owners form a contiguous suffix of the releases in the same
/// route/channel/key busy component. The endpoints and count encode this set
/// without quadratically duplicating its coordinates. `end` is filled only
/// when every candidate release has the same tick and no open owner is possible.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ReleaseEvidence {
    pub status: ReleaseStatus,
    pub first: Option<Coordinate>,
    pub last: Option<Coordinate>,
    pub candidate_count: usize,
    pub may_be_unreleased: bool,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ReleaseStatus {
    UniqueRelease,
    EquivalentReleaseTime,
    AmbiguousReleaseTime,
    MissingRelease,
    PossiblyUnreleased,
    UnresolvedRouteOwnership,
    RouteInvariantReleaseTime,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Timing {
    pub event_order: String,
    pub relative_clock_available: bool,
    pub end_relative_microseconds: Option<ExactMicroseconds>,
    pub smf_default_tempo_used: bool,
    pub source_tempo_events: usize,
    pub source_meter_events: usize,
    pub meter: String,
    pub legacy_running_status_events: usize,
    pub invalid_program_events: usize,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Coverage {
    pub source_tracks: usize,
    pub source_events: usize,
    pub represented_events: usize,
    pub key_attacks: usize,
    pub key_releases: usize,
    pub determined_ends: usize,
    pub zero_length_attacks: usize,
    pub unresolved_ends: usize,
    pub unmatched_releases: usize,
    pub notation_notes: usize,
    pub projected_melodic_targets: usize,
    pub unresolved_route_ends: usize,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Capabilities {
    pub source_events: String,
    pub basic_keys: String,
    pub score_projection: String,
    pub source_rendition: String,
    pub acoustic_pitch: String,
}
#[derive(Clone, Debug, Serialize)]
pub struct ConversionError {
    pub code: String,
    pub message: String,
}
impl std::fmt::Display for ConversionError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.message)
    }
}
impl std::error::Error for ConversionError {}
impl From<String> for ConversionError {
    fn from(message: String) -> Self {
        Self {
            code: "invalid_basic_keys".into(),
            message,
        }
    }
}
impl From<midi_events::MidiEventError> for ConversionError {
    fn from(error: midi_events::MidiEventError) -> Self {
        Self {
            code: format!("source_{:?}", error.code).to_lowercase(),
            message: error.message,
        }
    }
}
pub fn source_event_id(source_sha256: &str, origin: Coordinate) -> String {
    format!("midi:{source_sha256}:t{}:e{}", origin.track, origin.event)
}

fn validate_envelope(score: &CompleteBasicKeys) -> Result<(), String> {
    if score.format != FORMAT || score.version != 1 || score.performance.profile != PROFILE {
        return Err("Unsupported basic-key complete-score envelope/profile".into());
    }
    if score.source.format != "midi"
        || score.source.bytes == 0
        || score.source.bytes > midi_events::MAX_SOURCE_BYTES
        || score.source.sha256.len() != 64
        || !score
            .source
            .sha256
            .bytes()
            .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
    {
        return Err("Invalid original-source evidence".into());
    }
    Ok(())
}
/// This profile deliberately does not call the canonical playback compiler:
/// missing/ambiguous tempo, zero-length keys and unknown timbre are represented
/// facts, not reasons to discard determined key notation.
pub fn validate(score: &CompleteBasicKeys) -> Result<(), String> {
    validate_envelope(score)?;
    // Re-derive all claims from the complete compact event sequence. Source
    // hashes remain provenance claims until compared to private originals.
    let timeline = conversion::timeline_from_records(&score.performance)?;
    let expected = conversion::derive(&timeline, score.source.clone(), &score.notation.title)?;
    if wire_bytes(score)? != wire_bytes(&expected)?
        || serde_json::to_vec(&score.performance.notes).map_err(|e| e.to_string())?
            != serde_json::to_vec(&expected.performance.notes).map_err(|e| e.to_string())?
    {
        return Err("Basic-key projection, timing, route, identity or coverage differs from complete source events".into());
    }
    Ok(())
}
pub fn encode_json(score: &CompleteBasicKeys) -> Result<Vec<u8>, String> {
    validate(score)?;
    let encoded = wire_bytes(score)?;
    if encoded.len() > MAX_JSON_BYTES {
        return Err(
            "Complete basic-key score exceeds 16 MiB; no events or notes were trimmed".into(),
        );
    }
    Ok(encoded)
}
pub fn decode_json(bytes: &[u8]) -> Result<CompleteBasicKeys, String> {
    if bytes.len() > MAX_JSON_BYTES {
        return Err("Complete basic-key score exceeds 16 MiB".into());
    }
    let score: CompleteBasicKeys = serde_json::from_slice(bytes).map_err(|e| e.to_string())?;
    validate_envelope(&score)?;
    if !score.performance.notes.is_empty() {
        return Err(
            "Compact basic-key package must derive notes from its complete event records".into(),
        );
    }
    let timeline = conversion::timeline_from_records(&score.performance)?;
    let expected = conversion::derive(&timeline, score.source.clone(), &score.notation.title)?;
    if wire_bytes(&score)? != wire_bytes(&expected)? {
        return Err(
            "Basic-key package projection or coverage differs from complete event records".into(),
        );
    }
    // `expected` was just built from all validated source records, and the
    // exact wire comparison proved every submitted projection/coverage claim.
    // Its source/envelope checks are performed above. Re-validating expected
    // would repeat that identical full parse/derivation without a new input.
    Ok(expected)
}

fn wire_bytes(score: &CompleteBasicKeys) -> Result<Vec<u8>, String> {
    #[derive(Serialize)]
    struct WirePerformance<'a> {
        profile: &'a str,
        source_format: u16,
        ppq: u16,
        end_tick: u64,
        tracks: &'a [Track],
        routes: &'a [Route],
        parts: &'a [Part],
        timing: &'a Timing,
    }
    #[derive(Serialize)]
    struct Wire<'a> {
        format: &'a str,
        version: u32,
        source: &'a SourceEvidence,
        notation: &'a Score,
        performance: WirePerformance<'a>,
        coverage: &'a Coverage,
        capabilities: &'a Capabilities,
    }
    let p = &score.performance;
    serde_json::to_vec(&Wire {
        format: &score.format,
        version: score.version,
        source: &score.source,
        notation: &score.notation,
        performance: WirePerformance {
            profile: &p.profile,
            source_format: p.source_format,
            ppq: p.ppq,
            end_tick: p.end_tick,
            tracks: &p.tracks,
            routes: &p.routes,
            parts: &p.parts,
            timing: &p.timing,
        },
        coverage: &score.coverage,
        capabilities: &score.capabilities,
    })
    .map_err(|e| e.to_string())
}

#[derive(Clone, Debug, Serialize)]
pub struct PartInventory {
    pub id: String,
    pub attacks: usize,
    pub positive: usize,
    pub instantaneous: usize,
    pub unresolved: usize,
    pub percussion: bool,
    pub range: Option<[u8; 2]>,
}
pub fn part_inventory(score: &CompleteBasicKeys) -> Vec<PartInventory> {
    let mut inventory: Vec<_> = score
        .performance
        .parts
        .iter()
        .map(|part| PartInventory {
            id: part.id.clone(),
            attacks: 0,
            positive: 0,
            instantaneous: 0,
            unresolved: 0,
            percussion: part.channel == 9,
            range: None,
        })
        .collect();
    let indexes: BTreeMap<_, _> = score
        .performance
        .parts
        .iter()
        .enumerate()
        .map(|(i, p)| (p.id.as_str(), i))
        .collect();
    for note in &score.performance.notes {
        let part = &mut inventory[indexes[note.part_id.as_str()]];
        part.attacks += 1;
        part.range = Some(part.range.map_or([note.key, note.key], |[low, high]| {
            [low.min(note.key), high.max(note.key)]
        }));
        match &note.end {
            Some(end) if end.tick > note.start.tick => part.positive += 1,
            Some(_) => part.instantaneous += 1,
            None => part.unresolved += 1,
        }
    }
    inventory
}

/// Explicit nominal MIDI-key practice, not source-sound rendition. The complete
/// projection remains inspectable in `Compilation.score`; only positive,
/// determined non-channel-10 keys become timed targets. Zero-length attacks,
/// ambiguous ends and percussion key numbers remain in the complete profile.
/// An unavailable source clock disables timed practice without rejecting data.
pub fn compile_practice(score: &CompleteBasicKeys) -> Result<Option<crate::Compilation>, String> {
    validate(score)?;
    if !score.performance.timing.relative_clock_available {
        return Ok(None);
    }
    let milliseconds = |time: &ExactMicroseconds| -> Result<f64, String> {
        let numerator: u64 = time
            .numerator
            .parse()
            .map_err(|_| "Invalid exact microsecond numerator")?;
        Ok(numerator as f64 / f64::from(time.denominator) / 1000.0)
    };
    let channels: BTreeMap<_, _> = score
        .performance
        .parts
        .iter()
        .map(|part| (part.id.as_str(), part.channel))
        .collect();
    let mut notes = Vec::new();
    for note in &score.performance.notes {
        if channels[note.part_id.as_str()] == 9 {
            continue;
        }
        let Some(end) = &note.end else {
            continue;
        };
        if end.tick == note.start.tick {
            continue;
        }
        let start_ms = milliseconds(
            note.start
                .relative_microseconds
                .as_ref()
                .ok_or("Missing available start clock")?,
        )?;
        let end_ms = milliseconds(
            end.relative_microseconds
                .as_ref()
                .ok_or("Missing available end clock")?,
        )?;
        notes.push(crate::TimedNote {
            velocity: note.velocity,
            id: note.note_id.clone(),
            source_note_id: note.note_id.clone(),
            source_note_ids: vec![note.note_id.clone()],
            part_id: note.part_id.clone(),
            midi: note.key,
            start_ms,
            duration_ms: end_ms - start_ms,
            voice: "1".into(),
            staff: 1,
        });
    }
    let duration_ms = score
        .performance
        .timing
        .end_relative_microseconds
        .as_ref()
        .map(milliseconds)
        .transpose()?
        .unwrap_or(0.0);
    Ok(Some(crate::Compilation {
        score: score.notation.clone(), timeline: crate::Timeline { notes, duration_ms },
        diagnostics: vec![crate::Diagnostic {
            severity: "warning".into(), code: "basic_midi_key_practice".into(),
            message: "Nominal MIDI-key targets use exact source-clock times. This does not identify acoustic pitches, source instruments or sustained sound durations. Zero-length, unresolved and channel-10 attacks remain inspection data.".into(), note_id: None,
        }],
    }))
}

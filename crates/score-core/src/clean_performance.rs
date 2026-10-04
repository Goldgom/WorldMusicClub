//! Independent normalized attacks/releases; no notation or receiver pairing is inferred.
//! Consumers must explicitly dispatch this envelope/profile.
use crate::{Beat, Score};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
mod midi;
mod runtime;
pub use midi::convert_midi;
pub use runtime::{compile_performance, ExactMicroseconds, Runtime, RuntimeEvent};
#[cfg(test)]
mod tests;
pub const FORMAT: &str = "worldmusichub-complete-score";
pub const PROFILE: &str = "wmh-performance-midi1-v1";
pub const MAX_JSON_BYTES: usize = 16 * 1024 * 1024;
pub const MAX_EVENTS: usize = 250_000;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CompletePerformance {
    pub format: String,
    pub version: u32,
    pub id: String,
    pub title: String,
    pub source: crate::clean_song::SourceEvidence,
    pub notation: Option<Score>,
    pub performance: Performance,
    pub coverage: Coverage,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Coverage {
    pub performance: PerformanceCoverage,
    pub notation: UnavailableCoverage,
    pub targets: UnavailableCoverage,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PerformanceCoverage {
    pub status: Complete,
    pub source_tracks: usize,
    pub source_events: usize,
    pub represented_events: usize,
    pub key_attacks: usize,
    pub key_releases: usize,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Complete {
    Complete,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Unavailable {
    Unavailable,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct UnavailableCoverage {
    pub status: Unavailable,
    pub represented_attacks: usize,
    pub reason: UnavailableReason,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum UnavailableReason {
    NotDerivedFromIndependentEvents,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Performance {
    pub profile: String,
    pub end: Beat,
    pub tracks: Vec<Track>,
    pub parts: Vec<Part>,
    pub events: Vec<Event>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Track {
    pub id: String,
    pub name: String,
    pub source_index: u16,
    pub source_event_count: u32,
    pub end: Beat,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Part {
    pub id: String,
    pub track_id: String,
    pub channel: u8,
    pub sound_identity: SoundIdentity,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SoundIdentity {
    UnspecifiedMidiRoute,
}
pub use crate::clean_song::{
    BankComponent, Coordinate, InitialPitchBendSensitivity12Step, KeyMode, TextRole,
};
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Event {
    pub event_id: String,
    pub at: Beat,
    pub origin: Coordinate,
    pub command: Command,
}
/// Closed musical meanings, deliberately without raw/unknown/controller cases.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum Command {
    KeyAttack {
        part_id: String,
        channel: u8,
        key: u8,
        velocity: u8,
    },
    KeyRelease {
        part_id: String,
        channel: u8,
        key: u8,
        velocity: u8,
    },
    InstrumentProgram {
        channel: u8,
        program: u8,
    },
    BankSelect {
        channel: u8,
        component: BankComponent,
        value: u8,
    },
    Volume {
        channel: u8,
        value: u8,
    },
    Pan {
        channel: u8,
        value: u8,
    },
    Expression {
        channel: u8,
        value: u8,
    },
    /// Original CC64 value, including values on either side of the pedal threshold.
    Sustain {
        channel: u8,
        value: u8,
    },
    /// CC121=0 only in validated initial setup, followed by explicit sustain-off.
    /// This is not a general-purpose reset command during a performance.
    InitialControllerReset {
        channel: u8,
    },
    ReverbSend {
        channel: u8,
        value: u8,
    },
    ChorusSend {
        channel: u8,
        value: u8,
    },
    KeyPressure {
        channel: u8,
        key: u8,
        pressure: u8,
    },
    ChannelPressure {
        channel: u8,
        pressure: u8,
    },
    /// Original unsigned 14-bit displacement; 8192 is center. This does not
    /// identify a source instrument's range or derive a notated/key pitch.
    PitchBend {
        channel: u8,
        value: u16,
    },
    /// Reviewed pre-key-activity RPN 0 setup, retaining each authored named step.
    InitialPitchBendSensitivity12 {
        channel: u8,
        step: InitialPitchBendSensitivity12Step,
    },
    Tempo {
        microseconds_per_quarter: u32,
    },
    Meter {
        numerator: u8,
        denominator: u16,
        clocks_per_click: u8,
        thirty_seconds_per_quarter: u8,
    },
    KeySignature {
        fifths: i8,
        mode: KeyMode,
    },
    Text {
        role: TextRole,
        text: String,
    },
    SmpteOffset {
        timecode: crate::midi_timecode::Timecode,
    },
    SequenceNumber {
        number: Option<u16>,
    },
    TrackEnd,
}
impl Command {
    pub fn channel(&self) -> Option<u8> {
        match self {
            Self::KeyAttack { channel, .. }
            | Self::KeyRelease { channel, .. }
            | Self::InstrumentProgram { channel, .. }
            | Self::BankSelect { channel, .. }
            | Self::Volume { channel, .. }
            | Self::Pan { channel, .. }
            | Self::Expression { channel, .. }
            | Self::Sustain { channel, .. }
            | Self::InitialControllerReset { channel }
            | Self::ReverbSend { channel, .. }
            | Self::ChorusSend { channel, .. }
            | Self::KeyPressure { channel, .. }
            | Self::ChannelPressure { channel, .. }
            | Self::PitchBend { channel, .. }
            | Self::InitialPitchBendSensitivity12 { channel, .. } => Some(*channel),
            _ => None,
        }
    }
    fn validate(&self) -> Result<(), String> {
        if self.channel().is_some_and(|c| c > 15) {
            return Err("Invalid performance channel".into());
        }
        let valid = match self {
            Self::KeyAttack { key, velocity, .. } => *key <= 127 && (1..=127).contains(velocity),
            Self::KeyRelease { key, velocity, .. } => *key <= 127 && *velocity <= 127,
            Self::InstrumentProgram { program, .. } => *program <= 127,
            Self::BankSelect { value, .. }
            | Self::Volume { value, .. }
            | Self::Pan { value, .. }
            | Self::Expression { value, .. }
            | Self::Sustain { value, .. }
            | Self::ReverbSend { value, .. }
            | Self::ChorusSend { value, .. } => *value <= 127,
            Self::KeyPressure { key, pressure, .. } => *key <= 127 && *pressure <= 127,
            Self::ChannelPressure { pressure, .. } => *pressure <= 127,
            Self::PitchBend { value, .. } => *value <= 16383,
            Self::Tempo {
                microseconds_per_quarter,
            } => (1..=0xff_ffff).contains(microseconds_per_quarter),
            Self::Meter {
                numerator,
                denominator,
                thirty_seconds_per_quarter,
                ..
            } => *numerator > 0 && denominator.is_power_of_two() && *thirty_seconds_per_quarter > 0,
            Self::KeySignature { fifths, .. } => (-7..=7).contains(fifths),
            Self::SmpteOffset { timecode } => timecode.validate_zero().is_ok(),
            Self::Text {
                role: TextRole::DeviceName,
                text,
            } => crate::midi_device_route::valid_structural_text(text),
            Self::Text { text, .. } => valid_text(text, 4096),
            Self::InitialControllerReset { .. }
            | Self::InitialPitchBendSensitivity12 { .. }
            | Self::SequenceNumber { .. }
            | Self::TrackEnd => true,
        };
        valid
            .then_some(())
            .ok_or_else(|| "Invalid or unsupported typed performance command".into())
    }
}
fn valid_text(text: &str, limit: usize) -> bool {
    text.len() <= limit
        && !text
            .chars()
            .any(|c| c.is_control() && !matches!(c, '\n' | '\r' | '\t'))
        && !text
            .lines()
            .any(|line| line.trim_start().starts_with("DM:"))
        && !text
            .split(|c: char| !c.is_ascii_alphanumeric() && !matches!(c, '+' | '/' | '='))
            .any(|word| word.len() > 256)
}
fn nonnegative(beat: Beat) -> bool {
    beat.valid() && beat.numerator >= 0
}
fn event_id(hash: &str, origin: Coordinate) -> String {
    format!("midi:{hash}:t{}:e{}", origin.track, origin.event)
}
fn part_id(track: u16, channel: u8) -> String {
    format!("midi-t{}-c{}", track + 1, channel + 1)
}
fn calculated_coverage(performance: &Performance) -> Coverage {
    let unavailable = UnavailableCoverage {
        status: Unavailable::Unavailable,
        represented_attacks: 0,
        reason: UnavailableReason::NotDerivedFromIndependentEvents,
    };
    Coverage {
        performance: PerformanceCoverage {
            status: Complete::Complete,
            source_tracks: performance.tracks.len(),
            source_events: performance
                .tracks
                .iter()
                .map(|t| t.source_event_count as usize)
                .sum(),
            represented_events: performance.events.len(),
            key_attacks: performance
                .events
                .iter()
                .filter(|e| matches!(e.command, Command::KeyAttack { .. }))
                .count(),
            key_releases: performance
                .events
                .iter()
                .filter(|e| matches!(e.command, Command::KeyRelease { .. }))
                .count(),
        },
        notation: unavailable.clone(),
        targets: unavailable,
    }
}
/// Structural and semantic completeness, never authentication of an external source hash.
pub fn validate(score: &CompletePerformance) -> Result<(), String> {
    if score.format != FORMAT || score.version != 2 || score.performance.profile != PROFILE {
        return Err("Unsupported complete-performance version or profile".into());
    }
    if score.id.is_empty()
        || score.id.len() > 200
        || !score
            .id
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || b"-_".contains(&c))
        || score.title.is_empty()
        || !valid_text(&score.title, 1024)
    {
        return Err("Invalid complete-performance identity".into());
    }
    let source = &score.source;
    if source.format != "midi"
        || source.bytes == 0
        || source.bytes > crate::midi_events::MAX_SOURCE_BYTES
        || source.sha256.len() != 64
        || !source
            .sha256
            .bytes()
            .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
    {
        return Err("Invalid private source evidence".into());
    }
    if score.notation.is_some() {
        return Err(
            "This bounded profile has no proved notation mapping; notation must be null".into(),
        );
    }
    let p = &score.performance;
    if p.tracks.is_empty()
        || p.tracks.len() > 128
        || p.parts.len() > 128 * 16
        || p.events.len() > MAX_EVENTS
        || !nonnegative(p.end)
    {
        return Err("Invalid performance bounds".into());
    }
    let mut expected = 0usize;
    let mut max_end = Beat::ZERO;
    for (index, track) in p.tracks.iter().enumerate() {
        if track.source_index as usize != index
            || track.id != format!("track-{}", index + 1)
            || !valid_text(&track.name, 1024)
            || track.source_event_count == 0
            || !nonnegative(track.end)
            || track.end.compare(p.end).is_gt()
        {
            return Err("Invalid source track identity or extent".into());
        }
        expected += track.source_event_count as usize;
        if expected > MAX_EVENTS {
            return Err("Performance event limit exceeded".into());
        }
        if track.end.compare(max_end).is_gt() {
            max_end = track.end;
        }
    }
    if expected != p.events.len() || !max_end.equivalent(p.end) {
        return Err("Incomplete source extent or event coverage".into());
    }
    let mut parts = BTreeSet::new();
    let mut channel_track_counts = [0usize; 16];
    for part in &p.parts {
        let track = p
            .tracks
            .iter()
            .find(|t| t.id == part.track_id)
            .ok_or("Unknown part track")?;
        if part.channel > 15
            || part.id != part_id(track.source_index, part.channel)
            || !parts.insert((track.source_index, part.channel))
        {
            return Err("Invalid or duplicate source part".into());
        }
        channel_track_counts[part.channel as usize] += 1;
    }
    let mut used_parts = BTreeSet::new();
    let mut counts = vec![0u32; p.tracks.len()];
    let mut ended = BTreeSet::new();
    let mut prior: Option<&Event> = None;
    let mut initial_sensitivity = [crate::midi_initial_sensitivity::State::twelve(); 16];
    let mut channel_last = BTreeMap::<u8, &Event>::new();
    let mut channel_key_activity = BTreeSet::new();
    let mut pending_initial_resets = BTreeMap::<u8, &Event>::new();
    let mut offset_placement = crate::midi_timecode::Placement::default();
    let mut tempo_first: Option<(&Event, u32)> = None;
    let mut tempo_tracks_differ = false;
    let mut tempo_values_differ = false;
    for event in &p.events {
        let track = p
            .tracks
            .get(event.origin.track as usize)
            .ok_or("Unknown event track")?;
        let count = &mut counts[event.origin.track as usize];
        if event.origin.event != *count
            || ended.contains(&event.origin.track)
            || event.event_id != event_id(&source.sha256, event.origin)
            || !nonnegative(event.at)
            || event.at.compare(track.end).is_gt()
        {
            return Err("Invalid, duplicate or missing source coordinate".into());
        }
        *count += 1;
        if prior.is_some_and(|last| {
            last.at.compare(event.at).is_gt()
                || (last.at.equivalent(event.at) && last.origin >= event.origin)
        }) {
            return Err("Performance event order changed".into());
        }
        prior = Some(event);
        event.command.validate()?;
        if let Command::SmpteOffset { timecode } = &event.command {
            offset_placement.offset(timecode, event.origin.track, event.at)?;
        } else if event.command.channel().is_some() {
            offset_placement.channel(event.origin.track);
        }
        if let Some(channel) = event.command.channel() {
            if matches!(event.command, Command::PitchBend { .. })
                && channel_track_counts[channel as usize] != 1
            {
                return Err("Pitch bend requires one owning source track for its channel".into());
            }
            if !parts.contains(&(event.origin.track, channel)) {
                return Err("Missing channel part".into());
            }
            used_parts.insert((event.origin.track, channel));
            use crate::midi_initial_sensitivity::Prefix;
            let step = match event.command {
                Command::InitialPitchBendSensitivity12 { step, .. } => Some(step.controller()),
                _ => None,
            };
            let prefix = match event.command {
                Command::InstrumentProgram { .. } => Prefix::Program,
                Command::InitialControllerReset { .. } => Prefix::Reset,
                Command::BankSelect { .. }
                | Command::Volume { .. }
                | Command::Pan { .. }
                | Command::Expression { .. }
                | Command::ReverbSend { .. }
                | Command::ChorusSend { .. } => Prefix::Control,
                _ => Prefix::Other,
            };
            initial_sensitivity[channel as usize].observe(
                event.origin.track,
                event.origin.event,
                event.at,
                step,
                prefix,
            )?;

            if let Some(reset) = pending_initial_resets.remove(&channel) {
                if !matches!(event.command, Command::Sustain { value: 0, .. })
                    || !event.at.equivalent(Beat::ZERO)
                    || event.origin.track != reset.origin.track
                {
                    return Err(
                        "Initial controller reset must be immediately followed on its channel by same-track sustain value 0 at beat 0"
                            .into(),
                    );
                }
            }
            if matches!(event.command, Command::InitialControllerReset { .. }) {
                if !event.at.equivalent(Beat::ZERO)
                    || channel_key_activity.contains(&channel)
                    || channel_track_counts[channel as usize] != 1
                {
                    return Err(
                        "Initial controller reset requires beat 0, no prior key activity and one source track for the entire channel"
                            .into(),
                    );
                }
                pending_initial_resets.insert(channel, event);
            }
            if matches!(
                event.command,
                Command::KeyAttack { .. }
                    | Command::KeyRelease { .. }
                    | Command::KeyPressure { .. }
            ) {
                channel_key_activity.insert(channel);
            }
            if channel_last.insert(channel, event).is_some_and(|last| {
                last.at.equivalent(event.at) && last.origin.track != event.origin.track
            }) {
                return Err("Simultaneous cross-track channel order requires review".into());
            }
        }
        match &event.command {
            Command::KeyAttack {
                part_id: id,
                channel,
                ..
            }
            | Command::KeyRelease {
                part_id: id,
                channel,
                ..
            } => {
                if *id != part_id(event.origin.track, *channel) {
                    return Err("Key event has inconsistent source part".into());
                }
            }
            Command::Tempo {
                microseconds_per_quarter,
            } => {
                if tempo_first.is_none_or(|(first, _)| !first.at.equivalent(event.at)) {
                    tempo_first = Some((event, *microseconds_per_quarter));
                    tempo_tracks_differ = false;
                    tempo_values_differ = false;
                } else if let Some((first, value)) = tempo_first {
                    tempo_tracks_differ |= first.origin.track != event.origin.track;
                    tempo_values_differ |= value != *microseconds_per_quarter;
                    if tempo_tracks_differ && tempo_values_differ {
                        return Err("Ambiguous cross-track tempo".into());
                    }
                }
            }
            Command::TrackEnd => {
                if *count != track.source_event_count || !event.at.equivalent(track.end) {
                    return Err("Track end must be its final source event".into());
                }
                ended.insert(event.origin.track);
            }
            _ => (),
        }
    }
    for state in &initial_sensitivity {
        state.finish()?;
    }
    if !pending_initial_resets.is_empty() {
        return Err("Initial controller reset is missing its explicit initial sustain-off".into());
    }
    if ended.len() != p.tracks.len()
        || used_parts != parts
        || counts
            .iter()
            .zip(&p.tracks)
            .any(|(n, t)| *n != t.source_event_count)
    {
        return Err("Incomplete source tracks or parts".into());
    }
    if score.coverage != calculated_coverage(p) {
        return Err("Coverage disagrees with the validated complete performance".into());
    }
    runtime::validate_clock(score)?;
    Ok(())
}
/// Receiver routing capability for structurally valid complete events. An error
/// preserves the typed data but prohibits the current single-output reference.
/// Callers must not turn unresolved logical devices into a default output.
pub fn resolve_device_route(score: &CompletePerformance) -> Result<Option<String>, String> {
    validate(score)?;
    let mut evidence = crate::midi_device_route::Evidence::default();
    for event in &score.performance.events {
        if let Some(channel) = event.command.channel() {
            evidence.channel(event.origin, channel);
        }
        match &event.command {
            Command::Text {
                role: TextRole::DeviceName,
                text,
            } => evidence.device_name(event.origin, event.at, text),
            Command::Text {
                role: TextRole::ProgramName,
                ..
            } => evidence.program_name(event.origin),
            _ => (),
        }
    }
    evidence.resolve()
}

pub fn encode_json(score: &CompletePerformance) -> Result<Vec<u8>, String> {
    validate(score)?;
    let bytes = serde_json::to_vec(score).map_err(|e| e.to_string())?;
    if bytes.len() > MAX_JSON_BYTES {
        return Err("Complete performance JSON exceeds size bound".into());
    }
    Ok(bytes)
}
pub fn decode_json(bytes: &[u8]) -> Result<CompletePerformance, String> {
    if bytes.len() > MAX_JSON_BYTES {
        return Err("Complete performance JSON exceeds size bound".into());
    }
    let score = serde_json::from_slice(bytes)
        .map_err(|e| format!("Invalid typed performance JSON: {e}"))?;
    validate(&score)?;
    Ok(score)
}

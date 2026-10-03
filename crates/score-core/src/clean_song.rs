//! A validated semantic song sequence plus the existing canonical notation view.
//! Original input bytes belong in private audit storage, never this format.
use crate::{Beat, Score};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

mod midi;
mod runtime;
pub use midi::convert_midi;
pub use runtime::{compile_complete, ExactMicroseconds, Runtime, RuntimeEvent, RuntimeNote};
#[cfg(test)]
mod tests;

pub const FORMAT: &str = "worldmusichub-complete-score";
pub const PROFILE: &str = "wmh-semantic-midi1-v1";
pub const MAX_EVENTS: usize = 250_000;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SourceEvidence {
    pub format: String,
    pub bytes: usize,
    pub sha256: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CompleteScore {
    pub format: String,
    pub version: u32,
    pub source: SourceEvidence,
    pub notation: Score,
    pub performance: Performance,
    pub coverage: Coverage,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Coverage {
    pub status: String,
    pub notation: String,
    pub source_tracks: usize,
    pub source_events: usize,
    pub represented_events: usize,
    pub pitched_notes: usize,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Performance {
    pub profile: String,
    pub end: Beat,
    pub tracks: Vec<Track>,
    pub parts: Vec<Part>,
    pub notes: Vec<PerformanceNote>,
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
    pub notation_origin: String,
    pub target: String,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Coordinate {
    pub track: u16,
    pub event: u32,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PerformanceNote {
    pub note_id: String,
    pub part_id: String,
    pub attack: Coordinate,
    pub release: Coordinate,
    pub release_velocity: u8,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Event {
    pub at: Beat,
    pub origin: Coordinate,
    pub command: Command,
}
/// Closed musical meanings. Never add a generic byte/data/unknown-message case.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum Command {
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
    InitialControllerReset {
        channel: u8,
    },
    InitialSustainOff {
        channel: u8,
    },
    /// One of six retained steps of the reviewed zero-time RPN 0 setup.
    /// This does not admit arbitrary parameter selectors or data-entry values.
    InitialPitchBendSensitivity {
        channel: u8,
        step: InitialPitchBendSensitivityStep,
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
    SequenceNumber {
        number: Option<u16>,
    },
    TrackEnd,
}
#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BankComponent {
    MostSignificant,
    LeastSignificant,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum InitialPitchBendSensitivityStep {
    SelectMostSignificantZero,
    SelectLeastSignificantZero,
    SetSemitones24,
    SetCentsZero,
    DeselectMostSignificant,
    DeselectLeastSignificant,
}
impl InitialPitchBendSensitivityStep {
    const ORDER: [Self; 6] = [
        Self::SelectMostSignificantZero,
        Self::SelectLeastSignificantZero,
        Self::SetSemitones24,
        Self::SetCentsZero,
        Self::DeselectMostSignificant,
        Self::DeselectLeastSignificant,
    ];
}
#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum KeyMode {
    Major,
    Minor,
}
#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TextRole {
    Text,
    Copyright,
    TrackName,
    InstrumentName,
    Lyric,
    Marker,
    Cue,
    ProgramName,
    DeviceName,
}
impl Command {
    pub fn channel(&self) -> Option<u8> {
        match self {
            Self::InstrumentProgram { channel, .. }
            | Self::BankSelect { channel, .. }
            | Self::Volume { channel, .. }
            | Self::Pan { channel, .. }
            | Self::Expression { channel, .. }
            | Self::ReverbSend { channel, .. }
            | Self::ChorusSend { channel, .. }
            | Self::KeyPressure { channel, .. }
            | Self::ChannelPressure { channel, .. }
            | Self::InitialControllerReset { channel }
            | Self::InitialSustainOff { channel }
            | Self::InitialPitchBendSensitivity { channel, .. } => Some(*channel),
            _ => None,
        }
    }
    fn validate(&self, at: Beat) -> Result<(), String> {
        if self.channel().is_some_and(|c| c > 15) {
            return Err("Invalid performance channel".into());
        }
        let values: &[u8] = match self {
            Self::InstrumentProgram { program, .. } => std::slice::from_ref(program),
            Self::BankSelect { value, .. }
            | Self::Volume { value, .. }
            | Self::Pan { value, .. }
            | Self::Expression { value, .. }
            | Self::ReverbSend { value, .. }
            | Self::ChorusSend { value, .. } => std::slice::from_ref(value),
            Self::KeyPressure { key, pressure, .. } => {
                if *key > 127 {
                    return Err("Invalid pressure key".into());
                }
                std::slice::from_ref(pressure)
            }
            Self::ChannelPressure { pressure, .. } => std::slice::from_ref(pressure),
            Self::Tempo {
                microseconds_per_quarter,
            } => {
                if !(100_000..=6_000_000).contains(microseconds_per_quarter) {
                    return Err("Unsupported performance tempo".into());
                }
                &[]
            }
            Self::Meter {
                numerator,
                denominator,
                thirty_seconds_per_quarter,
                ..
            } => {
                if *numerator == 0
                    || !denominator.is_power_of_two()
                    || *thirty_seconds_per_quarter != 8
                {
                    return Err("Unsupported performance meter".into());
                }
                &[]
            }
            Self::KeySignature { fifths, .. } => {
                if !(-7..=7).contains(fifths) {
                    return Err("Invalid performance key".into());
                }
                &[]
            }
            Self::Text { text, .. } => {
                if text.len() > 4096
                    || text
                        .lines()
                        .any(|line| line.trim_start().starts_with("DM:"))
                    || text
                        .split(|c: char| {
                            !c.is_ascii_alphanumeric() && !matches!(c, '+' | '/' | '=')
                        })
                        .any(|word| word.len() > 256)
                    || text
                        .chars()
                        .any(|c| c.is_control() && !matches!(c, '\n' | '\r' | '\t'))
                {
                    return Err("Unsupported textual cue encoding or size".into());
                }
                &[]
            }
            Self::InitialControllerReset { .. }
            | Self::InitialSustainOff { .. }
            | Self::InitialPitchBendSensitivity { .. } => {
                if !at.equivalent(Beat::ZERO) {
                    return Err("Controller initialization must be at zero".into());
                }
                &[]
            }
            _ => &[],
        };
        if values.iter().any(|v| *v > 127) {
            return Err("Invalid seven-bit musical value".into());
        }
        Ok(())
    }
}
fn nonnegative(beat: Beat) -> bool {
    beat.valid() && beat.numerator >= 0
}
fn hash_valid(hash: &str) -> bool {
    hash.len() == 64
        && hash
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

/// Validates semantic coverage and reuses the canonical engine for every note.
/// An imported hash is an attribution claim; only conversion sees original bytes.
pub fn validate(score: &CompleteScore) -> Result<(), String> {
    if score.format != FORMAT || score.version != 1 || score.performance.profile != PROFILE {
        return Err("Unsupported complete-score version or semantic profile".into());
    }
    if score.source.format != "midi"
        || score.source.bytes == 0
        || score.source.bytes > crate::midi_events::MAX_SOURCE_BYTES
        || !hash_valid(&score.source.sha256)
    {
        return Err("Invalid private-source evidence".into());
    }
    if score.notation.source.is_some() {
        return Err("Clean scores must not embed original source content".into());
    }
    crate::compile(score.notation.clone())?;
    if !score.notation.repeats.is_empty() {
        return Err(
            "This performance profile uses an unfolded sequence, not notation repeats".into(),
        );
    }
    let performance = &score.performance;
    if performance.tracks.is_empty()
        || performance.tracks.len() > 128
        || performance.parts.len() != score.notation.parts.len()
        || performance.notes.len() > 100_000
        || performance.events.len() > MAX_EVENTS
        || !nonnegative(performance.end)
    {
        return Err("Invalid performance structure or bounds".into());
    }
    let mut track_ids = BTreeSet::new();
    let mut expected_events = 0usize;
    for (index, track) in performance.tracks.iter().enumerate() {
        if track.source_index as usize != index
            || track.id != format!("track-{}", index + 1)
            || !track_ids.insert(&track.id)
            || track.name.len() > 1024
            || track.source_event_count == 0
            || !nonnegative(track.end)
            || track.end.compare(performance.end).is_gt()
        {
            return Err("Invalid performance track identity or extent".into());
        }
        expected_events += track.source_event_count as usize;
        if expected_events > MAX_EVENTS {
            return Err("Performance event limit exceeded".into());
        }
    }
    let mut notes = BTreeMap::new();
    let canonical_parts: BTreeMap<_, _> = score
        .notation
        .parts
        .iter()
        .map(|p| (p.id.as_str(), p))
        .collect();
    let mut parts = BTreeMap::new();
    for part in &performance.parts {
        if !canonical_parts.contains_key(part.id.as_str())
            || !track_ids.contains(&part.track_id)
            || part.channel > 15
            || part.channel == 9
            || part.id
                != format!(
                    "midi-t{}-c{}",
                    performance
                        .tracks
                        .iter()
                        .find(|t| t.id == part.track_id)
                        .map_or(0, |t| t.source_index + 1),
                    part.channel + 1
                )
            || part.notation_origin != "inferred"
            || part.target != "key_release"
            || parts.insert(part.id.as_str(), part).is_some()
        {
            return Err("Invalid performance part or target".into());
        }
        for note in &canonical_parts[part.id.as_str()].notes {
            if note.pitch.is_none()
                || note.tie_start
                || note.tie_stop
                || notes.insert(note.id.as_str(), (part, note)).is_some()
            {
                return Err(
                    "This profile requires uniquely identified, untied pitched key-release notes"
                        .into(),
                );
            }
        }
    }
    let mut coordinates = BTreeMap::<Coordinate, (Beat, Option<u8>)>::new();
    let mut add = |origin: Coordinate, at: Beat, channel: Option<u8>| -> Result<(), String> {
        let track = performance
            .tracks
            .get(origin.track as usize)
            .ok_or("Unknown origin track")?;
        if origin.event >= track.source_event_count
            || !nonnegative(at)
            || at.compare(track.end).is_gt()
            || coordinates.insert(origin, (at, channel)).is_some()
        {
            return Err("Duplicate, out-of-bounds or invalid source event coverage".into());
        }
        Ok(())
    };
    let mut used_notes = BTreeSet::new();
    for note in &performance.notes {
        let (part, canonical) = notes
            .get(note.note_id.as_str())
            .ok_or("Performance refers to an unknown note")?;
        if note.part_id != part.id
            || !used_notes.insert(&note.note_id)
            || note.release_velocity > 127
            || note.release.track != note.attack.track
            || performance
                .tracks
                .get(note.attack.track as usize)
                .is_none_or(|t| t.id != part.track_id)
            || note.note_id
                != format!(
                    "midi-t{}-c{}-e{}",
                    note.attack.track + 1,
                    part.channel + 1,
                    note.attack.event + 1
                )
        {
            return Err("Inconsistent performance-note identity".into());
        }
        let end = canonical
            .at
            .checked_add(canonical.duration)
            .ok_or("Note duration overflow")?;
        add(note.attack, canonical.at, Some(part.channel))?;
        add(note.release, end, Some(part.channel))?;
    }
    if used_notes.len() != notes.len() {
        return Err("A canonical note is missing from the full performance".into());
    }
    let mut ended = BTreeSet::new();
    let mut prior_event: Option<&Event> = None;
    let mut initial_state = BTreeMap::<u8, (Coordinate, u8)>::new();
    for event in &performance.events {
        event.command.validate(event.at)?;
        if prior_event.is_some_and(|p| {
            p.at.compare(event.at).is_gt()
                || (p.at.equivalent(event.at) && p.origin >= event.origin)
        }) {
            return Err("Semantic events must preserve beat/track/event order".into());
        }
        prior_event = Some(event);
        add(event.origin, event.at, event.command.channel())?;
        if matches!(event.command, Command::TrackEnd) {
            let track = &performance.tracks[event.origin.track as usize];
            if event.origin.event + 1 != track.source_event_count
                || !event.at.equivalent(track.end)
                || !ended.insert(event.origin.track)
            {
                return Err("Track must end at its final original event".into());
            }
        }
        match event.command {
            Command::InitialControllerReset { channel } => {
                if initial_state.insert(channel, (event.origin, 1)).is_some() {
                    return Err("Repeated initial controller reset".into());
                }
            }
            Command::InitialSustainOff { channel } => {
                let state = initial_state
                    .get_mut(&channel)
                    .ok_or("Sustain initialization lacks reset")?;
                if state.1 != 1 || state.0.track != event.origin.track {
                    return Err("Ambiguous initial control ordering".into());
                }
                state.1 = 2;
            }
            _ => (),
        }
    }
    if initial_state.values().any(|(_, state)| *state != 2) {
        return Err("Incomplete initial controller state".into());
    }
    if ended.len() != performance.tracks.len() || coordinates.len() != expected_events {
        return Err("Missing source tracks or event coverage".into());
    }
    let mut max_end = Beat::ZERO;
    for track in &performance.tracks {
        let mut prior = Beat::ZERO;
        for event in 0..track.source_event_count {
            let (at, _) = coordinates
                .get(&Coordinate {
                    track: track.source_index,
                    event,
                })
                .ok_or("Missing original event coordinate")?;
            if prior.compare(*at).is_gt() {
                return Err("Original within-track order changed".into());
            }
            prior = *at;
        }
        if track.end.compare(max_end).is_gt() {
            max_end = track.end;
        }
    }
    if !max_end.equivalent(performance.end) {
        return Err("Incorrect full-sequence extent".into());
    }
    validate_clocks(score)?;
    validate_channel_order(score, &coordinates)?;
    let coverage = &score.coverage;
    if coverage.status != "complete"
        || coverage.notation != "inferred"
        || coverage.source_tracks != performance.tracks.len()
        || coverage.source_events != expected_events
        || coverage.represented_events != coordinates.len()
        || coverage.pitched_notes != notes.len()
    {
        return Err("Coverage claims disagree with validated sequence".into());
    }
    Ok(())
}

fn validate_clocks(score: &CompleteScore) -> Result<(), String> {
    let mut tempos: Vec<(Beat, u32)> = Vec::new();
    let mut meters: Vec<(Beat, u16, u16)> = Vec::new();
    let mut keys: Vec<(Beat, i8, &str)> = Vec::new();
    for event in &score.performance.events {
        match event.command {
            Command::Tempo {
                microseconds_per_quarter: value,
            } => {
                if let Some(previous) = tempos.last().filter(|p| p.0.equivalent(event.at)) {
                    if previous.1 != value {
                        return Err("Ambiguous simultaneous tempos".into());
                    }
                } else {
                    tempos.push((event.at, value));
                }
            }
            Command::Meter {
                numerator,
                denominator,
                ..
            } => {
                if let Some(previous) = meters.last().filter(|p| p.0.equivalent(event.at)) {
                    if (previous.1, previous.2) != (numerator as u16, denominator) {
                        return Err("Ambiguous simultaneous meters".into());
                    }
                } else {
                    meters.push((event.at, numerator as u16, denominator));
                }
            }
            Command::KeySignature { fifths, mode } => {
                let mode = match mode {
                    KeyMode::Major => "major",
                    KeyMode::Minor => "minor",
                };
                if let Some(previous) = keys.last().filter(|p| p.0.equivalent(event.at)) {
                    if (previous.1, previous.2) != (fifths, mode) {
                        return Err("Ambiguous simultaneous keys".into());
                    }
                } else {
                    keys.push((event.at, fifths, mode));
                }
            }
            _ => (),
        }
    }
    if tempos.first().is_none_or(|p| !p.0.equivalent(Beat::ZERO)) {
        tempos.insert(0, (Beat::ZERO, 500_000));
    }
    if meters.first().is_none_or(|p| !p.0.equivalent(Beat::ZERO)) {
        meters.insert(0, (Beat::ZERO, 4, 4));
    }
    if tempos.len() != score.notation.tempo.len()
        || tempos
            .iter()
            .zip(&score.notation.tempo)
            .any(|((at, value), t)| !at.equivalent(t.at) || t.bpm != 60_000_000.0 / *value as f64)
    {
        return Err("Canonical tempo disagrees with the exact performance clock".into());
    }
    if meters.len() != score.notation.meters.len()
        || meters
            .iter()
            .zip(&score.notation.meters)
            .any(|((at, n, d), m)| !at.equivalent(m.at) || *n != m.numerator || *d != m.denominator)
    {
        return Err("Canonical meter disagrees with performance metadata".into());
    }
    if keys.len() != score.notation.keys.len()
        || keys
            .iter()
            .zip(&score.notation.keys)
            .any(|((at, fifths, mode), k)| {
                !at.equivalent(k.at) || *fifths != k.fifths || *mode != k.mode
            })
    {
        return Err("Canonical key disagrees with performance metadata".into());
    }
    Ok(())
}
fn validate_channel_order(
    score: &CompleteScore,
    coordinates: &BTreeMap<Coordinate, (Beat, Option<u8>)>,
) -> Result<(), String> {
    let mut ordered: Vec<_> = coordinates
        .iter()
        .filter_map(|(origin, (at, channel))| channel.map(|c| (*at, c, *origin)))
        .collect();
    ordered.sort_by(|a, b| a.0.compare(b.0).then(a.1.cmp(&b.1)).then(a.2.cmp(&b.2)));
    for pair in ordered.windows(2) {
        if pair[0].0.equivalent(pair[1].0)
            && pair[0].1 == pair[1].1
            && pair[0].2.track != pair[1].2.track
        {
            return Err("Ambiguous same-channel cross-track ordering".into());
        }
    }
    let mut intervals: BTreeMap<(u8, u8), Vec<(&crate::Note, &Part)>> = BTreeMap::new();
    for part in &score.performance.parts {
        let canonical = score
            .notation
            .parts
            .iter()
            .find(|p| p.id == part.id)
            .ok_or("Unknown part")?;
        for note in &canonical.notes {
            intervals
                .entry((
                    part.channel,
                    note.pitch
                        .as_ref()
                        .and_then(|p| p.midi())
                        .ok_or("Missing note pitch")?,
                ))
                .or_default()
                .push((note, part));
        }
    }
    for notes in intervals.values_mut() {
        notes.sort_by(|a, b| a.0.at.compare(b.0.at));
        for pair in notes.windows(2) {
            if pair[0]
                .0
                .at
                .checked_add(pair[0].0.duration)
                .ok_or("Note timing overflow")?
                .compare(pair[1].0.at)
                .is_gt()
            {
                return Err("Ambiguous overlapping same-channel same-pitch notes".into());
            }
        }
    }
    let commands: BTreeMap<_, _> = score
        .performance
        .events
        .iter()
        .map(|e| (e.origin, &e.command))
        .collect();
    validate_initial_pitch_bend_sensitivity(&ordered, &commands)?;
    for event in &score.performance.events {
        let Command::InitialControllerReset { channel } = event.command else {
            continue;
        };
        let channel_order: Vec<_> = ordered.iter().filter(|item| item.1 == channel).collect();
        let reset_index = channel_order
            .iter()
            .position(|item| item.2 == event.origin)
            .ok_or("Missing controller reset origin")?;
        let only_programs_before = channel_order[..reset_index].iter().all(|item| {
            matches!(
                commands.get(&item.2),
                Some(Command::InstrumentProgram { .. })
            )
        });
        if !only_programs_before
            || channel_order
                .iter()
                .any(|item| item.2.track != event.origin.track)
        {
            return Err("Controller initialization requires one track before any notes or other control state".into());
        }
        let next = channel_order
            .get(reset_index + 1)
            .ok_or("Incomplete controller initialization")?
            .2;
        if !matches!(commands.get(&next), Some(Command::InitialSustainOff { channel: c }) if *c == channel)
        {
            return Err("Initial reset must be immediately followed by sustain off".into());
        }
    }
    Ok(())
}

fn validate_initial_pitch_bend_sensitivity(
    ordered: &[(Beat, u8, Coordinate)],
    commands: &BTreeMap<Coordinate, &Command>,
) -> Result<(), String> {
    for channel in 0..16 {
        let channel_order: Vec<_> = ordered.iter().filter(|item| item.1 == channel).collect();
        let setup: Vec<_> = channel_order
            .iter()
            .enumerate()
            .filter_map(|(index, item)| match commands.get(&item.2) {
                Some(Command::InitialPitchBendSensitivity { step, .. }) => {
                    Some((index, item.2, *step))
                }
                _ => None,
            })
            .collect();
        if setup.is_empty() {
            continue;
        }
        let (start_index, start, _) = setup[0];
        if setup.len() != 6
            || setup
                .iter()
                .enumerate()
                .any(|(index, (position, origin, step))| {
                    *position != start_index + index
                        || origin.track != start.track
                        || origin.event != start.event + index as u32
                        || *step != InitialPitchBendSensitivityStep::ORDER[index]
                })
            || channel_order.iter().any(|item| item.2.track != start.track)
            || !channel_order[..start_index].iter().all(|item| {
                matches!(
                    commands.get(&item.2),
                    Some(Command::InstrumentProgram { .. })
                )
            })
        {
            return Err("Initial pitch-bend sensitivity requires one exact contiguous six-step group, in one owning track before notes or other control state".into());
        }
    }
    Ok(())
}

pub const MAX_SCORE_BYTES: usize = 16 * 1024 * 1024;
/// Deserialize directly into closed types so duplicate JSON keys are rejected.
/// Do not parse through serde_json::Value first, which would erase duplicates.
pub fn decode_json(bytes: &[u8]) -> Result<CompleteScore, String> {
    if bytes.len() > MAX_SCORE_BYTES {
        return Err("Complete score exceeds 16 MiB".into());
    }
    let score: CompleteScore =
        serde_json::from_slice(bytes).map_err(|e| format!("Invalid complete score JSON: {e}"))?;
    validate(&score)?;
    Ok(score)
}
pub fn encode_json(score: &CompleteScore) -> Result<Vec<u8>, String> {
    validate(score)?;
    let bytes = serde_json::to_vec_pretty(score).map_err(|e| e.to_string())?;
    if bytes.len() > MAX_SCORE_BYTES {
        return Err("Complete score exceeds 16 MiB".into());
    }
    Ok(bytes)
}

//! WorldMusicHub's canonical musical model and deterministic performance engine.
//! Musical time is rational quarter-note time; wall-clock time is derived only at playback boundaries.
pub mod adaptation;
pub mod assistance;
pub mod clean_performance;
pub mod clean_song;
mod fingering_clock;
pub mod fingering_source;
pub mod guitar_fingering;
mod jianpu;
mod matching;
mod midi;
mod midi_device_route;
pub mod midi_events;
mod midi_initial_sensitivity;
pub mod midi_timecode;
pub mod piano_fingering;
mod ties;
pub mod vsq;
pub mod vsq_clean;
pub mod vsq_engine;
pub use jianpu::{export_jianpu, import_jianpu, ExportedJianpu};
mod musicxml;
mod musicxml_export;
mod musicxml_header;
pub use midi::import_midi;
pub use musicxml_export::{
    export_musicxml, ExportedMusicXml, ExportedNoteMap, ExportedNoteSegment, ExportedVoiceId,
};
mod mxl;
pub use mxl::import_mxl;
mod catalog_lookup;
mod curated_editions;
pub use catalog_lookup::{catalog_index, catalog_score, CatalogIndex, CatalogItem};
pub mod external_omr;
pub mod feedback;
pub mod instruments;
pub mod metronome;
pub mod navigation;
pub mod omr;
pub mod practice;
mod public_domain;
pub mod results;
pub mod targets;
pub mod transposition;
pub use musicxml::import_musicxml;

use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Beat {
    pub numerator: i64,
    pub denominator: i64,
}
impl Beat {
    pub const ZERO: Self = Self {
        numerator: 0,
        denominator: 1,
    };
    pub const fn new(numerator: i64, denominator: i64) -> Self {
        Self {
            numerator,
            denominator,
        }
    }
    pub fn value(self) -> f64 {
        self.numerator as f64 / self.denominator as f64
    }
    pub fn valid(self) -> bool {
        self.denominator > 0
            && self.denominator <= 1_000_000
            && self.numerator.unsigned_abs() <= 1_000_000_000
    }
    pub fn compare(self, other: Self) -> std::cmp::Ordering {
        (self.numerator as i128 * other.denominator as i128)
            .cmp(&(other.numerator as i128 * self.denominator as i128))
    }
    pub fn equivalent(self, other: Self) -> bool {
        self.numerator as i128 * other.denominator as i128
            == other.numerator as i128 * self.denominator as i128
    }
    pub fn checked_add(self, other: Self) -> Option<Self> {
        if !self.valid() || !other.valid() {
            return None;
        }
        let n = self.numerator as i128 * other.denominator as i128
            + other.numerator as i128 * self.denominator as i128;
        let d = self.denominator as i128 * other.denominator as i128;
        let g = gcd(n.unsigned_abs(), d as u128) as i128;
        let result = Self::new(i64::try_from(n / g).ok()?, i64::try_from(d / g).ok()?);
        result.valid().then_some(result)
    }
}
fn gcd(mut a: u128, mut b: u128) -> u128 {
    while b != 0 {
        let r = a % b;
        a = b;
        b = r;
    }
    a.max(1)
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Pitch {
    pub step: String,
    pub alter: i8,
    pub octave: i8,
}
impl Pitch {
    pub fn midi(&self) -> Option<u8> {
        let base = match self.step.as_str() {
            "C" => 0,
            "D" => 2,
            "E" => 4,
            "F" => 5,
            "G" => 7,
            "A" => 9,
            "B" => 11,
            _ => return None,
        };
        if !(-2..=2).contains(&self.alter) {
            return None;
        }
        let value = (self.octave as i16 + 1) * 12 + base + self.alter as i16;
        (0..=127).contains(&value).then_some(value as u8)
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Note {
    pub id: String,
    pub at: Beat,
    pub duration: Beat,
    pub pitch: Option<Pitch>,
    pub voice: String,
    pub staff: u8,
    pub velocity: u8,
    #[serde(default)]
    pub tie_start: bool,
    #[serde(default)]
    pub tie_stop: bool,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Part {
    pub id: String,
    pub name: String,
    pub instrument: String,
    pub notes: Vec<Note>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Tempo {
    pub at: Beat,
    pub bpm: f64,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Meter {
    pub at: Beat,
    pub numerator: u16,
    pub denominator: u16,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Key {
    pub at: Beat,
    pub fifths: i8,
    pub mode: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Measure {
    pub number: u32,
    pub at: Beat,
    pub length: Beat,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Repeat {
    pub from: Beat,
    pub to: Beat,
    pub times: u8,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Provenance {
    pub kind: String,
    pub attribution: String,
    pub source_url: Option<String>,
    pub license: Option<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Source {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub import_diagnostics: Option<Vec<Diagnostic>>,
    pub format: String,
    pub filename: Option<String>,
    pub content: String,
}
pub const SCORE_SCHEMA_REVISION: u32 = 2;
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FormatMetadata {
    pub schema_revision: u32,
    pub producer: String,
    pub producer_version: String,
}
impl FormatMetadata {
    pub fn current() -> Self {
        Self {
            schema_revision: SCORE_SCHEMA_REVISION,
            producer: "WorldMusicHub".into(),
            producer_version: env!("CARGO_PKG_VERSION").into(),
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Score {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub format_metadata: Option<FormatMetadata>,
    pub version: u32,
    pub id: String,
    pub title: String,
    pub composer: String,
    pub provenance: Provenance,
    pub parts: Vec<Part>,
    pub tempo: Vec<Tempo>,
    pub meters: Vec<Meter>,
    pub keys: Vec<Key>,
    pub measures: Vec<Measure>,
    #[serde(default)]
    pub repeats: Vec<Repeat>,
    pub source: Option<Source>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Diagnostic {
    pub severity: String,
    pub code: String,
    pub message: String,
    pub note_id: Option<String>,
}
impl Diagnostic {
    fn warning(code: &str, message: impl Into<String>, note_id: Option<String>) -> Self {
        Self {
            severity: "warning".into(),
            code: code.into(),
            message: message.into(),
            note_id,
        }
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TimedNote {
    #[serde(default = "default_velocity")]
    pub velocity: u8,
    pub id: String,
    #[serde(default)]
    pub source_note_id: String,
    /// All canonical tied segments represented by this sounding occurrence.
    #[serde(default)]
    pub source_note_ids: Vec<String>,
    pub part_id: String,
    pub midi: u8,
    pub start_ms: f64,
    pub duration_ms: f64,
    pub voice: String,
    pub staff: u8,
}
fn default_velocity() -> u8 {
    90
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Timeline {
    pub notes: Vec<TimedNote>,
    pub duration_ms: f64,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Compilation {
    pub score: Score,
    pub timeline: Timeline,
    pub diagnostics: Vec<Diagnostic>,
}

pub fn validate(score: &Score) -> Result<(), String> {
    let bounded = |value: &str, limit: usize, name: &str| -> Result<(), String> {
        if value.len() > limit {
            Err(format!("{name} exceeds {limit}-byte limit"))
        } else {
            Ok(())
        }
    };
    if let Some(metadata) = &score.format_metadata {
        if metadata.schema_revision > SCORE_SCHEMA_REVISION {
            return Err(format!("This score uses newer schema metadata revision {}. Update WorldMusicHub; this build reads revisions 1–{}. Keep the original file unchanged.", metadata.schema_revision, SCORE_SCHEMA_REVISION));
        }
        if metadata.schema_revision == 0
            || metadata.producer.trim().is_empty()
            || metadata.producer_version.trim().is_empty()
        {
            return Err("Format metadata requires a positive schema revision and nonempty producer/version claims".into());
        }
        bounded(&metadata.producer, 128, "Producer name")?;
        bounded(&metadata.producer_version, 64, "Producer version")?;
    }
    bounded(&score.id, 128, "Score id")?;
    bounded(&score.composer, 1024, "Composer")?;
    bounded(&score.provenance.kind, 64, "Provenance kind")?;
    bounded(&score.provenance.attribution, 8192, "Attribution")?;
    if let Some(url) = &score.provenance.source_url {
        bounded(url, 4096, "Source URL")?;
    }
    if let Some(license) = &score.provenance.license {
        bounded(license, 256, "Asset license")?;
    }
    if let Some(source) = &score.source {
        bounded(&source.format, 64, "Source format")?;
        if let Some(name) = &source.filename {
            bounded(name, 1024, "Source filename")?;
        }
        bounded(&source.content, 8 * 1024 * 1024, "Retained source")?;
        if let Some(observations) = &source.import_diagnostics {
            if observations.len() > 256 {
                return Err("Retained import diagnostics exceed 256 entries".into());
            }
            for diagnostic in observations {
                if !matches!(diagnostic.severity.as_str(), "warning" | "info")
                    || diagnostic.code.is_empty()
                    || diagnostic.message.is_empty()
                {
                    return Err("Retained import diagnostics require warning/info severity, a code and a message".into());
                }
                bounded(&diagnostic.code, 64, "Retained diagnostic code")?;
                bounded(&diagnostic.message, 8192, "Retained diagnostic message")?;
                if let Some(id) = &diagnostic.note_id {
                    bounded(id, 128, "Retained diagnostic note id")?;
                }
            }
        }
    }
    if score.tempo.len() > 100_000
        || score.meters.len() > 100_000
        || score.keys.len() > 100_000
        || score.measures.len() > 100_000
        || score.repeats.len() > 10_000
    {
        return Err("Score metadata exceeds event-count limits".into());
    }
    if score.version != 1 {
        return Err(format!("Unsupported canonical score format version {}. This build reads version 1; a newer format needs a newer compatible WorldMusicHub app. Keep the original file unchanged.", score.version));
    }
    if score.title.trim().is_empty() || score.title.len() > 1000 || score.id.trim().is_empty() {
        return Err("Score requires a short title and stable id".into());
    }
    if score.parts.is_empty() || score.parts.len() > 128 {
        return Err("A score must contain 1–128 parts".into());
    }
    if score.parts.iter().map(|p| p.notes.len()).sum::<usize>() > 100_000 {
        return Err("Score exceeds 100,000-note import limit".into());
    }
    if score.tempo.is_empty() || !score.tempo[0].at.equivalent(Beat::ZERO) {
        return Err("Tempo map must begin at beat zero".into());
    }
    let mut last: Option<Beat> = None;
    for t in &score.tempo {
        if !t.at.valid()
            || t.at.numerator < 0
            || last.is_some_and(|at| t.at.compare(at) != std::cmp::Ordering::Greater)
            || !t.bpm.is_finite()
            || t.bpm < 10.
            || t.bpm > 600.
        {
            return Err("Tempo map must have increasing nonnegative beats and 10–600 BPM".into());
        }
        last = Some(t.at);
    }
    for m in &score.meters {
        if !m.at.valid()
            || m.at.numerator < 0
            || m.numerator == 0
            || m.denominator == 0
            || !m.denominator.is_power_of_two()
        {
            return Err("Invalid time signature".into());
        }
    }
    for k in &score.keys {
        if !k.at.valid() || k.at.numerator < 0 || !(-7..=7).contains(&k.fifths) {
            return Err("Invalid key signature".into());
        }
    }
    for m in &score.measures {
        if !m.at.valid()
            || m.at.numerator < 0
            || !m.length.valid()
            || m.length.numerator <= 0
            || m.at.checked_add(m.length).is_none()
        {
            return Err("Invalid measure timing".into());
        }
    }
    let mut ids = HashSet::new();
    let mut part_ids = HashSet::new();
    for p in &score.parts {
        bounded(&p.id, 128, "Part id")?;
        bounded(&p.name, 256, "Part name")?;
        bounded(&p.instrument, 64, "Instrument")?;
        if p.id.is_empty() || !part_ids.insert(&p.id) {
            return Err("Part ids must be nonempty and unique".into());
        }
        for n in &p.notes {
            bounded(&n.id, 128, "Note id")?;
            bounded(&n.voice, 64, "Voice id")?;
            if n.id.is_empty() || !ids.insert(&n.id) {
                return Err("Note ids must be nonempty and globally unique".into());
            }
            if !n.at.valid()
                || n.at.numerator < 0
                || !n.duration.valid()
                || n.duration.numerator <= 0
                || n.at.checked_add(n.duration).is_none()
            {
                return Err(format!("Invalid rational timing for {}", n.id));
            }
            if n.staff == 0 || n.voice.is_empty() || n.velocity > 127 {
                return Err(format!("Invalid voice, staff or velocity for {}", n.id));
            }
            if n.pitch.as_ref().is_some_and(|p| p.midi().is_none()) {
                return Err(format!("Invalid or out-of-range pitch for {}", n.id));
            }
            if n.pitch.is_none() && (n.tie_start || n.tie_stop) {
                return Err(format!("A rest cannot be tied: {}", n.id));
            }
        }
    }
    for r in &score.repeats {
        if !r.from.valid()
            || !r.to.valid()
            || r.from.numerator < 0
            || r.to.compare(r.from) != std::cmp::Ordering::Greater
            || !(2..=16).contains(&r.times)
        {
            return Err("Invalid repeat region".into());
        }
    }
    Ok(())
}
/// Indexed piecewise-linear conversion from rational musical time to a playback clock.
struct TempoIndex {
    segments: Vec<(f64, f64, f64)>,
}
impl TempoIndex {
    fn new(tempo: &[Tempo]) -> Self {
        let mut segments = vec![];
        let mut elapsed = 0.;
        let mut previous: Option<&Tempo> = None;
        for event in tempo {
            if let Some(prior) = previous {
                elapsed += (event.at.value() - prior.at.value()) * 60_000. / prior.bpm;
            }
            segments.push((event.at.value(), event.bpm, elapsed));
            previous = Some(event);
        }
        Self { segments }
    }
    fn at(&self, beat: f64) -> f64 {
        let index = self
            .segments
            .partition_point(|(start, _, _)| *start <= beat)
            .saturating_sub(1);
        self.segments
            .get(index)
            .map_or(0., |(start, bpm, elapsed)| {
                elapsed + (beat - start).max(0.) * 60_000. / bpm
            })
    }
}
/// Integrate a validated tempo map, including changes inside a held note.
pub fn beat_to_ms(beat: f64, tempo: &[Tempo]) -> f64 {
    TempoIndex::new(tempo).at(beat)
}

pub fn compile(score: Score) -> Result<Compilation, String> {
    if score
        .source
        .as_ref()
        .is_some_and(|source| source.format == "external-omr-draft")
    {
        return Err("External OMR output needs explicit note/rhythm/key/tempo review before playback or practice".into());
    }
    validate(&score)?;
    let tempo_index = TempoIndex::new(&score.tempo);
    let mut notes: Vec<TimedNote> = vec![];
    let mut diagnostics: Vec<_> = score
        .source
        .as_ref()
        .and_then(|source| source.import_diagnostics.as_ref())
        .into_iter()
        .flatten()
        .cloned()
        .map(|mut diagnostic| {
            diagnostic.message = format!("Retained import observation: {}", diagnostic.message);
            diagnostic
        })
        .collect();
    let mut total: f64 = 0.;
    for part in &score.parts {
        let mut sorted: Vec<&Note> = part.notes.iter().collect();
        sorted.sort_by(|a, b| a.at.compare(b.at).then(a.id.cmp(&b.id)));
        let mut ties = ties::TieTracker::default();
        for note in sorted {
            let end = note.at.checked_add(note.duration).expect("validated");
            let start_ms = tempo_index.at(note.at.value());
            let end_ms = tempo_index.at(end.value());
            total = total.max(end_ms);
            let Some(midi) = note.pitch.as_ref().and_then(Pitch::midi) else {
                continue;
            };
            let prior = if note.tie_stop {
                ties.take(note, midi)?
            } else {
                None
            };
            let mut merged = false;
            if let Some(prior) = prior {
                let index = prior.index;
                if prior.end.equivalent(note.at) {
                    if prior.cross_lane {
                        diagnostics.push(Diagnostic::warning("cross_lane_tie", "Linked a unique explicit adjacent tie across written voices/staves. Original note IDs and written lanes are preserved.", Some(note.id.clone())));
                    }
                    notes[index].duration_ms = end_ms - notes[index].start_ms;
                    notes[index].source_note_ids.push(note.id.clone());
                    if note.tie_start {
                        ties.start(note, midi, index, end)?;
                    }
                    merged = true;
                } else {
                    diagnostics.push(Diagnostic::warning(
                        "broken_tie",
                        "Tie continuation is not adjacent; played separately",
                        Some(note.id.clone()),
                    ));
                }
            } else if note.tie_stop {
                diagnostics.push(Diagnostic::warning(
                    "orphan_tie",
                    "Tie continuation has no matching start; played separately",
                    Some(note.id.clone()),
                ));
            }
            if !merged {
                let index = notes.len();
                notes.push(TimedNote {
                    velocity: note.velocity,
                    id: note.id.clone(),
                    source_note_id: note.id.clone(),
                    source_note_ids: vec![note.id.clone()],
                    part_id: part.id.clone(),
                    midi,
                    start_ms,
                    duration_ms: end_ms - start_ms,
                    voice: note.voice.clone(),
                    staff: note.staff,
                });
                if note.tie_start {
                    ties.start(note, midi, index, end)?;
                }
            }
        }
        let mut unresolved = ties.unresolved();
        unresolved.sort_unstable();
        for index in unresolved {
            diagnostics.push(Diagnostic::warning(
                "unclosed_tie",
                "Tie start has no continuation",
                Some(notes[index].id.clone()),
            ));
        }
    }
    for measure in &score.measures {
        total = total.max(
            tempo_index.at(measure
                .at
                .checked_add(measure.length)
                .expect("validated")
                .value()),
        );
    }
    if !score.repeats.is_empty() {
        (notes, total) = expand_repeats(&notes, &score, &tempo_index)?;
    }
    notes.sort_by(|a, b| {
        a.start_ms
            .total_cmp(&b.start_ms)
            .then(a.midi.cmp(&b.midi))
            .then(a.id.cmp(&b.id))
    });
    Ok(Compilation {
        score,
        timeline: Timeline {
            notes,
            duration_ms: total,
        },
        diagnostics,
    })
}

/// Exact written duration of a validated score, including explicit rests and measures.
fn written_duration(score: &Score) -> Beat {
    let note_ends = score
        .parts
        .iter()
        .flat_map(|part| &part.notes)
        .map(|note| note.at.checked_add(note.duration).expect("validated"));
    let measure_ends = score
        .measures
        .iter()
        .map(|measure| measure.at.checked_add(measure.length).expect("validated"));
    note_ends
        .chain(measure_ends)
        .max_by(|a, b| a.compare(*b))
        .unwrap_or(Beat::ZERO)
}
/// Shared exact half-open navigation; indices refer to the unchanged repeat array.
#[derive(Clone, Copy, Debug)]
struct NavigationSegment {
    start: Beat,
    end: Beat,
    repeat_region_index: Option<usize>,
    repeat_pass: Option<u8>,
    repeat_times: Option<u8>,
}
fn navigation_segments(score: &Score, total: Beat) -> Result<Vec<NavigationSegment>, String> {
    let mut regions: Vec<_> = score.repeats.iter().enumerate().collect();
    regions.sort_by(|a, b| a.1.from.compare(b.1.from));
    let mut segments = vec![];
    let mut cursor = Beat::ZERO;
    for (region_index, region) in regions {
        if region.from.compare(cursor).is_lt() || region.to.compare(total).is_gt() {
            return Err("Overlapping/nested or out-of-score repeat regions are not supported; source is retained for correction".into());
        }
        if region.from.compare(cursor).is_gt() {
            segments.push(NavigationSegment {
                start: cursor,
                end: region.from,
                repeat_region_index: None,
                repeat_pass: None,
                repeat_times: None,
            });
        }
        for pass in 1..=region.times {
            segments.push(NavigationSegment {
                start: region.from,
                end: region.to,
                repeat_region_index: Some(region_index),
                repeat_pass: Some(pass),
                repeat_times: Some(region.times),
            });
        }
        cursor = region.to;
    }
    if cursor.compare(total).is_lt() {
        segments.push(NavigationSegment {
            start: cursor,
            end: total,
            repeat_region_index: None,
            repeat_pass: None,
            repeat_times: None,
        });
    }
    Ok(segments)
}

/// Expand disjoint written repeat ranges without changing the source score.
/// Complex endings and nested repeats require a richer navigation graph and are rejected.
fn expand_repeats(
    notes: &[TimedNote],
    score: &Score,
    tempo: &TempoIndex,
) -> Result<(Vec<TimedNote>, f64), String> {
    let source: HashMap<_, _> = score
        .parts
        .iter()
        .flat_map(|part| &part.notes)
        .map(|note| (note.id.as_str(), note))
        .collect();
    let total = written_duration(score);
    // Navigation membership and boundary crossing use exact written beats. A floating
    // epsilon could silently accept a very short sustain crossing a repeat boundary.
    let mut ordered: Vec<_> = notes
        .iter()
        .map(|note| {
            let first = source[note
                .source_note_ids
                .first()
                .expect("compiled source")
                .as_str()];
            let last = source[note
                .source_note_ids
                .last()
                .expect("compiled source")
                .as_str()];
            (
                note,
                first.at,
                last.at.checked_add(last.duration).expect("validated"),
            )
        })
        .collect();
    ordered.sort_by(|a, b| a.1.compare(b.1).then(a.0.id.cmp(&b.0.id)));
    let mut prefix_ends = Vec::with_capacity(ordered.len());
    let mut farthest = Beat::ZERO;
    for (_, _, end) in &ordered {
        if end.compare(farthest).is_gt() {
            farthest = *end;
        }
        prefix_ends.push(farthest);
    }
    let segments = navigation_segments(score, total)?;
    for region in &score.repeats {
        for boundary in [region.from, region.to] {
            let index = ordered.partition_point(|(_, start, _)| start.compare(boundary).is_lt());
            if index > 0 && prefix_ends[index - 1].compare(boundary).is_gt() {
                return Err("A note crosses a repeat boundary; explicit tie/navigation handling is required".into());
            }
        }
    }
    let mut output = vec![];
    let mut source_references = 0_usize;
    let mut offset = 0.;
    for segment in segments {
        let (start, end) = (segment.start, segment.end);
        let first = ordered.partition_point(|(_, at, _)| at.compare(start).is_lt());
        let last = ordered.partition_point(|(_, at, _)| at.compare(end).is_lt());
        let start_ms = tempo.at(start.value());
        for (note, _, _) in &ordered[first..last] {
            if output.len() >= 100_000 {
                return Err("Expanded repeat timeline exceeds 100,000-note limit".into());
            }
            source_references += note.source_note_ids.len();
            if source_references > 1_000_000 {
                return Err("Expanded repeat source references exceed 1,000,000; simplify repeat navigation".into());
            }
            let mut occurrence = (*note).clone();
            occurrence.id = format!("occurrence-{}", output.len());
            occurrence.start_ms = offset + note.start_ms - start_ms;
            output.push(occurrence);
        }
        offset += tempo.at(end.value()) - start_ms;
    }
    Ok((output, offset))
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct InputEvent {
    pub midi: u8,
    pub at_ms: f64,
    pub velocity: u8,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Hit {
    pub note_id: String,
    pub midi: u8,
    pub expected_ms: f64,
    pub actual_ms: f64,
    pub delta_ms: f64,
    pub grade: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Assessment {
    pub summary: feedback::PerformanceSummary,
    /// Counters for this assessed input snapshot, not a live or finalized combo.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub grade_counts: Option<results::GradeCounts>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub onset_completion: Option<results::OnsetCompletion>,
    /// Sorted by MIDI pitch, counting the submitted physical onset targets.
    #[serde(default)]
    pub pitch_breakdown: Vec<feedback::PitchFeedback>,
    pub hits: Vec<Hit>,
    pub misses: Vec<String>,
    pub extras: Vec<InputEvent>,
    pub accuracy_percent: f64,
    pub mean_abs_error_ms: Option<f64>,
}
pub fn assess(
    timeline: &Timeline,
    inputs: &[InputEvent],
    tolerance_ms: f64,
) -> Result<Assessment, String> {
    if !tolerance_ms.is_finite() || !(10.0..=2000.0).contains(&tolerance_ms) {
        return Err("Timing tolerance must be 10–2000 ms".into());
    }
    if inputs.len() > 200_000 || timeline.notes.len() > 100_000 {
        return Err("Performance exceeds assessment limits".into());
    }
    if inputs
        .iter()
        .any(|x| x.midi > 127 || x.velocity > 127 || !x.at_ms.is_finite())
        || timeline.notes.iter().any(|n| {
            n.midi > 127
                || n.velocity > 127
                || !n.start_ms.is_finite()
                || n.start_ms < 0.
                || !n.duration_ms.is_finite()
                || n.duration_ms <= 0.
        })
    {
        return Err("Invalid performance data".into());
    }
    let mut target_pitches: Vec<Vec<(usize, f64)>> = (0..128).map(|_| vec![]).collect();
    let mut input_pitches: Vec<Vec<(usize, f64)>> = (0..128).map(|_| vec![]).collect();
    for (i, note) in timeline.notes.iter().enumerate() {
        target_pitches[note.midi as usize].push((i, note.start_ms));
    }
    for (i, event) in inputs.iter().enumerate().filter(|(_, e)| e.velocity > 0) {
        input_pitches[event.midi as usize].push((i, event.at_ms));
    }
    let mut pairs = HashMap::new();
    let mut budget = 2_000_000;
    for midi in 0..128 {
        target_pitches[midi].sort_by(|a, b| a.1.total_cmp(&b.1).then(a.0.cmp(&b.0)));
        input_pitches[midi].sort_by(|a, b| a.1.total_cmp(&b.1).then(a.0.cmp(&b.0)));
        for (target, input) in matching::align_pitch(
            &target_pitches[midi],
            &input_pitches[midi],
            tolerance_ms,
            &mut budget,
        )? {
            pairs.insert(input, target);
        }
    }
    let mut matched = HashSet::new();
    let mut hits = vec![];
    let mut extras = vec![];
    let mut sorted: Vec<_> = inputs
        .iter()
        .enumerate()
        .filter(|(_, e)| e.velocity > 0)
        .collect();
    sorted.sort_by(|(ai, a), (bi, b)| a.at_ms.total_cmp(&b.at_ms).then(ai.cmp(bi)));
    for (input_index, event) in sorted {
        if let Some(&i) = pairs.get(&input_index) {
            let note = &timeline.notes[i];
            matched.insert(i);
            let delta = event.at_ms - note.start_ms;
            let grade = if delta.abs() <= tolerance_ms * 0.25 {
                "perfect"
            } else if delta.abs() <= tolerance_ms * 0.65 {
                "good"
            } else if delta < 0. {
                "early"
            } else {
                "late"
            };
            hits.push(Hit {
                note_id: note.id.clone(),
                midi: note.midi,
                expected_ms: note.start_ms,
                actual_ms: event.at_ms,
                delta_ms: delta,
                grade: grade.into(),
            });
        } else {
            extras.push(event.clone());
        }
    }
    let misses = timeline
        .notes
        .iter()
        .enumerate()
        .filter(|(i, _)| !matched.contains(i))
        .map(|(_, n)| n.id.clone())
        .collect();
    let denominator = timeline.notes.len() + extras.len();
    let accuracy_percent = if denominator == 0 {
        100.
    } else {
        100. * hits.len() as f64 / denominator as f64
    };
    let mean_abs_error_ms = (!hits.is_empty())
        .then(|| hits.iter().map(|h| h.delta_ms.abs()).sum::<f64>() / hits.len() as f64);
    let summary = feedback::summarize(&hits, timeline.notes.len(), extras.len(), tolerance_ms);
    let pitch_breakdown = feedback::pitch_breakdown(timeline, &hits, &extras);
    let grade_counts = results::grade_counts(&hits, timeline.notes.len(), extras.len());
    let onset_completion = results::onset_completion(timeline, &matched);
    Ok(Assessment {
        summary,
        grade_counts: Some(grade_counts),
        onset_completion: Some(onset_completion),
        pitch_breakdown,
        hits,
        misses,
        extras,
        accuracy_percent,
        mean_abs_error_ms,
    })
}

pub fn catalog() -> Vec<Score> {
    catalog_scores().to_vec()
}

fn catalog_scores() -> &'static [Score] {
    static SCORES: std::sync::OnceLock<Vec<Score>> = std::sync::OnceLock::new();
    SCORES.get_or_init(build_catalog)
}

fn build_catalog() -> Vec<Score> {
    let pitches = [
        ("C", 4),
        ("D", 4),
        ("E", 4),
        ("F", 4),
        ("G", 4),
        ("A", 4),
        ("B", 4),
        ("C", 5),
        ("B", 4),
        ("A", 4),
        ("G", 4),
        ("F", 4),
        ("E", 4),
        ("D", 4),
        ("C", 4),
    ];
    let notes = pitches
        .iter()
        .enumerate()
        .map(|(i, (step, octave))| Note {
            id: format!("scale-{i}"),
            at: Beat::new(i as i64, 1),
            duration: Beat::new(1, 1),
            pitch: Some(Pitch {
                step: step.to_string(),
                alter: 0,
                octave: *octave,
            }),
            voice: "1".into(),
            staff: 1,
            velocity: 90,
            tie_start: false,
            tie_stop: false,
        })
        .collect();
    let mut scale=Score { format_metadata: Some(crate::FormatMetadata::current()), version:1,id:"first-steps".into(),title:"初见 · First Steps".into(),composer:"WorldMusicHub original exercise".into(),provenance:Provenance {kind:"original_exercise".into(),attribution:"Newly authored pedagogical scale exercise for WorldMusicHub; not a transcription of a song".into(),source_url:None,license:Some("CC0-1.0".into())},parts:vec![Part {id:"piano".into(),name:"Piano".into(),instrument:"piano".into(),notes}],tempo:vec![Tempo {at:Beat::ZERO,bpm:90.}],meters:vec![Meter {at:Beat::ZERO,numerator:4,denominator:4}],keys:vec![Key {at:Beat::ZERO,fifths:0,mode:"major".into()}],measures:(0..4).map(|i|Measure {number:i+1,at:Beat::new(i as i64*4,1),length:Beat::new(4,1)}).collect(),repeats:vec![],source:None};
    let mut duet = scale.clone();
    duet.id = "steady-hands".into();
    duet.title = "同频 · Steady Hands".into();
    duet.parts[0].notes = duet.parts[0].notes.iter().take(8).cloned().collect();
    for i in 0..4 {
        duet.parts[0].notes.push(Note {
            id: format!("bass-{i}"),
            at: Beat::new(i * 2, 1),
            duration: Beat::new(2, 1),
            pitch: Some(Pitch {
                step: if i % 2 == 0 { "C" } else { "G" }.into(),
                alter: 0,
                octave: 3,
            }),
            voice: "2".into(),
            staff: 2,
            velocity: 70,
            tie_start: false,
            tie_stop: false,
        });
    }
    duet.measures.truncate(2);
    let mut rhythm = duet.clone();
    rhythm.id = "little-syncopation".into();
    rhythm.title = "跃动 · Little Syncopation".into();
    rhythm.tempo[0].bpm = 100.;
    rhythm.parts[0].notes.clear();
    for (i, (at, duration, step)) in [
        (0, 1, "C"),
        (1, 1, "E"),
        (3, 1, "G"),
        (4, 2, "E"),
        (6, 1, "D"),
        (7, 1, "C"),
        (9, 1, "G"),
        (10, 2, "C"),
    ]
    .iter()
    .enumerate()
    {
        rhythm.parts[0].notes.push(Note {
            id: format!("sync-{i}"),
            at: Beat::new(*at, 2),
            duration: Beat::new(*duration, 2),
            pitch: Some(Pitch {
                step: step.to_string(),
                alter: 0,
                octave: 4,
            }),
            voice: "1".into(),
            staff: 1,
            velocity: 90,
            tie_start: false,
            tie_stop: false,
        });
    }
    // Include an explicit rest: it is preserved in notation but does not become a sound.
    scale.parts[0].notes.push(Note {
        id: "scale-rest".into(),
        at: Beat::new(15, 1),
        duration: Beat::new(1, 1),
        pitch: None,
        voice: "1".into(),
        staff: 1,
        velocity: 0,
        tie_start: false,
        tie_stop: false,
    });
    let mut scores = vec![scale, duet, rhythm];
    scores.extend(public_domain::catalog());
    scores.extend(curated_editions::catalog());
    scores
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn import_observations_survive_json_reload_without_changing_source_bytes_or_reprefixing() {
        let xml = include_str!("../../../tests/fixtures/original-duet.musicxml");
        let (mut score, observations) = import_musicxml(xml).unwrap();
        assert!(!observations.is_empty());
        assert_eq!(score.source.as_ref().unwrap().content, xml);
        assert_eq!(
            serde_json::to_value(
                score
                    .source
                    .as_ref()
                    .unwrap()
                    .import_diagnostics
                    .as_ref()
                    .unwrap()
            )
            .unwrap(),
            serde_json::to_value(&observations).unwrap()
        );
        // Historical source warnings remain distinguishable after a later musical edit.
        score.tempo[0].bpm = 80.;
        let first = compile(score.clone()).unwrap();
        assert_eq!(
            first
                .diagnostics
                .iter()
                .filter(|d| d.message.starts_with("Retained import observation: "))
                .count(),
            observations.len()
        );
        let loaded: Score =
            serde_json::from_str(&serde_json::to_string(&first.score).unwrap()).unwrap();
        let again = compile(loaded).unwrap();
        assert_eq!(
            serde_json::to_value(&first.diagnostics).unwrap(),
            serde_json::to_value(&again.diagnostics).unwrap()
        );
        assert_eq!(again.score.source.unwrap().content, xml);
    }
    #[test]
    fn midi_and_jianpu_inference_warnings_are_kept_in_their_exact_source_package() {
        let midi = include_bytes!("../../../tests/fixtures/midi-original-ppq.mid");
        let (score, warnings) = import_midi(midi).unwrap();
        assert!(!warnings.is_empty());
        assert_eq!(
            score.source.unwrap().import_diagnostics.unwrap().len(),
            warnings.len()
        );
        let (score, warnings) = import_jianpu("1 2 3").unwrap();
        assert!(!warnings.is_empty());
        assert_eq!(
            score.source.unwrap().import_diagnostics.unwrap().len(),
            warnings.len()
        );
    }
    #[test]
    fn legacy_sources_still_parse_and_retained_observations_are_bounded_metadata() {
        let mut score = catalog().remove(0);
        score.source = Some(Source {
            format: "original".into(),
            filename: None,
            content: "exact source".into(),
            import_diagnostics: None,
        });
        let json = serde_json::to_string(&score).unwrap();
        assert!(!json.contains("import_diagnostics"));
        let loaded: Score = serde_json::from_str(&json).unwrap();
        assert!(validate(&loaded).is_ok());
        let observation = Diagnostic {
            severity: "warning".into(),
            code: "source_only".into(),
            message: "Original notation was not interpreted".into(),
            note_id: None,
        };
        score.source.as_mut().unwrap().import_diagnostics = Some(vec![observation.clone(); 257]);
        assert!(validate(&score).is_err());
        score.source.as_mut().unwrap().import_diagnostics = Some(vec![observation]);
        assert!(validate(&score).is_ok());
    }
    #[test]
    fn canonical_origin_metadata_is_optional_preserved_and_future_revisions_are_clear() {
        let mut score = catalog().remove(0);
        let metadata = score.format_metadata.as_ref().unwrap();
        assert_eq!(metadata.schema_revision, 2);
        assert_eq!(metadata.producer_version, env!("CARGO_PKG_VERSION"));
        score.format_metadata = None;
        let text = serde_json::to_string(&score).unwrap();
        assert!(!text.contains("format_metadata"));
        let legacy: Score = serde_json::from_str(&text).unwrap();
        assert!(compile(legacy).unwrap().score.format_metadata.is_none());
        let mut future = FormatMetadata::current();
        future.schema_revision = 3;
        score.format_metadata = Some(future);
        assert!(validate(&score)
            .unwrap_err()
            .contains("newer schema metadata"));
        score.format_metadata = None;
        score.version = 2;
        assert!(validate(&score)
            .unwrap_err()
            .contains("newer compatible WorldMusicHub"));
    }
    #[test]
    fn rational_addition_is_exact() {
        assert!(Beat::new(1, 3)
            .checked_add(Beat::new(1, 6))
            .unwrap()
            .equivalent(Beat::new(1, 2)));
        assert!(Beat::new(1, 0).checked_add(Beat::ZERO).is_none());
    }
    #[test]
    fn tempo_changes_inside_notes_are_integrated() {
        let tempo = vec![
            Tempo {
                at: Beat::ZERO,
                bpm: 120.,
            },
            Tempo {
                at: Beat::new(1, 1),
                bpm: 60.,
            },
        ];
        assert_eq!(beat_to_ms(2., &tempo), 1500.);
    }
    #[test]
    fn all_catalog_scores_compile_without_losing_written_pitch_ids() {
        for s in catalog() {
            let ids: HashSet<_> = s
                .parts
                .iter()
                .flat_map(|p| &p.notes)
                .filter(|n| n.pitch.is_some())
                .map(|n| n.id.clone())
                .collect();
            let untied_unrepeated = s.repeats.is_empty()
                && s.parts
                    .iter()
                    .flat_map(|p| &p.notes)
                    .all(|n| !n.tie_start && !n.tie_stop);
            let c = compile(s).unwrap();
            let retained: HashSet<_> = c
                .timeline
                .notes
                .iter()
                .flat_map(|n| n.source_note_ids.clone())
                .collect();
            assert_eq!(retained, ids);
            if untied_unrepeated {
                assert_eq!(c.timeline.notes.len(), ids.len());
            }
        }
    }
    #[test]
    fn source_roundtrip_preserves_notation() {
        let mut s = catalog().remove(0);
        s.source = Some(Source {
            import_diagnostics: None,
            format: "musicxml".into(),
            filename: None,
            content: "<score/>".into(),
        });
        let original = serde_json::to_value(&s).unwrap();
        let parsed: Score = serde_json::from_value(original.clone()).unwrap();
        assert_eq!(serde_json::to_value(parsed).unwrap(), original);
    }
    #[test]
    fn ties_merge_audio_without_deleting_score_notes() {
        let mut s = catalog().remove(0);
        s.parts[0].notes.truncate(2);
        s.parts[0].notes[0].tie_start = true;
        s.parts[0].notes[1].tie_stop = true;
        s.parts[0].notes[1].pitch = s.parts[0].notes[0].pitch.clone();
        let c = compile(s).unwrap();
        assert_eq!(c.score.parts[0].notes.len(), 2);
        assert_eq!(c.timeline.notes.len(), 1);
        assert!((c.timeline.notes[0].duration_ms - 1333.333333).abs() < 0.01);
    }
    #[test]
    fn invalid_and_duplicate_notes_are_rejected() {
        let mut s = catalog().remove(0);
        s.parts[0].notes[0].duration.denominator = 0;
        assert!(compile(s).is_err());
        let mut s = catalog().remove(0);
        let n = s.parts[0].notes[0].clone();
        s.parts[0].notes.push(n);
        assert!(compile(s).is_err());
    }
    #[test]
    fn assessment_matches_each_note_once() {
        let t = compile(catalog().remove(0)).unwrap().timeline;
        let inputs = vec![
            InputEvent {
                midi: 60,
                at_ms: 10.,
                velocity: 90,
            },
            InputEvent {
                midi: 60,
                at_ms: 20.,
                velocity: 90,
            },
        ];
        let a = assess(&t, &inputs, 150.).unwrap();
        assert_eq!(a.hits.len(), 1);
        assert_eq!(a.extras.len(), 1);
        assert_eq!(a.misses.len(), 14);
        assert_eq!(a.hits[0].grade, "perfect");
    }
    #[test]
    fn velocity_zero_does_not_create_wrong_note() {
        let t = Timeline {
            notes: vec![],
            duration_ms: 0.,
        };
        assert!(assess(
            &t,
            &[InputEvent {
                midi: 60,
                at_ms: 0.,
                velocity: 0
            }],
            100.
        )
        .unwrap()
        .extras
        .is_empty());
    }
    #[test]
    fn repeats_expand_occurrences_without_changing_source() {
        let mut s = catalog().remove(0);
        s.parts[0].notes.truncate(4);
        s.measures.truncate(1);
        s.repeats.push(Repeat {
            from: Beat::ZERO,
            to: Beat::new(4, 1),
            times: 3,
        });
        let c = compile(s).unwrap();
        assert_eq!(c.score.parts[0].notes.len(), 4);
        assert_eq!(c.timeline.notes.len(), 12);
        assert_eq!(
            c.timeline.notes[0].source_note_id,
            c.timeline.notes[4].source_note_id
        );
        assert_ne!(c.timeline.notes[0].id, c.timeline.notes[4].id);
        assert!((c.timeline.duration_ms - 8000.).abs() < 0.001);
    }
    #[test]
    fn nested_repeats_and_crossing_sustains_are_rejected() {
        let mut s = catalog().remove(0);
        s.repeats = vec![
            Repeat {
                from: Beat::ZERO,
                to: Beat::new(4, 1),
                times: 2,
            },
            Repeat {
                from: Beat::new(2, 1),
                to: Beat::new(3, 1),
                times: 2,
            },
        ];
        assert!(compile(s).unwrap_err().contains("nested"));
        let mut s = catalog().remove(0);
        s.parts[0].notes[0].duration = Beat::new(2, 1);
        s.repeats.push(Repeat {
            from: Beat::new(1, 1),
            to: Beat::new(4, 1),
            times: 2,
        });
        assert!(compile(s).unwrap_err().contains("crosses"));
    }
    #[test]
    fn repeat_boundary_checks_do_not_ignore_sub_millisecond_crossings() {
        let mut s = catalog().remove(0);
        s.parts[0].notes.truncate(1);
        s.parts[0].notes[0].at = Beat::new(999_999, 1_000_000);
        s.parts[0].notes[0].duration = Beat::new(2, 1_000_000);
        s.repeats.push(Repeat {
            from: Beat::new(1, 1),
            to: Beat::new(4, 1),
            times: 2,
        });
        assert!(compile(s).unwrap_err().contains("crosses"));
    }
    #[test]
    fn exact_repeat_edges_and_tempo_changes_preserve_occurrence_membership() {
        let mut s = catalog().remove(0);
        s.parts[0].notes.truncate(2);
        s.parts[0].notes[0].at = Beat::new(1, 3);
        s.parts[0].notes[0].duration = Beat::new(1, 3);
        s.parts[0].notes[1].at = Beat::new(2, 3);
        s.parts[0].notes[1].duration = Beat::new(1, 3);
        s.tempo = vec![
            Tempo {
                at: Beat::ZERO,
                bpm: 120.,
            },
            Tempo {
                at: Beat::new(2, 3),
                bpm: 60.,
            },
        ];
        s.repeats.push(Repeat {
            from: Beat::new(2, 6),
            to: Beat::new(1, 1),
            times: 2,
        });
        let c = compile(s).unwrap();
        assert_eq!(c.timeline.notes.len(), 4);
        assert_eq!(
            c.timeline.notes[0].source_note_ids,
            c.timeline.notes[2].source_note_ids
        );
        assert!((c.timeline.notes[2].start_ms - c.timeline.notes[0].start_ms - 500.).abs() < 1e-8);
        assert!((c.timeline.notes[3].duration_ms - 1000. / 3.).abs() < 1e-8);
    }
    #[test]
    fn dense_performance_matching_is_one_to_one_and_bounded() {
        let notes = (0..20_000)
            .map(|i| TimedNote {
                velocity: 90,
                id: format!("n-{i}"),
                source_note_id: format!("n-{i}"),
                source_note_ids: vec![format!("n-{i}")],
                part_id: "p".into(),
                midi: 60,
                start_ms: 0.,
                duration_ms: 500.,
                voice: "1".into(),
                staff: 1,
            })
            .collect();
        let t = Timeline {
            notes,
            duration_ms: 500.,
        };
        let inputs = vec![
            InputEvent {
                midi: 60,
                at_ms: 10.,
                velocity: 90
            };
            20_000
        ];
        let result = assess(&t, &inputs, 150.).unwrap();
        assert_eq!(result.hits.len(), 20_000);
        assert_eq!(result.accuracy_percent, 100.);
        assert!(result.extras.is_empty());
    }
    #[test]
    fn nearest_note_choice_handles_early_and_tied_distance() {
        let mut t = compile(catalog().remove(0)).unwrap().timeline;
        t.notes.truncate(2);
        t.notes[1].midi = 60;
        t.notes[1].start_ms = 200.;
        let result = assess(
            &t,
            &[
                InputEvent {
                    midi: 60,
                    at_ms: 100.,
                    velocity: 90,
                },
                InputEvent {
                    midi: 60,
                    at_ms: 190.,
                    velocity: 90,
                },
            ],
            150.,
        )
        .unwrap();
        assert_eq!(result.hits[0].note_id, t.notes[0].id);
        assert_eq!(result.hits[1].note_id, t.notes[1].id);
    }
    #[test]
    fn overflowing_measure_end_is_rejected_before_compilation() {
        let mut score = catalog().remove(0);
        score.measures[0].at = Beat::new(1_000_000_000, 1);
        score.measures[0].length = Beat::new(1, 1);
        assert!(compile(score).unwrap_err().contains("measure"));
    }
    #[test]
    fn oversized_identifiers_cannot_amplify_timeline_memory() {
        let mut score = catalog().remove(0);
        score.parts[0].id = "x".repeat(129);
        assert!(compile(score).unwrap_err().contains("Part id"));
        let mut score = catalog().remove(0);
        score.parts[0].notes[0].voice = "x".repeat(65);
        assert!(compile(score).unwrap_err().contains("Voice id"));
    }
    #[test]
    fn unknown_json_notation_fields_are_never_silently_discarded() {
        let mut json = serde_json::to_value(catalog().remove(0)).unwrap();
        json["parts"][0]["notes"][0]["articulations"] = serde_json::json!(["staccato"]);
        assert!(serde_json::from_value::<Score>(json)
            .unwrap_err()
            .to_string()
            .contains("unknown field"));
        let mut json = serde_json::to_value(catalog().remove(0)).unwrap();
        json["navigation"] = serde_json::json!({"dacapo":true});
        assert!(serde_json::from_value::<Score>(json).is_err());
    }
    #[test]
    fn ambiguous_tie_starts_do_not_silently_overwrite_each_other() {
        let mut score = catalog().remove(0);
        score.parts[0].notes.truncate(3);
        let pitch = score.parts[0].notes[0].pitch.clone();
        for n in &mut score.parts[0].notes {
            n.pitch = pitch.clone();
            n.at = Beat::ZERO;
            n.tie_start = true;
        }
        score.parts[0].notes[2].at = Beat::new(1, 1);
        score.parts[0].notes[2].tie_start = false;
        score.parts[0].notes[2].tie_stop = true;
        assert!(compile(score).unwrap_err().contains("Ambiguous"));
    }
    #[test]
    fn many_tempo_changes_and_notes_compile_with_indexed_clock() {
        let mut score = catalog().remove(0);
        let template = score.parts[0].notes[0].clone();
        score.parts[0].notes.clear();
        score.tempo.clear();
        score.measures.clear();
        for i in 0..20_000 {
            let mut n = template.clone();
            n.id = format!("dense-{i}");
            n.at = Beat::new(i, 1);
            score.parts[0].notes.push(n);
            score.tempo.push(Tempo {
                at: Beat::new(i, 1),
                bpm: if i % 2 == 0 { 120. } else { 60. },
            });
        }
        let c = compile(score).unwrap();
        assert_eq!(c.timeline.notes.len(), 20_000);
        assert_eq!(c.timeline.duration_ms, 15_000_000.);
    }
    #[test]
    fn unresolved_tie_diagnostics_follow_deterministic_source_order() {
        let mut score = catalog().remove(0);
        score.parts[0].notes.truncate(7);
        for note in &mut score.parts[0].notes {
            note.tie_start = true;
        }
        let first = serde_json::to_value(compile(score.clone()).unwrap().diagnostics).unwrap();
        for _ in 0..10 {
            assert_eq!(
                serde_json::to_value(compile(score.clone()).unwrap().diagnostics).unwrap(),
                first
            );
        }
    }
    #[test]
    fn playback_timeline_preserves_attack_velocity() {
        let mut score = catalog().remove(0);
        score.parts[0].notes[0].velocity = 42;
        assert_eq!(compile(score).unwrap().timeline.notes[0].velocity, 42);
    }
    #[test]
    fn late_repetitions_keep_the_correct_order_and_bias() {
        let mut t = compile(catalog().remove(0)).unwrap().timeline;
        t.notes.truncate(2);
        t.notes[0].midi = 60;
        t.notes[0].start_ms = 0.;
        t.notes[1].midi = 60;
        t.notes[1].start_ms = 250.;
        let a = assess(
            &t,
            &[
                InputEvent {
                    midi: 60,
                    at_ms: 140.,
                    velocity: 90,
                },
                InputEvent {
                    midi: 60,
                    at_ms: 390.,
                    velocity: 90,
                },
            ],
            180.,
        )
        .unwrap();
        assert_eq!(a.hits.len(), 2);
        assert!(a.misses.is_empty() && a.extras.is_empty());
        assert_eq!(a.accuracy_percent, 100.);
        assert!(a
            .hits
            .iter()
            .all(|h| h.delta_ms == 140. && h.grade == "late"));
        assert_eq!(a.summary.timing_bias_ms, Some(140.));
    }
}

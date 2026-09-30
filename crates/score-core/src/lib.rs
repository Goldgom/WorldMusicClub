//! WorldMusicHub's canonical musical model and deterministic performance engine.
//! Musical time is rational quarter-note time; wall-clock time is derived only at playback boundaries.
mod jianpu;
mod midi;
pub use jianpu::import_jianpu;
mod musicxml;
mod musicxml_export;
pub use midi::import_midi;
pub use musicxml_export::{export_musicxml, ExportedMusicXml, ExportedVoiceId};
mod mxl;
pub use mxl::import_mxl;
pub mod feedback;
pub mod instruments;
pub mod omr;
pub mod practice;
mod public_domain;
pub use musicxml::import_musicxml;

use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap, HashSet, VecDeque};

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
    pub format: String,
    pub filename: Option<String>,
    pub content: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Score {
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
        return Err("Unsupported score version; expected version 1".into());
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
    validate(&score)?;
    let tempo_index = TempoIndex::new(&score.tempo);
    let mut notes: Vec<TimedNote> = vec![];
    let mut diagnostics = vec![];
    let mut total: f64 = 0.;
    for part in &score.parts {
        let mut sorted: Vec<&Note> = part.notes.iter().collect();
        sorted.sort_by(|a, b| a.at.compare(b.at).then(a.id.cmp(&b.id)));
        let mut ties: HashMap<(String, u8, u8), (usize, Beat)> = HashMap::new();
        for note in sorted {
            let end = note.at.checked_add(note.duration).expect("validated");
            let start_ms = tempo_index.at(note.at.value());
            let end_ms = tempo_index.at(end.value());
            total = total.max(end_ms);
            let Some(midi) = note.pitch.as_ref().and_then(Pitch::midi) else {
                continue;
            };
            let tie_key = (note.voice.clone(), note.staff, midi);
            let prior = if note.tie_stop {
                ties.remove(&tie_key)
            } else {
                None
            };
            let mut merged = false;
            if let Some((index, prior_end)) = prior {
                if prior_end.equivalent(note.at) {
                    notes[index].duration_ms = end_ms - notes[index].start_ms;
                    if note.tie_start {
                        ties.insert(tie_key.clone(), (index, end));
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
                    part_id: part.id.clone(),
                    midi,
                    start_ms,
                    duration_ms: end_ms - start_ms,
                    voice: note.voice.clone(),
                    staff: note.staff,
                });
                if note.tie_start && ties.insert(tie_key, (index, end)).is_some() {
                    return Err(format!("Ambiguous overlapping tie starts for note {}; use distinct voices or correct the ties", note.id));
                }
            }
        }
        let mut unresolved: Vec<_> = ties.values().map(|(index, _)| *index).collect();
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
        (notes, total) = expand_repeats(&notes, total, &score.repeats, &tempo_index)?;
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

/// Expand disjoint written repeat ranges without changing the source score.
/// Complex endings and nested repeats require a richer navigation graph and are rejected.
fn expand_repeats(
    notes: &[TimedNote],
    duration_ms: f64,
    repeats: &[Repeat],
    tempo: &TempoIndex,
) -> Result<(Vec<TimedNote>, f64), String> {
    let mut regions: Vec<_> = repeats.iter().collect();
    regions.sort_by(|a, b| a.from.compare(b.from));
    let mut ordered: Vec<_> = notes.iter().collect();
    ordered.sort_by(|a, b| a.start_ms.total_cmp(&b.start_ms).then(a.id.cmp(&b.id)));
    let mut prefix_ends = Vec::with_capacity(ordered.len());
    let mut farthest: f64 = 0.;
    for note in &ordered {
        farthest = farthest.max(note.start_ms + note.duration_ms);
        prefix_ends.push(farthest);
    }
    let mut segments = vec![];
    let mut cursor = 0.;
    for region in regions {
        let from = tempo.at(region.from.value());
        let to = tempo.at(region.to.value());
        if from < cursor || to > duration_ms + 0.001 {
            return Err("Overlapping/nested or out-of-score repeat regions are not supported; source is retained for correction".into());
        }
        for boundary in [from, to] {
            let index = ordered.partition_point(|note| note.start_ms < boundary - 0.001);
            if index > 0 && prefix_ends[index - 1] > boundary + 0.001 {
                return Err("A note crosses a repeat boundary; explicit tie/navigation handling is required".into());
            }
        }
        if from > cursor {
            segments.push((cursor, from));
        }
        for _ in 0..region.times {
            segments.push((from, to));
        }
        cursor = to;
    }
    if cursor < duration_ms {
        segments.push((cursor, duration_ms));
    }
    let mut output = vec![];
    let mut offset = 0.;
    for (start, end) in segments {
        let first = ordered.partition_point(|note| note.start_ms < start);
        let last = ordered.partition_point(|note| note.start_ms < end);
        for note in &ordered[first..last] {
            if output.len() >= 100_000 {
                return Err("Expanded repeat timeline exceeds 100,000-note limit".into());
            }
            let mut occurrence = (*note).clone();
            occurrence.id = format!("occurrence-{}", output.len());
            occurrence.start_ms = offset + note.start_ms - start;
            output.push(occurrence);
        }
        offset += end - start;
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
    let mut matched = HashSet::new();
    let mut hits = vec![];
    let mut extras = vec![];
    let mut sorted: Vec<&InputEvent> = inputs.iter().filter(|e| e.velocity > 0).collect();
    sorted.sort_by(|a, b| a.at_ms.total_cmp(&b.at_ms));
    // Ordered buckets avoid quadratic scans on long scores or dense repeated pitches.
    let mut targets: Vec<BTreeMap<u64, VecDeque<usize>>> =
        (0..128).map(|_| BTreeMap::new()).collect();
    for (index, note) in timeline.notes.iter().enumerate() {
        targets[note.midi as usize]
            .entry(note.start_ms.max(0.).to_bits())
            .or_default()
            .push_back(index);
    }
    for event in sorted {
        let pitch_targets = &mut targets[event.midi as usize];
        let key = event.at_ms.max(0.).to_bits();
        let before = pitch_targets
            .range(..=key)
            .next_back()
            .map(|(time, indices)| (*time, indices[0]));
        let after = pitch_targets
            .range(key..)
            .next()
            .map(|(time, indices)| (*time, indices[0]));
        let best = before
            .into_iter()
            .chain(after)
            .filter(|(_, i)| (timeline.notes[*i].start_ms - event.at_ms).abs() <= tolerance_ms)
            .min_by(|(_, a), (_, b)| {
                (timeline.notes[*a].start_ms - event.at_ms)
                    .abs()
                    .total_cmp(&(timeline.notes[*b].start_ms - event.at_ms).abs())
                    .then(a.cmp(b))
            });
        if let Some((time, i)) = best {
            let bucket = pitch_targets
                .get_mut(&time)
                .expect("selected existing bucket");
            bucket.pop_front();
            if bucket.is_empty() {
                pitch_targets.remove(&time);
            }
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
    Ok(Assessment {
        summary,
        hits,
        misses,
        extras,
        accuracy_percent,
        mean_abs_error_ms,
    })
}

pub fn catalog() -> Vec<Score> {
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
    let mut scale=Score { version:1,id:"first-steps".into(),title:"初见 · First Steps".into(),composer:"WorldMusicHub original exercise".into(),provenance:Provenance {kind:"original_exercise".into(),attribution:"Newly authored pedagogical scale exercise for WorldMusicHub; not a transcription of a song".into(),source_url:None,license:Some("CC0-1.0".into())},parts:vec![Part {id:"piano".into(),name:"Piano".into(),instrument:"piano".into(),notes}],tempo:vec![Tempo {at:Beat::ZERO,bpm:90.}],meters:vec![Meter {at:Beat::ZERO,numerator:4,denominator:4}],keys:vec![Key {at:Beat::ZERO,fifths:0,mode:"major".into()}],measures:(0..4).map(|i|Measure {number:i+1,at:Beat::new(i as i64*4,1),length:Beat::new(4,1)}).collect(),repeats:vec![],source:None};
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
    scores
}

#[cfg(test)]
mod tests {
    use super::*;
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
    fn all_original_exercises_compile() {
        for s in catalog() {
            let n = s
                .parts
                .iter()
                .flat_map(|p| &p.notes)
                .filter(|n| n.pitch.is_some())
                .count();
            let c = compile(s).unwrap();
            assert_eq!(c.timeline.notes.len(), n);
        }
    }
    #[test]
    fn source_roundtrip_preserves_notation() {
        let mut s = catalog().remove(0);
        s.source = Some(Source {
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
    fn dense_performance_matching_is_one_to_one_and_bounded() {
        let notes = (0..20_000)
            .map(|i| TimedNote {
                velocity: 90,
                id: format!("n-{i}"),
                source_note_id: format!("n-{i}"),
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
}

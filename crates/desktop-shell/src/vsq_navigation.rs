//! Display-only VSQ navigation on the already selected native practice clock.
//! Source notation, all premeasure intervals and every original ID remain intact.
use score_core::{
    navigation::{NotationNavigation, SoundingGroup},
    vsq_clean::{PracticeChoice, PracticeRuntime, VsqCompleteScore},
    Beat, Diagnostic, Timeline,
};
use serde::Serialize;
use std::collections::{BTreeMap, BTreeSet};

const MAX_BYTES: usize = 16 * 1024 * 1024;
const MAX_CURSOR_BYTES: usize = 4 * 1024 * 1024;

#[derive(Debug, Serialize)]
pub(super) struct PracticeNavigation {
    profile: &'static str,
    content_sha256: String,
    source_sha256: String,
    runtime_profile: String,
    choice: PracticeChoice,
    practice_origin_tick: u64,
    /// Signed practice-relative start of source project tick zero.
    clock_start_ms: f64,
    /// Last original written measure boundary; not a playback or acoustic tail.
    written_end_ms: f64,
    #[serde(flatten)]
    navigation: NotationNavigation,
}

/// Reuse the ordinary navigation validator and its 100,000 occurrence /
/// 1,000,000 reference limits for exact written membership. Replace every
/// display clock from authoritative VSQ ticks; never offset approximate BPM ms.
/// No modification to the ordinary navigation path or its limits is needed.
pub(super) fn compile(
    score: &VsqCompleteScore,
    runtime: &PracticeRuntime,
    timeline: &Timeline,
    content_sha256: &str,
) -> Result<PracticeNavigation, String> {
    score_core::vsq_clean::validate(score)?;
    if !score.notation.repeats.is_empty()
        || runtime.profile != "wmh-vsq-base-note-practice-v1"
        || runtime.choice != PracticeChoice::BaseNotesInstrumental
        || runtime.source_sha256 != score.source.sha256
        || runtime.practice_origin_tick != score.authoring.premeasure_ticks
        || runtime.project_ppq != score.authoring.ppq
        || timeline.duration_ms != runtime.end_ms
        || timeline.notes.len() != runtime.notes.len()
    {
        return Err("VSQ navigation does not match the selected native practice runtime".into());
    }
    let ppq = u128::from(score.authoring.ppq);
    let tick = |beat: Beat| -> Result<u64, String> {
        if beat.numerator < 0 || beat.denominator <= 0 {
            return Err("VSQ written coordinates must remain nonnegative source beats".into());
        }
        let numerator = beat.numerator as u128 * ppq;
        let denominator = beat.denominator as u128;
        if !numerator.is_multiple_of(denominator) {
            return Err("VSQ written boundary is not an exact source tick".into());
        }
        u64::try_from(numerator / denominator).map_err(|_| "VSQ source tick overflow".into())
    };
    let tempo = &score.authoring.tempo;
    let mut prefix = Vec::with_capacity(tempo.len());
    let mut accumulated = 0_u128;
    for (i, change) in tempo.iter().enumerate() {
        if i > 0 {
            let previous = &tempo[i - 1];
            accumulated += u128::from(change.tick - previous.tick)
                * u128::from(previous.microseconds_per_quarter);
        }
        prefix.push(accumulated);
    }
    let project_time = |tick: u64| {
        let i = tempo.partition_point(|change| change.tick <= tick) - 1;
        prefix[i] + u128::from(tick - tempo[i].tick) * u128::from(tempo[i].microseconds_per_quarter)
    };
    let origin = project_time(runtime.practice_origin_tick);
    let milliseconds = |ticks: u64| {
        let project = project_time(ticks);
        let delta = project.abs_diff(origin);
        let divisor = ppq * 1000;
        let value = (delta / divisor) as f64 + (delta % divisor) as f64 / divisor as f64;
        if project < origin {
            -value
        } else {
            value
        }
    };
    if milliseconds(runtime.project_end_tick) != runtime.end_ms {
        return Err("VSQ navigation and native practice end clocks disagree".into());
    }
    let source_notes: BTreeMap<_, _> = score
        .notation
        .parts
        .iter()
        .flat_map(|part| {
            part.notes
                .iter()
                .map(move |note| (note.id.as_str(), (part.id.as_str(), note)))
        })
        .collect();
    let runtime_notes: BTreeMap<_, _> = runtime
        .notes
        .iter()
        .map(|note| (note.note_id.as_str(), note))
        .collect();
    if runtime_notes.len() != runtime.notes.len() || runtime_notes.len() != source_notes.len() {
        return Err("VSQ navigation requires every unique authored note".into());
    }
    let mut target_ids = BTreeSet::new();
    for target in &timeline.notes {
        if !target_ids.insert(target.id.as_str()) {
            return Err("VSQ navigation requires unique native target IDs".into());
        }
        let note = runtime_notes
            .get(target.id.as_str())
            .ok_or("Unknown native VSQ target ID")?;
        let (part_id, source) = source_notes
            .get(target.id.as_str())
            .ok_or("Unknown written VSQ note ID")?;
        let source_end = source
            .at
            .checked_add(source.duration)
            .ok_or("VSQ written end overflow")?;
        if target.source_note_id != note.note_id
            || target.source_note_ids.len() != 1
            || target.source_note_ids.first() != Some(&note.note_id)
            || target.part_id != note.part_id
            || target.part_id != *part_id
            || target.voice != note.singer_event_id
            || target.voice != source.voice
            || target.midi != note.key
            || target.start_ms != note.start_ms
            || target.duration_ms != note.end_ms - note.start_ms
            || tick(source.at)? != note.project_start_tick
            || tick(source_end)? != note.project_end_tick
            || milliseconds(note.project_start_tick) != note.start_ms
            || milliseconds(note.project_end_tick) != note.end_ms
        {
            return Err(
                "VSQ written identity or exact source clock disagrees with its native target"
                    .into(),
            );
        }
    }
    let mut navigation = score_core::navigation::notation_navigation(score.notation.clone())?;
    for occurrence in &mut navigation.occurrences {
        occurrence.start_ms = milliseconds(tick(occurrence.source_from)?);
        occurrence.end_ms = milliseconds(tick(occurrence.source_to)?);
        if !occurrence.start_ms.is_finite()
            || !occurrence.end_ms.is_finite()
            || occurrence.end_ms <= occurrence.start_ms
        {
            return Err(
                "VSQ written measure interval is too small for a reliable display clock".into(),
            );
        }
    }
    if let Some(cursor) = &mut navigation.written_cursor {
        for span in &mut cursor.spans {
            let source = source_notes[cursor.source_note_ids[span.source_note_index].as_str()].1;
            let occurrence = &navigation.occurrences[span.measure_occurrence_index];
            let source_end = source
                .at
                .checked_add(source.duration)
                .ok_or("VSQ written end overflow")?;
            let from = if source.at.compare(occurrence.source_from).is_gt() {
                source.at
            } else {
                occurrence.source_from
            };
            let to = if source_end.compare(occurrence.source_to).is_lt() {
                source_end
            } else {
                occurrence.source_to
            };
            span.start_ms = milliseconds(tick(from)?);
            span.end_ms = milliseconds(tick(to)?);
            if !span.start_ms.is_finite()
                || !span.end_ms.is_finite()
                || span.end_ms <= span.start_ms
            {
                return Err(
                    "VSQ written note interval is too small for a reliable display clock".into(),
                );
            }
        }
    }
    navigation.sounding_groups = runtime
        .notes
        .iter()
        .map(|note| SoundingGroup {
            occurrence_id: note.note_id.clone(),
            part_id: note.part_id.clone(),
            source_note_ids: vec![note.note_id.clone()],
            start_ms: note.start_ms,
            end_ms: note.end_ms,
        })
        .collect();
    navigation.duration_ms = runtime.end_ms;
    navigation
        .diagnostics
        .retain(|d| d.code != "notation_following_scope");
    navigation.diagnostics.push(warning("vsq_practice_navigation_scope", "Display-only source measures use the exact native VSQ practice clock. Premeasure intervals remain before time zero. Written extent may differ from declared playback end; no measures or acoustic tails are invented. Authoring, unknown source key and practice targets are unchanged.", None));
    let clock_start_ms = navigation
        .occurrences
        .first()
        .ok_or("VSQ has no written measure map")?
        .start_ms;
    let written_end_ms = navigation
        .occurrences
        .last()
        .ok_or("VSQ has no written measure map")?
        .end_ms;
    let mut output = PracticeNavigation {
        profile: "wmh-vsq-practice-navigation-v1",
        content_sha256: content_sha256.into(),
        source_sha256: score.source.sha256.clone(),
        runtime_profile: runtime.profile.clone(),
        choice: runtime.choice,
        practice_origin_tick: runtime.practice_origin_tick,
        clock_start_ms,
        written_end_ms,
        navigation,
    };
    // Re-clocking can change serialized lengths; enforce the original independent
    // cursor and response limits again rather than relying on the earlier BPM DTO.
    if output
        .navigation
        .written_cursor
        .as_ref()
        .is_some_and(|cursor| !fits(cursor, MAX_CURSOR_BYTES))
    {
        drop_cursor(&mut output);
    }
    if !fits(&output, MAX_BYTES) && output.navigation.written_cursor.is_some() {
        drop_cursor(&mut output);
    }
    if !fits(&output, MAX_BYTES) {
        return Err("VSQ notation following exceeds 16 MiB; use manual paging. Source and playback are unchanged".into());
    }
    Ok(output)
}
fn drop_cursor(output: &mut PracticeNavigation) {
    output.navigation.written_cursor = None;
    output.navigation.diagnostics.push(warning("notation_written_cursor_unavailable", "Complete VSQ written cursor exceeds the existing navigation size bound. Measure navigation, source and practice playback are unchanged.", None));
}

pub(super) fn fits(value: &impl Serialize, maximum: usize) -> bool {
    struct Size {
        remaining: usize,
    }
    impl std::io::Write for Size {
        fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
            self.remaining = self
                .remaining
                .checked_sub(bytes.len())
                .ok_or_else(|| std::io::Error::other("Navigation response bound exceeded"))?;
            Ok(bytes.len())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }
    serde_json::to_writer(Size { remaining: maximum }, value).is_ok()
}

fn warning(code: &str, message: impl Into<String>, note_id: Option<String>) -> Diagnostic {
    Diagnostic {
        severity: "warning".into(),
        code: code.into(),
        message: message.into(),
        note_id,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> (VsqCompleteScore, PracticeRuntime, Timeline) {
        let score = score_core::vsq_clean::decode_json(include_bytes!(
            "../../../tests/fixtures/vsq-clean-v1/score.json"
        ))
        .unwrap();
        let runtime =
            score_core::vsq_clean::compile_practice(&score, PracticeChoice::BaseNotesInstrumental)
                .unwrap();
        let response: serde_json::Value = serde_json::from_slice(include_bytes!(
            "../../../tests/fixtures/vsq-clean-v1-runtime.json"
        ))
        .unwrap();
        let timeline = serde_json::from_value(response["compilation"]["timeline"].clone()).unwrap();
        (score, runtime, timeline)
    }
    #[test]
    fn navigation_rejects_forged_source_target_identity_and_clock() {
        let (score, mut runtime, mut timeline) = fixture();
        assert!(compile(&score, &runtime, &timeline, "fixture").is_ok());
        timeline.notes[1] = timeline.notes[0].clone();
        assert!(compile(&score, &runtime, &timeline, "fixture")
            .unwrap_err()
            .contains("unique native target"));
        let (_, _, timeline) = fixture();
        runtime.notes[0].end_ms += 0.125;
        assert!(compile(&score, &runtime, &timeline, "fixture").is_err());
        let (mut score, runtime, timeline) = fixture();
        score.notation.measures[0].number = 99;
        assert!(compile(&score, &runtime, &timeline, "fixture").is_err());
    }
    #[test]
    fn independent_navigation_size_bound_is_inclusive() {
        let value = serde_json::json!({"clock":-2000.0,"ids":["source-1","source-2"]});
        let bytes = serde_json::to_vec(&value).unwrap().len();
        assert!(fits(&value, bytes));
        assert!(!fits(&value, bytes - 1));
    }
}

//! A reversible ownership view of one unchanged canonical song.
//!
//! Persist `AssistancePlan`, then validate it against the saved `Score` on every
//! load. Derived timelines are never trusted input. Only `human_targets.timeline`
//! belongs in assessment; `machine_timeline` is playback data, never input events.
use crate::{
    compile,
    instruments::InstrumentProfile,
    targets::{plan_targets, PracticeTargets, TargetGroup},
    Diagnostic, Score, Timeline,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};

pub const ASSISTANCE_SCHEMA_VERSION: u32 = 1;
pub const ASSISTANCE_PLANNER_REVISION: u32 = 1;
pub const SOURCE_SERIALIZATION_REVISION: u32 = 1;
const MAX_SOURCE_BYTES: usize = 8 * 1024 * 1024;
const SOURCE_SERIALIZATION: &str = "worldmusichub-score-serde-json";
const SOURCE_DIGEST_ALGORITHM: &str = "sha256";

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct SourceContentBinding {
    pub algorithm: String,
    pub serialization: String,
    pub serialization_revision: u32,
    /// Lowercase SHA-256 of exact Rust serde Score bytes, including retained
    /// source. This binds content; it is not a signature or proof of authenticity.
    pub digest: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct AssistancePlan {
    pub schema_version: u32,
    pub planner_revision: u32,
    /// Positive saved-plan revision. Storage must compare revisions when updating.
    pub revision: u32,
    pub score_id: String,
    /// Compact content binding. Keep the original score once, outside the plan.
    pub source_binding: SourceContentBinding,
    /// Explicit nonempty part scope. Other parts remain machine accompaniment.
    pub selected_part_ids: Vec<String>,
    pub profile: InstrumentProfile,
    /// Written pitched IDs, never occurrence IDs. All repeats share this choice.
    /// Empty means machine-only; complete selected scope means full human level.
    pub human_source_note_ids: Vec<String>,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum NoteOwner {
    Human,
    Machine,
}

#[derive(Clone, Debug, Serialize)]
pub struct OwnedTargetGroup {
    pub owner: NoteOwner,
    pub group: TargetGroup,
}

#[derive(Clone, Debug, Serialize)]
pub struct SourceOwnership {
    pub source_note_id: String,
    pub part_id: String,
    pub owner: NoteOwner,
    pub in_selected_scope: bool,
}

#[derive(Clone, Debug, Serialize)]
pub struct AssistanceCoverage {
    /// Written pitched notes only; rests keep their original timing and notation.
    pub source_note_count: usize,
    pub selected_source_note_count: usize,
    pub human_source_note_count: usize,
    pub machine_source_note_count: usize,
    pub occurrence_count: usize,
    pub human_occurrence_count: usize,
    pub machine_occurrence_count: usize,
    pub selected_target_count: usize,
    pub human_target_count: usize,
    pub machine_selected_target_count: usize,
}

/// Output-only: always regenerate from a validated persisted plan and exact Score.
#[derive(Clone, Debug, Serialize)]
pub struct CheckedAssistancePlan {
    pub plan: AssistancePlan,
    pub human_targets: PracticeTargets,
    /// Every non-human canonical sounding occurrence, including outside scope.
    /// No grouping, timing rewrite, transposition, or synthetic input conversion.
    pub machine_timeline: Timeline,
    /// Complete written pitched-note mapping for color and non-color ownership UI.
    pub source_ownership: Vec<SourceOwnership>,
    /// Physical groups within selected parts, using the existing target engine.
    pub selected_target_groups: Vec<OwnedTargetGroup>,
    pub coverage: AssistanceCoverage,
    pub all_selected_human: bool,
    /// Existing range/onset feasibility only; does not certify hand reach/sustain.
    pub full_scope_playable: bool,
    pub full_scope_diagnostics: Vec<Diagnostic>,
    /// False for machine-only and for infeasible selected human targets.
    pub scored_mode_allowed: bool,
    pub diagnostics: Vec<Diagnostic>,
}

#[derive(Clone, Debug, Serialize)]
pub struct AssistanceError {
    /// Stable language-independent code; callers can localize presentation.
    pub code: String,
    pub message: String,
    pub source_note_ids: Vec<String>,
}
impl AssistanceError {
    fn new(code: &str, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
            source_note_ids: vec![],
        }
    }
    fn notes(mut self, ids: Vec<String>) -> Self {
        self.source_note_ids = ids;
        self
    }
}
impl std::fmt::Display for AssistanceError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.code, self.message)
    }
}
impl std::error::Error for AssistanceError {}

fn sha256_hex(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn source_binding(score: &Score) -> Result<SourceContentBinding, AssistanceError> {
    crate::validate(score)
        .map_err(|message| AssistanceError::new("assistance_invalid_score", message))?;
    let bytes = serde_json::to_vec(score)
        .map_err(|e| AssistanceError::new("assistance_source_binding", e.to_string()))?;
    if bytes.len() > MAX_SOURCE_BYTES {
        return Err(AssistanceError::new(
            "assistance_source_limit",
            "Canonical serialized score exceeds 8 MiB; no source was truncated",
        ));
    }
    Ok(SourceContentBinding {
        algorithm: SOURCE_DIGEST_ALGORITHM.into(),
        serialization: SOURCE_SERIALIZATION.into(),
        serialization_revision: SOURCE_SERIALIZATION_REVISION,
        digest: sha256_hex(&bytes),
    })
}

/// Create revision 1 without mutating the score. Selection is explicit, never
/// inferred from MIDI tracks, voices, staff numbers, density, or instrument names.
pub fn create_assistance_plan(
    score: &Score,
    selected_part_ids: &[String],
    profile: &InstrumentProfile,
    human_source_note_ids: &[String],
) -> Result<CheckedAssistancePlan, AssistanceError> {
    let plan = AssistancePlan {
        schema_version: ASSISTANCE_SCHEMA_VERSION,
        planner_revision: ASSISTANCE_PLANNER_REVISION,
        revision: 1,
        score_id: score.id.clone(),
        source_binding: source_binding(score)?,
        selected_part_ids: selected_part_ids.to_vec(),
        profile: profile.clone(),
        human_source_note_ids: human_source_note_ids.to_vec(),
    };
    validate_assistance_plan(score, &plan)
}

/// Revalidate a persisted selection. Unsupported versions, changed source,
/// unknown IDs and partially owned atomic groups fail without repairing the plan.
pub fn validate_assistance_plan(
    score: &Score,
    plan: &AssistancePlan,
) -> Result<CheckedAssistancePlan, AssistanceError> {
    if plan.schema_version != ASSISTANCE_SCHEMA_VERSION {
        return Err(AssistanceError::new(
            "assistance_schema_version",
            "Unsupported assistance schema version",
        ));
    }
    if plan.planner_revision != ASSISTANCE_PLANNER_REVISION {
        return Err(AssistanceError::new(
            "assistance_planner_revision",
            "Unsupported assistance planner revision",
        ));
    }
    if plan.revision == 0 {
        return Err(AssistanceError::new(
            "assistance_plan_revision",
            "Saved plan revision must be positive",
        ));
    }
    if plan.source_binding.algorithm != SOURCE_DIGEST_ALGORITHM {
        return Err(AssistanceError::new(
            "assistance_binding_algorithm",
            "Unsupported assistance source digest algorithm",
        ));
    }
    if plan.source_binding.serialization != SOURCE_SERIALIZATION
        || plan.source_binding.serialization_revision != SOURCE_SERIALIZATION_REVISION
    {
        return Err(AssistanceError::new(
            "assistance_binding_serialization",
            "Unsupported assistance source serialization or revision",
        ));
    }
    if plan.source_binding.digest.len() != 64
        || !plan
            .source_binding
            .digest
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err(AssistanceError::new(
            "assistance_binding_digest",
            "Source binding requires a 64-character lowercase SHA-256 digest",
        ));
    }
    if plan.score_id != score.id || plan.source_binding != source_binding(score)? {
        return Err(AssistanceError::new(
            "assistance_source_mismatch",
            "Plan does not match this exact saved canonical score and retained source",
        ));
    }
    if plan.selected_part_ids.is_empty()
        || plan.selected_part_ids.len() > 128
        || plan.human_source_note_ids.len() > 100_000
        || plan
            .selected_part_ids
            .iter()
            .chain(&plan.human_source_note_ids)
            .any(|id| id.is_empty() || id.len() > 128)
    {
        return Err(AssistanceError::new(
            "assistance_selection_limit",
            "Choose 1–128 parts and at most 100,000 written human note IDs; identifiers must contain 1–128 bytes",
        ));
    }
    let mut selected = HashSet::new();
    for id in &plan.selected_part_ids {
        if !selected.insert(id.as_str()) {
            return Err(AssistanceError::new(
                "assistance_duplicate_part",
                "Selected part IDs must be unique",
            ));
        }
        if !score.parts.iter().any(|part| part.id == *id) {
            return Err(AssistanceError::new(
                "assistance_unknown_part",
                "A selected part is absent from the source score",
            ));
        }
    }
    let source: HashMap<_, _> = score
        .parts
        .iter()
        .flat_map(|part| {
            part.notes
                .iter()
                .map(move |note| (note.id.as_str(), (part, note)))
        })
        .collect();
    let mut human = HashSet::new();
    for id in &plan.human_source_note_ids {
        if !human.insert(id.as_str()) {
            return Err(AssistanceError::new(
                "assistance_duplicate_note",
                "Human source note IDs must be unique",
            )
            .notes(vec![id.clone()]));
        }
        let (part, note) = source.get(id.as_str()).ok_or_else(|| {
            AssistanceError::new(
                "assistance_unknown_note",
                "Human selection must reference existing written source note IDs",
            )
            .notes(vec![id.clone()])
        })?;
        if !selected.contains(part.id.as_str()) {
            return Err(AssistanceError::new(
                "assistance_note_outside_scope",
                "A human note is outside the selected parts",
            )
            .notes(vec![id.clone()]));
        }
        if note.pitch.is_none() {
            return Err(AssistanceError::new(
                "assistance_rest_selection",
                "Rests cannot be human attack targets",
            )
            .notes(vec![id.clone()]));
        }
    }
    let compiled = compile(score.clone())
        .map_err(|message| AssistanceError::new("assistance_compile", message))?;
    // Compilation can preserve malformed ties as separate events with warnings.
    // Ownership planning must not silently treat such a tie as independent notes.
    let retained_diagnostic_count = score
        .source
        .as_ref()
        .and_then(|source| source.import_diagnostics.as_ref())
        .map_or(0, Vec::len);
    if let Some(diagnostic) = compiled
        .diagnostics
        .iter()
        .skip(retained_diagnostic_count)
        .find(|d| {
            matches!(
                d.code.as_str(),
                "broken_tie" | "orphan_tie" | "unclosed_tie"
            )
        })
    {
        return Err(AssistanceError::new(
            "assistance_unresolved_tie",
            "Correct unresolved source ties before assigning note ownership",
        )
        .notes(diagnostic.note_id.iter().cloned().collect()));
    }
    let selected_timeline = Timeline {
        notes: compiled
            .timeline
            .notes
            .iter()
            .filter(|note| selected.contains(note.part_id.as_str()))
            .cloned()
            .collect(),
        duration_ms: compiled.timeline.duration_ms,
    };
    let selected_targets = plan_targets(&selected_timeline, &plan.profile)
        .map_err(|message| AssistanceError::new("assistance_target_plan", message))?;
    let mut human_occurrences = HashSet::new();
    let mut selected_target_groups = Vec::with_capacity(selected_targets.groups.len());
    for group in &selected_targets.groups {
        let count = group
            .source_note_ids
            .iter()
            .filter(|id| human.contains(id.as_str()))
            .count();
        if count != 0 && count != group.source_note_ids.len() {
            return Err(AssistanceError::new(
                "assistance_partial_group",
                "Every source segment of a tie or exact selected piano unison must share ownership",
            )
            .notes(group.source_note_ids.clone()));
        }
        let owner = if count == 0 {
            NoteOwner::Machine
        } else {
            human_occurrences.extend(group.source_occurrence_ids.iter().map(String::as_str));
            NoteOwner::Human
        };
        selected_target_groups.push(OwnedTargetGroup {
            owner,
            group: group.clone(),
        });
    }
    let mut human_timeline = Timeline {
        notes: vec![],
        duration_ms: compiled.timeline.duration_ms,
    };
    let mut machine_timeline = Timeline {
        notes: vec![],
        duration_ms: compiled.timeline.duration_ms,
    };
    for note in &compiled.timeline.notes {
        if human_occurrences.contains(note.id.as_str()) {
            human_timeline.notes.push(note.clone());
        } else {
            machine_timeline.notes.push(note.clone());
        }
    }
    let human_targets = plan_targets(&human_timeline, &plan.profile)
        .map_err(|message| AssistanceError::new("assistance_target_plan", message))?;
    let mut source_ownership = vec![];
    let mut selected_source_note_count = 0;
    for part in &score.parts {
        for note in part.notes.iter().filter(|note| note.pitch.is_some()) {
            let in_selected_scope = selected.contains(part.id.as_str());
            selected_source_note_count += usize::from(in_selected_scope);
            source_ownership.push(SourceOwnership {
                source_note_id: note.id.clone(),
                part_id: part.id.clone(),
                owner: if human.contains(note.id.as_str()) {
                    NoteOwner::Human
                } else {
                    NoteOwner::Machine
                },
                in_selected_scope,
            });
        }
    }
    let coverage = AssistanceCoverage {
        source_note_count: source_ownership.len(),
        selected_source_note_count,
        human_source_note_count: human.len(),
        machine_source_note_count: source_ownership.len() - human.len(),
        occurrence_count: compiled.timeline.notes.len(),
        human_occurrence_count: human_timeline.notes.len(),
        machine_occurrence_count: machine_timeline.notes.len(),
        selected_target_count: selected_targets.target_count,
        human_target_count: human_targets.target_count,
        machine_selected_target_count: selected_targets.target_count - human_targets.target_count,
    };
    let mut diagnostics = compiled.diagnostics;
    diagnostics.push(Diagnostic::warning(
        "assistance_feasibility_scope",
        "Feasibility uses the selected instrument's existing range and simultaneous-onset checks. It does not certify hand reach, sustained overlaps, fingering, or a whole ensemble's playability. Outside-selected parts remain machine accompaniment.",
        None,
    ));
    if human_targets.target_count == 0 {
        diagnostics.push(Diagnostic::warning(
            "assistance_machine_only",
            "There are no human assessment targets in this plan",
            None,
        ));
    }
    let mut normalized = plan.clone();
    normalized.selected_part_ids.sort();
    normalized.human_source_note_ids.sort();
    Ok(CheckedAssistancePlan {
        plan: normalized,
        all_selected_human: selected_source_note_count > 0
            && human.len() == selected_source_note_count,
        full_scope_playable: selected_targets.playable,
        full_scope_diagnostics: selected_targets.diagnostics,
        scored_mode_allowed: human_targets.playable,
        human_targets,
        machine_timeline,
        source_ownership,
        selected_target_groups,
        coverage,
        diagnostics,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{assess, catalog, Beat, InputEvent, Repeat, Source};

    fn piano() -> InstrumentProfile {
        InstrumentProfile::Piano {
            key_count: 88,
            lowest_midi: None,
        }
    }
    fn fixture() -> Score {
        let mut score = catalog().remove(0); // Newly authored original exercise.
        score.parts[0].notes.truncate(2);
        score.parts[0].notes[0].id = "first".into();
        score.parts[0].notes[1].id = "second".into();
        score.parts[0].notes[0].at = Beat::ZERO;
        score.parts[0].notes[0].duration = Beat::new(1, 1);
        score.parts[0].notes[1].at = Beat::new(1, 1);
        score.parts[0].notes[1].duration = Beat::new(1, 1);
        score.parts[0].notes[1].pitch = score.parts[0].notes[0].pitch.clone();
        score
    }
    fn ids(values: &[&str]) -> Vec<String> {
        values.iter().map(|s| (*s).into()).collect()
    }
    fn plan(score: &Score, human: &[&str]) -> CheckedAssistancePlan {
        create_assistance_plan(score, &ids(&["piano"]), &piano(), &ids(human)).unwrap()
    }
    fn json(value: &impl Serialize) -> serde_json::Value {
        serde_json::to_value(value).unwrap()
    }
    fn tied() -> Score {
        let mut score = fixture();
        score.parts[0].notes[0].tie_start = true;
        score.parts[0].notes[1].tie_stop = true;
        score.parts[0].notes[1].voice = "other-voice".into();
        score.parts[0].notes[1].staff = 2;
        score
    }
    fn unison() -> Score {
        let mut score = fixture();
        score.parts[0].notes[1].at = Beat::ZERO;
        score.parts[0].notes[1].duration = Beat::new(2, 1);
        score.parts[0].notes[1].voice = "other-voice".into();
        score
    }

    #[test]
    fn machine_only_preserves_complete_playback_and_has_no_assessment_targets() {
        let score = fixture();
        let expected = compile(score.clone()).unwrap().timeline;
        let result = plan(&score, &[]);
        assert_eq!(json(&result.machine_timeline), json(&expected));
        assert!(result.human_targets.timeline.notes.is_empty());
        assert!(!result.scored_mode_allowed);
        assert!(!result.all_selected_human);
        assert_eq!(result.coverage.human_target_count, 0);
        assert_eq!(result.coverage.machine_source_note_count, 2);
        assert_eq!(
            result.coverage.machine_occurrence_count,
            expected.notes.len()
        );
        let grade = assess(&result.human_targets.timeline, &[], 180.).unwrap();
        assert!(grade.hits.is_empty() && grade.misses.is_empty());
        assert!(grade.pitch_breakdown.is_empty());
    }

    #[test]
    fn all_human_is_identical_to_existing_targets_and_keeps_the_entire_source() {
        let mut score = fixture();
        score.source = Some(Source {
            format: "original".into(),
            filename: Some("original-exercise.xml".into()),
            content: "\u{feff}<original> 原始\r\n</original>".into(),
            import_diagnostics: None,
        });
        let before = json(&score);
        let expected = plan_targets(&compile(score.clone()).unwrap().timeline, &piano()).unwrap();
        let result = plan(&score, &["second", "first"]);
        assert_eq!(json(&result.human_targets), json(&expected));
        assert!(result.machine_timeline.notes.is_empty());
        assert_eq!(
            result.machine_timeline.duration_ms,
            expected.timeline.duration_ms
        );
        assert!(result.all_selected_human && result.scored_mode_allowed);
        assert_eq!(result.plan.human_source_note_ids, ids(&["first", "second"]));
        assert_eq!(json(&score), before);
        let saved: AssistancePlan = serde_json::from_value(json(&result.plan)).unwrap();
        assert_eq!(
            json(&validate_assistance_plan(&score, &saved).unwrap()),
            json(&result)
        );
        let inputs: Vec<_> = expected
            .timeline
            .notes
            .iter()
            .map(|note| InputEvent {
                midi: note.midi,
                at_ms: note.start_ms,
                velocity: 90,
            })
            .collect();
        assert_eq!(
            json(&assess(&result.human_targets.timeline, &inputs, 180.).unwrap()),
            json(&assess(&expected.timeline, &inputs, 180.).unwrap())
        );
    }

    #[test]
    fn machine_notes_cannot_capture_input_or_enter_human_denominators() {
        let score = fixture();
        let result = plan(&score, &["second"]);
        let machine = &result.machine_timeline.notes[0];
        let human = &result.human_targets.timeline.notes[0];
        let inputs = [machine, human].map(|note| InputEvent {
            midi: note.midi,
            at_ms: note.start_ms,
            velocity: 90,
        });
        let grade = assess(&result.human_targets.timeline, &inputs, 180.).unwrap();
        assert_eq!(grade.hits.len(), 1);
        assert_eq!(grade.hits[0].note_id, "second");
        assert_eq!(grade.extras.len(), 1);
        assert_eq!(grade.extras[0].at_ms, machine.start_ms);
        assert!(grade.misses.is_empty());
        assert_eq!(grade.pitch_breakdown[0].expected, 1);
        assert_eq!(grade.onset_completion.unwrap().total, 1);
        assert_eq!(
            result.coverage.occurrence_count,
            result.coverage.human_occurrence_count + result.coverage.machine_occurrence_count
        );
        // A closer machine attack must not steal the only physical human input.
        let mut close = score;
        close.parts[0].notes[1].at = Beat::new(1, 100);
        let result = plan(&close, &["second"]);
        let input = InputEvent {
            midi: result.machine_timeline.notes[0].midi,
            at_ms: 0.,
            velocity: 90,
        };
        let grade = assess(&result.human_targets.timeline, &[input], 180.).unwrap();
        assert_eq!(grade.hits.len(), 1);
        assert_eq!(grade.hits[0].note_id, "second");
        assert!(grade.misses.is_empty() && grade.extras.is_empty());
    }

    #[test]
    fn ties_require_every_written_segment_and_retain_cross_lane_provenance() {
        let score = tied();
        for human in [&["first"][..], &["second"][..]] {
            let error = create_assistance_plan(&score, &ids(&["piano"]), &piano(), &ids(human))
                .unwrap_err();
            assert_eq!(error.code, "assistance_partial_group");
            assert_eq!(error.source_note_ids, ids(&["first", "second"]));
        }
        let result = plan(&score, &["first", "second"]);
        assert_eq!(result.coverage.human_source_note_count, 2);
        assert_eq!(result.coverage.human_occurrence_count, 1);
        assert_eq!(result.coverage.human_target_count, 1);
        assert_eq!(
            result.human_targets.groups[0].source_note_ids,
            ids(&["first", "second"])
        );
        assert!(result
            .diagnostics
            .iter()
            .any(|d| d.code == "cross_lane_tie"));
        let machine = plan(&score, &[]);
        assert_eq!(
            machine.machine_timeline.notes[0].source_note_ids,
            ids(&["first", "second"])
        );
        assert_eq!(
            json(&machine.machine_timeline),
            json(&compile(score).unwrap().timeline)
        );
    }

    #[test]
    fn exact_piano_unisons_are_atomic_but_guitar_events_remain_distinct() {
        let score = unison();
        let error = create_assistance_plan(&score, &ids(&["piano"]), &piano(), &ids(&["first"]))
            .unwrap_err();
        assert_eq!(error.code, "assistance_partial_group");
        let result = plan(&score, &["first", "second"]);
        assert_eq!(result.coverage.human_occurrence_count, 2);
        assert_eq!(result.coverage.human_target_count, 1);
        assert_eq!(
            result.human_targets.groups[0].source_occurrence_ids.len(),
            2
        );
        let guitar = InstrumentProfile::Guitar {
            tuning: vec![40, 45, 50, 55, 59, 64],
            frets: 24,
            capo: 0,
        };
        let result =
            create_assistance_plan(&score, &ids(&["piano"]), &guitar, &ids(&["first"])).unwrap();
        assert_eq!(result.coverage.human_target_count, 1);
        assert_eq!(result.coverage.machine_occurrence_count, 1);
    }

    #[test]
    fn close_rearticulations_never_become_unison_ownership_groups() {
        let mut score = unison();
        score.parts[0].notes[1].at = Beat::new(1, 1000);
        let result = plan(&score, &["first"]);
        assert_eq!(result.coverage.selected_target_count, 2);
        assert_eq!(result.coverage.human_target_count, 1);
        assert_eq!(result.machine_timeline.notes[0].id, "second");
    }

    #[test]
    fn written_ownership_is_consistent_across_every_repeat_and_tied_segment() {
        let mut score = tied();
        let mut plain = score.parts[0].notes[0].clone();
        plain.id = "third".into();
        plain.at = Beat::new(2, 1);
        plain.tie_start = false;
        score.parts[0].notes.push(plain);
        score.repeats.push(Repeat {
            from: Beat::ZERO,
            to: Beat::new(4, 1),
            times: 3,
        });
        let result = plan(&score, &["first", "second"]);
        assert_eq!(result.coverage.human_source_note_count, 2);
        assert_eq!(result.coverage.human_occurrence_count, 3);
        assert_eq!(result.coverage.machine_occurrence_count, 3);
        assert!(result
            .human_targets
            .groups
            .iter()
            .all(|g| g.source_note_ids == ids(&["first", "second"])));
        assert!(result
            .machine_timeline
            .notes
            .iter()
            .all(|n| n.source_note_id == "third"));
        let original = compile(score.clone()).unwrap().timeline;
        let mut combined = result.human_targets.timeline.notes.clone();
        combined.extend(result.machine_timeline.notes.clone());
        combined.sort_by(|a, b| {
            a.start_ms
                .total_cmp(&b.start_ms)
                .then(a.midi.cmp(&b.midi))
                .then(a.id.cmp(&b.id))
        });
        assert_eq!(json(&combined), json(&original.notes));
        let error = create_assistance_plan(
            &score,
            &ids(&["piano"]),
            &piano(),
            &[original.notes[0].id.clone()],
        )
        .unwrap_err();
        assert_eq!(error.code, "assistance_unknown_note");
    }

    #[test]
    fn outside_selected_parts_stay_machine_even_at_same_key_and_onset() {
        let mut score = fixture();
        let mut part = score.parts[0].clone();
        part.id = "accompaniment".into();
        for note in &mut part.notes {
            note.id = format!("machine-{}", note.id);
        }
        score.parts.push(part);
        let before = json(&score);
        let result = plan(&score, &["first", "second"]);
        assert!(result.all_selected_human);
        assert_eq!(result.coverage.selected_source_note_count, 2);
        assert_eq!(result.coverage.source_note_count, 4);
        assert_eq!(result.coverage.human_target_count, 2);
        assert_eq!(result.coverage.machine_occurrence_count, 2);
        assert!(result
            .machine_timeline
            .notes
            .iter()
            .all(|n| n.part_id == "accompaniment"));
        assert_eq!(json(&score), before);
        let error =
            create_assistance_plan(&score, &ids(&["piano"]), &piano(), &ids(&["machine-first"]))
                .unwrap_err();
        assert_eq!(error.code, "assistance_note_outside_scope");
    }

    #[test]
    fn repeated_exact_unisons_keep_all_occurrences_and_one_owner() {
        let mut score = unison();
        score.repeats.push(Repeat {
            from: Beat::ZERO,
            to: Beat::new(4, 1),
            times: 3,
        });
        let result = plan(&score, &["first", "second"]);
        assert_eq!(result.coverage.source_note_count, 2);
        assert_eq!(result.coverage.human_occurrence_count, 6);
        assert_eq!(result.coverage.human_target_count, 3);
        assert!(result.machine_timeline.notes.is_empty());
        assert!(result
            .selected_target_groups
            .iter()
            .all(|owned| owned.owner == NoteOwner::Human
                && owned.group.source_occurrence_ids.len() == 2));
        assert_eq!(
            create_assistance_plan(&score, &ids(&["piano"]), &piano(), &ids(&["first"]))
                .unwrap_err()
                .code,
            "assistance_partial_group"
        );
    }

    #[test]
    fn guitar_conflicts_are_checked_for_human_subset_and_full_scope_separately() {
        let score = unison();
        let guitar = InstrumentProfile::Guitar {
            tuning: vec![60],
            frets: 0,
            capo: 0,
        };
        let assisted =
            create_assistance_plan(&score, &ids(&["piano"]), &guitar, &ids(&["first"])).unwrap();
        assert!(assisted.scored_mode_allowed && !assisted.full_scope_playable);
        let full = create_assistance_plan(
            &score,
            &ids(&["piano"]),
            &guitar,
            &ids(&["first", "second"]),
        )
        .unwrap();
        assert!(full.all_selected_human && !full.scored_mode_allowed);
        assert_eq!(full.coverage.human_target_count, 2);
        assert!(full
            .human_targets
            .diagnostics
            .iter()
            .any(|d| d.code == "guitar_string_conflict"));
    }

    #[test]
    fn canonical_and_retained_source_changes_invalidate_saved_content_binding() {
        let mut score = fixture();
        score.source = Some(Source {
            format: "original".into(),
            filename: None,
            content: "original source\r\n".into(),
            import_diagnostics: None,
        });
        let saved = plan(&score, &["first"]).plan;
        let mut edited = score.clone();
        edited.parts[0].notes[1].velocity -= 1;
        assert_eq!(
            validate_assistance_plan(&edited, &saved).unwrap_err().code,
            "assistance_source_mismatch"
        );
        edited = score.clone();
        edited.source.as_mut().unwrap().content = "original source\n".into();
        assert_eq!(
            validate_assistance_plan(&edited, &saved).unwrap_err().code,
            "assistance_source_mismatch"
        );
        let mut forged = saved.clone();
        forged.source_binding.digest = "0".repeat(64);
        assert_eq!(
            validate_assistance_plan(&score, &forged).unwrap_err().code,
            "assistance_source_mismatch"
        );
        forged = saved;
        forged.score_id = "different-score".into();
        assert_eq!(
            validate_assistance_plan(&score, &forged).unwrap_err().code,
            "assistance_source_mismatch"
        );
    }

    #[test]
    fn persisted_versions_revisions_unknown_and_duplicate_ids_are_checked() {
        let score = fixture();
        let saved = plan(&score, &["first"]).plan;
        let mut wrong = saved.clone();
        wrong.schema_version += 1;
        assert_eq!(
            validate_assistance_plan(&score, &wrong).unwrap_err().code,
            "assistance_schema_version"
        );
        wrong = saved.clone();
        wrong.planner_revision += 1;
        assert_eq!(
            validate_assistance_plan(&score, &wrong).unwrap_err().code,
            "assistance_planner_revision"
        );
        wrong = saved.clone();
        wrong.revision = 0;
        assert_eq!(
            validate_assistance_plan(&score, &wrong).unwrap_err().code,
            "assistance_plan_revision"
        );
        wrong = saved.clone();
        wrong.human_source_note_ids = ids(&["absent"]);
        assert_eq!(
            validate_assistance_plan(&score, &wrong).unwrap_err().code,
            "assistance_unknown_note"
        );
        wrong = saved.clone();
        wrong.human_source_note_ids.push("first".into());
        assert_eq!(
            validate_assistance_plan(&score, &wrong).unwrap_err().code,
            "assistance_duplicate_note"
        );
        wrong = saved.clone();
        wrong.selected_part_ids = ids(&["absent"]);
        assert_eq!(
            validate_assistance_plan(&score, &wrong).unwrap_err().code,
            "assistance_unknown_part"
        );
        wrong = saved;
        wrong.selected_part_ids.push("piano".into());
        assert_eq!(
            validate_assistance_plan(&score, &wrong).unwrap_err().code,
            "assistance_duplicate_part"
        );
    }

    #[test]
    fn infeasibility_disables_scoring_without_removing_or_rewriting_targets() {
        let score = fixture();
        let too_low = InstrumentProfile::Piano {
            key_count: 12,
            lowest_midi: Some(0),
        };
        let result = create_assistance_plan(
            &score,
            &ids(&["piano"]),
            &too_low,
            &ids(&["first", "second"]),
        )
        .unwrap();
        assert!(result.all_selected_human);
        assert!(!result.full_scope_playable && !result.scored_mode_allowed);
        assert_eq!(result.coverage.human_target_count, 2);
        assert!(result
            .human_targets
            .diagnostics
            .iter()
            .any(|d| d.code == "instrument_range"));
        assert!(result
            .full_scope_diagnostics
            .iter()
            .any(|d| d.code == "instrument_range"));
        assert!(result.machine_timeline.notes.is_empty());
        assert_eq!(
            json(&result.human_targets.timeline),
            json(&compile(score.clone()).unwrap().timeline)
        );
        let invalid = InstrumentProfile::Piano {
            key_count: 88,
            lowest_midi: Some(100),
        };
        assert_eq!(
            create_assistance_plan(&score, &ids(&["piano"]), &invalid, &[])
                .unwrap_err()
                .code,
            "assistance_target_plan"
        );
    }

    #[test]
    fn human_subset_can_be_feasible_while_complete_selected_scope_is_not() {
        let mut score = fixture();
        score.parts[0].notes[1].pitch.as_mut().unwrap().octave = 9;
        let result = plan(&score, &["first"]);
        assert!(result.scored_mode_allowed);
        assert!(!result.full_scope_playable);
        assert_eq!(result.machine_timeline.notes[0].midi, 120);
        let profile = InstrumentProfile::Piano {
            key_count: 61,
            lowest_midi: None,
        };
        let result =
            create_assistance_plan(&score, &ids(&["piano"]), &profile, &ids(&["first"])).unwrap();
        assert!(result.scored_mode_allowed && !result.full_scope_playable);
    }

    #[test]
    fn unresolved_ties_and_rest_selections_fail_without_mutating_the_score() {
        let mut score = tied();
        score.parts[0].notes[1].at = Beat::new(2, 1);
        let before = json(&score);
        assert_eq!(
            create_assistance_plan(&score, &ids(&["piano"]), &piano(), &[])
                .unwrap_err()
                .code,
            "assistance_unresolved_tie"
        );
        assert_eq!(json(&score), before);
        score = fixture();
        score.parts[0].notes[1].pitch = None;
        assert_eq!(
            create_assistance_plan(&score, &ids(&["piano"]), &piano(), &ids(&["second"]))
                .unwrap_err()
                .code,
            "assistance_rest_selection"
        );
    }

    #[test]
    fn ambiguous_cross_lane_ties_fail_at_the_existing_compiler() {
        let mut score = tied();
        let mut alternative = score.parts[0].notes[0].clone();
        alternative.id = "alternative-start".into();
        alternative.voice = "alternative-voice".into();
        score.parts[0].notes.push(alternative);
        let error = create_assistance_plan(&score, &ids(&["piano"]), &piano(), &[]).unwrap_err();
        assert_eq!(error.code, "assistance_compile");
        assert!(error.message.contains("Ambiguous cross-voice/staff"));
    }

    #[test]
    fn source_binding_matches_standard_sha256_and_frozen_canonical_bytes() {
        assert_eq!(
            sha256_hex(b""),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
        assert_eq!(
            sha256_hex(b"abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
        // Expected digest independently checked with Python hashlib. This fixes
        // serialization revision 1's exact field order and number representation.
        let canonical = r#"{"version":1,"id":"binding-fixture","title":"Binding fixture","composer":"","provenance":{"kind":"original_exercise","attribution":"Original test fixture","source_url":null,"license":"CC0-1.0"},"parts":[{"id":"piano","name":"Piano","instrument":"piano","notes":[]}],"tempo":[{"at":{"numerator":0,"denominator":1},"bpm":120.0}],"meters":[],"keys":[],"measures":[],"repeats":[],"source":null}"#;
        let score: Score = serde_json::from_str(canonical).unwrap();
        assert_eq!(serde_json::to_string(&score).unwrap(), canonical);
        let binding = source_binding(&score).unwrap();
        assert_eq!(
            binding.digest,
            "325b156f639ba52a03ebb28532104101c089275a5fa193823f68e1fa4ae6a2f9"
        );
        assert_eq!(binding.algorithm, "sha256");
        assert_eq!(binding.serialization, "worldmusichub-score-serde-json");
        assert_eq!(binding.serialization_revision, 1);
    }

    #[test]
    fn unknown_binding_formats_and_malformed_digests_are_rejected() {
        let score = fixture();
        let saved = plan(&score, &[]).plan;
        let mut changed = saved.clone();
        changed.source_binding.algorithm = "sha1".into();
        assert_eq!(
            validate_assistance_plan(&score, &changed).unwrap_err().code,
            "assistance_binding_algorithm"
        );
        changed = saved.clone();
        changed.source_binding.serialization = "other-json".into();
        assert_eq!(
            validate_assistance_plan(&score, &changed).unwrap_err().code,
            "assistance_binding_serialization"
        );
        changed = saved.clone();
        changed.source_binding.serialization_revision += 1;
        assert_eq!(
            validate_assistance_plan(&score, &changed).unwrap_err().code,
            "assistance_binding_serialization"
        );
        for digest in ["a".repeat(63), "A".repeat(64), "g".repeat(64)] {
            changed = saved.clone();
            changed.source_binding.digest = digest;
            assert_eq!(
                validate_assistance_plan(&score, &changed).unwrap_err().code,
                "assistance_binding_digest"
            );
        }
    }

    #[test]
    fn compact_plan_does_not_repeat_large_retained_source_and_fits_beside_one_song() {
        let mut score = fixture();
        let base = score.parts[0].notes[0].clone();
        score.parts[0].notes = (0..15_000)
            .map(|index| {
                let mut note = base.clone();
                note.id = format!("generated-{index}");
                note.at = Beat::new(index, 1);
                note
            })
            .collect();
        let marker = "original-fixture-source-only:";
        score.source = Some(Source {
            format: "original-generated".into(),
            filename: None,
            content: format!("{marker}{}", "a".repeat(1_048_576 - marker.len())),
            import_diagnostics: None,
        });
        let all = score.parts[0]
            .notes
            .iter()
            .map(|note| note.id.clone())
            .collect::<Vec<_>>();
        let result = create_assistance_plan(&score, &ids(&["piano"]), &piano(), &all).unwrap();
        let score_bytes = serde_json::to_vec(&score).unwrap().len();
        let plan_json = serde_json::to_string(&result.plan).unwrap();
        let combined_bytes =
            serde_json::to_vec(&serde_json::json!({"score": score, "plan": result.plan}))
                .unwrap()
                .len();
        assert!(score_bytes > 4_000_000);
        assert!(plan_json.len() < 300_000);
        assert!(combined_bytes < 8 * 1024 * 1024);
        assert!(!plan_json.contains(marker));
        assert_eq!(result.plan.source_binding.digest.len(), 64);
        println!("15k original notes + 1 MiB source: score={score_bytes}, plan={}, combined={combined_bytes}", plan_json.len());
        for id in [
            "cc0-schubert-wandrers-nachtlied-d768",
            "cc0-beethoven-gottes-macht-op48-5",
        ] {
            let score = crate::catalog_score(id).unwrap();
            let parts = score
                .parts
                .iter()
                .map(|part| part.id.clone())
                .collect::<Vec<_>>();
            let human = score
                .parts
                .iter()
                .flat_map(|part| &part.notes)
                .filter(|note| note.pitch.is_some())
                .map(|note| note.id.clone())
                .collect::<Vec<_>>();
            let checked = create_assistance_plan(&score, &parts, &piano(), &human).unwrap();
            let score_bytes = serde_json::to_vec(&score).unwrap().len();
            let plan_bytes = serde_json::to_vec(&checked.plan).unwrap().len();
            let combined_bytes =
                serde_json::to_vec(&serde_json::json!({"score": score, "plan": checked.plan}))
                    .unwrap()
                    .len();
            assert!(plan_bytes < 20_000);
            assert!(combined_bytes < 8 * 1024 * 1024);
            println!("{id}: score={score_bytes}, plan={plan_bytes}, combined={combined_bytes}");
        }
    }

    #[test]
    fn hashing_still_refuses_oversized_canonical_sources_without_truncation() {
        let mut score = fixture();
        score.source = Some(Source {
            format: "original-generated".into(),
            filename: None,
            content: "a".repeat(MAX_SOURCE_BYTES),
            import_diagnostics: None,
        });
        // The retained source alone fits validation; the complete canonical bytes do not.
        assert!(crate::validate(&score).is_ok());
        assert_eq!(
            create_assistance_plan(&score, &ids(&["piano"]), &piano(), &[])
                .unwrap_err()
                .code,
            "assistance_source_limit"
        );
        assert_eq!(score.source.unwrap().content.len(), MAX_SOURCE_BYTES);
    }

    #[test]
    fn historical_tie_observations_do_not_reject_a_corrected_current_score() {
        let mut score = fixture();
        score.source = Some(Source {
            format: "original".into(),
            filename: None,
            content: "preserved original".into(),
            import_diagnostics: Some(
                ["broken_tie", "orphan_tie", "unclosed_tie"]
                    .into_iter()
                    .map(|code| {
                        Diagnostic::warning(
                            code,
                            "Historical import observation",
                            Some("first".into()),
                        )
                    })
                    .collect(),
            ),
        });
        let result = plan(&score, &["first", "second"]);
        assert!(result.scored_mode_allowed);
        assert_eq!(
            result
                .diagnostics
                .iter()
                .filter(|d| d.message.starts_with("Retained import observation:"))
                .count(),
            3
        );
    }

    #[test]
    fn rest_only_selected_scope_has_no_human_target_and_keeps_song_duration() {
        let mut score = fixture();
        for note in &mut score.parts[0].notes {
            note.pitch = None;
        }
        let result = plan(&score, &[]);
        assert_eq!(result.coverage.source_note_count, 0);
        assert_eq!(result.coverage.selected_target_count, 0);
        assert!(
            !result.all_selected_human
                && !result.scored_mode_allowed
                && !result.full_scope_playable
        );
        assert_eq!(
            result.machine_timeline.duration_ms,
            compile(score).unwrap().timeline.duration_ms
        );
    }

    #[test]
    fn selection_order_does_not_change_checked_plan_or_ownership() {
        let mut score = fixture();
        let mut second = score.parts[0].clone();
        second.id = "second-part".into();
        for note in &mut second.notes {
            note.id = format!("part-two-{}", note.id);
        }
        score.parts.push(second);
        let result = create_assistance_plan(
            &score,
            &ids(&["second-part", "piano"]),
            &piano(),
            &ids(&["part-two-second", "first", "part-two-first", "second"]),
        )
        .unwrap();
        let reordered = create_assistance_plan(
            &score,
            &ids(&["piano", "second-part"]),
            &piano(),
            &ids(&["second", "first", "part-two-first", "part-two-second"]),
        )
        .unwrap();
        assert_eq!(json(&result), json(&reordered));
    }
}

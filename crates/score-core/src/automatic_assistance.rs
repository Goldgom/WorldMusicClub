//! Reversible, deterministic ownership of complete trusted practice sources.
//! Only `human_targets` enters scoring. Machine IDs filter the already compiled
//! complete runtime; they must never filter raw Basic events before FIFO pairing.
use crate::{
    assistance::NoteOwner,
    instruments::{analyze_instrument, InstrumentProfile},
    practice_source::{hash, Exact, PracticeRuntimeReceipt, PracticeSource, PracticeSourceError},
    targets::{plan_targets, PracticeTargets},
    Diagnostic, Timeline,
};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeSet, HashMap, HashSet};

pub const ALGORITHM_ID: &str = "wmc-keyboard-assistance-v1";
pub const PLAN_FORMAT: &str = "wmc-practice-assistance";
pub const SCHEMA_VERSION: u32 = 1;
pub const PLANNER_REVISION: u32 = 1;
/// Complete result, or explicit error. No prefix is returned as a full song.
pub const MAX_RESPONSE_BYTES: usize = 16 * 1024 * 1024;
const MAX_SELECTOR_WORK: usize = 5_000_000;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AssistanceSelection {
    pub selected_part_ids: Vec<String>,
    pub profile: InstrumentProfile,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AutomaticSettings {
    pub algorithm_id: String,
    pub max_targets_per_onset: u8,
    pub min_onset_interval_ms: u32,
    pub max_simultaneous_keys: u8,
    pub max_held_span_semitones: u8,
}
impl Default for AutomaticSettings {
    fn default() -> Self {
        Self {
            algorithm_id: ALGORITHM_ID.into(),
            max_targets_per_onset: 2,
            min_onset_interval_ms: 250,
            max_simultaneous_keys: 3,
            max_held_span_semitones: 7,
        }
    }
}
#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AssistanceMode {
    Original,
    Automatic,
    Explicit,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PracticeAssistancePlan {
    pub format: String,
    pub schema_version: u32,
    pub planner_revision: u32,
    /// Immutable generation revision. This version emits and accepts revision 1;
    /// client request epochs and storage revisions are separate identities.
    pub revision: u32,
    pub receipt: PracticeRuntimeReceipt,
    pub selection: AssistanceSelection,
    pub mode: AssistanceMode,
    pub settings: Option<AutomaticSettings>,
    pub human_source_ids: Vec<String>,
    pub selection_digest: String,
}
#[derive(Clone, Debug, Serialize)]
pub struct PracticeSourceOwnership {
    pub source_id: String,
    pub part_id: String,
    pub owner: NoteOwner,
    pub in_selected_scope: bool,
}
#[derive(Clone, Debug, Serialize)]
pub struct PracticeAssistanceCoverage {
    pub source_unit_count: usize,
    pub selected_source_unit_count: usize,
    pub human_source_unit_count: usize,
    pub machine_source_unit_count: usize,
    pub occurrence_count: usize,
    pub human_occurrence_count: usize,
    pub machine_occurrence_count: usize,
    pub selected_target_count: usize,
    pub human_target_count: usize,
    pub machine_selected_target_count: usize,
}
#[derive(Clone, Debug, Serialize)]
pub struct ExclusionReason {
    pub source_ids: Vec<String>,
    pub code: String,
}
/// Output-only. No duplicated complete machine timeline on the wire.
#[derive(Clone, Debug, Serialize)]
pub struct CheckedPracticeAssistance {
    pub plan: PracticeAssistancePlan,
    pub receipt: PracticeRuntimeReceipt,
    pub human_targets: PracticeTargets,
    pub machine_occurrence_ids: Vec<String>,
    pub source_ownership: Vec<PracticeSourceOwnership>,
    pub coverage: PracticeAssistanceCoverage,
    pub exclusion_reasons: Vec<ExclusionReason>,
    pub all_selected_human: bool,
    pub scored_mode_allowed: bool,
    pub diagnostics: Vec<Diagnostic>,
}
#[derive(Clone, Debug, Serialize)]
pub struct PracticeAssistanceError {
    pub code: String,
    pub message: String,
    pub source_ids: Vec<String>,
}
impl PracticeAssistanceError {
    fn new(code: &str, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
            source_ids: vec![],
        }
    }
}
impl std::fmt::Display for PracticeAssistanceError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.code, self.message)
    }
}
impl std::error::Error for PracticeAssistanceError {}
impl From<PracticeSourceError> for PracticeAssistanceError {
    fn from(value: PracticeSourceError) -> Self {
        Self {
            code: value.code,
            message: value.message,
            source_ids: value.source_ids,
        }
    }
}

pub fn generate(
    source: &PracticeSource,
    selection: &AssistanceSelection,
    settings: &AutomaticSettings,
) -> Result<CheckedPracticeAssistance, PracticeAssistanceError> {
    check_settings(settings)?;
    if !matches!(selection.profile, InstrumentProfile::Piano { .. }) {
        return Err(PracticeAssistanceError::new("assistance_automatic_profile", "Automatic v1 supports keyboard target limits only; guitar physical selection is not implemented"));
    }
    build(
        source,
        selection,
        AssistanceMode::Automatic,
        Some(settings),
        None,
    )
}
pub fn original(
    source: &PracticeSource,
    selection: &AssistanceSelection,
) -> Result<CheckedPracticeAssistance, PracticeAssistanceError> {
    build(source, selection, AssistanceMode::Original, None, None)
}
pub fn create(
    source: &PracticeSource,
    selection: &AssistanceSelection,
    human_source_ids: &[String],
) -> Result<CheckedPracticeAssistance, PracticeAssistanceError> {
    build(
        source,
        selection,
        AssistanceMode::Explicit,
        None,
        Some(human_source_ids),
    )
}
pub fn validate(
    source: &PracticeSource,
    plan: &PracticeAssistancePlan,
) -> Result<CheckedPracticeAssistance, PracticeAssistanceError> {
    if plan.format != PLAN_FORMAT
        || plan.schema_version != SCHEMA_VERSION
        || plan.planner_revision != PLANNER_REVISION
    {
        return Err(PracticeAssistanceError::new(
            "assistance_plan_version",
            "Unsupported assistance format, schema or planner revision",
        ));
    }
    if plan.revision != 1 {
        return Err(PracticeAssistanceError::new(
            "assistance_plan_revision",
            "Unsupported immutable plan revision",
        ));
    }
    if &plan.receipt != source.receipt() {
        return Err(PracticeAssistanceError::new("assistance_source_mismatch", "Plan belongs to a different saved source, native policy or explicit interpretation choice"));
    }
    let result = match (plan.mode, &plan.settings) {
        (AssistanceMode::Automatic, Some(settings)) => generate(source, &plan.selection, settings)?,
        (AssistanceMode::Original, None) => original(source, &plan.selection)?,
        (AssistanceMode::Explicit, None) => {
            create(source, &plan.selection, &plan.human_source_ids)?
        }
        _ => {
            return Err(PracticeAssistanceError::new(
                "assistance_plan_settings",
                "Plan mode and settings disagree",
            ))
        }
    };
    if serde_json::to_value(&result.plan)
        .map_err(|e| PracticeAssistanceError::new("assistance_encoding", e.to_string()))?
        != serde_json::to_value(plan)
            .map_err(|e| PracticeAssistanceError::new("assistance_encoding", e.to_string()))?
    {
        return Err(PracticeAssistanceError::new("assistance_plan_mismatch", "Saved selection is stale, altered or not normalized; regenerate it from this trusted source"));
    }
    Ok(result)
}
fn check_settings(settings: &AutomaticSettings) -> Result<(), PracticeAssistanceError> {
    if settings.algorithm_id != ALGORITHM_ID
        || !(1..=32).contains(&settings.max_targets_per_onset)
        || !(1..=32).contains(&settings.max_simultaneous_keys)
        || settings.min_onset_interval_ms > 60_000
        || settings.max_held_span_semitones > 127
    {
        return Err(PracticeAssistanceError::new("assistance_settings", "Use keyboard algorithm v1, 1–32 targets/keys, onset spacing 0–60,000 ms and held span 0–127 semitones"));
    }
    Ok(())
}
struct Groups {
    selected: PracticeTargets,
    roots: Vec<usize>,
    atoms: Vec<Vec<String>>,
    cross_scope: HashSet<usize>,
}
fn groups(
    source: &PracticeSource,
    selection: &AssistanceSelection,
    allow_empty: bool,
) -> Result<(AssistanceSelection, Groups), PracticeAssistanceError> {
    if (!allow_empty && selection.selected_part_ids.is_empty())
        || selection.selected_part_ids.len() > 128
    {
        return Err(PracticeAssistanceError::new(
            "assistance_selection_limit",
            "Select 1–128 existing parts",
        ));
    }
    let mut scope = HashSet::new();
    for id in &selection.selected_part_ids {
        if !scope.insert(id.as_str()) {
            return Err(PracticeAssistanceError::new(
                "assistance_duplicate_part",
                "Selected part IDs must be unique",
            ));
        }
        if !source.parts.contains(id) {
            return Err(PracticeAssistanceError::new(
                "assistance_unknown_part",
                "Selected part is absent from the complete source",
            ));
        }
    }
    let mut selection = selection.clone();
    selection.selected_part_ids.sort();
    let timeline = Timeline {
        duration_ms: source.timeline.duration_ms,
        notes: source
            .timeline
            .notes
            .iter()
            .filter(|n| scope.contains(n.part_id.as_str()))
            .cloned()
            .collect(),
    };
    let selected = plan_targets(&timeline, &selection.profile)
        .map_err(|e| PracticeAssistanceError::new("assistance_target_plan", e))?;
    let complete = plan_targets(&source.timeline, &selection.profile)
        .map_err(|e| PracticeAssistanceError::new("assistance_target_plan", e))?;
    let indices: HashMap<_, _> = source
        .units
        .iter()
        .enumerate()
        .map(|(i, u)| (u.source_id.as_str(), i))
        .collect();
    let mut parents: Vec<_> = (0..source.units.len()).collect();
    fn root(parents: &mut [usize], mut i: usize) -> usize {
        while parents[i] != i {
            parents[i] = parents[parents[i]];
            i = parents[i];
        }
        i
    }
    for group in &complete.groups {
        let first = indices[group.source_note_ids[0].as_str()];
        for id in &group.source_note_ids {
            let (a, b) = (
                root(&mut parents, first),
                root(&mut parents, indices[id.as_str()]),
            );
            parents[a.max(b)] = a.min(b);
        }
    }
    let roots: Vec<_> = (0..parents.len()).map(|i| root(&mut parents, i)).collect();
    let mut atoms = vec![vec![]; source.units.len()];
    let selected_atoms: HashSet<_> = source
        .units
        .iter()
        .enumerate()
        .filter(|(_, u)| scope.contains(u.part_id.as_str()))
        .map(|(i, _)| roots[i])
        .collect();
    let mut cross_scope = HashSet::new();
    for (i, unit) in source.units.iter().enumerate() {
        if selected_atoms.contains(&roots[i]) {
            atoms[roots[i]].push(unit.source_id.clone());
            if !scope.contains(unit.part_id.as_str()) {
                cross_scope.insert(roots[i]);
            }
        }
    }
    for atom in &mut atoms {
        atom.sort();
    }
    let group_roots = selected
        .groups
        .iter()
        .map(|g| roots[indices[g.source_note_ids[0].as_str()]])
        .collect();
    Ok((
        selection,
        Groups {
            selected,
            roots: group_roots,
            atoms,
            cross_scope,
        },
    ))
}
fn automatic_selection(
    source: &PracticeSource,
    groups: &Groups,
    profile: &InstrumentProfile,
    settings: &AutomaticSettings,
) -> Result<(HashSet<String>, Vec<ExclusionReason>), PracticeAssistanceError> {
    let report = analyze_instrument(&groups.selected.timeline, profile)
        .map_err(|e| PracticeAssistanceError::new("assistance_target_plan", e))?;
    let range: HashMap<_, _> = report
        .note_options
        .iter()
        .map(|n| (n.note_id.as_str(), n.playable))
        .collect();
    let gates: Vec<_> = groups
        .selected
        .groups
        .iter()
        .map(|group| {
            let start = source.gates[&group.source_occurrence_ids[0]].start;
            let end = group
                .source_occurrence_ids
                .iter()
                .map(|id| source.gates[id].end)
                .max()
                .expect("complete group");
            (start, end)
        })
        .collect();
    let mut rejected: HashMap<usize, &'static str> = groups
        .atoms
        .iter()
        .enumerate()
        .filter(|(_, ids)| ids.iter().any(|id| source.keyboard_excluded.contains(id)))
        .map(|(atom, _)| (atom, "percussion_selector"))
        .collect();
    for atom in &groups.cross_scope {
        rejected.insert(*atom, "cross_scope_physical_group");
    }
    let mut active: Vec<usize> = vec![];
    let mut onset: Vec<usize> = vec![];
    let mut previous_onsets: Vec<(Exact, usize)> = vec![];
    let mut current_start = None;
    let mut work = 0usize;
    // Stable existing target order is exact onset, pitch, representative ID.
    // At a conflict reject the entire source atom, including earlier/future
    // repeats. Removing earlier accepted gates only relaxes previous bounds.
    for (i, note) in groups.selected.timeline.notes.iter().enumerate() {
        let atom = groups.roots[i];
        if rejected.contains_key(&atom) {
            continue;
        }
        let start = gates[i].0;
        if current_start != Some(start) {
            onset.clear();
            current_start = Some(start);
        }
        work = work.saturating_add(active.len() + onset.len() + 1);
        if work > MAX_SELECTOR_WORK {
            return Err(PracticeAssistanceError::new("assistance_work_limit", "Complete automatic selection exceeds 5,000,000 work units; no partial plan was returned"));
        }
        active.retain(|prior| {
            !rejected.contains_key(&groups.roots[*prior]) && gates[*prior].1 > start
        });
        onset.retain(|prior| !rejected.contains_key(&groups.roots[*prior]));
        while previous_onsets
            .last()
            .is_some_and(|(_, a)| rejected.contains_key(a))
        {
            previous_onsets.pop();
        }
        let mut keys: BTreeSet<_> = active
            .iter()
            .map(|p| groups.selected.timeline.notes[*p].midi)
            .collect();
        keys.insert(note.midi);
        let density = if let Some((previous, _)) = previous_onsets.last() {
            *previous != start
                && start.sub(*previous)? < Exact::milliseconds(settings.min_onset_interval_ms)
        } else {
            false
        };
        let reason = if !range[note.id.as_str()] {
            Some("instrument_range")
        } else if onset.len() >= usize::from(settings.max_targets_per_onset) {
            Some("onset_target_limit")
        } else if density {
            Some("onset_density")
        } else if keys.len() > usize::from(settings.max_simultaneous_keys) {
            Some("simultaneous_key_limit")
        } else if keys.last().unwrap() - keys.first().unwrap() > settings.max_held_span_semitones {
            Some("held_span_limit")
        } else {
            None
        };
        if let Some(reason) = reason {
            rejected.insert(atom, reason);
        } else {
            active.push(i);
            onset.push(i);
            previous_onsets.push((start, atom));
        }
    }
    let mut human = HashSet::new();
    let mut reasons = vec![];
    for (atom, ids) in groups
        .atoms
        .iter()
        .enumerate()
        .filter(|(_, ids)| !ids.is_empty())
    {
        if let Some(code) = rejected.get(&atom) {
            reasons.push(ExclusionReason {
                source_ids: ids.clone(),
                code: (*code).into(),
            });
        } else {
            human.extend(ids.iter().cloned());
        }
    }
    reasons.sort_by(|a, b| a.source_ids.cmp(&b.source_ids));
    Ok((human, reasons))
}
fn build(
    source: &PracticeSource,
    selection: &AssistanceSelection,
    mode: AssistanceMode,
    settings: Option<&AutomaticSettings>,
    explicit: Option<&[String]>,
) -> Result<CheckedPracticeAssistance, PracticeAssistanceError> {
    let (selection, groups) = groups(source, selection, mode == AssistanceMode::Original)?;
    let selected_parts: HashSet<_> = selection
        .selected_part_ids
        .iter()
        .map(String::as_str)
        .collect();
    let selected_ids: HashSet<_> = source
        .units
        .iter()
        .filter(|u| selected_parts.contains(u.part_id.as_str()))
        .map(|u| u.source_id.clone())
        .collect();
    let (human, mut exclusion_reasons) = match mode {
        AssistanceMode::Automatic => automatic_selection(
            source,
            &groups,
            &selection.profile,
            settings.expect("internal mode"),
        )?,
        AssistanceMode::Original => {
            if !groups.cross_scope.is_empty() {
                let mut ids: Vec<_> = groups
                    .cross_scope
                    .iter()
                    .flat_map(|a| groups.atoms[*a].iter().cloned())
                    .collect();
                ids.sort();
                return Err(PracticeAssistanceError { code:"assistance_cross_scope_physical_group".into(),message:"Original mode would split a complete physical group across human and machine owners; include all its parts in the selection".into(),source_ids:ids });
            }
            (selected_ids.clone(), vec![])
        }
        AssistanceMode::Explicit => {
            let ids = explicit.expect("internal mode");
            if ids.len() > crate::practice_source::MAX_SOURCE_UNITS {
                return Err(PracticeAssistanceError::new(
                    "assistance_selection_limit",
                    "Human source selection exceeds 100,000 units",
                ));
            }
            let human: HashSet<_> = ids.iter().cloned().collect();
            if human.len() != ids.len() {
                return Err(PracticeAssistanceError::new(
                    "assistance_duplicate_source",
                    "Human source IDs must be unique",
                ));
            }
            if !human.is_subset(&selected_ids) {
                return Err(PracticeAssistanceError::new(
                    "assistance_unknown_source",
                    "Human source IDs must exist inside selected parts",
                ));
            }
            for (index, atom) in groups
                .atoms
                .iter()
                .enumerate()
                .filter(|(_, a)| !a.is_empty())
            {
                if groups.cross_scope.contains(&index) && atom.iter().any(|id| human.contains(id)) {
                    return Err(PracticeAssistanceError { code:"assistance_cross_scope_physical_group".into(),message:"Human selection would split a complete physical group across selected and unselected parts; include all its parts".into(),source_ids:atom.clone() });
                }
                let count = atom.iter().filter(|id| human.contains(*id)).count();
                if count != 0 && count != atom.len() {
                    return Err(PracticeAssistanceError {
                        code: "assistance_partial_atom".into(),
                        message:
                            "Ties, repeats and selected exact physical groups must share one owner"
                                .into(),
                        source_ids: atom.clone(),
                    });
                }
            }
            let reasons = groups
                .atoms
                .iter()
                .filter(|a| !a.is_empty() && !human.contains(&a[0]))
                .map(|a| ExclusionReason {
                    source_ids: a.clone(),
                    code: "explicit_machine".into(),
                })
                .collect();
            (human, reasons)
        }
    };
    exclusion_reasons.sort_by(|a, b| a.source_ids.cmp(&b.source_ids));
    let mut human_occurrences = HashSet::new();
    for group in &groups.selected.groups {
        if human.contains(&group.source_note_ids[0]) {
            human_occurrences.extend(group.source_occurrence_ids.iter().cloned());
        }
    }
    let human_timeline = Timeline {
        duration_ms: source.timeline.duration_ms,
        notes: source
            .timeline
            .notes
            .iter()
            .filter(|n| human_occurrences.contains(&n.id))
            .cloned()
            .collect(),
    };
    let human_targets = plan_targets(&human_timeline, &selection.profile)
        .map_err(|e| PracticeAssistanceError::new("assistance_target_plan", e))?;
    let mut machine_occurrence_ids: Vec<_> = source
        .timeline
        .notes
        .iter()
        .filter(|n| !human_occurrences.contains(&n.id))
        .map(|n| n.id.clone())
        .collect();
    let scope: HashSet<_> = selection
        .selected_part_ids
        .iter()
        .map(String::as_str)
        .collect();
    machine_occurrence_ids.sort();
    let mut source_ownership: Vec<_> = source
        .units
        .iter()
        .map(|u| PracticeSourceOwnership {
            source_id: u.source_id.clone(),
            part_id: u.part_id.clone(),
            owner: if human.contains(&u.source_id) {
                NoteOwner::Human
            } else {
                NoteOwner::Machine
            },
            in_selected_scope: scope.contains(u.part_id.as_str()),
        })
        .collect();
    source_ownership.sort_by(|a, b| a.source_id.cmp(&b.source_id));
    let coverage = PracticeAssistanceCoverage {
        source_unit_count: source.units.len(),
        selected_source_unit_count: selected_ids.len(),
        human_source_unit_count: human.len(),
        machine_source_unit_count: source.units.len() - human.len(),
        occurrence_count: source.timeline.notes.len(),
        human_occurrence_count: human_occurrences.len(),
        machine_occurrence_count: machine_occurrence_ids.len(),
        selected_target_count: groups.selected.target_count,
        human_target_count: human_targets.target_count,
        machine_selected_target_count: groups.selected.target_count - human_targets.target_count,
    };
    let mut human_source_ids: Vec<_> = human.into_iter().collect();
    human_source_ids.sort();
    let mut plan = PracticeAssistancePlan {
        format: PLAN_FORMAT.into(),
        schema_version: SCHEMA_VERSION,
        planner_revision: PLANNER_REVISION,
        revision: 1,
        receipt: source.receipt().clone(),
        selection,
        mode,
        settings: settings.cloned(),
        human_source_ids,
        selection_digest: String::new(),
    };
    plan.selection_digest = hash(&plan)?;
    let mut diagnostics = source.diagnostics.clone();
    diagnostics.push(Diagnostic::warning("assistance_scope_limits", "Automatic keyboard v1 is a deterministic subset using exact onset spacing, chord size, held-key count and total held pitch span. It is not a skill grade, musical optimum, hand/finger assignment, independent-release certification or guitar physical feasibility proof. Original mode retains every selected target even if infeasible.", None));
    let result = CheckedPracticeAssistance {
        all_selected_human: !selected_ids.is_empty()
            && plan.human_source_ids.len() == selected_ids.len(),
        scored_mode_allowed: human_targets.playable,
        plan,
        receipt: source.receipt().clone(),
        human_targets,
        machine_occurrence_ids,
        source_ownership,
        coverage,
        exclusion_reasons,
        diagnostics,
    };
    if serde_json::to_vec(&result)
        .map_err(|e| PracticeAssistanceError::new("assistance_encoding", e.to_string()))?
        .len()
        > MAX_RESPONSE_BYTES
    {
        return Err(PracticeAssistanceError::new("assistance_response_limit", "Complete assistance response exceeds 16 MiB; no IDs or ownership entries were truncated"));
    }
    Ok(result)
}

#[cfg(test)]
mod tests;

//! Independently versioned, nested keyboard practice layers on an immutable source.
//!
//! Compute the widest layer first. Stricter layers can only retain complete atoms
//! from their parent layer; atoms, physical groups and exact clocks always come
//! from the complete original source. A v1 Explicit plan alone is not a hierarchy
//! proof. Validate the progression plan against the trusted source before using
//! its freshly rebuilt chosen-layer assistance result.
//!
//! The fixed numeric schemes certify attack spacing, onset size, held-key count
//! and total held span, not a skill grade, optimum, hand assignment or independent
//! same-key releases. Adjacent layers may be equal, including empty layers; zero
//! targets are never scoreable. Original remains a separate full-target request
//! through `automatic_assistance::original`, and can be rejected or unscoreable.
use crate::{
    automatic_assistance::{
        self, AssistanceSelection, CheckedPracticeAssistance, Groups, PracticeAssistanceError,
    },
    instruments::{analyze_instrument, InstrumentProfile},
    practice_source::{hash, Exact, PracticeRuntimeReceipt, PracticeSource},
};
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeSet, HashMap, HashSet},
    io::{self, Write},
};

pub const ALGORITHM_ID: &str = "wmc-keyboard-progression-v1";
pub const SCHEME_ID: &str = "wmc-keyboard-three-layer-v1";
pub const PLAN_FORMAT: &str = "wmc-practice-progression";
pub const SCHEMA_VERSION: u32 = 1;
pub const PLANNER_REVISION: u32 = 1;
pub const MAX_RESPONSE_BYTES: usize = automatic_assistance::MAX_RESPONSE_BYTES;
/// One shared budget covers selection and independent verification of all layers.
const MAX_HIERARCHY_WORK: usize = 5_000_000;

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ProgressionLayer {
    Single,
    Balanced,
    Dense,
}
impl ProgressionLayer {
    fn index(self) -> usize {
        match self {
            Self::Single => 0,
            Self::Balanced => 1,
            Self::Dense => 2,
        }
    }
}
#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
pub struct ProgressionConstraints {
    pub max_targets_per_onset: u8,
    pub min_onset_interval_ms: u32,
    pub max_simultaneous_keys: u8,
    pub max_held_span_semitones: u8,
}
const LAYERS: [(ProgressionLayer, ProgressionConstraints); 3] = [
    (
        ProgressionLayer::Single,
        ProgressionConstraints {
            max_targets_per_onset: 1,
            min_onset_interval_ms: 500,
            max_simultaneous_keys: 1,
            max_held_span_semitones: 0,
        },
    ),
    (
        ProgressionLayer::Balanced,
        ProgressionConstraints {
            max_targets_per_onset: 2,
            min_onset_interval_ms: 250,
            max_simultaneous_keys: 3,
            max_held_span_semitones: 7,
        },
    ),
    (
        ProgressionLayer::Dense,
        ProgressionConstraints {
            max_targets_per_onset: 4,
            min_onset_interval_ms: 125,
            max_simultaneous_keys: 6,
            max_held_span_semitones: 12,
        },
    ),
];

/// A request to rederive a hierarchy, never a trusted eligibility mask. Every
/// digest, normalized field and chosen layer is checked against a fresh rebuild.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PracticeProgressionPlan {
    pub format: String,
    pub schema_version: u32,
    pub planner_revision: u32,
    pub revision: u32,
    pub algorithm_id: String,
    pub scheme_id: String,
    pub receipt: PracticeRuntimeReceipt,
    pub selection: AssistanceSelection,
    pub selection_digest: String,
    pub scheme_digest: String,
    pub hierarchy_digest: String,
    pub layer: ProgressionLayer,
    pub plan_digest: String,
}
#[derive(Clone, Debug, Serialize)]
pub struct ProgressionLayerSummary {
    pub layer: ProgressionLayer,
    pub constraints: ProgressionConstraints,
    pub human_source_unit_count: usize,
    pub human_occurrence_count: usize,
    pub human_target_count: usize,
    pub scored_mode_allowed: bool,
    /// False for Single. Equal adjacent layers and empty layers are permitted.
    pub equals_previous_layer: bool,
}
#[derive(Clone, Debug, Serialize)]
pub struct CheckedPracticeProgression {
    pub plan: PracticeProgressionPlan,
    /// Summaries only: there are no duplicate full ownership/runtime plans.
    pub layers: Vec<ProgressionLayerSummary>,
    /// Ordinary checked assistance for the chosen layer. Its Explicit mode is
    /// intentional: only the separately validated progression proves nesting.
    pub assistance: CheckedPracticeAssistance,
}

pub fn generate(
    source: &PracticeSource,
    selection: &AssistanceSelection,
    layer: ProgressionLayer,
) -> Result<CheckedPracticeProgression, PracticeAssistanceError> {
    generate_with_budget(source, selection, layer, MAX_HIERARCHY_WORK)
}

pub fn validate(
    source: &PracticeSource,
    plan: &PracticeProgressionPlan,
) -> Result<CheckedPracticeProgression, PracticeAssistanceError> {
    if plan.format != PLAN_FORMAT
        || plan.schema_version != SCHEMA_VERSION
        || plan.planner_revision != PLANNER_REVISION
        || plan.revision != 1
        || plan.algorithm_id != ALGORITHM_ID
        || plan.scheme_id != SCHEME_ID
    {
        return Err(error(
            "progression_plan_version",
            "Unsupported progression format, schema, algorithm, scheme or immutable revision",
        ));
    }
    if &plan.receipt != source.receipt() {
        return Err(error("progression_source_mismatch", "Progression belongs to another immutable source, saved package or interpretation choice"));
    }
    let result = generate(source, &plan.selection, plan.layer)?;
    if serde_json::to_value(&result.plan).map_err(encoding)?
        != serde_json::to_value(plan).map_err(encoding)?
    {
        return Err(error("progression_plan_mismatch", "Progression proof is stale, altered or not normalized; regenerate the hierarchy from this trusted source"));
    }
    Ok(result)
}

fn error(code: &str, message: impl Into<String>) -> PracticeAssistanceError {
    PracticeAssistanceError::new(code, message)
}
fn encoding(error: serde_json::Error) -> PracticeAssistanceError {
    PracticeAssistanceError::new("progression_encoding", error.to_string())
}
struct Work {
    remaining: usize,
}
impl Work {
    fn charge(&mut self, amount: usize) -> Result<(), PracticeAssistanceError> {
        self.remaining = self.remaining.checked_sub(amount).ok_or_else(|| {
            error("progression_work_limit", "Complete hierarchy exceeds its bounded selector/verification work budget; no partial layer was returned")
        })?;
        Ok(())
    }
}
struct Context<'a> {
    groups: &'a Groups,
    gates: Vec<(Exact, Exact)>,
    playable: Vec<bool>,
}
impl<'a> Context<'a> {
    fn new(
        source: &PracticeSource,
        groups: &'a Groups,
        profile: &InstrumentProfile,
    ) -> Result<Self, PracticeAssistanceError> {
        let report = analyze_instrument(&groups.selected.timeline, profile)
            .map_err(|e| error("progression_target_plan", e))?;
        let range: HashMap<_, _> = report
            .note_options
            .iter()
            .map(|n| (n.note_id.as_str(), n.playable))
            .collect();
        let playable = groups
            .selected
            .timeline
            .notes
            .iter()
            .map(|n| range[n.id.as_str()])
            .collect();
        let gates = groups
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
                    .expect("complete trusted group");
                (start, end)
            })
            .collect();
        Ok(Self {
            groups,
            gates,
            playable,
        })
    }

    /// Stable exact-onset/pitch/ID traversal. A later conflict rejects its entire
    /// atom, including earlier tie/repeat/unison occurrences. Removing previous
    /// targets only relaxes bounds. The eligible set is internal and derives
    /// solely from the already constructed wider layer.
    fn select(
        &self,
        eligible: &HashSet<usize>,
        constraints: ProgressionConstraints,
        work: &mut Work,
    ) -> Result<HashSet<usize>, PracticeAssistanceError> {
        let mut rejected = HashSet::new();
        let mut active: Vec<usize> = vec![];
        let mut onset: Vec<usize> = vec![];
        let mut previous_onsets: Vec<(Exact, usize)> = vec![];
        let mut current_start = None;
        for (i, note) in self.groups.selected.timeline.notes.iter().enumerate() {
            work.charge(1)?;
            let atom = self.groups.roots[i];
            if !eligible.contains(&atom) || rejected.contains(&atom) {
                continue;
            }
            let start = self.gates[i].0;
            if current_start != Some(start) {
                onset.clear();
                current_start = Some(start);
            }
            work.charge(active.len() + onset.len() + 1)?;
            active.retain(|prior| {
                !rejected.contains(&self.groups.roots[*prior]) && self.gates[*prior].1 > start
            });
            onset.retain(|prior| !rejected.contains(&self.groups.roots[*prior]));
            while previous_onsets
                .last()
                .is_some_and(|(_, a)| rejected.contains(a))
            {
                previous_onsets.pop();
                work.charge(1)?;
            }
            let mut keys: BTreeSet<_> = active
                .iter()
                .map(|p| self.groups.selected.timeline.notes[*p].midi)
                .collect();
            keys.insert(note.midi);
            let density = if let Some((previous, _)) = previous_onsets.last() {
                *previous != start
                    && start.sub(*previous)?
                        < Exact::milliseconds(constraints.min_onset_interval_ms)
            } else {
                false
            };
            if !self.playable[i]
                || onset.len() >= usize::from(constraints.max_targets_per_onset)
                || density
                || keys.len() > usize::from(constraints.max_simultaneous_keys)
                || keys.last().unwrap() - keys.first().unwrap()
                    > constraints.max_held_span_semitones
            {
                rejected.insert(atom);
            } else {
                active.push(i);
                onset.push(i);
                previous_onsets.push((start, atom));
            }
        }
        Ok(eligible.difference(&rejected).copied().collect())
    }

    /// Independently verify the final membership after rollback, not the
    /// transient greedy traversal. Releases at the exact next onset free a key.
    fn verify(
        &self,
        retained: &HashSet<usize>,
        constraints: ProgressionConstraints,
        work: &mut Work,
    ) -> Result<(), PracticeAssistanceError> {
        let mut active: Vec<usize> = vec![];
        let mut previous_onset = None;
        let mut onset_count = 0usize;
        for (i, note) in self.groups.selected.timeline.notes.iter().enumerate() {
            work.charge(1)?;
            if !retained.contains(&self.groups.roots[i]) {
                continue;
            }
            let start = self.gates[i].0;
            work.charge(active.len() + 1)?;
            active.retain(|prior| self.gates[*prior].1 > start);
            if previous_onset != Some(start) {
                if let Some(previous) = previous_onset {
                    if start.sub(previous)? < Exact::milliseconds(constraints.min_onset_interval_ms)
                    {
                        return Err(error(
                            "progression_invalid_layer",
                            "Final layer violates exact onset spacing",
                        ));
                    }
                }
                previous_onset = Some(start);
                onset_count = 0;
            }
            onset_count += 1;
            let mut keys: BTreeSet<_> = active
                .iter()
                .map(|p| self.groups.selected.timeline.notes[*p].midi)
                .collect();
            keys.insert(note.midi);
            if !self.playable[i]
                || onset_count > usize::from(constraints.max_targets_per_onset)
                || keys.len() > usize::from(constraints.max_simultaneous_keys)
                || keys.last().unwrap() - keys.first().unwrap()
                    > constraints.max_held_span_semitones
            {
                return Err(error(
                    "progression_invalid_layer",
                    "Final layer violates instrument range, onset targets, held keys or pitch span",
                ));
            }
            active.push(i);
        }
        Ok(())
    }
}

fn generate_with_budget(
    source: &PracticeSource,
    selection: &AssistanceSelection,
    layer: ProgressionLayer,
    budget: usize,
) -> Result<CheckedPracticeProgression, PracticeAssistanceError> {
    if !matches!(selection.profile, InstrumentProfile::Piano { .. }) {
        return Err(error(
            "progression_profile",
            "Progressive keyboard v1 supports piano profiles only",
        ));
    }
    let (selection, groups) = automatic_assistance::groups(source, selection, false)?;
    let context = Context::new(source, &groups, &selection.profile)?;
    let mut work = Work { remaining: budget };
    let mut eligible: HashSet<_> = groups
        .atoms
        .iter()
        .enumerate()
        .filter(|(atom, ids)| {
            !ids.is_empty()
                && !groups.cross_scope.contains(atom)
                && !ids.iter().any(|id| source.keyboard_excluded.contains(id))
        })
        .map(|(atom, _)| atom)
        .collect();
    let mut retained_layers: Vec<HashSet<usize>> = vec![HashSet::new(); 3];
    for (index, (_, constraints)) in LAYERS.iter().enumerate().rev() {
        let retained = context.select(&eligible, *constraints, &mut work)?;
        context.verify(&retained, *constraints, &mut work)?;
        if !retained.is_subset(&eligible) {
            return Err(error(
                "progression_invalid_hierarchy",
                "A stricter layer introduced a new source atom",
            ));
        }
        retained_layers[index] = retained.clone();
        eligible = retained;
    }
    let memberships: Vec<Vec<String>> = retained_layers
        .iter()
        .map(|retained| {
            let mut ids: Vec<_> = groups
                .atoms
                .iter()
                .enumerate()
                .filter(|(atom, _)| retained.contains(atom))
                .flat_map(|(_, ids)| ids.iter().cloned())
                .collect();
            ids.sort();
            ids
        })
        .collect();
    let layers = LAYERS
        .iter()
        .enumerate()
        .map(|(index, (layer, constraints))| {
            let retained = &retained_layers[index];
            let human_occurrence_count = groups
                .selected
                .groups
                .iter()
                .enumerate()
                .filter(|(i, _)| retained.contains(&groups.roots[*i]))
                .map(|(_, group)| group.source_occurrence_ids.len())
                .sum();
            let human_target_count = groups
                .roots
                .iter()
                .filter(|atom| retained.contains(atom))
                .count();
            ProgressionLayerSummary {
                layer: *layer,
                constraints: *constraints,
                human_source_unit_count: memberships[index].len(),
                human_occurrence_count,
                human_target_count,
                scored_mode_allowed: human_target_count != 0,
                equals_previous_layer: index != 0 && memberships[index] == memberships[index - 1],
            }
        })
        .collect::<Vec<_>>();
    let selection_digest = hash(&(PLAN_FORMAT, "selection", source.receipt(), &selection))?;
    let scheme_digest = hash(&(
        PLAN_FORMAT,
        SCHEMA_VERSION,
        PLANNER_REVISION,
        ALGORITHM_ID,
        SCHEME_ID,
        &LAYERS,
    ))?;
    let hierarchy_digest = hash(&(
        PLAN_FORMAT,
        "hierarchy",
        &selection_digest,
        &scheme_digest,
        &memberships,
    ))?;
    let mut plan = PracticeProgressionPlan {
        format: PLAN_FORMAT.into(),
        schema_version: SCHEMA_VERSION,
        planner_revision: PLANNER_REVISION,
        revision: 1,
        algorithm_id: ALGORITHM_ID.into(),
        scheme_id: SCHEME_ID.into(),
        receipt: source.receipt().clone(),
        selection,
        selection_digest,
        scheme_digest,
        hierarchy_digest,
        layer,
        plan_digest: String::new(),
    };
    plan.plan_digest = hash(&plan)?;
    let mut assistance =
        automatic_assistance::create(source, &plan.selection, &memberships[layer.index()])?;
    // A whole cross-scope atom necessarily names sources outside selected parts.
    // Preserve that specific reason in the progression wrapper so consumers can
    // distinguish it from an ordinary explicit exclusion. Legacy v1 entrypoints
    // and the checked Explicit plan remain unchanged.
    let cross_scope_first_ids: HashSet<_> = groups
        .cross_scope
        .iter()
        .map(|atom| groups.atoms[*atom][0].as_str())
        .collect();
    for reason in &mut assistance.exclusion_reasons {
        if reason
            .source_ids
            .first()
            .is_some_and(|id| cross_scope_first_ids.contains(id.as_str()))
        {
            reason.code = "cross_scope_physical_group".into();
        }
    }
    let chosen = &layers[layer.index()];
    if assistance.coverage.human_target_count != chosen.human_target_count
        || assistance.coverage.human_occurrence_count != chosen.human_occurrence_count
        || assistance.coverage.human_source_unit_count != chosen.human_source_unit_count
        || assistance.scored_mode_allowed != chosen.scored_mode_allowed
    {
        return Err(error(
            "progression_invalid_hierarchy",
            "Chosen assistance disagrees with its independently verified layer",
        ));
    }
    let result = CheckedPracticeProgression {
        plan,
        layers,
        assistance,
    };
    ensure_response_limit(&result, MAX_RESPONSE_BYTES)?;
    Ok(result)
}

/// Count the complete wrapper without allocating a second full JSON response.
/// Nothing is truncated or emitted until every layer and the final size pass.
fn ensure_response_limit<T: Serialize>(
    value: &T,
    limit: usize,
) -> Result<(), PracticeAssistanceError> {
    struct Counter {
        remaining: usize,
        exceeded: bool,
    }
    impl Write for Counter {
        fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
            if bytes.len() > self.remaining {
                self.exceeded = true;
                return Err(io::Error::other(
                    "Complete progression response is too large",
                ));
            }
            self.remaining -= bytes.len();
            Ok(bytes.len())
        }
        fn flush(&mut self) -> io::Result<()> {
            Ok(())
        }
    }
    let mut counter = Counter {
        remaining: limit,
        exceeded: false,
    };
    let encoded = serde_json::to_writer(&mut counter, value);
    if counter.exceeded {
        return Err(error("progression_response_limit", "Complete progression response exceeds its serialization budget (16 MiB on the wire); no layer, ownership or source IDs were truncated"));
    }
    encoded.map_err(encoding)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{Beat, Note, Pitch, Score};

    fn fixture() -> Score {
        let mut score = crate::catalog().remove(0);
        score.parts.truncate(1);
        score.parts[0].notes = [60, 64, 67, 72]
            .into_iter()
            .enumerate()
            .map(|(i, midi)| {
                let (step, octave) = match midi {
                    60 => ("C", 4),
                    64 => ("E", 4),
                    67 => ("G", 4),
                    _ => ("C", 5),
                };
                Note {
                    id: format!("atom-{i}"),
                    at: Beat::ZERO,
                    duration: Beat::new(1, 1),
                    pitch: Some(Pitch {
                        step: step.into(),
                        alter: 0,
                        octave,
                    }),
                    voice: "1".into(),
                    staff: 1,
                    velocity: 90,
                    tie_start: false,
                    tie_stop: false,
                }
            })
            .collect();
        score.measures.clear();
        score.repeats.clear();
        score.source = None;
        score
    }
    fn selection(source: &PracticeSource) -> AssistanceSelection {
        AssistanceSelection {
            selected_part_ids: source.part_ids().to_vec(),
            profile: InstrumentProfile::Piano {
                key_count: 88,
                lowest_midi: None,
            },
        }
    }
    #[test]
    fn three_layers_share_hierarchy_but_bind_chosen_layer() {
        let source = PracticeSource::from_canonical(&fixture()).unwrap();
        let selection = selection(&source);
        let results: Vec<_> = LAYERS
            .iter()
            .map(|(layer, _)| generate(&source, &selection, *layer).unwrap())
            .collect();
        let expected = [1, 2, 4];
        for (i, checked) in results.iter().enumerate() {
            assert_eq!(checked.assistance.coverage.human_target_count, expected[i]);
            assert_eq!(
                checked.plan.hierarchy_digest,
                results[0].plan.hierarchy_digest
            );
            assert_eq!(
                checked.plan.selection_digest,
                results[0].plan.selection_digest
            );
            assert_eq!(checked.plan.scheme_digest, results[0].plan.scheme_digest);
            assert_eq!(
                serde_json::to_value(validate(&source, &checked.plan).unwrap()).unwrap(),
                serde_json::to_value(checked).unwrap()
            );
            if i != 0 {
                assert_ne!(checked.plan.plan_digest, results[i - 1].plan.plan_digest);
                assert!(results[i - 1]
                    .assistance
                    .plan
                    .human_source_ids
                    .iter()
                    .all(|id| checked.assistance.plan.human_source_ids.contains(id)));
            }
        }
        let mut changed = results[0].plan.clone();
        changed.layer = ProgressionLayer::Dense;
        assert_eq!(
            validate(&source, &changed).unwrap_err().code,
            "progression_plan_mismatch"
        );
    }
    #[test]
    fn shared_work_budget_rejects_whole_hierarchy_without_partial_result() {
        let source = PracticeSource::from_canonical(&fixture()).unwrap();
        assert_eq!(
            generate_with_budget(&source, &selection(&source), ProgressionLayer::Single, 0)
                .unwrap_err()
                .code,
            "progression_work_limit"
        );
        // Exhaustion after the complete dense layer also rejects the whole
        // hierarchy; the successful widest layer is never returned on its own.
        let (selection, groups) =
            automatic_assistance::groups(&source, &selection(&source), false).unwrap();
        let context = Context::new(&source, &groups, &selection.profile).unwrap();
        let eligible = groups.roots.iter().copied().collect();
        let mut work = Work {
            remaining: MAX_HIERARCHY_WORK,
        };
        let dense = context.select(&eligible, LAYERS[2].1, &mut work).unwrap();
        context.verify(&dense, LAYERS[2].1, &mut work).unwrap();
        assert_eq!(
            generate_with_budget(
                &source,
                &selection,
                ProgressionLayer::Dense,
                MAX_HIERARCHY_WORK - work.remaining
            )
            .unwrap_err()
            .code,
            "progression_work_limit"
        );
        assert!(generate(&source, &selection, ProgressionLayer::Single).is_ok());
    }
    #[test]
    fn complete_wrapper_has_an_exact_serialized_response_budget() {
        let source = PracticeSource::from_canonical(&fixture()).unwrap();
        let checked = generate(&source, &selection(&source), ProgressionLayer::Single).unwrap();
        let bytes = serde_json::to_vec(&checked).unwrap();
        ensure_response_limit(&checked, bytes.len()).unwrap();
        assert_eq!(
            ensure_response_limit(&checked, bytes.len() - 1)
                .unwrap_err()
                .code,
            "progression_response_limit"
        );
    }
    #[test]
    fn final_set_verifier_rejects_a_too_wide_onset() {
        let source = PracticeSource::from_canonical(&fixture()).unwrap();
        let (selection, groups) =
            automatic_assistance::groups(&source, &selection(&source), false).unwrap();
        let context = Context::new(&source, &groups, &selection.profile).unwrap();
        let all = groups.roots.iter().copied().collect();
        assert_eq!(
            context
                .verify(
                    &all,
                    LAYERS[0].1,
                    &mut Work {
                        remaining: MAX_HIERARCHY_WORK
                    }
                )
                .unwrap_err()
                .code,
            "progression_invalid_layer"
        );
        assert!(context
            .verify(
                &all,
                LAYERS[2].1,
                &mut Work {
                    remaining: MAX_HIERARCHY_WORK
                }
            )
            .is_ok());
    }
    #[test]
    fn cross_scope_atom_can_make_every_layer_empty_but_never_scoreable() {
        let mut score = fixture();
        score.parts[0].notes.truncate(1);
        let mut second = score.parts[0].clone();
        second.id = "other".into();
        second.notes[0].id = "other-note".into();
        score.parts.push(second);
        let source = PracticeSource::from_canonical(&score).unwrap();
        let mut selection = selection(&source);
        selection.selected_part_ids.truncate(1);
        let result = generate(&source, &selection, ProgressionLayer::Balanced).unwrap();
        assert!(result
            .layers
            .iter()
            .all(|layer| layer.human_target_count == 0 && !layer.scored_mode_allowed));
        assert!(!result.layers[0].equals_previous_layer);
        assert!(result.layers[1..]
            .iter()
            .all(|layer| layer.equals_previous_layer));
        assert_eq!(
            result.assistance.machine_occurrence_ids.len(),
            source.timeline().notes.len()
        );
        assert_eq!(result.assistance.exclusion_reasons.len(), 1);
        assert_eq!(
            result.assistance.exclusion_reasons[0].code,
            "cross_scope_physical_group"
        );
        assert_eq!(
            result.assistance.exclusion_reasons[0].source_ids,
            vec!["atom-0", "other-note"]
        );
        assert_eq!(
            serde_json::to_value(validate(&source, &result.plan).unwrap()).unwrap(),
            serde_json::to_value(&result).unwrap()
        );
        // The independent progression diagnostic must not migrate old v1 output.
        assert_eq!(
            automatic_assistance::create(&source, &selection, &[])
                .unwrap()
                .exclusion_reasons[0]
                .code,
            "explicit_machine"
        );
        assert!(automatic_assistance::original(&source, &selection).is_err());
    }
}

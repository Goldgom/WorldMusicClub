//! Advisory whole-phrase guitar planning; it never changes score or assessment.
use crate::{
    fingering_clock::{exact_notes, ExactNote, Moment},
    instruments::{analyze_instrument, InstrumentProfile},
    Diagnostic, Score,
};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::sync::Arc;

const MAX_NOTES: usize = 1000;
const MAX_SOURCE_REFERENCES: usize = 16_384;
const BEAM: usize = 64;
const MAX_EXPANSIONS: usize = 2_000_000;
const MAX_RESPONSE_BYTES: usize = 8 * 1024 * 1024;
fn default_span() -> u8 {
    3
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct GuitarFingeringLock {
    pub source_note_id: String,
    pub string: Option<u8>,
    pub fret: Option<u8>,
    pub finger: Option<u8>,
}
#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GuitarFingeringRequest {
    pub score: Score,
    pub part_id: Option<String>,
    pub profile: InstrumentProfile,
    #[serde(default = "default_span")]
    pub max_fret_span: u8,
    #[serde(default)]
    pub locks: Vec<GuitarFingeringLock>,
}
#[derive(Clone, Debug, Serialize)]
pub struct GuitarAssignment {
    pub occurrence_id: String,
    pub source_note_ids: Vec<String>,
    pub part_id: String,
    pub midi: u8,
    pub start_ms: f64,
    pub end_ms: f64,
    /// One-based row in the supplied tuning array, matching InstrumentReport.
    pub string: u8,
    /// Relative to the capo, as in the existing fretboard profile.
    pub fret: u8,
    /// 0=open, 1=index, 2=middle, 3=ring, 4=little; no thumb model.
    pub finger: u8,
    pub onset_index: usize,
    /// Separate heuristic only. It is never validated by pitch-only MIDI.
    pub picking_hint: String,
}
#[derive(Clone, Debug, Serialize)]
pub struct GuitarFingeringPlan {
    pub version: u32,
    pub algorithm: String,
    pub score_id: String,
    pub part_id: Option<String>,
    pub status: String,
    pub profile: InstrumentProfile,
    pub complete: bool,
    pub changed_source_notes: bool,
    pub source_occurrence_count: usize,
    pub max_fret_span: u8,
    pub beam_width: usize,
    pub explored_choices: usize,
    pub beam_pruned: bool,
    pub objective_cost: Option<u64>,
    pub assignments: Vec<GuitarAssignment>,
    pub requested_locks: Vec<GuitarFingeringLock>,
    pub diagnostics: Vec<Diagnostic>,
}

fn finish_plan(plan: GuitarFingeringPlan) -> Result<GuitarFingeringPlan, String> {
    struct Budget(usize);
    impl std::io::Write for Budget {
        fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
            self.0 = self.0.checked_sub(bytes.len()).ok_or_else(||std::io::Error::other("Guitar guidance exceeds 8 MiB; choose a smaller phrase. No source notes or warnings were truncated"))?;
            Ok(bytes.len())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }
    serde_json::to_writer(Budget(MAX_RESPONSE_BYTES), &plan).map_err(|e| e.to_string())?;
    Ok(plan)
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
struct Position {
    string: u8,
    fret: u8,
    finger: u8,
}
#[derive(Clone, Debug)]
struct Held {
    index: usize,
    position: Position,
    end: Moment,
}
#[derive(Clone)]
struct Path {
    previous: Option<Arc<Path>>,
    added: Vec<(usize, Position)>,
    onset: usize,
}
#[derive(Clone)]
struct State {
    held: Vec<Held>,
    anchor: u8,
    last_string: Option<u8>,
    last_ms: Option<f64>,
    cost: u64,
    path: Option<Arc<Path>>,
}
impl State {
    fn same_future(&self, other: &Self) -> bool {
        self.anchor == other.anchor
            && self.last_string == other.last_string
            && self.held.len() == other.held.len()
            && self
                .held
                .iter()
                .zip(&other.held)
                .all(|(a, b)| a.index == b.index && a.position == b.position)
    }
}

fn fits(held: &[Held], position: Position, max_span: u8) -> bool {
    if held.iter().any(|n| n.position.string == position.string) {
        return false;
    }
    let positions: Vec<_> = held.iter().map(|n| n.position).chain([position]).collect();
    let fretted: Vec<_> = positions.iter().filter(|p| p.fret > 0).collect();
    if let (Some(low), Some(high)) = (
        fretted.iter().map(|p| p.fret).min(),
        fretted.iter().map(|p| p.fret).max(),
    ) {
        if high - low > max_span {
            return false;
        }
    }
    for a in &fretted {
        for b in &fretted {
            if a.finger == b.finger && a.fret != b.fret || a.finger < b.finger && a.fret > b.fret {
                return false;
            }
            // A same-finger barre covers the strings between its two endpoints.
            if a.finger == b.finger
                && positions.iter().any(|p| {
                    p.string > a.string.min(b.string)
                        && p.string < a.string.max(b.string)
                        && p.fret < a.fret
                })
            {
                return false;
            }
        }
    }
    true
}

fn movement_cost(
    previous: &State,
    held: &[Held],
    added: &[(usize, Position)],
    now: f64,
) -> (u8, u8, u64) {
    let mut implied: Vec<_> = held
        .iter()
        .filter(|n| n.position.fret > 0)
        .map(|n| (i16::from(n.position.fret) - i16::from(n.position.finger) + 1).max(1) as u8)
        .collect();
    implied.sort_unstable();
    let anchor = if implied.is_empty() {
        previous.anchor
    } else {
        implied[implied.len() / 2]
    };
    let elapsed = previous.last_ms.map_or(1000., |last| (now - last).max(0.));
    let speed_weight = 1 + (1000. / (elapsed + 50.)).floor() as u64;
    let shift = u64::from(anchor.abs_diff(previous.anchor)) * 100 * speed_weight;
    let posture: u64 = held
        .iter()
        .filter(|n| n.position.fret > 0)
        .map(|n| {
            let p = n.position;
            let ideal = i16::from(anchor) + i16::from(p.finger) - 1;
            u64::from((i16::from(p.fret) - ideal).unsigned_abs()) * 10
        })
        .sum();
    let low = held
        .iter()
        .filter(|n| n.position.fret > 0)
        .map(|n| n.position.fret)
        .min()
        .unwrap_or(0);
    let high = held.iter().map(|n| n.position.fret).max().unwrap_or(0);
    let span = u64::from(high - low);
    let fretting = added.iter().filter(|(_, p)| p.fret > 0).count() as u64 * 3;
    let mut by_finger = [0_u64; 5];
    for n in held {
        by_finger[n.position.finger as usize] += 1;
    }
    let barre = by_finger[1..]
        .iter()
        .map(|count| count.saturating_sub(1) * 20)
        .sum::<u64>();
    let first_string = added
        .iter()
        .map(|(_, p)| p.string)
        .min()
        .expect("nonempty onset");
    let last_string = added
        .iter()
        .map(|(_, p)| p.string)
        .max()
        .expect("nonempty onset");
    let crossing = previous
        .last_string
        .map_or(0, |last| u64::from(last.abs_diff(first_string)) * 8);
    (
        anchor,
        last_string,
        shift + posture + span * span * 3 + fretting + barre + crossing,
    )
}

struct Search<'a> {
    notes: &'a [ExactNote],
    choices: &'a [Vec<Position>],
    group: &'a [usize],
    span: u8,
    onset: usize,
    explored: &'a mut usize,
    exhausted: &'a mut bool,
    pruned: &'a mut bool,
    next: &'a mut Vec<State>,
}
impl Search<'_> {
    fn walk(
        &mut self,
        previous: &State,
        held: &mut Vec<Held>,
        added: &mut Vec<(usize, Position)>,
        depth: usize,
    ) {
        if *self.exhausted {
            return;
        }
        if depth == self.group.len() {
            let now = self.notes[self.group[0]].note.start_ms;
            let (anchor, last_string, cost) = movement_cost(previous, held, added, now);
            let mut state = State {
                held: held.clone(),
                anchor,
                last_string: Some(last_string),
                last_ms: Some(now),
                cost: previous.cost + cost,
                path: None,
            };
            state.held.sort_by_key(|n| n.index);
            if let Some(index) = self
                .next
                .iter()
                .position(|candidate| candidate.same_future(&state))
            {
                if self.next[index].cost <= state.cost {
                    return;
                }
                self.next.remove(index);
            }
            let index = self
                .next
                .partition_point(|candidate| candidate.cost <= state.cost);
            if index >= BEAM {
                *self.pruned = true;
                return;
            }
            state.path = Some(Arc::new(Path {
                previous: previous.path.clone(),
                added: added.clone(),
                onset: self.onset,
            }));
            self.next.insert(index, state);
            if self.next.len() > BEAM {
                self.next.pop();
                *self.pruned = true;
            }
            return;
        }
        let index = self.group[depth];
        for &position in &self.choices[index] {
            if *self.explored >= MAX_EXPANSIONS {
                *self.exhausted = true;
                return;
            }
            *self.explored += 1;
            if !fits(held, position, self.span) {
                continue;
            }
            held.push(Held {
                index,
                position,
                end: self.notes[index].end,
            });
            added.push((index, position));
            self.walk(previous, held, added, depth + 1);
            added.pop();
            held.pop();
        }
    }
}

pub fn plan_guitar_fingering(
    request: GuitarFingeringRequest,
) -> Result<GuitarFingeringPlan, String> {
    let InstrumentProfile::Guitar {
        tuning,
        frets,
        capo,
    } = &request.profile
    else {
        return Err("Guitar fingering needs a guitar profile".into());
    };
    if request.max_fret_span > 12 || request.locks.len() > MAX_NOTES {
        return Err("Use a fret span of 0–12 and at most 1,000 source-note locks".into());
    }
    let compiled = crate::compile(request.score)?;
    let selected_count = compiled
        .timeline
        .notes
        .iter()
        .filter(|note| {
            request
                .part_id
                .as_ref()
                .is_none_or(|id| &note.part_id == id)
        })
        .count();
    let references: usize = compiled
        .timeline
        .notes
        .iter()
        .filter(|note| {
            request
                .part_id
                .as_ref()
                .is_none_or(|id| &note.part_id == id)
        })
        .map(|note| note.source_note_ids.len())
        .sum();
    let mut plan = GuitarFingeringPlan {
        version: 1,
        algorithm: "deterministic_guitar_beam_v1".into(),
        score_id: compiled.score.id.clone(),
        part_id: request.part_id.clone(),
        status: "unavailable".into(),
        profile: request.profile.clone(),
        complete: false,
        changed_source_notes: false,
        source_occurrence_count: selected_count,
        max_fret_span: request.max_fret_span,
        beam_width: BEAM,
        explored_choices: 0,
        beam_pruned: false,
        objective_cost: None,
        assignments: vec![],
        requested_locks: request.locks.clone(),
        diagnostics: compiled.diagnostics.clone(),
    };
    plan.diagnostics.push(Diagnostic::warning("guitar_fingering_model", "Advisory bounded whole-phrase search, not a global or biomechanical optimum. It models exact held strings, four ordered fretting fingers, simple barres and a configurable fret span. Bends, slides, harmonics, thumb fretting, muting, sound decay and physical technique are not modeled. Pitch-only MIDI cannot verify this fingering. Picking hints are separate heuristics.",None));
    if selected_count > MAX_NOTES || references > MAX_SOURCE_REFERENCES {
        plan.diagnostics.push(Diagnostic::warning("guitar_fingering_limit","Plan at most 1,000 sounding occurrences and 16,384 tied-source references; choose a shorter phrase or part. No score events were removed.",None));
        return finish_plan(plan);
    }
    let notes = exact_notes(&compiled, request.part_id.as_deref())?;
    let selected = crate::Timeline {
        notes: notes.iter().map(|n| n.note.clone()).collect(),
        duration_ms: compiled.timeline.duration_ms,
    };
    let report = analyze_instrument(&selected, &request.profile)?;
    plan.diagnostics.extend(
        report
            .diagnostics
            .iter()
            .filter(|d| d.code != "guitar_fingering_advisory")
            .cloned(),
    );
    let sources: HashSet<_> = notes
        .iter()
        .flat_map(|n| n.note.source_note_ids.iter().map(String::as_str))
        .collect();
    let mut locked = HashSet::new();
    for lock in &request.locks {
        if !sources.contains(lock.source_note_id.as_str())
            || !locked.insert(&lock.source_note_id)
            || lock.string.is_none() && lock.fret.is_none() && lock.finger.is_none()
            || lock
                .string
                .is_some_and(|s| s == 0 || usize::from(s) > tuning.len())
            || lock.fret.is_some_and(|f| f > frets - capo)
            || lock.finger.is_some_and(|f| f > 4)
        {
            return Err("Each fingering lock must name one unique selected sounding source note and valid string/fret/finger constraints".into());
        }
    }
    if notes.is_empty() {
        plan.status = "no_targets".into();
        plan.complete = true;
        plan.objective_cost = Some(0);
        return finish_plan(plan);
    }
    let options: HashMap<_, _> = report
        .note_options
        .iter()
        .map(|n| (n.note_id.as_str(), &n.positions))
        .collect();
    let choices: Vec<Vec<Position>> = notes
        .iter()
        .map(|n| {
            options[n.note.id.as_str()]
                .iter()
                .flat_map(|p| {
                    let fingers: Vec<u8> = if p.fret == 0 {
                        vec![0]
                    } else {
                        vec![1, 2, 3, 4]
                    };
                    fingers.into_iter().map(move |finger| Position {
                        string: p.string,
                        fret: p.fret,
                        finger,
                    })
                })
                .filter(|p| {
                    request
                        .locks
                        .iter()
                        .filter(|lock| n.note.source_note_ids.contains(&lock.source_note_id))
                        .all(|lock| {
                            lock.string.is_none_or(|s| s == p.string)
                                && lock.fret.is_none_or(|f| f == p.fret)
                                && lock.finger.is_none_or(|f| f == p.finger)
                        })
                })
                .collect()
        })
        .collect();
    if let Some(index) = choices.iter().position(Vec::is_empty) {
        plan.status = "infeasible_under_model".into();
        plan.diagnostics.push(Diagnostic::warning("guitar_fingering_no_position","This occurrence has no position satisfying the tuning, range and all source-note locks. No partial recommendation is returned.",Some(notes[index].note.id.clone())));
        return finish_plan(plan);
    }
    let mut beam = vec![State {
        held: vec![],
        anchor: 1,
        last_string: None,
        last_ms: None,
        cost: 0,
        path: None,
    }];
    let (mut first, mut onset) = (0, 0);
    while first < notes.len() {
        let mut last = first + 1;
        while last < notes.len() && notes[last].start == notes[first].start {
            last += 1;
        }
        let mut group: Vec<_> = (first..last).collect();
        group.sort_by_key(|&i| (choices[i].len(), i));
        let mut next = vec![];
        let mut exhausted = false;
        for previous in &beam {
            let mut held: Vec<_> = previous
                .held
                .iter()
                .filter(|n| n.end > notes[first].start)
                .cloned()
                .collect();
            if held.len() + group.len() > tuning.len() {
                continue;
            }
            let mut search = Search {
                notes: &notes,
                choices: &choices,
                group: &group,
                span: request.max_fret_span,
                onset,
                explored: &mut plan.explored_choices,
                exhausted: &mut exhausted,
                pruned: &mut plan.beam_pruned,
                next: &mut next,
            };
            search.walk(previous, &mut held, &mut vec![], 0);
            if exhausted {
                break;
            }
        }
        if exhausted || next.is_empty() {
            plan.status = if exhausted {
                "search_limit"
            } else if plan.beam_pruned {
                "no_plan_found"
            } else {
                "infeasible_under_model"
            }
            .into();
            plan.diagnostics.push(Diagnostic::warning("guitar_fingering_incomplete",format!("No complete recommendation at onset {}. {} Source notes, playback and scoring are unchanged; change locks, reach, selected part or arrangement.",onset+1,if exhausted{"The bounded search exhausted its work budget."}else if plan.beam_pruned{"Previously pruned paths might contain a solution."}else{"All paths violate the declared string/finger/held-note model."}),Some(notes[first].note.id.clone())));
            return finish_plan(plan);
        }
        beam = next;
        first = last;
        onset += 1;
    }
    let best = &beam[0];
    plan.objective_cost = Some(best.cost);
    let mut paths = vec![];
    let mut link = best.path.as_deref();
    while let Some(path) = link {
        paths.push(path);
        link = path.previous.as_deref();
    }
    for path in paths.into_iter().rev() {
        for &(index, p) in &path.added {
            let n = &notes[index].note;
            plan.assignments.push(GuitarAssignment {
                occurrence_id: n.id.clone(),
                source_note_ids: n.source_note_ids.clone(),
                part_id: n.part_id.clone(),
                midi: n.midi,
                start_ms: n.start_ms,
                end_ms: n.start_ms + n.duration_ms,
                string: p.string,
                fret: p.fret,
                finger: p.finger,
                onset_index: path.onset,
                picking_hint: if path.added.len() > 1 {
                    "simultaneous_pluck_review".into()
                } else if path.onset % 2 == 0 {
                    "downstroke_suggestion".into()
                } else {
                    "upstroke_suggestion".into()
                },
            });
        }
    }
    plan.assignments.sort_by(|a, b| {
        a.start_ms
            .total_cmp(&b.start_ms)
            .then(a.occurrence_id.cmp(&b.occurrence_id))
    });
    if plan.assignments.len() != notes.len() {
        return Err("Fingering reconstruction did not preserve every occurrence".into());
    }
    plan.status = "ready".into();
    plan.complete = true;
    finish_plan(plan)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{Beat, Measure, Note, Pitch, Repeat};
    fn request(
        events: &[(u8, i64, i64)],
        tuning: Vec<u8>,
        frets: u8,
        capo: u8,
    ) -> GuitarFingeringRequest {
        let mut score = crate::catalog().remove(0);
        score.id = "original-guitar-planner-test".into();
        score.title = "Original guitar planner test".into();
        score.source = None;
        score.tempo[0].bpm = 120.;
        let spellings = [
            ("C", 0),
            ("C", 1),
            ("D", 0),
            ("D", 1),
            ("E", 0),
            ("F", 0),
            ("F", 1),
            ("G", 0),
            ("G", 1),
            ("A", 0),
            ("A", 1),
            ("B", 0),
        ];
        score.parts[0].notes = events
            .iter()
            .enumerate()
            .map(|(index, &(midi, at, duration))| {
                let (step, alter) = spellings[midi as usize % 12];
                Note {
                    id: format!("source-{index}"),
                    at: Beat::new(at, 1),
                    duration: Beat::new(duration, 1),
                    pitch: Some(Pitch {
                        step: step.into(),
                        alter,
                        octave: (midi / 12) as i8 - 1,
                    }),
                    voice: "1".into(),
                    staff: 1,
                    velocity: 90,
                    tie_start: false,
                    tie_stop: false,
                }
            })
            .collect();
        score.measures = vec![Measure {
            number: 1,
            at: Beat::ZERO,
            length: Beat::new(
                events
                    .iter()
                    .map(|(_, at, duration)| at + duration)
                    .max()
                    .unwrap_or(4),
                1,
            ),
        }];
        GuitarFingeringRequest {
            score,
            part_id: None,
            profile: InstrumentProfile::Guitar {
                tuning,
                frets,
                capo,
            },
            max_fret_span: 3,
            locks: vec![],
        }
    }
    fn standard(events: &[(u8, i64, i64)], frets: u8) -> GuitarFingeringRequest {
        request(events, vec![40, 45, 50, 55, 59, 64], frets, 0)
    }
    #[test]
    fn whole_phrase_chooses_a_costlier_first_position_to_keep_a_later_string_free() {
        let request = standard(&[(64, 0, 2), (67, 1, 1)], 5);
        let before = serde_json::to_value(&request.score).unwrap();
        let plan = plan_guitar_fingering(request.clone()).unwrap();
        assert!(plan.complete);
        assert_eq!(plan.status, "ready");
        assert_eq!(
            plan.assignments
                .iter()
                .map(|n| (n.string, n.fret))
                .collect::<Vec<_>>(),
            vec![(5, 5), (6, 3)],
            "Open high E would block the only available later G position"
        );
        assert_eq!(plan.assignments.len(), 2);
        assert!(!plan.changed_source_notes);
        assert_eq!(serde_json::to_value(request.score).unwrap(), before);
        assert_eq!(
            serde_json::to_value(plan.clone()).unwrap(),
            serde_json::to_value(
                plan_guitar_fingering(standard(&[(64, 0, 2), (67, 1, 1)], 5)).unwrap()
            )
            .unwrap()
        );
    }
    #[test]
    fn held_strings_are_reserved_but_exact_rational_release_allows_reuse() {
        let blocked =
            plan_guitar_fingering(request(&[(60, 0, 2), (62, 1, 1)], vec![60], 4, 0)).unwrap();
        assert_eq!(blocked.status, "infeasible_under_model");
        assert!(!blocked.complete);
        assert!(blocked.assignments.is_empty());
        assert_eq!(blocked.source_occurrence_count, 2);
        let mut exact = request(&[(60, 0, 1), (62, 1, 1)], vec![60], 4, 0);
        exact.score.parts[0].notes[0].duration = Beat::new(1, 3);
        exact.score.parts[0].notes[1].at = Beat::new(2, 6);
        exact.score.parts[0].notes[1].duration = Beat::new(1, 3);
        let ready = plan_guitar_fingering(exact).unwrap();
        assert!(ready.complete);
        assert_eq!(ready.assignments.len(), 2);
        assert!(ready.assignments.iter().all(|n| n.string == 1));
    }
    #[test]
    fn tied_source_locks_apply_to_one_held_attack_and_conflicts_return_no_partial_plan() {
        let mut tied = request(&[(62, 0, 1), (62, 1, 1)], vec![60], 4, 0);
        tied.score.parts[0].notes[0].tie_start = true;
        tied.score.parts[0].notes[1].tie_stop = true;
        tied.locks = vec![
            GuitarFingeringLock {
                source_note_id: "source-0".into(),
                string: Some(1),
                fret: Some(2),
                finger: Some(2),
            },
            GuitarFingeringLock {
                source_note_id: "source-1".into(),
                string: Some(1),
                fret: Some(2),
                finger: Some(2),
            },
        ];
        let ready = plan_guitar_fingering(tied.clone()).unwrap();
        assert!(ready.complete);
        assert_eq!(ready.source_occurrence_count, 1);
        assert_eq!(
            ready.assignments[0].source_note_ids,
            vec!["source-0", "source-1"]
        );
        assert_eq!(ready.assignments[0].finger, 2);
        tied.locks[1].finger = Some(3);
        let blocked = plan_guitar_fingering(tied).unwrap();
        assert!(!blocked.complete);
        assert_eq!(blocked.status, "infeasible_under_model");
        assert!(blocked.assignments.is_empty());
        assert_eq!(blocked.requested_locks.len(), 2);
    }
    #[test]
    fn capo_relative_open_strings_and_requested_reach_are_explicit() {
        let ready =
            plan_guitar_fingering(request(&[(62, 0, 1), (64, 1, 1)], vec![60], 5, 2)).unwrap();
        assert!(ready.complete);
        assert_eq!(
            (ready.assignments[0].fret, ready.assignments[0].finger),
            (0, 0)
        );
        assert_eq!(ready.assignments[1].fret, 2);
        let mut chord = request(&[(62, 0, 2), (67, 0, 2)], vec![60, 64], 3, 0);
        chord.max_fret_span = 0;
        let blocked = plan_guitar_fingering(chord.clone()).unwrap();
        assert_eq!(blocked.status, "infeasible_under_model");
        assert!(blocked.assignments.is_empty());
        chord.max_fret_span = 1;
        let ready = plan_guitar_fingering(chord).unwrap();
        assert!(ready.complete);
        assert_ne!(ready.assignments[0].string, ready.assignments[1].string);
        assert!(ready
            .assignments
            .iter()
            .all(|n| n.picking_hint == "simultaneous_pluck_review"));
    }
    #[test]
    fn barres_cannot_silently_raise_an_open_or_lower_fretted_sustained_string() {
        let end = Moment {
            segment: 0,
            at: Beat::new(4, 1),
        };
        let held = vec![
            Held {
                index: 0,
                position: Position {
                    string: 1,
                    fret: 1,
                    finger: 1,
                },
                end,
            },
            Held {
                index: 1,
                position: Position {
                    string: 2,
                    fret: 0,
                    finger: 0,
                },
                end,
            },
        ];
        assert!(!fits(
            &held,
            Position {
                string: 3,
                fret: 1,
                finger: 1
            },
            3
        ));
        let held = vec![
            held[0].clone(),
            Held {
                index: 1,
                position: Position {
                    string: 2,
                    fret: 3,
                    finger: 3,
                },
                end,
            },
        ];
        assert!(fits(
            &held,
            Position {
                string: 3,
                fret: 1,
                finger: 1
            },
            3
        ));
        assert!(!fits(
            &held,
            Position {
                string: 3,
                fret: 2,
                finger: 1
            },
            3
        ));
        assert!(!fits(
            &held,
            Position {
                string: 3,
                fret: 1,
                finger: 4
            },
            3
        ));
    }
    #[test]
    fn faster_scheduled_motion_costs_more_without_changing_the_requested_notes() {
        let mut slow = request(&[(61, 0, 1), (64, 1, 1)], vec![60], 4, 0);
        slow.score.tempo[0].bpm = 60.;
        slow.locks = (0..2)
            .map(|i| GuitarFingeringLock {
                source_note_id: format!("source-{i}"),
                string: None,
                fret: None,
                finger: Some(1),
            })
            .collect();
        let mut fast = slow.clone();
        fast.score.tempo[0].bpm = 240.;
        let a = plan_guitar_fingering(slow).unwrap();
        let b = plan_guitar_fingering(fast).unwrap();
        assert!(a.complete && b.complete);
        assert!(b.objective_cost > a.objective_cost);
        assert_eq!(
            a.assignments
                .iter()
                .map(|n| (n.midi, n.string, n.fret, n.finger))
                .collect::<Vec<_>>(),
            b.assignments
                .iter()
                .map(|n| (n.midi, n.string, n.fret, n.finger))
                .collect::<Vec<_>>()
        );
    }
    #[test]
    fn repeat_occurrences_and_source_locks_remain_complete_and_deterministic() {
        let mut input = request(&[(62, 0, 1), (64, 1, 1)], vec![60], 5, 0);
        input.score.repeats = vec![Repeat {
            from: Beat::ZERO,
            to: Beat::new(2, 1),
            times: 3,
        }];
        input.locks = vec![GuitarFingeringLock {
            source_note_id: "source-0".into(),
            string: Some(1),
            fret: Some(2),
            finger: Some(2),
        }];
        let compiled = crate::compile(input.score.clone()).unwrap();
        let plan = plan_guitar_fingering(input).unwrap();
        assert!(plan.complete);
        assert_eq!(plan.assignments.len(), 6);
        let mut expected: Vec<_> = compiled
            .timeline
            .notes
            .iter()
            .map(|n| n.id.clone())
            .collect();
        let mut actual: Vec<_> = plan
            .assignments
            .iter()
            .map(|n| n.occurrence_id.clone())
            .collect();
        expected.sort();
        actual.sort();
        assert_eq!(actual, expected);
        assert_eq!(
            plan.assignments
                .iter()
                .filter(|n| n.source_note_ids == ["source-0"] && n.finger == 2)
                .count(),
            3
        );
    }
    #[test]
    fn unavailable_ranges_and_long_phrases_never_return_a_truncated_recommendation() {
        let blocked =
            plan_guitar_fingering(request(&[(60, 0, 1), (80, 1, 1)], vec![60], 4, 0)).unwrap();
        assert!(!blocked.complete);
        assert!(blocked.assignments.is_empty());
        assert_eq!(blocked.source_occurrence_count, 2);
        let events: Vec<_> = (0..1001).map(|i| (60, i, 1)).collect();
        let limited = plan_guitar_fingering(request(&events, vec![60], 4, 0)).unwrap();
        assert_eq!(limited.status, "unavailable");
        assert_eq!(limited.source_occurrence_count, 1001);
        assert!(limited.assignments.is_empty());
        let mut bad = request(&[(60, 0, 1)], vec![60], 4, 0);
        bad.locks.push(GuitarFingeringLock {
            source_note_id: "missing".into(),
            string: Some(1),
            fret: None,
            finger: None,
        });
        assert!(plan_guitar_fingering(bad).is_err());
    }
}

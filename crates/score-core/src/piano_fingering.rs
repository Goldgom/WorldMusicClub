//! Advisory two-hand whole-phrase planning. Canonical music is never rewritten.
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
const MAX_RESPONSE_BYTES: usize = 8 * 1024 * 1024;
const BEAM: usize = 64;
const MAX_EXPANSIONS: usize = 2_000_000;

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "snake_case")]
pub enum PianoHand {
    Left,
    Right,
}
impl PianoHand {
    fn index(self) -> usize {
        match self {
            Self::Left => 0,
            Self::Right => 1,
        }
    }
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct PianoHandProfile {
    pub lowest_midi: u8,
    pub highest_midi: u8,
    pub max_span_semitones: u8,
}
impl Default for PianoHandProfile {
    fn default() -> Self {
        Self {
            lowest_midi: 0,
            highest_midi: 127,
            max_span_semitones: 12,
        }
    }
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct PianoFingeringLock {
    pub source_note_id: String,
    pub hand: Option<PianoHand>,
    /// 1=thumb, 2=index, 3=middle, 4=ring, 5=little, on either hand.
    pub finger: Option<u8>,
}
#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PianoFingeringRequest {
    pub score: Score,
    pub part_id: Option<String>,
    pub profile: InstrumentProfile,
    #[serde(default)]
    pub left_hand: PianoHandProfile,
    #[serde(default)]
    pub right_hand: PianoHandProfile,
    #[serde(default)]
    pub locks: Vec<PianoFingeringLock>,
}
#[derive(Clone, Debug, Serialize)]
pub struct PianoTarget {
    /// Same representative occurrence as the physical practice-target service.
    pub target_id: String,
    pub source_occurrence_ids: Vec<String>,
    pub source_note_ids: Vec<String>,
    pub part_ids: Vec<String>,
    pub midi: u8,
    pub start_ms: f64,
    pub end_ms: f64,
    pub onset_index: usize,
}
#[derive(Clone, Debug, Serialize)]
pub struct PianoAssignment {
    #[serde(flatten)]
    pub target: PianoTarget,
    pub hand: PianoHand,
    pub finger: u8,
}
#[derive(Clone, Debug, Serialize)]
pub struct PianoFingeringIssue {
    pub code: String,
    pub message: String,
    pub onset_index: Option<usize>,
    pub target_ids: Vec<String>,
    pub source_occurrence_ids: Vec<String>,
    pub source_note_ids: Vec<String>,
}
#[derive(Clone, Debug, Serialize)]
pub struct PianoFingeringPlan {
    pub version: u32,
    pub algorithm: String,
    pub score_id: String,
    pub part_id: Option<String>,
    pub status: String,
    pub profile: InstrumentProfile,
    pub left_hand: PianoHandProfile,
    pub right_hand: PianoHandProfile,
    pub complete: bool,
    pub changed_source_notes: bool,
    pub source_occurrence_count: usize,
    /// Unknown only when the input exceeds limits before exact grouping.
    pub physical_target_count: Option<usize>,
    pub beam_width: usize,
    pub max_expansions: usize,
    pub explored_choices: usize,
    pub beam_pruned: bool,
    pub objective_cost: Option<u64>,
    /// Retained on failed bounded searches; never an apparently complete prefix.
    pub targets: Vec<PianoTarget>,
    pub assignments: Vec<PianoAssignment>,
    pub requested_locks: Vec<PianoFingeringLock>,
    pub issues: Vec<PianoFingeringIssue>,
    pub diagnostics: Vec<Diagnostic>,
}
fn finish_plan(plan: PianoFingeringPlan) -> Result<PianoFingeringPlan, String> {
    struct Budget(usize);
    impl std::io::Write for Budget {
        fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
            self.0 = self.0.checked_sub(bytes.len()).ok_or_else(|| std::io::Error::other("Piano guidance exceeds 8 MiB; choose a smaller phrase. No source notes or warnings were truncated"))?;
            Ok(bytes.len())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }
    serde_json::to_writer(Budget(MAX_RESPONSE_BYTES), &plan).map_err(|e| e.to_string())?;
    Ok(plan)
}
#[derive(Clone)]
struct PhysicalNote {
    target: PianoTarget,
    start: Moment,
    end: Moment,
    /// A soft preference only; merged voices can suggest different hands.
    suggested_hands: Vec<PianoHand>,
}
fn physical_notes(notes: Vec<ExactNote>) -> Vec<PhysicalNote> {
    let mut output: Vec<PhysicalNote> = vec![];
    let mut onset = 0;
    for n in notes {
        let suggested = if n.note.staff >= 2 {
            PianoHand::Left
        } else {
            PianoHand::Right
        };
        if let Some(last) = output.last_mut() {
            if last.start == n.start && last.target.midi == n.note.midi {
                last.end = last.end.max(n.end);
                last.target.end_ms = last.target.end_ms.max(n.note.start_ms + n.note.duration_ms);
                last.target.source_occurrence_ids.push(n.note.id);
                last.target.source_note_ids.extend(n.note.source_note_ids);
                last.target.part_ids.push(n.note.part_id);
                last.suggested_hands.push(suggested);
                continue;
            }
            if last.start != n.start {
                onset += 1;
            }
        }
        output.push(PhysicalNote {
            start: n.start,
            end: n.end,
            suggested_hands: vec![suggested],
            target: PianoTarget {
                target_id: n.note.id.clone(),
                source_occurrence_ids: vec![n.note.id],
                source_note_ids: n.note.source_note_ids,
                part_ids: vec![n.note.part_id],
                midi: n.note.midi,
                start_ms: n.note.start_ms,
                end_ms: n.note.start_ms + n.note.duration_ms,
                onset_index: onset,
            },
        });
    }
    for n in &mut output {
        n.target.part_ids.sort();
        n.target.part_ids.dedup();
    }
    output
}
fn add_issue(
    plan: &mut PianoFingeringPlan,
    code: &str,
    message: &str,
    indexes: &[usize],
    onset: Option<usize>,
) {
    let targets: Vec<_> = indexes.iter().map(|&i| &plan.targets[i]).collect();
    let mut sources: Vec<_> = targets
        .iter()
        .flat_map(|t| t.source_note_ids.iter().cloned())
        .collect();
    sources.sort();
    sources.dedup();
    plan.issues.push(PianoFingeringIssue {
        code: code.into(),
        message: message.into(),
        onset_index: onset,
        target_ids: targets.iter().map(|t| t.target_id.clone()).collect(),
        source_occurrence_ids: targets
            .iter()
            .flat_map(|t| t.source_occurrence_ids.iter().cloned())
            .collect(),
        source_note_ids: sources,
    });
    plan.diagnostics.push(Diagnostic::warning(
        code,
        message,
        indexes.first().map(|&i| plan.targets[i].target_id.clone()),
    ));
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
struct Position {
    hand: PianoHand,
    finger: u8,
}
#[derive(Clone)]
struct Held {
    index: usize,
    position: Position,
}
#[derive(Clone)]
struct Path {
    previous: Option<Arc<Path>>,
    added: Vec<(usize, Position)>,
}
#[derive(Clone)]
struct State {
    held: Vec<Held>,
    anchors: [Option<i16>; 2],
    last_ms: [Option<f64>; 2],
    cost: u64,
    path: Option<Arc<Path>>,
}
impl State {
    fn same_future(&self, other: &Self) -> bool {
        self.anchors == other.anchors
            && self.last_ms == other.last_ms
            && self.held.len() == other.held.len()
            && self
                .held
                .iter()
                .zip(&other.held)
                .all(|(a, b)| a.index == b.index && a.position == b.position)
    }
}
fn fits(
    notes: &[PhysicalNote],
    held: &[Held],
    index: usize,
    p: Position,
    profiles: &[&PianoHandProfile; 2],
) -> bool {
    let midi = notes[index].target.midi;
    let same_hand = held.iter().filter(|n| n.position.hand == p.hand);
    for n in same_hand {
        let other = notes[n.index].target.midi;
        if n.position.finger == p.finger
            || midi.abs_diff(other) > profiles[p.hand.index()].max_span_semitones
        {
            return false;
        }
        let pitch_order = midi.cmp(&other);
        let finger_order = p.finger.cmp(&n.position.finger);
        if match p.hand {
            PianoHand::Left => pitch_order == finger_order,
            PianoHand::Right => pitch_order != finger_order,
        } {
            return false;
        }
    }
    true
}
fn implied_anchor(midi: u8, p: Position) -> i16 {
    let offset = [0, 2, 4, 5, 7][usize::from(p.finger - 1)];
    i16::from(midi)
        + if p.hand == PianoHand::Left {
            offset
        } else {
            -offset
        }
}
/// Disclosed heuristic costs, not a model of human injury risk or proficiency.
fn movement_cost(
    previous: &State,
    notes: &[PhysicalNote],
    held: &[Held],
    added: &[(usize, Position)],
) -> ([Option<i16>; 2], [Option<f64>; 2], u64) {
    let mut anchors = previous.anchors;
    let mut last_ms = previous.last_ms;
    let mut cost = 0;
    let now = notes[added[0].0].target.start_ms;
    for hand in [PianoHand::Left, PianoHand::Right] {
        let h = hand.index();
        if !added.iter().any(|(_, p)| p.hand == hand) {
            continue;
        }
        let active: Vec<_> = held.iter().filter(|n| n.position.hand == hand).collect();
        let mut implied: Vec<_> = active
            .iter()
            .map(|n| implied_anchor(notes[n.index].target.midi, n.position))
            .collect();
        implied.sort_unstable();
        let anchor = implied[implied.len() / 2];
        if let Some(old) = previous.anchors[h] {
            let elapsed = now - previous.last_ms[h].expect("anchor has a prior onset");
            let speed_weight = 1 + (1000. / (elapsed.max(0.) + 50.)).floor() as u64;
            cost += u64::from(anchor.abs_diff(old)) * 12 * speed_weight;
        }
        cost += implied
            .iter()
            .map(|a| u64::from(a.abs_diff(anchor)) * 2)
            .sum::<u64>();
        let low = active
            .iter()
            .map(|n| notes[n.index].target.midi)
            .min()
            .expect("active hand");
        let high = active
            .iter()
            .map(|n| notes[n.index].target.midi)
            .max()
            .expect("active hand");
        cost += u64::from(high - low).pow(2);
        anchors[h] = Some(anchor);
        last_ms[h] = Some(now);
    }
    for &(i, p) in added {
        let n = &notes[i];
        cost += n
            .suggested_hands
            .iter()
            .filter(|&&hand| hand != p.hand)
            .count() as u64
            * 8;
        let register_distance = match p.hand {
            PianoHand::Left => n.target.midi.saturating_sub(64),
            PianoHand::Right => 56_u8.saturating_sub(n.target.midi),
        };
        cost += u64::from(register_distance) * 2;
        if p.finger == 1 && [1, 3, 6, 8, 10].contains(&(n.target.midi % 12)) {
            cost += 5;
        }
    }
    (anchors, last_ms, cost)
}
#[derive(Clone, Copy)]
struct SearchLimits {
    beam: usize,
    expansions: usize,
}
struct Search<'a> {
    notes: &'a [PhysicalNote],
    choices: &'a [Vec<Position>],
    group: &'a [usize],
    profiles: [&'a PianoHandProfile; 2],
    limits: SearchLimits,
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
            let (anchors, last_ms, cost) = movement_cost(previous, self.notes, held, added);
            let mut state = State {
                held: held.clone(),
                anchors,
                last_ms,
                cost: previous.cost + cost,
                path: None,
            };
            state.held.sort_by_key(|n| n.index);
            if let Some(i) = self.next.iter().position(|s| s.same_future(&state)) {
                if self.next[i].cost <= state.cost {
                    return;
                }
                self.next.remove(i);
            }
            let i = self.next.partition_point(|s| s.cost <= state.cost);
            if i >= self.limits.beam {
                *self.pruned = true;
                return;
            }
            state.path = Some(Arc::new(Path {
                previous: previous.path.clone(),
                added: added.clone(),
            }));
            self.next.insert(i, state);
            if self.next.len() > self.limits.beam {
                self.next.pop();
                *self.pruned = true;
            }
            return;
        }
        let index = self.group[depth];
        for &position in &self.choices[index] {
            if *self.explored >= self.limits.expansions {
                *self.exhausted = true;
                return;
            }
            *self.explored += 1;
            if !fits(self.notes, held, index, position, &self.profiles) {
                continue;
            }
            held.push(Held { index, position });
            added.push((index, position));
            self.walk(previous, held, added, depth + 1);
            added.pop();
            held.pop();
        }
    }
}

fn validate_request(request: &PianoFingeringRequest) -> Result<(), String> {
    if !matches!(request.profile, InstrumentProfile::Piano { .. }) {
        return Err("Piano fingering needs a piano keyboard profile".into());
    }
    if [&request.left_hand, &request.right_hand].iter().any(|p| {
        p.lowest_midi > p.highest_midi || p.highest_midi > 127 || p.max_span_semitones > 24
    }) || request.locks.len() > MAX_NOTES
    {
        return Err("Use MIDI-safe ordered hand ranges, a reach of 0–24 semitones and at most 1,000 source-note locks".into());
    }
    Ok(())
}

pub fn plan_piano_fingering(request: PianoFingeringRequest) -> Result<PianoFingeringPlan, String> {
    plan_with_limits(
        request,
        SearchLimits {
            beam: BEAM,
            expansions: MAX_EXPANSIONS,
        },
    )
}
fn plan_with_limits(
    request: PianoFingeringRequest,
    limits: SearchLimits,
) -> Result<PianoFingeringPlan, String> {
    validate_request(&request)?;
    let source = crate::fingering_source::FingeringSource::canonical(request.score.clone())?;
    plan_source_with_limits(request, source, limits)
}

/// The opaque source can only be created by validated native compilation.
pub fn plan_piano_fingering_from_source(
    request: PianoFingeringRequest,
    source: crate::fingering_source::FingeringSource,
) -> Result<PianoFingeringPlan, String> {
    source.verify_score(&request.score)?;
    plan_source_with_limits(
        request,
        source,
        SearchLimits {
            beam: BEAM,
            expansions: MAX_EXPANSIONS,
        },
    )
}

fn plan_source_with_limits(
    request: PianoFingeringRequest,
    source: crate::fingering_source::FingeringSource,
    limits: SearchLimits,
) -> Result<PianoFingeringPlan, String> {
    validate_request(&request)?;
    let compiled = &source.compilation;
    let selected: Vec<_> = compiled
        .timeline
        .notes
        .iter()
        .filter(|n| request.part_id.as_ref().is_none_or(|p| &n.part_id == p))
        .collect();
    if request
        .part_id
        .as_ref()
        .is_some_and(|id| !compiled.score.parts.iter().any(|p| &p.id == id))
    {
        return Err("Choose an existing part for fingering guidance".into());
    }
    let source_occurrence_count = selected.len();
    let references: usize = selected.iter().map(|n| n.source_note_ids.len()).sum();
    let mut plan = PianoFingeringPlan {
        version: 1,
        algorithm: "deterministic_piano_beam_v1".into(),
        score_id: compiled.score.id.clone(),
        part_id: request.part_id.clone(),
        status: "unavailable".into(),
        profile: request.profile.clone(),
        left_hand: request.left_hand.clone(),
        right_hand: request.right_hand.clone(),
        complete: false,
        changed_source_notes: false,
        source_occurrence_count,
        physical_target_count: None,
        beam_width: limits.beam,
        max_expansions: limits.expansions,
        explored_choices: 0,
        beam_pruned: false,
        objective_cost: None,
        targets: vec![],
        assignments: vec![],
        requested_locks: request.locks.clone(),
        issues: vec![],
        diagnostics: compiled.diagnostics.clone(),
    };
    plan.diagnostics.push(Diagnostic::warning("piano_fingering_model", "Advisory bounded whole-phrase recommendation, not a global or biomechanical optimum. Five ordered fingers per hand reserve exact held keys inside configured ranges and reach. Hand crossing is permitted without collision modeling. Staff is a soft suggestion. Pedal, finger substitution, independent unison releases, black-key geometry and human technique are not modeled; a new attack on a held key is a model conflict. Pitch-only MIDI cannot verify hands or fingers.", None));
    plan.diagnostics.push(Diagnostic::warning("piano_fingering_objective", "Heuristic cost: thumb anchor uses semitone finger offsets [0,2,4,5,7], mirrored for the left hand; median implied anchor. Per-hand movement costs 12 per semitone times 1+floor(1000/(elapsed onset ms+50)); first use is uncharged. Posture deviation costs 2 per semitone and held span costs span squared, when that hand attacks. Each staff-hand mismatch costs 8; register distance costs 2 above MIDI64 for left/below MIDI56 for right; a thumb attack on a black key costs 5. Deterministic bounded beam selection can miss a better or feasible route.", None));
    // Validate the keyboard even when the requested phrase exceeds search limits.
    let empty = crate::Timeline {
        notes: vec![],
        duration_ms: compiled.timeline.duration_ms,
    };
    analyze_instrument(&empty, &request.profile)?;
    if source_occurrence_count > MAX_NOTES || references > MAX_SOURCE_REFERENCES {
        add_issue(&mut plan, "piano_fingering_limit", "Plan at most 1,000 sounding occurrences and 16,384 tied-source references. Choose a shorter phrase or part. No truncated recommendation or source-target map is returned; canonical music is unchanged.", &[], None);
        return finish_plan(plan);
    }
    let sources: HashSet<_> = selected
        .iter()
        .flat_map(|n| n.source_note_ids.iter().map(String::as_str))
        .collect();
    let mut seen = HashSet::new();
    for lock in &request.locks {
        if !sources.contains(lock.source_note_id.as_str())
            || !seen.insert(&lock.source_note_id)
            || lock.hand.is_none() && lock.finger.is_none()
            || lock.finger.is_some_and(|f| !(1..=5).contains(&f))
        {
            return Err("Each piano lock must name one unique selected sounding source note and specify a hand and/or a finger from 1–5".into());
        }
    }
    let exact = exact_notes(compiled, request.part_id.as_deref())?;
    let selected_timeline = crate::Timeline {
        notes: exact.iter().map(|n| n.note.clone()).collect(),
        duration_ms: compiled.timeline.duration_ms,
    };
    let report = analyze_instrument(&selected_timeline, &request.profile)?;
    plan.diagnostics.extend(report.diagnostics);
    let notes = physical_notes(exact);
    plan.targets = notes.iter().map(|n| n.target.clone()).collect();
    plan.physical_target_count = Some(notes.len());
    if notes.len() < source_occurrence_count {
        plan.diagnostics.push(Diagnostic::warning("piano_fingering_unisons", "Exact simultaneous same-key voices share one physical attack and one hand/finger assignment, held until their longest written end. All occurrence IDs and tied-source references remain mapped; conflicting source locks are explicit.", None));
    }
    if notes.is_empty() {
        plan.status = "no_targets".into();
        plan.complete = true;
        plan.objective_cost = Some(0);
        return finish_plan(plan);
    }
    let profiles = [&request.left_hand, &request.right_hand];
    let locks: HashMap<_, _> = request
        .locks
        .iter()
        .map(|l| (l.source_note_id.as_str(), l))
        .collect();
    let choices: Vec<Vec<_>> = notes
        .iter()
        .map(|n| {
            [PianoHand::Left, PianoHand::Right]
                .into_iter()
                .flat_map(|hand| (1..=5).map(move |finger| Position { hand, finger }))
                .filter(|p| {
                    let midi = n.target.midi;
                    let profile = profiles[p.hand.index()];
                    (report.lowest_midi..=report.highest_midi).contains(&midi)
                        && (profile.lowest_midi..=profile.highest_midi).contains(&midi)
                        && n.target
                            .source_note_ids
                            .iter()
                            .filter_map(|id| locks.get(id.as_str()))
                            .all(|lock| {
                                lock.hand.is_none_or(|h| h == p.hand)
                                    && lock.finger.is_none_or(|f| f == p.finger)
                            })
                })
                .collect()
        })
        .collect();
    let impossible: Vec<_> = choices
        .iter()
        .enumerate()
        .filter_map(|(i, p)| p.is_empty().then_some(i))
        .collect();
    if !impossible.is_empty() {
        plan.status = "infeasible_under_model".into();
        for i in impossible {
            add_issue(&mut plan, "piano_fingering_no_position", "This physical target has no hand/finger satisfying the keyboard, hand ranges and every merged/tied source-note lock. No partial recommendation is returned.", &[i], Some(notes[i].target.onset_index));
        }
        return finish_plan(plan);
    }
    // These failures are independent of beam pruning and therefore proven under the model.
    let mut active: Vec<usize> = vec![];
    for (i, n) in notes.iter().enumerate() {
        active.retain(|&index| notes[index].end > n.start);
        if let Some(&previous) = active
            .iter()
            .find(|&&index| notes[index].target.midi == n.target.midi)
        {
            plan.status = "infeasible_under_model".into();
            add_issue(&mut plan, "piano_fingering_held_reattack", "A later attack requests a key that must still be held. This no-pedal/no-substitution model cannot preserve both full written holds and the new attack. Review these voices; the score is unchanged.", &[previous, i], Some(n.target.onset_index));
            return finish_plan(plan);
        }
        active.push(i);
        if active.len() > 10 {
            plan.status = "infeasible_under_model".into();
            add_issue(&mut plan, "piano_fingering_capacity", "More than ten distinct keys must be held simultaneously. This five-fingers-per-hand model cannot cover every target; none was omitted.", &active, Some(n.target.onset_index));
            return finish_plan(plan);
        }
    }
    let mut beam = vec![State {
        held: vec![],
        anchors: [None, None],
        last_ms: [None, None],
        cost: 0,
        path: None,
    }];
    let mut first = 0;
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
                .filter(|n| notes[n.index].end > notes[first].start)
                .cloned()
                .collect();
            Search {
                notes: &notes,
                choices: &choices,
                group: &group,
                profiles,
                limits,
                explored: &mut plan.explored_choices,
                exhausted: &mut exhausted,
                pruned: &mut plan.beam_pruned,
                next: &mut next,
            }
            .walk(previous, &mut held, &mut vec![], 0);
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
            let reason = if exhausted {
                "The candidate expansion budget was exhausted."
            } else if plan.beam_pruned {
                "Retained paths failed; previously pruned paths might contain a solution."
            } else {
                "All possible paths violate the declared hand/finger/reach/held-key model."
            };
            let involved: Vec<_> = (0..last)
                .filter(|&i| notes[i].end > notes[first].start)
                .collect();
            add_issue(&mut plan, "piano_fingering_incomplete", &format!("No complete recommendation at onset {}. {reason} Every target remains available for review; no partial route is returned.", notes[first].target.onset_index + 1), &involved, Some(notes[first].target.onset_index));
            return finish_plan(plan);
        }
        beam = next;
        first = last;
    }
    let best = &beam[0];
    plan.objective_cost = Some(best.cost);
    let mut paths = vec![];
    let mut link = best.path.as_deref();
    while let Some(path) = link {
        paths.push(path);
        link = path.previous.as_deref();
    }
    let mut reconstructed: Vec<Option<Position>> = vec![None; notes.len()];
    for path in paths.into_iter().rev() {
        for &(index, p) in &path.added {
            if reconstructed[index].replace(p).is_some() {
                return Err("Piano reconstruction duplicated a physical target".into());
            }
        }
    }
    for (n, p) in notes.iter().zip(reconstructed) {
        let p = p.ok_or("Piano reconstruction did not preserve every physical target")?;
        plan.assignments.push(PianoAssignment {
            target: n.target.clone(),
            hand: p.hand,
            finger: p.finger,
        });
    }
    if plan
        .assignments
        .iter()
        .map(|a| a.target.source_occurrence_ids.len())
        .sum::<usize>()
        != source_occurrence_count
    {
        return Err("Piano reconstruction did not preserve every source occurrence".into());
    }
    plan.status = "ready".into();
    plan.complete = true;
    finish_plan(plan)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{Beat, Measure, Note, Pitch, Repeat};

    fn request(events: &[(u8, i64, i64)]) -> PianoFingeringRequest {
        let mut score = crate::catalog().remove(0);
        score.id = "original-piano-planner-test".into();
        score.title = "Original piano planner test".into();
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
        score.parts.truncate(1);
        score.parts[0].notes = events
            .iter()
            .enumerate()
            .map(|(i, &(midi, at, duration))| {
                let (step, alter) = spellings[usize::from(midi % 12)];
                Note {
                    id: format!("source-{i}"),
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
        PianoFingeringRequest {
            score,
            part_id: None,
            profile: InstrumentProfile::Piano {
                key_count: 88,
                lowest_midi: None,
            },
            left_hand: PianoHandProfile::default(),
            right_hand: PianoHandProfile::default(),
            locks: vec![],
        }
    }
    fn lock(index: usize, hand: Option<PianoHand>, finger: Option<u8>) -> PianoFingeringLock {
        PianoFingeringLock {
            source_note_id: format!("source-{index}"),
            hand,
            finger,
        }
    }
    fn assert_unchanged_complete(input: PianoFingeringRequest) -> PianoFingeringPlan {
        let before = serde_json::to_value(&input.score).unwrap();
        let plan = plan_piano_fingering(input.clone()).unwrap();
        assert!(plan.complete, "{} {:?}", plan.status, plan.issues);
        assert_eq!(plan.status, "ready");
        assert_eq!(serde_json::to_value(&input.score).unwrap(), before);
        assert!(!plan.changed_source_notes);
        assert_eq!(plan.assignments.len(), plan.physical_target_count.unwrap());
        let compiled = crate::compile(input.score).unwrap();
        let mut expected: Vec<_> = compiled
            .timeline
            .notes
            .iter()
            .filter(|n| input.part_id.as_ref().is_none_or(|id| &n.part_id == id))
            .map(|n| n.id.clone())
            .collect();
        let mut actual: Vec<_> = plan
            .assignments
            .iter()
            .flat_map(|n| n.target.source_occurrence_ids.iter().cloned())
            .collect();
        expected.sort();
        actual.sort();
        assert_eq!(actual, expected);
        plan
    }
    #[test]
    fn whole_phrase_changes_the_earlier_hand_to_preserve_a_later_locked_thumb() {
        let single = plan_piano_fingering(request(&[(60, 0, 2)])).unwrap();
        assert_eq!(single.assignments[0].hand, PianoHand::Right);
        let mut input = request(&[(60, 0, 2), (62, 1, 1)]);
        input.locks = vec![lock(1, Some(PianoHand::Right), Some(1))];
        let plan = assert_unchanged_complete(input.clone());
        assert_eq!(plan.assignments[0].hand, PianoHand::Left);
        assert_eq!(
            (plan.assignments[1].hand, plan.assignments[1].finger),
            (PianoHand::Right, 1)
        );
        assert_eq!(
            serde_json::to_value(&plan).unwrap(),
            serde_json::to_value(plan_piano_fingering(input).unwrap()).unwrap()
        );
    }
    #[test]
    fn same_onset_unison_voices_match_practice_targets_and_keep_longest_hold() {
        let mut input = request(&[(60, 0, 1), (64, 0, 1)]);
        let mut other = input.score.parts[0].clone();
        other.id = "other-part".into();
        other.notes.truncate(1);
        other.notes[0].id = "other-source".into();
        other.notes[0].duration = Beat::new(2, 1);
        other.notes[0].staff = 2;
        input.score.parts.push(other);
        input.score.measures[0].length = Beat::new(2, 1);
        let compiled = crate::compile(input.score.clone()).unwrap();
        let physical = crate::targets::plan_targets(&compiled.timeline, &input.profile).unwrap();
        let plan = assert_unchanged_complete(input.clone());
        assert_eq!(
            (plan.source_occurrence_count, plan.physical_target_count),
            (3, Some(2))
        );
        for ((assignment, group), target) in plan
            .assignments
            .iter()
            .zip(physical.groups)
            .zip(physical.timeline.notes)
        {
            assert_eq!(assignment.target.target_id, group.target_id);
            assert_eq!(
                assignment.target.source_occurrence_ids,
                group.source_occurrence_ids
            );
            assert_eq!(assignment.target.source_note_ids, group.source_note_ids);
            assert_eq!(assignment.target.part_ids, group.part_ids);
            assert_eq!(
                assignment.target.end_ms,
                target.start_ms + target.duration_ms
            );
        }
        input.locks = vec![
            lock(0, Some(PianoHand::Left), None),
            PianoFingeringLock {
                source_note_id: "other-source".into(),
                hand: Some(PianoHand::Right),
                finger: None,
            },
        ];
        let failed = plan_piano_fingering(input).unwrap();
        assert_eq!(failed.status, "infeasible_under_model");
        assert!(failed.assignments.is_empty());
        assert_eq!(failed.targets.len(), 2);
        assert_eq!(
            failed.issues[0].source_note_ids,
            vec!["other-source", "source-0"]
        );
    }
    #[test]
    fn unequal_unison_voice_ends_reserve_one_finger_until_the_longest_end() {
        let mut input = request(&[(60, 0, 1), (60, 0, 3), (62, 1, 1)]);
        input.score.parts[0].notes[1].voice = "2".into();
        input.locks = vec![
            lock(0, Some(PianoHand::Right), Some(2)),
            lock(2, Some(PianoHand::Right), Some(2)),
        ];
        let failed = plan_piano_fingering(input).unwrap();
        assert_eq!(failed.status, "infeasible_under_model");
        assert_eq!(failed.targets.len(), 2);
        assert_eq!(failed.targets[0].end_ms, 1500.);
        assert_eq!(
            failed.issues[0].source_note_ids,
            ["source-0", "source-1", "source-2"]
        );
    }
    #[test]
    fn exact_rational_release_allows_finger_reuse_without_float_tolerance() {
        let mut input = request(&[(60, 0, 1), (62, 1, 1)]);
        input.score.parts[0].notes[0].duration = Beat::new(1, 3);
        input.score.parts[0].notes[1].at = Beat::new(2, 6);
        input.score.parts[0].notes[1].duration = Beat::new(1, 3);
        input.locks = vec![
            lock(0, Some(PianoHand::Right), Some(2)),
            lock(1, Some(PianoHand::Right), Some(2)),
        ];
        let plan = assert_unchanged_complete(input.clone());
        assert!(plan.assignments.iter().all(|a| a.finger == 2));
        input.score.parts[0].notes[1].at = Beat::new(333_332, 999_999);
        let failed = plan_piano_fingering(input).unwrap();
        assert_eq!(failed.status, "infeasible_under_model");
        assert!(failed.assignments.is_empty());
    }
    #[test]
    fn held_same_key_reattack_is_explicit_even_with_another_free_hand() {
        let mut input = request(&[(60, 0, 2), (60, 1, 1)]);
        input.score.parts[0].notes[1].voice = "2".into();
        input.locks = vec![
            lock(0, Some(PianoHand::Left), Some(1)),
            lock(1, Some(PianoHand::Right), Some(1)),
        ];
        let failed = plan_piano_fingering(input).unwrap();
        assert_eq!(failed.status, "infeasible_under_model");
        assert_eq!(failed.issues[0].code, "piano_fingering_held_reattack");
        assert_eq!(failed.issues[0].source_note_ids, ["source-0", "source-1"]);
        assert_eq!(failed.targets.len(), 2);
        assert!(failed.assignments.is_empty());
    }
    #[test]
    fn repeated_key_at_release_remains_a_new_attack_and_tied_segments_do_not() {
        let mut input = request(&[(60, 0, 1), (60, 1, 1)]);
        input.locks = vec![
            lock(0, Some(PianoHand::Left), Some(3)),
            lock(1, Some(PianoHand::Left), Some(3)),
        ];
        assert_eq!(
            assert_unchanged_complete(input.clone()).assignments.len(),
            2
        );
        input.score.parts[0].notes[0].tie_start = true;
        input.score.parts[0].notes[1].tie_stop = true;
        let tied = assert_unchanged_complete(input.clone());
        assert_eq!(tied.assignments.len(), 1);
        assert_eq!(
            tied.assignments[0].target.source_note_ids,
            ["source-0", "source-1"]
        );
        assert_eq!(tied.assignments[0].target.end_ms, 1000.);
        input.locks[1].finger = Some(4);
        let failed = plan_piano_fingering(input).unwrap();
        assert_eq!(failed.status, "infeasible_under_model");
        assert!(failed.assignments.is_empty());
        assert_eq!(failed.requested_locks.len(), 2);
    }
    #[test]
    fn repeats_keep_distinct_occurrences_and_apply_canonical_locks_each_time() {
        let mut input = request(&[(60, 0, 1), (62, 1, 1)]);
        input.score.repeats = vec![Repeat {
            from: Beat::ZERO,
            to: Beat::new(2, 1),
            times: 3,
        }];
        input.locks = vec![lock(0, Some(PianoHand::Left), Some(4))];
        let plan = assert_unchanged_complete(input);
        assert_eq!(plan.assignments.len(), 6);
        assert_eq!(
            plan.assignments
                .iter()
                .filter(|a| a.target.source_note_ids == ["source-0"]
                    && a.hand == PianoHand::Left
                    && a.finger == 4)
                .count(),
            3
        );
        assert_eq!(plan.assignments.last().unwrap().target.onset_index, 5);
    }
    #[test]
    fn simultaneous_hand_order_and_configured_reach_are_constraints() {
        let mut input = request(&[(60, 0, 1), (67, 0, 1)]);
        input.locks = vec![
            lock(0, Some(PianoHand::Right), Some(1)),
            lock(1, Some(PianoHand::Right), Some(5)),
        ];
        input.right_hand.max_span_semitones = 6;
        assert_eq!(
            plan_piano_fingering(input.clone()).unwrap().status,
            "infeasible_under_model"
        );
        input.right_hand.max_span_semitones = 7;
        assert_unchanged_complete(input.clone());
        input.locks[0].finger = Some(5);
        input.locks[1].finger = Some(1);
        assert_eq!(
            plan_piano_fingering(input.clone()).unwrap().status,
            "infeasible_under_model"
        );
        for l in &mut input.locks {
            l.hand = Some(PianoHand::Left);
        }
        input.left_hand.max_span_semitones = 7;
        assert_unchanged_complete(input);
    }
    #[test]
    fn both_hand_ranges_and_keyboard_range_are_authoritative_without_dropping_targets() {
        let mut input = request(&[(48, 0, 1), (72, 0, 1)]);
        input.left_hand.highest_midi = 60;
        input.right_hand.lowest_midi = 61;
        let plan = assert_unchanged_complete(input.clone());
        assert_eq!(
            plan.assignments.iter().map(|a| a.hand).collect::<Vec<_>>(),
            [PianoHand::Left, PianoHand::Right]
        );
        input.locks = vec![lock(0, Some(PianoHand::Right), None)];
        let failed = plan_piano_fingering(input.clone()).unwrap();
        assert_eq!(failed.status, "infeasible_under_model");
        assert_eq!(failed.targets.len(), 2);
        input.locks.clear();
        input.profile = InstrumentProfile::Piano {
            key_count: 12,
            lowest_midi: Some(60),
        };
        let failed = plan_piano_fingering(input).unwrap();
        assert_eq!(failed.status, "infeasible_under_model");
        assert_eq!(failed.issues.len(), 2);
        assert!(failed.assignments.is_empty());
    }
    #[test]
    fn hand_crossings_are_allowed_but_do_not_claim_collision_or_technique_validity() {
        let mut input = request(&[(48, 0, 1), (72, 0, 1)]);
        input.locks = vec![
            lock(0, Some(PianoHand::Right), Some(1)),
            lock(1, Some(PianoHand::Left), Some(1)),
        ];
        let plan = assert_unchanged_complete(input);
        assert_eq!(
            plan.assignments.iter().map(|a| a.hand).collect::<Vec<_>>(),
            [PianoHand::Right, PianoHand::Left]
        );
        assert!(plan.diagnostics.iter().any(|d| d
            .message
            .contains("Hand crossing is permitted without collision modeling")));
    }
    #[test]
    fn ten_distinct_keys_can_fit_but_eleven_are_proven_impossible() {
        let events: Vec<_> = [48, 50, 52, 53, 55, 60, 62, 64, 65, 67]
            .into_iter()
            .map(|m| (m, 0, 1))
            .collect();
        let mut input = request(&events);
        input.locks = (0..10)
            .map(|i| {
                lock(
                    i,
                    Some(if i < 5 {
                        PianoHand::Left
                    } else {
                        PianoHand::Right
                    }),
                    Some(if i < 5 { 5 - i as u8 } else { i as u8 - 4 }),
                )
            })
            .collect();
        assert_eq!(assert_unchanged_complete(input).assignments.len(), 10);
        let events: Vec<_> = (48..59).map(|m| (m, 0, 1)).collect();
        let failed = plan_piano_fingering(request(&events)).unwrap();
        assert_eq!(failed.status, "infeasible_under_model");
        assert!(!failed.beam_pruned);
        assert_eq!(failed.explored_choices, 0);
        assert_eq!(failed.targets.len(), 11);
        assert_eq!(failed.issues[0].source_note_ids.len(), 11);
    }
    #[test]
    fn five_fingers_per_hand_are_not_silently_shared_for_a_six_note_chord() {
        let events: Vec<_> = (60..66).map(|m| (m, 0, 1)).collect();
        let mut input = request(&events);
        input.locks = (0..6)
            .map(|i| lock(i, Some(PianoHand::Right), None))
            .collect();
        let failed = plan_piano_fingering(input).unwrap();
        assert_eq!(failed.status, "infeasible_under_model");
        assert_eq!(failed.targets.len(), 6);
        assert!(failed.assignments.is_empty());
    }
    #[test]
    fn bounded_incomplete_and_proven_infeasible_are_distinct() {
        let mut input = request(&[(60, 0, 2), (62, 1, 1)]);
        input.locks = vec![lock(1, Some(PianoHand::Right), Some(1))];
        let narrow = plan_with_limits(
            input.clone(),
            SearchLimits {
                beam: 1,
                expansions: MAX_EXPANSIONS,
            },
        )
        .unwrap();
        assert_eq!(narrow.status, "no_plan_found");
        assert!(narrow.beam_pruned);
        assert_eq!(narrow.targets.len(), 2);
        assert!(narrow.assignments.is_empty());
        let bounded = plan_with_limits(
            input.clone(),
            SearchLimits {
                beam: BEAM,
                expansions: 1,
            },
        )
        .unwrap();
        assert_eq!(bounded.status, "search_limit");
        assert_eq!(bounded.explored_choices, 1);
        assert!(!bounded.complete);
        assert!(bounded.assignments.is_empty());
        assert_unchanged_complete(input.clone());
        input.locks.push(lock(0, Some(PianoHand::Right), Some(2)));
        let impossible = plan_piano_fingering(input).unwrap();
        assert_eq!(impossible.status, "infeasible_under_model");
        assert!(!impossible.beam_pruned);
    }
    #[test]
    fn tempo_changes_movement_cost_but_preserves_locked_guidance_and_canonical_time() {
        let mut slow = request(&[(60, 0, 1), (72, 1, 1)]);
        slow.score.tempo[0].bpm = 60.;
        slow.locks = (0..2)
            .map(|i| lock(i, Some(PianoHand::Right), Some(1)))
            .collect();
        let mut fast = slow.clone();
        fast.score.tempo[0].bpm = 240.;
        let a = assert_unchanged_complete(slow);
        let b = assert_unchanged_complete(fast);
        assert!(b.objective_cost > a.objective_cost);
        assert_eq!(a.assignments[1].target.start_ms, 1000.);
        assert_eq!(b.assignments[1].target.start_ms, 250.);
    }
    #[test]
    fn source_selection_and_transposition_require_fresh_authoritative_plans() {
        let mut input = request(&[(60, 0, 1), (64, 1, 1)]);
        let selected = input.score.parts[0].id.clone();
        let mut other = input.score.parts[0].clone();
        other.id = "excluded".into();
        for n in &mut other.notes {
            n.id = format!("excluded-{}", n.id);
        }
        input.score.parts.push(other);
        input.part_id = Some(selected);
        input.locks = vec![lock(0, Some(PianoHand::Right), Some(1))];
        let original = input.score.clone();
        let before = assert_unchanged_complete(input.clone());
        assert_eq!(before.source_occurrence_count, 2);
        let shifted = crate::transposition::preview_transposition(
            &input.score,
            crate::transposition::TranspositionOperation { semitones: 2 },
            &input.profile,
        )
        .unwrap();
        input.score = shifted.compilation.score;
        let after = assert_unchanged_complete(input.clone());
        assert_eq!(
            after.assignments[0].target.midi,
            before.assignments[0].target.midi + 2
        );
        assert_eq!(
            after.assignments[0].target.source_note_ids,
            before.assignments[0].target.source_note_ids
        );
        assert_eq!(
            serde_json::to_value(
                crate::transposition::restore_original(&input.score)
                    .unwrap()
                    .score
            )
            .unwrap(),
            serde_json::to_value(original).unwrap()
        );
        input.locks[0].source_note_id = "excluded-source-0".into();
        assert!(plan_piano_fingering(input.clone()).is_err());
        input.locks.clear();
        input.part_id = Some("missing".into());
        assert!(plan_piano_fingering(input).is_err());
    }
    #[test]
    fn limits_and_empty_phrases_never_masquerade_as_truncated_success() {
        let events: Vec<_> = (0..1001).map(|i| (60, i, 1)).collect();
        let limited = plan_piano_fingering(request(&events)).unwrap();
        assert_eq!(limited.status, "unavailable");
        assert_eq!(limited.source_occurrence_count, 1001);
        assert_eq!(limited.physical_target_count, None);
        assert!(limited.targets.is_empty() && limited.assignments.is_empty());
        assert!(!limited.complete);
        let empty = plan_piano_fingering(request(&[])).unwrap();
        assert_eq!(empty.status, "no_targets");
        assert!(empty.complete);
        assert_eq!(empty.physical_target_count, Some(0));
        assert_eq!(empty.objective_cost, Some(0));
    }
    #[test]
    fn malformed_profiles_locks_and_unknown_fields_are_rejected() {
        let good = request(&[(60, 0, 1)]);
        for bad_lock in [
            lock(0, None, None),
            lock(0, None, Some(0)),
            lock(0, None, Some(6)),
            lock(99, Some(PianoHand::Left), None),
        ] {
            let mut bad = good.clone();
            bad.locks = vec![bad_lock];
            assert!(plan_piano_fingering(bad).is_err());
        }
        let mut bad = good.clone();
        bad.locks = vec![lock(0, Some(PianoHand::Left), None), lock(0, None, Some(2))];
        assert!(plan_piano_fingering(bad).is_err());
        for hand in [
            PianoHandProfile {
                lowest_midi: 72,
                highest_midi: 60,
                max_span_semitones: 12,
            },
            PianoHandProfile {
                lowest_midi: 0,
                highest_midi: 128,
                max_span_semitones: 12,
            },
            PianoHandProfile {
                max_span_semitones: 25,
                ..PianoHandProfile::default()
            },
        ] {
            let mut bad = good.clone();
            bad.left_hand = hand;
            assert!(plan_piano_fingering(bad).is_err());
        }
        let mut bad = good.clone();
        bad.profile = InstrumentProfile::Piano {
            key_count: 88,
            lowest_midi: Some(60),
        };
        assert!(plan_piano_fingering(bad).is_err());
        let mut bad = good.clone();
        bad.profile = InstrumentProfile::Guitar {
            tuning: vec![60],
            frets: 12,
            capo: 0,
        };
        assert!(plan_piano_fingering(bad).is_err());
        let value =
            serde_json::json!({ "score": good.score, "profile":good.profile, "surprise":true });
        assert!(serde_json::from_value::<PianoFingeringRequest>(value).is_err());
    }
    #[test]
    fn independent_replay_checks_all_active_fingers_and_ranges_on_generated_phrases() {
        for seed in 0..12 {
            let events: Vec<_> = (0..8)
                .flat_map(|i| {
                    let low = 45 + ((seed * 3 + i * 2) % 12) as u8;
                    let high = 65 + ((seed + i * 3) % 12) as u8;
                    [(low, i * 2, 2), (high, i * 2, 2)]
                })
                .collect();
            let input = request(&events);
            let plan = assert_unchanged_complete(input);
            for current in &plan.assignments {
                let at = current.target.start_ms;
                let active: Vec<_> = plan
                    .assignments
                    .iter()
                    .filter(|a| a.target.start_ms <= at && a.target.end_ms > at)
                    .collect();
                for hand in [PianoHand::Left, PianoHand::Right] {
                    let profile = if hand == PianoHand::Left {
                        &plan.left_hand
                    } else {
                        &plan.right_hand
                    };
                    let assigned: Vec<_> = active.iter().filter(|a| a.hand == hand).collect();
                    assert!(assigned.len() <= 5);
                    for a in &assigned {
                        assert!(
                            (profile.lowest_midi..=profile.highest_midi).contains(&a.target.midi)
                        );
                        for b in &assigned {
                            if a.target.target_id == b.target.target_id {
                                continue;
                            }
                            assert_ne!(a.finger, b.finger);
                            assert!(
                                a.target.midi.abs_diff(b.target.midi) <= profile.max_span_semitones
                            );
                            assert_eq!(
                                a.target.midi < b.target.midi,
                                if hand == PianoHand::Left {
                                    a.finger > b.finger
                                } else {
                                    a.finger < b.finger
                                }
                            );
                        }
                    }
                }
            }
        }
    }
    #[test]
    fn many_tied_source_references_hit_a_separate_limit_without_partial_maps() {
        let mut input = request(&[(60, 0, 1)]);
        let original = input.score.parts[0].notes[0].clone();
        input.score.parts[0].notes = (0..=MAX_SOURCE_REFERENCES)
            .map(|i| {
                let mut n = original.clone();
                n.id = format!("segment-{i}");
                n.at = Beat::new(i as i64, 1);
                n.tie_start = i < MAX_SOURCE_REFERENCES;
                n.tie_stop = i > 0;
                n
            })
            .collect();
        input.score.measures[0].length = Beat::new(MAX_SOURCE_REFERENCES as i64 + 1, 1);
        let plan = plan_piano_fingering(input).unwrap();
        assert_eq!(plan.source_occurrence_count, 1);
        assert_eq!(plan.status, "unavailable");
        assert_eq!(plan.physical_target_count, None);
        assert!(plan.targets.is_empty() && plan.assignments.is_empty());
        assert_eq!(plan.issues[0].code, "piano_fingering_limit");
    }
    #[test]
    fn full_catalog_edition_retains_all_targets_even_if_the_model_cannot_resolve_it() {
        let mut input = request(&[]);
        input.score = crate::catalog_score("cc0-beethoven-gottes-macht-op48-5").unwrap();
        let compiled = crate::compile(input.score.clone()).unwrap();
        let expected = crate::targets::plan_targets(&compiled.timeline, &input.profile).unwrap();
        let plan = plan_piano_fingering(input).unwrap();
        assert_eq!(plan.source_occurrence_count, compiled.timeline.notes.len());
        assert_eq!(plan.physical_target_count, Some(expected.target_count));
        assert_eq!(plan.targets.len(), expected.target_count);
        assert_eq!(
            plan.targets
                .iter()
                .map(|t| t.source_occurrence_ids.len())
                .sum::<usize>(),
            plan.source_occurrence_count
        );
        for (target, group) in plan.targets.iter().zip(expected.groups) {
            assert_eq!(target.target_id, group.target_id);
            assert_eq!(target.source_occurrence_ids, group.source_occurrence_ids);
            assert_eq!(target.source_note_ids, group.source_note_ids);
        }
        if !plan.complete {
            assert!(plan.assignments.is_empty());
        }
    }
}

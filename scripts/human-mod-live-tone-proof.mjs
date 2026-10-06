// Acceptance-only contract checking. Replaying the production DSP verifies a
// retained receipt's recipe; it does not manufacture native receipt provenance.
// Synthetic fixtures can exercise this contract, but are never a native run.
import assert from 'node:assert/strict';
import {buildLiveToneTriangles, LiveToneCore, LIVE_TONE_LIMITS} from '../web/live-tone-core.js';
import {validateLiveToneEvidence, validateLiveToneInput} from './live-tone-proof.mjs';

export const HUMAN_MOD_LIVE_TONE_LIMITS = Object.freeze({holdMs: 10000, events: 128, targets: 4096, owners: 64});
const limits = HUMAN_MOD_LIVE_TONE_LIMITS;
const integer = (value, min = 0, max = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(value) && value >= min && value <= max;
const bounded = (value, max, message) => assert.ok(Array.isArray(value) && value.length <= max, message);
const id = value => typeof value === 'string' && value.length > 0 && value.length <= 256;
function ids(values, message) {
  bounded(values, limits.targets, message);
  assert.ok(values.length > 0 && values.every(id) && new Set(values).size === values.length, message);
  return [...values].sort();
}

// Float32 samples can differ by a few ulps between JS engines' transcendental
// implementations. Only aggregate floating PCM values receive this tolerance;
// every sample count and frame identity is exact. The opposite recipe must fail
// these same comparisons, so the tolerance cannot admit an ambiguous result.
const closePCM = (actual, expected) => Number.isFinite(actual) && Math.abs(actual - expected) <= Math.max(1e-10, Math.abs(expected) * 2e-6);
const accounting = ['pcmPeak', 'pcmEnergy', 'nonzeroSamples', 'renderedSamples', 'firstNonzeroFrame', 'lastRenderedFrame'];
const matchesAccounting = (actual, expected) => accounting.every(key => key === 'pcmPeak' || key === 'pcmEnergy' ? closePCM(actual[key], expected[key]) : actual[key] === expected[key]);
const triangleBanks = new Map();
function triangles(rate) {
  if (!triangleBanks.has(rate)) {
    if (triangleBanks.size === 4) triangleBanks.delete(triangleBanks.keys().next().value);
    triangleBanks.set(rate, buildLiveToneTriangles(rate));
  }
  return triangleBanks.get(rate);
}

function replay(call, start, end, timbre) {
  const rate = end.sampleRate, releaseFrame = end.actualEndFrame - Math.ceil(.012 * rate);
  assert.ok(integer(start.actualStartFrame, 0, LIVE_TONE_LIMITS.maxFrame));
  assert.ok(integer(end.actualEndFrame, 0, LIVE_TONE_LIMITS.maxFrame - 1));
  assert.ok(releaseFrame > start.actualStartFrame, 'Held native note must render before its 12 ms release tail');
  assert.ok(releaseFrame - start.actualStartFrame <= Math.ceil(limits.holdMs * rate / 1000), 'Native recipe replay exceeds the bounded held-key interval');
  const records = [], core = new LiveToneCore(rate, {emit: record => records.push(record)});
  core.handleMessage({type: 'initialize', generation: call.generation, requestId: 1, triangles: triangles(rate)}, start.actualStartFrame);
  core.handleMessage({type: 'play', generation: call.generation, requestId: 2, token: call.token, id: call.id, midi: call.midi,
    duration: null, delay: call.delay, timbre, velocity: call.velocity, atFrame: start.requestedStartFrame}, start.actualStartFrame);
  let frame = start.actualStartFrame;
  const block = new Float32Array(128);
  function renderUntil(stop) {
    while (frame < stop) {
      const length = Math.min(block.length, stop - frame);
      core.process([block.subarray(0, length)], frame);
      frame += length;
    }
  }
  renderUntil(releaseFrame);
  core.handleMessage({type: 'release', generation: call.generation, requestId: 3, id: call.id, token: call.token}, releaseFrame);
  // The terminal is emitted when the first frame after the last sample renders.
  renderUntil(end.actualEndFrame + 1);
  assert.equal(core.state, 'ready', 'Production DSP replay failed');
  assert.equal(core.started, 1);
  assert.equal(core.ended, 1);
  assert.equal(core.activeNotes, 0);
  assert.equal(core.droppedVoices, 0);
  const notes = records.filter(record => record.kind === 'note');
  assert.deepEqual(notes.map(record => record.type), ['started', 'ended']);
  assert.equal(notes[0].actualStartFrame, start.actualStartFrame);
  assert.equal(notes[1].actualEndFrame, end.actualEndFrame);
  assert.equal(notes[1].reason, 'release');
  return notes[1];
}

function validateTake(take, e, expectedPartIds, expectedTargetPlan) {
  assert.equal(take?.version, 1);
  assert.ok(Number.isFinite(take.latency_ms));
  assert.ok(Number.isFinite(take.tolerance_ms) && take.tolerance_ms >= 10 && take.tolerance_ms <= 2000);
  assert.deepEqual(take.unassigned_captures, [], 'No extra unassigned physical onset is admissible');
  assert.deepEqual(take.interruptions, []);
  assert.ok(['all', 'parts'].includes(take.practice_selection?.kind));
  assert.deepEqual(ids(take.practice_selection.part_ids, 'Complete human selection required'), expectedPartIds);
  bounded(take.passes, 1, 'One retained scored pass required');
  assert.equal(take.passes.length, 1);
  const pass = take.passes[0];
  assert.ok(integer(pass.id, 1));
  assert.equal(pass.capture_enabled, true);
  assert.equal(pass.pending, false, 'The take must retain its completed assessment');
  assert.equal(pass.error, null);
  assert.equal(pass.ownership, 'deterministic_corrected_clock');
  assert.equal(pass.revision, 1);
  assert.equal(pass.assessed_revision, 1);
  assert.deepEqual(pass.boundary_reviews, []);
  bounded(pass.inputs, 1, 'Exactly one recorded input required');
  bounded(pass.captures, 1, 'Exactly one captured input required');
  assert.equal(pass.inputs.length, 1);
  assert.equal(pass.captures.length, 1);
  bounded(take.input_evidence?.events, limits.events, 'Bounded complete input observations required');
  const input = pass.inputs[0], capture = pass.captures[0], onset = validateLiveToneInput(take, e);
  assert.equal(input.midi, 60);
  assert.equal(input.velocity, e.calls[0].velocity);
  assert.ok(Number.isFinite(input.at_ms));
  assert.deepEqual(capture.input, input, 'Captured and scored input must be the same original event');
  assert.ok(integer(capture.event_id, 1));
  assert.deepEqual(onset.onset_capture, {pass_id: pass.id, event_id: capture.event_id});
  assert.equal(onset.event_wall_ms, capture.event_wall_ms);
  assert.equal(onset.received_wall_ms, capture.received_wall_ms);
  const inputEvidence = take.input_evidence;
  assert.equal(inputEvidence.version, 1);
  assert.equal(inputEvidence.truncated, false);
  assert.equal(inputEvidence.omitted_observations, 0);
  const musical = inputEvidence.events.filter(event => event.kind !== 'boundary');
  assert.deepEqual(musical.map(event => event.kind), ['note_on', 'note_off'], 'One original scored key pair required; synthetic releases cannot replace it');
  const release = musical[1];
  assert.ok(id(onset.source_id));
  assert.equal(release.source_id, onset.source_id);
  assert.equal(release.source_generation, onset.source_generation);
  assert.equal(release.input_kind, 'typing_keyboard');
  assert.equal(release.encoding, 'key_up');
  assert.equal(release.midi, null, 'Typing keyup does not invent a scored pitch');
  assert.equal(release.onset_capture, null);
  for (const [index, observation] of musical.entries()) {
    assert.ok(integer(observation.event_id, 1));
    assert.equal(observation.raw_timestamp_ms, e.inputs[index].eventTime, 'Retain each original trusted DOM timestamp');
    assert.ok(['event_monotonic', 'event_epoch', 'event_clamped'].includes(observation.timestamp_basis));
    assert.ok(Number.isFinite(observation.event_wall_ms) && Number.isFinite(observation.received_wall_ms));
    assert.ok(observation.event_wall_ms <= observation.received_wall_ms);
    if (observation.timestamp_basis === 'event_monotonic') assert.equal(observation.event_wall_ms, observation.raw_timestamp_ms);
    if (observation.timestamp_basis === 'event_clamped') assert.equal(observation.event_wall_ms, observation.received_wall_ms);
    if (observation.timestamp_basis === 'event_epoch') assert.ok(observation.raw_timestamp_ms > observation.event_wall_ms);
  }
  assert.ok(release.event_id > onset.event_id);
  assert.ok(release.event_wall_ms >= onset.event_wall_ms);
  bounded(pass.clock_segments, limits.events, 'Original scoring clock segments required');
  assert.ok(pass.clock_segments.length > 0);
  const correctedWall = capture.event_wall_ms - take.latency_ms;
  assert.ok(pass.clock_segments.some(segment => Number.isFinite(segment.wallStart) && Number.isFinite(segment.positionStart)
    && (segment.wallEnd === null || Number.isFinite(segment.wallEnd))
    && correctedWall >= segment.wallStart - take.tolerance_ms
    && (segment.wallEnd === null || correctedWall <= segment.wallEnd + take.tolerance_ms)
    && Math.abs(input.at_ms - (segment.positionStart + correctedWall - segment.wallStart)) <= 1e-9),
  'Scored onset must derive from the captured input clock, never DSP frames');

  const plan = take.target_plan;
  assert.ok(expectedTargetPlan && typeof expectedTargetPlan === 'object' && !Array.isArray(expectedTargetPlan), 'An independent expected physical target plan is required');
  assert.deepEqual(plan, expectedTargetPlan, 'The complete physical target plan must match its independent profile-bound reference');
  assert.equal(plan?.playable, true);
  bounded(plan.groups, limits.targets, 'Bounded retained target groups required');
  bounded(plan.timeline?.notes, limits.targets, 'Bounded retained target timeline required');
  assert.ok(integer(plan.target_count, 1, limits.targets));
  assert.equal(plan.target_count, plan.groups.length);
  assert.equal(plan.target_count, plan.timeline.notes.length);
  assert.deepEqual(pass.timeline, plan.timeline, 'Scoring must retain the exact physical target timeline');
  const groupIds = new Set(), occurrenceIds = new Set();
  for (const group of plan.groups) {
    assert.ok(id(group.target_id) && !groupIds.has(group.target_id));
    groupIds.add(group.target_id);
    ids(group.source_occurrence_ids, 'Complete source occurrences required');
    ids(group.source_note_ids, 'Complete source note owners required');
    const owners = ids(group.part_ids, 'Complete unique target-group owners required');
    assert.ok(owners.every(partId => expectedPartIds.includes(partId)));
    for (const sourceId of group.source_occurrence_ids) {
      assert.equal(occurrenceIds.has(sourceId), false, 'An occurrence cannot be counted in two physical targets');
      occurrenceIds.add(sourceId);
    }
    const targets = plan.timeline.notes.filter(note => note.id === group.target_id);
    assert.equal(targets.length, 1);
    assert.deepEqual(ids(targets[0].source_note_ids, 'Target must retain every source note'), [...group.source_note_ids].sort());
  }
  assert.equal(plan.source_note_count, occurrenceIds.size);
  const candidates = plan.timeline.notes.filter(note => note.midi === 60);
  assert.ok(candidates.length > 0, 'The original C4 source targets must remain');
  const candidateIds = new Set(candidates.map(note => note.id));
  const candidateGroups = plan.groups.filter(group => candidateIds.has(group.target_id));
  assert.deepEqual([...new Set(candidateGroups.flatMap(group => group.part_ids))].sort(), expectedPartIds,
    'Every original C4 owner must survive the independently expected physical grouping');
  const assessment = pass.assessment;
  bounded(assessment?.hits, 1, 'Completed assessment hits required');
  bounded(assessment.extras, 1, 'Completed assessment extras required');
  assert.equal(assessment.hits.length + assessment.extras.length, 1, 'The original input must be assessed exactly once as a hit or extra');
  const hit = assessment.hits[0];
  if (hit) {
    const target = candidates.find(note => note.id === hit.note_id);
    assert.ok(target, 'The single assessed hit must refer to one original C4 physical target');
    assert.equal(hit.note_id, target.id);
    assert.equal(hit.midi, 60);
    assert.equal(hit.actual_ms, input.at_ms);
    assert.equal(hit.expected_ms, target.start_ms);
    assert.ok(Number.isFinite(hit.delta_ms) && Math.abs(hit.delta_ms - (hit.actual_ms - hit.expected_ms)) <= 1e-9);
    assert.ok(Math.abs(hit.delta_ms) <= take.tolerance_ms);
  } else assert.deepEqual(assessment.extras, [input], 'A genuinely late key must retain its original graded input');
  assert.deepEqual([...assessment.misses].sort(), plan.timeline.notes.filter(note => note.id !== hit?.note_id).map(note => note.id).sort());
}

/** Verify retained evidence only. The caller must independently bind transport,
 * native host/source identity, and actual exported bytes in its enclosing proof.
 * Returning the supplied value deliberately makes no actual-app/audio claim. */
export function validateHumanModLiveTone(e, {take, expectedInstrument, expectedPartIds, expectedTargetPlan, transport} = {}) {
  assert.ok(['piano', 'guitar'].includes(expectedInstrument), 'An explicit expected production recipe is required');
  bounded(expectedPartIds, limits.owners, 'Expected shared human owners required');
  assert.ok(expectedPartIds.length >= 2, 'Shared-key acceptance requires at least two human owners');
  const owners = ids(expectedPartIds, 'Expected shared human owners must be unique');
  bounded(transport?.rows, limits.events, 'Independent original trusted transport observations required');
  bounded(e?.receipts, limits.events, 'Bounded actual native receipts required');
  validateLiveToneEvidence(e, {keyCode: 'KeyR', midi: 60, transport});
  // Reject extra clicks/voices as well as duplicate note receipts. A separate
  // metronome or former receiver must not supply this shared-key proof.
  assert.equal(e.receipts.length, 2, 'Only the one native started/ended token may inhabit this proof');
  const call = e.calls[0], [start, end] = e.receipts.map(row => row.record);
  assert.equal(call.timbre, expectedInstrument, 'Native play call must use the expected human Mod recipe');
  assert.equal(start.reason, 'onset');
  assert.equal(start.firstNonzeroFrame, null);
  assert.equal(start.lastRenderedFrame, null);
  assert.ok(end.actualStartFrame >= Math.floor(e.ready.receiver.audioTime * end.sampleRate));
  assert.ok(end.actualEndFrame <= Math.ceil(e.after.receiver.audioTime * end.sampleRate), 'Native terminal must precede the final receiver clock');
  const expected = replay(call, start, end, call.timbre);
  for (const key of accounting) {
    if (key === 'pcmPeak' || key === 'pcmEnergy') assert.ok(closePCM(end[key], expected[key]), `Native ${key} must match the production ${expectedInstrument} recipe`);
    else assert.equal(end[key], expected[key], `Native ${key} must match the production ${expectedInstrument} recipe exactly`);
  }
  const opposite = expectedInstrument === 'piano' ? 'guitar' : 'piano';
  assert.equal(matchesAccounting(end, replay(call, start, end, opposite)), false, 'Native PCM must distinguish the selected recipe from the opposite recipe');
  validateTake(take, e, owners, expectedTargetPlan);
  return e;
}

import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareCleanSong, prepareVsqPractice} from '../web/clean-song-package.js';
import {admitPracticeAssistance} from '../web/practice-assistance-receipt.js';
import {buildBasicKeyAudioPlan, basicKeyGateFrames} from '../web/basic-key-audio-plan.js';
import {buildVsqAudioPlan} from '../web/vsq-audio-plan.js';
import {buildCanonicalAudioPlan, CANONICAL_AUDIO_POLICY} from '../web/canonical-audio-plan.js';
import {CleanSongPlayer} from '../web/clean-song-player.js';
import {basicKeyAudioHarness} from './basic-key-audio-harness.js';
import {audioFixture} from './practice-assistance-audio-fixtures.js';

const sampleRate = 48000;
function nativeBasic() {
  const fixture = audioFixture('assistance-native-basic'), descriptor = fixture.opened.clean_package;
  return {fixture, song: prepareCleanSong(`native:${fixture.source.key}`, descriptor, JSON.parse(fixture.opened.score_json))};
}
function nativeVsq() {
  const fixture = audioFixture('assistance-native-vsq'), opened = audioFixture('vsq-clean-v1-native-open');
  return {fixture, song: prepareVsqPractice(prepareCleanSong(`native:${fixture.source.key}`, opened.clean_package, JSON.parse(opened.score_json)), fixture.selected_runtime)};
}
function selected(sourceToken, response) {
  const native = Boolean(sourceToken.runtime), {selection, mode, settings, revision, selection_digest} = response.checked.plan;
  const binding = {source: native ? response.source : null, sourceToken, runtimeToken: native ? sourceToken.runtime : sourceToken.timeline, selection, mode, settings, revision, expected_selection_digest: selection_digest};
  return {sampleRate, mode: selection.selected_part_ids.length ? 'practice' : 'listen', practiceSelection: {kind: 'parts', part_ids: selection.selected_part_ids}, assistance: admitPracticeAssistance(response, binding), assistanceContext: binding};
}

test('real native Basic first-human/second-machine C4 keeps its original second FIFO release and complete retained events', () => {
  const {fixture, song} = nativeBasic(), before = JSON.stringify(song), full = buildBasicKeyAudioPlan(song, {sampleRate}), options = selected(song, fixture.explicit);
  const plan = buildBasicKeyAudioPlan(song, {...options, instrumentOverrides: {'midi-t1-c1-r0': 'reed'}});
  assert.deepEqual(options.assistance.plan.human_source_ids, ['midi-t1-e3']);
  assert.equal(plan.notes.some(row => row[0] === 'midi-t1-e3'), false);
  const second = plan.notes.find(row => row[0] === 'midi-t1-e4');
  assert.deepEqual(second, full.notes.find(row => row[0] === 'midi-t1-e4'));
  assert.deepEqual(second.slice(2, 4), [6000, 24000]);
  assert.notEqual(second[3], 12000, 'Removing the human first attack must never re-pair the second voice to the first FIFO release');
  assert.deepEqual(song.runtime.rendition.notes[1][2], [0, 5]); assert.equal(song.runtime.rendition.notes[1][11], 'fifo_release');
  assert.equal(plan.notes.length, 5); assert.equal(plan.sourceNotes, 6); assert.equal(plan.durationFrames, full.durationFrames);
  assert.equal(plan.timbres[plan.notes.indexOf(second)], 3, 'Assisted machine notes use the retained machine recipe of the human-selected part');
  assert.equal(song.score_json, fixture.opened.clean_package.score_json); assert.equal(song.metadata_json, fixture.opened.clean_package.metadata_json); assert.equal(JSON.stringify(song), before);
});

test('real Basic automatic response and Original receipt join exact admitted gates including percussion and synthetic onset', () => {
  const {fixture, song} = nativeBasic(), full = buildBasicKeyAudioPlan(song, {sampleRate}), options = selected(song, fixture.automatic), plan = buildBasicKeyAudioPlan(song, options);
  assert.deepEqual(new Set(plan.notes.map(row => row[0])), new Set(fixture.automatic.checked.machine_occurrence_ids));
  assert.deepEqual(plan.notes, full.notes.filter(row => fixture.automatic.checked.machine_occurrence_ids.includes(row[0])));
  assert.equal(plan.notes.find(row => row[6] === 1)?.[0], 'midi-t1-e13');
  const original = buildBasicKeyAudioPlan(song, selected(song, fixture.original));
  assert.equal(original.notes.length, 0); assert.equal(original.durationFrames, full.durationFrames);
  const explicit = buildBasicKeyAudioPlan(song, selected(song, fixture.explicit));
  assert.deepEqual(explicit.notes.find(row => row[0] === 'midi-t1-e11').slice(2, 4), [36000, 36960], 'The declared 20 ms instantaneous onset gate is unchanged');
});

test('real VSQ checked unions retain exact zero-origin gates, authored mute and every source ID', () => {
  const {fixture, song} = nativeVsq(), before = JSON.stringify(song), full = buildVsqAudioPlan(song, {sampleRate});
  assert.equal(fixture.original.checked.human_targets.target_count, 1); assert.equal(fixture.original.checked.human_targets.source_note_count, 2);
  for (const response of [fixture.original, fixture.automatic]) {
    const plan = buildVsqAudioPlan(song, selected(song, response)); assert.equal(plan.notes.length, 0); assert.equal(plan.durationFrames, full.durationFrames);
  }
  for (const response of [fixture.empty, fixture.narrow_scope]) {
    const plan = buildVsqAudioPlan(song, selected(song, response));
    assert.deepEqual(plan.notes, full.notes); assert.equal(plan.notes.length, 2); assert.equal(plan.notes[0][2], 0); assert.equal(plan.notes[1][2], 0);
    assert.deepEqual(new Set(plan.notes.map(row => row[0])), new Set(['vsq-t1-ID#0001', 'vsq-t2-ID#0001']));
    assert.ok(plan.notes.every(row => row[5] === 90)); assert.equal(plan.sourceNotes, 2);
    for (const [index, note] of song.runtime.notes.entries()) assert.deepEqual(plan.notes[index].slice(2, 4), basicKeyGateFrames(note.start_microseconds, note.end_microseconds, sampleRate));
  }
  assert.equal(fixture.narrow_scope.checked.scored_mode_allowed, false); assert.equal(song.runtime.notes[1].audible, false); assert.equal(JSON.stringify(song), before);
});

test('real canonical assistance and audio profile retain identical original occurrences and complete source clock', () => {
  const fixture = audioFixture('assistance-canonical'), before = JSON.stringify(fixture), full = buildCanonicalAudioPlan(fixture.compilation, fixture.audio_profile, {sampleRate, mode: 'listen', acceptedPolicyId: CANONICAL_AUDIO_POLICY});
  for (const response of [fixture.original, fixture.automatic, fixture.explicit, fixture.listen]) {
    const plan = buildCanonicalAudioPlan(fixture.compilation, fixture.audio_profile, {...selected(fixture.compilation, response), acceptedPolicyId: CANONICAL_AUDIO_POLICY});
    assert.deepEqual(plan.notes, full.notes.filter(row => response.checked.machine_occurrence_ids.includes(fixture.compilation.timeline.notes[row[0]].id)));
    assert.equal(plan.durationFrames, full.durationFrames); assert.equal(plan.sourceFingerprint, full.sourceFingerprint); assert.equal(plan.compiledFingerprint, full.compiledFingerprint);
  }
  assert.equal(JSON.stringify(fixture), before);
});

test('real Basic assisted playback keeps count-in, cancellation and explicit resumed machine gates on the audio thread', async () => {
  const {fixture, song} = nativeBasic(), h = basicKeyAudioHarness(), options = selected(song, fixture.explicit), errors = [];
  const original = Object.getOwnPropertyDescriptor(globalThis, 'AudioWorkletNode');
  globalThis.AudioWorkletNode = class {constructor() {return h.nodeFactory();}};
  const player = new CleanSongPlayer({getPositionMs: () => 0, onError: error => errors.push(error)}); player.select(song);
  const start = resumePositionMs => player.start({...options, context: h.context, output: h.output, acceptedPolicyId: song.runtime.rendition.policy_id, resumePositionMs});
  try {
    const anchor = await start(-100), receiver = player.basicKeys.receiver, secondIndex = receiver.plan.notes.findIndex(row => row[0] === 'midi-t1-e4');
    while (h.context.currentTime < anchor.anchorTime + .24) h.renderBlock();
    assert.equal(h.nodes[0].core.startedCount, 1); player.pause(); await Promise.resolve(); await Promise.resolve();
    assert.equal(receiver.outputGate.gain.value, 0); assert.equal(h.nodes[0].core.activeCount, 0);
    assert.equal(receiver.lastCompletion.ledger.actualStarts[secondIndex], anchor.anchorFrame + 10800, 'The second source attack starts after the original 125 ms plus 100 ms count-in');
    const resumed = await start(350), active = player.basicKeys.receiver;
    while (active.state !== 'ended') {h.renderBlock(); await Promise.resolve();}
    assert.equal(active.lastCompletion.started, 5); assert.equal(active.lastCompletion.ledger.actualStarts[secondIndex], resumed.anchorFrame);
    assert.equal(active.lastCompletion.ledger.actualEnds[secondIndex], resumed.anchorFrame + 7200, 'Resume uses the remaining 150 ms of the original second FIFO gate');
    assert.deepEqual(errors, []);
  } finally {player.stop(); await Promise.resolve(); await Promise.resolve(); if (original) Object.defineProperty(globalThis, 'AudioWorkletNode', original); else delete globalThis.AudioWorkletNode;}
});

test('real VSQ assistance reaches the shared player and rejects a changed selection before starting', async () => {
  const {fixture, song} = nativeVsq(), h = basicKeyAudioHarness(), options = selected(song, fixture.empty);
  let current = options.assistanceContext;
  const original = Object.getOwnPropertyDescriptor(globalThis, 'AudioWorkletNode');
  globalThis.AudioWorkletNode = class {constructor() {return h.nodeFactory();}};
  const player = new CleanSongPlayer({getPositionMs: () => 0}); player.select(song);
  try {
    await player.prepare({...options, assistanceContext: () => current, context: h.context, output: h.output});
    assert.equal(player.vsq.plan.notes.length, 2); assert.match(player.vsq.plan.assistanceFingerprint, /^[a-f0-9]{64}$/);
    const receiver = player.vsq.receiver; assert.equal(receiver.plan.assistanceFingerprint, player.vsq.plan.assistanceFingerprint);
    current = {...current, expected_selection_digest: fixture.automatic.checked.plan.selection_digest};
    await assert.rejects(player.startPrepared()); await Promise.resolve(); await Promise.resolve();
    assert.equal(receiver.connected, false); assert.equal(h.nodes[0].core.startedCount, 0); assert.equal(player.vsq.running, false);
  } finally {player.stop(); if (original) Object.defineProperty(globalThis, 'AudioWorkletNode', original); else delete globalThis.AudioWorkletNode;}
});

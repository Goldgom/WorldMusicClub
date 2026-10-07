import test from 'node:test';
import assert from 'node:assert/strict';
import {buildBasicKeyAudioPlan, createBasicKeyAudioTransfer} from '../web/basic-key-audio-plan.js';
import {buildVsqAudioPlan} from '../web/vsq-audio-plan.js';
import {buildCanonicalAudioPlan, canonicalIdentity, CANONICAL_AUDIO_POLICY} from '../web/canonical-audio-plan.js';
import {referencePreviewBudget} from '../web/basic-key-rendition.js';
import {CanonicalPlayer} from '../web/canonical-player.js';
import {CanonicalPracticeSession} from '../web/canonical-practice-session.js';
import {CanonicalAudioReceiver} from '../web/canonical-audio-receiver.js';
import {CanonicalAudioCore} from '../web/canonical-audio-core.js';
import {CleanSongPlayer} from '../web/clean-song-player.js';
import {basicKeySong} from './basic-key-rendition-fixtures.js';
import {basicKeyAudioHarness} from './basic-key-audio-harness.js';
import {capacityEvidence} from './canonical-audio-fixtures.js';
import {audioFixture, audioAssistanceFixture, originalVsqAudioSong} from './practice-assistance-audio-fixtures.js';

const sampleRate = 48000;
const options = f => ({mode: 'practice', practiceSelection: {kind: 'parts', part_ids: f.binding.selection.selected_part_ids}, assistance: f.assistance, assistanceContext: f.binding, sampleRate});
const canonical = (evidence, extra) => buildCanonicalAudioPlan(evidence.compilation, evidence.profile, {sampleRate, acceptedPolicyId: CANONICAL_AUDIO_POLICY, ...extra});
const settle = async () => {for (let i = 0; i < 8; i++) await Promise.resolve();};

test('Basic note assistance retains every other original gate inside the human part and uses its machine recipe', () => {
  const song = basicKeySong(), before = JSON.stringify(song), part = song.runtime.parts[0].id, full = buildBasicKeyAudioPlan(song, {sampleRate});
  const f = audioAssistanceFixture(song, {partIds: [part], humanIds: [song.compilation.timeline.notes[0].id]});
  const plan = buildBasicKeyAudioPlan(song, {...options(f), instrumentOverrides: {[part]: 'reed'}});
  assert.deepEqual(plan.notes, full.notes.filter(row => row[0] !== song.compilation.timeline.notes[0].id));
  assert.equal(plan.notes.filter(row => song.compilation.timeline.notes.find(note => note.id === row[0]).part_id === part).length, 2);
  assert.deepEqual(plan.timbres, plan.notes.map(row => song.compilation.timeline.notes.find(note => note.id === row[0]).part_id === part ? 3 : 0));
  assert.equal(plan.durationFrames, full.durationFrames); assert.equal(plan.sourceNotes, full.sourceNotes);
  assert.equal(plan.sourceSha256, full.sourceSha256); assert.equal(plan.policyId, full.policyId);
  assert.match(plan.assistanceFingerprint, /^[a-f0-9]{64}$/); assert.equal(JSON.stringify(song), before);
  const muted = buildBasicKeyAudioPlan(song, {...options(f), mutedParts: [part]});
  assert.equal(muted.notes.length, 2); assert.equal(muted.sourceNotes, full.sourceNotes);
  assert.notEqual(createBasicKeyAudioTransfer(muted).wire.assistancePlanFingerprint, createBasicKeyAudioTransfer(plan).wire.assistancePlanFingerprint);
});

for (const kind of ['basic', 'vsq']) test(`${kind} Original and empty-human ownership preserve existing gates, source clock and source bytes`, () => {
  const song = kind === 'basic' ? basicKeySong() : originalVsqAudioSong(), build = kind === 'basic' ? buildBasicKeyAudioPlan : buildVsqAudioPlan;
  const before = JSON.stringify(song), partIds = kind === 'vsq' ? song.runtime.parts.map(part => part.part_id) : [song.compilation.timeline.notes[0].part_id], humanIds = song.compilation.timeline.notes.filter(note => partIds.includes(note.part_id)).flatMap(note => note.source_note_ids);
  const original = audioAssistanceFixture(song, {partIds, humanIds, mode: 'original'}), originalPlan = build(song, options(original));
  const baseline = build(song, {sampleRate, mode: 'practice', practiceSelection: {kind: 'parts', part_ids: partIds}});
  assert.deepEqual(originalPlan.notes, baseline.notes); assert.equal(originalPlan.durationFrames, baseline.durationFrames);
  const empty = audioAssistanceFixture(song, {partIds, humanIds: []}), emptyPlan = build(song, options(empty)), full = build(song, {sampleRate});
  assert.deepEqual(emptyPlan.notes, full.notes); assert.equal(emptyPlan.durationFrames, full.durationFrames); assert.equal(emptyPlan.sourceSha256, full.sourceSha256);
  assert.equal(empty.assistance.scored_mode_allowed, false); assert.equal(JSON.stringify(song), before);
  if (kind === 'vsq') {assert.equal(emptyPlan.notes[0][2], 0); assert.ok(emptyPlan.notes.every(row => row[5] === 90)); assert.equal(emptyPlan.notes.length, 2, 'The authored source-muted part remains a retained machine voice');}
});

test('an admitted all-machine Original uses an explicit empty Listen union in every renderer', () => {
  for (const kind of ['basic', 'vsq', 'canonical']) {
    const evidence = kind === 'canonical' ? audioFixture('canonical-audio-evidence') : null;
    const song = kind === 'basic' ? basicKeySong() : kind === 'vsq' ? originalVsqAudioSong() : evidence.compilation;
    const f = audioAssistanceFixture(song, {partIds: [], mode: 'original'});
    const build = extra => kind === 'canonical' ? canonical(evidence, extra) : (kind === 'basic' ? buildBasicKeyAudioPlan : buildVsqAudioPlan)(song, {sampleRate, ...extra});
    const full = build({mode: 'listen'}), selected = build({...options(f), mode: 'listen'});
    assert.deepEqual(selected.notes, full.notes); assert.equal(selected.durationFrames, full.durationFrames);
    assert.throws(() => build({...options(f), mode: 'practice'}));
    if (kind !== 'canonical') assert.equal(referencePreviewBudget(song.compilation.timeline.notes, options(f).practiceSelection, song.runtime.rendition, {assistance: f.assistance, assistanceContext: f.binding, sourceToken: song}), referencePreviewBudget(song.compilation.timeline.notes, null, song.runtime.rendition));
  }
});

test('canonical atomic unisons, tied sources and repeats remain whole while same-part machine gates retain exact clocks', () => {
  const evidence = audioFixture('canonical-audio-evidence'), before = JSON.stringify(evidence), partIds = evidence.compilation.score.parts.map(part => part.id);
  const humanIds = [...new Set(evidence.compilation.timeline.notes.filter(note => note.midi === 60).flatMap(note => note.source_note_ids))];
  const f = audioAssistanceFixture(evidence.compilation, {partIds, humanIds}), full = canonical(evidence, {mode: 'listen'}), plan = canonical(evidence, {...options(f), instrumentOverrides: {'机 器/一': 'triangle'}});
  assert.equal(f.assistance.human_targets.target_count, 2); assert.equal(f.assistance.human_targets.source_note_count, 6);
  assert.deepEqual(plan.notes, full.notes.filter(row => row[3] === 67)); assert.deepEqual(plan.instruments, [1, 1]);
  assert.deepEqual(plan.notes.map((_, index) => canonicalIdentity(plan, index).sourceNoteIds), [['极短 🐦'], ['极短 🐦']]);
  assert.ok(plan.notes.every(row => row[2] - row[1] === 1)); assert.equal(plan.durationFrames, full.durationFrames);
  assert.equal(plan.sourceFingerprint, full.sourceFingerprint); assert.equal(plan.compiledFingerprint, full.compiledFingerprint); assert.equal(JSON.stringify(evidence), before);
  const allMachine = audioAssistanceFixture(evidence.compilation, {partIds}), machine = canonical(evidence, options(allMachine));
  assert.deepEqual(machine.notes, full.notes); assert.equal(machine.notes.filter(row => row[1] === 0 && row[3] === 60).length, 3, 'Machine unisons remain separate original voices');
});

test('missing/foreign receipt mappings, stale scope, revision, source and native choice fail before any gate transfer', () => {
  const song = basicKeySong(), partIds = [song.runtime.parts[0].id], f = audioAssistanceFixture(song, {partIds, humanIds: [song.compilation.timeline.notes[0].id]});
  for (const extra of [{assistance: structuredClone(f.assistance)}, {assistanceContext: {...f.binding, sourceToken: structuredClone(song)}}, {assistanceContext: {...f.binding, runtimeToken: {...song.runtime}}}, {assistanceContext: {...f.binding, revision: 2}}, {practiceSelection: {kind: 'all'}}, {assistanceContext: {...f.binding, expected_selection_digest: 'b'.repeat(64)}}, {assistanceContext: {...f.binding, expected_selection_digest: undefined}}]) assert.throws(() => buildBasicKeyAudioPlan(song, {...options(f), ...extra}));
  const missing = audioAssistanceFixture(song, {partIds, modify: response => {response.checked.machine_occurrence_ids[0] = 'foreign-occurrence';}});
  assert.throws(() => buildBasicKeyAudioPlan(song, options(missing)), {code: 'stale_practice_assistance'});
  const unisonSong = originalVsqAudioSong(), split = audioAssistanceFixture(unisonSong, {partIds: ['vsq-track-1'], humanIds: ['vsq-t1-ID#0001']});
  assert.throws(() => buildVsqAudioPlan(unisonSong, options(split)), {code: 'stale_practice_assistance'});
  const foreign = audioAssistanceFixture(song, {partIds, modify: (response, binding) => {binding.source.content_sha256 = 'b'.repeat(64); binding.source.key = `song-${binding.source.content_sha256}`; response.checked.receipt.saved_package_sha256 = binding.source.content_sha256;}});
  assert.throws(() => buildBasicKeyAudioPlan(song, options(foreign)), {code: 'stale_practice_assistance'});
  const vsq = originalVsqAudioSong(), vf = audioAssistanceFixture(vsq, {partIds: ['vsq-track-1']});
  assert.throws(() => buildVsqAudioPlan(vsq, {...options(vf), assistanceContext: {...vf.binding, source: {...vf.binding.source, choice: null}}}));
});

test('preview capacity cache includes assistance ownership and mute instead of only the human part union', () => {
  const song = basicKeySong(), notes = song.compilation.timeline.notes, rendition = song.runtime.rendition, partIds = [song.runtime.parts[0].id], selection = {kind: 'parts', part_ids: partIds};
  const original = referencePreviewBudget(notes, selection, rendition), f = audioAssistanceFixture(song, {partIds});
  const opts = {assistance: f.assistance, assistanceContext: f.binding, sourceToken: song};
  assert.equal(referencePreviewBudget(notes, selection, rendition, opts), referencePreviewBudget(notes, null, rendition));
  assert.ok(referencePreviewBudget(notes, selection, rendition, opts) > original);
  assert.equal(referencePreviewBudget(notes, selection, rendition, {...opts, mutedParts: song.runtime.parts.map(part => part.id)}), 0);
  assert.equal(referencePreviewBudget(notes, selection, rendition), original);
});

test('Guitar receipts retain independent same-key voices without applying Piano atomic ownership rules', () => {
  const song = originalVsqAudioSong(), f = audioAssistanceFixture(song, {partIds: ['vsq-track-1'], humanIds: ['vsq-t1-ID#0001'], modify: (_, binding) => {binding.selection.profile = {kind: 'guitar', tuning: [40, 45, 50, 55, 59, 64], frets: 24, capo: 0};}});
  const full = buildVsqAudioPlan(song, {sampleRate, instrument: 'guitar'}), plan = buildVsqAudioPlan(song, {...options(f), instrument: 'guitar'});
  assert.deepEqual(plan.notes, full.notes.filter(row => row[0] === 'vsq-t2-ID#0001'));
  assert.equal(plan.durationFrames, full.durationFrames); assert.equal(plan.sourceNotes, full.sourceNotes);
});

test('assistance exceeding 128 simultaneous canonical machine gates rejects the entire plan', () => {
  const evidence = capacityEvidence({count: 129, voices: 129}), partIds = evidence.compilation.score.parts.map(part => part.id), f = audioAssistanceFixture(evidence.compilation, {partIds});
  assert.equal(canonical(evidence, {mode: 'practice', practiceSelection: {kind: 'all'}}).count, 0);
  assert.throws(() => canonical(evidence, options(f)), {code: 'voice_budget_exceeded'});
});

test('a changed assistance binding while Basic module loading cancels the receiver and cannot auto-start', async () => {
  const h = basicKeyAudioHarness(), song = basicKeySong(), f = audioAssistanceFixture(song, {partIds: [song.runtime.parts[0].id]});
  let current = f.binding, release;
  h.context.audioWorklet.addModule = () => new Promise(resolve => {release = resolve;});
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'AudioWorkletNode');
  globalThis.AudioWorkletNode = class {constructor() {return h.nodeFactory();}};
  const player = new CleanSongPlayer({getPositionMs: () => 0}); player.select(song);
  try {
    const pending = player.prepare({...options(f), assistanceContext: () => current, context: h.context, output: h.output, acceptedPolicyId: song.runtime.rendition.policy_id});
    await settle(); current = {...current, expected_selection_digest: 'b'.repeat(64)}; release();
    await assert.rejects(pending); await settle();
    assert.equal(player.basicKeys.running, false); assert.equal(player.basicKeys.receiver, null); assert.equal(h.nodes[0].connected, false); assert.equal(h.nodes[0].core.startedCount, 0);
  } finally {player.stop(); if (descriptor) Object.defineProperty(globalThis, 'AudioWorkletNode', descriptor); else delete globalThis.AudioWorkletNode;}
});

test('canonical session forwards ownership through sounding/silent range plans and fences stale paused resume', async () => {
  const h = basicKeyAudioHarness(), evidence = audioFixture('canonical-audio-evidence'), f = audioAssistanceFixture(evidence.compilation, {partIds: evidence.compilation.score.parts.map(part => part.id), humanIds: ['极短 🐦']});
  let current = f.binding;
  const session = new CanonicalPracticeSession({api: async () => evidence.profile, playerFactory: callbacks => new CanonicalPlayer({...callbacks, receiverFactory: (context, output, callbacks) => CanonicalAudioReceiver.create(context, output, {...callbacks, nodeFactory: () => h.nodeFactory({Core: CanonicalAudioCore})})})});
  session.select(evidence.compilation);
  const configured = {...options(f), assistanceContext: () => current, context: h.context, output: h.output, range: {startMs: 0, endMs: 1000}, countInMs: 100, loop: {enabled: true, maxPasses: 3}};
  try {
    const prepared = await session.prepare(configured); assert.equal(prepared.plan.count, 6); assert.equal(prepared.plan.rangeGateCount, 3); assert.equal(prepared.interpretation.assistance_fingerprint, prepared.plan.assistanceFingerprint);
    await session.startPrepared(); for (let i = 0; i < 60; i++) h.renderBlock(); await session.pause();
    const receiver = session.player.receiver; current = {...current, expected_selection_digest: 'b'.repeat(64)};
    await assert.rejects(session.resume()); await settle(); assert.equal(receiver.connected, false); assert.equal(session.running, false);
    current = f.binding; const silent = await session.prepare({...configured, soundEnabled: false});
    assert.equal(silent.plan.planFingerprint, prepared.plan.planFingerprint); assert.equal(silent.plan.durationFrames, prepared.plan.durationFrames);
  } finally {session.stop(); await settle();}
});

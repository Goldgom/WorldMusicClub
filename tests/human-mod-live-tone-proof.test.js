import test from 'node:test';
import assert from 'node:assert/strict';
import {validateHumanModLiveTone, HUMAN_MOD_LIVE_TONE_LIMITS} from '../scripts/human-mod-live-tone-proof.mjs';
import {validateLiveToneEvidence} from '../scripts/live-tone-proof.mjs';

import {syntheticFixture} from './human-mod-proof-fixtures.js';

const verify = ({e, options}) => validateHumanModLiveTone(e, options);

test('synthetic contracts distinguish both production recipes with one native-token shape and all shared owners', () => {
  const piano = syntheticFixture(), guitar = syntheticFixture({instrument: 'guitar'});
  for (const fixture of [piano, guitar]) {
    const before = structuredClone(fixture);
    assert.equal(verify(fixture), fixture.e);
    assert.equal(fixture.e.fixtureKind, 'synthetic-verifier-only');
    assert.equal(fixture.e.actual_app, undefined, 'Contract verification does not certify synthetic native provenance');
    assert.deepEqual(fixture, before, 'Verification never edits retained evidence or scoring');
  }
  assert.notEqual(piano.e.receipts[1].record.pcmEnergy, guitar.e.receipts[1].record.pcmEnergy);
  assert.notEqual(piano.e.receipts[1].record.pcmPeak, guitar.e.receipts[1].record.pcmPeak);
});

test('a genuinely late original key is assessed once as an extra without rewriting it into a hit', () => {
  const fixture = syntheticFixture({instrument: 'guitar', late: true});
  assert.equal(fixture.options.take.passes[0].assessment.hits.length, 0);
  assert.deepEqual(fixture.options.take.passes[0].assessment.extras, fixture.options.take.passes[0].inputs);
  verify(fixture);
});

test('the original two-owner fixture retains its other unplayed shared target and all four source notes', () => {
  for (const late of [false, true]) {
    const fixture = syntheticFixture({late}), take = fixture.options.take, plan = take.target_plan;
    plan.timeline.notes.push({id: 'shared-e4-a', part_id: 'P1', midi: 64, start_ms: 63000,
      duration_ms: 1000, velocity: 90, source_note_id: 'shared-e4-a', source_note_ids: ['shared-e4-a', 'shared-e4-b'], voice: '1', staff: 1});
    plan.groups.push({target_id: 'shared-e4-a', source_occurrence_ids: ['shared-e4-a', 'shared-e4-b'],
      source_note_ids: ['shared-e4-a', 'shared-e4-b'], part_ids: ['P1', 'P2']});
    plan.timeline.duration_ms = 64000;
    plan.source_note_count = 4;
    plan.target_count = 2;
    take.passes[0].range.end_ms = 64000;
    take.passes[0].assessment.misses.push('shared-e4-a');
    verify(fixture);
  }
});

test('original epoch timestamps retain their normalized input clocks and independent transport identity', () => {
  const fixture = syntheticFixture();
  for (let index = 0; index < 2; index++) {
    const raw = fixture.e.inputs[index].eventTime + 1700000000000;
    fixture.e.inputs[index].eventTime = raw;
    fixture.options.transport.rows[index].event.eventTime = raw;
    Object.assign(fixture.options.take.input_evidence.events[index], {raw_timestamp_ms: raw, timestamp_basis: 'event_epoch'});
  }
  verify(fixture);
});

test('production replay follows observed rate, velocity, nonaligned onset and held release duration', () => {
  for (const rate of [8000, 44100, 48000, 96000]) for (const instrument of ['piano', 'guitar']) {
    verify(syntheticFixture({rate, instrument, velocity: rate === 44100 ? 47 : 127, holdMs: 73, offset: 19}));
  }
});

test('native-looking labels and positive PCM cannot substitute the opposite production recipe', () => {
  for (const instrument of ['piano', 'guitar']) {
    const opposite = instrument === 'piano' ? 'guitar' : 'piano';
    const fixture = syntheticFixture({instrument});
    fixture.e.receipts[1].record = syntheticFixture({instrument: opposite}).e.receipts[1].record;
    // The pre-existing general sound contract admits either nonzero recipe.
    validateLiveToneEvidence(fixture.e, {keyCode: 'KeyR', midi: 60, transport: fixture.options.transport});
    assert.throws(() => verify(fixture), /production .* recipe/);
    const swapped = syntheticFixture({instrument});
    swapped.e.calls[0].timbre = opposite;
    assert.throws(() => verify(swapped), /expected human Mod recipe/);
  }
});

const adversaries = [
  ['missing transport', f => { delete f.options.transport; }],
  ['forged down time', f => { f.e.inputs[0].eventTime++; }],
  ['forged up time', f => { f.e.inputs[1].eventTime++; }],
  ['transport rewritten time', f => { f.options.transport.rows[0].event.eventTime++; }],
  ['extra trusted event', f => { f.options.transport.rows.push(structuredClone(f.options.transport.rows[0])); }],
  ['untrusted down', f => { f.e.inputs[0].isTrusted = false; }],
  ['repeated down', f => { f.e.inputs[0].repeat = true; }],
  ['wrong shared key', f => { f.e.inputs[0].code = 'KeyT'; }],
  ['duplicate native call', f => { f.e.calls.push(structuredClone(f.e.calls[0])); }],
  ['duplicate native voice', f => { const rows = structuredClone(f.e.receipts); rows.forEach(row => row.record.token++); f.e.receipts.push(...rows); }],
  ['foreign click voice', f => { const row = structuredClone(f.e.receipts[1]); row.record.kind = 'click'; f.e.receipts.push(row); }],
  ['fake receiver', f => { f.e.ready.receiver.nativeNode = false; }],
  ['fake port', f => { f.e.receipts[1].nativePort = false; }],
  ['fake MessageEvent', f => { f.e.receipts[0].nativeMessage = false; }],
  ['untrusted receipt', f => { f.e.receipts[1].isTrusted = false; }],
  ['foreign receipt port', f => { f.e.receipts[1].portMatches = false; }],
  ['no native terminal', f => { f.e.receipts.pop(); }],
  ['finite duration', f => { f.e.calls[0].duration = 40; }],
  ['canceled release', f => { f.e.receipts[1].record.reason = 'canceled'; }],
  ['changed velocity', f => { f.e.calls[0].velocity = 45; }],
  ['changed peak', f => { f.e.receipts[1].record.pcmPeak *= 1.01; }],
  ['changed energy', f => { f.e.receipts[1].record.pcmEnergy *= 1.01; }],
  ['nonfinite peak', f => { f.e.receipts[1].record.pcmPeak = NaN; }],
  ['nonfinite energy', f => { f.e.receipts[1].record.pcmEnergy = Infinity; }],
  ['changed nonzero count', f => { f.e.receipts[1].record.nonzeroSamples--; }],
  ['changed rendered count', f => { f.e.receipts[1].record.renderedSamples--; }],
  ['changed first nonzero frame', f => { f.e.receipts[1].record.firstNonzeroFrame++; }],
  ['changed last rendered frame', f => { f.e.receipts[1].record.lastRenderedFrame--; }],
  ['changed receipt frame', f => { f.e.receipts[1].record.frame++; }],
  ['changed start frame', f => { f.e.receipts[0].record.actualStartFrame++; }],
  ['changed terminal frame', f => { f.e.receipts[1].record.actualEndFrame++; }],
  ['coherent changed duration', f => { const r = f.e.receipts[1].record; r.actualEndFrame += 128; r.frame += 128; r.renderedSamples += 128; r.lastRenderedFrame += 128; r.nonzeroSamples += 128; f.e.after.receiver.audioTime += 128 / r.sampleRate; }],
  ['impossible held release', f => { const r = f.e.receipts[1].record; r.actualEndFrame = r.actualStartFrame + Math.ceil(.012 * r.sampleRate); r.frame = r.actualEndFrame; r.renderedSamples = r.actualEndFrame - r.actualStartFrame; r.nonzeroSamples = r.renderedSamples - 1; r.lastRenderedFrame = r.actualEndFrame - 1; }],
  ['unbounded held interval', f => { const r = f.e.receipts[1].record; r.actualEndFrame += r.sampleRate * (HUMAN_MOD_LIVE_TONE_LIMITS.holdMs / 1000 + 1); r.frame = r.actualEndFrame; r.renderedSamples = r.actualEndFrame - r.actualStartFrame; r.nonzeroSamples = r.renderedSamples - 1; r.lastRenderedFrame = r.actualEndFrame - 1; f.e.after.receiver.audioTime = r.actualEndFrame / r.sampleRate + 1; }],
  ['no observed PCM', f => { f.e.pcm.blocks = []; }],
  ['silent observed PCM', f => { f.e.pcm.blocks[0].peak = 0; }],
  ['nonfinite observed PCM', f => { f.e.pcm.blocks[0].energy = Infinity; }],
  ['PCM outside token interval', f => { f.e.pcm.blocks[0].audioTime = 100; }],
  ['muted gain path', f => { f.e.pcm.blocks[0].graphToDestination[1].gain = 0; }],
  ['changed output graph', f => { f.e.after.graphRevision++; }],
  ['missing source accompaniment', f => { f.e.ready.source.activeReceivers = 0; }],
  ['missing recorded input', f => { f.options.take.passes[0].inputs = []; }],
  ['duplicate recorded input', f => { const p = f.options.take.passes[0]; p.inputs.push(structuredClone(p.inputs[0])); }],
  ['duplicate capture', f => { const p = f.options.take.passes[0]; p.captures.push(structuredClone(p.captures[0])); }],
  ['duplicate pass', f => { f.options.take.passes.push(structuredClone(f.options.take.passes[0])); }],
  ['unassigned extra input', f => { f.options.take.unassigned_captures.push({midi: 60}); }],
  ['pending assessment', f => { f.options.take.passes[0].pending = true; }],
  ['stale assessment', f => { f.options.take.passes[0].assessed_revision = 0; }],
  ['missing assessment', f => { f.options.take.passes[0].assessment = null; }],
  ['missing grade assignment', f => { f.options.take.passes[0].assessment.hits = []; }],
  ['double grade assignment', f => { const p = f.options.take.passes[0]; p.assessment.extras.push(structuredClone(p.inputs[0])); }],
  ['altered assessed time', f => { f.options.take.passes[0].assessment.hits[0].actual_ms++; }],
  ['altered assessed target', f => { f.options.take.passes[0].assessment.hits[0].note_id = 'missing'; }],
  ['altered capture input', f => { f.options.take.passes[0].captures[0].input.at_ms++; }],
  ['altered onset capture', f => { f.options.take.input_evidence.events[0].onset_capture.event_id++; }],
  ['altered scored clock', f => { f.options.take.passes[0].clock_segments[0].wallStart++; }],
  ['altered recorded down timestamp', f => { f.options.take.input_evidence.events[0].raw_timestamp_ms++; }],
  ['altered recorded up timestamp', f => { f.options.take.input_evidence.events[1].raw_timestamp_ms++; }],
  ['altered normalized up clock', f => { f.options.take.input_evidence.events[1].event_wall_ms--; }],
  ['processor supplied clock', f => { f.options.take.input_evidence.events[0].timestamp_basis = 'processor_frame'; }],
  ['missing key release', f => { f.options.take.input_evidence.events.pop(); }],
  ['foreign release source', f => { f.options.take.input_evidence.events[1].source_id = 'another-key'; }],
  ['synthetic key release', f => { f.options.take.input_evidence.events[1].kind = 'synthetic_release'; }],
  ['truncated input evidence', f => { f.options.take.input_evidence.truncated = true; }],
  ['native receipt in recorded input', f => { f.options.take.input_evidence.events.push({kind: 'started', source: 'live-tone'}); }],
  ['missing expected owner', f => { f.options.expectedPartIds.pop(); }],
  ['duplicate expected owner', f => { f.options.expectedPartIds.push('P1'); }],
  ['missing selected owner', f => { f.options.take.practice_selection.part_ids.pop(); }],
  ['missing target-group owner', f => { f.options.take.target_plan.groups[0].part_ids.pop(); }],
  ['duplicate target-group owner', f => { f.options.take.target_plan.groups[0].part_ids.push('P1'); }],
  ['substituted target-group owner', f => { f.options.take.target_plan.groups[0].part_ids[1] = 'P3'; }],
  ['collapsed source occurrence', f => { f.options.take.target_plan.groups[0].source_occurrence_ids.pop(); }],
  ['collapsed source note', f => { f.options.take.target_plan.groups[0].source_note_ids.pop(); }],
  ['coherently collapsed source note', f => { f.options.take.target_plan.groups[0].source_note_ids.pop(); f.options.take.target_plan.timeline.notes[0].source_note_ids.pop(); }],
  ['wrong source count', f => { f.options.take.target_plan.source_note_count++; }],
  ['wrong target count', f => { f.options.take.target_plan.target_count++; }],
  ['wrong target pitch', f => { f.options.take.target_plan.timeline.notes[0].midi = 61; }],
];
for (const [name, mutate] of adversaries) test(`human Mod proof rejects ${name}`, () => {
  const fixture = syntheticFixture();
  mutate(fixture);
  assert.throws(() => verify(fixture), `Accepted adversary: ${name}`);
});

test('a late extra still cannot substitute another input or hide an extra grade assignment', () => {
  for (const mutate of [
    f => { f.options.take.passes[0].assessment.extras[0].at_ms++; },
    f => { f.options.take.passes[0].assessment.extras[0].velocity--; },
    f => { f.options.take.passes[0].assessment.misses = []; },
  ]) {
    const fixture = syntheticFixture({late: true});
    mutate(fixture);
    assert.throws(() => verify(fixture));
  }
});

test('only aggregate floating PCM tolerates tiny platform roundoff; integral evidence remains exact', () => {
  const fixture = syntheticFixture();
  fixture.e.receipts[1].record.pcmPeak *= 1 + 1e-7;
  fixture.e.receipts[1].record.pcmEnergy *= 1 - 1e-7;
  verify(fixture);
  fixture.e.receipts[1].record.nonzeroSamples--;
  assert.throws(() => verify(fixture));
});

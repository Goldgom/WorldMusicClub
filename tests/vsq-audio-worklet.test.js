import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {prepareCleanSong, prepareVsqPractice} from '../web/clean-song-package.js';
import {buildVsqAudioPlan} from '../web/vsq-audio-plan.js';
import {BasicKeyAudioCore} from '../web/basic-key-audio-core.js';
import {CleanSongPlayer} from '../web/clean-song-player.js';
import {basicKeyAudioHarness} from './basic-key-audio-harness.js';
import {BASIC_KEY_AUDIO_PROTOCOL, BASIC_KEY_AUDIO_LIMITS, BASIC_KEY_TIMBRE_PROFILE, VSQ_AUDIO_POLICY, VSQ_AUDIO_IDENTITY, VSQ_TRIANGLE_SIZE, basicKeyGateFrames, validateBasicKeyAudioPlan, createBasicKeyAudioTransfer} from '../web/basic-key-audio-plan.js';

const fixture = name => JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url)));
const sampleRate = 48000, hash = 'a'.repeat(64);
export function vsqSong() {
  const opened = fixture('vsq-clean-v1-native-open'), descriptor = opened.clean_package;
  return prepareVsqPractice(prepareCleanSong(`native:song-${descriptor.content_sha256}`, descriptor, JSON.parse(opened.score_json)), fixture('vsq-clean-v1-runtime'));
}
function syntheticPlan(notes, options = {}) {
  return validateBasicKeyAudioPlan({protocol: BASIC_KEY_AUDIO_PROTOCOL, policyId: VSQ_AUDIO_POLICY, identityKind: VSQ_AUDIO_IDENTITY, sourceSha256: hash, sampleRate, sourceNotes: notes.length, durationFrames: Math.max(1, ...notes.map(note => note[3])), notes, ...options});
}
const row = (id, start, end, role = 2, key = 60) => [`vsq-t1-ID#${id}`, `vsq:${hash}:t1:ID#${id}`, start, end, key, 90, role];
function run(plan, {position = 0, audit = false} = {}) {
  const messages = [], core = new BasicKeyAudioCore(plan.sampleRate, {emit: message => messages.push(message)});
  const packed = createBasicKeyAudioTransfer(plan);
  const byteLength = packed.transfer.reduce((sum, buffer) => sum + buffer.byteLength, 0);
  core.handleMessage({type: 'prepare', generation: 1, wire: packed.wire, positionFrame: position}, 0);
  let frame = 0;
  while (core.state === 'preparing') { core.process([new Float32Array(128)], frame); assert.ok(core.lastPrepareWork <= 1024); frame += 128; }
  assert.equal(core.state, 'ready', JSON.stringify(messages)); assert.ok(frame / plan.sampleRate < 5, 'Maximum preparation fits the existing acknowledgment deadline');
  const anchor = frame + Math.round(plan.sampleRate * .05);
  core.handleMessage({type: 'start', generation: 1, anchorFrame: anchor}, frame);
  if (audit) core.handleMessage({type: 'audit', generation: 1, offset: 0, count: 256}, frame);
  let nonzero = 0; const pcm = new Float32Array(plan.durationFrames);
  while (core.state === 'running') { const block = new Float32Array(128); core.process([block], frame); assert.ok(block.every(Number.isFinite)); nonzero += block.filter(value => value !== 0).length; for (let at = 0; at < block.length; at++) if (frame+at >= anchor && frame+at-anchor < pcm.length) pcm[frame+at-anchor] = block[at]; frame += block.length; }
  assert.equal(core.state, 'ended', JSON.stringify(messages));
  return {core, messages, anchor, byteLength, nonzero, pcm, completion: messages.at(-1)};
}

test('VSQ uses every exact native gate and source end without changing source/score bytes or applying vocal Dynamics', () => {
  const song = vsqSong(), before = JSON.stringify(song), plan = buildVsqAudioPlan(song, {sampleRate});
  assert.equal(plan.identityKind, VSQ_AUDIO_IDENTITY); assert.equal(plan.policyId, VSQ_AUDIO_POLICY);
  assert.equal(plan.sourceNotes, 2); assert.equal(plan.notes.length, 2, 'Full Listen includes the source-muted authored part');
  const result = run(plan, {audit: true}); assert.equal(result.core.startedCount, 2); assert.equal(result.core.endedCount, 2); assert.ok(result.nonzero > 0);
  for (const [index, note] of song.runtime.notes.entries()) {
    assert.equal(plan.notes[index][0], note.note_id); assert.equal(plan.notes[index][5], 90); assert.equal(note.dynamics, 0);
    assert.deepEqual(plan.notes[index].slice(2, 4), basicKeyGateFrames(note.start_microseconds, note.end_microseconds, sampleRate));
    assert.equal(result.completion.ledger.actualStarts[index], result.anchor + plan.notes[index][2]);
    assert.equal(result.completion.ledger.actualEnds[index], result.anchor + plan.notes[index][3]);
  }
  assert.equal(result.completion.frame, result.anchor + plan.durationFrames); assert.equal(result.completion.sourceNotes, 2);
  assert.ok(Math.abs(plan.durationFrames - song.runtime.end_ms * 48) < 1);
  assert.equal(JSON.stringify(song), before);
});

test('VSQ explicit mix, solo and human exclusion retain source count and native project end', () => {
  const song = vsqSong(), build = options => buildVsqAudioPlan(song, {sampleRate, ...options}), full = build({});
  for (const options of [{mutedParts:['vsq-track-1']}, {soloParts:['vsq-track-2']}, {mode:'practice', targetPart:'vsq-track-1'}]) {
    const plan = build(options); assert.deepEqual(plan.notes.map(note => note[0]), ['vsq-t2-ID#0001']); assert.equal(plan.sourceNotes, 2); assert.equal(plan.durationFrames, full.durationFrames);
  }
  const silent = build({mode:'practice', targetPart:'vsq-track-1', mutedParts:['vsq-track-2']}); assert.equal(silent.notes.length, 0); assert.equal(run(silent).completion.frame, run(full).completion.frame);
  assert.throws(() => build({mode:'practice', targetPart:'missing'}), {code:'clean_target_required'});
  assert.throws(() => build({instrument:'voicebank'}), {code:'vsq_reference_instrument'});
});

test('VSQ transfer and bounded live audit preserve four/eight digit authored IDs as distinct identities', () => {
  const plan = syntheticPlan([row('0001', 0, 20), row('00000001', 0, 20), row('99999999', 30, 40)]), packed = createBasicKeyAudioTransfer(plan);
  assert.equal(packed.wire.buffers.tracks, undefined); assert.equal(packed.wire.buffers.events, undefined);
  assert.deepEqual([...new Uint8Array(packed.wire.buffers.authoredIdDigits)], [4, 8, 8]);
  const audit = run(plan, {audit:true}).messages.find(message => message.type === 'audit');
  assert.deepEqual(audit.rows.map(note => note.noteId), plan.notes.map(note => note[0])); assert.deepEqual(audit.rows.map(note => note.eventId), plan.notes.map(note => note[1]));
  for (const mutate of [p=>p.notes[0][0]='midi-t1-e1', p=>p.notes[0][1]=`midi:${hash}:t0:e0`, p=>p.notes[0][0]='vsq-t1-ID#1', p=>p.notes[0][5]=89, p=>p.notes[0][6]=0, p=>p.identityKind=undefined, p=>p.policyId='wmh-basic-key-rendition-fifo-v1']) {
    const invalid=structuredClone(plan); mutate(invalid); assert.throws(()=>validateBasicKeyAudioPlan(invalid), {code:'invalid_audio_plan'});
  }
});

test('VSQ negative count-in and resume play held gates once, skip expired gates and preserve authored ends', () => {
  const plan = syntheticPlan([row('0001',0,100),row('0002',0,1000),row('0003',500,600)]);
  const resumed = run(plan, {position:250}), ledger=resumed.completion.ledger;
  assert.deepEqual([...ledger.actualStarts],[-1,resumed.anchor,resumed.anchor+250]); assert.deepEqual([...ledger.actualEnds],[-1,resumed.anchor+750,resumed.anchor+350]); assert.equal(resumed.core.skippedCount,1);
  const countIn=run(plan,{position:-200});assert.deepEqual([...countIn.completion.ledger.actualStarts],[countIn.anchor+200,countIn.anchor+200,countIn.anchor+700]);
});

test('VSQ retains piano/guitar recipes and rejects unsupported harmonics rather than clamping a key', () => {
  const piano=syntheticPlan([row('0001',0,1000,2)]),guitar=syntheticPlan([row('0001',0,1000,3)]);
  assert.ok(run(piano).nonzero);assert.ok(run(guitar).nonzero);
  const packed=createBasicKeyAudioTransfer(piano),table=new Float32Array(packed.wire.buffers.triangles);assert.equal(table.length,128*VSQ_TRIANGLE_SIZE);assert.ok(table.every(value=>Number.isFinite(value)&&Math.abs(value)<=1.001));
  assert.throws(()=>syntheticPlan([row('0001',0,100,3,127)]),{code:'unsupported_audio_sample_rate'});
  assert.throws(()=>syntheticPlan([row('0001',0,100,2,100)],{sampleRate:8000}),{code:'unsupported_audio_sample_rate'});
});

test('VSQ accepts and renders the 65536-note, 128-voice bound with wire data below 16 MiB', () => {
  const notes=Array.from({length:BASIC_KEY_AUDIO_LIMITS.maxNotes},(_,index)=>row(String(index).padStart(8,'0'),Math.floor(index/128),Math.floor(index/128)+1));
  const plan=syntheticPlan(notes,{sampleRate:8000}),result=run(plan);
  assert.equal(result.core.startedCount,65536);assert.equal(result.core.endedCount,65536);assert.equal(result.core.activeCount,0);assert.ok(result.byteLength<BASIC_KEY_AUDIO_LIMITS.maxBytes);assert.ok(JSON.stringify(plan).length<BASIC_KEY_AUDIO_LIMITS.maxBytes);
  const colors=run(validateBasicKeyAudioPlan({...plan,timbreProfile:BASIC_KEY_TIMBRE_PROFILE,timbres:Array(notes.length).fill(3)}));
  assert.equal(colors.core.startedCount,65536);assert.equal(colors.core.endedCount,65536);assert.ok(colors.byteLength<BASIC_KEY_AUDIO_LIMITS.maxBytes);assert.deepEqual(colors.completion.ledger,result.completion.ledger);
  assert.throws(()=>validateBasicKeyAudioPlan({...plan,sourceNotes:65537}),{code:'invalid_audio_plan'});
  assert.throws(()=>syntheticPlan(Array.from({length:129},(_,index)=>row(String(index).padStart(4,'0'),0,1))),{code:'voice_budget_exceeded'});
});

test('VSQ receiver independently rejects malformed transferred IDs and unsafe waveform data before sound', () => {
  for(const change of [w=>new Uint8Array(w.buffers.authoredIdDigits)[0]=5,w=>new Uint16Array(w.buffers.sourceTracks)[0]=0,w=>new Uint32Array(w.buffers.authoredIds)[0]=10000,w=>new Float32Array(w.buffers.triangles)[0]=NaN,w=>new Float32Array(w.buffers.triangles)[0]=2]) {
    const wire=createBasicKeyAudioTransfer(syntheticPlan([row('0001',0,100)])).wire;change(wire);const core=new BasicKeyAudioCore(sampleRate);
    core.handleMessage({type:'prepare',generation:1,positionFrame:0,wire},0);let frame=0;while(core.state==='preparing'){core.process([new Float32Array(128)],frame);frame+=128;}
    assert.equal(core.state,'error');assert.equal(core.startedCount,0);
  }
});


test('VSQ preparation rejects native millisecond/rational disagreement even when a part is excluded', () => {
  const opened=fixture('vsq-clean-v1-native-open'),descriptor=opened.clean_package;
  for(const mutate of [r=>r.runtime.notes[0].start_microseconds.numerator='1',r=>r.runtime.notes[0].end_microseconds.numerator='227000188',r=>r.runtime.end_microseconds.numerator='24500024']) {
    const response=fixture('vsq-clean-v1-runtime');mutate(response);
    const song=prepareVsqPractice(prepareCleanSong(`native:song-${descriptor.content_sha256}`,descriptor,JSON.parse(opened.score_json)),response);
    assert.throws(()=>buildVsqAudioPlan(song,{sampleRate,mutedParts:['vsq-track-1']}),{code:'invalid_audio_plan'});
  }
  const song=vsqSong();for(const rate of [44100,48000,96000]) {
    const plan=buildVsqAudioPlan(song,{sampleRate:rate});
    for(const [index,note]of song.runtime.notes.entries())assert.deepEqual(plan.notes[index].slice(2,4),basicKeyGateFrames(note.start_microseconds,note.end_microseconds,rate));
    assert.ok(Math.abs(plan.durationFrames-song.runtime.end_ms*rate/1000)<1);
  }
});

test('canceling during bounded VSQ waveform validation cannot emit ready, attacks or resume', () => {
  const messages=[],core=new BasicKeyAudioCore(sampleRate,{emit:message=>messages.push(message)}),wire=createBasicKeyAudioTransfer(syntheticPlan([row('0001',0,1000)])).wire;
  core.handleMessage({type:'prepare',generation:1,positionFrame:0,wire},0);
  const block=new Float32Array(128);core.process([block],0);assert.equal(core.state,'preparing');assert.equal(core.preparePhase,-1);assert.ok(block.every(value=>value===0));
  core.handleMessage({type:'cancel',generation:2,reason:'pause'},128);core.process([block],128);assert.equal(core.state,'canceled');assert.equal(core.startedCount,0);assert.equal(messages.some(message=>message.type==='ready'),false);assert.equal(messages.at(-1).ledger,null);assert.ok(block.every(value=>value===0));
  core.handleMessage({type:'start',generation:1,anchorFrame:512},256);assert.equal(messages.at(-1).type,'stale');assert.equal(core.state,'canceled');
});

test('VSQ per-part synthetic choices preserve source identity, exact gates and both default recipes', () => {
  const song = vsqSong(), before = JSON.stringify(song), defaultPlan = buildVsqAudioPlan(song, {sampleRate});
  assert.deepEqual(buildVsqAudioPlan(song, {sampleRate, instrumentOverrides: {}}), defaultPlan);
  for (const [instrument, code] of [['sine', 1], ['triangle', 2], ['reed', 3]]) {
    const plan = buildVsqAudioPlan(song, {sampleRate, instrumentOverrides: {'vsq-track-1': instrument}});
    assert.deepEqual(plan.notes, defaultPlan.notes); assert.deepEqual(plan.timbres, [code, 0]);
    assert.equal(plan.identityKind, VSQ_AUDIO_IDENTITY); assert.equal(plan.policyId, VSQ_AUDIO_POLICY); assert.equal(plan.sourceSha256, defaultPlan.sourceSha256);
    const expected = run(defaultPlan), actual = run(plan); assert.notDeepEqual(actual.pcm, expected.pcm); assert.deepEqual(actual.completion.ledger, expected.completion.ledger);
    const onlyOther = buildVsqAudioPlan(song, {sampleRate, instrumentOverrides: {'vsq-track-1': instrument}, mutedParts: ['vsq-track-1']});
    assert.deepEqual(onlyOther, buildVsqAudioPlan(song, {sampleRate, mutedParts: ['vsq-track-1']}));
  }
  for (const [role, digest] of [[2, '63067bbd38fcd6034d03c9e5e080832993794ac48510a12afd26de91d40ffdc3'], [3, 'c6fc965bf8218ac859fb1892a7de9985bfd9fc34ab7d5c45884ce084815ce99b']]) {
    const result = run(syntheticPlan([row('0001', 0, 1000, role)]));
    assert.equal(createHash('sha256').update(Buffer.from(result.pcm.buffer)).digest('hex'), digest);
  }
  for (const instrumentOverrides of [{missing: 'sine'}, {'vsq-track-1': 'source'}, {'vsq-track-1': 'voicebank'}, null]) assert.throws(() => buildVsqAudioPlan(song, {sampleRate, instrumentOverrides}), {code: 'invalid_instrument_override'});
  assert.equal(JSON.stringify(song), before);
});

test('VSQ replacement colors validate their actual fundamental and reject altered supported selections', () => {
  const plan = syntheticPlan([row('0001', 0, 1000, 3, 127)], {timbreProfile: BASIC_KEY_TIMBRE_PROFILE, timbres: [3]});
  assert.ok(run(plan).nonzero, 'Replacing the source recipe omits source harmonics that cannot be represented');
  const wire = createBasicKeyAudioTransfer(plan).wire, messages = [], core = new BasicKeyAudioCore(sampleRate, {emit: message => messages.push(message)});
  new Uint8Array(wire.buffers.timbres)[0] = 1;
  core.handleMessage({type: 'prepare', generation: 1, positionFrame: 0, wire}, 0);
  let frame = 0; while (core.state === 'preparing') { core.process([new Float32Array(128)], frame); frame += 128; }
  assert.equal(core.state, 'error'); assert.equal(core.startedCount, 0); assert.equal(messages.at(-1).code, 'audio_timbre_fingerprint');
  assert.throws(() => syntheticPlan([row('0001', 0, 1000, 3, 127)], {sampleRate: 8000, timbreProfile: BASIC_KEY_TIMBRE_PROFILE, timbres: [3]}), {code: 'unsupported_audio_sample_rate'});
});

test('VSQ selected colors cross the real receiver transfer and reset with a fresh source preparation', async () => {
  const audio = basicKeyAudioHarness(), player = new CleanSongPlayer({getPositionMs: () => 0}), original = Object.getOwnPropertyDescriptor(globalThis, 'AudioWorkletNode');
  globalThis.AudioWorkletNode = class { constructor() { return audio.nodeFactory(); } };
  try {
    player.select(vsqSong());
    const anchor = await player.start({context: audio.context, output: audio.output, instrument: 'guitar', instrumentOverrides: {'vsq-track-1': 'triangle', 'vsq-track-2': 'reed'}});
    const core = audio.nodes.at(-1).core; assert.deepEqual([...core.plan.timbres], [2, 3]); assert.equal(core.plan.timbreProfile, BASIC_KEY_TIMBRE_PROFILE); assert.equal(core.plan.identityKind, VSQ_AUDIO_IDENTITY); assert.ok(anchor.anchorFrame > 0);
    player.stop(); await player.prepare({context: audio.context, output: audio.output}); assert.equal(audio.nodes.at(-1).core.plan.timbres, undefined);
  } finally { player.stop(); if (original) Object.defineProperty(globalThis, 'AudioWorkletNode', original); else delete globalThis.AudioWorkletNode; }
});

import assert from 'node:assert/strict';
import {buildLiveToneTriangles,LiveToneCore} from '../web/live-tone-core.js';
import {PracticeRecorder} from '../web/practice-recorder.js';
import {syntheticLiveToneEvidence,syntheticLiveToneTransport} from './live-tone-evidence-fixtures.js';

// Explicitly synthetic verifier fixtures. Production DSP accounting is real
// arithmetic, but the event/native flags, transport, assessment and analyser
// observations below are models and must never be reported as actual audio.
const banks = new Map();
export function syntheticFixture({instrument = 'piano', rate = 48000, velocity = 90, holdMs = 40, late = false, offset = 0} = {}) {
  const e = syntheticLiveToneEvidence({keyCode: 'KeyR', midi: 60});
  e.fixtureKind = 'synthetic-verifier-only';
  const call = e.calls[0], first = Math.round(1.02 * rate) + offset, releaseFrame = first + Math.ceil(holdMs * rate / 1000);
  Object.assign(call, {timbre: instrument, velocity});
  e.inputs[1].eventTime = e.inputs[0].eventTime + holdMs;
  for (const receiver of [e.ready.receiver, e.after.receiver, e.initialization.tapReady.receiver]) receiver.sampleRate = rate;
  e.initialization.ready.record.sampleRate = rate;
  e.after.receiver.audioTime = (releaseFrame + Math.ceil(.012 * rate) + 512) / rate;
  e.pcm.blocks[0].audioTime = (first + Math.ceil(holdMs * rate / 2000)) / rate;
  if (!banks.has(rate)) banks.set(rate, buildLiveToneTriangles(rate));
  const records = [], core = new LiveToneCore(rate, {emit: record => records.push(record)});
  core.handleMessage({type: 'initialize', generation: call.generation, requestId: 1, triangles: banks.get(rate)}, 0);
  core.handleMessage({type: 'play', generation: call.generation, requestId: 2, token: call.token, id: call.id,
    midi: 60, duration: null, delay: 0, timbre: instrument, velocity, atFrame: first - 10}, first);
  // Deliberately use a different block partition from the verifier. Neither
  // arithmetic nor release accounting depends on host render block alignment.
  core.process([new Float32Array(releaseFrame - first)], first);
  core.handleMessage({type: 'release', generation: call.generation, requestId: 3, token: call.token, id: call.id}, releaseFrame);
  core.process([new Float32Array(Math.ceil(.012 * rate) + 1)], releaseFrame);
  assert.equal(core.state, 'ready');
  const notes = records.filter(record => record.kind === 'note');
  assert.equal(notes.length, 2);
  e.receipts.forEach((row, index) => { row.record = notes[index]; });

  const target = {id: 'shared-c4-a', part_id: 'P1', midi: 60, start_ms: late ? 0 : 100,
    duration_ms: 1000, velocity: 90, source_note_id: 'shared-c4-a', source_note_ids: ['shared-c4-a', 'shared-c4-b'], voice: '1', staff: 1};
  const timeline = {duration_ms: 10000, notes: [target]}, recorder = new PracticeRecorder();
  recorder.begin({wallTime: late ? 100 : 1000, position: 0, startMs: 0, endMs: 10000, timeline});
  const onset = {source: 'physical-r', inputKind: 'typing_keyboard', midi: 60, velocity, encoding: 'key_down',
    eventWall: e.inputs[0].eventTime, receivedWall: e.inputs[0].eventTime + 2,
    rawTimestamp: e.inputs[0].eventTime, timestampBasis: 'event_monotonic'};
  recorder.observeOnset(onset, recorder.capture(onset));
  recorder.evidence.release({source: 'physical-r', encoding: 'key_up', eventWall: e.inputs[1].eventTime,
    receivedWall: e.inputs[1].eventTime + 2, rawTimestamp: e.inputs[1].eventTime, timestampBasis: 'event_monotonic'});
  recorder.requestAssessment(e.inputs[1].eventTime + 10, {grace: false});
  const job = recorder.submit(recorder.active), input = job.inputs[0];
  recorder.complete(job, late ? {hits: [], misses: [target.id], extras: [{...input}]} : {
    hits: [{note_id: target.id, midi: 60, expected_ms: target.start_ms, actual_ms: input.at_ms,
      delta_ms: input.at_ms - target.start_ms, grade: 'perfect'}], misses: [], extras: [],
  });
  const take = recorder.exportData();
  take.practice_selection = {kind: 'parts', part_ids: ['P1', 'P2']};
  take.target_plan = {timeline, playable: true, diagnostics: [], source_note_count: 2, target_count: 1,
    groups: [{target_id: target.id, source_occurrence_ids: ['shared-c4-a', 'shared-c4-b'],
      source_note_ids: ['shared-c4-a', 'shared-c4-b'], part_ids: ['P1', 'P2']}]};
  return structuredClone({e, options: {take, expectedInstrument: instrument, expectedPartIds: ['P1', 'P2'], expectedTargetPlan: structuredClone(take.target_plan), transport: syntheticLiveToneTransport(e)}});
}

// Append a complete, clock-consistent synthetic observer window to a synthetic
// human fixture. These invented observations exercise verifiers only; neither
// this builder nor its consumers constitute native execution/audio acceptance.
export function addSyntheticReleasedCheckpoint(e) {
  const r=e.ready.receiver,rate=r.sampleRate,end=e.receipts[1].record;
  const origin=e.inputs[0].eventTime-(end.actualStartFrame/rate-r.audioTime)*1000;
  const wall=audioTime=>origin+(audioTime-r.audioTime)*1000;
  e.fixtureKind='synthetic-verifier-only';e.pcmCoverage='finite-checkpoint-windows';
  e.ready.wallMs=origin;
  [e.initialization.created,e.initialization.ready,e.initialization.tapReady].forEach((value,index)=>{value.wallMs=origin-3+index;});
  e.inputs.forEach(value=>{value.wallMs=value.eventTime;});e.calls[0].wallMs=e.inputs[0].wallMs;
  e.receipts[0].wallMs=e.inputs[0].wallMs+1;e.receipts[1].wallMs=wall(end.actualEndFrame/rate)+1;
  for(const block of e.pcm.blocks){block.wallMs=wall(block.audioTime);block.tapConnected=true;}
  let sequence=Math.max(...[...e.inputs,...e.calls,...e.receipts,...e.pcm.blocks].map(value=>value.sequence));
  const event=audioTime=>({sequence:++sequence,wallMs:wall(audioTime),graphRevision:e.ready.graphRevision});
  const boundary=(label,audioTime)=>({...event(audioTime),label,nodes:1,source:structuredClone(e.ready.source),receiver:{...structuredClone(r),audioTime}});
  const audioTime=end.actualEndFrame/rate+.02,row={...boundary('released',audioTime),callCount:1,sampling:'sealed',pcm:{method:e.pcm.method,fftSize:16384,blocks:[]}};
  const firstQuiet=audioTime+(16384+256)/rate+.02;
  row.pcm.blocks=[audioTime,firstQuiet,firstQuiet+.06,firstQuiet+.12].map((time,index)=>({...structuredClone(e.pcm.blocks[0]),...event(time),audioTime:time,...(index?{peak:0,energy:0,nonzeroSamples:0}:{})}));
  row.closed=boundary('released-sealed',firstQuiet+.121);e.after=boundary('after',firstQuiet+.122);e.checkpoints=[row];
  e.silenceEstablished={sequence:row.pcm.blocks[1].sequence,audioTime:firstQuiet};
  return e;
}

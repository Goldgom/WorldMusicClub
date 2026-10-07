import test from 'node:test';
import assert from 'node:assert/strict';
import {BasicKeyAudioCore} from '../web/basic-key-audio-core.js';
import {BasicKeyAudioReceiver} from '../web/basic-key-audio-receiver.js';
import {buildBasicKeyAudioPlan, validateBasicKeyAudioPlan, createBasicKeyAudioTransfer, encodeBasicKeyAudioPlan, decodeBasicKeyAudioPlan} from '../web/basic-key-audio-plan.js';
import {basicKeySong} from './basic-key-rendition-fixtures.js';
import {basicKeyAudioHarness} from './basic-key-audio-harness.js';

const original = () => buildBasicKeyAudioPlan(basicKeySong(), {sampleRate: 48000});
const assisted = () => validateBasicKeyAudioPlan({...original(), assistanceFingerprint: 'a'.repeat(64)});

test('assistance wire binds selection and exact machine gates without altering original plans', () => {
  const source = original(), plan = assisted(), plain = createBasicKeyAudioTransfer(source).wire, packed = createBasicKeyAudioTransfer(plan).wire;
  assert.equal(plain.assistanceFingerprint, undefined); assert.equal(plain.assistancePlanFingerprint, undefined);
  assert.deepEqual(plan.notes, source.notes); assert.equal(plan.durationFrames, source.durationFrames);
  assert.deepEqual(decodeBasicKeyAudioPlan(encodeBasicKeyAudioPlan(plan)), plan);
  assert.match(packed.assistancePlanFingerprint, /^[a-f0-9]{64}$/);
  assert.notEqual(createBasicKeyAudioTransfer(validateBasicKeyAudioPlan({...plan, assistanceFingerprint: 'b'.repeat(64)})).wire.assistancePlanFingerprint, packed.assistancePlanFingerprint);
  assert.notEqual(createBasicKeyAudioTransfer(validateBasicKeyAudioPlan({...plan, notes: plan.notes.slice(1)})).wire.assistancePlanFingerprint, packed.assistancePlanFingerprint);
  for (const assistanceFingerprint of [null, '', 'f'.repeat(63), 123]) assert.throws(() => validateBasicKeyAudioPlan({...source, assistanceFingerprint}), {code: 'invalid_audio_plan'});
});

test('bounded worklet preparation rejects gate changes and stripped assistance fields', () => {
  for (const change of [wire => new Uint8Array(wire.buffers.keys)[0]++, wire => new Float64Array(wire.buffers.ends)[0]++, wire => { delete wire.assistanceFingerprint; delete wire.assistancePlanFingerprint; }]) {
    const wire = createBasicKeyAudioTransfer(assisted()).wire, messages = [], core = new BasicKeyAudioCore(48000, {emit: message => messages.push(message)});
    const command = {type: 'prepare', generation: 1, positionFrame: 0, wire, expectedAssistanceFingerprint: wire.assistanceFingerprint, expectedAssistancePlanFingerprint: wire.assistancePlanFingerprint};
    change(wire); core.handleMessage(command, 0);
    for (let frame = 0; core.state === 'preparing'; frame += 128) core.process([new Float32Array(128)], frame);
    assert.equal(core.state, 'error'); assert.equal(core.startedCount, 0); assert.equal(messages.at(-1).code, 'audio_assistance_fingerprint');
  }
});

for (const stage of ['ready', 'started', 'canceled']) test(`receiver rejects foreign assistance on ${stage} acknowledgements`, async () => {
  const h = basicKeyAudioHarness({autoMessages: false}), errors = [], receiver = await BasicKeyAudioReceiver.create(h.context, h.output, {nodeFactory: h.nodeFactory, onError: error => errors.push(error)});
  try {
    let pending = receiver.prepare(assisted());
    if (stage === 'ready') {
      const rejected = assert.rejects(pending, {code: 'audio_assistance_fingerprint'});
      h.deliverCore(); h.finishPreparation(); h.toMain.find(([, m]) => m.type === 'ready')[1].assistanceFingerprint = 'b'.repeat(64); h.deliverMain(); await rejected;
    } else {
      h.deliverCore(); h.finishPreparation(); h.deliverMain(); await pending;
      if (stage === 'started') {
        pending = receiver.start(); const rejected = assert.rejects(pending, {code: 'audio_assistance_fingerprint'});
        h.deliverCore(); delete h.toMain.find(([, m]) => m.type === 'started')[1].assistancePlanFingerprint; h.deliverMain(); await rejected;
      } else {
        receiver.dispose(); h.deliverCore(); h.toMain.find(([, m]) => m.type === 'canceled')[1].assistanceFingerprint = 'b'.repeat(64); h.deliverMain();
        assert.equal(receiver.lastCompletion, null); assert.equal(receiver.disposed, true);
      }
    }
    assert.equal(errors.at(-1).code, 'audio_assistance_fingerprint'); assert.equal(receiver.outputGate.gain.value, 0);
  } finally { receiver.dispose(); h.deliverCore(); h.deliverMain(); }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { PracticeModel, EXERCISE, DEGREES, OPEN_STRINGS, pitchName, formatTime } from '../model.js';

function fixture() { let now = 0; const model = new PracticeModel(() => now); return { model, advance: ms => { now += ms; } }; }
test('all original melody targets match the declared playable guitar route', () => {
  assert.equal(EXERCISE.length, 32);
  assert.equal(new Set(EXERCISE.map(note => note.id)).size, 32);
  for (const note of EXERCISE) {
    assert.equal(OPEN_STRINGS[note.string - 1] + note.fret, note.pitch);
    assert.equal(pitchName(note.pitch), note.name);
    assert.equal(note.beat, EXERCISE.indexOf(note));
    assert.equal(note.measure, Math.floor(note.beat / 4) + 1);
  }
  assert.equal(DEGREES.map(note => note.degree).join(''), '1234567');
});
test('pauses freeze position and resume does not include paused time', () => {
  const { model, advance } = fixture(); model.play(); advance(1250);
  assert.equal(model.snapshot().position, 2); assert.equal(model.snapshot().note.degree, 3);
  model.pause(); advance(100000); assert.equal(model.snapshot().position, 2);
  model.play(); advance(625); assert.equal(model.snapshot().position, 3);
});
test('repeated play does not reset the clock', () => {
  const { model, advance } = fixture(); model.play(); advance(625); model.play(); advance(625);
  assert.equal(model.snapshot().position, 2);
});
test('tempo changes preserve musical position and apply to later elapsed time', () => {
  const { model, advance } = fixture(); model.play(); advance(1250); model.setTempo(60);
  assert.equal(model.snapshot().position, 2); advance(1000); assert.equal(model.snapshot().position, 3);
  model.setTempo(NaN); assert.equal(model.bpm, 60); model.setTempo(999); assert.equal(model.bpm, 140);
});
test('seeking updates exact current note and keeps paused state', () => {
  const { model } = fixture(); model.play(); model.pause(); model.seek(16);
  assert.equal(model.snapshot().index, 16); assert.equal(model.snapshot().measure, 5);
  assert.equal(model.status, 'paused'); model.seek(-3); assert.equal(model.snapshot().position, 0);
  model.seek(NaN); assert.equal(model.snapshot().position, 0);
});
test('completion stays bounded, replay resets inputs, seeking reopens a paused round', () => {
  const { model, advance } = fixture(); model.play(); model.input(60, 'keyboard'); advance(100000);
  assert.equal(model.snapshot().status, 'finished'); assert.equal(model.snapshot().progress, 1);
  model.seek(8); assert.equal(model.status, 'paused'); model.seek(32); model.play();
  assert.equal(model.snapshot().position, 0); assert.equal(model.inputCount, 0);
});
test('free practice counts actual inputs, never invents targets or score', () => {
  const { model, advance } = fixture(); model.reset('free');
  assert.equal(model.input(60, 'keyboard'), false); model.play(); advance(90000);
  assert.equal(model.snapshot().seconds, 90); assert.equal(model.snapshot().status, 'playing');
  assert.equal(model.snapshot().note, null); assert.equal(model.input(60, 'keyboard'), true);
  assert.equal(model.input(128, 'keyboard'), false); assert.equal(model.inputCount, 1);
  assert.equal('score' in model.snapshot(), false); model.pause(); assert.equal(model.input(62, 'pointer'), false);
});
test('recent inputs are bounded while the lifetime count remains honest', () => {
  const { model } = fixture(); model.reset('free'); model.play();
  for (let n = 0; n < 70; n++) model.input(60 + n % 7, 'keyboard');
  assert.equal(model.inputs.length, 32); assert.equal(model.inputCount, 70);
  model.reset(); assert.equal(model.mode, 'free'); assert.equal(model.inputs.length, 0);
});
test('inputs arriving after the guided exercise ends do not extend its input count', () => {
  const { model, advance } = fixture(); model.play(); advance(21000);
  assert.equal(model.input(60, 'keyboard'), false); assert.equal(model.status, 'finished');
  assert.equal(model.inputCount, 0);
});
test('time display is bounded and uses minutes', () => {
  assert.equal(formatTime(-1), '0:00'); assert.equal(formatTime(61.9), '1:01');
});

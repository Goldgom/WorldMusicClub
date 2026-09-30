import {parsePitch} from './image-review.js';
import {pitchMidi} from './music.js';
export const STANDARD_TUNING = Object.freeze([64, 59, 55, 50, 45, 40]);
export function parseTuning(value) {
  const pitches = String(value).trim().split(/[\s,]+/).filter(Boolean);
  if (!pitches.length || pitches.length > 12) throw new Error('Enter 1–12 string pitches in order, for example E4 B3 G3 D3 A2 E2.');
  return pitches.map(text => pitchMidi(parsePitch(text)));
}
export function guitarProfile(tuningText, fretsValue, capoValue) {
  const tuning = parseTuning(tuningText); const frets = Number(fretsValue); const capo = Number(capoValue);
  if (![frets, capo].every(Number.isInteger) || frets < 0 || frets > 36 || capo < 0 || capo > frets || tuning.some(midi => midi + frets > 127)) throw new Error('Use 0–36 physical frets and a capo from 0 to the last fret. Tuned pitches plus frets must stay within MIDI 0–127.');
  return {kind:'guitar',tuning,frets,capo};
}
export function pianoProfile(countValue, lowestText) {
  const key_count = Number(countValue); const lowest_midi = pitchMidi(parsePitch(lowestText));
  if (!Number.isInteger(key_count) || key_count < 12 || key_count > 128 || lowest_midi + key_count - 1 > 127) throw new Error('Choose 12–128 keys and a starting pitch that keeps the highest key within MIDI 127.');
  return {kind:'piano',key_count,lowest_midi};
}

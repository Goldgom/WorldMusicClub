import {parsePitch} from './image-review.js';
import {pitchMidi} from './music.js';
const profileError=(code,message)=>Object.assign(new Error(message),{code});
export const STANDARD_TUNING = Object.freeze([64, 59, 55, 50, 45, 40]);
export function parseTuning(value) {
  const pitches = String(value).trim().split(/[\s,]+/).filter(Boolean);
  if (!pitches.length || pitches.length > 12) throw profileError('instrument_tuning_count','Enter 1–12 string pitches in order, for example E4 B3 G3 D3 A2 E2.');
  return pitches.map(text => {try{return pitchMidi(parsePitch(text))}catch(error){throw profileError('instrument_tuning_pitch',error.message)}});
}
export function guitarProfile(tuningText, fretsValue, capoValue) {
  const tuning = parseTuning(tuningText); const frets = Number(fretsValue); const capo = Number(capoValue);
  if (![frets, capo].every(Number.isInteger) || frets < 0 || frets > 36 || capo < 0 || capo > frets || tuning.some(midi => midi + frets > 127)) throw profileError('instrument_guitar_range','Use 0–36 physical frets and a capo from 0 to the last fret. Tuned pitches plus frets must stay within MIDI 0–127.');
  return {kind:'guitar',tuning,frets,capo};
}
export function pianoProfile(countValue, lowestText) {
  const key_count = Number(countValue); let lowest_midi;try{lowest_midi=pitchMidi(parsePitch(lowestText))}catch(error){throw profileError('instrument_piano_pitch',error.message)}
  if (!Number.isInteger(key_count) || key_count < 12 || key_count > 128 || lowest_midi + key_count - 1 > 127) throw profileError('instrument_piano_range','Choose 12–128 keys and a starting pitch that keeps the highest key within MIDI 127.');
  return {kind:'piano',key_count,lowest_midi};
}
/** Practice admission is conservative; listening never changes or drops source notes. */
export function compatibilityStatus(report, targets) {
  if (!report || !Array.isArray(report.note_options) || !Array.isArray(report.diagnostics) || report.changed_source_notes === true) return {status:'error',reasonCode:'instrument_report_incomplete',reasonParams:{},reason:'The instrument report is incomplete or changed source notes. Recheck the setup before scoring.'};
  const expected = new Set(targets.map(note => note.id));
  if (report.note_options.length !== targets.length || report.note_options.some(note => !expected.has(note.note_id) || typeof note.playable !== 'boolean') || new Set(report.note_options.map(note=>note.note_id)).size !== targets.length) return {status:'error',reasonCode:'instrument_report_coverage',reasonParams:{},reason:'The instrument report does not cover every selected target. Recheck the setup before scoring.'};
  if (!targets.length) return {status:'blocked',reasonCode:'instrument_no_targets',reasonParams:{},reason:'This selection has no sounding note-on targets. Choose a part or loop containing notes.'};
  const outside = report.note_options.filter(note=>!note.playable).length;
  const conflict = report.diagnostics.some(item=>item.code==='guitar_string_conflict');
  if (outside || conflict) return {status:'blocked',reasonCode:'instrument_unplayable',reasonParams:{outside,conflict},reason:`${outside ? `${outside} selected notes cannot be played in this instrument range. ` : ''}${conflict ? 'Some simultaneous notes cannot be assigned to distinct guitar strings. ' : ''}Change the range, tuning, part or loop before practicing.`};
  return {status:'ready',reasonCode:'instrument_ready',reasonParams:{},reason:'Every selected pitch has an instrument position. Guitar positions remain fingering candidates; hand reach and sustained overlaps require review.'};
}

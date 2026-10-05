/** Stable display identities; original diagnostics and numeric values remain unchanged. */
export const PRACTICE_SETTING_MESSAGE_KEYS = Object.freeze({
  latency_storage_read_failed: 'preferences.latency.storageUnavailable',
  latency_preference_invalid: 'preferences.latency.invalidSaved',
  latency_offset_invalid: 'preferences.latency.invalid',
  latency_input_invalid: 'preferences.latency.invalidInput',
  latency_storage_write_failed: 'preferences.latency.unsaved',
  practice_beat_syntax: 'preferences.beat.syntax',
  practice_beat_range: 'preferences.beat.range',
});
const preferenceError = (code, message) => Object.assign(new Error(message), {code});
const resolveStorage = storage => typeof storage === 'function' ? storage() : storage;

export function validLatency(value) { if(typeof value!=='number'&&typeof value!=='string')return false;const ms = Number(value); return String(value).trim() !== '' && Number.isFinite(ms) && Number.isInteger(ms) && ms >= -500 && ms <= 500; }
export function compensateInput(atMs, offsetMs) {
  if (!Number.isFinite(atMs) || !validLatency(offsetMs)) throw preferenceError('latency_input_invalid','Input time and latency offset must be finite; offset must be a whole number from −500 to 500 ms.');
  return atMs - Number(offsetMs);
}
export function readLatencyPreference({storage = () => globalThis.localStorage} = {}) {
  let stored;try{stored=resolveStorage(storage).getItem('worldmusichub.latency')}catch{return{value:0,code:'latency_storage_read_failed',message:'Latency starts at 0 ms. Browser storage is unavailable; changes apply to this tab.'}}
  if(stored===null)return{value:0,message:''};
  try{const value=JSON.parse(stored);if(validLatency(value))return{value:Number(value),message:''}}catch{/* An unreadable preference must not become a calibration offset. */}
  return{value:0,code:'latency_preference_invalid',message:'Saved latency was invalid and was not applied. Offset starts at 0 ms; enter a reviewed value to replace it.'};
}
export function loadLatency(options) { return readLatencyPreference(options).value; }
/** Detailed result for display owners; saveLatency retains its existing boolean API. */
export function writeLatencyPreference(value, {storage = () => globalThis.localStorage} = {}) {
  if (!validLatency(value)) return {saved:false,code:'latency_offset_invalid',message:'Enter a whole-number latency offset from −500 to 500 ms.'};
  try { resolveStorage(storage).setItem('worldmusichub.latency', JSON.stringify(Number(value)));return {saved:true,message:''}; }
  catch { return {saved:false,code:'latency_storage_write_failed',message:'Latency applies to this tab but could not be saved in browser storage.'}; }
}
export function saveLatency(value, options) { return writeLatencyPreference(value, options).saved; }
export function parseBeatInput(value) {
  const text = String(value).trim();
  let numerator, denominator;
  if (/^\d+\/\d+$/.test(text)) [numerator, denominator] = text.split('/').map(Number);
  else if (/^\d+(?:\.\d{1,6})?$/.test(text)) { const [whole, fraction = ''] = text.split('.'); denominator = 10 ** fraction.length; numerator = Number(whole) * denominator + Number(fraction || 0); }
  else throw preferenceError('practice_beat_syntax','Use a non-negative beat number such as 0, 4, 1.5 or 3/2.');
  if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator) || numerator > 1e9 || denominator < 1 || denominator > 1e6) throw preferenceError('practice_beat_range','Beat value is outside the supported rational range.');
  return {numerator, denominator};
}
export function windowNotes(notes, startMs, endMs) {
  return notes.filter(note => note.start_ms < endMs && note.start_ms + note.duration_ms > startMs).map(note => ({...note, start_ms: Math.max(startMs, note.start_ms), duration_ms: Math.min(endMs, note.start_ms + note.duration_ms) - Math.max(startMs, note.start_ms)}));
}
/** Select canonical part/occurrence IDs without changing note timing or source Score. */
export function practiceScope(timeline, partId = null, loop = null) {
  let includes;
  if (partId !== null && typeof partId === 'object') {
    if (!['all','parts'].includes(partId.kind) || !Array.isArray(partId.part_ids) || !partId.part_ids.length || partId.part_ids.some(id => typeof id !== 'string' || !id) || new Set(partId.part_ids).size !== partId.part_ids.length) throw new TypeError('Resolve the explicit human practice selection against its source parts first.');
    const ids = new Set(partId.part_ids);
    if (partId.kind === 'all' && timeline.notes.some(note => !ids.has(note.part_id))) throw new TypeError('The complete human selection does not cover every source part.');
    includes = note => ids.has(note.part_id);
  } else includes = note => partId === null || note.part_id === partId;
  const notes = timeline.notes.filter(includes);
  const selected = {...timeline, notes};
  const ids = new Set(notes.map(note => note.id));
  const targetIds = loop ? new Set(loop.target_note_ids.filter(id => ids.has(id))) : ids;
  return {
    selected,
    targets: {...timeline, notes: loop ? notes.filter(note => targetIds.has(note.id)) : notes},
    targetIds,
    playbackNotes: loop ? windowNotes(notes, loop.start_ms, loop.end_ms) : notes
  };
}

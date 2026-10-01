export function validLatency(value) { if(typeof value!=='number'&&typeof value!=='string')return false;const ms = Number(value); return String(value).trim() !== '' && Number.isFinite(ms) && Number.isInteger(ms) && ms >= -500 && ms <= 500; }
export function compensateInput(atMs, offsetMs) {
  if (!Number.isFinite(atMs) || !validLatency(offsetMs)) throw new Error('Input time and latency offset must be finite; offset must be a whole number from −500 to 500 ms.');
  return atMs - Number(offsetMs);
}
export function readLatencyPreference() {
  let stored;try{stored=localStorage.getItem('worldmusichub.latency')}catch{return{value:0,message:'Latency starts at 0 ms. Browser storage is unavailable; changes apply to this tab.'}}
  if(stored===null)return{value:0,message:''};
  try{const value=JSON.parse(stored);if(validLatency(value))return{value:Number(value),message:''}}catch{/* An unreadable preference must not become a calibration offset. */}
  return{value:0,message:'Saved latency was invalid and was not applied. Offset starts at 0 ms; enter a reviewed value to replace it.'};
}
export function loadLatency() { return readLatencyPreference().value; }
export function saveLatency(value) { if (!validLatency(value)) return false; try { localStorage.setItem('worldmusichub.latency', JSON.stringify(Number(value)));return true; } catch { return false; } }
export function parseBeatInput(value) {
  const text = String(value).trim();
  let numerator, denominator;
  if (/^\d+\/\d+$/.test(text)) [numerator, denominator] = text.split('/').map(Number);
  else if (/^\d+(?:\.\d{1,6})?$/.test(text)) { const [whole, fraction = ''] = text.split('.'); denominator = 10 ** fraction.length; numerator = Number(whole) * denominator + Number(fraction || 0); }
  else throw new Error('Use a non-negative beat number such as 0, 4, 1.5 or 3/2.');
  if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator) || numerator > 1e9 || denominator < 1 || denominator > 1e6) throw new Error('Beat value is outside the supported rational range.');
  return {numerator, denominator};
}
export function windowNotes(notes, startMs, endMs) {
  return notes.filter(note => note.start_ms < endMs && note.start_ms + note.duration_ms > startMs).map(note => ({...note, start_ms: Math.max(startMs, note.start_ms), duration_ms: Math.min(endMs, note.start_ms + note.duration_ms) - Math.max(startMs, note.start_ms)}));
}
/** Select canonical part/occurrence IDs without changing note timing or source Score. */
export function practiceScope(timeline, partId = null, loop = null) {
  const notes = partId === null ? timeline.notes : timeline.notes.filter(note => note.part_id === partId);
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

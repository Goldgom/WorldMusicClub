/** Admission of a native-validated package. Portable paths never become browser URLs. */
const prepared = new WeakSet();
const hash = /^[0-9a-f]{64}$/;
const roles = new Set(['cover','background','pv','full_mix','stem']);
export class CleanSongError extends Error {
  constructor(code, message, detail = {}) { super(message); this.name='CleanSongError';this.code=code;this.detail=detail; }
}
const fail = message => { throw new CleanSongError('clean_package_invalid',message); };
const stable = value => JSON.stringify(value, (_, item) => item && !Array.isArray(item) && typeof item === 'object' ? Object.fromEntries(Object.entries(item).sort(([a],[b])=>a.localeCompare(b))) : item);
function freeze(value) { if(value&&typeof value==='object'){Object.freeze(value);for(const item of Object.values(value))freeze(item);}return value; }
export function isCleanSong(value) { return prepared.has(value); }
export function prepareCleanSong(libraryKey, descriptor, normalizedScore) {
  if (!descriptor || descriptor.version!==2 || !hash.test(descriptor.content_sha256) || libraryKey!==`native:song-${descriptor.content_sha256}`) fail('The clean song does not match the selected saved package.');
  let metadata, score;
  try { metadata=JSON.parse(descriptor.metadata_json);score=JSON.parse(descriptor.score_json); } catch { fail('The package metadata or complete score is unreadable.'); }
  const runtime=descriptor.runtime;
  if(metadata?.format!=='worldmusichub-song'||metadata.version!==2||score?.format!=='worldmusichub-complete-score'||score.version!==1||score.performance?.profile!=='wmh-semantic-midi1-v1'||!runtime?.compilation?.timeline||!Array.isArray(runtime.events)||!Array.isArray(runtime.notes))fail('The native complete-song contract is missing.');
  if(!normalizedScore||normalizedScore.source!=null||score.notation?.source!=null||normalizedScore.id!==metadata.id||normalizedScore.title!==metadata.title||score.notation.id!==normalizedScore.id||score.notation.title!==normalizedScore.title||stable(runtime.compilation.score)!==stable(normalizedScore))fail('Canonical notation and complete performance are not the same validated score.');
  if(!Number.isFinite(runtime.duration_ms)||runtime.duration_ms<=0||runtime.compilation.timeline.duration_ms!==runtime.duration_ms)fail('The complete performance clock is invalid.');
  const parts=new Map(score.performance.parts.map(part=>[part.id,part]));
  const tracks=new Set(score.performance.tracks.map(track=>track.id));
  if(!parts.size||parts.size!==score.performance.parts.length||normalizedScore.parts.some(part=>!parts.has(part.id))||parts.size!==normalizedScore.parts.length)fail('The complete performance does not cover every notation part.');
  const ids=new Set();
  for(const note of runtime.notes){const part=parts.get(note.part_id);if(!part||!tracks.has(note.track_id)||part.track_id!==note.track_id||part.channel!==note.channel||!Number.isInteger(note.key)||note.key<0||note.key>127||!Number.isFinite(note.start_ms)||!Number.isFinite(note.end_ms)||note.start_ms<0||note.end_ms<=note.start_ms||note.end_ms>runtime.duration_ms+0.001||typeof note.event_id!=='string'||ids.has(note.event_id))fail('A complete performance note has invalid identity or timing.');ids.add(note.event_id);}
  const expected=new Map(score.performance.notes.map(note=>[note.note_id,note]));
  if(expected.size!==runtime.notes.length||runtime.notes.some(note=>expected.get(note.note_id)?.part_id!==note.part_id))fail('The runtime does not retain all complete score notes.');
  const media=descriptor.media||[];
  if(!Array.isArray(media)||media.length!==(metadata.media||[]).length)fail('The media descriptor is incomplete.');
  const mediaIds=new Set();
  for(const item of media){const source=metadata.media.find(asset=>asset.id===item.id);if(!source||mediaIds.has(item.id)||!roles.has(item.role)||source.role!==item.role||source.mime!==item.mime||source.bytes!==item.bytes||source.sha256!==item.sha256||!hash.test(item.sha256)||!/^asset-[0-9a-f]{64}$/.test(item.handle)||!Number.isSafeInteger(item.bytes)||item.bytes<=0||Object.keys(item).some(key=>['path','url','data','base64'].includes(key)))fail('Media identity is not bound to a validated opaque handle.');mediaIds.add(item.id);}
  // Native serde may add nullable defaults omitted in exact portable JSON.
  score.notation=structuredClone(normalizedScore);
  const result=freeze({libraryKey,identity:descriptor.content_sha256,metadata,score,media:structuredClone(media),runtime:structuredClone(runtime)});
  prepared.add(result);return result;
}

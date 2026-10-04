import {pitchMidi} from './music.js';
import {loadCleanPerformance} from './clean-performance-player.js';
import {BASIC_KEY_RUNTIME_PROFILE,validateBasicKeyRendition} from './basic-key-rendition.js';
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
export const PERFORMANCE_PROFILE='wmh-performance-midi1-v1';
export function isPerformanceSummary(value) {
  const coverage=value?.coverage;
  return value?.version===2&&value.profile===PERFORMANCE_PROFILE&&hash.test(value.content_sha256)&&value.notation_available===false&&coverage?.performance?.status==='complete'&&Number.isSafeInteger(coverage.performance.source_tracks)&&coverage.performance.source_tracks>0&&coverage.notation?.status==='unavailable'&&coverage.notation.represented_attacks===0&&coverage.targets?.status==='unavailable'&&coverage.targets.represented_attacks===0;
}
export function isPerformanceSong(value) { return isCleanSong(value)&&value.profile===PERFORMANCE_PROFILE; }
export const BASIC_KEYS_PROFILE='wmh-basic-keys-midi1-v1';
export const BASIC_KEYS_RUNTIME_PROFILE='wmh-basic-key-practice-v1';
const basicCoverageKeys=['source_tracks','source_events','represented_events','key_attacks','key_releases','determined_ends','zero_length_attacks','unresolved_ends','unmatched_releases','notation_notes','projected_melodic_targets','unresolved_route_ends'];
export function isBasicKeysSummary(value) {
  const c=value?.coverage;
  return value?.version===2&&value.profile===BASIC_KEYS_PROFILE&&hash.test(value.content_sha256)&&value.notation_available===true&&c&&basicCoverageKeys.every(key=>Number.isSafeInteger(c[key])&&c[key]>=0)&&c.source_events===c.represented_events&&c.determined_ends+c.unresolved_ends===c.key_attacks&&c.notation_notes+c.zero_length_attacks===c.determined_ends;
}
export function isBasicKeysSong(value) { return isCleanSong(value)&&value.profile===BASIC_KEYS_PROFILE; }
export function hasBasicKeyRendition(value) { return isBasicKeysSong(value)&&value.runtime.profile===BASIC_KEY_RUNTIME_PROFILE&&Boolean(value.runtime.rendition); }
const basicPartInventories=new WeakMap();
/** Display coverage includes every retained attack, even when timed practice is unavailable. */
export function basicKeysParts(song) {
  if(!isBasicKeysSong(song))return [];
  if(basicPartInventories.has(song))return basicPartInventories.get(song);
  const tracks=new Map(song.score.performance.tracks.map(track=>[track.id,track]));
  const targets=new Map();for(const note of song.compilation?.timeline.notes||[])targets.set(note.part_id,(targets.get(note.part_id)||0)+1);
  const result=song.score.performance.parts.map(part=>{
    const inventory=song.runtime.parts.find(item=>item.id===part.id);
    return {...part,...inventory,name:song.notation.parts.find(item=>item.id===part.id)?.name||part.id,track_name:tracks.get(part.track_id)?.name||part.track_id,practice_targets:targets.get(part.id)||0,practice_available:hasBasicKeyRendition(song)?(targets.get(part.id)||0)>0:Boolean(song.compilation)&&!inventory.percussion&&inventory.positive>0};
  });
  basicPartInventories.set(song,freeze(result));return result;
}
export const VSQ_PROFILE='wmh-vsq-clean-v1';
export const VSQ_PRACTICE_PROFILE='wmh-vsq-base-note-practice-v1';
export const VSQ_LIMITS=Object.freeze(['whole_vocal_rendering_unavailable','practice_uses_authored_base_notes_only','pitch_bend_and_sensitivity_not_rendered','vibrato_and_expression_not_rendered','lyrics_and_phonetics_not_synthesized','source_voice_program_is_descriptor_not_general_midi','mixer_gain_pan_and_output_mode_not_interpreted','engine_dispatch_timing_and_acoustic_tails_not_rendered']);
export function isVsqSummary(value) { return value?.version===2&&value.profile===VSQ_PROFILE&&hash.test(value.content_sha256)&&value.capabilities?.whole_vocal_rendering==='blocked'&&value.capabilities?.instrumental_practice==='requires_explicit_base_note_choice'&&stable(value.interpretation_limits)===stable(VSQ_LIMITS); }
export function isCleanSong(value) { return prepared.has(value); }
export function isVsqSong(value) { return isCleanSong(value)&&value.profile===VSQ_PROFILE; }
function admitted(value) {const result=freeze(value);prepared.add(result);return result;}

export function prepareCleanSong(libraryKey, descriptor, normalizedScore) {
  if (!descriptor || descriptor.version!==2 || !hash.test(descriptor.content_sha256) || libraryKey!==`native:song-${descriptor.content_sha256}`) fail('The clean song does not match the selected saved package.');
  let metadata, score;
  try { metadata=JSON.parse(descriptor.metadata_json);score=JSON.parse(descriptor.score_json); } catch { fail('The package metadata or complete score is unreadable.'); }
  const runtime=descriptor.runtime;
  if(descriptor.profile===BASIC_KEYS_PROFILE||score?.performance?.profile===BASIC_KEYS_PROFILE){
    normalizedScore??=score.notation;
    if(!isBasicKeysSummary(descriptor)||score.performance?.profile!==BASIC_KEYS_PROFILE||score.profile!==undefined||metadata?.format!=='worldmusichub-song'||metadata.version!==2||score.format!=='worldmusichub-complete-score'||score.version!==1||!normalizedScore||normalizedScore.source!=null||normalizedScore.id!==metadata.id||normalizedScore.title!==metadata.title||stable(score.notation)!==stable(normalizedScore)||stable(score.coverage)!==stable(descriptor.coverage)||stable(score.capabilities)!==stable(descriptor.capabilities)||!hash.test(score.source?.sha256)||metadata.sources?.length!==1||stable(metadata.sources[0])!==stable(score.source)||!Array.isArray(score.performance.tracks)||!Array.isArray(score.performance.parts)||!Array.isArray(descriptor.media)||descriptor.media.length||metadata.media?.length)fail('The native basic-key package identity, coverage or projection is inconsistent.');
    const parts=new Set(normalizedScore.parts.map(part=>part.id));
    if(parts.size!==normalizedScore.parts.length||score.performance.parts.length!==parts.size||score.performance.parts.some(part=>!parts.has(part.id))||score.performance.tracks.reduce((sum,track)=>sum+track.events.length,0)!==score.coverage.source_events)fail('The basic-key package does not retain every part, event or attack.');
    const renditionV2=runtime?.profile===BASIC_KEY_RUNTIME_PROFILE;
    if(![BASIC_KEYS_RUNTIME_PROFILE,BASIC_KEY_RUNTIME_PROFILE].includes(runtime?.profile)||runtime.source_sha256!==score.source.sha256||runtime.reference_audio!==(renditionV2?'basic_synthesized':'unavailable')||runtime.source_rendition!=='unresolved'||!Object.hasOwn(runtime,'compilation')||!Array.isArray(runtime.parts)||runtime.parts.length!==parts.size)fail('The native basic-key runtime is missing or belongs to another source.');
    const seenParts=new Set();
    for(const item of runtime.parts){const part=score.performance.parts.find(part=>part.id===item.id),written=normalizedScore.parts.find(part=>part.id===item.id);if(!part||seenParts.has(item.id)||['attacks','positive','instantaneous','unresolved'].some(key=>!Number.isSafeInteger(item[key])||item[key]<0)||item.attacks!==item.positive+item.instantaneous+item.unresolved||written.notes.length!==item.positive||item.percussion!==(part.key_semantics==='channel10_key_number_percussion_unresolved')||(item.attacks>0?(!Array.isArray(item.range)||item.range.length!==2||item.range.some(key=>!Number.isInteger(key)||key<0||key>127)||item.range[0]>item.range[1]):item.range!==null))fail('The native basic-key part coverage is inconsistent.');seenParts.add(item.id);}
    for(const [total,field] of [['key_attacks','attacks'],['notation_notes','positive'],['zero_length_attacks','instantaneous'],['unresolved_ends','unresolved']])if(runtime.parts.reduce((sum,part)=>sum+part[field],0)!==score.coverage[total])fail('The native part inventory disagrees with source coverage.');
    const compilation=runtime.compilation;
    if(renditionV2){
      if(!Array.isArray(compilation?.diagnostics))fail('The complete basic-key runtime omits its interpretation diagnostics.');
      validateBasicKeyRendition(score,runtime,fail);
    }else if(compilation!==null){
      if(!score.performance.timing.relative_clock_available||!Array.isArray(compilation.timeline?.notes)||!Array.isArray(compilation.diagnostics)||!Number.isFinite(compilation.timeline.duration_ms)||compilation.timeline.duration_ms<0)fail('The basic-key practice clock is inconsistent.');
      const melodic=new Set(score.performance.parts.filter(part=>part.key_semantics==='midi_key_number').map(part=>part.id)),expected=new Map(normalizedScore.parts.filter(part=>melodic.has(part.id)).flatMap(part=>part.notes.filter(note=>note.pitch).map(note=>[note.id,{...note,part_id:part.id}]))),seen=new Set();
      if(compilation.timeline.notes.length!==expected.size)fail('The native basic-key targets omit or add determined melodic keys.');
      for(const target of compilation.timeline.notes){const note=expected.get(target.id);if(!note||seen.has(target.id)||target.source_note_id!==note.id||stable(target.source_note_ids)!==stable([note.id])||target.part_id!==note.part_id||target.midi!==pitchMidi(note.pitch)||target.velocity!==note.velocity||!Number.isFinite(target.start_ms)||target.start_ms<0||!Number.isFinite(target.duration_ms)||target.duration_ms<=0||target.start_ms+target.duration_ms>compilation.timeline.duration_ms+0.001)fail('A basic-key target has unsupported identity, pitch or timing.');seen.add(target.id);}
    }else if(score.performance.timing.relative_clock_available)fail('The native basic-key runtime omits an available practice clock.');
    const admittedRuntime=structuredClone(runtime),notation=structuredClone(normalizedScore);
    if(admittedRuntime.compilation)admittedRuntime.compilation.score=notation;
    score.notation=notation;
    return admitted({libraryKey,identity:descriptor.content_sha256,profile:BASIC_KEYS_PROFILE,metadata,score,notation,metadata_json:descriptor.metadata_json,score_json:descriptor.score_json,capabilities:structuredClone(descriptor.capabilities),coverage:structuredClone(score.coverage),media:[],runtime:admittedRuntime,compilation:admittedRuntime.compilation});
  }
  if(descriptor.profile===VSQ_PROFILE||score?.profile===VSQ_PROFILE){
    if(!isVsqSummary(descriptor)||score.profile!==VSQ_PROFILE||metadata?.format!=='worldmusichub-song'||metadata.version!==2||score.format!=='worldmusichub-complete-score'||score.version!==1||runtime!==null||!normalizedScore||normalizedScore.source!=null||score.notation?.source!=null||normalizedScore.id!==metadata.id||normalizedScore.title!==metadata.title||score.notation.id!==normalizedScore.id||score.notation.title!==normalizedScore.title||stable(score.notation.keys)!==stable(normalizedScore.keys)||!Array.isArray(score.authoring?.tracks)||!Array.isArray(normalizedScore.parts)||!normalizedScore.parts.length||!hash.test(score.source?.sha256)||stable(score.capabilities)!==stable(descriptor.capabilities)||stable(score.interpretation_limits)!==stable(VSQ_LIMITS)||!Array.isArray(descriptor.media)||descriptor.media.length||metadata.media?.length)fail('The native VSQ package contract is missing or inconsistent.');
    const parts=new Set(normalizedScore.parts.map(part=>part.id));
    if(parts.size!==normalizedScore.parts.length||score.authoring.tracks.length!==parts.size||score.authoring.tracks.some(track=>!parts.has(`vsq-track-${track.source_track_index}`)))fail('The VSQ package does not retain every authored part.');
    // Parsed authoring is display-only: exact integers can exceed JS safe integer range.
    // Only these original strings may be used for a portable package or export.
    return admitted({libraryKey,identity:descriptor.content_sha256,profile:VSQ_PROFILE,metadata,score,notation:structuredClone(normalizedScore),metadata_json:descriptor.metadata_json,score_json:descriptor.score_json,capabilities:structuredClone(descriptor.capabilities),interpretation_limits:[...descriptor.interpretation_limits],media:[],runtime:null,compilation:null});
  }
  if(descriptor.profile&&descriptor.profile!=='wmh-semantic-midi1-v1'||score?.profile)fail('Unknown complete-song profile.');
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
  const admittedRuntime=structuredClone(runtime);
  return admitted({libraryKey,identity:descriptor.content_sha256,profile:'wmh-semantic-midi1-v1',metadata,score,notation:score.notation,metadata_json:descriptor.metadata_json,score_json:descriptor.score_json,media:structuredClone(media),runtime:admittedRuntime,compilation:admittedRuntime.compilation});
}

/** Admission only after an explicit choice; scheduling data is exclusively native-derived. */
export function prepareVsqPractice(song,response) {
  if(!isVsqSong(song)||song.runtime!==null)fail('Choose base-note practice for the loaded VSQ package.');
  const runtime=response?.runtime,compilation=response?.compilation;
  if(runtime?.profile!==VSQ_PRACTICE_PROFILE||runtime.choice!=='base_notes_instrumental'||runtime.source_sha256!==song.score.source.sha256||!Array.isArray(runtime.parts)||!Array.isArray(runtime.notes)||!compilation?.timeline||!Array.isArray(compilation.timeline.notes)||!Array.isArray(compilation.diagnostics)||stable(compilation.score)!==stable(song.notation)||stable(runtime.interpretation_limits)!==stable(VSQ_LIMITS)||response.reference_velocity!==90||!Number.isFinite(runtime.end_ms)||runtime.end_ms<=0||compilation.timeline.duration_ms!==runtime.end_ms)fail('The native VSQ practice runtime is incomplete or belongs to another score.');
  const parts=new Map(song.notation.parts.map(part=>[part.id,part])),runtimeParts=new Map(runtime.parts.map(part=>[part.part_id,part]));
  if(runtimeParts.size!==parts.size||runtime.parts.length!==parts.size||runtime.parts.some(part=>!parts.has(part.part_id)||typeof part.audible!=='boolean'||part.part_id!==`vsq-track-${part.source_track_index}`||'channel' in part||'program' in part))fail('The practice runtime does not retain every VSQ part.');
  const expected=new Map(song.notation.parts.flatMap(part=>part.notes.filter(note=>note.pitch).map(note=>[note.id,part.id]))),ids=new Set(),timeline=new Map(compilation.timeline.notes.map(note=>[note.id,note]));
  if(runtime.notes.length!==expected.size||timeline.size!==expected.size||compilation.timeline.notes.length!==expected.size)fail('The practice runtime omits authored notes.');
  for(const note of runtime.notes){const projected=timeline.get(note.note_id);if(expected.get(note.note_id)!==note.part_id||ids.has(note.note_id)||!runtimeParts.has(note.part_id)||typeof note.authored_note_id!=='string'||typeof note.singer_event_id!=='string'||typeof note.audible!=='boolean'||'channel' in note||'program' in note||!Number.isInteger(note.key)||note.key<0||note.key>127||!Number.isFinite(note.start_ms)||!Number.isFinite(note.end_ms)||note.start_ms<0||note.end_ms<=note.start_ms||note.end_ms>runtime.end_ms+0.001||note.part_id!==`vsq-track-${note.source_track_index}`||note.note_id!==`vsq-t${note.source_track_index}-${note.authored_note_id}`||projected?.part_id!==note.part_id||projected.source_note_id!==note.note_id||stable(projected.source_note_ids)!==stable([note.note_id])||projected.voice!==note.singer_event_id||!Number.isFinite(projected.duration_ms)||projected.midi!==note.key||projected.start_ms!==note.start_ms||Math.abs(projected.duration_ms-(note.end_ms-note.start_ms))>0.001||projected.velocity!==response.reference_velocity)fail('A native VSQ practice note has invalid identity or timing.');ids.add(note.note_id);}
  if(runtime.notes.some((note,index)=>index>0&&note.start_ms<runtime.notes[index-1].start_ms))fail('The native practice notes are not in scheduling order.');
  return admitted({...song,runtime:structuredClone(runtime),compilation:structuredClone(compilation),navigation:structuredClone(response.navigation??null),navigation_unavailable:structuredClone(response.navigation_unavailable??null),reference_velocity:response.reference_velocity});
}

/** Native response only: exact clean bytes bind the separate authoritative runtime.
 * A null notation never enters the canonical compiler, preview or target pipeline.
 */
export async function preparePerformanceSong(libraryKey, descriptor, normalizedScore) {
  if (!descriptor || descriptor.version!==2 || descriptor.profile!==PERFORMANCE_PROFILE || !hash.test(descriptor.content_sha256) || libraryKey!==`native:song-${descriptor.content_sha256}` || normalizedScore!==null) fail('The complete performance does not match the selected package or has unexpected notation.');
  let metadata,score;
  try {metadata=JSON.parse(descriptor.metadata_json);score=JSON.parse(descriptor.score_json);}catch{fail('The complete performance package is unreadable.');}
  const runtime=descriptor.runtime;
  if(metadata?.format!=='worldmusichub-song'||metadata.version!==2||score?.format!=='worldmusichub-complete-score'||score.version!==2||score.performance?.profile!==PERFORMANCE_PROFILE||score.profile!==undefined||score.notation!==null||score.id!==metadata.id||score.title!==metadata.title||metadata.score?.path!=='score.json'||!hash.test(metadata.score.sha256)||!hash.test(score.source?.sha256)||metadata.sources?.length!==1||stable(metadata.sources[0])!==stable(score.source)||runtime?.profile!==PERFORMANCE_PROFILE||runtime.score_id!==score.id||runtime.source_sha256!==score.source.sha256||runtime.score_sha256!==metadata.score.sha256||stable(runtime.tracks)!==stable(score.performance.tracks)||stable(runtime.parts)!==stable(score.performance.parts)||stable(runtime.coverage)!==stable(score.coverage)||!Array.isArray(score.performance.events)||!Array.isArray(runtime.events)||runtime.events.length!==score.performance.events.length||runtime.events.some((event,index)=>event.event_id!==score.performance.events[index].event_id||stable(event.origin)!==stable(score.performance.events[index].origin)||stable(event.command)!==stable(score.performance.events[index].command)))fail('The native complete performance identity, coverage or events are inconsistent.');
  const scoreBytes=new TextEncoder().encode(descriptor.score_json);
  if(scoreBytes.byteLength!==metadata.score.bytes)fail('The complete score byte count does not match its metadata.');
  const media=descriptor.media;
  if(!Array.isArray(media)||!Array.isArray(metadata.media)||media.length!==metadata.media.length)fail('The media descriptor is incomplete.');
  const mediaIds=new Set(),parts=new Set(score.performance.parts.map(part=>part.id));
  for(const item of media){const source=metadata.media.find(asset=>asset.id===item.id);if(!source||mediaIds.has(item.id)||!roles.has(item.role)||source.role!==item.role||source.mime!==item.mime||source.bytes!==item.bytes||source.sha256!==item.sha256||stable(source.parts??null)!==stable(item.parts??null)||(source.offset_ms??null)!==(item.offset_ms??null)||!hash.test(item.sha256)||!/^asset-[0-9a-f]{64}$/.test(item.handle)||!Number.isSafeInteger(item.bytes)||item.bytes<=0||Object.keys(item).some(key=>['path','url','data','base64'].includes(key))||(item.parts&&item.parts.some(id=>!parts.has(id))))fail('Media identity is not bound to the complete performance package.');mediaIds.add(item.id);}
  const reference=await loadCleanPerformance({scoreBytes,expectedScoreSha256:metadata.score.sha256,compile:async()=>runtime});
  return admitted({libraryKey,identity:descriptor.content_sha256,profile:PERFORMANCE_PROFILE,metadata,score,notation:null,compilation:null,runtime:reference.runtime,reference,media:structuredClone(media),metadata_json:descriptor.metadata_json,score_json:descriptor.score_json});
}

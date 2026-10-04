import {isBasicKeysSong} from './clean-song-package.js';
import {equivalentJson} from './adaptation-view.js';

const freeze=value=>{if(value&&typeof value==='object'&&!Object.isFrozen(value)){Object.freeze(value);for(const item of Object.values(value))freeze(item);}return value;};
const sourceIndexes=new WeakMap(),admittedPages=new WeakMap(),boundaryIdentities=new WeakMap();
const invalid=()=>{throw Object.assign(Error('The basic-key notation page does not match the saved source and selected part.'),{code:'basic_keys_notation_identity',messageKey:'notationRuntime.basicPageInvalid'});};

/** Bind a small view request to immutable native bytes. The Rust view owns all
 * musical-time projection; this adapter checks identities and display bounds. */
export function basicKeyNotationRequest(song,{partId,from,count,displayMeter=null,positionMs=null}){
  if(!isBasicKeysSong(song)||!/^[0-9a-f]{64}$/.test(song.identity)||song.libraryKey!==`native:song-${song.identity}`
    ||!song.notation.parts.some(part=>part.id===partId)||!Number.isSafeInteger(from)||from<1||from>4294967296
    ||!Number.isInteger(count)||count<1||count>32)invalid();
  if(displayMeter!==null&&(!Number.isInteger(displayMeter.numerator)||displayMeter.numerator<1
    ||!Number.isInteger(displayMeter.denominator)||displayMeter.denominator<1))invalid();
  if(positionMs!==null&&(!Number.isFinite(positionMs)||positionMs<0))invalid();
  return{source:{key:song.libraryKey.slice(7),content_sha256:song.identity,profile:song.profile},
    settings:{part_id:partId,first_measure:from-1,measure_count:count,display_meter:displayMeter,...(positionMs===null?{}:{position_ms:positionMs})}};
}

export function basicKeyNotationPage(response,request,song){
  if(!response||!equivalentJson(response.source,request.source)||!response.page)invalid();
  const page=response.page;
  if(page.profile!==song.profile||page.view_version!==1||page.source_sha256!==song.score.source.sha256
    ||page.part_id!==request.settings.part_id||!Number.isSafeInteger(page.first_measure)||page.first_measure<0
    ||request.settings.position_ms===undefined&&page.first_measure!==request.settings.first_measure)invalid();
  const counts=page.coverage,arrays=[page.unresolved,page.instantaneous,page.continuations],inventory=song.runtime.parts.find(part=>part.id===request.settings.part_id);
  const rational=beat=>beat&&Number.isSafeInteger(beat.numerator)&&beat.numerator>=0&&Number.isSafeInteger(beat.denominator)&&beat.denominator>0;
  if(!counts||!['source_attacks','part_attacks','window_attacks','rendered_positive_keys','unresolved_attacks','instantaneous_attacks'].every(key=>Number.isSafeInteger(counts[key])&&counts[key]>=0)
    ||counts.source_attacks!==song.coverage.key_attacks||counts.part_attacks!==inventory?.attacks||!arrays.every(items=>Array.isArray(items)&&items.length<=2048)
    ||page.status!=='page_limit'&&(counts.unresolved_attacks!==page.unresolved.length||counts.instantaneous_attacks!==page.instantaneous.length)||!Array.isArray(page.diagnostics))invalid();
  if([...page.unresolved,...page.instantaneous].some(item=>typeof item.note_id!=='string'||!/^midi-t[1-9][0-9]*-e[1-9][0-9]*$/.test(item.note_id)||!Number.isInteger(item.key)||item.key<0||item.key>127||!rational(item.source_at)))invalid();
  if(['display_meter_required','percussion_mapping_required','empty_page','page_limit'].includes(page.status)){
    if(page.score||page.musicxml)invalid();
    return page;
  }
  if(!['ready','rendering_unavailable'].includes(page.status)||!page.score||page.status==='ready'&&(!page.musicxml||typeof page.musicxml.xml!=='string')||page.status==='rendering_unavailable'&&page.musicxml
    ||!Number.isSafeInteger(page.total_measures)||page.total_measures<=page.first_measure
    ||!Array.isArray(page.score.measures)
    ||page.measure_count!==page.score.measures.length||page.score.measures.length<1||page.score.measures.length>request.settings.measure_count
    ||page.score.parts?.length!==1||page.score.parts[0].id!==request.settings.part_id)invalid();
  const original=song.notation.parts.find(part=>part.id===request.settings.part_id),ids=new Map(original.notes.map(note=>[note.id,note]));
  const notes=page.score.parts[0].notes;
  if(!Array.isArray(notes)||notes.length>2048||new Set(notes.map(note=>note.id)).size!==notes.length
    ||counts.rendered_positive_keys!==notes.length||notes.length+page.unresolved.length+page.instantaneous.length>2048
    ||notes.some(note=>!ids.has(note.id)||!equivalentJson(note.pitch,ids.get(note.id).pitch)||note.velocity!==ids.get(note.id).velocity||note.voice!==ids.get(note.id).voice||note.staff!==ids.get(note.id).staff)
    ||page.continuations.some(item=>!ids.has(item.note_id)||!rational(item.source_start)||!rational(item.source_end)))invalid();
  if(!rational(page.source_start)||!rational(page.source_end))invalid();
  const fraction=beat=>{if(!rational(beat))invalid();return[BigInt(beat.numerator),BigInt(beat.denominator)];},add=(a,b)=>[a[0]*b[1]+b[0]*a[1],a[1]*b[1]],cmp=(a,b)=>a[0]*b[1]-b[0]*a[1];
  const start=fraction(page.source_start),stop=fraction(page.source_end),continuations=new Map(page.continuations.map(item=>[item.note_id,item]));
  if(cmp(start,stop)>=0n||continuations.size!==page.continuations.length)invalid();
  for(const note of notes){
    const original=ids.get(note.id),sourceStart=fraction(original.at),sourceEnd=add(sourceStart,fraction(original.duration));
    const actualStart=add(start,fraction(note.at)),actualEnd=add(actualStart,fraction(note.duration));
    if(cmp(actualStart,cmp(sourceStart,start)>0n?sourceStart:start)!==0n||cmp(actualEnd,cmp(sourceEnd,stop)<0n?sourceEnd:stop)!==0n)invalid();
    const incoming=cmp(sourceStart,start)<0n,outgoing=cmp(sourceEnd,stop)>0n,item=continuations.get(note.id);
    if(incoming||outgoing){if(!item||item.enters_page!==incoming||item.leaves_page!==outgoing||cmp(fraction(item.source_start),sourceStart)!==0n||cmp(fraction(item.source_end),sourceEnd)!==0n)invalid();}
    else if(item)invalid();
  }
  if(!Array.isArray(page.measures)||page.measures.length!==page.score.measures.length)invalid();
  let end=page.source_start_ms;const sourceClock=song.score.performance.timing.relative_clock_available,sourceDuration=song.runtime.rendition?.source_duration_ms??song.compilation?.timeline.duration_ms;
  for(const[index,measure]of page.measures.entries()){
    if(measure.source_measure_index!==page.first_measure+index||!rational(measure.source_at)||!rational(measure.source_end))invalid();
    if(sourceClock){if(!Number.isFinite(measure.start_ms)||!Number.isFinite(measure.end_ms)||measure.start_ms!==end||measure.end_ms<=end)invalid();end=measure.end_ms;}
    else if(measure.start_ms!==null||measure.end_ms!==null)invalid();
  }
  if(sourceClock&&(end!==page.source_end_ms||page.source_duration_ms!==sourceDuration
    ||request.settings.position_ms!==undefined&&(page.resolved_position_ms!==Math.min(request.settings.position_ms,page.source_duration_ms)||page.resolved_position_ms<page.source_start_ms||page.resolved_position_ms>page.source_end_ms||page.resolved_position_ms===page.source_end_ms&&page.source_end_ms!==page.source_duration_ms)))invalid();
  freeze(page);admittedPages.set(page,song);
  return page;
}

/** Only a page admitted against the original native source can authorize open
 * ties at its boundaries. Ordinary and caller-made identity objects get none. */
export function basicKeyEngravingIdentity(song,page){
  if(admittedPages.get(page)!==song||page.status!=='ready')invalid();
  const exported=page.musicxml,identity={score:page.score,noteMap:exported.note_id_map,partIdMap:exported.part_id_map,voiceIdMap:exported.voice_id_map};
  boundaryIdentities.set(identity,new Map(page.continuations.map(item=>[item.note_id,Object.freeze({incoming:item.enters_page,outgoing:item.leaves_page})])));
  return Object.freeze(identity);
}
export function basicKeyEngravingBoundaries(identity){return boundaryIdentities.has(identity)?new Map(boundaryIdentities.get(identity)):null;}

/** All times below were returned by Rust. Index them without deriving a tempo
 * clock or converting beats to milliseconds in the browser. */
export function basicKeyWrittenAt(song,page,position,timedNotes){
  if(!isBasicKeysSong(song)||!song.compilation||page?.status!=='ready')return null;
  const measure=page.measures.find(item=>position>=item.start_ms&&position<item.end_ms);
  if(!measure)return null;
  if(!sourceIndexes.has(song))sourceIndexes.set(song,new Map(song.notation.parts.flatMap(part=>part.notes.map(note=>[note.id,{note,partId:part.id}]))));
  const sources=sourceIndexes.get(song);
  const entries=timedNotes.flatMap(timed=>(timed.source_note_ids||[]).map(sourceNoteId=>{
    const source=sources.get(sourceNoteId);
    return source?{...source,sourceNoteId,sourceMeasureIndex:measure.source_measure_index,startMs:timed.start_ms,endMs:timed.start_ms+timed.duration_ms}:null;
  }).filter(Boolean));
  const occurrence={id:`basic-key-measure-${measure.source_measure_index}`,source_measure_index:measure.source_measure_index,measure_number:measure.source_measure_index+1,
    source_from:measure.source_at,source_to:measure.source_end,start_ms:measure.start_ms,end_ms:measure.end_ms,
    written_note_ids:entries.filter(entry=>entry.startMs>=measure.start_ms).map(entry=>entry.sourceNoteId),continuing_note_ids:entries.filter(entry=>entry.startMs<measure.start_ms).map(entry=>entry.sourceNoteId),
    repeat_region_index:null,repeat_pass:null,repeat_times:null};
  return{occurrence,entries};
}

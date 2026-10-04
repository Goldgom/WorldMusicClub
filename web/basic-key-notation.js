import {isBasicKeysSong} from './clean-song-package.js';
import {equivalentJson} from './adaptation-view.js';

const sourceIndexes=new WeakMap();
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
  if(!Array.isArray(page.measures)||page.measures.length!==page.score.measures.length)invalid();
  let end=page.source_start_ms;
  for(const[index,measure]of page.measures.entries()){
    if(measure.source_measure_index!==page.first_measure+index||!rational(measure.source_at)||!rational(measure.source_end))invalid();
    if(song.compilation){if(!Number.isFinite(measure.start_ms)||!Number.isFinite(measure.end_ms)||measure.start_ms!==end||measure.end_ms<=end)invalid();end=measure.end_ms;}
    else if(measure.start_ms!==null||measure.end_ms!==null)invalid();
  }
  if(song.compilation&&(end!==page.source_end_ms||page.source_duration_ms!==song.compilation.timeline.duration_ms
    ||request.settings.position_ms!==undefined&&(page.resolved_position_ms!==Math.min(request.settings.position_ms,page.source_duration_ms)||page.resolved_position_ms<page.source_start_ms||page.resolved_position_ms>page.source_end_ms||page.resolved_position_ms===page.source_end_ms&&page.source_end_ms!==page.source_duration_ms)))invalid();
  return page;
}

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

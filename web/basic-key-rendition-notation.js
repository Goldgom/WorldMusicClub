import {basicKeyRenditionNotes,basicKeyExactMilliseconds,BASIC_KEY_RENDITION} from './basic-key-rendition.js';
import {pitchMidi} from './music.js';

const indexes=new WeakMap();
const close=(a,b)=>Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<=.001;
const rational=value=>value&&Number.isSafeInteger(value.numerator)&&value.numerator>=0&&Number.isSafeInteger(value.denominator)&&value.denominator>0;
const pair=value=>[BigInt(value.numerator),BigInt(value.denominator)];
const compare=(a,b)=>a[0]*b[1]-b[0]*a[1];
const add=(a,b)=>[a[0]*b[1]+b[0]*a[1],a[1]*b[1]];
const coordEqual=(a,b)=>a===null?b===null:a&&b&&a.track===b.track&&a.event===b.event;
const exactEqual=(a,b)=>a&&b&&a.numerator===b.numerator&&a.denominator===b.denominator;
const keyPitch=key=>({step:['C','C','D','D','E','F','F','G','G','A','A','B'][key%12],alter:[0,1,0,1,0,0,1,0,1,0,1,0][key%12],octave:Math.floor(key/12)-1});
export function renditionNotationIndex(song){
  if(indexes.has(song))return indexes.get(song);
  const ticks=new Map();for(const track of song.score.performance.tracks){let tick=0;for(const[index,event]of track.events.entries()){tick+=event[0];ticks.set(`${track.source_index}:${index}`,tick);}}
  const targets=new Map(song.compilation.timeline.notes.map(note=>[note.id,note])),index=new Map();
  for(const evidence of basicKeyRenditionNotes(song.runtime.rendition)){const target=targets.get(evidence.note_id);index.set(evidence.note_id,{target,evidence,tick:ticks.get(`${evidence.attack.track}:${evidence.attack.event}`),startMs:target.start_ms,endMs:basicKeyExactMilliseconds(evidence.end),note:{id:target.id,pitch:evidence.role==='percussion_selector'?null:keyPitch(target.midi),velocity:target.velocity,voice:target.voice,staff:target.staff},partId:target.part_id});}
  indexes.set(song,index);return index;
}

/** The native interpretation supplies every musical and display boundary.
 * Browser checks bind them to the admitted playback/target view and source IDs. */
export function validateRenditionNotationPage(page,request,song,invalid){
  const rendition=song.runtime.rendition,settings=request.settings,counts=page.coverage;
  if(settings.rendition_policy_id!==BASIC_KEY_RENDITION||page.rendition_policy_id!==settings.rendition_policy_id||page.view_version!==2||page.profile!==song.profile||page.source_sha256!==song.score.source.sha256||page.part_id!==settings.part_id||!Number.isSafeInteger(page.first_measure)||page.first_measure<0||settings.position_ms===undefined&&page.first_measure!==settings.first_measure||!counts||counts.source_attacks!==song.coverage.key_attacks||counts.part_attacks!==song.runtime.parts.find(part=>part.id===settings.part_id)?.attacks||!Array.isArray(page.diagnostics))invalid();
  for(const field of ['interpreted_notes','onsets','selectors','continuations','unresolved','instantaneous'])if(page[field]!==undefined&&(!Array.isArray(page[field])||page[field].length>2048))invalid();
  const items=page.interpreted_notes||[],onsets=page.onsets||[],selectors=page.selectors||[];
  if(['display_meter_required','page_limit'].includes(page.status)){if(page.score||page.musicxml)invalid();return page;}
  if(page.status==='empty_page'&&page.source_start===null&&page.first_measure>=page.total_measures){if(page.score||page.musicxml||items.length||onsets.length||selectors.length)invalid();return page;}
  if(!['ready','rendering_unavailable','empty_page','onset_page','percussion_selectors'].includes(page.status)||!Number.isSafeInteger(page.total_measures)||page.total_measures<1||page.first_measure>=page.total_measures||!Array.isArray(page.measures)||page.measures.length<1||page.measures.length>settings.measure_count||page.measure_count!==page.measures.length||!rational(page.source_start)||!rational(page.source_end)||!close(page.source_duration_ms,rendition.source_duration_ms)||!close(page.rendition_duration_ms,rendition.duration_ms)||!Number.isFinite(page.source_start_ms)||page.source_start_ms<0||!Number.isFinite(page.source_end_ms)||page.source_end_ms<page.source_start_ms||!Number.isFinite(page.follow_end_ms)||page.follow_end_ms<page.source_end_ms||page.follow_end_ms>rendition.duration_ms+.001)invalid();
  const index=renditionNotationIndex(song),pageStart=pair(page.source_start),pageEnd=pair(page.source_end),ppq=BigInt(song.score.performance.ppq),globalEnd=[BigInt(song.score.performance.end_tick),ppq];
  const expected=new Map([...index].filter(([,item])=>{
    if(item.partId!==page.part_id)return false;const start=[BigInt(item.tick),ppq],end=[BigInt(item.evidence.receiver_end_tick),ppq];
    if(!item.evidence.synthetic_gate)return compare(start,pageEnd)<0n&&compare(end,pageStart)>0n;
    const onset=compare(start,pageStart)>=0n&&(compare(start,pageEnd)<0n||compare(start,pageEnd)===0n&&compare(pageEnd,globalEnd)===0n);
    return onset||item.target.start_ms<page.source_end_ms&&item.target.start_ms+item.target.duration_ms>page.source_start_ms;
  })),seen=new Map();
  if(page.source_clock_available!==rendition.source_clock_available)invalid();
  if(items.length!==expected.size)invalid();
  for(const item of items){const source=expected.get(item.note_id),evidence=source?.evidence;
    if(!source||seen.has(item.note_id)||item.key!==source.target.midi||item.role!==evidence.role||!coordEqual(item.attack,evidence.attack)||!coordEqual(item.release,evidence.release)||!exactEqual(item.start_exact,evidence.start)||!exactEqual(item.end_exact,evidence.end)||!close(item.start_ms,source.startMs)||!close(item.end_ms,source.endMs)||item.source_end_tick!==evidence.source_end_tick||item.receiver_end_tick!==evidence.receiver_end_tick||item.source_release_status!==evidence.source_release_status||item.end_reason!==evidence.end_reason||item.synthetic_gate!==evidence.synthetic_gate||item.display_kind!==(evidence.role==='percussion_selector'?'percussion_selector':evidence.synthetic_gate?'synthetic_onset':'interval')||!rational(item.source_at)||!rational(item.receiver_end)||compare(pair(item.source_at),[BigInt(source.tick),BigInt(song.score.performance.ppq)])!==0n||compare(pair(item.receiver_end),[BigInt(evidence.receiver_end_tick),BigInt(song.score.performance.ppq)])!==0n)invalid();seen.set(item.note_id,item);
  }
  const markers=(rows,kind)=>{const expectedItems=items.filter(item=>item.display_kind===kind);if(rows.length!==expectedItems.length||new Set(rows.map(item=>item.note_id)).size!==rows.length||rows.some(item=>{const source=seen.get(item.note_id);return!source||source.display_kind!==kind||source.key!==item.key||!rational(item.source_at)||compare(pair(source.source_at),pair(item.source_at))!==0n;}))invalid();};
  markers(onsets,'synthetic_onset');markers(selectors,'percussion_selector');
  let end=page.source_start_ms;for(const[index,measure]of page.measures.entries()){if(measure.source_measure_index!==page.first_measure+index||!rational(measure.source_at)||!rational(measure.source_end)||!close(measure.start_ms,end)||!Number.isFinite(measure.end_ms)||measure.end_ms<measure.start_ms||!Number.isFinite(measure.follow_end_ms)||measure.follow_end_ms<measure.end_ms||measure.follow_end_ms>page.follow_end_ms+.001)invalid();end=measure.end_ms;}
  if(!close(end,page.source_end_ms)||!close(page.measures.at(-1).follow_end_ms,page.follow_end_ms))invalid();
  const intervals=items.filter(item=>item.display_kind==='interval'),notes=page.score?.parts?.[0]?.notes||[];
  if(['onset_page','percussion_selectors','empty_page'].includes(page.status)){if(page.score||page.musicxml||intervals.length)invalid();}
  else{
    if(!page.score||page.score.parts?.length!==1||page.score.parts[0].id!==page.part_id||!Array.isArray(page.score.measures)||page.score.measures.length!==page.measure_count||!Array.isArray(notes)||notes.length!==intervals.length||new Set(notes.map(note=>note.id)).size!==notes.length||page.status==='ready'&&typeof page.musicxml?.xml!=='string'||page.status==='rendering_unavailable'&&page.musicxml)invalid();
    const start=pair(page.source_start),stop=pair(page.source_end);
    for(const note of notes){const item=seen.get(note.id),source=expected.get(note.id);if(!item||item.display_kind!=='interval'||pitchMidi(note.pitch)!==item.key||note.velocity!==source.target.velocity||!rational(note.at)||!rational(note.duration))invalid();const sourceStart=pair(item.source_at),sourceEnd=pair(item.receiver_end),actualStart=add(start,pair(note.at)),actualEnd=add(actualStart,pair(note.duration));if(compare(actualStart,compare(sourceStart,start)>0n?sourceStart:start)!==0n||compare(actualEnd,compare(sourceEnd,stop)<0n?sourceEnd:stop)!==0n)invalid();}
    const continuations=page.continuations||[],continued=intervals.filter(item=>compare(pair(item.source_at),start)<0n||compare(pair(item.receiver_end),stop)>0n);
    if(continuations.length!==continued.length||new Set(continuations.map(item=>item.note_id)).size!==continuations.length||continuations.some(item=>{const source=seen.get(item.note_id);return!source||source.display_kind!=='interval'||!rational(item.source_start)||!rational(item.source_end)||compare(pair(item.source_start),pair(source.source_at))!==0n||compare(pair(item.source_end),pair(source.receiver_end))!==0n||item.enters_page!==(compare(pair(source.source_at),start)<0n)||item.leaves_page!==(compare(pair(source.receiver_end),stop)>0n);}))invalid();
  }
  if(settings.position_ms!==undefined&&(!close(page.resolved_position_ms,Math.min(settings.position_ms,rendition.duration_ms))||page.resolved_position_ms<page.source_start_ms||page.resolved_position_ms>page.follow_end_ms))invalid();
  return page;
}

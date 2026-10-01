/** Rust supplies every written/performance interval. JavaScript only indexes that response. */
export class NotationNavigationIndex {
  constructor(response,score,timeline){
    const fail=()=>{throw Error('The notation-navigation response does not match this complete score/timeline. Manual notation and playback remain available.');};
    if(response?.version!==1||response.source_measure_count!==score.measures.length||!Number.isFinite(response.duration_ms)||response.duration_ms!==timeline.duration_ms||!Array.isArray(response.occurrences)||!response.occurrences.length||response.occurrences.length>100000||!Array.isArray(response.sounding_groups)||response.sounding_groups.length!==timeline.notes.length||!Array.isArray(response.diagnostics))fail();
    this.sourceNotes=new Map(score.parts.flatMap(part=>part.notes.map(note=>[note.id,{note,partId:part.id}])));
    this.soundingGroups=new Map();const compiled=new Map(timeline.notes.map(note=>[note.id,note]));let references=0;
    const ids=(values,partId=null)=>{if(!Array.isArray(values)||(references+=values.length)>1000000)fail();const seen=new Set();for(const id of values){const source=this.sourceNotes.get(id);if(!source||seen.has(id)||partId!==null&&source.partId!==partId)fail();seen.add(id)}return seen};
    const rational=value=>value&&Number.isSafeInteger(value.numerator)&&Number.isSafeInteger(value.denominator)&&value.numerator>=0&&value.denominator>0;
    const compare=(a,b)=>BigInt(a.numerator)*BigInt(b.denominator)-BigInt(b.numerator)*BigInt(a.denominator);
    const sourceEnd=item=>{const length=item.duration??item.length;return{numerator:BigInt(item.at.numerator)*BigInt(length.denominator)+BigInt(length.numerator)*BigInt(item.at.denominator),denominator:BigInt(item.at.denominator)*BigInt(length.denominator)}};
    let end=0;const occurrenceIds=new Set();
    for(const occurrence of response.occurrences){const measure=score.measures[occurrence.source_measure_index];if(!Number.isInteger(occurrence.source_measure_index)||!measure||occurrence.measure_number!==measure.number||typeof occurrence.id!=='string'||occurrenceIds.has(occurrence.id)||!Number.isFinite(occurrence.start_ms)||!Number.isFinite(occurrence.end_ms)||occurrence.start_ms!==end||occurrence.end_ms<=end||!rational(occurrence.source_from)||!rational(occurrence.source_to)||compare(occurrence.source_from,occurrence.source_to)>=0n||compare(occurrence.source_from,measure.at)<0n||compare(occurrence.source_to,sourceEnd(measure))>0n)fail();occurrenceIds.add(occurrence.id);end=occurrence.end_ms;
      if(occurrence.repeat_region_index===null){if(occurrence.repeat_pass!==null||occurrence.repeat_times!==null)fail()}else{const region=score.repeats?.[occurrence.repeat_region_index];if(!Number.isInteger(occurrence.repeat_region_index)||!region||occurrence.repeat_times!==region.times||!Number.isInteger(occurrence.repeat_pass)||occurrence.repeat_pass<1||occurrence.repeat_pass>region.times)fail()}
      const starts=ids(occurrence.written_note_ids);for(const id of starts){const note=this.sourceNotes.get(id).note;if(compare(note.at,occurrence.source_from)<0n||compare(note.at,occurrence.source_to)>=0n)fail()}for(const id of ids(occurrence.continuing_note_ids)){const note=this.sourceNotes.get(id).note;if(starts.has(id)||compare(note.at,occurrence.source_from)>=0n||compare(sourceEnd(note),occurrence.source_from)<=0n)fail()}
    }
    if(end!==response.duration_ms)fail();
    for(const group of response.sounding_groups){const note=compiled.get(group.occurrence_id),sourceIds=note?.source_note_ids?.length?note.source_note_ids:[note?.source_note_id||note?.id];if(!note||this.soundingGroups.has(group.occurrence_id)||group.part_id!==note.part_id||group.start_ms!==note.start_ms||group.end_ms!==note.start_ms+note.duration_ms||!Array.isArray(group.source_note_ids)||group.source_note_ids.length!==sourceIds.length||group.source_note_ids.some((id,index)=>id!==sourceIds[index]))fail();ids(group.source_note_ids,group.part_id);this.soundingGroups.set(group.occurrence_id,group)}
    this.occurrences=response.occurrences;this.duration=response.duration_ms;this.diagnostics=response.diagnostics;
  }
  at(position){
    if(!Number.isFinite(position)||position<0||position>=this.duration)return null;
    let low=0,high=this.occurrences.length;while(low<high){const middle=(low+high)>>>1;if(this.occurrences[middle].start_ms<=position)low=middle+1;else high=middle}
    const occurrence=this.occurrences[low-1];return occurrence&&position<occurrence.end_ms?occurrence:null;
  }
}
export function sourceMeasurePage(index,pageSize){if(!Number.isInteger(index)||index<0||!Number.isInteger(pageSize)||pageSize<1||pageSize>64)throw Error('Invalid source measure/page size.');return Math.floor(index/pageSize)*pageSize+1}

export function setupNotationFollowing({api,getContext,getPlayback,view}){
  const checkbox=document.getElementById('engraving-follow'),status=document.getElementById('engraving-follow-status');let controller=null,generation=0,index=null,target=null,last='';
  function message(text,announce=true){status.setAttribute('aria-live',announce?'polite':'off');status.textContent=text}
  function suspend(reason='Manual navigation suspended following. Enable it again to resume.'){
    generation++;controller?.abort();controller=null;checkbox.checked=false;last='';view.resetReveal?.();message(reason);
  }
  function scoreChanged(){suspend('Following is off.');index=null;target=null}
  function tick(position,running){
    if(!checkbox.checked||!index)return;
    if(target!==getContext().score){scoreChanged();return}if(!view.isActive()){suspend('Following stopped because the engraved view is not active. Manual notation and playback remain available.');return}
    const occurrence=index.at(position);
    if(!occurrence){const key=position<0?'count-in':'end';if(last!==key){last=key;message(position<0?'Count-in: no active score measure.':'End of performance.')}return}
    view.followMeasure(occurrence.source_measure_index);const page=view.navigationState(),reveal=view.revealExpectedWrittenNotes?.(occurrence.id,occurrence.source_measure_index);const key=`${occurrence.id}:${page.ready}:${running}:${reveal?.status}`;if(key===last)return;last=key;
    status.title=`${occurrence.written_note_ids.length} full-score written onsets, ${occurrence.continuing_note_ids.length} continuing written events. Display changes do not alter the playback clock.`;
    message(`${running?'Following':'Paused at'} written measure ${occurrence.measure_number} · source ${occurrence.source_measure_index+1}/${getContext().score.measures.length}${occurrence.repeat_region_index===null?'':` · repeat ${occurrence.repeat_region_index+1}, pass ${occurrence.repeat_pass}/${occurrence.repeat_times}`}${page.ready?'':' · Loading display…'}${reveal?.status==='partial'?' · Some expected notes remain outside this view.':''}`,!running);
  }
  checkbox.addEventListener('change',async()=>{
    if(!checkbox.checked){suspend('Following is off. Manual measure paging remains available.');return}
    view.resetReveal?.();
    if(!view.isActive()){suspend('Choose the engraved view before enabling following.');return}
    const context=getContext();if(!context.score||!context.timeline){suspend('Load a validated score first.');return}
    if(index&&target===context.score){last='';const playback=getPlayback();tick(playback.position,playback.running);return}
    const current=++generation;controller?.abort();controller=new AbortController();const signal=controller.signal;message('Preparing measure following…');
    try{const response=await api('/api/notation-navigation',context.score,signal);if(current!==generation||signal.aborted||!checkbox.checked||getContext().score!==context.score)return;index=new NotationNavigationIndex(response,context.score,context.timeline);target=context.score;last='';const playback=getPlayback();tick(playback.position,playback.running)}catch(error){if(current===generation&&!signal.aborted)suspend(`Following unavailable: ${error.message} Use manual measure paging; playback is unchanged.`)}finally{if(current===generation)controller=null}
  });
  window.addEventListener('pagehide',()=>suspend('Following stopped when the page was hidden. Enable it again after returning.'));
  return{tick,suspend,scoreChanged};
}

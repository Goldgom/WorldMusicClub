import {isVsqNavigationIndex} from './vsq-navigation.js';
import {planEngravingReveal} from './engraving-reveal.js';
import {getAppI18n} from './app-locale.js';
const navigationError=key=>Object.assign(new Error(getAppI18n().t(`notationRuntime.${key}`)),{code:`notation_${key}`});

/** Rust supplies every written/performance interval. JavaScript only indexes that response. */
export class NotationNavigationIndex {
  constructor(response,score,timeline){
    const fail=()=>{throw navigationError('followInvalid');};
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
export function sourceMeasurePage(index,pageSize){if(!Number.isInteger(index)||index<0||!Number.isInteger(pageSize)||pageSize<1||pageSize>64)throw navigationError('sourcePage');return Math.floor(index/pageSize)*pageSize+1}

/** A display page comes from written positions, never a reconstructed playback clock. */
export function basicNotationPage(occurrence, entries, partId, spanBeats, pageAnchor=null) {
  if (!occurrence || !Number.isSafeInteger(spanBeats) || spanBeats < 1) return null;
  const compare = (a,b) => BigInt(a.numerator)*BigInt(b.denominator)-BigInt(b.numerator)*BigInt(a.denominator);
  let at = occurrence.source_from;
  if(pageAnchor&&compare(pageAnchor,at)>0n&&compare(pageAnchor,occurrence.source_to)<0n)at=pageAnchor;
  for (const entry of entries || []) {
    if ((partId===null || entry.partId === partId) && entry.sourceMeasureIndex === occurrence.source_measure_index
      && compare(entry.note.at,at)>0n && compare(entry.note.at,occurrence.source_to)<0n) at=entry.note.at;
  }
  return Number(BigInt(at.numerator)/(BigInt(at.denominator)*BigInt(spanBeats)));
}

/** Leave the compact, sticky page/Follow toolbar above the revealed music.
 * Use its height at the pinned position, not its current flow position: scrolling
 * the dock can move the toolbar to the top while the same reveal is in progress.
 */
export function notationScrollViewport(dock) {
  const overlay=dock.ownerDocument?.getElementById('notation-lane-overlay');
  return overlay&&!overlay.hidden?overlay:dock;
}

export function notationRevealViewport(dock,container) {
  dock=notationScrollViewport(dock);
  const outer=dock.getBoundingClientRect(),inner=container.getBoundingClientRect();
  const toolbar=dock.querySelector?.('.short-notation .engraving-follow-controls');
  const toolbarHeight=toolbar?.getBoundingClientRect().height||0;
  return {
    top:outer.top+dock.clientTop+toolbarHeight,bottom:outer.top+dock.clientTop+dock.clientHeight,
    left:Math.max(outer.left+dock.clientLeft,inner.left+container.clientLeft),
    right:Math.min(outer.left+dock.clientLeft+dock.clientWidth,inner.left+container.clientLeft+container.clientWidth),
    scrollTop:dock.scrollTop,scrollLeft:container.scrollLeft,
    maxTop:dock.scrollHeight-dock.clientHeight,maxLeft:container.scrollWidth-container.clientWidth,
  };
}

/** Reveal exact generated note IDs inside the score dock; never scroll the page. */
export function createBasicNotationReveal({container,dock}) {
  let last='',root=null,result={status:'unavailable'};
  const reset=()=>{last='';root=null};
  function reveal(occurrenceId,sourceNoteIds) {
    const key=JSON.stringify([occurrenceId,[...sourceNoteIds].sort()]);
    if(last===key&&root===container.firstElementChild)return result;
    last=key;root=container.firstElementChild;result={status:'unavailable'};
    if(!sourceNoteIds.length)return result;
    try {
      const ids=new Set(sourceNoteIds),nodes=[...container.querySelectorAll('.score-note')].filter(node=>ids.has(node.dataset.noteId));
      if(!nodes.length)return result;
      const plan=planEngravingReveal(nodes.map(node=>node.getBoundingClientRect()),notationRevealViewport(dock,container));
      if(!plan)return result;
      const viewport=notationScrollViewport(dock);
      if(plan.scrollTop!==viewport.scrollTop)viewport.scrollTo({top:plan.scrollTop,left:viewport.scrollLeft,behavior:'instant'});
      if(plan.scrollLeft!==container.scrollLeft)container.scrollTo({left:plan.scrollLeft,top:container.scrollTop,behavior:'instant'});
      return result={status:plan.partial||new Set(nodes.map(node=>node.dataset.noteId)).size<ids.size?'partial':'ready'};
    } catch { return result; } // Optional layout must not interrupt audio or the game frame.
  }
  return {reveal,reset};
}

/** One explicit follow preference for every notation view, independent of transport. */
export function setupNotationFollowing({api,getContext,getPlayback,view,prepareNavigation,defaultEnabled=true,document=globalThis.document,i18n=getAppI18n(document)}) {
  const checkbox=document.getElementById('engraving-follow'),status=document.getElementById('engraving-follow-status');
  let controller=null,generation=0,index=null,target=null,timeline=null,pending=null,last='',presentation=null;
  const t=(key,params)=>i18n.t(`notationRuntime.${key}`,params);
  const failureKeys={notation_followInvalid:'followInvalid',notation_followMap:'followMap',notation_sourcePage:'sourcePage'};
  const errorText=error=>{
    const owned=Object.hasOwn(failureKeys,error?.code);
    const detail=owned?error?.cause?.message:error?.message;
    const explanation=owned?t(failureKeys[error.code]):'';
    return explanation+(typeof detail==='string'&&detail?(explanation?' ':'')+t('technical',{detail}):'')||t('followMap');
  };
  status.removeAttribute?.('data-i18n');
  checkbox.checked=defaultEnabled;
  function redrawLocale(){
    if(!presentation)return;
    const {key,params,announce,occurrence,total,ready,revealStatus,running,error}=presentation;
    status.setAttribute('aria-live',announce?'polite':'off');
    status.title='';
    if(occurrence){
      status.title=t('followTitle',{onsets:occurrence.written_note_ids.length,continuing:occurrence.continuing_note_ids.length});
      status.textContent=t(running?'following':'paused',{measure:String(occurrence.measure_number),source:occurrence.source_measure_index+1,total})+(occurrence.repeat_region_index===null?'':t('repeat',{region:occurrence.repeat_region_index+1,pass:occurrence.repeat_pass,times:occurrence.repeat_times}))+(ready?'':t('loading'))+(revealStatus==='partial'?t('partial'):'');
    }else status.textContent=t(key,error?{reason:errorText(error)}:params);
  }
  function message(key,params,announce=true){presentation={key,params,announce};redrawLocale()}

  function cancel(){generation++;controller?.abort();controller=null;pending=null;last='';view.resetReveal?.()}
  function suspend(reason) {
    cancel();checkbox.checked=false;
    if(reason?.error){presentation={key:'followUnavailable',error:reason.error,announce:true};redrawLocale()}
    else if(typeof reason==='string')message('technical',{detail:reason});
    else message(reason?.key||'followSuspended');
  }
  function scoreChanged() {
    cancel();index=null;target=null;timeline=null;
    message(checkbox.checked?'followOn':'followOff');
  }
  function tick(position,running,written) {
    if(!checkbox.checked)return;
    const context=getContext();
    if(target!==context.score||timeline!==context.timeline){scoreChanged();target=context.score;timeline=context.timeline}
    if(!view.isActive()||!context.score||!context.timeline)return;
    if(!index){prepare();return}
    const occurrence=index.at(position);
    if(!occurrence){const key=position<0?'count-in':'end';if(last!==key){last=key;message(position<0?'countIn':'end')}return}
    view.followMeasure(occurrence.source_measure_index,occurrence,written);
    const page=view.navigationState(),reveal=view.revealExpectedWrittenNotes?.(occurrence.id,occurrence.source_measure_index,written);
    const key=`${occurrence.id}:${page.ready}:${running}:${reveal?.status}`;if(key===last)return;last=key;
    presentation={occurrence,total:context.score.measures.length,ready:page.ready,revealStatus:reveal?.status,running,announce:!running};redrawLocale();
  }
  function prepare({retry=false}={}) {
    if(pending)return pending;
    const context=getContext();
    if(!checkbox.checked||!context.score||!context.timeline||!view.isActive())return Promise.resolve(null);
    if(index&&target===context.score&&timeline===context.timeline){last='';const playback=getPlayback();tick(playback.position,playback.running,playback.written);return Promise.resolve(index)}
    const current=++generation;controller?.abort();controller=new AbortController();const signal=controller.signal;
    target=context.score;timeline=context.timeline;message('followPreparing');
    const isCurrent=()=>current===generation&&!signal.aborted&&checkbox.checked&&getContext().score===context.score&&getContext().timeline===context.timeline;
    const request=(async()=>{
      try {
        const prepared=prepareNavigation?await prepareNavigation({retry}):new NotationNavigationIndex(await api('/api/notation-navigation',context.score,signal),context.score,context.timeline);
        if(!isCurrent())return null;
        if(!(prepared instanceof NotationNavigationIndex)&&!isVsqNavigationIndex(prepared))throw navigationError('followMap');
        index=prepared;last='';const playback=getPlayback();tick(playback.position,playback.running,playback.written);return index;
      }catch(error){if(isCurrent())suspend({error});return null}
    })().finally(()=>{if(pending===request)pending=null;if(current===generation)controller=null});
    pending=request;return request;
  }
  checkbox.addEventListener('change',()=>{
    if(!checkbox.checked){suspend({key:'followManual'});return}
    last='';view.resetReveal?.();
    return prepare({retry:true});
  });
  window.addEventListener('pagehide',()=>{cancel();index=null;target=null;timeline=null});
  message(defaultEnabled?'followOn':'followOff');
  // Text-only redraw: never tick, prepare, read the transport, navigate or reveal.
  i18n.subscribe(redrawLocale);
  return {tick,suspend,scoreChanged,prepare,isEnabled:()=>checkbox.checked};
}

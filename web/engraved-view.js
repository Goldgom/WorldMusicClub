import {sourceMeasurePage,notationRevealViewport} from './notation-follow.js';
import {planEngravingReveal} from './engraving-reveal.js';
export function engravingWindow(total, from = 1, count = 8) {
  if (!Number.isInteger(total) || total < 0 || !Number.isInteger(from) || from < 1 || !Number.isInteger(count) || count < 1 || count > 64 || (total && from > total)) throw new Error('Choose a valid one-based source measure range of at most 64 measures.');
  return {total, from, to:Math.min(total,from+count-1)};
}
export function mappedPartIds(exported, canonicalId) {
  if (canonicalId === null) return null;
  const map = exported.part_id_map;
  if (!map || !Object.hasOwn(map,canonicalId) || typeof map[canonicalId] !== 'string' || !map[canonicalId]) throw new Error('The selected canonical part has no generated MusicXML ID.');
  return [map[canonicalId]];
}
/** Optional presentation surface. All score conversion and timing stay in Rust. */
export function setupEngravedView({getScore, getPracticePart, onVisibility, onFallback, notice, onManualNavigation=()=>{},isVisible=()=>true,loadAdapter=()=>import('./engraving.js')}) {
  const $ = id => document.getElementById(id);
  let active = false, preferred = true, score = null, selectedPart = null, from = 1, pageSize = 8;
  let generation = 0, controller = null, cached = null, adapter = null, rendered = null;
  let expected=null,expectedScore=null,knownScore=null,knownIds=new Set();
  let lastReveal='',revealStatus={status:'unavailable'};
  let lastDark = document.documentElement.dataset.theme === 'dark';
  const container = $('engraved-staff');
  function cancel() { generation++;lastReveal='';revealStatus={status:'unavailable'}; controller?.abort(); controller = null; rendered?.dispose(); rendered = null; adapter?.disposeEngravedStaff(container); }
  function hasNoteMapping(){return ['mappingStatus','setExpectedWrittenNotes','clearExpectedWrittenNotes'].every(name=>typeof rendered?.[name]==='function')}
  function mappingStatus(){return hasNoteMapping()?rendered.mappingStatus():{status:'unavailable',verifiedGlyphCount:0,diagnostics:rendered?[{code:'engraving_note_mapping_unavailable',message:'Individual notehead mapping is unavailable from this renderer. Static staff remains available; current written notes are not highlighted.'}]:[]}}
  function clearExpectedWrittenNotes(){expected=null;expectedScore=null;lastReveal='';return hasNoteMapping()?rendered.clearExpectedWrittenNotes():false}
  function revealExpectedWrittenNotes(occurrenceId,sourceMeasureIndex=expected?.sourceMeasureIndex){
    if(!$('engraving-follow').checked||!active||!isVisible()||expectedScore!==score||!expected||expected.sourceMeasureIndex!==sourceMeasureIndex||!rendered)return {status:'unavailable'};
    const key=JSON.stringify([generation,rendered.renderGeneration?.(),occurrenceId,expected.sourceMeasureIndex,[...expected.sourceNoteIds].sort()]);
    if(lastReveal===key)return revealStatus;
    lastReveal=key;revealStatus={status:'unavailable'};
    if(!hasNoteMapping()||typeof rendered.expectedNoteBounds!=='function')return revealStatus;
    try{
      const bounds=rendered.expectedNoteBounds(),dock=$('notation-dock'),scroller=container.closest?.('.engraving-scroll');
      if(!['ready','partial'].includes(bounds?.status)||!bounds?.rects?.length||!dock||!scroller)return revealStatus;
      const plan=planEngravingReveal(bounds.rects,notationRevealViewport(dock,scroller));
      if(!plan)return revealStatus;
      if(plan.scrollTop!==dock.scrollTop)dock.scrollTo({top:plan.scrollTop,left:dock.scrollLeft,behavior:'instant'});
      if(plan.scrollLeft!==scroller.scrollLeft)scroller.scrollTo({left:plan.scrollLeft,top:scroller.scrollTop,behavior:'instant'});
      return revealStatus={status:plan.partial||bounds.status==='partial'?'partial':'ready'};
    }catch{return revealStatus} // Optional presentation failures never break the playback frame.
  }
  function setExpectedWrittenNotes(value){
    const current=getScore();if(!active||!current||score!==current){clearExpectedWrittenNotes();return false}
    if(knownScore!==current){knownScore=current;knownIds=new Set(current.parts.flatMap(part=>part.notes.map(note=>note.id)))}
    const ids=value?.sourceNoteIds,measure=value?.sourceMeasureIndex;
    if(!Array.isArray(ids)||ids.some(id=>typeof id!=='string'||!knownIds.has(id))||new Set(ids).size!==ids.length||!Number.isInteger(measure)||measure<0||measure>=current.measures.length){expected=null;expectedScore=null;lastReveal='';if(hasNoteMapping())rendered.setExpectedWrittenNotes(value);return false}
    expected={sourceNoteIds:[...ids],sourceMeasureIndex:measure};expectedScore=current;return rendered?(hasNoteMapping()?rendered.setExpectedWrittenNotes(expected):false):true;
  }
  function showNotices(exported,mapping){
    const diagnostics=[...(exported.diagnostics||[]),...(mapping?.diagnostics||[])];
    if(mapping?.status==='partial')diagnostics.push({code:'engraving_note_mapping_partial',message:`Current-note highlighting is limited: ${mapping.verifiedGlyphCount} of ${mapping.displayedSegmentCount} visible written segments have individually verified noteheads. Other symbols remain unchanged.`});
    const unique=[...new Map(diagnostics.map(item=>[`${item.code}:${item.message}`,item])).values()];$('engraving-diagnostics').replaceChildren();
    for(const diagnostic of unique){const item=document.createElement('li');item.textContent=diagnostic.message;$('engraving-diagnostics').append(item)}
    if($('dock-warning-count'))$('dock-warning-count').textContent=`Notation notices · ${unique.length}`;
  }
  function setParts() {
    $('engraving-part').replaceChildren();
    const all = document.createElement('option'); all.value = ''; all.textContent = 'All parts · 全部声部'; $('engraving-part').append(all);
    for (const part of score?.parts || []) { const option = document.createElement('option'); option.value = part.id; option.textContent = part.name; $('engraving-part').append(option); }
    if (selectedPart !== null && !score?.parts.some(part => part.id === selectedPart)) selectedPart = null;
    $('engraving-part').value = selectedPart || '';
  }
  function rangeControls() {
    const {total,to} = engravingWindow(score?.measures.length || 0,from,pageSize);
    $('engraving-range').textContent = total ? `Measures ${from}–${to} / ${total}` : 'No measure map';
    $('engraving-prev').disabled = from <= 1;
    $('engraving-next').disabled = to >= total;
    return {total, to};
  }
  async function exportScore(target, signal) {
    if (cached?.score === target) return cached.result;
    const response = await fetch('/api/export/musicxml', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(target),signal});
    let result; try { result = await response.json(); } catch { throw new Error('The Rust MusicXML exporter returned an unreadable response. Restart with a current server build.'); }
    if (!response.ok) throw new Error(result.error || `MusicXML export returned ${response.status}.`);
    if (typeof result.xml !== 'string' || !result.part_id_map) throw new Error('MusicXML export is missing its XML or canonical part map.');
    if (!signal?.aborted && getScore() === target) cached = {score:target,result};
    return result;
  }
  function fallback(message) {
    if (!active) return;
    hide(); $('engraving-fallback').textContent = `Engraved staff unavailable: ${message} Showing the simplified pitch guide. It does not fully engrave rhythm, voices, ties or key signatures. Playback still uses the Rust score.`; $('engraving-fallback').hidden = false; onFallback();
    if($('dock-warning-count')){$('dock-warning-count').hidden=false;$('dock-warning-count').textContent='View notation error · 查看提示';}
  }
  async function render() {
    if (!active || !score || !isVisible()) return;
    cancel(); const current = generation; controller = new AbortController(); const signal = controller.signal; const target = score;
    $('engraving-fallback').hidden = true; onVisibility(true); rangeControls(); $('engraving-status').textContent = 'Preparing exact MusicXML with Rust, then engraving locally…';
    $('engraving-diagnostics').replaceChildren();if($('dock-warning-count'))$('dock-warning-count').textContent='Notation notices · preparing…';
    try {
      const exported = await exportScore(target, signal);
      if (signal.aborted || current !== generation || !active || target !== getScore()) return;
      adapter ||= await loadAdapter();
      if (signal.aborted || current !== generation || !active) return;
      const {total,to} = rangeControls();
      if (!total) throw new Error('This score has no declared measure map for engraving.');
      const mapped = mappedPartIds(exported,selectedPart);
      const result = await adapter.renderEngravedStaff(container, exported.xml, {dark:lastDark,fromMeasure:from,toMeasure:to,partIds:mapped,responsive:true,compactHeader:true,
        identity:{score:target,noteMap:exported.note_id_map,partIdMap:exported.part_id_map,voiceIdMap:exported.voice_id_map},
        onMappingChange:mapping=>{if(current===generation&&active&&getScore()===target)showNotices(exported,mapping)},
        onError:failure=>{if(current===generation&&active)fallback(failure.message)}}, signal);
      if (signal.aborted || current !== generation || !active) { result.dispose?.(); return; }
      if (!result.ok) { if (result.status !== 'cancelled') fallback(result.message); return; }
      rendered = result;
      if(expectedScore===target&&expected&&hasNoteMapping())rendered.setExpectedWrittenNotes(expected);
      $('engraving-status').textContent = `Generated staff preview · Measures ${result.metadata.fromMeasure}–${result.metadata.toMeasure} · display only.`;
      showNotices(exported,mappingStatus());
      $('engraving-license-note').hidden = false;
    } catch (error) { if (current === generation && !signal.aborted && active && error.name !== 'AbortError') fallback(error.message || 'The optional renderer is unavailable in this build.'); }
  }
  function show() {
    if (!getScore()) return;
    if(score!==getScore()){score=getScore();selectedPart=getPracticePart();from=1}
    active = true; preferred = true;
    setParts(); onVisibility(true); render();
  }
  function hide({remember=false}={}) { if(remember){preferred=false;$('engraving-fallback').hidden=true;}clearExpectedWrittenNotes();active = false; cancel(); container.replaceChildren(); onVisibility(false); }
  function updateScore() {
    const current = getScore(); $('export-musicxml').disabled = !current;
    if (current === score) return;
    clearExpectedWrittenNotes();score = current; cached = null; from = 1; selectedPart = getPracticePart(); setParts(); rangeControls();
    if (active || preferred) {active=true;render();}
  }
  function selectPart(part) { onManualNavigation(); selectedPart = part; setParts(); if (active) render(); }
  $('engraving-part').addEventListener('change', () => { onManualNavigation(); selectedPart=$('engraving-part').value || null; render(); });
  $('engraving-page-size').addEventListener('change', () => { onManualNavigation(); pageSize=Number($('engraving-page-size').value); from=Math.floor((from-1)/pageSize)*pageSize+1; render(); });
  $('engraving-prev').addEventListener('click', () => { onManualNavigation(); from=Math.max(1,from-pageSize);render(); });
  $('engraving-next').addEventListener('click', () => { onManualNavigation(); if(from+pageSize<=(score?.measures.length||0)){from+=pageSize;render()} });
  $('export-musicxml').addEventListener('click', async () => {
    const target=getScore(); if(!target)return;
    const button=$('export-musicxml'); button.disabled=true;
    try {
      const exported=await exportScore(target);
      if(target!==getScore())return;
      const url=URL.createObjectURL(new Blob([exported.xml],{type:'application/vnd.recordare.musicxml+xml'}));const link=document.createElement('a');link.href=url;link.download=`${target.id.replace(/[^\w.-]/g,'_')}.musicxml`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
      notice('Generated MusicXML exported. Clefs and rhythmic spelling may be inferred; canonical JSON retains the full source and provenance.');
    }catch(error){notice(`MusicXML export failed. ${error.message}`,true)}finally{button.disabled=!getScore()}
  });
  const observer=new MutationObserver(()=>{const dark=document.documentElement.dataset.theme==='dark';if(dark!==lastDark){lastDark=dark;if(active)render()}});observer.observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});
  window.addEventListener('pagehide',cancel);window.addEventListener('pageshow',event=>{if(event.persisted&&active)render()});
  const dock=$('notation-dock');
  if(dock?.setAttribute){dock.setAttribute('tabindex','0');dock.setAttribute('aria-label','Score notation scroll area · 乐谱滚动区域')}
  const manualScroll=()=>{if($('engraving-follow').checked){lastReveal='';onManualNavigation()}};
  dock?.addEventListener('wheel',manualScroll,{passive:true});dock?.addEventListener('touchmove',manualScroll,{passive:true});
  dock?.addEventListener('pointerdown',event=>{if(event.target===dock||event.target?.closest?.('.engraving-scroll,.notation-scroll'))manualScroll()},{passive:true});
  dock?.addEventListener('keydown',event=>{if(!event.defaultPrevented&&!event.altKey&&!event.ctrlKey&&!event.metaKey&&['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','PageUp','PageDown','Home','End',' '].includes(event.key)&&!event.target?.isContentEditable&&!event.target?.closest?.('input,select,textarea,button,summary,[contenteditable]:not([contenteditable="false"])'))manualScroll()});
  const invalidateReveal=()=>{lastReveal=''};
  window.addEventListener('resize',invalidateReveal);
  // Opening score details can shift the staff without changing the dock's size.
  dock?.addEventListener('toggle',invalidateReveal,true);
  if(dock&&typeof globalThis.ResizeObserver==='function'){
    const resizeObserver=new ResizeObserver(invalidateReveal),surfaces=[dock,container.closest?.('.engraving-scroll'),dock.firstElementChild].filter(Boolean);
    const observe=()=>surfaces.forEach(surface=>resizeObserver.observe(surface));observe();
    window.addEventListener('pagehide',()=>resizeObserver.disconnect());window.addEventListener('pageshow',event=>{if(event.persisted){invalidateReveal();observe()}});
  }
  return {show,hide,updateScore,selectPart,setExpectedWrittenNotes,clearExpectedWrittenNotes,revealExpectedWrittenNotes,resetReveal(){lastReveal=''},mappingStatus,isActive:()=>active,surfaceChanged(){if(active&&isVisible())render();else cancel()},
    navigationState:()=>({from,ready:Boolean(rendered)}),
    followMeasure(index){if(!active||!score||!Number.isInteger(index)||index<0||index>=score.measures.length)return false;const page=sourceMeasurePage(index,pageSize);if(page===from)return false;from=page;render();return true}
  };
}

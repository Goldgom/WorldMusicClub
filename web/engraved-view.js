import {sourceMeasurePage} from './notation-follow.js';
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
export function setupEngravedView({getScore, getPracticePart, pausePlayback, onVisibility, onFallback, notice, onManualNavigation=()=>{}}) {
  const $ = id => document.getElementById(id);
  let active = false, preferred = true, score = null, selectedPart = null, from = 1, pageSize = 8;
  let generation = 0, controller = null, cached = null, adapter = null, rendered = null;
  let lastDark = document.documentElement.dataset.theme === 'dark';
  const container = $('engraved-staff');
  function cancel() { generation++; controller?.abort(); controller = null; rendered?.dispose(); rendered = null; adapter?.disposeEngravedStaff(container); }
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
  }
  async function render({automatic=false}={}) {
    if (!active || !score) return;
    cancel(); const current = generation; controller = new AbortController(); const signal = controller.signal; const target = score;
    $('engraving-fallback').hidden = true; onVisibility(true); if(!automatic)pausePlayback(); rangeControls(); $('engraving-status').textContent = 'Preparing exact MusicXML with Rust, then engraving locally…';
    try {
      const exported = await exportScore(target, signal);
      if (signal.aborted || current !== generation || !active || target !== getScore()) return;
      adapter ||= await import('./engraving.js');
      if (signal.aborted || current !== generation || !active) return;
      const {total,to} = rangeControls();
      if (!total) throw new Error('This score has no declared measure map for engraving.');
      const mapped = mappedPartIds(exported,selectedPart);
      const result = await adapter.renderEngravedStaff(container, exported.xml, {dark:lastDark,fromMeasure:from,toMeasure:to,partIds:mapped,responsive:true,onError:failure=>{if(current===generation&&active)fallback(failure.message)}}, signal);
      if (signal.aborted || current !== generation || !active) { result.dispose?.(); return; }
      if (!result.ok) { if (result.status !== 'cancelled') fallback(result.message); return; }
      rendered = result;
      $('engraving-status').textContent = `Generated staff preview · Measures ${result.metadata.fromMeasure}–${result.metadata.toMeasure}. Static display; playback and assessment use the Rust timeline.`;
      $('engraving-diagnostics').replaceChildren();
      for (const diagnostic of exported.diagnostics || []) { const item=document.createElement('li'); item.textContent=diagnostic.message; $('engraving-diagnostics').append(item); }
      $('engraving-license-note').hidden = false;
    } catch (error) { if (current === generation && !signal.aborted && active && error.name !== 'AbortError') fallback(error.message || 'The optional renderer is unavailable in this build.'); }
  }
  function show() {
    if (!getScore()) return;
    score = getScore(); selectedPart = getPracticePart(); from = 1; active = true; preferred = true;
    setParts(); onVisibility(true); render();
  }
  function hide({remember=false}={}) { if(remember){preferred=false;$('engraving-fallback').hidden=true;} active = false; cancel(); container.replaceChildren(); onVisibility(false); }
  function updateScore() {
    const current = getScore(); $('export-musicxml').disabled = !current;
    if (current === score) return;
    score = current; cached = null; from = 1; selectedPart = getPracticePart(); setParts(); rangeControls();
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
  return {show,hide,updateScore,selectPart,isActive:()=>active,
    navigationState:()=>({from,ready:Boolean(rendered)}),
    followMeasure(index){if(!active||!score||!Number.isInteger(index)||index<0||index>=score.measures.length)return false;const page=sourceMeasurePage(index,pageSize);if(page===from)return false;from=page;render({automatic:true});return true}
  };
}

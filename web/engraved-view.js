import {isBasicKeysSong,hasBasicKeyRendition} from './clean-song-package.js';
import {basicKeyNotationRequest,basicKeyNotationPage,basicKeyEngravingIdentity} from './basic-key-notation.js';
import {sourceMeasurePage,notationRevealViewport,notationScrollViewport} from './notation-follow.js';
import {planEngravingReveal} from './engraving-reveal.js';
import {getAppI18n} from './app-locale.js';
import notationMessages from './locales/notation-runtime-schema.js';
const presentationError=(key,messageParams={})=>Object.assign(new Error(getAppI18n().t(`notationRuntime.${key}`,messageParams)),{code:`engraving_${key}`,messageKey:`notationRuntime.${key}`,messageParams});
export function engravingWindow(total, from = 1, count = 8) {
  if (!Number.isInteger(total) || total < 0 || !Number.isInteger(from) || from < 1 || !Number.isInteger(count) || count < 1 || count > 64 || (total && from > total)) throw presentationError('window');
  return {total, from, to:Math.min(total,from+count-1)};
}
export function mappedPartIds(exported, canonicalId) {
  if (canonicalId === null) return null;
  const map = exported.part_id_map;
  if (!map || !Object.hasOwn(map,canonicalId) || typeof map[canonicalId] !== 'string' || !map[canonicalId]) throw presentationError('partMap');
  return [map[canonicalId]];
}
/** Optional presentation surface. All score conversion and timing stay in Rust. */
export function setupEngravedView({getScore, getCleanSong=()=>null, getPracticePart, onVisibility, onFallback, notice, onManualNavigation=()=>{},onBasicPage=()=>{},isVisible=()=>true,loadAdapter=()=>import('./engraving.js'),document=globalThis.document,i18n=getAppI18n(document)}) {
  const $ = id => document.getElementById(id);
  const t=(key,params)=>i18n.t(`notationRuntime.${key}`,params);
  const errorText=value=>{
    const own=value?.messageKey&&Object.hasOwn(notationMessages,value.messageKey);
    const message=own?i18n.t(value.messageKey,value.messageParams||{}):typeof value?.message==='string'?t('technical',{detail:value.message}):typeof value==='string'?t('technical',{detail:value}):t('unknownFailure');
    return message+(own&&typeof value.cause?.message==='string'?' '+t('technical',{detail:value.cause.message}):'');
  };
  let allPartsOption=null,statusMessage=null,fallbackReason=null,noticeState=null;
  for(const id of ['engraving-range','engraving-status','engraving-fallback'])$(id)?.removeAttribute?.('data-i18n');
  let active = false, preferred = true, score = null, selectedPart = null, from = 1, pageSize = 8;
  let generation = 0, controller = null, cached = null, adapter = null, rendered = null, sourcePage = null, rendering = false, followFailure = null;
  const basicSong=()=>isBasicKeysSong(getCleanSong())?getCleanSong():null;
  const totalMeasures=()=>basicSong()?(sourcePage?.total_measures||0):(score?.measures.length||0);
  function displayMeter(){const value=$('engraving-basic-meter')?.value;if(!value||value==='source')return null;const[numerator,denominator]=value.split('/').map(Number);return{numerator,denominator};}
  let expected=null,expectedScore=null,knownScore=null,knownIds=new Set();
  let lastReveal='',revealStatus={status:'unavailable'};
  let lastDark = document.documentElement.dataset.theme === 'dark';
  const container = $('engraved-staff');
  $('notation')?.before?.($('engraving-basic-controls'));
  const renditionRows=new Map();let expectedRenditionIds=[];
  const isRenditionPage=()=>sourcePage?.view_version===2;
  const sourceInspection=()=>hasBasicKeyRendition(basicSong())&&$('engraving-basic-view-mode')?.value==='source';
  const markRenditionRows=ids=>{const activeIds=new Set(ids);for(const[id,row]of renditionRows){row.classList?.toggle('active',activeIds.has(id));row.setAttribute?.('aria-current',String(activeIds.has(id)));}};
  function cancel() { generation++;rendering=false;lastReveal='';revealStatus={status:'unavailable'}; controller?.abort(); controller = null; rendered?.dispose(); rendered = null; adapter?.disposeEngravedStaff(container); }
  function hasNoteMapping(){return ['mappingStatus','setExpectedWrittenNotes','clearExpectedWrittenNotes'].every(name=>typeof rendered?.[name]==='function')}
  function mappingStatus(){return hasNoteMapping()?rendered.mappingStatus():{status:'unavailable',verifiedGlyphCount:0,diagnostics:rendered?[{code:'engraving_note_mapping_unavailable',message:t('mappingUnavailable')}]:[]}}
  function clearExpectedWrittenNotes(){expected=null;expectedScore=null;lastReveal='';expectedRenditionIds=[];markRenditionRows([]);return hasNoteMapping()?rendered.clearExpectedWrittenNotes():false}
  function revealRenditionEvents(ids){
    if(!isRenditionPage()||!$('engraving-follow').checked||!isVisible())return null;
    const rows=(ids||[]).map(id=>renditionRows.get(id)).filter(Boolean);if(!rows.length)return null;
    const list=$('basic-rendition-events-list'),dock=$('notation-dock'),top=rows[0].offsetTop-list.offsetTop;
    if(Number.isFinite(top))list.scrollTop=Math.max(0,top);
    try{const rects=rows.map(row=>row.getBoundingClientRect()).map(rect=>({left:rect.left,right:rect.right,top:rect.top,bottom:rect.bottom})),plan=planEngravingReveal(rects,notationRevealViewport(dock,list));if(plan){const viewport=notationScrollViewport(dock);if(plan.scrollTop!==viewport.scrollTop)viewport.scrollTo({top:plan.scrollTop,left:viewport.scrollLeft,behavior:'instant'});}}
    catch{/* Geometry is optional; stable row highlighting remains available. */}
    return{status:'ready'};
  }
  function revealExpectedWrittenNotes(occurrenceId,sourceMeasureIndex){
    sourceMeasureIndex=sourceMeasureIndex===undefined?expected?.sourceMeasureIndex:basicSong()?sourceMeasureIndex-(sourcePage?.first_measure||0):sourceMeasureIndex;
    if(isRenditionPage()&&$('engraving-follow').checked&&active&&isVisible()&&expectedScore===score){
      const marker=revealRenditionEvents(expectedRenditionIds);if(marker&&(!rendered||!expected?.sourceNoteIds.length))return marker;
    }
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
      const viewport=notationScrollViewport(dock);
      if(plan.scrollTop!==viewport.scrollTop)viewport.scrollTo({top:plan.scrollTop,left:viewport.scrollLeft,behavior:'instant'});
      if(plan.scrollLeft!==scroller.scrollLeft)scroller.scrollTo({left:plan.scrollLeft,top:scroller.scrollTop,behavior:'instant'});
      return revealStatus={status:plan.partial||bounds.status==='partial'?'partial':'ready'};
    }catch{return revealStatus} // Optional presentation failures never break the playback frame.
  }
  function setExpectedWrittenNotes(value){
    const current=getScore();if(!active||!current||score!==current){clearExpectedWrittenNotes();return false}
    if(isRenditionPage()){
      const ids=value?.sourceNoteIds,measure=value?.sourceMeasureIndex-sourcePage.first_measure,available=new Set((sourcePage.interpreted_notes||[]).map(note=>note.note_id));
      if(!Array.isArray(ids)||new Set(ids).size!==ids.length||ids.some(id=>!available.has(id))||!Number.isInteger(measure)||measure<0||measure>=sourcePage.measures.length){clearExpectedWrittenNotes();return false;}
      expectedRenditionIds=[...ids];markRenditionRows(ids);const glyphs=new Set((sourcePage.score?.parts[0]?.notes||[]).map(note=>note.id));expected={sourceNoteIds:ids.filter(id=>glyphs.has(id)),sourceMeasureIndex:measure};expectedScore=current;
      if(hasNoteMapping())rendered.setExpectedWrittenNotes(expected);return true;
    }
    if(knownScore!==current){knownScore=current;knownIds=new Set(current.parts.flatMap(part=>part.notes.map(note=>note.id)))}
    const ids=value?.sourceNoteIds,measure=basicSong()?value?.sourceMeasureIndex-(sourcePage?.first_measure||0):value?.sourceMeasureIndex,view=basicSong()?sourcePage?.score:current;
    if(!Array.isArray(ids)||ids.some(id=>typeof id!=='string'||!knownIds.has(id))||new Set(ids).size!==ids.length||!Number.isInteger(measure)||measure<0||measure>=(view?.measures.length||0)){expected=null;expectedScore=null;lastReveal='';if(hasNoteMapping())rendered.setExpectedWrittenNotes(value);return false}
    expected={sourceNoteIds:[...ids],sourceMeasureIndex:measure};expectedScore=current;return rendered?(hasNoteMapping()?rendered.setExpectedWrittenNotes(expected):false):true;
  }
  const diagnosticKeys={engraving_note_mapping_unavailable:'mappingUnavailable',engraving_note_identity_ambiguous:'identityAmbiguous',engraving_note_identity_missing:'identityMissing',engraving_shared_glyph:'sharedGlyph',engraving_expected_notes_invalid:'expectedInvalid',engraving_glyph_stale:'glyphStale'};
  function paintNotices(){
    if(!noticeState)return;
    for(const {diagnostic,node} of noticeState.rows){
      node.textContent=diagnostic.code==='engraving_note_mapping_partial'?t('mappingPartial',{verified:noticeState.mapping.verifiedGlyphCount,displayed:noticeState.mapping.displayedSegmentCount}):Object.hasOwn(diagnosticKeys,diagnostic.code)?t(diagnosticKeys[diagnostic.code]):errorText(diagnostic);
    }
    if($('dock-warning-count'))$('dock-warning-count').textContent=t('noticeCount',{count:noticeState.rows.length});
  }
  function showNotices(exported,mapping){
    const diagnostics=[...(exported.diagnostics||[]),...(mapping?.diagnostics||[])];
    if(mapping?.status==='partial')diagnostics.push({code:'engraving_note_mapping_partial'});
    const unique=[...new Map(diagnostics.map(item=>[`${item.code}:${item.message}`,item])).values()];$('engraving-diagnostics').replaceChildren();
    noticeState={mapping,rows:unique.map(diagnostic=>{const node=document.createElement('li');$('engraving-diagnostics').append(node);return {diagnostic,node}})};
    paintNotices();
  }
  // Redraw retained presentation only. Never call render(), exportScore(), reveal or navigation here.
  function redrawLocale(){
    if(allPartsOption)allPartsOption.textContent=t('allParts');
    const basic=basicSong();
    if($('engraving-basic-controls'))$('engraving-basic-controls').hidden=!basic;
    if($('engraving-basic-view-mode-label')){$('engraving-basic-view-mode-label').hidden=!hasBasicKeyRendition(basic);$('engraving-basic-view-mode-title').textContent=i18n.locale==='en'?'Displayed interpretation':'显示解释';const options=$('engraving-basic-view-mode')?.querySelectorAll?.('option');if(options?.length===2){options[0].textContent=i18n.locale==='en'?'Playable interpretation · all targets':'可播放解释 · 全部目标';options[1].textContent=i18n.locale==='en'?'Source-only inspection · proved subset':'仅源数据检查 · 已确定子集';}}
    if($('engraving-basic-meter-label'))$('engraving-basic-meter-label').textContent=t('basicMeterLabel');
    const sourceOption=$('engraving-basic-meter')?.querySelector?.('option[value=source]');if(sourceOption)sourceOption.textContent=t('basicSourceMeter');
    if($('engraving-basic-provenance'))$('engraving-basic-provenance').textContent=basic?t(hasBasicKeyRendition(basic)&&!sourceInspection()?'basicRenditionView':'basicView')+(sourcePage?.meter_origin==='source'?t('basicAuthoredMeter'):sourcePage?.meter_origin?.includes('chosen')?t('basicDisplayMeter'):'')+(sourcePage?.tempo_origin==='smf_default_presentation'?t('basicDefaultTempo'):'')+(['ready','rendering_unavailable'].includes(sourcePage?.status)&&sourcePage.key_origin!=='source'?t('basicUnknownKey'):''):'';
    if($('engraving-basic-meter'))$('engraving-basic-meter').disabled=Boolean(basic&&basic.score.performance.timing.meter==='source_declared'&&basic.notation.meters[0]?.at.numerator===0);
    const coverage=sourcePage?.coverage;
    if($('engraving-basic-coverage'))$('engraving-basic-coverage').textContent=basic&&coverage?(sourcePage.status==='ready'?t('basicCoverage',{source:coverage.source_attacks,part:coverage.part_attacks,window:coverage.window_attacks,rendered:coverage.rendered_positive_keys,unresolved:coverage.unresolved_attacks,instantaneous:coverage.instantaneous_attacks,continuations:sourcePage.continuations.length}):t('basicSourceCoverage',{source:coverage.source_attacks,part:coverage.part_attacks})):'';
    if($('engraving-basic-attacks-label'))$('engraving-basic-attacks-label').textContent=t('basicAttackDetails');
    if($('basic-rendition-events')){
      const items=isRenditionPage()?(sourcePage.interpreted_notes||[]).filter(item=>item.display_kind!=='interval'||sourcePage.status==='rendering_unavailable'):[];
      $('basic-rendition-events').hidden=!items.length;renditionRows.clear();$('basic-rendition-events-list').replaceChildren();$('basic-rendition-events-title').textContent=i18n.locale==='en'?'Interpreted targets · shared playback and scoring IDs':'解释目标 · 与播放和评分共用标识';
      for(const item of items){const row=document.createElement('li');row.className='basic-rendition-event score-note';if(!row.dataset)row.dataset={};row.dataset.noteId=item.note_id;row.dataset.role=item.role;row.dataset.displayKind=item.display_kind;const start=i18n.formatNumber(item.start_ms/1000,{maximumFractionDigits:3}),end=i18n.formatNumber(item.end_ms/1000,{maximumFractionDigits:3});row.textContent=i18n.locale==='en'?`${item.role==='percussion_selector'?'Percussion selector':'MIDI key'} ${item.key} · ${start}–${end} s · ${item.synthetic_gate?'20 ms onset marker':'interpreted gate'} · ${item.note_id}`:`${item.role==='percussion_selector'?'打击乐选择键':'MIDI 键'} ${item.key} · ${start}～${end} 秒 · ${item.synthetic_gate?'20 毫秒起音标记':'解释门限'} · ${item.note_id}`;$('basic-rendition-events-list').append(row);renditionRows.set(item.note_id,row);}
    }
    if($('engraving-basic-attack-list')){
      const items=basic&&sourcePage?[...sourcePage.unresolved.map(item=>[item,'basicUnresolved']),...sourcePage.instantaneous.map(item=>[item,'basicInstantaneous'])]:[];
      $('engraving-basic-attack-list').replaceChildren();
      for(const[item,state]of items){const node=document.createElement('li');node.textContent=t('basicAttack',{id:item.note_id,key:item.key,beat:`${item.source_at.numerator}/${item.source_at.denominator}`,state:t(state)});$('engraving-basic-attack-list').append(node);}
      const continued=basic&&sourcePage?sourcePage.continuations:[];
      for(const item of continued){const node=document.createElement('li');node.textContent=t('basicContinuation',{id:item.note_id,from:`${item.source_start.numerator}/${item.source_start.denominator}`,to:`${item.source_end.numerator}/${item.source_end.denominator}`});$('engraving-basic-attack-list').append(node);}
      if($('engraving-basic-attacks'))$('engraving-basic-attacks').hidden=!items.length&&!continued.length;
    }
    $('export-musicxml').title=basic?t('basicExportUnavailable'):'';
    rangeControls();
    if(statusMessage)$('engraving-status').textContent=t(statusMessage.key,statusMessage.params);
    paintNotices();
    if(fallbackReason!==null){$('engraving-fallback').textContent=t('fallback',{reason:errorText(fallbackReason)});if($('dock-warning-count'))$('dock-warning-count').textContent=t('noticeError')}
    else if(statusMessage?.key==='preparing'&&$('dock-warning-count'))$('dock-warning-count').textContent=t('noticePreparing');
    $('notation-dock')?.setAttribute?.('aria-label',t('scrollArea'));
  }
  function setParts() {
    $('engraving-part').replaceChildren();
    const all = document.createElement('option'); all.value = ''; allPartsOption=all; all.textContent = t('allParts'); if(!basicSong())$('engraving-part').append(all);
    for (const part of score?.parts || []) { const option = document.createElement('option'); option.value = part.id; option.textContent = part.name; $('engraving-part').append(option); }
    if (selectedPart !== null && !score?.parts.some(part => part.id === selectedPart)) selectedPart = null;
    if(basicSong()&&selectedPart===null)selectedPart=score?.parts.find(part=>part.instrument!=='midi-percussion-key-number'&&part.notes.length)?.id||score?.parts[0]?.id||null;
    $('engraving-part').value = selectedPart || '';
  }
  function rangeControls() {
    const {total,to} = engravingWindow(totalMeasures(),from,pageSize);
    $('engraving-range').textContent = total ? t('pageRange',{from,to,total}) : t('noMap');
    $('engraving-prev').disabled = from <= 1;
    $('engraving-next').disabled = to >= total;
    return {total, to};
  }
  async function exportScore(target, signal, positionMs=null) {
    const song=basicSong(),request=song?basicKeyNotationRequest(song,{partId:selectedPart,from,count:pageSize,displayMeter:displayMeter(),positionMs,sourceOnly:sourceInspection()}):null;
    const key=request?JSON.stringify(request):null;
    if (cached?.score === target&&cached.key===key) return cached.result;
    const response = await fetch(song?'/api/library/basic-keys/notation':'/api/export/musicxml', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(request||target),signal});
    let result; try { result = await response.json(); } catch { throw presentationError('exportUnreadable'); }
    if (!response.ok) {if(typeof result?.error==='string'&&result.error)throw new Error(result.error);throw presentationError('exportHttp',{status:response.status})}
    if(song){const page=basicKeyNotationPage(result,request,song);result={...(page.musicxml||{}),diagnostics:[...(page.musicxml?.diagnostics||[]),...(page.diagnostics||[])],basicPage:page};}
    if ((!result.basicPage||result.basicPage.status==='ready')&&(typeof result?.xml !== 'string' || !result.part_id_map)) throw presentationError('exportIncomplete');
    if (!signal?.aborted && getScore() === target&&(!song||getCleanSong()===song)) cached = {score:target,key,result};
    return result;
  }
  function fallback(reason) {
    if (!active) return;
    hide(); fallbackReason=reason??presentationError('unknownFailure'); redrawLocale(); $('engraving-fallback').hidden = false; onFallback();
    if($('dock-warning-count')){$('dock-warning-count').hidden=false;$('dock-warning-count').textContent=t('noticeError');}
  }
  async function render(positionMs=null, navigationOnly=false) {
    if ((!active&&!navigationOnly) || !score || !isVisible()) return;
    cancel(); rendering=true;followFailure=null; const current = generation; controller = new AbortController(); const signal = controller.signal; const target = score;
    fallbackReason=null;$('engraving-fallback').hidden = true; if(!navigationOnly)onVisibility(true); rangeControls();statusMessage={key:'preparing'}; $('engraving-status').textContent = t('preparing');
    noticeState=null;$('engraving-diagnostics').replaceChildren();if($('dock-warning-count'))$('dock-warning-count').textContent=t('noticePreparing');
    try {
      const exported = await exportScore(target, signal, positionMs);
      if (signal.aborted || current !== generation || (!active&&!navigationOnly) || target !== getScore()) return;
      if(exported.basicPage){sourcePage=exported.basicPage;from=sourcePage.first_measure+1;rangeControls();redrawLocale();onBasicPage(sourcePage);if(sourcePage.status!=='ready'){statusMessage={key:({display_meter_required:'basicNeedsMeter',percussion_mapping_required:'basicPercussion',percussion_selectors:'basicSelectorPage',onset_page:'basicOnsetPage',empty_page:'basicEmpty',page_limit:'basicPageLimit',rendering_unavailable:'basicRenderingUnavailable'})[sourcePage.status]};showNotices({...exported,diagnostics:sourcePage.diagnostics},null);redrawLocale();return;}}
      if(navigationOnly)return;
      adapter ||= await loadAdapter();
      if (signal.aborted || current !== generation || !active) return;
      const {total,to} = rangeControls();
      if (!total) throw presentationError('missingMap');
      const mapped = mappedPartIds(exported,selectedPart);
      const viewScore=exported.basicPage?.score||target;
      const result = await adapter.renderEngravedStaff(container, exported.xml, {i18n,dark:lastDark||Boolean(document.getElementById('workspace')?.classList?.contains('notation-on-lanes')),fromMeasure:exported.basicPage?1:from,toMeasure:exported.basicPage?viewScore.measures.length:to,partIds:mapped,responsive:true,compactHeader:true,
        identity:exported.basicPage?basicKeyEngravingIdentity(basicSong(),exported.basicPage):{score:viewScore,noteMap:exported.note_id_map,partIdMap:exported.part_id_map,voiceIdMap:exported.voice_id_map},
        onMappingChange:mapping=>{if(current===generation&&active&&getScore()===target)showNotices(exported,mapping)},
        onError:failure=>{if(current===generation&&active&&getScore()===target)fallback(failure)}}, signal);
      if (signal.aborted || current !== generation || !active || target !== getScore()) { result.dispose?.(); return; }
      if (!result.ok) { if (result.status !== 'cancelled') fallback(result); return; }
      rendered = result;
      if(expectedScore===target&&expected&&hasNoteMapping())rendered.setExpectedWrittenNotes(expected);
      statusMessage={key:'preview',params:{from:exported.basicPage?from:result.metadata.fromMeasure,to:exported.basicPage?from+viewScore.measures.length-1:result.metadata.toMeasure}};$('engraving-status').textContent = t(statusMessage.key,statusMessage.params);
      showNotices(exported,mappingStatus());
      $('engraving-license-note').hidden = false;
    } catch (error) { if (current === generation && !signal.aborted && error.name !== 'AbortError'){if(basicSong())followFailure=error;if(active)fallback(error);else if(basicSong()){statusMessage={key:'basicFollowUnavailable'};redrawLocale();onBasicPage(null);}} }
    finally{if(current===generation)rendering=false;}
  }
  function show() {
    if (!getScore()) return;
    if(score!==getScore()){score=getScore();if($('engraving-basic-view-mode'))$('engraving-basic-view-mode').value='rendition';selectedPart=getPracticePart();from=1;sourcePage=null;cached=null;followFailure=null;if($('engraving-basic-meter'))$('engraving-basic-meter').value=hasBasicKeyRendition(basicSong())&&basicSong().score.performance.timing.meter!=='source_declared'?'4/4':'source';}
    active = true; preferred = true;
    setParts();redrawLocale(); onVisibility(true); render();
  }
  function hide({remember=false}={}) { if(remember){preferred=false;fallbackReason=null;$('engraving-fallback').hidden=true;}clearExpectedWrittenNotes();active = false; cancel(); container.replaceChildren(); onVisibility(false); }
  function updateScore() {
    const current = getScore(); $('export-musicxml').disabled = !current||Boolean(basicSong());
    if (current === score){redrawLocale();return;}
    clearExpectedWrittenNotes();score = current;if($('engraving-basic-view-mode'))$('engraving-basic-view-mode').value='rendition'; cached = null; sourcePage=null;followFailure=null; if($('engraving-basic-meter'))$('engraving-basic-meter').value=hasBasicKeyRendition(basicSong())&&basicSong().score.performance.timing.meter!=='source_declared'?'4/4':'source'; from = 1; selectedPart = getPracticePart(); setParts();redrawLocale(); rangeControls();
    if (active || preferred) {active=true;render();}
  }
  function selectPart(part) { onManualNavigation(); selectedPart = part; if(basicSong()){from=1;sourcePage=null;}setParts(); if (active||basicSong()) render(null,!active); }
  $('engraving-part').addEventListener('change', () => { onManualNavigation(); selectedPart=$('engraving-part').value || null;if(basicSong()){from=1;sourcePage=null;}render(); });
  $('engraving-page-size').addEventListener('change', () => { onManualNavigation(); pageSize=Number($('engraving-page-size').value); from=Math.floor((from-1)/pageSize)*pageSize+1; render(); });
  $('engraving-prev').addEventListener('click', () => { onManualNavigation(); from=Math.max(1,from-pageSize);render(); });
  $('engraving-next').addEventListener('click', () => { onManualNavigation(); if(from+pageSize<=totalMeasures()){from+=pageSize;render()} });
  $('export-musicxml').addEventListener('click', async () => {
    const target=getScore(); if(!target||basicSong())return;
    const button=$('export-musicxml'); button.disabled=true;
    try {
      const exported=await exportScore(target);
      if(target!==getScore())return;
      const url=URL.createObjectURL(new Blob([exported.xml],{type:'application/vnd.recordare.musicxml+xml'}));const link=document.createElement('a');link.href=url;link.download=`${target.id.replace(/[^\w.-]/g,'_')}.musicxml`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
      notice(()=>t('exported'));
    }catch(error){if(target===getScore())notice(()=>t('exportFailed',{reason:errorText(error)}),true)}finally{button.disabled=!getScore()||Boolean(basicSong())}
  });
  $('engraving-basic-meter')?.addEventListener('change',()=>{onManualNavigation();from=1;sourcePage=null;cached=null;followFailure=null;redrawLocale();if(active)render();});
  $('engraving-basic-view-mode')?.addEventListener('change',()=>{onManualNavigation();from=1;sourcePage=null;cached=null;followFailure=null;redrawLocale();void render(null,!active);onBasicPage(null);});
  const observer=new MutationObserver(()=>{const dark=document.documentElement.dataset.theme==='dark';if(dark!==lastDark){lastDark=dark;if(active)render()}});observer.observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});
  window.addEventListener('pagehide',cancel);window.addEventListener('pageshow',event=>{if(event.persisted&&active)render()});
  const dock=$('notation-dock');
  if(dock?.setAttribute){dock.setAttribute('tabindex','0');dock.setAttribute('aria-label',t('scrollArea'))}
  const manualScroll=()=>{if($('engraving-follow').checked){lastReveal='';onManualNavigation()}};
  dock?.addEventListener('notationmanualscroll',manualScroll);
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
  i18n.subscribe(redrawLocale);
  redrawLocale();
  return {show,hide,updateScore,selectPart,sourceInspection,revealRenditionEvents,basicPage:()=>sourcePage,turnBasicPage(direction){if(!basicSong())return;onManualNavigation();const next=from+direction*pageSize;if(next<1||next>totalMeasures())return;from=next;void render(null,!active);},followPosition(position){
      const song=basicSong();if(!song)return null;
      if(!song.compilation)return{status:'unavailable'};
      if(sourceInspection()&&!song.score.performance.timing.relative_clock_available)return{status:'unavailable'};
      if(!Number.isFinite(position))return{status:'unavailable'};
      const duration=sourceInspection()?song.runtime.rendition.source_duration_ms:song.compilation.timeline.duration_ms,ended=position>=duration;
      if(position<0||duration<=0)return{status:'end'};
      position=Math.min(position,duration);
      if(followFailure)return{status:'unavailable',error:followFailure};
      if(rendering)return{status:'pending'};
      if(sourcePage&&!['ready',...(isRenditionPage()?['onset_page','percussion_selectors','rendering_unavailable']:[])].includes(sourcePage.status))return{status:'choice'};
      const pageEnd=sourcePage?.follow_end_ms??sourcePage?.source_end_ms;
      if(!sourcePage||position<sourcePage.source_start_ms||position>=pageEnd&&!(ended&&pageEnd===duration)){void render(position,!active);return{status:'pending'};}
      if(ended)return{status:'end'};
      const measure=sourcePage.measures.find(measure=>position>=measure.start_ms&&position<(measure.follow_end_ms??measure.end_ms));
      return measure?{status:'ready',measure,total:sourcePage.total_measures,ready:!active||Boolean(rendered)||isRenditionPage()&&sourcePage.status!=='ready'}:{status:'unavailable'};
    },setExpectedWrittenNotes,clearExpectedWrittenNotes,revealExpectedWrittenNotes,resetReveal(){lastReveal='';followFailure=null;},mappingStatus,isActive:()=>active,surfaceChanged(){
      lastReveal='';
      // Entering the desktop stage can expose notation and then notify the
      // screen change. Both notifications own the same in-flight render.
      // A genuinely hidden surface cancels below and creates fresh work on return.
      if(active&&isVisible()){if(!controller)render();}else cancel();
    },
    navigationState:()=>({from,ready:Boolean(rendered)||isRenditionPage()&&['onset_page','percussion_selectors','rendering_unavailable'].includes(sourcePage.status)}),
    followMeasure(index){if(!active||!score||!Number.isInteger(index)||index<0||index>=score.measures.length)return false;const page=sourceMeasurePage(index,pageSize);if(page===from)return false;from=page;render();return true}
  };
}

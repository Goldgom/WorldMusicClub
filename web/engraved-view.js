import {notationMeasuresPerRow,revealNotationRows} from './notation-row-window.js';
import {isBasicKeysSong,hasBasicKeyRendition} from './clean-song-package.js';
import {basicKeyNotationRequest,basicKeyNotationPage,basicKeyEngravingIdentity} from './basic-key-notation.js';
import {sourceMeasurePage,notationRevealViewport,notationScrollViewport} from './notation-follow.js';
import {planEngravingReveal} from './engraving-reveal.js';
import {notationScopeRestrictionText} from './notation-scope-controls.js';
import {resolveNotationScope,planNotationPartBatch,loadNotationPartBatch} from './notation-scope.js';
import {createNotationRenderGroup} from './notation-render-group.js';
import {NotationPagePrefetch} from './notation-page-prefetch.js';
import {prepareNotationBatch,notationPreparationWithinBudget} from './notation-prepared-batch.js';
import {readPlaybackClock} from './playback-clock-view.js';
import {notationAudioAdmission} from './engraving-render-scheduler.js';
import {getAppI18n} from './app-locale.js';
import {assertPracticeAssistanceDisplay} from './practice-assistance-display.js';
import {markPracticeNotation} from './practice-stage-display.js';
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
export function setupEngravedView({getScore,getExportScore=getScore, getCleanSong=()=>null, getPracticePart,getPracticeSelection=()=>null,getPracticeDisplay=()=>null,getPracticeAssistanceDisplay=()=>null,getMode=()=>null, onVisibility, onFallback, onRenderComplete=()=>{}, notice, onManualNavigation=()=>{},onBasicPage=()=>{},isVisible=()=>true,loadAdapter=()=>import('./engraving.js'),document=globalThis.document,i18n=getAppI18n(document)}) {
  const $ = id => document.getElementById(id);
  const visualAdmission=notationAudioAdmission(document.defaultView ?? globalThis);
  const loadAdmittedAdapter = signal => visualAdmission.prepareVisual(loadAdapter, signal);
  const t=(key,params)=>i18n.t(`notationRuntime.${key}`,params);
  const errorText=value=>{
    const own=value?.messageKey&&Object.hasOwn(notationMessages,value.messageKey);
    const message=own?i18n.t(value.messageKey,value.messageParams||{}):typeof value?.message==='string'?t('technical',{detail:value.message}):typeof value==='string'?t('technical',{detail:value}):t('unknownFailure');
    return message+(own&&typeof value.cause?.message==='string'?' '+t('technical',{detail:value.cause.message}):'');
  };
  let allPartsOption=null,statusMessage=null,fallbackReason=null,noticeState=null;
  for(const id of ['engraving-range','engraving-status','engraving-fallback'])$(id)?.removeAttribute?.('data-i18n');
  let active = false, preferred = true, score = null, selectedPart = null, from = 1, pageSize = 8;
  let generation = 0, controller = null, cached = null, adapter = null, rendered = null, sourcePage = null, sourcePages=[],sourceBatch=null, rendering = false, followFailure = null;
  let scope='all',scopeChosen=false,firstPart=0,paintedPartIds=[],scopeStatus='pending',practiceContextKey=null;
  const assistanceDisplay=()=>{const value=getMode()==='practice'?getPracticeAssistanceDisplay():null;return value?.assistance?{...value,showMachine:getPracticeDisplay()?.layout!=='solo'&&getPracticeDisplay()?.showOthers!==false}:null;};
  const practiceContext=()=>JSON.stringify([getMode(),getPracticeSelection(),getPracticeDisplay(),assistanceDisplay()?.assistance.plan.selection_digest]);
  const nextPage=new NotationPagePrefetch(),nextRender=new NotationPagePrefetch({dispose:value=>value.dispose()});let lastFollowPosition=null,declinedPreparation=null;
  const basicSong=()=>isBasicKeysSong(getCleanSong())?getCleanSong():null;
  function practiceDisplayRestriction(){const display=getPracticeDisplay();return getMode()==='practice'&&score===getScore()&&getPracticeSelection()?(display?.layout==='solo'?'solo':display?.showOthers===false?'hidden_others':null):null;}
  function resolvedScope(){const selection=score===getScore()?getPracticeSelection():null,humanOnly=Boolean(practiceDisplayRestriction()),resolved=resolveNotationScope({parts:score?.parts||[],scope:humanOnly?'current':basicSong()&&!hasBasicKeyRendition(basicSong())&&!scopeChosen?'part':scope,practiceSelection:selection,practicePartId:getPracticePart(),selectedPartId:selectedPart}),hidden=new Set(getPracticeDisplay()?.hiddenPartIds||[]);if(!hidden.size)return resolved;const partIds=resolved.partIds.filter(id=>!hidden.has(id));return {...resolved,partIds,partId:partIds.length===1?partIds[0]:null,status:partIds.length?resolved.status:'empty'};}
  function partBatch(){return planNotationPartBatch(resolvedScope().partIds,{firstPart,maxParts:4});}
  function publishScope(status=scopeStatus,ids=paintedPartIds){
    scopeStatus=status;paintedPartIds=ids;const stage=$('workspace'),Window=document.defaultView||globalThis.window;if(!stage?.dispatchEvent||!Window?.CustomEvent)return;
    const resolved=resolvedScope(),restriction=practiceDisplayRestriction(),reason=notationScopeRestrictionText(i18n,restriction);for(const id of ['engraving-part','notation-part']){const control=$(id);if(control){control.disabled=Boolean(restriction);control.title=reason;}}stage.dataset.notationScopeRestriction=restriction||'';stage.dataset.notationScope=resolved.scope;stage.dataset.notationRenderStatus=status;stage.dataset.renderedNotationParts=JSON.stringify(ids);stage.dataset.notationLoadMs=String(Math.round(sourceBatch?.load_ms||0));stage.dataset.notationPrefetch=nextPage.peek()?(nextPage.peek().value?'ready':'pending'):'none';const count=sourceBatch?.measureCount||pageSize,total=totalMeasures();stage.dispatchEvent(new Window.CustomEvent('notationscopecontext',{detail:{parts:score?.parts||[],scope:resolved.scope,practiceDisplayRestriction:restriction,practiceSelection:getPracticeSelection(),practicePartId:getPracticePart(),selectedPartId:selectedPart,renderedPartIds:ids,page:Math.floor((from-1)/count)+1,totalPages:Math.max(1,Math.ceil(total/count)),firstPart,maxParts:4,status}}));
  }
  const totalMeasures=()=>basicSong()?(sourcePage?.total_measures||0):(score?.measures.length||0);
  function displayMeter(){const value=$('engraving-basic-meter')?.value;if(!value||value==='source')return null;const[numerator,denominator]=value.split('/').map(Number);return{numerator,denominator};}
  let expected=null,expectedScore=null,knownScore=null,knownIds=new Set();
  let lastReveal='',revealStatus={status:'unavailable'};
  let lastDark = document.documentElement.dataset.theme === 'dark';
  const container = $('engraved-staff');
  const rowMode=()=>Boolean($('workspace')?.classList?.contains('notation-on-lanes'));
  const rowSize=()=>notationMeasuresPerRow(container.clientWidth||800);
  const rowOptions=()=>rowMode()?{measuresPerRow:Math.max(1,Math.min(rowSize(),Math.floor((sourcePage?.measure_count||pageSize)/2)))}:{};
  let rowMeasure=0,rowRevealKey=null,rowRevealResult=null,previewBatch=null,previewFailure=null;
  function rowLayout(){try{
    if(!active)return [...$('notation').querySelectorAll('[data-notation-native-row]')].map((node,index)=>({index,sourceMeasureIndices:Array.from({length:Number(node.dataset.notationMeasureCount)},(_,offset)=>Number(node.dataset.notationNativeRow)+offset),rect:node.getBoundingClientRect()}));
    return (rendered?.systemLayout?.()?.systems||[]).map(row=>basicSong()?{...row,sourceMeasureIndices:row.sourceMeasureIndices.map(index=>index+(sourcePage?.first_measure||0))}:row);
  }catch{return [];}}
  function revealRows(index=rowMeasure){
    if(!rowMode()||active&&!rendered)return null;
    const local=index;
    const key=JSON.stringify([generation,rendered?.renderGeneration?.(),local,expected?.sourceNoteIds||[]]);
    if(key===rowRevealKey)return rowRevealResult;rowRevealKey=key;
    return rowRevealResult=revealNotationRows({systems:rowLayout(),sourceMeasureIndex:local,viewport:notationScrollViewport($('notation-dock')),stage:$('workspace'),horizontalScroller:active?container.closest?.('.engraving-scroll'):$('notation'),expectedRects:rendered?.expectedNoteBounds?.()?.rects||[],more:basicSong()?sourcePage?.next_measure!==null:from+pageSize-1<totalMeasures()});
  }
  function followRows(index){
    rowMeasure=index;
    const plan=revealRows(index);
    if(plan?.nextFrom!==null&&plan?.nextFrom!==undefined){const next=plan.nextFrom+1;if(next>from){from=next;void render(null,!active,{requestFrom:next,measureCount:pageSize});return true;}}
    return false;
  }
  $('notation')?.before?.($('engraving-basic-controls'));
  const renditionRows=new Map();let expectedRenditionIds=[];
  const isRenditionPage=()=>sourcePage?.view_version===2;
  const clockPage=page=>Array.isArray(page?.measures)&&page.measures.length>0&&Number.isFinite(page.source_start_ms)&&Number.isFinite(page.follow_end_ms)&&page.follow_end_ms>page.source_start_ms;
  const needsEngraving=page=>page?.status==='ready'&&(page.score?.parts||[]).some(part=>part.notes.length>0);
  const usablePage=page=>['ready','rendering_unavailable','onset_page','percussion_selectors'].includes(page.status)||page.status==='empty_page'&&clockPage(page);
  const quietMessage=page=>page.status==='rendering_unavailable'?t('basicRenderingUnavailable'):(page.interpreted_notes||[]).length?t(page.status==='percussion_selectors'?'basicSelectorPage':'basicOnsetPage'):i18n.t('notation.empty');
  function quietPart(mount,page){const text=document.createElement('p');text.className='notation-quiet-part';if(!text.dataset)text.dataset={};text.dataset.partId=page.part_id;const name=score.parts.find(part=>part.id===page.part_id)?.name||page.part_id;text.textContent=`${name} · ${quietMessage(page)}`;mount.append(text);}

  const interpretedPages=()=>sourcePages.length?sourcePages:sourcePage?[sourcePage]:[];
  const sourceInspection=()=>hasBasicKeyRendition(basicSong())&&$('engraving-basic-view-mode')?.value==='source';
  const markRenditionRows=ids=>{const activeIds=new Set(ids);for(const[id,row]of renditionRows){const current=activeIds.has(id)&&!['machine','unavailable'].includes(row.dataset.practiceRole);if(row.classList?.contains('active')!==current)row.classList?.toggle('active',current);if(row.getAttribute?.('aria-current')!==String(current))row.setAttribute?.('aria-current',String(current));}};
  function cancel({keepPaint=false,keepPrepared=false}={}) { generation++;if(!keepPaint){previewBatch=null;previewFailure=null;}if(!keepPaint||rendering)controller?.abort();rendering=false;lastReveal='';revealStatus={status:'unavailable'};controller = null;if(!keepPrepared)nextRender.clear();if(!keepPaint){nextPage.clear();rendered?.dispose();rendered=null;adapter?.disposeEngravedStaff(container);} }
  function hasNoteMapping(){return ['mappingStatus','setExpectedWrittenNotes','clearExpectedWrittenNotes'].every(name=>typeof rendered?.[name]==='function')}
  function mappingStatus(){return hasNoteMapping()?rendered.mappingStatus():{status:'unavailable',verifiedGlyphCount:0,diagnostics:rendered?[{code:'engraving_note_mapping_unavailable',message:t('mappingUnavailable')}]:[]}}
  function clearExpectedWrittenNotes({preserveRenditionRows=false}={}){expected=null;expectedScore=null;lastReveal='';expectedRenditionIds=[];if(!preserveRenditionRows)markRenditionRows([]);return hasNoteMapping()?rendered.clearExpectedWrittenNotes():false}
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
    if(rowMode()&&active&&isVisible()){const rows=revealRows();if(rows)return {status:rows.status};}
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
    const display=assistanceDisplay(),ownership=display?assertPracticeAssistanceDisplay(display.assistance,display.ownershipIndex):null;
    if(ownership&&Array.isArray(value?.sourceNoteIds))value={...value,sourceNoteIds:value.sourceNoteIds.filter(id=>ownership.isHumanSource(id))};
    const current=getScore();if(!active||!current||score!==current){clearExpectedWrittenNotes();return false}
    if(isRenditionPage()){
      const ids=value?.sourceNoteIds,measure=value?.sourceMeasureIndex-sourcePage.first_measure,available=new Set(interpretedPages().flatMap(page=>(page.interpreted_notes||[]).map(note=>note.note_id)));
      if(!Array.isArray(ids)||new Set(ids).size!==ids.length||ids.some(id=>!available.has(id))||!Number.isInteger(measure)||measure<0||measure>=sourcePage.measures.length){clearExpectedWrittenNotes();return false;}
      expectedRenditionIds=[...ids];markRenditionRows(ids);const glyphs=new Set(interpretedPages().flatMap(page=>(page.score?.parts[0]?.notes||[]).map(note=>note.id)));expected={sourceNoteIds:ids.filter(id=>glyphs.has(id)),sourceMeasureIndex:measure};expectedScore=current;
      if(hasNoteMapping()&&!rendering)rendered.setExpectedWrittenNotes(expected);return true;
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
    const diagnostics=[...(exported.diagnostics||[]),...(mapping?.diagnostics||[]),...(previewFailure?[{code:'notation_preview_unavailable',message:i18n.locale==='en'?'The adjacent score row is unavailable. The current admitted row is retained; reopen Staff to retry.':'相邻谱行暂不可用，当前已验证的谱行仍然保留。请重新打开五线谱重试。'}]:[])];
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
    for(const node of container.querySelectorAll?.('.notation-quiet-part')||[]){const page=sourcePages.find(page=>page.part_id===node.dataset.partId);if(page)node.textContent=`${score.parts.find(part=>part.id===page.part_id)?.name||page.part_id} · ${quietMessage(page)}`;}
    const coverage=sourcePage?.coverage;
    if($('engraving-basic-coverage'))$('engraving-basic-coverage').textContent=basic&&coverage?(sourcePage.status==='ready'?t('basicCoverage',{source:coverage.source_attacks,part:coverage.part_attacks,window:coverage.window_attacks,rendered:coverage.rendered_positive_keys,unresolved:coverage.unresolved_attacks,instantaneous:coverage.instantaneous_attacks,continuations:sourcePage.continuations.length}):t('basicSourceCoverage',{source:coverage.source_attacks,part:coverage.part_attacks})):'';
    if($('engraving-basic-attacks-label'))$('engraving-basic-attacks-label').textContent=t('basicAttackDetails');
    if($('basic-rendition-events')){
      const items=isRenditionPage()?interpretedPages().flatMap(page=>(page.interpreted_notes||[]).filter(item=>item.display_kind!=='interval'||page.status==='rendering_unavailable').map(item=>({...item,part_id:page.part_id,part_name:score.parts.find(part=>part.id===page.part_id)?.name||page.part_id}))):[];
      $('basic-rendition-events').hidden=!items.length;renditionRows.clear();$('basic-rendition-events-list').replaceChildren();$('basic-rendition-events-title').textContent=i18n.locale==='en'?'Interpreted targets · shared playback and scoring IDs':'解释目标 · 与播放和评分共用标识';
      for(const item of items){const row=document.createElement('li');row.className='basic-rendition-event score-note';if(!row.dataset)row.dataset={};row.dataset.noteId=item.note_id;row.dataset.partId=item.part_id;row.dataset.role=item.role;row.dataset.displayKind=item.display_kind;const machine=getMode()==='practice'&&!(getPracticeSelection()?.part_ids||[getPracticePart()]).includes(item.part_id);row.dataset.practiceRole=machine?'machine':getMode()==='practice'?'human':'listen';if(machine)row.classList.add('machine-note');const start=i18n.formatNumber(item.start_ms/1000,{maximumFractionDigits:3}),end=i18n.formatNumber(item.end_ms/1000,{maximumFractionDigits:3});row.textContent=i18n.locale==='en'?`${item.part_name} · ${item.role==='percussion_selector'?'Percussion selector':'MIDI key'} ${item.key} · ${start}–${end} s · ${item.synthetic_gate?'20 ms onset marker':'interpreted gate'} · ${item.note_id}`:`${item.part_name} · ${item.role==='percussion_selector'?'打击乐选择键':'MIDI 键'} ${item.key} · ${start}～${end} 秒 · ${item.synthetic_gate?'20 毫秒起音标记':'解释门限'} · ${item.note_id}`;$('basic-rendition-events-list').append(row);renditionRows.set(item.note_id,row);}
      const display=assistanceDisplay();if(display&&items.length)markPracticeNotation($('basic-rendition-events-list'),{...display,mode:'practice',layout:getPracticeDisplay()?.layout,showOthers:getPracticeDisplay()?.showOthers});
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
    if(statusMessage){
      const display=assistanceDisplay(),retained=active&&statusMessage.key==='preview'&&display?.showMachine===false&&resolvedScope().partIds.some(id=>display.ownershipIndex.hasMachinePart(id));
      const hint=retained?(i18n.locale==='en'?' Full staff notation stays visible to preserve shared stems, flags and accidentals. Machine falling notes and numbered guides are hidden.':' 为保留共用符干、符尾和变音记号，完整五线谱仍然显示。机器下落音符和简谱提示已隐藏。'):'';
      $('engraving-status').textContent=(statusMessage.literal?statusMessage.literal():t(statusMessage.key,statusMessage.params))+hint;
    }
    paintNotices();
    if(fallbackReason!==null){$('engraving-fallback').textContent=t('fallback',{reason:errorText(fallbackReason)});if($('dock-warning-count'))$('dock-warning-count').textContent=t('noticeError')}
    else if(statusMessage?.key==='preparing'&&$('dock-warning-count'))$('dock-warning-count').textContent=t('noticePreparing');
    $('notation-dock')?.setAttribute?.('aria-label',t('scrollArea'));
  }
  function setParts() {
    $('engraving-part').replaceChildren();
    const all = document.createElement('option'); all.value = ''; allPartsOption=all; all.textContent = t('allParts'); if(!basicSong()||hasBasicKeyRendition(basicSong()))$('engraving-part').append(all);
    for (const part of score?.parts || []) { const option = document.createElement('option'); option.value = part.id; option.textContent = part.name; $('engraving-part').append(option); }
    if (selectedPart !== null && !score?.parts.some(part => part.id === selectedPart)) selectedPart = null;
    if(basicSong()&&!hasBasicKeyRendition(basicSong())&&!scopeChosen&&selectedPart===null)selectedPart=score?.parts.find(part=>part.instrument!=='midi-percussion-key-number'&&part.notes.length)?.id||score?.parts[0]?.id||null;
    const resolved=resolvedScope();if(resolved.scope==='all')selectedPart=null;else if(resolved.scope==='current')selectedPart=resolved.partId;
    $('engraving-part').value = selectedPart || '';
  }
  const rowStep=()=>Math.max(1,Math.min(rowSize(),Math.floor((sourcePage?.measure_count||pageSize)/2)));
  const finalRowStart=()=>Math.max(1,(Math.ceil(totalMeasures()/rowStep())-2)*rowStep()+1);
  function turnRow(direction){
    onManualNavigation();const next=Math.max(1,Math.min(finalRowStart(),from+direction*rowStep()));
    if(next===from)return;from=next;rowMeasure=from-1;rowRevealKey=null;void render(null,!active);
  }
  function rangeControls() {
    const {total,to} = engravingWindow(totalMeasures(),from,sourcePage?.measure_count||pageSize);
    $('engraving-range').textContent = total ? t('pageRange',{from,to,total}) : t('noMap');
    $('engraving-prev').disabled = from <= 1;
    $('engraving-next').disabled = rowMode()?from>=finalRowStart():to >= total;
    return {total, to};
  }
  async function exportScore(target, signal, positionMs=null,{requestFrom=from,measureCount=pageSize,prefetching=false}={}) {
    signal?.throwIfAborted();
    const song=basicSong(),resolved=resolvedScope(),key=song?JSON.stringify([song.identity,song.pitch_mod_identity?.digest||null,song.runtime?.profile,song.runtime?.rendition?.policy_id,resolved.partIds,firstPart,requestFrom,measureCount,displayMeter(),positionMs,sourceInspection()]):null;
    if(cached?.score===target&&cached.key===key)return cached.result;
    if(!prefetching&&song){if(nextPage.peek()?.key===key){const prefetched=await nextPage.take(key);signal?.throwIfAborted();if(prefetched){cached={score:target,key,result:prefetched};return prefetched;}}nextPage.clear();}
    const requestJson=async(path,body)=>{const response=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal});let result;try{result=await response.json();}catch{throw presentationError('exportUnreadable');}if(!response.ok){if(typeof result?.error==='string'&&result.error)throw new Error(result.error);throw presentationError('exportHttp',{status:response.status});}return result;};
    let result;
    if(song){
      const loadStarted=globalThis.performance?.now?.()??Date.now();
      const batch=await loadNotationPartBatch({partIds:resolved.partIds,firstPart,maxParts:4,measureCount,maxTargets:2048,signal,requestPage:async(partId,{measureCount})=>{const request=basicKeyNotationRequest(song,{partId,from:requestFrom,count:measureCount,displayMeter:displayMeter(),positionMs,sourceOnly:sourceInspection()});return basicKeyNotationPage(await requestJson('/api/library/basic-keys/notation',request),request,song);}});
      batch.load_ms=Math.max(0,(globalThis.performance?.now?.()??Date.now())-loadStarted);
      const first=batch.pages[0];
      if(batch.pages.some(page=>page.first_measure!==first.first_measure||page.source_start_ms!==first.source_start_ms||page.source_end_ms!==first.source_end_ms||page.follow_end_ms!==first.follow_end_ms||page.view_version!==first.view_version))throw presentationError('basicPageInvalid');
      result={...(first?.musicxml||{}),basicPage:first,basicPages:batch.pages,basicBatch:batch,diagnostics:batch.pages.flatMap(page=>[...(page.musicxml?.diagnostics||[]),...(page.diagnostics||[])])};
      for(const page of batch.pages)if(page.status==='ready'&&(typeof page.musicxml?.xml!=='string'||!page.musicxml.part_id_map))throw presentationError('exportIncomplete');
    }else{
      result=await requestJson('/api/export/musicxml',target);if(typeof result?.xml!=='string'||!result.part_id_map)throw presentationError('exportIncomplete');
    }
    if(!prefetching&&!signal?.aborted&&getScore()===target&&(!song||getCleanSong()===song))cached={score:target,key,result};return result;
  }
  function prefetchNext(){
    const song=basicSong();if(!hasBasicKeyRendition(song)||sourceInspection()||!sourcePage||sourcePage.next_measure===null||!['ready','partial'].includes(sourceBatch?.status))return;
    const requestFrom=rowMode()&&sourcePage.measure_count>1?sourcePage.first_measure+Math.floor((sourcePage.measure_count-1)/rowStep())*rowStep()+1:sourcePage.next_measure+1,measureCount=sourceBatch.measureCount,target=score,resolved=resolvedScope(),key=JSON.stringify([song.identity,song.pitch_mod_identity?.digest||null,song.runtime?.profile,song.runtime?.rendition?.policy_id,resolved.partIds,firstPart,requestFrom,measureCount,displayMeter(),null,sourceInspection()]);
    const pending=nextPage.prime(key,{requestFrom,measureCount},signal=>exportScore(target,signal,null,{requestFrom,measureCount,prefetching:true}));publishScope();void pending.then(()=>{if(score===target&&isVisible()&&nextPage.peek()?.key===key){publishScope();prepareNextRender();}});
  }
  function playbackRunning(){try{return readPlaybackClock(document).running;}catch{return false;}}
  function preparationContext(){
    const width=container.clientWidth;if(!Number.isFinite(width)||width<=0)return null;
    const dark=lastDark||Boolean($('workspace')?.classList?.contains('notation-on-lanes'));
    return {width:Math.max(320,Math.min(4096,Math.round(width))),dark,key:JSON.stringify([width,dark,resolvedScope(),firstPart,pageSize,displayMeter(),sourceInspection(),practiceContext()])};
  }
  function prepareNextRender(){
    // The published transport clock is a read-only gate. Do not perform visual
    // speculation before Listen has anchored audio, or while it is preparing.
    if(!playbackRunning()){nextRender.clear();return;}
    const queued=nextPage.peek(),context=preparationContext(),song=basicSong(),target=score;
    if(rowMode()||rendering||!active||!isVisible()||!hasBasicKeyRendition(song)||sourceInspection()||!queued?.value||!context||!document.body?.append)return;
    const key=JSON.stringify([queued.key,context.key]);
    if(nextRender.peek()?.key===key||declinedPreparation===key)return;
    nextRender.clear();
    if(!queued.value.basicPages.some(needsEngraving)||!notationPreparationWithinBudget(queued.value)){declinedPreparation=key;return;}
    declinedPreparation=null;
    const exported=queued.value;
    void nextRender.prime(key,{exported,source:target,song,context:context.key,generation,jsonKey:queued.key},async signal=>{
      const current=()=>!signal.aborted&&active&&isVisible()&&target===score&&target===getScore()&&song===basicSong()&&context.key===preparationContext()?.key;
      adapter ||= await loadAdmittedAdapter(signal);if(!current())return null;
      let prepared;
      const owned=()=>prepared?.active&&prepared.ownerGeneration===generation&&rendered===prepared.renderer&&active&&target===getScore();
      prepared=await prepareNotationBatch({document,width:context.width,pages:exported.basicPages.filter(usablePage),signal,isCurrent:current,needsEngraving,quietPart,
        renderPage:(mount,page,pendingSignal)=>adapter.renderEngravedStaff(mount,page.musicxml.xml,{i18n,...rowOptions(),cooperative:true,getPracticeAssistanceDisplay:assistanceDisplay,getHumanPartIds:()=>getMode()==='practice'?getPracticeSelection()?.part_ids:null,dark:context.dark,fromMeasure:1,toMeasure:page.score.measures.length,partIds:mappedPartIds(page.musicxml,page.part_id),responsive:true,compactHeader:true,identity:basicKeyEngravingIdentity(song,page),onMappingChange:mapping=>{if(owned())showNotices(exported,mapping);},onError:failure=>{if(owned())fallback(failure);else if(nextRender.peek()?.controller.signal===signal){declinedPreparation=key;nextRender.clear();}}},pendingSignal)});
      return prepared;
    });
  }
  async function completePaint(current,target,signal,publish=()=>{}) {
    const owns=()=>current===generation&&!signal?.aborted&&active&&target===getScore()&&Boolean(rendered)&&isVisible();
    if(!owns())return false;
    // The renderer releases its own lease before its promise settles. Queued
    // audio may own the gate now; publication and reveal need a fresh lease.
    const lease=visualAdmission.tryVisual()??await visualAdmission.acquireVisual(signal);
    if(!lease)return false;
    try{
      if(!owns())return false;
      publish();rendering=false;
      if(rowMode())revealRows();
      // A display callback is optional and cannot reject a fire-and-forget
      // render, discard good notation, or create a transport frame.
      try{onRenderComplete();}catch{/* Retain the completed staff on presentation failure. */}
      return owns();
    }finally{lease.release();}
  }
  function refreshCompletedPaint(){
    if(rendering||!rendered)return Promise.resolve(false);
    return completePaint(generation,score,controller?.signal).catch(()=>false);
  }
  function fallback(reason) {
    if (!active) return;
    hide(); fallbackReason=reason??presentationError('unknownFailure'); redrawLocale(); $('engraving-fallback').hidden = false; onFallback();
    if($('dock-warning-count')){$('dock-warning-count').hidden=false;$('dock-warning-count').textContent=t('noticeError');}
  }
  async function render(positionMs=null, navigationOnly=false,viewRequest={}) {
    if ((!active&&!navigationOnly) || !score || !isVisible()) return;
    if(rowMode()){pageSize=Math.max(2,pageSize);if(!$('engraving-follow').checked)rowMeasure=from-1;}
    const candidate=nextRender.peek(),keepPrepared=!navigationOnly&&viewRequest.prefetched&&candidate?.metadata.generation===generation&&candidate.metadata.source===score&&candidate.metadata.song===basicSong()&&candidate.metadata.jsonKey===nextPage.peek()?.key&&candidate.metadata.context===preparationContext()?.key;
    cancel({keepPaint:true,keepPrepared});clearExpectedWrittenNotes();rendering=true;followFailure=null;publishScope('pending',paintedPartIds); const current = generation; controller = new AbortController(); const signal = controller.signal; const target = score;
    let prepared=null;
    fallbackReason=null;$('engraving-fallback').hidden = true; if(!navigationOnly)onVisibility(true); rangeControls();statusMessage={key:'preparing'}; $('engraving-status').textContent = t('preparing');
    noticeState=null;$('engraving-diagnostics').replaceChildren();if($('dock-warning-count'))$('dock-warning-count').textContent=t('noticePreparing');
    try {
      const resolved=resolvedScope();if(!resolved.partIds.length){sourcePage=null;sourcePages=[];sourceBatch=null;container.replaceChildren();statusMessage={key:resolved.status==='choose_current_part'?'scopeChooseCurrent':'scopeChoosePart'};redrawLocale();onBasicPage(null,{pages:[],scope:resolved.scope,status:resolved.status});publishScope(resolved.status,[]);return;}
      const exported = await exportScore(target, signal, positionMs,viewRequest);
      if (signal.aborted || current !== generation || (!active&&!navigationOnly) || target !== getScore()) return;
      const stalePrefetched=()=>viewRequest.prefetched&&Number.isFinite(lastFollowPosition)&&exported.basicPage&&(lastFollowPosition<exported.basicPage.source_start_ms||lastFollowPosition>=exported.basicPage.follow_end_ms&&exported.basicPage.follow_end_ms<basicSong().compilation.timeline.duration_ms);
      if(stalePrefetched()){nextRender.clear();void render(lastFollowPosition,navigationOnly);return;}
      if(keepPrepared&&candidate.metadata.exported===exported)prepared=await nextRender.take(candidate.key);
      else nextRender.clear();
      if (signal.aborted || current !== generation || (!active&&!navigationOnly) || target !== getScore()) {prepared?.dispose();return;}
      if(stalePrefetched()){prepared?.dispose();void render(lastFollowPosition,navigationOnly);return;}
      if(exported.basicBatch){
        sourceBatch=exported.basicBatch;sourcePages=exported.basicPages;sourcePage=sourcePages[0]||null;if(sourcePage)from=sourcePage.first_measure+1;previewBatch=null;previewFailure=null;
        if(rowMode()&&sourcePage?.measure_count===1&&sourcePage.total_measures>1){
          const requestFrom=sourcePage.next_measure!==null?sourcePage.next_measure+1:sourcePage.first_measure;
          let adjacent;try{adjacent=await exportScore(target,signal,null,{requestFrom,measureCount:1,prefetching:true});}catch(error){if(signal.aborted)throw error;previewFailure=error;}
          if(signal.aborted||current!==generation||target!==getScore())return;
          if(adjacent?.basicPage&&adjacent.basicPages.length===sourcePages.length&&adjacent.basicPages.every((page,index)=>page.part_id===sourcePages[index].part_id&&usablePage(page)))previewBatch={pages:adjacent.basicPages,firstMeasure:adjacent.basicPage.first_measure};
          else previewFailure ||= presentationError('basicFollowUnavailable');
        }
        rangeControls();redrawLocale();onBasicPage(sourcePage,{...sourceBatch,scope:resolvedScope().scope});
        if(!sourcePage){rendered?.dispose();rendered=null;adapter?.disposeEngravedStaff(container);container.replaceChildren();statusMessage={key:sourceBatch.status==='page_limit'?'scopePageLimit':'scopeEmpty'};redrawLocale();publishScope(sourceBatch.status,[]);return;}
        if((!rowMode()||sourcePage.measure_count<1||!sourcePages.every(usablePage))&&!sourcePages.some(needsEngraving)&&!previewBatch?.pages.some(needsEngraving)){rendered?.dispose();rendered=null;adapter?.disposeEngravedStaff(container);container.replaceChildren();statusMessage={key:({display_meter_required:'basicNeedsMeter',percussion_mapping_required:'basicPercussion',percussion_selectors:'basicSelectorPage',onset_page:'basicOnsetPage',empty_page:'basicEmpty',page_limit:'basicPageLimit',rendering_unavailable:'basicRenderingUnavailable'})[sourcePage.status]||'basicFollowUnavailable'};if(sourcePages.every(usablePage)){for(const page of sourcePages){const mount=document.createElement('div');mount.className='notation-part-render';if(!mount.dataset)mount.dataset={};mount.dataset.notationPartId=page.part_id;quietPart(mount,page);container.append(mount);}const quietPage=sourcePage;statusMessage={literal:()=>quietMessage(quietPage)};}showNotices(exported,null);redrawLocale();publishScope(sourceBatch.status,sourcePages.filter(usablePage).map(page=>page.part_id));prefetchNext();return;}
      }
      if(navigationOnly){publishScope(sourceBatch?.status||'ready',sourcePages.filter(usablePage).map(page=>page.part_id));prefetchNext();return;}
      if(prepared){
        rendered?.dispose();rendered=null;adapter?.disposeEngravedStaff(container);
        if(prepared.activate(container)){
          // keepPaint can retain these nodes into another pending request;
          // only the generation that adopted them owns status/error callbacks.
          prepared.ownerGeneration=current;
          rendered=prepared.renderer;
          await completePaint(current,target,signal,()=>{
            if(expectedScore===target&&expected)rendered.setExpectedWrittenNotes(expected);
            statusMessage={key:'preview',params:{from,to:from+sourcePage.measure_count-1}};redrawLocale();showNotices(exported,mappingStatus());publishScope(sourceBatch.status,sourcePages.filter(usablePage).map(page=>page.part_id));$('engraving-license-note').hidden=false;prefetchNext();
          });return;
        }
        prepared=null;
      }
      adapter ||= await loadAdmittedAdapter(signal);
      if (signal.aborted || current !== generation || !active) return;
      rendered?.dispose();rendered=null;adapter?.disposeEngravedStaff(container);
      if(sourcePages.length>1||rowMode()&&sourcePages.length){
        const members=[];rendered=createNotationRenderGroup(members);container.replaceChildren();
        const rowSpan=Math.max(1,Math.min(rowSize(),Math.floor(sourcePage.measure_count/2)));
        const ranges=rowMode()?Array.from({length:Math.ceil(sourcePage.measure_count/rowSpan)},(_,index)=>({from:index*rowSpan+1,to:Math.min(sourcePage.measure_count,(index+1)*rowSpan),pages:sourcePages,offset:0})):[null];
        if(previewBatch){ranges.push({from:1,to:1,pages:previewBatch.pages,offset:previewBatch.firstMeasure-sourcePage.first_measure});ranges.sort((a,b)=>a.offset-b.offset||a.from-b.from);}
        for(const [rowIndex,range] of ranges.entries()){
          const rowMount=range?document.createElement('section'):container;
          if(range){rowMount.className='notation-system-row';rowMount.dataset.notationSystemRow=String(rowIndex);container.append(rowMount);}
          for(const page of range?.pages||sourcePages){
            if(!usablePage(page))continue;
            const mount=document.createElement('div');mount.className='notation-part-render';if(!mount.dataset)mount.dataset={};mount.dataset.notationPartId=page.part_id;rowMount.append(mount);
            const member={mount,sourceMeasureOffset:range?.offset||0,rowMount:range?rowMount:null,rowIndex:range?rowIndex:null,sourceMeasureIndices:range?Array.from({length:range.to-range.from+1},(_,index)=>range.offset+range.from-1+index):null};
            if(!needsEngraving(page)){quietPart(mount,page);members.push({...member,noteIds:new Set(),renderer:{dispose(){mount.remove?.();},mappingStatus:()=>({status:'ready',verifiedGlyphCount:0,displayedSegmentCount:0,diagnostics:[]}),setExpectedWrittenNotes:()=>true,clearExpectedWrittenNotes:()=>true}});continue;}
            const result=await adapter.renderEngravedStaff(mount,page.musicxml.xml,{i18n,...rowOptions(),cooperative:true,getPracticeAssistanceDisplay:assistanceDisplay,getHumanPartIds:()=>getMode()==='practice'?getPracticeSelection()?.part_ids:null,dark:lastDark||Boolean(document.getElementById('workspace')?.classList?.contains('notation-on-lanes')),singleSystem:Boolean(range),fromMeasure:range?.from||1,toMeasure:range?.to||page.score.measures.length,partIds:mappedPartIds(page.musicxml,page.part_id),responsive:true,compactHeader:true,identity:basicKeyEngravingIdentity(basicSong(),page),onMappingChange:mapping=>{if(current===generation&&active&&getScore()===target)showNotices(exported,mapping)},onError:failure=>{if(current===generation&&active&&getScore()===target)fallback(failure)}},signal);
            if(signal.aborted||current!==generation||!active||target!==getScore()){result.dispose?.();mount.remove?.();return;}
            if(!result.ok){if(result.status!=='cancelled')fallback(result);return;}
            members.push({...member,renderer:result,mount,noteIds:new Set(page.score.parts[0].notes.map(note=>note.id))});
          }
        }
        await completePaint(current,target,signal,()=>{
          if(expectedScore===target&&expected)rendered.setExpectedWrittenNotes(expected);
          statusMessage={key:'preview',params:{from,to:from+sourcePage.measure_count-1}};redrawLocale();showNotices(exported,mappingStatus());publishScope(sourceBatch.status,sourcePages.filter(usablePage).map(page=>page.part_id));$('engraving-license-note').hidden=false;prefetchNext();
        });return;
      }
      const {total,to} = rangeControls();
      if (!total) throw presentationError('missingMap');
      const batch=partBatch(),mapped = basicSong()?mappedPartIds(exported,selectedPart):scope==='all'&&batch.partIds.length===score.parts.length?null:batch.partIds.flatMap(id=>mappedPartIds(exported,id));
      const viewScore=exported.basicPage?.score||target;
      const result = await adapter.renderEngravedStaff(container, exported.xml, {i18n,...rowOptions(),cooperative:true,getPracticeAssistanceDisplay:assistanceDisplay,getHumanPartIds:()=>getMode()==='practice'?getPracticeSelection()?.part_ids:null,dark:lastDark||Boolean(document.getElementById('workspace')?.classList?.contains('notation-on-lanes')),fromMeasure:exported.basicPage?1:from,toMeasure:exported.basicPage?viewScore.measures.length:to,partIds:mapped,responsive:true,compactHeader:true,
        identity:exported.basicPage?basicKeyEngravingIdentity(basicSong(),exported.basicPage):{score:viewScore,noteMap:exported.note_id_map,partIdMap:exported.part_id_map,voiceIdMap:exported.voice_id_map},
        onMappingChange:mapping=>{if(current===generation&&active&&getScore()===target)showNotices(exported,mapping)},
        onError:failure=>{if(current===generation&&active&&getScore()===target)fallback(failure)}}, signal);
      if (signal.aborted || current !== generation || !active || target !== getScore()) { result.dispose?.(); return; }
      if (!result.ok) { if (result.status !== 'cancelled') fallback(result); return; }
      rendered = result;
      await completePaint(current,target,signal,()=>{
        if(expectedScore===target&&expected&&hasNoteMapping())rendered.setExpectedWrittenNotes(expected);
        statusMessage={key:'preview',params:{from:exported.basicPage?from:result.metadata.fromMeasure,to:exported.basicPage?from+viewScore.measures.length-1:result.metadata.toMeasure}};redrawLocale();
        showNotices(exported,mappingStatus());
        $('engraving-license-note').hidden = false;publishScope(sourceBatch?.status||'ready',basicSong()?sourcePages.map(page=>page.part_id):partBatch().partIds);prefetchNext();
      });
    } catch (error) { if (current === generation && !signal.aborted && error.name !== 'AbortError'){if(basicSong())followFailure=error;if(active)fallback(error);else if(basicSong()){statusMessage={key:'basicFollowUnavailable'};redrawLocale();onBasicPage(null,{pages:[],scope:resolvedScope().scope,status:'error'});}publishScope('error',[]);} }
    finally{if(prepared&&!prepared.active)prepared.dispose();if(current===generation)rendering=false;}
  }
  function show() {
    if (!getScore()) return;
    if(score!==getScore()){cancel();score=getScore();scope=getMode()==='practice'&&getPracticeDisplay()?.layout!=='complete'&&getPracticePart()?'current':'all';scopeChosen=false;firstPart=0;if($('engraving-basic-view-mode'))$('engraving-basic-view-mode').value='rendition';selectedPart=getPracticePart();from=1;sourcePage=null;sourcePages=[];sourceBatch=null;cached=null;followFailure=null;if($('engraving-basic-meter'))$('engraving-basic-meter').value=hasBasicKeyRendition(basicSong())&&(basicSong().score.performance.timing.meter!=='source_declared'||basicSong().notation.meters[0]?.at.numerator!==0)?'4/4':'source';}
    active = true; preferred = true;
    setParts();redrawLocale(); onVisibility(true); render();
  }
  function hide({remember=false}={}) { if(remember){preferred=false;fallbackReason=null;$('engraving-fallback').hidden=true;}clearExpectedWrittenNotes();active = false; cancel(); container.replaceChildren(); onVisibility(false); }
  function updateScore() {
    const current = getScore(); $('export-musicxml').disabled = !current||Boolean(basicSong());
    if (current === score){if(practiceContextKey!==practiceContext()){practicePartChanged();return;}if(scope==='current'&&selectedPart!==resolvedScope().partId){practicePartChanged();return;}redrawLocale();publishScope();return;}
    cancel();clearExpectedWrittenNotes();rowMeasure=0;$('workspace')?.style?.removeProperty('--notation-row-height');score = current;practiceContextKey=practiceContext();scope=getMode()==='practice'&&getPracticeDisplay()?.layout!=='complete'&&getPracticePart()?'current':'all';scopeChosen=false;firstPart=0;if($('engraving-basic-view-mode'))$('engraving-basic-view-mode').value='rendition'; cached = null; sourcePage=null;sourcePages=[];sourceBatch=null;followFailure=null; if($('engraving-basic-meter'))$('engraving-basic-meter').value=hasBasicKeyRendition(basicSong())&&(basicSong().score.performance.timing.meter!=='source_declared'||basicSong().notation.meters[0]?.at.numerator!==0)?'4/4':'source'; from = 1; selectedPart = getPracticePart(); setParts();redrawLocale(); rangeControls();publishScope('pending',[]);
    if (active || preferred) {active=true;render();}
  }
  function setScope(value,{manual=true}={}){
    if(manual&&practiceDisplayRestriction()&&value.scope!=='current'){notice(()=>notationScopeRestrictionText(i18n,practiceDisplayRestriction()));publishScope();return;}
    if(manual)onManualNavigation();cancel();scope=value.scope;scopeChosen=manual||scopeChosen;selectedPart=value.selectedPartId??value.partId??null;firstPart=value.firstPart||0;resolvedScope();sourcePage=null;sourcePages=[];sourceBatch=null;cached=null;followFailure=null;setParts();redrawLocale();publishScope('pending',[]);if(active||basicSong())void render(null,!active);
  }
  function selectPart(part){setScope({scope:part===null?'all':'part',partId:part,firstPart:0});}
  function practicePartChanged(){practiceContextKey=practiceContext();if(getPracticeSelection()&&getMode()==='practice'){const display=getPracticeDisplay();setScope({scope:getMode()==='practice'&&(display?.layout==='solo'||display?.showOthers===false)?'current':'all',partId:getPracticePart(),firstPart:0},{manual:false});}else if(scope==='current')setScope({scope:'current',partId:getPracticePart(),firstPart:0},{manual:false});else setScope({scope,selectedPartId:selectedPart,firstPart:0},{manual:false});}
  function modeChanged(){practiceContextKey=practiceContext();if(!scopeChosen)setScope({scope:getMode()==='practice'&&getPracticeDisplay()?.layout!=='complete'&&getPracticePart()?'current':'all',partId:getPracticePart(),firstPart:0},{manual:false});else setScope({scope,selectedPartId:selectedPart,firstPart},{manual:false});}
  function turnBasicPage(direction){if(!basicSong())return;if(rowMode()){turnRow(direction);return;}onManualNavigation();const count=sourceBatch?.measureCount||pageSize,next=direction>0?(sourcePage?.next_measure===null?null:(sourcePage?.next_measure??from-1+count)+1):Math.max(1,from-count);if(next===null||next<1||next>totalMeasures())return;from=next;void render(null,!active);}
  $('engraving-part').addEventListener('change',()=>selectPart($('engraving-part').value||null));
  $('engraving-page-size').addEventListener('change',()=>{onManualNavigation();pageSize=Number($('engraving-page-size').value);from=Math.floor((from-1)/pageSize)*pageSize+1;render(null,!active);});
  $('engraving-prev').addEventListener('click',()=>{if(rowMode()){turnRow(-1);return;}if(basicSong()){turnBasicPage(-1);return;}onManualNavigation();from=Math.max(1,from-pageSize);render();});
  $('engraving-next').addEventListener('click',()=>{if(rowMode()){turnRow(1);return;}if(basicSong()){turnBasicPage(1);return;}onManualNavigation();if(from+pageSize<=totalMeasures()){from+=pageSize;render();}});
  $('export-musicxml').addEventListener('click', async () => {
    const target=getExportScore(); if(!target||basicSong())return;
    const button=$('export-musicxml'); button.disabled=true;
    try {
      const exported=await exportScore(target);
      if(target!==getExportScore())return;
      const url=URL.createObjectURL(new Blob([exported.xml],{type:'application/vnd.recordare.musicxml+xml'}));const link=document.createElement('a');link.href=url;link.download=`${target.id.replace(/[^\w.-]/g,'_')}.musicxml`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
      notice(()=>t('exported'));
    }catch(error){if(target===getExportScore())notice(()=>t('exportFailed',{reason:errorText(error)}),true)}finally{button.disabled=!getExportScore()||Boolean(basicSong())}
  });
  $('engraving-basic-meter')?.addEventListener('change',()=>{onManualNavigation();cancel();from=1;sourcePage=null;sourcePages=[];sourceBatch=null;cached=null;followFailure=null;redrawLocale();if(active)render();});
  $('engraving-basic-view-mode')?.addEventListener('change',()=>{onManualNavigation();cancel();from=1;sourcePage=null;sourcePages=[];sourceBatch=null;cached=null;followFailure=null;redrawLocale();void render(null,!active);onBasicPage(null);});
  const observer=new MutationObserver(()=>{const dark=document.documentElement.dataset.theme==='dark';if(dark!==lastDark){lastDark=dark;if(active)render()}});observer.observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});
  window.addEventListener('pagehide',cancel);window.addEventListener('pageshow',event=>{if(event.persisted&&active)render()});
  const dock=$('notation-dock');
  if(dock?.setAttribute){dock.setAttribute('tabindex','0');dock.setAttribute('aria-label',t('scrollArea'))}
  const manualScroll=()=>{if($('engraving-follow').checked){lastReveal='';onManualNavigation()}};
  dock?.addEventListener('notationmanualscroll',manualScroll);
  dock?.addEventListener('wheel',manualScroll,{passive:true});dock?.addEventListener('touchmove',manualScroll,{passive:true});
  dock?.addEventListener('pointerdown',event=>{if(event.target===dock||event.target?.closest?.('.engraving-scroll,.notation-scroll'))manualScroll()},{passive:true});
  dock?.addEventListener('keydown',event=>{if(!event.defaultPrevented&&!event.altKey&&!event.ctrlKey&&!event.metaKey&&['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','PageUp','PageDown','Home','End',' '].includes(event.key)&&!event.target?.isContentEditable&&!event.target?.closest?.('input,select,textarea,button,summary,[contenteditable]:not([contenteditable="false"])'))manualScroll()});
  const invalidateReveal=()=>{lastReveal='';if(nextRender.peek()?.metadata.context!==preparationContext()?.key)nextRender.clear();};
  window.addEventListener('resize',invalidateReveal);
  // Opening score details can shift the staff without changing the dock's size.
  dock?.addEventListener('toggle',invalidateReveal,true);
  if(dock&&typeof globalThis.ResizeObserver==='function'){
    const resizeObserver=new ResizeObserver(invalidateReveal),surfaces=[dock,container.closest?.('.engraving-scroll'),dock.firstElementChild].filter(Boolean);
    const observe=()=>surfaces.forEach(surface=>resizeObserver.observe(surface));observe();
    window.addEventListener('pagehide',()=>resizeObserver.disconnect());window.addEventListener('pageshow',event=>{if(event.persisted){invalidateReveal();observe()}});
  }
  i18n.subscribe(redrawLocale);
  // Observe only the transport's existing publication. A seek/pause/preparing
  // state cancels speculation, and source position is never written here.
  const clockElement=$('progress');
  if(clockElement?.getAttribute){const clockObserver=new MutationObserver(()=>{if(!playbackRunning())nextRender.clear();});clockObserver.observe(clockElement,{attributes:true,attributeFilter:['data-playback-clock']});}
  for(const type of ['pointerdown','input','keydown'])clockElement?.addEventListener(type,()=>nextRender.clear());
  $('reset-button')?.addEventListener('click',()=>nextRender.clear());
  redrawLocale();
  return {show,hide,updateScore,selectPart,setScope,practicePartChanged,modeChanged,sourceInspection,revealRenditionEvents,
    scopeInfo:()=>({...resolvedScope(),...partBatch(),status:scopeStatus}),displayedPartIds:()=>partBatch().partIds,
    reportPaint(ids,status='ready'){const allowed=new Set(partBatch().partIds);publishScope(status,[...new Set(ids)].filter(id=>allowed.has(id)));},
    basicPage:()=>sourcePage,basicPages:()=>[...sourcePages],basicRowBatches:()=>[...sourcePages.length?[{pages:sourcePages,firstMeasure:sourcePage.first_measure}]:[],...previewBatch?[previewBatch]:[]].sort((a,b)=>a.firstMeasure-b.firstMeasure),basicBatch:()=>sourceBatch,turnBasicPage,
    followPosition(position){
      const song=basicSong();if(!song)return null;
      if(!song.compilation)return{status:'unavailable'};
      if(sourceInspection()&&!song.score.performance.timing.relative_clock_available)return{status:'unavailable'};
      if(!Number.isFinite(position))return{status:'unavailable'};
      if(Number.isFinite(lastFollowPosition)&&position<lastFollowPosition)nextRender.clear();
      lastFollowPosition=position;prepareNextRender();
      const duration=sourceInspection()?song.runtime.rendition.source_duration_ms:song.compilation.timeline.duration_ms,ended=position>=duration;
      if(position<0||duration<=0)return{status:'end'};
      position=Math.min(position,duration);
      if(followFailure)return{status:'unavailable',error:followFailure};
      if(rendering)return{status:'pending'};
      if(sourceBatch?.status==='page_limit'||!resolvedScope().partIds.length)return{status:'choice'};
      if(sourcePage&&!['ready',...(isRenditionPage()?['onset_page','percussion_selectors','rendering_unavailable',...(clockPage(sourcePage)?['empty_page']:[])]:[])].includes(sourcePage.status))return{status:'choice'};
      const pageEnd=sourcePage?.follow_end_ms??sourcePage?.source_end_ms;
      if(!sourcePage||position<sourcePage.source_start_ms||position>=pageEnd&&!(ended&&pageEnd===duration)){const queued=nextPage.peek();if(sourcePage&&position>=pageEnd&&queued){void render(null,!active,{...queued.metadata,prefetched:true});}else void render(position,!active);return{status:'pending'};}
      if(ended)return{status:'end'};
      const measure=sourcePage.measures.find(measure=>position>=measure.start_ms&&position<(measure.follow_end_ms??measure.end_ms));
      if(rowMode()&&measure){const index=sourcePage.measures.indexOf(measure)+sourcePage.first_measure;if(followRows(index))return {status:'pending'};}
      return measure?{status:'ready',measure,total:sourcePage.total_measures,ready:!active||Boolean(rendered)||isRenditionPage()&&!needsEngraving(sourcePage)}:{status:'unavailable'};
    },setExpectedWrittenNotes,clearExpectedWrittenNotes,revealExpectedWrittenNotes,resetReveal(){lastReveal='';rowRevealKey=null;followFailure=null;try{rendered?.refreshExpectedCueGeometry?.();}catch{/* Optional cue geometry cannot alter transport. */}},mappingStatus,isActive:()=>active,surfaceChanged(){
      lastReveal='';rowRevealKey=null;
      // Entering the desktop stage can expose notation and then notify the
      // screen change. Both notifications own the same in-flight render.
      // A genuinely hidden surface cancels below and creates fresh work on return.
      // Jianpu needs its native page even when Staff and optional Follow are off.
      if(isVisible()){if(active){if(!controller)render();}else if(sourcePage){onBasicPage(sourcePage,{...sourceBatch,scope:resolvedScope().scope});publishScope(sourceBatch?.status||'ready',sourcePages.filter(usablePage).map(page=>page.part_id));prefetchNext();}else if(basicSong()){if(!controller)void render(null,true);}else publishScope(resolvedScope().status,partBatch().partIds);}else{cancel();publishScope('hidden',[]);}
    },
    refreshCompletedPaint,
    navigationState:()=>({from,ready:!rendering&&(Boolean(rendered)||isRenditionPage()&&usablePage(sourcePage)&&!needsEngraving(sourcePage))}),
    followMeasure(index){if(!active||!score||!Number.isInteger(index)||index<0||index>=score.measures.length)return false;if(rowMode()){rowMeasure=index;if(rendering)return false;if(index>=from-1&&index<from-1+pageSize){return followRows(index);}from=Math.max(1,Math.min(index+1,Math.max(1,score.measures.length-pageSize+1)));render();return true;}const page=sourceMeasurePage(index,pageSize);if(page===from)return false;from=page;render();return true}
  };
}

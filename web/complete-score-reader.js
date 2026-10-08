import {getAppI18n} from './app-locale.js';
import {isBasicKeysSong,hasBasicKeyRendition} from './clean-song-package.js';
import {basicKeyNotationRequest,basicKeyNotationPage,basicKeyEngravingIdentity} from './basic-key-notation.js';
import {notationAudioAdmission} from './engraving-render-scheduler.js';
import {pitchMidi} from './music.js';

const messages={
 en:{title:'Complete score',close:'Back',more:'Load more score',loading:'Loading the next section…',empty:'This source does not provide notation that this reader can display.',intro:'Scroll through every source part in written order. This reader does not follow playback or change the practice view.',basic:'MIDI notation is a source-bound interpretation. Synthetic onsets, unresolved durations and percussion selectors are shown as events, not invented pitched notes. Source audio, expression and receiver-specific sound are not a complete written score.',meter:'Display meter',sourceMeter:'Use source meter',view:'Notation interpretation',playable:'Playable interpretation · all targets',source:'Source-only inspection · proved subset',chosenMeter:'This meter is a display choice, not an authored source meter.',loadingStatus:({loaded,parts,total})=>`Loaded ${loaded} sections; reached ${parts} of ${total} source parts. More sections are loading.`,partialStatus:({loaded,parts,total})=>`Loaded ${loaded} sections; reached ${parts} of ${total} source parts. Scroll or load more to continue.`,doneStatus:({loaded,total})=>`Reached the end of all ${total} source parts (${loaded} sections).`,stoppedStatus:({loaded,blocked})=>`Loaded ${loaded} sections. ${blocked} source parts could not be browsed to their end.`,limitedStatus:({count})=>` ${count} sections have unavailable notation; full staff coverage is not established.`,coverage:({seen,total,events})=>` Inspected ${seen} of ${total} source attacks; ${events} appear in event details.`,missingCoverage:' Some source attacks have not been represented. Do not treat this as complete notation.',range:({from,to})=>`Source measures ${from}–${to}`,eventDetails:({count})=>`Source event details (${count})`,event:({id,key,at,kind})=>`${id} · key ${key} · source beat ${at} · ${kind}`,synthetic:'synthetic onset; duration is interpreted',percussion:'percussion selector; pitched notation unavailable',unresolved:'unresolved source duration',instantaneous:'instantaneous source attack',interval:'source interval; staff display unavailable',ready:'Staff section ready.',quiet:'No written notes in this section.',display_meter_required:'The source does not declare a usable meter. Choose a display meter above to browse it.',percussion_mapping_required:'Percussion notation needs a receiver mapping. This source part is retained but cannot be drawn as pitched staff notes.',page_limit:'This source measure exceeds the safe page limit. Its notes have not been silently truncated.',rendering_unavailable:'Native source events are available, but this section cannot be engraved.',failed:'This section could not be displayed.',diagnostics:'Source and rendering details',sourceLimits:'Source interpretation limits',error:'Unable to load this source section.',unavailable:'Unavailable',noMeasures:'This source has no written measure map.'},
 zh:{title:'完整乐谱',close:'返回',more:'继续加载乐谱',loading:'正在加载后续乐谱…',empty:'当前来源没有可供此阅读器显示的乐谱。',intro:'按书写顺序滚动浏览全部来源声部。此阅读器不跟随播放，也不改变练习视图。',basic:'MIDI 乐谱是绑定来源的解释。合成起音、未确定时值与打击乐选择器以事件列出，不虚构为有音高的音符。原始音频、表情及接收器音色不能完整还原为书面乐谱。',meter:'显示拍号',sourceMeter:'使用来源拍号',view:'乐谱解释',playable:'可播放解释 · 全部目标',source:'仅源数据检查 · 已确定子集',chosenMeter:'此拍号是显示选择，并非来源创作的拍号。',loadingStatus:({loaded,parts,total})=>`已加载 ${loaded} 个区段，已到达 ${total} 个来源声部中的 ${parts} 个。正在加载后续区段。`,partialStatus:({loaded,parts,total})=>`已加载 ${loaded} 个区段，已到达 ${total} 个来源声部中的 ${parts} 个。滚动或继续加载以浏览后续乐谱。`,doneStatus:({loaded,total})=>`已到达全部 ${total} 个来源声部的末尾（${loaded} 个区段）。`,stoppedStatus:({loaded,blocked})=>`已加载 ${loaded} 个区段。${blocked} 个来源声部尚无法浏览到末尾。`,limitedStatus:({count})=>` ${count} 个区段的乐谱无法显示，尚不能确认五线谱完整覆盖。`,coverage:({seen,total,events})=>` 已检查 ${total} 个来源起音中的 ${seen} 个；其中 ${events} 个包含事件详情。`,missingCoverage:' 仍有来源起音未得到表示，不能将此视为完整记谱。',range:({from,to})=>`来源第 ${from}–${to} 小节`,eventDetails:({count})=>`来源事件详情（${count}）`,event:({id,key,at,kind})=>`${id} · 键号 ${key} · 来源拍位置 ${at} · ${kind}`,synthetic:'合成起音；时值由解释确定',percussion:'打击乐选择器；无法显示为有音高的记谱',unresolved:'来源时值未确定',instantaneous:'瞬时来源起音',interval:'来源音符区间；五线谱显示不可用',ready:'此区段五线谱已就绪。',quiet:'此区段没有书写音符。',display_meter_required:'来源没有可用拍号。请在上方选择显示拍号后继续浏览。',percussion_mapping_required:'打击乐记谱需要接收器映射。此来源声部仍被保留，但不能绘制为有音高的五线谱。',page_limit:'此来源小节超过安全显示上限。没有静默截掉其中的音符。',rendering_unavailable:'已取得来源事件，但此区段无法绘制为五线谱。',failed:'此区段无法显示。',diagnostics:'来源与绘谱详情',sourceLimits:'来源解释限制',error:'无法加载此来源区段。',unavailable:'不可用',noMeasures:'此来源没有书写小节映射。'},
};
const fraction=value=>value?`${value.numerator}/${value.denominator}`:'?';

/** Independent, read-only browsing of all parts, never a transport/follow owner.
 * "End reached" describes traversal, not lossless source/audio or glyph coverage.
 * Every unsupported section is retained with a reason; no failed part is filtered
 * from the inventory. Only the next bounded batch is fetched/rendered on demand.
 */
export function setupCompleteScoreReader({document=globalThis.document,getScore,getExportScore=getScore,getCleanSong=()=>null,loadAdapter=()=>import('./engraving.js'),i18n=getAppI18n(document),fetch:request=globalThis.fetch,onVisibility=()=>{},measureCount=8,maxParts=4}={}){
 if(!document?.body||typeof getScore!=='function'||!Number.isInteger(measureCount)||measureCount<1||measureCount>32||!Number.isInteger(maxParts)||maxParts<1||maxParts>4)throw new TypeError('Invalid complete-score reader configuration.');
 const view=document.defaultView??globalThis,admission=notationAudioAdmission(view);
 const t=(key,params={})=>{const value=messages[i18n.locale==='en'?'en':'zh'][key];return typeof value==='function'?value(params):value||key;};
 const el=(tag,className,parent)=>{const node=document.createElement(tag);if(className)node.className=className;parent?.append(node);return node;};
 const backdrop=el('div','complete-score-reader-backdrop',document.body);backdrop.hidden=true;backdrop.setAttribute('aria-hidden','true');
 const dialog=el('dialog','complete-score-reader',document.body);dialog.id='complete-score-reader';dialog.hidden=true;dialog.setAttribute('aria-labelledby','complete-score-reader-title');dialog.setAttribute('aria-describedby','complete-score-reader-intro');
 const header=el('header','complete-score-reader-header',dialog),heading=el('h2','',header);heading.id='complete-score-reader-title';
 const back=el('button','complete-score-reader-back',header);back.type='button';
 const title=el('p','complete-score-reader-song',dialog),intro=el('p','complete-score-reader-intro',dialog);intro.id='complete-score-reader-intro';
 const controls=el('div','complete-score-reader-controls',dialog),modeLabel=el('label','',controls),modeText=el('span','',modeLabel),mode=el('select','',modeLabel);
 for(const value of ['playable','source']){const option=el('option','',mode);option.value=value;}
 mode.value='playable';
 const meterLabel=el('label','',controls),meterText=el('span','',meterLabel),meter=el('select','',meterLabel);
 for(const value of ['source','4/4','3/4','2/4','6/8']){const option=el('option','',meter);option.value=value;option.textContent=value;}
 meter.value='source';
 const sourceNotice=el('p','complete-score-reader-source-notice',dialog),status=el('p','complete-score-reader-status',dialog);status.setAttribute('role','status');status.setAttribute('aria-live','polite');
 const scroller=el('div','complete-score-reader-scroll',dialog);scroller.tabIndex=0;const sections=el('div','complete-score-reader-sections',scroller),sentinel=el('div','complete-score-reader-sentinel',scroller),more=el('button','complete-score-reader-more',sentinel);more.type='button';
 let session=null,disposed=false,generation=0,observer=null,returnFocus=null,restoredInert=[],scrollLock=null,adapter=null,localeUnsubscribe=null;
 const current=s=>session===s&&!s.controller.signal.aborted&&getScore()===s.ownerScore&&getCleanSong()===s.ownerSong;
 const state=()=>{
  const s=session;if(!s)return{open:false,status:'closed'};
  const exhausted=s.parts.every(part=>part.done),done=s.parts.length>0&&s.parts.every(part=>part.traversed),seen=new Set(s.parts.flatMap(part=>[...part.seen])),events=new Set(s.parts.flatMap(part=>[...part.events]));
  return{open:true,status:s.loading?'loading':done&&!s.failures?'end':'partial',loading:s.loading,endReached:done,hasMore:!exhausted,blockedParts:s.parts.filter(part=>part.done&&!part.traversed).length,loadedSections:s.loaded,totalParts:s.parts.length,reachedParts:s.parts.filter(part=>part.reached).length,unavailableSections:s.failures,sourceAttacks:s.basic?s.song.coverage.key_attacks:null,inspectedAttacks:seen.size,eventDetails:events.size,partIds:s.parts.map(part=>part.part.id)};
 };
 function translateSection(row){
  row.heading.textContent=`${row.names.join(' · ')} · ${t('range',{from:row.from,to:row.to})}`;
  row.notice.textContent=row.key?t(row.key)+(row.detail?` ${row.detail}`:''):'';row.notice.hidden=!row.notice.textContent;
  if(row.events){row.events.summary.textContent=t('eventDetails',{count:row.events.items.length});for(const item of row.events.items)item.node.textContent=t('event',{id:item.note.note_id,key:item.note.key,at:fraction(item.note.source_at),kind:t(item.kind)});}
  if(row.diagnostics)row.diagnostics.summary.textContent=t('diagnostics');
 }
 function paint(){
  heading.textContent=t('title');back.textContent=t('close');intro.textContent=t('intro');modeText.textContent=t('view');meterText.textContent=t('meter');mode.options[0].textContent=t('playable');mode.options[1].textContent=t('source');meter.options[0].textContent=t('sourceMeter');
  const s=session;if(!s)return;
  title.textContent=s.score?.title||s.song?.metadata?.title||'';controls.hidden=!s.basic;modeLabel.hidden=!hasBasicKeyRendition(s.song);
  sourceNotice.hidden=!s.basic;sourceNotice.textContent=s.basic?t('basic')+(meter.value!=='source'?` ${t('chosenMeter')}`:''):'';
  const report=state();status.textContent=!s.parts.length?t('empty'):t(report.endReached?'doneStatus':!report.hasMore?'stoppedStatus':report.loading?'loadingStatus':'partialStatus',{loaded:report.loadedSections,parts:report.reachedParts,total:report.totalParts,blocked:report.blockedParts});
  if(report.unavailableSections)status.textContent+=t('limitedStatus',{count:report.unavailableSections});
  if(s.basic){status.textContent+=t('coverage',{seen:report.inspectedAttacks,total:report.sourceAttacks,events:report.eventDetails});if(!report.hasMore&&report.inspectedAttacks!==report.sourceAttacks)status.textContent+=t('missingCoverage');}
  dialog.dataset.readerStatus=report.status;more.textContent=t(s.loading?'loading':'more');more.disabled=s.loading;sentinel.hidden=!report.hasMore||!s.parts.length;
  for(const row of s.rows)translateSection(row);
 }
 function disconnect(){observer?.disconnect();observer=null;}
 function observe(){
  disconnect();if(!session||typeof view.IntersectionObserver!=='function')return;
  const owner=session;observer=new view.IntersectionObserver(entries=>{if(current(owner)&&!owner.loading&&entries.some(entry=>entry.isIntersecting))void loadMore();},{root:scroller,rootMargin:'240px 0px'});observer.observe(sentinel);
 }
 function cleanSession(){
  disconnect();const old=session;session=null;generation++;if(!old)return;
  old.controller.abort();for(const renderer of old.renderers){try{renderer.dispose?.();}catch{/* Other sections still need their cleanup. */}}
  sections.replaceChildren();
 }
 function restoreBackground(){backdrop.hidden=true;if(scrollLock){document.body.style.overflow=scrollLock.overflow;scrollLock=null;}for(const[node,had]of restoredInert){if(had)node.setAttribute('inert','');else node.removeAttribute('inert');}restoredInert=[];}
 function close({restoreFocus=true}={}){
  if(!session)return false;cleanSession();dialog.hidden=true;if(typeof dialog.close==='function'&&dialog.open)dialog.close();else dialog.removeAttribute('open');restoreBackground();onVisibility(false);
  if(restoreFocus&&returnFocus?.isConnected!==false)returnFocus?.focus?.({preventScroll:true});returnFocus=null;return true;
 }
 function scoreChanged(){if(session&&(getScore()!==session.ownerScore||getCleanSong()!==session.ownerSong))close();}
 function addRow(s,parts,from,to){
  const root=el('section','complete-score-reader-section',sections);root.dataset.fromMeasure=String(from);root.dataset.toMeasure=String(to);root.dataset.partIds=JSON.stringify(parts.map(part=>part.part.id));
  const row={root,heading:el('h3','',root),notice:el('p','complete-score-reader-section-notice',root),mount:el('div','complete-score-reader-staff',root),from,to,names:parts.map(part=>part.part.name||part.part.id),key:null};s.rows.push(row);translateSection(row);return row;
 }
 function unavailable(s,row,key,detail){row.key=key;row.detail=detail;if(row.root.dataset.status!=='unavailable')s.failures++;row.root.dataset.status='unavailable';translateSection(row);}
 function diagnostics(row,items){
  if(!items?.length)return;const details=el('details','complete-score-reader-diagnostics',row.root),summary=el('summary','',details),list=el('ul','',details);row.diagnostics={summary};
  for(const item of items){const li=el('li','',list);li.textContent=typeof item==='string'?item:item.message||item.code||'';}
 }
 async function json(path,body,s){
  const response=await request(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:s.controller.signal});
  if(!current(s))return null;const result=await response.json();if(!current(s))return null;
  if(!response.ok)throw new Error(result?.error||`HTTP ${response.status}`);return result;
 }
 async function render(s,row,exported,identity,partIds,from,to){
  try{
  if(!adapter)adapter=await admission.prepareVisual(loadAdapter,s.controller.signal);if(!current(s)||!adapter)return false;
  const result=await adapter.renderEngravedStaff(row.mount,exported.xml,{i18n,cooperative:true,responsive:true,compactHeader:true,dark:document.documentElement.dataset.theme==='dark',fromMeasure:from,toMeasure:to,partIds,identity,onError:error=>{if(current(s)&&row.root.dataset.status!=='unavailable'){unavailable(s,row,'failed',error?.message);paint();}}},s.controller.signal);
  if(!current(s)){result?.dispose?.();return false;}
  if(result?.dispose)s.renderers.push(result);
  if(!result?.ok){unavailable(s,row,'failed',result?.message);return false;}
  row.root.dataset.status='ready';row.key='ready';return true;
  }catch(error){if(!current(s))return false;adapter?.disposeEngravedStaff?.(row.mount);row.mount.replaceChildren();unavailable(s,row,'failed',error?.message);return false;}
 }
 function eventRows(s,row,part,page,staffReady){
  const rows=new Map(),put=(note,kind)=>rows.set(note.note_id,{note,kind});
  if(page.view_version===2){for(const note of page.interpreted_notes||[]){part.seen.add(note.note_id);if(note.display_kind!=='interval'||!staffReady)put(note,note.display_kind==='percussion_selector'?'percussion':note.display_kind==='synthetic_onset'?'synthetic':'interval');}}
  else{
   for(const note of page.score?.parts?.[0]?.notes||[])part.seen.add(note.id);
   for(const note of page.unresolved||[]){part.seen.add(note.note_id);put(note,'unresolved');}
   for(const note of page.instantaneous||[]){part.seen.add(note.note_id);put(note,'instantaneous');}
   if(!staffReady)for(const note of page.score?.parts?.[0]?.notes||[]){const original=part.part.notes.find(item=>item.id===note.id);put({note_id:note.id,key:note.pitch?pitchMidi(note.pitch):'?',source_at:original?.at},'interval');}
  }
  if(!rows.size)return;const details=el('details','complete-score-reader-events',row.root),summary=el('summary','',details),list=el('ul','',details);details.open=!staffReady;row.events={summary,items:[]};
  for(const[id,item]of rows){part.events.add(id);const node=el('li','',list);node.dataset.noteId=id;row.events.items.push({...item,node});}
 }
 async function basicPart(s,part){
  const from=part.next;let count=measureCount,page;
  for(;;){
   const displayMeter=meter.value==='source'?null:(()=>{const[numerator,denominator]=meter.value.split('/').map(Number);return{numerator,denominator};})();
   const nativeRequest=basicKeyNotationRequest(s.song,{partId:part.part.id,from,count,displayMeter,sourceOnly:mode.value==='source'}),response=await json('/api/library/basic-keys/notation',nativeRequest,s);if(!current(s))return;
   page=basicKeyNotationPage(response,nativeRequest,s.song);if(page.status!=='page_limit'||count===1)break;count=Math.max(1,Math.floor(count/2));
  }
  if(!current(s))return;
  const amount=Number.isSafeInteger(page.measure_count)&&page.measure_count>0?page.measure_count:0,total=page.total_measures;
  const row=addRow(s,[part],from,amount?from+amount-1:from);part.pendingRow=row;part.reached=true;s.loaded++;
  diagnostics(row,[...(page.diagnostics||[]),...(page.musicxml?.diagnostics||[])]);
  let staffReady=false;
  if(page.status==='ready'){
   if(page.score.parts[0].notes.length){const mapped=page.musicxml.part_id_map?.[part.part.id];if(typeof mapped!=='string'||!mapped)throw new Error('Native notation part identity is missing.');staffReady=await render(s,row,page.musicxml,basicKeyEngravingIdentity(s.song,page),[mapped],1,page.score.measures.length);}
   else{row.key='quiet';row.root.dataset.status='ready';staffReady=true;}
  }else if(['empty_page','onset_page','percussion_selectors'].includes(page.status)){row.key='quiet';row.root.dataset.status='events';}
  else unavailable(s,row,messages.en[page.status]?page.status:'failed');
  if(!current(s))return;
  eventRows(s,row,part,page,staffReady);translateSection(row);
  if(Number.isSafeInteger(total)&&total>=0&&amount>0){part.next=from+amount;part.done=part.next>total;part.traversed=part.done;}
  else{part.done=true;part.traversed=page.status==='empty_page'&&Number.isSafeInteger(total)&&from>total;if(!['display_meter_required','percussion_mapping_required','page_limit'].includes(page.status)&&!(page.status==='empty_page'&&Number.isSafeInteger(total)&&from>total)&&row.root.dataset.status!=='unavailable')unavailable(s,row,'failed','Native source measure coverage is unavailable.');}
  part.pendingRow=null;
 }
 async function canonicalBatch(s,parts){
  const from=parts[0].next,to=Math.min(s.score.measures.length,from+measureCount-1),row=addRow(s,parts,from,to||from);s.loaded++;for(const part of parts)part.reached=true;
  if(!to){unavailable(s,row,'noMeasures');for(const part of parts)part.done=true;return;}
  if(!s.exported){s.exported=await json('/api/export/musicxml',s.score,s);if(!current(s))return;if(typeof s.exported?.xml!=='string'||!s.exported.part_id_map)throw new Error('Native MusicXML export is incomplete.');}
  const exported=s.exported,mapped=parts.map(part=>exported.part_id_map[part.part.id]);if(mapped.some(id=>typeof id!=='string'||!id))throw new Error('Native notation part identity is missing.');
  diagnostics(row,exported.diagnostics);await render(s,row,exported,{score:s.score,noteMap:exported.note_id_map,partIdMap:exported.part_id_map,voiceIdMap:exported.voice_id_map},mapped,from,to);
  if(!current(s))return;for(const part of parts){part.next=to+1;part.done=to===s.score.measures.length;part.traversed=part.done;}
 }
 async function loadMore(){
  const s=session;if(!s||!current(s)||s.loading)return false;const pending=s.parts.filter(part=>!part.done).sort((a,b)=>a.next-b.next||a.index-b.index);if(!pending.length)return false;
  const first=pending[0].next,batch=pending.filter(part=>part.next===first).slice(0,maxParts);s.loading=true;paint();
  try{
   if(s.basic){for(const part of batch){try{await basicPart(s,part);}catch(error){if(!current(s))return false;const row=part.pendingRow||addRow(s,[part],part.next,part.next);if(!part.pendingRow)s.loaded++;part.pendingRow=null;part.reached=true;part.done=true;unavailable(s,row,'error',error?.message);}if(!current(s))return false;}}
   else{try{await canonicalBatch(s,batch);}catch(error){if(!current(s))return false;const row=s.rows.at(-1);unavailable(s,row,'error',error?.message);for(const part of batch)part.done=true;}}
  }finally{if(current(s)){s.loading=false;paint();}}
  return current(s);
 }
 function start(){
  cleanSession();const ownerScore=getScore(),ownerSong=getCleanSong();let song=ownerSong;while(song?.originalSong)song=song.originalSong;
  const basic=isBasicKeysSong(song),score=basic?song.notation:getExportScore(),parts=score?.parts||[];
  const s={generation,ownerScore,ownerSong,score,song,basic,controller:new AbortController(),renderers:[],rows:[],parts:parts.map((part,index)=>({part,index,next:1,done:false,traversed:false,reached:false,seen:new Set(),events:new Set()})),loading:false,loaded:0,failures:0,exported:null};session=s;scroller.scrollTop=0;paint();observe();return loadMore();
 }
 function open(){
  if(disposed)return Promise.resolve(false);if(session&&current(session))return Promise.resolve(true);if(session)close({restoreFocus:false});returnFocus=document.activeElement;scrollLock={overflow:document.body.style.overflow};document.body.style.overflow='hidden';dialog.hidden=false;
  let native=false;if(typeof dialog.showModal==='function'){try{dialog.showModal();native=true;}catch{/* Older embedded engines can use the accessible fallback. */}}
  if(!native){backdrop.hidden=false;dialog.setAttribute('open','');dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');for(const node of document.body.children)if(node!==dialog&&node!==backdrop){restoredInert.push([node,node.hasAttribute('inert')]);node.setAttribute('inert','');}}
  onVisibility(true);back.focus?.({preventScroll:true});return start();
 }
 const keydown=event=>{if(!session)return;if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close();return;}if(event.key!=='Tab')return;
  const focusable=[...dialog.querySelectorAll('button,select,a[href],summary,[tabindex]')].filter(node=>!node.disabled&&!node.closest('[hidden]')&&node.tabIndex!==-1),first=focusable[0],last=focusable.at(-1);if(!first)return;
  if(event.shiftKey&&(document.activeElement===first||!dialog.contains(document.activeElement))){event.preventDefault();last.focus();}else if(!event.shiftKey&&(document.activeElement===last||!dialog.contains(document.activeElement))){event.preventDefault();first.focus();}
 };
 const cancel=event=>{event.preventDefault();close();},nativeClose=()=>{if(session)close();},restart=()=>{if(session)void start();};
 backdrop.addEventListener('wheel',event=>event.preventDefault(),{passive:false});backdrop.addEventListener('touchmove',event=>event.preventDefault(),{passive:false});
 back.addEventListener('click',()=>close());more.addEventListener('click',()=>void loadMore());mode.addEventListener('change',restart);meter.addEventListener('change',restart);dialog.addEventListener('cancel',cancel);dialog.addEventListener('close',nativeClose);document.addEventListener('keydown',keydown,true);localeUnsubscribe=i18n.subscribe?.(paint);paint();
 return{open,close,scoreChanged,loadMore,isOpen:()=>Boolean(session),state,dispose(){if(disposed)return;close();disposed=true;localeUnsubscribe?.();document.removeEventListener('keydown',keydown,true);dialog.remove();backdrop.remove();}};
}

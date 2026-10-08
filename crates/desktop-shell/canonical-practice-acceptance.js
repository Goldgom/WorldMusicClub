/* Actual application-only acceptance. All controls use host-owned trusted actions.
 * Read-only observers forward the production call, event, promise and clock. */
function canonicalPracticeSampleOffsetFrames(plan,positionFrame){
 // The acknowledged production plan clips crossing notes at A/seek, then
 // places that first pass after its declared count-in. Source onset alone
 // can precede this gate and consume the bounded analyser budget in silence.
 if(!plan.rangeMode){const first=plan.notes.find(note=>note[2]>positionFrame);return first?Math.max(first[1],positionFrame)-positionFrame:null;}
 const first=plan.notes[plan.firstRangeOrder[0]];
 if(first)return plan.initialCountInFrames+Math.max(first[1],plan.initialPositionFrame)-plan.initialPositionFrame;
 // A seek can leave no first-pass gates while a later loop still has them.
 const next=plan.maxPasses>1&&plan.notes[plan.rangeOrder[0]];
 return next?plan.initialCountInFrames+plan.rangeEndFrame-plan.initialPositionFrame+plan.countInFrames+Math.max(next[1],plan.rangeStartFrame)-plan.rangeStartFrame:null;
}
// Closing Mod commits the selection before Rust rebuilds the stage targets.
// Native coordinate dispatch has no Playwright-style enabled-control wait.
// Admit Play only from the public, settled stage UI; keep the owned hit and
// subsequent receiver acknowledgement checks in the unchanged caller.
async function dispatchCanonicalPracticePlay({document,until,click,readClock}){
 const $=id=>document.getElementById(id);
 await until(()=>{
  const stage=$('workspace'),play=$('play-button'),gate=$('practice-gate'),retry=$('practice-gate-retry');
  if(document.body.dataset.screen!=='stage'||!stage||stage.hidden||stage.dataset.scoreState!=='session'||document.querySelector('dialog[open]'))return false;
  if(gate&&!gate.hidden&&retry&&!retry.disabled)throw Error(`Canonical Play blocked: ${$('practice-gate-reason')?.textContent||'target compatibility failed'}`);
  const clock=readClock();
  return Boolean(play&&!play.disabled&&!play.closest('[hidden]')&&gate?.hidden&&clock.available&&!clock.running&&['ready','paused','ended'].includes(clock.phase));
 },'canonical Play ready after target and compatibility checks');
 return click('play-button');
}
// Source completion precedes the final Rust assessment and the next HUD draw.
// Admit the completed session only after that public result is rendered; equal
// rectangles before an outstanding response are not a completion signal.
function canonicalPracticeCompletionReady(document){
 const phase=document.querySelector('.performance-status')?.dataset.phase;
 if(phase==='error')throw Error('Canonical completed take assessment failed');
 return !document.getElementById('play-button').disabled&&['listen','assessed','review','empty'].includes(phase);
}
function canonicalPracticeModalScope(document,node){
 // Several dialogs may remain open in the browser's modal stack. DOM order
 // does not identify the top layer; the target's own dialog admits scope,
 // and the painted elementFromPoint check below proves actual ownership.
 const owner=node.closest('dialog');
 return owner?owner.hasAttribute('open'):!document.querySelector('dialog[open]');
}
async function waitCanonicalPracticeControl({document,node,until,readClock}){
 let readiness;
 await until(()=>{
  if(!node.isConnected||node.disabled||node.closest('[hidden]'))return false;
  if(!canonicalPracticeModalScope(document,node))return false;
  const stage=document.getElementById('workspace'),clock=readClock();
  readiness={screen:document.body.dataset.screen,completed:clock.completed,feedbackPhase:document.querySelector('.performance-status')?.dataset.phase||null,playDisabled:document.getElementById('play-button').disabled};
  return !(stage?.contains(node)&&clock.completed)||canonicalPracticeCompletionReady(document);
 },`owned control ready: ${node.id||node.tagName}`);
 return readiness;
}
// Windows515 Play and Windows518 Mod both captured targets before delayed
// layout publication. All pointer controls use this one read-only contract.
// Stage controls additionally require the public status, notice and viewport
// budgets to have committed, followed by an unchanged painted target.
function prepareCanonicalPracticeTarget({document,node=document.getElementById('play-button'),window=document.defaultView,onSample=()=>{}}){
 const root=document.getElementById('workspace'),stage=Boolean(root?.contains(node)&&root.classList.contains('piano-workspace')),lane=stage&&root.querySelector('.piano-lanes-shared'),transport=stage&&root.querySelector('.piano-transport'),samples=[];
 return new Promise((resolve,reject)=>{
  let frame=null,timeout=null,previous=null;
  const finish=error=>{if(frame!==null)window.cancelAnimationFrame(frame);window.clearTimeout(timeout);error?reject(error):resolve(samples.at(-1));};
  const fail=reason=>finish(Error(`${reason}: ${JSON.stringify(samples)}`));
  const sample=()=>{
   const targetRect=node.getBoundingClientRect(),target={x:targetRect.x,y:targetRect.y,width:targetRect.width,height:targetRect.height},value={frame:samples.length,width:window.innerWidth,height:window.innerHeight,target};let budgetReady=true;
   if(stage){
    const laneRect=lane.getBoundingClientRect(),transportRect=transport.getBoundingClientRect(),zoom=Math.round(laneRect.height/parseFloat(window.getComputedStyle(lane).height)*1000)/1000;
    const visual=window.visualViewport,viewportBottom=Math.min(window.innerHeight,visual?visual.offsetTop+visual.height:window.innerHeight),padding=parseFloat(window.getComputedStyle(root).paddingBottom)||0;
    // Activity is a real flow sibling after transport. Hidden source contexts
    // and responsive display:none slots have no painted extent to reserve.
    const activity=root.querySelector('.part-activity-host'),activityRect=activity&&!activity.hidden?activity.getBoundingClientRect():null;
    const activityBottom=activityRect?.width>0&&activityRect.height>0?activityRect.bottom:null,stageBottom=Math.max(transportRect.bottom,activityBottom??transportRect.bottom);
    const expected=Math.max(100,Math.floor(((viewportBottom-stageBottom-(root.scrollTop||0)*zoom+laneRect.height)/zoom-padding)*100)/100),committed=parseFloat(document.body.style.getPropertyValue('--piano-available-lane-height'));
    Object.assign(value,{committed,expected,laneHeight:laneRect.height,transportBottom:transportRect.bottom,activityBottom,stageBottom,viewportBottom,zoom});
    budgetReady=Number.isFinite(committed)&&Number.isFinite(expected)&&Math.abs(committed-expected)<=.02;
    for(const [kind,chrome]of [['status',root.querySelector('.performance-status')],['notice',document.getElementById('notice')]])if(chrome){
     const rect=chrome.getBoundingClientRect(),css=window.getComputedStyle(chrome),expected=kind==='status'?Math.ceil(rect.height):chrome.hidden?0:Math.ceil(rect.height+(parseFloat(css.marginTop)||0)+(parseFloat(css.marginBottom)||0)),committed=parseFloat(document.body.style.getPropertyValue(`--piano-${kind}-space`));
     value[kind]={committed,expected};budgetReady&&=Number.isFinite(committed)&&committed===expected;
    }
   }
   const x=target.x+target.width/2,y=target.y+target.height/2,hit=document.elementFromPoint(x,y),hitOwned=hit===node||node.contains(hit);
   Object.assign(value,{modalOwner:node.closest('dialog[open]')?.id||null,hitId:hit?.id||null,hitOwned});
   samples.push(value);onSample(value);
   const owned=node.isConnected&&!node.disabled&&!node.closest('[hidden]')&&canonicalPracticeModalScope(document,node)&&target.width>0&&target.height>0&&x>0&&x<window.innerWidth&&y>0&&y<window.innerHeight&&hitOwned;
   const fingerprint=JSON.stringify({width:value.width,height:value.height,target});
   if(owned&&budgetReady&&previous===fingerprint)return finish();
   previous=owned?fingerprint:null;
   // Three frames admit the chained budget commits; the fourth verifies the
   // resulting target. Missing commits remain a hard failure, without retries.
   if(samples.length===5)return fail('Canonical control geometry did not settle within four rendered frames');
   frame=window.requestAnimationFrame(sample);
  };
  timeout=window.setTimeout(()=>fail('No canonical control geometry frame within 2000ms'),2000);
  sample();
 });
}
function observeCanonicalPracticeOwnedClick({document,node,sequence}){
 const events=[];
 const observe=event=>{
  if(events.length>=5)return;
  events.push({sequence,id:event.target?.id||null,owned:event.target===node||node.contains(event.target),trusted:event.isTrusted===true});
 };
 document.addEventListener('click',observe,true);
 return{events,restore:()=>document.removeEventListener('click',observe,true)};
}
async function requireCanonicalPracticeOwnedClick({until,events,sequence,id,kind}){
 let matches;
 await until(()=>{
  if(events.length>4)throw Error(`Canonical click evidence bound for action ${sequence}`);
  if(events.some(event=>event.sequence===sequence&&event.trusted&&!event.owned))throw Error(`Canonical action ${sequence} missed owned ${id||kind}: ${JSON.stringify(events)}`);
  matches=events.filter(event=>event.sequence===sequence&&event.owned&&event.trusted);
  if(kind==='click'&&matches.length>1)throw Error(`Duplicate trusted canonical click for action ${sequence}`);
  return matches.length>0;
 },`trusted owned ${id||kind} click for action ${sequence}`);
 return matches;
}
function compactCanonicalPracticeAudio(rows){
 const compact=record=>{const r=structuredClone(record);if(r.ledgerLayout==='range-pass-major'&&r.ledger){r.ledgerCapacity=r.ledger.actualStarts.length;r.unusedLedgerSentinel=0;r.unusedLedgerEmpty=r.ledger.actualStarts.slice(r.recordCount).every(n=>n===0)&&r.ledger.actualEnds.slice(r.recordCount).every(n=>n===0);r.ledger.actualStarts=r.ledger.actualStarts.slice(0,r.recordCount);r.ledger.actualEnds=r.ledger.actualEnds.slice(0,r.recordCount);r.passFrames=Array.from(r.passFrames||[]).slice(0,r.passCount);}if(r.pauseSpans)r.pauseSpans=Array.from(r.pauseSpans);return r;};
 return rows.map(row=>({...row,terminals:row.terminals.map(t=>({...t,record:compact(t.record)})),rawTerminals:row.rawTerminals.map(t=>({...t,record:compact(t.record)}))}));
}
// Timing is diagnostic only. Read the already-published DOM clock; never ask
// the transport to sample/advance itself, or use diagnostics to admit input.
function createCanonicalActionTiming({document,performance,phase,utcNow=()=>Date.now()}){
 const report={version:1,kind:'canonical-action-timing',diagnostic_only:true,phase,timeOrigin:performance.timeOrigin,omitted_actions:0,record_errors:0,actions:[]};
 const allowed=['action-post-start','action-post-completed','result-headers','result-body'];
 function publishedClock(){
  const raw=document.getElementById('progress')?.getAttribute('data-playback-clock');
  if(typeof raw!=='string'||raw.length>1024)return null;
  let value;try{value=JSON.parse(raw);}catch{return null;}
  if(!value||value.version!==1||!Number.isFinite(value.positionMs)||!Number.isFinite(value.transportPositionMs)||!Number.isFinite(value.durationMs)||!['unavailable','preparing','playing','paused','ready','ended'].includes(value.phase))return null;
  return{positionMs:value.positionMs,transportPositionMs:value.transportPositionMs,durationMs:value.durationMs,phase:value.phase};
 }
 return{report,begin(sequence,kind){
  let row=null;
  if(Number.isSafeInteger(sequence)&&sequence>0&&sequence<=(phase==='canonical-practice-seed'?80:64)&&typeof kind==='string'&&kind.length<=32&&report.actions.length<80){row={sequence,kind,pending_polls:0,checkpoints:[]};report.actions.push(row);}else report.omitted_actions++;
  return{pending(){if(row)row.pending_polls=Math.min(65535,row.pending_polls+1);},mark(stage){
   if(!row)return;
   try{
    if(!allowed.includes(stage)||row.checkpoints.length>=4||row.checkpoints.some(point=>point.stage===stage))throw Error('Invalid diagnostic checkpoint');
    const monotonic_ms=performance.now(),utc_ms=utcNow(),published_clock=publishedClock();
    if(!Number.isFinite(monotonic_ms)||!Number.isFinite(utc_ms))throw Error('Invalid diagnostic clock');
    row.checkpoints.push({stage,monotonic_ms,utc_ms,published_clock});
   }catch{report.record_errors++;}
  }};
 }};
}
// Optional diagnostics must never consume the mandatory report's envelope.
// Run only at existing finalization/publication, after timed actions finish.
function fitCanonicalActionTiming(report){
 if(!Object.hasOwn(report,'actionTiming'))return;
 try{
  const bytes=value=>new TextEncoder().encode(JSON.stringify(value)).length;
  const mandatory={...report};delete mandatory.actionTiming;
  const base=bytes(mandatory),overhead=new TextEncoder().encode('"actionTiming":').length+(Object.keys(mandatory).length?1:0);
  const fits=timing=>base+overhead+bytes(timing)<1000000,timing=report.actionTiming;
  if(fits(timing))return;
  if(!Array.isArray(timing.actions))throw Error('Invalid optional action timing');
  timing.truncated=true;
  // Keep the earliest complete action records, including early Play barriers.
  while(timing.actions.length&&!fits(timing)){timing.actions.pop();timing.omitted_actions++;}
  if(fits(timing))return;
  report.actionTiming={version:1,diagnostic_only:true,truncated:true};
  if(!fits(report.actionTiming))delete report.actionTiming;
 }catch{delete report.actionTiming;}
}
(() => {
 const phase=globalThis.__WMH_ACCEPTANCE_PHASE__,$=id=>document.getElementById(id),assert=(v,m)=>{if(!v)throw Error(m);},waits=createAcceptanceWait(),fetcher=globalThis.fetch.bind(globalThis),originalFetch=globalThis.fetch;
 const report={version:1,phase,origin:location.origin,ok:false,stage:'bootstrap',errors:[],requests:[],responses:[],trusted:[],samples:{},screenshots:{},files:{},runs:{},receipts:[],edits:[],controlActions:[]};
 const actionTiming=createCanonicalActionTiming({document,performance,phase});report.actionTiming=actionTiming.report;
 let sequence=0,receiver,live,controls,restored=false;const receiptRemovers=[];
 const json=(path,body)=>waits.json(fetcher,path,body===undefined?undefined:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)},10000);
 const until=(fn,label,ms=15000)=>waits.until(()=>{receiver?.assertHealthy();live?.assertHealthy();return fn();},`${phase}: ${report.stage}: ${label}`,ms),frame=()=>new Promise(requestAnimationFrame);
 const responses=createVsqJsonObserver({maxRows:160,onValue:row=>report.responses.push(row),onError:error=>report.errors.push(error)});
 function observedFetch(...args){const result=Reflect.apply(originalFetch,this,args),path=String(args[0]);if(path.startsWith('/api/')){assert(report.requests.length<160,'Canonical request bound');let body=null;try{body=typeof args[1]?.body==='string'?JSON.parse(args[1].body):null;}catch{}report.requests.push({path,body});responses.observe(path,result,report.requests.length-1);}return result;}globalThis.fetch=observedFetch;
 const fields={'canonical-range-start':{id:'loop-from',type:'text',value:'2'},'canonical-range-end':{id:'loop-to',type:'text',value:'6'},'canonical-tempo':{id:'tempo',type:'number',value:'90'}};
 const input=e=>{if(e.target?.id==='score-file'||(!e.target?.id&&!e.target?.closest?.('.song-mod-part')))return;assert(report.trusted.length<256,'Canonical trusted event bound');report.trusted.push({sequence,type:e.type,id:e.target.id||null,part:e.target.closest?.('.song-mod-part')?.dataset.partId||null,actionSequence:sequence,modField:e.target.dataset?.modPerformer?'performer':e.target.dataset?.modInstrument?'instrument':e.target.dataset?.modMute?'mute':e.target.dataset?.modVisible?'visible':null,code:e.code||null,trusted:e.isTrusted===true,repeat:Boolean(e.repeat),eventTime:e.timeStamp,surface:e.target.closest?.('[data-keyboard-performance]')?.id||null,value:e.target.value??null,checked:typeof e.target.checked==='boolean'?e.target.checked:null});};
 async function native(kind,node,file){
  assert(node,'Owned canonical control unavailable');const readiness=kind==='key-c5'?null:await waitCanonicalPracticeControl({document,node,until,readClock:()=>globalThis.__wmhReadPlaybackClock(document)});assert(!node.disabled,'Owned canonical control disabled');const field=fields[kind];if(field)assert(phase==='canonical-practice-controls'&&node.id===field.id&&node.tagName==='INPUT'&&node.type===field.type,'Closed numeric action target mismatch');
  if(kind==='key-c5')assert(document.hasFocus()&&document.activeElement===node&&node.id==='stage-title','Prepared C5 focus lost');else{node.scrollIntoView({block:'center',inline:'center'});node.focus();await frame();await frame();}
  let controlAction;
  if(kind!=='key-c5'){controlAction={sequence:sequence+1,id:node.id||null,kind,readiness,samples:[]};report.controlActions.push(controlAction);await prepareCanonicalPracticeTarget({document,node,onSample:value=>controlAction.samples.push(value)});}
  const b=node.getBoundingClientRect(),x=b.x+b.width/2,y=b.y+b.height/2,hit=document.elementFromPoint(x,y);assert(b.width>0&&b.height>0&&x>0&&x<innerWidth&&y>0&&y<innerHeight&&(hit===node||node.contains(hit)),`Owned target obscured: ${node.id}`);assert(sequence<(phase==='canonical-practice-seed'?80:64),'Canonical native action bound');
  const before=field?{value:node.value,captured:$('hud-captured').textContent,eventStart:report.trusted.length}:null,a={version:1,sequence:++sequence,kind,x,y,width:innerWidth,height:innerHeight,...(file?{file}:{})};
  const pointer=controlAction&&observeCanonicalPracticeOwnedClick({document,node,sequence});
  if(controlAction){controlAction.request={...a,target:{x:b.x,y:b.y,width:b.width,height:b.height}};controlAction.clicks=pointer.events;}
  try{
   if(kind==='picker')controls.beginPicker(sequence,file);const timing=actionTiming.begin(sequence,kind);timing.mark('action-post-start');await json('/__desktop_smoke/action',a);timing.mark('action-post-completed');let result;await until(async()=>{const r=await fetcher(`/__desktop_smoke/result/${sequence}`);if(r.status===404){timing.pending();return false;}timing.mark('result-headers');result=await r.json();timing.mark('result-body');return true;},`owned ${kind}`,15000);assert(result.ok,result.error);
   if(controlAction){const after=node.getBoundingClientRect();controlAction.afterDispatch={target:{x:after.x,y:after.y,width:after.width,height:after.height},disabled:node.disabled};await requireCanonicalPracticeOwnedClick({until,events:pointer.events,sequence,id:node.id,kind});}
  }finally{pointer?.restore();}
  if(field){assert(node.value===field.value,'Fixed numeric value mismatch');report.edits.push({kind,sequence,id:node.id,type:node.type,before,after:{value:node.value,captured:$('hud-captured').textContent,eventEnd:report.trusted.length}});assert($('hud-captured').textContent==='0','Editing generated music input');}
  return sequence;
 }
 const mod=createAcceptanceSongMod({document,native,until});
 const click=async id=>native('click',typeof id==='string'?$(id):id),clock=()=>globalThis.__wmhReadPlaybackClock(document),state=()=>clock().phase;
 const geometry=()=>({width:innerWidth,height:innerHeight,dpr:devicePixelRatio,documentWidth:document.documentElement.scrollWidth,canvas:(()=>{const {x,y,width,height}=$('falling-notes').getBoundingClientRect();return{x,y,width,height};})()});
 function scene(){return{sequence,clock:clock(),state:state(),renderer:$('canonical-audio-policy').dataset.rendererState,captured:$('hud-captured').textContent,playDisabled:$('play-button').disabled,practiceGate:{hidden:$('practice-gate').hidden,retryDisabled:$('practice-gate-retry').disabled,reason:$('practice-gate-reason').textContent},exportDisabled:$('export-takes').disabled,part:$('practice-part').value,complete:$('song-mod-layout').value==='complete',human:JSON.parse($('falling-notes').dataset.humanNoteIds||'[]'),machine:JSON.parse($('falling-notes').dataset.machineNoteIds||'[]'),selection:mod.fields().filter(n=>n.value==='human').map(n=>n.dataset.modPerformer),audio:receiver.status(),geometry:geometry()};}
 async function sample(name){await click('stage-title');await frame();report.samples[name]=scene();report.screenshots[name]=sequence;}
 async function library(){if(document.body.dataset.screen==='stage')await click('back-to-library');else if(document.body.dataset.screen==='home')await click('home-single-player');await until(()=>document.body.dataset.screen==='library'&&$('song-lobby').dataset.previewStatus==='ready','library preview');}
 async function close(id){await click($(id).querySelector('[data-close-panel]'));}
 async function importFile(filename){await click('import-tools-button');const before=report.responses.filter(r=>r.path==='/api/library/save').length,n=await native('picker',$('import-button'),filename);let complete=false;try{await until(()=>report.responses.filter(r=>r.path==='/api/library/save').length===before+1&&document.querySelector('.score-storage-status')?.dataset.persistence==='saved','picker import persisted');complete=true;}finally{controls.endPicker(n,complete);}await close('import-tools-dialog');}
 async function select(key){await library();await until(()=>document.querySelector(`#catalog [data-library-key="native:${key}"]`),'saved catalog row');await click(document.querySelector(`#catalog [data-library-key="native:${key}"]`));await until(()=>$('song-lobby').dataset.previewId===`native:${key}`&&$('song-lobby').dataset.previewStatus==='ready','saved native preview');}
 async function download(id,name){const before=(await json('/__desktop_smoke/state')).downloads.length;await click(id);let row;await until(async()=>{row=(await json('/__desktop_smoke/state')).downloads[before];return row?.complete;},'download completed');assert(row.success,'Export failed');report.files[name]=row.file;}
 async function take(name){await click('results-button');await until(()=>!$('export-takes').disabled,'take ready');await download('export-takes',name);await close('results-dialog');}
 async function score(name){await click('score-tools-button');await download('export-button',name);await close('score-tools-dialog');}
 async function reset(){await click('reset-button');await until(()=>!$('play-button').disabled&&receiver.quiet(),'reset disposed source');}
 async function pause(){await click('play-button');await until(()=>state()==='paused'&&!$('play-button').disabled&&receiver.status().ownedNodes.some(n=>n.state==='paused'&&n.pendingCommands===0),'acknowledged pause');}
 async function play(){await dispatchCanonicalPracticePlay({document,until,click,readClock:clock});await until(()=>state()==='playing'&&!$('play-button').disabled,'acknowledged play');}
 async function end(){await until(()=>clock().completed&&state()==='ended'&&receiver.quiet()&&canonicalPracticeCompletionReady(document),'natural source end and completed take UI',10000);}
 async function popup(){await mod.open();}
 async function choose(ids){await mod.choose(ids,{layout:'complete'});}
 async function apply({starts=false}={}){await mod.apply();if(starts){await mod.startApplied();await until(()=>state()==='playing','cold performance started');}}
 const mark=name=>{report.stage=name;report.runs[name]={from:receiver.count()};},finish=name=>{report.runs[name].to=receiver.count();};
 function cleanup(){if(restored)return;restored=true;report.audio=compactCanonicalPracticeAudio(receiver?.snapshot()||[]);report.liveToneCleanup=live?.restore();report.receiverCleanup=receiver?.restore();for(const remove of receiptRemovers)remove();report.pickerObservations=controls?.pickers||[];report.pickerFileEvents=controls?.trusted.filter(e=>e.id==='score-file'||e.pickerSequence!==undefined)||[];controls?.restore();responses.restore();if(globalThis.fetch===observedFetch)globalThis.fetch=originalFetch;report.fetchRestored=globalThis.fetch===originalFetch;for(const type of ['click','input','change','keydown','keyup'])document.removeEventListener(type,input,true);}
 addEventListener('DOMContentLoaded',async()=>{try{
  assert(['canonical-practice-seed','canonical-practice-controls','canonical-practice-restart'].includes(phase),'Unknown canonical phase');for(const type of ['click','input','change','keydown','keyup'])document.addEventListener(type,input,true);controls=createVsqControlObserver(document,{readActionSequence:()=>sequence});
  await prepareNativePlaybackClock({document,until});const {CanonicalAudioReceiver}=await import('/canonical-audio-receiver.js');
  receiver=await observeBasicKeyReceiver(document,{Receiver:CanonicalAudioReceiver,readStartFrame:n=>n[1],readEndFrame:n=>n[2],readSampleOffsetFrames:canonicalPracticeSampleOffsetFrames,onStart(owner){const listener=e=>{if(!['paused','resumed','pass_started'].includes(e.data?.type))return;assert(report.receipts.length<64,'Canonical receipt bound');report.receipts.push({sequence,isTrusted:e.isTrusted===true,nativeMessage:e instanceof MessageEvent,nativePort:e.currentTarget===owner.node.port&&e.currentTarget instanceof MessagePort,record:structuredClone(e.data)});};owner.node.port.addEventListener('message',listener);receiptRemovers.push(()=>owner.node.port.removeEventListener('message',listener));}});
  live=await observeLiveToneAudio(document,{keyCode:'Digit2',midi:72,readSource:()=>receiver.status()});await library();(await import('/app-locale.js')).getAppI18n(document).setLocale('en');assert((await json('/api/health')).network==='native-protocol-no-listener','Actual Rust stdin/native protocol required');
  if(phase==='canonical-practice-seed')await importFile('canonical-practice-original.json');
  const inventory=await json('/api/library/list');assert(inventory.entries.length===1,'One persisted original JSON required');report.key=inventory.entries[0].key;report.opened=await json('/api/library/load',{key:report.key});await select(report.key);
  if(phase==='canonical-practice-seed'){
   mark('multi-human');await popup(false);await choose(['P1','P2']);await apply({starts:true});await until(()=>clock().positionMs>0,'count-in ended');await pause();await sample('multi');await take('machine');finish('multi-human');
   await reset();mark('trusted-human');await play();$('stage-title').focus();await frame();await frame();await until(()=>clock().positionMs>=1370,'C5 source onset');assert(clock().positionMs<1630,'Missed C5 dispatch window');report.keyPreparation={clock:clock(),focus:document.activeElement.id,timeOrigin:performance.timeOrigin};live.begin();report.keyAction=await native('key-c5',$('stage-title'));await until(()=>live.settled(),'one live key sound');report.humanLiveAudio=live.finish();await pause();report.fastPause={before:scene(),wallStart:performance.now()};await play();await pause();report.fastPause.after=scene();report.fastPause.wallEnd=performance.now();await play();await end();finish('trusted-human');await sample('human-ended');await take('human');
   mark('replay');await play();await end();finish('replay');await sample('replayed');
   await popup();await mod.choose('all',{layout:'complete'});await apply();mark('all-human');await play();await end();finish('all-human');await sample('all');await take('all');
   await popup();await choose(['P1']);await apply();mark('one-human');await play();await end();finish('one-human');await sample('one');await take('one');await score('json');
   report.modTimbre={before:scene(),actionStart:sequence};await mod.configure(['P1'],{layout:'complete',instrument:{P4:'reed'}});mark('mod-reed');await play();await end();finish('mod-reed');report.modTimbre.override=scene();await mod.open();await mod.restore();await mod.choose(['P1'],{layout:'complete'});await mod.apply();mark('mod-restored');await play();await end();finish('mod-restored');report.modTimbre.restored=scene();report.modTimbre.actionEnd=sequence;
  }else if(phase==='canonical-practice-controls'){
   mark('listen');await mod.start('none',{layout:'complete'});await until(()=>state()==='playing','full Listen');await end();finish('listen');await sample('listen-ended');await reset();
   await click('settings-button');const options=document.querySelector('.practice-options');if(!options.open)await click(options.querySelector('summary'));await native('canonical-range-start',$('loop-from'));await native('canonical-range-end',$('loop-to'));await click('loop-apply');await until(()=>$('loop-enabled').checked&&!$('loop-apply').disabled,'nonzero A/B accepted');await close('settings-dialog');
   mark('range');await play();await until(()=>report.receipts.filter(r=>r.record.type==='pass_started').length>=2,'second A/B pass',12000);await pause();await sample('range-paused');finish('range');
   report.seek={before:scene(),eventStart:report.trusted.length};await click('progress');await until(()=>clock().positionMs>1000&&clock().positionMs<3000&&state()==='paused'&&receiver.quiet(),'partial range seek');report.seek.after=scene();report.seek.eventEnd=report.trusted.length;mark('partial');await play();await until(()=>report.receipts.some(r=>r.record.type==='pass_started'&&r.record.planGeneration===receiver.snapshot().at(-1)?.planGeneration),'partial range source active');await pause();await sample('partial-paused');finish('partial');await reset();
   await click('settings-button');await click('loop-enabled');if($('count-in').checked)await click('count-in');await close('settings-dialog');await popup();await choose(['P1','P2']);await apply();
   await click('settings-button');await native('canonical-tempo',$('tempo'));await until(()=>!$('play-button').disabled&&report.responses.some(r=>r.path==='/api/compile'&&r.body.score?.tempo?.[0]?.bpm===90),'tempo compilation');const instrument=$('instrument-settings');if(!instrument.open)await click(instrument.querySelector('summary'));await click('transposition-button');await until(()=>$('transposition-dialog').open,'pitch review');assert($('transposition-semitones').value==='1','Expected actual default one semitone');await click('transposition-preview');await until(()=>!$('transposition-confirm').disabled,'Rust pitch preview');await click('transposition-confirm');await click('transposition-activate');await until(()=>!$('transposition-dialog').open&&!$('play-button').disabled,'pitch activated');if($('settings-dialog').open)await close('settings-dialog');
   mark('transformed');await play();await end();finish('transformed');await sample('transformed');await take('transformed');await score('transformedScore');
  }else{
   mark('restored');await popup();report.restoredMod={layout:$('song-mod-layout').value,showOthers:$('song-mod-show-others').checked,parts:[...document.querySelectorAll('#song-mod-parts .song-mod-part')].map(row=>({partId:row.dataset.partId,performer:row.querySelector('[data-mod-performer]').value,instrument:row.querySelector('[data-mod-instrument]').value,muted:row.querySelector('[data-mod-mute]').checked,visible:row.querySelector('[data-mod-visible]').checked}))};assert(JSON.stringify(report.restoredMod.parts.filter(p=>p.performer==='human').map(p=>p.partId))===JSON.stringify(['P1','P2']),'Original Mod human roles did not survive the owned-profile restart');await choose(['P1','P2']);await apply({starts:true});await end();finish('restored');await take('restored');await score('restoredScore');await library();
   await importFile('canonical-practice-original.musicxml');const list=await json('/api/library/list');assert(list.entries.length===2,'Both source formats persist independently');const xml=list.entries.find(row=>row.key!==report.key);report.xmlKey=xml.key;report.xmlOpened=await json('/api/library/load',{key:xml.key});await select(xml.key);mark('xml-listen');await mod.start('none',{layout:'complete'});await end();finish('xml-listen');await sample('xml-listen');await score('xmlScore');
   await select(xml.key);mark('selected-listen');await mod.start('none',{layout:'complete',muted:{P1:false,P2:true,P3:true,P4:true}});await end();finish('selected-listen');await sample('selected-listen');await score('xmlSelectedScore');
  }
  await until(()=>receiver.quiet(),'all source receivers released');report.inventory=await json('/api/library/list');report.finalAudio=receiver.status();report.actions=sequence;report.modActions=mod.history;report.layout=geometry();cleanup();assert(report.errors.length===0,report.errors.join('; '));fitCanonicalActionTiming(report);assert(new TextEncoder().encode(JSON.stringify(report)).length<1000000,'Canonical report stays below existing 1MiB budget');report.stage='complete';report.ok=true;
 }catch(error){report.error=String(error.stack||error);report.actions=sequence;try{report.failureScene=$('canonical-audio-policy')?scene():null;report.liveFailure=live?.failureEvidence();cleanup();}catch(cleanupError){report.errors.push(String(cleanupError));}}
 fitCanonicalActionTiming(report);await json('/__desktop_smoke/report',report);
 },{once:true});
})();

/* Separate process-owned native acceptance. It reuses the passive finite PCM
 * observer and canonical control geometry, without running canonical's suite. */
function nativeLiveToneNavigationCase(phase){
 const match=/^live-navigation-(settings|authoring)-(keyup|navigation)$/.exec(phase||'');
 if(!match)throw Error('Unknown native live-tone navigation phase');
 return{route:match[1],release:match[2]};
}

async function deliverNativeLiveToneNavigationReport(report,send){
 let bytes=null;try{bytes=new TextEncoder().encode(JSON.stringify(report)).byteLength;if(bytes>=1_000_000)throw Error('Native live navigation report exceeded its 1 MiB wire budget');await send(report);return{delivered:true,bytes};}
 catch(error){await send({version:1,scenario:'live-tone-navigation',phase:report.phase,route:report.route,release:report.release,origin:report.origin,ok:false,error:'Native live navigation report could not be delivered',report_failure:{code:'live_navigation_report_delivery_failed',received_bytes:bytes,limit_bytes:1_000_000,detail:String(error).slice(0,512)}});return{delivered:false,bytes};}
}

function createNativeLiveToneNavigationControls({document,phase,until,readClock,frame,postAction,readResult,report,controls}){
 nativeLiveToneNavigationCase(phase);let sequence=0,held=false;
 const view=document.defaultView,assert=(value,message)=>{if(!value)throw Error(message);};
 async function native(kind,node,file){
  assert(['click','picker','select-first','select-last','key-r','live-key-r-down','live-key-r-up'].includes(kind),'Unsupported native live navigation action');
  assert(node&&node.isConnected&&!node.disabled,'Owned live navigation target unavailable');
  const splitKey=kind==='live-key-r-down'||kind==='live-key-r-up';
  if(splitKey){
   assert(document.hasFocus()&&!document.hidden&&document.activeElement===node,'Prepared live-key foreground/focus lost');
   if(kind==='live-key-r-down')assert(!held&&node.id==='stage-title'&&document.body.dataset.screen==='stage'&&!document.querySelector('dialog[open]')&&readClock().running,'KeyR down requires the running prepared stage');
   else assert(held,'KeyR up requires its original held native key');
   report.keyPreparations.push({sequence:sequence+1,kind,focus:node.id||null,screen:document.body.dataset.screen,clock:readClock(),timeOrigin:view.performance.timeOrigin});
  }else{
   if(kind==='key-r')assert((document.body.dataset.screen==='authoring'&&node.id==='song-authoring-title')||node.closest('dialog[open]')?.id==='settings-dialog','Blocked KeyR needs the actual authoring or Settings surface');
   await waitCanonicalPracticeControl({document,node,until,readClock});
   // Deliberately do not focus pointer targets. While R is held, only the
   // trusted Windows pointer/focus transition may cancel its live voice.
   node.scrollIntoView({block:'center',inline:'center'});await frame();await frame();
  }
  assert(sequence<64,'Native live navigation action bound exceeded');
  if(kind==='picker')assert(file==='live-tone-navigation-original.json'&&node.id==='import-button','Unexpected native live navigation fixture picker');
  else assert(file===undefined,'Only the owned picker may name a fixture');
  let control;
  if(!splitKey){control={sequence:sequence+1,id:node.id||null,closePanel:node.dataset?.closePanel||null,kind,samples:[]};report.controlActions.push(control);await prepareCanonicalPracticeTarget({document,node,onSample:value=>control.samples.push(value)});}
  const b=node.getBoundingClientRect(),x=b.x+b.width/2,y=b.y+b.height/2,hit=document.elementFromPoint(x,y);
  assert(b.width>0&&b.height>0&&x>0&&x<view.innerWidth&&y>0&&y<view.innerHeight&&(hit===node||node.contains(hit)),'Native live navigation target is obscured or outside the viewport');
  const action={version:1,sequence:++sequence,kind,x,y,width:view.innerWidth,height:view.innerHeight,...(file?{file}:{})},pointer=control&&observeCanonicalPracticeOwnedClick({document,node,sequence});
  if(control){control.request={...action,target:{x:b.x,y:b.y,width:b.width,height:b.height}};control.clicks=pointer.events;}
  let completed=false;if(kind==='picker')controls.beginPicker(sequence,file);
  try{
   await postAction(action);let result;await until(async()=>{result=await readResult(sequence);return result!==null;},`native ${kind} #${sequence}`,15000);assert(result.ok,result.error||'Native live navigation action failed');
   if(control){const after=node.getBoundingClientRect();control.afterDispatch={target:{x:after.x,y:after.y,width:after.width,height:after.height},disabled:Boolean(node.disabled)};await requireCanonicalPracticeOwnedClick({until,events:pointer.events,sequence,id:node.id,kind});}
   if(kind==='live-key-r-down')held=true;else if(kind==='live-key-r-up')held=false;
   completed=true;return sequence;
  }finally{pointer?.restore();if(kind==='picker'&&!completed)controls.endPicker(sequence,false);}
 }
 return{native,sequence:()=>sequence,held:()=>held};
}

async function observeNativeLiveToneNavigation({document,route,release,native,click,until,live,receiver,clock,take,score,report}){
 const $=id=>document.getElementById(id),assert=(value,message)=>{if(!value)throw Error(message);};
 const snapshot=()=>({title:$('score-title').textContent,stageTitle:$('stage-title').textContent,position:clock().positionMs,mode:$('session-mode').value,pass:document.querySelector('.performance-status').dataset.passId,revision:document.querySelector('.performance-status').dataset.revision,captured:$('hud-captured').textContent});
 const quiet=async(label,{seal=true}={})=>{await until(()=>live.quiet(label),`finite live silence ${label}`);if(seal)live.sealCheckpoint(label);};
 assert($('sound-button').getAttribute('aria-pressed')==='false','Native live navigation must remain unmuted');
 assert($('keyboard-map').querySelector('[data-code="KeyR"]').dataset.noteMidi==='60','Native KeyR must retain the original C4 mapping');
 await until(()=>clock().running&&clock().positionMs>0,'original human transport running');
 report.actionRoles.keyFocus=await click('stage-title');live.begin();
 report.actionRoles.keyDown=await native('live-key-r-down',$('stage-title'));
 await until(()=>{const down=live.failureEvidence().current?.inputs.find(row=>row.type==='keydown');return live.sounding()&&down&&document.defaultView.performance.now()-down.wallMs>=40;},'trusted held KeyR and nonzero live PCM');
 if(release==='keyup'){report.actionRoles.keyUp=await native('live-key-r-up',document.activeElement);await until(()=>live.settled(),'original physical keyup terminal');}
 live.checkpoint('navigation');if(release==='keyup')await quiet('navigation');else live.sealCheckpoint('navigation',{requireSilence:false});
 report.actionRoles.navigation=[];
 if(route==='settings')report.actionRoles.navigation.push(await click('settings-button'));
 else for(const id of ['back-to-library','lobby-home','home-song-authoring'])report.actionRoles.navigation.push(await click(id));
 await until(()=>route==='settings'?$('settings-dialog').open:document.body.dataset.screen==='authoring'&&!$('song-authoring-screen').hidden,'native navigation surface visible');
 if(release==='navigation'){
  await until(()=>live.failureEvidence().current.receipts.some(row=>row.record.type==='ended'),'pointer navigation cancelled the still-held native voice');
  report.actionRoles.keyUp=await native('live-key-r-up',document.activeElement);
 }
 await until(()=>receiver.quiet(),'source receivers disposed normally');live.checkpoint('entered');await quiet('entered');
 assert(!document.querySelector('#keyboard .pressed,#keyboard-map .held'),'Native navigation left a pressed physical key');
 assert($('sound-button').getAttribute('aria-pressed')==='false','Cleanup must not hide behind Sound Off');
 report.pausedBefore=snapshot();
 if(route==='settings')await click($('settings-dialog').querySelector('[data-close-panel]'));
 report.actionRoles.beforeTake=await take('beforeTake');
 if(route==='settings')await click('settings-button');
 report.actionRoles.blockedKey=await native('key-r',$(route==='settings'?'settings-title':'song-authoring-title'));
 live.checkpoint('blocked-input');await quiet('blocked-input');report.actionRoles.return=[];
 if(route==='settings')report.actionRoles.return.push(await click($('settings-dialog').querySelector('[data-close-panel]')));
 else for(const id of ['authoring-library','resume-session'])report.actionRoles.return.push(await click(id));
 await until(()=>document.body.dataset.screen==='stage'&&!$('workspace').hidden&&!document.querySelector('dialog[open]'),'return to the paused stage');live.checkpoint('returned');await quiet('returned');
 report.pausedAfter=snapshot();assert(JSON.stringify(report.pausedAfter)===JSON.stringify(report.pausedBefore),'Native navigation changed the complete paused session state');
 report.actionRoles.afterTake=await take('afterTake');report.actionRoles.score=await score();
 live.checkpoint('finished');await quiet('finished',{seal:false});report.audio=live.finish();
}

(() => {
 const phase=globalThis.__WMH_ACCEPTANCE_PHASE__,{route,release}=nativeLiveToneNavigationCase(phase),$=id=>document.getElementById(id),assert=(value,message)=>{if(!value)throw Error(message);};
 const waits=createAcceptanceWait(),fetcher=globalThis.fetch.bind(globalThis),json=(path,body)=>waits.json(fetcher,path,body===undefined?undefined:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)},10000);
 const report={version:1,scenario:'live-tone-navigation',phase,route,release,origin:location.origin,ok:false,stage:'bootstrap',errors:[],trustedActions:[],controlActions:[],keyPreparations:[],actionRoles:{},files:{},physicalAudio:false,pcmCoverage:'finite-checkpoint-windows'};
 let receiver,live,controls,dispatch,cleaned=false;
 const frame=()=>new Promise(requestAnimationFrame),clock=()=>globalThis.__wmhReadPlaybackClock(document),until=(fn,label,ms=15000)=>waits.until(()=>{receiver?.assertHealthy();live?.assertHealthy();return fn();},`${phase}: ${label}`,ms);
 const input=event=>{const target=event.target,part=target.closest?.('.song-mod-part');if(!target.id&&!part&&event.code!=='KeyR'&&!target.closest?.('button')?.dataset.closePanel)return;assert(report.trustedActions.length<256,'Native live navigation trusted event bound');report.trustedActions.push({sequence:dispatch?.sequence()||0,actionSequence:dispatch?.sequence()||0,type:event.type,id:target.id||null,closePanel:target.closest?.('button')?.dataset.closePanel||null,part:part?.dataset.partId||null,modField:target.dataset?.modPerformer?'performer':target.dataset?.modInstrument?'instrument':target.dataset?.modMute?'mute':target.dataset?.modVisible?'visible':null,code:event.code||null,isTrusted:event.isTrusted===true,repeat:Boolean(event.repeat),eventTime:event.timeStamp,surface:target.closest?.('[data-keyboard-performance]')?.id||null,value:target.value??null,checked:typeof target.checked==='boolean'?target.checked:null});};
 const error=event=>{if(report.errors.length<16)report.errors.push(String(event.message||event.reason).slice(0,2048));};addEventListener('error',error);addEventListener('unhandledrejection',error);
 const cleanup=()=>{if(cleaned)return;cleaned=true;report.cleanup={live:live?.restore(),source:receiver?.restore()};report.pickerObservations=controls?.pickers||[];controls?.restore();for(const type of ['click','input','change','keydown','keyup'])document.removeEventListener(type,input,true);removeEventListener('error',error);removeEventListener('unhandledrejection',error);};
 addEventListener('DOMContentLoaded',async()=>{
  try{
   for(const type of ['click','input','change','keydown','keyup'])document.addEventListener(type,input,true);
   await prepareNativePlaybackClock({document,until});const {CanonicalAudioReceiver}=await import('/canonical-audio-receiver.js');
   receiver=await observeBasicKeyReceiver(document,{Receiver:CanonicalAudioReceiver,readStartFrame:note=>note[1],readEndFrame:note=>note[2],readSampleOffsetFrames:canonicalPracticeSampleOffsetFrames});
   live=await observeLiveToneAudio(document,{keyCode:'KeyR',midi:60,readSource:()=>receiver.status()});
   controls=createVsqControlObserver(document,{readActionSequence:()=>dispatch?.sequence()||0});
   dispatch=createNativeLiveToneNavigationControls({document,phase,until,readClock:clock,frame,report,controls,postAction:action=>json('/__desktop_smoke/action',action),readResult:async sequence=>{const response=await fetcher(`/__desktop_smoke/result/${sequence}`);if(response.status===404)return null;const result=await response.json();assert(response.ok,result.error||'Native result read failed');return result;}});
   const native=dispatch.native,click=id=>native('click',typeof id==='string'?$(id):id),close=id=>click($(id).querySelector('[data-close-panel]'));
   const download=async(id,name)=>{const before=(await json('/__desktop_smoke/state')).downloads.length,action=await click(id);let row;await until(async()=>{row=(await json('/__desktop_smoke/state')).downloads[before];return row?.complete;},`download ${name}`);assert(row.success,'Native live navigation export failed');report.files[name]=row.file;return action;};
   const take=async name=>{await click('results-button');await until(()=>!$('export-takes').disabled,'native take export ready');const action=await download('export-takes',name);await close('results-dialog');return action;};
   const score=async()=>{await click('score-tools-button');const action=await download('export-button','score');await close('score-tools-dialog');return action;};
   assert((await json('/api/health')).network==='native-protocol-no-listener','Actual Rust native protocol required');
   (await import('/app-locale.js')).getAppI18n(document).setLocale('en');await click('home-single-player');await until(()=>document.body.dataset.screen==='library','native library');
   await click('settings-button');const options=document.querySelector('.practice-options');if(!options.open)await click(options.querySelector('summary'));for(const id of ['count-in','metronome-enabled'])if($(id).checked)await click(id);await close('settings-dialog');
   await click('import-tools-button');let picker,complete=false;
   try{picker=await native('picker',$('import-button'),'live-tone-navigation-original.json');await until(()=>$('score-title').textContent==='Original live tone navigation exercise'&&document.querySelector('.score-storage-status')?.dataset.persistence==='saved','original native fixture imported');complete=true;}finally{if(picker)controls.endPicker(picker,complete);}
   if($('import-tools-dialog').open)await close('import-tools-dialog');
   if(document.body.dataset.screen==='stage')await click('back-to-library');
   const inventory=await json('/api/library/list');assert(inventory.storage==='native-filesystem'&&inventory.issues.length===0&&inventory.entries.length===1,'Exactly one original native fixture required');
   report.key=inventory.entries[0].key;const opened=await json('/api/library/load',{key:report.key});report.sourceScoreJson=opened.score_json;report.sourceTitle=JSON.parse(opened.score_json).title;
   await until(()=>document.querySelector(`#catalog [data-library-key="native:${report.key}"]`),'saved native fixture row');await click(document.querySelector(`#catalog [data-library-key="native:${report.key}"]`));await until(()=>$('song-lobby').dataset.previewId===`native:${report.key}`&&$('song-lobby').dataset.previewStatus==='ready','saved original fixture preview');
   const mod=createAcceptanceSongMod({document,native,until});await mod.configure('all',{layout:'solo'});report.actionRoles.play=await mod.startApplied();report.modActions=mod.history;
   if($('notation-toggle').getAttribute('aria-expanded')==='true')await click('notation-toggle');
   report.stage='finite-navigation';await observeNativeLiveToneNavigation({document,route,release,native,click,until,live,receiver,clock,take,score,report});
   assert(!dispatch.held(),'Native KeyR remained held');assert(report.errors.length===0,report.errors.join('; '));report.stage='complete';report.ok=true;
  }catch(cause){report.error=cause.stack||String(cause);try{report.failedAudio=live?.failureEvidence();}catch{}}
  finally{
   report.actions=dispatch?.sequence()||0;try{cleanup();}catch(error){report.ok=false;report.error??=String(error);report.errors.push(`Cleanup: ${String(error).slice(0,512)}`);}
   await deliverNativeLiveToneNavigationReport(report,value=>json('/__desktop_smoke/report',value));
  }
 });
})();

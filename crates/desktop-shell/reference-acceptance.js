/* Process-owner hosted Windows acceptance only. All audio calls below forward to
 * the real native WebView AudioContext; no parser, audio, file input or API mock. */
// Import the production's versioned DOM reader before any owned scenario.
// Native range strings remain input evidence, never a source-clock fallback.
async function prepareNativePlaybackClock({document=globalThis.document,until}){
 if(typeof globalThis.__wmhReadPlaybackClock!=='function')globalThis.__wmhReadPlaybackClock=(await import('/playback-clock-view.js')).readPlaybackClock;
 if(typeof until!=='function')throw Error('Playback clock preparation needs the existing bounded readiness wait');
 await until(()=>{const node=document.getElementById('progress');if(!node||node.getAttribute('data-playback-clock')===null)return false;globalThis.__wmhReadPlaybackClock(document);return true;},'first published playback clock');
}
function nativePlaybackEnded(endMs,document=globalThis.document){const clock=globalThis.__wmhReadPlaybackClock(document);return clock.positionMs===endMs&&clock.completed&&clock.phase==='ended';}
function nativePlaybackClockDiagnostic(document){try{const clock=globalThis.__wmhReadPlaybackClock(document);return{position:clock.positionMs,clock};}catch(error){return{position:null,clockError:String(error).slice(0,512)};}}

const NATIVE_REFERENCE_FIXTURE=Object.freeze({name:'original-reference-overlap.mid',sha256:'c2d487c1044c31ab520afce4ffa06c0513ca7250ec129cf96d71f7a671a46f66',tracks:3,events:26,onsets:8});

function observeNativeReferenceAudio(root=globalThis) {
  const rows=[],restores=[];let sourceStarts=0;
  const prototypes=new Set([root.AudioContext?.prototype,root.webkitAudioContext?.prototype].filter(Boolean));
  if(!prototypes.size)throw Error('Native reference acceptance requires real AudioContext');
  for(const prototype of prototypes)for(const method of ['createOscillator','createBufferSource']) {
    const original=prototype[method];
    if(typeof original!=='function')throw Error(`Missing native audio method ${method}`);
    prototype[method]=function(...args) {
      const source=original.apply(this,args);
      if(rows.length>=512)throw Error('Native reference audio observation exceeded its finite source bound');
      const row={context:this,kind:method,start:null,stop:Infinity,disconnected:false};rows.push(row);
      const start=source.start,stop=source.stop,disconnect=source.disconnect;
      source.start=function(...values){const result=start.apply(this,values);row.start=Math.max(row.context.currentTime,Number(values[0])||0);sourceStarts++;return result;};
      source.stop=function(...values){const result=stop.apply(this,values);row.stop=Math.max(row.context.currentTime,Number(values[0])||0);return result;};
      source.disconnect=function(...values){const result=disconnect.apply(this,values);if(values.length===0)row.disconnected=true;return result;};
      return source;
    };
    restores.push(()=>{prototype[method]=original;});
  }
  return {snapshot(){return {sourceStarts,oscillatorStarts:rows.filter(row=>row.kind==='createOscillator'&&row.start!==null).length,
    activeSources:rows.filter(row=>!row.disconnected&&row.start!==null&&row.start<=row.context.currentTime&&row.stop>row.context.currentTime).length,
    pendingSources:rows.filter(row=>!row.disconnected&&row.start!==null&&row.start>row.context.currentTime&&row.stop>row.start).length};},restore(){for(const restore of restores)restore();}};
}

// Observe only the finite scored-take preparation. Native dispatch success does
// not establish DOM event receipt or a running transport. No input is synthesized.
function observeNativeReferenceTransport(document, {now=()=>performance.now(),defer=queueMicrotask,keyCode='KeyR'}={}) {
  const $=id=>document.getElementById(id),window=document.defaultView,rows=[],remove=[];
  const started=now(),encoder=new TextEncoder();let omitted=0,rowBytes=2,active=true,lastState='',trustedPlayClicks=0,trustedKeyDowns=0,trustedKeyUps=0;
  const text=value=>String(value ?? '').slice(0,64);
  function state(){const status=document.querySelector('.performance-status');return {
    screen:text(document.body.dataset.screen),mode:text($('session-mode')?.value),hidden:Boolean(document.hidden),
    focused:typeof document.hasFocus==='function'?document.hasFocus():null,activeElement:text(document.activeElement?.id),
    openDialogs:[...document.querySelectorAll('dialog[open]')].slice(0,4).map(node=>text(node.id)),
    playDisabled:Boolean($('play-button')?.disabled),playText:text($('play-button')?.textContent),
    phase:text(status?.dataset.phase),passId:text(status?.dataset.passId),revision:text(status?.dataset.revision),
    captured:text($('hud-captured')?.textContent),positionMs:globalThis.__wmhReadPlaybackClock(document).positionMs,transportPositionMs:globalThis.__wmhReadPlaybackClock(document).transportPositionMs,durationMs:globalThis.__wmhReadPlaybackClock(document).durationMs,
    cue:text($('stage-cue')?.dataset.cueState),soundMuted:$('sound-button')?.getAttribute('aria-pressed')==='true',
  };}
  function append(kind,detail={}){if(!active)return;const row={elapsedMs:Math.max(0,now()-started),kind,...detail,state:state()},bytes=encoder.encode(JSON.stringify(row)).length+1;
    while(rows.length&&(rows.length>=64||rowBytes+bytes>24*1024)){rowBytes-=encoder.encode(JSON.stringify(rows.shift())).length+1;omitted++;}
    if(rowBytes+bytes<=24*1024){rows.push(row);rowBytes+=bytes;}else omitted++;
  }
  function changed(label,{checkpoint=false}={}){const current=state(),signature=JSON.stringify({...current,positionMs:undefined,transportPositionMs:undefined});if(checkpoint||signature!==lastState){lastState=signature;append(label);}return current;}
  function observe(event){
    const element=event.target?.closest?.('[id]'),target=text(element?.id||event.target?.localName||'window');
    const control=text(event.target?.closest?.('button')?.id),surface=text(event.target?.closest?.('[data-keyboard-performance]')?.id);
    if(event.isTrusted===true&&event.type==='click'&&control==='play-button')trustedPlayClicks++;
    if(event.isTrusted===true&&event.code===keyCode&&surface==='stage-title'){
      if(event.type==='keydown'&&!event.repeat)trustedKeyDowns++;
      if(event.type==='keyup')trustedKeyUps++;
    }
    append('event',{event:{type:text(event.type),trusted:event.isTrusted===true,target,control,surface,code:text(event.code),repeat:Boolean(event.repeat),
      preventedAtCapture:Boolean(event.defaultPrevented),eventTime:Number.isFinite(event.timeStamp)?event.timeStamp:null,
      x:Number.isFinite(event.clientX)?event.clientX:null,y:Number.isFinite(event.clientY)?event.clientY:null}});
    if(['click','keydown','keyup','blur','visibilitychange'].includes(event.type))defer(()=>{if(active)changed(`after-${event.type}`);});
  }
  for(const type of ['pointerdown','pointerup','click','keydown','keyup','focusin','focusout','visibilitychange']){document.addEventListener(type,observe,true);remove.push(()=>document.removeEventListener(type,observe,true));}
  for(const type of ['focus','blur']){window?.addEventListener(type,observe,true);remove.push(()=>window?.removeEventListener(type,observe,true));}
  append('begin');
  return {state,changed,counts:()=>({trustedPlayClicks,trustedKeyDowns,trustedKeyUps}),
    snapshot:stage=>({version:1,stage,rows:rows.slice(),omitted,rowBytes,...{trustedPlayClicks,trustedKeyDowns,trustedKeyUps},current:state()}),
    stop(){active=false;for(const cleanup of remove)cleanup();}};
}

async function prepareNativeReferenceScoredTake({document,native,click,closeDialogs,until,onPrepared=()=>{}}) {
  await prepareNativePlaybackClock({document,until});
  const $=id=>document.getElementById(id);let trace=observeNativeReferenceTransport(document);
  let stage='prepare';const setupActions=[];const setupClick=async id=>{const sequence=await native('click',typeof id==='string'?$(id):id);setupActions.push({sequence,id:typeof id==='string'?id:id.id||'settings-close'});};
  try {
    closeDialogs();if(document.body.dataset.screen!=='stage'){
      const resume=$('resume-session');
      if(!resume||resume.hidden||resume.closest('[hidden]'))throw Error('Scored take preparation requires an active score before resuming');
      click('resume-session');
    }
    await until(()=>document.body.dataset.screen==='stage'&&!$('play-button').disabled,'resumed score stage');
    if($('sound-button').getAttribute('aria-pressed')!=='true')await setupClick('sound-button');
    if($('edit-song-mod')){await setupClick('edit-song-mod');await setupClick('song-mod-all-human');await setupClick('song-mod-apply');await until(()=>!$('song-mod-dialog').open&&$('session-mode').value==='practice','human Mod applied');}
    else if($('session-mode').value!=='practice')throw Error('Visible Mod setup is required before scored transport');
    if($('edit-song-mod')){await setupClick('settings-button');if($('count-in').checked)await setupClick('count-in');await setupClick($('settings-dialog').querySelector('[data-close-panel]'));}
    else if($('count-in').checked)throw Error('Visible count-in setup is required before scored transport');
    // Setup has its own action receipts. Begin the bounded performance trace
    // only after all Mod/settings controls close, retaining its original budget.
    trace.stop();trace=observeNativeReferenceTransport(document);
    // Readiness is a required evidence boundary even when an event callback
    // already sampled the same state; ordinary polling remains deduplicated.
    await until(()=>!$('play-button').disabled,'score practice ready');onPrepared();const initialPosition=trace.changed('ready',{checkpoint:true}).positionMs;
    stage='transport-start';await native('click',$('play-button'));
    // The actual native key is never sent merely because the OS helper returned.
    // Require its trusted Play click and observable recorder/clock admission.
    await until(()=>{const current=trace.changed('await-transport-start');return trace.counts().trustedPlayClicks===1&&current.phase==='capturing'&&/^[1-9][0-9]*$/.test(current.passId)&&current.positionMs>initialPosition&&current.positionMs<current.durationMs&&!current.hidden&&current.openDialogs.length===0;},'native scored transport started');
    const passId=trace.state().passId;stage='keyboard-capture';await native('key-r',$('stage-title'));
    await until(()=>{const current=trace.changed('await-keyboard-capture'),events=trace.counts();return events.trustedKeyDowns===1&&events.trustedKeyUps===1&&current.passId===passId&&current.phase==='capturing'&&current.captured==='1';},'one actual Windows keyboard input');
    stage='transport-pause';await native('click',$('play-button'));
    await until(()=>{const current=trace.changed('await-transport-pause');return trace.counts().trustedPlayClicks===2&&current.passId===passId&&current.captured==='1'&&current.phase!=='capturing'&&current.cue==='paused';},'native scored transport paused');
    return {...trace.snapshot('complete'),setupActions};
  } catch(error) {trace.changed('failed');error.nativeReferenceTransport=trace.snapshot(stage);throw error;}
  finally {trace.stop();}
}

async function checkNativeReferenceListening({document,native,click,closeDialogs,download,until,delay,requests}) {
  const $=id=>document.getElementById(id),f=NATIVE_REFERENCE_FIXTURE,checks=[],files={};
  const assert=(value,message)=>{if(!value)throw Error(`Native reference: ${message}`);};
  const state=value=>until(()=>$('reference-status').dataset.state===value,`reference ${value}`);
  const play=async()=>{await native('click',$('reference-play'));await state('playing');};
  const open=async()=>{closeDialogs();click('import-tools-button');await native('click',$('reference-listening-entry'));assert($('reference-listening-dialog').open,'actual Import entry did not open');};
  const snapshot=()=>({title:$('score-title').textContent,stage:$('stage-title').textContent,mode:$('session-mode').value,clock:globalThis.__wmhReadPlaybackClock(document).positionMs,captured:$('hud-captured').textContent,pass:document.querySelector('.performance-status').dataset.passId,revision:document.querySelector('.performance-status').dataset.revision});
  async function scoreDownload(){closeDialogs();click('score-tools-button');const file=await download('export-button');closeDialogs();return file;}
  async function takeDownload(){closeDialogs();click('results-button');const file=await download('export-takes');closeDialogs();return file;}
  const transportAdmission=await prepareNativeReferenceScoredTake({document,native,click,closeDialogs,until});
  files.beforeScore=await scoreDownload();files.beforeTake=await takeDownload();
  const before=JSON.stringify(snapshot()),requestStart=requests.length,probe=observeNativeReferenceAudio();let cleanupChecks=0;
  function unchanged(label){assert(JSON.stringify(snapshot())===before,`${label}: score/take display changed`);}
  function clean(label){const current=probe.snapshot();assert(current.activeSources===0&&current.pendingSources===0,`${label}: native voices remain scheduled or active`);cleanupChecks++;return current;}
  try {
    await open();let pickerEvent=null;
    const pickerListener=event=>{pickerEvent=event.type;};
    $('reference-file').addEventListener('change',pickerListener,{once:true});
    await native('picker',$('reference-choose-file'),f.name);
    await until(()=>pickerEvent==='change'&&$('reference-counts').dataset.eventCount==='26'&&requests.slice(requestStart).some(row=>row.path==='/api/midi/events'&&row.status===200),'actual native MIDI selection and Rust inspection');
    $('reference-file').removeEventListener('change',pickerListener);
    const parsed=requests.slice(requestStart).filter(row=>row.path==='/api/midi/events');
    assert(parsed.length===1,'source must pass through one live Rust load');
    const timeline=parsed[0].body;
    assert(timeline.source_sha256===f.sha256&&timeline.track_count===f.tracks&&timeline.events.length===f.events,'Rust complete source identity/counts');
    assert(timeline.events.filter(row=>row.kind.kind==='channel'&&row.kind.message.kind==='note_on'&&row.kind.message.velocity>0).length===f.onsets,'all independent onsets retained');
    assert(timeline.events.some(row=>row.kind.kind==='channel'&&row.kind.channel===9&&row.kind.message.kind==='program_change'&&row.kind.message.program===118),'source percussion program 118 was lost');
    assert($('reference-source-name').textContent===f.name,'original selected filename');
    assert($('reference-counts').dataset.trackCount==='3'&&$('reference-counts').dataset.onsetCount==='8','visible total track/onset counts');
    assert(JSON.stringify([...$('reference-tracks').children].map(row=>[Number(row.dataset.eventCount),Number(row.dataset.onsetCount)]))===JSON.stringify([[10,3],[7,2],[9,3]]),'visible per-track counts');
    assert($('reference-programs').textContent.includes('118'),'visible source program');
    assert($('reference-play').disabled&&!$('reference-policy-accept').checked,'explicit policy required');
    assert(probe.snapshot().sourceStarts===0,'loading source started audio');files.original=await download('reference-download');
    checks.push('native-filechooser','complete-original-source','explicit-rendition-policy');
    await native('click',$('reference-policy-accept'));await native('click',$('reference-sound'));
    assert($('sound-button').getAttribute('aria-pressed')==='false','reference uses the global sound preference');
    assert(probe.snapshot().sourceStarts===0,'policy or sound preference started audio');
    await play();await until(()=>probe.snapshot().sourceStarts>0&&!$('reference-clock').textContent.startsWith('0:00.0 /'),'real reference sources and elapsed time');
    await native('key-r',$('reference-source-name'));unchanged('native keyboard inside listener');checks.push('reference-input-isolated');
    await native('click',$('reference-pause'));await state('paused');clean('Pause');
    const pausedClock=$('reference-clock').textContent,controls=[...$('reference-listening-dialog').querySelectorAll('input,button')];
    const {getAppI18n}=await import('/app-locale.js'),i18n=getAppI18n(document);
    for(const locale of ['zh-CN','en']){i18n.setLocale(locale);assert($('reference-clock').textContent===pausedClock&&controls.every(node=>document.getElementById(node.id)===node),'locale replaced controls or moved paused clock');assert($('reference-source-name').textContent===f.name,'locale changed source filename');}
    checks.push('live-locale-preserved');unchanged('live locale');
    await play();await state('playing');
    let cancelEvent=false;const cancelListener=()=>{cancelEvent=true;};$('reference-file').addEventListener('cancel',cancelListener,{once:true});
    await native('cancel-picker',$('reference-choose-file'));await until(()=>cancelEvent,'native reference picker cancellation');$('reference-file').removeEventListener('cancel',cancelListener);
    await state('paused');assert(!$('reference-clock').textContent.startsWith('0:00.0 /'),'cancelled chooser reset paused clock');assert($('reference-source-name').textContent===f.name,'cancelled chooser replaced source');clean('native picker cancel');
    await native('click',$('reference-stop'));await state('stopped');clean('Stop');assert($('reference-clock').textContent==='0:00.0 / 0:06.0','Stop did not reset clock');
    checks.push('play-pause-resume-stop');
    const beforeComplete=probe.snapshot();await play();await state('ended');const afterComplete=clean('all tracks complete');
    assert(afterComplete.oscillatorStarts-beforeComplete.oscillatorStarts===14,'complete reference run lost or invented source onsets');
    checks.push('all-tracks-complete');await native('click',$('reference-stop'));
    await native('click',$('reference-mute-1'));assert($('reference-mute-1').checked&&!$('reference-mute-1').disabled,'independent mute unavailable while stopped');
    const beforeMuted=probe.snapshot();await play();await state('ended');const afterMuted=clean('muted track complete');
    assert(afterMuted.oscillatorStarts-beforeMuted.oscillatorStarts===10,'independent track mute lost or invented reference onsets');
    assert($('reference-counts').dataset.eventCount==='26'&&$('reference-counts').dataset.onsetCount==='8','muting changed source counts');checks.push('independent-track-mute');
    await native('click',$('reference-stop'));await native('click',$('reference-mute-1'));
    await play();await native('click',$('reference-sound'));await state('muted');clean('global sound off');
    assert($('sound-button').getAttribute('aria-pressed')==='true'&&$('reference-play').disabled,'global mute state incoherent');
    const mutedStarts=probe.snapshot().sourceStarts;await native('click',$('reference-sound'));await state('stopped');assert(probe.snapshot().sourceStarts===mutedStarts,'unmute auto-started sound');checks.push('shared-sound-mute');
    await play();await native('click',$('reference-close'));assert(!$('reference-listening-dialog').open,'native Close did not dismiss');clean('Close');
    const closedStarts=probe.snapshot().sourceStarts;await delay(200);assert(probe.snapshot().sourceStarts===closedStarts,'old timer scheduled after Close');
    await open();await state('stopped');assert($('reference-source-name').textContent===f.name&&$('reference-counts').dataset.eventCount==='26','Close discarded retained source');click('reference-close');checks.push('close-cleanup');
    unchanged('reference playback complete');files.afterScore=await scoreDownload();files.afterTake=await takeDownload();
    assert(!requests.slice(requestStart).some(row=>['/api/compile','/api/import/midi','/api/assess','/api/practice-targets'].includes(row.path)),'reference operations entered score import, compilation or assessment');
    checks.push('canonical-score-unchanged','scored-take-unchanged');
    return {ok:true,transportAdmission,fixture:f.name,sourceSha256:f.sha256,eventCount:f.events,trackCount:f.tracks,onsetCount:f.onsets,files,checks,audio:{...clean('final'),cleanupChecks}};
  } finally {if($('reference-listening-dialog')?.open)click('reference-close');probe.restore();}
}

// Shared actual AudioWorklet evidence for MIDI and authored VSQ.
async function observeBasicKeyReceiver(document,{Receiver,root=globalThis,onContext=()=>{},onStart=()=>{},readStartFrame=note=>note[2],readEndFrame=note=>note[3],readSampleOffsetFrames,graphOnly=false,graphObserver}={}){
 // Observe the shipped adapter and native MessagePort without replacing a
 // processor, audio clock, command, callback result, or application promise.
 if(!graphOnly)Receiver ||= (await import('/basic-key-audio-receiver.js')).BasicKeyAudioReceiver;
 const rows=[],initializations=[],owners=new Map(),contexts=new Map(),errors=[];let active=true,overflow=false;
 const errorRecord=error=>{
  const details={};for(const key of ['phase','moduleUrl','isSecureContext','hasAudioWorklet','addModuleType','audioWorkletNodeType','usesNodeFactory','contextState','sampleRate','causeName','causeMessage','cause','command','timeoutMs','outcome','discontinuityKind','expectedFrame','actualFrame','previousBlockFrame','previousBlockLength','blockLength','frameDelta','successfulBlocks','missedAttackIndex','generation','planGeneration','sourceSha256','policyId','identityKind','frame','anchorFrame','positionFrame']){const value=error?.details?.[key];if(['string','number','boolean'].includes(typeof value)||value===null)details[key]=typeof value==='string'?value.slice(0,1024):value;}
  return{code:String(error?.code||error?.name||'error').slice(0,96),name:String(error?.name||'Error').slice(0,96),message:String(error?.message||error).slice(0,1024),details};
 };
 const pushError=error=>{if(errors.length<32)errors.push(errorRecord(error));else overflow=true;};
 const clock=()=>({wallMs:root.performance.now(),audioTime:null}),copy=value=>structuredClone(value);
 const audioProto=root.AudioNode?.prototype,connect=audioProto?.connect,disconnect=audioProto?.disconnect,edges=new Map(),graphIds=new WeakMap(),graphEvents=[];let graphTotal=0,nextGraphId=0;
 const graphId=node=>{if(!node||!['object','function'].includes(typeof node))return null;if(!graphIds.has(node))graphIds.set(node,++nextGraphId);return graphIds.get(node);};
 const graphChange=(kind,node,target)=>{if(!active)return;try{graphTotal++;if(graphEvents.length===64)graphEvents.shift();graphEvents.push({sequence:graphTotal,kind,node:graphId(node),nodeType:String(node?.constructor?.name||'unknown').slice(0,64),target:graphId(target),targetType:String(target?.constructor?.name||'none').slice(0,64),wallMs:root.performance.now(),audioTime:node?.context?.currentTime??null});}catch(error){pushError(error);}};
 function connected(target,...args){const result=Reflect.apply(connect,this,[target,...args]);if(active){if(edges.size>=4096&&!edges.has(this))overflow=true;else{if(!edges.has(this))edges.set(this,new Set());edges.get(this).add(target);}graphChange('connect',this,target);}return result;}
 function disconnected(...args){const result=Reflect.apply(disconnect,this,args);if(!args.length||typeof args[0]==='number')edges.delete(this);else edges.get(this)?.delete(args[0]);graphChange('disconnect',this,args[0]);return result;}
 if(audioProto&&!graphObserver){audioProto.connect=connected;audioProto.disconnect=disconnected;}
 const graphPath=graphObserver?.path||((node,destination,seen=new Set())=>{if(seen.has(node))return null;seen.add(node);const current={type:node.constructor.name,gain:node.gain?.value??null};if(node===destination)return[current];for(const next of edges.get(node)||[]){const path=graphPath(next,destination,seen);if(path)return[current,...path];}return null;});
 // A graph-only observer can begin before application navigation creates its
 // persistent output chain. Late receiver attachment borrows these exact node
 // objects and observed connect/disconnect calls; no edge is inferred or added.
 const graphStatus=()=>graphObserver?.status()||{errors:copy(errors),overflow,graphHistory:{total:graphTotal,omitted:Math.max(0,graphTotal-graphEvents.length),events:copy(graphEvents)}};
 const graphConnections=node=>graphObserver?graphObserver.connections(node):edges.get(node)?.size||0;
 const restoreGraph=()=>{if(graphObserver)return graphObserver.restore();let restored=true;
  if(audioProto){for(const[method,wrapped,original]of [['connect',connected,connect],['disconnect',disconnected,disconnect]])try{if(audioProto[method]===wrapped)audioProto[method]=original;if(audioProto[method]!==original)restored=false;}catch(error){pushError(error);restored=false;}}
  return restored;
 };
 if(graphOnly)return{path:graphPath,connections:graphConnections,status:graphStatus,restore(){active=false;return restoreGraph();}};
 const proto=Receiver.prototype;
 const observedErrors=()=>graphObserver?[...copy(errors),...graphStatus().errors]:copy(errors),observedOverflow=()=>overflow||Boolean(graphObserver&&graphStatus().overflow);
 function observe(owner){
  if(owners.has(owner))return owners.get(owner);
  if(owners.size>=32){overflow=true;throw Error('Audio receiver observation bound');}
  const context=owner.context,node=owner.node,originals={},entry={id:owners.size+1,owner,node,originals,rows:[],transfers:new Map(),hashes:new Set(),analyser:null,pending:null};owners.set(owner,entry);
  if(!contexts.has(context)){const states=[],listener=()=>{if(states.length<128)states.push({...clock(),audioTime:context.currentTime,state:context.state});else overflow=true;};contexts.set(context,{states,listener});context.addEventListener?.('statechange',listener);listener();onContext(context);}
  // Observe the exact outgoing native-port table before transfer detaches it.
  // Hash a temporary copy asynchronously; do not change the call, arguments,
  // return value or promise, and never retain the half-megabyte table in JSON.
  const postMessage=node.port.postMessage;
  if(typeof postMessage==='function'){
   entry.postMessage=function(...args){
    const message=args[0],wire=message?.wire;let evidence,buffer;
    if(active&&message.type==='prepare'&&wire?.identityKind==='vsq-authored-note')try{
     buffer=wire.buffers.triangles;
     if(Object.prototype.toString.call(buffer)!=='[object ArrayBuffer]'||buffer.byteLength!==128*1024*4)throw Error('VSQ triangle transfer shape changed');
     evidence={recipe:'wmh-vsq-bandlimited-triangle-1024-v1',sampleRate:wire.sampleRate,type:'Float32Array',length:128*1024,bytes:buffer.byteLength,sha256:null,transferred:Array.isArray(args[1])&&args[1].filter(value=>value===buffer).length===1,detached:false};
     entry.transfers.set(message.generation,evidence);
     const pending=root.crypto.subtle.digest('SHA-256',buffer.slice(0)).then(hash=>{evidence.sha256=Array.from(new Uint8Array(hash),value=>value.toString(16).padStart(2,'0')).join('');},pushError).finally(()=>entry.hashes.delete(pending));entry.hashes.add(pending);
    }catch(error){pushError(error);}
    const result=Reflect.apply(postMessage,this,args);if(evidence)evidence.detached=buffer.byteLength===0;return result;
   };entry.originals.postMessage=postMessage;node.port.postMessage=entry.postMessage;
  }
  const capture=(kind,record,extra={})=>{const row=entry.rows.find(row=>row.planGeneration===record?.planGeneration);if(!row){pushError(Error('Unowned audio completion'));return;}if(row.terminals.length>=4){overflow=true;return;}
   const ledger=record.ledger,valid=Object.prototype.toString.call(ledger?.actualStarts)==='[object Float64Array]'&&Object.prototype.toString.call(ledger?.actualEnds)==='[object Float64Array]'&&ledger.actualStarts.length<=65536&&ledger.actualEnds.length<=65536;
   if(!valid){pushError(Error('Actual bounded Float64 processor ledger required'));return;}
   row.terminals.push({callback:kind,...extra,record:{...record,ledger:{actualStarts:Array.from(ledger.actualStarts),actualEnds:Array.from(ledger.actualEnds)}},ledgerType:'Float64Array',...clock(),audioTime:context.currentTime});
  };
  for(const kind of ['onEnded','onStopped','onError']){const original=owner[kind];originals[kind]=original;const wrapped=function(...args){if(active){if(kind==='onError')pushError(args[0]);else capture(kind,args[0]);}return Reflect.apply(original,this,args);};entry[kind]=wrapped;owner[kind]=wrapped;}
  entry.message=event=>{if(!active)return;const message=event.data,row=entry.rows.find(row=>row.planGeneration===(message.planGeneration||message.generation));if(!row)return;
   if(row.messages.length>=16){overflow=true;return;}row.messages.push({type:message.type,generation:message.generation,planGeneration:message.planGeneration,frame:message.frame,anchorFrame:message.anchorFrame,positionFrame:message.positionFrame,isTrusted:event.isTrusted===true,portMatches:event.target===node.port,...(message.type==='error'?{error:errorRecord({name:'BasicKeyAudioError',code:message.code,message:message.message,details:{...message,...message.details}})}:{})});
   if(['ended','canceled'].includes(message.type)&&message.ledger){const ledger=message.ledger,valid=Object.prototype.toString.call(ledger.actualStarts)==='[object Float64Array]'&&Object.prototype.toString.call(ledger.actualEnds)==='[object Float64Array]'&&ledger.actualStarts.length<=65536&&ledger.actualEnds.length<=65536;
    if(!valid){pushError(Error('Actual bounded raw-port Float64 ledger required'));return;}if(row.rawTerminals.length>=4){overflow=true;return;}
    row.rawTerminals.push({record:{...message,ledger:{actualStarts:Array.from(ledger.actualStarts),actualEnds:Array.from(ledger.actualEnds)}},ledgerType:'Float64Array',isTrusted:event.isTrusted===true,portMatches:event.target===node.port});
   }
  };
  // Capture phase retains the raw native payload before the adapter's ordinary
  // onmessage handler can transform it. A second passive listener runs after it.
  node.port.addEventListener('message',entry.message,true);
  entry.afterMessage=event=>{if(!active)return;const message=event.data,row=entry.rows.find(row=>row.planGeneration===message.planGeneration);if(row&&['ended','canceled'].includes(message.type)&&message.ledger&&!row.terminals.some(terminal=>terminal.record.type===message.type&&terminal.record.generation===message.generation))capture('MessagePort',message,{fencedGeneration:owner.generation});};node.port.addEventListener('message',entry.afterMessage);
  entry.processorError=()=>pushError(Object.assign(Error('Actual AudioWorklet processorerror'),{code:'audio_processor_error'}));node.addEventListener('processorerror',entry.processorError);
  return entry;
 }
 function sample(entry,row){
  if(!active||entry.sampleRow!==row)return;const owner=entry.owner;
  if(entry.analyser&&row.pcm.blocks.length<64&&owner.connected&&owner.context.state==='running'&&(owner.context.currentTime>=entry.sampleFromAudioTime||row.pcm.blocks.length<4)){
   const values=new Float32Array(256);entry.analyser.getFloatTimeDomainData(values);let peak=0,sum=0;for(const value of values){peak=Math.max(peak,Math.abs(value));sum+=value*value;}
   row.pcm.blocks.push({...clock(),audioTime:owner.context.currentTime,peak,rms:Math.sqrt(sum/values.length)});if(peak>1e-6&&owner.context.currentTime>=row.started.anchorTime&&!row.pcm.graphToDestination)row.pcm.graphToDestination=graphPath(owner.node,owner.context.destination);
  }
  if(row.pcm.blocks.length<64&&!owner.disposed&&!owner.disposing&&owner.state!=='ended')entry.pending=root.requestAnimationFrame(()=>sample(entry,row));else entry.pending=null;
 }
 const create=Receiver.create;
 function created(...args){
  let row;try{if(active){if(initializations.length>=32)overflow=true;else{const context=args[0];row={index:initializations.length+1,settled:false,...clock(),contextState:context?.state??null,audioTime:context?.currentTime??null,isSecureContext:typeof root.isSecureContext==='boolean'?root.isSecureContext:null,hasAudioWorklet:Boolean(context?.audioWorklet),addModuleType:typeof context?.audioWorklet?.addModule,audioWorkletNodeType:typeof root.AudioWorkletNode};initializations.push(row);}}}catch(observationError){pushError(observationError);}
  const failed=error=>{if(!active)return;try{if(row){row.settled=true;row.ok=false;row.error=errorRecord(error);}pushError(error);}catch(observationError){pushError(observationError);}};
  let result;try{result=Reflect.apply(create,this,args);}catch(error){failed(error);throw error;}
  if(result&&typeof result.then==='function')result.then(()=>{if(active&&row){row.settled=true;row.ok=true;}},failed);
  else if(active&&row){row.settled=true;row.ok=true;}
  return result;
 }
 if(typeof create==='function')Receiver.create=created;
 const prepare=proto.prepare,start=proto.start;
 function prepared(...args){
  const entry=observe(this),result=Reflect.apply(prepare,this,args),plan=this.plan;
  if(plan){if(rows.length>=32||plan.notes.length>65536){overflow=true;return result;}
   const row={receiverId:entry.id,planGeneration:this.generation,plan:copy(plan),positionFrame:this.positionFrame,...(entry.transfers.has(this.generation)?{timbre:entry.transfers.get(this.generation)}:{}),prepared:null,started:null,terminals:[],rawTerminals:[],messages:[],node:{actualAudioWorkletNode:typeof root.AudioWorkletNode==='function'&&this.node instanceof root.AudioWorkletNode,contextMatches:this.node.context===this.context,numberOfInputs:this.node.numberOfInputs,numberOfOutputs:this.node.numberOfOutputs},pcm:{method:'passive-output-analyser',fftSize:256,blocks:[]}};rows.push(row);entry.rows.push(row);
   try{if(!entry.analyser){entry.analyser=this.context.createAnalyser();entry.analyser.fftSize=256;this.output.connect(entry.analyser);}}catch(error){pushError(error);}
   result.then(value=>{row.prepared=copy(value);},pushError);
  }return result;
 }
 function started(...args){
  const entry=observe(this),row=entry.rows.at(-1),result=Reflect.apply(start,this,args);
  if(row){
   result.then(value=>{if(!active)return;row.started={...copy(value),observedAudioTime:this.context.currentTime,connected:this.connected,outputContextMatches:this.output?.context===this.context,outputGain:this.output?.gain?.value??null,graphToDestination:graphPath(this.node,this.context.destination)};onStart(this,row);
    try{
     entry.sampleRow=row;const first=row.plan.notes.find(note=>readEndFrame(note)>row.positionFrame);
     const offsetFrames=readSampleOffsetFrames?readSampleOffsetFrames(row.plan,row.positionFrame):Math.max(first?readStartFrame(first):row.positionFrame,row.positionFrame)-row.positionFrame;
     if(offsetFrames!==null&&(!Number.isSafeInteger(offsetFrames)||offsetFrames<0))throw Error('Invalid observed source sampling offset');
     entry.sampleFromAudioTime=offsetFrames===null?Infinity:row.started.anchorTime+offsetFrames/row.plan.sampleRate;
     row.pcm.sampling={anchorTime:row.started.anchorTime,offsetFrames,fromAudioTime:offsetFrames===null?null:entry.sampleFromAudioTime,preGateBlockLimit:4,blockLimit:64};sample(entry,row);
    }catch(error){pushError(error);}
   },pushError);
  }return result;
 }
 proto.prepare=prepared;proto.start=started;
 const lifecycle=entry=>({receiverId:entry.id,state:entry.owner.state,connected:entry.owner.connected===true,nodeConnections:graphConnections(entry.node),gateConnections:entry.owner.outputGate?graphConnections(entry.owner.outputGate):null,disposed:entry.owner.disposed===true,disposing:entry.owner.disposing===true,pendingCommands:entry.owner.pending?.size??null,pendingStarts:entry.owner.pending?[...entry.owner.pending.values()].filter(command=>command.type==='start').length:null});
 const ownedNodes=()=>[...owners.values()].map(lifecycle),quiet=()=>[...owners.values()].every(entry=>entry.hashes.size===0)&&ownedNodes().every(row=>!row.connected&&row.nodeConnections===0&&row.gateConnections===0&&row.disposed&&!row.disposing&&row.pendingCommands===0&&row.pendingStarts===0);
 const status=()=>({errors:observedErrors(),initializations:copy(initializations),overflow:observedOverflow(),graphHistory:graphStatus().graphHistory,contexts:contexts.size,states:[...contexts.values()].flatMap(value=>copy(value.states)),receivers:owners.size,ownedNodes:ownedNodes(),started:rows.filter(row=>row.started).length,activeReceivers:[...owners.values()].filter(({owner})=>owner.connected).length,pendingReceivers:[...owners.values()].filter(({owner})=>['preparing','ready','starting'].includes(owner.state)||[...(owner.pending?.values()||[])].some(command=>command.type==='start')).length,completed:rows.filter(row=>row.terminals.some(t=>t.record.type==='ended')).length});
 return{snapshot:()=>copy(rows.map(row=>({...row,lifecycle:lifecycle([...owners.values()].find(entry=>entry.id===row.receiverId))}))),count:()=>rows.length,status,assertHealthy(){const failures=observedErrors();if(failures.length)throw Error('Basic-key audio failed: '+JSON.stringify(failures[0])+'\nProduction UI: '+String(document.getElementById?.('notice')?.textContent||'').slice(0,4096));},quiet,settledSince:index=>rows.slice(index).length>0&&rows.slice(index).every(row=>row.terminals.length>0),restore(){active=false;const cleanupErrors=[];let restored=true;
  const attempt=(name,run)=>{try{if(run()===false)throw Error('Original method was not restored');}catch(error){restored=false;if(cleanupErrors.length<128)cleanupErrors.push({name,message:String(error?.message||error).slice(0,512)});else overflow=true;}};
  if(typeof create==='function')attempt('receiver.create',()=>{if(Receiver.create===created)Receiver.create=create;return Receiver.create===create;});
  attempt('receiver.prepare',()=>{if(proto.prepare===prepared)proto.prepare=prepare;return proto.prepare===prepare;});attempt('receiver.start',()=>{if(proto.start===started)proto.start=start;return proto.start===start;});
  for(const entry of owners.values()){
   if(entry.postMessage)attempt(`receiver-${entry.id}.postMessage`,()=>{if(entry.node.port.postMessage===entry.postMessage)entry.node.port.postMessage=entry.originals.postMessage;return entry.node.port.postMessage===entry.originals.postMessage;});
   attempt(`receiver-${entry.id}.frame`,()=>root.cancelAnimationFrame(entry.pending));attempt(`receiver-${entry.id}.port`,()=>entry.node.port.removeEventListener('message',entry.message,true));attempt(`receiver-${entry.id}.port-after`,()=>entry.node.port.removeEventListener('message',entry.afterMessage));attempt(`receiver-${entry.id}.processorerror`,()=>entry.node.removeEventListener('processorerror',entry.processorError));
   if(entry.analyser){attempt(`receiver-${entry.id}.tap-input`,()=>entry.owner.output.disconnect(entry.analyser));attempt(`receiver-${entry.id}.tap-output`,()=>entry.analyser.disconnect());}
   for(const kind of ['onEnded','onStopped','onError'])attempt(`receiver-${entry.id}.${kind}`,()=>{if(entry.owner[kind]===entry[kind])entry.owner[kind]=entry.originals[kind];return entry.owner[kind]===entry.originals[kind];});
  }
  for(const[context,{listener}]of contexts)attempt('context.statechange',()=>context.removeEventListener?.('statechange',listener));
  attempt('AudioNode.graph',restoreGraph);
  return{restored,overflow:observedOverflow(),errors:observedErrors(),cleanupErrors};
 }};
}
// End shared audio-thread observer.

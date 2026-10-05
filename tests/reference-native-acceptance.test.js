import {readPlaybackClock} from '../web/playback-clock-view.js';
import {evidenceClockNode,setEvidencePlaybackClock} from './playback-clock-evidence-fixtures.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {runInNewContext} from 'node:vm';
import {originalReferenceMidiFixture} from './reference-listening-fixture.js';

// Pure contracts only: no native window, browser, server, audio device or timer.
const source=await readFile(new URL('../crates/desktop-shell/reference-acceptance.js',import.meta.url),'utf8');
const {NATIVE_REFERENCE_FIXTURE:f,observeNativeReferenceAudio}=runInNewContext(`${source}\n({NATIVE_REFERENCE_FIXTURE,observeNativeReferenceAudio})`);

test('native chooser fixture is exactly the new original three-track source with paired finite allowlists',async()=>{
  const original=originalReferenceMidiFixture(),bytes=await readFile(new URL(`./fixtures/${original.name}`,import.meta.url));
  assert.deepEqual(bytes,original.bytes);assert.equal(createHash('sha256').update(bytes).digest('hex'),f.sha256);
  assert.equal(f.name,original.name);assert.equal(f.tracks,original.expected.trackCount);assert.equal(f.events,original.expected.eventCount);assert.equal(f.onsets,original.expected.onsetCount);
  const [rust,helper,runner,contract]=await Promise.all(['../crates/desktop-shell/src/acceptance.rs','../scripts/windows-desktop-native.cs','../scripts/windows-desktop-acceptance.ps1','./windows-desktop-contract.ps1'].map(path=>readFile(new URL(path,import.meta.url),'utf8')));
  for(const text of [rust,helper,runner,contract])assert.ok(text.includes(f.name),'Native bridge, OS helper, fixture materialization and pure path contracts all name the same exact fixture');
  assert.match(rust,/include_str!\("\.\.\/reference-acceptance\.js"\)/);
  assert.match(rust,/\(1\.\.=action_limit\(phase\)\)/,'Actions use the finite scenario budget');assert.match(rust,/fn action_limit\(phase: &str\)/);
  assert.match(rust,/rows\.len\(\) >= 16/,'Download budget is not expanded');
  assert.match(contract,/\.\.\/original-reference-overlap\.mid/,'Traversal is explicitly rejected by hosted pure path tests');
});

function audioFixture(){
  class NativeSource {
    constructor(context,kind){this.context=context;this.kind=kind;this.calls=[];}
    start(...args){this.calls.push(['start',...args]);return 'native-start';}
    stop(...args){this.calls.push(['stop',...args]);return 'native-stop';}
    disconnect(...args){this.calls.push(['disconnect',...args]);return 'native-disconnect';}
  }
  class NativeAudio {
    constructor(){this.currentTime=10;this.creates=[];}
    createOscillator(...args){this.creates.push(['oscillator',...args]);return new NativeSource(this,'oscillator');}
    createBufferSource(...args){this.creates.push(['noise',...args]);return new NativeSource(this,'noise');}
  }
  return {NativeAudio};
}

test('native audio observation forwards actual methods unchanged and distinguishes future, active and canceled voices',()=>{
  const {NativeAudio}=audioFixture(),originalOsc=NativeAudio.prototype.createOscillator,originalBuffer=NativeAudio.prototype.createBufferSource;
  const probe=observeNativeReferenceAudio({AudioContext:NativeAudio,webkitAudioContext:NativeAudio}),context=new NativeAudio();
  const oscillator=context.createOscillator('passthrough'),noise=context.createBufferSource();
  assert.deepEqual(context.creates,[['oscillator','passthrough'],['noise']]);
  assert.equal(oscillator.start(10.2),'native-start');assert.equal(oscillator.stop(12),'native-stop');noise.start(10);noise.stop(13);
  assert.deepEqual({...probe.snapshot()},{sourceStarts:2,oscillatorStarts:1,activeSources:1,pendingSources:1});
  context.currentTime=10.3;assert.equal(probe.snapshot().activeSources,2);assert.equal(probe.snapshot().pendingSources,0);
  assert.equal(oscillator.stop(10.3),'native-stop');assert.equal(oscillator.disconnect(),'native-disconnect');noise.stop(10.3);noise.disconnect();
  assert.deepEqual({...probe.snapshot()},{sourceStarts:2,oscillatorStarts:1,activeSources:0,pendingSources:0});
  assert.deepEqual(oscillator.calls,[['start',10.2],['stop',12],['stop',10.3],['disconnect']]);
  probe.restore();assert.equal(NativeAudio.prototype.createOscillator,originalOsc);assert.equal(NativeAudio.prototype.createBufferSource,originalBuffer);
});

test('native probe reports uncanceled future audio and elapsed scheduled stops rather than trusting UI labels',()=>{
  const {NativeAudio}=audioFixture(),probe=observeNativeReferenceAudio({AudioContext:NativeAudio}),context=new NativeAudio();
  try {
    const source=context.createOscillator();source.start(11);source.stop(12);
    assert.equal(probe.snapshot().pendingSources,1);context.currentTime=11.5;assert.equal(probe.snapshot().activeSources,1);
    context.currentTime=12.1;assert.equal(probe.snapshot().activeSources,0);
    const future=context.createBufferSource();future.start(14);future.stop(15);future.disconnect(0);
    assert.equal(probe.snapshot().pendingSources,1,'Disconnecting one output is not proof all scheduling was canceled');
    future.disconnect();assert.equal(probe.snapshot().pendingSources,0);
  } finally {probe.restore();}
  assert.throws(()=>observeNativeReferenceAudio({}),/real AudioContext/);
});

// Model only the acceptance admission contract. These plain event samples do
// not enter the application, OS input system, or any scored performance.
function transportFixture({clickDelivered=true,startOnPoll=0,keyDelivered=true,blurBeforeStart=false}={}) {
  let wall=1000,startPolls=0,clicks=0;const listeners=new Map(),windowListeners=new Map(),deferred=[],actions=[];
  const node=(id,kind='div')=>({id,localName:kind,dataset:{},disabled:false,value:'',textContent:'',checked:false,
    getAttribute(name){return this[name]??null;},dispatchEvent(){},closest(selector){if(selector==='[id]')return this;if(selector==='button'&&kind==='button')return this;if(selector==='[data-keyboard-performance]'&&id==='stage-title')return this;return null;}});
  const ids=Object.fromEntries(['session-mode','play-button','sound-button','count-in','stage-title','hud-captured','progress','stage-cue','settings-button','resume-session'].map(id=>[id,node(id,id.endsWith('button')?'button':'div')]));
  ids['session-mode'].value='practice';ids['play-button'].textContent='▶ Play';ids['sound-button']['aria-pressed']='true';ids['hud-captured'].textContent='0';setEvidencePlaybackClock(ids.progress,0,{durationMs:6000});ids['stage-cue'].dataset.cueState='ready';
  const status=node('status');status.dataset={phase:'ready',passId:'',revision:''};
  const add=(map,type,listener)=>{if(!map.has(type))map.set(type,new Set());map.get(type).add(listener);};
  const document={body:{dataset:{screen:'stage'}},hidden:false,activeElement:ids['stage-title'],hasFocus:()=>true,
    getElementById:id=>ids[id],querySelector:selector=>selector==='.performance-status'?status:null,querySelectorAll:()=>[],
    addEventListener:(type,fn)=>add(listeners,type,fn),removeEventListener:(type,fn)=>listeners.get(type)?.delete(fn),
    defaultView:{addEventListener:(type,fn)=>add(windowListeners,type,fn),removeEventListener:(type,fn)=>windowListeners.get(type)?.delete(fn)}};
  const emit=(type,target,values={},map=listeners)=>{const event={type,target,timeStamp:++wall,isTrusted:true,...values};for(const listener of map.get(type)||[])listener(event);};
  const running=()=>{status.dataset.phase='capturing';status.dataset.passId='1';status.dataset.revision='0';setEvidencePlaybackClock(ids.progress,10,{durationMs:6000,running:true});ids['play-button'].textContent='Ⅱ Pause';delete ids['stage-cue'].dataset.cueState;};
  const exported=runInNewContext(`${source}\n({observeNativeReferenceTransport,prepareNativeReferenceScoredTake})`,{__wmhReadPlaybackClock:readPlaybackClock,TextEncoder,performance:{now:()=>wall},queueMicrotask:fn=>deferred.push(fn),Event:class{}});
  const options={document,click(){},closeDialogs(){},
    async native(kind,target){actions.push([kind,target.id]);
      if(kind==='click'){
        clicks++;if(clickDelivered)emit('click',target);
        if(clicks===1&&startOnPoll===0)running();
        if(clicks===1&&blurBeforeStart){emit('blur',document.defaultView,{},windowListeners);status.dataset.phase='ready';setEvidencePlaybackClock(ids.progress,0,{durationMs:6000});}
        if(clicks===2){status.dataset.phase='pending';ids['play-button'].textContent='▶ Play';ids['stage-cue'].dataset.cueState='paused';}
      }else if(kind==='key-r'){
        assert.equal(status.dataset.phase,'capturing');assert.ok(readPlaybackClock(ids.progress).positionMs>0,'Native key is sequenced after observable clock admission');
        if(keyDelivered){emit('keydown',target,{code:'KeyR'});emit('keyup',target,{code:'KeyR'});}
        ids['hud-captured'].textContent='1';status.dataset.revision='1';
      }
      for(const fn of deferred.splice(0))fn();
    },
    async until(condition,label){for(let i=0;i<4;i++){
      if(label==='native scored transport started'&&startOnPoll>0&&++startPolls>=startOnPoll)running();
      if(await condition())return;
    }throw Error(`Timed out: ${label}`);}};
  return {...exported,document,options,actions,ids,status,emit,listeners,windowListeners,deferred};
}

test('native coordinate success and a displayed clock cannot replace trusted Play delivery',async()=>{
  const f=transportFixture({clickDelivered:false});let error;
  await assert.rejects(f.prepareNativeReferenceScoredTake(f.options),value=>{error=value;return /native scored transport started/.test(value.message);});
  assert.deepEqual(f.actions,[['click','play-button']],'Never inject the real key or retry a click before start admission');
  assert.equal(error.nativeReferenceTransport.stage,'transport-start');assert.equal(error.nativeReferenceTransport.trustedPlayClicks,0);
  assert.equal(error.nativeReferenceTransport.current.phase,'capturing','Even a running display alone is insufficient');
  assert.ok([...f.listeners.values(),...f.windowListeners.values()].every(set=>set.size===0));
});

test('scored-take preparation rejects a hidden resume control before exposing an empty stage or sending input',async()=>{
  const f=transportFixture(),clicks=[];f.document.body.dataset.screen='library';f.ids['resume-session'].hidden=true;f.options.click=id=>clicks.push(id);let error;
  await assert.rejects(f.prepareNativeReferenceScoredTake(f.options),value=>{error=value;return /requires an active score before resuming/.test(value.message);});
  assert.deepEqual(clicks,[]);assert.deepEqual(f.actions,[]);assert.equal(f.document.body.dataset.screen,'library');
  assert.equal(error.nativeReferenceTransport.stage,'prepare');assert.equal(error.nativeReferenceTransport.current.screen,'library');
  assert.equal(error.nativeReferenceTransport.trustedPlayClicks,0);assert.ok([...f.listeners.values(),...f.windowListeners.values()].every(set=>set.size===0));
});

test('scored-take preparation still resumes a visible active session before the trusted transport proof',async()=>{
  const f=transportFixture(),clicks=[];f.document.body.dataset.screen='library';f.ids['resume-session'].hidden=false;
  f.options.click=id=>{clicks.push(id);if(id==='resume-session')f.document.body.dataset.screen='stage';};
  const result=await f.prepareNativeReferenceScoredTake(f.options);
  assert.equal(clicks[0],'resume-session');assert.equal(result.stage,'complete');
  assert.deepEqual(f.actions,[['click','play-button'],['key-r','stage-title'],['click','play-button']]);
  assert.equal(result.trustedPlayClicks,2);assert.equal(result.trustedKeyDowns,1);assert.equal(result.trustedKeyUps,1);
});

test('trusted Play followed by focus loss fails at transport admission with bounded lifecycle evidence',async()=>{
  const f=transportFixture({blurBeforeStart:true});let error;
  await assert.rejects(f.prepareNativeReferenceScoredTake(f.options),value=>{error=value;return /native scored transport started/.test(value.message);});
  assert.equal(error.nativeReferenceTransport.trustedPlayClicks,1);assert.equal(error.nativeReferenceTransport.current.phase,'ready');
  assert.ok(error.nativeReferenceTransport.rows.some(row=>row.event?.type==='blur'));assert.deepEqual(f.actions,[['click','play-button']]);
});

test('native key follows actual pass/clock transition, and only its trusted down/up plus capture admits Pause',async()=>{
  const f=transportFixture({startOnPoll:3}),result=await f.prepareNativeReferenceScoredTake(f.options);
  assert.deepEqual(f.actions,[['click','play-button'],['key-r','stage-title'],['click','play-button']]);
  assert.equal(result.stage,'complete');assert.equal(result.trustedPlayClicks,2);assert.equal(result.trustedKeyDowns,1);assert.equal(result.trustedKeyUps,1);
  assert.equal(result.current.passId,'1');assert.equal(result.current.captured,'1');assert.equal(result.current.cue,'paused');
  const firstKey=result.rows.find(row=>row.event?.code==='KeyR');assert.equal(firstKey.state.phase,'capturing');assert.ok(firstKey.state.positionMs>0);
});

test('a displayed capture without trusted Windows key receipt is rejected, with no retry',async()=>{
  const f=transportFixture({keyDelivered:false});let error;
  await assert.rejects(f.prepareNativeReferenceScoredTake(f.options),value=>{error=value;return /one actual Windows keyboard input/.test(value.message);});
  assert.deepEqual(f.actions,[['click','play-button'],['key-r','stage-title']]);assert.equal(error.nativeReferenceTransport.stage,'keyboard-capture');
  assert.equal(error.nativeReferenceTransport.current.captured,'1');assert.equal(error.nativeReferenceTransport.trustedKeyDowns,0);
});

test('native readiness remains an explicit evidence boundary after an identical lifecycle callback sample',async()=>{
  const f=transportFixture(),until=f.options.until;
  f.options.until=async(condition,label)=>{
    if(label==='score practice ready'){
      f.emit('blur',f.document.defaultView,{},f.windowListeners);
      for(const fn of f.deferred.splice(0))fn();
    }
    return until(condition,label);
  };
  const result=await f.prepareNativeReferenceScoredTake(f.options);
  const ready=result.rows.filter(row=>row.kind==='ready');
  assert.equal(ready.length,1,'Independent folder and pack verifiers require the recorded start boundary');
  assert.equal(ready[0].state.positionMs,0);assert.equal(ready[0].state.phase,'ready');
  assert.ok(result.rows.some(row=>row.kind==='after-blur'&&row.state.phase==='ready'));
  assert.ok(result.rows.some(row=>row.state.phase==='capturing'&&row.state.passId===result.current.passId&&row.state.positionMs>ready[0].state.positionMs));
  assert.equal(result.omitted,0);assert.ok(result.rowBytes<=24*1024);
  assert.deepEqual(f.actions,[['click','play-button'],['key-r','stage-title'],['click','play-button']]);
});

test('functional transport diagnostics have finite rows and byte budget and stop observing after cleanup',()=>{
  const f=transportFixture(),trace=f.observeNativeReferenceTransport(f.document,{now:()=>1000,defer:fn=>f.deferred.push(fn)});
  for(let i=0;i<150;i++)f.emit('click',f.ids['play-button']);
  const result=trace.snapshot('stress-contract');assert.ok(result.rows.length<=64);assert.ok(result.rowBytes<=24*1024);assert.ok(result.omitted>0);
  assert.ok(new TextEncoder().encode(JSON.stringify(result)).length<32*1024,'Diagnostic fits beneath the existing64KiB report limit with room for prior seed evidence');
  trace.stop();for(const fn of f.deferred.splice(0))fn();f.emit('click',f.ids['play-button']);
  assert.equal(trace.counts().trustedPlayClicks,150);
});

test('waiting for a clock transition retains the causal click rather than logging every progress tick',()=>{
  const f=transportFixture(),trace=f.observeNativeReferenceTransport(f.document,{now:()=>1000,defer:fn=>f.deferred.push(fn)});
  f.emit('click',f.ids['play-button']);f.status.dataset.phase='capturing';f.status.dataset.passId='1';
  for(let tick=1;tick<=150;tick++){setEvidencePlaybackClock(f.ids.progress,tick,{durationMs:6000,running:true});trace.changed('await-keyboard-capture');}
  const result=trace.snapshot('keyboard-capture');trace.stop();
  assert.equal(result.omitted,0);assert.ok(result.rows.length<5);assert.ok(result.rows.some(row=>row.event?.type==='click'&&row.event.trusted));
  assert.equal(result.current.positionMs,150,'Latest clock remains available without evicting event receipt');
  assert.equal(result.rows.find(row=>row.event).event.preventedAtCapture,false,'Capture-phase sampling is explicitly named');
});

test('native clock preparation waits only for first publication within the existing readiness bound',async()=>{
 const prefix=source.slice(0,source.indexOf('const NATIVE_REFERENCE_FIXTURE'));
 for(const mode of ['absent-element-valid','absent-attribute-valid','absent-deadline','malformed','empty','unavailable']){
  const valid=mode==='unavailable'?evidenceClockNode(0,{durationMs:0,available:false}):evidenceClockNode(0,{durationMs:5000}),node={getAttribute:()=>raw};
  let raw=mode==='malformed'?'{':mode==='empty'?'':mode==='unavailable'?valid.dataset.playbackClock:null,element=mode==='absent-element-valid'?null:node,polls=0,reads=0;
  const document={getElementById:id=>{assert.equal(id,'progress');return element;}},prepare=runInNewContext(`${prefix}\nprepareNativePlaybackClock`,{__wmhReadPlaybackClock:document=>{reads++;return readPlaybackClock(document);}});
  const until=async(predicate,label,...overrides)=>{
   assert.equal(label,'first published playback clock');assert.deepEqual(overrides,[],'Preparation keeps the scenario readiness bound');
   for(let i=0;i<3;i++){polls++;if(i===1&&mode.endsWith('-valid')){element=node;raw=valid.dataset.playbackClock;}if(predicate())return;}
   throw Error('existing readiness deadline');
  };
  if(mode==='absent-deadline'){await assert.rejects(prepare({document,until}),/existing readiness deadline/);assert.equal(polls,3);assert.equal(reads,0);}
  else if(['malformed','empty'].includes(mode)){await assert.rejects(prepare({document,until}),/missing or invalid/);assert.equal(polls,1);assert.equal(reads,1);}
  else{await prepare({document,until});assert.equal(polls,mode==='unavailable'?1:2);assert.equal(reads,1);}
 }
});

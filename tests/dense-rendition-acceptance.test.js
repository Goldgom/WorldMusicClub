import {createPlaybackClock,readPlaybackClock} from '../web/playback-clock-view.js';
import test from 'node:test';
import {syntheticAudioThreadRun,syntheticAudioThreadStatus} from './audio-thread-proof-fixtures.js';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import vm from 'node:vm';
import {DOMParser,parseHTML} from 'linkedom';
import {finishDenseReport} from '../scripts/dense-report-cleanup.mjs';
import {DENSE_STREAM,originalDenseRenditionMidi,expectedDenseAttacks,denseDigest} from '../scripts/prepare-dense-rendition-fixture.mjs';
import {observeDenseRenditionAudio,denseRenditionBootstrap} from '../scripts/dense-rendition-observer.mjs';
import {denseTimingMetrics,validateDenseRenditionEvidence,validateDenseLongTaskObservation} from '../scripts/verify-dense-rendition-evidence.mjs';
import {observeCanonicalPcm} from './canonical-pcm-observer-fixture.js';
import {basicKeySong} from './basic-key-rendition-fixtures.js';
import {buildBasicKeyAudioPlan} from '../web/basic-key-audio-plan.js';
import {BasicKeyAudioReceiver} from '../web/basic-key-audio-receiver.js';
import {BasicKeyAudioCore} from '../web/basic-key-audio-core.js';
function clockProgress(positionMs,{durationMs=48000,...state}={}) {
 const node={id:'progress',value:String(positionMs),max:String(durationMs),dataset:{},
  getAttribute(name){return name==='data-playback-clock'?this.dataset.playbackClock:null;}};
 node.dataset.playbackClock=JSON.stringify(createPlaybackClock({positionMs,durationMs,running:true,hasStarted:true,...state}));
 return node;
}
const sourceSha='1732e837773757a00212a03374e9111a4e0f4662d920f45461ffb64f46247ba7';
test('original dense MIDI has an independent complete one-based source inventory and bounded allocation',()=>{
 const bytes=originalDenseRenditionMidi();assert.equal(bytes.length,49380);assert.equal(denseDigest(bytes),sourceSha);assert.equal(bytes.toString('ascii',0,4),'MThd');assert.equal(bytes.readUInt16BE(8),1);assert.equal(bytes.readUInt16BE(10),5);assert.equal(bytes.readUInt16BE(12),96);
 let offset=14;const tracks=[];
 for(let track=1;track<=5;track++){assert.equal(bytes.toString('ascii',offset,offset+4),'MTrk');const end=offset+8+bytes.readUInt32BE(offset+4);offset+=8;let tick=0,event=0;const rows=[],vlq=()=>{let value=0,byte;do{byte=bytes[offset++];value=value*128+(byte&127);}while(byte&128);return value;};while(offset<end){tick+=vlq();const status=bytes[offset++];event++;if(status===255){const kind=bytes[offset++],length=vlq(),data=bytes.subarray(offset,offset+length);offset+=length;rows.push({track,event,tick,status,kind,data});}else{const data=bytes.subarray(offset,offset+(status>>4===12?1:2));offset+=data.length;rows.push({track,event,tick,status,data});}}assert.equal(offset,end);tracks.push(rows);}
 assert.equal(offset,bytes.length);assert.deepEqual(tracks[0].map(row=>row.kind),[81,88,89,47]);assert.deepEqual(tracks[0].map(row=>row.tick),[0,0,0,9216]);
 const expected=expectedDenseAttacks(sourceSha),actual=[];for(const rows of tracks.slice(1)){assert.equal(rows[0].event,1);assert.equal(rows[0].kind,3);assert.match(rows[0].data.toString(),/^Original arithmetic part [1-4]$/);assert.equal(rows[1].event,2);assert.equal(rows[1].status>>4,12);assert.equal(rows[1].data[0],0);assert.equal(rows.at(-1).tick,9216);let index=0;for(const row of rows)if(row.status>>4===9){const release=rows[row.event];assert.equal(row.event,3+index*2);assert.equal(release.status>>4,8);assert.equal(release.tick-row.tick,3);actual.push({id:`midi-t${row.track}-e${row.event}`,eventId:`midi:${sourceSha}:t${row.track-1}:e${row.event-1}`,part:`midi-t${row.track}-c${(row.status&15)+1}-r0`,key:row.data[0],velocity:row.data[1],startMs:row.tick*500/96,durationMs:(release.tick-row.tick)*500/96});index++;}assert.equal(index,1536);}
 actual.sort((a,b)=>a.startMs-b.startMs||a.part.localeCompare(b.part));assert.equal(actual.length,6144);for(const[index,row]of actual.entries())assert.deepEqual(row,expected[index],`Source target ${index}`);
 const edges=actual.flatMap(n=>[{time:n.startMs-100,delta:1},{time:n.startMs+n.durationMs,delta:-1}]).sort((a,b)=>a.time-b.time||a.delta-b.delta);let live=0,max=0;for(const edge of edges){live+=edge.delta;max=Math.max(max,live);}assert.equal(max,16);assert.ok(max<=128);for(const start of [0,16000,32000])assert.equal(actual.filter(n=>n.startMs>=start&&n.startMs<start+16000).length,2048);
});
test('dense audio observation forwards every real method and does not inherit the old 512-source ceiling',()=>{
 const calls=[];class Audio{currentTime=0;createOscillator(...args){calls.push(['create',this,args]);return{start(...values){calls.push(['start',this,values]);return 'started';},stop(){return 'stopped';},disconnect(){return 'disconnected';}};}createBufferSource(){return this.createOscillator();}}
 const original=Audio.prototype.createOscillator,probe=observeDenseRenditionAudio({AudioContext:Audio}),context=new Audio();
 for(let i=0;i<6144;i++){const node=context.createOscillator(i);assert.equal(node.start(1),'started');assert.equal(node.stop(2),'stopped');assert.equal(node.disconnect(),'disconnected');}
 assert.equal(probe.snapshot().created,6144);assert.equal(probe.snapshot().sourceStarts,6144);assert.equal(probe.snapshot().oscillatorStarts,6144);assert.equal(probe.snapshot().overflow,false);assert.equal(probe.snapshot().activeSources,0);assert.equal(calls[0][1],context);assert.deepEqual(calls[0][2],[0]);assert.equal(probe.restore(),true);assert.equal(Audio.prototype.createOscillator,original);
});
test('dense init namespace survives the real init-script closure boundary',async()=>{
 const writes=[],realm=vm.createContext({localStorage:{setItem:(...args)=>writes.push(args)}});
 vm.runInContext(`(()=>{${denseRenditionBootstrap()}})();`,realm);
 assert.equal(vm.runInContext('typeof installDenseRenditionObserver',realm),'undefined','Local init names are intentionally not page globals');
 assert.equal(typeof realm.__wmhReadPlaybackClock,'function');assert.equal(typeof realm.__wmhDenseObserverTools.install,'function');assert.equal(typeof realm.__wmhDenseObserverTools.observeAudio,'function');assert.equal(Object.isFrozen(realm.__wmhDenseObserverTools),true);
 assert.deepEqual(writes,[['worldmusichub.locale.v1','zh-CN']]);const graph=await realm.__wmhDenseAudioGraph;assert.equal(typeof graph.path,'function');assert.equal(graph.restore(),true);delete realm.__wmhDenseObserverTools;assert.equal(realm.__wmhDenseObserverTools,undefined);
});
test('early graph capture retains an actual pre-existing mixer path when the dense receiver attaches later',async()=>{
 const plan=buildBasicKeyAudioPlan(basicKeySong(),{sampleRate:48000}),options={canonical:false,ReceiverClass:BasicKeyAudioReceiver,Core:BasicKeyAudioCore,connectBeforeObserver:true};
 const missed=await observeCanonicalPcm(plan,options),captured=await observeCanonicalPcm(plan,{...options,earlyGraph:true});
 assert.equal(missed.row.started.graphToDestination,null);assert.equal(missed.row.pcm.graphToDestination,null,'Late receiver attachment cannot infer the missing destination edge');
 for(const run of [missed.row,captured.row]){assert.ok(run.pcm.blocks.some(block=>block.peak>1e-6&&block.rms>1e-7));assert.equal(run.plan.sourceSha256,plan.sourceSha256);assert.equal(run.started.planGeneration,run.planGeneration);assert.equal(run.started.sourceSha256,plan.sourceSha256);assert.equal(run.terminals[0].record.started,plan.notes.length);}
 assert.deepEqual(captured.row.started.graphToDestination.map(node=>node.type),['AudioWorkletNode','GainNode','GainNode','AudioDestinationNode']);
 assert.deepEqual(captured.row.pcm.graphToDestination,captured.row.started.graphToDestination);
 assert.equal(captured.graphHistory.events[0].nodeType,'GainNode');assert.equal(captured.graphHistory.events[0].targetType,'AudioDestinationNode');assert.equal(captured.graphHistory.events[0].kind,'connect');
 assert.deepEqual(captured.row.terminals[0].record.ledger,missed.row.terminals[0].record.ledger,'Observation timing changes no source gate or frame');
});
for(const negative of [{disconnected:true},{disconnectBeforeObserver:true},{foreignDestination:true}])test(`early graph never invents a destination edge: ${Object.keys(negative)[0]}`,async()=>{
 const plan=buildBasicKeyAudioPlan(basicKeySong(),{sampleRate:48000}),{row}=await observeCanonicalPcm(plan,{canonical:false,ReceiverClass:BasicKeyAudioReceiver,Core:BasicKeyAudioCore,connectBeforeObserver:true,earlyGraph:true,...negative});
 assert.ok(row.pcm.blocks.some(block=>block.peak>1e-6),'Positive analyser data alone cannot prove a destination connection');
 assert.equal(row.started.graphToDestination,null);assert.equal(row.pcm.graphToDestination,null);
});
test('dense graph capture starts in the navigation init script without source evaluation or security relaxation',async()=>{
 const bootstrap=denseRenditionBootstrap(),host=await readFile(new URL('../scripts/hosted-dense-rendition-check.mjs',import.meta.url),'utf8');
 assert.match(bootstrap,/__wmhDenseAudioGraph=.*observeReceiver\(globalThis.document,\{graphOnly:true\}\)/);
 assert.ok(host.indexOf('context.addInitScript(denseRenditionBootstrap())')<host.indexOf('page.goto(origin)'));
 assert.doesNotMatch(bootstrap,/\beval\b|\bFunction\s*\(|bypassCSP|unsafe-eval/);
 assert.doesNotMatch(host,/bypassCSP|unsafe-eval|content-security-policy/i);
});
test('dense trace preserves renderer promises and frame callbacks without inventing main-thread audio pumps',async()=>{
 const nodes={progress:clockProgress(10),'clean-song-stage':{dataset:{rendererState:'playing'}},workspace:{dataset:{scoreState:'active'},addEventListener(){},removeEventListener(){}},'engraving-range':{textContent:'Measures 9–16 / 24'},'hud-captured':{textContent:'0'},notice:{textContent:''}},calls=[],context={currentTime:1,state:'running',addEventListener(){},removeEventListener(){}},promise=Promise.resolve('loaded');
 class Renderer{load(...args){calls.push(['load',this,args]);return promise;}updateGraphic(){return 'graphic';}render(...args){calls.push(['render',this,args]);return 'rendered';}}
 const frameCalls=[],requestFrame=function(callback){if(typeof callback!=='function')throw new TypeError('Original frame callback required');frameCalls.push({owner:this,callback});return 73;},realm=vm.createContext({document:{getElementById:id=>nodes[id]},performance,structuredClone,requestAnimationFrame:requestFrame,localStorage:{setItem(){}}});vm.runInContext(`(()=>{${denseRenditionBootstrap()}})();`,realm);
 const original=Renderer.prototype.load,observeReceiver=async(_,{onContext,onStart})=>{onContext(context);onStart();return{status:()=>({...syntheticAudioThreadStatus(),receivers:1}),snapshot:()=>[],count:()=>1,quiet:()=>true,restore:()=>({restored:true,overflow:false,errors:[],cleanupErrors:[]})};};
 const trace=await realm.__wmhDenseObserverTools.install({library:{Renderer,observeReceiver},audioProbe:{snapshot:()=>({}),restore:()=>true}}),renderer=new Renderer();
 assert.throws(()=>realm.requestAnimationFrame(null),/Original frame callback required/);const frameOwner={},callbackOwner={},seen=[];assert.equal(realm.requestAnimationFrame.call(frameOwner,function animate(value){seen.push([this,value]);return 'painted';}),73);assert.equal(frameCalls[0].owner,frameOwner);assert.equal(frameCalls[0].callback.call(callbackOwner,123),'painted');assert.equal(seen[0][0],callbackOwner);assert.equal(seen[0][1],123);
 assert.equal(renderer.load('exact-doc'),promise);assert.equal(renderer.render('real-options'),'rendered');await promise;const value=trace.stop();assert.equal(value.frames.length,1);assert.equal(value.frames[0].callback,'animate');assert.ok(value.frames[0].durationMs>=0);assert.equal(realm.requestAnimationFrame,requestFrame);assert.equal(frameCalls[0].callback.call(callbackOwner,125),'painted');assert.equal(trace.snapshot().frames.length,1);assert.deepEqual([...value.pumps],[]);assert.deepEqual([...value.schedules],[]);assert.equal(value.cleanup.restored,true);assert.equal(Renderer.prototype.load,original);assert.equal(calls[0][1],renderer);assert.deepEqual(calls[0][2],['exact-doc']);
});
test('dense terminal proof requires the exact published clock, actual End and receiver cleanup',async()=>{
 const durationMs=4083.3371666666667,progress=clockProgress(durationMs,{durationMs,running:false}),
  nodes={progress,'clean-song-stage':{dataset:{rendererState:'ended'}},workspace:{dataset:{scoreState:'session'},addEventListener(){},removeEventListener(){}},'engraving-range':{textContent:''},'hud-captured':{textContent:'0'},notice:{textContent:''}};
 progress.value='4083.33716666667';
 let completed=1,quiet=true;
 class Renderer{load(){}updateGraphic(){}render(){}}
 const realm=vm.createContext({document:{getElementById:id=>nodes[id]},performance,structuredClone,localStorage:{setItem(){}}});
 vm.runInContext(`(()=>{${denseRenditionBootstrap()}})();`,realm);
 const observer=await realm.__wmhDenseObserverTools.install({library:{Renderer,observeReceiver:async()=>({
  status:()=>({...syntheticAudioThreadStatus(),completed}),snapshot:()=>[],count:()=>1,quiet:()=>quiet,restore:()=>({restored:true,overflow:false,errors:[],cleanupErrors:[]})
 })},audioProbe:{snapshot:()=>({}),restore:()=>true}});
 const publish=state=>{progress.dataset.playbackClock=JSON.stringify(createPlaybackClock({positionMs:durationMs,durationMs,running:false,hasStarted:true,...state}));};
 assert.notEqual(Number(progress.value),durationMs,'Native serialization differs from source time');
 assert.equal(observer.status().current.position,durationMs);
 assert.equal(readPlaybackClock(progress).positionMs,durationMs);
 assert.throws(()=>observer.markEnded(),/Natural processor End/,'Seeking to the endpoint does not complete playback');
 publish({running:true});assert.throws(()=>observer.markEnded(),/Natural processor End/,'The source may still be playing at the endpoint');
 publish({completed:true,positionMs:durationMs-1,rangeEndMs:durationMs-1});assert.throws(()=>observer.markEnded(),/Natural processor End/,'A shorter completed range does not prove full-source End');
 publish({completed:true});nodes['clean-song-stage'].dataset.rendererState='playing';assert.throws(()=>observer.markEnded(),/Natural processor End/);
 nodes['clean-song-stage'].dataset.rendererState='ended';completed=0;assert.throws(()=>observer.markEnded(),/Natural processor End/);
 completed=1;quiet=false;assert.throws(()=>observer.markEnded(),/Natural processor End/);
 quiet=true;const end=observer.markEnded();assert.equal(end.position,durationMs);assert.equal(end.clock.completed,true);assert.equal(end.clock.phase,'ended');
 const snapshot=progress.dataset.playbackClock;delete progress.dataset.playbackClock;
 assert.throws(()=>observer.status(),/playback clock is missing or invalid/,'Native range values never replace missing source observations');
 progress.dataset.playbackClock=snapshot;assert.equal(observer.stop().cleanup.restored,true);
});
test('dense frame diagnostics preserve cancellation and remain bounded without suppressing callbacks',async()=>{
 const nodes={progress:clockProgress(1),'clean-song-stage':{dataset:{rendererState:'playing'}},workspace:{dataset:{scoreState:'session'},addEventListener(){},removeEventListener(){}},'engraving-range':{textContent:''},'hud-captured':{textContent:'0'},notice:{textContent:''}};
 const callbacks=new Map();let next=0,painted=0;
 const requestAnimationFrame=callback=>{if(typeof callback!=='function')throw new TypeError('callback');callbacks.set(++next,callback);return next;},cancelAnimationFrame=id=>callbacks.delete(id);
 class Player{constructor(){this.running=true;this.noteCursor=0;this.context={currentTime:0,state:'running'};this.onError=()=>{};}pump(){}}
 class Receiver{schedule(){}}class Renderer{load(){}updateGraphic(){}render(){}}
 const realm=vm.createContext({document:{getElementById:id=>nodes[id]},performance,structuredClone,requestAnimationFrame,cancelAnimationFrame,localStorage:{setItem(){}}});vm.runInContext(`(()=>{${denseRenditionBootstrap()}})();`,realm);
 const probe=await realm.__wmhDenseObserverTools.install({library:{Renderer,observeReceiver:async(_,{onContext,onStart})=>{onContext({currentTime:0,state:'running'});onStart();return{status:()=>syntheticAudioThreadStatus(),snapshot:()=>[],count:()=>1,quiet:()=>true,restore:()=>({restored:true,overflow:false,errors:[],cleanupErrors:[]})};}},audioProbe:{snapshot:()=>({}),restore:()=>true}});
 const cancelled=realm.requestAnimationFrame(()=>{throw Error('Cancelled callback ran');});realm.cancelAnimationFrame(cancelled);assert.equal(callbacks.has(cancelled),false);assert.equal(realm.cancelAnimationFrame,cancelAnimationFrame);
 for(let i=0;i<4100;i++){const handle=realm.requestAnimationFrame(()=>++painted);assert.equal(callbacks.get(handle)(i),i+1);callbacks.delete(handle);}
 const value=probe.stop();assert.equal(painted,4100);assert.equal(value.frames.length,4096);assert.deepEqual([...value.overflow],['frames']);assert.equal(value.cleanup.restored,true);assert.equal(realm.requestAnimationFrame,requestAnimationFrame);assert.equal(callbacks.size,0);
});
test('dense evidence survives cleanup failure and never loses the primary playback cause',async()=>{
 const writes=[],calls=[],report={ok:false,error:'original late scheduling',trace:{exact:'retained'}};
 const resources=['context','browser','driver'].map(name=>({name,present:true,close:async()=>{calls.push(name);assert.ok(writes.length);assert.equal(writes[0].ok,false);assert.equal(writes[0].cleanup.status,'pending');if(name==='driver')throw Error('close exceeded5000ms');}}));
 await finishDenseReport(report,{resources,persist:async value=>writes.push(structuredClone(value)),validate(){throw Error('Failed playback cannot be validated as success');}});
 assert.deepEqual(calls,['context','browser','driver']);assert.equal(report.ok,false);assert.equal(report.error,'original late scheduling');assert.equal(report.cleanup.status,'failed');assert.equal(report.cleanup.errors[0].name,'driver');assert.deepEqual(writes.at(-1).trace,{exact:'retained'});
});
test('dense pending report is unaccepted, every cleanup runs and final validation is mandatory',async()=>{
 const writes=[],calls=[],resources=['context','browser','driver'].map(name=>({name,present:true,close:async()=>calls.push(name)})),report={ok:true};let validated=0;
 await finishDenseReport(report,{resources,persist:async value=>writes.push(structuredClone(value)),validate(value){validated++;assert.equal(value.cleanup.status,'complete');}});
 assert.equal(validated,1);assert.equal(report.ok,true);assert.ok(writes.slice(0,-1).every(row=>row.ok===false));assert.deepEqual(calls,['context','browser','driver']);
 const invalid={ok:true};await finishDenseReport(invalid,{resources,persist:async()=>{},validate(){throw Error('source identity failure');}});assert.equal(invalid.ok,false);assert.match(invalid.error,/source identity failure/);
 const writeFailed={ok:true},closed=[];await assert.rejects(finishDenseReport(writeFailed,{resources:resources.map(row=>({...row,close:async()=>closed.push(row.name)})),persist:async()=>{throw Error('quota');},validate(){}}),/evidence write failed/);assert.deepEqual(closed,['context','browser','driver']);assert.equal(writeFailed.ok,false);
});
async function observedSyntheticLongTasks(entries,{queued=[]}={}){
 // Original scalar diagnostic fixtures only. No browser or audio is launched.
 const nodes={progress:clockProgress(0),'clean-song-stage':{dataset:{rendererState:'ready'}},workspace:{dataset:{scoreState:'session'},addEventListener(){},removeEventListener(){}},'engraving-range':{textContent:''},'hud-captured':{textContent:'0'},notice:{textContent:''}};
 let deliver,options,disconnected=false;
 class PerformanceObserver{
  static supportedEntryTypes=['longtask'];
  constructor(callback){deliver=entries=>callback({getEntries:()=>entries});}
  observe(value){options=value;}
  takeRecords(){const records=queued;queued=[];return records;}
  disconnect(){disconnected=true;}
 }
 class Renderer{load(){}updateGraphic(){}render(){}}
 const realm=vm.createContext({document:{getElementById:id=>nodes[id]},performance:{now:()=>48000},PerformanceObserver,structuredClone,localStorage:{setItem(){}}});
 vm.runInContext(`(()=>{${denseRenditionBootstrap()}})();`,realm);
 const observer=await realm.__wmhDenseObserverTools.install({library:{Renderer,observeReceiver:async()=>({status:()=>syntheticAudioThreadStatus(),snapshot:()=>[],count:()=>1,quiet:()=>true,restore:()=>({restored:true,overflow:false,errors:[],cleanupErrors:[]})})},audioProbe:{snapshot:()=>({}),restore:()=>true}});
 deliver(entries);const status=observer.status(),trace=observer.stop();assert.equal(disconnected,true);assert.deepEqual({...options},{type:'longtask',buffered:false});
 deliver([{startTime:47000,duration:999}]);assert.deepEqual(observer.snapshot().longTaskObservation,trace.longTaskObservation,'Callbacks delivered after stop cannot alter evidence');
 return {trace,status};
}
test('dense long-task observation accounts for omitted raw samples and queued late maxima within the original sample budget',async()=>{
 const entries=Array.from({length:600},(_,index)=>({startTime:index*60,duration:50})),queued=[{startTime:36000,duration:400}];
 const {trace,status}=await observedSyntheticLongTasks(entries,{queued});
 assert.equal(trace.version,3);assert.equal(trace.longTasks.length,256);assert.deepEqual([...trace.longTasks].map(row=>({...row})),entries.slice(0,256));
 assert.deepEqual({...trace.longTaskObservation},{version:1,sampleLimit:256,observedCount:601,retainedCount:256,omittedCount:345,totalDurationMs:30400,maxDurationMs:400,firstStartTimeMs:0,lastEndTimeMs:36400});
 assert.deepEqual([...status.overflow],[]);assert.deepEqual([...trace.overflow],[]);assert.deepEqual([...trace.errors],[]);assert.equal(trace.cleanup.restored,true);
 validateDenseLongTaskObservation(trace);const metrics=denseTimingMetrics(trace);assert.equal(metrics.maxLongTaskMs,400);assert.deepEqual(metrics.longTaskObservation,trace.longTaskObservation);
 const good=syntheticProof();Object.assign(good.trace,{longTasks:trace.longTasks,longTaskSupported:true,longTaskObservation:trace.longTaskObservation});good.metrics=denseTimingMetrics(good.trace);validateDenseRenditionEvidence(good);
 for(const mutate of [
  report=>report.trace.errors.push({code:'audio_processor_error'}),
  report=>{report.trace.audioThread[0].terminals=[];report.trace.audioThread[0].rawTerminals=[];},
  report=>{report.trace.listeningEnded=null;},
  report=>report.trace.overflow.push('frames'),
  report=>report.trace.cleanup.restored=false,
  report=>report.trace.scope.pop(),
 ]){const bad=structuredClone(good);mutate(bad);bad.metrics=denseTimingMetrics(bad.trace);assert.throws(()=>validateDenseRenditionEvidence(bad));}
});
test('dense long-task evidence rejects invalid counts, durations, timestamp bounds and misleading summary versions',async()=>{
 const entries=Array.from({length:300},(_,index)=>({startTime:index*100,duration:index===299?200:50})),{trace}=await observedSyntheticLongTasks(entries);
 const reject=mutate=>{const bad=structuredClone(trace);mutate(bad);assert.throws(()=>validateDenseLongTaskObservation(bad));};
 for(const mutate of [
  t=>delete t.longTaskObservation,t=>t.longTaskObservation.version=2,t=>t.longTaskObservation.sampleLimit=257,
  t=>t.longTaskObservation.observedCount=Number.MAX_SAFE_INTEGER+1,t=>t.longTaskObservation.retainedCount=255,t=>t.longTaskObservation.omittedCount=43,
  t=>t.longTaskObservation.omittedCount=-1,t=>t.longTaskObservation.observedCount=300.5,t=>t.longTaskObservation.totalDurationMs=Infinity,
  t=>t.longTaskObservation.totalDurationMs=1,t=>t.longTaskObservation.maxDurationMs=NaN,t=>t.longTaskObservation.maxDurationMs=1,
  t=>t.longTaskObservation.maxDurationMs=20000,t=>t.longTaskObservation.firstStartTimeMs=1,t=>t.longTaskObservation.firstStartTimeMs=-1,
  t=>t.longTaskObservation.lastEndTimeMs=10,t=>t.longTaskObservation.lastEndTimeMs=Infinity,t=>t.longTaskObservation.lastEndTimeMs=48001,
  t=>t.longTasks[0].duration=-1,t=>t.longTasks[0].startTime=Infinity,t=>t.longTasks.push({startTime:1,duration:50}),
  t=>t.longTaskSupported=false,t=>t.longTaskObservation.completeRawRetention=true,t=>t.version=2,
 ])reject(mutate);
 const {trace:oneOmitted}=await observedSyntheticLongTasks(Array.from({length:257},(_,index)=>({startTime:index*100,duration:index===256?200:50})));
 for(const totalDurationMs of [12800,12900,100000]){const bad=structuredClone(oneOmitted);Object.assign(bad.longTaskObservation,{totalDurationMs,maxDurationMs:500});assert.throws(()=>validateDenseLongTaskObservation(bad),'The omitted duration must be possible for its count and maximum');}
 const hugeCount=structuredClone(oneOmitted);Object.assign(hugeCount.longTaskObservation,{observedCount:Number.MAX_SAFE_INTEGER,omittedCount:Number.MAX_SAFE_INTEGER-256,totalDurationMs:12800,maxDurationMs:500});assert.throws(()=>validateDenseLongTaskObservation(hugeCount),'A large safe count cannot use arithmetic tolerance to invent an omitted maximum');
 const {trace:empty}=await observedSyntheticLongTasks([]);validateDenseLongTaskObservation(empty);assert.equal(denseTimingMetrics(empty).maxLongTaskMs,null);
 for(const mutate of [t=>t.longTaskObservation.maxDurationMs=0,t=>t.longTaskObservation.firstStartTimeMs=0,t=>t.longTaskObservation.totalDurationMs=1]){const bad=structuredClone(empty);mutate(bad);assert.throws(()=>validateDenseLongTaskObservation(bad));}
 const {trace:one}=await observedSyntheticLongTasks([{startTime:100,duration:50}]);validateDenseLongTaskObservation(one);
 for(const mutate of [t=>t.longTaskObservation.totalDurationMs=51,t=>t.longTaskObservation.maxDurationMs=51,t=>t.longTaskObservation.firstStartTimeMs=99,t=>t.longTaskObservation.lastEndTimeMs=151]){const bad=structuredClone(one);mutate(bad);assert.throws(()=>validateDenseLongTaskObservation(bad));}
 const proof=syntheticProof();proof.metrics.longTaskObservation.omittedCount=1;assert.throws(()=>validateDenseRenditionEvidence(proof),'Metrics cannot hide omitted samples');
});
test('dense accounting preserves fractional timestamps and durations without rounding them into different observations',async()=>{
 const fixtures=[
  [{startTime:1000.1,duration:1000}],
  [{startTime:0.1,duration:64}],
  Array.from({length:257},(_,index)=>({startTime:index*100+.1,duration:50.1})),
  ...[500.1,500.3].map(duration=>Array.from({length:257},(_,index)=>({startTime:index*100+.1,duration:index===256?duration:50}))),
 ];
 for(const entries of fixtures){const {trace}=await observedSyntheticLongTasks(entries);validateDenseLongTaskObservation(trace);assert.equal(trace.longTaskObservation.totalDurationMs,entries.reduce((sum,row)=>sum+row.duration,0));assert.equal(trace.longTaskObservation.maxDurationMs,Math.max(...entries.map(row=>row.duration)));}
});
test('dense invalid observed timing stays fatal instead of being summarized as valid diagnostics',async()=>{
 for(const row of [{startTime:-1,duration:50},{startTime:1,duration:-50},{startTime:1,duration:Infinity},{startTime:NaN,duration:50},{startTime:Number.MAX_VALUE,duration:Number.MAX_VALUE}]){
  const {trace,status}=await observedSyntheticLongTasks([row]);assert.equal(status.errors[0].code,'dense_long_task_observer');assert.equal(trace.errors[0].code,'dense_long_task_observer');assert.equal(trace.longTaskObservation.observedCount,0);assert.equal(trace.longTasks.length,0);
 }
});
test('historical version 2 dense reports keep their raw-only metrics and overflow rejection',()=>{
 const legacy=syntheticProof();legacy.trace.version=2;delete legacy.trace.longTaskObservation;legacy.metrics=denseTimingMetrics(legacy.trace);assert.equal(legacy.metrics.longTaskObservation,undefined);assert.equal(legacy.metrics.maxLongTaskMs,200);validateDenseRenditionEvidence(legacy);
 legacy.trace.overflow.push('longTasks');assert.throws(()=>validateDenseRenditionEvidence(legacy),'Historical overflow cannot be reclassified as complete evidence');
});
function syntheticProof(){
 // Synthetic verifier records only; these never establish a browser/audio run.
 const expected=expectedDenseAttacks(sourceSha),trace={version:3,longTaskSupported:true,longTaskObservation:{version:1,sampleLimit:256,observedCount:1,retainedCount:1,omittedCount:0,totalDurationMs:200,maxDurationMs:200,firstStartTimeMs:16000,lastEndTimeMs:16200},cleanup:{restored:true,stopped:true,players:1,contexts:1,errors:[],receiver:{restored:true,overflow:false,errors:[],cleanupErrors:[]}},errors:[],overflow:[],states:[{state:'running'}],longTasks:[{startTime:16000,duration:200}],counts:{pumps:0,schedules:0},pumps:[],schedules:[],frames:Array.from({length:200},(_,i)=>({durationMs:1,audioTime:i*.24,audioState:'running',renderer:'playing'})),listeningStarted:{audioTime:0,wall:0},current:{renderer:'ended',position:48000,clock:createPlaybackClock({positionMs:48000,durationMs:48000,completed:true}),captured:'0',audioState:'running',audioTime:48.1,wall:48100},audio:{created:0,overflow:false,sourceStarts:0,oscillatorStarts:0,activeSources:0,pendingSources:0},receiver:syntheticAudioThreadStatus(),audioThread:[syntheticAudioThreadRun(expected,{sourceSha256:sourceSha,durationMs:48000})],scope:[0,8,16].map(first=>({scope:'all',status:'ready',range:`第 ${first+1}–${first+8} 小节，共24小节`,renderer:first?'playing':'ready',parts:[2,3,4,5].map((track,i)=>`midi-t${track}-c${i+1}-r0`),sourceIds:expected.filter(n=>n.startMs>=first*2000&&n.startMs<(first+8)*2000).map(n=>n.id),svg:4,heads:2048,loadMs:30})),renders:[9,17].map(from=>({method:'render',renderer:'playing',range:`Measures ${from}–${from+7} / 24`,durationMs:200}))};
 const pages=[];trace.renders=[];trace.engravingOwnership={version:1,overflow:false};
 for(const [pageIndex,frame]of trace.scope.entries()){
  const first=pageIndex*8;frame.wall=1000+first*2000;frame.renderOwners=[];
  for(const [partIndex,partId]of frame.parts.entries()){
   const id=pageIndex*4+partIndex+1,written=expected.filter(note=>note.part===partId&&note.startMs>=first*2000&&note.startMs<(first+8)*2000).map(note=>['xml-'+note.id,note.id]),xmlNoteIds=written.map(pair=>pair[0]);
   const ownership={version:1,rendererId:id,loadId:id,renderId:id,svgNodes:[id],xmlNoteIds},wall=pageIndex?first*2000-14000+partIndex:100+partIndex;
   pages.push({first_measure:first,request:{settings:{part_id:partId}},written_ids:written});
   frame.renderOwners.push({...ownership,partId,bindings:written});
   trace.renders.push({method:'load',renderer:pageIndex?'playing':'ready',wall:wall-1,durationMs:5,ownership:{version:1,rendererId:id,loadId:id,xmlNoteIds}},
    {method:'render',renderer:pageIndex?'playing':'ready',wall,durationMs:200,range:`Measures ${Math.max(1,first-7)}–${Math.max(8,first)} / 24`,ownership});
  }
 }
 trace.listeningEnded={...trace.current,clock:{...trace.current.clock}};return{ok:true,origin:'https://wmh.localhost',cleanup:{status:'complete',resources:['context','browser','driver'].map(name=>({name,status:'closed'})),errors:[],writeErrors:[]},locale:'zh-CN',fixture:{source_sha256:sourceSha,fixture:DENSE_STREAM,pages},trace,metrics:denseTimingMetrics(trace),assessmentRequests:0,results:{historyHidden:true,passOptions:[''],exportDisabled:true,assessmentDisabled:true},actions:Array.from({length:10},()=>({completed:true})),pageErrors:[],claims:{physical_audio:false,synthetic_clock:false,production_behavior_changed:false}};
}
test('dense proof rejects lost processor onsets, stale generations, fake PCM, paused clocks and machine input',()=>{
 const good=syntheticProof();validateDenseRenditionEvidence(good);assert.equal(good.metrics.maxRenderMs,200,'Long measured rendering is reported without being hidden or relabeled');assert.equal(good.metrics.processorStarted,6144);
 for(const change of [r=>delete r.cleanup,r=>r.cleanup.status='pending',r=>r.cleanup.resources[2].status='failed',r=>r.trace.errors.push({code:'audio_processor_error'}),r=>r.trace.audioThread[0].terminals[0].record.ledger.actualStarts.pop(),r=>r.trace.audioThread[0].plan.notes[1][1]=r.trace.audioThread[0].plan.notes[0][1],r=>r.trace.audioThread[0].terminals[0].record.ledger.actualStarts[0]++,r=>r.trace.audioThread[0].terminals[0].record.ledger.actualEnds[0]++,r=>r.trace.audioThread[0].messages[1].generation++,r=>r.trace.audioThread[0].messages[0].isTrusted=false,r=>r.trace.audioThread[0].pcm.blocks[0].peak=0,r=>r.trace.audioThread[0].started.graphToDestination=null,r=>r.trace.scope[1].sourceIds.pop(),r=>r.trace.scope[2].renderer='paused',r=>r.trace.current.captured='1',r=>r.trace.states.push({state:'suspended'}),r=>r.trace.frames[1].audioTime=-1,r=>r.trace.current.renderer='paused',r=>r.trace.audio.activeSources=1,r=>r.trace.cleanup.restored=false,r=>r.assessmentRequests=1,r=>r.metrics.maxRenderMs=0]){const value=structuredClone(good);change(value);assert.throws(()=>validateDenseRenditionEvidence(value));}
 const failed={...good,ok:false,error:'native scheduling sentinel'};assert.throws(()=>validateDenseRenditionEvidence(failed),/native scheduling sentinel/);
 const legacy=structuredClone(good);legacy.trace.version=1;legacy.trace.audio={created:6144,sourceStarts:6144,oscillatorStarts:6144};delete legacy.trace.audioThread;assert.throws(()=>validateDenseRenditionEvidence(legacy),/Legacy main-thread/,'Old 314/317 oscillator traces cannot masquerade as worklet completion');
});
test('dense evidence rejects missing or forged End clocks and completed shorter loops',()=>{
 const good=syntheticProof();validateDenseRenditionEvidence(good);
 for(const label of ['listeningEnded','current'])for(const mutate of [
  sample=>delete sample.clock,
  sample=>sample.clock={version:1},
  sample=>sample.clock.version=2,
  sample=>sample.clock.positionMs='48000',
  sample=>sample.clock.transportPositionMs=47999,
  sample=>sample.clock.unverified=true,
  sample=>sample.clock=createPlaybackClock({positionMs:48000,durationMs:48000,available:false}),
  sample=>sample.clock=createPlaybackClock({positionMs:48000,durationMs:48000,hasStarted:true}),
  sample=>sample.clock=createPlaybackClock({positionMs:48001,durationMs:48001,completed:true}),
  sample=>sample.clock=createPlaybackClock({positionMs:48000,durationMs:48000,rangeStartMs:1,completed:true}),
  sample=>{sample.position=47999;sample.clock=createPlaybackClock({positionMs:47999,durationMs:48000,rangeEndMs:47999,completed:true});},
  sample=>sample.position=47999,
 ]){
  const changed=structuredClone(good);mutate(changed.trace[label]);
  assert.throws(()=>validateDenseRenditionEvidence(changed),`${label}: corrupted source End must fail acceptance`);
 }
});
test('dense CI uses the prepared exact-source driver, retains original evidence and refuses local launch',async()=>{
 for(const[name,job]of [['basic-key-preview.yml','basic-key-browser'],['windows-desktop-acceptance.yml','bulk-import-browser']]){const result=spawnSync('python',['scripts/check-authoring-workflow.py','--json',fileURLToPath(new URL(`../.github/workflows/${name}`,import.meta.url))],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);const steps=JSON.parse(result.stdout).jobs[job].steps,run=steps.find(row=>row.run==='node scripts/hosted-dense-rendition-check.mjs');assert.ok(run);assert.equal(run['continue-on-error'],undefined);assert.equal(run.if,"${{ !cancelled() && steps.notation_server.outcome == 'success' && steps.dense_native_driver.outcome == 'success' && steps.dense_browser_setup.outcome == 'success' }}");assert.equal(steps.find(row=>row.id==='dense_native_driver').run,'cargo build -p worldmusichub-desktop --example native_import_driver --locked');assert.equal(steps.find(row=>row.id==='dense_browser_setup').run,'npx playwright install --with-deps chromium');assert.equal(run.env.WMH_SOURCE_SHA,'${{ github.sha }}');assert.equal(run.env.WMH_NATIVE_IMPORT_DRIVER,'${{ github.workspace }}/target/debug/examples/native_import_driver');const artifact=steps.find(row=>row.with?.name==='dense-rendition-browser-${{ github.sha }}');assert.equal(artifact.if,'always()');assert.ok(artifact.with.path.includes('fixture/*'));assert.ok(artifact.with.path.includes('ui-pages/*.json'));assert.ok(!artifact.with.path.includes('Scores'));}
 const script=fileURLToPath(new URL('../scripts/hosted-dense-rendition-check.mjs',import.meta.url)),refused=spawnSync(process.execPath,[script],{env:{...process.env,GITHUB_ACTIONS:'false',WMH_HOSTED_BROWSER:'0'},encoding:'utf8'});assert.equal(refused.status,1);assert.match(refused.stderr,/require the authorized hosted Actions runner/);const source=await readFile(script,'utf8');assert.doesNotMatch(source,/waitForTimeout|lookAheadMs\s*=|transport\.seek|progress[^\n]*\.value\s*=/);
});

test('dense observer attempts all cleanup after listener and receiver failures without replacing the product cause',async()=>{
 const calls=[],fail=name=>{calls.push(name);throw Error(`${name} cleanup failure`);},nodes={progress:clockProgress(10,{running:false}),'clean-song-stage':{dataset:{rendererState:'paused'}},workspace:{dataset:{scoreState:'session'},addEventListener(){},removeEventListener(){fail('scope');}},'engraving-range':{textContent:'Measures 1–8 / 24'},'hud-captured':{textContent:'0'},notice:{textContent:'original product failure'}},context={currentTime:1,state:'running',addEventListener(){},removeEventListener(){fail('context');}};
 class Renderer{load(){}updateGraphic(){}render(){}}
 const originalMethods=[Renderer.prototype.load,Renderer.prototype.updateGraphic,Renderer.prototype.render],requestAnimationFrame=()=>1,realm=vm.createContext({document:{getElementById:id=>nodes[id]},performance,structuredClone,requestAnimationFrame,localStorage:{setItem(){}}});vm.runInContext(`(()=>{${denseRenditionBootstrap()}})();`,realm);
 const productError={code:'audio_processor_error',message:'original product failure'},observeReceiver=async(_,{onContext,onStart})=>{onContext(context);onStart();return{status:()=>({...syntheticAudioThreadStatus(),errors:[productError]}),snapshot:()=>[],count:()=>1,quiet:()=>true,restore:()=>fail('receiver')};};
 const observer=await realm.__wmhDenseObserverTools.install({library:{Renderer,observeReceiver},audioProbe:{snapshot:()=>({}),restore:()=>fail('legacy')}}),trace=observer.stop();
 assert.equal(trace.cleanup.restored,false);assert.equal(trace.cleanup.errors.length,4);assert.deepEqual(calls,['scope','receiver','context','legacy']);assert.deepEqual([Renderer.prototype.load,Renderer.prototype.updateGraphic,Renderer.prototype.render],originalMethods);assert.equal(realm.requestAnimationFrame,requestAnimationFrame);assert.equal(trace.receiver.errors[0].message,'original product failure');
 const report={ok:false,error:'original product failure',trace};await finishDenseReport(report,{resources:['context','browser','driver'].map(name=>({name,present:true,close:async()=>calls.push(name)})),persist:async()=>{},validate(){throw Error('Failed audio cannot pass');}});assert.equal(report.error,'original product failure');assert.equal(report.trace.cleanup.errors.length,4);assert.deepEqual(calls.slice(-3),['context','browser','driver']);
});


test('dense startup failure exposes initialization phase and product notice before any prepared audio row exists',async()=>{
 const nodes={progress:clockProgress(0,{running:false,hasStarted:false}),'clean-song-stage':{dataset:{rendererState:'ready'}},workspace:{dataset:{scoreState:'inspection'},addEventListener(){},removeEventListener(){}},'engraving-range':{textContent:'Measures 1–8'},'hud-captured':{textContent:'0'},notice:{textContent:'Actual startup module failure'}};
 class Receiver{static create(){return Promise.reject(Object.assign(new Error('Module import failed'),{code:'audio_worklet_unavailable',details:{phase:'module-load',causeName:'AbortError',causeMessage:'Underlying loader rejection'}}));}prepare(){}start(){}}
 class Renderer{load(){}updateGraphic(){}render(){}}
 const realm=vm.createContext({document:{getElementById:id=>nodes[id]},performance,structuredClone,Float32Array,localStorage:{setItem(){}}});vm.runInContext(`(()=>{${denseRenditionBootstrap()}})();`,realm);
 const original=Receiver.create,observer=await realm.__wmhDenseObserverTools.install({library:{BasicKeyAudioReceiver:Receiver,Renderer},audioProbe:{snapshot:()=>({}),restore:()=>true}});await assert.rejects(Receiver.create({state:'running'},{}),/Module import failed/);
 const status=observer.status();assert.equal(status.schedules,0);assert.equal(status.current.position,0);assert.equal(status.errors[0].details.phase,'module-load');assert.equal(status.errors[0].details.causeMessage,'Underlying loader rejection');assert.equal(status.current.notice,'Actual startup module failure');assert.equal(observer.snapshot().receiver.initializations[0].ok,false);assert.equal(observer.stop().cleanup.restored,true);assert.equal(Receiver.create,original);
 const host=await readFile(new URL('../scripts/hosted-dense-rendition-check.mjs',import.meta.url),'utf8');assert.match(host,/Actual audio failure:/);assert.match(host,/Production UI: '\+status.current.notice/);
});

test('dense prepared pages require actual load/render and same adopted SVG/source bindings without page-label timing assumptions',()=>{
 const good=syntheticProof();
 assert.equal(good.trace.renders.some(row=>row.method==='render'&&Number(row.range?.match(/\d+/)?.[0])===17),false,'The next page actually renders before its new range label');
 validateDenseRenditionEvidence(good);
 for(const mutate of [
  report=>delete report.trace.engravingOwnership,
  report=>report.trace.engravingOwnership.overflow=true,
  report=>delete report.trace.scope[1].renderOwners,
  report=>report.trace.scope[1].renderOwners.pop(),
  report=>report.trace.scope[1].renderOwners[0].partId='unrelated-part',
  report=>report.trace.scope[1].renderOwners[0].svgNodes=[499],
  report=>report.trace.scope[1].renderOwners[1].svgNodes=report.trace.scope[1].renderOwners[0].svgNodes,
  report=>report.trace.scope[1].renderOwners[0].loadId=1,
  report=>report.trace.scope[1].renderOwners[0].renderId=1,
  report=>report.trace.scope[1].renderOwners[0].bindings[0][1]='unrelated-source-note',
  report=>report.trace.scope[1].renderOwners[0].bindings[0][0]='unrelated-xml-note',
  report=>report.trace.scope[1].renderOwners[0].xmlNoteIds.pop(),
  report=>report.fixture.pages[4].written_ids[0][1]='unrelated-native-source',
  report=>report.trace.renders=report.trace.renders.filter(row=>row.ownership?.renderId!==5),
  report=>report.trace.renders=report.trace.renders.filter(row=>!(row.method==='load'&&row.ownership?.loadId===5)),
  report=>report.trace.renders.find(row=>row.ownership?.renderId===5).method='updateGraphic',
  report=>report.trace.renders.find(row=>row.ownership?.renderId===5).ownership.svgNodes=[498],
  report=>report.trace.renders.find(row=>row.ownership?.renderId===5).ownership.rendererId=1,
  report=>report.trace.renders.find(row=>row.ownership?.renderId===5).error='real render failed',
  report=>report.trace.renders.find(row=>row.ownership?.renderId===5).wall=report.trace.scope[1].wall+1,
  report=>report.trace.renders.push(structuredClone(report.trace.renders.find(row=>row.ownership?.renderId===5))),
 ]){const changed=structuredClone(good);mutate(changed);changed.metrics=denseTimingMetrics(changed.trace);assert.throws(()=>validateDenseRenditionEvidence(changed));}
});

for(const changedNodes of [false,true])test(`dense passive observer ${changedNodes?'rejects substituted':'links prepared and adopted'} SVG objects through the real scope event`,async()=>{
 const {document}=parseHTML('<html><body><div id="workspace"></div><div id="clean-song-stage"></div><div id="engraving-range"></div><div id="hud-captured"></div><div id="notice"></div><div id="engraved-staff"></div><div id="staged" inert data-notation-preparation=""></div></body></html>'),Event=document.defaultView.CustomEvent;
 const bounds=node=>{node.getBoundingClientRect=()=>({x:10,y:10,width:200,height:100});return node;};for(const node of document.querySelectorAll('*'))bounds(node);
 Object.defineProperty(document,'defaultView',{value:{getComputedStyle:()=>({display:'block',visibility:'visible',opacity:'1'})}});
 const find=document.getElementById.bind(document),progress=clockProgress(1000);document.getElementById=id=>id==='progress'?progress:find(id);
 const stage=find('workspace');stage.dataset.scoreState='session';stage.dataset.notationLoadMs='0';find('clean-song-stage').dataset.rendererState='playing';find('engraving-range').textContent='第 1–8 小节，共24小节';find('hud-captured').textContent='0';
 class Renderer{
  constructor(container){this.container=container;}
  load(){this.clear();this.Sheet={SourceMeasures:[{}]};return Promise.resolve();}
  updateGraphic(){return 'actual graphic';}
  render(){const svg=bounds(document.createElement('svg')),head=bounds(document.createElement('g'));head.setAttribute('class','vf-notehead');svg.append(head);this.container.append(svg);this.GraphicSheet={MeasureList:[]};return 'actual render';}
  clear(){this.container.replaceChildren();delete this.Sheet;delete this.GraphicSheet;}
 }
 const realm=vm.createContext({document,performance,structuredClone,localStorage:{setItem(){}}});vm.runInContext(`(()=>{${denseRenditionBootstrap()}})();`,realm);
 const observer=await realm.__wmhDenseObserverTools.install({library:{Renderer,observeReceiver:async()=>({status:()=>syntheticAudioThreadStatus(),snapshot:()=>[],count:()=>1,quiet:()=>true,restore:()=>({restored:true,overflow:false,errors:[],cleanupErrors:[]})})},audioProbe:{snapshot:()=>({}),restore:()=>true}});
 delete realm.__wmhDenseObserverTools;
 const parts=[],mounts=[];
 for(let index=0;index<4;index++){
  const mount=bounds(document.createElement('div'));mount.dataset.notationPartId=`part-${index}`;parts.push(mount.dataset.notationPartId);find('staged').append(mount);mounts.push(mount);
  const renderer=new Renderer(mount),xml=new DOMParser().parseFromString(`<score-partwise><part><measure><note id="xml-${index}"/></measure></part></score-partwise>`,'application/xml');await renderer.load(xml);assert.equal(renderer.render(),'actual render');
  const cue=document.createElement('span');cue.className='engraving-expected-cue';cue.dataset.sourceNoteId=`original-${index}`;cue.dataset.xmlNoteId=`xml-${index}`;mount.append(cue);
 }
 assert.equal(find('engraved-staff').querySelectorAll('svg').length,0);
 const prepared=observer.snapshot().renders.filter(row=>row.method==='render');assert.equal(prepared.length,4);assert.ok(prepared.every(row=>row.range.includes('1–8')&&row.ownership));
 if(changedNodes){const svg=mounts[0].querySelector('svg'),clone=bounds(svg.cloneNode(true));svg.replaceWith(clone);}
 find('engraved-staff').replaceChildren(...mounts);find('engraving-range').textContent='第 9–16 小节，共24小节';
 assert.doesNotThrow(()=>stage.dispatchEvent(new Event('notationscopecontext',{detail:{scope:'all',status:'ready',page:2,renderedPartIds:parts}})),'Passive observation failure must not throw into the application event');
 const trace=observer.stop();assert.equal(trace.cleanup.restored,true);
 if(changedNodes){assert.ok(trace.errors.some(error=>error.code==='dense_engraving_ownership'));assert.equal(trace.scope[0].renderOwners,undefined);}
 else{assert.deepEqual([...trace.scope[0].renderOwners].map(owner=>owner.svgNodes[0]),prepared.map(row=>row.ownership.svgNodes[0]));assert.deepEqual([...trace.scope[0].renderOwners].map(owner=>[...owner.bindings[0]]),[0,1,2,3].map(index=>[`xml-${index}`,`original-${index}`]));assert.deepEqual([...trace.errors],[]);}
});

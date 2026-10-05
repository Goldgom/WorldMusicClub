import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {CanonicalAudioCore} from '../web/canonical-audio-core.js';
import {CanonicalAudioReceiver} from '../web/canonical-audio-receiver.js';
import {CanonicalPlayer} from '../web/canonical-player.js';
import {buildCanonicalAudioPlan,CANONICAL_AUDIO_POLICY,CANONICAL_AUDIO_LIMITS,createCanonicalAudioTransfer} from '../web/canonical-audio-plan.js';
import {basicKeyAudioHarness} from './basic-key-audio-harness.js';
import {capacityEvidence} from './canonical-audio-fixtures.js';
const fixture=()=>JSON.parse(readFileSync(new URL('./fixtures/canonical-audio-evidence.json',import.meta.url)));
const options={sampleRate:48000,mode:'practice',practiceSelection:{kind:'parts',part_ids:['人 手 🎹']},acceptedPolicyId:CANONICAL_AUDIO_POLICY,range:{startMs:250,endMs:500},countInMs:100,loop:{enabled:true,maxPasses:192}};
function plan(overrides={},f=fixture()){return buildCanonicalAudioPlan(f.compilation,f.profile,{...options,...overrides});}
function rig(p){let frame=0;const messages=[],core=new CanonicalAudioCore(p.sampleRate,{emit:(m,transfer=[])=>messages.push(structuredClone(m,{transfer}))}),packed=createCanonicalAudioTransfer(p);
 core.handleMessage({type:'prepare',generation:1,positionFrame:p.initialPositionFrame-p.initialCountInFrames,wire:structuredClone(packed.wire,{transfer:packed.transfer})},0);
 const block=()=>{const pcm=new Float32Array(128);core.process([pcm],frame);frame+=128;return pcm;};while(core.state==='preparing')block();assert.equal(core.state,'ready',messages.at(-1)?.message);
 const anchor=frame+100;core.handleMessage({type:'start',generation:1,anchorFrame:anchor},frame);
 return {core,messages,block,anchor,get frame(){return frame;},command(type,extra={}){core.handleMessage({type,generation:1,...extra},frame);}};
}
test('original three-part 48-second A/B run preserves every clipped gate through complete host-render stall',()=>{
 const p=plan({countInMs:0}),h=rig(p),first=h.anchor+p.countInFrames,edges=new Map();let energy=0;
 // No drawing, input or host-message callback runs during the entire 192-pass
 // render. This is production-core PCM/ledger evidence, not a native device.
 while(h.core.state==='running'){const start=h.frame,pcm=h.block();for(let i=0;i<pcm.length;i++){energy+=Math.abs(pcm[i]);const relative=start+i-first;if(relative>=0&&(relative%12000===0||relative%12000===11999))edges.set(start+i,pcm[i]);}}
 const e=h.messages.find(m=>m.type==='ended');assert.equal(e.reason,'loop_budget_end');assert.equal(e.passCount,192);assert.equal(e.recordCount,384);assert.equal(e.frame,first+48000*48);assert.ok(energy>1000);
 for(let pass=0;pass<192;pass++)for(let voice=0;voice<2;voice++){const record=pass*2+voice;assert.equal(e.ledger.actualStarts[record],first+pass*12000);assert.equal(e.ledger.actualEnds[record],first+(pass+1)*12000);}
 for(let pass=1;pass<192;pass++){const boundary=first+pass*12000;assert.notEqual(edges.get(boundary-1),0);assert.notEqual(edges.get(boundary),0);}
 assert.equal(h.messages.filter(m=>m.type==='pass_started').length,192);assert.deepEqual([...e.passFrames],Array.from({length:192},(_,pass)=>first+pass*12000));
});
test('zero-machine 250ms loops keep full source identity and all pass clocks without divide-by-zero',()=>{
 const p=plan({practiceSelection:{kind:'all'},loop:{enabled:true,maxPasses:4}}),h=rig(p);let energy=0;while(h.core.state==='running')for(const v of h.block())energy+=Math.abs(v);
 const e=h.messages.find(m=>m.type==='ended');assert.equal(energy,0);assert.equal(p.durationFrames,192000);assert.equal(p.recordCapacity,0);assert.equal(e.recordCount,0);assert.equal(e.passCount,4);assert.equal(e.frame,h.anchor+4*(4800+12000));assert.equal(e.ledger.actualStarts.length,0);
});
test('pause/resume inside one loop preserves envelope and pass boundary without re-count-in',()=>{
 const p=plan({loop:{enabled:true,maxPasses:3}}),h=rig(p);while(h.frame<10000)h.block();const pauseFrame=h.frame,pass=h.core.rangePassIndex,phase=h.core.voiceSlots[h.core.activeSlots[0]].phase;h.command('pause');
 for(let i=0;i<8;i++)assert.ok(h.block().every(v=>v===0));assert.equal(h.core.voiceSlots[h.core.activeSlots[0]].phase,phase);const resume=h.frame+64;h.command('resume',{anchorFrame:resume});assert.equal(h.core.rangePassIndex,pass);
 while(h.core.state==='running')h.block();const e=h.messages.find(m=>m.type==='ended'),shift=resume-pauseFrame,first=h.anchor+p.countInFrames;
 assert.equal(e.passCount,3);assert.equal(e.recordCount,6);assert.deepEqual([...e.pauseSpans],[pauseFrame,resume]);assert.equal(e.ledger.actualStarts[0],first);assert.equal(e.ledger.actualEnds[0],first+12000+shift);assert.equal(e.ledger.actualStarts[2],first+12000+4800+shift);assert.equal(e.frame,first+36000+9600+shift);
});
test('Listen part mix is explicit and source-preserving; range/count-in/budget are fingerprint-bound',()=>{
 const f=fixture(),all=plan({mode:'listen',practiceSelection:undefined},f),one=plan({mode:'listen',practiceSelection:undefined,audiblePartIds:['机 器/一']},f);
 assert.equal(all.rangeGateCount,3);assert.equal(one.rangeGateCount,1);assert.equal(all.durationFrames,one.durationFrames);assert.equal(all.sourceFingerprint,one.sourceFingerprint);assert.notEqual(all.selectionFingerprint,one.selectionFingerprint);
 for(const change of [{range:{startMs:251,endMs:500}},{countInMs:101},{loop:{enabled:true,maxPasses:193}}])assert.notEqual(plan(change).planFingerprint,plan().planFingerprint);
 for(const o of [{range:{startMs:0,endMs:5000}},{range:{startMs:500,endMs:500}},{countInMs:-1},{loop:{enabled:true,maxPasses:5000}},{audiblePartIds:['absent']}])assert.throws(()=>plan(o));
 const p=plan(),packed=createCanonicalAudioTransfer(p);packed.wire.rangeStartFrame++;const c=new CanonicalAudioCore(48000);c.handleMessage({type:'prepare',generation:1,positionFrame:p.initialPositionFrame-p.initialCountInFrames,wire:packed.wire},0);assert.equal(c.state,'error');
});
test('500k actual gate budget admits only whole passes and reports reduction before start',()=>{
 const f=capacityEvidence({count:100000}),p=plan({practiceSelection:{kind:'parts',part_ids:['human']},range:undefined,countInMs:0,loop:true},f);
 assert.equal(p.requestedPasses,4096);assert.equal(p.maxPasses,5);assert.equal(p.budgetLimited,true);assert.equal(p.recordCapacity,500000);
 const packed=createCanonicalAudioTransfer(p),bytes=packed.transfer.reduce((n,b)=>n+b.byteLength,0)+CANONICAL_AUDIO_LIMITS.maxPauses*16;
 assert.ok(bytes<=16*1024*1024);assert.equal(bytes,14065576);assert.equal(p.rangeOrder.length,100000);
 const messages=[],c=new CanonicalAudioCore(48000,{emit:m=>messages.push(m)});c.handleMessage({type:'prepare',generation:1,positionFrame:0,wire:packed.wire},0);assert.equal(c.prepareCursor,0);let frame=0;const out=new Float32Array(128);while(c.state==='preparing'){c.process([out],frame);frame+=128;assert.ok(c.lastPrepareWork<=256);}assert.equal(c.state,'ready');assert.equal(messages.at(-1).budgetLimited,true);assert.equal(messages.at(-1).maxPasses,5);c.handleMessage({type:'cancel',generation:2},frame);
});
test('historical input event-time resolves exact passes after stalled receipt delivery and excludes pauses',async()=>{
 const h=basicKeyAudioHarness({autoMessages:false}),receipts=[],r=await CanonicalAudioReceiver.create(h.context,h.output,{nodeFactory:()=>h.nodeFactory({Core:CanonicalAudioCore}),onPass:m=>receipts.push(m)}),p=plan({loop:{enabled:true,maxPasses:8}});
 try{
  const prepared=r.prepare(p);h.deliverCore();h.finishPreparation();h.deliverMain();await prepared;const starting=r.start();h.deliverCore();h.deliverMain();const start=await starting,first=start.anchorFrame+p.countInFrames;
  while(h.frame<first+36000)h.renderBlock();assert.equal(receipts.length,0,'Host pass callbacks are intentionally stalled');
  assert.equal(r.sourceClockAtTime((first+11999)/48000).passIndex,0);assert.equal(r.sourceClockAtTime((first+12000)/48000).passIndex,1);assert.equal(r.sourceClockAtTime((first+12000)/48000).positionMs,150);
  assert.equal(r.sourceClockAtTime((first-1)/48000).inCountIn,true);h.deliverMain();assert.equal(receipts.length,3);
  const pausing=r.pause();h.deliverCore();h.deliverMain();const paused=await pausing;for(let i=0;i<10;i++)h.renderBlock();const resuming=r.resume();h.deliverCore();h.deliverMain();const resumed=await resuming;
  const inPause=r.sourceClockAtTime((paused.frame+100)/48000);assert.equal(inPause.paused,true);assert.equal(inPause.positionMs,paused.sourcePositionFrame/48);
  const after=r.sourceClockAtTime(resumed.resumeFrame/48000);assert.equal(after.paused,false);assert.equal(after.passIndex,paused.passIndex);assert.equal(after.positionMs,paused.sourcePositionFrame/48);
  assert.equal(r.sourceClockAtTime((first+12000)/48000).passIndex,1,'A later pause does not change an old input timestamp');
  assert.equal(r.sourceClockAtTime(h.context.currentTime,{generation:99}),null);assert.equal(r.sourceClockAtTime(h.context.currentTime,{planFingerprint:'0'.repeat(64)}),null);
  while(h.nodes[0].core.state==='running')h.renderBlock();h.deliverMain();const audit=await r.audit({offset:2,count:2});assert.ok(audit.rows.every(row=>row.passIndex===1));assert.equal(audit.rows[0].partId,'机 器/一');assert.equal(audit.recordCount,16);
 }finally{r.dispose();h.deliverCore();h.deliverMain();}
});
test('player preserves source clock snapshot on device interruption and rejects old player epochs',async()=>{
 const h=basicKeyAudioHarness(),f=fixture(),errors=[],player=new CanonicalPlayer({onError:e=>errors.push(e),receiverFactory:(ctx,out,o)=>CanonicalAudioReceiver.create(ctx,out,{...o,nodeFactory:()=>h.nodeFactory({Core:CanonicalAudioCore})})});player.select(f.compilation,f.profile);
 await player.prepare({...options,context:h.context,output:h.output});await player.startPrepared();for(let i=0;i<80;i++)h.renderBlock();await Promise.resolve();const before=player.sourceClockAtTime(),epoch=before.playerEpoch;h.setState('suspended');assert.equal(player.running,false);assert.equal(player.lastStopClock.positionMs,before.positionMs);assert.equal(player.sourceClockAtTime(h.context.currentTime,{playerEpoch:epoch}),null);assert.equal(errors.at(-1).code,'clean_clock_unavailable');h.setState('running');await Promise.resolve();player.stop();
});
test('midrange seek binds a shorter first pass, then reuses A with count-in and distinct audit identity',async()=>{
 const overrides={range:{startMs:250,endMs:2250},resumePositionMs:1200,countInMs:100,loop:{enabled:true,maxPasses:3}},p=plan(overrides),h=rig(p);
 assert.equal(p.initialPositionFrame,57600);assert.equal(p.initialCountInFrames,0);assert.equal(p.firstGateCount,2);assert.equal(p.rangeGateCount,5);assert.equal(p.recordCapacity,12);
 while(h.core.state==='running')h.block();const e=h.messages.find(m=>m.type==='ended');assert.equal(e.recordCount,12);assert.equal(e.passCount,3);assert.equal(e.frame,h.anchor+5250*48);
 assert.equal(e.ledger.actualStarts[0],h.anchor+800*48);assert.equal(e.ledger.actualEnds[0],h.anchor+1050*48);
 const secondAttack=h.anchor+1150*48;assert.equal(e.passFrames[1],secondAttack);assert.equal(e.ledger.actualStarts[2],secondAttack);assert.equal(e.ledger.actualEnds[2],secondAttack+750*48);
 assert.equal(h.messages.find(m=>m.type==='pass_started'&&m.passIndex===1).cycleStartFrame,h.anchor+1050*48);
 const harness=basicKeyAudioHarness(),r=await CanonicalAudioReceiver.create(harness.context,harness.output,{nodeFactory:()=>harness.nodeFactory({Core:CanonicalAudioCore})});
 try{
  await r.prepare(p,{positionMs:1200});const start=await r.start();assert.equal(r.sourcePositionMs(),1200);
  const count=r.sourceClockAtTime((start.anchorFrame+1050*48)/48000);assert.equal(count.passIndex,1);assert.equal(count.positionMs,150);assert.equal(count.inCountIn,true);assert.equal(count.cycleStartFrame,start.anchorFrame+1050*48);assert.equal(count.passStartFrame,start.anchorFrame+1150*48);
  while(harness.nodes[0].core.state==='running')harness.renderBlock();harness.deliverMain();const audit=await r.audit({offset:0,count:8});assert.equal(audit.rows[0].passIndex,0);assert.equal(audit.rows[0].noteIndex,p.firstRangeOrder[0]);assert.equal(audit.rows[2].passIndex,1);assert.equal(audit.rows[2].noteIndex,p.rangeOrder[0]);assert.notEqual(audit.rows[0].occurrenceIndex,audit.rows[2].occurrenceIndex);
 }finally{r.dispose();await Promise.resolve();}
});
test('range clock advances pass at B before musical-start receipt and preserves explicit count-in silence',()=>{
 const p=plan({loop:{enabled:true,maxPasses:3}}),h=rig(p),first=h.anchor+p.initialCountInFrames,firstB=first+12000;let silence=0;
 while(h.core.state==='running'){const before=h.frame,pcm=h.block();for(let i=0;i<pcm.length;i++){const frame=before+i;if(frame>=firstB&&frame<firstB+4800){assert.equal(pcm[i],0);silence++;}}}
 assert.equal(silence,4800);const starts=h.messages.filter(m=>m.type==='pass_started');assert.deepEqual(starts.map(m=>m.frame),[first,first+16800,first+33600]);assert.equal(starts[1].cycleStartFrame,firstB);assert.equal(starts[1].passIndex,1);
});
test('new generation during range count-in resumes only the remaining count-in',async()=>{
 const p=plan({resumePositionMs:210,countInMs:100,loop:{enabled:true,maxPasses:2}});assert.equal(p.initialPositionFrame,250*48);assert.equal(p.initialCountInFrames,40*48);assert.equal(p.firstGateCount,p.rangeGateCount);
 const h=rig(p);while(h.core.state==='running')h.block();const starts=h.messages.filter(m=>m.type==='pass_started');assert.equal(starts[0].frame,h.anchor+40*48);assert.equal(starts[1].frame,starts[0].frame+(250+100)*48);
 const harness=basicKeyAudioHarness(),r=await CanonicalAudioReceiver.create(harness.context,harness.output,{nodeFactory:()=>harness.nodeFactory({Core:CanonicalAudioCore})});try{await r.prepare(p,{positionMs:210});const started=await r.start();assert.equal(r.sourcePositionMs(),210);const clock=r.sourceClockAtTime((started.anchorFrame+20*48)/48000);assert.equal(clock.positionMs,230);assert.equal(clock.inCountIn,true);assert.equal(clock.passIndex,0);}finally{r.dispose();await Promise.resolve();}
 assert.throws(()=>plan({resumePositionMs:149.9}));
});
test('seek exactly B admits an empty first interval even when source sustains cross B',()=>{
 for(const loop of [false,{enabled:true,maxPasses:2}]){
  const p=plan({resumePositionMs:500,loop}),h=rig(p);assert.equal(p.firstGateCount,0);assert.equal(p.firstRangeOrder.length,0);
  while(h.core.state==='running')h.block();const e=h.messages.find(m=>m.type==='ended');assert.ok(e,JSON.stringify(h.messages.at(-1)));assert.equal(e.recordCount,loop?2:0);assert.equal(e.frame,h.anchor+(loop?350*48:0));
  if(loop){assert.equal(e.ledger.actualStarts[0],h.anchor+100*48);assert.equal(e.ledger.actualEnds[0],h.anchor+350*48);assert.equal(e.passFrames[0],-1);assert.equal(e.passFrames[1],h.anchor+100*48);assert.equal(e.observedPassCount,1);}
 }
});
test('re-pausing during a future resume lead reopens one interval without rewinding held playback',async()=>{
 const h=basicKeyAudioHarness(),r=await CanonicalAudioReceiver.create(h.context,h.output,{nodeFactory:()=>h.nodeFactory({Core:CanonicalAudioCore})}),p=plan({countInMs:0,loop:{enabled:true,maxPasses:3}});
 try{
  await r.prepare(p);const start=await r.start();for(let i=0;i<40;i++)h.renderBlock();const firstPause=await r.pause(),position=r.sourcePositionMs(),phase=h.nodes[0].core.voiceSlots[h.nodes[0].core.activeSlots[0]].phase;
  await r.resume();const secondPause=await r.pause();assert.equal(secondPause.resumedLeadCanceled,true);assert.equal(secondPause.pauseFrame,firstPause.frame);assert.equal(r.clockPauses.length,1);assert.equal(r.sourcePositionMs(),position);
  for(let i=0;i<10;i++)assert.ok(h.renderBlock()[0].every(v=>v===0));assert.equal(h.nodes[0].core.voiceSlots[h.nodes[0].core.activeSlots[0]].phase,phase);
  const resumed=await r.resume(),shift=resumed.resumeFrame-firstPause.frame;assert.equal(r.sourceClockAtTime(resumed.resumeTime).positionMs,position);
  while(h.nodes[0].core.state==='running')h.renderBlock();h.deliverMain();const e=r.lastCompletion;assert.deepEqual([...e.pauseSpans],[firstPause.frame,resumed.resumeFrame]);assert.equal(e.ledger.actualEnds[0],start.anchorFrame+12000+shift);assert.equal(e.frame,start.anchorFrame+36000+shift);assert.equal(e.totalPausedFrames,shift);
 }finally{r.dispose();await Promise.resolve();}
});
test('stale start cannot reset cursor or pass state in a newer active generation',()=>{
 const p=plan({countInMs:0,loop:{enabled:true,maxPasses:3}}),h=rig(p),packed=createCanonicalAudioTransfer(p);
 h.core.handleMessage({type:'prepare',generation:2,positionFrame:p.initialPositionFrame-p.initialCountInFrames,wire:packed.wire},h.frame);while(h.core.state==='preparing')h.block();h.core.handleMessage({type:'start',generation:2,anchorFrame:h.frame+100},h.frame);for(let i=0;i<10;i++)h.block();
 const cursor=h.core.cursor,pass=h.core.rangePassIndex,anchor=h.core.initialAnchorFrame;h.core.handleMessage({type:'start',generation:1,anchorFrame:h.frame+100},h.frame);assert.equal(h.messages.at(-1).type,'stale');assert.equal(h.core.cursor,cursor);assert.equal(h.core.rangePassIndex,pass);assert.equal(h.core.initialAnchorFrame,anchor);
 while(h.core.state==='running')h.block();assert.equal(h.core.state,'ended');assert.equal(h.messages.at(-1).planGeneration,2);assert.equal(h.messages.at(-1).recordCount,6);
});
test('canceled count-in reports entered cycles separately from observed musical passes',()=>{
 for(const inSecondCycle of [false,true]){
  const p=plan({loop:{enabled:true,maxPasses:3}}),h=rig(p),first=h.anchor+p.initialCountInFrames,stopAt=inSecondCycle?first+12000+128:h.anchor+128;
  while(h.frame<stopAt)h.block();h.command('cancel',{generation:2});const e=h.messages.findLast(m=>m.type==='canceled');assert.equal(e.passCount,inSecondCycle?2:1);assert.equal(e.observedPassCount,inSecondCycle?1:0);assert.equal(e.passFrames[inSecondCycle?1:0],-1);assert.equal(e.recordCount,inSecondCycle?2:0);
 }
});

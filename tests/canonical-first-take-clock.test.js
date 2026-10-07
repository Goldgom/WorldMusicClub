import test from 'node:test';
import assert from 'node:assert/strict';
import {canonicalPracticeApp} from './canonical-practice-fixtures.js';
import {readPlaybackClock} from '../web/playback-clock-view.js';

// Actual app/receiver/processor, independently advanced wall and render clocks.
// A render quantum is not an output-device or performance timestamp sample.
async function start(f){const {app}=f;await app.click('midi-button');app.$('count-in').checked=false;await app.click('start-complete-practice');await app.click('complete-practice-apply');await app.until(()=>app.$('canonical-audio-policy').dataset.rendererState==='playing');return (await app.exported('export-takes')).passes[0].clock_segments[0].wallStart;}

test('a complete render quantum cannot publish positive playing time before the frozen recorder anchor',async()=>{
 const f=await canonicalPracticeApp({audioSampleRate:44100}),{app}=f;
 try{
  const anchor=await start(f),eventWall=anchor-1.2;f.time(eventWall);for(const harness of app.audioHarnesses)harness.renderBlock(128);app.frame();
  const publicClock=readPlaybackClock(app.document);assert.equal(publicClock.phase,'preparing',JSON.stringify({anchor,eventWall,publicClock}));assert.equal(publicClock.running,false);assert.equal(publicClock.positionMs,0);
  f.time(anchor+225);app.midi([0x90,60,93],eventWall);app.midi([0x80,60,0],eventWall+.1);await app.tick();assert.equal((await app.exported('export-takes')).passes[0].inputs.length,0,'An original pre-anchor event remains ineligible even if delivered later');
  const onset=anchor+2.25;f.time(anchor+230);app.midi([0x90,60,94],onset);app.midi([0x80,60,0],onset+.1);await app.tick();app.frame();const take=await app.exported('export-takes');assert.equal(take.passes[0].inputs.length,1);assert.equal(take.passes[0].captures[0].event_wall_ms,onset);assert.equal(take.passes[0].inputs[0].at_ms,2.25);
 }finally{await app.close();}
});

test('output timestamp availability cannot change the admitted snapshot or original MIDI projection',async()=>{
 const f=await canonicalPracticeApp({audioSampleRate:8000}),{app}=f,latencyMs=12.5;
 AudioContext.prototype.getOutputTimestamp=function(){return {contextTime:(performance.now()-this.createdWall)/1000+(this.harness.wallAudioOffset||0)-latencyMs/1000,performanceTime:performance.now()};};
 try{
  const anchor=await start(f),expected=app.sourceStartWall();assert.ok(Math.abs(anchor-expected)<1e-8,JSON.stringify({anchor,expected}));
  f.time(anchor-1);app.frame();assert.equal(readPlaybackClock(app.document).phase,'preparing');
  const eventWall=anchor+2.25;f.time(eventWall);app.frame();const clock=readPlaybackClock(app.document);assert.equal(clock.phase,'playing');assert.ok(Math.abs(clock.transportPositionMs-2.25)<=1000/8000);
  f.time(anchor+225);app.midi([0x90,60,90],eventWall);app.midi([0x80,60,0],eventWall+.1);await app.tick();const take=await app.exported('export-takes');assert.equal(take.passes[0].inputs.length,1);assert.equal(take.passes[0].captures[0].event_wall_ms,eventWall);assert.equal(take.passes[0].inputs[0].at_ms,eventWall-anchor);
 }finally{delete AudioContext.prototype.getOutputTimestamp;await app.close();}
});

test('nonadvancing render frames cap display without inventing a hardware failure or new pass',async()=>{
 let wall=1000;const f=await canonicalPracticeApp({audioSampleRate:44100,now:()=>wall}),{app}=f;
 try{
  const anchor=await start(f);wall=anchor+20;f.time(wall);app.frame();const at=readPlaybackClock(app.document).transportPositionMs;
  for(const elapsed of [1000,2000,6000]){wall=anchor+elapsed;app.frame();const clock=readPlaybackClock(app.document);assert.equal(clock.running,true);assert.ok(Math.abs(clock.transportPositionMs-at)<=1000/44100);assert.equal((await app.exported('export-takes')).passes.length,1);}
  assert.doesNotMatch(app.$('notice-message').textContent,/interrupted the source clock/);
  // This checks display bounds only. Existing recorder grace and delayed-input
  // semantics are retained; no new stalled-input exclusion is claimed.
 }finally{await app.close();}
});

function outputClock(latencyMs){AudioContext.prototype.getOutputTimestamp=function(){return {contextTime:(performance.now()-this.createdWall)/1000+(this.harness.wallAudioOffset||0)-latencyMs/1000,performanceTime:performance.now()};};}
test('snapshot-clock pause and resume retain one correlation and apply latency once to the unchanged MIDI timestamp',async()=>{
 const f=await canonicalPracticeApp({audioSampleRate:8000}),{app}=f;outputClock(12.5);
 try{
  app.$('latency-offset').value='125';app.emit(app.$('latency-offset'),'change');const anchor=await start(f);f.time(anchor+100);app.frame();await app.click('play-button');await app.until(()=>!app.$('play-button').disabled);const paused=await app.exported('export-takes'),first=paused.passes[0].clock_segments[0],position=Number(app.$('progress').value);
  assert.ok(Math.abs(first.positionStart+first.wallEnd-first.wallStart-position)<1e-8);const origin=paused.passes[0].interpretation.playback_segments[0].audio_wall_clock;assert.equal(origin.basis,'render-snapshot');
  f.time(anchor+30000);await app.click('play-button');await app.until(()=>app.$('canonical-audio-policy').dataset.rendererState==='playing');const resumed=await app.exported('export-takes'),second=resumed.passes[0].clock_segments[1];assert.deepEqual(resumed.passes[0].interpretation.playback_segments[1].audio_wall_clock,origin);
  f.time(second.wallStart-1);app.frame();assert.equal(readPlaybackClock(app.document).phase,'preparing');assert.equal(Number(app.$('progress').value),position);
  const eventWall=second.wallStart+125+25;f.time(eventWall);app.frame();assert.equal(readPlaybackClock(app.document).phase,'playing');f.time(eventWall+225);app.midi([0x90,60,90],eventWall);app.midi([0x80,60,0],eventWall+.1);await app.tick();const take=await app.exported('export-takes');assert.equal(take.passes.length,1);assert.equal(take.passes[0].inputs.length,1);assert.equal(take.passes[0].captures[0].event_wall_ms,eventWall);assert.equal(take.passes[0].inputs[0].at_ms,second.positionStart+25);
 }finally{delete AudioContext.prototype.getOutputTimestamp;await app.close();}
});

test('snapshot-clock count-in and loop transitions never publish a take whose wall anchor is still in the future',async()=>{
 const f=await canonicalPracticeApp({audioSampleRate:8000}),{app}=f;outputClock(12.5);
 try{
  await start(f);await app.click('play-button');app.$('loop-to').value='1';await app.click('loop-apply');await app.until(()=>app.$('loop-enabled').checked&&!app.$('play-button').disabled);app.$('count-in').checked=true;await app.click('play-button');await app.until(()=>app.$('canonical-audio-policy').dataset.rendererState==='playing');const first=(await app.exported('export-takes')).passes[0],anchor=first.clock_segments[0].wallStart;assert.equal(first.clock_segments[0].positionStart,-2000);
  f.time(anchor+1000);app.frame();assert.ok(Math.abs(readPlaybackClock(app.document).transportPositionMs+1000)<=.125);
  const eventWall=anchor+2002.25;f.time(eventWall);app.frame();assert.ok(Math.abs(readPlaybackClock(app.document).transportPositionMs-2.25)<=.125);f.time(eventWall+225);app.midi([0x90,60,90],eventWall);app.midi([0x80,60,0],eventWall+.1);await app.tick();assert.equal((await app.exported('export-takes')).passes[0].inputs[0].at_ms,2.25);
  f.time(anchor+2499.9);app.frame();assert.equal((await app.exported('export-takes')).passes.length,1);f.time(anchor+2500.25);app.frame();const take=await app.exported('export-takes');assert.equal(take.passes.length,2);assert.ok(Math.abs(take.passes[1].clock_segments[0].wallStart-anchor-2500)<1e-8);assert.ok(Math.abs(readPlaybackClock(app.document).transportPositionMs+1999.75)<=.125);assert.ok(take.passes[1].clock_segments[0].wallStart<=performance.now());
 }finally{delete AudioContext.prototype.getOutputTimestamp;await app.close();}
});

test('future, stale, extreme or malformed output timestamps never alter the snapshot admission estimate',async()=>{
 const {CanonicalPracticeSession}=await import('../web/canonical-practice-session.js');const session=new CanonicalPracticeSession();let calls=0;
 for(const stamp of [null,{contextTime:0,performanceTime:0},{contextTime:NaN,performanceTime:1000},{contextTime:1.99,performanceTime:50000},{contextTime:1.99,performanceTime:1},{contextTime:.001,performanceTime:2000},{contextTime:2,performanceTime:2000}]){
  const context={state:'running',getOutputTimestamp(){calls++;return stamp;}};
  session.bindWallClock({context,wallTime:2000,audioTime:2,sampleRate:48000});assert.deepEqual(session.clockOrigin,{wallTime:2000,audioTime:2,sampleRate:48000,basis:'render-snapshot'});assert.equal(session.wallAtFrame(2.05*48000),2050);
 }
 assert.equal(calls,0);session.stop();assert.equal(session.clockOrigin,null);
});

// Receiver clock arithmetic with an explicit synthetic range context; these
// cases prove boundary ordering, not browser timing or physical device accuracy.
async function projectionFixture(){
 const [{CanonicalPracticeSession},{CanonicalAudioReceiver}]=await Promise.all([import('../web/canonical-practice-session.js'),import('../web/canonical-audio-receiver.js')]);
 const sampleRate=48000,origin={wallTime:2000,audioTime:2,sampleRate},receiver={context:{state:'running',currentTime:2},planGeneration:1,state:'running',initialAnchorFrame:98400,positionFrame:0,clockPauses:[],plan:{sampleRate,planFingerprint:'clock-arithmetic-fixture',rangeMode:true,rangeStartFrame:0,rangeEndFrame:24000,initialPositionFrame:0,initialCountInFrames:96000,countInFrames:96000,maxPasses:3}};
 const session=new CanonicalPracticeSession({playerFactory:()=>({context:receiver.context,stop(){},sourceClockAtTime:t=>CanonicalAudioReceiver.prototype.sourceClockAtTime.call(receiver,t)})});session.bindWallClock(origin);session.phase='running';return{session,receiver,origin};
}

test('48 receiver clock cases never cross a count-in or loop boundary before its recorded wall anchor',async()=>{
 const {session,receiver,origin}=await projectionFixture();let cases=0;
 for(const wall of [2048.8,2050,4050,4052.25,4549.99,4550,4550.25,7050])for(const skewMs of [-12,-3,0,2.2449,10,100]){
  receiver.context.currentTime=Math.max(0,origin.audioTime+(wall-origin.wallTime+skewMs)/1000);const clock=session.sourceClock(wall);
  assert.ok(clock.absoluteFrame<=Math.floor(receiver.context.currentTime*origin.sampleRate));assert.ok(session.wallAtFrame(clock.absoluteFrame)<=wall+1e-9);
  if(clock.passIndex>0)assert.ok(session.wallAtFrame(clock.cycleStartFrame)<=wall+1e-9);if(wall<2050)assert.equal(clock.phase,'scheduled');cases++;
 }
 assert.equal(cases,48);
});

test('batched rendering and a progressing slow clock do not invent stalls or pauses, even over an hour',async()=>{
 const {session,receiver,origin}=await projectionFixture();receiver.plan.maxPasses=10000;
 for(const [wall,audio]of [[2006,2],[2010,2+512/48000],[32000,31.9968],[3602000,2+3600*(1-106.7e-6)]]){
  receiver.context.currentTime=audio;const clock=session.sourceClock(wall);assert.equal(session.phase,'running');assert.equal(Boolean(clock.renderStalled),false);assert.equal(clock.paused,false);assert.ok(clock.absoluteFrame<=Math.floor(audio*origin.sampleRate));assert.ok(session.wallAtFrame(clock.absoluteFrame)<=wall+1e-9);
 }
 assert.deepEqual(session.clockOrigin,{...origin,basis:'render-snapshot'});
});

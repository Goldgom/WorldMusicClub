import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {notationAudioAdmission} from '../web/engraving-render-scheduler.js';
import {CanonicalAudioReceiver} from '../web/canonical-audio-receiver.js';
import {CanonicalAudioCore} from '../web/canonical-audio-core.js';
import {buildCanonicalAudioPlan,CANONICAL_AUDIO_POLICY} from '../web/canonical-audio-plan.js';
import {basicKeyAudioHarness} from './basic-key-audio-harness.js';
import {canonicalAudioErrorText} from '../web/canonical-practice-text.js';
import {cleanErrorText} from '../web/clean-song-text.js';
const tick=async()=>{for(let n=0;n<8;n++)await Promise.resolve();};

test('unresolved notation loading gives the same save-and-reopen recovery in canonical and complete-song playback',()=>{
  const error={code:'notation_audio_reload_required'};
  for(const render of [canonicalAudioErrorText,cleanErrorText]){
    const en=render('en',error),zh=render('zh-CN',error);
    assert.match(en,/Export any practice takes.*then reload the page or reopen the app/);
    assert.match(zh,/先导出需要保留的练习记录，再刷新页面或重新打开应用/);
    assert.match(en,/notation_audio_reload_required/);assert.match(zh,/notation_audio_reload_required/);
    assert.doesNotMatch(en,/retry|unlock|audio settings/i);
  }
});

test('pending audio takes priority over new notation and cancellation releases queued and admitted work',async()=>{
  const gate=notationAudioAdmission({}),old=gate.tryVisual(),stop=new AbortController();let painted=false;
  const audio=gate.acquireAudio(stop.signal),queued=gate.acquireVisual().then(lease=>{painted=true;return lease;});
  old.release();const owned=await audio;await tick();assert.equal(painted,false);assert.equal(gate.tryVisual(),null);
  stop.abort();const visual=await queued;assert.equal(painted,true);owned.release();visual.release();
  const busy=gate.tryVisual(),canceled=new AbortController(),pending=gate.acquireAudio(canceled.signal);canceled.abort();assert.equal(await pending,null);busy.release();
  const next=await gate.acquireAudio();next.release();
});

test('the finite queue rejects excess work and drops canceled visual successors',async()=>{
  const gate=notationAudioAdmission({}),audio=await gate.acquireAudio(),cancel=new AbortController(),waiters=[];
  for(let n=0;n<256;n++)waiters.push(gate.acquireVisual(cancel.signal));
  await assert.rejects(gate.acquireVisual(),{code:'clean_audio_unavailable'});cancel.abort();assert.ok((await Promise.all(waiters)).every(lease=>lease===null));audio.release();
  const fresh=gate.tryVisual();assert.ok(fresh);fresh.release();
});

test('outstanding visual ownership also stays bounded while retained native work settles',async()=>{
  const gate=notationAudioAdmission({}),leases=Array.from({length:256},()=>gate.tryVisual());
  assert.ok(leases.every(Boolean));assert.equal(gate.tryVisual(),null);
  assert.throws(()=>leases[0].retainUntil(Promise.resolve()),{code:'clean_audio_unavailable'});
  let admitted=false;const pending=gate.acquireAudio().then(lease=>{admitted=true;return lease;});
  for(const lease of leases.slice(1))lease.release();await tick();assert.equal(admitted,false);
  leases[0].release();const audio=await pending;audio.release();
});

test('expired native evaluation fails audio before anchor selection while retaining its late-load fence',async()=>{
  const gate=notationAudioAdmission({}),render=gate.tryVisual();let finish;const native=new Promise(resolve=>{finish=resolve;});
  const nativeLease=render.retainUntil(native);render.release();const request=gate.acquireAudio(),failure=Object.assign(new Error('original bundle deadline'),{code:'clean_audio_unavailable'});
  const rejected=assert.rejects(request,error=>error===failure);nativeLease.fail(failure);await rejected;
  await assert.rejects(gate.acquireAudio(),error=>error===failure);finish();await tick();const explicit=await gate.acquireAudio();explicit.release();
});

for(const coordinated of [false,true])test(`original canonical ACK during 192 ms notation work: coordination=${coordinated}`,async()=>{
  const h=basicKeyAudioHarness({autoMessages:false}),gate=notationAudioAdmission({});
  const fixture=JSON.parse(readFileSync(new URL('./fixtures/canonical-audio-evidence.json',import.meta.url)));
  const plan=buildCanonicalAudioPlan(fixture.compilation,fixture.profile,{mode:'listen',sampleRate:48000,acceptedPolicyId:CANONICAL_AUDIO_POLICY});
  const receiver=await CanonicalAudioReceiver.create(h.context,h.output,{nodeFactory:()=>h.nodeFactory({Core:CanonicalAudioCore})});
  try{
    const prepared=receiver.prepare(plan);h.deliverCore();h.finishPreparation();h.deliverMain();await prepared;
    const source=receiver.plan.planFingerprint,originalClock=h.context.currentTime;
    let audioLease=null;
    if(coordinated){
      const oldPreparation=gate.tryVisual(),admission=gate.acquireAudio();
      for(let n=0;n<72;n++)h.renderBlock();assert.equal(h.toCore.length,0,'No start command or anchor exists while notation preparation runs');oldPreparation.release();audioLease=await admission;
    }
    const before=h.context.currentTime,starting=receiver.start({anchorTime:before+.05});
    const rejection=coordinated?null:assert.rejects(starting,{code:'clean_late_start'});
    h.deliverCore();const acknowledgement=h.toMain.find(([,message])=>message.type==='started')[1];
    assert.ok(acknowledgement.frame<acknowledgement.anchorFrame);assert.equal(acknowledgement.anchorFrame-Math.round(before*48000),2400);
    let rendered=false;
    const redraw=async()=>{for(let n=0;n<72;n++)h.renderBlock();rendered=true;};
    const drawing=coordinated?gate.prepareVisual(redraw):redraw();await tick();
    if(coordinated)assert.equal(rendered,false);else assert.equal(rendered,true);
    h.deliverMain();
    if(coordinated){const started=await starting;assert.equal(receiver.state,'running');assert.equal(started.planFingerprint,source);assert.ok(h.context.currentTime*48000<started.anchorFrame);assert.equal(Math.round((before-originalClock)*48000),9216);audioLease.release();await drawing;assert.equal(rendered,true);}
    else{await rejection;assert.equal(receiver.state,'error');assert.equal(h.nodes[0].connected,false);}
  }finally{receiver.dispose();h.deliverCore();h.deliverMain();}
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {canonicalPracticeApp} from './canonical-practice-fixtures.js';
import {CanonicalPlayer} from '../web/canonical-player.js';
import {readPlaybackClock} from '../web/playback-clock-view.js';
import {notationAudioAdmission} from '../web/engraving-render-scheduler.js';

function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};}
async function completedPractice(){
  const f=await canonicalPracticeApp(),{app,score}=f;app.$('count-in').checked=false;
  await app.click('start-complete-practice');for(const box of app.$('complete-practice-parts').querySelectorAll('input'))box.checked=box.value===score.parts[0].id;
  await app.click('complete-practice-apply');await app.until(()=>app.$('canonical-audio-policy').dataset.rendererState==='playing');
  const first=f.receiver(),zero=app.sourceStartWall();f.time(zero+60);await app.tick();app.frame();
  const key=app.document.querySelector('#keyboard [data-midi="60"]');app.emit(key,'pointerdown',{pointerId:7,button:0});await app.tick();app.emit(key,'pointerup',{pointerId:7,button:0});
  f.time(zero+4300);await app.tick();app.frame();await app.until(()=>readPlaybackClock(app.document).completed&&!app.$('play-button').disabled);
  const take=await app.exported('export-takes');assert.equal(take.passes.length,1);assert.equal(take.passes[0].inputs.length,1);assert.equal(take.passes[0].pending,false);
  return {...f,first,zero,take};
}

/** The real source plan is ready but its caller has not received the result.
 * This leaves production cancellation/epoch fencing active during the gap. */
function holdPrepared(){
  const original=CanonicalPlayer.prototype.prepare,gate=deferred();let entered=false;
  CanonicalPlayer.prototype.prepare=async function(...args){const result=await original.apply(this,args);entered=true;await gate.promise;return result;};
  return {...gate,entered:()=>entered,restore(){CanonicalPlayer.prototype.prepare=original;}};
}

for(const action of ['admit','pause','navigate'])test(`canonical Replay awaiting notation ${action} preserves original take and chooses its anchor only after ownership`,async()=>{
  const f=await completedPractice(),{app,take}=f,lease=notationAudioAdmission(app.window).tryVisual();
  try{
    app.$('play-button').click();await app.until(()=>f.receiver()?.core.state==='ready');
    f.time(f.zero+4800);app.frame();assert.equal(readPlaybackClock(app.document).running,false);assert.equal(f.receiver().core.anchorFrame,null);
    assert.deepEqual(await app.exported('export-takes'),take);
    if(action==='pause')app.$('play-button').click();
    if(action==='navigate')app.$('back-to-library').click();
    lease.release();await app.tick();
    if(action==='admit'){
      await app.until(()=>app.$('canonical-audio-policy').dataset.rendererState==='playing');
      const resumed=await app.exported('export-takes');assert.equal(resumed.passes.length,2);assert.deepEqual(resumed.passes[0],take.passes[0]);assert.equal(Math.round(resumed.passes[1].clock_segments[0].wallStart*48),Math.round(app.sourceStartWall()*48));
    }else{assert.equal(readPlaybackClock(app.document).running,false);assert.equal(f.receiver(),undefined);assert.deepEqual(await app.exported('export-takes'),take);const next=await notationAudioAdmission(app.window).acquireAudio();next.release();}
  }finally{lease.release();await app.close();}
});

for(const boundary of ['unlock','prepared'])test(`canonical Replay crosses a real frame during delayed ${boundary} without old-pass completion`,async()=>{
  const f=await completedPractice(),{app,take,first}=f,gate=boundary==='prepared'?holdPrepared():deferred();
  try{
    if(boundary==='unlock')app.setUnlock(()=>gate.promise);
    app.$('play-button').click();if(boundary==='prepared')await app.until(gate.entered);
    for(let frame=0;frame<3;frame++){
      f.time(f.zero+4501+frame*151);
      assert.doesNotThrow(()=>app.frame(),'An old closed take cannot finish the reset transport while Replay is preparing');
      const clock=readPlaybackClock(app.document);assert.equal(clock.phase,'preparing');assert.equal(clock.completed,false);assert.equal(clock.positionMs,0);
    }
    assert.deepEqual(await app.exported('export-takes'),take,'Admission creates no take and preserves every previous export field');
    gate.resolve();await app.until(()=>app.$('canonical-audio-policy').dataset.rendererState==='playing');app.frame();
    const second=f.receiver(),zero=app.sourceStartWall(),clock=readPlaybackClock(app.document);assert.notEqual(second,first);assert.equal(clock.running,true);assert.equal(clock.completed,false);assert.equal(clock.phase,'playing');
    const replay=await app.exported('export-takes');assert.equal(replay.passes.length,2);assert.deepEqual(replay.passes[0],take.passes[0]);assert.deepEqual(replay.passes[1].inputs,[]);assert.equal(replay.passes[1].clock_segments[0].positionStart,0);assert.ok(replay.passes[1].clock_segments[0].wallStart>take.passes[0].clock_segments.at(-1).wallEnd);
    f.time(zero+400);await app.tick();assert.doesNotThrow(()=>app.frame());assert.ok(readPlaybackClock(app.document).positionMs>0);assert.equal(readPlaybackClock(app.document).completed,false);
    f.time(zero+4300);await app.tick();app.frame();await app.until(()=>readPlaybackClock(app.document).completed&&!app.$('play-button').disabled);const ended=await app.exported('export-takes');assert.deepEqual(ended.passes[0],take.passes[0]);assert.equal(ended.passes.length,2);assert.equal(second.core.startedCount,6);assert.equal(second.core.endedCount,6);
  }finally{app.setUnlock(null);gate.resolve();gate.restore?.();await app.close();}
});

for(const outcome of ['cancel','failure'])test(`canonical Replay ${outcome} after delayed preparation preserves old take and admits no new pass`,async()=>{
  const f=await completedPractice(),{app,take}=f,gate=holdPrepared();
  try{
    app.$('play-button').click();await app.until(gate.entered);f.time(f.zero+4501);assert.doesNotThrow(()=>app.frame());
    if(outcome==='cancel'){app.$('play-button').click();gate.resolve();}else gate.reject(new Error('Original controlled preparation failure'));
    await app.until(()=>!app.$('play-button').disabled);await app.tick();
    for(let frame=0;frame<3;frame++){f.time(f.zero+4702+frame*151);assert.doesNotThrow(()=>app.frame());}
    const clock=readPlaybackClock(app.document);assert.equal(clock.running,false);assert.equal(clock.completed,false);assert.equal(clock.positionMs,0);assert.equal(clock.phase,'ready');assert.equal(f.receiver(),undefined);
    assert.deepEqual(await app.exported('export-takes'),take,'An unadmitted Replay must not erase, reopen or append any recording evidence');
    gate.restore();await app.click('play-button');await app.until(()=>app.$('canonical-audio-policy').dataset.rendererState==='playing');app.frame();assert.equal(readPlaybackClock(app.document).running,true);assert.equal(readPlaybackClock(app.document).completed,false);const retry=await app.exported('export-takes');assert.equal(retry.passes.length,2);assert.deepEqual(retry.passes[0],take.passes[0]);
  }finally{gate.resolve();gate.restore();await app.close();}
});

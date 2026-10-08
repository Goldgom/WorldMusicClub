import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFileSync,readFileSync} from 'node:fs';
import {canonicalPracticeApp} from './canonical-practice-fixtures.js';
import {readPlaybackClock} from '../web/playback-clock-view.js';
const baseline=process.env.ACTIVITY_BASELINE==='1';
test('independent production activity: count-in, rollover, pause, seek and human evidence retain baseline semantics',async()=>{
 const f=await canonicalPracticeApp({audioSampleRate:8000}),{app,score}=f,trace=[];
 const strip=()=>app.document.querySelector('.part-activity-strip');
 async function sample(label,playing){
  app.frame();if(process.env.ACTIVITY_HIDE==='1'&&strip())strip().style.display='none';await app.tick();
  const take=await app.exported('export-takes'),clock=readPlaybackClock(app.document);trace.push({label,clock,target:take.target_plan,passes:take.passes});
  if(!baseline&&playing!==undefined){assert.ok(strip(),'production strip mounted');const expected=playing==='source'?clock.transportPositionMs>=0&&clock.transportPositionMs<500:playing;assert.equal(!strip().hidden&&Boolean(strip().querySelector('[data-state="playing"]')),expected,JSON.stringify({label,clock,strip:strip().outerHTML}));}
  return take;
 }
 try{
  await app.click('midi-button');app.$('count-in').checked=false;await app.click('start-complete-practice');for(const box of app.$('complete-practice-parts').querySelectorAll('input'))box.checked=box.value===score.parts[0].id;await app.click('complete-practice-apply');await app.until(()=>app.$('canonical-audio-policy').dataset.rendererState==='playing');
  f.time(app.sourceStartWall()+30);await sample('initial',true);await app.click('play-button');await app.until(()=>!app.$('play-button').disabled);await sample('pause-ack',false);
  app.$('loop-to').value='1';await app.click('loop-apply');await app.until(()=>app.$('loop-enabled').checked&&!app.$('play-button').disabled);app.$('count-in').checked=true;await app.click('play-button');await app.until(()=>app.$('canonical-audio-policy').dataset.rendererState==='playing');
  const anchor=(await app.exported('export-takes')).passes[0].clock_segments[0].wallStart;
  for(const [delta,playing]of [[0,false],[1999.875,false],[2000,'source'],[2000.125,true],[2499.875,true],[2500,'source'],[2500.125,false],[4500,'source'],[4500.125,true]]){f.time(anchor+delta);if(delta===2000.125){app.midi([0x90,60,93],anchor+delta);app.midi([0x80,60,0],anchor+delta+.0625);await app.tick();}await sample(`loop-${delta}`,playing);}
  const take=await app.exported('export-takes');assert.equal(take.passes.length,2);assert.ok(Math.abs(take.passes[1].clock_segments[0].wallStart-anchor-2500)<1e-8);assert.equal(take.passes[0].inputs.length,1);assert.equal(take.passes[0].inputs[0].at_ms,.125);assert.equal(take.passes[1].inputs.length,0);
  await app.click('play-button');await app.until(()=>!app.$('play-button').disabled);await sample('second-pause',false);assert.equal(app.$('progress').disabled,true);
  for(const value of [375,125]){app.$('progress').value=String(value);app.emit(app.$('progress'),'input');await app.tick();await sample(`seek-${value}`,false);}
  await app.click('play-button');await app.until(()=>app.$('canonical-audio-policy').dataset.rendererState==='playing');await sample('resume-future-anchor',false);
  const final=await app.exported('export-takes');assert.deepEqual(final.target_plan,take.target_plan);assert.deepEqual(final.passes.map(p=>p.inputs),take.passes.map(p=>p.inputs));
  app.$('session-mode').value='listen';app.emit(app.$('session-mode'),'change');await app.tick();for(const value of [375,125]){app.$('progress').value=String(value);app.emit(app.$('progress'),'input');await sample(`listen-seek-${value}`,false);assert.equal(readPlaybackClock(app.document).positionMs,value);}
  assert.equal(trace.length,17);if(process.env.ACTIVITY_TRACE)writeFileSync(process.env.ACTIVITY_TRACE,JSON.stringify(trace,null,2));if(process.env.ACTIVITY_EXPECT_TRACE)assert.deepEqual(trace,JSON.parse(readFileSync(process.env.ACTIVITY_EXPECT_TRACE,'utf8')));
 }finally{await app.close();}
});

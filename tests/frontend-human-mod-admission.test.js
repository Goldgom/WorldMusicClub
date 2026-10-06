import test from 'node:test';
import assert from 'node:assert/strict';
import {nativeScoreServer,nativeStorageApp,nativeResponse,deferred} from './native-storage-app-fixtures.js';
import {humanModTimbreFixture} from '../scripts/prepare-human-mod-timbre-fixtures.mjs';
import {humanModFixtureCompilation} from '../scripts/human-mod-timbre-sample-proof.mjs';
import {CanonicalPlayer} from '../web/canonical-player.js';
import {readPlaybackClock} from '../web/playback-clock-view.js';
import {admitHumanModPlayback,readHumanModExport} from './human-mod-timbre-browser-regression.js';

// Real app/transport/DSP in the existing in-memory DOM fixture. This opens no
// browser/server and does not claim native input or hosted audio acceptance.
async function fixture(){
 const score=humanModTimbreFixture().score,compiled=humanModFixtureCompilation(),server=await nativeScoreServer({scores:[score]});
 server.setRoute(({path,body})=>path==='/api/compile'&&body.id===score.id?nativeResponse(compiled):undefined);
 let wall=1000;const app=await nativeStorageApp(server,{now:()=>wall}),saved=[...server.records.keys()][0];
 await app.until(()=>Boolean(app.savedButton(saved)));await app.click('home-single-player');app.savedButton(saved).click();await app.until(()=>!app.$('configure-song-mod').disabled);await app.click('configure-song-mod');await app.click('song-mod-all-human');app.$('song-mod-unify-sound').value='guitar';app.emit(app.$('song-mod-unify-sound'),'change');await app.click('song-mod-unify-human');await app.click('song-mod-apply');await app.until(()=>!app.$('song-mod-dialog').open);app.$('count-in').checked=false;app.$('metronome-enabled').checked=false;
 const previous=Object.getOwnPropertyDescriptor(globalThis,'__wmhReadPlaybackClock');Object.defineProperty(globalThis,'__wmhReadPlaybackClock',{configurable:true,value:()=>readPlaybackClock(app.document)});
 return{app,score,time(ms){wall=ms;app.renderAudioTo((ms-1000)/1000);app.frame();},async close(){if(previous)Object.defineProperty(globalThis,'__wmhReadPlaybackClock',previous);else delete globalThis.__wmhReadPlaybackClock;await app.close();}};
}
function delayedPreparation(){
 const prepare=CanonicalPlayer.prototype.prepare,start=CanonicalPlayer.prototype.startPrepared,gate=deferred();let ready=false,prepares=0,starts=0;
 CanonicalPlayer.prototype.prepare=async function(...args){prepares++;const result=await prepare.apply(this,args);ready=true;await gate.promise;return result;};
 CanonicalPlayer.prototype.startPrepared=function(...args){starts++;return start.apply(this,args);};
 return{resolve:gate.resolve,ready:()=>ready,prepares:()=>prepares,starts:()=>starts,restore(){CanonicalPlayer.prototype.prepare=prepare;CanonicalPlayer.prototype.startPrepared=start;}};
}
function pageAdapter(app){
 const clicks=[];let stopWaiting=null,waiting=false;
 const page={locator(selector){const id=/^#([^:\s]+)/.exec(selector)?.[1];assert.ok(id);return{async click(){await app.until(()=>!app.$(id).disabled);clicks.push(id);await app.click(id);},async waitFor(){await app.until(()=>id!=='workspace'||app.document.body.dataset.screen==='stage');}};},async waitForFunction(predicate,arg){waiting=true;await app.until(()=>{if(stopWaiting)throw stopWaiting;return predicate(arg);},'Owned source clock did not advance');return{dispose(){}};},async evaluate(callback,arg){return callback(arg);}};
 return{page,clicks,waiting:()=>waiting,cancelWait(){stopWaiting=Error('Original canceled admission observation');}};
}

test('the old public-clock probe reproduces cancellation of an already pending Start',async()=>{
 const f=await fixture(),{app}=f,held=delayedPreparation();
 try{
  await app.click('start-performance');await app.until(held.ready);app.frame();assert.equal(readPlaybackClock(app.document).running,false);assert.equal(readPlaybackClock(app.document).phase,'preparing');assert.equal(app.$('play-button').disabled,false);assert.equal(held.starts(),0);
  // This is the former sample() branch: a second toggle cancels pending Play.
  if(!readPlaybackClock(app.document).running)await app.click('play-button');held.resolve();await app.tick();f.time(1250);await app.tick();
  assert.equal(held.prepares(),1);assert.equal(held.starts(),0);assert.equal(app.sourceStartWall(),null);assert.equal(readPlaybackClock(app.document).phase,'ready');assert.equal((await app.exported('export-takes')).passes.length,0);assert.equal(app.$('notice-message').textContent,'');
 }finally{held.resolve();held.restore();await f.close();}
});

for(const control of ['start-performance','play-button'])test(`owned ${control} waits for delayed real preparation and starts exactly once`,async()=>{
 const f=await fixture(),{app}=f;
 try{
  if(control==='play-button'){await app.click('start-performance');await app.until(()=>app.$('canonical-audio-policy').dataset.rendererState==='playing');await app.click('reset-button');}
  const held=delayedPreparation(),driver=pageAdapter(app);let settled=false;
  try{
   const admitted=admitHumanModPlayback(driver.page,control).then(()=>{settled=true;});await app.until(held.ready);app.frame();await app.tick();assert.equal(settled,false);assert.equal(readPlaybackClock(app.document).running,false);assert.deepEqual(driver.clicks,[control]);assert.equal(held.prepares(),1);assert.equal(held.starts(),0);assert.equal((await app.exported('export-takes')).passes.length,0);
   held.resolve();await app.until(()=>app.$('canonical-audio-policy').dataset.rendererState==='playing');f.time(app.sourceStartWall()+100);await admitted;
   assert.equal(held.starts(),1);assert.deepEqual(driver.clicks,[control]);assert.equal(readPlaybackClock(app.document).running,true);assert.ok(readPlaybackClock(app.document).positionMs>0);assert.equal((await app.exported('export-takes')).passes.length,1);assert.deepEqual(await app.exported('export-button'),f.score);
  }finally{held.resolve();held.restore();}
 }finally{await f.close();}
});

test('navigation cancels the owned Start without any replacement toggle or late source anchor',async()=>{
 const f=await fixture(),{app}=f,held=delayedPreparation(),driver=pageAdapter(app);
 try{
  const rejected=assert.rejects(admitHumanModPlayback(driver.page,'start-performance'),error=>/admission did not reach advancing playback/.test(error.message)&&error.cause.message==='Original canceled admission observation');
  await app.until(held.ready);await app.until(driver.waiting);await app.click('back-to-library');held.resolve();await app.tick();f.time(1250);driver.cancelWait();await rejected;
  assert.deepEqual(driver.clicks,['start-performance']);assert.equal(held.starts(),0);assert.equal(app.sourceStartWall(),null);assert.equal(readPlaybackClock(app.document).running,false);assert.equal((await app.exported('export-takes')).passes.length,0);assert.equal(app.document.body.dataset.screen,'library');
 }finally{held.resolve();held.restore();await f.close();}
});


function exportPanelPage(app){
 const closed=[];
 return{closed,page:{locator(selector){
  const dialog=app.document.querySelector(selector);assert.ok(['results-dialog','score-tools-dialog'].includes(dialog?.id));
  return{isVisible:async()=>dialog.open,locator(child){assert.equal(child,'[data-close-panel]');return{async click(){assert.equal(dialog.open,true,'Close must belong to the visible export panel');closed.push(dialog.id);dialog.querySelector(child).click();await app.tick();}};},async waitFor({state}){assert.equal(state,'hidden');await app.until(()=>!dialog.open);}};
 }}};
}
async function panelExport(app,id){
 const panel=id==='export-button'?'score-tools':'results';
 assert.equal(app.document.querySelector('dialog[open]'),null,'A real export opener must not be covered');
 await app.click(`${panel}-button`);assert.equal(app.$(`${panel}-dialog`).open,true);
 return app.exported(id);
}
async function pausedHumanTake(f){
 const {app}=f;await app.click('start-performance');await app.until(()=>app.$('canonical-audio-policy').dataset.rendererState==='playing');f.time(app.sourceStartWall()+100);
 const key=app.document.querySelector('#keyboard [data-midi="60"]');app.emit(key,'pointerdown',{pointerId:55,button:0});await app.tick();f.time(app.sourceStartWall()+140);app.emit(key,'pointerup',{pointerId:55,button:0});await app.click('play-button');f.time(1400);await app.tick();
 return app.exported('export-takes');
}

test('human source and take exports close their visible panels before repeated Mod Cancel/Apply/navigation',async()=>{
 const f=await fixture(),{app}=f,driver=exportPanelPage(app);
 try{
  const before=await pausedHumanTake(f),clock=readPlaybackClock(app.document);
  for(let repeat=0;repeat<2;repeat++){
   const take=await readHumanModExport(driver.page,()=>panelExport(app,'export-takes'));assert.deepEqual(take,before);
   assert.deepEqual(await readHumanModExport(driver.page,()=>panelExport(app,'export-button')),f.score);
   assert.equal(app.document.querySelector('dialog[open]'),null);assert.deepEqual(readPlaybackClock(app.document),clock);
   await app.click('edit-song-mod');assert.equal(app.$('song-mod-dialog').open,true);
   if(!repeat){app.$('song-mod-unify-sound').value='piano';app.emit(app.$('song-mod-unify-sound'),'change');await app.click('song-mod-unify-human');await app.click('song-mod-cancel');}
   else{await app.click('song-mod-apply');await app.until(()=>!app.$('song-mod-dialog').open);}
   assert.deepEqual(await readHumanModExport(driver.page,()=>panelExport(app,'export-takes')),before);
  }
  assert.deepEqual(driver.closed,['results-dialog','score-tools-dialog','results-dialog','results-dialog','score-tools-dialog','results-dialog']);
  await app.click('back-to-library');assert.equal(app.document.body.dataset.screen,'library');assert.equal(app.document.querySelector('dialog[open]'),null);assert.equal(readPlaybackClock(app.document).running,false);
  assert.equal(app.document.querySelectorAll('#keyboard .pressed').length,0);assert.equal(app.plays.filter(call=>String(call[0]).startsWith('manual:')).length,1);
  assert.deepEqual(await app.exported('export-button'),f.score);assert.deepEqual((await app.exported('export-takes')).passes,before.passes);
 }finally{await f.close();}
});

for(const panel of ['results','score-tools'])test(`failed ${panel} export closes its actual panel while retaining the paused take`,async()=>{
 const f=await fixture(),{app}=f,driver=exportPanelPage(app),failure=Error('Original export read failure');
 try{
  const before=await pausedHumanTake(f),clock=readPlaybackClock(app.document);
  await assert.rejects(readHumanModExport(driver.page,async()=>{await app.click(`${panel}-button`);assert.equal(app.$(`${panel}-dialog`).open,true);throw failure;}),error=>error===failure);
  assert.deepEqual(driver.closed,[`${panel}-dialog`]);assert.equal(app.document.querySelector('dialog[open]'),null);assert.deepEqual(readPlaybackClock(app.document),clock);
  assert.deepEqual(await app.exported('export-takes'),before);await app.click('edit-song-mod');assert.equal(app.$('song-mod-dialog').open,true);await app.click('song-mod-cancel');
 }finally{await f.close();}
});

test('export panel pause drains a held human voice and Close cannot resume or recapture it',async()=>{
 const f=await fixture(),{app}=f,driver=exportPanelPage(app);
 try{
  await app.click('start-performance');await app.until(()=>app.$('canonical-audio-policy').dataset.rendererState==='playing');f.time(app.sourceStartWall()+100);
  const key=app.document.querySelector('#keyboard [data-midi="60"]');app.emit(key,'pointerdown',{pointerId:56,button:0});await app.tick();f.time(app.sourceStartWall()+140);
  const live=app.audioNodes.find(node=>node.kind==='live-audio-worklet').core;assert.equal(live.activeNotes,1);assert.equal(key.classList.contains('pressed'),true);
  assert.deepEqual(await readHumanModExport(driver.page,()=>panelExport(app,'export-button')),f.score);f.time(1500);await app.tick();
  assert.equal(readPlaybackClock(app.document).running,false);assert.equal(app.document.querySelector('dialog[open]'),null);assert.equal(live.activeNotes,0);assert.equal(key.classList.contains('pressed'),false);
  const take=await readHumanModExport(driver.page,()=>panelExport(app,'export-takes'));assert.equal(take.passes[0].inputs.length,1);const count=app.plays.filter(call=>String(call[0]).startsWith('manual:')).length;assert.equal(count,1);
  app.emit(key,'pointerup',{pointerId:56,button:0});await app.tick();assert.equal(live.activeNotes,0);assert.equal(app.plays.filter(call=>String(call[0]).startsWith('manual:')).length,count);assert.deepEqual((await app.exported('export-takes')).passes,take.passes);
 }finally{await f.close();}
});

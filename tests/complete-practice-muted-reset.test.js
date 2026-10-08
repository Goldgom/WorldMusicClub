// Production app + modeled DOM/audio regression; not native/browser acceptance.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {vsqAcceptanceFixture} from '../scripts/prepare-vsq-song-fixtures.mjs';
import {nativeScoreServer,nativeStorageApp,nativeResponse} from './native-storage-app-fixtures.js';
import {readPlaybackClock} from '../web/playback-clock-view.js';

test('VSQ mute-only Mod retains paused human admission; explicit Reset starts fresh muted audio at source zero',async()=>{
 const f=vsqAcceptanceFixture(),server=await nativeScoreServer(),score=f.runtime.compilation.score;let wall=1000;
 server.records.set(f.key,{...f.opened,entry:{key:f.key,revision:1,title:score.title,composer:score.composer,score_id:score.id,label:score.title,score_bytes:Buffer.byteLength(f.opened.score_json),saved_at_unix_ms:1700000000000,clean_package:f.summary}});
 server.setRoute(({path})=>path==='/api/library/runtime'?nativeResponse(f.runtime):undefined);
 const app=await nativeStorageApp(server,{now:()=>wall}),set=(kind,id,value)=>{const node=app.$('song-mod-parts').querySelector(`[data-mod-${kind}="${id}"]`);if(typeof value==='boolean')node.checked=value;else node.value=value;app.emit(node,'change');};
 const runner=await readFile(new URL('../crates/desktop-shell/complete-practice-acceptance.js',import.meta.url),'utf8'),shared=await readFile(new URL('../crates/desktop-shell/vsq-song-acceptance.js',import.meta.url),'utf8'),context=vm.createContext({structuredClone});
 vm.runInContext(shared.slice(shared.indexOf('function createVsqJsonObserver('),shared.indexOf('/* Actual rendered identities'))+runner.slice(runner.indexOf('function observeCompletePracticeRequests('),runner.indexOf('(() => {'))+';globalThis.helpers={observeCompletePracticeRequests,captureSettledCompletePracticeMod};',context);
 const report={requests:[],responses:[],errors:[]};let observer;
 const advance=ms=>{wall=ms;app.renderAudioTo((ms-1000)/1000);app.frame();},source=()=>app.audioNodes.findLast(node=>node.kind==='audio-worklet'&&node.core?.plan&&node.connected);
 try{
  await app.until(()=>app.savedButton(f.key));await app.click('home-single-player');app.savedButton(f.key).click();await app.until(()=>app.$('song-lobby').dataset.previewStatus==='choice');await app.click('vsq-choose-base-notes');await app.until(()=>!app.$('configure-song-mod').disabled);
  observer=context.helpers.observeCompletePracticeRequests({root:globalThis,report});await app.click('configure-song-mod');set('performer','vsq-track-1','machine');set('performer','vsq-track-2','human');app.$('song-mod-layout').value='complete';app.emit(app.$('song-mod-layout'),'change');await app.click('song-mod-apply');await app.until(()=>!app.$('song-mod-dialog').open&&!app.$('start-performance').disabled);
  app.$('count-in').checked=false;await app.click('start-performance');await app.until(()=>app.$('clean-song-stage').dataset.rendererState==='playing');advance(3300);await app.click('play-button');app.frame();
  if(app.$('notation-toggle').getAttribute('aria-expanded')!=='true')await app.click('notation-toggle');await app.click('jianpu-button');await app.until(()=>app.$('workspace').dataset.notationRenderStatus==='ready');
  const paused=readPlaybackClock(app.document),before=await app.exported('export-takes'),oldSource=source(),admissions=app.requests.filter(row=>['/api/practice-targets','/api/instrument-check'].includes(row.path));assert.ok(paused.positionMs>=1800&&paused.positionMs<3500);assert.equal(paused.running,false);
  const mutedRequestStart=report.requests.length;await app.click('edit-song-mod');set('mute','vsq-track-1',true);await app.click('song-mod-apply');await app.until(()=>!app.$('song-mod-dialog').open);app.frame();
  assert.equal(readPlaybackClock(app.document).positionMs,paused.positionMs,'Mute-only Mod cannot satisfy a source-zero wait');assert.deepEqual((await app.exported('export-takes')).target_plan,before.target_plan);assert.deepEqual(app.requests.filter(row=>['/api/practice-targets','/api/instrument-check'].includes(row.path)),admissions,'Mute retains the admitted human selection');assert.equal(app.$('play-button').disabled,false);
  await app.click('reset-button');app.frame();const reset=readPlaybackClock(app.document);assert.equal(reset.positionMs,0);assert.equal(reset.transportPositionMs,0);assert.equal(reset.running,false);assert.equal(reset.completed,false);assert.equal(app.$('play-button').disabled,false);assert.deepEqual((await app.exported('export-takes')).target_plan,before.target_plan);
  let settled=false;await context.helpers.captureSettledCompletePracticeMod({document:app.document,until:app.until,report,requestStart:0,humanParts:['vsq-track-2'],blocked:false,name:'vsq-muted',sample:()=>{settled=true;}});assert.equal(settled,true);assert.ok(report.modReadiness['vsq-muted'].checkRequestIndex<mutedRequestStart,'The native readiness helper accepts the retained exact human admission');
  const resetAction=runner.indexOf("report.vsqMutedResetAction=await native('click',$('reset-button'))"),zeroWait=runner.indexOf("'reset muted VSQ human targets'");assert.ok(resetAction>=0&&zeroWait>resetAction);
  await app.click('play-button');await app.until(()=>app.$('clean-song-stage').dataset.rendererState==='playing');const fresh=source();assert.notEqual(fresh,oldSource);assert.equal(fresh.core.positionFrame,0);assert.equal(fresh.core.plan.count,0,'The only machine track is genuinely muted');advance(3400);assert.ok(readPlaybackClock(app.document).positionMs>0);assert.ok(app.document.querySelector('.part-activity-strip [data-state="muted"]'));assert.deepEqual((await app.exported('export-takes')).target_plan,before.target_plan);assert.deepEqual(before.target_plan.timeline.notes.map(note=>note.id),['vsq-t2-ID#0001']);
 }finally{observer?.restore();await app.close();}
});

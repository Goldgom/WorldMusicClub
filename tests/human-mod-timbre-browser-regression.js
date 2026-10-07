import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {liveToneNavigationBootstrap} from './live-tone-navigation-browser-regression.js';
import {installCanonicalPreviewAudio} from './browser-canonical-preview-audio.js';
import {waitForPlaybackClock,waitForPlaybackClockAdvance} from './browser-playback-clock.js';
import {selectLegacyEnglish} from './browser-input-fixtures.js';
import {openSongMod} from '../scripts/hosted-song-mod-controls.mjs';
import {humanModTimbreFixture,HUMAN_MOD_TIMBRE_FIXTURE,HUMAN_MOD_TIMBRE_PARTS} from '../scripts/prepare-human-mod-timbre-fixtures.mjs';
import {validateHumanModFixtureSample} from '../scripts/human-mod-timbre-sample-proof.mjs';
import {validateHostedHumanModTimbre} from '../scripts/verify-human-mod-timbre-hosted.mjs';
import {validateLiveToneCleanup} from '../scripts/live-tone-proof.mjs';

const reference=readFileSync(new URL('../crates/desktop-shell/reference-acceptance.js',import.meta.url),'utf8');
const traceStart=reference.indexOf('function observeNativeReferenceTransport('),traceEnd=reference.indexOf('async function prepareNativeReferenceScoredTake(');
assert.ok(traceStart>=0&&traceEnd>traceStart);
export const humanModTimbreBootstrap=`${liveToneNavigationBootstrap}\n${reference.slice(traceStart,traceEnd)}\nglobalThis.__wmhHumanModTransport=observeNativeReferenceTransport;`;
export const HUMAN_MOD_TIMBRE_BROWSER_CASE='real human Mod timbres preserve shared ownership, PCM, legacy storage and interrupted controls';

/** One explicit acceptance action owns admission. An early public clock can
 * still be ready/preparing after Start, so it must never trigger another toggle. */
export async function admitHumanModPlayback(page,control){
 assert.ok(['start-performance','play-button'].includes(control));
 try{
  await page.locator(`#${control}:not([disabled])`).click();
  await page.locator('#workspace').waitFor({state:'visible'});
  await waitForPlaybackClockAdvance(page);
 }catch(error){
  const observed=await page.evaluate(()=>{const source=globalThis.__wmhPreviewAudio?.status();return{screen:document.body.dataset.screen,clock:globalThis.__wmhReadPlaybackClock(),rendererState:document.querySelector('#canonical-audio-policy')?.dataset.rendererState,notice:document.querySelector('#notice-message')?.textContent,source:source?{activeReceivers:source.activeReceivers,pendingReceivers:source.pendingReceivers,started:source.started,errors:source.errors,overflow:source.overflow}:null};}).catch(()=>null);
  throw new Error(`Human Mod ${control} admission did not reach advancing playback: ${JSON.stringify(observed)}`,{cause:error});
 }
}

// The shared download helpers expose different panels. This case owns their
// complete lifecycle so its next stage/Mod action never targets a covered UI.
export async function readHumanModExport(page,readExport){
 try{return await readExport();}
 finally{
  for(const id of ['results-dialog','score-tools-dialog']){
   const dialog=page.locator(`#${id}`);
   if(await dialog.isVisible()){
    await dialog.locator('[data-close-panel]').click();
    await dialog.waitFor({state:'hidden'});
   }
  }
 }
}

export function registerHumanModTimbreBrowserRegression({test,getPage,ui,readyForTitle,closeShellPanels,exportTakeData,exportScore,artifactDirectory}){
 test(HUMAN_MOD_TIMBRE_BROWSER_CASE,{timeout:180000},async()=>{
  const page=getPage(),fixture=humanModTimbreFixture(),parts=HUMAN_MOD_TIMBRE_PARTS,report={version:1,scenario:'human-mod-timbre',fixture:fixture.manifest,physicalAudio:false,ok:false,samples:[],states:[],cleanup:[]};let installed=false,legacy;
  const readTake=()=>readHumanModExport(page,exportTakeData),readSource=()=>readHumanModExport(page,exportScore);
  const state=async label=>{const value=await page.evaluate(()=>({screen:document.body.dataset.screen,liveToneControls:document.querySelectorAll('[data-mod-live-instrument],#song-mod-unify-sound').length,repairVisible:!document.querySelector('#song-mod-unify-row').hidden,applyDisabled:document.querySelector('#song-mod-apply').disabled,startDisabled:document.querySelector('#start-performance').disabled,playDisabled:document.querySelector('#play-button').disabled,routing:document.querySelector('#song-mod-input-routing').textContent,summary:document.querySelector('#song-mod-preview-summary').textContent,unify:document.querySelector('#song-mod-unify-description').textContent,mode:document.querySelector('#session-mode').value,performanceInstrument:document.querySelector('#instrument').value,parts:[...document.querySelectorAll('.song-mod-part')].map(row=>({id:row.dataset.partId,performer:row.querySelector('[data-mod-performer]').value,liveInstrument:row.dataset.liveInstrument,instrument:row.querySelector('[data-mod-instrument]').value}))}));report.states.push({label,...value});return value;};
  const apply=async()=>{assert.equal(await page.locator('#song-mod-apply').isDisabled(),false);await page.locator('#song-mod-apply').click();await page.locator('#song-mod-dialog').waitFor({state:'hidden'});};
  const repair=async()=>{const before=await state('repair-follow');assert.equal(await page.locator('#song-mod-unify-row').isVisible(),true);for(const part of fixture.score.parts)assert.ok(before.unify.includes(part.name));await page.locator('#song-mod-unify-human').click();assert.equal(await page.locator('#song-mod-unify-row').isVisible(),false);assert.ok((await state('repaired-draft')).parts.every(part=>part.liveInstrument==='follow'));};
  const seedConflict=async tones=>{
   // Only this bounded, self-authored source's saved compatibility sidecar is
   // seeded. Product UI never regains per-part live-tone editing controls.
   await page.evaluate(async({score,tones})=>{const m=await import('/song-mod.js'),identity=m.songModIdentity({score}),store=new m.SongModStore(),mod=m.defaultSongMod({score,mode:'practice',practiceSelection:{kind:'all'}});for(const [i,part]of mod.config.parts.entries()){part.instrument=i?'triangle':'reed';part.liveInstrument=tones[i];}mod.configFingerprint=m.songModConfigFingerprint(mod.config);m.validateSongMod(mod,{identity,parts:score.parts});localStorage.setItem(store.key(identity),JSON.stringify(mod));},{score:fixture.score,tones});
   if(await page.locator('#song-mod-dialog').isVisible())await page.locator('#song-mod-cancel').click();
   if(await page.locator('body').getAttribute('data-screen')==='stage')await page.locator('#back-to-library').click();
   await savedRow().click();await page.waitForFunction(title=>document.querySelector('#preview-title').textContent===title&&!document.querySelector('#configure-song-mod').disabled,fixture.score.title);
  };
  const install=async()=>{await installCanonicalPreviewAudio(page);await page.evaluate(async()=>{globalThis.__wmhHumanLive=await __wmhObserveLiveNavigation(document,{keyCode:'KeyR',midi:60,readSource:()=>__wmhPreviewAudio.status()});});installed=true;};
  const cleanup=async()=>{if(!installed)return;const value=await page.evaluate(()=>({live:__wmhHumanLive.restore(),source:__wmhPreviewAudio.restore()}));report.cleanup.push(value);validateLiveToneCleanup(value.live);assert.equal(value.source.restored,true);installed=false;};
  const savedRow=()=>page.locator('#catalog [data-library-key]').filter({hasText:fixture.score.title}).first();
  const reopen=async()=>{await page.reload({waitUntil:'domcontentloaded'});await waitForPlaybackClock(page);await selectLegacyEnglish(page);await install();await page.locator('#home-single-player').click();await savedRow().waitFor();await savedRow().click();await page.waitForFunction(title=>document.querySelector('#preview-title').textContent===title&&!document.querySelector('#configure-song-mod').disabled,fixture.score.title);};
  const configurePerformance=async instrument=>{await ui('#instrument').selectOption(instrument);await closeShellPanels();};
  const prepareOptions=async()=>{if(!await ui('.practice-options').evaluate(node=>node.open))await ui('.practice-options>summary').click();await ui('#count-in').uncheck();await ui('#metronome-enabled').uncheck();await closeShellPanels();};
  async function sample(label,expectedInstrument,control='play-button'){
   const profile=await page.evaluate(()=>({instrument:document.querySelector('#instrument').value,keys:document.querySelector('#key-count').value,tuning:document.querySelector('#guitar-tuning').value,frets:document.querySelector('#guitar-frets').value,capo:document.querySelector('#guitar-capo').value}));assert.ok(['piano','guitar'].includes(profile.instrument));assert.deepEqual(profile,{instrument:profile.instrument,keys:'61',tuning:'E4 B3 G3 D3 A2 E2',frets:'12',capo:'0'},'Each original sample requires the exact default profile retained by its Rust oracle');
   await admitHumanModPlayback(page,control);if(await page.locator('#notation-toggle').getAttribute('aria-expanded')==='true')await page.locator('#notation-toggle').click();
   await page.locator('#stage-title').click();assert.equal(await page.locator('#keyboard-map [data-code="KeyR"]').getAttribute('data-note-midi'),'60');
   await page.evaluate(()=>{globalThis.__wmhHumanTrace=__wmhHumanModTransport(document,{keyCode:'KeyR'});__wmhHumanLive.begin();});
   await page.keyboard.down('r');await page.waitForTimeout(50);await page.waitForFunction(()=>{__wmhHumanLive.assertHealthy();return __wmhHumanLive.sounding();});await page.keyboard.up('r');await page.waitForFunction(()=>__wmhHumanLive.settled());
   // A finite post-release window observes the same connected audible node.
   await page.evaluate(()=>__wmhHumanLive.checkpoint('released'));await page.waitForFunction(()=>{__wmhHumanLive.assertHealthy();return __wmhHumanLive.quiet('released');});
   const observed=await page.evaluate(()=>{const audio=__wmhHumanLive.finish(),transport=__wmhHumanTrace.snapshot('complete');__wmhHumanTrace.stop();return{audio,transport};});
   await page.locator('#play-button').click();await ui('#assess-button:not([disabled])').click();await page.waitForFunction(()=>document.querySelector('.performance-status')?.dataset.phase==='assessed');const take=await readTake();
   assert.deepEqual(await readSource(),report.sourceScore);
   const row={label,expectedInstrument,performanceInstrument:await page.locator('#instrument').inputValue(),...observed,take};validateHumanModFixtureSample(row,{take,compilation:report.compilation,expectedLiveInstrument:'follow'});report.samples.push(row);return take;
  }
  try{
   await page.addInitScript(humanModTimbreBootstrap);await page.reload({waitUntil:'domcontentloaded'});await waitForPlaybackClock(page);await selectLegacyEnglish(page);
   await ui('#score-file').setInputFiles({name:HUMAN_MOD_TIMBRE_FIXTURE,mimeType:'application/json',buffer:fixture.bytes});await readyForTitle(fixture.score.title);await closeShellPanels();report.sourceScore=await readSource();assert.deepEqual(report.sourceScore,fixture.score);report.compilation=await page.evaluate(async score=>{const response=await fetch('/api/compile',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(score)});if(!response.ok)throw Error('Original fixture compilation failed');return response.json();},report.sourceScore);
   // Seed only this original fixture's legacy sidecar, before creating a v2 Mod.
   legacy=await page.evaluate(async score=>{const m=await import('/song-mod.js'),identity=m.songModIdentity({score}),mod=m.defaultSongMod({score,mode:'practice',practiceSelection:{kind:'all'}});mod.version=1;for(const [index,part]of mod.config.parts.entries()){delete part.liveInstrument;part.instrument=index?'triangle':'reed';}mod.configFingerprint=m.songModConfigFingerprint(mod.config,1);m.validateSongMod(mod,{identity,parts:score.parts});const store=new m.SongModStore(),key=store.key(identity,m.SONG_MOD_LEGACY_STORAGE_PREFIX),v2Key=store.key(identity),raw=JSON.stringify(mod);if(localStorage.getItem(v2Key)!==null)throw Error('Fixture unexpectedly already has a v2 Mod');localStorage.setItem(key,raw);return{key,v2Key,raw};},report.sourceScore);report.legacy=legacy;
   await reopen();await prepareOptions();await configurePerformance('piano');await openSongMod(page,{origin:'preview'});let initial=await state('legacy-read');assert.ok(initial.parts.every(part=>part.performer==='human'&&part.liveInstrument==='follow'));assert.deepEqual(initial.parts.map(part=>part.instrument),['reed','triangle']);await page.locator('#song-mod-cancel').click();assert.deepEqual(await page.evaluate(({key,v2Key})=>({legacy:localStorage.getItem(key),v2:localStorage.getItem(v2Key)}),legacy),{legacy:legacy.raw,v2:null});
   assert.equal(await page.locator('[data-mod-live-instrument]').count(),0);assert.equal(await page.locator('#song-mod-unify-sound').count(),0);
   await seedConflict(['piano','guitar']);await openSongMod(page,{origin:'preview'});const conflict=await state('draft-conflict');assert.equal(conflict.applyDisabled,true);for(const part of fixture.score.parts)assert.ok(conflict.routing.includes(part.name));await page.screenshot({path:join(artifactDirectory,'worldmusichub-human-mod-conflict.png')});
   const beforeRepair=await page.evaluate(key=>localStorage.getItem(key),legacy.v2Key);report.conflictBeforeCancel=beforeRepair;await repair();await page.locator('#song-mod-cancel').click();report.conflictAfterCancel=await page.evaluate(key=>localStorage.getItem(key),legacy.v2Key);assert.equal(report.conflictAfterCancel,beforeRepair,'Cancel preserves the conflicting saved config');await openSongMod(page,{origin:'preview'});assert.equal(await page.locator('#song-mod-apply').isDisabled(),true);await page.locator('#song-mod-unify-human').click();await apply();assert.equal(await page.evaluate(key=>localStorage.getItem(key),legacy.key),legacy.raw);
   await configurePerformance('guitar');await sample('guitar','guitar','start-performance');
   await openSongMod(page,{origin:'stage'});assert.equal(await page.locator('#song-mod-unify-row').isVisible(),false);await page.locator('#song-mod-cancel').click();
   await configurePerformance('piano');const piano=await sample('piano','piano');await openSongMod(page,{origin:'stage'});await page.locator('#song-mod-cancel').click();assert.deepEqual(await readTake(),piano,'Cancel preserves the entire paused take and applied Mod');
   await seedConflict(['piano','follow']);await configurePerformance('guitar');await page.waitForFunction(()=>document.querySelector('#start-performance').disabled);const changed=await state('changed-default-conflict');assert.equal(changed.startDisabled,true);for(const part of fixture.score.parts)assert.ok(changed.summary.includes(part.name));await openSongMod(page,{origin:'preview'});await page.locator('#song-mod-unify-human').click();await apply();await admitHumanModPlayback(page,'start-performance');
   await openSongMod(page,{origin:'stage'});await page.locator('#song-mod-all-machine').click();await apply();assert.equal((await state('listen-mode')).mode,'listen');await openSongMod(page,{origin:'stage'});await page.locator('#song-mod-all-human').click();await apply();assert.equal((await state('human-mode')).mode,'practice');await sample('follow-guitar-after-mode','guitar');
   await cleanup();await reopen();await prepareOptions();await openSongMod(page,{origin:'preview'});const reopened=await state('v2-reopened');assert.ok(reopened.parts.every(part=>part.performer==='human'&&part.liveInstrument==='follow'));assert.deepEqual(reopened.parts.map(part=>part.instrument),['reed','triangle']);await page.locator('#song-mod-cancel').click();assert.equal(await page.evaluate(key=>localStorage.getItem(key),legacy.key),legacy.raw);await sample('follow-after-reload',reopened.performanceInstrument,'start-performance');
   report.storage=await page.evaluate(({key,v2Key})=>({legacy:localStorage.getItem(key),v2:localStorage.getItem(v2Key)}),legacy);assert.equal(report.storage.legacy,legacy.raw);assert.equal(JSON.parse(report.storage.v2).version,2);report.ok=true;
  }catch(error){report.error=error.stack||String(error);if(installed)try{report.failure=await page.evaluate(()=>__wmhHumanLive.failureEvidence());}catch{}throw error;}
  finally{try{await cleanup();if(report.ok)validateHostedHumanModTimbre(report);}finally{await writeFile(join(artifactDirectory,'worldmusichub-human-mod-timbre.json'),JSON.stringify(report,null,2));}}
 });
}

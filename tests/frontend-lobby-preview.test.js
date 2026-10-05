import {readPlaybackClock} from '../web/playback-clock-view.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {freePracticeApp,fixtureScoreServer} from './free-practice-app-fixtures.js';
import {getAppI18n} from '../web/app-locale.js';
import {fixture} from './frontend-fixtures.js';
function supportDurationAudio() {
 const original=AudioContext.prototype.createGain;
 AudioContext.prototype.createGain=function(){const result=original.call(this);result.gain.setTargetAtTime=()=>{};return result;};
}
const deferred=()=>{let resolve;const promise=new Promise(yes=>{resolve=yes;});return {promise,resolve};};

test('main menu leads to the real library, appearance and settings, and planned modes never invent a session',async()=>{
 const app=await freePracticeApp({fetchResult:await fixtureScoreServer()});
 try {
  supportDurationAudio();
  await app.until(()=>!app.$('start-listen').disabled);
  assert.equal(app.document.body.dataset.screen,'home');assert.equal(app.$('game-home').hidden,false);assert.equal(app.$('song-lobby').hidden,true);
  assert.equal(app.$('home-collaboration').disabled,true);assert.equal(app.$('home-online').disabled,true);assert.equal(app.$('resume-session').hidden,true);
  await app.click('home-settings');assert.equal(app.$('settings-dialog').open,true);app.$('settings-dialog').close();
  await app.click('home-appearance');assert.equal(app.$('settings-dialog').open,true);assert.equal(app.$('theme-mode').closest('dialog').id,'settings-dialog');app.$('settings-dialog').close();
  await app.click('home-single-player');assert.equal(app.document.body.dataset.screen,'library');assert.equal(app.$('game-home').hidden,true);assert.equal(app.$('song-lobby').hidden,false);
  assert.equal(app.$('lobby-preview-play').disabled,false);assert.deepEqual(app.audio(),{contexts:0,unlocks:0});
  await app.click('lobby-home');assert.equal(app.document.body.dataset.screen,'home');
  const i18n=getAppI18n(app.document);i18n.setLocale('en');assert.match(app.$('home-single-player').textContent,/Single player/);assert.match(app.$('home-online').textContent,/Planned/);
  assert.equal(app.document.querySelectorAll('#preview-part').length,1);assert.equal(app.document.querySelectorAll('#instrument').length,1);assert.equal(app.document.querySelectorAll('#start-free-practice').length,1);
 }finally {await app.close();}
});

test('real app audition creates independent sound, retains session/source exports, and cancels for panels, navigation and mute',async()=>{
 const app=await freePracticeApp({fetchResult:await fixtureScoreServer()});
 try {
  supportDurationAudio();
  await app.until(()=>!app.$('start-listen').disabled);await app.click('home-single-player');app.$('count-in').checked=false;
  await app.click('start-listen');await app.until(()=>app.document.body.dataset.screen==='stage');await app.click('back-to-library');
  const beforeScore=await app.exported('export-button'),beforeTakes=await app.exported('export-takes');
  const requests=app.requests.length,scoreTitle=app.$('score-title').textContent,progress=readPlaybackClock(app.document).positionMs,sessionSound=app.$('sound-button').getAttribute('aria-pressed');
  await app.click('lobby-preview-play');await app.until(()=>app.$('lobby-preview-status').dataset.state==='playing');
  assert.ok(app.plays.some(args=>args[0].startsWith('lobby:')));assert.equal(app.audio().contexts,2,'Session and audition have different Synth contexts');
  const i18n=getAppI18n(app.document),control=app.$('lobby-preview-play');i18n.setLocale('en');assert.equal(app.$('lobby-preview-status').textContent,'Preview playing');assert.equal(app.$('lobby-preview-play'),control);
  app.$('lobby-preview-volume').value='23';app.emit(app.$('lobby-preview-volume'),'input');assert.equal(app.$('lobby-preview-volume').getAttribute('aria-valuetext'),'23%');
  await app.click('settings-button');assert.equal(app.$('lobby-preview-status').dataset.state,'stopped');app.$('settings-dialog').close();assert.equal(app.$('lobby-preview-status').dataset.state,'stopped');
  await app.click('lobby-preview-play');app.$('lobby-preview-sound').checked=false;app.emit(app.$('lobby-preview-sound'),'change');assert.equal(app.$('lobby-preview-status').dataset.state,'muted');assert.equal(app.$('lobby-preview-play').disabled,true);
  assert.equal(app.$('sound-button').getAttribute('aria-pressed'),sessionSound);assert.equal(app.$('score-title').textContent,scoreTitle);assert.equal(readPlaybackClock(app.document).positionMs,progress);assert.equal(app.requests.length,requests);
  assert.deepEqual(await app.exported('export-button'),beforeScore);assert.deepEqual(await app.exported('export-takes'),beforeTakes);
  app.$('lobby-preview-sound').checked=true;app.emit(app.$('lobby-preview-sound'),'change');await app.click('lobby-preview-play');await app.click('lobby-home');assert.equal(app.$('lobby-preview-status').dataset.state,'stopped');
  await app.click('home-single-player');assert.equal(app.$('lobby-preview-status').dataset.state,'stopped','Returning never resumes audition');
 }finally {await app.close();}
});

test('rapid selection, leaving during audio unlock, and page visibility prevent stale audition playback',async()=>{
 const base=await fixtureScoreServer(),other={...structuredClone(fixture),id:'other-selection',title:'第二首试听'};
 const app=await freePracticeApp({fetchResult:(path,body)=>{
  if(path==='/api/catalog/index'){const result=base(path,body);return {...result,items:[...result.items,{...result.items[0],id:other.id,title:other.title}]};}
  if(path==='/api/catalog/score/'+other.id)return other;return base(path,body);
 }});
 try {
  supportDurationAudio();
  await app.until(()=>!app.$('start-listen').disabled);await app.click('home-single-player');
  const gate=deferred();app.setUnlock(()=>gate.promise);await app.click('lobby-preview-play');assert.equal(app.$('lobby-preview-status').dataset.state,'loadingAudio');
  app.document.querySelector('[data-score-id="other-selection"]').click();await app.until(()=>app.$('preview-title').textContent===other.title&&!app.$('start-listen').disabled);
  gate.resolve();await app.tick();assert.equal(app.plays.length,0);assert.equal(app.$('lobby-preview-status').dataset.state,'ready');
  const next=deferred();app.setUnlock(()=>next.promise);await app.click('lobby-preview-play');await app.click('lobby-home');next.resolve();await app.tick();assert.equal(app.plays.length,0);
  app.setUnlock(null);await app.click('home-single-player');await app.click('lobby-preview-play');await app.until(()=>app.$('lobby-preview-status').dataset.state==='playing');
  Object.defineProperty(app.document,'hidden',{configurable:true,value:true});app.emit(app.document,'visibilitychange');assert.equal(app.$('lobby-preview-status').dataset.state,'interrupted');
  Object.defineProperty(app.document,'hidden',{configurable:true,value:false});app.emit(app.document,'visibilitychange');assert.equal(app.$('lobby-preview-status').dataset.state,'interrupted');
 }finally {await app.close();}
});

test('all audition and instrument labels are populated on mount and stay localized without replacing controls or part choices',async()=>{
 const app=await freePracticeApp({fetchResult:await fixtureScoreServer()});
 try {
  await app.until(()=>!app.$('start-listen').disabled);await app.click('home-single-player');
  const i18n=getAppI18n(app.document),panels=['.lobby-audition','.lobby-options'];
  const ids=['lobby-preview-sound','lobby-preview-volume','lobby-instrument','preview-part'];
  const controls=new Map(ids.map(id=>[id,app.$(id)]));
  app.$('lobby-preview-volume').value='23';app.emit(app.$('lobby-preview-volume'),'input');
  app.$('preview-part').value='piano';app.emit(app.$('preview-part'),'change');await app.until(()=>!app.$('start-practice').disabled);
  const requests=app.requests.length,audio=app.audio();
  for(const locale of ['zh-CN','en','zh-CN']) {
   i18n.setLocale(locale);
   for(const selector of panels)for(const element of app.document.querySelectorAll(`${selector} [data-i18n]`)) {
    const key=element.getAttribute('data-i18n');assert.equal(element.textContent,i18n.t(key),`${locale}: ${key} has visible owned text`);
   }
   for(const [id,control]of controls)assert.equal(app.$(id),control,`${id} retains its handler-bearing node`);
   assert.equal(app.$('lobby-preview-volume').value,'23');assert.equal(app.$('lobby-instrument').value,'piano');
   assert.equal(app.$('preview-part').value,'piano');assert.equal(app.$('preview-part').querySelector('option[value="piano"]').textContent,'Piano','Source part names remain authored data');
   const partLabel=[...app.$('preview-part-label').childNodes].filter(node=>node.nodeType===3).map(node=>node.textContent).join('');
   assert.equal(partLabel,i18n.t('shell.targetPart'));assert.equal(app.$('start-listen').textContent,i18n.t('shell.startListen'));assert.equal(app.$('preview-part-help').hidden,true);
   assert.equal(app.$('preview-part').querySelector('option[value=""]').textContent,i18n.t('app.allParts'));
  }
  assert.equal(app.requests.length,requests);assert.deepEqual(app.audio(),audio);assert.equal(app.$('lobby-preview-status').dataset.state,'ready');
 }finally {await app.close();}
});

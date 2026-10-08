import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {nativeScoreServer,nativeStorageApp,nativeResponse} from './native-storage-app-fixtures.js';
import {CanonicalPracticeSession} from '../web/canonical-practice-session.js';
const evidence=JSON.parse(readFileSync(new URL('./fixtures/assistance-canonical.json',import.meta.url)));
const set=(app,id,value)=>{app.$(id).value=String(value);app.emit(app.$(id),'change');};
async function assistedApp(){
 const server=await nativeScoreServer({scores:[evidence.compilation.score]});let wall=1000;
 server.setRoute(({path,body})=>{
  if(path==='/api/compile'&&body.id===evidence.compilation.score.id)return nativeResponse(evidence.compilation);
  if(path==='/api/canonical-audio-profile')return nativeResponse(evidence.audio_profile);
  if(path.startsWith('/api/practice-assistance/'))return nativeResponse(path.endsWith('/generate')?evidence.automatic:evidence.original);
 });
 const app=await nativeStorageApp(server,{now:()=>wall}),key=[...server.records.keys()][0];
 await app.until(()=>app.savedButton(key));await app.click('home-single-player');set(app,'key-count',88);app.savedButton(key).click();await app.until(()=>!app.$('configure-song-mod').disabled);
 await app.click('configure-song-mod');set(app,'song-mod-layout','complete');set(app,'song-mod-assistance-mode','automatic');
 for(const [name,value]of Object.entries(evidence.automatic.checked.plan.settings))if(name!=='algorithm_id'){app.$(`song-mod-assistance-${name}`).value=String(value);app.emit(app.$(`song-mod-assistance-${name}`),'input');}
 await app.click('song-mod-assistance-check');await app.until(()=>app.$('song-mod-assistance-status').dataset.phase==='prepared');await app.click('song-mod-apply');await app.until(()=>!app.$('song-mod-dialog').open);
 app.$('count-in').checked=false;app.$('metronome-enabled').checked=false;await app.click('start-performance');await app.until(()=>app.$('canonical-audio-policy').dataset.rendererState==='playing');
 return {app,server,advance(ms){wall=ms;app.renderAudioTo((ms-1000)/1000);},at(ms){wall=ms;app.renderAudioTo((ms-1000)/1000);app.frame();},strip:()=>app.document.querySelector('.part-activity-strip')};
}
test('independent activity app: assisted machine gates never enter targets, inputs or score exports',async()=>{
 const f=await assistedApp(),{app}=f;
 try{
  f.at(app.sourceStartWall()+30);const strip=f.strip();assert.ok(strip);assert.equal(strip.hidden,false);assert.ok(strip.querySelector('[data-state="playing"]'));assert.equal(strip.querySelector('.part-activity-subset').hidden,false);
  const before=await app.exported('export-takes');assert.deepEqual(before.target_plan.timeline.notes,evidence.automatic.checked.human_targets.timeline.notes);assert.deepEqual(before.passes[0].inputs,[]);assert.deepEqual(await app.exported('export-button'),evidence.compilation.score);
  strip.hidden=true;const hidden=await app.exported('export-takes');assert.deepEqual(hidden.passes,before.passes);assert.deepEqual(hidden.target_plan,before.target_plan);
  f.at(app.sourceStartWall()+40);const key=app.document.querySelector('#keyboard [data-midi="60"]');app.emit(key,'pointerdown',{pointerId:701,button:0});f.at(app.sourceStartWall()+80);app.emit(key,'pointerup',{pointerId:701,button:0});
  const after=await app.exported('export-takes');assert.equal(after.passes[0].inputs.length,1);assert.deepEqual(after.target_plan,before.target_plan);assert.deepEqual(after.passes[0].timeline,before.passes[0].timeline);assert.deepEqual(await app.exported('export-button'),evidence.compilation.score);
 }finally{await app.close();}
});
test('independent activity app: running frames retain four baseline source-clock reads',async()=>{
 const original=CanonicalPracticeSession.prototype.sourceClock;let calls=0,f;CanonicalPracticeSession.prototype.sourceClock=function(...args){calls++;return original.apply(this,args);};
 try{f=await assistedApp();f.at(f.app.sourceStartWall()+20);f.app.frame();for(let n=0;n<6;n++){f.advance(f.app.sourceStartWall()+30+n*25);calls=0;f.app.frame();assert.equal(calls,4,`frame ${n}, pre-integration baseline is four`);assert.ok(f.strip().querySelector('[data-state="playing"]'));}}
 finally{await f?.app.close();CanonicalPracticeSession.prototype.sourceClock=original;}
});
test('independent activity app: paging keys cannot inject notes or toggle Space transport; departure hides strip',async()=>{
 const f=await assistedApp(),{app}=f;
 try{f.at(app.sourceStartWall()+30);const strip=f.strip(),next=strip.querySelector('.part-activity-next'),before=await app.exported('export-takes');
  for(const [key,code]of [[' ','Space'],['z','KeyZ'],['ArrowRight','ArrowRight'],['Home','Home'],['End','End']]){app.emit(next,'keydown',{key,code});app.emit(next,'keyup',{key,code});}
  assert.deepEqual((await app.exported('export-takes')).passes,before.passes);assert.equal(app.$('canonical-audio-policy').dataset.rendererState,'playing');await app.click('back-to-library');app.frame();assert.equal(strip.hidden,true);assert.deepEqual((await app.exported('export-takes')).target_plan,before.target_plan);
 }finally{await app.close();}
});
test('independent activity app: hiding, solo and mute remain separate; unmute admits fresh activity',async()=>{
 const f=await assistedApp(),{app}=f;
 try{
  f.at(app.sourceStartWall()+30);const targets=(await app.exported('export-takes')).target_plan;
  async function edit(change){await app.click('edit-song-mod');change();await app.click('song-mod-apply');await app.until(()=>!app.$('song-mod-dialog').open,()=>app.$('song-mod-error').textContent);app.frame();assert.deepEqual((await app.exported('export-takes')).target_plan,targets);}
  const field=kind=>app.$('song-mod-parts').querySelector(`[data-mod-${kind}="piano"]`),check=(node,value)=>{node.checked=value;app.emit(node,'change');};
  await edit(()=>set(app,'song-mod-layout','solo'));assert.equal(f.strip().hidden,true);
  await edit(()=>{set(app,'song-mod-layout','complete');check(app.$('song-mod-show-others'),false);});assert.equal(f.strip().hidden,true);
  await edit(()=>{check(app.$('song-mod-show-others'),true);check(field('visible'),false);});assert.equal(f.strip().hidden,true);
  await edit(()=>{check(field('visible'),true);check(field('mute'),true);});await app.click('play-button');await app.until(()=>app.$('canonical-audio-policy').dataset.rendererState==='playing');f.at(app.sourceStartWall()+50);assert.equal(f.strip().hidden,false);assert.ok(f.strip().querySelector('[data-state="muted"]'));
  await edit(()=>check(field('mute'),false));await app.click('play-button');await app.until(()=>app.$('canonical-audio-policy').dataset.rendererState==='playing');f.at(app.sourceStartWall()+60);assert.ok(f.strip().querySelector('[data-state="playing"]'));const take=await app.exported('export-takes');assert.ok(take.passes.every(p=>p.inputs.length===0));assert.deepEqual(take.target_plan,targets);
 }finally{await app.close();}
});
test('independent activity app: paging keyup preserves held human owner while matching release and focusout remain intact',async()=>{
 const f=await assistedApp(),{app}=f;
 try{
  f.at(app.sourceStartWall()+30);const key=app.document.querySelector('#keyboard [data-midi="60"]'),next=f.strip().querySelector('.part-activity-next');app.emit(key,'keydown',{key:' ',code:'Space'});app.frame();assert.equal(key.getAttribute('aria-pressed'),'true');
  app.emit(next,'keydown',{key:'Enter',code:'Enter'});app.emit(next,'keyup',{key:'Enter',code:'Enter'});app.frame();assert.equal(key.getAttribute('aria-pressed'),'true','Pager-owned Enter cannot release human Space');
  app.emit(next,'keyup',{key:' ',code:'Space'});app.frame();assert.equal(key.getAttribute('aria-pressed'),'false');app.emit(key,'keydown',{key:' ',code:'Space'});app.frame();assert.equal(key.getAttribute('aria-pressed'),'true');app.emit(key,'focusout',{relatedTarget:next});app.emit(next,'focusin',{relatedTarget:key});app.frame();assert.equal(key.getAttribute('aria-pressed'),'false');app.emit(next,'keyup',{key:' ',code:'Space'});app.frame();assert.equal(key.getAttribute('aria-pressed'),'false');assert.equal((await app.exported('export-takes')).passes[0].inputs.length,2);
 }finally{await app.close();}
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {canonicalPracticeApp} from './canonical-practice-fixtures.js';
import {CanonicalPlayer} from '../web/canonical-player.js';
import {readPlaybackClock} from '../web/playback-clock-view.js';
const deferred=()=>{let resolve;const promise=new Promise(yes=>{resolve=yes;});return {promise,resolve};};
async function completed(){const f=await canonicalPracticeApp(),{app,score}=f;app.$('count-in').checked=false;await app.click('start-complete-practice');for(const box of app.$('complete-practice-parts').querySelectorAll('input'))box.checked=box.value===score.parts[0].id;await app.click('complete-practice-apply');await app.until(()=>app.$('canonical-audio-policy').dataset.rendererState==='playing');f.time(app.sourceStartWall()+40);app.frame();return f;}
for(const outcome of ['admit','cancel'])test(`independent activity Replay ${outcome}: current renderer alone owns rows and old ended take stays immutable`,async()=>{
 const f=await completed(),{app}=f,oldPrepare=CanonicalPlayer.prototype.prepare,gate=deferred();let entered=false;
 const strip=()=>app.document.querySelector('.part-activity-strip'),playing=()=>!strip().hidden&&Boolean(strip().querySelector('[data-state="playing"]'));
 try{
  assert.ok(strip());assert.equal(playing(),true);const first=f.receiver();f.time(app.sourceStartWall()+4300);await app.tick();app.frame();await app.until(()=>readPlaybackClock(app.document).completed&&!app.$('play-button').disabled);app.frame();assert.equal(playing(),false,'Ended renderer cannot leave playing rows');const before=await app.exported('export-takes');
  CanonicalPlayer.prototype.prepare=async function(...args){const value=await oldPrepare.apply(this,args);entered=true;await gate.promise;return value;};app.$('play-button').click();await app.until(()=>entered);app.frame();assert.equal(playing(),false,'Delayed Replay cannot show previous take as playing');assert.ok(strip().hidden||[...strip().querySelectorAll('[data-state]')].every(n=>['ready','preparing','unavailable','ended'].includes(n.dataset.state)),'Old paused/playing rows are not an admitted Replay');
  assert.deepEqual(await app.exported('export-takes'),before);if(outcome==='cancel')app.$('play-button').click();gate.resolve();await app.until(()=>!app.$('play-button').disabled);app.frame();
  if(outcome==='cancel'){assert.equal(f.receiver(),undefined);assert.equal(playing(),false);assert.deepEqual(await app.exported('export-takes'),before);}
  else{await app.until(()=>app.$('canonical-audio-policy').dataset.rendererState==='playing');assert.notEqual(f.receiver(),first);app.frame();assert.equal(playing(),false,'New admitted future anchor cannot play early');f.time(app.sourceStartWall()+40);app.frame();assert.equal(playing(),true,'Supported canonical Replay uses its new current admitted renderer');const after=await app.exported('export-takes');assert.deepEqual(after.passes[0],before.passes[0]);assert.equal(after.passes.length,2);assert.deepEqual(after.passes[1].inputs,[]);await app.click('play-button');await app.until(()=>!app.$('play-button').disabled);app.frame();assert.equal(playing(),false,'Pause acknowledgement clears sounding state');await app.click('reset-button');app.frame();assert.equal(strip().hidden,true,'Reset invalidates admitted rows');}
 }finally{gate.resolve();CanonicalPlayer.prototype.prepare=oldPrepare;await app.close();}
});

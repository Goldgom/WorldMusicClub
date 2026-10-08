import test from 'node:test';
import assert from 'node:assert/strict';
import {basicKeyRenditionFixture} from './basic-key-rendition-fixtures.js';
import {nativeScoreServer,nativeStorageApp,nativeResponse,deferred} from './native-storage-app-fixtures.js';
import {PracticeRecorder} from '../web/practice-recorder.js';
import {Synth} from '../web/transport.js';

// Real app lifecycle and recorder in the in-memory DOM/native/audio fixture.
// These protocol mocks do not establish Rust GM analysis or browser acceptance.
const rejected=()=>nativeResponse({code:'unsupported_human_source',error:'Unsupported original attacks cannot be assigned Human. Choose Listen or a supported part.'},422);
async function fixture({route,storageValues=new Map()}={}){
  const opened=basicKeyRenditionFixture(),descriptor=opened.clean_package,score=JSON.parse(descriptor.score_json).notation,server=await nativeScoreServer(),key=`song-${descriptor.content_sha256}`;
  const summary={version:2,content_sha256:descriptor.content_sha256,profile:descriptor.profile,capabilities:descriptor.capabilities,coverage:descriptor.coverage,notation_available:true,media:[]};
  server.records.set(key,{...opened,entry:{key,revision:1,title:score.title,composer:score.composer,score_id:score.id,label:score.title,score_bytes:Buffer.byteLength(descriptor.score_json),saved_at_unix_ms:1700000000000,clean_package:summary}});
  if(route)server.setRoute(route);
  let wall=1000;const app=await nativeStorageApp(server,{now:()=>wall,storageValues});
  await app.until(()=>Boolean(app.savedButton(key)));await app.click('home-single-player');app.savedButton(key).click();await app.until(()=>app.$('song-lobby').dataset.previewStatus==='ready'&&!app.$('configure-song-mod').disabled&&app.$('preview-gate').textContent!=='Checking selected pitches with your instrument…');
  return{app,server,score,key,descriptor,storageValues,time(value){wall=value;app.renderAudioTo((value-1000)/1000);app.frame();}};
}
const admissions=app=>app.requests.filter(row=>row.path==='/api/library/practice-admission');

test('Basic uses strict saved-source admission with explicit pitch Off and retains raw/unresolved compatibility',async()=>{
  const f=await fixture(),{app}=f;
  try{
    await app.until(()=>!app.$('start-practice').disabled);
    const rows=admissions(app);assert.ok(rows.length>0);
    for(const {body}of rows){assert.deepEqual(Object.keys(body).sort(),['pitch_mod','selection','source']);assert.equal(body.source.key,f.key);assert.equal(body.source.content_sha256,f.descriptor.content_sha256);assert.deepEqual(body.pitch_mod,{format:'wmc-pitch-mod',version:1,semitones:0});assert.deepEqual(body.selection.selected_part_ids,[f.score.parts[0].id]);assert.equal(body.selection.profile.kind,'piano');assert.equal('timeline'in body,false);}
    const before=app.requests.length;await app.click('start-practice');await app.until(()=>app.$('clean-song-stage').dataset.rendererState==='playing');
    assert.ok(app.requests.slice(before).some(row=>row.path==='/api/library/practice-admission'));
    assert.equal(app.requests.slice(before).some(row=>row.path==='/api/practice-targets'),false,'Caller-created timelines cannot authorize Basic practice');
    const take=await app.exported('export-takes');assert.equal(take.practice_assistance,null);assert.equal(take.passes[0].interpretation.practice_assistance,null);assert.ok(take.passes[0].interpretation.basic_practice_admission.receipt.source_eligibility);assert.equal(f.descriptor.score_json,basicKeyRenditionFixture().clean_package.score_json);
  }finally{await app.close();}
});

test('missing mandatory Basic authority visibly blocks practice while complete Listen remains available',async()=>{
  const f=await fixture({route:({path})=>path==='/api/library/practice-admission'?nativeResponse({error:'Original-source admission service unavailable.'},503):undefined}),{app}=f;
  try{
    await app.until(()=>app.$('preview-gate').textContent.includes('admission service unavailable'));
    assert.equal(app.$('start-practice').disabled,true);assert.equal(app.$('start-listen').disabled,false);
    await app.click('start-listen');await app.until(()=>app.$('clean-song-stage').dataset.rendererState==='playing');
    assert.equal((await app.exported('export-takes')).passes.length,0);
    assert.ok(app.audioNodes.some(node=>node.kind==='audio-worklet'&&node.connected));
    assert.equal(app.requests.some(row=>row.path==='/api/library/assistance/plan'),false);
  }finally{await app.close();}
});

for(const action of ['song-mod-all-human','song-mod-restore'])test(`rejected ${action} Apply keeps its draft cancellable and never saves or replaces the active ownership`,async()=>{
  const f=await fixture(),{app,server}=f;
  try{
    await app.until(()=>!app.$('start-practice').disabled);const saved=[...f.storageValues];
    await app.click('configure-song-mod');await app.click(action);
    server.setRoute(({path})=>path==='/api/library/practice-admission'?rejected():undefined);
    await app.click('song-mod-apply');await app.until(()=>app.$('song-mod-error').textContent.includes('Unsupported original attacks'));
    assert.equal(app.$('song-mod-dialog').open,true);assert.deepEqual([...f.storageValues],saved);assert.equal((await app.exported('export-takes')).passes.length,0);
    await app.click('song-mod-cancel');assert.equal(app.$('song-mod-dialog').open,false);assert.equal(app.document.body.dataset.screen,'library');
    assert.equal(f.descriptor.score_json,basicKeyRenditionFixture().clean_package.score_json);
  }finally{await app.close();}
});

test('legacy preview Human selector checks first and preserves its previous selection on native rejection',async()=>{
  const f=await fixture(),{app,server,score}=f;
  try{
    await app.until(()=>!app.$('start-practice').disabled);const before=app.$('preview-part').value,saved=[...f.storageValues];
    server.setRoute(({path})=>path==='/api/library/practice-admission'?rejected():undefined);
    app.$('preview-part').value=score.parts[2].id;app.emit(app.$('preview-part'),'change');
    await app.until(()=>app.$('notice-message').textContent.includes('Unsupported original attacks'));
    assert.equal(app.$('preview-part').value,before);assert.equal(app.document.body.dataset.screen,'library');assert.deepEqual([...f.storageValues],saved);
  }finally{await app.close();}
});

test('a delayed Basic Start cannot install ownership or a take after navigation supersedes its candidate',async()=>{
  const f=await fixture(),{app,server}=f,held=deferred();let waiting=false;
  try{
    await app.until(()=>!app.$('start-practice').disabled);
    server.setRoute(async({path,defaultReply})=>{if(path==='/api/library/practice-admission'){waiting=true;await held.promise;return defaultReply();}});
    await app.click('start-practice');await app.until(()=>waiting);await app.click('start-free-practice');held.resolve();await app.tick();await app.tick();
    assert.equal(app.document.body.dataset.screen,'free');assert.equal((await app.exported('export-takes')).passes.length,0);assert.equal(app.audioNodes.some(node=>node.kind==='audio-worklet'&&node.connected),false);
  }finally{held.resolve();await app.close();}
});

test('resume rechecks saved-source authority and blocks capture, raw onset evidence and scoring before any input routing',async()=>{
  const f=await fixture(),{app,server}=f;const capture=PracticeRecorder.prototype.capture,observe=PracticeRecorder.prototype.observeOnset;let captures=0,onsets=0;
  try{
    await app.until(()=>!app.$('start-practice').disabled);await app.click('sound-button');await app.click('start-practice');await app.until(()=>app.$('clean-song-stage').dataset.rendererState==='playing');f.time(1100);await app.click('play-button');
    const before=admissions(app).length;server.setRoute(({path})=>path==='/api/library/practice-admission'?rejected():undefined);await app.click('play-button');await app.until(()=>app.$('practice-gate-reason').textContent.includes('Unsupported original attacks'));assert.ok(admissions(app).length>before);
    PracticeRecorder.prototype.capture=function(...args){captures++;return capture.apply(this,args);};PracticeRecorder.prototype.observeOnset=function(...args){onsets++;return observe.apply(this,args);};
    const take=await app.exported('export-takes'),key=app.document.querySelector('#keyboard [data-midi="60"]'),assessments=app.requests.filter(row=>row.path==='/api/assess').length;
    f.time(1200);app.emit(key,'pointerdown',{pointerId:77,button:0});app.emit(key,'pointerup',{pointerId:77});await app.tick();await app.click('assess-button');await app.tick();
    assert.equal(captures,0);assert.equal(onsets,0);assert.equal(app.requests.filter(row=>row.path==='/api/assess').length,assessments);assert.deepEqual((await app.exported('export-takes')).passes,take.passes);assert.equal(app.plays.some(row=>String(row[0]).startsWith('manual:')),false);
    app.$('session-mode').value='listen';app.emit(app.$('session-mode'),'change');await app.click('play-button');await app.until(()=>app.$('clean-song-stage').dataset.rendererState==='playing');assert.equal((await app.exported('export-takes')).passes.length,0);
  }finally{PracticeRecorder.prototype.capture=capture;PracticeRecorder.prototype.observeOnset=observe;await app.close();}
});

test('a response with no original eligibility receipt cannot authorize Basic even when target groups are plausible',async()=>{
  const f=await fixture(),{app,server}=f;
  try{
    await app.until(()=>!app.$('start-practice').disabled);
    server.setRoute(async({path,defaultReply})=>{if(path==='/api/library/practice-admission'){const value=await defaultReply().json();delete value.checked.receipt.source_eligibility;delete value.checked.plan.receipt.source_eligibility;return nativeResponse(value);}});
    await app.click('start-practice');await app.until(()=>app.$('notice-message').textContent.includes('eligibility could not be verified'));
    assert.equal(app.document.body.dataset.screen,'library');assert.equal((await app.exported('export-takes')).passes.length,0);
  }finally{await app.close();}
});

for(const control of ['start-performance','start-practice','play-button'])test(`${control} unlocks on the gesture before waiting for mandatory native Basic authority`,async()=>{
  const f=await fixture(),{app,server}=f,held=deferred(),events=[];let waiting=false;const unlock=Synth.prototype.unlock;
  try{
    await app.until(()=>!app.$('start-practice').disabled);
    if(control==='play-button'){await app.click('start-practice');await app.until(()=>app.$('clean-song-stage').dataset.rendererState==='playing');await app.click('play-button');}
    Synth.prototype.unlock=function(...args){events.push('unlock');return unlock.apply(this,args);};
    server.setRoute(async({path,defaultReply})=>{if(path==='/api/library/practice-admission'){events.push('native');waiting=true;await held.promise;return defaultReply();}});
    await app.click(control);await app.until(()=>waiting);assert.equal(events[0],'unlock');assert.equal(events[1],'native');
    assert.notEqual(app.$('clean-song-stage').dataset.rendererState,'playing');
    assert.equal((await app.exported('export-takes')).passes.length,control==='play-button'?1:0);
    held.resolve();await app.until(()=>app.$('clean-song-stage').dataset.rendererState==='playing');
  }finally{held.resolve();Synth.prototype.unlock=unlock;await app.close();}
});

test('saved Human preferences survive an unavailable eligibility service after application reload and do not enable Start',async()=>{
  const storageValues=new Map();let f=await fixture({storageValues});
  try{await f.app.until(()=>!f.app.$('start-practice').disabled);await f.app.click('configure-song-mod');await f.app.click('song-mod-all-human');await f.app.click('song-mod-apply');await f.app.until(()=>!f.app.$('song-mod-dialog').open);}finally{await f.app.close();}
  const saved=[...storageValues];f=await fixture({storageValues,route:({path})=>path==='/api/library/practice-admission'?rejected():undefined});
  try{await f.app.until(()=>f.app.$('preview-gate').textContent.includes('Unsupported original attacks'));assert.equal(f.app.$('start-performance').disabled,true);assert.equal(f.app.$('start-practice').disabled,true);assert.equal(f.app.$('start-listen').disabled,false);assert.deepEqual([...storageValues],saved);assert.equal((await f.app.exported('export-takes')).passes.length,0);}finally{await f.app.close();}
});

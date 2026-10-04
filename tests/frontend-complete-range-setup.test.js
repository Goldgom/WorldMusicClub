import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {basicKeyRenditionFixture} from './basic-key-rendition-fixtures.js';
import {nativeScoreServer,nativeStorageApp,nativeResponse,deferred} from './native-storage-app-fixtures.js';
import {getAppI18n} from '../web/app-locale.js';
import {keyboardGeometry} from '../web/music.js';

// Original, in-memory protocol examples derived from the authored five-attack
// fixture. Only nominal keys differ; this is not native compiler/import evidence.
function extremeRangeFixture(){
  const opened=basicKeyRenditionFixture(),descriptor=opened.clean_package;
  const score=JSON.parse(descriptor.score_json),metadata=JSON.parse(descriptor.metadata_json);
  const pitches=new Map([[35,16],[72,109]]);
  for(const track of score.performance.tracks)for(const [,command]of track.events)if([0x80,0x90].includes(command[0]&0xf0))command[1]=pitches.get(command[1])??command[1];
  score.notation.parts[1].notes[0].pitch={step:'E',alter:0,octave:0};
  score.notation.parts[2].notes[0].pitch={step:'C',alter:1,octave:8};
  for(const part of descriptor.runtime.parts)part.range=part.range.map(key=>pitches.get(key)??key);
  for(const row of descriptor.runtime.compilation.timeline.notes)row[2]=pitches.get(row[2])??row[2];
  const digest=value=>createHash('sha256').update(value).digest('hex');
  const sourceIdentity=JSON.stringify(score.performance.tracks);
  score.source={...score.source,sha256:digest(sourceIdentity),bytes:Buffer.byteLength(sourceIdentity)};
  score.notation.id=`original-range-${score.source.sha256}`;score.notation.title='Original complete-range setup example';
  descriptor.runtime.source_sha256=descriptor.runtime.rendition.source_sha256=score.source.sha256;
  metadata.id=score.notation.id;metadata.title=score.notation.title;metadata.sources=[score.source];
  descriptor.score_json=JSON.stringify(score);
  metadata.score={...metadata.score,sha256:digest(descriptor.score_json),bytes:Buffer.byteLength(descriptor.score_json)};
  descriptor.metadata_json=JSON.stringify(metadata);descriptor.content_sha256=digest(descriptor.metadata_json+descriptor.score_json);
  return opened;
}
async function setup(){
  const opened=extremeRangeFixture(),descriptor=opened.clean_package,score=JSON.parse(descriptor.score_json).notation;
  const server=await nativeScoreServer(),key=`song-${descriptor.content_sha256}`;
  const summary={version:2,content_sha256:descriptor.content_sha256,profile:descriptor.profile,capabilities:descriptor.capabilities,coverage:descriptor.coverage,notation_available:true,media:[]};
  server.records.set(key,{...opened,entry:{key,revision:1,title:score.title,composer:score.composer,score_id:score.id,label:score.title,score_bytes:Buffer.byteLength(JSON.stringify(score)),saved_at_unix_ms:1700000000000,clean_package:summary}});
  server.setRoute(({path,body,defaultReply})=>{
    if(!['/api/practice-targets','/api/instrument-check'].includes(path))return;
    const profile=body.profile,keys=profile.kind==='piano'?keyboardGeometry(profile.key_count,profile.lowest_midi):null;
    const low=keys?keys[0].midi:Math.min(...profile.tuning)+profile.capo,high=keys?keys.at(-1).midi:Math.max(...profile.tuning)+profile.frets;
    const fits=note=>note.midi>=low&&note.midi<=high;
    if(path==='/api/practice-targets')return defaultReply().json().then(plan=>nativeResponse({...plan,playable:body.timeline.notes.every(fits)}));
    return nativeResponse({lowest_midi:low,highest_midi:high,note_options:body.timeline.notes.map(note=>({note_id:note.id,midi:note.midi,playable:fits(note),positions:[]})),diagnostics:[],changed_source_notes:false});
  });
  let clock=1000;const app=await nativeStorageApp(server,{now:()=>clock,audioSampleRate:44100});
  let focused=null;const originalFocus=app.window.HTMLElement.prototype.focus;
  app.window.HTMLElement.prototype.focus=function(){focused=this;};
  await app.until(()=>app.savedButton(key)&&!app.$('start-listen').disabled);await app.click('home-single-player');app.savedButton(key).click();
  await app.until(()=>app.$('song-lobby').dataset.previewStatus==='ready'&&!app.$('start-practice').disabled);
  const close=app.close;app.close=async()=>{try{await close();}finally{app.window.HTMLElement.prototype.focus=originalFocus;}};
  return {app,server,descriptor,score,key,focused:()=>focused,time:value=>{clock=value;app.renderAudioTo((value-1000)/1000);}};
}
const sounds=app=>app.audioNodes.filter(node=>node.kind==='audio-worklet'?node.connected:['oscillator','buffer-source'].includes(node.kind)&&!node.disconnected);
const audioCore=app=>app.audioNodes.findLast(node=>node.kind==='audio-worklet'&&node.connected)?.core;
const actualRange=app=>{const keys=[...app.$('keyboard').querySelectorAll('[data-midi]')].map(key=>Number(key.dataset.midi));return [Math.min(...keys),Math.max(...keys)];};
function assertVisibleInSettings(app,id){
  const control=app.$(id),dialog=app.$('settings-dialog');
  assert.equal(control.closest('dialog'),dialog);assert.equal(dialog.parentNode,app.document.body);assert.equal(dialog.open,true);
  for(let node=control;node;node=node.parentElement){
    assert.equal(node.hidden,false,`${id}: hidden ancestor ${node.id||node.tagName}`);
    assert.equal(node.classList.contains('free-score-settings-hidden'),false,`${id}: free-screen hidden ancestor`);
    if(node.tagName==='DETAILS')assert.equal(node.open,true,`${id}: collapsed ancestor`);
  }
}
async function choosePart(app,part){app.$('preview-part').value=part;app.emit(app.$('preview-part'),'change');await app.until(()=>app.$('preview-gate').classList.contains('preview-blocked'));}
function draft(app,count,lowest){app.$('custom-key-count').value=String(count);app.emit(app.$('custom-key-count'),'input');app.$('custom-lowest').value=lowest;app.emit(app.$('custom-lowest'),'input');}

for(const [partIndex,midi]of [[1,16],[2,109]])test(`lobby MIDI ${midi}: 61 to 88 remains blocked; explicit custom setup preserves the entire song`,async()=>{
  const {app,descriptor,score,focused}=await setup(),source=descriptor.score_json,selected=score.parts[partIndex].id;
  try{
    await choosePart(app,selected);assert.deepEqual(actualRange(app),[36,96]);assert.match(app.$('basic-key-preview-range-text').textContent,/1 outside/);
    assert.equal(app.$('start-practice').disabled,true);assert.equal(app.$('start-listen').disabled,false);
    await app.click('basic-key-preview-piano-88');await app.until(()=>app.$('preview-gate').classList.contains('preview-blocked'));
    assert.deepEqual(actualRange(app),[21,108]);assert.equal(app.$('basic-key-preview-piano-88').hidden,true);assert.equal(app.$('basic-key-preview-range-setup').hidden,false);
    assert.match(app.$('basic-key-preview-range-help').textContent,/Applied range: A0–C8 \(MIDI 21–108\)/);assert.match(app.$('basic-key-preview-range-help').textContent,/on-screen.*physical keyboard.*source pitches.*all pitches/);
    await app.click('basic-key-preview-range-setup');
    assert.equal(app.document.body.dataset.screen,'library');assert.equal(app.$('workspace').hidden,true);assert.equal(app.$('key-count').value,'custom');assert.equal(focused(),app.$('custom-key-count'));
    for(const id of ['key-count','custom-key-count','custom-lowest','instrument-apply'])assertVisibleInSettings(app,id);
    assert.equal(app.$('custom-key-count').value,'88');assert.equal(app.$('custom-lowest').value,'A0');assert.deepEqual(actualRange(app),[21,108]);
    draft(app,94,'E0');assert.deepEqual(actualRange(app),[21,108],'Editing a draft must not silently extend the current range');
    app.$('settings-dialog').close();await app.click('basic-key-preview-range-setup');assert.equal(app.$('custom-key-count').value,'94');assert.equal(app.$('custom-lowest').value,'E0','Reopening preserves an unapplied draft');
    await app.click('instrument-apply');await app.until(()=>!app.$('start-practice').disabled&&actualRange(app)[0]===16);
    assert.deepEqual(actualRange(app),[16,109]);assert.match(app.$('basic-key-preview-range-help').textContent,/MIDI 16–109/);assert.match(app.$('basic-key-preview-range-text').textContent,/0 outside/);assert.equal(app.$('preview-part').value,selected);
    assert.equal(sounds(app).length,0);assert.equal(app.audio().unlocks,0,'Setup never starts audio');
    app.$('settings-dialog').close();await app.click('start-practice');await app.until(()=>app.$('clean-song-stage').dataset.rendererState==='playing');await app.click('play-button');
    const take=await app.exported('export-takes');assert.equal(take.score_id,score.id);assert.equal(take.practice_part,selected);assert.deepEqual(take.passes[0].timeline.notes.map(note=>[note.id,note.midi]),[[score.parts[partIndex].notes[0].id,midi]]);assert.deepEqual(take.passes[0].inputs,[]);
    assert.match(app.$('song-complete-range-text').textContent,/5 eligible targets.*0 targets outside/);assert.equal(app.$('clean-song-target').value,selected);
    const expected=descriptor.runtime.compilation.timeline.notes.map(([id,part_id,midi])=>({id,part_id,midi}));
    for(const request of app.requests.filter(request=>request.path==='/api/practice-targets'&&request.body.timeline.notes.some(note=>note.id.startsWith('midi-'))))for(const note of request.body.timeline.notes)assert.deepEqual({id:note.id,part_id:note.part_id,midi:note.midi},expected.find(item=>item.id===note.id));
    assert.equal(descriptor.score_json,source);assert.equal(app.requests.some(request=>/transpose|adapt|library\/save/.test(request.path)),false);
  }finally{await app.close();}
});

test('invalid custom bounds keep the applied range and every target blocked until an explicit valid apply',async()=>{
  const {app,descriptor}=await setup();try{
    await choosePart(app,JSON.parse(descriptor.score_json).notation.parts[2].id);await app.click('basic-key-preview-range-setup');
    for(const [count,lowest]of [[11,'E0'],[129,'C-1'],[94.5,'E0'],[113,'E0'],[94,'C-2'],[94,'no pitch']]){
      draft(app,count,lowest);const requests=app.requests.length;await app.click('instrument-apply');
      assert.deepEqual(actualRange(app),[36,96],`${count}/${lowest}`);assert.equal(app.$('start-practice').disabled,true);assert.equal(app.$('start-listen').disabled,false);
      assert.equal(app.requests.length,requests,'Invalid bounds never reach the native adaptation endpoint');assert.equal(app.$('instrument-report').textContent.length>0,true);assert.equal(sounds(app).length,0);
    }
    draft(app,128,'C-1');await app.click('instrument-apply');await app.until(()=>!app.$('start-practice').disabled);
    assert.deepEqual(actualRange(app),[0,127]);assert.match(app.$('basic-key-preview-range-help').textContent,/MIDI 0–127/);
  }finally{await app.close();}
});

test('stage setup releases playing audio and held typing input, keeps all-pitch listening independent, and never resumes on close',async()=>{
  const {app,score,focused,time}=await setup();try{
    await choosePart(app,score.parts[2].id);await app.click('start-listen');await app.until(()=>app.$('clean-song-stage').dataset.rendererState==='playing');
    assert.equal(app.$('clean-song-target').value,score.parts[2].id);time(1060);assert.equal(audioCore(app).startedCount,2,'The production core renders the low percussion selector outside the configured range');
    time(1560);app.frame();const core=audioCore(app),high=core.plan.keys.findIndex(key=>key===109);assert.ok(high>=0&&core.actualStarts[high]>=0,'The production core starts the retained high original MIDI key');assert.ok(Math.abs(core.steps[high]-2*Math.PI*440*2**((109-69)/12)/44100)<Number.EPSILON);assert.equal(core.startedCount,5,'All five original attacks rendered, including both keys outside the 61-key range');
    app.emit(app.$('stage-title'),'keydown',{code:'KeyZ',key:'z'});await app.tick();assert.ok(app.$('keyboard').querySelector('.pressed'),'Typing input really holds a key before setup');
    app.$('song-parts-tools').open=true;await app.click('song-range-setup');
    assert.equal(app.document.body.dataset.screen,'stage');assert.equal(focused(),app.$('custom-key-count'));for(const id of ['custom-key-count','custom-lowest','instrument-apply'])assertVisibleInSettings(app,id);
    assert.equal(app.$('keyboard').querySelector('.pressed'),null);assert.equal(sounds(app).length,0);assert.equal(app.$('clean-song-stage').dataset.rendererState,'ready');assert.deepEqual(actualRange(app),[36,96]);
    draft(app,94,'E0');await app.click('instrument-apply');await app.until(()=>actualRange(app)[0]===16);assert.equal(app.$('clean-song-target').value,score.parts[2].id);assert.match(app.$('song-range-help').textContent,/MIDI 16–109/);
    app.$('settings-dialog').close();time(1600);app.frame();assert.equal(sounds(app).length,0);assert.equal(app.$('clean-song-stage').dataset.rendererState,'ready');
    const before=app.plays.length;app.emit(app.$('stage-title'),'keydown',{code:'KeyZ',key:'z',repeat:true});assert.equal(app.plays.length,before,'A still-held physical key cannot restart after setup');app.emit(app.$('stage-title'),'keyup',{code:'KeyZ',key:'z'});
    app.emit(app.$('stage-title'),'keydown',{code:'KeyZ',key:'z'});await app.tick();assert.ok(app.$('keyboard').querySelector('.pressed'),'A fresh key press works after explicit release');app.emit(app.$('stage-title'),'keyup',{code:'KeyZ',key:'z'});
    assert.match(app.$('song-complete-range-text').textContent,/5 eligible targets.*0 targets outside/);assert.equal(app.requests.some(request=>request.path==='/api/assess'),false);
    await app.click('play-button');assert.equal(app.$('clean-song-stage').dataset.rendererState,'playing');await app.click('song-range-setup');assert.equal(app.$('clean-song-stage').dataset.rendererState,'paused');assert.deepEqual(actualRange(app),[16,109]);app.$('settings-dialog').close();app.frame();assert.equal(sounds(app).length,0);assert.equal(app.$('clean-song-stage').dataset.rendererState,'paused','Reopening an applied custom setup also never auto-resumes');
    const i18n=getAppI18n(app.document),button=app.$('song-range-setup'),previewButton=app.$('basic-key-preview-range-setup');i18n.setLocale('zh-CN');assert.equal(app.$('song-range-setup'),button);assert.equal(app.$('basic-key-preview-range-setup'),previewButton);assert.equal(button.textContent,'自定义音域／设备设置');assert.equal(previewButton.textContent,'自定义音域／设备设置');assert.match(app.$('song-range-help').textContent,/已应用音域.*MIDI 16～109.*屏幕键盘.*实体键盘.*源音高/);
  }finally{await app.close();}
});

test('range setup cancels a pending stage audio start and opens existing guitar controls without changing instruments',async()=>{
  const {app}=await setup();try{
    await app.click('open-score');await app.until(()=>app.document.body.dataset.screen==='stage');const pending=deferred();app.setUnlock(()=>pending.promise);
    await app.click('play-button');await app.click('song-range-setup');pending.resolve();await app.tick();assert.equal(sounds(app).length,0);assert.equal(app.$('clean-song-stage').dataset.rendererState,'ready');app.$('settings-dialog').close();
    app.$('instrument').value='guitar';app.emit(app.$('instrument'),'change');await app.tick();await app.click('song-range-setup');
    assert.equal(app.$('instrument').value,'guitar');for(const id of ['guitar-tuning','guitar-frets','guitar-capo','instrument-apply'])assertVisibleInSettings(app,id);assert.equal(app.$('custom-piano-controls').hidden,true);assert.match(app.$('song-range-help').textContent,/MIDI 40–76/);
    app.$('settings-dialog').close();await app.click('back-to-library');assert.match(app.$('basic-key-preview-range-help').textContent,/MIDI 40–76/);
  }finally{await app.close();}
});

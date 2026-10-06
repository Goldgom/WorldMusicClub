import test from 'node:test';
import assert from 'node:assert/strict';
import {nativeScoreServer,nativeStorageApp,nativeResponse,deferred} from './native-storage-app-fixtures.js';
import {fixture} from './frontend-fixtures.js';
import {compileBrowserFixture} from './frontend-browser-compilation-fixture.js';
import {readPlaybackClock} from '../web/playback-clock-view.js';
import {SONG_MOD_STORAGE_PREFIX} from '../web/song-mod.js';

// In-memory DOM/backend wiring only. These checks launch no browser/server and
// cannot establish native trusted input, device audio or hosted acceptance.
async function pausedImport(score=fixture) {
  const server=await nativeScoreServer(),app=await nativeStorageApp(server,{now:()=>1000});
  await app.click('import-tools-button');app.importFile(score);
  await app.until(()=>app.$('score-title').textContent===score.title&&app.$('practice-scope').textContent.includes('physical attacks'));
  app.$('import-tools-dialog').querySelector('[data-close-panel]').click();
  if(app.document.body.dataset.screen==='home')await app.click('home-single-player');
  if(app.document.body.dataset.screen==='library')await app.click('resume-session');
  return{server,app};
}
test('a frozen-clock original fixture can activate paused through Import and Resume without live-audio Start',async()=>{
  const {app}=await pausedImport();
  try{
    assert.equal(app.document.body.dataset.screen,'stage');assert.equal(performance.now(),1000);
    const clock=readPlaybackClock(app.$('progress'));assert.equal(clock.positionMs,0);assert.equal(clock.running,false);
    assert.equal(app.audio().contexts,0);assert.equal(app.$('canonical-audio-policy').dataset.rendererState,'stopped');
    assert.deepEqual((await app.exported('export-button')).parts,fixture.parts);
    assert.equal((await app.exported('export-takes')).passes.length,0);
  }finally{await app.close();}
});
test('same-title MusicXML import retains source only after file bytes, import and compile responses settle',async()=>{
  const {app,server}=await pausedImport(),read=deferred(),imported=deferred(),compiled=deferred();
  const xml='\uFEFF<score-partwise version="4.0">\r\n<!-- 原稿 & exact bytes -->\r\n</score-partwise>',bytes=new TextEncoder().encode(xml);
  const score={...structuredClone(fixture),source:{format:'musicxml',filename:null,content:xml}};
  let importRequest,compileRequest;
  try{
    server.setRoute(request=>{
      if(request.path==='/api/import/musicxml'){importRequest=request;return imported.promise;}
      if(request.path==='/api/compile'&&request.body.source?.format==='musicxml'){compileRequest=request;return compiled.promise;}
    });
    const previousCompile=server.requests.filter(request=>request.path==='/api/compile').at(-1);
    const file={name:'exercise.musicxml',size:bytes.length,arrayBuffer:()=>read.promise,text:()=>{throw Error('MusicXML must retain the original file bytes');}};
    Object.defineProperty(app.$('score-file'),'files',{configurable:true,value:[file]});app.emit(app.$('score-file'),'change');
    assert.equal(app.$('score-title').textContent,score.title,'The old title already matches while file reading is pending');
    assert.equal(importRequest,undefined);assert.equal(previousCompile.body.source,null);
    assert.equal((await app.exported('export-button')).source,null);

    read.resolve(bytes.buffer);await app.until(()=>Boolean(importRequest),'The raw MusicXML request never arrived');
    assert.deepEqual(new Uint8Array(importRequest.body),bytes);assert.equal(compileRequest,undefined);
    assert.equal(server.requests.filter(request=>request.path==='/api/compile').at(-1),previousCompile,'An observed import request alone does not replace the bootstrap compile');
    assert.equal((await app.exported('export-button')).source,null);

    imported.resolve(nativeResponse(compileBrowserFixture(score)));await app.until(()=>Boolean(compileRequest),'The imported source was not submitted for compilation');
    assert.deepEqual(compileRequest.body.source,score.source);assert.equal(app.$('play-button').disabled,true);
    assert.equal((await app.exported('export-button')).source,null,'An observed compile request alone does not publish its response');
    await app.click('sound-button');assert.equal(app.$('play-button').disabled,false,'The old take can still be playable while source compilation waits');
    assert.equal(app.$('configure-song-mod').disabled,true,'Import admission must remain pending despite the old take being playable');

    compiled.resolve(compileRequest.defaultReply());await app.until(()=>!app.$('configure-song-mod').disabled,'The imported score did not finish admission');
    assert.equal(app.$('score-title').textContent,fixture.title);assert.deepEqual((await app.exported('export-button')).source,score.source);
  }finally{read.resolve(bytes.buffer);imported.resolve(nativeResponse(compileBrowserFixture(score)));compiled.resolve(nativeResponse(compileBrowserFixture(score)));await app.close();}
});
test('stage Mod closure precedes the second target check and the final out-of-range reason',async()=>{
  const score=structuredClone(fixture);score.title='Original setup range test';score.parts[0].notes[0].pitch={step:'C',alter:0,octave:8};
  const {app,server}=await pausedImport(score);let release,seen=0;
  try{
    server.setRoute(({path,body,defaultReply})=>{
      if(path==='/api/instrument-check')return nativeResponse({lowest_midi:36,highest_midi:96,note_options:body.timeline.notes.map(note=>({note_id:note.id,midi:note.midi,playable:note.midi>=36&&note.midi<=96,positions:[]})),diagnostics:[],changed_source_notes:false});
      if(path==='/api/practice-targets'&&++seen===2)return new Promise(resolve=>{release=()=>resolve(defaultReply());});
    });
    await app.click('edit-song-mod');await app.click('song-mod-all-human');app.$('song-mod-apply').click();await app.until(()=>Boolean(release),'Second target request must be waiting after Mod closes');
    assert.equal(app.$('song-mod-dialog').open,false);assert.match(app.$('practice-scope').textContent,/pending/);assert.equal(app.$('play-button').disabled,true);
    release();await app.until(()=>app.$('practice-gate-reason').textContent==='Selected notes outside this instrument range: 1. Change the range, tuning, part or loop before practicing.','Completed target check must publish the exact blocked reason');
    assert.match(app.$('practice-scope').textContent,/2 physical/);assert.equal(app.$('play-button').disabled,true);assert.equal(app.$('assess-button').disabled,true);
  }finally{release?.();await app.close();}
});
test('failed human preview Apply retains the draft and previous Listen settings until explicit recovery',async()=>{
  const server=await nativeScoreServer({scores:[fixture]}),app=await nativeStorageApp(server,{now:()=>1000});
  try{
    const key=[...server.records.keys()][0];await app.until(()=>app.savedButton(key));await app.click('home-single-player');app.savedButton(key).click();await app.until(()=>!app.$('configure-song-mod').disabled);
    await app.click('configure-song-mod');await app.click('song-mod-all-machine');await app.click('song-mod-apply');await app.until(()=>!app.$('song-mod-dialog').open);
    server.setRoute(({path})=>path==='/api/practice-targets'?nativeResponse({error:'Preview target service unavailable'},503):undefined);
    await app.click('configure-song-mod');await app.click('song-mod-all-human');await app.click('song-mod-apply');await app.until(()=>app.$('song-mod-error').textContent==='Preview target service unavailable'&&!app.$('song-mod-apply').disabled);
    assert.equal(app.$('song-mod-dialog').open,true);assert.match(app.$('song-mod-preview-summary').textContent,/0 human.*Listen/);assert.equal(app.document.body.dataset.screen,'library');
    assert.ok([...app.$('song-mod-parts').querySelectorAll('[data-mod-performer]')].every(node=>node.value==='human'));
    await app.click('song-mod-all-machine');await app.click('song-mod-apply');await app.until(()=>!app.$('song-mod-dialog').open);assert.equal(app.$('start-performance').disabled,false);assert.match(app.$('song-mod-preview-summary').textContent,/Listen/);
  }finally{await app.close();}
});

for(const delayedPath of ['/api/practice-targets','/api/instrument-check'])test(`import admission gates the previous Mod and Start until ${delayedPath} settles`,async()=>{
  const {originalMultipartNotation}=await import('./notation-scope-fixtures.js');
  const score=originalMultipartNotation(),server=await nativeScoreServer(),app=await nativeStorageApp(server,{now:()=>1000});let release;
  try{
    await app.until(()=>!app.$('start-performance').disabled);await app.click('home-single-player');const prior=app.$('preview-title').textContent;
    server.setRoute(({path,defaultReply})=>path===delayedPath&&!release?new Promise(resolve=>{release=()=>resolve(defaultReply());}):undefined);
    app.importFile(score);await app.until(()=>release&&app.$('score-title').textContent===score.title);
    assert.equal(app.$('preview-title').textContent,prior,'The prior candidate has not been relabeled as the import');
    assert.equal(app.$('configure-song-mod').disabled,true);assert.equal(app.$('start-performance').disabled,true);
    // Programmatic activation in this DOM fixture also exercises handler guards;
    // browser acceptance uses only the actual enabled visible controls.
    await app.click('configure-song-mod');await app.click('start-performance');assert.equal(app.$('song-mod-dialog').open,false);assert.equal(app.document.body.dataset.screen,'library');
    release();await app.until(()=>app.$('preview-title').textContent===score.title&&!app.$('configure-song-mod').disabled);
    await app.click('configure-song-mod');assert.deepEqual([...app.$('song-mod-parts').querySelectorAll('[data-mod-performer]')].map(node=>node.dataset.modPerformer),score.parts.map(part=>part.id));
    await app.click('song-mod-all-machine');await app.click('song-mod-apply');await app.until(()=>!app.$('song-mod-dialog').open);assert.match(app.$('song-mod-preview-summary').textContent,/0 human · 12 machine.*Listen/);
    await app.click('start-performance');await app.until(()=>app.document.body.dataset.screen==='stage'&&app.$('canonical-audio-policy').dataset.rendererState==='playing');
    assert.equal(app.$('session-mode').value,'listen');assert.match(app.$('song-mod-stage-summary').textContent,/0 human · 12 machine.*Listen/);
    assert.equal((await app.exported('export-takes')).passes.length,0);assert.deepEqual(await app.exported('export-button'),score);
  }finally{release?.();await app.close();}
});

test('a failed replacement admission restores the previous Mod and Start without resuming or losing its take',async()=>{
  const server=await nativeScoreServer(),app=await nativeStorageApp(server,{now:()=>1000});let release;
  try{
    await app.until(()=>!app.$('start-performance').disabled);await app.click('home-single-player');await app.click('start-performance');await app.until(()=>app.$('canonical-audio-policy').dataset.rendererState==='playing');await app.click('back-to-library');
    const before=await app.exported('export-takes'),source=await app.exported('export-button'),title=app.$('preview-title').textContent;
    const rejected={...structuredClone(fixture),id:'rejected-mod-replacement',title:'Rejected replacement'};
    server.setRoute(({path,body})=>path==='/api/compile'&&body.id===rejected.id?new Promise(resolve=>{release=()=>resolve(nativeResponse({error:'Replacement rejected'},400));}):undefined);
    app.importFile(rejected);await app.until(()=>Boolean(release));assert.equal(app.$('configure-song-mod').disabled,true);assert.equal(app.$('start-performance').disabled,true);
    release();await app.until(()=>app.$('notice-message').textContent.includes('Replacement rejected')&&!app.$('configure-song-mod').disabled);
    assert.equal(app.$('start-performance').disabled,false);assert.equal(app.$('preview-title').textContent,title);assert.equal(readPlaybackClock(app.$('progress')).running,false);
    assert.deepEqual(await app.exported('export-button'),source);assert.deepEqual(await app.exported('export-takes'),before);
    await app.click('configure-song-mod');assert.equal(app.$('song-mod-dialog').open,true);
  }finally{release?.();await app.close();}
});

test('late imported target admission cannot replace a newer selected preview or apply an older open Mod draft',async()=>{
  const {originalMultipartNotation}=await import('./notation-scope-fixtures.js');
  const imported=originalMultipartNotation(),server=await nativeScoreServer(),storageValues=new Map(),app=await nativeStorageApp(server,{now:()=>1000,storageValues});let release;
  try{
    await app.until(()=>!app.$('configure-song-mod').disabled);await app.click('home-single-player');await app.click('configure-song-mod');await app.click('song-mod-all-machine');
    server.setRoute(({path,defaultReply})=>path==='/api/practice-targets'&&!release?new Promise(resolve=>{release=()=>resolve(defaultReply());}):undefined);
    app.importFile(imported);await app.until(()=>release&&app.$('score-title').textContent===imported.title);
    await app.click('song-mod-apply');await app.until(()=>!app.$('song-mod-dialog').open);assert.equal(app.$('start-performance').disabled,true);
    assert.equal([...storageValues.keys()].some(key=>key.startsWith(SONG_MOD_STORAGE_PREFIX)),false);
    app.document.querySelector(`[data-score-id="${fixture.id}"]`).click();await app.until(()=>app.$('song-lobby').dataset.previewStatus==='ready');
    release();await app.until(()=>app.storageStatus().dataset.persistence==='saved'&&app.document.querySelector('[data-score-storage]').getAttribute('aria-busy')==='false','The imported source must finish its caller persistence callback');await app.tick();
    assert.equal(app.$('configure-song-mod').disabled,false);assert.equal(app.document.body.dataset.screen,'library');assert.equal(app.$('preview-title').textContent,fixture.title);assert.equal(app.document.querySelector(`[data-score-id="${fixture.id}"]`).getAttribute('aria-pressed'),'true');assert.equal(app.$('score-title').textContent,imported.title);assert.deepEqual(await app.exported('export-button'),imported);
    await app.click('configure-song-mod');assert.ok([...app.$('song-mod-parts').querySelectorAll('[data-mod-performer]')].every(node=>node.value==='human'));
  }finally{release?.();await app.close();}
});

test('cancelling a deferred replacement restores usable preview controls before its late response',async()=>{
  const server=await nativeScoreServer(),app=await nativeStorageApp(server,{now:()=>1000});let release;
  try{
    await app.until(()=>!app.$('start-performance').disabled);await app.click('home-single-player');const title=app.$('preview-title').textContent;
    const replacement={...structuredClone(fixture),id:'cancelled-mod-replacement',title:'Cancelled replacement'};
    server.setRoute(({path,body,defaultReply})=>path==='/api/compile'&&body.id===replacement.id?new Promise(resolve=>{release=()=>resolve(defaultReply());}):undefined);
    app.importFile(replacement);await app.until(()=>Boolean(release));assert.equal(app.$('configure-song-mod').disabled,true);assert.equal(app.$('start-performance').disabled,true);
    app.importFile('{broken',{name:'cancelled-by-newer-file.json'});await app.until(()=>app.$('notice-message').textContent.includes('cancelled-by-newer-file.json'));
    assert.equal(app.$('configure-song-mod').disabled,false);assert.equal(app.$('start-performance').disabled,false);assert.equal(app.$('preview-title').textContent,title);
    await app.click('configure-song-mod');await app.click('song-mod-all-machine');await app.click('song-mod-apply');await app.until(()=>!app.$('song-mod-dialog').open);assert.match(app.$('song-mod-preview-summary').textContent,/0 human · 1 machine.*Listen/);
    release();await app.tick();assert.equal(app.$('preview-title').textContent,title);assert.match(app.$('song-mod-preview-summary').textContent,/0 human · 1 machine.*Listen/);
    await app.click('start-performance');await app.until(()=>app.$('canonical-audio-policy').dataset.rendererState==='playing');assert.equal(app.$('score-title').textContent,title);assert.equal((await app.exported('export-takes')).passes.length,0);
  }finally{release?.();await app.close();}
});

test('an older Apply finishing during replacement admission cannot save its draft or re-enable Start',async()=>{
  const {originalMultipartNotation}=await import('./notation-scope-fixtures.js');
  const imported=originalMultipartNotation(),server=await nativeScoreServer(),storageValues=new Map(),app=await nativeStorageApp(server,{now:()=>1000,storageValues});let releaseApply,releaseImport;
  try{
    await app.until(()=>!app.$('configure-song-mod').disabled);await app.click('home-single-player');await app.click('configure-song-mod');
    server.setRoute(({path,body,defaultReply})=>{
      if(path==='/api/practice-targets'&&!releaseApply)return new Promise(resolve=>{releaseApply=()=>resolve(defaultReply());});
      if(path==='/api/compile'&&body.id===imported.id)return new Promise(resolve=>{releaseImport=()=>resolve(defaultReply());});
    });
    app.$('song-mod-apply').click();await app.until(()=>Boolean(releaseApply));app.importFile(imported);await app.until(()=>Boolean(releaseImport));
    releaseApply();await app.until(()=>!app.$('song-mod-dialog').open);assert.equal(app.$('configure-song-mod').disabled,true);assert.equal(app.$('start-performance').disabled,true);
    assert.equal([...storageValues.keys()].some(key=>key.startsWith(SONG_MOD_STORAGE_PREFIX)),false);
    releaseImport();await app.until(()=>app.$('preview-title').textContent===imported.title&&!app.$('configure-song-mod').disabled);assert.match(app.$('song-mod-preview-summary').textContent,/12 human · 0 machine/);
    await app.click('configure-song-mod');assert.equal(app.$('song-mod-parts').querySelectorAll('[data-mod-performer]').length,12);
  }finally{releaseApply?.();releaseImport?.();await app.close();}
});

test('a deferred Start caller cannot navigate after a newer song is selected',async()=>{
  const {originalMultipartNotation}=await import('./notation-scope-fixtures.js');
  const selected=originalMultipartNotation(),server=await nativeScoreServer({scores:[selected]}),app=await nativeStorageApp(server,{now:()=>1000});let release;
  try{
    const key=[...server.records.keys()][0];await app.until(()=>app.savedButton(key)&&!app.$('start-performance').disabled);await app.click('home-single-player');
    server.setRoute(({path,defaultReply})=>path==='/api/practice-targets'&&!release?new Promise(resolve=>{release=()=>resolve(defaultReply());}):undefined);
    app.$('start-performance').click();await app.until(()=>Boolean(release));app.savedButton(key).click();await app.until(()=>app.$('preview-title').textContent===selected.title&&!app.$('configure-song-mod').disabled);
    release();await app.tick();await app.tick();assert.equal(app.document.body.dataset.screen,'library');assert.equal(app.$('preview-title').textContent,selected.title);assert.equal(app.savedButton(key).getAttribute('aria-pressed'),'true');assert.equal(app.$('canonical-audio-policy').dataset.rendererState,'stopped');assert.equal((await app.exported('export-takes')).passes.length,0);
    await app.click('start-performance');await app.until(()=>app.document.body.dataset.screen==='stage'&&app.$('canonical-audio-policy').dataset.rendererState==='playing');assert.equal(app.$('score-title').textContent,selected.title);assert.deepEqual(await app.exported('export-button'),selected);
  }finally{release?.();await app.close();}
});

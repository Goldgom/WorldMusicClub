import {readPlaybackClock} from '../web/playback-clock-view.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {getAppI18n} from '../web/app-locale.js';
import {cleanDescriptor,fixtureKey,mediaFixture} from './clean-song-fixtures.js';
import {nativeScoreServer,nativeStorageApp,nativeResponse,deferred,authoredScore} from './native-storage-app-fixtures.js';
import {orderedInitialTempoBrowserMidi,standardMidiDisclosure} from './browser-input-fixtures.js';
import {unavailablePianoResult} from './piano-fingering-fixtures.js';
async function setup({media=false,now,descriptor:providedDescriptor}={}){
 const assets=media?[mediaFixture(),mediaFixture({id:'bg',role:'background',content:'authored-bg'}),mediaFixture({id:'pv',role:'pv',mime:'video/webm',content:'authored-pv'})]:[];
 const descriptor=providedDescriptor||cleanDescriptor(({metadata})=>metadata.media=assets.map(item=>item.descriptor)),score=descriptor.runtime.compilation.score,server=await nativeScoreServer(),key=fixtureKey.slice(7);
 server.records.set(key,{entry:{key,revision:1,title:score.title,composer:'',score_id:score.id,label:score.title,score_bytes:JSON.stringify(score).length,saved_at_unix_ms:1700000000000,clean_package:{version:2,content_sha256:descriptor.content_sha256,media:descriptor.media}},score_json:JSON.stringify(score),clean_package:descriptor});
 if(media)server.setRoute(({path,body})=>{if(path==='/api/library/asset'){const asset=assets.find(item=>'asset-'+item.descriptor.sha256===body.handle);return{ok:true,url:'https://wmh.localhost/api/library/asset',headers:{get:()=>asset.descriptor.mime},arrayBuffer:async()=>Uint8Array.from(asset.data).buffer};}});
 const app=await nativeStorageApp(server,{now});await app.until(()=>app.savedButton(key)&&!app.$('start-listen').disabled);await app.click('home-single-player');app.savedButton(key).click();await app.until(()=>!app.$('start-listen').disabled&&!app.$('clean-song-preview').hidden,'Clean preview did not load');app.$('count-in').checked=false;return{app,server,descriptor,score,key};
}
async function activate(app,mode){await app.click(`start-${mode}`);await app.until(()=>app.document.body.dataset.screen==='stage'&&!app.$('play-button').disabled);}
const runningOscillators=app=>app.audioNodes.filter(node=>node.kind==='oscillator'&&!node.disconnected);
const readFixture=path=>JSON.parse(readFileSync(new URL(`./fixtures/${path}`,import.meta.url),'utf8'));
function longDescriptor(){return{version:2,content_sha256:fixtureKey.slice('native:song-'.length),metadata_json:JSON.stringify(readFixture('clean-song-v2-long/metadata.json')),score_json:JSON.stringify(readFixture('clean-song-v2-long/score.json')),runtime:readFixture('clean-song-v2-long-runtime.json'),media:[]};}
function fractionalDescriptor(){
 const fixture=readFixture('clean-midi-fractional-navigation.json'),descriptor=cleanDescriptor(),metadata=JSON.parse(descriptor.metadata_json);
 descriptor.score_json=JSON.stringify(fixture.complete_score);descriptor.runtime=fixture.runtime;
 metadata.id=fixture.complete_score.notation.id;metadata.title=fixture.complete_score.notation.title;metadata.sources=[fixture.complete_score.source];
 metadata.score={path:'score.json',bytes:Buffer.byteLength(descriptor.score_json),sha256:createHash('sha256').update(descriptor.score_json).digest('hex')};
 descriptor.metadata_json=JSON.stringify(metadata);return descriptor;
}

test('initial tempo projection disclosure follows locale in clean preview and score details without changing source evidence',async()=>{
 const original='Canonical notation uses the final source-ordered tick-zero tempo; complete commands remain retained.';
 const descriptor=cleanDescriptor(({runtime})=>runtime.compilation.diagnostics.push({severity:'warning',code:'midi_initial_tempo_projection',message:original,note_id:null}));
 const before=JSON.stringify(descriptor),{app}=await setup({descriptor});
 try{
  const i18n=getAppI18n(app.document),preview=app.$('preview-notice-list');
  assert.match(preview.textContent,/final declaration at tick zero controls subsequent timing/);
  assert.doesNotMatch(preview.textContent,/Canonical notation uses/);
  i18n.setLocale('zh-CN');
  assert.match(preview.textContent,/零时刻最后一次速度声明用于后续计时/);
  assert.match(preview.textContent,/先前声明仍被保留/);
  assert.doesNotMatch(preview.textContent,/Canonical|opening tempo|Earlier declarations/);
  await activate(app,'listen');await app.click('play-button');
  const details=app.$('diagnostic-list');
  assert.match(details.textContent,/midi_initial_tempo_projection/);
  assert.match(details.textContent,/零时刻最后一次速度声明用于后续计时/);
  assert.doesNotMatch(details.textContent,/Canonical|opening tempo|Earlier declarations/);
  i18n.setLocale('en');assert.match(details.textContent,/Earlier declarations are retained/);assert.doesNotMatch(details.textContent,/起始速度|先前声明/);
  assert.equal(JSON.stringify(descriptor),before);
 }finally{await app.close();}
});

function standardMidiScore(){
 const score=authoredScore({id:'authored-standard-midi',title:'Original <MIDI title> 原题',composer:'Original <author> 作者'});
 const last=structuredClone(score.parts[0].notes[1]);last.id='g4';last.at.numerator=2;last.pitch.step='G';score.parts[0].notes.push(last);
 score.provenance={kind:'user_import',attribution:standardMidiDisclosure.en.attribution,source_url:null,license:null};
 const diagnostics=Object.entries(standardMidiDisclosure.en.warnings).map(([code,message])=>({severity:'warning',code,message,note_id:null}));
 diagnostics[2].message='Canonical notation uses the final source-ordered tick-zero tempo; complete commands remain retained.';
 score.source={format:'midi-base64',filename:'authored-initial-tempos.mid',content:orderedInitialTempoBrowserMidi().toString('base64'),import_diagnostics:diagnostics};
 return score;
}

test('standard MIDI known warnings and generated attribution follow locale across import, preview and details without altering saved evidence or exports',async()=>{
 const {app,server}=await setup(),imported=standardMidiScore();
 const unknown={severity:'warning',code:'authored_unknown_warning',message:`Retained import observation: ${standardMidiDisclosure.en.warnings.midi_notation_inferred} <original detail> 原文`,note_id:null};
 imported.source.import_diagnostics.push(unknown);
 const original=JSON.stringify(imported),diagnostics=imported.source.import_diagnostics.map(item=>({...item,message:`Retained import observation: ${item.message}`})),diagnosticBytes=JSON.stringify(diagnostics);
 server.setRoute(({path})=>path==='/api/import/midi'?nativeResponse({score:imported,diagnostics}):undefined);
 try{
  const i18n=getAppI18n(app.document);i18n.setLocale('zh-CN');
  const bytes=orderedInitialTempoBrowserMidi(),file={name:'authored-initial-tempos.mid',size:bytes.length,arrayBuffer:async()=>Uint8Array.from(bytes).buffer};
  Object.defineProperty(app.$('score-file'),'files',{configurable:true,value:[file]});app.emit(app.$('score-file'),'change');
  await app.until(()=>app.$('score-title').textContent===imported.title&&!app.$('play-button').disabled);
  await app.until(()=>[...server.records.values()].some(row=>row.entry.score_id===imported.id));
  const detailRows=[...app.$('diagnostic-list').children],previewRows=[...app.$('preview-notice-list').children],provenance=app.$('provenance');
  const requestCount=app.requests.length;
  for(const locale of ['zh-CN','en','zh-CN']){
   i18n.setLocale(locale);const expected=standardMidiDisclosure[locale],messages=Object.values(expected.warnings);
   assert.equal(app.$('notice-message').textContent,[...messages,diagnostics.at(-1).message].join(' '));
   assert.deepEqual(detailRows.map(row=>row.textContent),[...Object.entries(expected.warnings).map(([code,message])=>`${code}: ${message}`),`${unknown.code}: ${diagnostics.at(-1).message}`]);
   assert.deepEqual(previewRows.map(row=>row.textContent),[...messages,diagnostics.at(-1).message]);
   assert.ok(provenance.textContent.includes(expected.attribution));
   assert.equal(provenance.textContent.includes(standardMidiDisclosure[locale==='en'?'zh-CN':'en'].attribution),false);
   assert.deepEqual([...app.$('diagnostic-list').children],detailRows);assert.deepEqual([...app.$('preview-notice-list').children],previewRows);assert.equal(app.$('provenance'),provenance);
   assert.equal(app.$('score-title').textContent,imported.title);assert.ok(app.$('score-meta').textContent.includes(imported.composer));
   assert.equal(app.$('preview-title').textContent,imported.title);assert.ok(app.$('preview-meta').textContent.includes(imported.composer));
   assert.equal(app.$('diagnostic-list').querySelector('original'),null);assert.equal(app.$('score-title').children.length,0);
   assert.equal(app.requests.length,requestCount,'Locale changes must not import or recompile');
  }
  await app.click('back-to-library');assert.equal(app.document.body.dataset.screen,'library');
  assert.deepEqual([...app.$('preview-notice-list').children].map(row=>row.textContent),[...Object.values(standardMidiDisclosure['zh-CN'].warnings),diagnostics.at(-1).message]);
  await app.click('resume-session');await app.exported('export-button');const chineseExport=await app.downloads.at(-1).text();
  i18n.setLocale('en');await app.exported('export-button');assert.equal(await app.downloads.at(-1).text(),chineseExport);
  assert.equal(chineseExport,JSON.stringify(imported,null,2));
  await app.click('source-files-button');
  for(const [index,expectedBytes] of [Buffer.from(imported.source.content),bytes].entries()){
   app.document.querySelector(`#source-archive-files [data-source-file-index="${index}"]`).click();
   await app.until(()=>!app.$('source-archive-download').disabled);
   for(const locale of ['zh-CN','en']){
    i18n.setLocale(locale);await app.click('source-archive-download');
    assert.deepEqual(Buffer.from(await app.downloads.at(-1).arrayBuffer()),expectedBytes,'Retained source and decoded MIDI downloads stay byte-for-byte identical');
   }
  }
  await app.click('source-archive-close');
  const saved=[...server.records.values()].find(row=>row.entry.score_id===imported.id);assert.equal(saved.score_json,original);
  assert.equal(JSON.stringify(imported),original);assert.equal(JSON.stringify(diagnostics),diagnosticBytes);assert.deepEqual(i18n.getReports(),[]);
 }finally{await app.close();}
});

test('only the exact standard MIDI generated attribution is localized; authored rights and unknown errors stay literal',async()=>{
 const {app,server}=await setup();
 try{
  let index=0;const i18n=getAppI18n(app.document);
  for(const change of [
   score=>{score.provenance.attribution='Original author <credits> 原文';},
   score=>{score.provenance.attribution+=' ';},
   score=>{score.provenance.kind='original_exercise';},
   score=>{score.provenance.license='CC-BY-4.0';},
   score=>{score.provenance.source_url='https://example.com/original';},
   score=>{score.source.format='musicxml';},
   score=>{score.source=null;},
  ]){
   const score=standardMidiScore();score.id+=`-literal-${index++}`;score.title=score.id;change(score);const original=JSON.stringify(score);
   app.importFile(score);await app.until(()=>app.$('score-title').textContent===score.title&&!app.$('play-button').disabled);
   for(const locale of ['zh-CN','en']){
    i18n.setLocale(locale);assert.ok(app.$('provenance').textContent.includes(score.provenance.attribution));
    assert.equal(app.$('provenance').textContent.includes(standardMidiDisclosure['zh-CN'].attribution),false);assert.equal(app.$('provenance').querySelector('credits'),null);
   }
   assert.deepEqual(await app.exported('export-button'),score);assert.equal(JSON.stringify(score),original);
  }
  const error=`${standardMidiDisclosure.en.warnings.midi_key_release_timing} <unknown error> 原文`;
  server.setRoute(({path})=>path==='/api/import/midi'?nativeResponse({error},400):undefined);
  const file={name:'unknown-error.mid',size:1,arrayBuffer:async()=>new ArrayBuffer(1)};
  Object.defineProperty(app.$('score-file'),'files',{configurable:true,value:[file]});app.emit(app.$('score-file'),'change');
  await app.until(()=>app.$('notice').textContent.includes(error));
  for(const locale of ['zh-CN','en']){i18n.setLocale(locale);assert.ok(app.$('notice').textContent.includes(error));assert.equal(app.$('notice').querySelector('unknown'),null);}
  assert.deepEqual(i18n.getReports(),[]);
 }finally{await app.close();}
});

test('ordinary library consumes exact runtime, all-part notation and program-aware Listen without recompiling timing',async()=>{const {app,descriptor}=await setup();try{
 assert.equal(app.$('clean-song-routing').hidden,true);assert.equal(app.$('clean-song-routing').textContent,'');
 assert.equal(app.$('preview-part').children.length,2);assert.equal(app.$('preview-part').value,descriptor.runtime.compilation.score.parts[0].id);assert.match(app.$('clean-song-preview-status').textContent,/3 tracks.*2 parts.*5 notes/);assert.equal(app.document.querySelector('.lobby-audition').hidden,true);
 const compiledBefore=app.requests.filter(request=>request.path==='/api/compile').length;await activate(app,'listen');assert.equal(app.$('clean-song-stage').dataset.rendererState,'playing');assert.equal(app.$('notation-part').value,'');assert.equal(app.$('engraving-part').value,'');assert.equal(app.requests.filter(request=>request.path==='/api/compile').length,compiledBefore);assert.equal(runningOscillators(app).length,4);assert.equal(app.plays.filter(args=>String(args[0]).startsWith('score:')).length,0);assert.equal(app.$('tempo').disabled,true);assert.equal(app.$('loop-enabled').disabled,true);assert.equal(app.$('export-button').disabled,true);
 await app.click('play-button');assert.equal(app.$('clean-song-stage').dataset.rendererState,'paused');assert.equal(runningOscillators(app).length,0);assert.ok(app.audioNodes.filter(node=>node.kind==='convolver').every(node=>node.buffer===null));await app.click('play-button');assert.equal(runningOscillators(app).length,4);await app.click('reset-button');assert.equal(app.$('clean-song-stage').dataset.rendererState,'ready');assert.equal(runningOscillators(app).length,0);assert.equal(readPlaybackClock(app.document).positionMs,0);
 }finally{await app.close();}});

test('practice target and accompaniment toggles keep stable controls; only human input can enter scoring',async()=>{const {app,score}=await setup();try{
 await activate(app,'practice');assert.equal(runningOscillators(app).length,2);await app.click('play-button');let take=await app.exported('export-takes');assert.deepEqual(take.passes[0].inputs,[]);assert.deepEqual(take.passes[0].captures,[]);assert.ok(take.passes[0].timeline.notes.every(note=>note.part_id===score.parts[0].id));assert.equal(take.passes[0].timeline.notes.at(-1).duration_ms,800);
 const target=app.$('clean-song-target'),checkbox=app.document.querySelector(`#clean-song-parts input[data-part-id="${score.parts[0].id}"]`);target.value=score.parts[1].id;app.emit(target,'change');await app.until(()=>!app.$('play-button').disabled);assert.equal(app.$('clean-song-target'),target);assert.equal(app.document.querySelector(`#clean-song-parts input[data-part-id="${score.parts[0].id}"]`),checkbox);checkbox.checked=false;app.emit(checkbox,'change');await app.click('play-button');assert.equal(runningOscillators(app).length,0);take=await app.exported('export-takes');assert.equal(take.practice_part,score.parts[1].id);assert.equal(take.passes[0].timeline.notes.length,2);assert.deepEqual(take.passes[0].inputs,[]);await app.click('play-button');checkbox.checked=true;app.emit(checkbox,'change');await app.click('play-button');assert.equal(runningOscillators(app).length,2);await app.click('back-to-library');assert.equal(runningOscillators(app).length,0);
 }finally{await app.close();}});

test('complete-song media has gesture lifecycle, localized optional failure and navigation cleanup',async()=>{let clock=1000;const {app}=await setup({media:true,now:()=>clock});try{
 await app.until(()=>Boolean(app.$('clean-song-cover').src));app.$('clean-song-cover').onload();assert.equal(app.$('clean-song-cover').hidden,false);
 const video=app.$('clean-song-pv');let plays=0,pauses=0;video.pause=()=>{pauses++;video.paused=true;};video.play=()=>{plays++;video.paused=false;return Promise.resolve();};video.load=()=>{};
 assert.equal(plays,0);await activate(app,'listen');await app.until(()=>Boolean(video.src));video.onloadeddata();app.frame();assert.equal(video.muted,true);assert.equal(plays,0,'Shared start admission has not reached song zero yet');clock+=65;app.frame();await app.tick();assert.equal(plays,1);
 await app.click('play-button');assert.equal(video.paused,true);getAppI18n(app.document).setLocale('zh-CN');app.$('clean-song-background').onerror();assert.match(app.$('clean-song-media-status').textContent,/背景无法显示/);assert.doesNotMatch(app.$('clean-song-preview').textContent,/inferred|Reference|channel /);await app.click('back-to-library');assert.equal(video.hidden,true);assert.equal(video.paused,true);assert.ok(pauses>0);
 }finally{await app.close();}});

test('complete-song start admits a metadata-only PV on the shared clock before its first decoded frame',async()=>{
 let clock=1000;const {app}=await setup({media:true,now:()=>clock});
 try{
  const video=app.$('clean-song-pv');let plays=0;
  Object.defineProperty(video,'src',{configurable:true,get(){return this.getAttribute('src')||'';},set(value){this.setAttribute('src',value);}});
  video.readyState=0;video.pause=()=>{video.paused=true;};video.play=()=>{plays++;video.paused=false;return Promise.resolve();};
  video.load=()=>{if(!video.src)return;video.readyState=1;video.duration=5;video.onloadedmetadata?.();};
  await activate(app,'listen');await app.until(()=>Boolean(video.src));
  assert.equal(plays,0,'Admission still waits for the shared song-zero boundary');assert.equal(video.hidden,true);
  clock+=65;app.frame();await app.tick();
  assert.equal(plays,1,'The admitted renderer must request playback even when preload has supplied only metadata');
  assert.ok(runningOscillators(app).length>0);assert.equal(video.hidden,true,'play() alone does not certify a decoded frame');
  await app.click('play-button');video.readyState=2;video.onloadeddata();app.frame();await app.tick();
  assert.equal(video.hidden,false);assert.equal(video.paused,true);assert.equal(plays,1,'Late data cannot restart a paused song');
  await app.click('back-to-library');assert.equal(video.hidden,true);assert.equal(video.src,'');
 }finally{await app.close();}
});

test('a late audio unlock cannot activate clean audio after another song selection',async()=>{const {app}=await setup();try{const pending=deferred();app.setUnlock(()=>pending.promise);await app.click('start-listen');await app.click('home-single-player');const bundled=app.document.querySelector('#catalog [data-score-id]');bundled.click();await app.until(()=>app.$('clean-song-preview').hidden);pending.resolve();await app.tick();assert.equal(runningOscillators(app).length,0);}finally{await app.close();}});

test('range summary retains all notes and 88-key action changes device range without transposition',async()=>{const {app,score}=await setup();try{await activate(app,'listen');await app.click('play-button');assert.match(app.$('song-complete-range-text').textContent,/5 notes/);const original=JSON.stringify(score.parts);await app.click('song-use-piano-88');assert.equal(app.$('key-count').value,'88');assert.equal(JSON.stringify(score.parts),original);assert.equal(app.$('song-use-piano-88').hidden,true);app.$('tempo').value='130';app.emit(app.$('tempo'),'change');assert.equal(app.$('tempo').value,'120');assert.equal(app.requests.filter(request=>request.path==='/api/transpose').length,0);}finally{await app.close();}});


test('ordinary All display stays independent of the human part, while explicit Current follows it',async()=>{const {app,score}=await setup();try{
 await app.click('home-single-player');const standard=structuredClone(score);standard.id='ordinary-two-part';app.importFile(standard);await app.until(()=>app.$('score-title')?.textContent===standard.title&&!app.$('play-button').disabled);
 assert.equal(app.$('song-parts-tools').hidden,true);const second=standard.parts[1].id;app.$('practice-part').value=second;app.emit(app.$('practice-part'),'change');await app.until(()=>!app.$('play-button').disabled);assert.equal(app.$('notation-part').value,'');assert.equal(app.$('engraving-part').value,'');app.$('notation-scope').value='current';app.emit(app.$('notation-scope'),'change');await app.tick();assert.equal(app.$('notation-part').value,second);assert.equal(app.$('engraving-part').value,second);assert.equal(app.$('practice-part').value,second);
 }finally{await app.close();}});

test('native current-note and page following use the admitted all-part runtime through part changes',async()=>{
 let clock=1000;const descriptor=longDescriptor(),before=JSON.stringify(descriptor),{app,score}=await setup({descriptor,now:()=>clock});
 try{
  await activate(app,'listen');await app.click('staff-button');await app.click('notation-toggle');app.frame();
  await app.until(()=>app.$('written-cursor-status').dataset.status==='ready','Native written cursor did not become ready');
  clock=1051;app.frame();
  const at=position=>descriptor.runtime.notes.filter(n=>n.start_ms<=position&&position<n.end_ms).map(n=>n.note_id).sort();
  const active=()=>[...app.document.querySelectorAll('#notation .score-note.active')].map(n=>n.dataset.noteId).sort();
  assert.deepEqual(active(),at(1));assert.equal(active().length,2);
  const second=score.parts[1].id;app.$('notation-part').value=second;app.emit(app.$('notation-part'),'change');app.frame();
  assert.deepEqual(active(),at(1).filter(id=>score.parts[1].notes.some(n=>n.id===id)));
  app.$('engraving-follow').checked=true;app.emit(app.$('engraving-follow'),'change');await app.tick();
  clock=1050+28010;app.frame();
  assert.equal(app.$('written-cursor-status').dataset.sourceMeasureIndex,'14');
  assert.match(app.$('notation-page').textContent,/15\s*\/\s*16/);
  assert.deepEqual(active(),at(28010).filter(id=>score.parts[1].notes.some(n=>n.id===id)));
  assert.equal(app.requests.filter(r=>r.path==='/api/notation-navigation'&&r.body.id===score.id).length,0);
  assert.equal(JSON.stringify(descriptor),before);
  await app.click('play-button');app.$('clean-song-target').value=second;app.emit(app.$('clean-song-target'),'change');await app.until(()=>!app.$('play-button').disabled);app.frame();
  assert.equal(app.$('written-cursor-status').dataset.status,'ready');assert.equal(app.$('notation-part').value,second);
  assert.equal(app.$('written-cursor-status').dataset.sourceMeasureIndex,'0');
  const ordinary=structuredClone(score);ordinary.id='ordinary-after-native';ordinary.title='Ordinary after native';
  for(const part of ordinary.parts)for(const note of part.notes)note.id=`ordinary-${note.id}`;
  app.importFile(ordinary);await app.until(()=>app.$('score-title').textContent===ordinary.title&&!app.$('play-button').disabled);app.frame();await app.tick();
  assert.ok(app.requests.some(r=>r.path==='/api/notation-navigation'&&r.body.id===ordinary.id),'A later ordinary import uses its own legacy request');
  assert.equal(app.$('written-cursor-status').dataset.status,'unavailable','The unimplemented ordinary fixture response cannot reuse native readiness');
  assert.equal(app.$('written-cursor-status').dataset.sourceNoteIds,'[]');assert.deepEqual(active(),[]);
 }finally{await app.close();}
});

test('actual fractional-tempo Rust package reaches ready and highlights each native current note in the app',async()=>{
 let clock=1000;const descriptor=fractionalDescriptor(),before=JSON.stringify(descriptor),{app,score}=await setup({descriptor,now:()=>clock});
 try{
  await activate(app,'listen');await app.click('staff-button');await app.click('notation-toggle');app.frame();
  await app.until(()=>app.$('written-cursor-status').dataset.status==='ready');
  for(const note of descriptor.runtime.notes){
   clock=1050+(note.start_ms+note.end_ms)/2;app.frame();
   assert.deepEqual(JSON.parse(app.$('written-cursor-status').dataset.sourceNoteIds),[note.note_id]);
   assert.deepEqual([...app.document.querySelectorAll('#notation .score-note.active')].map(n=>n.dataset.noteId),[note.note_id]);
   assert.equal(app.$('written-cursor-status').dataset.sourceMeasureIndex,'0');assert.match(app.$('notation-page').textContent,/1\s*\/\s*1/);
  }
  assert.equal(app.requests.filter(r=>r.path==='/api/notation-navigation'&&r.body.id===score.id).length,0);
  assert.equal(JSON.stringify(descriptor),before);
 }finally{await app.close();}
});

test('native unavailable maps expose an explicit retry state without a floating-BPM fallback',async()=>{
 const descriptor=cleanDescriptor(({runtime})=>{runtime.navigation=null;runtime.compilation.diagnostics.push({severity:'warning',code:'clean_song_navigation_unavailable',message:'Original test: native navigation limit reached.'});});
 const {app,score}=await setup({descriptor});
 try{
  await activate(app,'listen');await app.click('staff-button');await app.click('notation-toggle');app.frame();
  await app.until(()=>app.$('written-cursor-status').dataset.status==='unavailable');
  assert.match(app.$('written-cursor-status').title,/native navigation limit reached/);
  assert.equal(app.$('written-cursor-retry').hidden,false);assert.ok(app.document.querySelector('#notation .score-note'));
  await app.click('written-cursor-retry');assert.equal(app.$('written-cursor-status').dataset.status,'unavailable');
  assert.equal(app.requests.filter(r=>r.path==='/api/notation-navigation'&&r.body.id===score.id).length,0);
 }finally{await app.close();}
});

test('native cursor bounds keep measure pages following without claiming exact current notes',async()=>{
 let clock=1000;const descriptor=longDescriptor();descriptor.runtime.navigation.written_cursor=null;
 descriptor.runtime.navigation.diagnostics.push({severity:'warning',code:'notation_written_cursor_unavailable',message:'Original test: written cursor exceeds its bound; measure following remains available.'});
 const {app,score}=await setup({descriptor,now:()=>clock});
 try{
  await activate(app,'listen');await app.click('staff-button');await app.click('notation-toggle');app.frame();
  await app.until(()=>app.$('written-cursor-status').dataset.status==='unavailable');await app.tick();
  clock=1050+28010;app.frame();
  assert.equal(app.$('engraving-follow').checked,true);assert.match(app.$('notation-page').textContent,/15\s*\/\s*16/);
  assert.match(app.$('engraving-follow-status').textContent,/written measure 15/);
  assert.equal(app.$('written-cursor-status').dataset.sourceNoteIds,'[]');assert.equal(app.document.querySelectorAll('#notation .score-note.active').length,0);
  assert.equal(app.requests.filter(r=>r.path==='/api/notation-navigation'&&r.body.id===score.id).length,0);
 }finally{await app.close();}
});

test('both app fingering contexts route the active complete song through its native source binding',async()=>{
 const {app,server,descriptor,score,key}=await setup({descriptor:fractionalDescriptor()});
 server.setRoute(({path,body})=>{
  if(!['/api/library/fingering/piano','/api/library/fingering/guitar'].includes(path))return;
  const request=body.settings,timeline=descriptor.runtime.compilation.timeline;
  // This transport fixture exercises routing/admission, without impersonating a Rust solver.
  const plan=path.endsWith('/piano')?unavailablePianoResult({score,...request},timeline):{version:1,algorithm:'deterministic_guitar_beam_v1',score_id:score.id,part_id:request.part_id,profile:request.profile,status:'unavailable',complete:false,changed_source_notes:false,source_occurrence_count:timeline.notes.filter(note=>request.part_id===null||note.part_id===request.part_id).length,max_fret_span:request.max_fret_span,beam_width:64,explored_choices:0,beam_pruned:false,objective_cost:null,requested_locks:request.locks,assignments:[],diagnostics:[{code:'frontend_fixture_no_guitar_solver',severity:'warning',message:'No Rust solver in this frontend transport fixture.',note_id:null}]};
  return nativeResponse({source:body.source,plan});
 });
 try{
  await activate(app,'listen');await app.until(()=>app.requests.some(request=>request.path==='/api/library/fingering/piano'));
  await app.until(()=>app.$('piano-fingering-status').dataset.phase==='unavailable');
  app.$('instrument').value='guitar';app.emit(app.$('instrument'),'change');
  await app.until(()=>app.requests.some(request=>request.path==='/api/library/fingering/guitar'));
  await app.until(()=>app.$('guitar-planning').dataset.status==='unavailable');
  for(const request of app.requests.filter(request=>request.path.startsWith('/api/library/fingering/'))){
   assert.deepEqual(request.body.source,{key,content_sha256:descriptor.content_sha256,profile:'wmh-semantic-midi1-v1',choice:null});
   assert.equal(request.body.settings.part_id,score.parts[0].id);assert.equal('score' in request.body.settings,false);
  }
  assert.equal(app.requests.filter(request=>['/api/fingering/piano','/api/fingering/guitar'].includes(request.path)&&request.body.score?.id===score.id).length,0);
 }finally{await app.close();}
});

function logicalDeviceDescriptor(name,otherName=name){
 return cleanDescriptor(({score,runtime})=>{
  for(const events of [score.performance.events,runtime.events])for(const event of events){
   if(event.origin.track>0&&event.origin.event===0)event.command={kind:'text',role:'device_name',text:event.origin.track===1?name:otherName};
  }
 });
}

test('clean-song preview discloses the exact logical device mapping in both languages before explicit listening',async()=>{
 const name='Authored <device> & “键盘”  ',descriptor=logicalDeviceDescriptor(name),before=JSON.stringify(descriptor),{app}=await setup({descriptor});
 try{
  const routing=app.$('clean-song-routing');assert.equal(routing.hidden,false);assert.ok(routing.textContent.includes(name));assert.equal(routing.children.length,0);
  assert.match(routing.textContent,/selected procedural reference receiver/);assert.match(routing.textContent,/source device and timbre are unverified/);assert.match(routing.textContent,/Listen or Practice selects this mapping/);
  getAppI18n(app.document).setLocale('zh-CN');assert.equal(app.$('clean-song-routing'),routing);assert.ok(routing.textContent.includes(name));assert.match(routing.textContent,/逻辑目标.*所选程序合成参考接收器/);assert.match(routing.textContent,/未验证源设备与原始音色/);assert.match(routing.textContent,/选择聆听或练习即选用此映射/);
  await activate(app,'listen');assert.equal(app.$('clean-song-stage').dataset.rendererState,'playing');assert.ok(runningOscillators(app).length>0);
  await app.click('back-to-library');app.document.querySelector('#catalog [data-score-id]').click();await app.until(()=>app.$('clean-song-preview').hidden);assert.equal(routing.hidden,true);assert.equal(routing.textContent,'');
  assert.equal(JSON.stringify(descriptor),before);
 }finally{await app.close();}
});

test('unresolved clean-song logical routes disclose retained data and block reference sound in both languages',async()=>{
 const descriptor=logicalDeviceDescriptor('Authored Device A','Authored Device B'),before=JSON.stringify(descriptor),{app}=await setup({descriptor});
 try{
  assert.equal(app.$('clean-song-routing').hidden,true);assert.match(app.$('clean-song-rendition').textContent,/unresolved logical device route; playback is blocked/);assert.match(app.$('clean-song-rendition').textContent,/Tracks name different logical destinations/);assert.match(app.$('clean-song-rendition').textContent,/All retained data remains in the package/);
  getAppI18n(app.document).setLocale('zh-CN');assert.match(app.$('clean-song-rendition').textContent,/逻辑设备路由无法解析；已阻止播放/);assert.match(app.$('clean-song-rendition').textContent,/音轨声明了不同的逻辑目标/);assert.match(app.$('clean-song-rendition').textContent,/所有数据仍完整保存在曲包中/);
  await activate(app,'listen');assert.equal(app.$('clean-song-stage').dataset.rendererState,'unsupported');assert.equal(runningOscillators(app).length,0);
  await app.click('play-button');assert.equal(runningOscillators(app).length,0);assert.equal(JSON.stringify(descriptor),before);
 }finally{await app.close();}
});

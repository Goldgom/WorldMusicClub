import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {getAppI18n} from '../web/app-locale.js';
import {createI18n} from '../web/i18n.js';
import {SongAuthoringModel} from '../web/song-authoring-model.js';
import {setupSongAuthoringView} from '../web/song-authoring-view.js';
import {nativeStorageApp,deferred,nativeResponse} from './native-storage-app-fixtures.js';
import {selectImportFiles} from './bulk-import-fixtures.js';
import {authoringServer,authoredDraft,authoredVsqDraft,vsqFile,midiFile,packageBlob} from './song-authoring-fixtures.js';
const reviewed=app=>app.$('song-authoring-screen').dataset.phase==='review';
const row=app=>app.document.querySelector('[data-authoring-song]');
const pick=(app,files)=>selectImportFiles(app,files,'authoring-files');
const start=async app=>{await app.until(()=>!app.$('start-listen').disabled);await app.click('home-song-authoring');};

test('real menu opens standalone Chinese authoring, complete inventory includes conductor-only track and never starts audio or saves',async()=>{
 const server=await authoringServer(),app=await nativeStorageApp(server);
 try{
  getAppI18n(app.document).setLocale('zh-CN');await start(app);assert.equal(app.document.body.dataset.screen,'authoring');assert.equal(app.$('song-authoring-screen').hidden,false);assert.equal(app.$('song-authoring-screen').closest('dialog'),null);assert.equal(app.$('workspace').hidden,true);assert.match(app.$('rhythm-location').textContent,/谱面制作/);assert.equal(app.document.querySelector('.skip-link').getAttribute('href'),'#song-authoring-title');
  pick(app,[midiFile()]);await app.until(()=>reviewed(app)&&row(app)?.dataset.phase==='ready');assert.equal(server.records.size,0);assert.equal(app.requests.filter(item=>item.path.endsWith('/commit')).length,0);assert.deepEqual(app.audio(),{contexts:0,unlocks:0});assert.match(row(app).textContent,/严格记谱候选/);assert.match(row(app).textContent,/实际练习与发声仍需/);assert.equal(row(app).querySelectorAll('.authoring-track-list>li').length,2);assert.match(row(app).querySelector('.authoring-track-list').textContent,/无通道事件.*完整保留/);assert.match(row(app).querySelector('.authoring-totals').textContent,/2 个音轨.*9 个事件.*1 个声部/);
  assert.equal(app.document.querySelectorAll('#home-song-authoring').length,1);assert.equal(app.document.querySelectorAll('#song-authoring-screen').length,1);assert.equal(app.$('authoring-save-all').disabled,false);
 }finally{await app.close();}
});
test('title edit regenerates Rust package; explicit save is discoverable, complete export matches and restart retains it',async()=>{
 const server=await authoringServer();let app=await nativeStorageApp(server);
 try{
  await start(app);pick(app,[midiFile()]);await app.until(()=>reviewed(app)&&row(app)?.dataset.phase==='ready');const title=row(app).querySelector('input'),literal='Original <title> $& 原题';title.value=literal;app.emit(title,'input');assert.equal(row(app).dataset.phase,'edited');assert.equal(app.$('authoring-save-all').disabled,true);assert.equal(row(app).querySelector('[data-authoring-export]').hidden,true);
  row(app).querySelector('[data-authoring-recheck]').click();await app.until(()=>reviewed(app)&&row(app)?.dataset.phase==='ready');assert.equal(server.drafts.get('original-ceg.mid').title,literal);assert.equal(row(app).querySelector('script'),null);assert.equal(server.records.size,0);
  row(app).querySelector('[data-authoring-save]').click();await app.until(()=>reviewed(app)&&row(app)?.dataset.phase==='saved');const key=[...server.records.keys()][0];assert.ok(app.savedButton(key));assert.equal(app.$('authoring-save-all').disabled,true);row(app).querySelector('[data-authoring-export]').click();await app.until(()=>app.downloads.length===1);assert.deepEqual(Buffer.from(await app.downloads[0].arrayBuffer()),server.packs.get(key.slice(5)).zip);
  row(app).querySelector('[data-authoring-browse]').click();await app.until(()=>app.document.body.dataset.screen==='library'&&!app.$('clean-song-preview').hidden);assert.equal(app.savedButton(key).classList.contains('selected'),true);
  await app.close();app=await nativeStorageApp(server);await app.until(()=>app.savedButton(key));assert.equal(app.savedButton(key).querySelector('strong').textContent,literal);assert.equal(server.records.size,1);
 }finally{await app.close();}
});
test('editing and conversion leave the canonical score, active take, source export and preview identity unchanged',async()=>{
 const server=await authoringServer(),app=await nativeStorageApp(server);
 try{
  await app.until(()=>!app.$('start-practice').disabled);await app.click('home-single-player');app.$('count-in').checked=false;await app.click('start-practice');await app.until(()=>app.document.body.dataset.screen==='stage'&&!app.$('play-button').disabled);const key=app.$('keyboard').querySelector('[data-midi="60"]');app.emit(key,'pointerdown',{pointerId:8,button:0});app.emit(key,'pointerup',{pointerId:8});await app.click('back-to-library');
  const source=await app.exported('export-button'),take=await app.exported('export-takes'),preview=app.$('song-lobby').dataset.previewId,title=app.$('score-title').textContent,audioBefore=app.audio();await app.click('lobby-home');await app.click('home-song-authoring');pick(app,[midiFile(),midiFile('held-original.mid'),midiFile('events-original.mid'),vsqFile()]);await app.until(()=>reviewed(app));
  assert.deepEqual(await app.exported('export-button'),source);assert.deepEqual(await app.exported('export-takes'),take);assert.equal(app.$('song-lobby').dataset.previewId,preview);assert.equal(app.$('score-title').textContent,title);assert.deepEqual(app.audio(),audioBefore);assert.equal(app.document.body.dataset.screen,'authoring');assert.equal(server.records.size,0);
 }finally{await app.close();}
});
test('event-only and held rows keep distinct limits and never offer a held save or export',async()=>{
 const server=await authoringServer(),app=await nativeStorageApp(server);
 try{
  await start(app);pick(app,[midiFile('events-original.mid'),midiFile('held-original.mid')]);await app.until(()=>reviewed(app));const rows=[...app.document.querySelectorAll('[data-authoring-song]')];assert.match(rows[0].textContent,/Event-preserving \/ reference candidate/);assert.match(rows[0].textContent,/Scored notation is not admitted/);assert.equal(rows[1].dataset.phase,'held');assert.equal(rows[1].querySelector('[data-authoring-save]').hidden,true);assert.equal(rows[1].querySelector('[data-authoring-export]').hidden,true);assert.match(rows[1].textContent,/tracks are never discarded/);assert.equal(app.requests.filter(item=>item.path==='/api/clean-song/draft/pack').length,1);
  getAppI18n(app.document).setLocale('zh-CN');assert.match(rows[0].textContent,/事件保全 \/ 参考候选/);assert.match(rows[1].textContent,/不会丢弃音轨/);assert.equal(server.records.size,0);
 }finally{await app.close();}
});
test('locale changes preserve editor identity, literal titles, draft checks and opened inventory without extra requests',async()=>{
 const server=await authoringServer(),app=await nativeStorageApp(server);
 try{
  await start(app);pick(app,[midiFile('原题 $& <literal>.mid')]);await app.until(()=>reviewed(app));const original=row(app),input=original.querySelector('input'),inventory=original.querySelector('.authoring-inventory');inventory.open=true;app.$('song-authoring-screen').scrollTop=220;const calls=app.requests.length,draft=structuredClone([...server.drafts.values()][0]);
  for(const locale of ['zh-CN','en','zh-CN']){getAppI18n(app.document).setLocale(locale);assert.equal(row(app),original);assert.equal(row(app).querySelector('input'),input);assert.equal(input.value,'原题 $& <literal>');assert.equal(inventory.open,true);assert.equal(app.$('song-authoring-screen').scrollTop,220);assert.equal(app.requests.length,calls);assert.deepEqual([...server.drafts.values()][0],draft);assert.equal(row(app).querySelector('literal'),null);}
  assert.doesNotMatch(app.$('authoring-status').textContent,/Review|Save|Waiting/);assert.match(original.querySelector('.authoring-classification').textContent,/严格记谱候选/);
 }finally{await app.close();}
});
test('route change invalidates late draft and late native save results, never navigates back or starts the next save',async()=>{
 const server=await authoringServer(),draftGate=deferred(),saveGate=deferred();let waitingDraft=true,waitingSave=false;server.setAuthoringRoute(async({path})=>{if(path==='/api/clean-song/draft'&&waitingDraft)await draftGate.promise;if(path==='/api/library/import/commit'){waitingSave=true;await saveGate.promise;}});const app=await nativeStorageApp(server);
 try{
  await start(app);pick(app,[midiFile()]);await app.until(()=>app.requests.some(item=>item.path==='/api/clean-song/draft'));await app.click('authoring-home');draftGate.resolve();await app.tick();await app.tick();assert.equal(app.document.body.dataset.screen,'home');assert.equal(row(app).dataset.phase,'cancelled');assert.equal(app.requests.some(item=>item.path==='/api/clean-song/draft/pack'),false);
  waitingDraft=false;await app.click('home-song-authoring');pick(app,[midiFile('first.mid'),midiFile('second.mid')]);await app.until(()=>reviewed(app));await app.click('authoring-save-all');await app.until(()=>waitingSave);await app.click('authoring-home');assert.equal(row(app).dataset.phase,'uncertain');saveGate.resolve();await app.until(()=>server.records.size===1);await app.until(()=>app.$('authoring-choose').disabled===false);assert.equal(app.document.body.dataset.screen,'home');assert.equal(row(app).dataset.phase,'uncertain');assert.equal(app.requests.filter(item=>item.path==='/api/library/import/commit').length,1);assert.equal(app.document.querySelectorAll('#catalog [data-library-key]').length,1);
  await app.click('home-song-authoring');assert.match(row(app).textContent,/Save outcome unconfirmed/);assert.equal(row(app).querySelector('[data-authoring-retry-save]').hidden,false);row(app).querySelector('[data-authoring-retry-save]').click();await app.until(()=>reviewed(app)&&row(app).dataset.phase==='duplicate');assert.equal(server.records.size,1);
 }finally{draftGate.resolve();saveGate.resolve();await app.close();}
});
test('browser-only screen clearly offers complete download, never save, and cancels late export on navigation',async()=>{
 const {document,window}=parseHTML('<html><body><div class="app-shell"></div></body></html>'),i18n=createI18n({locale:'zh-CN'}),downloads=[];let commits=0;
 const model=new SongAuthoringModel({getStorageKind:async()=> 'browser',transport:{draft:async(file,{title})=>authoredDraft({sourceName:file.name,title}),pack:async()=>packageBlob()},imports:{commit:async()=>{commits++;}}}),view=setupSongAuthoringView({document,i18n,model,download:async(_document,blob)=>downloads.push(await blob.text())});
 try{
  view.screenChanged('authoring');await model.select([midiFile()]);assert.match(document.getElementById('authoring-storage').textContent,/浏览器模式.*原生应用/);assert.equal(document.getElementById('authoring-save-all').hidden,true);assert.equal(document.querySelector('[data-authoring-save]').hidden,true);document.querySelector('[data-authoring-export]').click();await new Promise(resolve=>setImmediate(resolve));assert.equal(downloads.length,1);assert.equal(commits,0);assert.match(document.querySelector('.authoring-download').textContent,/请求下载/);
  const exportGate=deferred();model.export=async()=>{await exportGate.promise;return{blob:packageBlob(),id:'1',generation:model.generation,filename:'complete.zip'};};document.querySelector('[data-authoring-export]').click();view.screenChanged('home');exportGate.resolve();await new Promise(resolve=>setImmediate(resolve));assert.equal(downloads.length,1);assert.equal(document.getElementById('song-authoring-screen').hidden,true);assert.ok(window);
 }finally{view.destroy();}
});
test('actual Rust rejected inventory and known diagnostics show Chinese explanations while original details remain unchanged',async()=>{
 const {readFile}=await import('node:fs/promises'),draft=JSON.parse(await readFile(new URL('./fixtures/song-authoring/rejected-response.json',import.meta.url),'utf8')),before=structuredClone(draft);
 const {document}=parseHTML('<html><body><div class="app-shell"></div></body></html>'),i18n=createI18n({locale:'zh-CN'}),model=new SongAuthoringModel({getStorageKind:async()=> 'browser',transport:{draft:async()=>draft},imports:{}}),view=setupSongAuthoringView({document,i18n,model});
 try{
  view.screenChanged('authoring');await model.select([midiFile()]);const item=document.querySelector('[data-authoring-song]'),primary=item.querySelector('.authoring-diagnostic-list');assert.equal(item.dataset.phase,'held');assert.match(item.querySelector('.authoring-totals').textContent,/1 个音轨.*13 个事件.*0 个声部/);assert.match(primary.textContent,/音色编号.*完整转换暂缓/);assert.match(primary.textContent,/涉及音轨 1/);assert.doesNotMatch(primary.textContent,/Program|Controller|Resolve|Keep|Track/);
  const technical=item.querySelector('.authoring-notes details'),original=technical.textContent;assert.equal(technical.hasAttribute('open'),false);assert.match(original,/Controller 2 at t0:e4/);assert.match(technical.querySelector('summary').textContent,/原始技术说明/);assert.equal(item.querySelector('[data-authoring-save]').hidden,true);assert.equal(item.querySelector('[data-authoring-export]').hidden,true);
  i18n.setLocale('en');assert.match(item.querySelector('.authoring-diagnostic-list').textContent,/Complete conversion is held/);assert.deepEqual(draft,before);assert.match(item.querySelector('.authoring-notes details').textContent,/Controller 2 at t0:e4/);
 }finally{view.destroy();}
});

test('VSQ review separates raw tracks and logical vocal parts, keeps locale changes lossless and requires explicit library choice after save and restart',async()=>{
 const server=await authoringServer();let app=await nativeStorageApp(server);
 try{
  await start(app);assert.match(app.$('home-song-authoring').textContent,/MIDI or VSQ/);assert.match(app.$('authoring-files').getAttribute('accept'),/\.vsq/);pick(app,[vsqFile()]);await app.until(()=>reviewed(app)&&row(app)?.dataset.phase==='ready');const original=row(app),input=original.querySelector('input'),inventory=original.querySelector('.authoring-inventory'),draft=structuredClone(server.drafts.get('original.vsq'));inventory.open=true;
  assert.match(original.querySelector('.authoring-classification').textContent,/VSQ authoring \/ base-note instrumental candidate/);assert.match(original.querySelector('.authoring-phase').textContent,/practice projection not chosen/);assert.match(original.textContent,/not the original voice or audio/);assert.match(original.querySelector('.authoring-totals').textContent,/Raw SMF: 4 tracks.*152 events.*0 attacks \/ 0 releases/);assert.equal(original.querySelectorAll('.authoring-track-list>li').length,4);assert.equal(original.querySelectorAll('.authoring-vsq-parts>li').length,3);const parts=[...original.querySelectorAll('.authoring-vsq-parts>li')];assert.match(parts[0].textContent,/source track 2; no MIDI channel assigned/);assert.match(parts[0].textContent,/1 authored notes.*1 singer records.*1 lyric records.*3 curves \/ 3 curve points/);assert.match(parts[1].textContent,/Part mute: on/);assert.match(parts[2].textContent,/0 authored notes/);assert.doesNotMatch(original.querySelector('.authoring-track-list').textContent,/Part vsq-track/);assert.equal(server.records.size,0);assert.deepEqual(app.audio(),{contexts:0,unlocks:0});
  getAppI18n(app.document).setLocale('zh-CN');assert.equal(row(app),original);assert.equal(original.querySelector('input'),input);assert.equal(inventory.open,true);assert.match(original.querySelector('.authoring-classification').textContent,/基础音符器乐候选/);assert.match(original.querySelector('.authoring-vsq-parts').textContent,/无 MIDI 通道分配/);assert.match(original.querySelector('.authoring-diagnostic-list').textContent,/完整保留.*明确选择/);assert.deepEqual(server.drafts.get('original.vsq'),draft);
  getAppI18n(app.document).setLocale('en');original.querySelector('[data-authoring-save]').click();await app.until(()=>reviewed(app)&&row(app).dataset.phase==='saved');assert.match(row(app).querySelector('.authoring-phase').textContent,/VSQ draft saved; choose a practice projection/);const [key,record]=[...server.records][0];assert.equal(record.clean_package.runtime,null);assert.equal(record.clean_package.score_json,draft.package.score_json);assert.match(record.clean_package.score_json,/9007199254740993/);assert.equal(record.clean_package.metadata_json,draft.package.metadata_json);assert.equal(server.requests.some(call=>call.path==='/api/library/runtime'),false);
  row(app).querySelector('[data-authoring-export]').click();await app.until(()=>app.downloads.length===1);assert.deepEqual(Buffer.from(await app.downloads[0].arrayBuffer()),server.packs.get(key.slice(5)).zip);row(app).querySelector('[data-authoring-recheck]').click();await app.until(()=>reviewed(app)&&row(app).dataset.phase==='duplicate');assert.equal(server.records.size,1);assert.match(row(app).querySelector('.authoring-phase').textContent,/VSQ draft already saved/);row(app).querySelector('[data-authoring-browse]').click();await app.until(()=>app.$('song-lobby').dataset.previewStatus==='choice');assert.equal(app.$('start-listen').disabled,true);assert.equal(app.$('start-practice').disabled,true);assert.equal(app.$('vsq-choose-base-notes').hidden,false);assert.deepEqual(app.audio(),{contexts:0,unlocks:0});
  await app.close();app=await nativeStorageApp(server);await app.until(()=>app.savedButton(key)&&!app.$('start-listen').disabled);await app.click('home-single-player');app.savedButton(key).click();await app.until(()=>app.$('song-lobby').dataset.previewStatus==='choice');assert.equal(app.$('start-listen').disabled,true);assert.equal(app.$('start-practice').disabled,true);assert.equal(server.requests.some(call=>call.path==='/api/library/runtime'),false);assert.deepEqual(app.audio(),{contexts:0,unlocks:0});assert.equal(server.records.get(key).clean_package.score_json,draft.package.score_json);
 }finally{await app.close();}
});

test('held VSQ retains muted and note-free inventories with actionable limits and no package actions',async()=>{
 const server=await authoringServer(),app=await nativeStorageApp(server);
 try{
  await start(app);pick(app,[vsqFile('held-original.vsq')]);await app.until(()=>reviewed(app)&&row(app)?.dataset.phase==='held');assert.equal(row(app).querySelectorAll('.authoring-vsq-parts>li').length,3);assert.match(row(app).querySelector('.authoring-totals').textContent,/Raw SMF/);assert.match(row(app).querySelector('.authoring-diagnostic-list').textContent,/complete package exceeds the native limits/);assert.equal(row(app).querySelector('[data-authoring-save]').hidden,true);assert.equal(row(app).querySelector('[data-authoring-export]').hidden,true);assert.equal(app.$('authoring-save-all').disabled,true);getAppI18n(app.document).setLocale('zh-CN');assert.match(row(app).querySelector('.authoring-diagnostic-list').textContent,/16 MiB.*暂缓保存和导出.*均未删减/);assert.equal(app.requests.some(call=>call.path==='/api/clean-song/draft/pack'||call.path==='/api/library/import/commit'||call.path==='/api/library/runtime'),false);assert.deepEqual(app.audio(),{contexts:0,unlocks:0});
 }finally{await app.close();}
});

test('browser VSQ review exports exact complete bytes without native admission or automatic projection',async()=>{
 const {document}=parseHTML('<html><body><div class="app-shell"></div></body></html>'),i18n=createI18n({locale:'en'}),downloads=[];let nativeCalls=0;
 const draft=authoredVsqDraft(),before=structuredClone(draft),pack=new Blob([draft.package.metadata_json,'\n',draft.package.score_json]),model=new SongAuthoringModel({getStorageKind:async()=> 'browser',transport:{draft:async()=>draft,pack:async()=>pack},imports:{preview:async()=>{nativeCalls++;},commit:async()=>{nativeCalls++;}}}),view=setupSongAuthoringView({document,i18n,model,download:async(_document,blob)=>downloads.push(await blob.text())});
 try{
  view.screenChanged('authoring');await model.select([vsqFile()]);assert.match(document.querySelector('.authoring-phase').textContent,/VSQ package ready to export; playback not admitted/);assert.equal(document.querySelector('[data-authoring-save]').hidden,true);document.querySelector('[data-authoring-export]').click();await new Promise(resolve=>setImmediate(resolve));assert.equal(downloads[0],await pack.text());assert.match(downloads[0],/9007199254740993/);assert.equal(nativeCalls,0);assert.deepEqual(model.snapshot().rows[0].draft,before);assert.equal(model.snapshot().rows[0].phase,'ready');
 }finally{view.destroy();}
});

test('recognized but undecodable VSQ distinguishes unavailable vocal inventory from an empty project',async()=>{
 const server=await authoringServer();server.setAuthoringRoute(({path,body})=>{if(path!=='/api/clean-song/draft')return;const draft=authoredVsqDraft({sourceName:body.source_name,title:body.title,state:'rejected'});draft.inventory.parts=[];draft.diagnostics=[{code:'vsq_source_rejected',message:'Synthetic unsupported engine meaning',action:'Keep the complete original VSQ',source_event_id:null,track_index:1}];return nativeResponse(draft,422);});const app=await nativeStorageApp(server);
 try{
  await start(app);pick(app,[vsqFile()]);await app.until(()=>reviewed(app)&&row(app)?.dataset.phase==='held');assert.match(row(app).textContent,/Logical vocal inventory unavailable/);assert.doesNotMatch(row(app).textContent,/Logical vocal parts \(0\)/);assert.match(row(app).querySelector('.authoring-diagnostic-list').textContent,/will not fall back to generic MIDI/);assert.equal(row(app).querySelectorAll('.authoring-track-list>li').length,4);assert.equal(row(app).querySelector('[data-authoring-export]').hidden,true);assert.equal(server.records.size,0);assert.equal(server.requests.some(call=>call.path==='/api/clean-song/draft/pack'),false);
 }finally{await app.close();}
});

test('explicit basic-key authoring reviews complete coverage, saves and reopens target practice without source audio',async()=>{
 const {basicKeyFile}=await import('./song-authoring-fixtures.js'),server=await authoringServer();let app=await nativeStorageApp(server);
 try{
  await start(app);app.$('authoring-intent').value='basic_keys';pick(app,[basicKeyFile()]);await app.until(()=>reviewed(app)&&row(app)?.dataset.phase==='ready');
  assert.match(row(app).querySelector('.authoring-classification').textContent,/Complete basic-key practice candidate/);assert.match(row(app).querySelector('.authoring-basic-coverage').textContent,/3 retained attacks.*3 positive determined.*0 instantaneous.*0 unresolved/);assert.match(row(app).textContent,/Source and reference audio are unavailable/);assert.equal(server.records.size,0);assert.deepEqual(app.audio(),{contexts:0,unlocks:0});assert.equal(app.requests.find(call=>call.path==='/api/clean-song/draft').body.intent,'basic_keys');
  getAppI18n(app.document).setLocale('zh-CN');assert.match(app.$('authoring-intent').textContent,/完整基础 MIDI 按键/);assert.match(row(app).querySelector('.authoring-basic-coverage').textContent,/保留 3 次按键/);assert.match(row(app).textContent,/参考音频不可用/);
  const title=row(app).querySelector('input');title.value='Original key retitle';app.emit(title,'input');app.$('authoring-intent').value='source_rendition';row(app).querySelector('[data-authoring-recheck]').click();await app.until(()=>reviewed(app)&&row(app)?.dataset.phase==='ready');assert.equal(app.requests.filter(call=>call.path==='/api/clean-song/draft').at(-1).body.intent,'basic_keys');
  row(app).querySelector('[data-authoring-save]').click();await app.until(()=>reviewed(app)&&row(app).dataset.phase==='saved');const [key,record]=[...server.records][0];assert.equal(record.score_json,null);assert.equal(record.clean_package.profile,'wmh-basic-keys-midi1-v1');const raw=record.clean_package.score_json;
  row(app).querySelector('[data-authoring-browse]').click();await app.until(()=>app.$('song-lobby').dataset.previewStatus==='ready'&&!app.$('start-practice').disabled);assert.equal(app.$('start-listen').disabled,true);assert.deepEqual(app.audio(),{contexts:0,unlocks:0});
  await app.close();app=await nativeStorageApp(server);await app.until(()=>app.savedButton(key)&&!app.$('start-listen').disabled);await app.click('home-single-player');app.savedButton(key).click();await app.until(()=>app.$('song-lobby').dataset.previewStatus==='ready'&&!app.$('start-practice').disabled);assert.equal(app.$('start-listen').disabled,true);assert.equal(server.records.get(key).clean_package.score_json,raw);assert.deepEqual(app.audio(),{contexts:0,unlocks:0});
 }finally{await app.close();}
});

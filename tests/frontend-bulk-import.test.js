import test from 'node:test';
import assert from 'node:assert/strict';
import {nativeStorageApp,deferred,nativeResponse} from './native-storage-app-fixtures.js';
import {bulkNativeFixture,importFile,authoredImportScore,selectImportFiles} from './bulk-import-fixtures.js';
import {getAppI18n} from '../web/app-locale.js';
import {IMPORT_COPY,IMPORT_ERROR_KEYS} from '../web/bulk-import-view.js';

const ready=async app=>{await app.until(()=>!app.$('start-listen').disabled);await app.click('home-single-player')};
const reviewed=app=>app.$('bulk-import-dialog').dataset.phase==='review';
const importRows=app=>[...app.document.querySelectorAll('.bulk-import-song')];
const savedRows=app=>[...app.document.querySelectorAll('#catalog [data-library-key]')];
const settled=async app=>app.until(()=>reviewed(app)&&[...app.document.querySelectorAll('[data-import-file]')].every(group=>group.dataset.phase==='complete'));

test('actual existing picker imports multiple scores without changing the active score, take, or independent preview',async()=>{
 const a=authoredImportScore('batch-a','Original score A'),b=authoredImportScore('batch-b','Original score B'),raw=`\n${JSON.stringify(a,null,2)}\r\n`,server=await bulkNativeFixture(),app=await nativeStorageApp(server);
 try{
  await ready(app);app.$('count-in').checked=false;await app.click('start-practice');await app.until(()=>app.document.body.dataset.screen==='stage'&&!app.$('play-button').disabled);
  const key=app.$('keyboard').querySelector('[data-midi="60"]');app.emit(key,'pointerdown',{pointerId:8,button:0});app.emit(key,'pointerup',{pointerId:8});await app.click('back-to-library');
  const original=await app.exported('export-button'),take=await app.exported('export-takes'),identity=app.$('song-lobby').dataset.previewId;assert.ok(take.passes[0].inputs.length);
  assert.equal(app.$('score-file').hasAttribute('multiple'),true);selectImportFiles(app,[importFile('原谱一.json',raw),importFile('原谱二.json',JSON.stringify(b))]);await app.until(()=>reviewed(app)&&importRows(app).length===2);
  assert.equal(app.$('bulk-import-dialog').open,true);assert.equal(server.records.size,0);assert.equal(server.originals.size,0,'Preflight never persists originals');
  await app.click('bulk-import-save');await settled(app);assert.equal(server.records.size,2);assert.equal(savedRows(app).length,2);assert.equal(server.originals.size,2);
  assert.equal(app.$('song-lobby').dataset.previewId,identity);assert.deepEqual(await app.exported('export-button'),original);assert.deepEqual(await app.exported('export-takes'),take);
  assert.deepEqual([...server.records.values()].map(row=>JSON.parse(row.score_json)),[a,b]);assert.equal(app.openedDatabases.includes('worldmusichub.scores.v1'),false);
  app.document.querySelector('[data-import-browse]').click();await app.until(()=>app.$('preview-title').textContent===a.title);assert.deepEqual(await app.exported('export-button'),original,'Explicit browse changes only the independent preview');
 }finally{await app.close()}
});

test('legacy ZIP and backup route automatically to review; conflicts are explicit and nonplayable entries stay separate across restart',async()=>{
 const a=authoredImportScore('same-id','Existing version'),b=authoredImportScore('same-id','New version'),c=authoredImportScore('new-id','New playable song');
 const archive='旧曲包_日本語.zip',bytes=Buffer.from([80,75,3,4,0,255,1,2,3]),server=await bulkNativeFixture({scores:[a],sources:{[archive]:[{path:'songs/new/score.wmhscore.json',score:b},{path:'songs/other/score.wmhscore.json',score:c},{path:'songs/unsupported/source/events.json',title:'Unrecognized original events'}]}});let app=await nativeStorageApp(server);
 try{
  await ready(app);selectImportFiles(app,[importFile(archive,bytes)]);await app.until(()=>reviewed(app)&&importRows(app).length===3);assert.equal(server.records.size,1);assert.match(app.$('bulk-import-summary').textContent,/ID conflicts 1.*Not playable 1/);
  await app.click('bulk-import-save');await settled(app);assert.equal(server.records.size,2);assert.equal(importRows(app).filter(row=>row.dataset.status==='retained_nonplayable').length,1);assert.match(importRows(app)[2].textContent,/Not playable; original retained only/);assert.equal(importRows(app)[2].querySelector('[data-import-browse]').hidden,true);
  app.document.querySelector('[data-import-keep-both="0"]').click();await app.until(()=>server.records.size===3&&reviewed(app));
  const keep=server.requests.filter(row=>row.path==='/api/library/import/commit').at(-1);assert.equal(keep.options.headers['x-wmh-item-index'],'0');assert.equal(keep.options.headers['x-wmh-conflict'],'keep-both');assert.equal(importRows(app)[1].dataset.status,'saved','Resolving one conflict does not erase the earlier success');assert.equal(server.originals.size,1);
  await app.until(()=>app.document.querySelector('[data-import-archive]'));app.document.querySelector('[data-import-archive]').click();await app.until(()=>app.downloads.length===1);assert.deepEqual(Buffer.from(await app.downloads[0].arrayBuffer()),bytes);
  await app.close();app=await nativeStorageApp(server);await ready(app);assert.equal(savedRows(app).length,3);await app.click('bulk-import-history-button');await app.until(()=>app.document.querySelector('[data-import-archive]'));assert.match(app.$('bulk-import-history-list').textContent,/旧曲包_日本語/);
  app.$('bulk-import-dialog').close();const backup={format:'worldmusichub-library-backup',version:1,entries:[{label:'Original backup',score:c}]};server.setImportRoute(({path,body})=>{if(path==='/api/library/import/preview'&&body.name==='backup.json')return nativeResponse({code:'pack_authored_review',error:'Backup reached native preflight'},422)});selectImportFiles(app,[importFile('backup.json',JSON.stringify(backup))]);await app.until(()=>app.$('bulk-import-groups').textContent.includes('Backup reached native preflight'));assert.equal(app.$('bulk-import-dialog').open,true);assert.equal(server.records.size,3);
 }finally{await app.close()}
});

test('close during native save stops the remaining queue and never reopens or navigates after a late commit',async()=>{
 const a=authoredImportScore('cancel-a'),b=authoredImportScore('cancel-b'),server=await bulkNativeFixture(),gate=deferred();let current=false;
 server.setImportRoute(async({path})=>{if(path==='/api/library/import/commit'){current=true;await gate.promise}});const app=await nativeStorageApp(server);
 try{
  await ready(app);selectImportFiles(app,[importFile('a.json',JSON.stringify(a)),importFile('b.json',JSON.stringify(b))]);await app.until(()=>reviewed(app));await app.click('bulk-import-save');await app.until(()=>current);await app.click('bulk-import-close');assert.equal(app.$('bulk-import-dialog').open,false);assert.equal(app.$('bulk-import-dialog').dataset.phase,'cancelling');
  await app.click('lobby-home');await app.click('start-free-practice');const screen=app.document.body.dataset.screen,identity=app.$('song-lobby').dataset.previewId;
  gate.resolve();await app.until(()=>app.$('bulk-import-dialog').dataset.phase==='cancelled');assert.equal(server.records.size,1);assert.equal(app.document.body.dataset.screen,screen);assert.equal(app.$('song-lobby').dataset.previewId,identity);assert.equal(app.$('bulk-import-dialog').open,false);assert.equal(savedRows(app).length,1);assert.match(app.$('bulk-import-status').textContent,/Saved 1.*not undone or deleted/);assert.equal(server.requests.filter(row=>row.path==='/api/library/import/commit').length,1);
 }finally{gate.resolve();await app.close()}
});

test('locale switches preserve report identities, raw source details, scroll, and retry ownership',async()=>{
 const fileName='<img src=x> $& 原件.zip',server=await bulkNativeFixture({sources:{[fileName]:[{path:'原始/events.json',title:'<script>original title</script>'}]}}),app=await nativeStorageApp(server);
 try{
  await ready(app);selectImportFiles(app,[importFile(fileName,'synthetic')]);await app.until(()=>reviewed(app));const row=importRows(app)[0],list=app.document.querySelector('.bulk-import-song-list');list.scrollTop=120;row.querySelector('details').open=true;
  const originalDetails=row.querySelector('details p').textContent,requests=server.requests.length;getAppI18n(app.document).setLocale('zh-CN');assert.equal(importRows(app)[0],row);assert.equal(list.scrollTop,120);assert.equal(row.querySelector('details').open,true);assert.equal(row.querySelector('details p').textContent,originalDetails);assert.equal(row.querySelector('script'),null);assert.equal(app.$('bulk-import-groups').querySelector('img'),null);assert.ok(app.$('bulk-import-groups').textContent.includes(fileName));assert.match(row.textContent,/不能播放/);assert.equal(server.requests.length,requests);
  getAppI18n(app.document).setLocale('en');assert.match(row.textContent,/Not playable/);assert.equal(app.$('bulk-import-dialog').open,true);
 }finally{await app.close()}
});

test('Chinese and English import copy expose the same keys and interpolation contracts',()=>{
 assert.deepEqual(Object.keys(IMPORT_COPY.en).sort(),Object.keys(IMPORT_COPY['zh-CN']).sort());for(const key of Object.keys(IMPORT_COPY.en)){const tokens=value=>[...value.matchAll(/\{(\w+)\}/g)].map(match=>match[1]).sort();assert.deepEqual(tokens(IMPORT_COPY.en[key]),tokens(IMPORT_COPY['zh-CN'][key]),key)}
 for(const [code,key]of Object.entries(IMPORT_ERROR_KEYS)){assert.ok(IMPORT_COPY.en[key],code);assert.match(IMPORT_COPY['zh-CN'][key],/[\u4e00-\u9fff]/,code)}
});

test('retained-original history loads another native page without losing earlier rows',async()=>{
 const server=await bulkNativeFixture(),pages=[];
 server.setImportRoute(({path})=>{if(path.startsWith('/api/library/imports')){pages.push(path);const more=path.includes('?cursor=10');return nativeResponse({format:'worldmusichub-import-history',version:1,imports:[{archive_key:more?'pack-b':'pack-a',filename:more?'Next original.zip':'First original.zip',report:{items:[{title:'Original source-only events',path:'events.json',status:'retained_nonplayable',playable:false}]}}],issues:[],next_cursor:more?null:'10'})}});
 const app=await nativeStorageApp(server);
 try{await ready(app);await app.click('bulk-import-history-button');await app.until(()=>!app.$('bulk-import-history-more').hidden);assert.match(app.$('bulk-import-history-list').textContent,/First original/);await app.click('bulk-import-history-more');await app.until(()=>app.$('bulk-import-history-more').hidden);assert.match(app.$('bulk-import-history-list').textContent,/First original.*Next original/s);assert.equal(pages.at(-1),'/api/library/imports?cursor=10');assert.equal(app.document.querySelectorAll('[data-history-status="retained_nonplayable"]').length,2)}finally{await app.close()}
});

test('an unreadable commit outcome is visibly unconfirmed and retry remains tied to the same original',async()=>{
 const score=authoredImportScore('unconfirmed-batch'),name='uncertain.zip',server=await bulkNativeFixture({sources:{[name]:[{path:'score.json',score}]}}),app=await nativeStorageApp(server);
 try{await ready(app);selectImportFiles(app,[importFile(name,'original retained input')]);await app.until(()=>reviewed(app));server.setImportRoute(({path})=>{if(path==='/api/library/import/commit')throw Error('Response lost')});await app.click('bulk-import-save');await app.until(()=>app.document.querySelector('[data-import-file][data-phase="uncertain"]'));assert.match(app.$('bulk-import-groups').textContent,/retention is unconfirmed/);assert.match(app.$('bulk-import-groups').textContent,/Some content may already be saved/);const originalRequest=server.requests.find(row=>row.path==='/api/library/import/commit');server.setImportRoute(null);app.document.querySelector('[data-import-retry]').click();await app.until(()=>server.records.size===1&&reviewed(app));assert.equal(server.requests.filter(row=>row.path==='/api/library/import/commit').at(-1).body,originalRequest.body);assert.equal(app.document.querySelector('[data-import-file]').dataset.phase,'complete')}finally{await app.close()}
});

test('native storage failures have actionable Chinese status while original English details stay disclosed separately',async()=>{
 const server=await bulkNativeFixture(),app=await nativeStorageApp(server);server.setImportRoute(({path})=>path==='/api/library/import/preview'?nativeResponse({code:'library_unsafe_path',error:'Original OS detail: unsafe staging path'},500):undefined);
 try{await ready(app);getAppI18n(app.document).setLocale('zh-CN');selectImportFiles(app,[importFile('原件.zip','synthetic')]);await app.until(()=>reviewed(app));const problem=app.document.querySelector('.bulk-import-problem');assert.match(problem.querySelector(':scope > p').textContent,/本机存储目录.*重试/);assert.doesNotMatch(problem.querySelector(':scope > p').textContent,/Original OS/);assert.match(problem.querySelector('details summary').textContent,/原始检查说明/);assert.equal(problem.querySelector('details').open,false);assert.match(problem.querySelector('details p').textContent,/Original OS detail/)}finally{await app.close()}
});

test('200 partial commit reports remain unconfirmed in rows and history while rescan and retry recover the published song',async()=>{
 const first=authoredImportScore('known-published','Known saved song'),second=authoredImportScore('uncertain-published','Possibly saved song'),filename='部分确认_日本語.zip',detail='<img src=x> Original OS detail $& after publication',server=await bulkNativeFixture({sources:{[filename]:[{path:'first.json',score:first},{path:'second.json',score:second}]}});let injected=false;
 server.setImportRoute(({path,body,defaultReply})=>{if(path==='/api/library/save'&&JSON.parse(body.score_json).id===second.id&&!injected){injected=true;defaultReply();return nativeResponse({code:'library_commit_uncertain',error:detail},500)}});
 const app=await nativeStorageApp(server);
 try{
  await ready(app);selectImportFiles(app,[importFile(filename,'exact complete source')]);await app.until(()=>reviewed(app));await app.click('bulk-import-save');await app.until(()=>reviewed(app)&&app.document.querySelector('[data-import-file][data-phase="uncertain"]')&&app.document.querySelector('[data-history-status="error"]'));
  assert.equal(server.records.size,2);assert.equal(savedRows(app).length,2,'The normal post-commit rescan includes the recovered published song');assert.ok(server.requests.some(row=>row.path==='/api/library/list'));assert.equal(server.originals.size,1);
  const row=importRows(app)[1],historyRow=app.document.querySelector('[data-history-status="error"]');assert.equal(importRows(app)[0].dataset.status,'saved');assert.equal(row.dataset.status,'error','Keep the native report schema');assert.equal(row.querySelector('[data-import-retry-item]').hidden,false);assert.match(row.querySelector('.bulk-import-item-status').textContent,/Save outcome unconfirmed.*Rescan/);assert.doesNotMatch(row.querySelector('.bulk-import-item-status').textContent,/not imported/);assert.match(app.$('bulk-import-summary').textContent,/Saved 1.*Unconfirmed 1.*Errors 0/);assert.match(app.document.querySelector('.bulk-import-source-status').textContent,/Complete original retained/);
  assert.match(historyRow.textContent,/Save outcome unconfirmed/);assert.doesNotMatch(historyRow.textContent,/not imported/);for(const node of [row,historyRow]){assert.equal(node.querySelector('details').open,false);assert.match(node.querySelector('details').querySelector('p').textContent,/Original OS detail \$&/);assert.equal(node.querySelector('img'),null)}
  getAppI18n(app.document).setLocale('zh-CN');assert.match(row.querySelector('.bulk-import-item-status').textContent,/保存结果待确认.*重新扫描/);assert.doesNotMatch(row.querySelector('.bulk-import-item-status').textContent,/未导入|Original OS/);assert.match(app.$('bulk-import-summary').textContent,/已保存 1.*结果待确认 1.*错误 0/);assert.match(app.$('bulk-import-history-list').textContent,/保存结果待确认/);
  row.querySelector('[data-import-retry-item]').click();await app.until(()=>reviewed(app)&&app.document.querySelector('[data-import-file]').dataset.phase==='complete'&&!app.document.querySelector('[data-history-status="error"]'));assert.equal(server.records.size,2);assert.deepEqual(importRows(app).map(value=>value.dataset.status),['saved','duplicate']);const commits=server.requests.filter(value=>value.path==='/api/library/import/commit');assert.equal(commits.length,2);assert.equal(commits[1].body,commits[0].body);assert.equal(commits[1].options.headers['x-wmh-item-index'],'1');assert.match(app.$('bulk-import-summary').textContent,/已保存 1.*已存在 1.*结果待确认 0.*错误 0/);
 }finally{await app.close()}
});

test('paged recovery notices retain literal details and accumulate without becoming a failed history request',async()=>{
 const server=await bulkNativeFixture(),backup={code:'pack_backup_only',message:'Original <script>backup</script> detail',archive_key:'import-backup-literal'},stage={code:'pack_incomplete_stages',message:'Original staged files detail'};let refreshed=false,failMore=false;
 server.setImportRoute(({path})=>{if(!path.startsWith('/api/library/imports'))return;const more=path.includes('?cursor=10');if(more&&failMore)return nativeResponse({code:'library_io',error:'Original read failure'},500);return nativeResponse({format:'worldmusichub-import-history',version:1,imports:[{archive_key:more?'pack-b':'pack-a',filename:more?'Next original.zip':'First original.zip'}],issues:refreshed?[]:more?[backup,stage]:[backup],next_cursor:more?null:'10'})});
 const app=await nativeStorageApp(server);
 try{
  await ready(app);getAppI18n(app.document).setLocale('zh-CN');await app.click('bulk-import-history-button');await app.until(()=>app.document.querySelector('[data-history-issue]'));assert.match(app.$('bulk-import-history-status').textContent,/已读取.*1 项恢复说明/);assert.equal(app.$('bulk-import-history-error').hidden,true);const notice=app.document.querySelector('[data-history-issue]');assert.match(notice.querySelector(':scope > p').textContent,/重新导入同一完整原件/);assert.equal(notice.querySelector('details').open,false);assert.match(notice.querySelector('details').querySelector('p').textContent,/import-backup-literal/);assert.match(notice.querySelector('details').querySelector('p').textContent,/<script>backup<\/script>/);assert.equal(notice.querySelector('script'),null);
  failMore=true;await app.click('bulk-import-history-more');await app.until(()=>!app.$('bulk-import-history-error').hidden);assert.equal(app.document.querySelectorAll('[data-history-issue]').length,1);assert.match(app.$('bulk-import-history-list').textContent,/First original/);
  failMore=false;await app.click('bulk-import-history-more');await app.until(()=>app.document.querySelectorAll('[data-history-issue]').length===2);assert.match(app.$('bulk-import-history-list').textContent,/First original.*Next original/s);assert.match(app.$('bulk-import-history-status').textContent,/已读取.*2 项恢复说明/);assert.equal(app.$('bulk-import-history-error').hidden,true);assert.match(app.document.querySelector('[data-history-issue="pack_incomplete_stages"] > p').textContent,/临时内容已保留并排除/);
  getAppI18n(app.document).setLocale('en');assert.match(app.$('bulk-import-history-status').textContent,/loaded with 2 recovery notices/);assert.match(app.document.querySelector('[data-history-issue="pack_backup_only"] > p').textContent,/Reimport the same complete original/);
  refreshed=true;await app.click('bulk-import-history-refresh');await app.until(()=>app.document.querySelectorAll('[data-history-issue]').length===0&&!app.$('bulk-import-history-more').disabled);assert.match(app.$('bulk-import-history-status').textContent,/1 complete originals/);
 }finally{await app.close()}
});

test('score-only pack export uses explicit bounded checkbox selection and permits fewer-song retry',async()=>{
 const server=await bulkNativeFixture({scores:Array.from({length:17},(_,index)=>authoredImportScore(`export-selection-${index}`))});for(const row of server.records.values())row.entry.score_bytes=8*1024*1024;
 let reject=true;server.setImportRoute(({path})=>{if(path==='/api/library/pack/export')return reject?nativeResponse({code:'pack_export_limit',error:'Original compressed export exceeds limit'},413):{...nativeResponse(null),blob:async()=>new Blob(['authored score-only pack'])}});
 const app=await nativeStorageApp(server);
 try{
  await ready(app);await app.click('bulk-import-history-button');await app.until(()=>app.document.querySelectorAll('[data-import-export-key]').length===17);assert.equal(app.$('bulk-import-export-pack').disabled,true);assert.match(app.$('bulk-import-export-count').textContent,/Selected 0/);
  await app.click('bulk-import-export-all');assert.equal(app.$('bulk-import-export-pack').disabled,true);assert.match(app.$('bulk-import-export-count').textContent,/Selected 17.*136 MiB/);assert.equal(app.$('bulk-import-export-limit').dataset.exceeded,'true');assert.equal(server.requests.filter(row=>row.path==='/api/library/pack/export').length,0);
  const boxes=[...app.document.querySelectorAll('[data-import-export-key]')];boxes[0].checked=false;app.emit(boxes[0],'change');assert.equal(app.$('bulk-import-export-pack').disabled,false);assert.match(app.$('bulk-import-export-count').textContent,/Selected 16.*128 MiB/);await app.click('bulk-import-export-pack');await app.until(()=>!app.$('bulk-import-export-error').hidden);assert.match(app.$('bulk-import-export-error').querySelector(':scope > p').textContent,/Choose fewer songs/);
  getAppI18n(app.document).setLocale('zh-CN');assert.match(app.$('bulk-import-export-error').querySelector(':scope > p').textContent,/减少所选歌曲/);assert.equal(boxes[0].checked,false);boxes[1].checked=false;app.emit(boxes[1],'change');reject=false;await app.click('bulk-import-export-pack');await app.until(()=>app.downloads.length===1);const exports=server.requests.filter(row=>row.path==='/api/library/pack/export');assert.equal(exports[0].body.keys.length,16);assert.equal(exports[1].body.keys.length,15);assert.deepEqual(exports[1].body.keys,boxes.slice(2).map(box=>box.dataset.importExportKey));assert.equal(server.records.size,17);await app.click('bulk-import-export-none');assert.equal(app.$('bulk-import-export-pack').disabled,true);
 }finally{await app.close()}
});

test('reviewing an already retained original describes this preview without denying its existing retained copy',async()=>{
 const filename='再次检查.zip',score=authoredImportScore('retained-before-review'),file=importFile(filename,'same complete original'),server=await bulkNativeFixture({sources:{[filename]:[{path:'score.json',score}]}}),app=await nativeStorageApp(server);
 try{
  await ready(app);selectImportFiles(app,[file]);await app.until(()=>reviewed(app));await app.click('bulk-import-save');await settled(app);selectImportFiles(app,[file]);await app.until(()=>reviewed(app)&&app.document.querySelector('[data-import-file]').dataset.phase==='ready'&&app.document.querySelector('[data-import-archive]'));
  assert.equal(server.originals.size,1);assert.match(app.document.querySelector('.bulk-import-source-status').textContent,/This review has not saved the original; earlier retained copies/);assert.match(app.$('bulk-import-history-list').textContent,/再次检查.zip/);getAppI18n(app.document).setLocale('zh-CN');assert.match(app.document.querySelector('.bulk-import-source-status').textContent,/本次检查尚未保存原件；已有保留记录/);
 }finally{await app.close()}
});

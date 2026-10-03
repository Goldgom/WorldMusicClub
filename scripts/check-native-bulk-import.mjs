// Node DOM + actual native Rust stdin routes. No GUI, browser, or server.
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {nativeStorageApp} from '../tests/native-storage-app-fixtures.js';
import {authoredLegacyPack,startNativeImportDriver} from '../tests/native-import-driver-fixtures.js';
import {importFile,selectImportFiles,authoredImportScore} from '../tests/bulk-import-fixtures.js';

if(!process.env.WMH_NATIVE_IMPORT_DRIVER)throw Error('Build the native_import_driver example, then set WMH_NATIVE_IMPORT_DRIVER to its absolute path.');
const directory=await mkdtemp(path.join(tmpdir(),'wmh-authored-bulk-route-')),fixture=authoredLegacyPack(),report={kind:'node-dom-real-rust-native-stdin',browser:false,native_window:false,directory,cases:[],ok:false};
let driver,app;
const until=async(predicate,label)=>{const deadline=Date.now()+15000;while(Date.now()<deadline){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,5))}assert.fail(label)};
const launch=async()=>{driver=startNativeImportDriver({binary:process.env.WMH_NATIVE_IMPORT_DRIVER,directory});app=await nativeStorageApp(driver);await until(()=>!app.$('start-listen').disabled,'Initial native catalog unavailable');await app.click('home-single-player')};
try{
 report.driver_sha256=createHash('sha256').update(await readFile(process.env.WMH_NATIVE_IMPORT_DRIVER)).digest('hex');
 await launch();
 // The old JSON-as-Score route cannot validate a library backup. The new picker
 // must route the envelope to native pack inspection before score compilation.
 const backup={format:'worldmusichub-library-backup',version:1,entries:fixture.scores.map(score=>({label:null,score}))};
 const rejected=await driver.fetcher('/api/compile',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(backup)});assert.equal(rejected.ok,false);report.cases.push({name:'backup-is-not-a-canonical-score',status:rejected.status,ok:true});
 const previous=app.$('song-lobby').dataset.previewId;selectImportFiles(app,[importFile(fixture.filename,fixture.bytes)]);
 await until(()=>app.$('bulk-import-dialog').dataset.phase==='review'&&app.document.querySelectorAll('.bulk-import-song').length>=3,'Native ZIP preflight did not complete');
 assert.equal(app.document.querySelectorAll('#catalog [data-library-key]').length,0);assert.equal(app.$('bulk-import-groups').querySelectorAll('[data-status="retained_nonplayable"]').length>=1,true);
 await app.click('bulk-import-save');await until(()=>app.$('bulk-import-dialog').dataset.phase==='review'&&app.document.querySelectorAll('#catalog [data-library-key]').length===2,'Native ZIP songs were not persisted');
 assert.equal(app.$('song-lobby').dataset.previewId,previous);const entries=[...app.document.querySelectorAll('#catalog [data-library-key]')].map(row=>row.dataset.libraryKey);assert.equal(new Set(entries).size,2);
 const history=await(await driver.fetcher('/api/library/imports')).json();assert.equal(history.imports.length,1);const original=await driver.fetcher('/api/library/import/export',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({archive_key:history.imports[0].archive_key})});assert.deepEqual(await original.bytes(),fixture.bytes);
 report.cases.push({name:'unicode-legacy-zip-preflight-save-original-fidelity',saved:entries.length,retained_nonplayable:app.$('bulk-import-groups').querySelectorAll('[data-status="retained_nonplayable"]').length,sha256:createHash('sha256').update(fixture.bytes).digest('hex'),ok:true});
 // A duplicate backup uses the same picker and creates no extra saved copies.
 app.$('bulk-import-dialog').close();selectImportFiles(app,[importFile('一键导入曲库.json',JSON.stringify(backup))]);await until(()=>app.$('bulk-import-dialog').dataset.phase==='review'&&app.$('bulk-import-groups').textContent.includes('一键导入曲库.json'),'Backup review unavailable');await app.click('bulk-import-save');await until(()=>app.$('bulk-import-dialog').dataset.phase==='review'&&app.$('bulk-import-groups').querySelector('[data-phase="complete"]'),'Backup save did not complete');assert.equal(app.document.querySelectorAll('#catalog [data-library-key]').length,2);report.cases.push({name:'existing-backup-restores-without-duplicates',ok:true});
 const conflicting={...structuredClone(fixture.scores[0]),title:'Explicit authored conflicting edition'},fresh=authoredImportScore('authored-extra-batch','Extra batch exercise');app.$('bulk-import-dialog').close();selectImportFiles(app,[importFile('版本冲突.json',JSON.stringify(conflicting)),importFile('另一首.json',JSON.stringify(fresh))]);await until(()=>app.$('bulk-import-dialog').dataset.phase==='review'&&app.$('bulk-import-groups').querySelector('[data-status="conflict"]'),'Multiple files did not detect conflict');await app.click('bulk-import-save');await until(()=>app.$('bulk-import-dialog').dataset.phase==='review'&&app.document.querySelectorAll('#catalog [data-library-key]').length===3,'Fresh song did not save');app.$('bulk-import-groups').querySelector('[data-import-keep-both]:not([hidden])').click();await until(()=>app.$('bulk-import-dialog').dataset.phase==='review'&&app.document.querySelectorAll('#catalog [data-library-key]').length===4,'Explicit keep-both failed');report.cases.push({name:'multiple-standard-scores-explicit-conflict-policy',ok:true});
 app.$('bulk-import-history').open=true;await app.click('bulk-import-export-all');await app.click('bulk-import-export-pack');await until(()=>app.downloads.length===1,'Unified export did not download');const unified=Buffer.from(await app.downloads[0].arrayBuffer());app.$('bulk-import-dialog').close();selectImportFiles(app,[importFile('统一曲包.zip',unified)]);await until(()=>app.$('bulk-import-dialog').dataset.phase==='review'&&app.$('bulk-import-groups').querySelectorAll('[data-status="duplicate"]').length===4,'Unified export did not reimport');await app.click('bulk-import-save');await until(()=>app.$('bulk-import-dialog').dataset.phase==='review'&&app.$('bulk-import-groups').querySelector('[data-phase="complete"]'),'Unified reimport did not finish');assert.equal(app.document.querySelectorAll('#catalog [data-library-key]').length,4);report.cases.push({name:'unified-pack-ui-export-reimport-exact-edition-deduplication',sha256:createHash('sha256').update(unified).digest('hex'),ok:true});
 await app.close();await driver.close();app=null;driver=null;await launch();await until(()=>app.document.querySelectorAll('#catalog [data-library-key]').length===4,'Native restart lost saved songs');await app.click('bulk-import-history-button');await until(()=>app.$('bulk-import-history-list').children.length>=3,'Native restart lost originals');report.cases.push({name:'fresh-process-restart-inventory-and-original-history',saved:4,ok:true});
 for(const name of ['web/bulk-import.js','web/bulk-import-view.js','web/app.js']){report.source_hashes??={};report.source_hashes[name]=createHash('sha256').update(await readFile(new URL(`../${name}`,import.meta.url))).digest('hex')}
 report.ok=true;
}catch(error){report.error=error.stack||String(error);process.exitCode=1}
finally{await app?.close();await driver?.close();if(process.env.WMH_IMPORT_REPORT){await mkdir(path.dirname(process.env.WMH_IMPORT_REPORT),{recursive:true});await writeFile(process.env.WMH_IMPORT_REPORT,JSON.stringify(report,null,2)+'\n')}console.log(JSON.stringify(report,null,2))}
if(!report.ok)throw Error(report.error);

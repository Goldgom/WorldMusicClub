// Complete original media fixture through the actual Rust stdin protocol.
// No server, browser, WebView, codec or audio device is launched here.
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {startNativeImportDriver} from '../tests/native-import-driver-fixtures.js';
import {authoredCleanPackage,digest,inspectAuthoredZip,assertCleanExportInventory} from '../tests/clean-song-package-fixtures.js';
const binary=process.env.WMH_NATIVE_IMPORT_DRIVER;
if(!binary)throw Error('Set WMH_NATIVE_IMPORT_DRIVER to the exact-source native driver.');
const directory=await mkdtemp(path.join(tmpdir(),'wmh-clean-native-')),fixture=authoredCleanPackage();
let driver;
const report={ok:false,fixture_sha256:digest(fixture.bytes),driver_sha256:digest(await readFile(binary)),browser:false,native_window:false,decoded_media:false};
const launch=()=>driver=startNativeImportDriver({binary,directory:path.join(directory,'Scores')});
async function json(route,body){const response=await driver.fetcher(route,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});assert.ok(response.ok,await response.text());return response.json();}
async function importPack(mode,bytes){const response=await driver.fetcher(`/api/library/import/${mode}`,{method:'POST',headers:{'Content-Type':'application/zip','X-WMH-Filename':encodeURIComponent(fixture.filename)},body:bytes});assert.ok(response.ok,await response.text());return response.json();}
try{
 launch();const preview=await importPack('preview',fixture.bytes);assert.equal(preview.summary.ready,1,JSON.stringify(preview));assert.equal((await json('/api/library/list')).entries.length,0);
 const saved=await importPack('commit',fixture.bytes);assert.equal(saved.summary.saved,1,JSON.stringify(saved));const key=saved.items[0].entry.key;
 const loaded=await json('/api/library/load',{key}),complete=loaded.clean_package;
 assert.equal(complete.metadata_json,fixture.files.get('metadata.json').toString('utf8'));assert.equal(complete.score_json,fixture.files.get('score.json').toString('utf8'));assert.equal(complete.runtime.notes.length,30);
 for(const asset of complete.media){const response=await driver.fetcher('/api/library/asset',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key,handle:asset.handle})});assert.ok(response.ok);assert.equal(response.contentType,asset.mime);assert.deepEqual(await response.bytes(),fixture.files.get(fixture.metadata.media.find(item=>item.id===asset.id).path));}
 const response=await driver.fetcher('/api/library/pack/export',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({keys:[key]})});assert.ok(response.ok);const exported=await response.bytes();assertCleanExportInventory(inspectAuthoredZip(exported),fixture,key);assert.equal((await importPack('commit',exported)).summary.duplicate,1);
 await driver.close();driver=null;launch();const reopened=await json('/api/library/load',{key});assert.deepEqual(reopened.clean_package,complete);assert.equal((await json('/api/library/list')).entries.length,1);
 report.ok=true;report.key=key;report.tracks=fixture.score.performance.tracks.length;report.parts=fixture.score.performance.parts.length;report.notes=30;report.assets=complete.media.length;report.export_sha256=digest(exported);
}finally{await driver?.close();await rm(directory,{recursive:true,force:true});console.log(JSON.stringify(report,null,2));}

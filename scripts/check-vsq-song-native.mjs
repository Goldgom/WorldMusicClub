// Real native stdio only. This is deliberately not browser/Windows acceptance.
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {startVsqNativeDriver} from '../tests/vsq-native-driver-fixtures.js';
import {vsqAcceptanceFixture} from './prepare-vsq-song-fixtures.mjs';
import {digest,inspectAuthoredZip,assertCleanExportInventory} from '../tests/clean-song-package-fixtures.js';
const binary=process.env.WMH_NATIVE_IMPORT_DRIVER;if(!binary)throw Error('An exact-source native_import_driver is required');
const directory=await mkdtemp(join(tmpdir(),'wmh-vsq-protocol-'));let driver;
const bounded=async(p,label)=>{let timer;try{return await Promise.race([p,new Promise((_,reject)=>timer=setTimeout(()=>reject(Error(`Timed out (10s): ${label}`)),10000))]);}finally{clearTimeout(timer);}};
const request=(path,body)=>bounded(driver.fetcher(path,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),path);
const json=async(path,body)=>{const r=await request(path,body);assert.ok(r.ok,await r.text());return r.json();};
const report={ok:false,browser:false,native_window:false,physical_audio:false,driver_sha256:digest(await readFile(binary)),variants:[]};
try {for(const padding of [false,true]) {
 const f=vsqAcceptanceFixture({padding}),library=join(directory,padding?'padding':'tail');driver=startVsqNativeDriver({binary,directory:library});
 const upload=async(mode,bytes=f.bytes)=>{const r=await bounded(driver.fetcher(`/api/library/import/${mode}`,{method:'POST',headers:{'Content-Type':'application/zip','X-WMH-Filename':f.filename},body:bytes}),`VSQ ${mode}`);assert.ok(r.ok,await r.text());return r.json();};
 const preview=await upload('preview');assert.equal(preview.summary.ready,1);assert.equal(preview.items[0].playable,false);assert.equal(preview.items[0].clean_package.profile,'wmh-vsq-clean-v1');assert.equal(preview.items[0].clean_package.coverage.project.tracks,2);assert.equal((await json('/api/library/list')).entries.length,0);
 const saved=await upload('commit');assert.equal(saved.summary.saved,1);assert.equal(saved.items[0].playable,false);assert.equal(saved.items[0].entry.key,f.key);
 const opened=await json('/api/library/load',{key:f.key});assert.deepEqual({score_json:opened.score_json,clean_package:opened.clean_package},f.opened);assert.equal(opened.clean_package.runtime,null);
 const vocal=await request('/api/library/runtime',{key:f.key,profile:'wmh-vsq-clean-v1',choice:'full_vocal'});assert.equal(vocal.status,422);assert.equal((await vocal.json()).code,'library_vocal_unsupported');
 for(const choice of [null,'unrecognized']){const bad=await request('/api/library/runtime',{key:f.key,profile:'wmh-vsq-clean-v1',...(choice?{choice}:{})});assert.equal(bad.status,400);}
 assert.deepEqual(await json('/api/library/runtime',{key:f.key,profile:'wmh-vsq-clean-v1',choice:'base_notes_instrumental'}),f.runtime);
 assert.equal((await json('/api/library/load',{key:f.key})).clean_package.runtime,null);
 const exported=await request('/api/library/pack/export',{keys:[f.key]});assert.ok(exported.ok);const bytes=await exported.bytes();assertCleanExportInventory(inspectAuthoredZip(bytes),f,f.key);assert.equal((await upload('commit',bytes)).summary.duplicate,1);
 await bounded(driver.close(),'first driver close');driver=null;driver=startVsqNativeDriver({binary,directory:library});const reload=await json('/api/library/load',{key:f.key});assert.deepEqual(reload.clean_package,f.opened.clean_package);assert.equal(reload.clean_package.runtime,null);assert.equal((await json('/api/library/list')).entries.length,1);
 report.variants.push({fixture:f.manifest.fixture,key:f.key,fixture_sha256:f.manifest.sha256,export_sha256:digest(bytes),metadata_sha256:digest(f.files.get('metadata.json')),score_sha256:digest(f.files.get('score.json')),ok:true});await bounded(driver.close(),'restarted driver close');driver=null;
 }report.ok=true;
}finally{await driver?.close();await rm(directory,{recursive:true,force:true});console.log(JSON.stringify(report,null,2));}

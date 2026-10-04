// Real Rust stdio only. This check opens no listener, browser, native window or
// audio device, and its receipt cannot establish GUI or final acceptance.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,readFile,readdir,rm,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {startVsqNativeDriver} from '../tests/vsq-native-driver-fixtures.js';
import {vsqAuthoringFixture,validateVsqAuthoringDraft} from './prepare-vsq-authoring-fixtures.mjs';
import {readBulkEvidenceZip} from './verify-native-bulk-import-evidence.mjs';

const digest=value=>createHash('sha256').update(value).digest('hex');

export function assertVsqAuthoringZip(bytes,fixture){
  const files=readBulkEvidenceZip(bytes),manifest=JSON.parse(files.get('manifest.json'));
  assert.deepEqual(Object.keys(manifest).sort(),['format','songs','version']);
  assert.equal(manifest.format,'worldmusichub-song-pack');
  assert.equal(manifest.version,2);
  assert.equal(manifest.songs.length,1);
  assert.deepEqual(Object.keys(manifest.songs[0]),['folder']);
  const folder=manifest.songs[0].folder;
  assert.match(folder,/^songs\/[a-zA-Z0-9_-]+$/);
  assert.deepEqual([...files.keys()].sort(),['manifest.json',`${folder}/metadata.json`,`${folder}/score.json`].sort(),'Only the complete metadata and score belong in this package');
  for(const name of ['metadata','score'])assert.deepEqual(files.get(`${folder}/${name}.json`),Buffer.from(fixture.draft.package[`${name}_json`]),`Exact captured ${name} bytes must survive packing and export`);
  return [...files].map(([path,bytes])=>({path,bytes:bytes.length,sha256:digest(bytes)}));
}

export function validateVsqAuthoringOpened(opened,fixture){
  assert.deepEqual({score_json:opened.score_json,clean_package:opened.clean_package},fixture.opened);
  assert.equal(opened.clean_package.runtime,null,'Loading must never imply the instrumental choice');
  assert.equal(opened.clean_package.metadata_json,fixture.draft.package.metadata_json);
  assert.equal(opened.clean_package.score_json,fixture.draft.package.score_json);
  assert.match(opened.clean_package.score_json,/"coefficient":\s*9007199254740993\b/,'Retain the original integer token without JavaScript rounding');
  assert.equal(Object.hasOwn(opened,'runtime'),false);
  if(opened.entry)assert.equal(opened.entry.key,fixture.key);
  return opened.clean_package;
}

export function validateVsqAuthoringRuntime(response,fixture){
  assert.deepEqual(response,fixture.runtime);
  assert.equal(response.runtime.choice,'base_notes_instrumental');
  assert.equal(response.runtime.parts.length,3);
  assert.equal(response.runtime.notes.length,2);
  assert.equal(response.runtime.notes.filter(n=>n.audible).length,1);
  assert.deepEqual(response.runtime.parts.map(p=>p.part_id),['vsq-track-1','vsq-track-2','vsq-track-3']);
  assert.equal(response.runtime.parts[1].mix.mute,true);
  assert.equal(response.runtime.notes.some(n=>n.part_id==='vsq-track-3'),false);
  return response.runtime;
}

async function snapshot(directory){
  const files=[];
  async function walk(folder,prefix=''){
    for(const item of (await readdir(folder,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
      const relative=prefix+item.name;
      if(item.isDirectory())await walk(join(folder,item.name),`${relative}/`);
      else{assert.ok(item.isFile());const bytes=await readFile(join(folder,item.name));files.push({path:relative,bytes:bytes.length,sha256:digest(bytes)});}
    }
  }
  await walk(directory);return files;
}

export async function checkVsqAuthoringNative({binary=process.env.WMH_NATIVE_IMPORT_DRIVER,reportPath=process.env.WMH_VSQ_AUTHORING_REPORT}={}){
  if(!binary)throw Error('Set WMH_NATIVE_IMPORT_DRIVER to an exact-source native_import_driver; fixtures alone are not native acceptance.');
  const driverSha256=digest(await readFile(binary)),fixture=vsqAuthoringFixture();
  const directory=await mkdtemp(join(tmpdir(),'wmh-vsq-authoring-protocol-')),library=join(directory,'original');
  let driver;
  const report={version:1,ok:false,scope:'real-native-stdio',browser:false,native_window:false,physical_audio:false,full_checkpoint_acceptance:false,driver_sha256:driverSha256,fixture:fixture.manifest,cases:[]};
  const launch=()=>{driver=startVsqNativeDriver({binary,directory:library});};
  const close=async()=>{await driver.close();driver=null;};
  const request=(path,body)=>driver.fetcher(path,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const json=async(path,body,status=200)=>{const response=await request(path,body),data=await response.json();assert.equal(response.status,status,JSON.stringify(data));return data;};
  const upload=async(mode,bytes)=>{const response=await driver.fetcher(`/api/library/import/${mode}`,{method:'POST',headers:{'Content-Type':'application/zip','X-WMH-Filename':'authoring-original.zip'},body:bytes}),data=await response.json();assert.equal(response.status,200,JSON.stringify(data));return data;};
  const noWrite=async action=>{const before=await snapshot(library),listed=await json('/api/library/list'),result=await action();assert.deepEqual(await json('/api/library/list'),listed);assert.deepEqual(await snapshot(library),before,'Read-only/rejected VSQ authoring operation changed native storage');return result;};
  const load=async()=>{const opened=await json('/api/library/load',{key:fixture.key});validateVsqAuthoringOpened(opened,fixture);return opened;};
  const choiceGuards=async()=>{
    for(const choice of [undefined,'unrecognized','full_vocal']){
      const response=await noWrite(()=>json('/api/library/runtime',{key:fixture.key,profile:'wmh-vsq-clean-v1',...(choice===undefined?{}:{choice})},choice==='full_vocal'?422:400));
      assert.equal(Object.hasOwn(response,'runtime'),false);
      if(choice==='full_vocal')assert.equal(response.code,'library_vocal_unsupported');
    }
    await load();
  };
  try{
    launch();assert.equal((await json('/api/library/list')).entries.length,0);
    const draft=await noWrite(()=>json('/api/clean-song/draft',fixture.request));
    validateVsqAuthoringDraft(draft,fixture);
    assert.equal(Object.hasOwn(draft,'runtime'),false);
    report.cases.push({name:'prepare-read-only-exact-original-complete-draft',ok:true,draft_sha256:draft.draft_sha256,source_sha256:fixture.manifest.sha256});
    const fingerprint=draft.draft_sha256;
    const negatives=[
      ['blank-title','/api/clean-song/draft',{...fixture.request,title:' '},400],
      ['control-title','/api/clean-song/draft',{...fixture.request,title:'original\n'},400],
      ['invalid-base64','/api/clean-song/draft',{...fixture.request,source_base64:'not base64!'},400],
      ['unknown-track-selection','/api/clean-song/draft',{...fixture.request,selected_tracks:[1]},400],
      ['stale-title','/api/clean-song/draft/pack',{...fixture.request,title:'Changed title',expected_draft_sha256:fingerprint},409],
      ['wrong-fingerprint','/api/clean-song/draft/pack',{...fixture.request,expected_draft_sha256:'0'.repeat(64)},409],
      ['missing-fingerprint','/api/clean-song/draft/pack',fixture.request,400],
    ];
    for(const [name,path,body,status]of negatives){const rejected=await noWrite(()=>json(path,body,status));assert.equal(Object.hasOwn(rejected,'zip_base64'),false);if(status===409)assert.equal(rejected.code,'clean_draft_changed');report.cases.push({name,status,no_write:true,ok:true});}
    const pack=await noWrite(()=>json('/api/clean-song/draft/pack',{...fixture.request,expected_draft_sha256:fingerprint}));
    assert.equal(pack.draft_sha256,fingerprint);
    const bytes=Buffer.from(pack.zip_base64,'base64'),inventory=assertVsqAuthoringZip(bytes,fixture);
    const preview=await noWrite(()=>upload('preview',bytes));
    assert.equal(preview.summary.ready,1);assert.equal(preview.items.length,1);assert.equal(preview.items[0].playable,false);
    assert.equal(preview.items[0].clean_package.profile,'wmh-vsq-clean-v1');
    assert.deepEqual(preview.items[0].clean_package.coverage,JSON.parse(draft.package.score_json).coverage);
    assert.equal((await json('/api/library/list')).entries.length,0);
    report.cases.push({name:'explicit-pack-and-preview-preserve-bytes-without-saving',ok:true,zip_sha256:digest(bytes),files:inventory});
    const saved=await upload('commit',bytes);
    assert.equal(saved.summary.saved,1);assert.equal(saved.items[0].entry.key,fixture.key);assert.equal(saved.items[0].playable,false);
    const listed=await json('/api/library/list');assert.deepEqual(listed.issues,[]);assert.deepEqual(listed.entries.map(e=>e.key),[fixture.key]);
    await load();await choiceGuards();
    report.cases.push({name:'explicit-save-load-keeps-runtime-null-until-choice',key:fixture.key,ok:true});
    const runtime=await noWrite(()=>json('/api/library/runtime',{key:fixture.key,profile:'wmh-vsq-clean-v1',choice:'base_notes_instrumental'}));
    validateVsqAuthoringRuntime(runtime,fixture);await load();
    report.cases.push({name:'explicit-instrumental-choice-matches-exact-native-runtime',parts:3,notes:2,audible_notes:1,ok:true});
    const exported=await noWrite(async()=>{const response=await request('/api/library/pack/export',{keys:[fixture.key]});assert.equal(response.status,200);return response.bytes();});
    report.cases.push({name:'export-preserves-exact-complete-metadata-and-score',sha256:digest(exported),files:assertVsqAuthoringZip(exported,fixture),ok:true});
    // Explicit import commit may retain its own receipt and source backup even
    // for a duplicate. The song entries and complete clean bytes must not change.
    const beforeDuplicate=await json('/api/library/list');
    assert.equal((await upload('commit',exported)).summary.duplicate,1);
    assert.deepEqual(await json('/api/library/list'),beforeDuplicate);await load();
    report.cases.push({name:'explicit-export-reimport-detects-duplicate-without-changing-song',ok:true});
    const firstPid=driver.pid;await close();launch();assert.notEqual(driver.pid,firstPid);
    assert.deepEqual((await json('/api/library/list')).entries.map(e=>e.key),[fixture.key]);
    await load();await choiceGuards();
    validateVsqAuthoringRuntime(await noWrite(()=>json('/api/library/runtime',{key:fixture.key,profile:'wmh-vsq-clean-v1',choice:'base_notes_instrumental'})),fixture);
    await load();
    report.cases.push({name:'fresh-process-restart-requires-choice-again-and-preserves-all-bytes',ok:true});
    assert.deepEqual(vsqAuthoringFixture().bytes,fixture.bytes);
    await close();report.ok=true;return report;
  }catch(error){report.error=String(error?.stack??error);throw error;}
  finally{try{await driver?.close();}finally{await rm(directory,{recursive:true,force:true});if(reportPath){await mkdir(dirname(reportPath),{recursive:true});await writeFile(reportPath,JSON.stringify(report,null,2)+'\n');}console.log(JSON.stringify(report,null,2));}}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)await checkVsqAuthoringNative();

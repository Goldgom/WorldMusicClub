// The real Rust stdio API owns conversion, validation and runtime compilation.
// This check starts no listener, browser, native window or physical audio.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,readFile,readdir,rm,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {startVsqNativeDriver} from '../tests/vsq-native-driver-fixtures.js';
import {authoringAcceptanceFixtures,AUTHORING_PAIR_ALIAS} from './prepare-song-authoring-fixtures.mjs';
import {readBulkEvidenceZip} from './verify-native-bulk-import-evidence.mjs';
import {prepareCleanSong,preparePerformanceSong} from '../web/clean-song-package.js';
import {inspectCleanRendition} from '../web/clean-song-player.js';
import {validateAuthoringDraft} from './song-authoring-fixture-contract.mjs';

const digest=value=>createHash('sha256').update(value).digest('hex');
export function assertAuthoringZip(bytes,expected){
  const members=readBulkEvidenceZip(bytes),manifest=JSON.parse(members.get('manifest.json'));
  assert.equal(manifest.format,'worldmusichub-song-pack');assert.equal(manifest.version,2);assert.equal(manifest.songs.length,expected.length);assert.equal(members.size,1+2*expected.length);
  const remaining=new Set(expected);
  for(const song of manifest.songs){
    const metadata=members.get(`${song.folder}/metadata.json`),score=members.get(`${song.folder}/score.json`);
    assert.ok(metadata&&score,'Every declared song contains complete clean files');
    const found=[...remaining].find(e=>metadata.equals(Buffer.from(e.metadata_json))&&score.equals(Buffer.from(e.score_json)));
    assert.ok(found,'ZIP changed exact metadata/score bytes or added an unreviewed song');remaining.delete(found);
  }
  assert.equal(remaining.size,0);return [...members].map(([path,bytes])=>({path,bytes:bytes.length,sha256:digest(bytes)}));
}
async function snapshot(directory){
  const files=[];
  async function walk(folder,prefix=''){for(const item of (await readdir(folder,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){const relative=prefix+item.name;if(item.isDirectory())await walk(join(folder,item.name),relative+'/');else{assert.ok(item.isFile());const bytes=await readFile(join(folder,item.name));files.push({path:relative,bytes:bytes.length,sha256:digest(bytes)});}}}
  await walk(directory);return files;
}
export async function checkSongAuthoringNative({binary=process.env.WMH_NATIVE_IMPORT_DRIVER,reportPath=process.env.WMH_AUTHORING_REPORT}={}){
  if(!binary)throw Error('Set WMH_NATIVE_IMPORT_DRIVER to an exact-source native_import_driver; fixtures alone are not native acceptance.');
  const driverSha256=digest(await readFile(binary));
  const directory=await mkdtemp(join(tmpdir(),'wmh-authoring-protocol-')),fixtures=authoringAcceptanceFixtures(),library=join(directory,'original');let driver;
  const report={version:1,ok:false,scope:'real-native-stdio',browser:false,native_window:false,physical_audio:false,driver_sha256:driverSha256,pair_alias:AUTHORING_PAIR_ALIAS,fixtures:fixtures.map(f=>f.manifest),cases:[],admission:[]};
  const launch=root=>{driver=startVsqNativeDriver({binary,directory:root});};
  const close=async()=>{await driver.close();driver=null;};
  const request=(path,body)=>driver.fetcher(path,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const json=async(path,body,status=200)=>{const response=await request(path,body),data=await response.json();assert.equal(response.status,status,JSON.stringify(data));return data;};
  const upload=async(mode,bytes,keepBoth=false)=>{const response=await driver.fetcher(`/api/library/import/${mode}`,{method:'POST',headers:{'Content-Type':'application/zip','X-WMH-Filename':'authoring-original.zip',...(keepBoth?{'X-WMH-Conflict':'keep-both'}:{})},body:bytes}),data=await response.json();assert.equal(response.status,200,JSON.stringify(data));return data;};
  const noWrite=async(action)=>{const before=await snapshot(library),entries=await json('/api/library/list');const result=await action();assert.deepEqual(await json('/api/library/list'),entries);assert.deepEqual(await snapshot(library),before,'Read-only or rejected authoring operation wrote native storage');return result;};
  const expected=new Map();
  const verifyLibrary=async()=>{
    const listed=await json('/api/library/list');assert.deepEqual(listed.issues,[]);assert.deepEqual(listed.entries.map(e=>e.key).sort(),[...expected.keys()].sort());
    for(const [key,row]of expected){const loaded=await json('/api/library/load',{key});assert.equal(loaded.clean_package.metadata_json,row.package.metadata_json);assert.equal(loaded.clean_package.score_json,row.package.score_json);assert.deepEqual(loaded.clean_package,row.opened.clean_package);assert.equal(loaded.score_json,row.opened.score_json);}
  };
  try{
    launch(library);assert.equal((await json('/api/library/list')).entries.length,0);
    const drafts=new Map();
    for(const fixture of fixtures){const draft=await noWrite(()=>json('/api/clean-song/draft',fixture.request,fixture.id==='blocked'?422:200));validateAuthoringDraft(draft,fixture);drafts.set(fixture.id,draft);}
    report.cases.push({name:'whole-original-inventory-and-exact-event-coordinates',ok:true});
    const strict=fixtures[0],fingerprint=drafts.get('strict').draft_sha256;
    const negatives=[
      ['blank-title','/api/clean-song/draft',{...strict.request,title:' '},400],
      ['control-title','/api/clean-song/draft',{...strict.request,title:'original\n'},400],
      ['invalid-base64','/api/clean-song/draft',{...strict.request,source_base64:'not base64!'},400],
      ['unknown-selection','/api/clean-song/draft',{...strict.request,selected_tracks:[1]},400],
      ['stale-title','/api/clean-song/draft/pack',{...strict.request,title:'Changed title',expected_draft_sha256:fingerprint},409],
      ['stale-source','/api/clean-song/draft/pack',{...strict.request,source_base64:fixtures[1].request.source_base64,expected_draft_sha256:fingerprint},409],
      ['invalid-fingerprint','/api/clean-song/draft/pack',{...strict.request,expected_draft_sha256:'0'.repeat(64)},409],
      ['missing-fingerprint','/api/clean-song/draft/pack',strict.request,400],
      ['blocked-pack','/api/clean-song/draft/pack',{...fixtures[2].request,expected_draft_sha256:fingerprint},422],
    ];
    for(const [name,path,body,status]of negatives){const response=await noWrite(()=>json(path,body,status));assert.equal('zip_base64' in response,false);if(status===409)assert.equal(response.code,'clean_draft_changed');report.cases.push({name,status,no_write:true,ok:true});}
    for(const fixture of fixtures.filter(f=>f.id!=='blocked')){
      const draft=drafts.get(fixture.id),pack=await noWrite(()=>json('/api/clean-song/draft/pack',{...fixture.request,expected_draft_sha256:draft.draft_sha256}));
      assert.equal(pack.draft_sha256,draft.draft_sha256);const bytes=Buffer.from(pack.zip_base64,'base64');assertAuthoringZip(bytes,[draft.package]);
      const preview=await noWrite(()=>upload('preview',bytes));assert.equal(preview.summary.ready,1);assert.equal(preview.items.length,1);assert.equal(preview.items[0].clean_package.notation_available,fixture.id==='strict');
      const committed=await upload('commit',bytes);assert.equal(committed.summary.saved,1);const key=committed.items[0].entry.key,opened=await json('/api/library/load',{key});
      const admission=fixture.id==='strict'?prepareCleanSong(`native:${key}`,opened.clean_package,JSON.parse(opened.score_json)):await preparePerformanceSong(`native:${key}`,opened.clean_package,opened.score_json);
      assert.equal(admission.profile,fixture.expectedProfile);assert.equal(admission.metadata_json,draft.package.metadata_json);assert.equal(admission.score_json,draft.package.score_json);
      const runtime=opened.clean_package.runtime;
      if(fixture.id==='strict'){assert.equal(runtime.notes.length,fixture.inventory.key_attacks);assert.ok(runtime.notes.some(n=>n.key===24));assert.ok(runtime.notes.some(n=>n.key===100));}
      else{assert.equal(admission.notation,null);assert.equal(admission.compilation,null);assert.equal('notes' in runtime,false);assert.equal(runtime.events.length,fixture.inventory.source_events);assert.ok(runtime.events.some(e=>e.command.kind==='key_attack'&&e.command.key===24));assert.ok(runtime.events.some(e=>e.command.kind==='key_attack'&&e.command.key===100));}
      const rendition=fixture.id==='strict'?inspectCleanRendition(admission):null;
      if(rendition){assert.equal(preview.items[0].playable,true);assert.equal(rendition.supported,false);assert.ok(rendition.blockers.includes('bank_select'));}
      report.admission.push({receiver_rendition:rendition,fixture:fixture.id,profile:admission.profile,runtime_received:true,notation_available:fixture.id==='strict',native_import_playable:preview.items[0].playable,reference_playable:admission.reference?.playable??null,reference_blockers:admission.reference?.blockers??[],instrument_range_acceptance:'not-asserted',physical_audio:false});
      expected.set(key,{fixture:fixture.id,package:draft.package,opened});await verifyLibrary();assert.equal((await upload('commit',bytes)).summary.duplicate,1);await verifyLibrary();
      report.cases.push({name:`${fixture.id}-draft-pack-preview-commit-load-duplicate`,key,draft_sha256:draft.draft_sha256,zip_sha256:digest(bytes),ok:true});
    }
    const renamed={...strict,title:strict.title+' alternate edition',request:{...strict.request,title:strict.title+' alternate edition'}};
    const changed=await noWrite(()=>json('/api/clean-song/draft',renamed.request));validateAuthoringDraft(changed,renamed);assert.notEqual(changed.draft_sha256,fingerprint);
    assert.equal(JSON.parse(changed.package.metadata_json).id,JSON.parse(drafts.get('strict').package.metadata_json).id);
    const repack=await noWrite(()=>json('/api/clean-song/draft/pack',{...renamed.request,expected_draft_sha256:changed.draft_sha256})),changedBytes=Buffer.from(repack.zip_base64,'base64');assertAuthoringZip(changedBytes,[changed.package]);
    assert.equal((await noWrite(()=>upload('preview',changedBytes))).summary.conflict,1);const conflict=await upload('commit',changedBytes);assert.equal(conflict.summary.conflict,1);await verifyLibrary();
    const kept=await upload('commit',changedBytes,true);assert.equal(kept.summary.saved,1);const changedKey=kept.items[0].entry.key;assert.ok(!expected.has(changedKey));expected.set(changedKey,{fixture:'strict-retitled',package:changed.package,opened:await json('/api/library/load',{key:changedKey})});await verifyLibrary();
    report.cases.push({name:'reprepared-title-conflict-requires-explicit-keep-both',key:changedKey,ok:true});
    const firstPid=driver.pid;await close();launch(library);assert.notEqual(driver.pid,firstPid);await verifyLibrary();report.cases.push({name:'fresh-process-restart-loads-all-exact-clean-bytes',ok:true});
    const exported=await request('/api/library/pack/export',{keys:[...expected.keys()]});assert.equal(exported.status,200);const exportedBytes=await exported.bytes(),inventory=assertAuthoringZip(exportedBytes,[...expected.values()].map(row=>row.package));
    assert.equal((await upload('commit',exportedBytes)).summary.duplicate,expected.size);await verifyLibrary();
    report.cases.push({name:'exact-complete-metadata-score-export',sha256:digest(exportedBytes),files:inventory,ok:true});
    await close();launch(join(directory,'fresh-import'));assert.equal((await json('/api/library/list')).entries.length,0);assert.equal((await upload('preview',exportedBytes,true)).summary.ready,expected.size);assert.equal((await json('/api/library/list')).entries.length,0);
    assert.equal((await upload('commit',exportedBytes,true)).summary.saved,expected.size);await verifyLibrary();report.cases.push({name:'export-imports-exact-original-and-retitled-editions-into-fresh-library',ok:true});
    // Source bytes belong to the original input, not the clean package. Rebuild
    // independently to establish that no acceptance step changed any original.
    assert.deepEqual(authoringAcceptanceFixtures().map(f=>f.bytes),fixtures.map(f=>f.bytes));
    await close();report.ok=true;return report;
  }catch(error){report.error=String(error?.stack??error);throw error;}
  finally{try{await driver?.close();}finally{await rm(directory,{recursive:true,force:true});if(reportPath){await mkdir(dirname(reportPath),{recursive:true});await writeFile(reportPath,JSON.stringify(report,null,2)+'\n');}console.log(JSON.stringify(report,null,2));}}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)await checkSongAuthoringNative();

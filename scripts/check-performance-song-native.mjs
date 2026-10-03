// Real Rust stdin protocol only. This never launches a browser, GUI, or listener.
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname,join} from 'node:path';
import {startVsqNativeDriver as startBoundedNativeDriver} from '../tests/vsq-native-driver-fixtures.js';
import {performanceAcceptanceFixtures} from './prepare-performance-song-fixtures.mjs';
import {digest,inspectAuthoredZip} from '../tests/clean-song-package-fixtures.js';
import {preparePerformanceSong} from '../web/clean-song-package.js';

const binary=process.env.WMH_NATIVE_IMPORT_DRIVER;
if(!binary)throw Error('An exact-source native_import_driver is required');
const directory=await mkdtemp(join(tmpdir(),'wmh-performance-protocol-')),pack=performanceAcceptanceFixtures();
let driver;
const report={version:1,ok:false,browser:false,native_window:false,physical_audio:false,driver_sha256:digest(await readFile(binary)),fixture_sha256:pack.manifest.sha256,request_scope:'ordinary-library-flow-excludes-explicit-negative-probes',requests:[],negative_probes:[],cases:[]};
const request=(path,body)=>{
  report.requests.push(path);
  return driver.fetcher(path,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
};
const json=async(path,body)=>{const response=await request(path,body);assert.ok(response.ok,await response.text());return response.json();};
const upload=async(mode,bytes=pack.bytes)=>{
  const path=`/api/library/import/${mode}`;report.requests.push(path);
  const response=await driver.fetcher(path,{method:'POST',headers:{'Content-Type':'application/zip','X-WMH-Filename':pack.filename},body:bytes});
  assert.ok(response.ok,await response.text());return response.json();
};
const verifyLibrary=async()=>{
  const listed=await json('/api/library/list');
  assert.deepEqual(listed.entries.map(entry=>entry.key).sort(),pack.fixtures.map(f=>f.key).sort());assert.deepEqual(listed.issues,[]);
  for(const fixture of pack.fixtures) {
    const loaded=await json('/api/library/load',{key:fixture.key});
    assert.deepEqual({score_json:loaded.score_json,clean_package:loaded.clean_package},fixture.opened);
    assert.deepEqual(loaded.entry.clean_package,fixture.summary);
    const song=await preparePerformanceSong(`native:${fixture.key}`,loaded.clean_package,loaded.score_json);
    assert.deepEqual(song.reference,fixture.reference);assert.equal(song.notation,null);assert.equal(song.compilation,null);
    assert.equal(song.score.coverage.targets.represented_attacks,0);assert.equal('notes' in song.runtime,false);
  }
};
const verifyUnavailablePractice=async()=>{
  // These explicit negative API probes are separate from ordinary library/app
  // traffic. They use the real saved identity and never fabricate notation.
  for(const fixture of pack.fixtures) {
    const source={key:fixture.key,content_sha256:fixture.opened.clean_package.content_sha256,profile:fixture.opened.clean_package.profile};
    const probes=[
      ...['piano','guitar'].map(kind=>({path:`/api/library/fingering/${kind}`,body:{source,settings:{}},code:'library_fingering_source'})),
      {path:'/api/library/runtime',body:{key:fixture.key,profile:source.profile,choice:'base_notes_instrumental'},code:'library_runtime_profile'},
      {path:'/api/library/runtime',body:{key:fixture.key,profile:'wmh-vsq-clean-v1',choice:'base_notes_instrumental'},code:'library_runtime_profile'},
    ];
    for(const probe of probes) {
      const response=await driver.fetcher(probe.path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(probe.body)});
      const result=await response.json();
      assert.equal(response.status,422);assert.equal(result.code,probe.code);assert.equal('plan' in result,false);assert.equal('runtime' in result,false);
      report.negative_probes.push({fixture:fixture.name,path:probe.path,request:probe.body,status:response.status,code:result.code,ok:true});
    }
  }
};

try {
  const library=join(directory,'original');driver=startBoundedNativeDriver({binary,directory:library});
  const preview=await upload('preview');assert.equal(preview.summary.ready,2);assert.equal(preview.items.length,2);
  for(const item of preview.items){assert.equal(item.playable,false);assert.equal(item.clean_package.profile,'wmh-performance-midi1-v1');assert.equal(item.clean_package.notation_available,false);}
  assert.equal((await json('/api/library/list')).entries.length,0);
  const saved=await upload('commit');assert.equal(saved.summary.saved,2);
  assert.deepEqual(saved.items.map(item=>item.entry.key).sort(),pack.fixtures.map(f=>f.key).sort());await verifyLibrary();
  report.cases.push({name:'both-authored-complete-songs-coexist-without-notation-or-targets',ok:true});
  await verifyUnavailablePractice();await verifyLibrary();
  report.cases.push({name:'explicit-piano-guitar-and-vsq-practice-probes-reject-both-typed-songs',probes:report.negative_probes.length,ok:true});
  assert.equal((await upload('commit')).summary.duplicate,2);await verifyLibrary();
  report.cases.push({name:'whole-pack-content-deduplication',ok:true});
  const exported=await request('/api/library/pack/export',{keys:pack.fixtures.map(f=>f.key)});assert.ok(exported.ok);
  const bytes=await exported.bytes(),inventory=inspectAuthoredZip(bytes),expected=new Map();
  for(const fixture of pack.fixtures)for(const[path,data] of fixture.files)expected.set(`songs/${fixture.key}/${path}`,{bytes:data.length,sha256:digest(data)});
  assert.equal(Object.keys(inventory).length,expected.size+1);assert.ok(inventory['manifest.json']);
  for(const[path,entry]of expected)assert.deepEqual(inventory[path],entry);
  assert.equal((await upload('commit',bytes)).summary.duplicate,2);await verifyLibrary();
  report.cases.push({name:'exact-metadata-and-score-pair-export-reimport',export_sha256:digest(bytes),files:inventory,ok:true});
  await driver.close();driver=null;driver=startBoundedNativeDriver({binary,directory:library});await verifyLibrary();
  report.cases.push({name:'fresh-native-process-reloads-both-original-runtimes',ok:true});
  await driver.close();driver=null;driver=startBoundedNativeDriver({binary,directory:join(directory,'reimport')});
  assert.equal((await upload('commit',bytes)).summary.saved,2);await verifyLibrary();
  report.cases.push({name:'export-imports-both-songs-into-a-fresh-library',ok:true});
  assert.ok(report.requests.every(path=>['/api/library/list','/api/library/load','/api/library/import/preview','/api/library/import/commit','/api/library/pack/export'].includes(path)));
  report.cases.push({name:'no-compile-runtime-practice-or-fingering-endpoints',scope:'ordinary-library-flow',ok:true});
  await driver.close();driver=null;
  report.ok=true;
} finally {
  try {await driver?.close();} finally {
    await rm(directory,{recursive:true,force:true});
    if(process.env.WMH_PERFORMANCE_REPORT){await mkdir(dirname(process.env.WMH_PERFORMANCE_REPORT),{recursive:true});await writeFile(process.env.WMH_PERFORMANCE_REPORT,JSON.stringify(report,null,2)+'\n');}
    console.log(JSON.stringify(report,null,2));
  }
}

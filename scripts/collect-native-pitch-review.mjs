// Additive, bounded review outputs. Preserve every byte in the full artifact.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {lstat,readFile,writeFile,mkdir} from 'node:fs/promises';
import {join,resolve,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {PITCH_SOURCES_NATIVE_PHASES,PITCH_SOURCES_NATIVE_FIXTURE} from './native-pitch-sources-fixtures.mjs';
import {PITCH_SOURCES_CLAIMS} from './verify-native-pitch-sources.mjs';
import {passivePngPixels} from './native-passive-capture-evidence.mjs';
import {buildDiagnosticsExecutableBinding} from './build-diagnostics-evidence.mjs';

const MIB=1024*1024,hash=bytes=>createHash('sha256').update(bytes).digest('hex');
export const PITCH_REVIEW_BOUNDS=Object.freeze({screenshots:28*MIB,executable:31*MIB,metadata:2*MIB,fixture:128*1024,screenshotCount:36});
const parse=bytes=>JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes).replace(/^\uFEFF/,''));
const metadataNames=['native-pitch-sources.json','native-pitch-sources-files.json'];
export function planPitchReview(proof,native,reports,{sourceSha}={}){
 assert.match(sourceSha,/^[a-f0-9]{40}$/);assert.equal(proof.version,1);assert.equal(proof.ok,true);assert.equal(proof.scenario,'pitch-sources');assert.equal(proof.source_sha,sourceSha);assert.match(proof.source_tree,/^[a-f0-9]{40}$/);assert.deepEqual(proof.claims,PITCH_SOURCES_CLAIMS);
 assert.equal(native.ok,true);assert.equal(native.scenario,'pitch-sources');for(const key of ['source_sha','source_tree','executable_sha256','executable_bytes'])assert.equal(native[key],proof[key]);assert.match(proof.executable_sha256,/^[a-f0-9]{64}$/);assert.ok(Number.isSafeInteger(proof.executable_bytes)&&proof.executable_bytes>0&&proof.executable_bytes<PITCH_REVIEW_BOUNDS.executable);
 assert.deepEqual(proof.phases,PITCH_SOURCES_NATIVE_PHASES);assert.deepEqual(native.phases.map(row=>row.phase),PITCH_SOURCES_NATIVE_PHASES);assert.deepEqual(reports.map(row=>row.phase),PITCH_SOURCES_NATIVE_PHASES);
 const expected=[];
 for(const report of reports){
  assert.equal(report.ok,true);assert.equal(report.scenario,'pitch-sources');assert.equal(report.cases.length,2);expected.push(`native-${report.phase}.png`);
  for(const item of report.cases)for(const run of [item.machine,item.human]){
   const shots=run.notation.screenshots;assert.deepEqual(Object.keys(shots).sort(),['jianpu','staff']);
   for(const sequence of Object.values(shots)){assert.ok(Number.isSafeInteger(sequence)&&sequence>0&&sequence<=128);expected.push(`native-action-${report.phase}-${sequence}.png`);}
  }
 }
 assert.equal(new Set(expected).size,PITCH_REVIEW_BOUNDS.screenshotCount);assert.equal(expected.length,PITCH_REVIEW_BOUNDS.screenshotCount);
 const screenshots=proof.files.filter(row=>row.path.endsWith('.png')).sort((a,b)=>a.path.localeCompare(b.path));assert.deepEqual(screenshots.map(row=>row.path),expected.sort(),'Retain exactly the original PNGs consumed by the proof');
 let total=0;for(const row of screenshots){assert.match(row.path,/^native-(?:action-)?pitch-sources-(?:seed|restart|zero|zero-restart)(?:-[1-9][0-9]{0,2})?\.png$/);assert.ok(Number.isSafeInteger(row.bytes)&&row.bytes>0&&row.bytes<=16*MIB);assert.match(row.sha256,/^[a-f0-9]{64}$/);total+=row.bytes;}
 assert.ok(total<=PITCH_REVIEW_BOUNDS.screenshots,'Selected original screenshots exceed the review bound');
 const fixture=proof.files.filter(row=>row.path===`fixtures/${PITCH_SOURCES_NATIVE_FIXTURE}`);assert.equal(fixture.length,1);assert.ok(Number.isSafeInteger(fixture[0].bytes)&&fixture[0].bytes>0&&fixture[0].bytes<=PITCH_REVIEW_BOUNDS.fixture);assert.match(fixture[0].sha256,/^[a-f0-9]{64}$/);
 return{source_sha:proof.source_sha,source_tree:proof.source_tree,executable:{name:'worldmusichub-desktop.exe',bytes:proof.executable_bytes,sha256:proof.executable_sha256},screenshots,fixture:fixture[0],screenshot_bytes:total};
}

export async function collectPitchReview(directory,executable,reviewDirectory,executableDirectory,{sourceSha}={}){
 const root=await lstat(directory);assert.ok(root.isDirectory()&&!root.isSymbolicLink(),'Review input must be an ordinary native evidence directory');assert.notEqual(resolve(reviewDirectory),resolve(executableDirectory));
 async function ordinary(name,limit){let path=directory;for(const part of name.split('/')){assert.ok(part&&part!=='.'&&part!=='..'&&!/[\\:\0\r\n]/.test(part));path=join(path,part);assert.equal((await lstat(path)).isSymbolicLink(),false);}const stat=await lstat(path);assert.ok(stat.isFile()&&stat.size>0&&stat.size<=limit);const bytes=await readFile(path);assert.equal(bytes.length,stat.size);return bytes;}
 const metadata=await Promise.all(metadataNames.map(async name=>({name,bytes:await ordinary(name,PITCH_REVIEW_BOUNDS.metadata)}))),native=parse(metadata[0].bytes),proof=parse(metadata[1].bytes),reports=await Promise.all(PITCH_SOURCES_NATIVE_PHASES.map(async phase=>parse(await ordinary(`renderer-${phase}.json`,MIB))));
 const plan=planPitchReview(proof,native,reports,{sourceSha}),actual=await buildDiagnosticsExecutableBinding(executable);assert.equal(actual.sha256,plan.executable.sha256);assert.equal(actual.bytes,plan.executable.bytes);
 const bindings=metadata.map(row=>({path:row.name,bytes:row.bytes.length,sha256:hash(row.bytes)})),bindingBytes=bindings.reduce((sum,row)=>sum+row.bytes,0);
 assert.ok(plan.screenshot_bytes+plan.fixture.bytes+bindingBytes+64*1024<=PITCH_REVIEW_BOUNDS.screenshots);assert.ok(plan.executable.bytes+bindingBytes+64*1024<=PITCH_REVIEW_BOUNDS.executable);
 const pictures=[];for(const record of plan.screenshots){const bytes=await ordinary(record.path,16*MIB);assert.equal(bytes.length,record.bytes);assert.equal(hash(bytes),record.sha256);const pixels=passivePngPixels(bytes);pictures.push({record,pixels,bytes});}
 const fixtureBytes=await ordinary(plan.fixture.path,PITCH_REVIEW_BOUNDS.fixture);assert.equal(fixtureBytes.length,plan.fixture.bytes);assert.equal(hash(fixtureBytes),plan.fixture.sha256);
 // Read before creating either output; a partial/changed input cannot publish
 // a nominally complete review folder. These are fresh runner-owned folders.
 const executableBytes=await readFile(executable);assert.equal(executableBytes.length,plan.executable.bytes);assert.equal(hash(executableBytes),plan.executable.sha256);
 await mkdir(reviewDirectory);await mkdir(executableDirectory);
 for(const row of metadata){await writeFile(join(reviewDirectory,row.name),row.bytes,{flag:'wx'});await writeFile(join(executableDirectory,row.name),row.bytes,{flag:'wx'});}
 for(const picture of pictures)await writeFile(join(reviewDirectory,picture.record.path),picture.bytes,{flag:'wx'});
 await mkdir(dirname(join(reviewDirectory,plan.fixture.path)));await writeFile(join(reviewDirectory,plan.fixture.path),fixtureBytes,{flag:'wx'});
 await writeFile(join(executableDirectory,plan.executable.name),executableBytes,{flag:'wx'});
 const index={version:1,scope:'Exact original proof-selected PNGs and small original fixture; full artifact remains retained',source_sha:plan.source_sha,source_tree:plan.source_tree,executable:plan.executable,bindings,fixture:plan.fixture,screenshots:pictures.map(row=>({...row.record,...row.pixels})),screenshot_bytes:plan.screenshot_bytes};
 await writeFile(join(reviewDirectory,'screenshot-review.json'),JSON.stringify(index,null,2)+'\n',{flag:'wx'});
 const executableIndex={version:1,scope:'Exact executable bytes and frozen native proof binding; executable is not run by this collector',source_sha:plan.source_sha,source_tree:plan.source_tree,executable:plan.executable,bindings};
 await writeFile(join(executableDirectory,'executable-review.json'),JSON.stringify(executableIndex,null,2)+'\n',{flag:'wx'});
 return{source_sha:plan.source_sha,screenshot_count:pictures.length,screenshot_bytes:plan.screenshot_bytes,fixture_bytes:plan.fixture.bytes,binding_bytes:bindingBytes,executable_bytes:plan.executable.bytes,review_max_bytes:PITCH_REVIEW_BOUNDS.screenshots,executable_max_bytes:PITCH_REVIEW_BOUNDS.executable};
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){assert.equal(process.env.GITHUB_ACTIONS,'true','Only the hosted exact-source workflow publishes review outputs');assert.equal(process.argv.length,6);console.log(JSON.stringify(await collectPitchReview(...process.argv.slice(2).map(path=>resolve(path)),{sourceSha:process.env.GITHUB_SHA}),null,2));}

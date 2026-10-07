import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {planPitchReview,PITCH_REVIEW_BOUNDS} from '../scripts/collect-native-pitch-review.mjs';
import {PITCH_SOURCES_CLAIMS} from '../scripts/verify-native-pitch-sources.mjs';
import {PITCH_SOURCES_NATIVE_PHASES,PITCH_SOURCES_NATIVE_FIXTURE} from '../scripts/native-pitch-sources-fixtures.mjs';

// Metadata-only retention fixtures. They are never native run/pixel evidence.
function synthetic(){
 const reports=PITCH_SOURCES_NATIVE_PHASES.map(phase=>({phase,ok:true,scenario:'pitch-sources',cases:[0,1].map(index=>({machine:{notation:{screenshots:{staff:10+index*40,jianpu:11+index*40}}},human:{notation:{screenshots:{staff:20+index*40,jianpu:21+index*40}}}}))}));
 const files=reports.flatMap(report=>[{path:`native-${report.phase}.png`,bytes:100,sha256:'c'.repeat(64)},...report.cases.flatMap(item=>[item.machine,item.human].flatMap(run=>Object.values(run.notation.screenshots).map(sequence=>({path:`native-action-${report.phase}-${sequence}.png`,bytes:100,sha256:'c'.repeat(64)}))))]);
 files.push({path:`fixtures/${PITCH_SOURCES_NATIVE_FIXTURE}`,bytes:100,sha256:'d'.repeat(64)});
 const proof={version:1,ok:true,scenario:'pitch-sources',source_sha:'a'.repeat(40),source_tree:'b'.repeat(40),executable_sha256:'e'.repeat(64),executable_bytes:25_299_456,claims:structuredClone(PITCH_SOURCES_CLAIMS),phases:[...PITCH_SOURCES_NATIVE_PHASES],files};
 const native={ok:true,scenario:proof.scenario,source_sha:proof.source_sha,source_tree:proof.source_tree,executable_sha256:proof.executable_sha256,executable_bytes:proof.executable_bytes,phases:PITCH_SOURCES_NATIVE_PHASES.map(phase=>({phase}))};return{proof,native,reports,sourceSha:proof.source_sha};
}
const plan=value=>planPitchReview(value.proof,value.native,value.reports,{sourceSha:value.sourceSha});
test('review output chooses all36 proof screenshots and the bounded original fixture without all action PNGs',()=>{
 const result=plan(synthetic());assert.equal(result.screenshots.length,36);assert.equal(result.screenshot_bytes,3600);assert.equal(result.fixture.path,`fixtures/${PITCH_SOURCES_NATIVE_FIXTURE}`);assert.ok(PITCH_REVIEW_BOUNDS.screenshots<32*1024*1024);assert.ok(PITCH_REVIEW_BOUNDS.executable<32*1024*1024);
});
test('review output rejects missing extra duplicate unbound oversized or traversal metadata',()=>{
 for(const change of [v=>v.proof.files.shift(),v=>v.proof.files.push({path:'native-action-pitch-sources-seed-127.png',bytes:100,sha256:'c'.repeat(64)}),v=>v.reports[0].cases[0].human.notation.screenshots.staff=10,v=>v.sourceSha='f'.repeat(40),v=>v.native.executable_sha256='f'.repeat(64),v=>v.proof.files[0].path='../outside.png',v=>v.proof.files[0].bytes=32*1024*1024,v=>v.proof.ok=false,v=>v.reports[0].ok=false,v=>v.proof.claims.physical_audio=true]){const value=synthetic();change(value);assert.throws(()=>plan(value));}
});
test('forward workflow keeps the full artifact and separately publishes bounded originals and executable binding',()=>{
 const workflow=readFileSync(new URL('../.github/workflows/native-pitch-sources.yml',import.meta.url),'utf8');
 for(const text of ['collect-native-pitch-review.mjs','native-pitch-sources-review-${{ github.sha }}','native-pitch-sources-executable-${{ github.sha }}','native-pitch-sources-${{ github.sha }}','target/release/worldmusichub-desktop.exe','if: always()'])assert.ok(workflow.includes(text),text);
 assert.equal(workflow.includes('download_url'),false);
});

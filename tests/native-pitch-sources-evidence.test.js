import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {PITCH_SOURCES_SOURCE_FILES,PITCH_SOURCES_CLAIMS,validateNativePitchSourcesActions,validatePitchSourceNotation} from '../scripts/verify-native-pitch-sources.mjs';
import {PITCH_SOURCES_NATIVE_PHASES,nativePitchSourcesFixture} from '../scripts/native-pitch-sources-fixtures.mjs';

const read=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8');
test('source pitch lane keeps finite explicit source closure and limited native claims',()=>{
 assert.ok(PITCH_SOURCES_SOURCE_FILES.length<=384);assert.equal(new Set(PITCH_SOURCES_SOURCE_FILES).size,PITCH_SOURCES_SOURCE_FILES.length);
 for(const path of ['crates/score-core/src/basic_keys/rendition.rs','crates/score-core/src/vsq_clean/runtime.rs','web/pitch-mod-context.js','scripts/native-pitch-sources-renderer.js','tests/fixtures/pitch-mod-handler-vectors.json','scripts/basic-practice-admission-proof.mjs','web/basic-practice-admission.js','web/source-practice-eligibility.js','crates/score-core/src/source_identity/eligibility.rs','crates/desktop-shell/src/native_assistance.rs','crates/desktop-shell/src/native_library.rs'])assert.ok(PITCH_SOURCES_SOURCE_FILES.includes(path));
 for(const key of ['physical_audio','physical_midi','source_specific_trusted_hits','raw_vsq_import','original_singing_voice','full_acceptance','release_ready'])assert.equal(PITCH_SOURCES_CLAIMS[key],false);
 assert.deepEqual(PITCH_SOURCES_NATIVE_PHASES,['pitch-sources-seed','pitch-sources-restart','pitch-sources-zero','pitch-sources-zero-restart']);
});

test('source native proof rejects a nominal success without actual owned actions or pixels',()=>{
 for(const phase of PITCH_SOURCES_NATIVE_PHASES)assert.throws(()=>validateNativePitchSourcesActions({phase,actions:1,controls:[],trusted:[]},{actions:1,process_id:7},[],[]));
 assert.throws(()=>validatePitchSourceNotation({kind:'vsq',semitones:2,machine:{notation:{}},human:{notation:{}}}));
});

test('source workflow uses original generated fixtures and same pinned Windows gates',()=>{
 const workflow=read('.github/workflows/native-pitch-sources.yml'),renderer=read('scripts/native-pitch-sources-renderer.js'),host=read('scripts/windows-desktop-acceptance.ps1'),registration=read('crates/desktop-shell/src/acceptance.rs'),profile=read('scripts/windows-desktop-profile.ps1');
 for(const token of ["node-version: '22.23.3'","python-version: '3.12.10'","toolchain: '1.99.0'",'PyYAML==6.0.3','--test native_pitch_mod','-Scenario pitch-sources','verify-native-pitch-sources.mjs --check','if: always()'])assert.ok(workflow.includes(token),token);
 for(const token of ['PITCH_SOURCES_PHASES','pitch_sources_require_ordered_profile_predecessors_and_closed_original_actions','native-pitch-sources-renderer.js','pitch-sources-original.wmhpack'])assert.ok(registration.includes(token),token);
 for(const phase of PITCH_SOURCES_NATIVE_PHASES){assert.ok(profile.includes(phase));assert.ok(host.includes(phase));assert.ok(renderer.includes(phase));}
 for(const token of ['createNativePitchSourcesRequestObserver','observeBasicKeyReceiver',"row.observation='consumed'",'readOnlyZeroProjection',"await click('vsq-choose-base-notes')",'sourceSpecificTrustedHits:false',"receiver.quiet()"] )assert.ok(renderer.includes(token),token);
 assert.equal(renderer.includes('HeldPerformanceKey'),false);assert.equal(renderer.includes('key-s'),false);assert.equal(workflow.includes('releases:'),false);assert.equal(workflow.includes('branches: [main]'),false);
 const fixture=nativePitchSourcesFixture();assert.ok(fixture.manifest.sources.every(source=>source.semantic_clean_package&&source.raw_source_bundled===false));
});

test('source observer retains the consumed strict Basic admission without replacing JSON or VSQ targets',async()=>{
 const source=read('scripts/native-pitch-sources-renderer.js').split('/* Complete saved Basic FIFO')[0];
 const create=vm.runInNewContext(`${source};createNativePitchSourcesRequestObserver`,{structuredClone,TextEncoder});
 const rows=[],errors=[],response={source:{key:'saved'},checked:{receipt:{source_eligibility:{fingerprint:'observed-only'}}}},fetchOwner={fetch:async()=>({status:200,json:()=>Promise.resolve(response)})},original=fetchOwner.fetch;
 const observer=create({fetchOwner,onRequest:row=>rows.push(row),onError:error=>errors.push(error),readContext:()=>({actionSequence:4,case:'basic-2'})});
 for(const path of ['/api/library/practice-admission','/api/practice-targets']){
  const request=path.endsWith('practice-admission')?{source:{key:'saved'},pitch_mod:{format:'wmc-pitch-mod',version:1,semitones:2},selection:{selected_part_ids:['human'],profile:{kind:'piano',key_count:88,lowest_midi:21}}}:{timeline:{notes:[],duration_ms:0},profile:{kind:'piano',key_count:88,lowest_midi:21}};
  const fetched=await fetchOwner.fetch(path,{method:'POST',body:JSON.stringify(request)}),result=await fetched.json();await Promise.resolve();
  assert.equal(result,response);assert.deepEqual(structuredClone(rows.at(-1).request),request);assert.deepEqual(rows.at(-1).response,response);assert.equal(rows.at(-1).observation,'consumed');assert.equal(rows.at(-1).path,path);
 }
 assert.deepEqual(errors,[]);assert.equal(observer.settled(),true);assert.equal(observer.restore(),true);assert.equal(fetchOwner.fetch,original);
 for(const name of ['scripts/native-pitch-sources-fixtures.mjs','scripts/native-pitch-sources-proof.mjs','scripts/verify-native-pitch-sources.mjs'])assert.equal(/withMockBasicEligibility|mockBasicPracticeAdmission/.test(read(name)),false,'Production proof must not enrich legacy goldens');
});

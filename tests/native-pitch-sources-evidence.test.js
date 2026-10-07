import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PITCH_SOURCES_SOURCE_FILES,PITCH_SOURCES_CLAIMS,validateNativePitchSourcesActions,validatePitchSourceNotation} from '../scripts/verify-native-pitch-sources.mjs';
import {PITCH_SOURCES_NATIVE_PHASES,nativePitchSourcesFixture} from '../scripts/native-pitch-sources-fixtures.mjs';

const read=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8');
test('source pitch lane keeps finite explicit source closure and limited native claims',()=>{
 assert.ok(PITCH_SOURCES_SOURCE_FILES.length<=384);assert.equal(new Set(PITCH_SOURCES_SOURCE_FILES).size,PITCH_SOURCES_SOURCE_FILES.length);
 for(const path of ['crates/score-core/src/basic_keys/rendition.rs','crates/score-core/src/vsq_clean/runtime.rs','web/pitch-mod-context.js','scripts/native-pitch-sources-renderer.js','tests/fixtures/pitch-mod-handler-vectors.json'])assert.ok(PITCH_SOURCES_SOURCE_FILES.includes(path));
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

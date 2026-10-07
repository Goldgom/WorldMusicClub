import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {nativePitchModFixture, PITCH_MOD_NATIVE_PHASES} from '../scripts/native-pitch-mod-fixtures.mjs';
import {NATIVE_PITCH_MOD_CLAIMS, PITCH_MOD_SOURCE_FILES, validateNativePitchActions} from '../scripts/verify-native-pitch-mod-evidence.mjs';

test('native pitch fixtures retain original canonical C4 bytes and bounded claims', () => {
  const fixture=nativePitchModFixture();assert.deepEqual(JSON.parse(fixture.bytes),fixture.score);assert.equal(fixture.manifest.rights.license,'CC0-1.0');
  assert.deepEqual(PITCH_MOD_NATIVE_PHASES,['pitch-mod-seed','pitch-mod-restart']);
  for(const key of ['physical_audio','physical_midi','basic_native_runtime','vsq_native_runtime','full_acceptance','release_ready'])assert.equal(NATIVE_PITCH_MOD_CLAIMS[key],false);
  assert.equal(new Set(PITCH_MOD_SOURCE_FILES).size,PITCH_MOD_SOURCE_FILES.length);
  for(const path of ['crates/score-core/src/pitch_projection.rs','crates/practice-server/src/pitch_mod_api.rs','crates/desktop-shell/src/native_pitch_mod.rs','web/pitch-mod.js'])assert.ok(PITCH_MOD_SOURCE_FILES.includes(path));
});

test('native pitch evidence rejects unknown phase, absent actions and missing native ownership', () => {
  for(const phase of ['seed','assistance-restart','pitch-mod-restart'])assert.throws(()=>validateNativePitchActions({phase,actions:1,controls:[],trusted:[]},{actions:1,process_id:7},[],[]));
  assert.throws(()=>validateNativePitchActions({phase:'pitch-mod-restart',actions:1,controls:[],trusted:[],keyAction:1},{actions:1,process_id:7},[{version:1,sequence:1,kind:'pitch-mod-key-s',x:20,y:30,width:1280,height:720}],[{ok:true}]));
});

test('native pitch workflow preserves exact pins, fresh evidence and independent revalidation', () => {
  const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
  const workflow=read('.github/workflows/native-pitch-mod.yml'),renderer=read('scripts/native-pitch-mod-renderer.js'),host=read('scripts/windows-desktop-acceptance.ps1'),registration=read('crates/desktop-shell/src/acceptance.rs');
  for(const token of ["node-version: '22.23.3'","python-version: '3.12.10'","toolchain: '1.99.0'",'PyYAML==6.0.3','--test native_pitch_mod','-Scenario pitch-mod','verify-native-pitch-mod-evidence.mjs --check','if: always()'])assert.ok(workflow.includes(token),token);
  for(const token of ['createNativePitchRequestObserver',"row.observation='consumed'",'observeBasicKeyReceiver','CanonicalAudioReceiver','report.mapping=mapping()',"report.mapping.midi===62","native('pitch-mod-key-s'",'receiver.quiet()'])assert.ok(renderer.includes(token),token);
  for(const token of ['PITCH_MOD_PHASES','pitch_mod_phases_keep_closed_actions_and_exact_saved_profile','pitch-mod-shift-two','pitch-mod-key-s','pitch-mod-original-c4.json'])assert.ok(registration.includes(token),token);
  assert.ok(host.includes('[NativePitchModInput]::PlayS($env:WMH_DESKTOP_ACCEPTANCE_PHASE,[string]$Action.kind)'));assert.ok(host.includes("profile_reused=$profileSelection.existing_required"));
  assert.equal(host.includes('[NativeAcceptance]::HeldPerformanceKey(0x53)'),false);
  assert.equal(workflow.includes('releases:'),false);assert.equal(workflow.includes('branches: [main]'),false);
});

test('native pitch S uses a dedicated phase/action guard and preserves the unrelated generic key boundary', () => {
  const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
  const helper=read('scripts/native-pitch-mod-input.cs'),contract=read('scripts/native-pitch-mod-contract.ps1'),generic=read('scripts/windows-desktop-native.cs');
  assert.ok(helper.includes('phase != "pitch-mod-restart" || kind != "pitch-mod-key-s"'));
  assert.match(helper,/ValidateKey\(phase, kind\); Down\(0x53\);\s*try \{ System\.Threading\.Thread\.Sleep\(40\); \}\s*finally \{ Up\(0x53\); \}/);
  assert.ok(contract.includes("[NativePitchModInput]::ValidateKey('pitch-mod-restart','pitch-mod-key-s')"));
  for(const value of ['pitch-mod-seed','pitch-sources-restart','assistance-restart','PITCH-MOD-RESTART','pitch-mod-key-c5'])assert.ok(contract.includes(value));
  assert.ok(generic.includes('if(key!=0x32 && key!=0x55)throw new ArgumentOutOfRangeException'));
});

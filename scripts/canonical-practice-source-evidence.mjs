// Finite exact-source boundary shared by the hosted/native acceptance and package.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFile,lstat} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
// Match the renderer's existing compact-wire budget. Saving a pretty-printed
// copy can exceed the verifier's file bound without adding any evidence.
export const CANONICAL_RENDERER_REPORT_BYTES=1_000_000;
export function decodeCanonicalRendererReportBytes(input){
 assert.ok(input instanceof Uint8Array&&input.byteLength>0&&input.byteLength<CANONICAL_RENDERER_REPORT_BYTES,'Canonical renderer report exceeds its existing wire budget');
 const bytes=Buffer.from(input),renderer=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
 assert.ok(renderer!==null&&typeof renderer==='object'&&!Array.isArray(renderer),'Canonical renderer report must be an object');
 return {bytes,renderer};
}
export const CANONICAL_PRACTICE_SOURCE_FILES=Object.freeze([
 'Cargo.toml','Cargo.lock','package.json','package-lock.json',
 '.github/workflows/canonical-practice-preview.yml','.github/workflows/windows-desktop-acceptance.yml',
 'scripts/canonical-practice-source-evidence.mjs','scripts/prepare-canonical-practice-fixtures.mjs','scripts/check-canonical-practice-native.mjs','scripts/verify-canonical-practice-evidence.mjs','scripts/verify-song-mod-controls.mjs','scripts/hosted-canonical-practice-check.mjs','scripts/hosted-worklet-assets.mjs','scripts/vsq-hosted-chooser.mjs','scripts/vsq-hosted-console.mjs','scripts/live-tone-proof.mjs','scripts/verify-complete-practice-evidence.mjs','scripts/verify-native-vsq-song-evidence.mjs',
  'scripts/native-passive-capture-evidence.mjs',
  'scripts/verify-vsq-owned-controls.mjs','scripts/verify-native-clean-song-evidence.mjs','scripts/native-saved-audition-evidence.mjs',
 'scripts/windows-desktop-acceptance.ps1','scripts/windows-desktop-profile.ps1','scripts/windows-desktop-geometry.ps1','scripts/windows-desktop-evidence.ps1','scripts/windows-desktop-native.cs','scripts/native-canonical-practice-evidence.py','scripts/native-release-manifest.py',
 'crates/desktop-shell/Cargo.toml','crates/desktop-shell/build.rs','crates/desktop-shell/src/lib.rs','crates/desktop-shell/src/windows.rs','crates/desktop-shell/src/acceptance.rs','crates/desktop-shell/src/acceptance_publication.rs','crates/desktop-shell/src/native_library.rs','crates/desktop-shell/examples/native_import_driver.rs',
 'crates/desktop-shell/canonical-practice-acceptance.js','crates/desktop-shell/acceptance-wait.js','crates/desktop-shell/reference-acceptance.js','crates/desktop-shell/live-tone-acceptance.js','crates/desktop-shell/vsq-song-acceptance.js','crates/desktop-shell/performance-song-acceptance.js',
 'crates/practice-server/Cargo.toml','crates/practice-server/build.rs','crates/practice-server/src/lib.rs','crates/practice-server/src/main.rs',
 'crates/score-core/Cargo.toml','crates/score-core/src/lib.rs','crates/score-core/src/canonical_audio.rs','crates/score-core/src/practice.rs','crates/score-core/src/targets.rs','crates/score-core/src/ties.rs','crates/score-core/src/musicxml.rs','crates/score-core/src/musicxml_header.rs','crates/score-core/src/transposition.rs','crates/score-core/src/instruments.rs','crates/score-core/src/matching.rs','crates/score-core/src/results.rs',
 'web/index.html','web/app.js','web/transport.js','web/complete-practice-view.js','web/song-mod.js','web/song-mod-view.js','web/part-instrument-policy.js','web/skin-format.js','web/skin-runtime.js','web/skin-settings.js','web/skin-storage.js','web/skin-settings.css','web/practice-selection.js','web/practice-settings.js','web/practice-recorder.js','web/playback-clock-view.js','web/input-evidence.js','web/keyboard-input.js','web/keyboard-input-view.js','web/native-score-storage.js','web/score-storage-model.js','web/score-download.js','web/score-preview.js','web/transposition-view.js','web/music.js','web/game-shell.js','web/game-shell.css','web/performance-view.js','web/performance-stage.css','web/piano-stage-view.js','web/piano-layout-budget.js','web/piano-viewport-budget.js',
 'web/canonical-practice-session.js','web/canonical-practice-text.js','web/canonical-player.js','web/canonical-audio-receiver.js','web/canonical-audio-plan.js','web/canonical-audio-core.js','web/canonical-audio-processor.js','web/canonical-audio-fingerprint.js','web/basic-key-audio-receiver.js','web/basic-key-audio-plan.js','web/basic-key-audio-core.js','web/basic-key-player.js','web/vsq-audio-plan.js','web/vsq-practice-player.js','web/clean-song-player.js','web/clean-song-package.js','web/clean-song-view.js','web/clean-song-text.js','web/practice-stage-display.js','web/engraved-view.js','web/engraving.js','web/engraving-render-scheduler.js','web/live-tone-receiver.js','web/live-tone-core.js','web/live-tone-audio-processor.js',
].sort());
const rootDefault=fileURLToPath(new URL('../',import.meta.url)),sha=bytes=>createHash('sha256').update(bytes).digest('hex'),object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
export async function canonicalPracticeSourceBinding(root=rootDefault){
 const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim(),source_sha=git('rev-parse','HEAD'),source_tree=git('rev-parse','HEAD^{tree}'),source_hashes={};
 assert.ok(CANONICAL_PRACTICE_SOURCE_FILES.length<=128);assert.equal(new Set(CANONICAL_PRACTICE_SOURCE_FILES).size,CANONICAL_PRACTICE_SOURCE_FILES.length);
 for(const path of CANONICAL_PRACTICE_SOURCE_FILES){let file=root;for(const component of path.split('/')){file=join(file,component);assert.equal((await lstat(file)).isSymbolicLink(),false,`Linked canonical source: ${path}`);}const stat=await lstat(file);assert.ok(stat.isFile()&&stat.size>0&&stat.size<=4*1024*1024,`Unbounded canonical source: ${path}`);const bytes=await readFile(file),frozen=execFileSync('git',['show',`${source_sha}:${path}`],{cwd:root,maxBuffer:4*1024*1024});assert.deepEqual(bytes,frozen,`Canonical source differs from frozen commit: ${path}`);source_hashes[path]=sha(bytes);}
 return{source_sha,source_tree,source_hashes};
}
export function validateCanonicalPracticeSourceBinding(value,expected){
 assert.ok(object(value)&&object(expected),'Independent frozen canonical source binding required');for(const key of ['source_sha','source_tree']){assert.match(value[key],/^[a-f0-9]{40}$/);assert.equal(value[key],expected[key],`Canonical ${key} differs from verifier checkout`);}for(const row of [value,expected]){assert.ok(object(row.source_hashes));assert.deepEqual(Object.keys(row.source_hashes).sort(),[...CANONICAL_PRACTICE_SOURCE_FILES],'Canonical module hash keyset differs');for(const path of CANONICAL_PRACTICE_SOURCE_FILES)assert.match(row.source_hashes[path],/^[a-f0-9]{64}$/);}assert.deepEqual(value.source_hashes,expected.source_hashes,'Canonical module source bytes changed');return value;
}
export function uniqueCanonicalEvidenceFiles(rows){
 assert.ok(Array.isArray(rows)&&rows.length>0&&rows.length<=2048);const byPath=new Map(),aliases=new Map();let bytes=0;
 for(const row of rows){assert.ok(object(row));assert.deepEqual(Object.keys(row).sort(),['bytes','path','sha256'],'Canonical file binding has unknown fields');assert.ok(typeof row.path==='string'&&row.path.length<1024&&!/[\\:\0\r\n]/.test(row.path)&&row.path.split('/').every(p=>p&&p!=='.'&&p!=='..'&&!p.toLowerCase().startsWith('webview-')),'Unsafe canonical evidence path');assert.ok(Number.isSafeInteger(row.bytes)&&row.bytes>0&&row.bytes<=16*1024*1024);assert.match(row.sha256,/^[a-f0-9]{64}$/);const alias=row.path.toLowerCase();if(aliases.has(alias))assert.equal(aliases.get(alias),row.path,'Case-aliased canonical evidence');aliases.set(alias,row.path);if(byPath.has(row.path))assert.deepEqual(row,byPath.get(row.path),'Conflicting canonical evidence bindings');else{byPath.set(row.path,{path:row.path,bytes:row.bytes,sha256:row.sha256});bytes+=row.bytes;}assert.ok(byPath.size<=1024&&bytes<=128*1024*1024,'Canonical evidence exceeds finite package budget');}
 return [...byPath.values()].sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){assert.ok(process.argv.length<=3,'Usage: canonical-practice-source-evidence.mjs [source-root]');console.log(JSON.stringify(await canonicalPracticeSourceBinding(process.argv[2]?resolve(process.argv[2]):rootDefault)));}

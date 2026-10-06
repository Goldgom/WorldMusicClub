import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {decodeCanonicalRendererReportBytes,CANONICAL_RENDERER_REPORT_BYTES,CANONICAL_PRACTICE_SOURCE_FILES,canonicalPracticeSourceBinding,validateCanonicalPracticeSourceBinding,uniqueCanonicalEvidenceFiles} from '../scripts/canonical-practice-source-evidence.mjs';
const binding=()=>({source_sha:'1'.repeat(40),source_tree:'2'.repeat(40),source_hashes:Object.fromEntries(CANONICAL_PRACTICE_SOURCE_FILES.map(path=>[path,'3'.repeat(64)]))});
test('canonical source binding requires every exact module, frozen source/tree and no unbound extra key',()=>{
 const expected=binding();validateCanonicalPracticeSourceBinding(structuredClone(expected),expected);assert.ok(CANONICAL_PRACTICE_SOURCE_FILES.length>40&&CANONICAL_PRACTICE_SOURCE_FILES.length<=128);assert.equal(new Set(CANONICAL_PRACTICE_SOURCE_FILES).size,CANONICAL_PRACTICE_SOURCE_FILES.length);
 for(const path of CANONICAL_PRACTICE_SOURCE_FILES){const missing=structuredClone(expected);delete missing.source_hashes[path];assert.throws(()=>validateCanonicalPracticeSourceBinding(missing,expected),/keyset/);const changed=structuredClone(expected);changed.source_hashes[path]='4'.repeat(64);assert.throws(()=>validateCanonicalPracticeSourceBinding(changed,expected),/source bytes/);}
 for(const change of [r=>r.source_sha='4'.repeat(40),r=>r.source_tree='4'.repeat(40),r=>r.source_hashes['web/unknown.js']='3'.repeat(64)]){const value=structuredClone(expected);change(value);assert.throws(()=>validateCanonicalPracticeSourceBinding(value,expected));}
 for(const path of ['web/song-mod.js','web/song-mod-view.js','web/basic-key-audio-plan.js','web/basic-key-audio-core.js','web/vsq-audio-plan.js','web/vsq-practice-player.js','web/clean-song-package.js','web/clean-song-view.js','web/clean-song-text.js','web/practice-stage-display.js','web/engraved-view.js','web/app.js','web/playback-clock-view.js','web/canonical-audio-core.js','web/live-tone-core.js','crates/score-core/src/canonical_audio.rs','crates/score-core/src/targets.rs','crates/desktop-shell/canonical-practice-acceptance.js','scripts/native-canonical-practice-evidence.py','scripts/native-release-manifest.py','scripts/native-saved-audition-evidence.mjs','.github/workflows/windows-desktop-acceptance.yml'])assert.ok(CANONICAL_PRACTICE_SOURCE_FILES.includes(path));
});
test('canonical source hashes are derived from committed bytes and reject a changed working file',async()=>{
 const root=await mkdtemp(join(tmpdir(),'canonical-frozen-source-'));
 try{for(const path of CANONICAL_PRACTICE_SOURCE_FILES){await mkdir(dirname(join(root,path)),{recursive:true});await writeFile(join(root,path),`Original source-binding test fixture: ${path}\n`);}const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();git('init');git('add','.');git('-c','user.name=Original acceptance test','-c','user.email=acceptance@example.invalid','commit','-m','Original finite source-binding fixture');const expected=await canonicalPracticeSourceBinding(root);assert.equal(expected.source_sha,git('rev-parse','HEAD'));validateCanonicalPracticeSourceBinding(expected,expected);await writeFile(join(root,'web/app.js'),'Uncommitted original test mutation\n');await assert.rejects(canonicalPracticeSourceBinding(root),/differs from frozen commit/);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('canonical retained file inventory deduplicates exact paths and rejects conflicts, aliases and profiles',()=>{
 const one={path:'Scores/songs/original/score.json',bytes:7,sha256:'3'.repeat(64)},two={path:'renderer-canonical-practice-seed.json',bytes:9,sha256:'4'.repeat(64)};assert.deepEqual(uniqueCanonicalEvidenceFiles([two,one,{...one}]),[one,two]);
 for(const bad of [{...one,sha256:'5'.repeat(64)},{...one,bytes:8},{...one,path:'scores/songs/original/score.json'},{...one,path:'../score.json'},{...one,path:'webview-profiles/canonical-practice-seed/a'},{...one,path:'evidence/WebView-profile/a'},{...one,path:'Scores\\score.json'},{...one,path:'unknown',bytes:17*1024*1024}])assert.throws(()=>uniqueCanonicalEvidenceFiles([one,bad]));
});
test('both actual hosts capture frozen module hashes and the verifier binds an independent binary and complete retention',async()=>{
 const read=name=>readFile(new URL(`../${name}`,import.meta.url),'utf8'),[hosted,native,verifier]=await Promise.all(['scripts/hosted-canonical-practice-check.mjs','scripts/windows-desktop-acceptance.ps1','scripts/verify-canonical-practice-evidence.mjs'].map(read));
 assert.match(hosted,/canonicalPracticeSourceBinding\(root\)/);assert.match(hosted,/driver_bytes=driverBytes\.length/);assert.match(native,/canonical-practice-source-evidence\.mjs'\) \$Repository/);assert.match(native,/\$native\.source_hashes=\$canonicalBinding\.source_hashes/);assert.ok(native.indexOf('$native.source_hashes=$canonicalBinding.source_hashes')<native.indexOf('foreach($phase in $phases)'));
 assert.match(verifier,/validateCanonicalPracticeSourceBinding\(host,binding\)/);assert.match(verifier,/An independent exact-source executable\/driver is required/);assert.match(verifier,/files:uniqueCanonicalEvidenceFiles\(files\)/);assert.match(verifier,/scenario:'canonical-practice',\.\.\.binding,\.\.\.binaryIdentity,phases:/);for(const marker of ['metadata.json','source.payload','snapshot-${phase}.json','trace-${phase}.json','geometry-native-action-${phase}-${n}.json'])assert.ok(verifier.includes(marker));
});


test('hosted canonical reports retain exact bounded wire bytes instead of oversized pretty copies',()=>{
 const original={version:1,original_test_data:Array.from({length:30000},(_,i)=>({a:i,b:i%7}))};
 const input=Buffer.from(JSON.stringify(original));assert.ok(input.length<CANONICAL_RENDERER_REPORT_BYTES);assert.ok(Buffer.byteLength(JSON.stringify(original,null,2))>1024*1024);
 const result=decodeCanonicalRendererReportBytes(input);assert.deepEqual(result.renderer,original);assert.deepEqual(result.bytes,input);input.fill(0);assert.deepEqual(JSON.parse(result.bytes),original);
 for(const bad of [Buffer.alloc(0),Buffer.alloc(CANONICAL_RENDERER_REPORT_BYTES),Uint8Array.of(0xff),Buffer.from('{'),Buffer.from('[]')])assert.throws(()=>decodeCanonicalRendererReportBytes(bad));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,mkdir,writeFile,readFile,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {LIVE_TONE_NAVIGATION_CASES,LIVE_TONE_NAVIGATION_PHASES,LIVE_TONE_NAVIGATION_FIXTURE_FILENAME,LIVE_TONE_NAVIGATION_MANIFEST_FILENAME,liveToneNavigationFixture,prepareLiveToneNavigationFixtures} from '../scripts/prepare-live-tone-navigation-fixtures.mjs';
import {LIVE_TONE_NAVIGATION_SOURCE_FILES,validateNativeLiveToneNavigationRenderer,validateNativeLiveToneNavigationActions,validateNativeLiveToneNavigationControlClicks,validateNativeLiveToneNavigationSourceBinding,verifyNativeLiveToneNavigationEvidence} from '../scripts/verify-native-live-tone-navigation-evidence.mjs';
import {syntheticNativeLiveToneNavigationCase} from './native-live-tone-navigation-fixtures.js';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
test('native navigation fixture is deterministic original CC0 C4/E4 with exact long source text',async t=>{
 const f=liveToneNavigationFixture();assert.deepEqual(f,liveToneNavigationFixture());assert.equal(f.score.provenance.license,'CC0-1.0');assert.equal(f.manifest.duration_ms,64000);assert.equal(f.score.tempo[0].bpm,60);assert.deepEqual(f.score.parts[0].notes.map(row=>[row.pitch.step,row.pitch.octave,row.at]),[['C',4,{numerator:0,denominator:1}],['E',4,{numerator:63,denominator:1}]]);assert.equal(f.score.measures.length,16);assert.match(f.score.source.content,/^\uFEFF.*\r\n/);assert.equal(f.manifest.files[0].sha256,hash(f.bytes));
 const directory=await mkdtemp(join(tmpdir(),'wmh-native-navigation-fixture-'));t.after(()=>rm(directory,{recursive:true,force:true}));await prepareLiveToneNavigationFixtures(directory);assert.deepEqual(await readFile(join(directory,LIVE_TONE_NAVIGATION_FIXTURE_FILENAME)),f.bytes);assert.deepEqual(JSON.parse(await readFile(join(directory,LIVE_TONE_NAVIGATION_MANIFEST_FILENAME),'utf8')),f.manifest);await assert.rejects(prepareLiveToneNavigationFixtures(directory),{code:'EEXIST'});
});

test('native renderer and host contract accepts each separate finite route/release shape',()=>{
 for(const c of LIVE_TONE_NAVIGATION_CASES){const f=syntheticNativeLiveToneNavigationCase(c);validateNativeLiveToneNavigationRenderer(f.report,f.exports);validateNativeLiveToneNavigationActions(f.report,f.host,f.actions,f.results);}
});

test('only the exact trusted Import activation and original file-input delegation may form the native picker trace',()=>{
 const f=syntheticNativeLiveToneNavigationCase(),row=f.report.controlActions.find(row=>row.kind==='picker'),before=structuredClone(f.report),classified=validateNativeLiveToneNavigationControlClicks(f.report,row);
 assert.equal(classified.primary,row.clicks[0]);assert.equal(classified.forwarded,row.clicks[1]);assert.deepEqual(f.report,before,'Validation must retain every original event, not filter the trace');
 const changes=[
  (r,p)=>p.clicks=[],(r,p)=>p.clicks.shift(),(r,p)=>p.clicks.pop(),(r,p)=>p.clicks.push(structuredClone(p.clicks[0])),(r,p)=>p.clicks.push(structuredClone(p.clicks[1])),(r,p)=>p.clicks.reverse(),
  (r,p)=>p.clicks[0].trusted=false,(r,p)=>p.clicks[0].owned=false,(r,p)=>p.clicks[0].id='another-button',(r,p)=>p.clicks[1].trusted=true,(r,p)=>p.clicks[1].owned=true,(r,p)=>p.clicks[1].id='foreign-file',(r,p)=>p.clicks[1].sequence++,
  (r,p)=>p.id='other-import',(r,p)=>p.kind='click',(r,p)=>p.request.kind='click',(r,p)=>p.request.file='foreign.json',
  r=>r.pickerObservations=[],r=>r.pickerObservations.push(structuredClone(r.pickerObservations[0])),r=>r.pickerObservations[0].sequence++,r=>r.pickerObservations[0].completed=false,r=>r.pickerObservations[0].filename='foreign.json',
  r=>r.pickerObservations[0].delegatedClicks=[],r=>r.pickerObservations[0].delegatedClicks[0].originalControl=false,r=>r.pickerObservations[0].inputs[0].originalControl=false,r=>r.pickerObservations[0].changes[0].filename='foreign.json',r=>r.pickerObservations[0].changes[0].fileCount=2,
  r=>r.pickerObservations[0].gestures[3].trusted=false,r=>r.pickerObservations[0].gestures[4].targetId='another-file',r=>r.pickerObservations[0].gestures[5].eventTimeMs++,
  r=>r.trustedActions.find(row=>row.id==='score-file'&&row.type==='click').isTrusted=true,r=>r.trustedActions.find(row=>row.id==='score-file'&&row.type==='change').eventTime++,r=>r.trustedActions.push(structuredClone(r.trustedActions.find(row=>row.id==='score-file'&&row.type==='click'))),
 ];
 for(const [index,change]of changes.entries()){const value=structuredClone(before),picker=value.controlActions.find(row=>row.kind==='picker');change(value,picker);assert.throws(()=>validateNativeLiveToneNavigationControlClicks(value,picker),`Forwarding adversary ${index} accepted`);}
 const ordinary=structuredClone(before.controlActions.find(row=>row.kind==='click'));ordinary.clicks.push({sequence:ordinary.sequence,id:'score-file',owned:false,trusted:false});assert.throws(()=>validateNativeLiveToneNavigationControlClicks(before,ordinary));ordinary.clicks=[ordinary.clicks[0],structuredClone(ordinary.clicks[0])];assert.throws(()=>validateNativeLiveToneNavigationControlClicks(before,ordinary));
});

test('native navigation preserves canonical score objects and exact embedded source across JSON formatting',()=>{
 const f=syntheticNativeLiveToneNavigationCase();f.exports.scoreBytes=Buffer.from(JSON.stringify(liveToneNavigationFixture().score));validateNativeLiveToneNavigationRenderer(f.report,f.exports);
 const changed=liveToneNavigationFixture().score;changed.source.content=changed.source.content.replace('\r\n','\n');f.exports.scoreBytes=Buffer.from(JSON.stringify(changed));assert.throws(()=>validateNativeLiveToneNavigationRenderer(f.report,f.exports),/score export changed/);
});

test('native authoring descendant clicks require matching raw ownership, button identity and live timestamp',()=>{
 for(const release of ['keyup','navigation']){
  const f=syntheticNativeLiveToneNavigationCase({route:'authoring',release}),n=f.report.actionRoles.navigation.at(-1),row=f.report.trustedActions.find(row=>row.sequence===n),control=f.report.controlActions.find(row=>row.sequence===n);
  row.id=null;row.controlId='home-song-authoring';control.clicks[0].id=null;
  validateNativeLiveToneNavigationRenderer(f.report,f.exports);
  for(const mutate of [
   (r,e,c)=>r.trustedActions.splice(r.trustedActions.indexOf(e),1),(r,e)=>delete e.controlId,(r,e)=>e.controlId='home-single-player',(r,e)=>e.isTrusted=false,(r,e)=>e.eventTime++,
   (r,e,c)=>c.id='home-single-player',(r,e,c)=>c.clicks[0].id='foreign-child',(r,e,c)=>c.clicks[0].owned=false,(r,e,c)=>c.clicks[0].trusted=false,(r,e,c)=>c.clicks.push(structuredClone(c.clicks[0])),
   (r,e)=>r.trustedActions.push(structuredClone(e)),(r,e)=>r.trustedActions.push({...e,id:'foreign-child',controlId:'foreign-button'}),
  ]){const report=structuredClone(f.report),event=report.trustedActions.find(row=>row.sequence===n),owned=report.controlActions.find(row=>row.sequence===n);mutate(report,event,owned);assert.throws(()=>validateNativeLiveToneNavigationRenderer(report,f.exports));}
 }
});

test('post-click navigation may hide or disable its old control without changing the owned pre-click geometry',()=>{
 const f=syntheticNativeLiveToneNavigationCase();const row=f.report.controlActions.find(row=>row.sequence===f.report.actionRoles.navigation[0]);row.afterDispatch={target:{x:0,y:0,width:0,height:0},disabled:true};validateNativeLiveToneNavigationRenderer(f.report,f.exports);validateNativeLiveToneNavigationActions(f.report,f.host,f.actions,f.results);
});

test('native renderer rejects false cleanup, changed takes, stale PCM and action/live-input disconnects',()=>{
 const mutations=[
  f=>f.report.phase='canonical-practice-seed',f=>f.report.route='authoring',f=>f.report.release='navigation',f=>f.report.origin='http://localhost:3000',f=>f.report.ok=false,f=>f.report.physicalAudio=true,f=>f.report.error='retained failure',
  f=>f.report.cleanup.source.restored=false,f=>f.report.cleanup.source.errors.push('failed'),f=>f.report.cleanup.live.overflow=true,
  f=>f.report.pausedAfter.position++,f=>f.report.pausedBefore.position=64000,f=>f.report.pausedBefore.mode='listen',f=>f.report.pausedBefore.captured='0',
  f=>f.exports.afterTakeBytes=Buffer.concat([f.exports.afterTakeBytes,Buffer.from('\n')]),f=>f.exports.scoreBytes=Buffer.from('{}'),f=>f.report.sourceScoreJson+=' ',
  f=>f.report.audio.checkpoints[4].sampling='exhausted',f=>f.report.audio.after.receiver.audioTime=100,f=>f.report.audio.checkpoints[2].pcm.blocks[0].peak=.1,f=>f.report.audio.inputs[0].isTrusted=false,
  f=>f.report.trustedActions.find(row=>row.type==='keydown'&&row.code==='KeyR').eventTime++,f=>f.report.trustedActions.find(row=>row.type==='keyup'&&row.code==='KeyR').repeat=true,f=>f.report.trustedActions.find(row=>row.id==='settings-button').isTrusted=false,
  f=>f.report.actionRoles.keyUp=f.report.actionRoles.navigation[0],f=>f.report.actionRoles.beforeTake=f.report.actionRoles.afterTake,f=>f.report.actionRoles.navigation=[],
  f=>f.report.keyPreparations=[],f=>f.report.keyPreparations[0].clock.running=false,f=>f.report.keyPreparations[0].focus='settings-title',f=>f.report.keyPreparations[1].timeOrigin++,
  f=>f.report.controlActions.find(row=>row.sequence===f.report.actionRoles.return[0]).closePanel='results',
  f=>f.report.controlActions[0].samples.at(-1).hitOwned=false,f=>f.report.controlActions[0].samples[0].hitOwned=false,f=>f.report.controlActions[0].afterDispatch.target.width=-1,f=>f.report.controlActions[0].samples[0].target.x++,f=>f.report.controlActions[0].clicks[0].owned=false,
 ];
 for(const [i,change]of mutations.entries()){const f=syntheticNativeLiveToneNavigationCase();change(f);assert.throws(()=>validateNativeLiveToneNavigationRenderer(f.report,f.exports),`Renderer adversary ${i} accepted`);}
});

test('native key actions cannot hide focus reacquisition, substituted keys, missing releases or process drift',()=>{
 const mutations=[
  f=>f.host.live_key_held_at_close=true,f=>f.results[f.report.actionRoles.keyDown-1].native_key.held_before=true,f=>f.results[f.report.actionRoles.keyUp-1].native_key.held_after=true,f=>f.results[f.report.actionRoles.keyUp-1].native_key.held_ms=39,f=>f.results[f.report.actionRoles.keyUp-1].native_key.held_ms=10001,f=>f.results[f.report.actionRoles.keyDown-1].native_key.code='Digit2',f=>f.results[f.report.actionRoles.keyDown-1].native_key.virtual_key=50,
  f=>f.results[f.report.actionRoles.keyDown-1].native_key.focus_reacquired=true,f=>f.results[f.report.actionRoles.keyDown-1].native_key.pointer_clicked=true,
  f=>f.results[f.report.actionRoles.keyUp-1].native_key.app_enabled=false,f=>f.results[f.report.actionRoles.keyUp-1].native_key.foreground++,f=>f.results[f.report.actionRoles.keyUp-1].native_key.app_process_id++,
  f=>f.results[f.report.actionRoles.keyDown-1].client_click={},f=>f.actions[f.report.actionRoles.keyUp-1].kind='key-r',f=>f.actions[f.report.actionRoles.blockedKey-1].kind='live-key-r-up',
  f=>f.actions[0].sequence++,f=>f.actions[0].keyCode='KeyR',f=>f.actions[0].x=20000,f=>f.results[0].ok=false,f=>f.results[0].client_click.actual[0]++,f=>delete f.results[0].client_click.hit_root,f=>f.results[0].client_click.hit_root=0,f=>f.results[0].client_click.hit_root=99,
  f=>f.actions[0].kind='click',f=>f.actions[0].file='foreign.json',f=>f.results[0].owned_dialog.root_owner_hwnd=99,f=>f.results[0].owned_dialog.process_id++,f=>f.results[0].picker_completion.dialog_dismissed=false,
  f=>f.report.controlActions.splice(0,1),f=>f.report.controlActions[0].request.x++,
  f=>f.report.modActions=[],f=>f.report.trustedActions.find(row=>row.type==='change'&&row.id==='song-mod-layout').isTrusted=false,
 ];
 for(const [i,change]of mutations.entries()){const f=syntheticNativeLiveToneNavigationCase();change(f);assert.throws(()=>validateNativeLiveToneNavigationActions(f.report,f.host,f.actions,f.results),`Host adversary ${i} accepted`);}
});

async function evidenceDirectory(t){
 const directory=await mkdtemp(join(tmpdir(),'wmh-native-navigation-evidence-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const save=async(name,value)=>{await mkdir(dirname(join(directory,name)),{recursive:true});await writeFile(join(directory,name),Buffer.isBuffer(value)?value:JSON.stringify(value,null,2)+'\n');};
 const binding={source_sha:'a'.repeat(40),source_tree:'b'.repeat(40),source_hashes:Object.fromEntries(LIVE_TONE_NAVIGATION_SOURCE_FILES.map(path=>[path,hash(path)]))},executable=join(directory,'fixture-executable.bin'),executableBytes=Buffer.from('synthetic executable identity only');await writeFile(executable,executableBytes);
 const native={version:1,scenario:'live-tone-navigation',ok:true,profile_reused:false,directory:join(directory,'Scores'),...binding,executable_sha256:hash(executableBytes),executable_bytes:executableBytes.length,phases:[]};
 const fixtures=liveToneNavigationFixture();await save(`fixtures/${LIVE_TONE_NAVIGATION_FIXTURE_FILENAME}`,fixtures.bytes);await save(`fixtures/${LIVE_TONE_NAVIGATION_MANIFEST_FILENAME}`,fixtures.manifest);
 for(const [index,c]of LIVE_TONE_NAVIGATION_CASES.entries()){const f=syntheticNativeLiveToneNavigationCase(c),pid=71+index;for(const result of f.results){if(result.native_key)result.native_key.app_process_id=pid;if(result.owned_dialog){result.owned_dialog.process_id=pid;result.owned_dialog.app_process_id=pid;}}
  const host={phase:c.phase,process_id:pid,actions:f.actions.length,live_key_held_at_close:false,profile_fresh:true,profile_reused:false,profile_absent_before_launch:true,profile_directory:join(directory,'webview-profiles',c.phase),renderer_ok:true,normal_close:true,launched_new_process:true,renderer_origin:'https://wmh.localhost',executable_tcp_listeners:0,elapsed_seconds:20};native.phases.push(host);
  await save(`profile-${c.phase}.json`,{version:1,phase:c.phase,process_id:pid,profile_directory:host.profile_directory,library_directory:native.directory,fresh_required:true,created_new:true});await save(`renderer-${c.phase}.json`,f.report);
  for(const [name,file]of Object.entries(f.report.files))await save(`downloads/${file}`,f.exports[`${name}Bytes`]);
  for(const [i,action]of f.actions.entries()){await save(`action-${c.phase}-${i+1}.json`,action);await save(`result-${c.phase}-${i+1}.json`,f.results[i]);}
  await save(`trace-${c.phase}.json`,{version:1,phase:c.phase,events:[{event:{stage:'reply-submitted',path:'/__desktop_smoke/report',status:200}}]});
 }
 await save('native-live-tone-navigation.json',native);const verify=()=>verifyNativeLiveToneNavigationEvidence(directory,{sourceBinding:binding,executable});return{directory,native,binding,executable,save,verify};
}

test('complete native proof re-reads all four exact phases, exports, profiles and executable identity',async t=>{
 const f=await evidenceDirectory(t),proof=await f.verify();assert.deepEqual(proof.phases,LIVE_TONE_NAVIGATION_PHASES);assert.equal(proof.claims.finite_live_output_gate_silence,true);assert.equal(proof.claims.physical_audio,false);assert.equal(proof.claims.full_acceptance,false);assert.equal(proof.claims.continuous_pcm_coverage,false);
 assert.equal(proof.files.filter(row=>row.path.startsWith('downloads/')).length,12);for(const row of proof.files){const bytes=await readFile(join(f.directory,row.path));assert.equal(row.bytes,bytes.length);assert.equal(row.sha256,hash(bytes));}
});

test('native proof rejects wrong frozen source, partial phases, reused profiles and changed retained files',async t=>{
 const f=await evidenceDirectory(t),nativeMutations=[n=>n.source_sha='c'.repeat(40),n=>n.source_hashes[LIVE_TONE_NAVIGATION_SOURCE_FILES[0]]='0'.repeat(64),n=>n.phases.pop(),n=>n.phases.reverse(),n=>n.phases[1].process_id=n.phases[0].process_id,n=>n.phases[1].profile_reused=true,n=>n.phases[1].profile_directory=n.phases[0].profile_directory,n=>n.executable_bytes++,n=>n.executable_sha256='0'.repeat(64),n=>n.phases[0].normal_close=false,n=>n.phases[0].elapsed_seconds=241];
 for(const [i,mutate]of nativeMutations.entries()){const value=structuredClone(f.native);mutate(value);await f.save('native-live-tone-navigation.json',value);await assert.rejects(f.verify(),undefined,`Native envelope adversary ${i} accepted`);}await f.save('native-live-tone-navigation.json',f.native);
 const phase=LIVE_TONE_NAVIGATION_PHASES[0],name=`downloads/${phase}-2.json`,bytes=await readFile(join(f.directory,name));await f.save(name,Buffer.concat([bytes,Buffer.from('\n')]));await assert.rejects(f.verify(),/take export bytes changed/);await f.save(name,bytes);
 const reportName=`renderer-${phase}.json`,report=JSON.parse(await readFile(join(f.directory,reportName),'utf8'));report.files.score='../../fixture-executable.bin';await f.save(reportName,report);await assert.rejects(f.verify());
});

test('source binding requires its exact finite module set and cannot accept self-selected subsets',()=>{
 const binding={source_sha:'a'.repeat(40),source_tree:'b'.repeat(40),source_hashes:Object.fromEntries(LIVE_TONE_NAVIGATION_SOURCE_FILES.map(path=>[path,hash(path)]))};validateNativeLiveToneNavigationSourceBinding(binding,structuredClone(binding));for(const mutate of [b=>delete b.source_hashes[LIVE_TONE_NAVIGATION_SOURCE_FILES[0]],b=>b.source_hashes.extra='0'.repeat(64),b=>b.source_tree='c'.repeat(40)]){const changed=structuredClone(binding);mutate(changed);assert.throws(()=>validateNativeLiveToneNavigationSourceBinding(changed,binding));}
});

test('native evidence rejects linked roots, oversized reports and independent host report failures',async t=>{
 const f=await evidenceDirectory(t),phase=LIVE_TONE_NAVIGATION_PHASES[0],reportName=`renderer-${phase}.json`,original=await readFile(join(f.directory,reportName));
 await f.save(reportName,Buffer.alloc(1024*1024+1,32));await assert.rejects(f.verify(),/exceeds bound/);await f.save(reportName,original);
 await f.save(`trace-${phase}.json`,{version:1,phase,events:[{event:{stage:'reply-submitted',path:'/__desktop_smoke/report',status:500}}]});await assert.rejects(f.verify(),/report admission failure/);
 if(process.platform!=='win32'){const linked=join(f.directory,'linked-root');await symlink(f.directory,linked);await assert.rejects(verifyNativeLiveToneNavigationEvidence(linked,{sourceBinding:f.binding,executable:f.executable}),/ordinary non-linked directory/);}
});

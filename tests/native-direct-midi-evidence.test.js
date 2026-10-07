import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile, access} from 'node:fs/promises';
import {directMidiFixtures,directMidiDigest as hash,DIRECT_MIDI_POLICY} from '../scripts/prepare-direct-midi-fixtures.mjs';
import {DIRECT_MIDI_NATIVE_PHASES,DIRECT_MIDI_NATIVE_CLAIMS,DIRECT_MIDI_NATIVE_SOURCE_FILES,validateDirectMidiNativeActions,validateDirectMidiNativeRequests,validateDirectMidiNativeRenderer} from '../scripts/verify-native-direct-midi-evidence.mjs';

// Explicitly constructed validator unit inputs. They establish rejection
// contracts only, never Windows, real picker, process, playback or audio success.
const fixture=directMidiFixtures().boundary,identity='a'.repeat(64),key=`song-${identity}`,archiveKey=`pack-${fixture.manifest.sha256}`;
function opened(){
 const source={format:'midi',bytes:fixture.bytes.length,sha256:fixture.manifest.sha256},coverage={source_tracks:1,source_events:fixture.manifest.source_events,represented_events:fixture.manifest.source_events,key_attacks:4,key_releases:4};
 const score={source,performance:{source_format:0,ppq:384,tracks:fixture.tracks.map((events,source_index)=>({events:structuredClone(events),source_index}))},coverage},score_json=JSON.stringify(score),metadata_json=JSON.stringify({score:{bytes:Buffer.byteLength(score_json),sha256:hash(score_json)},sources:[source]});
 return{entry:{key},clean_package:{profile:'wmh-basic-keys-midi1-v1',content_sha256:identity,score_json,metadata_json,coverage,runtime:{profile:'wmh-basic-key-practice-v2',source_sha256:source.sha256,rendition:{policy_id:DIRECT_MIDI_POLICY,coverage:{source_attacks:4},duration_ms:2000,notes:[[],[],[],[]]},compilation:{timeline:{notes:fixture.expectedNotes.map(n=>[n.id,'midi-t1-c1-r0',n.midi,n.velocity,n.start_ms,n.duration_ms])}}}}};
}
function importReport(mode){return{format:'worldmusichub-import-report',version:1,mode,source:{filename:fixture.filename,bytes:fixture.bytes.length,sha256:fixture.manifest.sha256,retained:mode==='commit',...(mode==='commit'?{archive_key:archiveKey}:{})},items:[{status:mode==='commit'?'saved':'ready',...(mode==='commit'?{entry:{key}}:{}),clean_package:{profile:'wmh-basic-keys-midi1-v1',content_sha256:identity,coverage:{key_attacks:4}}}],warnings:['Explicit FIFO rendition retained']};}
const observed=(path,response,{status=200,request=null,sequence=3}={})=>({path,status,request,response,observation:'consumed',canceled:false,started:{sequence},settled:{sequence}});
function renderer(phase='direct-midi-seed'){
 const value={version:1,scenario:'direct-midi',phase,ok:true,origin:'https://wmh.localhost',actions:6,key,archiveKey,opened:opened(),profileMarkerAbsent:true,requestsRestored:true,errors:[],initialInventory:{entries:phase.endsWith('seed')?[]:[{key}]},inventory:{entries:[{key}],issues:[]},preview:{id:`native:${key}`,status:'ready',screen:'library',startDisabled:false,bulkDialog:false,notice:'Complete MIDI source saved. Disclosed FIFO interpretation',clock:{running:false}},ended:{screen:'stage',mode:'practice',renderer:'ended',captured:'0',clock:{running:false,completed:true,positionMs:2000}},files:{raw:'raw.mid',take:'take.json'},screenshots:{preview:4,ended:6},pickerAction:3,startAction:5,requests:[]};
 if(phase.endsWith('seed'))value.requests.push(observed('/api/import/midi',{error:'Strict overlap rejected'},{status:400}),observed('/api/library/import/preview',importReport('preview')),observed('/api/library/import/commit',importReport('commit')));
 value.requests.push(observed('/api/library/load',value.opened,{request:{key}}),observed('/api/practice-targets',{source_note_count:4,target_count:4,timeline:{notes:fixture.expectedNotes}},{request:{timeline:{notes:fixture.expectedNotes}}}),observed('/api/assess',{accuracy_percent:0,hits:[],extras:[],misses:fixture.expectedNotes.map(n=>({note_id:n.id}))},{sequence:5,request:{inputs:[],timeline:{notes:fixture.expectedNotes}}}));return value;
}
test('native direct MIDI renderer validator binds default Start, complete source and fresh restart',()=>{
 for(const phase of DIRECT_MIDI_NATIVE_PHASES)assert.equal(validateDirectMidiNativeRenderer(renderer(phase)).phase,phase);
 for(const change of [r=>r.ok=false,r=>r.origin='http://127.0.0.1:9000',r=>r.phase='direct-midi-seed-extra',r=>r.requestsRestored=false,r=>r.profileMarkerAbsent=false,r=>r.preview.id='builtin:first-steps',r=>r.preview.startDisabled=true,r=>r.preview.bulkDialog=true,r=>r.preview.clock.running=true,r=>r.preview.notice='silently changed',r=>r.ended.clock.positionMs=1000,r=>r.ended.captured='1',r=>r.ended.mode='listen',r=>r.opened.clean_package.runtime.compilation.timeline.notes.pop()]){const r=renderer();change(r);assert.throws(()=>validateDirectMidiNativeRenderer(r));}
});
test('request proof rejects missing strict fallback, hand-triggered commit and truncated default targets',()=>{
 validateDirectMidiNativeRequests(renderer());
 for(const change of [r=>r.requests.shift(),r=>r.requests[0].status=200,r=>r.requests[1].response.source.sha256='0'.repeat(64),r=>r.requests[2].started.sequence=4,r=>r.requests[2].response.items[0].entry.key='other',r=>r.requests[2].response.source.archive_key='other',r=>r.requests[3].response={entry:{key:'other'}},r=>r.requests.at(-1).observation='awaiting-json',r=>r.requests.at(-1).request.inputs.push({midi:60}),r=>r.requests.at(-1).request.timeline.notes=r.requests.at(-1).request.timeline.notes.slice(0,3),r=>r.requests.at(-1).response.accuracy_percent=100,r=>r.requests.at(-1).response.misses.pop(),r=>r.requests[4].response.target_count=3]){const r=structuredClone(renderer());change(r);assert.throws(()=>validateDirectMidiNativeRequests(r));}
 const r=renderer('direct-midi-restart');r.requests.unshift(observed('/api/library/import/commit',importReport('commit')));assert.throws(()=>validateDirectMidiNativeRequests(r));
});
function actionModel(){
 const ids=['start-performance','export-takes',null],actions=ids.map((_,i)=>({version:1,sequence:i+1,kind:'click',x:100,y:100,width:1280,height:720})),target={x:50,y:80,width:100,height:40};
 const controls=actions.map((action,i)=>({sequence:i+1,id:ids[i],kind:'click',request:{...action,target},samples:[{hitOwned:true,target,width:1280,height:720},{hitOwned:true,target,width:1280,height:720}],clicks:[{sequence:i+1,id:ids[i],trusted:true,owned:true}]}));
 const report={phase:'direct-midi-restart',actions:3,controls,pickerObservations:[],trusted:[{id:'start-performance',type:'click',trusted:true,actionSequence:1}],startAction:1,files:{take:'take.json',raw:'raw.mid'},downloads:{take:{action:2,file:'take.json',complete:true,success:true},raw:{action:3,file:'raw.mid',complete:true,success:true}}},host={actions:3,process_id:99};
 const results=actions.map(()=>({ok:true,client_click:{app_hwnd:1,hit_hwnd:1,hit_root:1,foreground:1,viewport:[1280,720],client:[0,0,1280,720],origin:[20,30],requested:[120,130],actual:[120,130]}}));return{report,host,actions,results};
}
test('native action proof rejects forged clicks, wrong HWND, arbitrary actions, missing download and Mod repairs',()=>{
 const run=m=>validateDirectMidiNativeActions(m.report,m.host,m.actions,m.results);run(actionModel());
 for(const change of [m=>m.results[0].client_click.foreground=2,m=>m.results[0].client_click.actual[0]++,m=>m.results[0].ok=false,m=>m.report.controls[0].clicks[0].trusted=false,m=>m.report.controls[0].samples[1].hitOwned=false,m=>m.actions[0].file='../private.mid',m=>m.actions[0].kind='key-r',m=>m.report.downloads.raw.success=false,m=>m.report.trusted=[],m=>m.report.controls[2].id='song-mod-apply',m=>m.report.actions=65]){const m=structuredClone(actionModel());change(m);assert.throws(()=>run(m));}
});
test('consumed-body observer forwards original promises and ignores clone results',async()=>{
 const source=(await readFile(new URL('../scripts/native-direct-midi-renderer.js',import.meta.url),'utf8')).split('/* Process-owner-only')[0];const context=vm.createContext({structuredClone,TextEncoder,Promise,Set,WeakMap,JSON,Reflect,Object});vm.runInContext(source,context);
 const rows=[],errors=[],body={error:'Strict rejected'},response={status:400,json(){return Promise.resolve(body);},clone(){throw Error('Cloning forbidden in this test');}},promise=Promise.resolve(response),owner={fetch:()=>promise},original=owner.fetch;
 const observer=context.createNativeDirectMidiRequestObserver({fetchOwner:owner,onRequest:row=>rows.push(row),onError:error=>errors.push(error),readContext:()=>({sequence:3})});assert.equal(owner.fetch('/api/import/midi',{body:new Uint8Array([1,2]).buffer}),promise);await promise;const consumed=await response.json();assert.equal(consumed,body);await Promise.resolve();assert.equal(rows[0].observation,'consumed');assert.deepEqual(rows[0].response,body);assert.deepEqual(errors,[]);assert.equal(observer.settled(),true);assert.equal(observer.restore(),true);assert.equal(owner.fetch,original);
});
test('observer reports a failed application body instead of manufacturing success',async()=>{
 const source=(await readFile(new URL('../scripts/native-direct-midi-renderer.js',import.meta.url),'utf8')).split('/* Process-owner-only')[0];const context=vm.createContext({structuredClone,TextEncoder,Promise,Set,WeakMap,JSON,Reflect,Object});vm.runInContext(source,context);const rows=[],errors=[],response={status:200,json:()=>Promise.reject(Error('body failed'))},owner={fetch:()=>Promise.resolve(response)};
 const observer=context.createNativeDirectMidiRequestObserver({fetchOwner:owner,onRequest:row=>rows.push(row),onError:error=>errors.push(error),readContext:()=>({sequence:3})});await owner.fetch('/api/library/import/commit',{body:new Uint8Array([1]).buffer});await assert.rejects(response.json());await Promise.resolve();assert.equal(rows[0].observation,'body-rejected');assert.equal(errors.length,1);assert.equal(observer.restore(),true);
});
test('closed scenario source, profile, fixture and workflow registration are complete',async()=>{
 assert.ok(DIRECT_MIDI_NATIVE_SOURCE_FILES.length<=160);for(const path of DIRECT_MIDI_NATIVE_SOURCE_FILES)await access(new URL('../'+path,import.meta.url));assert.equal(new Set(DIRECT_MIDI_NATIVE_SOURCE_FILES).size,DIRECT_MIDI_NATIVE_SOURCE_FILES.length);
 const read=path=>readFile(new URL('../'+path,import.meta.url),'utf8'),[rust,host,profile,renderer,workflow]=await Promise.all(['crates/desktop-shell/src/acceptance.rs','scripts/windows-desktop-acceptance.ps1','scripts/windows-desktop-profile.ps1','scripts/native-direct-midi-renderer.js','.github/workflows/native-direct-midi.yml'].map(read));
 for(const phase of DIRECT_MIDI_NATIVE_PHASES){for(const text of [rust,host,profile,renderer])assert.ok(text.includes(phase));}
 assert.match(rust,/\.chain\(DIRECT_MIDI_PHASES\)/);assert.match(rust,/include_str!\("\.\.\/\.\.\/\.\.\/scripts\/native-direct-midi-renderer.js"\)/);assert.match(host,/-Scenario|\$Scenario/);assert.ok(host.includes("if($Action.kind -cnotin @('click','picker')){throw 'Unknown closed direct MIDI action'}"));assert.match(host,/prepare-direct-midi-fixtures.mjs/);assert.match(host,/WMH_DIRECT_MIDI_EXECUTABLE=\$Executable/);assert.match(host,/verify-native-direct-midi-evidence.mjs/);
 assert.match(workflow,/-Scenario direct-midi/);assert.match(workflow,/verify-native-direct-midi-evidence.mjs --check/);assert.match(workflow,/if: always\(\)/);assert.match(workflow,/!\$\{\{ runner.temp \}\}\/direct-midi-windows\/webview-profiles\/\*\*/);assert.doesNotMatch(workflow,/gh release|npm publish|git push|publish-release/);
 assert.doesNotMatch(renderer,/setInputFiles|dispatchEvent|new File\(|\.files\s*=/);assert.match(renderer,/const action=await native\('picker'/);assert.match(renderer,/report.startAction=await click\('start-performance'\)/);assert.doesNotMatch(renderer,/click\('(?:bulk-import-save|configure-song-mod|song-mod-all-human)'\)/);
});
test('native claim scope excludes physical fidelity, private music and release/full acceptance',()=>{
 assert.deepEqual(DIRECT_MIDI_NATIVE_PHASES,['direct-midi-seed','direct-midi-restart']);for(const key of ['physical_keyboard','physical_midi','physical_audio','audio_fidelity','private_music','full_acceptance','release_ready'])assert.equal(DIRECT_MIDI_NATIVE_CLAIMS[key],false);
});

test('exact injected helper composition parses without starting other scenario runners',async()=>{
 const read=path=>readFile(new URL('../'+path,import.meta.url),'utf8');
 const [wait,reference,vsq,canonical,renderer]=await Promise.all(['crates/desktop-shell/acceptance-wait.js','crates/desktop-shell/reference-acceptance.js','crates/desktop-shell/vsq-song-acceptance.js','crates/desktop-shell/canonical-practice-acceptance.js','scripts/native-direct-midi-renderer.js'].map(read));
 const script=[wait,reference,vsq.split('(() => {')[0],canonical.split('(() => {')[0],renderer].join('\n');assert.doesNotThrow(()=>new vm.Script(script));assert.equal((script.match(/addEventListener\('DOMContentLoaded'/g)||[]).length,1);assert.doesNotMatch(script,/scenario:'(?:pitch-mod|assistance)'/);
});

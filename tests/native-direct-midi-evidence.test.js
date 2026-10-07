import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile, access} from 'node:fs/promises';
import {directMidiFixtures,directMidiDigest as hash,DIRECT_MIDI_POLICY} from '../scripts/prepare-direct-midi-fixtures.mjs';
import {directMidiFixtureMetadata} from '../scripts/direct-midi-proof.mjs';
import {DIRECT_MIDI_NATIVE_PHASES,DIRECT_MIDI_NATIVE_CLAIMS,DIRECT_MIDI_NATIVE_SOURCE_FILES,validateDirectMidiNativeActions,validateDirectMidiNativeRequests,validateDirectMidiNativeRenderer} from '../scripts/verify-native-direct-midi-evidence.mjs';

// Explicitly constructed validator unit inputs. They establish rejection
// contracts only, never Windows, real picker, process, playback or audio success.
const fixture=directMidiFixtures().boundary,archiveKey=`pack-${fixture.manifest.sha256}`;
function opened(){
 const source={format:'midi',bytes:fixture.bytes.length,sha256:fixture.manifest.sha256},coverage={source_tracks:1,source_events:fixture.manifest.source_events,represented_events:fixture.manifest.source_events,key_attacks:4,key_releases:4};
 const score={source,performance:{source_format:0,ppq:384,tracks:fixture.tracks.map((events,source_index)=>({events:structuredClone(events),source_index}))},coverage},score_json=JSON.stringify(score),metadata=directMidiFixtureMetadata(score_json,fixture),metadata_json=JSON.stringify(metadata),identity=hash(JSON.stringify(metadata)),key=`song-${identity}`;
 return{entry:{key},clean_package:{profile:'wmh-basic-keys-midi1-v1',content_sha256:identity,score_json,metadata_json,coverage,runtime:{profile:'wmh-basic-key-practice-v2',source_sha256:source.sha256,rendition:{policy_id:DIRECT_MIDI_POLICY,coverage:{source_attacks:4},duration_ms:2000,notes:[[],[],[],[]]},compilation:{timeline:{duration_ms:2000,note_columns:['id','part_id','midi','velocity','start_ms','duration_ms'],notes:fixture.expectedNotes.map(n=>[n.id,'midi-t1-c1-r0',n.midi,n.velocity,n.start_ms,n.duration_ms])}}}}};
}
const identity=opened().clean_package.content_sha256,key=`song-${identity}`;
function importReport(mode){return{format:'worldmusichub-import-report',version:1,mode,source:{filename:fixture.filename,bytes:fixture.bytes.length,sha256:fixture.manifest.sha256,retained:mode==='commit',...(mode==='commit'?{archive_key:archiveKey}:{})},items:[{status:mode==='commit'?'saved':'ready',...(mode==='commit'?{entry:{key}}:{}),clean_package:{profile:'wmh-basic-keys-midi1-v1',content_sha256:identity,coverage:{key_attacks:4}}}],warnings:['Explicit FIFO rendition retained']};}
const observed=(path,response,{status=200,request=null,sequence=3,screen='library',previewId=`native:${key}`}={})=>({path,status,request,response,observation:'consumed',canceled:false,signalAbortedAtStart:false,signalAborted:false,started:{sequence,screen,previewId},settled:{sequence,screen,previewId}});
const timeline=()=>({duration_ms:2000,notes:fixture.expectedNotes.map(note=>({...note,part_id:'midi-t1-c1-r0',source_note_id:note.id,source_note_ids:[note.id],voice:'1',staff:1}))});
const targetPlan=()=>({source_note_count:4,target_count:4,playable:true,timeline:timeline(),groups:fixture.expectedNotes.map(note=>({part_ids:['midi-t1-c1-r0'],source_note_ids:[note.id],source_occurrence_ids:[note.id],target_id:note.id}))});
function renderer(phase='direct-midi-seed'){
 const value={version:1,scenario:'direct-midi',phase,ok:true,origin:'https://wmh.localhost',actions:6,key,archiveKey,opened:opened(),profileMarkerAbsent:true,requestsRestored:true,errors:[],initialInventory:{entries:phase.endsWith('seed')?[]:[{key}]},inventory:{entries:[{key}],issues:[]},preview:{id:`native:${key}`,status:'ready',screen:'library',startDisabled:false,bulkDialog:false,notice:'Complete MIDI source saved. Disclosed FIFO interpretation',clock:{version:1,available:false,positionMs:0,transportPositionMs:0,durationMs:0,rangeStartMs:0,rangeEndMs:0,running:false,completed:false,phase:'unavailable'}},ended:{screen:'stage',mode:'practice',renderer:'ended',captured:'0',clock:{version:1,available:true,positionMs:2000,transportPositionMs:2000,durationMs:2000,rangeStartMs:0,rangeEndMs:2000,running:false,completed:true,phase:'ended'}},files:{raw:'raw.mid',take:'take.json'},screenshots:{preview:4,ended:6},pickerAction:3,startAction:5,requests:[]};
 if(phase.endsWith('seed'))value.requests.push(observed('/api/import/midi',{error:'Strict overlap rejected'},{status:400}),observed('/api/library/import/preview',importReport('preview')),observed('/api/library/import/commit',importReport('commit')));
 if(phase.endsWith('restart')){value.startAction=4;value.screenshots.preview=3;delete value.pickerAction;}
 for(const sequence of [phase.endsWith('seed')?3:2,value.startAction])value.requests.push(observed('/api/library/load',structuredClone(value.opened),{sequence,request:{key}}),observed('/api/practice-targets',targetPlan(),{sequence,request:{timeline:timeline(),profile:{kind:'piano',key_count:61,lowest_midi:null}}}));
 value.requests.push(observed('/api/assess',{accuracy_percent:0,hits:[],extras:[],misses:fixture.expectedNotes.map(n=>n.id)},{sequence:value.startAction,screen:'stage',request:{inputs:[],timeline:timeline()}}));return value;
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
// Suffix positions describe application fetch order, not a helper-created load.
const sourceRows=r=>r.requests.slice(r.requests.findIndex(row=>row.path==='/api/library/load'));
const removeRow=(r,row)=>r.requests.splice(r.requests.indexOf(row),1);
test('preview and Start require separate complete consumed load-plan pairs in both phases',()=>{
 for(const phase of DIRECT_MIDI_NATIVE_PHASES){
  const r=renderer(phase),[previewLoad,previewPlan,startLoad,startPlan,assessment]=sourceRows(r);
  assert.ok(previewLoad.settled.sequence<r.startAction);assert.equal(startLoad.started.sequence,r.startAction);assert.equal(startLoad.settled.sequence,r.startAction);
  assert.notEqual(previewLoad,startLoad);assert.deepEqual(previewLoad.response,startLoad.response);assert.deepEqual(previewPlan.response,startPlan.response);assert.equal(validateDirectMidiNativeRequests(r),assessment);
 }
});
test('load proof rejects missing preview, missing Start, delayed settlement and contradictory extra loads',()=>{
 const changes=[
  ['no preview load',(r,rows)=>removeRow(r,rows[0])],
  ['no Start revalidation',(r,rows)=>removeRow(r,rows[2])],
  ['preview starts during Start',(r,rows)=>{rows[0].started.sequence=r.startAction;rows[0].settled.sequence=r.startAction;}],
  ['preview settles during Start',(r,rows)=>rows[0].settled.sequence=r.startAction],
  ['preview crosses action boundary',(r,rows)=>rows[0].settled.sequence++],
  ['Start load starts early',(r,rows)=>rows[2].started.sequence--],
  ['Start load starts late',(r,rows)=>{rows[2].started.sequence++;rows[2].settled.sequence++;}],
  ['Start load settles late',(r,rows)=>rows[2].settled.sequence++],
  ['missing settled sequence',(r,rows)=>delete rows[2].settled.sequence],
  ['fractional settled sequence',(r,rows)=>rows[2].settled.sequence+=0.5],
  ['duplicate preview',(r,rows)=>r.requests.splice(r.requests.indexOf(rows[0]),0,structuredClone(rows[0]))],
  ['duplicate Start',(r,rows)=>r.requests.splice(r.requests.indexOf(rows[2]),0,structuredClone(rows[2]))],
  ['unrelated load before preview',(r,rows)=>{const extra=structuredClone(rows[0]);extra.request.key='unrelated';r.requests.splice(r.requests.indexOf(rows[0]),0,extra);}],
  ['contradictory load after Start',(r,rows)=>{const extra=structuredClone(rows[2]);extra.response.entry.key='different';r.requests.push(extra);}],
 ];
 for(const phase of DIRECT_MIDI_NATIVE_PHASES)for(const [label,change]of changes){const r=renderer(phase);change(r,sourceRows(r));assert.throws(()=>validateDirectMidiNativeRequests(r),`${phase}: ${label}`);}
});
test('both load observations bind consumed success, library context and exact complete package identity',()=>{
 const changes=[
  ['wrong requested key',row=>row.request.key='different'],['unexpected request selection',row=>row.request.part_id='partial'],
  ['wrong returned key',row=>row.response.entry.key='different'],['changed package identity',row=>row.response.clean_package.content_sha256='0'.repeat(64)],
  ['changed raw event bytes',row=>row.response.clean_package.score_json+=' '],['changed source SHA',row=>row.response.clean_package.runtime.source_sha256='0'.repeat(64)],
  ['changed compiled source clock',row=>row.response.clean_package.runtime.compilation.timeline.notes[3][4]=1400],
  ['failed response',row=>row.status=500],['unconsumed response',row=>row.observation='awaiting-json'],['canceled response',row=>row.canceled=true],
  ['aborted at fetch',row=>row.signalAbortedAtStart=true],['aborted before consumption',row=>row.signalAborted=true],
  ...['started','settled'].flatMap(point=>[
   [`${point} wrong screen`,row=>row[point].screen='stage'],[`${point} wrong preview`,row=>row[point].previewId='builtin:first-steps'],[`${point} missing preview`,row=>delete row[point].previewId],
  ]),
 ];
 for(const phase of DIRECT_MIDI_NATIVE_PHASES)for(const index of [0,2])for(const [label,change]of changes){const r=renderer(phase);change(sourceRows(r)[index]);assert.throws(()=>validateDirectMidiNativeRequests(r),`${phase} load ${index}: ${label}`);}
 for(const field of ['part','duration','columns']){const r=renderer(),compiled=r.opened.clean_package.runtime.compilation.timeline;if(field==='part')compiled.notes[0][1]='different';else if(field==='duration')compiled.duration_ms=1000;else compiled.note_columns.reverse();for(const load of [sourceRows(r)[0],sourceRows(r)[2]])load.response=structuredClone(r.opened);assert.throws(()=>validateDirectMidiNativeRequests(r),`consistent loads cannot mask wrong compiled ${field}`);}
});
test('each load is followed by its own complete plan with exact identities, source clock and order',()=>{
 const changes=[
  ['missing plan',(r,row)=>removeRow(r,row)],['failed plan',(_,row)=>row.status=500],['unplayable plan',(_,row)=>row.response.playable=false],
  ['wrong source count',(_,row)=>row.response.source_note_count=3],['wrong target count',(_,row)=>row.response.target_count=3],
  ['delayed plan',(_,row)=>row.settled.sequence++],['plan wrong preview',(_,row)=>row.started.previewId='different'],['plan on stage',(_,row)=>row.settled.screen='stage'],
  ['missing group',(_,row)=>row.response.groups.pop()],['wrong source group',(_,row)=>row.response.groups[0].source_note_ids=['other']],
  ...['request','response'].flatMap(side=>[
   [`${side} missing target`,(_,row)=>row[side].timeline.notes.pop()],
   [`${side} changed pitch`,(_,row)=>row[side].timeline.notes[0].midi++],
   [`${side} changed velocity`,(_,row)=>row[side].timeline.notes[0].velocity++],
   [`${side} changed part`,(_,row)=>row[side].timeline.notes[0].part_id='different'],
   [`${side} changed source identity`,(_,row)=>row[side].timeline.notes[0].source_note_id='different'],
   [`${side} changed target clock`,(_,row)=>row[side].timeline.notes[3].start_ms-=100],
   [`${side} changed note duration`,(_,row)=>row[side].timeline.notes[3].duration_ms-=100],
   [`${side} changed source duration`,(_,row)=>row[side].timeline.duration_ms=1000],
  ]),
 ];
 for(const phase of DIRECT_MIDI_NATIVE_PHASES)for(const index of [1,3])for(const [label,change]of changes){const r=renderer(phase);change(r,sourceRows(r)[index]);assert.throws(()=>validateDirectMidiNativeRequests(r),`${phase} plan ${index}: ${label}`);}
 for(const phase of DIRECT_MIDI_NATIVE_PHASES){
  for(const [left,right]of [[0,1],[2,3],[3,4]]){const r=renderer(phase),rows=sourceRows(r),a=r.requests.indexOf(rows[left]),b=r.requests.indexOf(rows[right]);[r.requests[a],r.requests[b]]=[r.requests[b],r.requests[a]];assert.throws(()=>validateDirectMidiNativeRequests(r),`${phase}: out-of-order load, plan or assessment`);}
  const r=renderer(phase);sourceRows(r)[3].request.profile.key_count=49;assert.throws(()=>validateDirectMidiNativeRequests(r),'Start cannot silently change preview profile');
  const extra=renderer(phase);extra.requests.push(structuredClone(sourceRows(extra)[3]));assert.throws(()=>validateDirectMidiNativeRequests(extra),'Additional target plan must not be filtered away');
 }
});
test('prefix admits distinct earlier bootstrap plans but never additional saved-source plans',()=>{
 for(const phase of DIRECT_MIDI_NATIVE_PHASES){
  const bootstrap=()=>observed('/api/practice-targets',{timeline:{duration_ms:1000,notes:[{id:'builtin-note',source_note_id:'builtin-note',source_note_ids:['builtin-note']}]},groups:[]},{sequence:0,screen:'home',previewId:'first-steps',request:{timeline:{duration_ms:1000,notes:[{id:'builtin-note',source_note_id:'builtin-note',source_note_ids:['builtin-note']}]}}});
  const accepted=renderer(phase);accepted.requests.unshift(bootstrap(),bootstrap());validateDirectMidiNativeRequests(accepted);
  const changes=[
   ['actual additional saved plan',r=>structuredClone(sourceRows(r)[1])],
   ['saved identity on bootstrap',()=>{const row=bootstrap();row.started.previewId=row.settled.previewId=`native:${key}`;return row;}],
   ['saved notes under different preview',r=>{const row=structuredClone(sourceRows(r)[1]);row.started=row.settled={sequence:0,screen:'home',previewId:'first-steps'};return row;}],
   ['saved source id under different target id',()=>{const row=bootstrap();row.request.timeline.notes[0].source_note_id=fixture.expectedNotes[0].id;return row;}],
   ['saved response source ids',()=>{const row=bootstrap();row.response.timeline.notes[0].source_note_ids=[fixture.expectedNotes[0].id];return row;}],
   ['saved group source occurrence',()=>{const row=bootstrap();row.response.groups=[{target_id:'other',source_occurrence_ids:[fixture.expectedNotes[0].id]}];return row;}],
   ['late other-source plan',r=>{const row=bootstrap();row.started.sequence=row.settled.sequence=sourceRows(r)[0].started.sequence;return row;}],
  ];
  for(const [label,make]of changes){const r=renderer(phase),extra=make(r);r.requests.splice(extra.started.sequence===0?0:r.requests.indexOf(sourceRows(r)[0]),0,extra);assert.throws(()=>validateDirectMidiNativeRequests(r),`${phase}: ${label}`);}
 }
});
test('assessment follows Start planning on stage with no inputs and the complete unchanged source clock',()=>{
 for(const phase of DIRECT_MIDI_NATIVE_PHASES)for(const change of [
  row=>row.started.sequence--,row=>row.settled.sequence++,row=>row.started.screen='library',row=>row.settled.previewId='different',
  row=>row.request.inputs.push({midi:60}),row=>row.request.timeline.notes[3].start_ms-=100,row=>row.request.timeline.notes[0].midi++,row=>row.request.timeline.duration_ms=1000,
  row=>row.response.misses[0]='different',row=>row.response.hits.push({note_id:fixture.expectedNotes[0].id}),row=>row.response.extras.push({midi:60}),
 ]){const r=renderer(phase);change(sourceRows(r)[4]);assert.throws(()=>validateDirectMidiNativeRequests(r));}
 for(const point of ['preview','ended'])for(const field of ['positionMs','transportPositionMs','durationMs','rangeStartMs','rangeEndMs']){const r=renderer();r[point].clock[field]++;assert.throws(()=>validateDirectMidiNativeRenderer(r),`${point} ${field} must match the captured transport`);}
});
function actionModel(){
 const ids=['home-single-player',null,'preview-title','start-performance','stage-title','results-button','export-takes',null,'back-to-library','import-tools-button','bulk-import-history-button',null,null],actions=ids.map((_,i)=>({version:1,sequence:i+1,kind:'click',x:100,y:100,width:1280,height:720})),target={x:50,y:80,width:100,height:40};
 const controls=actions.map((action,i)=>({sequence:i+1,id:ids[i],kind:'click',request:{...action,target},samples:[{hitId:ids[i],hitOwned:true,target,width:1280,height:720},{hitId:ids[i],hitOwned:true,target,width:1280,height:720}],clicks:[{sequence:i+1,id:ids[i],trusted:true,owned:true}]}));
 const report={phase:'direct-midi-restart',actions:ids.length,controls,pickerObservations:[],trusted:[{id:'start-performance',type:'click',trusted:true,actionSequence:4}],startAction:4,files:{take:'take.json',raw:'raw.mid'},downloads:{take:{action:7,file:'take.json',complete:true,success:true},raw:{action:13,file:'raw.mid',complete:true,success:true}}},host={actions:ids.length,process_id:99};
 const results=actions.map(()=>({ok:true,client_click:{app_hwnd:1,hit_hwnd:1,hit_root:1,foreground:1,viewport:[1280,720],client:[0,0,1280,720],origin:[20,30],requested:[120,130],actual:[120,130]}}));return{report,host,actions,results};
}
test('native action proof rejects forged clicks, wrong HWND, arbitrary actions, missing download and Mod repairs',()=>{
 const run=m=>validateDirectMidiNativeActions(m.report,m.host,m.actions,m.results);run(actionModel());
 for(const change of [m=>m.results[0].client_click.foreground=2,m=>m.results[0].client_click.actual[0]++,m=>m.results[0].ok=false,m=>m.report.controls[0].clicks[0].trusted=false,m=>m.report.controls[0].samples[1].hitOwned=false,m=>m.actions[0].file='../private.mid',m=>m.actions[0].kind='key-r',m=>m.report.downloads.raw.success=false,m=>m.report.trusted=[],m=>m.report.controls[2].id='song-mod-apply',m=>m.report.actions=65]){const m=structuredClone(actionModel());change(m);assert.throws(()=>run(m));}
});
test('native pointer proof admits the same painted owned descendant without replacing its original control',()=>{
 const run=m=>validateDirectMidiNativeActions(m.report,m.host,m.actions,m.results);
 for(const id of [null,'home-description']){const m=actionModel(),control=m.report.controls[0];for(const sample of control.samples)sample.hitId=id;control.clicks[0].id=id;run(m);assert.equal(control.id,'home-single-player');}
 const shortened=actionModel();shortened.report.controls.pop();shortened.actions.pop();shortened.results.pop();shortened.report.actions--;shortened.host.actions--;shortened.report.downloads.raw.action--;run(shortened);
});
test('native pointer proof rejects unrelated, changed, foreign or forged descendant observations',()=>{
 const changes=[
  ['unrelated trusted ID',m=>m.report.controls[0].clicks[0].id='neighbor'],
  ['null without sampled descendant',m=>m.report.controls[0].clicks[0].id=null],
  ['missing painted ID',m=>{for(const sample of m.report.controls[0].samples)delete sample.hitId;}],
  ['changed painted descendant',m=>m.report.controls[0].samples[0].hitId='old-child'],
  ['changed actual descendant',m=>m.report.controls[0].clicks[0].id='other-child'],
  ['foreign actual descendant',m=>m.report.controls[0].clicks[0].owned=false],
  ['foreign painted descendant',m=>m.report.controls[0].samples[1].hitOwned=false],
  ['changed requested original control',m=>m.report.controls[0].id='neighbor'],
  ['missing requested original identity',m=>m.report.controls[0].id=null],
  ['wrong action sequence',m=>m.report.controls[0].clicks[0].sequence=2],
  ['untrusted descendant',m=>m.report.controls[0].clicks[0].trusted=false],
  ['duplicate trusted descendant',m=>m.report.controls[0].clicks.push({...m.report.controls[0].clicks[0]})],
  ['extra trusted foreign target',m=>m.report.controls[0].clicks.push({...m.report.controls[0].clicks[0],owned:false,id:'neighbor'})],
  ['foreign native root',m=>m.results[0].client_click.hit_root=2],
  ['changed native coordinate',m=>m.results[0].client_click.actual[0]++],
  ['missing exact Start trust',m=>m.report.trusted[0].id='start-child'],
  ['changed exact Start target',m=>{const control=m.report.controls[3];for(const sample of control.samples)sample.hitId='start-child';control.clicks[0].id='start-child';}],
  ['untrusted file forwarding cannot activate',m=>{m.report.controls[0].clicks[0].trusted=false;m.report.controls[0].clicks.push({sequence:1,id:'score-file',owned:false,trusted:false});}],
 ];
 for(const [label,change]of changes){const m=actionModel(),control=m.report.controls[0];for(const sample of control.samples)sample.hitId=null;control.clicks[0].id=null;if(label==='null without sampled descendant')for(const sample of control.samples)sample.hitId='home-single-player';change(m);assert.throws(()=>validateDirectMidiNativeActions(m.report,m.host,m.actions,m.results),label);}
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

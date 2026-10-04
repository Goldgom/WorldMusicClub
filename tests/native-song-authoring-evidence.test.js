import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {webcrypto} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import vm from 'node:vm';
import {authoringAcceptanceFixtures,AUTHORING_PAIR_ALIAS,AUTHORING_FIXTURE_FILENAMES} from '../scripts/prepare-song-authoring-fixtures.mjs';
import {validateAuthoringPicker,validateAuthoringExport,validateAuthoringTakes,AUTHORING_CLAIMS} from '../scripts/verify-native-song-authoring-evidence.mjs';
import {authoringPickerFiles,createAuthoringHostedChooser} from '../scripts/song-authoring-hosted-chooser.mjs';
import {createAuthoringHostedConsole} from '../scripts/song-authoring-hosted-console.mjs';
import {storedZip} from './native-import-driver-fixtures.js';
const read=name=>readFile(new URL(`../${name}`,import.meta.url),'utf8');
const renderer=await read('crates/desktop-shell/song-authoring-acceptance.js'),fixtures=authoringAcceptanceFixtures();
function picker(sequence,file){const chosen=fixtures.filter(f=>file===AUTHORING_PAIR_ALIAS?f.id!=='blocked':f.id==='blocked');return{sequence,file,completed:true,started_wall_ms:0,finished_wall_ms:0,blurs:[],delegated:[{id:'authoring-files',type:'click',trusted:false}],changes:[{trusted:true,count:chosen.length,input:{id:'authoring-files',type:'file',multiple:true,disabled:false,connected:true}}],files:chosen.map(f=>({filename:f.filename,bytes:f.bytes.length,sha256:f.manifest.sha256}))};}
test('actual picker inventory requires the exact pair, blocked file, count, bytes and trusted change',()=>{
 const report={phase:'authoring-seed',pickerObservations:[picker(1,AUTHORING_PAIR_ALIAS),picker(2,AUTHORING_FIXTURE_FILENAMES.blocked),picker(3,AUTHORING_PAIR_ALIAS)]};validateAuthoringPicker(report);validateAuthoringPicker({phase:'authoring-restart',pickerObservations:[]});
 for(const edit of [r=>r.pickerObservations.pop(),r=>r.pickerObservations[0].files.pop(),r=>r.pickerObservations[0].files.reverse(),r=>r.pickerObservations[0].files[0].sha256='0'.repeat(64),r=>r.pickerObservations[0].files[0].bytes++,r=>r.pickerObservations[0].changes[0].count=1,r=>r.pickerObservations[0].changes[0].trusted=false,r=>r.pickerObservations[0].changes[0].input.id='score-file',r=>r.pickerObservations[0].delegated.push({id:'authoring-files',type:'click',trusted:false}),r=>r.pickerObservations[0].file='../other.mid',r=>r.pickerObservations[0].completed=false]){const bad=structuredClone(report);edit(bad);assert.throws(()=>validateAuthoringPicker(bad));}
});
test('authoring picker aliases cannot select arbitrary or expanded fixture paths',()=>{
 assert.deepEqual(authoringPickerFiles(AUTHORING_PAIR_ALIAS,'/fixtures'),['/fixtures/authoring-original-strict.mid','/fixtures/authoring-original-events.mid']);assert.deepEqual(authoringPickerFiles(AUTHORING_FIXTURE_FILENAMES.blocked,'/fixtures'),['/fixtures/authoring-original-blocked.mid']);
 for(const alias of ['*','authoring-original-multiple','authoring-original-strict.mid','../authoring-original-blocked.mid','/private/music.mid','a.mid" "b.mid',null])assert.throws(()=>authoringPickerFiles(alias,'/fixtures'));
});
test('the renderer observes real selected File bytes and bounds the entire selection',async()=>{
 const listeners={},document={addEventListener:(name,fn)=>listeners[name]=fn,removeEventListener:()=>{}};
 const create=vm.runInNewContext(`${renderer.split('(() => {')[0]}\ncreateAuthoringControlObserver`,{crypto:webcrypto,Uint8Array,Promise,Array,Error}),observer=create(document,{now:()=>0}),files=fixtures.slice(0,2).map(f=>({name:f.filename,size:f.bytes.length,arrayBuffer:async()=>f.bytes}));
 const target={id:'authoring-files',type:'file',multiple:true,disabled:false,isConnected:true,files};observer.begin(1,AUTHORING_PAIR_ALIAS);listeners.click({type:'click',isTrusted:false,target});listeners.change({type:'change',isTrusted:true,target});await observer.end(1,true);await observer.finish();
 assert.deepEqual(JSON.parse(JSON.stringify(observer.pickers)),[picker(1,AUTHORING_PAIR_ALIAS)]);await assert.rejects(observer.end(1,true));observer.restore();
});
test('hosted observer consumes only its actual enabled authoring FileChooser and finite pair',async()=>{
 let listener,selected;const page={on:(name,fn)=>{assert.equal(name,'filechooser');listener=fn;},off(){},mouse:{async click(){listener({page:()=>page,isMultiple:()=>true,element:()=>({evaluate:async()=>({id:'authoring-files',tag:'INPUT',type:'file',disabled:false,multiple:true,connected:true})}),setFiles:async files=>{selected=files;}});}}};
 const observer=createAuthoringHostedChooser(page);observer.navigation('start');observer.navigation('end');await observer.choose({sequence:1,file:AUTHORING_PAIR_ALIAS,x:1,y:1},'/fixtures');observer.assertComplete([1]);assert.deepEqual(selected,authoringPickerFiles(AUTHORING_PAIR_ALIAS,'/fixtures'));assert.equal(observer.evidence.events[0].selected_count,2);observer.stop();
});
test('clean export preserves exactly metadata and score bytes and refuses source/report sidecars',()=>{
 const draft={package:{metadata_json:'{"title":"Original C/E/G"}\n',score_json:'{"source":"original"}\n'}},folder='songs/song-original',entries=[['manifest.json',JSON.stringify({format:'worldmusichub-song-pack',version:2,songs:[{folder}]})],[`${folder}/metadata.json`,draft.package.metadata_json],[`${folder}/score.json`,draft.package.score_json]];validateAuthoringExport(storedZip(entries),draft);
 for(const extra of ['raw.mid','inventory.json','runtime.json','audit.json','request.json'])assert.throws(()=>validateAuthoringExport(storedZip([...entries,[`${folder}/${extra}`,'private or derived']]),draft));
 assert.throws(()=>validateAuthoringExport(storedZip(entries.map(([name,bytes])=>[name,name.endsWith('score.json')?bytes+' ':bytes])),draft));
});
function humanTake(){const input={midi:60,velocity:90,at_ms:100};return{version:1,score_id:'original-authored-practice',practice_part:null,passes:[{id:1,capture_enabled:true,inputs:[input],captures:[{event_id:1,event_wall_ms:1100,received_wall_ms:1101,input}],assessment:null,timeline:{notes:[{id:'original-note',midi:60,start_ms:0,duration_ms:1000}]}}],input_evidence:{version:1,truncated:false,omitted_observations:0,events:[{event_id:1,kind:'note_on',input_kind:'typing_keyboard',encoding:'key_down',midi:60,velocity:90,event_wall_ms:1100,received_wall_ms:1101,onset_capture:{pass_id:1,event_id:1}},{event_id:2,kind:'boundary',reason:'blur',event_wall_ms:1200,received_wall_ms:1201,boundary_wall_ms:1200}]}};}
function transport(){const state={passId:'1',captured:'1',cue:'paused',hidden:false,openDialogs:[],positionMs:500};return{version:1,stage:'complete',omitted:0,rowBytes:1000,trustedPlayClicks:2,trustedKeyDowns:1,trustedKeyUps:1,current:state,rows:[{kind:'ready',state:{...state,positionMs:0}},{kind:'transport',state:{...state,phase:'capturing',positionMs:200}},...['keydown','keyup'].map(type=>({kind:'event',state,event:{type,trusted:true,code:'KeyR',surface:'stage-title',repeat:false}}))]};}
test('comparison preserves complete human input evidence including blur clocks, boundaries and assessment',()=>{
 const before=humanTake(),report={transportAdmission:transport()};validateAuthoringTakes(before,structuredClone(before),report);
 for(const edit of [after=>after.input_evidence.events.pop(),after=>after.input_evidence.events.at(-1).received_wall_ms++,after=>after.input_evidence.events.at(-1).boundary_wall_ms++,after=>after.input_evidence.events.push({kind:'boundary',reason:'blur'}),after=>after.passes[0].assessment={score:100},after=>after.passes[0].inputs.push(after.passes[0].inputs[0]),after=>after.score_id='midi-clean-other']){const after=structuredClone(before);edit(after);assert.throws(()=>validateAuthoringTakes(before,after,report));}
 const noHuman=humanTake();noHuman.passes[0].captures=[];assert.throws(()=>validateAuthoringTakes(noHuman,noHuman,report));
});
test('authoring console only admits the exact fulfilled original Rust rejection, preserving all other errors',()=>{
 const origin='https://wmh.localhost',message=(text,url=`${origin}/api/clean-song/draft`)=>({type:()=> 'error',text:()=>text,location:()=>({url,lineNumber:0,columnNumber:0})}),text='Failed to load resource: the server responded with a status of 422 (Unprocessable Entity)';
 const observer=createAuthoringHostedConsole({origin});observer.rejectedResponse({path:'/api/clean-song/draft',method:'POST',status:422,source_name:AUTHORING_FIXTURE_FILENAMES.blocked,state:'rejected',source_sha256:fixtures[2].manifest.sha256}).finish(true);observer.observe(message(text));observer.assertComplete();observer.observe(message('Unexpected authoring exception'));assert.throws(()=>observer.assertComplete());
 const unowned=createAuthoringHostedConsole({origin});unowned.observe(message(text));assert.throws(()=>unowned.assertComplete());
});
test('all injected helpers parse with one runner, no fake DOM/clock/file events, and fixed action/report bounds',async()=>{
 const helpers=await Promise.all(['acceptance-wait.js','reference-acceptance.js','vsq-song-acceptance.js','performance-song-acceptance.js'].map(name=>read(`crates/desktop-shell/${name}`)));for(const index of [2,3])helpers[index]=helpers[index].split('(() => {')[0];assert.doesNotThrow(()=>new vm.Script([...helpers,renderer].join('\n')));assert.equal(renderer.split('(() => {').length,2);assert.match(renderer,/Reflect.apply\(originalFetch,this,args\)/);assert.match(renderer,/sequence<64/);assert.match(renderer,/humanActionStart:sequence,lastPickerAction/);assert.match(renderer,/assert\(JSON.stringify\(report.afterTakeState\)===JSON.stringify\(report.beforeTakeState\)/);assert.doesNotMatch(renderer,/dispatchEvent|setInputFiles|delete .*input_evidence|filter.*blur|\.passes\s*=/);
 const claims=JSON.parse(await read('scripts/native-song-authoring-claims.json'));assert.deepEqual(claims,AUTHORING_CLAIMS);assert.equal(claims.full_checkpoint_acceptance,false);assert.equal(claims.conversion_implies_playability,false);assert.equal(claims.actual_audibility,false);
});

test('authoring report serialization keeps the same strict 1 MiB native and hosted envelope',async()=>{
 const post=vm.runInNewContext(`${renderer.split('(() => {')[0]}\npostAuthoringAcceptanceReport`,{TextEncoder}),sent=[],waits={json:async(_,path,request)=>{assert.equal(path,'/__desktop_smoke/report');sent.push(JSON.parse(request.body));}};
 assert.equal((await post({report:{version:1,phase:'authoring-seed',ok:true},waits})).delivered,true);assert.equal(sent[0].ok,true);
 assert.equal((await post({report:{version:1,phase:'authoring-seed',ok:true,padding:'x'.repeat(1024*1024)},waits})).delivered,false);assert.equal(sent.length,2);assert.equal(sent[1].ok,false);assert.equal(sent[1].report_failure.limit_bytes,1024*1024);assert.equal(sent[1].report_failure.code,'authoring_report_delivery_failed');
});
test('independent manifest rejects wrong source, EXE, report hashes, missing/extra claims and numeric booleans',()=>{
 // Unit-test the Python source/EXE boundary separately from the full Node
 // verifier. The subprocess stub is confined to this test; it is not evidence
 // of a native run and no generated manifest is promoted or delivered.
 const source=String.raw`
import copy, hashlib, importlib.util, json, pathlib, tempfile, types
from unittest.mock import patch
root=pathlib.Path.cwd()
spec=importlib.util.spec_from_file_location('authoring_manifest',root/'scripts/native-song-authoring-manifest.py')
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
with tempfile.TemporaryDirectory(prefix='wmh-manifest-contract-') as temp:
 directory=pathlib.Path(temp);executable=directory/'original-fixture.exe';executable.write_bytes(b'original fixture executable bytes')
 commit='a'*40;tree='b'*40
 base={'version':1,'ok':True,'source_sha':commit,'source_tree':tree,'executable_sha256':module.sha(executable.read_bytes()),'executable_bytes':executable.stat().st_size}
 native_path=directory/'native-song-authoring.json';native_path.write_text(json.dumps(base))
 for phase in module.SONG_AUTHORING_PHASES:(directory/f'renderer-{phase}.json').write_text(json.dumps({'version':1,'phase':phase,'fixture_only':True}))
 proof={**base,'claims':dict(module.SONG_AUTHORING_CLAIMS),'files':[{'path':name,'bytes':(directory/name).stat().st_size,'sha256':module.sha((directory/name).read_bytes())} for name in module.SONG_AUTHORING_REPORTS]}
 proof_path=directory/'native-song-authoring-files.json'
 def save(value):proof_path.write_text(json.dumps(value))
 def rejects(value):
  save(value)
  try:module.accepted_song_authoring_evidence(directory,executable,commit,tree)
  except ValueError:return
  raise AssertionError('Manifest admitted invalid source/EXE/claims/report bytes')
 with patch.object(module.subprocess,'run',return_value=types.SimpleNamespace(returncode=0,stderr='')) as invoked:
  save(proof);result=module.accepted_song_authoring_evidence(directory,executable,commit,tree)
  assert result['full_checkpoint_acceptance'] is False and result['release_ready'] is False
  assert invoked.call_count==1 and invoked.call_args.args[0][-2]=='--check'
  for name,value in [('source_sha','c'*40),('source_tree','c'*40),('executable_sha256','c'*64),('executable_bytes',1),('version',True),('ok',1)]:
   bad=copy.deepcopy(proof);bad[name]=value;rejects(bad)
  for name in module.SONG_AUTHORING_CLAIMS:
   bad=copy.deepcopy(proof);bad['claims'][name]=int(bad['claims'][name]);rejects(bad)
   bad=copy.deepcopy(proof);del bad['claims'][name];rejects(bad)
  bad=copy.deepcopy(proof);bad['claims']['extra_acceptance']=True;rejects(bad)
  for name in module.SONG_AUTHORING_REPORTS:
   bad=copy.deepcopy(proof);next(row for row in bad['files'] if row['path']==name)['sha256']='d'*64;rejects(bad)
  save(proof)
  with patch.object(module.subprocess,'run',return_value=types.SimpleNamespace(returncode=1,stderr='fixture verifier rejected')):
   rejects(proof)
print('source, executable, strict claims and independent verifier boundary passed')
`;
 const result=spawnSync('python',['-c',source],{cwd:new URL('../',import.meta.url),encoding:'utf8'});assert.equal(result.status,0,result.stderr||result.stdout);assert.match(result.stdout,/strict claims/);
});

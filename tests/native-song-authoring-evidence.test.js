import {readPlaybackClock} from '../web/playback-clock-view.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,writeFile,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {webcrypto,createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import vm from 'node:vm';
import {authoringAcceptanceFixtures,AUTHORING_PAIR_ALIAS,AUTHORING_FIXTURE_FILENAMES} from '../scripts/prepare-song-authoring-fixtures.mjs';
import {validateAuthoringPicker,validateAuthoringExport,validateAuthoringTakes,validateAuthoringNavigation,validateAuthoringEventOnlyOpened,verifyNativeSongAuthoringEvidence,AUTHORING_PHASES,AUTHORING_CLAIMS} from '../scripts/verify-native-song-authoring-evidence.mjs';
import {addNativeProfileEvidence} from './native-profile-evidence-fixtures.js';
import {authoringPickerFiles,createAuthoringHostedChooser} from '../scripts/song-authoring-hosted-chooser.mjs';
import {createAuthoringHostedConsole} from '../scripts/song-authoring-hosted-console.mjs';
import {storedZip} from './native-import-driver-fixtures.js';
import {freePracticeApp,fixtureScoreServer} from './free-practice-app-fixtures.js';
import {waitForTestCondition} from './async-test-wait.js';
const read=name=>readFile(new URL(`../${name}`,import.meta.url),'utf8');
const renderer=await read('crates/desktop-shell/song-authoring-acceptance.js'),fixtures=authoringAcceptanceFixtures();
test('captured original Rust open response proves null notation through the summary, score and receiver identity',async()=>{
 const bytes=await readFile(new URL('./fixtures/song-authoring/acceptance-events-opened.json',import.meta.url)),opened=JSON.parse(bytes),provenance=JSON.parse(await read('tests/fixtures/song-authoring/acceptance-events-opened-provenance.json')),source=fixtures.find(f=>f.id==='events');
 assert.equal(bytes.length,provenance.file.bytes);assert.equal(createHash('sha256').update(bytes).digest('hex'),provenance.file.sha256);assert.deepEqual(provenance.source_midi,{format:'midi',bytes:source.bytes.length,sha256:source.manifest.sha256});assert.equal(provenance.limits.original_run_post_verifier_passed,false);assert.equal(provenance.limits.full_checkpoint_acceptance,false);
 assert.equal(Object.hasOwn(opened.clean_package,'notation_available'),false,'Rust OpenPackage does not own the summary boolean');assert.equal(opened.entry.clean_package.notation_available,false);validateAuthoringEventOnlyOpened(opened);
 const score=JSON.parse(opened.clean_package.score_json);assert.equal(score.source.sha256,source.manifest.sha256);assert.equal(score.coverage.performance.source_events,source.inventory.source_events);assert.equal(score.coverage.performance.source_tracks,source.inventory.source_tracks);
 const editScore=(value,edit)=>{const score=JSON.parse(value.clean_package.score_json);edit(score);value.clean_package.score_json=JSON.stringify(score);};
 for(const edit of [v=>delete v.entry.clean_package,v=>v.entry.clean_package=null,v=>v.entry.clean_package={},v=>delete v.entry.clean_package.notation_available,v=>v.entry.clean_package.notation_available=0,v=>v.entry.clean_package.notation_available=null,v=>v.entry.clean_package.notation_available=true,v=>v.entry.clean_package.profile='wmh-semantic-midi1-v1',v=>v.entry.clean_package.content_sha256='0'.repeat(64),v=>delete v.entry.clean_package.coverage,v=>delete v.score_json,v=>v.score_json='null',v=>editScore(v,s=>delete s.notation),v=>editScore(v,s=>s.notation=false),v=>editScore(v,s=>s.notation={parts:[]}),v=>editScore(v,s=>s.coverage.notation.represented_attacks=1),v=>editScore(v,s=>s.coverage.targets.status='complete'),v=>v.clean_package.profile='wmh-semantic-midi1-v1',v=>delete v.clean_package.runtime,v=>v.clean_package.runtime.profile='wmh-semantic-midi1-v1',v=>delete v.clean_package.runtime.score_id,v=>delete v.clean_package.runtime.source_sha256,v=>delete v.clean_package.runtime.score_sha256,v=>v.clean_package.runtime.source_sha256='0'.repeat(64),v=>v.clean_package.runtime.score_sha256='0'.repeat(64),v=>v.clean_package.runtime.score_id+='-other',v=>delete v.clean_package.runtime.coverage,v=>v.clean_package.runtime.coverage.notation.status='complete',v=>v.clean_package.runtime.compilation=null,v=>v.clean_package.runtime.notes=[]]){const bad=structuredClone(opened);edit(bad);assert.throws(()=>validateAuthoringEventOnlyOpened(bad));}
 assert.match(await read('scripts/check-song-authoring-native.mjs'),/validateAuthoringEventOnlyOpened\(opened\)/,'Real Rust stdio must exercise the same opened-package assertion before GUI acceptance');
});
const navigation=await read('crates/desktop-shell/acceptance-wait.js'),reference=await read('crates/desktop-shell/reference-acceptance.js'),performanceSetup=await read('crates/desktop-shell/performance-song-acceptance.js');
const {createAcceptanceNavigation,prepareAuthoringNavigationPause,activatePerformanceOriginalScore}=vm.runInNewContext(`${navigation}\n${reference}\n${performanceSetup.split('(() => {')[0]}\n${renderer.split('(() => {')[0]}\n({createAcceptanceNavigation,prepareAuthoringNavigationPause,activatePerformanceOriginalScore})`,{__wmhReadPlaybackClock:readPlaybackClock,AbortController,setTimeout,clearTimeout,performance,TextEncoder,queueMicrotask});
// Node DOM regression only: real app handlers and elapsed clock, fixture Rust
// replies and untrusted DOM clicks. This cannot create native acceptance proof.
async function navigationFixture({suppress=null}={}){
 const serve=await fixtureScoreServer(),app=await freePracticeApp({fetchResult:serve}),prototype=app.window.HTMLElement.prototype,geometry=Object.getOwnPropertyDescriptor(prototype,'getBoundingClientRect'),timers=new Set(),actions=[];
 Object.defineProperty(prototype,'getBoundingClientRect',{configurable:true,value(){return{width:120,height:40};}});
 Object.defineProperty(globalThis,'requestAnimationFrame',{configurable:true,value:callback=>{const timer=setTimeout(()=>{timers.delete(timer);callback(performance.now());},10);timers.add(timer);return timer;}});
 Object.defineProperty(globalThis,'cancelAnimationFrame',{configurable:true,value:timer=>{clearTimeout(timer);timers.delete(timer);}});
 app.emit(app.window,'pageshow',{persisted:true});
 const click=id=>app.$(id).click(),until=(condition,label)=>waitForTestCondition(condition,{label,timeoutMs:(suppress==='start-listen'&&label==='native Start Listen is running')||(suppress==='back-to-library'&&label==='navigation genuinely paused')?200:5000}),menu=createAcceptanceNavigation({document:app.document,click,until});
 const native=async(kind,node)=>{assert.equal(kind,'click');actions.push(node.id);if(node.id!==suppress)node.click();return actions.length;};
 const snapshot=()=>({title:app.$('score-title').textContent,stage:app.$('stage-title').textContent,mode:app.$('session-mode').value,clock:readPlaybackClock(app.document).positionMs,captured:app.$('hud-captured').textContent,cue:app.$('stage-cue').dataset.cueState,soundMuted:app.$('sound-button').getAttribute('aria-pressed')==='true',pressed:app.document.querySelectorAll('.pressed').length});
 await menu.enterLibrary();
 return{app,click,until,menu,native,snapshot,actions,async close(){try{await app.close();}finally{for(const timer of timers)clearTimeout(timer);if(geometry)Object.defineProperty(prototype,'getBoundingClientRect',geometry);else delete prototype.getBoundingClientRect;}}};
}
test('real Start Listen handler starts transport and a second Play toggle pauses it',async()=>{
 const f=await navigationFixture();try{
  await activatePerformanceOriginalScore({document:f.app.document,click:f.click,menu:f.menu});await f.until(()=>readPlaybackClock(f.app.document).positionMs>0,'Start Listen clock advances');assert.notEqual(f.snapshot().cue,'paused');
  await f.native('click',f.app.$('play-button'));assert.equal(f.snapshot().cue,'paused');assert.deepEqual(f.app.audio(),{contexts:0,unlocks:0});
 }finally{await f.close();}
});
test('authoring waits for Start Listen transport before Songs pauses it, without a second toggle',async()=>{
 const f=await navigationFixture();try{
  const result=await prepareAuthoringNavigationPause({document:f.app.document,...f});assert.deepEqual(f.actions,['start-listen','back-to-library']);assert.ok(Number(result.before.clock)>0);assert.equal(result.after.cue,'paused');assert.equal(result.after.pressed,0);assert.equal(result.admission.stage,'complete');assert.equal(result.admission.trustedPlayClicks,0);assert.deepEqual(f.app.audio(),{contexts:0,unlocks:0});
  assert.deepEqual(Array.from(result.admission.rows.filter(row=>['listen-ready','listen-running','navigation-paused'].includes(row.kind)),row=>row.kind),['listen-ready','listen-running','navigation-paused']);
  assert.ok(result.admission.rows.filter(row=>row.event?.type==='click').every(row=>row.event.trusted===false),'Node DOM evidence must remain explicitly untrusted');
 }finally{await f.close();}
});
test('missing listen or navigation effects fail at their own causal boundary without retrying',async()=>{
 for(const suppress of ['start-listen','back-to-library']){const f=await navigationFixture({suppress});try{
  await assert.rejects(prepareAuthoringNavigationPause({document:f.app.document,...f}),error=>{assert.equal(error.authoringNavigation.stage,suppress==='start-listen'?'listen-start':'navigation-pause');assert.notEqual(error.authoringNavigation.current.screen,suppress==='start-listen'?'stage':'library');return true;});
  assert.deepEqual(f.actions,suppress==='start-listen'?['start-listen']:['start-listen','back-to-library']);
 }finally{await f.close();}}
});
function navigationEvidence(){
 const state={screen:'library',mode:'listen',playDisabled:false,hidden:false,openDialogs:[],positionMs:0,durationMs:10000,cue:'ready',captured:'0',soundMuted:true},running={...state,screen:'stage',positionMs:100,cue:''},paused={...state,positionMs:120,cue:'paused'},event=control=>({type:'click',control,trusted:true}),rows=[{kind:'listen-ready',state},{kind:'event',event:event('start-listen'),state},{kind:'listen-running',state:running},{kind:'event',event:event('back-to-library'),state:running},{kind:'navigation-paused',state:paused}].map((row,index)=>({elapsedMs:index,...row})),snapshot=s=>({title:'Original',stage:'Original',clock:String(s.positionMs),mode:s.mode,captured:s.captured,cue:s.cue,soundMuted:true,pressed:0});
 return{navigationSetup:{kind:'native-listen-navigation',previewId:'first-steps',title:'Original',controls:['sound-button','start-listen','back-to-library'],listenAction:1,navigationAction:2},navigationAdmission:{version:1,stage:'complete',omitted:0,rowBytes:1000,trustedPlayClicks:0,trustedKeyDowns:0,trustedKeyUps:0,rows,current:paused},navigationBefore:snapshot(running),navigationAfter:snapshot(paused),trusted:[{sequence:1,id:'start-listen',type:'click',trusted:true},{sequence:2,id:'back-to-library',type:'click',trusted:true}],pickerObservations:[{sequence:5}],baselineScope:{humanActionStart:20}};
}
test('navigation proof requires ordered trusted start, running clock and real paused navigation before picker or take',()=>{
 const report=navigationEvidence();validateAuthoringNavigation(report);
 for(const edit of [r=>r.navigationSetup.previewId='native:converted',r=>r.navigationSetup.navigationAction=1,r=>r.trusted[0].trusted=false,r=>r.trusted[1].sequence=1,r=>r.pickerObservations[0].sequence=1,r=>r.baselineScope.humanActionStart=1,r=>r.navigationAdmission.trustedPlayClicks=1,r=>r.navigationAdmission.omitted=1,r=>r.navigationAdmission.rows[1].event.trusted=false,r=>r.navigationAdmission.rows[3].event.control='play-button',r=>r.navigationAdmission.rows[2].state.positionMs=0,r=>r.navigationAdmission.rows[2].state.cue='paused',r=>r.navigationAdmission.rows[2].state.hidden=true,r=>r.navigationAdmission.rows[2].state.mode='practice',r=>r.navigationAdmission.rows[2].state.openDialogs=['settings'],r=>r.navigationAdmission.rows.reverse(),r=>r.navigationAdmission.rows[4].state.screen='stage',r=>r.navigationAfter.pressed=1,r=>r.navigationAfter.clock='101',r=>r.navigationAfter.captured='1']){const bad=structuredClone(report);edit(bad);assert.throws(()=>validateAuthoringNavigation(bad));}
});
test('Songs must receive its trusted click while running, even if a prior blur already paused the session',()=>{
 for(const blur of [false,true]){const report=navigationEvidence(),paused={...report.navigationAdmission.rows[3].state,cue:'paused'};report.navigationAdmission.rows[3].state=paused;
  if(blur)report.navigationAdmission.rows.splice(3,0,{elapsedMs:2.5,kind:'after-blur',state:paused});
  assert.throws(()=>validateAuthoringNavigation(report),/Songs must receive its click while the original transport is still running/);
 }
});
function picker(sequence,file){const chosen=fixtures.filter(f=>file===AUTHORING_PAIR_ALIAS?f.id!=='blocked':f.id==='blocked');return{sequence,file,completed:true,started_wall_ms:0,finished_wall_ms:0,blurs:[],delegated:[{id:'authoring-files',type:'click',trusted:false}],changes:[{trusted:true,count:chosen.length,input:{id:'authoring-files',type:'file',multiple:true,disabled:false,connected:true}}],files:chosen.map(f=>({filename:f.filename,bytes:f.bytes.length,sha256:f.manifest.sha256}))};}
test('actual picker inventory requires the exact pair, blocked file, count, bytes and trusted change',()=>{
 const report={phase:'authoring-seed',pickerObservations:[picker(1,AUTHORING_PAIR_ALIAS),picker(2,AUTHORING_FIXTURE_FILENAMES.blocked),picker(3,AUTHORING_PAIR_ALIAS)]};validateAuthoringPicker(report);validateAuthoringPicker({phase:'authoring-restart',pickerObservations:[]});
 for(const edit of [r=>r.pickerObservations.pop(),r=>r.pickerObservations[0].files.pop(),r=>r.pickerObservations[0].files.reverse(),r=>r.pickerObservations[0].files[0].sha256='0'.repeat(64),r=>r.pickerObservations[0].files[0].bytes++,r=>r.pickerObservations[0].changes[0].count=1,r=>r.pickerObservations[0].changes[0].trusted=false,r=>r.pickerObservations[0].changes[0].input.id='score-file',r=>r.pickerObservations[0].delegated.push({id:'authoring-files',type:'click',trusted:false}),r=>r.pickerObservations[0].file='../other.mid',r=>r.pickerObservations[0].completed=false]){const bad=structuredClone(report);edit(bad);assert.throws(()=>validateAuthoringPicker(bad));}
});
test('authoring picker uses host-native paths and rejects arbitrary or expanded aliases with either separator',()=>{
 const directory=path.resolve('fixtures');
 // FileChooser consumes filesystem paths on the host running the acceptance check.
 assert.deepEqual(authoringPickerFiles(AUTHORING_PAIR_ALIAS,directory),[path.join(directory,'authoring-original-strict.mid'),path.join(directory,'authoring-original-events.mid')]);assert.deepEqual(authoringPickerFiles(AUTHORING_FIXTURE_FILENAMES.blocked,directory),[path.join(directory,'authoring-original-blocked.mid')]);
 for(const alias of ['*','authoring-original-multiple','authoring-original-strict.mid','../authoring-original-blocked.mid','..\\authoring-original-blocked.mid','./authoring-original-blocked.mid','.\\authoring-original-blocked.mid','/private/music.mid','C:\\private\\music.mid','\\\\server\\share\\music.mid','a.mid" "b.mid',null])assert.throws(()=>authoringPickerFiles(alias,directory));
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
test('authoring reads both fresh host profiles before sources and rejects missing, reused or mismatched host records',async t=>{
 // This deliberately incomplete synthetic bundle exercises the real reader's
 // profile admission boundary; it cannot yield a native acceptance proof.
 const directory=await mkdtemp(path.join(tmpdir(),'authoring-profile-contract-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const save=async(name,value)=>writeFile(path.join(directory,name),JSON.stringify(value)),native={version:1,ok:true,scenario:'authoring',profile_reused:false,os:'Windows',source_sha:'a'.repeat(40),source_tree:'b'.repeat(40),executable_sha256:'c'.repeat(64),executable_bytes:1,directory:path.join(directory,'Scores'),phases:AUTHORING_PHASES.map((phase,index)=>({phase,process_id:100+index,profile_fresh:true,profile_reused:false}))};
 await addNativeProfileEvidence(native,save);await save('native-song-authoring.json',native);await mkdir(path.join(directory,'fixtures'));
 const reachedSources=()=>assert.rejects(verifyNativeSongAuthoringEvidence(directory),error=>error.code==='ENOENT'&&error.path===path.join(directory,'fixtures','authoring-fixtures.json'));
 await reachedSources();
 for(const change of [v=>delete v.phases[0].profile_directory,v=>v.phases[1].profile_directory=v.phases[0].profile_directory,v=>v.phases[1].process_id=v.phases[0].process_id,v=>v.phases[1].profile_reused=true,v=>v.phases[1].profile_fresh=false,v=>v.phases[1].profile_absent_before_launch=false,v=>delete v.phases[1].profile_absent_before_launch]){
  const bad=structuredClone(native);change(bad);await save('native-song-authoring.json',bad);await assert.rejects(verifyNativeSongAuthoringEvidence(directory),/Native .*profile/);await save('native-song-authoring.json',native);
 }
 for(const phase of AUTHORING_PHASES){
  const name=`profile-${phase}.json`,filename=path.join(directory,name),original=JSON.parse(await readFile(filename));await rm(filename);
  await assert.rejects(verifyNativeSongAuthoringEvidence(directory),error=>error.code==='ENOENT'&&error.path===filename);await save(name,original);
  for(const change of [v=>v.phase='other-phase',v=>v.process_id++,v=>v.profile_directory=native.phases.find(row=>row.phase!==phase).profile_directory,v=>v.library_directory+='-other',v=>v.created_new=false,v=>v.fresh_required=false,v=>delete v.created_new]){
   const bad=structuredClone(original);change(bad);await save(name,bad);await assert.rejects(verifyNativeSongAuthoringEvidence(directory),/Native .*profile/);await save(name,original);
  }
  await writeFile(filename,' '.repeat(16*1024+1));await assert.rejects(verifyNativeSongAuthoringEvidence(directory),/bounded ordinary file/);await save(name,original);
  if(process.platform!=='win32'){await rm(filename);await symlink(path.join(directory,`profile-${AUTHORING_PHASES.find(other=>other!==phase)}.json`),filename);await assert.rejects(verifyNativeSongAuthoringEvidence(directory),/bounded ordinary file/);await rm(filename);await save(name,original);}
 }
 await reachedSources();
});
test('independent manifest binds both fresh authoring profiles and rejects wrong source, EXE, hashes, claims and numeric booleans',()=>{
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
 native={**base,'directory':str(directory/'Scores'),'phases':[{'phase':phase,'process_id':100+index,'profile_directory':str(directory/'webview-profiles'/phase),'profile_fresh':True,'profile_reused':False,'profile_absent_before_launch':True} for index,phase in enumerate(module.SONG_AUTHORING_PHASES)]}
 native_path=directory/'native-song-authoring.json';native_path.write_text(json.dumps(native))
 for phase in module.SONG_AUTHORING_PHASES:(directory/f'renderer-{phase}.json').write_text(json.dumps({'version':1,'phase':phase,'fixture_only':True}))
 for row in native['phases']:(directory/f'profile-{row["phase"]}.json').write_text(json.dumps({'version':1,'phase':row['phase'],'process_id':row['process_id'],'profile_directory':row['profile_directory'],'library_directory':native['directory'],'fresh_required':True,'created_new':True}))
 assert module.SONG_AUTHORING_REPORTS==['native-song-authoring.json','renderer-authoring-seed.json','renderer-authoring-restart.json','profile-authoring-seed.json','profile-authoring-restart.json']
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
  assert result['native_song_authoring_reports_sha256']=={name:module.sha((directory/name).read_bytes()) for name in module.SONG_AUTHORING_REPORTS}
  assert invoked.call_count==1 and invoked.call_args.args[0][-2]=='--check'
  for name,value in [('source_sha','c'*40),('source_tree','c'*40),('executable_sha256','c'*64),('executable_bytes',1),('version',True),('ok',1)]:
   bad=copy.deepcopy(proof);bad[name]=value;rejects(bad)
  for name in module.SONG_AUTHORING_CLAIMS:
   bad=copy.deepcopy(proof);bad['claims'][name]=int(bad['claims'][name]);rejects(bad)
   bad=copy.deepcopy(proof);del bad['claims'][name];rejects(bad)
  bad=copy.deepcopy(proof);bad['claims']['extra_acceptance']=True;rejects(bad)
  for name in module.SONG_AUTHORING_REPORTS:
   bad=copy.deepcopy(proof);next(row for row in bad['files'] if row['path']==name)['sha256']='d'*64;rejects(bad)
   bad=copy.deepcopy(proof);next(row for row in bad['files'] if row['path']==name)['bytes']+=1;rejects(bad)
   bad=copy.deepcopy(proof);bad['files']=[row for row in bad['files'] if row['path']!=name];rejects(bad)
   bad=copy.deepcopy(proof);bad['files'].append(copy.deepcopy(next(row for row in bad['files'] if row['path']==name)));rejects(bad)
  def bind_current_reports():
   value=copy.deepcopy(proof)
   for row in value['files']:
    data=(directory/row['path']).read_bytes();row['bytes']=len(data);row['sha256']=module.sha(data)
   return value
  for key,value in [('profile_directory',native['phases'][0]['profile_directory']),('process_id',100),('profile_fresh',False),('profile_reused',True),('profile_absent_before_launch',False),('profile_absent_before_launch',1)]:
   bad=copy.deepcopy(native);bad['phases'][1][key]=value;native_path.write_text(json.dumps(bad));rejects(bind_current_reports());native_path.write_text(json.dumps(native))
  for phase in module.SONG_AUTHORING_PHASES:
   host_path=directory/f'profile-{phase}.json';original=host_path.read_bytes();host=json.loads(original)
   host_path.unlink();rejects(proof);host_path.write_bytes(original)
   for key,value in [('version',True),('phase','other-phase'),('process_id',999),('process_id',True),('profile_directory','C:/other-root/webview-profiles/'+phase),('library_directory','C:/other-root/Scores'),('fresh_required',False),('created_new',False),('created_new',1)]:
    bad=copy.deepcopy(host);bad[key]=value;host_path.write_text(json.dumps(bad));rejects(bind_current_reports());host_path.write_bytes(original)
   for key in ['fresh_required','created_new','profile_directory','library_directory']:
    bad=copy.deepcopy(host);del bad[key];host_path.write_text(json.dumps(bad));rejects(bind_current_reports());host_path.write_bytes(original)
   host_path.write_bytes(b' '*(16*1024+1));rejects(bind_current_reports());host_path.write_bytes(original)
   target=directory/f'profile-{next(other for other in module.SONG_AUTHORING_PHASES if other!=phase)}.json'
   try:
    host_path.unlink();host_path.symlink_to(target)
   except OSError:pass
   else:rejects(bind_current_reports())
   finally:
    if host_path.is_symlink():host_path.unlink()
    host_path.write_bytes(original)
  save(proof)
  with patch.object(module.subprocess,'run',return_value=types.SimpleNamespace(returncode=1,stderr='fixture verifier rejected')):
   rejects(proof)
print('source, executable, strict claims and independent verifier boundary passed')
`;
 const result=spawnSync('python',['-c',source],{cwd:new URL('../',import.meta.url),encoding:'utf8'});assert.equal(result.status,0,result.stderr||result.stdout);assert.match(result.stdout,/strict claims/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {createPlaybackClock,publishPlaybackClock} from '../web/playback-clock-view.js';
import {CATALOG_SOURCE_FILES} from '../scripts/verify-library-catalog-acceptance.mjs';
import {CANONICAL_PRACTICE_SOURCE_FILES} from '../scripts/canonical-practice-source-evidence.mjs';

const read=path=>readFileSync(new URL(`../${path}`,import.meta.url),'utf8');
const source=read('crates/desktop-shell/canonical-practice-acceptance.js'),host=read('scripts/windows-desktop-acceptance.ps1');
const make=runInNewContext(source.split('(() => {')[0]+';createCanonicalActionTiming;');
const fit=runInNewContext(source.split('(() => {')[0]+';fitCanonicalActionTiming;',{TextEncoder});
function fixture(){
 let mono=100,utc=1000,reads=0,raw=JSON.stringify(createPlaybackClock({positionMs:-1000,durationMs:4000,running:true}));
 const progress={getAttribute(name){assert.equal(name,'data-playback-clock');reads++;return raw;},setAttribute(name,value){assert.equal(name,'data-playback-clock');raw=value;}};
 const timing=make({document:{getElementById(id){assert.equal(id,'progress');return progress;}},phase:'canonical-practice-seed',performance:{timeOrigin:900,now:()=>mono},utcNow:()=>utc});
 return{timing,progress,get reads(){return reads;},time(m,u){mono=m;utc=u;},raw(value){raw=value;}};
}

test('timing retains genuine published count-in and late receipt samples without updating the transport',()=>{
 const f=fixture(),t=f.timing.begin(18,'click');t.mark('action-post-start');t.mark('action-post-completed');
 assert.equal(f.reads,2);assert.equal(f.timing.report.actions[0].checkpoints[0].published_clock.transportPositionMs,-1000);
 for(let i=0;i<60;i++)t.pending();assert.equal(f.reads,2,'Pending polls add no source-clock reads');
 f.time(3700,800);publishPlaybackClock(f.progress,{positionMs:3601.11,durationMs:4000,running:true});t.mark('result-headers');f.time(3710,810);t.mark('result-body');
 const row=f.timing.report.actions[0];assert.equal(row.sequence,18);assert.equal(row.pending_polls,60);assert.equal(row.checkpoints.length,4);
 assert.equal(row.checkpoints[2].published_clock.positionMs,3601.11);assert.equal(row.checkpoints[2].utc_ms,800,'UTC may move backwards independently');
 assert.equal(row.checkpoints[3].monotonic_ms-row.checkpoints[2].monotonic_ms,10);assert.equal(f.timing.report.diagnostic_only,true);assert.equal(f.timing.report.record_errors,0);
});

test('missing, malformed and incomplete diagnostic observations cannot fabricate completion',()=>{
 const f=fixture(),t=f.timing.begin(18,'click');t.mark('action-post-start');
 f.raw('{bad');t.mark('result-headers');const row=f.timing.report.actions[0];assert.equal(row.checkpoints[1].published_clock,null);
 assert.equal(row.checkpoints.some(x=>x.stage==='result-body'),false);t.mark('result-headers');t.mark('unknown');assert.equal(row.checkpoints.length,2);assert.equal(f.timing.report.record_errors,2);
 f.time(NaN,1);assert.doesNotThrow(()=>t.mark('result-body'));assert.equal(row.checkpoints.length,2);assert.equal(f.timing.report.record_errors,3);
 assert.doesNotMatch(source.slice(source.indexOf('function createCanonicalActionTiming'),source.indexOf('(() => {')),/await|setTimeout|setInterval|requestAnimationFrame|fetch\(|\.click\(|\.focus\(|__wmhReadPlaybackClock|publishPlaybackClock/);
});

test('diagnostic memory/report growth is bounded within existing action limits',()=>{
 const f=fixture();for(let i=1;i<=100;i++){const t=f.timing.begin(i,'click');for(const stage of ['action-post-start','action-post-completed','result-headers','result-body'])t.mark(stage);}
 assert.equal(f.timing.report.actions.length,80);assert.equal(f.timing.report.omitted_actions,20);assert.ok(Buffer.byteLength(JSON.stringify(f.timing.report))<128*1024);
 const t=f.timing.begin(0,'click');t.mark('result-body');assert.equal(f.timing.report.actions.length,80);
});

test('host checkpoints leave input, capture, temporary publication and original waits in order',()=>{
 const between=(start,end)=>host.slice(host.indexOf(start),host.indexOf(end,host.indexOf(start)));
 const save=between('function Save-Json(','function Capture-Handle(');
 for(const [before,after] of [["'result-write-start'",'$Value | ConvertTo-Json -Depth 16 | Set-Content -Encoding utf8 $temporary'],['Set-Content',"'result-temporary-written'"],["'result-rename-start'",'Move-Item -Force $temporary $Path'],['Move-Item',"'result-published'"]])assert.ok(save.indexOf(before)<save.indexOf(after));
 const capture=between('function Capture-Handle(','# This closed action');
 for(const [before,after] of [["'print-start'",'::PrintWindow('],['::PrintWindow(',"'print-completed'"],["'png-start'",'$bitmap.Save('],['$bitmap.Save(',"'png-completed'"]])assert.ok(capture.indexOf(before)<capture.indexOf(after));
 assert.match(host,/ClickPositioned\(\)\s*\$clientSubmittedClock=\[Diagnostics.Stopwatch\]::StartNew\(\)\s*Record-NativeActionTiming/,'Existing picker timing anchor remains immediately after input');
 assert.match(host,/Native-Action \$app \$action \$result;Record-NativeActionTiming \$actionTiming 'input-completed';if\(\$action.kind/);
 assert.match(host,/Save-Json \$result \(Join-Path \$OutputDirectory "result-\$phase-\$sequence.json"\) -ObserveResultPublication/);
 assert.match(host,/Start-Sleep -Milliseconds 100/);assert.match(source,/positionMs>=1370,'C5 source onset'\);assert\(clock\(\).positionMs<1630,'Missed C5 dispatch window'/);
 assert.equal((host.match(/Save-NativeActionTiming \$actionTiming \$OutputDirectory/g)||[]).length,1);assert.ok(host.lastIndexOf('Stop-Process -Id $app.Id')<host.indexOf('Save-NativeActionTiming $actionTiming $OutputDirectory'));
});

test('diagnostics are source-bound but do not enter acceptance decisions or action/result schema',()=>{
 const timing=read('scripts/windows-action-timing.ps1'),hot=timing.slice(0,timing.indexOf('function Save-NativeActionTiming('));
 assert.doesNotMatch(hot,/Set-Content|WriteAllText|Move-Item|ConvertTo-Json|Start-Sleep|Start-Job|Get-Native|NativeAcceptance|Timer/);
 assert.match(timing,/max_events=4096/);assert.match(timing,/flushed\)\{return\}/);assert.match(timing,/diagnostic_only=\$true/);
 for(const files of [CANONICAL_PRACTICE_SOURCE_FILES,CATALOG_SOURCE_FILES])assert.ok(files.includes('scripts/windows-action-timing.ps1'));
 for(const path of ['scripts/verify-canonical-practice-evidence.mjs','scripts/native-canonical-practice-evidence.py','crates/desktop-shell/src/acceptance.rs'])assert.doesNotMatch(read(path),/actionTiming|timing-canonical-practice/);
 assert.match(read('tests/windows-desktop-contract.ps1'),/windows-action-timing-contract.ps1/);
 assert.match(read('.github/workflows/windows-desktop-acceptance.yml'),/desktop-canonical-practice\/\*\.json/,'Existing diagnostic uploads retain the new sidecar');
});

test('actual renderer dispatch keeps its pending/result await order and original error decision',async()=>{
 for(const rejectBody of [false,true]){
  const f=fixture(),order=[],results=[{status:404},{status:200,json:async()=>{order.push('body');if(rejectBody)throw Error('Original body read failed');return{ok:true};}}];
  const node={id:'stage-title',disabled:false,contains:()=>false,getBoundingClientRect:()=>({x:20,y:20,width:100,height:30})};
  const document={hasFocus:()=>true,activeElement:node,elementFromPoint:()=>node};
  const start=source.indexOf(' async function native('),end=source.indexOf(' const mod=',start);
  const native=runInNewContext(`let sequence=17;${source.slice(start,end)};native;`,{
   assert:(value,message)=>assert.ok(value,message),document,fields:{},phase:'canonical-practice-seed',innerWidth:1280,innerHeight:720,actionTiming:f.timing,
   json:async(path,action)=>{order.push('post');assert.equal(action.sequence,18);assert.equal(action.kind,'key-c5');assert.deepEqual(Object.keys(action).sort(),['height','kind','sequence','version','width','x','y']);},
   fetcher:async()=>{order.push('headers');return results.shift();},until:async(condition,label,timeout)=>{assert.equal(label,'owned key-c5');assert.equal(timeout,15000);while(!await condition()){}},
  });
  if(rejectBody)await assert.rejects(native('key-c5',node),/Original body read failed/);else assert.equal(await native('key-c5',node),18);
  assert.deepEqual(order,['post','headers','headers','body']);const row=f.timing.report.actions[0];assert.equal(row.pending_polls,1);
  assert.deepEqual(Array.from(row.checkpoints,p=>p.stage),['action-post-start','action-post-completed','result-headers',...(rejectBody?[]:['result-body'])]);
 }
});

const size=value=>Buffer.byteLength(JSON.stringify(value));
function fullTiming(){
 const f=fixture();f.time(-1.7976931348623157e308,-1.7976931348623157e308);
 f.raw(JSON.stringify({version:1,positionMs:-1.7976931348623157e308,transportPositionMs:-1.7976931348623157e308,durationMs:-1.7976931348623157e308,phase:'unavailable'}));
 for(let i=1;i<=80;i++){const t=f.timing.begin(i,'\0'.repeat(32));for(const stage of ['action-post-start','action-post-completed','result-headers','result-body'])t.mark(stage);}
 f.timing.report.timeOrigin=-1.7976931348623157e308;f.timing.report.record_errors=Number.MAX_SAFE_INTEGER;f.timing.report.omitted_actions=Number.MAX_SAFE_INTEGER-80;
 for(const row of f.timing.report.actions)row.pending_polls=65535;
 return JSON.parse(JSON.stringify(f.timing.report));
}
function sizedMandatory(bytes,{failed=false}={}){
 const value={version:1,ok:!failed,phase:'canonical-practice-seed',...(failed?{error:'Original acceptance failure',failureScene:{captured:'0'}}:{}),original:'🎵',padding:''};
 value.padding='x'.repeat(bytes-size(value));assert.equal(size(value),bytes);return value;
}
test('bounded worst-shape diagnostics preserve the original cap through optional-only trimming',()=>{
 const timing=fullTiming();assert.ok(size(timing)<128*1024);
 for(const failed of [false,true])for(const bytes of [531247,970000,999900,999990,999999,1000000,1000010]){
  const mandatory=sizedMandatory(bytes,{failed}),original=JSON.stringify(mandatory),report={...mandatory,actionTiming:structuredClone(timing)};
  fit(report);const after={...report};delete after.actionTiming;assert.equal(JSON.stringify(after),original,'Every mandatory evidence byte must remain unchanged');
  assert.equal(size(report)<1000000,bytes<1000000,'Optional timing cannot change original envelope admission');
  if(bytes===531247){assert.equal(report.actionTiming.actions.length,80);assert.equal(report.actionTiming.truncated,undefined);}
  else if(report.actionTiming){assert.equal(report.actionTiming.truncated,true);if(report.actionTiming.actions?.length)assert.equal(report.actionTiming.actions[0].sequence,1);}
  else assert.equal(Object.hasOwn(report,'actionTiming'),false);
  const once=JSON.stringify(report);fit(report);assert.equal(JSON.stringify(report),once,'Success and publication guards are idempotent');
 }
});
test('malformed optional timing cannot obscure mandatory errors or manufacture receipt completion',()=>{
 const mandatory=sizedMandatory(999999,{failed:true}),report={...mandatory,actionTiming:{diagnostic_only:true,actions:[]}};report.actionTiming.self=report.actionTiming;
 assert.doesNotThrow(()=>fit(report));assert.deepEqual(report,mandatory);assert.equal(report.ok,false);assert.equal(report.error,'Original acceptance failure');
 for(const actionTiming of [null,false,0,'']){const malformed={...mandatory,actionTiming};assert.doesNotThrow(()=>fit(malformed));assert.deepEqual(malformed,mandatory);}
 const success=source.indexOf("fitCanonicalActionTiming(report);assert(new TextEncoder().encode(JSON.stringify(report)).length<1000000");
 const failure=source.indexOf('}catch(error){report.error=String(error.stack||error);report.actions=sequence;');
 const publish=source.indexOf("fitCanonicalActionTiming(report);await json('/__desktop_smoke/report',report);");
 assert.ok(success>0&&failure>success&&publish>failure,'Both success admission and unconditional success/failure publication guard optional diagnostics');
});

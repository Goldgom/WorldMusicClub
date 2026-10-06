import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const source=readFileSync(new URL('../crates/desktop-shell/picker-observation.js',import.meta.url),'utf8');
const create=runInNewContext(`${source}\ncreateNativePickerObservation;`);
function fixture({id='free-import-file',fetcher}={}) {
 const listeners=new Map(),calls=[];
 const node={id,tagName:'INPUT',isConnected:true,disabled:false,getBoundingClientRect:()=>({x:300,y:350,width:106.25,height:49.5625}),contains:other=>other?.parent===node};
 let hit=node;
 const document={defaultView:{innerWidth:1024,innerHeight:689},elementFromPoint:()=>hit,addEventListener(type,listener,options){assert.equal(options.capture,true);assert.equal(options.passive,true);listeners.set(type,listener);},removeEventListener(type,listener,capture){assert.equal(capture,true);assert.equal(listeners.get(type),listener);listeners.delete(type);}};
 const observer=create({document,fetcher:fetcher||((path,options)=>{calls.push({path,receipt:JSON.parse(options.body)});return new Promise(()=>{});}),sequence:35,node,now:()=>1234,utcNow:()=>1791324000000});
 return{node,listeners,calls,observer,setHit:value=>{hit=value},emit(type,target=node,trusted=true){return listeners.get(type)?.({type,target,isTrusted:trusted,clientX:353.125,clientY:374.78125,preventDefault(){throw Error('must not prevent input')},stopPropagation(){throw Error('must not stop input')}});}};
}
test('passive picker receipt captures original target geometry/trust without awaiting delivery',()=>{
 const f=fixture();
 for(const type of ['pointerdown','pointerup','click'])assert.equal(f.emit(type),undefined);
 assert.deepEqual(f.calls.map(row=>row.receipt.event),['pointerdown','pointerup','click']);
 assert.ok(f.calls.every(row=>row.path==='/__desktop_smoke/picker-observation'));
 assert.deepEqual(f.calls[2].receipt,{version:1,sequence:35,event:'click',expected_id:'free-import-file',trusted:true,target_id:'free-import-file',target_tag:'INPUT',expected_connected:true,expected_disabled:false,expected_hit:true,target_matches:true,x:353.125,y:374.78125,bounds:[300,350,106.25,49.5625],viewport:[1024,689],renderer_time_ms:1234,utc_ms:1791324000000});
 f.observer.stop();f.observer.stop();assert.equal(f.listeners.size,0);
});
test('wrong target, untrusted delegation, detached/disabled expected input remain observations',()=>{
 const f=fixture({id:'import-button'}),other={id:'score-file',tagName:'INPUT'};
 f.setHit(other);f.node.isConnected=false;f.node.disabled=true;
 assert.equal(f.emit('click',other,false),undefined);
 assert.deepEqual(Object.fromEntries(['trusted','expected_connected','expected_disabled','expected_hit','target_matches'].map(key=>[key,f.calls[0].receipt[key]])),{trusted:false,expected_connected:false,expected_disabled:true,expected_hit:false,target_matches:false});
 assert.equal(f.calls[0].receipt.target_id,'score-file');
 f.observer.stop();
});
test('native picker receipt never captures text, arbitrary IDs, filenames, or excess events',()=>{
 const f=fixture(),other={id:'Private Song Name 日本語',tagName:'PRIVATE-TAG',textContent:'private text',value:'C:\\private\\song.json'};
 for(let i=0;i<10;i++)f.emit('click',other);
 assert.equal(f.calls.length,6);assert.equal(f.calls[0].receipt.target_id,null);assert.equal(f.calls[0].receipt.target_tag,null);
 assert.doesNotMatch(JSON.stringify(f.calls),/private|日本語/);
 f.observer.stop();
 assert.equal(fixture({id:'arbitrary-input'}).listeners.size,0);
});
test('observation exceptions and rejected delivery cannot interrupt original input dispatch',async()=>{
 const thrown=fixture({fetcher:()=>{throw Error('offline')}});assert.doesNotThrow(()=>thrown.emit('click'));thrown.observer.stop();
 const rejected=fixture({fetcher:()=>Promise.reject(Error('late native modal'))});assert.doesNotThrow(()=>rejected.emit('click'));rejected.observer.stop();await Promise.resolve();
 const geometry=fixture();geometry.node.getBoundingClientRect=()=>{throw Error('node unavailable')};assert.doesNotThrow(()=>geometry.emit('click'));assert.equal(geometry.calls.length,0);geometry.observer.stop();
});
test('original 564 failures remain distinct and native observation cannot grant success or extend waits',()=>{
 const original=JSON.parse(readFileSync(new URL('./fixtures/native-picker/original564.json',import.meta.url)));
 assert.equal(original.seed.action.sequence,35);assert.equal(original.seed.result.ok,false);assert.equal(original.seed.result.owned_dialog,undefined);
 const bulk=original.bulk.result;assert.equal(original.bulk.action.sequence,17);assert.equal(bulk.ok,false);assert.equal(bulk.picker_completion.elapsed_ms,5033);assert.equal(bulk.owned_dialog.hwnd,bulk.picker_completion.foreground_hwnd);assert.equal(bulk.picker_completion.dialog_visible,true);assert.equal(bulk.picker_completion.app_enabled,false);
 const native=readFileSync(new URL('../scripts/windows-desktop-acceptance.ps1',import.meta.url),'utf8');
 assert.match(native,/PickerPollDecision\(\$elapsed,10000,\$ready\)/);
 assert.match(native,/PickerPollDecision\(\$elapsed,5000,\$dismissed\)/);
 assert.match(native,/Record-PickerObservation \$Observation 'failure-capture-before'[\s\S]*Capture-PickerFailure[\s\S]*Record-PickerObservation \$Observation 'failure-capture-after'[\s\S]*throw \$failure/);
 const helper=readFileSync(new URL('../scripts/windows-picker-observation.ps1',import.meta.url),'utf8');
 assert.doesNotMatch(helper,/::(?:SetForegroundWindow|Click|Key|mouse_event|SendText|ReadControlText)\(/);
 assert.doesNotMatch(helper,/\.ok\s*=/);
});

// Execute the production C# decision expressions, whose primitive operators
// are shared with JavaScript, rather than a second implementation of policy.
// Windows contracts also compile/call the full helper, including input guards.
const nativeSource=readFileSync(new URL('../scripts/windows-desktop-native.cs',import.meta.url),'utf8');
function nativeExpression(name,parameters) {
 const start=nativeSource.indexOf(`public static ${name==='PickerPollDecision'?'int':'string'} ${name}(`);
 assert.ok(start>=0);
 const method=nativeSource.slice(start,nativeSource.indexOf('\n  }',start));
 const expression=method.match(/return ([^;]+);/)?.[1];assert.ok(expression);
 return new Function(...parameters,`return ${expression};`);
}
const decide=nativeExpression('PickerPollDecision',['elapsedMilliseconds','budgetMilliseconds','ready']);
const stopReason=nativeExpression('PickerObservationStopReason',['visited','elapsedMilliseconds']);
test('actual native decision rejects late opening and late first dismissal samples',()=>{
 const opening={entered:9950,observedAt:10050,appearedAt:10020,budget:10000};
 assert.equal(decide(opening.entered,opening.budget,false),0);
 assert.equal(decide(opening.observedAt,opening.budget,opening.appearedAt<=opening.observedAt),-1);
 const closing={submitted:0,firstObserved:5100,dismissedAt:5050,budget:5000};
 assert.equal(decide(closing.firstObserved-closing.submitted,closing.budget,closing.dismissedAt<=closing.firstObserved),-1);
 for(const budget of [5000,10000]) {
  assert.equal(decide(budget-1,budget,true),1);
  assert.equal(decide(budget-1,budget,false),0);
  assert.equal(decide(budget,budget,true),-1);
  assert.equal(decide(budget+100,budget,false),-1);
 }
});
test('actual inventory policy truncates total callbacks/time independently of owned output size',()=>{
 assert.equal(stopReason(255,24),null);
 assert.equal(stopReason(256,0),'visit-limit');
 assert.equal(stopReason(1,25),'time-limit');
 assert.equal(stopReason(1,200),'time-limit');
});
test('native polling makes the expiry decision before acceptance and keeps observations outside live pointer checks',()=>{
 const host=readFileSync(new URL('../scripts/windows-desktop-acceptance.ps1',import.meta.url),'utf8');
 const close=host.slice(host.indexOf('function Wait-PickerDismissal('),host.indexOf('function Capture-PickerFailure('));
 const open=host.slice(host.indexOf('  $dialog=[IntPtr]::Zero\n  while($true)'),host.indexOf("  if($dialog -eq [IntPtr]::Zero)"));
 for(const [loop,budget,ready] of [[open,10000,'ready'],[close,5000,'dismissed']]) {
  assert.match(loop,new RegExp(`PickerPollDecision\\(\\$elapsed,${budget},\\$false\\)`));
  const sampledDecision=loop.indexOf(`PickerPollDecision($elapsed,${budget},$${ready})`);
  assert.ok(sampledDecision>0);
  const expiryBranch=loop.indexOf('if($decision -lt 0)',sampledDecision);
  const readyBranch=loop.indexOf('if($decision -eq 1)',sampledDecision);
  assert.ok(expiryBranch>=0&&readyBranch>=0,'Both expiry rejection and ready acceptance must remain explicit');
  assert.ok(expiryBranch<readyBranch,'Reject an expired completed sample before accepting its ready state');
  assert.doesNotMatch(loop,/Record-PickerObservation|Flush-PickerObservation|Save-PickerObservation|ConvertTo-Json/);
 }
 const actual=host.indexOf('if(-not [NativeAcceptance]::SetCursorPos($point.X,$point.Y)');
 const click=host.indexOf('[NativeAcceptance]::ClickPositioned()',actual);
 assert.ok(host.indexOf("Record-PickerObservation $Observation 'client-before-click'")<actual);
 assert.doesNotMatch(host.slice(actual,click),/Record-Picker|Flush-Picker|Save-Picker|ConvertTo-Json|OwnedPickerObservationWindows/);
 const recorder=readFileSync(new URL('../scripts/windows-picker-observation.ps1',import.meta.url),'utf8');
 const poll=recorder.slice(recorder.indexOf('function Record-PickerPoll('),recorder.indexOf('function Flush-PickerObservation('));
 assert.doesNotMatch(poll,/Get-PickerObservationState|Save-PickerObservation|::(?:Get|Set)|ConvertTo-Json/);
 const full=recorder.slice(recorder.indexOf('function Record-PickerObservation('));assert.doesNotMatch(full,/Save-PickerObservation|Move-Item|WriteAllText/);
});

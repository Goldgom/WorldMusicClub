// Pure protocol and original-pixel tests. No desktop or browser is started.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {passivePngPixels,validateNativePassiveCapture} from '../scripts/native-passive-capture-evidence.mjs';
import {syntheticCapturePng,syntheticPassiveCapture} from './passive-capture-fixtures.js';
function fixture(){const picture=syntheticCapturePng(),capture=syntheticPassiveCapture({picture});return{capture,options:{action:{version:1,kind:'capture',sequence:17,x:320,y:180,width:640,height:360,devicePixelRatio:1},host:{process_id:101},native:{source_sha:'1'.repeat(40),source_tree:'2'.repeat(40),executable_sha256:'3'.repeat(64)},phase:'vsq-seed',bytes:picture.bytes}};}
test('passive PNG consumer independently reconstructs all five PNG filters and rejects blank pixels',()=>{
 for(const filter of [0,1,2,3,4]){const {bytes,...expected}=syntheticCapturePng({filter});assert.deepEqual(passivePngPixels(bytes),expected);}
 assert.throws(()=>passivePngPixels(syntheticCapturePng({uniform:true}).bytes));
 for(const alpha of [0,127,254])assert.throws(()=>passivePngPixels(syntheticCapturePng({alpha}).bytes),/opaque/);
 const {bytes,...expected}=syntheticCapturePng({alpha:255});assert.deepEqual(passivePngPixels(bytes),expected);
});
test('passive capture binds exact source, process, PNG bytes, ownership and monotonic timing',()=>{const {capture,options}=fixture();assert.equal(validateNativePassiveCapture(capture,options),capture);});
test('passive capture rejects unowned, occluded, scaled, altered or invalid evidence',()=>{
 const original=fixture();const changes=[
  c=>c.before.hwnd=0,c=>c.before.owner_process_id++,c=>c.before.foreground_hwnd++,c=>c.before.root_hwnd++,c=>c.before.visible=false,c=>c.before.enabled=false,
  c=>c.before.client_rect[0]=1,c=>c.before.client_origin[0]++,c=>c.before.client_screen[2]++,c=>c.before.work_area[2]--,c=>c.before.viewport[0]++,c=>c.before.window_dpi=120,c=>c.before.monitor_scale_percent=125,c=>c.before.monitor_scale_hresult=-1,c=>c.before.caller_awareness=-1,c=>c.before.caller_awareness=0,c=>c.before.system_dpi=144,c=>c.before.device_pixel_ratio=1.25,
  c=>c.before.windows_above.push({hwnd:11,visible:true,rect:[0,31,640,391]}),c=>c.before.windows_above=undefined,
  c=>c.after.client_origin[0]++,c=>c.input.pointer_clicked=true,c=>c.input.focus_changed=true,c=>c.input.keyboard_sent=true,c=>c.input.pointer_moved=true,
  c=>c.phase='vsq-restart',c=>c.sequence++,c=>c.source_sha='4'.repeat(40),c=>c.source_tree='4'.repeat(40),c=>c.executable_sha256='4'.repeat(64),c=>c.file='other.png',c=>c.bytes++,c=>c.sha256='0'.repeat(64),c=>c.width++,c=>c.non_black_pixels--,c=>c.different_pixels--,
  c=>delete c.timings.copy_finished_ms,c=>c.timings.copy_finished_ms=1,c=>c.timings.png_saved_ms=4,c=>c.timings.finished_ms=15001,c=>c.timings.started_ms=1,
 ];
 for(const change of changes){const capture=structuredClone(original.capture);change(capture);assert.throws(()=>validateNativePassiveCapture(capture,original.options));}
 for(const change of [a=>a.kind='click',a=>a.x=a.width,a=>a.y=0,a=>a.devicePixelRatio=2]){const options={...original.options,action:{...original.options.action}};change(options.action);assert.throws(()=>validateNativePassiveCapture(original.capture,options));}
 const capture=structuredClone(original.capture);capture.before.windows_above=[{hwnd:11,visible:false,rect:[0,31,640,391]},{hwnd:12,visible:true,rect:[640,31,650,391]}];capture.after=structuredClone(capture.before);assert.doesNotThrow(()=>validateNativePassiveCapture(capture,original.options));
});
test('DPI-unaware callers are admitted only for a proven unit single monitor at zero origin',()=>{
 const {capture,options}=fixture();capture.before.caller_awareness=0;capture.after=structuredClone(capture.before);assert.doesNotThrow(()=>validateNativePassiveCapture(capture,options));
 for(const change of [t=>t.monitor_count=2,t=>t.monitor_rect=[-640,0,640,391],t=>t.monitor_scale_percent=125,t=>t.device_pixel_ratio=1.25]){const changed=structuredClone(capture);change(changed.before);changed.after=structuredClone(changed.before);assert.throws(()=>validateNativePassiveCapture(changed,options));}
});
test('renderer passive capture never scrolls, focuses, waits for frames or injects a gesture',async()=>{
 const source=await readFile(new URL('../crates/desktop-shell/vsq-song-acceptance.js',import.meta.url),'utf8'),start=source.indexOf('async function native('),end=source.indexOf(' const mod=',start),actions=[];
 let visible=true,focused=true,modal=null;
 const node={id:'notation-lane-overlay',disabled:false,scrollIntoView(){throw Error('scroll');},focus(){throw Error('focus');},contains(){throw Error('hit-test');},getBoundingClientRect:()=>({x:18,y:100,width:600,height:200})};
 const document={hidden:false,hasFocus:()=>focused,querySelector:()=>modal,elementFromPoint:()=>null};
 const native=runInNewContext(`let sequence=0;${source.slice(start,end)}\nnative`,{assert:(v,m)=>assert.ok(v,m),document,devicePixelRatio:1,innerWidth:640,innerHeight:360,observeVsqFollowingSurface:()=>assert.ok(visible),frame:async()=>{throw Error('frame wait');},json:async(path,body)=>actions.push(body),until:async condition=>assert.equal(await condition(),true),fetcher:async()=>({status:200,ok:true,json:async()=>({ok:true})})});
 await native('capture',node);assert.equal(actions.length,1);assert.equal(actions[0].kind,'capture');assert.equal(actions[0].devicePixelRatio,1);
 focused=false;await assert.rejects(native('capture',node));focused=true;modal={};await assert.rejects(native('capture',node));modal=null;visible=false;await assert.rejects(native('capture',node));assert.equal(actions.length,1);
});
test('Windows passive dispatch skips ordinary input and PrintWindow, with separate capture/encode receipts',async()=>{
 const host=await readFile(new URL('../scripts/windows-desktop-acceptance.ps1',import.meta.url),'utf8'),start=host.indexOf('function Capture-PassiveClient('),end=host.indexOf('function Find-Control(',start),passive=host.slice(start,end);
 assert.match(passive,/CopyFromScreen/);assert.match(passive,/FileMode\]::CreateNew/);assert.match(passive,/ValidatePassiveCapturePixels/);assert.match(passive,/copy_started_ms/);assert.match(passive,/copy_finished_ms/);assert.match(passive,/png_saved_ms/);
 assert.doesNotMatch(passive,/PrintWindow|SetForegroundWindow|SetCursorPos|ClickPositioned|Start-Sleep|::Key\(/);
 const dispatch=host.indexOf("if($Action.kind -ceq 'capture')"),ordinary=host.indexOf('[NativeAcceptance]::SetForegroundWindow($window) | Out-Null',dispatch);assert.ok(dispatch>0&&ordinary>dispatch);assert.match(host,/Native-Action \$app \$action \$result;Record-NativeActionTiming \$actionTiming 'input-completed';if\(\$action.kind -cne 'capture'/);
 const renderer=await readFile(new URL('../crates/desktop-shell/vsq-song-acceptance.js',import.meta.url),'utf8');assert.match(renderer,/report\.screenshots\.following=await native\('capture',\$\('notation-lane-overlay'\)\)/);
});

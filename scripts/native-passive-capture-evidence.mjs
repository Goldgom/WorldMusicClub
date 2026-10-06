// Independent consumer of actual foreground-client captures. No capture API here.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {inflateSync} from 'node:zlib';
import {validateCleanScreenshot} from './verify-native-clean-song-evidence.mjs';
const integer=n=>Number.isSafeInteger(n),positive=n=>integer(n)&&n>0;
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const rect=value=>Array.isArray(value)&&value.length===4&&value.every(integer)&&value[2]>value[0]&&value[3]>value[1];
const intersects=(a,b)=>a[0]<b[2]&&a[2]>b[0]&&a[1]<b[3]&&a[3]>b[1];
export function passivePngPixels(bytes){
 const {width,height}=validateCleanScreenshot(bytes),channels=bytes[25]===2?3:4,data=[];
 for(let offset=8;offset<bytes.length;){const size=bytes.readUInt32BE(offset);if(bytes.toString('ascii',offset+4,offset+8)==='IDAT')data.push(bytes.subarray(offset+8,offset+8+size));offset+=size+12;}
 const rowBytes=width*channels,raw=inflateSync(Buffer.concat(data),{maxOutputLength:(rowBytes+1)*height});let prior=new Uint8Array(rowBytes),nonBlack=0,different=0,min=255,max=0,first;
 const paeth=(a,b,c)=>{const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);return pa<=pb&&pa<=pc?a:pb<=pc?b:c;};
 for(let y=0;y<height;y++){
  const offset=y*(rowBytes+1),filter=raw[offset],row=new Uint8Array(rowBytes);
  for(let x=0;x<rowBytes;x++){const left=x>=channels?row[x-channels]:0,above=prior[x],corner=x>=channels?prior[x-channels]:0;row[x]=(raw[offset+1+x]+(filter===0?0:filter===1?left:filter===2?above:filter===3?Math.floor((left+above)/2):paeth(left,above,corner)))&255;}
  for(let x=0;x<rowBytes;x+=channels){if(channels===4)assert.equal(row[x+3],255,'Passive capture pixels must be opaque');const r=row[x],g=row[x+1],b=row[x+2],rgb=r*65536+g*256+b;first??=rgb;if(rgb!==0)nonBlack++;if(rgb!==first)different++;min=Math.min(min,r,g,b);max=Math.max(max,r,g,b);}
  prior=row;
 }
 assert.ok(nonBlack>=64&&different>=64&&max-min>=8,'Passive capture PNG is black or uniform');
 return{width,height,non_black_pixels:nonBlack,different_pixels:different,channel_min:min,channel_max:max};
}
export function validatePassiveCaptureTarget(target,{action,processId}){
 assert.ok(target&&positive(processId)&&target.process_id===processId&&target.owner_process_id===processId,'Passive capture PID ownership changed');
 assert.ok(positive(target.hwnd)&&target.root_hwnd===target.hwnd&&target.foreground_hwnd===target.hwnd&&target.visible===true&&target.enabled===true,'Passive capture foreground ownership unavailable');
 assert.ok(rect(target.client_rect)&&target.client_rect[0]===0&&target.client_rect[1]===0&&rect(target.client_screen)&&rect(target.work_area),'Passive capture geometry invalid');
 assert.equal(target.window_dpi,96);assert.equal(target.monitor_scale_percent,100);assert.equal(target.monitor_scale_hresult,0);assert.equal(target.device_pixel_ratio,1);assert.equal(action.devicePixelRatio,1);assert.ok([0,1,2].includes(target.window_awareness),'Passive capture window awareness missing');assert.ok(positive(target.monitor_count)&&target.monitor_count<=16&&rect(target.monitor_rect),'Passive capture monitor topology missing');const singleUnitOrigin=target.monitor_count===1&&target.monitor_rect[0]===0&&target.monitor_rect[1]===0;assert.ok(positive(target.system_dpi)&&(target.caller_awareness===2||(target.caller_awareness===1&&target.system_dpi===96)||(target.caller_awareness===0&&singleUnitOrigin)),'Passive capture caller coordinates may be DPI virtualized');assert.ok(target.work_area[0]>=target.monitor_rect[0]&&target.work_area[1]>=target.monitor_rect[1]&&target.work_area[2]<=target.monitor_rect[2]&&target.work_area[3]<=target.monitor_rect[3],'Passive capture work area exceeds its monitor');
 const [,,width,height]=target.client_rect;assert.ok(width<=8192&&height<=8192&&width*height<=16777216,'Passive capture dimensions exceed the bound');
 assert.deepEqual(target.viewport,[action.width,action.height]);assert.deepEqual(target.viewport,[width,height],'Passive capture pixels must match the unscaled viewport');
 assert.ok(Array.isArray(target.client_origin)&&target.client_origin.length===2&&target.client_origin.every(integer),'Passive capture origin missing');
 const [x,y]=target.client_origin;assert.deepEqual(target.client_screen,[x,y,x+width,y+height]);
 assert.ok(x>=target.work_area[0]&&y>=target.work_area[1]&&x+width<=target.work_area[2]&&y+height<=target.work_area[3],'Passive capture client extends outside the visible work area');
 assert.ok(Array.isArray(target.windows_above)&&target.windows_above.length<=128,'Passive capture upper-window inventory missing');
 const seen=new Set();for(const window of target.windows_above){assert.ok(positive(window.hwnd)&&window.hwnd!==target.hwnd&&!seen.has(window.hwnd)&&typeof window.visible==='boolean'&&Array.isArray(window.rect)&&window.rect.length===4&&window.rect.every(integer),'Passive capture upper-window identity invalid');seen.add(window.hwnd);if(window.visible&&rect(window.rect))assert.ok(!intersects(target.client_screen,window.rect),'Passive capture client is occluded');}
 return{width,height};
}
export function validateNativePassiveCapture(capture,{action,host,native,phase,bytes}){
 assert.equal(action.kind,'capture');assert.ok(positive(action.sequence)&&action.sequence<=80&&[action.x,action.y,action.width,action.height].every(Number.isFinite)&&action.x>0&&action.y>0&&action.x<action.width&&action.y<action.height,'Passive capture action target invalid');
 assert.ok(['vsq-seed','vsq-restart'].includes(phase));assert.equal(capture?.version,1);assert.equal(capture.kind,'foreground-client-pixels');assert.equal(capture.method,'CopyFromScreen');assert.equal(capture.phase,phase);assert.equal(capture.sequence,action.sequence);
 for(const key of ['source_sha','source_tree','executable_sha256'])assert.equal(capture[key],native[key],`Passive capture ${key} differs`);
 const size=validatePassiveCaptureTarget(capture.before,{action,processId:host.process_id});validatePassiveCaptureTarget(capture.after,{action,processId:host.process_id});assert.deepEqual(capture.after,capture.before,'Passive capture target changed during pixel copy');
 assert.deepEqual(capture.input,{pointer_moved:false,pointer_clicked:false,focus_changed:false,keyboard_sent:false},'Passive capture must not inject input or focus');
 const times=['started_ms','target_checked_ms','copy_started_ms','copy_finished_ms','target_rechecked_ms','pixels_verified_ms','png_saved_ms','finished_ms'];assert.deepEqual(Object.keys(capture.timings??{}).sort(),[...times].sort());let last=0;for(const key of times){const value=capture.timings[key];assert.ok(Number.isFinite(value)&&value>=last&&value<=15000,`Passive capture timing ${key} invalid`);last=value;}assert.equal(capture.timings.started_ms,0);assert.ok(capture.timings.copy_finished_ms>capture.timings.copy_started_ms);assert.ok(capture.timings.png_saved_ms>=capture.timings.pixels_verified_ms);
 assert.equal(capture.file,`native-action-${phase}-${action.sequence}.png`);assert.ok(bytes.length>0&&bytes.length<=16*1024*1024);assert.equal(capture.bytes,bytes.length);assert.equal(capture.sha256,sha(bytes));assert.equal(capture.width,size.width);assert.equal(capture.height,size.height);
 const pixels=passivePngPixels(bytes);for(const [key,value]of Object.entries(pixels))assert.equal(capture[key],value,`Passive capture ${key} differs from actual PNG`);
 return capture;
}

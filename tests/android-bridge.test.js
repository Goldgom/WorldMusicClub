import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

function bridge() {
  const calls = [], downloads = [], listeners = new Map();
  class Anchor { click() {} }
  const window = {fetch:async () => new Response(new Uint8Array([0,255,1])), WorldMusicClubAndroid:{
    request(...args) {calls.push(args);}, saveFile(...args) {downloads.push(args);},
  }};
  const context = {window,location:{origin:'https://wmh.localhost',href:'https://wmh.localhost/'},
    document:{addEventListener:(kind,handler)=>listeners.set(kind,handler)}, HTMLAnchorElement:Anchor,
    Request,Response,URL,Uint8Array,Map,Object,String,TypeError,Error,Promise,btoa,atob,alert:assert.fail};
  vm.runInNewContext(readFileSync(new URL('../android/assets/android-bridge.js', import.meta.url),'utf8'),context);
  return {window,calls,downloads,Anchor};
}
const tick = () => new Promise(resolve => setImmediate(resolve));

test('Android bridge preserves binary requests, native errors and response headers',async()=>{
  const {window,calls}=bridge();
  const pending=window.fetch('/api/import/midi',{method:'POST',headers:{'content-type':'audio/midi'},body:new Uint8Array([0,128,255])});
  await tick();
  assert.deepEqual(calls[0].slice(1),['POST','https://wmh.localhost/api/import/midi',JSON.stringify({'content-type':'audio/midi'}),'AID/']);
  window.__worldMusicClubReply(calls[0][0],{status:422,headers:{'content-type':'application/json'},body:btoa('{"code":"unsupported"}')});
  const response=await pending;
  assert.equal(response.status,422);assert.equal(response.headers.get('content-type'),'application/json');
  assert.deepEqual(await response.json(),{code:'unsupported'});
});
test('Android pack requests retain encoded Unicode filenames, conflict policy and selected item',async()=>{
  const {window,calls}=bridge();
  const headers={'content-type':'application/octet-stream','x-wmh-filename':encodeURIComponent('原创曲包.zip'),'x-wmh-conflict':'keep-both','x-wmh-item-index':'2'};
  const pending=window.fetch(new Request('https://wmh.localhost/api/library/import/preview',{method:'POST',headers,body:new Uint8Array([80,75,3,4])}));
  await tick();
  assert.deepEqual(JSON.parse(calls[0][3]),headers);
  assert.equal(calls[0][4],'UEsDBA==');
  window.__worldMusicClubReply(calls[0][0],{status:200,headers:{},body:''});
  assert.equal((await pending).status,200);
});
test('Android cancellation ignores late replies and foreign requests never reach native host',async()=>{
  const {window,calls}=bridge();const controller=new AbortController();
  const pending=window.fetch('/api/compile',{method:'POST',body:'{}',signal:controller.signal});
  await tick();controller.abort();await assert.rejects(pending,{name:'AbortError'});
  window.__worldMusicClubReply(calls[0][0],{status:200,headers:{},body:''});
  await assert.rejects(window.fetch('https://evil.example/api/health'),/External network/);
  assert.equal(calls.length,1);
});
test('Android detached programmatic export retains exact blob bytes',async()=>{
  const {Anchor,downloads}=bridge();const anchor=new Anchor();
  anchor.hasAttribute=key=>key==='download';anchor.href='blob:https://wmh.localhost/original';anchor.download='source.mid';
  anchor.click();await tick();
  assert.deepEqual(downloads,[['source.mid','application/octet-stream','AP8B']]);
});

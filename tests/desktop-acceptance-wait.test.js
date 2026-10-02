import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';

const source=await readFile(new URL('../crates/desktop-shell/acceptance-wait.js',import.meta.url),'utf8');
const createWait=runInNewContext(`${source}\ncreateAcceptanceWait`,{AbortController,setTimeout,clearTimeout});
const never=()=>new Promise(()=>{});

test('acceptance deadline rejects a pending async condition and aborts its request',async()=>{
  let signal;
  await assert.rejects(createWait().until(value=>{signal=value;return never();},'native picker result 2',10),/Timed out: native picker result 2/);
  assert.equal(signal.aborted,true);
});

test('acceptance timeout remains an error if abort makes the condition finish',async()=>{
  await assert.rejects(createWait().until(signal=>new Promise(resolve=>signal.addEventListener('abort',()=>resolve(true))),'aborted condition',10),/Timed out: aborted condition/);
});

test('late false condition cannot start another poll after timeout',async()=>{
  let finish,calls=0;
  const pending=createWait().until(()=>{calls++;return new Promise(resolve=>{finish=resolve;});},'late condition',10);
  await assert.rejects(pending,/Timed out: late condition/);finish(false);
  await new Promise(resolve=>setImmediate(resolve));assert.equal(calls,1);
});

test('acceptance JSON deadline covers both fetch and a pending response body',async()=>{
  for(const fetch of [never,async()=>({ok:true,json:never})]) {
    await assert.rejects(createWait().json(fetch,'/__desktop_smoke/result/2',undefined,10),/Timed out: response \/__desktop_smoke\/result\/2/);
  }
});

test('completed conditions and JSON clear their deadline without aborting',async()=>{
  const active=new Set();let signal;
  const waits=createWait({setTimer:(callback,ms)=>{const timer=setTimeout(callback,ms);active.add(timer);return timer;},clearTimer:timer=>{active.delete(timer);clearTimeout(timer);}});
  await waits.until(async()=>true,'completed',100);
  const value=await waits.json(async(path,options)=>{signal=options.signal;assert.equal(path,'/result');return{ok:true,json:async()=>({ok:true})};},'/result',undefined,100);
  assert.equal(value.ok,true);assert.equal(signal.aborted,false);assert.equal(active.size,0);
});

test('condition failures and HTTP result errors reach the report unchanged',async()=>{
  await assert.rejects(createWait().until(async()=>{throw Error('condition failed');},'poll',100),/condition failed/);
  await assert.rejects(createWait().json(async()=>({ok:false,status:500,json:async()=>({error:'Invalid action result'})}),'/result',undefined,100),/\/result: Invalid action result/);
});

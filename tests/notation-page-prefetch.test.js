import test from 'node:test';
import assert from 'node:assert/strict';
import {NotationPagePrefetch} from '../web/notation-page-prefetch.js';
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return{promise,resolve};};
test('next-page admission stays bounded and replacement rejects a late source or scope response',async()=>{
 const cache=new NotationPagePrefetch(),first=deferred(),second=deferred();let oldSignal;
 cache.prime('source-A:all:next',{source:'A',scope:'all',from:9},signal=>{oldSignal=signal;return first.promise;});await Promise.resolve();cache.prime('source-B:part:next',{source:'B',scope:'part',from:9},()=>second.promise);assert.equal(oldSignal.aborted,true);first.resolve({wrong:'old-page'});await Promise.resolve();assert.equal(cache.peek().key,'source-B:part:next');second.resolve({pages:['new-page']});assert.deepEqual(await cache.take('source-B:part:next'),{pages:['new-page']});assert.equal(cache.peek(),null);
});
test('a pending next page is adopted once without discarding the caller-owned current page',async()=>{
 const cache=new NotationPagePrefetch(),next=deferred(),current={pages:['current']};let calls=0;cache.prime('same',{from:9},()=>{calls++;return next.promise;});cache.prime('same',{from:9},()=>{throw Error('No duplicate load');});const waiting=cache.take('same');assert.deepEqual(current,{pages:['current']});next.resolve({pages:['next']});assert.deepEqual(await waiting,{pages:['next']});assert.equal(calls,1);assert.equal(await cache.take('same'),null);
});
test('closing notation cancels speculative work and a failed prefetch can be retried by an explicit current-page load',async()=>{
 const cache=new NotationPagePrefetch(),next=deferred();let signal;cache.prime('one',{from:2},value=>{signal=value;return next.promise;});await Promise.resolve();cache.clear();assert.equal(signal.aborted,true);next.resolve({pages:['late']});assert.equal(await cache.take('one'),null);await cache.prime('two',{from:2},async()=>{throw Error('Temporary native failure');});assert.match(cache.peek().error.message,/Temporary/);assert.equal(await cache.take('two'),null);assert.equal(cache.peek(),null);
});

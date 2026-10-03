import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto,createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {waitForTestCondition} from './async-test-wait.js';

test('real delayed WebCrypto completes while the musical clock is frozen',async()=>{
  const descriptor=Object.getOwnPropertyDescriptor(globalThis,'performance');
  Object.defineProperty(globalThis,'performance',{configurable:true,value:{now:()=>1000}});
  const input=new TextEncoder().encode('original async checksum fixture');let actual;
  const producing=(async()=>{await delay(15);actual=Buffer.from(await webcrypto.subtle.digest('SHA-256',input)).toString('hex');})();
  try{await waitForTestCondition(()=>actual,{label:'Real checksum'});await producing;assert.equal(actual,createHash('sha256').update(input).digest('hex'));}
  finally{if(descriptor)Object.defineProperty(globalThis,'performance',descriptor);else delete globalThis.performance;}
});

test('an unmet condition fails on its real finite deadline despite a frozen musical clock',async()=>{
  const descriptor=Object.getOwnPropertyDescriptor(globalThis,'performance');
  Object.defineProperty(globalThis,'performance',{configurable:true,value:{now:()=>0}});
  try{await assert.rejects(waitForTestCondition(()=>false,{label:()=> 'Expected callback missing',timeoutMs:20}),/Expected callback missing within 20 ms/);}
  finally{if(descriptor)Object.defineProperty(globalThis,'performance',descriptor);else delete globalThis.performance;}
});

test('predicate errors propagate once and successful values retain identity',async()=>{
  const failure=new Error('Actual operation failure');let calls=0;
  await assert.rejects(waitForTestCondition(()=>{calls++;throw failure;}),error=>error===failure);assert.equal(calls,1);
  await assert.rejects(waitForTestCondition(async()=>{throw failure;}),error=>error===failure);
  const ready={complete:true};assert.equal(await waitForTestCondition(()=>ready),ready);
  for(const timeoutMs of [0,-1,NaN,Infinity])await assert.rejects(waitForTestCondition(()=>true,{timeoutMs}),/finite positive/);
});

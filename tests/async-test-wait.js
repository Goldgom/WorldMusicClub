import assert from 'node:assert/strict';
import {performance as clock} from 'node:perf_hooks';
import {setTimeout as yieldToAsyncWork} from 'node:timers/promises';
import {setTimeout as deadlineTimer,clearTimeout as clearDeadline} from 'node:timers';

/** Wait for an assertion precondition, never retry the operation producing it.
 * Crypto, IndexedDB and filesystem completions need elapsed time, not a fixed
 * number of empty JS turns. Keep this clock independent of musical test clocks.
 */
export async function waitForTestCondition(predicate,{label='Async test state did not settle',timeoutMs=5000}={}) {
  assert.ok(Number.isFinite(timeoutMs)&&timeoutMs>0,'A finite positive test deadline is required');
  const deadline=clock.now()+timeoutMs;let stopped=false,timer;
  const fail=()=>assert.fail(`${typeof label==='function'?label():label} within ${timeoutMs} ms`);
  async function poll(){
    while(!stopped){
      const value=await predicate();
      if(stopped)return;
      if(value)return value;
      if(clock.now()>=deadline)fail();
      await yieldToAsyncWork(1);
    }
  }
  try{return await Promise.race([poll(),new Promise((_,reject)=>{timer=deadlineTimer(()=>{try{fail();}catch(error){reject(error);}},timeoutMs);})]);}
  finally{stopped=true;clearDeadline(timer);}
}

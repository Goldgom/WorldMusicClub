import assert from 'node:assert/strict';
import {performance as clock} from 'node:perf_hooks';
import {setTimeout as yieldToAsyncWork} from 'node:timers/promises';

/** Wait for an assertion precondition, never retry the operation producing it.
 * Crypto, IndexedDB and filesystem completions need elapsed time, not a fixed
 * number of empty JS turns. Keep this clock independent of musical test clocks.
 */
export async function waitForTestCondition(predicate,{label='Async test state did not settle',timeoutMs=5000}={}) {
  assert.ok(Number.isFinite(timeoutMs)&&timeoutMs>0,'A finite positive test deadline is required');
  const deadline=clock.now()+timeoutMs;
  for(;;){
    const value=await predicate();
    if(value)return value;
    if(clock.now()>=deadline)assert.fail(`${typeof label==='function'?label():label} within ${timeoutMs} ms`);
    await yieldToAsyncWork(1);
  }
}

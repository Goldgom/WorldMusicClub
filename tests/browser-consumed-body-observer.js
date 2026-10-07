import assert from 'node:assert/strict';

// Serialized into the page by Playwright. Observe only the original app's fetch,
// getReader and read results: no second consumer, clone, tee, request or UI state.
// Every wrapper returns the original object/promise/result, including rejections.
export function installConsumedBodyObserver(options) {
  'use strict';
  const {key, expectedUrl, maxBytes = 32 * 1024} = options;
  const root = globalThis;
  if (Object.hasOwn(root, key)) throw new Error('Consumed-body observer already installed');
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 32 * 1024) throw new Error('Invalid observation bound');
  const expected = new URL(expectedUrl);
  const state = {version: 1, key, expectedUrl, maxBytes, active: true, requestCount: 0,
    request: null, response: null, readerCount: 0, readCalls: 0, chunkCount: 0, byteLength: 0, bytes: [],
    complete: false, abortBeforeComplete: false, abortAfterComplete: false, released: false,
    restored: false, restorationFailures: [], failure: null, events: []};
  const patches = [], cleanups = [];
  const fail = message => { state.failure ??= message; };
  const event = (name, detail = {}) => { if (state.events.length < 24) state.events.push({event: name, ...detail}); };
  const errorText = error => String(error?.message ?? error).slice(0, 512);
  const watch = (promise, fulfilled, rejected) => {
    // Side-chain errors never replace or reject the original app promise.
    try {
      promise.then(value => {
        if (state.active) { try { fulfilled(value); } catch (error) { fail(`Observation failed: ${errorText(error)}`); } }
      }, error => {
        if (state.active) { try { rejected(error); } catch (failure) { fail(`Observation failed: ${errorText(failure)}`); } }
      }).catch(error => { if (state.active) fail(`Observation failed: ${errorText(error)}`); });
    } catch (error) { fail(`Cannot observe original promise: ${errorText(error)}`); }
  };
  const patch = (owner, name, make) => {
    const descriptor = Object.getOwnPropertyDescriptor(owner, name), original = owner[name];
    if (typeof original !== 'function') throw new Error(`Missing original ${name}`);
    const wrapper = make(original);
    Object.defineProperty(owner, name, {configurable: true, writable: true, enumerable: descriptor?.enumerable ?? false, value: wrapper});
    patches.push({owner, name, descriptor, wrapper});
  };
  const observeReader = reader => {
    state.readerCount++;
    event('reader');
    if (state.readerCount !== 1) { fail('Multiple readers');return; }
    let pending = 0;
    patch(reader, 'read', original => function (...args) {
      let promise;
      try { promise = Reflect.apply(original, this, args); }
      catch (error) { if (state.active) fail(`Read threw: ${errorText(error)}`);throw error; }
      if (!state.active) return promise;
      if (this !== reader) { fail('Read borrowed by another reader');return promise; }
      state.readCalls++;
      if (state.complete || pending) fail('Read after completion or concurrent read');
      if (state.readCalls > maxBytes + 1) fail('Too many read results');
      pending++;
      watch(promise, next => {
        pending--;
        if (!next || typeof next.done !== 'boolean') { fail('Malformed read result');return; }
        if (state.abortBeforeComplete) { fail('Read settled after incomplete abort');return; }
        if (next.done) {
          if (next.value !== undefined) { fail('Unexpected value on completed read');return; }
          state.complete = true;event('consumed-done', {bytes: state.byteLength});return;
        }
        if (!(next.value instanceof Uint8Array)) { fail('Non-byte read result');return; }
        const length = next.value.byteLength;
        state.byteLength += length;state.chunkCount++;
        if (state.byteLength > maxBytes) { fail('Consumed body exceeds byte bound');return; }
        // Copy immediately: later mutation of a reused read buffer is not evidence.
        if (!state.failure) state.bytes.push(...next.value);
        event('consumed-chunk', {bytes: length});
      }, error => { pending--;fail(`Read rejected: ${errorText(error)}`);event('read-rejected'); });
      return promise;
    });
    patch(reader, 'cancel', original => function (...args) {
      let result;
      try { result = Reflect.apply(original, this, args); }
      catch (error) { if (state.active) fail(`Cancel threw: ${errorText(error)}`);throw error; }
      if (state.active) {
        if (this !== reader) fail('Cancel borrowed by another reader');
        else { event('reader-cancel');if (!state.complete) fail('Reader cancelled before completion'); }
      }
      return result;
    });
    patch(reader, 'releaseLock', original => function (...args) {
      let result;
      try { result = Reflect.apply(original, this, args); }
      catch (error) { if (state.active) fail(`Release threw: ${errorText(error)}`);throw error; }
      if (state.active) {
        if (this !== reader) fail('Release borrowed by another reader');
        else { state.released = true;event('reader-release');if (!state.complete) fail('Reader released before completion'); }
      }
      return result;
    });
  };
  const snapshot = () => ({...state, request: state.request && {...state.request}, response: state.response && {...state.response},
    bytes: [...state.bytes], restorationFailures: [...state.restorationFailures], events: state.events.map(row => ({...row}))});
  const controller = {
    settled: () => (state.complete && state.released) || Boolean(state.failure),
    snapshot,
    restore: () => {
      if (!state.active) return snapshot();
      state.active = false;
      const restoreFailed = message => { state.restorationFailures.push(message);fail(message); };
      if (!state.complete) fail('Observer restored before complete consumption');
      for (const cleanup of cleanups) { try { cleanup(); } catch (error) { restoreFailed(`Cleanup failed: ${errorText(error)}`); } }
      for (const {owner, name, descriptor, wrapper} of patches.reverse()) {
        try {
          if (owner[name] !== wrapper) { restoreFailed(`Original ${name} restoration ownership lost`);continue; }
          if (descriptor) Object.defineProperty(owner, name, descriptor);else delete owner[name];
        } catch (error) { restoreFailed(`Cannot restore ${name}: ${errorText(error)}`); }
      }
      if (root[key] === controller) delete root[key];else restoreFailed('Observer restoration ownership lost');
      state.restored = state.restorationFailures.length === 0;
      return snapshot();
    },
  };
  Object.defineProperty(root, key, {configurable: true, value: controller});
  try {
    patch(root, 'fetch', original => function (...args) {
      let promise;
      try { promise = Reflect.apply(original, this, args); }
      catch (error) { if (state.active) fail(`Fetch threw: ${errorText(error)}`);throw error; }
      if (!state.active) return promise;
      try {
        const [input, init] = args;
        const url = new URL(typeof input === 'string' || input instanceof URL ? String(input) : input.url, root.location?.href ?? expectedUrl);
        if (url.pathname !== expected.pathname) return promise;
        state.requestCount++;event('fetch', {request: state.requestCount});
        if (state.requestCount !== 1) { fail('Multiple matching fetch requests');return promise; }
        state.request = {url: url.href, method: String(init?.method ?? input?.method ?? 'GET').toUpperCase(),
          cache: init?.cache ?? input?.cache ?? 'default', credentials: init?.credentials ?? input?.credentials ?? 'same-origin',
          mode: init?.mode ?? input?.mode ?? 'cors', redirect: init?.redirect ?? input?.redirect ?? 'follow'};
        if (url.href !== expectedUrl || state.request.method !== 'GET') fail('Mismatched fetch request');
        const signal = init?.signal ?? input?.signal;
        if (signal) {
          const onAbort = () => {
            if (!state.active) return;
            if (state.complete) { state.abortAfterComplete = true;event('abort-after-complete'); }
            else { state.abortBeforeComplete = true;fail('Fetch aborted before complete consumption');event('abort-before-complete'); }
          };
          signal.addEventListener('abort', onAbort, {once: true});
          cleanups.push(() => signal.removeEventListener('abort', onAbort));
          if (signal.aborted) onAbort();
        }
        watch(promise, response => {
          state.response = {url: response.url, status: response.status, redirected: response.redirected, type: response.type,
            contentLength: response.headers.get('content-length'), cacheControl: response.headers.get('cache-control'),
            contentType: response.headers.get('content-type'), contentEncoding: response.headers.get('content-encoding')};
          event('fetch-response', {status: response.status});
          if (response.url !== expectedUrl || response.redirected) fail('Mismatched fetch response');
          if (!response.body) { fail('Missing response stream');return; }
          const body = response.body;
          patch(body, 'getReader', original => function (...args) {
            let reader;
            try { reader = Reflect.apply(original, this, args); }
            catch (error) { if (state.active) fail(`getReader threw: ${errorText(error)}`);throw error; }
            if (state.active) {
              if (this !== body) fail('getReader borrowed by another response stream');
              else { try { observeReader(reader); } catch (error) { fail(`Cannot observe reader: ${errorText(error)}`); } }
            }
            return reader;
          });
        }, error => { fail(`Fetch rejected: ${errorText(error)}`);event('fetch-rejected'); });
      } catch (error) { fail(`Cannot observe fetch: ${errorText(error)}`); }
      return promise;
    });
  } catch (error) { controller.restore();throw error; }
  return {key, expectedUrl, maxBytes};
}

// Bind one bounded stream observation to the original Playwright request and
// response. DOM content is deliberately not an input to this evidence check.
export function assertConsumedJsonResponse(response, observation, {key, expectedUrl, requests}) {
  assert.equal(observation.version, 1);
  assert.equal(observation.key, key, 'Stale body observation');
  assert.equal(observation.expectedUrl, expectedUrl);
  assert.equal(observation.failure, null, observation.failure ?? 'Consumption failed');
  assert.equal(observation.active, false);assert.equal(observation.restored, true);assert.deepEqual(observation.restorationFailures, []);
  assert.equal(observation.requestCount, 1);assert.equal(observation.readerCount, 1);
  assert.equal(observation.complete, true);assert.equal(observation.released, true);assert.equal(observation.abortBeforeComplete, false);
  assert.ok(Number.isSafeInteger(observation.maxBytes) && observation.maxBytes > 0 && observation.maxBytes <= 32 * 1024);
  assert.ok(Number.isSafeInteger(observation.byteLength) && observation.byteLength > 0 && observation.byteLength <= observation.maxBytes);
  assert.equal(observation.bytes.length, observation.byteLength);
  assert.ok(observation.bytes.every(byte => Number.isInteger(byte) && byte >= 0 && byte <= 255));
  assert.equal(requests.length, 1, 'Ambiguous network request identity');
  assert.equal(response.request(), requests[0], 'Observed a different Playwright request');
  assert.equal(requests[0].url(), expectedUrl);assert.equal(requests[0].method(), 'GET');
  assert.equal(requests[0].postData(), null);assert.equal(requests[0].redirectedFrom(), null);
  assert.equal(response.url(), expectedUrl);assert.equal(response.status(), 200);
  assert.equal(response.fromServiceWorker(), false);
  assert.deepEqual(observation.request, {url: expectedUrl, method: 'GET', cache: 'no-store', credentials: 'same-origin', mode: 'same-origin', redirect: 'error'});
  const headers = response.headers(), observed = observation.response;
  assert.equal(observed.url, expectedUrl);assert.equal(observed.status, response.status());assert.equal(observed.redirected, false);
  assert.equal(observed.type, 'basic');
  for (const [field, header] of Object.entries({contentLength: 'content-length', cacheControl: 'cache-control', contentType: 'content-type', contentEncoding: 'content-encoding'})) {
    assert.equal(observed[field], headers[header] ?? null, `Mismatched ${header}`);
  }
  assert.equal(observed.cacheControl, 'no-store');assert.match(observed.contentType, /^application\/json(?:;|$)/i);
  assert.ok(observed.contentEncoding === null || observed.contentEncoding === 'identity', 'Encoded length cannot attest consumed bytes');
  assert.match(observed.contentLength, /^\d+$/);
  assert.equal(Number(observed.contentLength), observation.byteLength, 'Declared length differs from consumed bytes');
  const bytes = Uint8Array.from(observation.bytes);
  const body = new TextDecoder('utf-8', {fatal: true}).decode(bytes);
  return {response, body, bytes, json: JSON.parse(body)};
}

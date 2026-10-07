import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {installConsumedBodyObserver, assertConsumedJsonResponse} from './browser-consumed-body-observer.js';
import {readBuildDiagnostics} from '../web/build-diagnostics.js';
import {diagnosticsFixture, deferred} from './build-diagnostics-fixtures.js';

const expectedUrl = 'https://wmh.localhost/api/diagnostics/build', key = '__unitConsumedBody';
const encode = value => new TextEncoder().encode(value);
const options = signal => ({method: 'GET', cache: 'no-store', credentials: 'same-origin', mode: 'same-origin', redirect: 'error', signal});
const plain = value => JSON.parse(JSON.stringify(value));

function fixture({bytes = encode(JSON.stringify(diagnosticsFixture())), results, read, fetch, maxBytes, responseChanges = {}, body} = {}) {
  const calls = {fetch: [], getReader: [], read: [], cancel: [], release: []};
  const values = results ?? [{done: false, value: bytes}, {done: true}];
  const cancelResult = Promise.resolve(), releaseResult = undefined;
  const reader = {
    read(...args) {
      const index = calls.read.length, result = read ? read(index) : Promise.resolve(values[index]);
      calls.read.push({receiver: this, args, result});return result;
    },
    cancel(...args) { calls.cancel.push({receiver: this, args});return cancelResult; },
    releaseLock(...args) { calls.release.push({receiver: this, args});return releaseResult; },
  };
  body ??= {getReader(...args) { calls.getReader.push({receiver: this, args});return reader; }};
  const headers = {'content-length': String(bytes.length), 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store'};
  const response = {url: expectedUrl, status: 200, ok: true, type: 'basic', redirected: false,
    headers: new Headers(headers), body,
    clone() { assert.fail('No cloned response'); }, json() { assert.fail('No replacement JSON reader'); }, text() { assert.fail('No CDP or duplicate body reader'); }, ...responseChanges};
  const fetchPromise = Promise.resolve(response);
  const originalFetch = function (...args) { calls.fetch.push({receiver: this, args});return fetch ? fetch(...args) : fetchPromise; };
  const realm = vm.createContext({fetch: originalFetch, URL, Uint8Array, location: {href: 'https://wmh.localhost/'}, config: {key, expectedUrl, maxBytes}});
  // This executes the exact self-contained serialization Playwright injects.
  vm.runInContext(`(${installConsumedBodyObserver.toString()})(config)`, realm);
  const controller = realm[key], originalMethods = {read: reader.read, cancel: reader.cancel, releaseLock: reader.releaseLock, getReader: body.getReader};
  const networkRequest = {url: () => expectedUrl, method: () => 'GET', postData: () => null, redirectedFrom: () => null};
  const networkResponse = {request: () => networkRequest, url: () => expectedUrl, status: () => 200, fromServiceWorker: () => false, headers: () => ({...headers})};
  const restore = () => plain(controller.restore());
  const validate = observation => assertConsumedJsonResponse(networkResponse, observation, {key, expectedUrl, requests: [networkRequest]});
  return {realm, controller, restore, validate, response, reader, body, headers, originalFetch, originalMethods, calls, bytes,
    fetchPromise, cancelResult, releaseResult, networkRequest, networkResponse};
}

async function consume(f, signal) {
  const response = await f.realm.fetch('/api/diagnostics/build', options(signal));
  const reader = response.body.getReader();
  while (!(await reader.read()).done) { /* Only this simulated app consumes. */ }
  reader.releaseLock();
}

test('the early observer forwards the exact fetch/read promises, chunks, receivers and method results', async () => {
  const raw = encode('{"value":"原稿"}'), first = {done: false, value: raw}, done = {done: true};
  const f = fixture({bytes: raw, results: [first, done]}), receiver = {}, init = options();
  const retainedFetch = f.realm.fetch; // As in setupBuildDiagnosticsView, captured before the click.
  const promise = retainedFetch.call(receiver, '/api/diagnostics/build', init);
  assert.equal(promise, f.fetchPromise);assert.equal(f.calls.fetch.length, 1);
  assert.equal(f.calls.fetch[0].receiver, receiver);assert.equal(f.calls.fetch[0].args[1], init);
  const response = await promise;assert.equal(response, f.response);assert.equal(f.calls.getReader.length, 0);
  const readerArgs = {mode: 'default'}, reader = response.body.getReader(readerArgs);
  assert.equal(reader, f.reader);assert.equal(f.calls.getReader[0].receiver, f.body);assert.equal(f.calls.getReader[0].args[0], readerArgs);
  assert.equal(f.calls.read.length, 0, 'The observer never drives a read');
  const readArg = {}, firstPromise = reader.read(readArg);
  assert.equal(firstPromise, f.calls.read[0].result);assert.equal(f.calls.read[0].receiver, reader);assert.equal(f.calls.read[0].args[0], readArg);
  const delivered = await firstPromise;assert.equal(delivered, first);assert.equal(delivered.value, raw);
  assert.equal(await reader.read(), done);
  assert.equal(reader.releaseLock('release'), f.releaseResult);assert.equal(f.calls.release[0].args[0], 'release');
  assert.equal(reader.cancel('after done'), f.cancelResult);assert.equal(f.calls.cancel[0].args[0], 'after done');
  const snapshot = f.restore(), captured = f.validate(snapshot);
  assert.deepEqual(captured.json, {value: '原稿'});assert.deepEqual(captured.bytes, raw);assert.equal(captured.response, f.networkResponse);
  assert.equal(f.realm.fetch, f.originalFetch);assert.equal(f.realm[key], undefined);
  for (const name of ['read', 'cancel', 'releaseLock']) assert.equal(reader[name], f.originalMethods[name]);
  assert.equal(f.body.getReader, f.originalMethods.getReader);
  assert.equal(retainedFetch('/unrelated', init), f.fetchPromise, 'Captured wrappers become inactive original forwarders');
  assert.equal(f.calls.fetch.at(-1).receiver, undefined, 'Serialized wrappers preserve strict unbound this');
  assert.equal(f.controller.snapshot().requestCount, 1);
  assert.deepEqual(f.restore(), snapshot, 'Restoration is idempotent');
});

test('the actual product reader consumes split UTF-8 bytes and normalizes only after original completion', async () => {
  const input = diagnosticsFixture();input.native.executable_path = '/原稿/practice-server';
  const bytes = encode(JSON.stringify(input)), split = bytes.indexOf(0xe5) + 1;
  const f = fixture({bytes, body: new ReadableStream({start(stream) { stream.enqueue(bytes.slice(0, split));stream.enqueue(bytes.slice(split));stream.close(); }})});
  const model = await readBuildDiagnostics({fetcher: f.realm.fetch, origin: 'https://wmh.localhost'});
  assert.deepEqual(model.compiled, input.compiled);assert.equal(model.native.executable_path, input.native.executable_path);
  const observation = f.restore();assert.equal(observation.chunkCount, 2);assert.equal(observation.readCalls, 3);
  assert.deepEqual(f.validate(observation).json, input);assert.equal(f.calls.fetch.length, 1);
});

test('raw evidence is copied at read delivery without altering a reused application chunk', async () => {
  const raw = encode('{"a":1}'), f = fixture({bytes: raw});
  const response = await f.realm.fetch(expectedUrl, options()), reader = response.body.getReader();
  const next = await reader.read();assert.equal(next.value, raw);raw.fill(32);
  await reader.read();reader.releaseLock();
  assert.deepEqual(f.validate(f.restore()).json, {a: 1});
});

test('empty, invalid UTF-8, invalid JSON and oversized consumed bodies all fail closed', async t => {
  for (const [name, bytes, pattern] of [
    ['empty', new Uint8Array(), /Assertion/], ['UTF-8', Uint8Array.from([0xc3, 0x28]), /encoded data/],
    ['JSON', encode('{broken'), /JSON|property name/], ['oversized', new Uint8Array(32 * 1024 + 1), /byte bound/],
  ]) await t.test(name, async () => {
    const f = fixture({bytes});await consume(f);const snapshot = f.restore();
    assert.ok(snapshot.bytes.length <= 32 * 1024);assert.throws(() => f.validate(snapshot), pattern);
  });
});

test('malformed read results and extra completion values cannot establish consumption', async t => {
  for (const next of [null, {}, {done: 'yes'}, {done: false, value: [1, 2]}, {done: true, value: encode('{}')}]) {
    await t.test(JSON.stringify(next), async () => {
      const f = fixture({results: [next]});const response = await f.realm.fetch(expectedUrl, options());
      const reader = response.body.getReader(), delivered = await reader.read();assert.equal(delivered, next);
      assert.throws(() => f.validate(f.restore()), /read result|byte read|completed read/);
    });
  }
});

test('original rejected and synchronously thrown fetches/reads reach the app unchanged', async t => {
  const failure = new Error('Original network failure');
  for (const synchronous of [false, true]) for (const operation of ['fetch', 'read']) await t.test(`${operation} ${synchronous ? 'throw' : 'reject'}`, async () => {
    const rejected = Promise.reject(failure);rejected.catch(() => {});
    const f = fixture({[operation]: () => { if (synchronous) throw failure;return rejected; }});
    if (operation === 'fetch') {
      if (synchronous) assert.throws(() => f.realm.fetch(expectedUrl, options()), error => error === failure);
      else { const actual = f.realm.fetch(expectedUrl, options());assert.equal(actual, rejected);await assert.rejects(actual, error => error === failure); }
    } else {
      const response = await f.realm.fetch(expectedUrl, options()), reader = response.body.getReader();
      if (synchronous) assert.throws(() => reader.read(), error => error === failure);
      else { const actual = reader.read();assert.equal(actual, rejected);await assert.rejects(actual, error => error === failure); }
    }
    assert.throws(() => f.validate(f.restore()), /Original network failure/);
  });
});

test('abort before done rejects late reads; abort after completed app consumption remains explicitly recorded', async () => {
  const pending = deferred(), signal = new AbortController(), f = fixture({read: () => pending.promise});
  const response = await f.realm.fetch(expectedUrl, options(signal.signal)), reader = response.body.getReader();
  const original = reader.read();signal.abort();pending.resolve({done: true});await original;
  const aborted = f.restore();assert.equal(aborted.abortBeforeComplete, true);assert.equal(aborted.complete, false);
  assert.throws(() => f.validate(aborted), /aborted before complete/);
  const late = new AbortController(), complete = fixture();await consume(complete, late.signal);late.abort();
  const snapshot = complete.restore();assert.equal(snapshot.abortBeforeComplete, false);assert.equal(snapshot.abortAfterComplete, true);
  assert.equal(complete.validate(snapshot).json.schema_version, 1);
});

test('a pre-aborted signal and early cancel or release never turn partial bytes into success', async t => {
  for (const action of ['pre-abort', 'cancel', 'releaseLock']) await t.test(action, async () => {
    const f = fixture(), signal = new AbortController();if (action === 'pre-abort') signal.abort();
    const response = await f.realm.fetch(expectedUrl, options(signal.signal)), reader = response.body.getReader();
    if (action !== 'pre-abort') { await reader.read();reader[action]('original reason'); }
    const snapshot = f.restore();assert.equal(snapshot.complete, false);assert.throws(() => f.validate(snapshot));
    if (action === 'cancel') assert.equal(f.calls.cancel[0].args[0], 'original reason');
  });
});

test('multiple readers, concurrent reads and reads after done fail without suppressing original calls', async t => {
  for (const action of ['reader', 'concurrent', 'after-done']) await t.test(action, async () => {
    const f = fixture(), response = await f.realm.fetch(expectedUrl, options()), reader = response.body.getReader();
    if (action === 'reader') { assert.equal(response.body.getReader(), reader);assert.equal(f.calls.getReader.length, 2); }
    if (action === 'concurrent') await Promise.all([reader.read(), reader.read()]);
    if (action === 'after-done') { await reader.read();await reader.read();await reader.read(); }
    assert.throws(() => f.validate(f.restore()), /Multiple readers|concurrent read|Read after completion/);
  });
});

test('multiple or mismatched requests/responses cannot bind a plausible identity to this request', async t => {
  for (const action of ['duplicate', 'query', 'origin', 'method', 'response', 'redirect']) await t.test(action, async () => {
    const f = fixture({responseChanges: action === 'response' ? {url: `${expectedUrl}?wrong`} : action === 'redirect' ? {redirected: true} : {}});
    const url = action === 'query' ? `${expectedUrl}?wrong` : action === 'origin' ? expectedUrl.replace('wmh', 'other') : expectedUrl;
    await f.realm.fetch(url, {...options(), method: action === 'method' ? 'POST' : 'GET'});
    if (action === 'duplicate') await f.realm.fetch(url, options());
    assert.throws(() => f.validate(f.restore()), /Multiple matching|Mismatched fetch/);
    assert.equal(f.calls.fetch.length, action === 'duplicate' ? 2 : 1, 'No observer retry');
  });
});

test('stale keys, ambiguous network identity, header/status/length mismatches and service workers fail closed', async t => {
  const f = fixture();await consume(f);const observation = f.restore();
  const binding = {key, expectedUrl, requests: [f.networkRequest]};
  for (const [name, mutate] of Object.entries({
    key: ({snapshot}) => { snapshot.key = 'stale'; }, url: ({snapshot}) => { snapshot.expectedUrl += '?stale'; },
    incomplete: ({snapshot}) => { snapshot.complete = false; }, unbounded: ({snapshot}) => { snapshot.maxBytes = 65536; },
    truncated: ({snapshot}) => { snapshot.bytes.pop(); }, invalidByte: ({snapshot}) => { snapshot.bytes[0] = 300; },
    duplicates: ({binding}) => { binding.requests.push(f.networkRequest); },
    otherRequest: ({response}) => { response.request = () => ({...f.networkRequest}); },
    headers: ({snapshot}) => { snapshot.response.cacheControl = 'public'; },
    length: ({snapshot}) => { snapshot.byteLength--;snapshot.bytes.pop(); },
    status: ({response}) => { response.status = () => 503; }, worker: ({response}) => { response.fromServiceWorker = () => true; },
    compressed: ({snapshot, response}) => { snapshot.response.contentEncoding = 'gzip';response.headers = () => ({...f.headers, 'content-encoding': 'gzip'}); },
  })) await t.test(name, () => {
    const context = {snapshot: structuredClone(observation), response: {...f.networkResponse}, binding: {...binding, requests: [...binding.requests]}};
    mutate(context);assert.throws(() => assertConsumedJsonResponse(context.response, context.snapshot, context.binding));
  });
});

test('restoration handles pending work and inherited methods without leaving instrumentation active', async () => {
  const delayed = deferred(), f = fixture({fetch: () => delayed.promise});
  const original = f.realm.fetch(expectedUrl, options()), snapshot = f.restore();
  assert.equal(snapshot.complete, false);assert.match(snapshot.failure, /before complete/);
  delayed.resolve(f.response);assert.equal(await original, f.response);await Promise.resolve();
  assert.equal(f.body.getReader, f.originalMethods.getReader, 'A late original fetch cannot install new wrappers');
  const body = new ReadableStream({start(stream) { stream.enqueue(encode('{}'));stream.close(); }}), clean = fixture({bytes: encode('{}'), body});
  const getReader = body.getReader;assert.equal(Object.hasOwn(body, 'getReader'), false);
  const response = await clean.realm.fetch(expectedUrl, options()), reader = response.body.getReader();
  const readerPrototype = Object.getPrototypeOf(reader), originalRead = readerPrototype.read;
  while (!(await reader.read()).done) {}reader.releaseLock();clean.validate(clean.restore());
  assert.equal(Object.hasOwn(body, 'getReader'), false);assert.equal(body.getReader, getReader);
  assert.equal(Object.hasOwn(reader, 'read'), false);assert.equal(reader.read, originalRead);
});

test('restoration ownership loss fails without overwriting another owner’s replacement', async () => {
  const f = fixture();await consume(f);const replacement = () => 'replacement';f.realm.fetch = replacement;
  const snapshot = f.restore();assert.equal(f.realm.fetch, replacement);assert.equal(snapshot.restored, false);
  assert.equal(snapshot.restorationFailures.length, 1);assert.throws(() => f.validate(snapshot), /restoration ownership lost/);
});

test('completed body evidence cannot conceal the original triggering click failure', async () => {
  const f = fixture(), failure = new Error('Original click failed');
  await consume(f);const evidence = f.validate(f.restore());
  await assert.rejects(Promise.all([Promise.resolve(evidence), Promise.reject(failure)]), error => error === failure);
});

test('browser integration installs before app boot, uses original stream evidence and preserves existing backend/privacy checks', () => {
  const source = readFileSync(new URL('./full-app-browser.test.js', import.meta.url), 'utf8');
  assert.ok(source.indexOf('page.addInitScript(installConsumedBodyObserver') < source.indexOf('page.goto(origin'));
  assert.match(source, /currentTestName === buildDiagnosticsTestName/);
  const diagnostics = source.slice(source.indexOf('test(buildDiagnosticsTestName'), source.indexOf("test('embedded browser UI"));
  assert.doesNotMatch(diagnostics, /captureJsonResponse|\.text\(\)|\.clone\(|\.tee\(/);
  for (const assertion of ['assertConsumedJsonResponse(response, consumedBody', 'compiled.source_sha, sourceSha', 'compiled.source_tree, sourceTree',
    'native.process_id, server.pid', 'native.executable_sha256, executableHash', 'native.executable_bytes, executableStat.size',
    "defaultText.includes(native.executable_path), false", 'path_choice_reset_on_close: true']) assert.ok(diagnostics.includes(assertion), assertion);
  assert.match(diagnostics, /Promise\.all\(\[[\s\S]*page\.locator\('#build-diagnostics-read'\)\.click\(\)/);
});

// Borrowed native methods still work for their legitimate receiver, but cannot
// attach an unrelated stream's bytes to the observed network response.
test('borrowed stream/reader methods never substitute another response body', async t => {
  for (const action of ['getReader', 'read', 'cancel', 'releaseLock']) await t.test(action, async () => {
    const bytes = encode('{"original":true}');
    const body = new ReadableStream({start(stream) { stream.enqueue(bytes);stream.close(); }});
    const other = new ReadableStream({start(stream) { stream.enqueue(encode('{"alternate":true}'));stream.close(); }});
    const f = fixture({bytes, body}), response = await f.realm.fetch(expectedUrl, options());
    if (action === 'getReader') {
      const borrowed = response.body.getReader.call(other);
      const next = await borrowed.read();assert.deepEqual(next.value, encode('{"alternate":true}'));
      assert.equal(body.locked, false, 'The original response stream was never consumed');
      borrowed.releaseLock();
    } else {
      const reader = response.body.getReader(), otherReader = other.getReader();
      if (action === 'read') assert.deepEqual((await reader.read.call(otherReader)).value, encode('{"alternate":true}'));
      if (action === 'cancel') await reader.cancel.call(otherReader, 'other reason');
      if (action === 'releaseLock') assert.equal(reader.releaseLock.call(otherReader), undefined);
      while (!(await reader.read()).done) {}reader.releaseLock();
      if (action !== 'releaseLock') otherReader.releaseLock();
    }
    assert.throws(() => f.validate(f.restore()), /borrowed by another/);
  });
});

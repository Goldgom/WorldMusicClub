import test from 'node:test';
import assert from 'node:assert/strict';
import {captureJsonResponse} from './browser-response-capture.js';

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes;reject = no; });
  return {promise, resolve, reject};
}
function response(text = async () => '{"source_sha":"original"}', status = 200) {
  return {text, status: () => status, url: () => 'http://127.0.0.1:1234/api/diagnostics/build'};
}

test('capture reads once before the triggering click finishes, retaining this exact response', async () => {
  // This is a scheduling counterexample, not a claim that Chromium navigation
  // caused the original failure. A late reader cannot use an expired body.
  const arrived = deferred(), click = deferred(), started = deferred(), body = deferred();
  let available = true, reads = 0;
  const original = response(() => {
    reads++;assert.equal(available, true, 'Read must start while the response is available');
    started.resolve();return body.promise;
  });
  const events = [], captured = captureJsonResponse(arrived.promise, event => events.push(event));
  const together = Promise.all([captured, click.promise]);
  arrived.resolve(original);await started.promise;
  assert.equal(reads, 1);assert.deepEqual(events, ['body-read-start']);
  available = false;click.resolve();body.resolve('{"source_sha":"original"}');
  const [result] = await together;
  assert.equal(result.response, original);assert.deepEqual(result.json, {source_sha: 'original'});
  assert.equal(reads, 1);assert.deepEqual(events, ['body-read-start', 'body-read-complete']);

  const late = response(async () => { assert.equal(available, true, 'Expired response body'); });
  await assert.rejects((async () => {
    const [received] = await Promise.all([Promise.resolve(late), Promise.resolve()]);
    await received.text();
  })(), /Expired response body/);
});

test('a body protocol failure remains the original failure with no read retry', async () => {
  const failure = new Error('Network.getResponseBody: No data found for resource with given identifier');
  let reads = 0;const events = [];
  await assert.rejects(captureJsonResponse(Promise.resolve(response(async () => { reads++;throw failure; })),
    (event, data) => events.push({event, data})), error => error === failure);
  assert.equal(reads, 1);
  assert.deepEqual(events.map(row => row.event), ['body-read-start', 'body-read-failed']);
  assert.equal(events[1].data.message, failure.message);
});

test('a failed response waiter cannot cause a body read or synthetic evidence', async () => {
  const failure = new Error('Response timeout');let observations = 0;
  await assert.rejects(captureJsonResponse(Promise.reject(failure), () => observations++), error => error === failure);
  assert.equal(observations, 0);
});

test('early capture still rejects unsuccessful HTTP status and invalid JSON', async () => {
  await assert.rejects(captureJsonResponse(Promise.resolve(response(async () => '{"error":"unavailable"}', 503))),
    error => error.code === 'ERR_ASSERTION' && error.actual === 503);
  await assert.rejects(captureJsonResponse(Promise.resolve(response(async () => '{broken'))), SyntaxError);
});

test('early body success cannot conceal failure of the triggering click', async () => {
  const failure = new Error('Click failed');
  await assert.rejects(Promise.all([
    captureJsonResponse(Promise.resolve(response())), Promise.reject(failure),
  ]), error => error === failure);
});

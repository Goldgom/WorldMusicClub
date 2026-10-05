import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {Script} from 'node:vm';
import {createHash} from 'node:crypto';
import {nativeStorageApp, nativeResponse} from './native-storage-app-fixtures.js';
import {userPackServer} from './library-user-pack-fixtures.js';
import {catalogAcceptanceRendererHelpers} from './catalog-acceptance-renderer-helpers.js';
import {originalCatalogAcceptanceFixtures} from '../scripts/prepare-library-catalog-acceptance.mjs';
import {validateCatalogApiEvidence, validateCatalogHostApiTrace, validateCatalogTransportSettlement} from '../scripts/verify-library-catalog-acceptance.mjs';
const {createCatalogAcceptanceTransport, settleCatalogAcceptanceTransport, catalogManagementPaneReady, catalogAcceptanceEqual, catalogSeedImportFilenames, catalogTrustedActionComplete} = await catalogAcceptanceRendererHelpers();
const digest = async bytes => createHash('sha256').update(bytes).digest('hex'), plain = value => JSON.parse(JSON.stringify(value)), origin = 'https://wmh.localhost';
const options = value => ({method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(value)});
const commit = options({library_id: `library-${'a'.repeat(64)}`, preview: {request: {operation_id: `operation-${'b'.repeat(32)}`}}});
const deferred = () => { let resolve; const promise = new Promise(value => { resolve = value; }); return {promise, resolve}; };

test('renderer settlement waits for actual response bytes before strict independent host comparison', async () => {
  const gate = deferred(), body = '{ "ORIGINAL": "delayed actual response" }\n';
  const transport = createCatalogAcceptanceTransport({origin, digest, fetcher: async () => { await gate.promise; return new Response(body); }});
  const request = options({original: 'pending'}), task = transport.fetcher('/api/library/list', request);
  await new Promise(resolve => setImmediate(resolve));
  const host = [{sequence: 1, path: '/api/library/list', method: 'POST', status: 200, request_bytes: Buffer.byteLength(request.body), request_sha256: await digest(request.body), response_bytes: Buffer.byteLength(body), response_sha256: await digest(body), response_file: 'api/original-delayed.json'}];
  assert.equal(transport.rows[0].status, null);
  assert.throws(() => validateCatalogHostApiTrace(host, plain(transport.rows)), /sequence 1.*POST \/api\/library\/list/);
  let finished = false; const drain = transport.drain().then(() => { finished = true; });
  await new Promise(resolve => setImmediate(resolve)); assert.equal(finished, false);
  gate.resolve(); await task; await drain;
  assert.equal(transport.rows[0].response_text, body); assert.equal(validateCatalogHostApiTrace(host, plain(transport.rows)), 1);
  validateCatalogApiEvidence(plain(transport.rows)); validateCatalogTransportSettlement(plain(transport.settlement), plain(transport.rows));
});

test('settlement includes delayed request hashes and cloned response bodies, not just fetch headers', async () => {
  const hashGate = deferred(), bodyGate = deferred(); let first = true, called = false;
  const stream = new ReadableStream({async start(controller) { await bodyGate.promise; controller.enqueue(new TextEncoder().encode('{"ORIGINAL":"streamed"}')); controller.close(); }});
  const transport = createCatalogAcceptanceTransport({origin, digest: async bytes => { if (first) { first = false; await hashGate.promise; } return digest(bytes); }, fetcher: async () => { called = true; return new Response(stream); }});
  const task = transport.fetcher('/api/library/list'); assert.equal(transport.settlement.pending, 1);
  let finished = false; const drain = transport.drain().then(() => { finished = true; });
  await new Promise(resolve => setImmediate(resolve)); assert.equal(called, false); assert.equal(finished, false);
  hashGate.resolve(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(transport.rows[0].status, 200); assert.equal(transport.rows[0].response_sha256, null); assert.equal(finished, false);
  bodyGate.resolve(); await task; await drain;
  assert.equal(transport.rows[0].response_sha256, await digest('{"ORIGINAL":"streamed"}'));
  validateCatalogTransportSettlement(plain(transport.settlement), plain(transport.rows));
});

test('draining a deferred read before its real response arrives releases the later-created gate', async () => {
  const gate = deferred(), transport = createCatalogAcceptanceTransport({origin, digest, fetcher: async () => { await gate.promise; return new Response('{"ORIGINAL":"deferred"}', {status: 409}); }});
  transport.arm({kind: 'defer-query'}); const task = transport.fetcher('/api/library/catalog/query', options({view: 'active'}));
  await new Promise(resolve => setImmediate(resolve)); assert.equal(transport.held(), null);
  const drain = transport.drain(); gate.resolve(); await task; await drain;
  assert.equal(transport.held(), null); assert.equal(transport.rows[0].delivery_complete, true);
  assert.ok(transport.rows[0].release_event > transport.rows[0].response_event);
  validateCatalogApiEvidence(plain(transport.rows)); validateCatalogTransportSettlement(plain(transport.settlement), plain(transport.rows));
});

test('actual management DOM readiness waits for the startup response before switching to catalog', async () => {
  const server = await userPackServer(), gate = deferred(), entered = deferred(), events = []; let request;
  server.setManagementRoute(async (value, fixture) => { request = value; value.options.signal.addEventListener('abort', () => events.push('abort'), {once: true}); entered.resolve(); await gate.promise; events.push('response'); return nativeResponse(fixture.query(value.body)); });
  const app = await nativeStorageApp(server);
  try {
    await app.until(() => !app.$('start-listen').disabled); await app.click('home-single-player'); await app.click('library-management-button'); await entered.promise;
    await app.until(() => !app.$('management-catalog-button').hidden);
    assert.equal(app.$('library-management-dialog').dataset.phase, 'loading'); assert.equal(catalogManagementPaneReady(app.document), false); assert.equal(request.options.signal.aborted, false);
    gate.resolve(); await app.until(() => catalogManagementPaneReady(app.document));
    assert.deepEqual(events, ['response']); assert.equal(app.$('library-management-dialog').getAttribute('aria-busy'), 'false'); assert.ok(app.$('management-rows').children.length > 0);
    await app.click('management-catalog-button'); await app.until(() => catalogManagementPaneReady(app.document));
    assert.deepEqual(events, ['response', 'abort']); assert.equal(app.$('management-catalog').hidden, false);
    await app.click('management-close'); assert.equal(catalogManagementPaneReady(app.document), false);
  } finally { gate.resolve(); await app.close(); }
  const source = await readFile(new URL('../crates/desktop-shell/library-catalog-acceptance.js', import.meta.url), 'utf8');
  const open = source.slice(source.indexOf('async function openCatalog('), source.indexOf('async function catalogView('));
  assert.ok(open.indexOf('await until(() => catalogManagementPaneReady(document)') < open.indexOf("await native('click', $('management-catalog-button'))"));
  assert.match(source, /'Management read completed before membership view'/);
});

test('a deliberate switch still cancels its in-flight startup read and read errors never satisfy readiness', async () => {
  const server = await userPackServer(), gate = deferred(), entered = deferred(); let request;
  server.setManagementRoute(async value => { request = value; entered.resolve(); await gate.promise; throw Error('ORIGINAL late startup read failure'); });
  const app = await nativeStorageApp(server);
  try {
    await app.until(() => !app.$('start-listen').disabled); await app.click('home-single-player'); await app.click('library-management-button'); await entered.promise;
    await app.until(() => !app.$('management-catalog-button').hidden); assert.equal(catalogManagementPaneReady(app.document), false);
    await app.click('management-catalog-button'); assert.equal(request.options.signal.aborted, true); gate.resolve(); await app.until(() => app.$('management-catalog').dataset.phase === 'ready');
    assert.equal(server.history.size, 0);
    app.document.querySelector('[data-management-view="packs"]').click(); await app.until(() => app.$('library-management-dialog').dataset.phase === 'error');
    assert.equal(catalogManagementPaneReady(app.document), false); assert.match(app.$('management-error').textContent, /library_transport/);
  } finally { gate.resolve(); await app.close(); }
});

test('an already-aborted native read retains its real failure and cannot borrow the host status', async () => {
  const controller = new AbortController(); let originalSignal;
  const transport = createCatalogAcceptanceTransport({origin, digest, fetcher: (_, request) => { originalSignal = request.signal; return new Promise((_, reject) => request.signal.addEventListener('abort', () => reject(new DOMException('ORIGINAL request cancelled', 'AbortError')), {once: true})); }});
  const task = transport.fetcher('/api/library/list', {...options({original: 'abort'}), signal: controller.signal});
  await new Promise(resolve => setImmediate(resolve)); controller.abort(); await assert.rejects(task, {name: 'AbortError'});
  assert.equal(originalSignal, controller.signal); assert.equal(transport.settlement.pending, 0); assert.equal(transport.rows[0].status, null);
  await assert.rejects(transport.drain(), /AbortError.*ORIGINAL request cancelled/);
  assert.equal(transport.rows[0].observation_error.name, 'AbortError'); assert.equal(transport.settlement.status, 'failed');
  assert.throws(() => validateCatalogTransportSettlement(plain(transport.settlement), plain(transport.rows)));
});

test('closed capture rejects and records late reads without dispatching an unobserved request', async () => {
  const gate = deferred(); let calls = 0;
  const transport = createCatalogAcceptanceTransport({origin, digest, fetcher: async () => { calls++; await gate.promise; return new Response('{}'); }});
  const task = transport.fetcher('/api/library/list'); await new Promise(resolve => setImmediate(resolve));
  const drain = transport.drain(); await assert.rejects(transport.fetcher('/api/library/manage/query', options({view: 'packs'})), /admission closed/);
  assert.equal(calls, 1); gate.resolve(); await task; await assert.rejects(drain, /late_admissions.*\/api\/library\/manage\/query/);
  await assert.rejects(transport.drain(), /observations incomplete/); assert.equal(transport.rows.length, 1);
});

test('unexpected completed fetch, body and digest failures remain failures after pending empties', async () => {
  for (const kind of ['fetch', 'body', 'digest']) {
    let hashes = 0;
    const transport = createCatalogAcceptanceTransport({origin, digest: async bytes => { if (kind === 'digest' && ++hashes === 2) throw Error('ORIGINAL digest failure'); return digest(bytes); }, fetcher: async () => {
      if (kind === 'fetch') throw Error('ORIGINAL fetch failure');
      if (kind === 'body') return new Response(new ReadableStream({start(controller) { controller.error(Error('ORIGINAL body failure')); }}));
      return new Response('{}');
    }});
    await assert.rejects(transport.fetcher('/api/library/list'), new RegExp(`ORIGINAL ${kind} failure`));
    assert.equal(transport.settlement.pending, 0); await assert.rejects(transport.drain(), new RegExp(`ORIGINAL ${kind} failure`));
    assert.equal(transport.settlement.errors.length, 1); assert.notEqual(transport.settlement.status, 'complete');
  }
});

test('bounded finalization preserves its original error and still creates a failed diagnostic report', async () => {
  const deadline = Error('ORIGINAL settlement deadline'), original = 'earlier renderer failure', report = {ok: true, error: original}; let drained = false;
  await settleCatalogAcceptanceTransport({drain() { drained = true; return new Promise(() => {}); }}, report, async (operation, label, milliseconds) => {
    assert.equal(label, 'catalog transport evidence settlement'); assert.equal(milliseconds, 15000); void operation(); throw deadline;
  });
  assert.equal(drained, true); assert.equal(report.ok, false); assert.equal(report.error, original); assert.match(report.transport_error, /ORIGINAL settlement deadline/);
  const body = JSON.stringify(report); assert.equal(JSON.parse(body).ok, false);
  const source = await readFile(new URL('../crates/desktop-shell/library-catalog-acceptance.js', import.meta.url), 'utf8');
  assert.ok(source.indexOf('await settleCatalogAcceptanceTransport(transport, report, waits.bounded)') < source.indexOf('const body = JSON.stringify(report)'));
  assert.doesNotMatch(source, /globalThis\.fetch = originalFetch/);
});

test('native destination selection needs its exact trusted change even when popup close produces a second click', async () => {
  const observation = JSON.parse(await readFile(new URL('./fixtures/library-catalog/original-select-popup-observation.json', import.meta.url), 'utf8'));
  assert.equal(observation.run_id, 37332543259); assert.equal(observation.action.trusted_clicks, 2); assert.equal(observation.action.untrusted_clicks, 0);
  assert.equal(catalogTrustedActionComplete(observation.action), false, 'Old counters alone cannot be relabeled as a passing selection proof');
  // Authored protocol inputs below supply the new fields; these are not claims
  // that the old run recorded events or selection values it never captured.
  const target = `collection-${'a'.repeat(32)}`, control = 'management-catalog-add-target';
  const row = {...observation.action, selection: {target_id: control, target_tag: 'SELECT', before: '', after: target, option_values: ['', target], selected_index: 1, selected_text: `rr · ${target}`, trusted_changes: 1, untrusted_changes: 0, events: [{type: 'click', trusted: true, target_id: control, value: ''}, {type: 'input', trusted: true, target_id: control, value: target}, {type: 'change', trusted: true, target_id: control, value: target}, {type: 'click', trusted: true, target_id: control, value: target}]}};
  assert.equal(catalogTrustedActionComplete(row), true);
  const single = structuredClone(row); single.trusted_clicks = 1; single.selection.events.pop(); assert.equal(catalogTrustedActionComplete(single), true);
  for (const edit of [r => r.control = 'management-catalog-filter', r => r.kind = 'click', r => r.trusted_clicks = 3, r => r.untrusted_clicks = 1, r => r.selection.trusted_changes = 0, r => r.selection.trusted_changes = 2, r => r.selection.untrusted_changes = 1, r => r.selection.before = target, r => r.selection.after = '', r => r.selection.option_values.push(`collection-${'b'.repeat(32)}`), r => r.selection.selected_index = 0, r => r.selection.selected_text = 'wrong pack', r => r.selection.events[1].trusted = false, r => r.selection.events[2].target_id = 'other', r => r.selection.events[2].value = '', r => r.selection.events.push(r.selection.events[2])]) {
    const changed = structuredClone(row); edit(changed); assert.equal(catalogTrustedActionComplete(changed), false);
  }
});

test('shared catalog transport loses before dispatch without fabricating any native receipt', async () => {
  let calls = 0; const transport = createCatalogAcceptanceTransport({origin, digest, fetcher: async () => { calls++; throw Error('must not dispatch'); }});
  transport.arm({kind: 'lose-before'}); await assert.rejects(transport.fetcher('/api/library/catalog/commit', commit), /before native dispatch/);
  assert.equal(calls, 0); const row = plain(transport.rows[0]); assert.equal(row.dispatched, false);
  assert.deepEqual([row.status, row.response, row.response_text, row.response_sha256], [null, null, null, null]);
  validateCatalogApiEvidence([row]); await transport.drain(); assert.deepEqual(plain(transport.settlement.errors), []);
});

test('shared catalog transport records exact real response bytes before losing the reply', async () => {
  let calls = 0; const responseText = '{ "outcome": "committed", "operation_id": "original-unit-only" }\n';
  const transport = createCatalogAcceptanceTransport({origin, digest, fetcher: async () => { calls++; return new Response(responseText, {status: 200, headers: {'Content-Type': 'application/json'}}); }});
  transport.arm({kind: 'lose-after'}); await assert.rejects(transport.fetcher('/api/library/catalog/commit', commit), /after durable native commit/);
  assert.equal(calls, 1); assert.equal(transport.rows[0].response_text, responseText); assert.equal(transport.rows[0].response_sha256, await digest(responseText));
  assert.equal(transport.rows[0].delivery, 'lost-after-native'); validateCatalogApiEvidence(plain(transport.rows)); await transport.drain(); assert.deepEqual(plain(transport.settlement.errors), []);
});

test('selected pack exports retain exact binary response evidence without parsing ZIP bytes as JSON', async () => {
  const bytes = originalCatalogAcceptanceFixtures().legacy.bytes;
  const transport = createCatalogAcceptanceTransport({origin, digest, fetcher: async () => new Response(bytes, {status: 200, headers: {'Content-Type': 'application/zip'}})});
  const request = options({keys: [`song-${'a'.repeat(64)}`]});
  const response = await transport.fetcher('/api/library/pack/export', request);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
  const rows = plain(transport.rows); assert.equal(rows[0].response_binary_bytes, bytes.length); assert.equal(rows[0].response_sha256, await digest(bytes));
  assert.equal(rows[0].response_text, null); assert.equal(rows[0].response, null); validateCatalogApiEvidence(rows);
  const failed = createCatalogAcceptanceTransport({origin, digest, fetcher: async () => new Response('{"code":"catalog_in_trash"}', {status: 409})});
  assert.equal((await failed.fetcher('/api/library/pack/export', request)).status, 409);
  assert.equal(failed.rows[0].response.code, 'catalog_in_trash'); assert.equal(failed.rows[0].response_binary_bytes, undefined); validateCatalogApiEvidence(plain(failed.rows));
});

test('wrong-operation injection changes only the native read target and preserves its actual bytes', async () => {
  const requested = `operation-${'a'.repeat(32)}`, other = `operation-${'b'.repeat(32)}`; let sent;
  const transport = createCatalogAcceptanceTransport({origin, digest, fetcher: async (_, input) => { sent = JSON.parse(input.body); return new Response(JSON.stringify({operation_id: sent.operation_id, outcome: 'committed'})); }});
  transport.arm({kind: 'wrong-operation', operation_id: other});
  const response = await transport.fetcher('/api/library/catalog/operation', options({library_id: 'original-unit-only', operation_id: requested}));
  assert.equal((await response.json()).operation_id, other); assert.equal(sent.operation_id, other);
  const row = transport.rows[0]; assert.equal(row.request.operation_id, requested); assert.equal(row.wire_request.operation_id, other); assert.equal(row.response.operation_id, other);
  validateCatalogApiEvidence(plain(transport.rows));
});

test('held native metadata can finish after a newer read without rewriting either response', async () => {
  let index = 0; const transport = createCatalogAcceptanceTransport({origin, digest, fetcher: async () => new Response(JSON.stringify({source: ++index}), {status: 409})});
  transport.arm({kind: 'defer-query'}); const old = transport.fetcher('/api/library/catalog/query', options({view: 'trash'}));
  for (let attempt = 0; attempt < 50 && !transport.held(); attempt++) await new Promise(resolve => setImmediate(resolve));
  assert.ok(transport.held()); const current = await transport.fetcher('/api/library/catalog/query', options({view: 'active'})); assert.equal((await current.json()).source, 2);
  transport.release(); assert.equal((await (await old).json()).source, 1); assert.equal(transport.held(), null); assert.equal(transport.rows[0].delivery_complete, true);
  validateCatalogApiEvidence(plain(transport.rows));
});

test('concurrent hash completion preserves unique capture and real dispatch order', async () => {
  const slow = deferred(); let first = true;
  const transport = createCatalogAcceptanceTransport({origin, digest: async bytes => { if (first) { first = false; await slow.promise; } return digest(bytes); }, fetcher: async (_, input) => new Response(input.body, {status: 409})});
  const one = transport.fetcher('/api/library/catalog/query', options({value: 1})), two = transport.fetcher('/api/library/catalog/query', options({value: 2}));
  await two; slow.resolve(); await one;
  assert.deepEqual(plain(transport.rows.map(row => row.sequence)), [1, 2]); assert.deepEqual(plain(transport.rows.map(row => row.dispatch_order)), [2, 1]);
  validateCatalogApiEvidence(plain(transport.rows));
});

test('shared renderer rejects overlapping faults and bounds retained API evidence', async () => {
  let calls = 0; const transport = createCatalogAcceptanceTransport({origin, digest, limit: 1, fetcher: async () => { calls++; return new Response('{}', {status: 409}); }});
  transport.arm({kind: 'lose-before'}); assert.throws(() => transport.arm({kind: 'lose-after'}), /Overlapping/); transport.stop();
  await transport.fetcher('/api/library/catalog/status'); await assert.rejects(transport.fetcher('/api/library/catalog/status'), /finite bound/); assert.equal(calls, 1);
  assert.equal(catalogAcceptanceEqual({b: [2, {z: 3, a: 1}], a: 7}, {a: 7, b: [2, {a: 1, z: 3}]}), true);
  assert.equal(catalogAcceptanceEqual([1, 2], [2, 1]), false);
});

test('common renderer parses and hosted runner rejects local execution before any launch', async () => {
  new Script(await readFile(new URL('../crates/desktop-shell/library-catalog-acceptance.js', import.meta.url), 'utf8'));
  const result = spawnSync(process.execPath, ['scripts/hosted-library-catalog-check.mjs'], {cwd: fileURLToPath(new URL('../', import.meta.url)), env: {...process.env, GITHUB_ACTIONS: '', WMH_HOSTED_BROWSER: ''}, encoding: 'utf8', timeout: 10000});
  assert.equal(result.status, 1); assert.match(result.stderr, /requires authorized hosted Actions/);
});


test('native sorted JSON object keys cannot reorder the seed import protocol', async () => {
  const fixture = originalCatalogAcceptanceFixtures();
  const sortedJson = value => JSON.stringify(value, function(key, item) {
    return item && !Array.isArray(item) && typeof item === 'object' ? Object.fromEntries(Object.entries(item).sort(([left], [right]) => left.localeCompare(right))) : item;
  });
  // Equivalent to the current serde_json::Value map roundtrip at /catalog-config.
  const nativeConfig = JSON.parse(sortedJson({fixture: fixture.manifest}));
  assert.deepEqual(Object.keys(nativeConfig.fixture.spec.filenames), ['clean', 'legacy', 'shared']);
  assert.deepEqual(Object.values(nativeConfig.fixture.spec.filenames), [fixture.clean.filename, fixture.legacy.filename, fixture.shared.filename], 'reproduce the actual 419 producer failure');
  for (const spec of [fixture.spec, nativeConfig.fixture.spec]) {
    assert.deepEqual(plain(catalogSeedImportFilenames(spec)), [fixture.legacy.filename, fixture.shared.filename, fixture.clean.filename]);
  }
  const source = await readFile(new URL('../crates/desktop-shell/library-catalog-acceptance.js', import.meta.url), 'utf8');
  assert.match(source, /for \(const filename of catalogSeedImportFilenames\(spec\)\) await choose\(filename\)/);
  assert.doesNotMatch(source, /Object\.(values|keys|entries)\(spec\.filenames\)/);
});

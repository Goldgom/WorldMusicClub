import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {Script} from 'node:vm';
import {createHash} from 'node:crypto';
import {catalogAcceptanceRendererHelpers} from './catalog-acceptance-renderer-helpers.js';
import {validateCatalogApiEvidence} from '../scripts/verify-library-catalog-acceptance.mjs';
const {createCatalogAcceptanceTransport, catalogAcceptanceEqual} = await catalogAcceptanceRendererHelpers();
const digest = async bytes => createHash('sha256').update(bytes).digest('hex'), plain = value => JSON.parse(JSON.stringify(value)), origin = 'https://wmh.localhost';
const options = value => ({method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(value)});
const commit = options({library_id: `library-${'a'.repeat(64)}`, preview: {request: {operation_id: `operation-${'b'.repeat(32)}`}}});
const deferred = () => { let resolve; const promise = new Promise(value => { resolve = value; }); return {promise, resolve}; };

test('shared catalog transport loses before dispatch without fabricating any native receipt', async () => {
  let calls = 0; const transport = createCatalogAcceptanceTransport({origin, digest, fetcher: async () => { calls++; throw Error('must not dispatch'); }});
  transport.arm({kind: 'lose-before'}); await assert.rejects(transport.fetcher('/api/library/catalog/commit', commit), /before native dispatch/);
  assert.equal(calls, 0); const row = plain(transport.rows[0]); assert.equal(row.dispatched, false);
  assert.deepEqual([row.status, row.response, row.response_text, row.response_sha256], [null, null, null, null]);
  validateCatalogApiEvidence([row]);
});

test('shared catalog transport records exact real response bytes before losing the reply', async () => {
  let calls = 0; const responseText = '{ "outcome": "committed", "operation_id": "original-unit-only" }\n';
  const transport = createCatalogAcceptanceTransport({origin, digest, fetcher: async () => { calls++; return new Response(responseText, {status: 200, headers: {'Content-Type': 'application/json'}}); }});
  transport.arm({kind: 'lose-after'}); await assert.rejects(transport.fetcher('/api/library/catalog/commit', commit), /after durable native commit/);
  assert.equal(calls, 1); assert.equal(transport.rows[0].response_text, responseText); assert.equal(transport.rows[0].response_sha256, await digest(responseText));
  assert.equal(transport.rows[0].delivery, 'lost-after-native'); validateCatalogApiEvidence(plain(transport.rows));
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

// Pure evidence/observation tests. No browser, native child or listener runs.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {managementHostedRoute, validateManagementHostedOrigin, validateManagementNativeBridge, observeManagementWorkletLoads, validateManagementWorkletLoads} from '../scripts/management-hosted-runtime.mjs';
import {createHostedNativeBridge, verifyHostedWorkletAssets} from '../scripts/hosted-worklet-assets.mjs';
const origin = 'http://127.0.0.1:43123', nativeOrigin = 'https://wmh.localhost', sourceSha = 'a'.repeat(40);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

test('management routes only API/control/foreign requests while all real same-origin assets bypass interception', () => {
  for (const path of ['/', '/index.html', '/app.js', '/live-tone-audio-processor.js', '/live-tone-core.js', '/canonical-audio-processor.js', '/piano-layout-budget.js', '/fonts/original.woff2']) assert.equal(managementHostedRoute(new URL(origin + path), origin), false, path);
  for (const path of ['/api/library/catalog/query', '/api/health', '/__desktop_smoke/catalog-config']) assert.equal(managementHostedRoute(new URL(origin + path), origin), true, path);
  for (const foreign of [nativeOrigin, 'http://localhost:43123', 'http://127.0.0.1:43124', 'https://other.example']) assert.equal(managementHostedRoute(new URL(foreign + '/app.js'), origin), true);
  assert.throws(() => managementHostedRoute(new URL(origin), nativeOrigin));
});

test('both hosted management entry points use the real asset transport and retain diagnostics behind their CI guards', async () => {
  for (const name of ['hosted-library-catalog-check.mjs', 'hosted-pack-management-check.mjs']) {
    const source = await readFile(new URL(`../scripts/${name}`, import.meta.url), 'utf8');
    for (const required of ['startHostedAssetServer({root', 'process.env.WMH_SERVER_BINARY', 'createHostedNativeBridge({origin', 'managementHostedRoute(url, origin)', 'observeManagementWorkletLoads', 'native_request_sha256', 'native_response_sha256', '.stopAdmission()', '.drain()', 'validateManagementWorkletLoads', 'validateManagementNativeBridge']) assert.ok(source.includes(required), `${name}: ${required}`);
    assert.ok(source.indexOf("process.env.GITHUB_ACTIONS") >= 0 || source.indexOf('requireHostedPackManagement(process.env') >= 0);
    for (const forbidden of ["context.route('**/*'", 'await readFile(file)', 'headers: request.headers()', "origin = 'https://wmh.localhost'"]) assert.equal(source.includes(forbidden), false, `${name}: ${forbidden}`);
    assert.equal(/(?:setTimeout|requestTimeoutMs|timeout)\s*[:(]\s*30000/.test(source), false, 'Transport migration must not increase the existing admission deadlines');
  }
});

test('hosted origin requires matching config, native mapping and closed exact-source server with complete source assets', async () => {
  const sourceReader = name => readFile(new URL(`../web/${name}`, import.meta.url));
  const fetcher = async url => { const response = new Response(await sourceReader(new URL(url).pathname.slice(1)), {headers: {'content-type': 'text/javascript'}}); Object.defineProperty(response, 'url', {value: url}); return response; };
  const assets = await verifyHostedWorkletAssets({sourceSha, origin, sourceReader, fetcher});
  const host = {origin, native_protocol_origin: nativeOrigin, asset_server: {kind: 'exact-source-practice-server', origin, source_sha: sourceSha, bind: '127.0.0.1', status: 'ready', cleanup: {status: 'closed'}, server_sha256: hash('test-only server'), server_bytes: 16, assets}};
  const config = {hosted_origin: origin, native_protocol_origin: nativeOrigin};
  assert.equal(validateManagementHostedOrigin(host, config, sourceSha), origin);
  for (const edit of [v => v.origin = nativeOrigin, v => v.native_protocol_origin = origin, v => v.asset_server.source_sha = 'b'.repeat(40), v => v.asset_server.origin = 'http://127.0.0.1:43124', v => v.asset_server.cleanup.status = 'not-started', v => v.asset_server.assets.pop(), v => v.asset_server.assets = v.asset_server.assets.filter(row => row.path !== 'web/practice-selection.js'), v => v.asset_server.kind = 'fake-server', v => v.asset_server.assets[0].url = nativeOrigin + '/basic-key-audio-processor.js', v => v.asset_server.assets.push(v.asset_server.assets[0])]) { const changed = structuredClone(host); edit(changed); assert.throws(() => validateManagementHostedOrigin(changed, config, sourceSha)); }
  assert.throws(() => validateManagementHostedOrigin(host, {...config, hosted_origin: nativeOrigin}, sourceSha));
  assert.throws(() => validateManagementHostedOrigin(host, {...config, native_protocol_origin: origin}, sourceSha));
});

async function bridgeEvidence() {
  const page = {isClosed: () => false, url: () => origin + '/', workers: () => [], mainFrame: () => frame};
  const frame = {page: () => page, url: page.url, isDetached: () => false};
  const request = {url: () => origin + '/api/library/catalog/query', method: () => 'POST', allHeaders: async () => ({'content-type': 'application/json'}), frame: () => frame, serviceWorker: () => null, isNavigationRequest: () => false, resourceType: () => 'fetch'};
  const native = {sequence: 1, path: '/api/library/catalog/query', method: 'POST', request_bytes: 2, request_sha256: hash('{}'), status: 200, response_sha256: hash('ORIGINAL response')};
  const bridge = createHostedNativeBridge({origin, getOwnedPage: () => page});
  await bridge.run(request, async (headers, row) => { assert.equal(headers.origin, nativeOrigin); Object.assign(row, {native_sequence: native.sequence, native_request_bytes: native.request_bytes, native_request_sha256: native.request_sha256, native_status: native.status, native_response_sha256: native.response_sha256}); });
  bridge.stopAdmission(); await bridge.drain(); return {evidence: bridge.evidence, rows: [native]};
}
test('each native request and response binds one settled owned-frame mapping without inventing incoming headers', async () => {
  const {evidence, rows} = await bridgeEvidence(); validateManagementNativeBridge(evidence, origin, rows);
  assert.equal(evidence.requests[0].incoming_origin, null);
  const mutations = [v => v.origin = nativeOrigin, v => v.native_protocol_origin = origin, v => v.drain.status = 'pending', v => v.requests = [], v => v.requests.push(v.requests[0]), ...[
    r => r.admission = 'synthetic', r => r.hosted_origin = nativeOrigin, r => r.native_protocol_origin = origin, r => r.native_origin_basis = 'invented-header', r => r.owned_main_frame = false,
    r => r.frame_detached = true, r => r.page_closed = true, r => r.dedicated_workers = 1, r => r.service_worker = true, r => r.navigation = true, r => r.status = 'failed',
    r => r.request_url = origin + '/api/library/load', r => r.frame_url = nativeOrigin + '/', r => r.incoming_origin = nativeOrigin, r => r.incoming_host = 'localhost:43123', r => r.sec_fetch_site = 'cross-site', r => r.request_timeout_ms = 30000,
    r => r.native_sequence = 2, r => r.method = 'GET', r => r.native_status = 500, r => r.native_request_bytes++, r => r.native_request_sha256 = hash('wrong request'), r => r.native_response_sha256 = hash('wrong response'),
  ].map(edit => value => edit(value.requests[0]))];
  for (const edit of mutations) { const changed = structuredClone(evidence); edit(changed); assert.throws(() => validateManagementNativeBridge(changed, origin, rows)); }
  assert.throws(() => validateManagementNativeBridge(evidence, origin, [...rows, {...rows[0], sequence: 2}]));
});

function browserBoundary(implementation) {
  class Worklet { addModule(...args) { return implementation.apply(this, args); } }
  return {isSecureContext: true, AudioContext: function(){}, AudioWorkletNode: function(){}, AudioWorklet: Worklet};
}
test('worklet observer delegates real module arguments, receiver and resolved value without replacing audio', async () => {
  const calls = [], target = browserBoundary(function(...args) { calls.push({receiver: this, args}); return Promise.resolve('native result'); });
  observeManagementWorkletLoads(target); const worklet = new target.AudioWorklet(), options = {credentials: 'omit'};
  assert.equal(await worklet.addModule(origin + '/live-tone-audio-processor.js', options), 'native result');
  assert.equal(calls[0].receiver, worklet); assert.equal(calls[0].args[1], options);
  validateManagementWorkletLoads(target.__wmhManagementWorkletLoads, origin);
  const report = target.__wmhManagementWorkletLoads;
  for (const edit of [v => v.secure_context = false, v => v.installed = false, v => v.overflow = true, v => v.has_audio_context = false, v => v.has_worklet_node = false, v => v.modules = [], v => v.modules[0].status = 'failed', v => v.modules[0].error = {message: 'module-load'}, v => v.modules[0].url = nativeOrigin + '/live-tone-audio-processor.js', v => v.modules[0].url += '?substitute', v => v.modules[0].url = origin + '/fake.js']) { const changed = structuredClone(report); edit(changed); assert.throws(() => validateManagementWorkletLoads(changed, origin)); }
  validateManagementWorkletLoads({...report, modules: []}, origin, {required: false});
});
test('module load rejection and synchronous failure preserve the exact error and original bounded details', async () => {
  for (const synchronous of [false, true]) {
    const failure = new Error('ORIGINAL module-load failure'); failure.name = 'NetworkError';
    const target = browserBoundary(() => { if (synchronous) throw failure; return Promise.reject(failure); }); observeManagementWorkletLoads(target);
    await assert.rejects(async () => new target.AudioWorklet().addModule(origin + '/live-tone-audio-processor.js'), error => error === failure);
    assert.deepEqual(target.__wmhManagementWorkletLoads.modules[0], {url: origin + '/live-tone-audio-processor.js', status: 'failed', error: {name: 'NetworkError', message: failure.message}});
    assert.throws(() => validateManagementWorkletLoads(target.__wmhManagementWorkletLoads, origin));
  }
});
test('missing capability and diagnostic overflow never fabricate module success', async () => {
  const missing = {isSecureContext: true}; observeManagementWorkletLoads(missing); assert.equal(missing.__wmhManagementWorkletLoads.installed, false); assert.throws(() => validateManagementWorkletLoads(missing.__wmhManagementWorkletLoads, origin));
  let calls = 0; const target = browserBoundary(() => { calls++; return Promise.resolve(); }); observeManagementWorkletLoads(target);
  for (let i = 0; i < 17; i++) await new target.AudioWorklet().addModule(origin + '/live-tone-audio-processor.js');
  assert.equal(calls, 17); assert.equal(target.__wmhManagementWorkletLoads.modules.length, 16); assert.equal(target.__wmhManagementWorkletLoads.overflow, true); assert.throws(() => validateManagementWorkletLoads(target.__wmhManagementWorkletLoads, origin));
});

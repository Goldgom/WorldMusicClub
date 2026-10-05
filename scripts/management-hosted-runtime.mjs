// Pure admission/evidence helpers shared by the two hosted management gates.
// Asset serving and native forwarding remain the existing production helpers.
import assert from 'node:assert/strict';
import {validateHostedOrigin, NATIVE_PROTOCOL_ORIGIN, validateHostedAssetEvidence} from './hosted-worklet-assets.mjs';

export function managementHostedRoute(url, origin) {
  validateHostedOrigin(origin);
  return url.origin !== origin || url.pathname.startsWith('/api/') || url.pathname.startsWith('/__desktop_smoke/');
}
export function validateManagementHostedOrigin(host, config, sourceSha) {
  validateHostedOrigin(host.origin);
  assert.equal(host.native_protocol_origin, NATIVE_PROTOCOL_ORIGIN);
  if (config) { assert.equal(config.hosted_origin, host.origin); assert.equal(config.native_protocol_origin, NATIVE_PROTOCOL_ORIGIN); }
  validateHostedAssetEvidence(host.asset_server, {origin: host.origin, sourceSha});
  assert.equal(host.asset_server.kind, 'exact-source-practice-server');
  assert.ok(host.asset_server.assets.some(row => row.path === 'web/practice-selection.js'), 'The canonical Worklet selection dependency must remain source-bound');
  return host.origin;
}
export function validateManagementNativeBridge(value, origin, rows) {
  validateHostedOrigin(origin); assert.equal(value?.origin, origin); assert.equal(value.native_protocol_origin, NATIVE_PROTOCOL_ORIGIN);
  assert.equal(value.drain?.status, 'complete'); assert.ok(Array.isArray(value.requests) && value.requests.length > 0 && value.requests.length <= 256);
  assert.equal(value.requests.length, rows.length, 'Every real native dispatch must have one owned-frame bridge observation');
  const found = new Set();
  for (const row of value.requests) {
    assert.equal(row.admission, 'owned-live-main-frame'); assert.equal(row.hosted_origin, origin); assert.equal(row.native_protocol_origin, NATIVE_PROTOCOL_ORIGIN);
    assert.equal(row.native_origin_basis, 'verified-owned-frame-origin'); assert.equal(row.owned_main_frame, true); assert.equal(row.frame_detached, false); assert.equal(row.page_closed, false);
    assert.equal(row.dedicated_workers, 0); assert.equal(row.service_worker, false); assert.equal(row.navigation, false); assert.equal(row.status, 'settled');
    assert.equal(row.request_url, `${origin}${row.path}`); assert.equal(row.request_timeout_ms, 10000); assert.equal(new URL(row.request_url).origin, origin); assert.equal(new URL(row.frame_url).origin, origin);
    assert.ok(row.incoming_host === null || row.incoming_host === new URL(origin).host); assert.ok(row.incoming_origin === null || row.incoming_origin === origin); assert.ok(row.sec_fetch_site === null || row.sec_fetch_site === 'same-origin');
    assert.ok(Number.isSafeInteger(row.native_sequence) && !found.has(row.native_sequence)); found.add(row.native_sequence);
    const dispatched = rows.find(item => item.sequence === row.native_sequence); assert.ok(dispatched, 'Mapped native dispatch is missing');
    assert.equal(row.path, dispatched.path); assert.equal(row.method, dispatched.method); assert.equal(row.native_status, dispatched.status);
    assert.equal(row.native_request_sha256, dispatched.request_sha256); assert.equal(row.native_request_bytes, dispatched.request_bytes);
    assert.equal(row.native_response_sha256, dispatched.response_sha256 ?? dispatched.sha256);
  }
}

// CI observation only: call the original browser implementation unchanged and
// retain rejection details. This neither supplies modules nor changes audio.
export function observeManagementWorkletLoads(target = globalThis) {
  const report = {version: 1, secure_context: target.isSecureContext === true, has_audio_context: typeof target.AudioContext === 'function' || typeof target.webkitAudioContext === 'function', has_worklet_node: typeof target.AudioWorkletNode === 'function', installed: false, overflow: false, modules: []};
  target.__wmhManagementWorkletLoads = report;
  const prototype = target.AudioWorklet?.prototype, original = prototype?.addModule;
  if (typeof original !== 'function') return;
  prototype.addModule = function(url, ...args) {
    if (report.modules.length >= 16) { report.overflow = true; return original.call(this, url, ...args); }
    const row = {url: String(url), status: 'pending', error: null}; report.modules.push(row);
    try {
      const pending = original.call(this, url, ...args);
      return Promise.resolve(pending).then(value => { row.status = 'loaded'; return value; }, error => { row.status = 'failed'; row.error = {name: String(error?.name || '').slice(0, 128), message: String(error?.message || error).slice(0, 1024)}; throw error; });
    } catch (error) { row.status = 'failed'; row.error = {name: String(error?.name || '').slice(0, 128), message: String(error?.message || error).slice(0, 1024)}; throw error; }
  };
  report.installed = true;
}
export function validateManagementWorkletLoads(value, origin, {required = true} = {}) {
  validateHostedOrigin(origin); assert.equal(value?.version, 1); assert.equal(value.secure_context, true); assert.equal(value.has_audio_context, true); assert.equal(value.has_worklet_node, true); assert.equal(value.installed, true); assert.equal(value.overflow, false);
  assert.ok(Array.isArray(value.modules) && value.modules.length <= 16);
  for (const row of value.modules) { assert.equal(row.status, 'loaded'); assert.equal(row.error, null); const url = new URL(row.url); assert.equal(url.origin, origin); assert.ok(['/live-tone-audio-processor.js', '/basic-key-audio-processor.js', '/canonical-audio-processor.js'].includes(url.pathname)); assert.equal(url.search + url.hash, ''); }
  if (required) assert.ok(value.modules.some(row => row.url === `${origin}/live-tone-audio-processor.js`), 'The practice preservation baseline must load its real live-input worklet');
}

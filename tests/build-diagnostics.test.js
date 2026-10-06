import test from 'node:test';
import assert from 'node:assert/strict';
import {BUILD_DIAGNOSTICS_PATH, BUILD_DIAGNOSTICS_MAX_BYTES, normalizeBuildDiagnostics, readBuildDiagnostics, buildDiagnosticsText} from '../web/build-diagnostics.js';
import {diagnosticsFixture, diagnosticResponse, deferred} from './build-diagnostics-fixtures.js';
const origin = 'https://wmh.localhost';
const code = expected => error => error?.code === expected;

test('compiled Rust and actual process evidence never claim the current browser asset revision', () => {
  const input = diagnosticsFixture(), before = structuredClone(input), model = normalizeBuildDiagnostics(input);
  assert.deepEqual(model.compiled, input.compiled);assert.deepEqual(model.native, input.native);
  assert.deepEqual(model.browser_assets, {source_sha: null, source_tree: null, source_commit_count: null, source_status: 'unknown'});
  assert.deepEqual(input, before);
  input.native.transport = 'loopback-only';input.compiled.source_status = 'dirty';
  assert.equal(normalizeBuildDiagnostics(input).native.transport, 'loopback-only');assert.equal(normalizeBuildDiagnostics(input).compiled.source_status, 'dirty');
});

test('old health, unsupported schemas, malformed objects and absent Git evidence cannot establish an exact build', () => {
  for (const input of [null, [], {version: '0.2.0-alpha.1', name: 'WorldMusicHub'}, {...diagnosticsFixture(), schema_version: 2}]) assert.throws(() => normalizeBuildDiagnostics(input), code('unsupported'));
  for (const compiled of [null, [], '0.2.0-alpha.1']) assert.throws(() => normalizeBuildDiagnostics({...diagnosticsFixture(), compiled}), code('invalid'));
  const input = diagnosticsFixture();input.compiled.source_status = 'unavailable';input.compiled.source_error = 'git_unavailable';
  const model = normalizeBuildDiagnostics(input);assert.equal(model.compiled.source_sha, null);assert.equal(model.compiled.source_tree, null);assert.equal(model.compiled.source_commit_count, null);assert.equal(model.compiled.source_error, 'git_unavailable');
});

test('shallow count stays unknown, SHA-256 Git object IDs are supported and all numbers reject coercion', () => {
  const input = diagnosticsFixture();input.compiled.source_sha = 'a'.repeat(64);input.compiled.source_tree = 'b'.repeat(64);input.compiled.source_commit_count = null;input.compiled.source_error = 'shallow_history';
  assert.equal(normalizeBuildDiagnostics(input).compiled.source_sha, 'a'.repeat(64));assert.equal(normalizeBuildDiagnostics(input).compiled.source_commit_count, null);
  for (const invalid of ['27', true, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    input.compiled.source_commit_count = invalid;input.native.process_id = invalid;input.native.executable_bytes = invalid;
    const model = normalizeBuildDiagnostics(input);assert.equal(model.compiled.source_commit_count, null);assert.equal(model.native.process_id, null);assert.equal(model.native.executable_bytes, null);assert.equal(model.native.executable_sha256, null);
  }
});

test('changed, unavailable, oversized and incomplete hash evidence never display a successful digest', () => {
  for (const status of ['changed', 'unavailable', 'too_large', 'invented']) {
    const input = diagnosticsFixture();input.native.executable_hash_status = status;
    const model = normalizeBuildDiagnostics(input);assert.equal(model.native.executable_sha256, null);assert.notEqual(model.native.executable_hash_status, 'ok');
  }
  for (const [field, invalid] of [['executable_hash_scope', 'loaded_image'], ['executable_cache', 'unknown'], ['executable_sha256', 'not-a-digest'], ['executable_checked_at_unix_ms', null], ['executable_checked_at_unix_ms', 8640000000000001], ['executable_path', null], ['executable_bytes', null]]) {
    const input = diagnosticsFixture();input.native[field] = invalid;
    const model = normalizeBuildDiagnostics(input);assert.equal(model.native.executable_sha256, null, field);assert.equal(model.native.executable_hash_status, 'unknown', field);
  }
});

test('bounded literals reject line injection, controls, bidi overrides and arbitrary exception details', () => {
  for (const path of ['a'.repeat(4097), 'C:\\file\ncompiled.source_sha: accepted', 'C:\\file\u202eexe', 123, '']) {
    const input = diagnosticsFixture();input.native.executable_path = path;input.native.executable_error = 'Open C:\\Users\\private failed';input.compiled.source_error = '<script>bad</script>';
    const model = normalizeBuildDiagnostics(input);assert.equal(model.native.executable_path, null);assert.equal(model.native.executable_error, null);assert.equal(model.compiled.source_error, null);
  }
  const input = diagnosticsFixture();input.compiled.package_version = 'C:\\Users\\private';input.compiled.source_sha = 'a'.repeat(40) + '\n';
  const model = normalizeBuildDiagnostics(input);assert.equal(model.compiled.package_version, null);assert.equal(model.compiled.source_sha, null);
});

test('plain text excludes full path and music data unless the exact path option is explicitly true', () => {
  const input = diagnosticsFixture();input.music = {title: 'Private original score'};input.native.library_directory = '/private/music';input.native.username = 'Unrelated User';
  const model = normalizeBuildDiagnostics(input), report = buildDiagnosticsText(model, {status: 'ready'});
  assert.match(report, /compiled.source_sha: a{40}/);assert.match(report, /compiled.source_commit_count: 27/);assert.match(report, /not the loaded memory image/);assert.match(report, /browser_assets.source_sha: unknown/);
  for (const content of ['Original Fixture', 'Private original score', '/private/music', 'Unrelated User', 'native.executable_path:']) assert.equal(report.includes(content), false);
  assert.ok(buildDiagnosticsText(model, {includePath: true}).includes(input.native.executable_path));
  for (const includePath of [false, 'true', 1, {}]) assert.equal(buildDiagnosticsText(model, {includePath}).includes(input.native.executable_path), false);
  const forged = diagnosticsFixture();forged.compiled.source_sha = 'forged\nnative.executable_path: SECRET';assert.doesNotMatch(buildDiagnosticsText(forged), /SECRET/);
  assert.match(buildDiagnosticsText(null, {status: 'unsupported'}), /compiled.source_sha: unknown/);assert.doesNotMatch(buildDiagnosticsText(null), /545|accepted/);
});

test('one explicit read uses only the agreed endpoint with no writes, cache, redirect or health fallback', async () => {
  const calls = [];
  const model = await readBuildDiagnostics({origin, fetcher: async (...args) => { calls.push(args);return diagnosticResponse(); }});
  assert.equal(calls.length, 1);const [path, options] = calls[0];assert.equal(path, BUILD_DIAGNOSTICS_PATH);assert.equal(options.method, 'GET');assert.equal(options.body, undefined);assert.equal(options.credentials, 'same-origin');assert.equal(options.mode, 'same-origin');assert.equal(options.redirect, 'error');assert.equal(options.cache, 'no-store');assert.equal(model.compiled.source_commit_count, 27);
});

test('404 and unsupported schema remain unsupported while server and network errors disclose no text', async () => {
  for (const status of [404, 501]) await assert.rejects(readBuildDiagnostics({origin, fetcher: async () => new Response('path C:\\Users\\private', {status})}), code('unsupported'));
  await assert.rejects(readBuildDiagnostics({origin, fetcher: async () => diagnosticResponse({version: '0.2.0-alpha.1'})}), code('unsupported'));
  for (const fetcher of [async () => new Response('private failure', {status: 500}), async () => { throw Error('private failure'); }]) await assert.rejects(readBuildDiagnostics({origin, fetcher}), error => error.code === 'unavailable' && !error.message.includes('private'));
});

test('cross-origin or redirected reads fail closed before parsing body; invalid origins never fetch', async () => {
  for (const response of [{ok: true, redirected: true}, {ok: true, url: 'https://outside.invalid/build'}]) await assert.rejects(readBuildDiagnostics({origin, fetcher: async () => ({...response, get body() { assert.fail('Must not read body'); }})}), code('invalid'));
  for (const bad of [undefined, 'null', 'file:///private/file', 'bad-url']) await assert.rejects(readBuildDiagnostics({origin: bad, fetcher: async () => assert.fail('Must not fetch')}), code('unavailable'));
});

test('JSON decoding rejects huge declared/streamed responses, invalid UTF-8 and malformed JSON', async () => {
  const values = [new Response('{}', {headers: {'Content-Length': String(BUILD_DIAGNOSTICS_MAX_BYTES + 1)}}), new Response('x'.repeat(BUILD_DIAGNOSTICS_MAX_BYTES + 1)), new Response(new Uint8Array([255, 255])), new Response('{broken')];
  for (const response of values) await assert.rejects(readBuildDiagnostics({origin, fetcher: async () => response}), code('invalid'));
  let cancelled = 0;
  const response = {ok: true, status: 200, body: new ReadableStream({pull(controller) { controller.enqueue(new Uint8Array(BUILD_DIAGNOSTICS_MAX_BYTES + 1)); }, cancel() { cancelled++; }})};
  await assert.rejects(readBuildDiagnostics({origin, fetcher: async () => response}), code('invalid'));assert.equal(cancelled, 1);
});

test('abort settles reads even if fetch or a streamed body ignores cancellation', async () => {
  for (const stage of ['fetch', 'body']) {
    const controller = new AbortController(), gate = deferred();
    const response = new Response(new ReadableStream({pull: () => gate.promise}));
    const task = readBuildDiagnostics({origin, signal: controller.signal, fetcher: () => stage === 'fetch' ? gate.promise : Promise.resolve(response)});
    await Promise.resolve();await Promise.resolve();controller.abort();await assert.rejects(task, error => error.name === 'AbortError');gate.resolve(diagnosticResponse());
  }
});

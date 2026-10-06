// Node DOM simulation only. Does not establish browser/native acceptance.
import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {createI18n} from '../web/i18n.js';
import {setupBuildDiagnosticsView} from '../web/build-diagnostics-view.js';
import {diagnosticsFixture, diagnosticResponse, deferred} from './build-diagnostics-fixtures.js';
const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture(options = {}) {
  const {document, window} = parseHTML('<html><body><dialog id="settings-dialog" open><div class="shell-dialog-content"><label id="existing-setting">Existing choice<input id="existing-draft" value="kept"></label></div></dialog></body></html>');
  const dialog = document.getElementById('settings-dialog'), calls = [], copied = [], timers = new Map();let nextTimer = 0, clipboardReads = 0, selected = 0;
  Object.defineProperty(dialog, 'open', {get: () => dialog.hasAttribute('open')});
  Object.defineProperty(document, 'hidden', {writable: true, value: false});
  const i18n = createI18n({locale: 'en', storage: null, onReport: () => {}});
  const view = setupBuildDiagnosticsView({document, i18n, origin: 'https://wmh.localhost',
    fetcher: (...args) => { calls.push(args);return options.fetcher ? options.fetcher(...args) : Promise.resolve(diagnosticResponse()); },
    clipboard: () => { clipboardReads++;return options.clipboard ? options.clipboard() : {writeText: async text => copied.push(text)}; },
    setTimer: (callback, delay) => { timers.set(++nextTimer, {callback, delay});return nextTimer; }, clearTimer: id => timers.delete(id), ...options.viewOptions,
  });
  const $ = id => document.getElementById(`build-diagnostics-${id}`);
  $('text').select = () => { selected++; };
  const emit = (node, type) => node.dispatchEvent(new window.Event(type, {bubbles: true}));
  return {document, window, dialog, i18n, view, $, calls, copied, timers, get clipboardReads() { return clipboardReads; }, get selected() { return selected; }, emit,
    async read() { $('read').click();await tick(); }, close() { dialog.removeAttribute('open');emit(dialog, 'close'); },
    open() { dialog.setAttribute('open', ''); }, fireTimer(delay) { const entry = [...timers.entries()].find(([, timer]) => timer.delay === delay);assert.ok(entry, `Missing ${delay}ms timer`);timers.delete(entry[0]);entry[1].callback(); },
    destroy() { view.destroy(); },
  };
}

test('Settings diagnostics start unknown without network, storage, permissions or clipboard access', () => {
  const f = fixture();try {
    assert.equal(f.calls.length, 0);assert.equal(f.clipboardReads, 0);assert.equal(f.copied.length, 0);assert.equal(f.timers.size, 0);
    assert.equal(f.$('include-path').checked === true, false);assert.equal(f.$('text').hasAttribute('readonly'), true);assert.match(f.$('text').value, /compiled.source_sha: unknown/);
    assert.match(f.$('status').textContent, /not been read/);assert.equal(f.view.element.dataset.keyboardInput, 'off');assert.equal(f.view.element.closest('dialog'), f.dialog);
    assert.equal(f.document.querySelectorAll('dialog').length, 1);assert.equal(f.document.getElementById('existing-draft').value, 'kept');
  } finally { f.destroy(); }
});

test('explicit Read displays native compiled evidence and complete local path but leaves default copied report path-free', async () => {
  const f = fixture();try {
    await f.read();assert.equal(f.calls.length, 1);assert.equal(f.$('value-runtime').textContent, 'Native desktop app');assert.equal(f.$('value-sourceCount').textContent, '27');
    assert.equal(f.$('value-sourceSha').textContent, 'a'.repeat(40));assert.equal(f.$('value-hash').textContent, 'c'.repeat(64));assert.match(f.$('value-path').textContent, /Original Fixture/);
    assert.match(f.$('hash-note').textContent, /not the loaded memory image/);assert.match(f.$('browser-note').textContent, /source revision.*unknown/);assert.equal(f.$('value-checkedAt').textContent, new Date(1780000000000).toISOString());
    assert.equal(f.$('text').value.includes('Original Fixture'), false);assert.equal(f.clipboardReads, 0);assert.equal(f.timers.size, 0);
    f.$('copy').click();await tick();assert.equal(f.copied.length, 1);assert.equal(f.copied[0], f.$('text').value);assert.doesNotMatch(f.copied[0], /Original Fixture|executable_path:/);assert.match(f.$('copy-status').textContent, /copied/);
  } finally { f.destroy(); }
});

test('path copying requires explicit checkbox and resets without persistence when Settings closes or page hides', async () => {
  const f = fixture();try {
    await f.read();f.$('include-path').checked = true;f.emit(f.$('include-path'), 'change');assert.match(f.$('text').value, /Original Fixture/);assert.equal(f.copied.length, 0);
    f.$('copy').click();await tick();assert.match(f.copied[0], /native.executable_path: C:\\Users\\Original Fixture/);
    f.close();assert.equal(f.$('include-path').checked, false);assert.doesNotMatch(f.$('text').value, /Original Fixture/);assert.equal(f.$('copy-status').textContent, '');
    f.open();f.$('include-path').checked = true;f.emit(f.$('include-path'), 'change');f.document.hidden = true;f.emit(f.document, 'visibilitychange');assert.equal(f.$('include-path').checked, false);assert.doesNotMatch(f.$('text').value, /Original Fixture/);
  } finally { f.destroy(); }
});

test('clipboard missing, rejected or synchronously unavailable keeps a visible selectable manual fallback without raw errors', async () => {
  for (const clipboard of [() => undefined, () => ({writeText: () => Promise.reject(Error('Private path C:\\Users\\secret'))}), () => { throw Error('Private path C:\\Users\\secret'); }]) {
    const f = fixture({clipboard});try {
      await f.read();assert.equal(f.clipboardReads, 0);f.$('copy').click();await tick();
      assert.equal(f.clipboardReads, 1);assert.match(f.$('copy-status').textContent, /copy it manually/);assert.doesNotMatch(f.$('copy-status').textContent, /secret/);assert.equal(f.selected, 1);assert.equal(f.$('text').hidden, false);assert.equal(f.timers.size, 0);
      f.$('select').click();assert.equal(f.selected, 2);assert.equal(f.clipboardReads, 1);assert.match(f.$('copy-status').textContent, /selected/);
    } finally { f.destroy(); }
  }
});

test('404, old health and unreadable responses show unsupported or invalid with all exact build values unknown', async () => {
  for (const [response, state] of [[new Response('Not found', {status: 404}), 'unsupported'], [diagnosticResponse({version: '0.2.0-alpha.1', name: 'WorldMusicHub'}), 'unsupported'], [new Response('not json'), 'invalid']]) {
    const f = fixture({fetcher: async () => response});try {
      await f.read();assert.equal(f.view.element.dataset.state, state);assert.equal(f.$('value-sourceSha').textContent, 'Unknown');assert.equal(f.$('value-sourceCount').textContent, 'Unknown');assert.equal(f.$('value-packageVersion').textContent, 'Unknown');assert.equal(f.calls.length, 1);assert.doesNotMatch(f.$('text').value, /545|accepted|0\.2\.0-alpha\.1/);
    } finally { f.destroy(); }
  }
});

test('locale switching preserves controls, existing draft, checkbox, report and pending request', async () => {
  const gate = deferred(), f = fixture({fetcher: () => gate.promise});try {
    const textarea = f.$('text'), checkbox = f.$('include-path'), existing = f.document.getElementById('existing-draft');f.$('read').click();assert.equal(f.view.element.dataset.state, 'loading');
    f.i18n.setLocale('zh-CN');assert.equal(f.$('title').textContent, '版本与诊断');assert.match(f.$('status').textContent, /正在读取/);assert.equal(f.calls.length, 1);assert.equal(f.$('text'), textarea);assert.equal(f.$('include-path'), checkbox);assert.equal(f.document.getElementById('existing-draft'), existing);
    gate.resolve(diagnosticResponse());await tick();checkbox.checked = true;f.emit(checkbox, 'change');const report = textarea.value;f.i18n.setLocale('en');assert.equal(textarea.value, report);assert.equal(checkbox.checked, true);assert.equal(existing.value, 'kept');assert.match(f.$('value-runtime').textContent, /Native desktop/);
  } finally { f.destroy(); }
});

test('server strings stay text, never markup, and browser backend never becomes a native desktop identity', async () => {
  const input = diagnosticsFixture();input.native.transport = 'loopback-only';input.native.executable_path = '/local/<img src=x onerror=bad()>/server';
  const f = fixture({fetcher: async () => diagnosticResponse(input)});try {
    await f.read();assert.equal(f.$('value-runtime').textContent, 'Browser with local Rust server');assert.match(f.$('value-path').textContent, /<img/);assert.equal(f.view.element.querySelector('img,script'), null);assert.match(f.$('text').value, /browser_assets.source_sha: unknown/);
  } finally { f.destroy(); }
});

test('changed and failed hashes display unknown with the snapshot qualification in both languages', async () => {
  for (const status of ['changed', 'unavailable', 'too_large']) {
    const input = diagnosticsFixture();input.native.executable_hash_status = status;
    const f = fixture({fetcher: async () => diagnosticResponse(input)});try {
      await f.read();assert.equal(f.$('value-hash').textContent, 'Unknown');assert.match(f.$('value-hashStatus').textContent, /^Unknown:/);assert.match(f.$('text').value, /native.executable_sha256: unknown/);
      f.i18n.setLocale('zh-CN');assert.equal(f.$('value-hash').textContent, '未知');assert.match(f.$('value-hashStatus').textContent, /^未知：/);assert.match(f.$('hash-note').textContent, /不是已加载的内存映像/);
    } finally { f.destroy(); }
  }
});

test('repeated Read and Copy during a read do not duplicate work; closing aborts and discards late response', async () => {
  const gate = deferred(), f = fixture({fetcher: () => gate.promise});try {
    f.$('read').click();f.$('read').click();f.$('copy').click();assert.equal(f.calls.length, 1);assert.equal(f.clipboardReads, 0);assert.equal(f.view.element.getAttribute('aria-busy'), 'true');
    const signal = f.calls[0][1].signal;f.close();assert.equal(signal.aborted, true);assert.equal(f.view.element.dataset.state, 'cancelled');assert.equal(f.timers.size, 0);
    gate.resolve(diagnosticResponse());await tick();assert.equal(f.$('value-sourceSha').textContent, 'Unknown');assert.equal(f.view.element.dataset.state, 'cancelled');
    f.open();await f.read();assert.equal(f.calls.length, 2);assert.equal(f.view.element.dataset.state, 'ready');
  } finally { f.destroy(); }
});

test('read timeout clears busy state and explicit retry can succeed without a stale first result winning', async () => {
  const gate = deferred();let reads = 0;
  const f = fixture({fetcher: () => ++reads === 1 ? gate.promise : Promise.resolve(diagnosticResponse())});try {
    f.$('read').click();f.fireTimer(10000);await tick();assert.equal(f.view.element.dataset.state, 'timeout');assert.equal(f.view.element.getAttribute('aria-busy'), 'false');assert.equal(f.calls[0][1].signal.aborted, true);
    await f.read();assert.equal(f.view.element.dataset.state, 'ready');const report = f.$('text').value;
    const wrong = diagnosticsFixture();wrong.compiled.source_commit_count = 99;gate.resolve(diagnosticResponse(wrong));await tick();assert.equal(f.$('text').value, report);assert.equal(f.$('value-sourceCount').textContent, '27');
  } finally { f.destroy(); }
});

test('a failed refresh drops earlier evidence instead of retaining a success claim', async () => {
  let calls = 0;const f = fixture({fetcher: async () => ++calls === 1 ? diagnosticResponse() : new Response('private path failure', {status: 503})});try {
    await f.read();assert.equal(f.$('value-sourceCount').textContent, '27');await f.read();assert.equal(f.view.element.dataset.state, 'unavailable');assert.equal(f.$('value-sourceCount').textContent, 'Unknown');assert.doesNotMatch(f.$('status').textContent, /private/);
  } finally { f.destroy(); }
});

test('hung Copy has bounded feedback; close or path choice change cannot let late success update the current view', async () => {
  const gate = deferred(), f = fixture({clipboard: () => ({writeText: () => gate.promise})});try {
    await f.read();f.$('copy').click();f.$('copy').click();assert.equal(f.clipboardReads, 1);assert.match(f.$('copy-status').textContent, /Copying/);f.fireTimer(5000);assert.match(f.$('copy-status').textContent, /copy it manually/);
    f.close();gate.resolve();await tick();assert.equal(f.$('copy-status').textContent, '');assert.equal(f.timers.size, 0);
  } finally { f.destroy(); }
});

test('hidden Settings cannot read or copy; destroying aborts and removes only its own callbacks and section', async () => {
  const gate = deferred(), f = fixture({fetcher: () => gate.promise});
  const read = f.$('read'), copy = f.$('copy');f.close();read.click();copy.click();assert.equal(f.calls.length, 0);assert.equal(f.clipboardReads, 0);
  f.open();read.click();assert.equal(f.calls.length, 1);f.destroy();assert.equal(f.calls[0][1].signal.aborted, true);assert.equal(f.document.getElementById('build-diagnostics'), null);assert.equal(f.document.getElementById('existing-draft').value, 'kept');assert.equal(f.timers.size, 0);
  read.click();copy.click();f.i18n.setLocale('zh-CN');gate.resolve(diagnosticResponse());await tick();assert.equal(f.calls.length, 1);assert.equal(f.clipboardReads, 0);
});

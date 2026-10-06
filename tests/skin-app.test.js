import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {IDBFactory} from 'fake-indexeddb';
import {parseHTML} from 'linkedom';
import {DEFAULT_SKIN, SKIN_LIMITS, parseSkinManifest} from '../web/skin-format.js';
import {prepareSkinPackage, importSkinFiles, openSkinStorage, skinRecord, restoreSkinRecord, skinStorageError} from '../web/skin-storage.js';
import {createSkinRuntime, paintSkinNote} from '../web/skin-runtime.js';
import {setupSkinSettings} from '../web/skin-settings.js';

const source = await readFile(new URL('../skins/original-midnight/skin.json', import.meta.url));
const png = await readFile(new URL('../skins/original-midnight/assets/woven.png', import.meta.url));
const file = (name, bytes) => ({name, size: bytes.length, arrayBuffer: async () => Uint8Array.from(bytes).buffer});
const manifestFile = () => file('skin.json', source);
const backgroundFile = () => file('woven.png', png);
const tick = () => new Promise(resolve => setImmediate(resolve));
async function settled(predicate) { const deadline = Date.now() + 5000;while (!predicate()) { if (Date.now() > deadline) throw new Error('Skin operation did not settle');await tick(); } }

test('imports validate actual PNG bytes, retain exact bytes, and disclose unsupported layout', async () => {
  const pkg = await importSkinFiles(manifestFile(), backgroundFile());
  assert.equal(pkg.resolved.skin.id, 'original-midnight');
  assert.deepEqual(pkg.resources.get('assets/woven.png'), Uint8Array.from(png));
  assert.deepEqual(pkg.resolved.skin.layout, DEFAULT_SKIN.layout);
  assert.deepEqual(pkg.resolved.diagnostics, [
    {code: 'skin_feature_unsupported', path: 'background_image', fallback: 'builtin_default'},
    {code: 'skin_feature_unsupported', path: 'layout_bands', fallback: 'builtin_default'},
  ]);
  assert.equal(pkg.resolved.background_bytes, null, 'Decorative home images do not advertise stage-background support');
  assert.deepEqual(pkg.resolved.homeDecoration.bytes, Uint8Array.from(png));
  assert.equal(pkg.resolved.skin.notes.machine.marker, 'triangle');
  assert.equal(pkg.resolved.skin.notes.machine.pattern, 'stripes');
  assert.equal(JSON.parse(pkg.manifest).layout.notation_height, .28, 'The original declarative layout remains available in the saved source');
  const missing = await importSkinFiles(manifestFile());
  assert.equal(missing.resolved.background_bytes, null);assert.equal(missing.resources.size, 0);
  assert.ok(missing.resolved.diagnostics.some(item => item.code === 'skin_asset_missing'));
  const corrupt = await importSkinFiles(manifestFile(), file('woven.png', Uint8Array.from(png, (byte, index) => index === 30 ? byte ^ 1 : byte)));
  assert.equal(corrupt.resources.size, 0);assert.equal(corrupt.resolved.background_bytes, null);assert.equal(corrupt.resolved.homeDecoration, null);
  assert.ok(corrupt.resolved.diagnostics.some(item => item.code === 'skin_png'));
});

test('invalid imports and oversized files fail before installation and before oversized file reads', async () => {
  let read = false;
  await assert.rejects(importSkinFiles({size: SKIN_LIMITS.manifest_bytes + 1, arrayBuffer: async () => { read = true; }}), {code: 'skin_file_size'});
  assert.equal(read, false);
  await assert.rejects(importSkinFiles(file('skin.json', Buffer.from('{"version":2}'))));
  await assert.rejects(importSkinFiles(manifestFile(), file('wrong.png', png)), {code: 'skin_background_file'});
  const injected = {...DEFAULT_SKIN, script: 'alert(1)'};
  await assert.rejects(prepareSkinPackage(JSON.stringify(injected)), {code: 'skin_unknown_field'});
  await assert.rejects(importSkinFiles({size: 10, arrayBuffer: async () => source.buffer}), {code: 'skin_file_size'});
});

test('one origin-local atomic record survives reopen and default reset preserves the imported source', async () => {
  const factory = new IDBFactory(), pkg = await importSkinFiles(manifestFile(), backgroundFile());
  let db = await openSkinStorage({factory});
  assert.deepEqual(await restoreSkinRecord(await db.read()), {selected: 'default', installed: null});
  await db.write(skinRecord('imported', pkg));db.close();
  db = await openSkinStorage({factory});
  const reloaded = await restoreSkinRecord(await db.read());
  assert.equal(reloaded.selected, 'imported');assert.equal(reloaded.installed.manifest, pkg.manifest);
  assert.deepEqual(reloaded.installed.resources.get('assets/woven.png'), Uint8Array.from(png));
  await db.write(skinRecord('default', reloaded.installed));db.close();
  db = await openSkinStorage({factory});
  const reset = await restoreSkinRecord(await db.read());
  assert.equal(reset.selected, 'default');assert.equal(reset.installed.resolved.skin.id, 'original-midnight');db.close();
});

test('stored records are untrusted and cannot smuggle scripts, unbounded assets or duplicate resources', async () => {
  const pkg = await importSkinFiles(manifestFile(), backgroundFile()), good = skinRecord('imported', pkg);
  for (const changed of [
    {...good, version: 2}, {...good, script: 'x'}, {...good, selected: 'remote'},
    {...good, manifest: '{"version":1}'}, {...good, resources: [...good.resources, ...good.resources]},
    {...good, resources: [['https://example.test/a.png', png]]},
    {...good, resources: [['assets/woven.png', new Uint8Array(SKIN_LIMITS.asset_bytes + 1)]]},
  ]) await assert.rejects(restoreSkinRecord(changed));
  await assert.rejects(openSkinStorage({factory: null}), {code: 'skin_storage_unavailable'});
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
  try {
    Object.defineProperty(globalThis, 'indexedDB', {configurable: true, get() { throw new Error('Storage access denied'); }});
    await assert.rejects(openSkinStorage(), {code: 'skin_storage_unavailable'});
  } finally { if (descriptor) Object.defineProperty(globalThis, 'indexedDB', descriptor);else delete globalThis.indexedDB; }
});

function domFixture({record, failWrite = false, writeGate = null, importer = importSkinFiles} = {}) {
  const {document, window} = parseHTML('<html><body class="game-shell rhythm-shell"><div class="theme-settings"><select id="theme-mode"><option value="custom">Custom</option></select><input id="theme-accent" value="#123456"></div><div class="rhythm-hero-art" aria-hidden="true"></div><button id="held-key" class="pressed" aria-pressed="true"></button><textarea id="source-draft">untouched</textarea></body></html>');
  Object.defineProperty(window.HTMLSelectElement.prototype, 'value', {configurable: true, get() { return this.querySelector('option[selected]')?.value ?? this.querySelector('option')?.value ?? ''; }, set(value) { for (const option of this.querySelectorAll('option')) option.toggleAttribute('selected', option.value === value); }});
  document.documentElement.dataset.themeMode = 'custom';document.documentElement.style.setProperty('--green', '#123456');
  const urls = [], revoked = [], runtime = createSkinRuntime({document, urls: {createObjectURL(blob) { const url = `blob:test-${urls.length}`;urls.push({url, blob});return url; }, revokeObjectURL(url) { revoked.push(url); }}});
  const listeners = new Set(), i18n = {locale: 'en', subscribe(callback) { listeners.add(callback);return () => listeners.delete(callback); }};
  let saved = record, writes = 0, changes = 0, failing = failWrite;
  const view = setupSkinSettings({document, i18n, runtime, importFiles: importer, onChange: () => changes++, openStorage: async () => ({
    read: async () => saved,
    write: async value => { writes++;if (writeGate) await writeGate;if (failing) throw skinStorageError('skin_storage_full');saved = structuredClone(value); }, close() {},
  })});
  const $ = id => document.getElementById(id), emit = (node, type) => node.dispatchEvent(new window.Event(type));
  function files(json = manifestFile(), image = backgroundFile()) { Object.defineProperty($('skin-manifest'), 'files', {configurable: true, value: json ? [json] : []});Object.defineProperty($('skin-image'), 'files', {configurable: true, value: image ? [image] : []});emit($('skin-manifest'), 'change'); }
  return {document, window, $, emit, runtime, view, i18n, listeners, files, urls, revoked, writes: () => writes, saved: () => saved, changes: () => changes, fail: value => { failing = value; }, done: () => settled(() => $('skin-settings').getAttribute('aria-busy') === 'false')};
}

test('Settings imports, selects and resets without replacing theme, keyboard or source nodes', async () => {
  const f = domFixture();await f.view.ready;
  const key = f.$('held-key'), draft = f.$('source-draft'), theme = f.$('theme-mode');
  f.files();f.$('skin-import').click();await f.done();
  assert.equal(f.document.documentElement.dataset.skin, 'original-midnight');assert.equal(f.$('skin-choice').value, 'imported');
  assert.match(f.$('skin-status').textContent, /selected and saved/);assert.match(f.$('skin-diagnostics').textContent, /layout settings are unsupported/);
  assert.match(f.$('skin-scope').textContent, /home artwork only/);assert.equal(f.urls.length, 1);
  assert.equal(f.$('held-key'), key);assert.equal(key.getAttribute('aria-pressed'), 'true');assert.equal(f.$('source-draft'), draft);assert.equal(draft.textContent, 'untouched');
  assert.equal(f.$('theme-mode'), theme);assert.equal(f.document.documentElement.dataset.themeMode, 'custom');assert.equal(f.document.documentElement.style.getPropertyValue('--green'), '#123456');
  f.i18n.locale = 'zh-CN';f.listeners.forEach(fn => fn());assert.match(f.$('skin-status').textContent, /已使用导入皮肤/);assert.equal(f.$('skin-choice').value, 'imported');
  f.$('skin-reset').click();await f.done();assert.equal(f.document.documentElement.dataset.skin, undefined);
  assert.equal(f.document.documentElement.style.getPropertyValue('--skin-key-white'), undefined);assert.deepEqual(f.revoked, ['blob:test-0']);
  assert.equal(f.saved().selected, 'default');assert.ok(f.saved().manifest);assert.equal(f.document.documentElement.style.getPropertyValue('--green'), '#123456');
  f.$('skin-choice').value = 'imported';f.$('skin-use').click();await f.done();assert.equal(f.document.documentElement.dataset.skin, 'original-midnight');
  f.view.destroy();f.runtime.destroy();assert.equal(f.listeners.size, 0);
});

test('quota failure and invalid replacement preserve the active skin, selection and persisted bytes', async () => {
  const pkg = await importSkinFiles(manifestFile(), backgroundFile()), original = skinRecord('imported', pkg), f = domFixture({record: original});await f.view.ready;
  const imageUrl = f.document.documentElement.style.getPropertyValue('--skin-background-image');
  const replacement = {...DEFAULT_SKIN, id: 'replacement', name: '<img src=x onerror=alert(1)>'};
  f.fail(true);f.files(file('skin.json', Buffer.from(JSON.stringify(replacement))), null);f.$('skin-import').click();await f.done();
  assert.deepEqual(f.saved(), original);assert.equal(f.document.documentElement.dataset.skin, 'original-midnight');assert.equal(f.$('skin-choice').value, 'imported');
  assert.equal(f.document.documentElement.style.getPropertyValue('--skin-background-image'), imageUrl);assert.match(f.$('skin-status').textContent, /not changed.*storage/);assert.equal(f.revoked.length, 0);
  f.fail(false);f.files(file('skin.json', Buffer.from('{"version":2}')), null);f.$('skin-import').click();await f.done();assert.equal(f.writes(), 1);assert.deepEqual(f.saved(), original);
  f.files(file('skin.json', Buffer.from(JSON.stringify(replacement))), null);f.$('skin-import').click();await f.done();assert.equal(f.document.documentElement.dataset.skin, 'replacement');
  assert.equal(f.$('skin-choice').querySelector('img'), null);assert.match(f.$('skin-choice').textContent, /<img src=x/);
  f.view.destroy();f.runtime.destroy();
});

test('storage commits precede visual changes and repeated clicks cannot race an import', async () => {
  let release;const gate = new Promise(resolve => { release = resolve; }), f = domFixture({writeGate: gate});await f.view.ready;
  f.files();f.$('skin-import').click();await settled(() => f.writes() === 1);
  assert.equal(f.document.documentElement.dataset.skin, undefined);assert.equal(f.$('skin-reset').getAttribute('aria-disabled'), 'true');
  assert.equal(f.$('skin-import').disabled, false, 'A saving button retains native focusability');
  f.$('skin-import').click();f.$('skin-reset').click();assert.equal(f.writes(), 1);
  release();await f.done();assert.equal(f.document.documentElement.dataset.skin, 'original-midnight');assert.equal(f.writes(), 1);
  f.view.destroy();f.runtime.destroy();
});

test('an invalid saved manifest starts with a visible fallback and never installs executable content', async () => {
  const f = domFixture({record: {version: 1, selected: 'imported', manifest: '{}', resources: []}});await f.view.ready;
  assert.match(f.$('skin-status').textContent, /could not be read or validated/);assert.equal(f.document.documentElement.dataset.skin, undefined);assert.equal(f.urls.length, 0);f.view.destroy();f.runtime.destroy();
});

test('note painter preserves geometry, draws independent role markers, and bounds long-note decoration to the viewport', () => {
  const calls = [], ctx = new Proxy({}, {get(_target, key) { return (...args) => calls.push([key, ...args]); }, set(target, key, value) { target[key] = value;calls.push([key, value]);return true; }});
  const skin = structuredClone(DEFAULT_SKIN), geometry = {x: 10, y: -100000, width: 12, height: 100040, viewportHeight: 200, role: 'machine'};
  assert.equal(paintSkinNote(ctx, null, geometry), false);assert.deepEqual(calls, []);
  assert.equal(paintSkinNote(ctx, skin, geometry), true);
  assert.ok(calls.some(call => call[0] === 'roundRect' && call[1] === geometry.x && call[2] === geometry.y && call[3] === geometry.width && call[4] === geometry.height));
  assert.ok(calls.some(call => call[0] === 'fillStyle' && call[1] === skin.palette.surface));
  assert.ok(calls.some(call => call[0] === 'moveTo'));assert.ok(calls.filter(call => call[0] === 'lineTo').length < 20);
  assert.equal(calls.at(-1)[0], 'restore');assert.equal(geometry.y, -100000);
  calls.length = 0;paintSkinNote(ctx, skin, {...geometry, role: 'human'});assert.ok(calls.some(call => call[0] === 'arc'));
});

test('optional labels never paint over the role marker on short or clipped notes with solid patterns', () => {
  const source = structuredClone(DEFAULT_SKIN);source.notes.machine.pattern = 'solid';
  const skin = parseSkinManifest(JSON.stringify(source));
  for (const role of ['human', 'machine']) for (const geometry of [
    {x: 10, y: 60, width: 30, height: 25, viewportHeight: 240, label: 'C4', labelY: 85},
    {x: 10, y: 220, width: 30, height: 40, viewportHeight: 240, label: 'C4', labelY: 227},
    {x: 10, y: -10, width: 30, height: 35, viewportHeight: 240, label: 'C4', labelY: 17},
    {x: 10, y: 60, width: 30, height: 80, viewportHeight: 240, label: 'C4', labelY: 85},
  ]) {
    const calls = [], ctx = new Proxy({}, {get(target, key) { return Object.hasOwn(target, key) ? target[key] : (...args) => calls.push([key, ...args]); }, set(target, key, value) { target[key] = value;return true; }});
    paintSkinNote(ctx, skin, {...geometry, role});
    const bottom = Math.min(geometry.viewportHeight, geometry.y + geometry.height), marker = {left: 21, right: 29, top: bottom - 9, bottom: bottom - 1};
    const markerStart = calls.findIndex(call => call[0] === (role === 'human' ? 'arc' : 'moveTo'));
    assert.ok(markerStart >= 0, `The ${role} role marker remains present`);
    for (const [command, x, y, width, height] of calls.slice(markerStart)) {
      if (command === 'fillRect') assert.ok(x + width <= marker.left || x >= marker.right || y + height <= marker.top || y >= marker.bottom,
        `An opaque label plate must not overlap the ${role} marker`);
    }
    assert.equal(calls.some(call => call[0] === 'fillText'), geometry.height === 80,
      'Only the tall note has enough separate room for the optional label');
  }
});

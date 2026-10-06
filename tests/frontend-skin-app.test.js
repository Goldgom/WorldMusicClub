// Actual app bootstrap with original score and skin fixtures. DOM/audio/native
// endpoints are simulated in Node; this is not browser or native acceptance.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {authoredScore, nativeScoreServer, nativeStorageApp} from './native-storage-app-fixtures.js';
import {getAppI18n} from '../web/app-locale.js';
import {openSkinStorage, restoreSkinRecord} from '../web/skin-storage.js';

const manifest = await readFile(new URL('../skins/original-midnight/skin.json', import.meta.url));
const png = await readFile(new URL('../skins/original-midnight/assets/woven.png', import.meta.url));
const file = (name, bytes) => ({name, size: bytes.length, arrayBuffer: async () => Uint8Array.from(bytes).buffer});
const skinIdle = app => app.until(() => app.$('skin-settings')?.getAttribute('aria-busy') === 'false', 'Skin settings did not settle');
async function importSkin(app, bytes = manifest) {
  Object.defineProperty(app.$('skin-manifest'), 'files', {configurable: true, value: [file('skin.json', bytes)]});
  Object.defineProperty(app.$('skin-image'), 'files', {configurable: true, value: [file('woven.png', png)]});
  app.emit(app.$('skin-manifest'), 'change');await app.click('skin-import');await skinIdle(app);
}
function keySnapshot(app, root = 'keyboard') {
  return [...app.$(root).querySelectorAll('[data-midi]')].map(node => ({node, midi: node.dataset.midi, style: node.getAttribute('style'), pressed: node.getAttribute('aria-pressed'), held: node.classList.contains('held'), physical: node.classList.contains('pressed')}));
}

test('skin import, replacement failure and reset preserve the actual paused take, source and theme choice', async () => {
  const score = authoredScore({id: 'original-skin-adapter-exercise', title: 'Original skin adapter exercise'}), server = await nativeScoreServer({scores: [score]});
  const theme = JSON.stringify({mode: 'custom', accent: '#326b4c', background: '#f4f6f1'}), storageValues = new Map([['worldmusichub.theme', theme]]);
  const app = await nativeStorageApp(server, {now: () => 1000, storageValues});
  try {
    const key = [...server.records.keys()][0];await app.until(() => app.savedButton(key) && !app.$('start-practice').disabled);await skinIdle(app);
    await app.click('home-single-player');app.savedButton(key).click();await app.until(() => !app.$('start-practice').disabled);
    app.$('count-in').checked = false;await app.click('start-practice');await app.until(() => app.document.body.dataset.screen === 'stage' && !app.$('play-button').disabled);
    if (!app.$('play-button').textContent.includes('Pause')) await app.click('play-button');
    await app.until(() => app.$('play-button').textContent.includes('Pause'));await app.click('play-button');
    await app.until(() => !app.$('play-button').disabled);
    const before = await app.exported('export-takes'), source = await app.exported('export-button');
    const keys = keySnapshot(app), canvas = app.$('falling-notes'), notation = app.$('notation-lane-overlay');
    Object.defineProperties(canvas, {clientWidth: {value: 800, configurable: true}, clientHeight: {value: 240, configurable: true}});
    const fills = [], rectangles = [];
    const paint = new Proxy({roundRect(...args) { rectangles.push(args); }, fill() { fills.push(this.fillStyle); }}, {get: (target, key) => Object.hasOwn(target, key) ? target[key] : () => {}});
    canvas.getContext = () => paint;
    const requests = app.requests.length;
    await importSkin(app);app.frame();
    assert.equal(app.document.documentElement.dataset.skin, 'original-midnight');assert.equal(canvas.dataset.skin, 'original-midnight');
    assert.ok(fills.includes('#FBBF24'), 'Actual app canvas uses the imported human-note fill');assert.ok(rectangles.length > 0);
    assert.deepEqual(await app.exported('export-takes'), before);assert.deepEqual(await app.exported('export-button'), source);
    assert.deepEqual(keySnapshot(app), keys);assert.equal(app.$('notation-lane-overlay'), notation);assert.equal(app.requests.length, requests);
    assert.equal(storageValues.get('worldmusichub.theme'), theme);assert.equal(app.document.documentElement.dataset.themeMode, 'custom');
    assert.match(app.$('skin-diagnostics').textContent, /Stage background images are unsupported/);
    getAppI18n(app.document).setLocale('zh-CN');assert.match(app.$('skin-status').textContent, /已使用导入皮肤/);
    getAppI18n(app.document).setLocale('en');
    await importSkin(app, Buffer.from('{"version":2}'));assert.equal(app.document.documentElement.dataset.skin, 'original-midnight');assert.match(app.$('skin-status').textContent, /not changed/);
    await app.click('skin-reset');await skinIdle(app);app.frame();assert.equal(app.document.documentElement.dataset.skin, undefined);assert.equal(canvas.dataset.skin, 'builtin');
    assert.deepEqual(await app.exported('export-takes'), before);assert.deepEqual(await app.exported('export-button'), source);assert.deepEqual(keySnapshot(app), keys);assert.equal(storageValues.get('worldmusichub.theme'), theme);
    const db = await openSkinStorage({factory: app.factory}), restored = await restoreSkinRecord(await db.read());db.close();
    assert.equal(restored.selected, 'default');assert.equal(restored.installed.resolved.skin.id, 'original-midnight');assert.deepEqual(restored.installed.resources.get('assets/woven.png'), Uint8Array.from(png));
  } finally { await app.close(); }
});

test('skin styling changes during free input retain physical keys, contacts, recording and audio ownership', async () => {
  let clock = 1000;
  const server = await nativeScoreServer(), app = await nativeStorageApp(server, {now: () => clock});
  try {
    await skinIdle(app);await app.click('start-free-practice');await app.click('free-sound');await app.click('free-start');
    await app.until(() => app.$('free-stop').disabled === false);
    const key = app.document.querySelector('#free-practice-keys [data-midi="60"]');assert.ok(key);
    clock = 1010;
    app.emit(key, 'pointerdown', {pointerId: 71, button: 0});
    const keys = keySnapshot(app, 'free-practice-keys'), graph = [...app.audioGraphEvents], requests = app.requests.length;
    const liveStatus = app.$('free-live-notes').textContent, held = key.classList.contains('held') || key.classList.contains('pressed');
    assert.equal(held, true);
    await importSkin(app);
    assert.deepEqual(keySnapshot(app, 'free-practice-keys'), keys);assert.equal(app.$('free-live-notes').textContent, liveStatus);assert.deepEqual(app.audioGraphEvents, graph);assert.equal(app.requests.length, requests);
    await app.click('skin-reset');await skinIdle(app);
    assert.deepEqual(keySnapshot(app, 'free-practice-keys'), keys);assert.equal(app.$('free-live-notes').textContent, liveStatus);assert.deepEqual(app.audioGraphEvents, graph);
    clock = 1030;app.emit(key, 'pointerup', {pointerId: 71});await app.click('free-stop');
    const recording = await app.exported('free-export-draft');
    assert.equal(recording.score_context, null);assert.equal(recording.observations.events.filter(event => event.kind === 'note_on').length, 1);
    assert.equal(recording.observations.events.filter(event => event.kind === 'note_off').length, 1);
    assert.equal(recording.observations.events.find(event => event.kind === 'note_off').event_wall_ms - recording.observations.events.find(event => event.kind === 'note_on').event_wall_ms, 20);
    assert.equal(recording.observations.events.some(event => event.kind === 'synthetic_release'), false);
  } finally { await app.close(); }
});

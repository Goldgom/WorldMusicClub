import test from 'node:test';
import assert from 'node:assert/strict';
import {userPackServer, customPackId} from './library-user-pack-fixtures.js';
import {nativeStorageApp, nativeResponse, deferred} from './native-storage-app-fixtures.js';
import {getAppI18n} from '../web/app-locale.js';
const settled = app => app.until(() => app.$('management-catalog').dataset.phase === 'ready');
async function open(app) { await app.until(() => !app.$('start-listen').disabled); await app.click('home-single-player'); await app.click('library-management-button'); await app.until(() => !app.$('management-catalog-button').hidden); await app.click('management-catalog-button'); await settled(app); }
function select(app, row) { const box = app.document.querySelector(`[data-catalog-edition="${row.edition_id}"]`); assert.equal(box.disabled, false); box.checked = true; app.emit(box, 'change'); }
const reviewed = app => app.until(() => !app.$('management-catalog-review').hidden);

test('a new keyboard review receives focus once and Cancel returns to the initiating input', async () => {
  const server = await userPackServer(), app = await nativeStorageApp(server), focused = [], scrolled = [];
  try {
    await open(app);
    const input = app.$('management-catalog-create-name'), title = app.$('management-catalog-review-title'), cancel = app.$('management-catalog-cancel');
    for (const node of [input, title, cancel]) {
      node.focus = () => { Object.defineProperty(app.document, 'activeElement', {configurable: true, value: node}); focused.push(node.id); };
      node.scrollIntoView = () => scrolled.push(node.id);
    }
    input.value = 'Original keyboard review'; input.focus(); app.emit(app.$('management-catalog-create-form'), 'submit'); await reviewed(app);
    assert.equal(app.document.activeElement, title); assert.deepEqual(scrolled, [title.id]);
    cancel.focus(); getAppI18n(app.document).setLocale('zh-CN');
    assert.equal(app.document.activeElement, cancel); assert.equal(focused.filter(id => id === title.id).length, 1);
    await app.click(cancel.id); assert.equal(app.document.activeElement, input); assert.deepEqual(scrolled, [title.id, input.id]);
    assert.equal(server.history.size, 0);
    app.emit(app.$('management-catalog-create-form'), 'submit'); await reviewed(app);
    assert.equal(focused.filter(id => id === title.id).length, 2);
  } finally { await app.close(); }
});
async function confirm(app) { await app.click('management-catalog-confirm'); await app.until(() => app.$('management-catalog-review').hidden); await settled(app); }
function target(app, id, value) { app.$(`management-catalog-${id}`).value = value; app.emit(app.$(`management-catalog-${id}`), 'change'); }
test('production DOM creates and renames empty packs, filters editions, and keeps imported names read only in both languages', async () => {
  const server = await userPackServer(), app = await nativeStorageApp(server);
  try {
    await open(app); assert.equal(app.$('management-catalog-packs').hidden, false); await app.click('management-catalog-packs'); await settled(app);
    assert.equal(app.$('management-catalog-rows').querySelectorAll('[data-catalog-pack]').length, 4); assert.equal(app.$('management-catalog-rows').querySelectorAll('[data-catalog-rename-pack]').length, 2);
    assert.match(app.$('management-catalog-rows').textContent, /0 active editions · 0 verified available/);
    app.$('management-catalog-create-name').value = '  我的 <script>曲包</script>  '; app.emit(app.$('management-catalog-create-form'), 'submit'); await reviewed(app);
    assert.match(app.$('management-catalog-review-content').textContent, /1 packs created/); assert.equal(app.$('management-catalog-review-content').querySelector('script'), null); assert.match(app.$('management-catalog-review-content').textContent, /我的 <script>曲包<\/script>/);
    getAppI18n(app.document).setLocale('zh-CN'); assert.match(app.$('management-catalog-confirm').textContent, /创建已核对/); await app.click('management-catalog-cancel'); assert.equal(server.history.size, 0);
    app.emit(app.$('management-catalog-create-form'), 'submit'); await reviewed(app); await confirm(app); assert.match(app.$('management-catalog-operation-status').textContent, /曲包操作保存成功/);
    const created = [...server.packs.values()].find(pack => pack.name === '我的 <script>曲包</script>'); assert.ok(created); assert.equal(app.$('management-catalog-rows').querySelector('script'), null);
    app.$('management-catalog-rows').querySelector(`[data-catalog-rename-pack="${created.collection_id}"]`).click(); assert.equal(app.$('management-catalog-rename-preview').disabled, false); app.$('management-catalog-rename-name').value = 'Renamed empty pack'; app.emit(app.$('management-catalog-rename-form'), 'submit'); await reviewed(app); assert.match(app.$('management-catalog-review-content').textContent, /Renamed empty pack/); await confirm(app);
    app.$('management-catalog-rows').querySelector(`[data-catalog-open-pack="${created.collection_id}"]`).click(); await settled(app); assert.equal(app.$('management-catalog-filter').value, created.collection_id); assert.equal(app.$('management-catalog-rows').children.length, 0); assert.equal(app.$('management-catalog-empty').hidden, false);
    getAppI18n(app.document).setLocale('en'); assert.deepEqual(getAppI18n(app.document).getReports(), []); assert.equal(server.history.size, 2);
  } finally { await app.close(); }
});
test('production DOM adds exact mixed editions, reports duplicate membership noops, and exports original selected formats separately', async () => {
  const server = await userPackServer(), app = await nativeStorageApp(server);
  try {
    await open(app); const preview = app.$('song-lobby').dataset.previewId, audio = app.audio(); select(app, server.rows[0]); select(app, server.rows[1]); target(app, 'add-target', customPackId(0));
    assert.equal(app.$('management-catalog-add-preview').disabled, false); await app.click('management-catalog-add-preview'); await reviewed(app); assert.match(app.$('management-catalog-review-content').textContent, /2 memberships added/); assert.match(app.$('management-catalog-review-content').textContent, /Original custom pack 0/); await confirm(app);
    select(app, server.rows[0]); target(app, 'add-target', customPackId(0)); await app.click('management-catalog-add-preview'); await reviewed(app); assert.match(app.$('management-catalog-review-content').textContent, /0 memberships added · 1 memberships already present/); assert.match(app.$('management-catalog-review-content').textContent, /Original custom pack 0/); await app.click('management-catalog-cancel'); select(app, server.rows[1]);
    await app.click('management-catalog-export-clean'); await app.until(() => app.downloads.length === 1); assert.deepEqual(server.requests.filter(row => row.path === '/api/library/pack/export').at(-1).body.keys, [server.rows[1].key]);
    await app.click('management-catalog-export-legacy'); await app.until(() => app.downloads.length === 2); assert.deepEqual(server.requests.filter(row => row.path === '/api/library/pack/export').at(-1).body.keys, [server.rows[0].key]);
    assert.equal(app.$('song-lobby').dataset.previewId, preview); assert.deepEqual(app.audio(), audio); assert.deepEqual(getAppI18n(app.document).getReports(), []);
  } finally { await app.close(); }
});
test('partial pack-read failure disables stale controls and closing cancels the exact in-flight selected export', async () => {
  const server = await userPackServer(), gate = deferred(), app = await nativeStorageApp(server); let exporting = false;
  try {
    await open(app); select(app, server.rows[0]); target(app, 'add-target', customPackId(0));
    server.setUserPackRoute(request => request.path.endsWith('/query') && request.body.view === 'packs' ? Promise.reject(Error('Authored pack read failure')) : request.proceed());
    await app.click('management-catalog-refresh'); await app.until(() => app.$('management-catalog').dataset.phase === 'error');
    for (const id of ['create-preview', 'rename-preview', 'add-preview', 'export-legacy', 'export-clean']) assert.equal(app.$(`management-catalog-${id}`).disabled, true);
    assert.equal(app.$('management-catalog-rows').children.length, 0); assert.equal(app.$('management-catalog-filter').options.length, 1);
    server.setUserPackRoute(null); await app.click('management-catalog-refresh'); await settled(app); select(app, server.rows[0]);
    server.setAuxRoute(async ({path}) => { if (path === '/api/library/pack/export') { exporting = true; await gate.promise; return {...nativeResponse({}), blob: async () => new Blob(['late original pack'])}; } });
    await app.click('management-catalog-export-legacy'); await app.until(() => exporting); const call = server.requests.find(row => row.path === '/api/library/pack/export'); await app.click('management-close'); assert.equal(call.options.signal.aborted, true); gate.resolve(); await app.tick(); assert.equal(app.downloads.length, 0);
  } finally { gate.resolve(); await app.close(); }
});

test('a pending pack preview can be canceled visibly and a late result never becomes a confirmable review', async () => {
  const server = await userPackServer(), gate = deferred(), admitted = deferred(), app = await nativeStorageApp(server);
  try {
    await open(app); server.setUserPackRoute(async request => { if (request.path.endsWith('/preview')) { admitted.resolve(); await gate.promise; } return request.proceed(); });
    app.$('management-catalog-create-name').value = 'Cancelled in-flight pack'; app.emit(app.$('management-catalog-create-form'), 'submit'); await admitted.promise;
    assert.equal(app.$('management-catalog-pending-cancel').hidden, false); assert.equal(app.$('management-catalog-confirm').disabled, true); await app.click('management-catalog-pending-cancel');
    gate.resolve(); await app.tick(); await settled(app); assert.equal(app.$('management-catalog-review').hidden, true); assert.equal(app.$('management-catalog-pending-cancel').hidden, true); assert.equal(server.history.size, 0);
  } finally { gate.resolve(); await app.close(); }
});

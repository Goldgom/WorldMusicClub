import test from 'node:test';
import assert from 'node:assert/strict';
import {membershipPackServer, seedMemberships} from './library-pack-membership-fixtures.js';
import {customPackId} from './library-user-pack-fixtures.js';
import {nativeStorageApp, nativeResponse, deferred} from './native-storage-app-fixtures.js';
import {getAppI18n} from '../web/app-locale.js';
const source = customPackId(0), destination = customPackId(1);
const settled = app => app.until(() => app.$('management-catalog').dataset.phase === 'ready');
const reviewed = app => app.until(() => !app.$('management-catalog-review').hidden);
const ready = async app => { await app.until(() => !app.$('start-listen').disabled); await app.click('home-single-player'); };
async function open(app) { await app.click('library-management-button'); await app.until(() => !app.$('management-catalog-button').hidden); await app.click('management-catalog-button'); await settled(app); }
function choose(app, row, checked = true) { const node = app.document.querySelector(`[data-catalog-edition="${row.edition_id}"]`); assert.ok(node); assert.equal(node.disabled, false); node.checked = checked; app.emit(node, 'change'); }
function target(app, id, value) { app.$(`management-catalog-${id}`).value = value; app.emit(app.$(`management-catalog-${id}`), 'change'); }
async function filter(app, value) { target(app, 'filter', value); await settled(app); }
async function confirm(app) { await app.click('management-catalog-confirm'); await app.until(() => app.$('management-catalog-review').hidden); await settled(app); }
async function serverFixture() { const server = await membershipPackServer(); seedMemberships(server); return server; }

test('production membership controls expose exact custom source and destination scope, retain imported readonly groups, and localize review', async () => {
  const server = await serverFixture(), app = await nativeStorageApp(server);
  try {
    await ready(app); await open(app); assert.equal(app.$('management-catalog-memberships').hidden, false); assert.equal(app.$('management-catalog-membership-actions').hidden, true);
    await filter(app, server.rows[0].packs.find(pack => pack.kind === 'imported').collection_id); assert.match(app.$('management-catalog-membership-scope').textContent, /Memberships are read only/); assert.equal(app.$('management-catalog-membership-actions').hidden, true);
    await filter(app, source); assert.match(app.$('management-catalog-membership-scope').textContent, /Original custom pack 0/); assert.equal(app.$('management-catalog-remove-preview').disabled, true);
    const options = [...app.$('management-catalog-move-target').options].map(option => option.value); assert.deepEqual(options, ['', destination]);
    choose(app, server.rows[0]); choose(app, server.rows[1]); target(app, 'move-target', destination); await app.click('management-catalog-move-preview'); await reviewed(app);
    assert.match(app.$('management-catalog-review-content').textContent, /2 memberships removed · 1 memberships added · 1 destination memberships already present/);
    assert.match(app.$('management-catalog-review-content').textContent, /Reviewed source pack: Original custom pack 0/); assert.match(app.$('management-catalog-review-content').textContent, /Reviewed pack: Original custom pack 1/);
    for (const row of server.rows.slice(0, 2)) assert.ok(app.$('management-catalog-review-content').textContent.includes(row.edition_id));
    getAppI18n(app.document).setLocale('zh-CN'); assert.match(app.$('management-catalog-confirm').textContent, /移动已核对的成员关系/); assert.match(app.$('management-catalog-membership-scope').textContent, /成员关系来源/);
    await app.click('management-catalog-cancel'); assert.equal(server.history.size, 0); target(app, 'move-target', ''); assert.equal(app.$('management-catalog-move-preview').disabled, true);
    await app.click('management-catalog-remove-preview'); await reviewed(app); assert.match(app.$('management-catalog-confirm').textContent, /从此曲包移除/); await confirm(app);
    assert.equal(app.$('management-catalog-rows').children.length, 0); assert.equal(app.$('management-catalog-undo').hidden, false); assert.equal(app.$('management-catalog-undo-preview').disabled, false);
    getAppI18n(app.document).setLocale('en'); await app.click('management-catalog-undo-preview'); await reviewed(app); assert.match(app.$('management-catalog-review-content').textContent, /0 memberships removed · 2 memberships added/); await confirm(app);
    assert.equal(app.$('management-catalog-rows').children.length, 2); assert.equal(app.$('management-catalog-undo').hidden, true); assert.deepEqual(getAppI18n(app.document).getReports(), []);
  } finally { await app.close(); }
});

test('paused production score and takes survive move, restart-recovered Undo, and preserved destination duplicates', async () => {
  const server = await serverFixture(), values = new Map(); let app = await nativeStorageApp(server, {storageValues: values}), closed = false;
  try {
    await ready(app); app.savedButton(server.rows[0].key).click(); await app.until(() => app.$('song-lobby').dataset.previewId === `native:${server.rows[0].key}` && !app.$('start-practice').disabled);
    app.$('count-in').checked = false; await app.click('start-practice'); await app.until(() => app.document.body.dataset.screen === 'stage' && !app.$('play-button').disabled);
    const key = app.$('keyboard').querySelector('[data-midi="60"]'); app.emit(key, 'pointerdown', {pointerId: 9, button: 0}); app.emit(key, 'pointerup', {pointerId: 9}); await app.click('back-to-library'); await app.until(() => !app.$('assess-button').disabled);
    const score = await app.exported('export-button'), takes = await app.exported('export-takes'), identity = app.$('song-lobby').dataset.previewId, audio = app.audio();
    await open(app); await filter(app, source); choose(app, server.rows[0]); choose(app, server.rows[1]); target(app, 'move-target', destination); await app.click('management-catalog-move-preview'); await reviewed(app); await confirm(app);
    const original = [...server.history.values()][0].request.operation_id;
    await app.click('management-close'); assert.deepEqual(await app.exported('export-button'), score); assert.deepEqual(await app.exported('export-takes'), takes); assert.equal(app.$('song-lobby').dataset.previewId, identity); assert.deepEqual(app.audio(), audio);
    await app.close(); closed = true; values.clear(); app = await nativeStorageApp(server, {storageValues: values}); closed = false; await ready(app); await open(app);
    assert.equal(app.$('management-catalog-operation').hidden, true); assert.equal(app.$('management-catalog-undo').hidden, false); assert.ok(app.$('management-catalog-undo-id').textContent.includes(original));
    await app.click('management-catalog-undo-preview'); await reviewed(app); assert.match(app.$('management-catalog-review-content').textContent, /1 memberships removed · 2 memberships added/); await confirm(app);
    assert.equal(server.rows[0].packs.some(pack => pack.collection_id === destination), true); assert.equal(server.rows[1].packs.some(pack => pack.collection_id === destination), false); assert.ok(server.rows.slice(0, 2).every(row => row.packs.some(pack => pack.collection_id === source)));
  } finally { if (!closed) await app.close(); }
});

test('production lost Undo reply blocks new writes and restart checks the same durable operation ID', async () => {
  const server = await serverFixture(), values = new Map(); let app = await nativeStorageApp(server, {storageValues: values}), closed = false;
  try {
    await ready(app); await open(app); await filter(app, source); choose(app, server.rows[0]); await app.click('management-catalog-remove-preview'); await reviewed(app); await confirm(app);
    await app.click('management-catalog-undo-preview'); await reviewed(app); const preview = server.catalogRequests.filter(row => row.path.endsWith('/preview')).at(-1); assert.equal(preview.body.action, 'undo_memberships');
    server.setMembershipRoute(async request => { const result = await request.proceed(); if (request.path.endsWith('/commit')) throw Error('Original lost Undo response'); return result; });
    await app.click('management-catalog-confirm'); await app.until(() => app.$('management-catalog-operation-status').textContent.includes('Outcome unconfirmed'));
    const id = server.catalogRequests.filter(row => row.path.endsWith('/commit')).at(-1).body.preview.request.operation_id;
    assert.equal(app.$('management-catalog-undo-preview').disabled, true); assert.equal(app.$('management-catalog-remove-preview').disabled, true); assert.equal(app.$('management-catalog-retry').hidden, true);
    await app.close(); closed = true; server.setMembershipRoute(null); app = await nativeStorageApp(server, {storageValues: values}); closed = false; await ready(app); await open(app);
    assert.match(app.$('management-catalog-operation-status').textContent, /Native journal confirms/); assert.ok(app.$('management-catalog-operation-id').textContent.includes(id)); assert.equal(app.$('management-catalog-undo').hidden, true); assert.equal(server.catalogRequests.filter(row => row.path.endsWith('/commit')).length, 2); assert.equal(server.history.size, 2);
  } finally { if (!closed) await app.close(); }
});

test('late membership reviews cannot survive target changes or Close; stale reads disable all membership controls', async () => {
  const server = await serverFixture(), gate = deferred(), admitted = deferred(), app = await nativeStorageApp(server);
  try {
    await ready(app); await open(app); await filter(app, source); choose(app, server.rows[0]); target(app, 'move-target', destination);
    server.setMembershipRoute(async request => { if (request.path.endsWith('/preview')) { admitted.resolve(); await gate.promise; } return request.proceed(); });
    await app.click('management-catalog-move-preview'); await admitted.promise; await app.click('management-catalog-pending-cancel'); target(app, 'move-target', ''); gate.resolve(); await app.tick(); await settled(app); assert.equal(app.$('management-catalog-review').hidden, true); assert.equal(server.history.size, 0);
    server.setMembershipRoute(null); target(app, 'move-target', destination); await app.click('management-catalog-move-preview'); await reviewed(app); target(app, 'move-target', ''); assert.equal(app.$('management-catalog-review').hidden, true);
    server.setMembershipRoute(async request => { const result = await request.proceed(); if (request.path.endsWith('/status')) { const value = await result.json(); value.generation++; return nativeResponse(value); } return result; });
    await app.click('management-catalog-refresh'); await app.until(() => app.$('management-catalog').dataset.phase === 'error'); for (const id of ['remove-preview', 'move-preview', 'undo-preview']) assert.equal(app.$(`management-catalog-${id}`).disabled, true); assert.equal(app.$('management-catalog-rows').children.length, 0); assert.equal(server.history.size, 0);
  } finally { gate.resolve(); await app.close(); }
});

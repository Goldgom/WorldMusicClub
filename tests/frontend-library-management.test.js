import test from 'node:test';
import assert from 'node:assert/strict';
import {nativeStorageApp, nativeScoreServer, nativeResponse, deferred} from './native-storage-app-fixtures.js';
import {managementServer, digest, songRow} from './library-management-fixtures.js';
import {getAppI18n} from '../web/app-locale.js';

const ready = async app => { await app.until(() => !app.$('start-listen').disabled); await app.click('home-single-player'); };
const settled = app => app.until(() => app.$('library-management-dialog').dataset.phase === 'ready');
const view = async (app, name) => { app.document.querySelector(`[data-management-view="${name}"]`).click(); await settled(app); };
const open = async app => { await app.click('library-management-button'); await settled(app); };
const songRows = app => [...app.document.querySelectorAll('[data-management-song]')];
const select = (app, node, checked) => { node.checked = checked; app.emit(node, 'change'); };
function expand(app, details) { details.open = true; app.emit(details, 'toggle'); }

test('actual library entry groups shared immutable editions, keeps retained sources separate and never activates a song', async () => {
  const server = await managementServer(), app = await nativeStorageApp(server);
  try {
    await ready(app); assert.ok(app.$('library-management-button').closest('#song-lobby'));
    const before = server.requests.length, identity = app.$('song-lobby').dataset.previewId, audio = app.audio();
    await open(app); assert.equal(app.document.querySelectorAll('[data-management-pack-row]').length, 3);
    assert.equal(server.queryRequests[0].body.refresh, true); assert.match(app.$('management-freshness').textContent, /Verified at/);
    const pack = server.fixture.packs[0]; app.document.querySelector(`[data-management-pack="${pack.pack_id}"]`).click(); await settled(app);
    assert.equal(songRows(app).length, 2); assert.match(app.$('management-context').textContent, /甲 <原始>/); assert.match(app.$('management-rows').textContent, /One stored edition shared by 2 packs/);
    assert.equal(app.$('management-rows').querySelector('img'), null, 'Source titles are inert text');
    expand(app, songRows(app)[0].querySelector('details')); assert.equal(songRows(app)[0].querySelectorAll('[data-management-pack]').length, 2);
    await view(app, 'songs'); assert.equal(songRows(app).length, 3); assert.equal(new Set(songRows(app).map(row => row.dataset.managementSong)).size, 3);
    await view(app, 'unfiled'); assert.equal(songRows(app).length, 1); assert.equal(songRows(app)[0].dataset.managementSong, server.fixture.songs[2].edition_id);
    await view(app, 'issues'); assert.equal(songRows(app).length, 0); assert.equal(app.document.querySelectorAll('[data-management-issue]').length, 1); assert.match(app.$('management-rows').textContent, /Original test-only unsupported/); assert.equal(app.$('management-selection').hidden, true);
    assert.ok(server.requests.slice(before).every(row => row.path === '/api/library/manage/query'));
    assert.equal(app.$('song-lobby').dataset.previewId, identity); assert.deepEqual(app.audio(), audio); assert.equal(app.openedDatabases.includes('worldmusichub.scores.v1'), false);
    assert.equal(app.$('library-management-dialog').querySelector('[data-delete], [data-trash], [data-rename]'), null);
  } finally { await app.close(); }
});

test('duplicate browsing separates reused content, source-ID editions and title-only suggestions', async () => {
  const server = await managementServer(), app = await nativeStorageApp(server);
  try {
    await ready(app); await open(app); await view(app, 'duplicates');
    assert.match(app.$('management-help').textContent, /not uploaded ZIP bytes/); assert.match(app.$('management-rows').textContent, /Already reuses one stored edition/);
    let details = app.document.querySelector('[data-management-group]'); assert.equal(details.querySelectorAll('.management-song').length, 0); expand(app, details); assert.equal(details.querySelectorAll('.management-song').length, 1);
    app.$('management-category').value = 'same_id'; app.emit(app.$('management-category'), 'change'); await settled(app); assert.match(app.$('management-help').textContent, /source ID matches/);
    details = app.document.querySelector('[data-management-group]'); expand(app, details); assert.equal(details.querySelectorAll('.management-song').length, 2);
    app.$('management-category').value = 'same_title'; app.emit(app.$('management-category'), 'change'); await settled(app); assert.match(app.$('management-help').textContent, /does not establish the same song/);
    assert.deepEqual(server.queryRequests.slice(1).map(row => row.body.duplicate_kind), ['exact_content', 'same_id', 'same_title']);
  } finally { await app.close(); }
});

test('search waits for explicit submit, rows and nested editions are bounded, and pages reuse the snapshot', async () => {
  const server = await managementServer({many: 87}), app = await nativeStorageApp(server);
  try {
    await ready(app); await open(app); await view(app, 'songs'); assert.equal(songRows(app).length, 40); const reads = server.queryRequests.length;
    for (const value of ['a', 'au', 'authored-86']) { app.$('management-search').value = value; app.emit(app.$('management-search'), 'input'); }
    await app.tick(); assert.equal(server.queryRequests.length, reads);
    app.emit(app.$('management-search-form'), 'submit'); await settled(app); assert.equal(songRows(app).length, 1); assert.equal(server.queryRequests.at(-1).body.search, 'authored-86'); assert.equal(server.queryRequests.at(-1).body.refresh, false);
    await view(app, 'songs'); await app.click('management-next'); await settled(app); assert.equal(songRows(app).length, 40); assert.match(app.$('management-page').textContent, /Page 2/); assert.equal(server.queryRequests.at(-1).body.refresh, false);
    await app.click('management-previous'); await settled(app); assert.match(app.$('management-page').textContent, /Page 1/);
    const large = Array.from({length: 91}, (_, index) => songRow(`same-id-${index}`, {score_id: 'one-original'}));
    server.fixture.duplicates[1] = {group_id: `same_id:${digest('large original group')}`, kind: 'same_id', match: 'one-original', edition_count: large.length, pack_count: 0, reference_count: 0, evidence_type: 'distinct_editions', editions: large};
    await view(app, 'duplicates'); app.$('management-category').value = 'same_id'; app.emit(app.$('management-category'), 'change'); await settled(app);
    const details = app.document.querySelector('[data-management-group]'); expand(app, details); assert.equal(details.querySelectorAll('.management-song').length, 20);
    details.lastElementChild.lastElementChild.click(); assert.equal(details.querySelectorAll('.management-song').length, 20); assert.match(details.textContent, /Editions 21–40 of 91/);
  } finally { await app.close(); }
});

test('selection exposes hidden count, survives locale switching, and exports clean and legacy selections explicitly', async () => {
  const server = await managementServer({many: 45}), app = await nativeStorageApp(server);
  try {
    await ready(app); await open(app); await view(app, 'songs');
    const boxes = app.$('management-rows').querySelectorAll('[data-management-edition]'); select(app, boxes[0], true); select(app, boxes[1], true);
    assert.equal(app.$('management-select-page').indeterminate, true); assert.equal(app.$('management-export-clean').disabled, false); assert.equal(app.$('management-export-legacy').disabled, false);
    getAppI18n(app.document).setLocale('zh-CN'); assert.match(app.$('management-selected').textContent, /已选 2/); assert.match(app.$('management-title').textContent, /本机曲库管理/); assert.equal([...app.$('management-rows').querySelectorAll('[data-management-edition]')].filter(node => node.checked).length, 2);
    assert.ok([...app.$('management-rows').querySelectorAll('[data-management-edition]')].every(node => node.getAttribute('aria-label').includes('选择')));
    getAppI18n(app.document).setLocale('en'); await app.click('management-next'); await settled(app); assert.match(app.$('management-selected').textContent, /2 outside this page/);
    await app.click('management-export-clean'); await app.until(() => app.downloads.length === 1); assert.deepEqual(server.requests.filter(row => row.path === '/api/library/pack/export').at(-1).body.keys, [server.fixture.songs[1].key]);
    await app.click('management-export-legacy'); await app.until(() => app.downloads.length === 2); assert.deepEqual(server.requests.filter(row => row.path === '/api/library/pack/export').at(-1).body.keys, [server.fixture.songs[0].key]);
    await app.click('management-clear-hidden'); assert.match(app.$('management-selected').textContent, /0 editions selected/);
    assert.deepEqual(getAppI18n(app.document).getReports(), []);
  } finally { await app.close(); }
});

test('paused practice takes, independent preview and saved/unsaved free recordings remain byte-equivalent', async () => {
  const server = await managementServer(), app = await nativeStorageApp(server);
  try {
    await ready(app); app.$('count-in').checked = false; await app.click('start-practice'); await app.until(() => app.document.body.dataset.screen === 'stage' && !app.$('play-button').disabled);
    const key = app.$('keyboard').querySelector('[data-midi="60"]'); app.emit(key, 'pointerdown', {pointerId: 8, button: 0}); app.emit(key, 'pointerup', {pointerId: 8}); await app.click('back-to-library');
    const beforeScore = await app.exported('export-button'), beforeTakes = await app.exported('export-takes'), preview = app.$('song-lobby').dataset.previewId; assert.ok(beforeTakes.passes[0].inputs.length);
    await app.click('start-free-practice'); await app.click('free-sound'); await app.click('free-start'); app.emit(app.$('free-practice-title'), 'keydown', {code: 'KeyR', key: 'r'}); app.emit(app.$('free-practice-title'), 'keyup', {code: 'KeyR', key: 'r'}); await app.click('free-stop'); await app.click('free-save'); await app.until(() => app.$('free-save-status').textContent.includes('Saved') && app.$('free-practice-screen').getAttribute('aria-busy') === 'false');
    const saved = await app.exported('free-export-record'); await app.click('free-start'); app.emit(app.$('free-practice-title'), 'keydown', {code: 'KeyZ', key: 'z'}); app.emit(app.$('free-practice-title'), 'keyup', {code: 'KeyZ', key: 'z'}); await app.click('free-stop'); const draft = await app.exported('free-export-draft'); await app.click('free-exit');
    const requests = server.requests.length, audio = app.audio(); await open(app); await view(app, 'duplicates'); await view(app, 'unfiled'); await app.click('management-refresh'); await settled(app); await app.click('management-close');
    assert.deepEqual(await app.exported('export-button'), beforeScore); assert.deepEqual(await app.exported('export-takes'), beforeTakes); assert.equal(app.$('song-lobby').dataset.previewId, preview); assert.deepEqual(app.audio(), audio);
    assert.ok(server.requests.slice(requests).every(row => row.path === '/api/library/manage/query'));
    await app.click('start-free-practice'); assert.deepEqual(await app.exported('free-export-draft'), draft); assert.deepEqual(await app.exported('free-export-record'), saved); assert.equal(app.openedDatabases.includes('worldmusichub.scores.v1'), false);
  } finally { await app.close(); }
});

test('Escape, close and rapid reopen discard stale reads; query errors remain localized with original details', async () => {
  const server = await managementServer(), gate = deferred(), app = await nativeStorageApp(server); let first = true;
  try {
    await ready(app); server.setManagementRoute(async request => { if (first) { first = false; await gate.promise; } return nativeResponse(server.fixture.query(request.body)); });
    await app.click('library-management-button'); await app.until(() => server.queryRequests.length === 1); app.emit(app.$('library-management-dialog'), 'cancel'); assert.equal(app.$('library-management-dialog').open, false);
    await open(app); const snapshot = app.$('management-rows').textContent; gate.resolve(); await app.tick(); assert.equal(app.$('management-rows').textContent, snapshot);
    getAppI18n(app.document).setLocale('zh-CN'); server.setManagementRoute(() => nativeResponse({code: 'library_unavailable', error: 'Authored English diagnostic <script>ignored</script>'}, 503));
    await app.click('management-refresh'); await app.until(() => app.$('library-management-dialog').dataset.phase === 'error'); assert.match(app.$('management-error').firstElementChild.textContent, /无法读取曲库/); assert.match(app.$('management-error').querySelector('details').textContent, /Authored English diagnostic/); assert.equal(app.$('management-error').querySelector('script'), null); assert.match(app.$('management-status').textContent, /可能已过期/);
    server.setManagementRoute(null); await app.click('management-refresh'); await settled(app); assert.equal(app.$('management-error').hidden, true);
  } finally { gate.resolve(); await app.close(); }
});

test('an older native app shows an honest unsupported state and sends no management request', async () => {
  const server = await nativeScoreServer(), app = await nativeStorageApp(server);
  try { await ready(app); await app.click('library-management-button'); await app.until(() => app.$('library-management-dialog').dataset.phase === 'error'); assert.match(app.$('management-error').textContent, /requires a native app with library query support/); assert.equal(server.requests.some(row => row.path === '/api/library/manage/query'), false); assert.equal(app.openedDatabases.includes('worldmusichub.scores.v1'), false); }
  finally { await app.close(); }
});

test('pending assessment remains owned by the existing practice pass during management queries', async () => {
  const server = await managementServer(), gate = deferred(); let assessing = false;
  server.setExtraRoute(async ({path}) => {
    if (path === '/api/assess') { assessing = true; await gate.promise; return nativeResponse({hits: [], misses: [], extras: [], accuracy_percent: 0, mean_abs_error_ms: null}); }
  });
  let now = 10000; const app = await nativeStorageApp(server, {now: () => now});
  try {
    await ready(app); app.$('count-in').checked = false; await app.click('start-practice'); await app.until(() => app.document.body.dataset.screen === 'stage' && !app.$('play-button').disabled); await app.click('play-button');
    await app.click('assess-button'); now += 1000; app.frame(); await app.until(() => assessing); await app.click('back-to-library');
    const before = await app.exported('export-takes'); assert.equal(app.$('assess-button').disabled, true);
    await open(app); await view(app, 'songs'); await app.click('management-close'); assert.deepEqual(await app.exported('export-takes'), before); assert.equal(app.$('assess-button').disabled, true);
    gate.resolve(); await app.until(() => !app.$('feedback-results').hidden && !app.$('assess-button').disabled); assert.equal(server.requests.filter(row => row.path === '/api/assess').length, 1);
  } finally { gate.resolve(); await app.close(); }
});

test('failed export keeps exact selection, blocks duplicate submits and permits an explicit retry', async () => {
  const server = await managementServer(), gate = deferred(); let fail = true;
  server.setExtraRoute(async ({path}) => { if (path === '/api/library/pack/export' && fail) { await gate.promise; return nativeResponse({code: 'library_io', error: 'Authored export read failure'}, 500); } });
  const app = await nativeStorageApp(server);
  try {
    await ready(app); await open(app); await view(app, 'songs'); select(app, app.$('management-rows').querySelector('[data-management-edition]'), true);
    app.$('management-export-legacy').click(); app.$('management-export-legacy').click(); await app.until(() => server.requests.filter(row => row.path === '/api/library/pack/export').length === 1); gate.resolve();
    await app.until(() => !app.$('management-export-legacy').disabled); assert.match(app.$('management-selected').textContent, /1 editions selected/); assert.match(app.$('management-error').textContent, /Authored export read failure/); assert.equal(app.downloads.length, 0);
    fail = false; await app.click('management-export-legacy'); await app.until(() => app.downloads.length === 1); assert.equal(server.requests.filter(row => row.path === '/api/library/pack/export').length, 2);
  } finally { gate.resolve(); await app.close(); }
});

test('actual Rust responses render all views, including conflict issues without a fabricated song membership', async () => {
  const {readFile} = await import('node:fs/promises');
  const samples = JSON.parse(await readFile(new URL('./fixtures/library-management/native-query-responses.json', import.meta.url), 'utf8'));
  const server = await managementServer(); server.setManagementRoute(({body}) => nativeResponse(samples[body.view]));
  const app = await nativeStorageApp(server);
  try {
    await ready(app); await open(app); assert.equal(app.document.querySelectorAll('[data-management-pack-row]').length, 3);
    await view(app, 'songs'); assert.equal(songRows(app).length, 1); assert.match(app.$('management-rows').textContent, /Original <inert> song/); assert.equal(app.$('management-rows').querySelector('inert'), null);
    await view(app, 'duplicates'); assert.match(app.$('management-rows').textContent, /Already reuses one stored edition/);
    await view(app, 'issues'); assert.match(app.$('management-rows').textContent, /remains conflict; no membership was inferred/); assert.equal(songRows(app).length, 0);
  } finally { await app.close(); }
});

test('closing and reopening owns a new export; an older response cannot download or replace new status', async () => {
  const server = await managementServer(), old = deferred(), current = deferred(); let count = 0;
  server.setExtraRoute(async ({path}) => {
    if (path !== '/api/library/pack/export') return;
    const index = count++; await (index === 0 ? old.promise : current.promise);
    return {...nativeResponse({}), blob: async () => new Blob([index === 0 ? 'abandoned old export' : 'current exact export'])};
  });
  const app = await nativeStorageApp(server);
  try {
    await ready(app); await open(app); await view(app, 'songs'); select(app, app.$('management-rows').querySelector('[data-management-edition]'), true);
    await app.click('management-export-legacy'); await app.until(() => count === 1);
    const originalRequest = server.requests.find(row => row.path === '/api/library/pack/export'); assert.deepEqual(originalRequest.body.keys, [server.fixture.songs[0].key]);
    await app.click('management-close'); assert.equal(originalRequest.options.signal.aborted, true); await open(app); assert.match(app.$('management-selected').textContent, /0 editions selected/);
    select(app, app.$('management-rows').querySelectorAll('[data-management-edition]')[1], true); await app.click('management-export-clean'); await app.until(() => count === 2);
    old.resolve(); await app.tick(); await app.tick(); assert.equal(app.downloads.length, 0); assert.match(app.$('management-status').textContent, /Preparing a complete export/); assert.equal(app.$('management-export-clean').disabled, true);
    current.resolve(); await app.until(() => app.downloads.length === 1); assert.equal(await app.downloads[0].text(), 'current exact export'); assert.match(app.$('management-status').textContent, /Download requested/);
    assert.deepEqual(server.requests.filter(row => row.path === '/api/library/pack/export')[1].body.keys, [server.fixture.songs[1].key]);
  } finally { old.resolve(); current.resolve(); await app.close(); }
});

for (const action of ['view', 'search', 'destroy']) test(`changing ${action} cancels an export and discards its late result`, async () => {
  const server = await managementServer(), gate = deferred(); let requested = false;
  server.setExtraRoute(async ({path}) => { if (path === '/api/library/pack/export') { requested = true; await gate.promise; return {...nativeResponse({}), blob: async () => new Blob(['must not download'])}; } });
  const app = await nativeStorageApp(server); let closed = false;
  try {
    await ready(app); await open(app); await view(app, 'songs'); select(app, app.$('management-rows').querySelector('[data-management-edition]'), true); await app.click('management-export-legacy'); await app.until(() => requested);
    const request = server.requests.find(row => row.path === '/api/library/pack/export');
    if (action === 'view') await view(app, 'packs');
    else if (action === 'search') { app.$('management-search').value = 'unfiled'; app.emit(app.$('management-search-form'), 'submit'); await settled(app); }
    else { await app.close(); closed = true; }
    assert.equal(request.options.signal.aborted, true); gate.resolve(); await app.tick(); await app.tick(); assert.equal(app.downloads.length, 0);
    if (!closed) { assert.doesNotMatch(app.$('management-status').textContent, /Download requested/); assert.equal(app.$('management-error').hidden, true); }
  } finally { gate.resolve(); if (!closed) await app.close(); }
});

test('a queued native close event cannot cancel or overwrite a reopened dialog session', async () => {
  const server = await managementServer(), app = await nativeStorageApp(server);
  try {
    await ready(app); await open(app); const dialog = app.$('library-management-dialog');
    dialog.close = function () { this.open = false; };
    await app.click('management-close'); await open(app); assert.equal(dialog.dataset.phase, 'ready');
    app.emit(dialog, 'close'); assert.equal(dialog.open, true); assert.equal(dialog.dataset.phase, 'ready');
    await view(app, 'songs'); select(app, app.$('management-rows').querySelector('[data-management-edition]'), true); assert.equal(app.$('management-export-legacy').disabled, false);
  } finally { await app.close(); }
});

test('native unresolved and retained-only packs stay visible with localized evidence and linked original issues', async () => {
  const {readFile} = await import('node:fs/promises');
  const samples = JSON.parse(await readFile(new URL('./fixtures/library-management/native-recovery-responses.json', import.meta.url), 'utf8'));
  const unresolved = samples.packs.rows.find(row => row.provenance === 'unresolved'), unsupported = samples.packs.rows.find(row => row.retained_only_count > 0);
  const server = await managementServer(); server.setManagementRoute(({body}) => nativeResponse(body.view === 'issues' && body.pack_id === unresolved.pack_id ? samples.unresolved_issues : body.view === 'issues' && body.pack_id === unsupported.pack_id ? samples.unsupported_issues : samples[body.view]));
  const app = await nativeStorageApp(server);
  try {
    await ready(app); await open(app); assert.equal(app.document.querySelectorAll('[data-management-pack-row]').length, samples.packs.rows.length); assert.equal(app.$('management-error').hidden, true);
    const row = () => app.document.querySelector(`[data-management-pack-row="${unresolved.pack_id}"]`);
    assert.equal(row().dataset.managementProvenance, 'unresolved'); assert.match(row().textContent, /song memberships are unresolved/); assert.doesNotMatch(row().textContent, /Read-only grouping from verified import records/);
    getAppI18n(app.document).setLocale('zh-CN'); assert.match(row().textContent, /乐曲归属尚未确认/); assert.doesNotMatch(row().textContent, /按已验证导入记录建立/);
    row().lastElementChild.click(); await settled(app); assert.equal(server.queryRequests.at(-1).body.pack_id, unresolved.pack_id); assert.equal(app.document.querySelectorAll('[data-management-issue]').length, samples.unresolved_issues.rows.length); assert.match(app.$('management-rows').textContent, /no validated complete import receipt/); assert.equal(app.$('management-selection').hidden, true); assert.equal(app.$('management-rows').querySelectorAll('input[type="checkbox"]').length, 0);
    await view(app, 'packs'); app.document.querySelector(`[data-management-pack-row="${unsupported.pack_id}"]`).lastElementChild.click(); await settled(app);
    assert.equal(server.queryRequests.at(-1).body.pack_id, unsupported.pack_id); assert.equal(app.document.querySelectorAll('[data-management-issue]').length, samples.unsupported_issues.rows.length);
    for (const issue of samples.unsupported_issues.rows) assert.ok(app.$('management-rows').textContent.includes(issue.message));
    assert.match(app.$('management-rows').textContent, /song\/metadata.json/); assert.equal(app.$('management-selection').hidden, true); assert.equal(songRows(app).length, 0);
    await view(app, 'songs'); assert.equal(songRows(app).length, samples.songs.rows.length); assert.ok(samples.songs.rows.every(song => !song.pack_ids.includes(unresolved.pack_id) && !song.pack_ids.includes(unsupported.pack_id)));
    assert.deepEqual(getAppI18n(app.document).getReports(), []);
  } finally { await app.close(); }
});

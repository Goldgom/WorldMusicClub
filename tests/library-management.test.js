import test from 'node:test';
import assert from 'node:assert/strict';
import {openScoreStorage} from '../web/native-score-storage.js';
import {managementRequest, checkedManagementResponse} from '../web/library-management-contract.js';
import {LibraryManagementModel} from '../web/library-management-model.js';
import {managementFixture, managementServer, songRow} from './library-management-fixtures.js';
import {nativeResponse, deferred} from './native-storage-app-fixtures.js';

const origin = 'https://wmh.localhost';
const health = {name: 'WorldMusicHub', engine: 'rust', network: 'native-protocol-no-listener', score_format_version: 1, library_management_query_version: 1};
const fixtureStorage = fixture => ({info: {kind: 'native', capabilities: {manageQuery: true}}, queryManagement: async options => fixture.query(options)});

test('native management negotiates explicit capability and uses strict same-origin metadata-only POST', async () => {
  const server = await managementServer();
  const storage = await openScoreStorage({origin, fetcher: server.fetcher, openBrowserLibrary: () => { throw Error('No IDB fallback'); }});
  assert.equal(storage.info.capabilities.manageQuery, true);
  const result = await storage.queryManagement({view: 'songs', refresh: true});
  assert.equal(result.rows[0].pack_count, 2); assert.equal(result.rows.filter(row => row.edition_id === result.rows[0].edition_id).length, 1);
  const call = server.queryRequests[0]; assert.equal(call.options.method, 'POST'); assert.equal(call.options.credentials, 'same-origin'); assert.equal(call.options.redirect, 'error'); assert.equal(call.options.cache, 'no-store'); assert.equal(call.body.refresh, true);
  assert.deepEqual(server.requests.map(row => row.path), ['/api/health', '/api/library/manage/query']);
});

test('older native and browser environments cannot query management or silently switch to IDB', async () => {
  for (const network of ['native-protocol-no-listener', 'loopback-only']) {
    let opens = 0; const calls = [];
    const storage = await openScoreStorage({origin, fetcher: async path => { calls.push(path); return nativeResponse({...health, network, library_management_query_version: undefined}); }, openBrowserLibrary: async () => { opens++; return {close() {}}; }});
    assert.equal(storage.info.capabilities.manageQuery, false);
    await assert.rejects(storage.queryManagement(), {code: 'library_management_unavailable'});
    assert.deepEqual(calls, ['/api/health']); assert.equal(opens, network === 'loopback-only' ? 1 : 0);
  }
});

test('query validation rejects malformed keys, excessive Unicode search, cursors and unknown actions before I/O', async () => {
  for (const input of [{view: 'trash'}, {pack_id: '../private'}, {search: '汉'.repeat(86)}, {limit: 101}, {refresh: true, cursor: 'page'}, {cursor: ''}, {action: 'delete'}, {unfiled: 'true'}]) assert.throws(() => managementRequest(input), {code: 'library_management_invalid_query'});
  assert.equal(managementRequest({search: '汉'.repeat(85)}).search.length, 85);
});

test('adapter rejects corrupt, cross-view and over-limit responses and retains typed source diagnostics', async () => {
  const fixture = managementFixture(), request = managementRequest({view: 'songs'}), response = fixture.query(request);
  for (const change of [value => { value.version = 2; }, value => { value.view = 'issues'; }, value => { value.rows.push(value.rows[0]); }, value => { value.rows[0].edition_id = 'clean:' + value.rows[0].key; }, value => { value.rows[0].pack_count = 0; }, value => { value.rows[0].packs = []; }, value => { value.freshness.change_detection = 'live'; }, value => { value.summary.songs = -1; }, value => { value.next_cursor = {}; }]) {
    const broken = structuredClone(response); change(broken); assert.throws(() => checkedManagementResponse(broken, request), {code: 'library_management_invalid_response'});
  }
  const adapter = await openScoreStorage({origin, fetcher: async path => path === '/api/health' ? nativeResponse(health) : nativeResponse({code: 'library_snapshot_stale', error: 'Original diagnostic'}, 409)});
  await assert.rejects(adapter.queryManagement(), error => error.code === 'library_snapshot_stale' && error.message === 'Original diagnostic');
  const foreign = await openScoreStorage({origin, fetcher: async path => path === '/api/health' ? nativeResponse(health) : {...nativeResponse(response), url: 'https://foreign.invalid/api/library/manage/query'}});
  await assert.rejects(foreign.queryManagement(request), {code: 'library_environment_unknown'});
});

test('read model preserves view selection across pages, clears on query changes, and never selects future matches', async () => {
  const fixture = managementFixture({many: 82}), calls = [], storage = fixtureStorage(fixture);
  const model = new LibraryManagementModel({getStorage: async () => ({...storage, queryManagement: async value => { calls.push(value); return storage.queryManagement(value); }})});
  await model.setView({view: 'songs'}); model.selectPage(true); assert.equal(model.snapshot().selected.length, 40);
  await model.next(); assert.equal(model.snapshot().page, 1); assert.equal(model.snapshot().response.rows.length, 40); assert.equal(model.snapshot().selected.length, 40);
  model.toggle(model.snapshot().response.rows[0], true); assert.equal(model.snapshot().selected.length, 41);
  model.clearSelection({hiddenOnly: true}); assert.equal(model.snapshot().selected.length, 1);
  await model.previous(); assert.equal(model.snapshot().selected.length, 1); assert.ok(calls.every(call => call.refresh === false));
  await model.setView({unfiled: true}); assert.equal(model.snapshot().selected.length, 0);
  model.selectPage(true); fixture.songs.push(songRow('new-after-selection')); await model.refresh(); assert.equal(model.snapshot().selected.length, 0); assert.equal(calls.at(-1).refresh, true);
});

test('late reads, closing and newer navigation cannot replace the latest metadata view', async () => {
  const fixture = managementFixture(), gate = deferred(), calls = [];
  const storage = fixtureStorage(fixture); storage.queryManagement = async query => { calls.push(query); if (query.view === 'packs') await gate.promise; return fixture.query(query); };
  const model = new LibraryManagementModel({getStorage: async () => storage});
  const pending = model.refresh(); await Promise.resolve(); await model.setView({view: 'songs'}); gate.resolve(); assert.equal(await pending, false); assert.equal(model.snapshot().response.view, 'songs'); assert.equal(calls[0].signal.aborted, true);
  const nextGate = deferred(); storage.queryManagement = async query => { await nextGate.promise; return fixture.query(query); };
  const closing = model.refresh(); await Promise.resolve(); model.close(); const before = model.snapshot(); nextGate.resolve(); assert.equal(await closing, false); assert.deepEqual(model.snapshot(), before);
});

test('an import during a query stays stale until explicit verified refresh; cached filters cannot conceal it', async () => {
  const fixture = managementFixture(), gate = deferred(), storage = fixtureStorage(fixture), original = storage.queryManagement;
  const model = new LibraryManagementModel({getStorage: async () => storage}); await model.setView({view: 'songs'}); model.selectPage(true);
  storage.queryManagement = async query => { await gate.promise; return original(query); };
  const read = model.refresh(); await Promise.resolve(); model.invalidate(); gate.resolve(); await read;
  assert.equal(model.snapshot().stale, true); assert.equal(model.snapshot().selected.length, 0); model.selectPage(true); assert.equal(model.snapshot().selected.length, 0);
  await model.setView({unfiled: true}); assert.equal(model.snapshot().stale, true);
  await model.refresh(); assert.equal(model.snapshot().stale, false);
});

test('snapshot changes and failed refreshes keep earlier data visibly stale without enabling selection', async () => {
  const fixture = managementFixture({many: 44}), storage = fixtureStorage(fixture), model = new LibraryManagementModel({getStorage: async () => storage});
  await model.setView({view: 'songs'}); fixture.query({view: 'packs', refresh: true});
  assert.equal(await model.next(), false); assert.equal(model.snapshot().error.code, 'library_snapshot_stale'); assert.equal(model.snapshot().stale, true);
  storage.queryManagement = async () => { throw Object.assign(Error('Authored scan error'), {code: 'library_unavailable'}); };
  assert.equal(await model.refresh(), false); assert.equal(model.snapshot().response.rows.length, 40); assert.equal(model.snapshot().stale, true); model.selectPage(true); assert.equal(model.snapshot().selected.length, 0);
});

test('all four actual Rust-emitted original-fixture responses pass the renderer contract unchanged', async () => {
  const {readFile} = await import('node:fs/promises');
  const samples = JSON.parse(await readFile(new URL('./fixtures/library-management/native-query-responses.json', import.meta.url), 'utf8'));
  for (const view of ['packs', 'songs', 'duplicates', 'issues']) {
    const adapter = await openScoreStorage({origin, fetcher: async path => path === '/api/health' ? nativeResponse(health) : nativeResponse(samples[view])});
    assert.deepEqual(await adapter.queryManagement({view}), samples[view]);
  }
  assert.equal(samples.songs.rows.length, 1); assert.equal(samples.songs.rows[0].pack_count, 2);
  assert.equal(samples.duplicates.rows[0].evidence_type, 'shared_edition'); assert.equal(samples.issues.rows[0].song_key, null);
});

test('a failed filtered query cannot erase the pending-import freshness warning', async () => {
  const fixture = managementFixture(), storage = fixtureStorage(fixture), model = new LibraryManagementModel({getStorage: async () => storage});
  await model.setView({view: 'songs'}); model.invalidate(); const original = storage.queryManagement;
  storage.queryManagement = async () => { throw Error('Temporary query failure'); };
  await model.setView({search: 'authored'}); assert.equal(model.snapshot().stale, true);
  storage.queryManagement = original; await model.setView({search: ''}); assert.equal(model.snapshot().stale, true);
  model.selectPage(true); assert.equal(model.snapshot().selected.length, 0);
  await model.refresh(); assert.equal(model.snapshot().stale, false);
});

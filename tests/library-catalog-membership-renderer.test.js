// Production DOM and original contract fixtures only. Input and geometry here
// are synthetic; the same helper still requires real hosted/Windows evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import {membershipPackServer} from './library-pack-membership-fixtures.js';
import {customPackId} from './library-user-pack-fixtures.js';
import {nativeStorageApp} from './native-storage-app-fixtures.js';
import {catalogAcceptanceRendererHelpers} from './catalog-acceptance-renderer-helpers.js';
import {LIBRARY_OPERATION_STORAGE_KEY} from '../web/library-operation-store.js';
const helpers = await catalogAcceptanceRendererHelpers();

test('shared membership acceptance helper drives removal, cache-free recovery, uncertain move, exact Undo and conflict through production controls', async () => {
  const server = await membershipPackServer(), source = customPackId(0), selected = server.rows.slice(0, 2), values = new Map(), calls = [], actions = [];
  server.packs.delete(customPackId(1)); server.packs.get(source).name = 'rr';
  for (const row of selected) { row.packs.push({...server.packs.get(source)}); row.pack_count++; }
  let lost = false, app;
  server.setMembershipRoute(async request => { const reply = await request.proceed(), response = await reply.json(); calls.push({path: request.path, request: request.body, response}); if (lost && request.path.endsWith('/commit')) { lost = false; throw Error('Original shared-helper lost commit reply'); } return reply; });
  const transport = {arm(mode) { assert.equal(mode.kind, 'lose-after'); assert.equal(lost, false); lost = true; }};
  const cat = id => app.$(`management-catalog-${id}`), operation = () => Object.values(JSON.parse(values.get(LIBRARY_OPERATION_STORAGE_KEY) || '{"libraries":{}}').libraries)[0] || null;
  const query = async view => (await server.fetcher('/api/library/catalog/query', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({view, limit: 100, refresh: true})})).json();
  const ready = () => app.until(() => app.$('management-catalog').dataset.phase === 'ready');
  async function launch() {
    app = await nativeStorageApp(server, {storageValues: values}); await app.until(() => !app.$('start-listen').disabled); await app.click('home-single-player');
    app.window.HTMLElement.prototype.focus = function() { Object.defineProperty(app.document, 'activeElement', {configurable: true, value: this}); };
    app.window.HTMLElement.prototype.scrollIntoView = function() {};
    cat('review-title').getBoundingClientRect = () => ({top: 16, bottom: 44, width: 400, height: 28});
    await app.click('library-management-button'); await app.until(() => !app.$('management-catalog-button').hidden); await app.click('management-catalog-button'); await ready();
  }
  async function input(kind, node) {
    assert.ok(node && !node.disabled, `Unavailable ${node?.id}`); const sequence = actions.length + 1; actions.push({sequence, kind, control: node.id}); node.focus(); node.click();
    if (kind === 'key-r') { assert.equal(node.value, '', 'Destination typing must start fresh and use only one native action'); node.value += 'r'; app.emit(node, 'input'); }
    else if (['select-last', 'select-second'].includes(kind)) { node.value = kind === 'select-last' ? [...node.options].at(-1).value : node.options[1].value; app.emit(node, 'change'); }
    else assert.equal(kind, 'click');
    if (node.type === 'checkbox') { node.checked = !node.checked; app.emit(node, 'change'); }
    if (node.type === 'submit') app.emit(node.closest('form'), 'submit');
    if (node.tagName === 'SUMMARY' && node.parentNode.tagName === 'DETAILS') node.parentNode.open = !node.parentNode.open;
    await app.tick(); return sequence;
  }
  const args = () => ({document: app.document, native: input, until: app.until, query, operation, apiLast: path => calls.filter(row => row.path === path).at(-1)?.response, screenshot: async (_name, node) => input('click', node), selected: selected.map(({edition_id, title}) => ({edition_id, title})), sourcePackId: source, clearRecovery: () => values.delete(LIBRARY_OPERATION_STORAGE_KEY), transport, viewport: {width: 1280, height: 720}});
  async function filter() { cat('filter').value = source; app.emit(cat('filter'), 'change'); await ready(); }
  try {
    await launch(); await filter(); const removed = await helpers.runCatalogMembershipAcceptance({...args(), stage: 'remove'}); assert.equal(operation(), null); assert.equal(removed.records.remove_before_restart.kind, 'remove_memberships'); assert.equal(actions.length, 5);
    await app.close(); app = null; await launch(); const recovered = await helpers.runCatalogMembershipAcceptance({...args(), stage: 'recover'}); assert.equal(recovered.discovery.local_record, null); assert.equal(recovered.records.undo_after_restart.kind, 'undo_memberships');
    await filter(); const before = actions.length, finished = await helpers.runCatalogMembershipAcceptance({...args(), stage: 'exercise', output: recovered}); assert.equal(actions.length - before, 26);
    assert.deepEqual(actions.slice(before).filter(row => row.kind === 'key-r').map(({kind, control}) => ({kind, control})), [{kind: 'key-r', control: 'management-catalog-create-name'}]);
    assert.equal(finished.records.create_destination.preview.request.action.name, 'r'); assert.equal(server.packs.get(source).name, 'rr');
    assert.equal(finished.uncertain.before.operation_id, finished.uncertain.after.operation_id); assert.equal(finished.conflict.disabled, true); assert.equal(finished.conflict.status.membership_undo.can_undo, false);
    const destination = finished.records.create_destination.preview.request.action.pack_id;
    assert.notEqual(destination, source); assert.equal(server.packs.get(destination).name, 'r');
    assert.ok(selected.every(row => row.packs.some(pack => pack.collection_id === source))); assert.equal(selected[0].packs.some(pack => pack.collection_id === destination), true); assert.equal(selected[1].packs.some(pack => pack.collection_id === destination), false);
    assert.equal(calls.filter(row => row.path.endsWith('/commit')).length, 8); assert.equal(server.history.size, 8);
  } finally { await app?.close(); }
});

test('membership destination typing rejects a stale name or a key action that does not produce exactly r', async () => {
  for (const [initial, typed] of [['r', 'r'], ['', ''], ['', 'rr'], ['', 'R']]) {
    let value = initial, keys = 0;
    const sourcePackId = customPackId(0), nodes = {
      'management-catalog-filter': {value: sourcePackId},
      'management-catalog-organize': {open: true},
      'management-catalog-create-name': {get value() { return value; }},
    };
    await assert.rejects(helpers.runCatalogMembershipAcceptance({stage: 'exercise', sourcePackId, selected: [], document: {getElementById: id => nodes[id]}, native: async (kind, node) => {
      assert.equal(kind, 'key-r'); assert.equal(node, nodes['management-catalog-create-name']); keys++; value = typed;
    }}), initial ? /name input must be fresh/ : /exactly one real keyboard action/);
    assert.equal(keys, initial ? 0 : 1);
  }
});

test('destination selection proof accepts the distinct r and rr names and rejects the retired rrr label', () => {
  const destination = customPackId(1), control = 'management-catalog-move-target';
  const action = {kind: 'select-last', control, trusted_clicks: 1, untrusted_clicks: 0, selection: {target_id: control, target_tag: 'SELECT', before: '', after: destination, option_values: ['', destination], selected_index: 1, selected_text: '', trusted_changes: 1, untrusted_changes: 0, events: [{type: 'click', trusted: true, target_id: control, value: ''}, {type: 'input', trusted: true, target_id: control, value: destination}, {type: 'change', trusted: true, target_id: control, value: destination}]}};
  for (const name of ['r', 'rr']) { action.selection.selected_text = `${name} · ${destination}`; assert.equal(helpers.catalogTrustedActionComplete(action), true); }
  action.selection.selected_text = `rrr · ${destination}`; assert.equal(helpers.catalogTrustedActionComplete(action), false);
});

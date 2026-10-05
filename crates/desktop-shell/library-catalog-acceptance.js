/* ORIGINAL-only renderer contract shared by hosted Chromium and Windows WebView2.
 * The host supplies real trusted input, real native replies and a private profile.
 * Faults lose/delay actual transport replies; they never manufacture success. */
function createCatalogAcceptanceTransport({fetcher, digest, origin, limit = 128, getActionSequence = () => 0}) {
  const rows = [], faults = []; let mode = null, held = null, dispatchOrder = 0, eventOrder = 0;
  const pathOf = input => new URL(String(input), origin).pathname;
  const tracked = path => path.startsWith('/api/library/catalog/') || path.startsWith('/api/library/import/') || ['/api/library/list', '/api/library/manage/query', '/api/library/pack/export', '/api/assess'].includes(path);
  const text = value => value === undefined ? '' : typeof value === 'string' ? value : JSON.stringify(value);
  async function send(input, options = {}, source = 'app') {
    const path = pathOf(input);
    if (!tracked(path)) return fetcher(input, options);
    if (rows.length >= limit) throw Error('Catalog native API evidence exceeded its finite bound');
    const body = options.body === undefined ? new Uint8Array() : typeof options.body === 'string' ? new TextEncoder().encode(options.body) : new Uint8Array(await new Response(options.body).arrayBuffer());
    if (rows.length >= limit) throw Error('Catalog native API evidence exceeded its finite bound');
    const contentType = new Headers(options.headers).get('content-type') || '', isJson = contentType.includes('json');
    const requestText = isJson ? new TextDecoder().decode(body) : '';
    const row = {sequence: rows.length + 1, action_sequence: getActionSequence(), source, path, method: options.method || 'GET', request: isJson && requestText ? JSON.parse(requestText) : null, request_text: isJson ? requestText : '', ...(!isJson && body.length ? {request_base64: btoa(Array.from(body, byte => String.fromCharCode(byte)).join(''))} : {}), request_sha256: null, dispatched: true, delivery: 'forwarded', status: null, response: null, response_text: null, response_sha256: null};
    rows.push(row); row.request_sha256 = await digest(body);
    let sent = options, fault = null;
    if (path === '/api/library/catalog/commit' && ['lose-before', 'lose-after'].includes(mode?.kind)) {
      fault = mode; mode = null; row.delivery = fault.kind === 'lose-before' ? 'lost-before-native' : 'lost-after-native';
      faults.push({kind: row.delivery, sequence: row.sequence, operation_id: row.request.preview.request.operation_id});
      if (fault.kind === 'lose-before') { row.dispatched = false; throw Error('ORIGINAL acceptance transport loss before native dispatch'); }
    }
    if (path === '/api/library/catalog/operation' && mode?.kind === 'wrong-operation') {
      fault = mode; mode = null; row.delivery = 'wrong-operation-read';
      row.wire_request = {...row.request, operation_id: fault.operation_id}; row.wire_request_text = text(row.wire_request); row.wire_request_sha256 = await digest(new TextEncoder().encode(row.wire_request_text));
      sent = {...options, body: row.wire_request_text};
      faults.push({kind: row.delivery, sequence: row.sequence, requested_operation_id: row.request.operation_id, actual_operation_id: fault.operation_id});
    }
    if (path === '/api/library/catalog/query' && mode?.kind === 'defer-query') {
      fault = mode; mode = null; row.delivery = 'deferred-read';
    }
    row.dispatch_order = ++dispatchOrder; row.dispatch_event = ++eventOrder;
    const response = await fetcher(input, sent);
    if (path === '/api/library/pack/export' && response.status === 200) {
      const bytes = new Uint8Array(await response.clone().arrayBuffer());
      row.status = response.status; row.response_binary_bytes = bytes.length; row.response_sha256 = await digest(bytes); row.response_event = ++eventOrder;
      return response;
    }
    const responseText = await response.clone().text();
    row.status = response.status; row.response_text = responseText; row.response_sha256 = await digest(new TextEncoder().encode(responseText));
    row.response = JSON.parse(responseText); row.response_event = ++eventOrder;
    if (fault?.kind === 'lose-after') throw Error('ORIGINAL acceptance transport loss after durable native commit');
    if (fault?.kind === 'defer-query') {
      let release; const gate = new Promise(resolve => { release = resolve; }); held = {row, release};
      faults.push({kind: 'deferred-read', sequence: row.sequence}); await gate; row.delivery_complete = true; row.release_event = ++eventOrder; held = null;
    }
    return response;
  }
  return {rows, faults, fetcher: send, probe: (path, body) => send(path, body === undefined ? {} : {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)}, 'probe'), arm(value) { if (mode || held) throw Error('Overlapping catalog transport faults'); mode = value; }, held: () => held, release() { if (!held) throw Error('No held catalog query'); held.release(); }, stop() { held?.release(); mode = null; }};
}

function catalogPracticeBaselineReady(document) {
  const result = document.getElementById('result-summary');
  return result && ['assessed', 'review'].includes(result.dataset.phase) && result.dataset.revision === result.dataset.assessedRevision && !document.getElementById('assess-button').disabled && document.getElementById('retry-assessments').hidden && !document.getElementById('feedback-results').hidden;
}

// JSON object member order is not a protocol. Native serde_json may sort keys;
// the duplicate-import exercise requires legacy before its shared archive.
function catalogSeedImportFilenames(spec) {
  return [spec.filenames.legacy, spec.filenames.shared, spec.filenames.clean];
}

function catalogAcceptanceEqual(left, right) {
  const sorted = value => Array.isArray(value) ? value.map(sorted) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, sorted(value[key])])) : value;
  return JSON.stringify(sorted(left)) === JSON.stringify(sorted(right));
}

// The exact UI sequence is also run against the real Rust stdin adapter in Node.
// Only native() differs: real acceptance supplies trusted OS/browser input.
async function runCatalogUserPackAcceptance({document, native, until, query, operation, apiLast, download, screenshot, selected, prior = null, viewport, assert = (value, message) => { if (!value) throw Error(message); }}) {
  const cat = id => document.getElementById(`management-catalog-${id}`), clone = value => structuredClone(value);
  const output = {review_focus: []}, files = {};
  const ready = () => until(() => document.getElementById('management-catalog').dataset.phase === 'ready', 'User pack catalog ready');
  async function view(id) { await native('click', cat(id)); await ready(); }
  async function review(id, kind) {
    const actionSequence = await native('click', cat(id)); await until(() => !cat('review').hidden && !cat('confirm').disabled, `User pack ${kind} review`);
    const title = cat('review-title'), rect = title.getBoundingClientRect();
    assert(document.activeElement === title, 'New user-pack review must receive keyboard focus');
    assert(rect.width > 0 && rect.height > 0 && rect.top >= 0 && rect.bottom <= viewport.height, 'New user-pack review title must be visible without an extra navigation click');
    output.review_focus.push({kind, action_sequence: actionSequence, active_element: title.id, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height, viewport: {...viewport}});
  }
  async function confirm(kind) {
    const preview = apiLast('/api/library/catalog/preview'), id = preview.preview.request.operation_id;
    assert(preview.preview.request.action.type === kind, 'Wrong user-pack preview kind');
    await native('click', cat('confirm')); await until(() => operation()?.operation_id === id && operation().phase === 'committed' && document.getElementById('management-catalog').dataset.phase === 'ready', `Durable user-pack ${kind}`);
    return clone(operation());
  }
  let packId;
  if (!prior) {
    if (!cat('organize').open) await native('click', cat('organize').querySelector('summary'));
    assert(cat('create-name').value === '', 'Original create input must start empty'); await native('key-r', cat('create-name')); assert(cat('create-name').value === 'r', 'Create name must come from the real bounded keyboard action');
    await review('create-preview', 'create_pack'); await screenshot('user-pack-empty-review', cat('review-title')); output.create = await confirm('create_pack'); packId = output.create.preview.request.action.pack_id;
    output.empty = await query('packs'); const empty = output.empty.rows.find(row => row.collection_id === packId);
    assert(empty?.kind === 'custom' && empty.import_pack_id === null && empty.name === 'r' && empty.active_song_count === 0 && empty.available_song_count === 0, 'Created empty user pack is missing or misidentified');
    await view('packs'); const rename = cat('rows').querySelector(`[data-catalog-rename-pack="${packId}"]`); assert(rename, 'Empty custom pack needs its real rename control'); await native('click', rename);
    assert(cat('rename-name').value === 'r', 'Rename must target the created name'); await native('key-r', cat('rename-name')); assert(cat('rename-name').value === 'rr', 'Rename must append exactly one real key');
    await review('rename-preview', 'rename_pack'); output.rename = await confirm('rename_pack');
    await view('active');
    for (const song of selected) { const box = cat('rows').querySelector(`[data-catalog-edition="${song.edition_id}"]`); assert(box && !box.disabled && !box.checked, 'Exact user-pack edition is unavailable'); await native('click', box); assert(box.checked, 'Exact selected edition was not checked'); }
    await native('select-last', cat('add-target')); assert(cat('add-target').value === packId, 'Real destination selection differs from the created custom pack');
    await review('add-preview', 'add_memberships'); await screenshot('user-pack-add-review', cat('review-title')); output.add = await confirm('add_memberships');
  } else {
    for (const kind of ['create', 'rename', 'add']) output[kind] = clone(prior[kind]);
    output.empty = null;
    packId = output.create.preview.request.action.pack_id;
  }
  output.packs = await query('packs'); await view('packs');
  const imported = output.packs.rows.filter(row => row.kind === 'imported').map(row => row.collection_id).sort();
  output.readonly = {imported_collection_ids: imported, rename_target_ids: [...cat('rename-target').options].map(row => row.value).filter(Boolean).sort(), add_target_ids: [...cat('add-target').options].map(row => row.value).filter(Boolean).sort(), imported_rename_controls: [...cat('rows').querySelectorAll('[data-catalog-rename-pack]')].map(node => node.dataset.catalogRenamePack).filter(id => imported.includes(id))};
  assert(output.readonly.imported_rename_controls.length === 0 && output.readonly.rename_target_ids.length === 1 && output.readonly.rename_target_ids[0] === packId && output.readonly.add_target_ids.length === 1 && output.readonly.add_target_ids[0] === packId, 'Imported source groups became editable destinations');
  const open = cat('rows').querySelector(`[data-catalog-open-pack="${packId}"]`); assert(open, 'Persisted custom pack has no browse control'); output.filter_action = await native('click', open); await ready();
  assert(cat('filter').value === packId, 'Visible catalog filter differs from the selected collection');
  output.filtered = await query('active', packId); output.visible_editions = [...cat('rows').querySelectorAll('[data-catalog-song]')].map(node => node.dataset.catalogSong).sort();
  assert(catalogAcceptanceEqual(output.visible_editions, selected.map(row => row.edition_id).sort()), 'Pack filter omitted or added an exact edition');
  await screenshot(prior ? 'persisted-user-pack' : 'user-pack-filtered', document.getElementById('management-title'));
  if (!prior) {
    for (const song of selected) await native('click', cat('rows').querySelector(`[data-catalog-edition="${song.edition_id}"]`));
    files.selectedLegacyPack = await download(cat('export-legacy')); files.selectedCleanPack = await download(cat('export-clean'));
  }
  return {organization: output, files};
}

(() => {
  const phase = globalThis.__WMH_ACCEPTANCE_PHASE__, $ = id => document.getElementById(id), assert = (value, message) => { if (!value) throw Error(message); };
  if (!['catalog-seed', 'catalog-restart', 'catalog-final'].includes(phase)) throw Error('Unknown catalog acceptance phase');
  const originalFetch = globalThis.fetch.bind(globalThis), waits = createAcceptanceWait(), until = waits.until;
  const digest = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), value => value.toString(16).padStart(2, '0')).join('');
  const json = (path, options) => waits.json(originalFetch, path, options, 15000);
  const transport = createCatalogAcceptanceTransport({fetcher: originalFetch, digest, origin: location.origin, getActionSequence: () => sequence}); globalThis.fetch = transport.fetcher;
  const report = {version: 1, scenario: 'library-catalog', phase, ok: false, origin: location.origin, checks: [], errors: [], actions: [], screenshots: {}, api_trace: transport.rows, faults: transport.faults, files: {}, profile: {}, operations: {}, catalog: {}, state: {}, media: null, opened_score_databases: [], claims: {synthetic_clock: false, mock_success: false, private_music: false}};
  const storageKey = 'worldmusichub.library-operation.v1', markerKey = 'wmh.catalog.acceptance.owner', organizationKey = 'wmh.catalog.acceptance.organization';
  const operation = () => {
    const value = JSON.parse(localStorage.getItem(storageKey) || '{"libraries":{}}'), records = Object.values(value.libraries);
    assert(records.length <= 1, 'Catalog fixture must own exactly one renderer library pointer'); return records[0] || null;
  };
  const clone = value => structuredClone(value), same = catalogAcceptanceEqual;
  const apiLast = path => transport.rows.filter(row => row.path === path && row.dispatched && row.status === 200).at(-1)?.response;
  const apiCount = path => transport.rows.filter(row => row.path === path).length;
  async function probe(path, body) { const response = await waits.bounded(signal => transport.probe(path, body), `catalog probe ${path}`, 15000); const value = await response.json(); assert(response.ok, `${path}: ${JSON.stringify(value)}`); return value; }
  const cat = id => $(`management-catalog-${id}`), query = (view, collection_id = null) => probe('/api/library/catalog/query', {view, ...(collection_id ? {collection_id} : {}), limit: 100, refresh: true});
  const checked = name => report.checks.push(name);
  let sequence = 0, armed = null, config, spec, mediaStorage;
  const trustedClick = event => { if (armed && (event.target === armed.node || armed.node.contains(event.target))) { armed.row.trusted_clicks += Number(event.isTrusted); if (!event.isTrusted) armed.row.untrusted_clicks++; } };
  const trustedKey = event => { if (armed && event.code === 'KeyR' && event.target === armed.node) armed.row[event.type === 'keydown' ? 'trusted_key_downs' : 'trusted_key_ups'] += Number(event.isTrusted); };
  document.addEventListener('click', trustedClick, true); document.addEventListener('keydown', trustedKey, true); document.addEventListener('keyup', trustedKey, true);
  const originalOpen = IDBFactory.prototype.open;
  IDBFactory.prototype.open = function(name, ...args) { if (String(name) === 'worldmusichub.scores.v1') report.opened_score_databases.push(String(name)); return originalOpen.call(this, name, ...args); };
  addEventListener('error', event => report.errors.push(String(event.message))); addEventListener('unhandledrejection', event => report.errors.push(String(event.reason)));
  async function native(kind, node, file) {
    assert(sequence < 64 && node && !node.disabled, 'Bounded available native catalog control required');
    node.scrollIntoView({block: 'center', inline: 'center'}); node.focus();
    await new Promise(resolve => requestAnimationFrame(resolve));
    const bounds = node.getBoundingClientRect(); assert(bounds.width > 0 && bounds.height > 0 && !node.closest('[hidden]'), 'Catalog target must be visible');
    const collectionId = node.dataset.catalogOpenPack || node.dataset.catalogRenamePack;
    const row = {sequence: ++sequence, kind, control: node.id || (node.dataset.catalogOpenPack ? 'management-catalog-open-pack' : node.dataset.catalogRenamePack ? 'management-catalog-rename-pack' : node.dataset.catalogEdition || node.tagName), ...(collectionId ? {collection_id: collectionId} : {}), trusted_clicks: 0, untrusted_clicks: 0, trusted_key_downs: 0, trusted_key_ups: 0}; report.actions.push(row); armed = {row, node};
    try {
      await json('/__desktop_smoke/action', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({version: 1, sequence, kind, x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2, width: innerWidth, height: innerHeight, ...(file ? {file} : {})})});
      let result;
      await until(async signal => { const response = await originalFetch(`/__desktop_smoke/result/${row.sequence}`, {signal}); if (response.status === 404) return false; result = await response.json(); assert(response.ok && result.ok, result.error || 'Catalog native action failed'); return true; }, `trusted catalog ${kind} ${sequence}`, 15000);
      if (kind !== 'catalog-snapshot-before') { assert(row.trusted_clicks === 1 && row.untrusted_clicks === 0, 'Catalog action lacks exactly one trusted click'); if (kind === 'key-r') assert(row.trusted_key_downs === 1 && row.trusted_key_ups === 1, 'Catalog key input lacks trusted key events'); }
      row.completed = true; return row.sequence;
    } finally { armed = null; }
  }
  const click = id => { assert($(id) && !$(id).disabled, `Unavailable navigation ${id}`); $(id).click(); };
  const closeDialogs = () => { for (const dialog of document.querySelectorAll('dialog[open]')) dialog.close(); };
  const menu = createAcceptanceNavigation({document, until, click});
  const screenshot = async (name, node = $('management-title')) => { report.screenshots[name] = await native('click', node); };
  async function download(node) {
    const count = (await json('/__desktop_smoke/state')).downloads.length; await native('click', node); let row;
    await until(async () => { row = (await json('/__desktop_smoke/state')).downloads[count]; return row?.complete; }, 'Catalog exact download completion', 15000);
    assert(row.success, 'Catalog download did not complete'); return row.file;
  }
  async function choose(filename) {
    closeDialogs(); click('import-tools-button'); const before = apiCount('/api/library/import/commit'), previewBefore = apiCount('/api/library/import/preview');
    await native('picker', $('import-button'), filename);
    await until(() => $('bulk-import-dialog')?.dataset.phase === 'review' && apiCount('/api/library/import/preview') > previewBefore && document.querySelector('[data-import-file][data-phase="ready"]'), 'Catalog ORIGINAL picker preflight');
    await native('click', $('bulk-import-save'));
    await until(() => $('bulk-import-dialog').dataset.phase === 'review' && apiCount('/api/library/import/commit') > before && document.querySelector('[data-import-file][data-phase="complete"]'), 'Catalog ORIGINAL saved import');
    const receipt = apiLast('/api/library/import/commit'), input = config.fixture.inputs.find(row => row.filename === filename);
    assert(receipt.source.sha256 === input.sha256 && receipt.source.bytes === input.bytes && receipt.source.retained && receipt.summary.error === 0 && receipt.summary.conflict === 0, 'Catalog import did not preserve the exact ORIGINAL fixture');
    closeDialogs(); return receipt;
  }
  async function openCatalog(expected = 'ready') {
    await native('click', $('library-management-button')); await until(() => !$('management-catalog-button').hidden && !$('management-catalog-button').disabled, 'Catalog capability entry');
    if ($('management-catalog').hidden) await native('click', $('management-catalog-button')); await until(() => $('management-catalog').dataset.phase === expected, `Catalog ${expected}`);
  }
  async function catalogView(view) { await native('click', cat(view)); await until(() => $('management-catalog').dataset.phase === 'ready' && cat(view).getAttribute('aria-pressed') === 'true', `Catalog ${view} view`); }
  async function select(ids) {
    for (const id of ids) { const box = document.querySelector(`[data-catalog-edition="${id}"]`); assert(box && !box.checked && !box.disabled, 'Exact catalog selection unavailable'); await native('click', box); assert(box.checked, 'Trusted selection did not check the exact edition'); }
  }
  async function review(id = 'preview') { await native('click', cat(id)); await until(() => !cat('review').hidden && !$('management-catalog').getAttribute('aria-busy').includes('true'), 'Exact catalog review'); }
  async function committed(id) { await until(() => operation()?.operation_id === id && operation().phase === 'committed' && $('management-catalog').dataset.phase === 'ready', 'Native journal confirmed exact operation'); }
  async function state() { return {score: $('score-title').textContent, preview: $('song-lobby').dataset.previewId, mode: $('session-mode').value, progress: $('progress').value, transport: $('transport-status').textContent}; }
  async function sessionFiles(suffix) {
    closeDialogs(); click('score-tools-button'); report.files[suffix === 'before' ? 'beforeScore' : 'afterScore'] = await download($('export-button')); closeDialogs(); click('results-button');
    assert(catalogPracticeBaselineReady(document), 'Practice baseline must have a completed current assessment');
    report.files[suffix === 'before' ? 'beforeTake' : 'afterTake'] = await download($('export-takes')); closeDialogs();
  }
  async function prepareSession(shared) {
    await native('click', $('catalog').querySelector(`[data-library-key="native:${shared.key}"]`)); await until(() => !$('start-practice').disabled, 'Original shared practice preview');
    click('settings-button'); if ($('count-in').checked) await native('click', $('count-in')); closeDialogs();
    await native('click', $('start-practice')); await until(() => document.body.dataset.screen === 'stage' && /暂停/.test($('play-button').textContent), 'Real practice playback admitted');
    await native('key-r', $('stage-title')); await until(() => $('hud-captured').textContent === '1', 'One real practice onset'); await native('click', $('play-button'));
    click('results-button'); await native('click', $('assess-button')); await until(() => catalogPracticeBaselineReady(document), 'Practice assessment and grace completed', 15000); closeDialogs();
    await menu.returnToLibrary(); await sessionFiles('before');
    await menu.enterFree(); await native('click', $('free-start')); await native('key-r', $('free-practice-title')); await native('click', $('free-stop'));
    if (!$('free-recordings').open) click('free-recordings-toggle'); await native('click', $('free-save')); await until(() => !$('free-export-record').disabled && $('free-practice-screen').getAttribute('aria-busy') === 'false', 'Saved free recording');
    report.files.beforeSavedFree = await download($('free-export-record'));
    await native('click', $('free-start')); await native('key-r', $('free-practice-title')); await native('click', $('free-stop')); report.files.beforeDraftFree = await download($('free-export-draft')); await menu.exitFree();
    report.state.before = await state();
  }
  async function preserveSession() {
    assert(same(await state(), report.state.before), 'Catalog management changed active preview/transport'); await sessionFiles('after');
    await menu.enterFree({readyControl: 'free-exit'}); report.files.afterSavedFree = await download($('free-export-record')); report.files.afterDraftFree = await download($('free-export-draft')); await screenshot('preserved-recordings', $('free-practice-title')); await menu.exitFree(); report.state.after = await state();
    assert(same(report.state.before, report.state.after), 'Catalog management changed active state'); checked('active-take-and-free-recordings-preserved');
  }
  async function savedFreeAfterRestart() {
    closeDialogs(); await menu.enterFree(); if (!$('free-recordings').open) click('free-recordings-toggle'); await until(() => !$('free-load').disabled, 'Persisted saved free record'); await native('click', $('free-load')); await until(() => !$('free-export-record').disabled && $('free-practice-screen').getAttribute('aria-busy') === 'false', 'Actual persisted record loaded'); report.files.restartedSavedFree = await download($('free-export-record')); await menu.exitFree();
  }
  async function membershipEvidence() {
    closeDialogs(); await native('click', $('library-management-button')); await native('click', document.querySelector('[data-management-view="packs"]')); await until(() => $('library-management-dialog').dataset.phase === 'ready', 'Read-only membership view');
    const packs = await probe('/api/library/manage/query', {view: 'packs', limit: 100, refresh: true}), duplicates = await probe('/api/library/manage/query', {view: 'duplicates', limit: 100});
    assert(packs.rows.length === 3 && duplicates.rows.length === 1 && duplicates.rows[0].editions.length === 1 && duplicates.rows[0].evidence_type === 'shared_edition', 'Pack membership or duplicate ownership changed');
    await native('click', document.querySelector('[data-management-view="duplicates"]')); await until(() => $('library-management-dialog').dataset.phase === 'ready' && document.querySelector('[data-management-group]'), 'Actual shared duplicate UI');
    await native('click', document.querySelector('[data-management-group]>summary')); await screenshot('shared-duplicate-evidence'); report.catalog.packs = packs; report.catalog.duplicates = duplicates; closeDialogs();
  }
  async function runSeed() {
    assert((await probe('/api/library/list')).entries.length === 0, 'Seed requires an empty ORIGINAL library');
    for (const filename of catalogSeedImportFilenames(spec)) await choose(filename);
    await membershipEvidence(); await openCatalog('uninitialized'); await native('catalog-snapshot-before', $('management-title'));
    await review('initialize-preview'); const initialization = apiLast('/api/library/catalog/initialize/preview');
    assert(same(initialization.preview.counts, spec.expected.initial), 'Initialization review count differs'); await native('click', cat('cancel')); assert(apiCount('/api/library/catalog/initialize') === 0, 'Cancel initialized catalog');
    await review('initialize-preview'); await native('click', cat('confirm')); await until(() => operation()?.kind === 'initialize' && operation().phase === 'committed' && $('management-catalog').dataset.phase === 'ready', 'Explicit catalog initialization');
    report.operations.initialize = clone(operation()); report.catalog.initialized = await query('active'); assert(same(report.catalog.initialized.counts, spec.expected.initial), 'Initial catalog membership count differs'); checked('explicit-initialize-cancel-confirm');
    const selected = report.catalog.initialized.rows.filter(row => spec.selected_score_ids.includes(row.score_id)); assert(selected.length === 2, 'Mixed exact two-song selection required');
    closeDialogs(); await prepareSession(selected.find(row => row.storage_kind === 'legacy'));
    const clean = selected.find(row => row.storage_kind === 'clean'), storageModule = await import('/native-score-storage.js'); mediaStorage = await storageModule.openScoreStorage({origin: location.origin, fetcher: globalThis.fetch});
    const loaded = await mediaStorage.load(`native:${clean.key}`), asset = loaded.cleanSong.media[0], beforeMedia = new Uint8Array(await (await mediaStorage.loadAsset(`native:${clean.key}`, asset.handle)).arrayBuffer());
    report.media = {key: clean.key, handle: asset.handle, bytes: beforeMedia.length, before_sha256: await digest(beforeMedia)};
    await openCatalog(); await select(selected.map(row => row.edition_id)); await review(); const preview = apiLast('/api/library/catalog/preview');
    assert(preview.summary.selected_count === 2 && preview.summary.changed_song_count === 2 && preview.summary.removed_membership_count === 3 && preview.summary.shared_song_count === 1 && preview.summary.reclaimed_bytes === 0, 'Exact Trash impact is wrong');
    for (const row of selected) assert(cat('review-content').textContent.includes(row.edition_id), 'Review omitted an exact selected identity'); await screenshot('exact-trash-review', cat('review-title'));
    transport.arm({kind: 'lose-after'}); await native('click', cat('confirm')); await until(() => operation()?.phase === 'uncertain', 'Lost actual commit response remains uncertain');
    assert(cat('preview').disabled, 'Uncertain operation must block another mutation'); const trash = clone(operation());
    transport.arm({kind: 'wrong-operation', operation_id: report.operations.initialize.operation_id}); await native('click', cat('check')); await until(() => !cat('operation-error').hidden && !cat('check').disabled, 'Wrong operation response rejected');
    assert(operation().operation_id === trash.operation_id && operation().phase === 'uncertain', 'Foreign committed operation stole ownership'); report.operations.trash = clone(operation()); checked('wrong-operation-response-cannot-confirm-owner');
    report.catalog.trashed = await query('trash'); assert(same(report.catalog.trashed.counts, spec.expected.trashed) && report.catalog.trashed.rows.every(row => row.trashed_by === trash.operation_id), 'Durable Trash membership differs');
    const blocked = await originalFetch('/api/library/load', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({key: clean.key})}); report.media.new_load_error = (await blocked.json()).code; assert(report.media.new_load_error === 'catalog_in_trash', 'New load must respect Trash');
    report.media.after_sha256 = await digest(new Uint8Array(await (await mediaStorage.loadAsset(`native:${clean.key}`, asset.handle)).arrayBuffer())); assert(report.media.before_sha256 === report.media.after_sha256, 'Admitted media bytes changed');
    await screenshot('uncertain-native-commit', cat('operation-title')); closeDialogs(); await preserveSession();
    report.catalog.active = await query('active'); report.catalog.trash = await query('trash'); checked('durable-multi-song-trash-retains-admitted-media');
  }
  async function runRestart() {
    const pending = report.profile.recovery_before_open; assert(pending?.kind === 'trash_songs' && pending.phase === 'uncertain', 'Real persisted unresolved operation pointer required');
    await openCatalog(); await committed(pending.operation_id); report.profile.recovery_after_open = clone(operation()); assert(apiCount('/api/library/catalog/commit') === 0, 'Restart recovery submitted another write');
    report.operations.trash = clone(operation()); await screenshot('recovered-original-operation', cat('operation-title')); checked('new-process-reconciles-persisted-original-operation'); closeDialogs();
    const legacy = await choose(spec.filenames.legacy), clean = await choose(spec.filenames.clean); assert(legacy.summary.duplicate === 2 && clean.summary.duplicate === 1, 'Exact original retry created new editions');
    const trash = await query('trash'); report.catalog.trashed = trash; assert(same(trash.counts, spec.expected.trashed) && trash.rows.every(row => row.trashed_by === pending.operation_id), 'Exact retry changed Trash ownership'); checked('exact-reimport-keeps-trash-owner');
    await openCatalog(); await catalogView('trash'); await select(trash.rows.map(row => row.edition_id)); await review(); const preview = apiLast('/api/library/catalog/preview');
    assert(preview.summary.selected_count === 2 && preview.summary.restored_membership_count === 3 && preview.preview.request.action.trash_operation_id === pending.operation_id, 'Restore reviewed a different Trash operation'); await screenshot('exact-restore-review', cat('review-title'));
    transport.arm({kind: 'lose-before'}); await native('click', cat('confirm')); await until(() => operation()?.phase === 'uncertain', 'Unsubmitted restore remains uncertain'); const absent = clone(operation());
    await native('click', cat('check')); await until(() => operation()?.phase === 'not_committed' && !cat('retry').hidden && !cat('retry').disabled, 'Native journal proves restore absent');
    await native('click', cat('retry')); await committed(absent.operation_id); report.operations.restore = clone(operation());
    const attempts = transport.rows.filter(row => row.path === '/api/library/catalog/commit' && row.request?.preview.request.operation_id === absent.operation_id); assert(attempts.length === 2 && attempts[0].request_text === attempts[1].request_text && !attempts[0].dispatched && attempts[1].dispatched, 'Restore retry must use exact unchanged operation bytes'); checked('proved-absent-restore-retries-exact-operation');
    await catalogView('active'); report.catalog.restored = await query('active'); assert(same(report.catalog.restored.counts, spec.expected.restored), 'Restore lost original memberships');
    transport.arm({kind: 'defer-query'}); await native('click', cat('trash')); await until(() => transport.held(), 'Actual native old query held');
    const heldSequence = transport.held().row.sequence, closeAction = await native('click', $('management-close')), reopenAction = sequence + 1; await openCatalog(); await catalogView('active');
    const ownership = () => ({view: cat('active').getAttribute('aria-pressed') === 'true' ? 'active' : 'trash', edition_ids: [...cat('rows').querySelectorAll('[data-catalog-song]')].map(node => node.dataset.catalogSong), operation_id: operation().operation_id});
    const newest = transport.rows.filter(row => row.path === '/api/library/catalog/query' && row.request?.view === 'active').at(-1);
    report.stale_ownership = {held_sequence: heldSequence, latest_active_sequence: newest.sequence, close_action: closeAction, reopen_action: reopenAction, before: ownership()};
    const stable = JSON.stringify({rows: cat('rows').textContent, active: cat('active').getAttribute('aria-pressed'), operation: operation()}); transport.release(); await until(() => !transport.held(), 'Old native query released');
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    assert(JSON.stringify({rows: cat('rows').textContent, active: cat('active').getAttribute('aria-pressed'), operation: operation()}) === stable, 'Stale query replaced reopened active view or operation'); report.stale_ownership.after = ownership(); checked('late-native-query-cannot-own-reopened-view');
    await screenshot('restored-current-owner', cat('operation-title'));
    const userPacks = await runCatalogUserPackAcceptance({document, native, until, query, operation, apiLast, download, screenshot, selected: report.catalog.restored.rows.filter(row => spec.selected_score_ids.includes(row.score_id)), viewport: {width: innerWidth, height: innerHeight}, assert});
    report.organization = userPacks.organization; Object.assign(report.files, userPacks.files);
    localStorage.setItem(organizationKey, JSON.stringify({restore: report.operations.restore, create: report.organization.create, rename: report.organization.rename, add: report.organization.add}));
    checked('custom-pack-create-rename-add-and-selected-export'); checked('imported-source-groups-remain-readonly');
    closeDialogs(); await savedFreeAfterRestart(); report.catalog.active = await query('active'); report.catalog.trash = await query('trash');
  }
  async function runFinal() {
    const prior = report.profile.recovery_before_open, organization = report.profile.organization_before_open;
    assert(prior?.kind === 'add_memberships' && prior.phase === 'committed' && same(prior, organization?.add), 'Final restart requires the real persisted user-pack operation');
    await openCatalog(); await committed(prior.operation_id); report.profile.recovery_after_open = clone(operation()); report.operations.restore = clone(organization.restore);
    const restored = await probe('/api/library/catalog/operation', {library_id: prior.library_id, operation_id: organization.restore.operation_id}); assert(restored.outcome === 'committed' && same(restored.receipt.preview, organization.restore.preview), 'Original restore receipt did not survive organization');
    assert(apiCount('/api/library/catalog/commit') === 0 && apiCount('/api/library/catalog/initialize') === 0, 'Final restart must be read-only'); report.catalog.active = await query('active'); report.catalog.trash = await query('trash'); assert(same(report.catalog.active.counts, {...spec.expected.restored, packs: spec.expected.restored.packs + 1, memberships: spec.expected.restored.memberships + 2}) && report.catalog.trash.rows.length === 0, 'Final state did not persist');
    await screenshot('persisted-restored-catalog', cat('operation-title')); closeDialogs(); await membershipEvidence(); await savedFreeAfterRestart(); checked('second-process-restart-restores-native-and-renderer-persistence');
    await openCatalog(); const userPacks = await runCatalogUserPackAcceptance({document, native, until, query, operation, apiLast, download, screenshot, selected: prior.selected, prior: organization, viewport: {width: innerWidth, height: innerHeight}, assert}); report.organization = userPacks.organization;
    assert(apiCount('/api/library/catalog/commit') === 0, 'Final user-pack restart unexpectedly wrote'); checked('custom-pack-organization-survives-second-restart');
  }
  addEventListener('DOMContentLoaded', async () => {
    try {
      config = await json('/__desktop_smoke/catalog-config'); assert(config.version === 1 && config.run_id && config.fixture.private_music === false, 'Process-owned ORIGINAL catalog configuration missing'); spec = config.fixture.spec;
      report.run_id = config.run_id; report.source_binding = config.source_binding; report.fixture = config.fixture;
      report.profile.marker_before = localStorage.getItem(markerKey); report.profile.recovery_before_open = clone(operation());
      report.profile.organization_before_open = JSON.parse(localStorage.getItem(organizationKey) || 'null');
      if (phase === 'catalog-seed') { assert(report.profile.marker_before === null && report.profile.recovery_before_open === null, 'Catalog seed must have a fresh real profile'); localStorage.setItem(markerKey, config.run_id); }
      else assert(report.profile.marker_before === config.run_id, 'Restart must reuse the same actual browser profile');
      report.profile.marker_after = localStorage.getItem(markerKey);
      await menu.enterLibrary(); const {getAppI18n} = await import('/app-locale.js'); getAppI18n(document).setLocale('zh-CN'); report.layout = {width: innerWidth, height: innerHeight, locale: document.documentElement.lang};
      report.geometry = {width: innerWidth, height: innerHeight, document_client: {width: document.documentElement.clientWidth, height: document.documentElement.clientHeight}, device_pixel_ratio: devicePixelRatio, visual_viewport: globalThis.visualViewport ? {width: visualViewport.width, height: visualViewport.height, scale: visualViewport.scale, offset_left: visualViewport.offsetLeft, offset_top: visualViewport.offsetTop} : null};
      const nativeFit = config.viewport_contract?.kind === 'native-work-area';
      assert(report.layout.locale === 'zh-CN' && (nativeFit ? innerWidth >= 900 && innerHeight >= 640 && innerWidth <= 1280 && innerHeight <= 720 : innerWidth === 1280 && innerHeight === 720), nativeFit ? 'Native catalog needs a visible Chinese viewport from900x640 through requested1280x720' : 'Hosted catalog acceptance needs exact1280x720 Chinese UI');
      const health = await json('/api/health'); assert(health.network === 'native-protocol-no-listener' && health.library_catalog_version === 1, 'Actual native catalog capability required');
      if (phase === 'catalog-seed') await runSeed(); else if (phase === 'catalog-restart') await runRestart(); else await runFinal();
      assert(report.opened_score_databases.length === 0 && report.errors.length === 0, 'Catalog opened fallback score storage or reported an uncaught error'); report.ok = true;
    } catch (error) { report.error = String(error.stack || error); }
    finally {
      transport.stop(); mediaStorage?.close(); globalThis.fetch = originalFetch; IDBFactory.prototype.open = originalOpen;
      document.removeEventListener('click', trustedClick, true); document.removeEventListener('keydown', trustedKey, true); document.removeEventListener('keyup', trustedKey, true);
      report.downloads = (await json('/__desktop_smoke/state')).downloads;
      const body = JSON.stringify(report); assert(new TextEncoder().encode(body).length <= 1024 * 1024, 'Catalog renderer report exceeds 1MiB');
      await json('/__desktop_smoke/report', {method: 'POST', headers: {'Content-Type': 'application/json'}, body});
    }
  });
})();

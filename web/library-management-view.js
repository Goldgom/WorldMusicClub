import {setupLibraryCatalogView} from './library-catalog-view.js';
import {LibraryManagementModel} from './library-management-model.js';
import {createBulkImportTransport} from './bulk-import.js';

const errorKeys = {
  library_management_unavailable: 'unavailable', library_management_invalid_response: 'invalid',
  library_invalid_response: 'invalid', library_environment_unknown: 'invalid',
  library_management_invalid_query: 'query', library_invalid_request: 'query', library_query_limit: 'limit',
  library_snapshot_stale: 'stale', library_invalid_cursor: 'stale'
};
const editionPageSize = 20;
/** This view has no playback, navigation, score-loading or recording callbacks. */
export function setupLibraryManagementView({document = globalThis.document, i18n, getStorage, onCommitted = async () => {}, model = new LibraryManagementModel({getStorage}), transport = createBulkImportTransport(), download = downloadPack} = {}) {
  const make = (tag, className) => { const node = document.createElement(tag); if (className) node.className = className; return node; };
  const t = (key, params = {}) => i18n.t(`management.${key}`, params);
  const dialog = make('dialog', 'shell-dialog library-management-dialog');
  dialog.id = 'library-management-dialog'; dialog.setAttribute('aria-labelledby', 'management-title');
  dialog.innerHTML = `<div class="shell-dialog-heading"><h2 id="management-title" tabindex="-1" data-management-text="title"></h2><button id="management-close" type="button" class="button ghost" data-management-text="close"></button></div>
    <div class="library-management-body"><p data-management-text="intro"></p>
    <nav id="management-views" class="management-actions"></nav>
    <div id="management-browser"><form id="management-search-form" class="management-search"><label for="management-search" data-management-text="search"></label><input id="management-search" type="search" maxlength="256"><button type="submit" class="button secondary" data-management-text="submit"></button><button id="management-refresh" type="button" class="button secondary" data-management-text="refresh"></button></form>
    <p id="management-context" hidden></p><label id="management-category-label" for="management-category" hidden><span data-management-text="category"></span><select id="management-category"></select></label>
    <p id="management-help"></p><p data-management-text="refreshHelp" class="muted"></p><p id="management-summary"></p><p id="management-freshness" class="muted"></p>
    <p id="management-status" role="status" aria-live="polite" aria-atomic="true"></p><div id="management-error" role="alert" hidden></div>
    <section id="management-selection" hidden><label><input id="management-select-page" type="checkbox"><span data-management-text="selectPage"></span></label><p id="management-selected"></p><div class="management-actions"><button id="management-clear" type="button" class="button ghost" data-management-text="clear"></button><button id="management-clear-hidden" type="button" class="button ghost" data-management-text="clearHidden"></button><button id="management-export-legacy" type="button" class="button secondary"></button><button id="management-export-clean" type="button" class="button secondary"></button></div><p data-management-text="exportHelp"></p></section>
    <ul id="management-rows" class="management-rows" tabindex="-1"></ul><p id="management-empty" data-management-text="empty" hidden></p>
    <div class="management-actions management-pagination"><button id="management-previous" type="button" class="button secondary" data-management-text="previous"></button><p id="management-page"></p><button id="management-next" type="button" class="button secondary" data-management-text="next"></button></div></div></div>`;
  document.body.append(dialog);
  const $ = id => document.getElementById(`management-${id}`);
  let state = model.snapshot(), exporting = false, exportState = null, exportError = null, rowsSignature = null, packName = '', opener = null, destroyed = false, exportGeneration = 0, exportController = null;
  let catalogActive = false;
  const catalogView = setupLibraryCatalogView({document, i18n, getStorage, onCommitted: async () => { model.invalidate(); await onCommitted(); }});
  $('browser').before(catalogView.element);
  const catalogButton = make('button', 'button secondary'); catalogButton.id = 'management-catalog-button'; catalogButton.type = 'button'; catalogButton.hidden = true;
  catalogButton.addEventListener('click', () => { catalogActive = true; cancelExport(); model.close(); $('browser').hidden = true; catalogButton.setAttribute('aria-pressed', 'true'); catalogView.open(); });
  const viewButtons = new Map();
  for (const view of ['packs', 'songs', 'unfiled', 'duplicates', 'issues']) {
    const button = make('button', 'button secondary'); button.type = 'button'; button.dataset.managementView = view;
    button.addEventListener('click', () => {
      catalogActive = false; catalogView.close(); $('browser').hidden = false; catalogButton.setAttribute('aria-pressed', 'false'); packName = ''; $('search').value = ''; exportError = null; exportState = null;
      void changeView({view: view === 'unfiled' ? 'songs' : view, unfiled: view === 'unfiled', pack_id: null, search: '', duplicate_kind: view === 'duplicates' ? $('category').value : null});
    });
    $('views').append(button); viewButtons.set(view, button);
  }
  $('views').append(catalogButton);
  for (const kind of ['exact_content', 'same_id', 'same_title']) { const option = make('option'); option.value = kind; $('category').append(option); }
  const entry = make('button', 'button secondary'); entry.type = 'button'; entry.id = 'library-management-button'; entry.setAttribute('aria-haspopup', 'dialog'); entry.setAttribute('aria-controls', dialog.id);
  document.querySelector('#song-lobby .lobby-heading')?.append(entry);
  function statusText(node, value) { if (node.textContent !== value) node.textContent = value; }
  function problem(error) {
    const target = $('error'), signature = JSON.stringify([error, i18n.locale]);
    if (target.dataset.signature === signature) return;
    target.dataset.signature = signature; target.hidden = !error; target.replaceChildren(); if (!error) return;
    const message = make('p'); message.textContent = t(`error.${errorKeys[error.code] || 'general'}`);
    const details = make('details'), summary = make('summary'), raw = make('p'); summary.textContent = t('details'); raw.textContent = [error.message, error.code].filter(Boolean).join('\n'); details.append(summary, raw); target.append(message, details);
  }
  function packLink(pack) {
    const button = make('button', 'button ghost'); button.type = 'button'; button.textContent = pack.name || pack.pack_id;
    button.setAttribute('aria-label', t('openPack', {name: pack.name || pack.pack_id})); button.dataset.managementPack = pack.pack_id;
    button.addEventListener('click', () => {
      packName = pack.name || pack.pack_id; $('search').value = ''; exportError = null; exportState = null;
      void changeView({view: 'songs', pack_id: pack.pack_id, unfiled: false, search: '', duplicate_kind: null});
    });
    return button;
  }
  function songCard(song, selectable = false) {
    const content = make('div', 'management-song'), title = make('strong'), identity = make('p', 'management-identity'), metadata = make('p');
    title.textContent = song.title || song.score_id; identity.textContent = t('identity', {id: song.edition_id});
    metadata.textContent = [song.composer, t(`format.${song.storage_kind}`), t('scoreId', {id: song.score_id})].filter(Boolean).join(' · ');
    if (selectable) {
      const label = make('label'), input = make('input'); input.type = 'checkbox'; input.dataset.managementEdition = song.edition_id;
      input.setAttribute('aria-label', t('select', {title: song.title || song.score_id, id: song.edition_id}));
      input.addEventListener('change', () => model.toggle(song, input.checked)); label.append(input, title); content.append(label);
    } else content.append(title);
    content.append(metadata, identity);
    if (song.pack_count > 1) { const shared = make('p', 'management-shared'); shared.textContent = t('shared', {count: song.pack_count}); content.append(shared); }
    const details = make('details'), summary = make('summary'), links = make('div', 'management-memberships'), profile = make('p');
    summary.textContent = t('memberships', {count: song.pack_count}); profile.textContent = t('profile', {profile: song.profile});
    const packs = song.packs || song.pack_ids.map(pack_id => ({pack_id, name: pack_id}));
    let offset = 0, rendered = false;
    const controls = make('div', 'management-actions'), previous = make('button', 'button ghost'), next = make('button', 'button ghost');
    previous.type = next.type = 'button'; previous.textContent = t('previous'); next.textContent = t('next'); controls.append(previous, next); controls.hidden = packs.length <= editionPageSize;
    function renderMemberships() {
      links.replaceChildren(); for (const pack of packs.slice(offset, offset + editionPageSize)) links.append(packLink(pack));
      if (!song.pack_count) links.textContent = t('noMembership'); previous.disabled = offset === 0; next.disabled = offset + editionPageSize >= packs.length; rendered = true;
    }
    details.addEventListener('toggle', () => { if (details.open && !rendered) renderMemberships(); });
    previous.addEventListener('click', () => { offset = Math.max(0, offset - editionPageSize); renderMemberships(); });
    next.addEventListener('click', () => { offset = Math.min(packs.length - 1, offset + editionPageSize); renderMemberships(); });
    details.append(summary, links, controls, profile); content.append(details); return content;
  }
  function duplicateCard(row) {
    const card = make('div'), title = make('strong'), counts = make('p'); title.textContent = row.kind === 'exact_content' ? (row.editions[0]?.title || row.match) : row.match;
    counts.textContent = t('groupCounts', {editions: row.edition_count, packs: row.pack_count, references: row.reference_count}); card.append(title, counts);
    if (row.edition_count === 1) { const reused = make('p', 'management-shared'); reused.textContent = t('reused'); card.append(reused); }
    const details = make('details'), summary = make('summary'), list = make('ul', 'management-duplicate-editions'), controls = make('div', 'management-actions'), previous = make('button', 'button ghost'), next = make('button', 'button ghost'), page = make('p');
    summary.textContent = t('groupDetails'); previous.type = next.type = 'button'; previous.textContent = t('previous'); next.textContent = t('next');
    controls.append(previous, page, next); details.append(summary, list, controls); card.append(details); let offset = 0, rendered = false;
    function renderEditions() {
      list.replaceChildren(); for (const song of row.editions.slice(offset, offset + editionPageSize)) { const li = make('li'); li.append(songCard(song)); list.append(li); }
      page.textContent = t('editionPage', {start: offset + 1, end: Math.min(offset + editionPageSize, row.editions.length), total: row.editions.length});
      previous.disabled = offset === 0; next.disabled = offset + editionPageSize >= row.editions.length; controls.hidden = row.editions.length <= editionPageSize; rendered = true;
    }
    // Defer membership DOM until the user opens this group. Each group is bounded.
    details.addEventListener('toggle', () => { if (details.open && !rendered) renderEditions(); });
    previous.addEventListener('click', () => { offset = Math.max(0, offset - editionPageSize); renderEditions(); });
    next.addEventListener('click', () => { offset = Math.min(row.editions.length - 1, offset + editionPageSize); renderEditions(); });
    details.dataset.managementGroup = row.group_id;
    return card;
  }
  function renderRows() {
    const signature = JSON.stringify([state.response, i18n.locale]); if (rowsSignature === signature) return;
    rowsSignature = signature; const list = $('rows'); list.replaceChildren();
    for (const row of state.response?.rows || []) {
      const li = make('li', 'management-row');
      if (state.response.view === 'songs') { li.dataset.managementSong = row.edition_id; li.append(songCard(row, true)); }
      else if (state.response.view === 'packs') {
        li.dataset.managementPackRow = row.pack_id; li.dataset.managementProvenance = row.provenance;
        const title = make('h3'), counts = make('p'), evidence = make('p', 'muted'); title.append(packLink(row));
        counts.textContent = t('packCounts', {songs: row.song_count, shared: row.shared_song_count, retained: row.retained_only_count, issues: row.issue_count}); evidence.textContent = t(row.provenance === 'unresolved' ? 'packEvidenceUnresolved' : 'packEvidence'); li.append(title, counts, evidence);
        if (row.retained_only_count || row.issue_count || row.provenance === 'unresolved') {
          const issues = make('button', 'button ghost'); issues.type = 'button'; issues.textContent = t('issues');
          issues.addEventListener('click', () => { packName = row.name; $('search').value = ''; void changeView({view: 'issues', pack_id: row.pack_id, unfiled: false, search: '', duplicate_kind: null}); }); li.append(issues);
        }
      } else if (state.response.view === 'duplicates') { li.dataset.managementDuplicate = row.group_id; li.append(duplicateCard(row)); }
      else {
        li.dataset.managementIssue = row.issue_id; const title = make('strong'), source = make('p'), details = make('details'), summary = make('summary'), raw = make('p');
        title.textContent = t('issue'); source.textContent = row.archive_key || row.song_key || ''; summary.textContent = t('details'); raw.textContent = [row.message, row.code].join('\n'); details.append(summary, raw); li.append(title, source, details);
      }
      list.append(li);
    }
  }
  function render() {
    if (destroyed) return;
    for (const node of dialog.querySelectorAll('[data-management-text]')) node.textContent = t(node.dataset.managementText);
    catalogButton.textContent = t('catalog.open'); entry.textContent = t('open'); $('views').setAttribute('aria-label', t('viewAria')); $('search').placeholder = t('searchHint');
    const busy = state.phase === 'loading', enabled = state.phase === 'ready' && !state.stale && !exporting;
    dialog.setAttribute('aria-busy', String(busy)); dialog.dataset.phase = state.phase;
    for (const [view, button] of viewButtons) {
      button.textContent = t(view); button.setAttribute('aria-pressed', String(!catalogActive && (view === 'unfiled' ? state.query.unfiled : state.query.view === view && !state.query.unfiled && !state.query.pack_id)));
    }
    for (const option of $('category').options) option.textContent = t(option.value);
    $('category-label').hidden = state.query.view !== 'duplicates';
    if (state.query.duplicate_kind) $('category').value = state.query.duplicate_kind;
    $('context').hidden = !state.query.pack_id; $('context').textContent = state.query.pack_id ? t('packContext', {name: packName || state.query.pack_id}) : '';
    $('help').textContent = state.query.view === 'duplicates' ? t(`duplicateHelp.${state.query.duplicate_kind || 'exact_content'}`) : state.query.view === 'issues' ? t('issuesHelp') : '';
    const response = state.response;
    $('summary').textContent = response ? t('summary', {packs: response.summary.packs, songs: response.summary.songs, shared: response.summary.shared_songs, unfiled: response.summary.unfiled_songs}) : '';
    $('freshness').textContent = response ? t('freshness', {time: i18n.formatDateTime(response.freshness.verified_at_unix_ms)}) : '';
    statusText($('status'), exporting ? t('exporting') : busy ? t('loading') : state.stale ? t('stale') : exportState ? t(exportState) : '');
    problem(exportError || state.error); renderRows();
    const selected = new Set(state.selected.map(row => row.edition_id)), rows = response?.view === 'songs' ? response.rows : [], visibleSelected = rows.filter(row => selected.has(row.edition_id)).length, hidden = state.selected.length - visibleSelected;
    $('selection').hidden = state.query.view !== 'songs' || !response;
    $('select-page').checked = rows.length > 0 && visibleSelected === rows.length; $('select-page').indeterminate = visibleSelected > 0 && visibleSelected < rows.length; $('select-page').disabled = !enabled || !rows.length;
    for (const checkbox of $('rows').querySelectorAll('[data-management-edition]')) { checkbox.checked = selected.has(checkbox.dataset.managementEdition); checkbox.disabled = !enabled; }
    $('selected').textContent = t('selection', {count: state.selected.length, hidden}); $('clear').disabled = exporting || !selected.size; $('clear-hidden').disabled = exporting || !hidden;
    for (const kind of ['legacy', 'clean']) { const count = state.selected.filter(row => row.storage_kind === kind).length; $(`export-${kind}`).textContent = t(`export.${kind}`, {count}); $(`export-${kind}`).disabled = !enabled || count === 0; }
    $('empty').hidden = !response || response.rows.length !== 0 || busy;
    $('page').textContent = response ? t('page', {page: state.page + 1, total: response.total}) : '';
    $('previous').disabled = busy || state.stale || state.page === 0; $('next').disabled = busy || state.stale || !response?.next_cursor; $('refresh').disabled = busy || exporting;
  }
  function cancelExport() {
    exportGeneration++; exportController?.abort(); exportController = null;
    exporting = false; exportState = null; exportError = null;
  }
  function changeView(patch) { cancelExport(); return model.setView(patch); }
  async function exportSelection(kind) {
    if (exporting || state.phase !== 'ready' || state.stale) return;
    const rows = state.selected.filter(row => row.storage_kind === kind); if (!rows.length) return;
    const request = ++exportGeneration, controller = new AbortController(); exportController = controller;
    const ownsResult = () => !destroyed && request === exportGeneration && !controller.signal.aborted && dialog.open;
    exporting = true; exportError = null; exportState = null; render();
    try {
      const entries = rows.map(row => ({storageKind: 'native', storageKey: row.key, ...(kind === 'clean' ? {clean_package: {}} : {})}));
      const blob = await transport.exportPack(entries, {signal: controller.signal});
      if (ownsResult()) { await download(document, blob, kind === 'clean' ? 'worldmusicclub-complete-songs.zip' : 'worldmusicclub-legacy-scores.zip'); if (ownsResult()) exportState = 'exported'; }
    } catch (error) { if (ownsResult()) exportError = {code: error.code, message: error.message}; }
    finally { if (request === exportGeneration) { exportController = null; exporting = false; render(); } }
  }
  function open() { if (dialog.open) return; cancelExport(); opener = document.activeElement || entry; exportState = null; exportError = null; dialog.showModal(); $('title').focus(); if (catalogActive) catalogView.open(); else void model.refresh(); void getStorage().then(storage => { if (!destroyed) catalogButton.hidden = !storage.info.capabilities.manageCatalog; }).catch(() => {}); }
  function close() { cancelExport(); catalogView.close(); model.close(); if (dialog.open) dialog.close(); }
  entry.addEventListener('click', open); $('close').addEventListener('click', close);
  dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
  dialog.addEventListener('close', () => { if (destroyed || dialog.open) return; cancelExport(); catalogView.close(); model.close(); if (opener?.isConnected) opener.focus(); });
  $('search-form').addEventListener('submit', event => { event.preventDefault(); exportError = null; exportState = null; void changeView({search: $('search').value}); });
  $('category').addEventListener('change', () => { exportError = null; exportState = null; void changeView({duplicate_kind: $('category').value}); });
  $('refresh').addEventListener('click', () => { if (exporting) return; cancelExport(); void model.refresh(); });
  $('previous').addEventListener('click', () => void model.previous()); $('next').addEventListener('click', () => void model.next());
  $('select-page').addEventListener('change', () => model.selectPage($('select-page').checked));
  $('clear').addEventListener('click', () => model.clearSelection()); $('clear-hidden').addEventListener('click', () => model.clearSelection({hiddenOnly: true}));
  for (const kind of ['legacy', 'clean']) $(`export-${kind}`).addEventListener('click', () => void exportSelection(kind));
  const unsubscribe = model.subscribe(next => { state = next; render(); }), unlocale = i18n.subscribe(render); render();
  return {open, close, model, dialog, catalog: catalogView, invalidate: () => { cancelExport(); model.invalidate(); catalogView.invalidate(); }, destroy() { cancelExport(); destroyed = true; unsubscribe(); unlocale(); model.destroy(); catalogView.destroy(); dialog.remove(); entry.remove(); }};
}
function downloadPack(document, blob, filename) {
  const url = URL.createObjectURL(blob), link = document.createElement('a'); link.href = url; link.download = filename; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}

import {LibraryCatalogModel} from './library-catalog-model.js';
const errors = {catalog_unavailable: 'unavailable', catalog_invalid_response: 'invalid', catalog_stale: 'stale', catalog_conflict: 'stale', catalog_recovery_required: 'recovery', catalog_capacity: 'capacity', library_operation_storage: 'storage', catalog_pending_operation: 'pending', catalog_invalid_request: 'query'};
export function setupLibraryCatalogView({document, i18n, getStorage, onCommitted, model = new LibraryCatalogModel({getStorage, onCommitted})} = {}) {
  const make = (tag, className) => { const node = document.createElement(tag); if (className) node.className = className; return node; };
  const t = (key, params = {}) => i18n.t(`management.catalog.${key}`, params);
  const host = make('section', 'management-catalog'); host.id = 'management-catalog'; host.hidden = true;
  host.innerHTML = `<p data-catalog-text="intro"></p><div class="management-actions"><button id="management-catalog-active" type="button" class="button secondary" data-catalog-text="active"></button><button id="management-catalog-trash" type="button" class="button secondary" data-catalog-text="trash"></button><button id="management-catalog-refresh" type="button" class="button secondary" data-catalog-text="refresh"></button></div>
    <p id="management-catalog-status" role="status" aria-live="polite" aria-atomic="true"></p><div id="management-catalog-error" role="alert" hidden></div>
    <section id="management-catalog-initialize" hidden><p data-catalog-text="initializeHelp"></p><button id="management-catalog-initialize-preview" type="button" class="button secondary" data-catalog-text="initializePreview"></button></section>
    <section id="management-catalog-browser" hidden><form id="management-catalog-search-form" class="management-search"><label for="management-catalog-search" data-catalog-text="search"></label><input id="management-catalog-search" type="search" maxlength="256"><button type="submit" class="button secondary" data-catalog-text="submit"></button></form><p id="management-catalog-summary"></p><p id="management-catalog-freshness" class="muted"></p><p id="management-catalog-trash-help" data-catalog-text="trashHelp" hidden></p><div class="management-actions"><label id="management-catalog-select-page-label"><input id="management-catalog-select-page" type="checkbox"><span data-catalog-text="selectPage"></span></label><button id="management-catalog-clear" type="button" class="button ghost" data-catalog-text="clear"></button><button id="management-catalog-preview" type="button" class="button secondary"></button><button id="management-catalog-sync-preview" type="button" class="button secondary" data-catalog-text="syncPreview"></button></div><p id="management-catalog-selection"></p><ul id="management-catalog-rows" class="management-rows"></ul><p id="management-catalog-empty" data-catalog-text="empty" hidden></p><div class="management-actions"><button id="management-catalog-previous" type="button" class="button secondary" data-catalog-text="previous"></button><p id="management-catalog-page"></p><button id="management-catalog-next" type="button" class="button secondary" data-catalog-text="next"></button></div></section>
    <section id="management-catalog-review" class="management-operation" aria-labelledby="management-catalog-review-title" hidden><h3 id="management-catalog-review-title" tabindex="-1"></h3><div id="management-catalog-review-content"></div><p data-catalog-text="cancelHelp"></p><div class="management-actions"><button id="management-catalog-confirm" type="button" class="button primary"></button><button id="management-catalog-cancel" type="button" class="button secondary" data-catalog-text="cancel"></button></div></section>
    <section id="management-catalog-operation" class="management-operation" aria-labelledby="management-catalog-operation-title" hidden><h3 id="management-catalog-operation-title" data-catalog-text="operationTitle"></h3><p id="management-catalog-operation-status" role="status" aria-live="polite" aria-atomic="true"></p><p id="management-catalog-operation-id" class="management-identity"></p><p id="management-catalog-operation-help" data-catalog-text="operationHelp"></p><div id="management-catalog-operation-content"></div><div id="management-catalog-operation-error" role="alert" hidden></div><p id="management-catalog-refresh-error" data-catalog-text="refreshError" hidden></p><p id="management-catalog-recovery-warning" data-catalog-text="recoveryWarning" hidden></p><div class="management-actions"><button id="management-catalog-check" type="button" class="button secondary" data-catalog-text="check"></button><button id="management-catalog-retry" type="button" class="button secondary" data-catalog-text="retry" hidden></button><button id="management-catalog-dismiss" type="button" class="button secondary" data-catalog-text="dismiss" hidden></button></div></section>`;
  const $ = id => host.querySelector(`#management-catalog-${id}`);
  let state = model.snapshot(), rowsSignature = null, reviewSignature = null, operationSignature = null;
  function paragraph(parent, key, params) { const p = make('p'); p.textContent = t(key, params); parent.append(p); return p; }
  function problem(node, error) {
    const signature = JSON.stringify([error, i18n.locale]); if (node.dataset.signature === signature) return;
    node.dataset.signature = signature; node.hidden = !error; node.replaceChildren(); if (!error) return;
    paragraph(node, `error.${errors[error.code] || 'general'}`);
    const details = make('details'), label = make('summary'), literal = make('p'); label.textContent = t('details'); literal.textContent = [error.message, error.code].filter(Boolean).join('\n'); details.append(label, literal); node.append(details);
  }
  function exactSelection(parent, rows) {
    const details = make('details'); details.open = true; const summary = make('summary'), list = make('ol'); summary.textContent = t('exactSelection', {count: rows.length});
    for (const row of rows) { const li = make('li'), title = make('strong'), id = make('p', 'management-identity'); title.textContent = row.title || row.edition_id; id.textContent = row.edition_id; li.append(title, id); list.append(li); }
    details.append(summary, list); parent.append(details);
  }
  function impact(parent, record) {
    const p = record.preview, effects = p.effects, summary = record.summary; parent.replaceChildren();
    if (record.kind === 'initialize') {
      paragraph(parent, 'initializeCounts', {songs: p.counts.managed_songs, packs: p.counts.packs, memberships: p.counts.memberships});
      paragraph(parent, 'retained', {payload: p.retained_payload_bytes, sources: p.retained_source_bytes});
    } else {
      if (record.kind === 'sync_imports') paragraph(parent, 'syncImpact', {songs: summary.changed_song_count, memberships: effects.added_memberships.length, packs: (effects.adopted_packs || []).length});
      else paragraph(parent, 'impact', {selected: summary.selected_count, changed: summary.changed_song_count, removed: summary.removed_membership_count, restored: summary.restored_membership_count, shared: summary.shared_song_count});
      exactSelection(parent, record.selected);
      const details = make('details'); details.open = true; const label = make('summary'), list = make('ul'); label.textContent = t('affectedPacks', {count: summary.affected_packs.length});
      for (const pack of summary.affected_packs) { const li = make('li'), name = make('strong'), id = make('p', 'management-identity'); name.textContent = pack.name; id.textContent = `${pack.import_pack_id}\n${pack.collection_id}`; li.append(name, id); paragraph(li, 'packSelection', {count: pack.selected_song_count}); list.append(li); }
      details.append(label, list); parent.append(details);
      paragraph(parent, 'retained', {payload: effects.retained_payload_bytes, sources: effects.retained_source_bytes});
      if (effects.noops.length || effects.blocked_memberships.length) paragraph(parent, 'partial', {noops: effects.noops.length, blocked: effects.blocked_memberships.length});
      if (effects.blocked_memberships.length) {
        const blocked = make('ul');
        for (const row of effects.blocked_memberships) { const li = make('li'); li.textContent = `${row.membership.song} · ${row.membership.pack}`; blocked.append(li); }
        parent.append(blocked);
      }
    }
    paragraph(parent, record.kind === 'trash_songs' ? 'trashImpact' : record.kind === 'restore_songs' ? 'restoreImpact' : record.kind === 'sync_imports' ? 'syncHelp' : 'initializeEffect');
  }
  function renderRows() {
    const signature = JSON.stringify([state.response, i18n.locale]); if (signature === rowsSignature) return;
    rowsSignature = signature; $('rows').replaceChildren();
    for (const row of state.response?.rows || []) {
      const li = make('li', 'management-row'); li.dataset.catalogSong = row.edition_id;
      const label = make('label'), input = make('input'), title = make('strong'); input.type = 'checkbox'; input.dataset.catalogEdition = row.edition_id; input.setAttribute('aria-label', t('select', {title: row.title, id: row.edition_id})); title.textContent = row.title || row.score_id;
      input.addEventListener('change', () => model.toggle(row, input.checked)); label.append(input, title); li.append(label);
      const id = make('p', 'management-identity'); id.textContent = row.edition_id; li.append(id);
      if (!row.catalog_managed) paragraph(li, 'unmanaged');
      if (!row.physical_available) paragraph(li, 'unavailablePayload');
      if (row.trashed_by) { const owner = make('p', 'management-identity'); owner.textContent = t('trashOwner', {id: row.trashed_by}); li.append(owner); }
      const memberships = make('details'), summary = make('summary'), list = make('ul'); summary.textContent = t('memberships', {count: row.pack_count});
      for (const pack of row.packs) { const member = make('li'); member.textContent = `${pack.name} · ${pack.import_pack_id}`; list.append(member); }
      memberships.append(summary, list); li.append(memberships); $('rows').append(li);
    }
  }
  function render() {
    for (const node of host.querySelectorAll('[data-catalog-text]')) node.textContent = t(node.dataset.catalogText);
    host.dataset.phase = state.phase; const busy = ['loading', 'previewing', 'submitting'].includes(state.phase), pending = model.pending(), enabled = state.phase === 'ready' && !state.stale && !pending;
    host.setAttribute('aria-busy', String(busy)); const initialized = state.status?.state === 'ready';
    $('initialize').hidden = !state.status || initialized; $('browser').hidden = !initialized;
    $('active').disabled = $('trash').disabled = !initialized || busy; $('refresh').disabled = busy;
    $('active').setAttribute('aria-pressed', String(state.query.view === 'active')); $('trash').setAttribute('aria-pressed', String(state.query.view === 'trash'));
    $('status').textContent = busy ? t(state.phase === 'submitting' ? 'submitting' : 'loading') : state.stale ? t('stale') : '';
    problem($('error'), state.error);
    $('initialize-preview').disabled = busy || Boolean(pending);
    const response = state.response;
    $('summary').textContent = response ? t('summary', {active: response.counts.active_songs, trash: response.counts.trashed_songs, managed: response.counts.managed_songs}) : '';
    $('freshness').textContent = response ? t('freshness', {time: i18n.formatDateTime(response.freshness.verified_at_unix_ms)}) : '';
    $('trash-help').hidden = state.query.view !== 'trash'; $('select-page-label').hidden = state.query.view === 'trash';
    renderRows(); const selected = new Set(state.selected.map(row => row.edition_id)), rows = response?.rows || [], visible = rows.filter(row => selected.has(row.edition_id)).length;
    for (const box of $('rows').querySelectorAll('[data-catalog-edition]')) { const row = rows.find(item => item.edition_id === box.dataset.catalogEdition); box.checked = selected.has(row.edition_id); box.disabled = !enabled || !model.selectable(row); }
    const selectable = rows.filter(row => model.selectable(row)); $('select-page').disabled = !enabled || !selectable.length; $('select-page').checked = selectable.length > 0 && selectable.every(row => selected.has(row.edition_id)); $('select-page').indeterminate = visible > 0 && !$('select-page').checked;
    $('selection').textContent = t('selection', {count: selected.size, hidden: selected.size - visible}); $('clear').disabled = !selected.size || busy;
    $('preview').textContent = t(state.query.view === 'trash' ? 'restorePreview' : 'trashPreview'); $('preview').disabled = !enabled || !selected.size;
    $('sync-preview').disabled = !enabled; $('sync-preview').hidden = !state.status?.supported_operations?.includes('sync_inventory') || state.query.view !== 'active';
    $('empty').hidden = !response || rows.length > 0 || busy; $('page').textContent = response ? t('page', {page: state.page + 1, total: response.total}) : '';
    $('previous').disabled = busy || state.stale || state.page === 0; $('next').disabled = busy || state.stale || !response?.next_cursor;
    const preview = state.preview; $('review').hidden = !preview;
    const currentReview = JSON.stringify([preview, i18n.locale]); if (preview && reviewSignature !== currentReview) { reviewSignature = currentReview; $('review-title').textContent = t(`review.${preview.kind}`); impact($('review-content'), preview); }
    $('confirm').textContent = t(`confirm.${preview?.kind || 'trash_songs'}`); $('confirm').disabled = busy || Boolean(pending); $('cancel').disabled = state.phase === 'submitting';
    const op = state.operation; $('operation').hidden = !op;
    if (op) {
      $('operation-status').textContent = t(`outcome.${op.phase}`, op.phase === 'committed' ? {count: op.kind === 'initialize' ? op.preview.counts.managed_songs : op.summary.changed_song_count} : {});
      $('operation-id').textContent = t('operationId', {id: op.operation_id, library: op.library_id});
      const signature = JSON.stringify([op, i18n.locale]); if (signature !== operationSignature) { operationSignature = signature; impact($('operation-content'), op); }
      $('operation-help').hidden = op.phase === 'committed'; $('check').disabled = state.phase === 'submitting' || state.checking; $('retry').hidden = op.phase !== 'not_committed' || op.dismissed; $('retry').disabled = Boolean(state.checking);
      $('dismiss').hidden = state.result?.outcome !== 'not_committed' || op.dismissed; $('dismiss').disabled = Boolean(state.checking);
    }
    problem($('operation-error'), state.operationError); $('refresh-error').hidden = !state.refreshError; $('recovery-warning').hidden = !state.recoveryWarning;
  }
  $('active').addEventListener('click', () => { $('search').value = ''; void model.setView({view: 'active', search: ''}); });
  $('trash').addEventListener('click', () => { $('search').value = ''; void model.setView({view: 'trash', search: ''}); });
  $('refresh').addEventListener('click', () => void (state.status?.state === 'ready' ? model.refresh() : model.open()));
  $('search-form').addEventListener('submit', event => { event.preventDefault(); void model.setView({search: $('search').value}); });
  $('initialize-preview').addEventListener('click', () => void model.previewInitialize()); $('preview').addEventListener('click', () => void model.previewSelection()); $('sync-preview').addEventListener('click', () => void model.previewSync());
  $('confirm').addEventListener('click', () => void model.commit()); $('cancel').addEventListener('click', () => model.cancelPreview());
  $('check').addEventListener('click', () => void model.checkOperation()); $('retry').addEventListener('click', () => void model.retry()); $('dismiss').addEventListener('click', () => model.acknowledgeUncommitted());
  $('clear').addEventListener('click', () => model.clearSelection()); $('select-page').addEventListener('change', () => model.selectPage($('select-page').checked));
  $('previous').addEventListener('click', () => void model.previous()); $('next').addEventListener('click', () => void model.next());
  const unsubscribe = model.subscribe(next => { state = next; render(); }), unlocale = i18n.subscribe(render); render();
  return {element: host, model, open() { host.hidden = false; void model.open(); }, close() { host.hidden = true; model.close(); }, invalidate() { model.invalidate(); }, destroy() { unsubscribe(); unlocale(); model.destroy(); host.remove(); }};
}

import {catalogQuery, checkedRecoveryRecord} from './library-catalog-contract.js';
import {LibraryOperationStore} from './library-operation-store.js';
const failure = error => ({code: error?.code || 'library_transport', message: error?.message || String(error)});
/** Owns metadata and operation recovery; never owns a score, recorder or player. */
export class LibraryCatalogModel {
  constructor({getStorage, getProtectedSong = () => null, operationStore = new LibraryOperationStore(), onCommitted = async () => {}, onObserverError = error => globalThis.reportError?.(error)} = {}) {
    Object.assign(this, {getStorage, getProtectedSong, operationStore, onCommitted, onObserverError});
    this.listeners = new Set(); this.selected = new Map(); this.cursors = [null]; this.readVersion = 0; this.invalidationVersion = 0;
    this.state = {phase: 'idle', status: null, query: catalogQuery(), response: null, packs: null, page: 0, stale: false, preview: null, operation: null, result: null, error: null, operationError: null, refreshError: false};
  }
  snapshot() { return structuredClone({...this.state, selected: [...this.selected.values()]}); }
  subscribe(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  publish(patch = {}) {
    Object.assign(this.state, patch); if (this.destroyed) return;
    for (const listener of this.listeners) { try { listener(this.snapshot()); } catch (error) { this.onObserverError(error); } }
  }
  pending() { return this.state.operation && this.state.operation.phase !== 'committed' && !this.state.operation.dismissed; }
  async storage() {
    const storage = await this.getStorage();
    if (storage.info.kind !== 'native' || !storage.info.capabilities.manageCatalog) throw Object.assign(new Error('Native catalog management is unavailable.'), {code: 'catalog_unavailable'});
    this.storageOwner = storage; return storage;
  }
  startRead(phase = 'loading') {
    this.controller?.abort(); const controller = new AbortController(), version = ++this.readVersion;
    this.controller = controller; this.publish({phase, error: null, preview: null});
    return {signal: controller.signal, owns: () => version === this.readVersion && !this.destroyed && this.opened};
  }
  async open() {
    this.opened = true; if (this.writing) { this.publish(); return; }
    const read = this.startRead();
    try {
      const storage = await this.storage(), status = await storage.catalogStatus({signal: read.signal}); if (!read.owns()) return;
      const saved = this.operationStore.get(status.library_id), record = saved && checkedRecoveryRecord(saved, status.library_id);
      this.publish({status, operation: record, result: null, operationError: null});
      if (record) await this.checkOperation();
      if (!read.owns()) return;
      if (status.state === 'ready' || this.state.result?.outcome === 'committed') await this.refresh();
      else this.publish({phase: 'uninitialized'});
    } catch (error) { if (read.owns()) this.publish({phase: 'error', error: failure(error)}); }
  }
  close() {
    this.opened = false; this.readVersion++; this.controller?.abort(); this.selected.clear();
    this.publish({preview: null, phase: this.writing ? 'submitting' : 'idle'});
  }
  destroy() { this.close(); this.destroyed = true; this.listeners.clear(); }
  supportsOrganization() { return ['create_pack', 'rename_pack', 'add_memberships'].every(action => this.state.status?.supported_operations?.includes(action)); }
  async readPacks(storage, response, signal) {
    const packs = [], seenCursors = new Set(); let cursor = null;
    do {
      const page = await storage.queryCatalog({view: 'packs', collection_id: null, search: '', limit: 100, cursor, refresh: false, libraryId: response.library_id, signal});
      if (['library_id', 'generation', 'catalog_digest', 'snapshot_id'].some(key => page[key] !== response[key])) throw Object.assign(new Error('Pack and song metadata do not share a verified snapshot. Refresh before continuing.'), {code: 'catalog_stale'});
      packs.push(...page.rows);
      if (packs.length > 256 || new Set(packs.map(row => row.collection_id)).size !== packs.length || (page.next_cursor && seenCursors.has(page.next_cursor))) throw Object.assign(new Error('The pack list exceeded its verified bounds.'), {code: 'catalog_invalid_response'});
      cursor = page.next_cursor; if (cursor) seenCursors.add(cursor);
      if (!cursor && packs.length !== page.total) throw Object.assign(new Error('The pack list was incomplete.'), {code: 'catalog_invalid_response'});
    } while (cursor);
    return packs;
  }
  async read({refresh = false, page = this.state.page} = {}) {
    if (!this.opened || this.destroyed) return false;
    const read = this.startRead(), invalidation = this.invalidationVersion;
    try {
      const storage = await this.storage(), response = await storage.queryCatalog({...this.state.query, refresh, cursor: this.cursors[page], libraryId: this.state.status.library_id, signal: read.signal});
      if (!read.owns()) return false;
      const packs = this.supportsOrganization() ? await this.readPacks(storage, response, read.signal) : null;
      if (!read.owns()) return false;
      if (page > 0 && response.snapshot_id !== this.state.response?.snapshot_id) throw Object.assign(new Error('The catalog snapshot changed. Refresh and review the exact selection again.'), {code: 'catalog_stale'});
      if (this.state.response && response.snapshot_id !== this.state.response.snapshot_id) this.selected.clear();
      this.publish({phase: 'ready', response, packs, page, stale: invalidation !== this.invalidationVersion || (!refresh && this.state.stale)}); return true;
    } catch (error) { if (read.owns()) { this.selected.clear(); this.publish({phase: 'error', response: null, packs: null, preview: null, error: failure(error), stale: true}); } return false; }
  }
  refresh() { this.cursors = [null]; this.selected.clear(); this.publish({preview: null}); return this.read({refresh: true, page: 0}); }
  setView(patch) {
    let query; try { query = catalogQuery({...this.state.query, ...patch, cursor: null, refresh: false}); } catch (error) { this.publish({error: failure(error)}); return Promise.resolve(false); }
    this.selected.clear(); this.cursors = [null]; this.publish({query, page: 0, response: null, packs: null, preview: null}); return this.read({page: 0});
  }
  next() { if (!this.state.response?.next_cursor || this.state.phase === 'loading' || this.state.stale) return Promise.resolve(false); const page = this.state.page + 1; this.cursors[page] = this.state.response.next_cursor; return this.read({page}); }
  previous() { return this.state.page > 0 && this.state.phase !== 'loading' && !this.state.stale ? this.read({page: this.state.page - 1}) : Promise.resolve(false); }
  protectedEdition(libraryId = this.state.status?.library_id) {
    const song = this.getProtectedSong();
    return libraryId === this.state.status?.library_id && this.storageOwner?.info.kind === 'native' && this.storageOwner.ownsCleanSong?.(song) && /^native:song-[0-9a-f]{64}$/.test(song.libraryKey)
      ? `clean:${song.libraryKey.slice(7)}` : null;
  }
  selectionProtected(rows = [...this.selected.values()]) { const id = this.protectedEdition(); return this.state.query.view !== 'trash' && Boolean(id && rows.some(row => row.storage_kind === 'clean' && row.edition_id === id)); }
  recordProtected(record) { return record?.kind === 'trash_songs' && record.preview.request.action.song_ids.includes(this.protectedEdition(record.library_id || this.state.status?.library_id)); }
  protectionError() { return {code: 'catalog_current_song', message: 'This current complete song still needs native notation pages. Select another song before moving this edition to Trash.'}; }
  sessionChanged() { this.publish(); }
  selectable(row) { return this.state.query.view !== 'packs' && row.catalog_managed && row.physical_available && (!this.selected.size || this.state.query.view !== 'trash' || [...this.selected.values()][0].trashed_by === row.trashed_by); }
  toggle(row, checked) {
    if (this.state.phase !== 'ready' || this.state.stale || this.pending() || this.writing) return;
    const found = this.state.response?.rows.find(item => item.edition_id === row.edition_id);
    if (!found || checked && !this.selectable(found)) return;
    if (checked) this.selected.set(found.edition_id, structuredClone(found)); else this.selected.delete(found.edition_id);
    this.publish({preview: null, error: null});
  }
  selectPage(checked) {
    // A Trash page may contain different operations. Never choose one silently.
    if (this.state.query.view !== 'active') return;
    if (this.state.phase !== 'ready' || this.state.stale || this.pending() || this.writing) return;
    for (const row of this.state.response?.rows || []) if (this.selectable(row)) { if (checked) this.selected.set(row.edition_id, structuredClone(row)); else this.selected.delete(row.edition_id); }
    this.publish({preview: null, error: null});
  }
  clearSelection() { this.selected.clear(); this.publish({preview: null}); }
  invalidate() { if (this.state.phase === 'previewing') this.cancelPreview(); this.invalidationVersion++; this.selected.clear(); this.publish({stale: true, preview: null}); }
  cancelPreview() { if (!this.state.preview && this.state.phase !== 'previewing') return; this.readVersion++; this.controller?.abort(); this.publish({preview: null, phase: this.state.status?.state === 'uninitialized' ? 'uninitialized' : this.state.response ? 'ready' : 'idle'}); }
  async previewInitialize() {
    if (this.pending() || this.writing || this.state.status?.state !== 'uninitialized') return;
    const read = this.startRead('previewing');
    try { const value = await (await this.storage()).previewCatalogInitialize({libraryId: this.state.status.library_id, signal: read.signal}); if (read.owns()) this.publish({phase: 'uninitialized', stale: false, preview: {kind: 'initialize', preview: value.preview, selected: []}}); }
    catch (error) { if (read.owns()) this.publish({phase: 'uninitialized', error: failure(error)}); }
  }
  async previewSelection() {
    if (this.state.phase !== 'ready' || this.state.stale || this.pending() || this.writing || !this.selected.size) return;
    if (this.selectionProtected()) { this.publish({preview: null, error: this.protectionError()}); return; }
    const selected = structuredClone([...this.selected.values()]), kind = this.state.query.view === 'trash' ? 'restore_songs' : 'trash_songs', response = this.state.response;
    const request = {action: kind, edition_ids: selected.map(row => row.edition_id), trash_operation_id: kind === 'restore_songs' ? selected[0].trashed_by : null, expected_generation: response.generation, catalog_digest: response.catalog_digest, library_id: response.library_id};
    const read = this.startRead('previewing');
    try { const value = await (await this.storage()).previewCatalog({...request, signal: read.signal}); if (read.owns()) { const preview = {kind, preview: value.preview, summary: value.summary, selected}; if(this.recordProtected(preview))this.publish({phase: 'ready', preview: null, error: this.protectionError()});else this.publish({phase: 'ready', preview}); } }
    catch (error) { if (read.owns()) this.publish({phase: 'ready', preview: null, error: failure(error), stale: this.state.stale || ['catalog_stale', 'catalog_conflict'].includes(error.code)}); }
  }
  async previewOrganization(kind, {name = null, collectionId = null} = {}) {
    if (!['create_pack', 'rename_pack', 'add_memberships'].includes(kind) || !this.supportsOrganization() || this.state.phase !== 'ready' || this.state.stale || this.pending() || this.writing || !this.state.packs) return;
    const target = this.state.packs.find(pack => pack.collection_id === collectionId);
    if (kind !== 'create_pack' && target?.kind !== 'custom') { this.publish({preview: null, error: {code: 'catalog_invalid_request', message: 'Choose a verified custom pack.'}}); return; }
    if (kind !== 'add_memberships') {
      name = typeof name === 'string' ? name.trim() : '';
      if (!name || new TextEncoder().encode(name).length > 256 || /[\u0000-\u001f\u007f-\u009f]/u.test(name)) { this.publish({preview: null, error: {code: 'catalog_pack_name', message: 'Use a nonempty pack name of at most 256 UTF-8 bytes, without control characters.'}}); return; }
    }
    const selected = kind === 'add_memberships' ? structuredClone([...this.selected.values()]) : [];
    if (kind === 'add_memberships' && (this.state.query.view !== 'active' || !selected.length || selected.some(row => !this.selectable(row)))) return;
    const response = this.state.response, request = {action: kind, edition_ids: selected.map(row => row.edition_id), collection_id: kind === 'create_pack' ? null : collectionId, name: kind === 'add_memberships' ? null : typeof name === 'string' ? name.trim() : name, trash_operation_id: null, expected_generation: response.generation, catalog_digest: response.catalog_digest, library_id: response.library_id};
    const read = this.startRead('previewing');
    try {
      const value = await (await this.storage()).previewCatalog({...request, signal: read.signal});
      if (read.owns()) this.publish({phase: 'ready', preview: {kind, preview: value.preview, summary: value.summary, selected}});
    } catch (error) { if (read.owns()) this.publish({phase: 'ready', preview: null, error: failure(error), stale: this.state.stale || ['catalog_stale', 'catalog_conflict'].includes(error.code)}); }
  }
  async previewSync() {
    if (this.state.phase !== 'ready' || this.state.stale || this.pending() || this.writing || !this.state.status?.supported_operations?.includes('sync_inventory')) return;
    const response = this.state.response, read = this.startRead('previewing');
    try {
      const value = await (await this.storage()).previewCatalogSync({library_id: response.library_id, expected_generation: response.generation, catalog_digest: response.catalog_digest, signal: read.signal});
      if (read.owns()) this.publish({phase: 'ready', preview: {kind: 'sync_imports', preview: value.preview, summary: value.summary, selected: (value.preview.effects.adopted_songs || []).map(id => ({edition_id: id, title: response.rows.find(row => row.edition_id === id)?.title || id}))}});
    } catch (error) { if (read.owns()) this.publish({phase: 'ready', error: failure(error)}); }
  }
  acknowledgeUncommitted() {
    const record = this.state.operation;
    if (!record || this.state.result?.outcome !== 'not_committed' || this.writing || this.checking) return;
    const next = {...record, dismissed: true};
    try { this.operationStore.put(next); this.publish({operation: next, preview: null}); }
    catch (error) { this.publish({operationError: failure(error)}); }
  }
  async commit() {
    if (!this.state.preview || this.writing || this.pending() || this.state.stale || !['ready', 'uninitialized'].includes(this.state.phase)) return false;
    const owner = this.state.preview;
    if (this.recordProtected(owner)) { this.publish({error: this.protectionError()}); return false; }
    let storage; try { storage = await this.storage(); } catch(error) { this.publish({error: failure(error)}); return false; }
    if(this.state.preview !== owner || this.writing || this.pending())return false;
    if(this.recordProtected(owner)){this.publish({error: this.protectionError()});return false;}
    const p = structuredClone(owner), operation_id = p.kind === 'initialize' ? p.preview.operation_id : p.preview.request.operation_id;
    const record = {...p, library_id: this.state.status.library_id, operation_id, phase: 'submitted'};
    try {
      const saved = this.operationStore.get(record.library_id);
      if (saved && saved.operation_id !== operation_id && saved.phase !== 'committed' && !saved.dismissed) {
        this.publish({operation: checkedRecoveryRecord(saved, record.library_id), result: null, preview: null});
        throw Object.assign(new Error('An earlier operation needs a status check before another write.'), {code: 'catalog_pending_operation'});
      }
      this.operationStore.put(record);
    } catch (error) { this.publish({error: failure(error)}); return false; }
    return this.submit(record, storage);
  }
  async submit(record, storage) {
    this.writing = true; this.selected.clear(); this.publish({operation: record, preview: null, result: null, operationError: null, error: null, phase: 'submitting'});
    try { storage ||= await this.storage(); if(this.recordProtected(record))throw Object.assign(new Error(this.protectionError().message),{code:'catalog_current_song',outcome:'not_committed'}); const result = await storage.commitCatalog(record); await this.applyResult(record, result); return true; }
    catch (error) {
      const next = {...record, phase: error.outcome === 'not_committed' ? 'not_committed' : 'uncertain'};
      this.saveOutcome(next); this.publish({operation: next, operationError: failure(error), phase: this.opened ? (this.state.response ? 'ready' : 'uninitialized') : 'idle'}); return false;
    } finally { this.writing = false; this.publish(); }
  }
  saveOutcome(record) {
    try { const current = this.operationStore.get(record.library_id); if (current && current.operation_id !== record.operation_id) return; this.operationStore.put(record); this.publish({recoveryWarning: false}); } catch { this.publish({recoveryWarning: true}); }
  }
  async applyResult(record, result) {
    const next = {...record, phase: result.outcome}; this.saveOutcome(next);
    this.publish({operation: next, result, operationError: null});
    if (result.outcome === 'committed') {
      if (!this.destroyed) { try { await this.onCommitted(); this.publish({refreshError: false}); } catch { this.publish({refreshError: true}); } }
      if (!this.destroyed) this.publish({status: {...this.state.status, state: 'ready', generation: result.generation, catalog_digest: result.catalog_digest}});
      if (this.opened && !this.destroyed) await this.refresh();
    }
  }
  async checkOperation() {
    const record = this.state.operation; if (!record || this.writing || this.checking) return;
    this.checking = true; this.publish({checking: true, operationError: null});
    try { const result = await (await this.storage()).catalogOperation(record); if (this.state.operation?.operation_id === record.operation_id) await this.applyResult(record, result); }
    catch (error) { if (this.state.operation?.operation_id === record.operation_id) this.publish({operationError: failure(error)}); }
    finally { this.checking = false; this.publish({checking: false}); }
  }
  async retry() {
    const record = this.state.operation; if (record?.phase !== 'not_committed' || this.writing || this.checking) return;
    this.checking = true; this.publish({checking: true, operationError: null});
    try {
      const storage = await this.storage(), status = await storage.catalogStatus();
      if(this.recordProtected(record)){this.publish({operationError: this.protectionError()});return;}
      if (status.library_id !== record.library_id || (record.kind === 'initialize' ? status.state !== 'uninitialized' : status.generation !== record.preview.request.expected_generation || status.catalog_digest !== record.preview.base_digest)) throw Object.assign(new Error('The library changed. This frozen operation cannot be retried. Keep its identity and check status.'), {code: 'catalog_stale'});
      const next = {...record, phase: 'submitted'}; this.operationStore.put(next); await this.submit(next, storage);
    } catch (error) { this.publish({operationError: failure(error)}); }
    finally { this.checking = false; this.publish({checking: false}); }
  }
}

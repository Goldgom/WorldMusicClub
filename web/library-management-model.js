import {managementRequest} from './library-management-contract.js';

const failure = error => ({code: error?.code || 'library_transport', message: error?.message || String(error)});
/** Metadata and selection ownership only. No score, preview, audio, takes or IDB. */
export class LibraryManagementModel {
  constructor({getStorage, onObserverError = error => globalThis.reportError?.(error)} = {}) {
    this.getStorage = getStorage;
    this.onObserverError = onObserverError;
    this.listeners = new Set();
    this.version = 0;
    this.invalidationVersion = 0;
    this.selected = new Map();
    this.cursors = [null];
    this.state = {phase: 'idle', query: managementRequest(), response: null, error: null, page: 0, stale: false};
  }
  snapshot() { return structuredClone({...this.state, selected: [...this.selected.values()]}); }
  subscribe(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  publish(patch = {}) {
    if (this.destroyed) return;
    Object.assign(this.state, patch);
    for (const listener of this.listeners) { try { listener(this.snapshot()); } catch (error) { this.onObserverError(error); } }
  }
  async read({refresh = false, page = this.state.page} = {}) {
    if (this.destroyed) return false;
    this.controller?.abort();
    const version = ++this.version, invalidationVersion = this.invalidationVersion, controller = new AbortController();
    this.controller = controller;
    const query = {...this.state.query, cursor: this.cursors[page], refresh};
    this.publish({phase: 'loading', error: null});
    try {
      const storage = await this.getStorage();
      if (version !== this.version || this.destroyed) return false;
      if (storage.info.kind !== 'native' || !storage.info.capabilities.manageQuery || typeof storage.queryManagement !== 'function') throw Object.assign(new Error('Native metadata management is unavailable.'), {code: 'library_management_unavailable'});
      const response = await storage.queryManagement({...query, signal: controller.signal});
      if (version !== this.version || this.destroyed) return false;
      if (page > 0 && response.snapshot_id !== this.state.response?.snapshot_id) throw Object.assign(new Error('The metadata snapshot changed. Refresh before browsing more pages.'), {code: 'library_snapshot_stale'});
      if (this.state.response && response.snapshot_id !== this.state.response.snapshot_id) this.selected.clear();
      this.publish({phase: 'ready', response, page, stale: invalidationVersion !== this.invalidationVersion || (!refresh && this.state.stale)});
      return true;
    } catch (error) {
      if (version !== this.version || this.destroyed) return false;
      this.publish({phase: 'error', error: failure(error), stale: this.state.stale || Boolean(this.state.response)});
      return false;
    }
  }
  refresh() {
    this.cursors = [null]; this.selected.clear();
    return this.read({refresh: true, page: 0});
  }
  setView(patch) {
    let query;
    try { query = managementRequest({...this.state.query, ...patch, cursor: null, refresh: false}); }
    catch (error) { this.publish({error: failure(error), phase: 'error'}); return Promise.resolve(false); }
    this.cursors = [null]; this.selected.clear();
    this.publish({query, page: 0, response: null});
    return this.read({page: 0});
  }
  next() {
    if (this.state.phase === 'loading' || !this.state.response?.next_cursor) return Promise.resolve(false);
    const page = this.state.page + 1; this.cursors[page] = this.state.response.next_cursor;
    return this.read({page});
  }
  previous() {
    if (this.state.phase === 'loading' || this.state.page < 1) return Promise.resolve(false);
    return this.read({page: this.state.page - 1});
  }
  toggle(row, checked) {
    if (this.state.phase !== 'ready' || this.state.stale) return;
    const available = this.state.response.view === 'songs' ? this.state.response.rows : [];
    const found = available.find(item => item.edition_id === row.edition_id);
    if (!found) return;
    if (checked) this.selected.set(found.edition_id, structuredClone(found)); else this.selected.delete(found.edition_id);
    this.publish();
  }
  selectPage(checked) {
    if (this.state.phase !== 'ready' || this.state.stale || this.state.response?.view !== 'songs') return;
    for (const row of this.state.response.rows) { if (checked) this.selected.set(row.edition_id, structuredClone(row)); else this.selected.delete(row.edition_id); }
    this.publish();
  }
  clearSelection({hiddenOnly = false} = {}) {
    if (!hiddenOnly) this.selected.clear();
    else { const visible = new Set(this.state.response?.rows.map(row => row.edition_id)); for (const id of this.selected.keys()) if (!visible.has(id)) this.selected.delete(id); }
    this.publish();
  }
  invalidate() { this.invalidationVersion++; this.selected.clear(); this.publish({stale: true}); }
  close() { this.version++; this.controller?.abort(); this.publish({phase: 'idle'}); }
  destroy() { this.close(); this.destroyed = true; this.listeners.clear(); }
}

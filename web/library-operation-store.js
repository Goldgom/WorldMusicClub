/** Small renderer recovery pointer; the native journal remains authoritative. */
export const LIBRARY_OPERATION_STORAGE_KEY = 'worldmusichub.library-operation.v1';
const maxLibraries = 16, maxBytes = 512 * 1024;
const fail = () => Object.assign(new Error('The operation recovery identity could not be saved. No new native write was submitted.'), {code: 'library_operation_storage'});
const serializable = value => {
  const encoded = JSON.stringify(value);
  if (typeof encoded !== 'string' || new TextEncoder().encode(encoded).length > maxBytes) throw fail();
  return encoded;
};
export class LibraryOperationStore {
  constructor({storage} = {}) { if (storage !== undefined) this.storage = storage; else { try { this.storage = globalThis.localStorage; } catch { this.storage = null; } } }
  read() {
    try {
      const text = this.storage?.getItem(LIBRARY_OPERATION_STORAGE_KEY);
      if (text === null || text === undefined) return {version: 1, libraries: {}};
      if (new TextEncoder().encode(text).length > maxBytes) throw fail();
      const value = JSON.parse(text);
      if (value?.version !== 1 || !value.libraries || Array.isArray(value.libraries) || typeof value.libraries !== 'object' || Object.keys(value.libraries).length > maxLibraries) throw fail();
      for (const [id, record] of Object.entries(value.libraries)) if (!id || id.length > 256 || record?.library_id !== id || typeof record.operation_id !== 'string' || !record.operation_id || record.operation_id.length > 256) throw fail();
      return value;
    } catch { throw fail(); }
  }
  get(libraryId) { return structuredClone(this.read().libraries[libraryId] || null); }
  put(record) {
    try {
      if (!record || typeof record.library_id !== 'string' || !record.library_id || record.library_id.length > 256 || typeof record.operation_id !== 'string' || !record.operation_id || record.operation_id.length > 256) throw fail();
      const value = this.read();
      if (!Object.hasOwn(value.libraries, record.library_id) && Object.keys(value.libraries).length >= maxLibraries) {
        const terminal = Object.entries(value.libraries).find(([, item]) => item.phase === 'committed' || item.phase === 'not_committed' && item.dismissed === true);
        if (!terminal) throw fail();
        delete value.libraries[terminal[0]];
      }
      Object.defineProperty(value.libraries, record.library_id, {value: structuredClone(record), writable: true, enumerable: true, configurable: true});
      const encoded = serializable(value);
      this.storage.setItem(LIBRARY_OPERATION_STORAGE_KEY, encoded);
      if (this.storage.getItem(LIBRARY_OPERATION_STORAGE_KEY) !== encoded) throw fail();
      return structuredClone(record);
    } catch { throw fail(); }
  }
}

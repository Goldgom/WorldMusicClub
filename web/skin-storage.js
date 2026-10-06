import {SKIN_LIMITS, SkinValidationError, parseSkinManifest, validateSkinResources, resolveSkin} from './skin-format.js';

// Capabilities of the current presentation adapter, not a new skin format.
// Images decorate the home artwork; the shared score lane keeps its own ink.
export const APP_SKIN_FEATURES = Object.freeze(['marker_shapes', 'note_patterns']);
export const SKIN_DATABASE = 'worldmusicclub.skins.v1';

export async function prepareSkinPackage(manifest, resources = new Map()) {
  const original = parseSkinManifest(manifest); // Imports fail closed; never install a fallback as the requested skin.
  const text = JSON.stringify(original);
  const checked = await validateSkinResources(original, resources);
  const accepted = new Map(original.assets.filter(asset => checked.assets.has(asset.id))
    .map(asset => [asset.path, checked.assets.get(asset.id)]));
  const resolved = await resolveSkin(text, {resources: accepted, features: APP_SKIN_FEATURES});
  resolved.diagnostics = [...checked.diagnostics, ...resolved.diagnostics.filter(item => item.code === 'skin_feature_unsupported')];
  const retained = new Map();
  const background = original.assets.find(asset => asset.id === original.background.asset);
  // Home decoration is explicitly separate from the portable stage-background
  // capability. Keep the reader's unsupported-background diagnostic and default
  // stage result; validate the same bounded PNG for the decorative preview only.
  const bytes = background ? checked.assets.get(background.id) : null;
  if (bytes) retained.set(background.path, new Uint8Array(bytes));
  const homeDecoration = bytes ? {bytes, fit: original.background.fit, opacity: original.background.opacity} : null;
  return {manifest: text, resources: retained, resolved: {...resolved, homeDecoration}};
}

async function readBoundedFile(file, limit, path) {
  if (!file || !Number.isInteger(file.size) || file.size < 1 || file.size > limit || typeof file.arrayBuffer !== 'function') {
    throw new SkinValidationError('skin_file_size', path, `choose a file of 1..${limit} bytes`);
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.byteLength !== file.size || bytes.byteLength > limit) throw new SkinValidationError('skin_file_size', path, 'file size changed while reading');
  return bytes;
}

export async function importSkinFiles(manifestFile, backgroundFile = null) {
  const bytes = await readBoundedFile(manifestFile, SKIN_LIMITS.manifest_bytes, '$');
  const skin = parseSkinManifest(bytes), resources = new Map();
  if (backgroundFile) {
    const asset = skin.assets.find(entry => entry.id === skin.background.asset);
    if (!asset || backgroundFile.name !== asset.path.split('/').at(-1)) {
      throw new SkinValidationError('skin_background_file', '$.background', 'choose the PNG named by the background asset');
    }
    resources.set(asset.path, await readBoundedFile(backgroundFile, SKIN_LIMITS.asset_bytes, asset.path));
  }
  return prepareSkinPackage(bytes, resources);
}

export function skinStorageError(code = 'skin_storage_unavailable') {
  const error = new Error(code); error.code = code; return error;
}

// One atomic origin-local record. It never reads or writes scores, theme choices,
// filesystem paths, or network locations. Revalidate all stored bytes on load.
export async function restoreSkinRecord(record) {
  if (record === undefined || record === null) return {selected: 'default', installed: null};
  if (!record || record.version !== 1 || !['default', 'imported'].includes(record.selected) ||
      Object.keys(record).some(key => !['version', 'selected', 'manifest', 'resources'].includes(key)) ||
      !Array.isArray(record.resources) || record.resources.length > SKIN_LIMITS.assets) throw skinStorageError('skin_storage_invalid');
  if (record.manifest === null && record.selected === 'default' && record.resources.length === 0) return {selected: 'default', installed: null};
  const resources = new Map();
  for (const entry of record.resources) {
    if (!Array.isArray(entry) || entry.length !== 2 || resources.has(entry[0])) throw skinStorageError('skin_storage_invalid');
    resources.set(entry[0], entry[1]);
  }
  return {selected: record.selected, installed: await prepareSkinPackage(record.manifest, resources)};
}

export function skinRecord(selected, installed) {
  if (!['default', 'imported'].includes(selected) || selected === 'imported' && !installed) throw skinStorageError('skin_storage_invalid');
  return {version: 1, selected, manifest: installed?.manifest ?? null,
    resources: [...(installed?.resources ?? new Map())].map(([path, bytes]) => [path, new Uint8Array(bytes)])};
}

export function openSkinStorage(options = {}) {
  return new Promise((resolve, reject) => {
    let factory;
    try { factory = Object.hasOwn(options, 'factory') ? options.factory : globalThis.indexedDB; }
    catch { reject(skinStorageError());return; }
    if (!factory) { reject(skinStorageError()); return; }
    let request, settled = false;
    try { request = factory.open(options.name ?? SKIN_DATABASE, 1); } catch { reject(skinStorageError()); return; }
    request.onupgradeneeded = () => {
      if (settled) { request.transaction.abort(); return; }
      if (!request.result.objectStoreNames.contains('settings')) request.result.createObjectStore('settings');
    };
    request.onerror = () => { settled = true; reject(skinStorageError()); };
    request.onblocked = () => { settled = true; reject(skinStorageError('skin_storage_blocked')); };
    request.onsuccess = () => {
      const db = request.result;
      if (settled) { db.close(); return; }
      settled = true;
      db.onversionchange = () => db.close();
      const operation = (mode, value) => new Promise((done, fail) => {
        let transaction, result;
        try {
          transaction = db.transaction('settings', mode);
          const store = transaction.objectStore('settings');
          const action = mode === 'readonly' ? store.get('choice') : store.put(value, 'choice');
          action.onsuccess = () => { result = action.result; };
          transaction.oncomplete = () => done(result);
          transaction.onabort = () => fail(skinStorageError(transaction.error?.name === 'QuotaExceededError' ? 'skin_storage_full' : 'skin_storage_unavailable'));
          transaction.onerror = () => {}; // Abort owns the terminal error.
        } catch { fail(skinStorageError()); }
      });
      resolve({read: () => operation('readonly'), write: record => operation('readwrite', record), close: () => db.close()});
    };
  });
}

// Read-only build evidence. A package version never establishes a source revision.
export const BUILD_DIAGNOSTICS_PATH = '/api/diagnostics/build';
export const BUILD_DIAGNOSTICS_MAX_BYTES = 32 * 1024;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value, limit) => typeof value === 'string' && value.length > 0 && value.length <= limit && !/[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/u.test(value) ? value : null;
const token = value => typeof value === 'string' && /^[a-z0-9_]{1,80}$/.test(value) ? value : null;
const integer = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
const digest = (value, pattern) => typeof value === 'string' && pattern.test(value) ? value : null;
const sourceDigest = value => digest(value, /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/);
const selected = (value, allowed, fallback = 'unknown') => allowed.includes(value) ? value : fallback;
export function buildDiagnosticsError(code) { return Object.assign(new Error(code), {code}); }

/** Allowlist only build/process fields; never serialize an arbitrary response. */
export function normalizeBuildDiagnostics(value) {
  if (!object(value) || value.schema_version !== 1) throw buildDiagnosticsError('unsupported');
  if (!object(value.compiled) || !object(value.native)) throw buildDiagnosticsError('invalid');
  const source = value.compiled, process = value.native;
  const sourceStatus = selected(source.source_status, ['clean', 'dirty', 'unavailable']);
  const hashScope = selected(process.executable_hash_scope, ['current_executable_path_file']);
  const hashCache = selected(process.executable_cache, ['once_per_process']);
  const hashStatus = selected(process.executable_hash_status, ['ok', 'unavailable', 'too_large', 'changed']);
  const sha256 = digest(process.executable_sha256, /^[a-f0-9]{64}$/);
  const path = text(process.executable_path, 4096), size = integer(process.executable_bytes);
  const checkedAt = integer(process.executable_checked_at_unix_ms);
  const verifiedHash = hashStatus === 'ok' && hashScope !== 'unknown' && hashCache !== 'unknown' && sha256 && path && size !== null && checkedAt !== null && checkedAt <= 8640000000000000;
  return {
    schema_version: 1,
    compiled: {
      package_version: typeof source.package_version === 'string' && /^[0-9A-Za-z+_.-]{1,64}$/.test(source.package_version) ? source.package_version : null,
      source_sha: ['clean', 'dirty'].includes(sourceStatus) ? sourceDigest(source.source_sha) : null,
      source_tree: ['clean', 'dirty'].includes(sourceStatus) ? sourceDigest(source.source_tree) : null,
      source_commit_count: ['clean', 'dirty'].includes(sourceStatus) ? integer(source.source_commit_count) : null,
      source_status: sourceStatus,
      source_error: token(source.source_error),
      target: typeof source.target === 'string' && /^[a-zA-Z0-9_.-]{1,96}$/.test(source.target) ? source.target : null,
    },
    native: {
      transport: selected(process.transport, ['native-protocol-no-listener', 'loopback-only']),
      process_id: integer(process.process_id) > 0 ? process.process_id : null,
      os: token(process.os), arch: token(process.arch),
      executable_path: path,
      executable_sha256: verifiedHash ? sha256 : null,
      executable_bytes: size,
      executable_hash_status: hashStatus === 'ok' && !verifiedHash ? 'unknown' : hashStatus,
      executable_error: token(process.executable_error),
      executable_checked_at_unix_ms: checkedAt !== null && checkedAt <= 8640000000000000 ? checkedAt : null,
      executable_hash_scope: hashScope,
      executable_cache: hashCache,
    },
    // The endpoint attests the Rust build, not the script currently in the browser.
    browser_assets: {source_sha: null, source_tree: null, source_commit_count: null, source_status: 'unknown'},
  };
}

function aborted(signal) {
  if (signal?.aborted) throw Object.assign(new Error('Aborted'), {name: 'AbortError'});
}
async function abortable(promise, signal) {
  aborted(signal);
  if (!signal) return promise;
  let stop;
  const abort = new Promise((_, reject) => { stop = () => reject(Object.assign(new Error('Aborted'), {name: 'AbortError'}));signal.addEventListener('abort', stop, {once: true}); });
  try { return await Promise.race([promise, abort]); }
  finally { signal.removeEventListener('abort', stop); }
}
async function readBoundedJson(response, signal) {
  const declared = response.headers?.get('content-length');
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > BUILD_DIAGNOSTICS_MAX_BYTES)) throw buildDiagnosticsError('invalid');
  const reader = response.body?.getReader?.();
  if (!reader) throw buildDiagnosticsError('invalid');
  let bytes = 0, complete = false;
  const chunks = [];
  try {
    while (true) {
      const next = await abortable(reader.read(), signal);
      if (next.done) { complete = true;break; }
      if (!(next.value instanceof Uint8Array)) throw buildDiagnosticsError('invalid');
      bytes += next.value.byteLength;
      if (bytes > BUILD_DIAGNOSTICS_MAX_BYTES) throw buildDiagnosticsError('invalid');
      chunks.push(next.value);
    }
    const joined = new Uint8Array(bytes);let offset = 0;
    for (const chunk of chunks) { joined.set(chunk, offset);offset += chunk.byteLength; }
    try { return JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(joined)); }
    catch { throw buildDiagnosticsError('invalid'); }
  } finally {
    if (!complete) { try { void Promise.resolve(reader.cancel()).catch(() => {}); } catch { /* Best-effort cancellation only. */ } }
    try { reader.releaseLock(); } catch { /* An aborted read may still be settling. */ }
  }
}

/** One explicit same-origin GET, with no health fallback or library requests. */
export async function readBuildDiagnostics({fetcher = globalThis.fetch, origin = globalThis.location?.origin, signal} = {}) {
  let expected;
  try { expected = new URL(origin); } catch { throw buildDiagnosticsError('unavailable'); }
  if (!['http:', 'https:'].includes(expected.protocol) || typeof fetcher !== 'function') throw buildDiagnosticsError('unavailable');
  aborted(signal);
  let response;
  try { response = await abortable(fetcher(BUILD_DIAGNOSTICS_PATH, {method: 'GET', headers: {Accept: 'application/json'}, credentials: 'same-origin', mode: 'same-origin', redirect: 'error', cache: 'no-store', signal}), signal); }
  catch (error) { if (error?.name === 'AbortError') throw error;throw buildDiagnosticsError('unavailable'); }
  let sameOrigin = true;
  try { if (response?.url) sameOrigin = new URL(response.url, expected).origin === expected.origin; } catch { sameOrigin = false; }
  if (!response || response.redirected || !sameOrigin) throw buildDiagnosticsError('invalid');
  if (response.status === 404 || response.status === 501) throw buildDiagnosticsError('unsupported');
  if (!response.ok) throw buildDiagnosticsError('unavailable');
  return normalizeBuildDiagnostics(await readBoundedJson(response, signal));
}

/** Stable plain text, path excluded unless explicitly requested for this copy. */
export function buildDiagnosticsText(model, {status = 'idle', includePath = false} = {}) {
  let safe = null;
  try { if (model) safe = normalizeBuildDiagnostics(model); } catch { /* Unverified input is unknown. */ }
  const source = safe?.compiled ?? {}, process = safe?.native ?? {};
  const value = data => data === null || data === undefined ? 'unknown' : String(data);
  const lines = [
    'WorldMusicClub build diagnostics v1',
    `diagnostics.status: ${selected(status, ['idle', 'loading', 'ready', 'unsupported', 'unavailable', 'invalid', 'timeout', 'cancelled'])}`,
    'compiled.component: Rust backend (not browser assets)',
    ...['package_version', 'source_sha', 'source_tree', 'source_commit_count', 'source_status', 'source_error', 'target'].map(key => `compiled.${key}: ${value(source[key])}`),
    ...['transport', 'process_id', 'os', 'arch', 'executable_hash_status', 'executable_sha256', 'executable_bytes', 'executable_checked_at_unix_ms', 'executable_hash_scope', 'executable_cache', 'executable_error'].map(key => `native.${key}: ${value(process[key])}`),
    'native.hash_note: Cached file at executable path; not the loaded memory image',
    'browser_assets.source_sha: unknown',
    'browser_assets.source_tree: unknown',
    'browser_assets.source_commit_count: unknown',
    'browser_assets.source_status: unknown',
  ];
  if (includePath === true) lines.push(`native.executable_path: ${value(process.executable_path)}`);
  return lines.join('\n');
}

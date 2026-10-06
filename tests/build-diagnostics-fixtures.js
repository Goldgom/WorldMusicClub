// Original synthetic metadata, unrelated to an accepted artifact or user path.
export function diagnosticsFixture(overrides = {}) {
  return {
    schema_version: 1,
    compiled: {package_version: '0.2.0-alpha.1', source_sha: 'a'.repeat(40), source_tree: 'b'.repeat(40), source_commit_count: 27, source_status: 'clean', source_error: null, target: 'x86_64-pc-windows-msvc'},
    native: {transport: 'native-protocol-no-listener', process_id: 823, os: 'windows', arch: 'x86_64', executable_path: 'C:\\Users\\Original Fixture\\Music Club\\WorldMusicClub.exe', executable_sha256: 'c'.repeat(64), executable_bytes: 424242, executable_hash_status: 'ok', executable_error: null, executable_checked_at_unix_ms: 1780000000000, executable_hash_scope: 'current_executable_path_file', executable_cache: 'once_per_process'},
    ...overrides,
  };
}
export const diagnosticResponse = (value = diagnosticsFixture(), options = {}) => new Response(JSON.stringify(value), {status: 200, headers: {'Content-Type': 'application/json'}, ...options});
export function deferred() { let resolve, reject;const promise = new Promise((a, b) => { resolve = a;reject = b; });return {promise, resolve, reject}; }

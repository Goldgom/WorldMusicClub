import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Script, runInNewContext} from 'node:vm';
import {CANONICAL_PRACTICE_SOURCE_FILES} from '../scripts/canonical-practice-source-evidence.mjs';
import {LIVE_TONE_NAVIGATION_SOURCE_FILES, LIVE_TONE_NAVIGATION_SOURCE_LIMIT} from '../scripts/verify-native-live-tone-navigation-evidence.mjs';
import {CATALOG_SOURCE_FILES} from '../scripts/verify-library-catalog-acceptance.mjs';
import {BUILD_DIAGNOSTICS_SOURCE_FILES} from '../scripts/verify-native-build-diagnostics.mjs';
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const observerFactory = () => runInNewContext(`${read('crates/desktop-shell/build-diagnostics-acceptance.js').split('\n(() => {')[0]}\ncreateNativeBuildDiagnosticsObservers`, {Promise, Uint8Array, TextDecoder, setTimeout, clearTimeout});
const deferred = () => {let resolve, reject;const promise = new Promise((yes, no) => {resolve = yes;reject = no;});return {promise, resolve, reject};};
function observerOptions(fetchOwner, clipboard, options = {}) {
  const requests = [], writes = [], errors = [];
  const observer = observerFactory()({fetchOwner, clipboard, readSequence: () => 2, onRequest: row => requests.push(row), onOtherRequest() {}, onWrite: row => writes.push(row), onError: message => errors.push(message), ...options});
  return {observer, requests, writes, errors};
}
test('native fetch observer returns the exact promise and response before a held clone finishes', async () => {
  const operation = deferred(), clone = deferred(), cloneStarted = deferred();let reads = 0, cancelled = 0, released = 0, argumentsSeen;
  const response = {status: 200, clone() {cloneStarted.resolve();return {body: {getReader: () => ({read: () => ++reads === 1 ? clone.promise : Promise.resolve({done: true}), cancel() {cancelled++;}, releaseLock() {released++;}})}};}};
  const options = {method: 'GET'}, owner = {fetch(...args) {argumentsSeen = {self: this, args};return operation.promise;}}, original = owner.fetch;
  const observed = observerOptions(owner);
  try {
    const returned = owner.fetch('/api/diagnostics/build', options);assert.equal(returned, operation.promise);assert.equal(argumentsSeen.self, owner);assert.equal(argumentsSeen.args[1], options);
    operation.resolve(response);assert.equal(await returned, response);await cloneStarted.promise;
    assert.equal(observed.requests.length, 0, 'Production response must not wait for evidence parsing');
    let settled = false;const settling = observed.observer.settle().then(() => {settled = true;});await new Promise(resolve => setImmediate(resolve));assert.equal(settled, false);
    clone.resolve({done: false, value: new TextEncoder().encode('{"original":true}')});await settling;
    assert.equal(observed.requests.length, 1);assert.equal(observed.requests[0].data.original, true);assert.deepEqual(observed.errors, []);assert.equal(cancelled, 0);assert.equal(released, 1);
  } finally {assert.equal(observed.observer.restore(), true);assert.equal(owner.fetch, original);}
});
test('native clone observation does not consume or replace the response body delivered to production', async () => {
  const response = new Response('{"original":"body"}'), operation = Promise.resolve(response), owner = {fetch: () => operation};
  const observed = observerOptions(owner);
  try {
    const returned = owner.fetch('/api/diagnostics/build');assert.equal(returned, operation);
    assert.equal(await (await returned).text(), '{"original":"body"}');await observed.observer.settle();assert.equal(observed.requests[0].data.original, 'body');
  } finally {observed.observer.restore();}
});
test('clipboard observer preserves the exact platform promise, result, receiver, arguments and synchronous throw', async () => {
  const operation = deferred(), thrown = new Error('Original synchronous clipboard failure');let shouldThrow = false, called;
  const clipboard = {writeText(...args) {called = {self: this, args};if (shouldThrow) throw thrown;return operation.promise;}}, original = clipboard.writeText;
  const owner = {fetch: () => Promise.resolve()}, observed = observerOptions(owner, clipboard);
  try {
    const returned = clipboard.writeText('Original summary');assert.equal(returned, operation.promise);assert.equal(called.self, clipboard);assert.deepEqual(called.args, ['Original summary']);
    let settled = false;const settling = observed.observer.settle().then(() => {settled = true;});await new Promise(resolve => setImmediate(resolve));assert.equal(settled, false);
    operation.resolve('original platform result');assert.equal(await returned, 'original platform result');await settling;assert.equal(observed.writes[0].outcome, 'fulfilled');
    shouldThrow = true;assert.throws(() => clipboard.writeText('Original failing summary'), error => error === thrown);assert.equal(observed.writes[1].outcome, 'rejected');await observed.observer.settle();assert.deepEqual(observed.errors, []);
  } finally {assert.equal(observed.observer.restore(), true);assert.equal(clipboard.writeText, original);}
});
test('observer failures or unsettled clones cannot pass evidence, cancel only their clone, and leave production promises intact', async () => {
  const production = deferred(), clone = deferred(), entered = deferred();let cancelled = 0;
  const response = {status: 200, clone: () => ({body: {getReader: () => ({read() {entered.resolve();return clone.promise;}, cancel() {cancelled++;clone.resolve({done: true});return new Promise(() => {});}, releaseLock() {}})}})};
  const owner = {fetch: () => production.promise}, observed = observerOptions(owner, undefined, {timeoutMs: 10});
  try {
    const returned = owner.fetch('/api/diagnostics/build');production.resolve(response);assert.equal(await returned, response);await entered.promise;
    await assert.rejects(observed.observer.settle(), /did not settle/);assert.ok(cancelled > 0);assert.ok(observed.errors.some(message => /did not settle/.test(message)));assert.equal(returned, production.promise);
  } finally {observed.observer.restore();}
  const unreadable = new Response('not JSON'), operation = Promise.resolve(unreadable), brokenOwner = {fetch: () => operation}, broken = observerOptions(brokenOwner);
  try {
    const returned = brokenOwner.fetch('/api/diagnostics/build');assert.equal(returned, operation);assert.equal(await (await returned).text(), 'not JSON');
    await assert.rejects(broken.observer.settle(), /observation failed/);assert.equal(broken.requests.length, 0);assert.ok(broken.errors.length > 0);
    const originalThrow = new Error('Original fetch throw'), throwing = {fetch() {throw originalThrow;}}, throws = observerOptions(throwing);
    try {assert.throws(() => throwing.fetch('/api/diagnostics/build'), error => error === originalThrow);} finally {throws.observer.restore();}
  } finally {broken.observer.restore();}
});
test('native diagnostic renderer composes only its bounded runner and existing owned click helpers', () => {
  const rust = read('crates/desktop-shell/src/acceptance.rs'), host = read('scripts/windows-desktop-acceptance.ps1');
  assert.match(rust, /pub const BUILD_DIAGNOSTICS_PHASES: \[&str; 1\] = \["build-diagnostics"\]/);
  assert.match(rust, /\.chain\(BUILD_DIAGNOSTICS_PHASES\)/);assert.match(rust, /BUILD_DIAGNOSTICS_PHASES.contains\(&phase\) && value\["kind"\] != "click"/);
  assert.match(rust, /else if BUILD_DIAGNOSTICS_PHASES.contains\(&phase\) \{\s*32/);
  const script = [read('crates/desktop-shell/acceptance-wait.js'), read('crates/desktop-shell/reference-acceptance.js'), read('crates/desktop-shell/canonical-practice-acceptance.js').split('(() => {')[0], read('crates/desktop-shell/build-diagnostics-acceptance.js')].join('\n');assert.doesNotThrow(() => new Script(script));
  assert.ok(script.indexOf('report.evidenceSettled = await observers.settle();') < script.indexOf('report.ok = true;'), 'Evidence must settle before the actual runner marks success');
  assert.match(host, /\$native.diagnostic_host.process_image_path=\$app.MainModule.FileName/);
  for (const part of ['capture_started_unix_ms', 'capture_finished_unix_ms', 'Get-BuildDiagnosticsExecutable', 'Get-BuildDiagnosticsLibrarySnapshot']) assert.ok(host.includes(part));
  assert.match(host, /\$actionLimit=if\(\$phase -ceq 'build-diagnostics'\)\{32\}/);
  assert.match(read('scripts/windows-desktop-profile.ps1'), /\$fresh=@\('build-diagnostics'/);
  assert.match(read('.gitignore'), /^\/desktop-build-diagnostics\/$/m);
});
test('diagnostic source extension preserves all runtime dependencies within explicit finite capacities', () => {
  const runtime = ['crates/practice-server/build_source.rs', 'crates/practice-server/src/build_identity.rs', 'web/build-diagnostics.js', 'web/build-diagnostics-view.js', 'web/build-diagnostics.css'];
  assert.equal(CANONICAL_PRACTICE_SOURCE_FILES.length, 121);assert.equal(LIVE_TONE_NAVIGATION_SOURCE_FILES.length, 132);assert.equal(LIVE_TONE_NAVIGATION_SOURCE_LIMIT, 160);assert.equal(CATALOG_SOURCE_FILES.length, 55);
  for (const path of runtime) for (const inventory of [CANONICAL_PRACTICE_SOURCE_FILES, LIVE_TONE_NAVIGATION_SOURCE_FILES, BUILD_DIAGNOSTICS_SOURCE_FILES]) assert.equal(inventory.filter(name => name === path).length, 1, `Missing ${path}`);
  for (const path of runtime.filter(path => path.startsWith('web/'))) assert.ok(CATALOG_SOURCE_FILES.includes(path));
  for (const path of ['crates/desktop-shell/build-diagnostics-acceptance.js', 'scripts/windows-build-diagnostics.ps1', 'scripts/verify-native-build-diagnostics.mjs', 'scripts/build-diagnostics-evidence.mjs']) assert.ok(BUILD_DIAGNOSTICS_SOURCE_FILES.includes(path));
  assert.ok(BUILD_DIAGNOSTICS_SOURCE_FILES.length <= 160);assert.equal(new Set(BUILD_DIAGNOSTICS_SOURCE_FILES).size, BUILD_DIAGNOSTICS_SOURCE_FILES.length);
});
test('actual native diagnostics and exact-driver compatibility are required before package promotion', () => {
  const workflow = read('.github/workflows/windows-desktop-acceptance.yml');
  assert.ok(workflow.indexOf('id: dense_native_driver') < workflow.indexOf('id: native_clean_profile_routing'));
  assert.match(workflow, /WMH_NATIVE_IMPORT_DRIVER: \$\{\{ github.workspace \}\}\/target\/debug\/examples\/native_import_driver\n        run: node --test tests\/native-clean-profile-routing.test.js/);
  for (const output of ['native_clean_profile_routing', 'build_diagnostics_windows', 'build_diagnostics_windows_verify']) {
    assert.ok(workflow.includes(`${output}: \${{ steps.${output}.outcome }}`));assert.ok(workflow.includes(`'${output}'`));
  }
  const begin = workflow.indexOf('id: build_diagnostics_windows\n'), verify = workflow.indexOf('id: build_diagnostics_windows_verify\n'), packaging = workflow.indexOf('id: native_package\n');
  assert.ok(workflow.indexOf('id: native_build\n') < begin && begin < verify && verify < packaging);
  assert.match(workflow.slice(begin, verify), /steps.native_build.outcome == 'success'/);assert.match(workflow.slice(verify, packaging), /steps.build_diagnostics_windows.outcome == 'success'/);
  assert.match(workflow, /diagnosticProof.source_commit_count -ne \[long\]\(git rev-list --count HEAD\)/);
  for (const pattern of ['desktop-build-diagnostics/*.json', 'desktop-build-diagnostics/*.png']) assert.ok(workflow.includes(pattern));
  assert.doesNotMatch(workflow, /desktop-build-diagnostics\/\*\*|desktop-build-diagnostics\/webview/);
});

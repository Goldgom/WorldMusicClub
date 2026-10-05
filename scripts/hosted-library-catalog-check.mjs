// Opt-in ORIGINAL hosted acceptance. Actual persistent Chromium profile + native stdio.
// No local browser/server fallback; never dispatches CI or builds a native driver.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {lstat, mkdir, readFile, writeFile} from 'node:fs/promises';
import {dirname, extname, join, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {startVsqNativeDriver} from '../tests/vsq-native-driver-fixtures.js';
import {createAuthoringHostedChooser} from './song-authoring-hosted-chooser.mjs';
import {CATALOG_ACCEPTANCE_PHASES, CATALOG_ACCEPTANCE_FILENAMES, prepareLibraryCatalogFixtures, catalogSha256 as sha256} from './prepare-library-catalog-acceptance.mjs';
import {catalogSourceBinding, catalogLibraryInventory, verifyLibraryCatalogAcceptance, validateCatalogScreenshot} from './verify-library-catalog-acceptance.mjs';

assert.equal(process.env.GITHUB_ACTIONS, 'true', 'Catalog browser acceptance requires authorized hosted Actions');
assert.equal(process.env.WMH_HOSTED_BROWSER, '1', 'Catalog browser execution needs explicit hosted authorization');
const root = fileURLToPath(new URL('../', import.meta.url)), git = (...args) => execFileSync('git', args, {cwd: root, encoding: 'utf8'}).trim(), head = git('rev-parse', 'HEAD');
assert.equal(process.env.WMH_SOURCE_SHA, head, 'Catalog acceptance must use the frozen exact source');
assert.equal(git('status', '--porcelain', '--untracked-files=normal'), '', 'Catalog hosted source must be clean');
assert.ok(process.env.WMH_NATIVE_IMPORT_DRIVER, 'An already-built exact-source native driver is required');
const output = resolve(process.env.WMH_ARTIFACT_DIR || join(root, 'test-results/library-catalog')), binary = resolve(process.env.WMH_NATIVE_IMPORT_DRIVER), origin = 'https://wmh.localhost';
await mkdir(dirname(output), {recursive: true}); await mkdir(output, {recursive: false});
for (const folder of ['downloads', 'api']) await mkdir(join(output, folder));
const fixture = await prepareLibraryCatalogFixtures(join(output, 'fixtures')), binding = await catalogSourceBinding(root), runId = randomUUID(), profileDirectory = join(output, 'webview-catalog-profile'), library = join(output, 'Scores');
const config = {version: 1, viewport_contract: {kind: 'hosted-fixed', requested: {width: 1280, height: 720}}, run_id: runId, source_binding: binding, fixture}, configBytes = Buffer.from(JSON.stringify(config, null, 2) + '\n'); await writeFile(join(output, 'catalog-config.json'), configBytes, {flag: 'wx'});
const driverBytes = await readFile(binary), report = {version: 1, kind: 'original-library-catalog-hosted-real-native-stdio', scenario: 'library-catalog', ...binding, driver_sha256: sha256(driverBytes), driver_bytes: driverBytes.length, run_id: runId, config_sha256: sha256(configBytes), profile_reused: true, directory: library, phases: [], screenshots: [], viewport: {width: 1280, height: 720}, ok: false, claims: {browser: true, native_filesystem: true, native_window: false, physical_audio: false, user_library: false, private_music: false}};
let context, driver, page, chooser;
async function bounded(promise, label, milliseconds = 15000) { let timer; try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(Error(`${label} exceeded ${milliseconds}ms`)), milliseconds); })]); } finally { clearTimeout(timer); } }
const save = (filename, value) => writeFile(join(output, filename), JSON.stringify(value, null, 2) + '\n', {flag: 'wx'});
async function snapshot(phase) { await save(`snapshot-${phase}.json`, {version: 1, files: await catalogLibraryInventory(library)}); }
async function screenshot(phase, action) {
  const file = action === undefined ? `browser-${phase}.png` : `browser-action-${phase}-${action}.png`; await page.screenshot({path: join(output, file), fullPage: false}); const bytes = await readFile(join(output, file));
  const value = {file, phase, ...(action === undefined ? {} : {action}), bytes: bytes.length, sha256: sha256(bytes), locale: 'zh-CN'}; validateCatalogScreenshot(bytes, value); report.screenshots.push(value);
}
try {
  const {chromium} = await import('playwright');
  for (const [index, phase] of CATALOG_ACCEPTANCE_PHASES.entries()) {
    if (index === 0) await assert.rejects(lstat(profileDirectory), {code: 'ENOENT'}); else assert.ok((await lstat(profileDirectory)).isDirectory() && !(await lstat(profileDirectory)).isSymbolicLink());
    driver = startVsqNativeDriver({binary, directory: library, cwd: root, requestTimeoutMs: 15000, closeTimeoutMs: 3000});
    const host = {phase, process_id: driver.pid, launched_new_process: true, renderer_ok: false, normal_close: false, renderer_origin: origin, executable_tcp_listeners: 0, listener_evidence: 'native-driver-stdio-contract', profile_directory: profileDirectory, profile_fresh: index === 0, profile_reused: index !== 0, profile_absent_before_launch: index === 0, actions: 0, api_trace: [], page_errors: [], console_errors: [], chooser: null}; report.phases.push(host);
    context = await chromium.launchPersistentContext(profileDirectory, {headless: true, viewport: report.viewport, locale: 'zh-CN', acceptDownloads: true, serviceWorkers: 'block', timeout: 20000});
    await save(`profile-${phase}.json`, {version: 1, phase, process_id: driver.pid, profile_directory: profileDirectory, library_directory: library, fresh_required: index === 0, created_new: index === 0});
    const scripts = await Promise.all(['acceptance-wait.js', 'reference-acceptance.js', 'library-catalog-acceptance.js'].map(name => readFile(join(root, 'crates/desktop-shell', name), 'utf8')));
    await context.addInitScript(`globalThis.__WMH_ACCEPTANCE_PHASE__=${JSON.stringify(phase)};\n${scripts.join('\n')}`);
    const downloads = [], actionResults = new Map(); let renderer = null, actionPending = false, actionFailure = null, snapshotBefore = false;
    async function perform(action) {
      const result = {ok: false, browser_action: true, process_id: driver.pid};
      try {
        assert.equal(actionPending, false, 'Only one trusted catalog action may be active'); actionPending = true;
        assert.equal(action.version, 1); assert.equal(action.sequence, host.actions + 1); assert.ok(action.sequence <= 64); assert.ok(['click', 'picker', 'key-r', 'select-last', 'catalog-snapshot-before'].includes(action.kind));
        assert.equal(action.width, 1280); assert.equal(action.height, 720); assert.ok(Number.isFinite(action.x) && Number.isFinite(action.y) && action.x >= 0 && action.x < 1280 && action.y >= 0 && action.y < 720);
        host.actions++; await save(`action-${phase}-${action.sequence}.json`, action);
        if (action.kind === 'catalog-snapshot-before') { assert.equal(phase, 'catalog-seed'); assert.equal(snapshotBefore, false); await snapshot('catalog-before'); snapshotBefore = true; }
        else if (action.kind === 'picker') await chooser.choose(action, join(output, 'fixtures'));
        else { await page.mouse.click(action.x, action.y); if (action.kind === 'key-r') await page.keyboard.press('r'); if (action.kind === 'select-last') { await page.keyboard.press('End'); await page.keyboard.press('Enter'); } }
        await screenshot(phase, action.sequence); result.ok = true;
      } catch (error) { result.error = String(error.stack || error); actionFailure = result.error; }
      finally { await save(`result-${phase}-${action.sequence}.json`, result); actionResults.set(action.sequence, result); actionPending = false; }
    }
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url()), pathname = url.pathname;
      if (url.origin !== origin) { host.page_errors.push(`Unexpected external URL: ${url.origin}`); await route.abort(); return; }
      try {
        if (pathname.startsWith('/__desktop_smoke/')) {
          if (pathname === '/__desktop_smoke/catalog-config') { await route.fulfill({status: 200, json: config}); return; }
          if (pathname === '/__desktop_smoke/state') { await route.fulfill({status: 200, json: {phase, downloads}}); return; }
          if (pathname === '/__desktop_smoke/action') { const action = request.postDataJSON(); assert.ok(action?.version === 1 && Number.isInteger(action.sequence) && action.sequence >= 1 && action.sequence <= 64 && ['click', 'picker', 'key-r', 'select-last', 'catalog-snapshot-before'].includes(action.kind)); await route.fulfill({status: 200, json: {}}); void perform(action); return; }
          if (pathname === '/__desktop_smoke/report') { assert.equal(renderer, null, 'Repeated/stale renderer report'); assert.ok(request.postDataBuffer().length <= 1024 * 1024); const value = request.postDataJSON(); assert.equal(value.phase, phase); assert.equal(value.run_id, runId); renderer = value; await save(`renderer-${phase}.json`, renderer); await route.fulfill({status: 200, json: {}}); return; }
          if (pathname === '/__desktop_smoke/progress') { await route.fulfill({status: 200, json: {}}); return; }
          const sequence = Number(pathname.slice('/__desktop_smoke/result/'.length)), result = actionResults.get(sequence); await route.fulfill(result ? {status: 200, json: result} : {status: 404, json: {error: 'pending'}}); return;
        }
        if (pathname.startsWith('/api/')) {
          assert.ok(host.api_trace.length < 256, 'Bounded native dispatch trace'); const body = request.postDataBuffer() || Buffer.alloc(0), row = {sequence: host.api_trace.length + 1, path: pathname, method: request.method(), request_bytes: body.length, request_sha256: sha256(body)}; host.api_trace.push(row);
          const response = await driver.fetcher(pathname + url.search, {method: request.method(), headers: request.headers(), body}), bytes = await response.bytes();
          Object.assign(row, {status: response.status, response_bytes: bytes.length, response_sha256: sha256(bytes), response_file: `api/${phase}-${row.sequence}${response.contentType.includes('json') ? '.json' : '.bin'}`}); await writeFile(join(output, row.response_file), bytes, {flag: 'wx'});
          await route.fulfill({status: response.status, contentType: response.contentType, body: bytes}); return;
        }
        const file = resolve(root, 'web', '.' + decodeURIComponent(pathname === '/' ? '/index.html' : pathname)); assert.ok(file.startsWith(join(root, 'web') + sep));
        try { await route.fulfill({status: 200, contentType: ({'.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2'})[extname(file)] || 'application/octet-stream', body: await readFile(file)}); }
        catch (error) { if (error.code !== 'ENOENT') throw error; await route.fulfill({status: 404, body: 'Not found'}); }
      } catch (error) { host.page_errors.push(String(error.stack || error)); await route.abort(); }
    });
    page = context.pages()[0] || await context.newPage(); page.setDefaultTimeout(15000); page.setDefaultNavigationTimeout(15000);
    chooser = createAuthoringHostedChooser(page, {inputId: 'score-file', pickerFiles(filename, directory) { assert.ok(Object.values(CATALOG_ACCEPTANCE_FILENAMES).includes(filename), 'Only three ORIGINAL fixture picker filenames are allowed'); return [join(directory, filename)]; }, onError: error => { host.page_errors.push(error); actionFailure = error; }}); host.chooser = chooser.evidence;
    page.on('pageerror', error => host.page_errors.push(String(error.stack || error))); page.on('console', message => { if (message.type() === 'error' && host.console_errors.length < 64) host.console_errors.push({text: message.text(), location: message.location()}); });
    page.on('download', async download => {
      assert.ok(downloads.length < 16); const name = download.suggestedFilename(), extension = name.endsWith('.zip') ? 'zip' : 'json'; const row = {file: `${phase}-${downloads.length + 1}.${extension}`, suggested_name: name, complete: false, success: false}; downloads.push(row);
      try { await download.saveAs(join(output, 'downloads', row.file)); row.success = true; } catch (error) { host.page_errors.push(String(error)); } finally { row.complete = true; }
    });
    chooser.navigation('start'); await page.goto(origin); chooser.navigation('end');
    await bounded((async () => { while (!renderer && !actionFailure && !host.page_errors.length) await new Promise(resolve => setTimeout(resolve, 100)); assert.equal(actionFailure, null); assert.deepEqual(host.page_errors, []); })(), `${phase} actual renderer`, 240000);
    assert.equal(renderer?.ok, true, renderer?.error); assert.equal(actionPending, false); chooser.assertComplete(renderer.actions.filter(row => row.kind === 'picker').map(row => row.sequence)); await screenshot(phase);
    await save(`host-api-${phase}.json`, {version: 1, phase, process_id: driver.pid, rows: host.api_trace});
    host.renderer_ok = true; await bounded(context.close(), `${phase} profile persistence`, 15000); context = null; chooser.stop(); chooser = null;
    await bounded(driver.close(), `${phase} native close`, 5000); driver = null; host.normal_close = true; await snapshot(phase);
  }
  assert.equal(sha256(await readFile(binary)), report.driver_sha256, 'Immutable driver changed during acceptance'); report.ok = true; await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  const proof = await verifyLibraryCatalogAcceptance(output, {sourceSha: head, sourceTree: binding.source_tree, driver: binary, sourceRoot: root}); await save('library-catalog-proof.json', proof);
} catch (error) { report.ok = false; report.error = String(error.stack || error); process.exitCode = 1; }
finally {
  chooser?.stop();
  for (const [name, resource] of [['context', context], ['driver', driver]]) if (resource) try { await bounded(resource.close(), `final ${name} cleanup`, 10000); } catch (error) { report.ok = false; process.exitCode = 1; (report.cleanup_errors ||= []).push(String(error)); }
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
}
if (!report.ok) throw Error(report.error || JSON.stringify(report.cleanup_errors));

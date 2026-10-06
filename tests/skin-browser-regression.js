import assert from 'node:assert/strict';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium} from 'playwright';
import {chromiumLaunchOptions} from './browser-launch-options.js';
import {originalBrowserSkin, originalSkinScore, sha256} from './skin-browser-fixture.js';
import {liveToneNavigationBootstrap} from './live-tone-navigation-browser-regression.js';
import {installCanonicalPreviewAudio} from './browser-canonical-preview-audio.js';
import {selectLegacyEnglish} from './browser-input-fixtures.js';
import {waitForPlaybackClock, waitForPlaybackClockAdvance} from './browser-playback-clock.js';
import {settlePianoViewportBudget} from './browser-piano-budget.js';
import {validateSkinInteractionReport, validateSkinPersistenceReport, SKIN_BROWSER_CASES} from './skin-browser-proof.js';

const idle = page => page.waitForFunction(() => document.querySelector('#skin-settings')?.getAttribute('aria-busy') === 'false');
async function openSettings(page) {
  if (!await page.locator('#settings-dialog').isVisible()) await page.locator('#settings-button').click();
  await idle(page);
}
async function importSkin(page, skin, json = skin.json) {
  await openSettings(page);
  await page.locator('#skin-manifest').setInputFiles({name: 'skin.json', mimeType: 'application/json', buffer: json});
  await page.locator('#skin-image').setInputFiles({name: 'checker.png', mimeType: 'image/png', buffer: skin.png});
  await page.locator('#skin-import').click();await idle(page);
}
async function selectSkin(page, selected) {
  await openSettings(page);await page.locator('#skin-choice').selectOption(selected);await page.locator('#skin-use').click();await idle(page);
}
async function screenshot(page, directory, filename) {
  await page.evaluate(async () => { await document.fonts.ready;await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
  const bytes = await page.screenshot({path: join(directory, filename), fullPage: true, animations: 'disabled'});
  return {name: filename, bytes: bytes.length, sha256: sha256(bytes), width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20)};
}
async function readStoredSkin(page) {
  const record = await page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('worldmusicclub.skins.v1', 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result, transaction = db.transaction('settings', 'readonly'), read = transaction.objectStore('settings').get('choice');
      read.onerror = () => { db.close();reject(read.error); };
      read.onsuccess = () => { const value = read.result;db.close();resolve(value ? {...value, resources: value.resources.map(([path, bytes]) => [path, Array.from(bytes)])} : null); };
    };
  }));
  return record && {version: record.version, selected: record.selected, manifest: record.manifest,
    manifestSha256: sha256(record.manifest), resources: record.resources.map(([path, bytes]) => ({path, bytes: bytes.length, sha256: sha256(Buffer.from(bytes))}))};
}
async function readSettings(page) {
  return page.evaluate(() => ({locale: document.documentElement.lang, active: document.documentElement.dataset.skin ?? null,
    selected: document.querySelector('#skin-settings').dataset.selected, choice: document.querySelector('#skin-choice').value,
    title: document.querySelector('#skin-settings-title').textContent, status: document.querySelector('#skin-status').textContent,
    scope: document.querySelector('#skin-scope').textContent, diagnostics: document.querySelector('#skin-diagnostics').textContent,
    importedDisabled: document.querySelector('#skin-choice [value=imported]').disabled,
    legend: [...document.querySelectorAll('[data-skin-legend]')].map(node => ({role: node.dataset.skinLegend, marker: node.dataset.marker, pattern: node.dataset.pattern})),
    theme: localStorage.getItem('worldmusichub.theme'), presentation: Object.fromEntries(['--skin-human-fill','--skin-machine-fill','--skin-key-white','--skin-background-image'].map(key => [key, document.documentElement.style.getPropertyValue(key)]))}));
}
async function stageGeometry(page, retain = false) {
  return page.evaluate(retain => {
    const nodes = [...document.querySelectorAll('#keyboard .piano-key')];
    if (retain) globalThis.__skinOriginalKeys = nodes;
    const rect = node => { const r = node.getBoundingClientRect();return {x: r.x, y: r.y, width: r.width, height: r.height}; };
    return {viewport: {width: innerWidth, height: innerHeight}, canvas: rect(document.querySelector('#falling-notes')),
      keyboard: rect(document.querySelector('#keyboard')), transport: rect(document.querySelector('.transport')),
      keys: nodes.map(node => ({midi: node.dataset.midi, rect: rect(node)})),
      sameKeyNodes: nodes.length === globalThis.__skinOriginalKeys?.length && nodes.every((node, i) => node === globalThis.__skinOriginalKeys[i])};
  }, retain);
}
async function readStagePaint(page) {
  return page.evaluate(() => {
    const canvas = document.querySelector('#falling-notes'), box = canvas.getBoundingClientRect(), scale = canvas.width / box.width,
      context = canvas.getContext('2d'), data = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const hex = offset => `#${[0,1,2].map(i => data[offset+i].toString(16).padStart(2,'0')).join('')}`;
    const counts = {'#fbbf24': 0, '#67e8f9': 0};
    for (let i = 0; i < data.length; i += 4) if (data[i+3] === 255 && Object.hasOwn(counts, hex(i))) counts[hex(i)]++;
    const keys = [60, 61, 62, 67].map(midi => { const key = document.querySelector(`#keyboard [data-midi="${midi}"]`), style = getComputedStyle(key), r = key.getBoundingClientRect();return {midi, background: style.backgroundColor, foreground: style.color, center: r.x+r.width/2}; });
    const markers = [60, 67].map(midi => {
      const key = keys.find(key => key.midi === midi), cx = (key.center - box.x) * scale, cy = (box.height - 5) * scale, pixels = [];
      for (let y = -3; y <= 3; y++) for (let x = -3; x <= 3; x++) { const offset = (Math.floor(cy+y*scale)*canvas.width+Math.floor(cx+x*scale))*4;pixels.push({x,y,color:hex(offset),alpha:data[offset+3]}); }
      return {midi, pixels, foregroundPixels: pixels.filter(pixel => pixel.alpha === 255 && pixel.color === '#111111').length};
    });
    return {skin: canvas.dataset.skin, humanIds: JSON.parse(canvas.dataset.humanNoteIds), machineIds: JSON.parse(canvas.dataset.machineNoteIds), labels: canvas.dataset.noteLabels,
      canvas: {width: canvas.width, height: canvas.height}, fillPixels: counts, keys: keys.map(({center,...key}) => key), markers,
      laneBackground: getComputedStyle(canvas).backgroundImage, homeImage: getComputedStyle(document.querySelector('.rhythm-hero-art'), '::before').backgroundImage,
      homeAriaHidden: document.querySelector('.rhythm-hero-art').getAttribute('aria-hidden')};
  });
}
async function homeDecoration(page) {
  return page.evaluate(async () => {
    const node = document.querySelector('.rhythm-hero-art'), css = getComputedStyle(node, '::before'), match = css.backgroundImage.match(/^url\("?(blob:[^")]+)"?\)$/);
    if (!match) return {image: false, ariaHidden: node.getAttribute('aria-hidden')};
    const image = new Image();image.src = match[1];await image.decode();
    return {image: true, width: image.naturalWidth, height: image.naturalHeight, opacity: css.opacity, pointerEvents: css.pointerEvents, ariaHidden: node.getAttribute('aria-hidden')};
  });
}

// Registration only. The authorized hosted runner owns the real Rust server
// and browser launches. Importing this file never starts either process.
export function registerSkinBrowserRegressions({test, getPage, getOrigin, ui, startPreview, configureStageMod, readyForTitle,
  closeShellPanels, exportTakeData, exportScore, pausedTakeSnapshot, getRequests, artifactDirectory}) {
  test(SKIN_BROWSER_CASES[0].name, {timeout: 120_000}, async () => {
    const page = getPage(), skin = originalBrowserSkin(), replacement = originalBrowserSkin({replacement: true}), score = originalSkinScore();
    const report = {version: 1, kind: 'interaction', ok: false, originalFixturesOnly: true, physicalAudio: false,
      audioScope: 'finite-checkpoint-windows', route: 'settings', release: 'keyup', screenshots: [], fixture: {id: skin.manifest.id, manifestSha256: skin.jsonSha256, pngSha256: skin.pngSha256}};
    let observer = false, storageFault = false;
    const checkpoint = label => page.evaluate(label => __wmhLiveNavigation.checkpoint(label), label);
    const quiet = async (label, seal = true) => { await page.waitForFunction(label => { __wmhLiveNavigation.assertHealthy();__wmhPreviewAudio.assertHealthy();return __wmhLiveNavigation.quiet(label); }, label);if (seal) await page.evaluate(label => __wmhLiveNavigation.sealCheckpoint(label), label); };
    try {
      await page.addInitScript(liveToneNavigationBootstrap);await page.reload({waitUntil: 'domcontentloaded'});await waitForPlaybackClock(page);
      await installCanonicalPreviewAudio(page);
      await page.evaluate(async () => { globalThis.__wmhLiveNavigation = await __wmhObserveLiveNavigation(document, {keyCode: 'KeyR', midi: 60, readSource: () => __wmhPreviewAudio.status()}); });observer = true;
      await selectLegacyEnglish(page);await startPreview({mode: 'practice', performers: 'all', notation: false});
      await ui('#score-file').setInputFiles({name: 'original-skin-roles.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(score))});await readyForTitle(score.title);
      await configureStageMod({performers: ['human'], layout: 'complete', showOtherParts: true});
      await page.waitForFunction(() => !document.querySelector('#play-button').disabled && JSON.parse(document.querySelector('#falling-notes').dataset.machineNoteIds || '[]').length > 0);
      if (await page.locator('#notation-toggle').getAttribute('aria-expanded') === 'true') await page.locator('#notation-toggle').click();
      if (!await ui('.practice-options').evaluate(node => node.open)) await ui('.practice-options>summary').click();
      await ui('#metronome-enabled').uncheck();await ui('#count-in').uncheck();await ui('#falling-note-labels').check();
      await ui('#theme-mode').selectOption('custom');await closeShellPanels();await page.setViewportSize({width: 1280, height: 720});
      if (await page.locator('#notice-dismiss').isVisible()) await page.locator('#notice-dismiss').click();
      await page.waitForFunction(() => document.querySelector('#falling-notes').clientHeight > 100);
      report.scoreBefore = await exportScore();await closeShellPanels();await page.evaluate(() => document.fonts.ready);await page.evaluate(settlePianoViewportBudget);
      report.geometryBefore = await stageGeometry(page, true);report.themeBefore = await page.evaluate(() => localStorage.getItem('worldmusichub.theme'));
      report.screenshots.push(await screenshot(page, artifactDirectory, 'worldmusichub-skin-stage-builtin.png'));
      await importSkin(page, skin);assert.equal((await readSettings(page)).active, skin.manifest.id);await closeShellPanels();
      await page.locator('#play-button').click();await waitForPlaybackClockAdvance(page);await page.locator('#stage-title').click();
      assert.equal(await page.locator('#sound-button').getAttribute('aria-pressed'), 'false');
      await page.evaluate(() => __wmhLiveNavigation.begin());await page.keyboard.down('r');await page.waitForTimeout(40);
      await page.waitForFunction(() => { __wmhLiveNavigation.assertHealthy();return __wmhLiveNavigation.sounding(); });
      report.pressed = await page.locator('#keyboard [data-midi="60"]').evaluate(node => ({pressed: node.getAttribute('aria-pressed'), background: getComputedStyle(node).backgroundColor}));
      await page.keyboard.up('r');await page.waitForFunction(() => __wmhLiveNavigation.settled());
      await checkpoint('navigation');await quiet('navigation');await page.locator('#settings-button').click();
      await page.waitForFunction(() => __wmhPreviewAudio.quiet());await checkpoint('entered');await quiet('entered');
      await page.waitForFunction(() => document.querySelector('.performance-status').dataset.phase !== 'grace');
      report.pausedBefore = await pausedTakeSnapshot();report.takeBefore = await exportTakeData();
      const requestIndex = getRequests().length;
      await importSkin(page, skin);report.imported = await readSettings(page);report.storedImported = await readStoredSkin(page);
      await page.locator('#skin-settings').scrollIntoViewIfNeeded();report.screenshots.push(await screenshot(page, artifactDirectory, 'worldmusichub-skin-settings-en.png'));
      await importSkin(page, skin, Buffer.from('{"version":2}'));report.invalid = await readSettings(page);report.storedAfterInvalid = await readStoredSkin(page);
      // Deliberately abort only native skin write transactions. Reads remain
      // real; this proves the failure branch, not actual disk exhaustion.
      await page.evaluate(() => {
        const native = IDBDatabase.prototype.transaction;globalThis.__skinStorageFault = {native, aborted: 0};
        IDBDatabase.prototype.transaction = function(...args) { const tx = native.apply(this, args);if (this.name === 'worldmusicclub.skins.v1' && args[1] === 'readwrite') { __skinStorageFault.aborted++;queueMicrotask(() => tx.abort()); }return tx; };
      });storageFault = true;
      report.attemptedReplacement = {id: replacement.manifest.id, manifestSha256: replacement.jsonSha256, pngSha256: replacement.pngSha256};
      await importSkin(page, replacement);report.storageFailure = await readSettings(page);report.storedAfterFailure = await readStoredSkin(page);
      report.fault = await page.evaluate(() => { const fault = __skinStorageFault;IDBDatabase.prototype.transaction = fault.native;delete globalThis.__skinStorageFault;return {method: 'native-indexeddb-write-transaction-abort', aborted: fault.aborted}; });storageFault = false;
      await page.locator('#skin-reset').click();await idle(page);report.reset = await readSettings(page);report.storedReset = await readStoredSkin(page);
      await selectSkin(page, 'imported');report.reselected = await readSettings(page);
      await page.locator('#interface-language').selectOption('zh-CN');report.chinese = await readSettings(page);
      await page.locator('#skin-settings').scrollIntoViewIfNeeded();report.screenshots.push(await screenshot(page, artifactDirectory, 'worldmusichub-skin-settings-zh-CN.png'));
      await page.locator('#interface-language').selectOption('en');
      report.skinRequests = getRequests().slice(requestIndex);
      await page.locator('#settings-title').click();await page.keyboard.press('r', {delay: 40});await checkpoint('blocked-input');await quiet('blocked-input');
      await closeShellPanels();await checkpoint('returned');await quiet('returned');
      await page.waitForFunction(id => document.querySelector('#falling-notes').dataset.skin === id, skin.manifest.id);
      await page.evaluate(settlePianoViewportBudget);
      report.geometryAfter = await stageGeometry(page);report.paint = await readStagePaint(page);report.homeDecoration = await homeDecoration(page);
      report.screenshots.push(await screenshot(page, artifactDirectory, 'worldmusichub-skin-stage-active-en.png'));
      report.pausedAfter = await pausedTakeSnapshot();
      report.themeAfter = await page.evaluate(() => localStorage.getItem('worldmusichub.theme'));
      await checkpoint('finished');await quiet('finished', false);report.audio = await page.evaluate(() => { __wmhPreviewAudio.assertHealthy();__wmhLiveNavigation.assertHealthy();return __wmhLiveNavigation.finish(); });
      report.takeAfter = await exportTakeData();report.scoreAfter = await exportScore();
      report.ok = true;
    } catch (error) { report.error = error.stack || String(error);if (observer) try { report.failedAudio = await page.evaluate(() => __wmhLiveNavigation.failureEvidence()); } catch {}throw error; }
    finally {
      if (storageFault) await page.evaluate(() => { IDBDatabase.prototype.transaction = __skinStorageFault.native;delete globalThis.__skinStorageFault; });
      if (observer) report.cleanup = await page.evaluate(() => ({live: __wmhLiveNavigation.restore(), source: __wmhPreviewAudio.restore()}));
      await writeFile(join(artifactDirectory, SKIN_BROWSER_CASES[0].file), JSON.stringify(report, null, 2));
    }
    validateSkinInteractionReport(report);
  });

  test(SKIN_BROWSER_CASES[1].name, {timeout: 120_000}, async () => {
    const skin = originalBrowserSkin(), profile = await mkdtemp(join(tmpdir(), 'wmc-skin-profile-'));
    const report = {version: 1, kind: 'persistence', ok: false, originalFixturesOnly: true, physicalAudio: false,
      scope: 'same-origin-same-Chromium-user-data-directory', profileId: sha256(profile), rounds: [], screenshots: [], pageErrors: [], apiFailures: []};
    let context = null, previous = null;
    async function launch() {
      context = await chromium.launchPersistentContext(profile, {...chromiumLaunchOptions({timeout: 30_000}), viewport: {width: 1280, height: 720}, colorScheme: 'light', acceptDownloads: true});
      const page = context.pages()[0] ?? await context.newPage();page.setDefaultTimeout(15_000);
      page.on('pageerror', error => report.pageErrors.push(error.message));
      page.on('response', response => { if (new URL(response.url()).pathname.startsWith('/api/') && response.status() >= 400) report.apiFailures.push({url: response.url(), status: response.status()}); });
      await page.goto(getOrigin(), {waitUntil: 'domcontentloaded'});await page.locator('#game-home').waitFor({state: 'visible'});await idle(page);
      const round = {origin: new URL(page.url()).origin, profileId: sha256(profile), newContext: previous === null || context !== previous, priorPageClosed: report.rounds.length === 0 ? null : report.rounds.at(-1).pageClosed};
      report.rounds.push(round);return {page, round};
    }
    async function close(round, page) { previous = context;await context.close();context = null;round.pageClosed = page.isClosed(); }
    try {
      let opened = await launch(), page = opened.page;
      await selectLegacyEnglish(page, {fresh: true});await importSkin(page, skin);
      opened.round.settings = await readSettings(page);opened.round.stored = await readStoredSkin(page);await close(opened.round, page);
      opened = await launch();page = opened.page;
      opened.round.settings = await readSettings(page);opened.round.stored = await readStoredSkin(page);opened.round.decoration = await homeDecoration(page);
      report.screenshots.push(await screenshot(page, artifactDirectory, 'worldmusichub-skin-profile-imported.png'));
      await openSettings(page);await page.locator('#interface-language').selectOption('zh-CN');await page.locator('#skin-reset').click();await idle(page);
      opened.round.afterReset = await readSettings(page);opened.round.storedReset = await readStoredSkin(page);await close(opened.round, page);
      opened = await launch();page = opened.page;
      opened.round.settings = await readSettings(page);opened.round.stored = await readStoredSkin(page);opened.round.decoration = await homeDecoration(page);
      report.screenshots.push(await screenshot(page, artifactDirectory, 'worldmusichub-skin-profile-default.png'));
      await selectSkin(page, 'imported');opened.round.reselected = await readSettings(page);opened.round.storedReselected = await readStoredSkin(page);
      await close(opened.round, page);report.ok = true;
    } catch (error) { report.error = error.stack || String(error);if (context) try { report.screenshots.push(await screenshot(context.pages()[0], artifactDirectory, 'worldmusichub-skin-profile-failure.png')); } catch {}throw error; }
    finally { if (context) await context.close();await rm(profile, {recursive: true, force: true});await writeFile(join(artifactDirectory, SKIN_BROWSER_CASES[1].file), JSON.stringify(report, null, 2)); }
    validateSkinPersistenceReport(report);
  });
}

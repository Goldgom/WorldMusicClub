// Prepared for the authorized remote/hosted runner only. Do not run locally
// where a browser launch has been denied. Node/DOM tests do not call this file.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

if (process.env.WMH_HOSTED_BROWSER !== '1') {
  throw new Error('Browser checks require an authorized hosted runner and WMH_HOSTED_BROWSER=1. This entry must not be used to bypass a local browser denial.');
}
const { chromium } = await import(process.env.WMH_PLAYWRIGHT_MODULE || 'playwright');
const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, 'artifacts', 'hosted');
await mkdir(output, { recursive: true });
const port = String(process.env.PORT || 4173), baseURL = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ['scripts/serve.mjs'], { cwd: root, env: { ...process.env, PORT: port }, stdio: ['ignore', 'pipe', 'pipe'] });
let serverError = '';
server.stderr.on('data', value => { serverError += value; });
await Promise.race([
  once(server.stdout, 'data'),
  once(server, 'exit').then(() => { throw new Error(`Server exited: ${serverError}`); }),
  new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('Server did not become ready')), 10000); timer.unref(); }),
]);
let browser;
const errors = [], results = [];
try {
  browser = await chromium.launch({ headless: true });
  const cases = [
    { name: 'desktop-zh-dark', width: 1280, height: 720, locale: 'zh-CN', theme: 'dark' },
    { name: 'wide-zh-dark', width: 1920, height: 1080, locale: 'zh-CN', theme: 'dark' },
    { name: 'landscape-zh-dark', width: 844, height: 390, locale: 'zh-CN', theme: 'dark' },
    { name: 'desktop-en-light', width: 1280, height: 720, locale: 'en', theme: 'light' },
    { name: 'portrait-zh-dark', width: 390, height: 844, locale: 'zh-CN', theme: 'dark' },
  ];
  for (const entry of cases) {
    const context = await browser.newContext({ viewport: { width: entry.width, height: entry.height }, locale: entry.locale, reducedMotion: 'reduce', deviceScaleFactor: 1 });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(`${entry.name}: ${error.message}`));
    page.on('console', message => { if (message.type() === 'error') errors.push(`${entry.name}: ${message.text()}`); });
    await page.addInitScript(({ locale, theme }) => localStorage.setItem('wmh-ui-spike.preferences', JSON.stringify({ locale, theme })), entry);
    await page.goto(baseURL); await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: path.join(output, `${entry.name}-lobby.png`), fullPage: true });
    await page.locator('#start-guided').click();
    await page.locator('#sound').click(); // Avoid audio-device requirements in visual CI.
    await page.locator('#play').click();
    await page.waitForFunction(() => Number(document.querySelector('#progress').value) >= 1, null, { timeout: 5000 });
    await page.locator('#play').click();
    await page.locator('.score-note[data-index="6"]').click();
    const position = await page.locator('#progress').inputValue();
    assert.equal(position, '6');
    assert.equal(await page.locator('.score-note[aria-current="step"]').count(), 1);
    assert.equal(await page.locator('.fret.is-current').count(), 1);
    assert.equal(await page.locator('.fret').count(), 78);
    assert.equal(await page.locator('#current-pitch').textContent(), 'C4 · Do');
    await page.locator('#back').click(); await page.locator('#resume-session').click();
    assert.equal(await page.locator('#progress').inputValue(), position);
    assert.equal(await page.locator('#practice').getAttribute('data-status'), 'paused');
    const geometry = await page.evaluate(() => {
      const box = selector => { const rect = document.querySelector(selector).getBoundingClientRect(); return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, right: rect.right, bottom: rect.bottom }; };
      return { viewport: { width: innerWidth, height: innerHeight }, documentWidth: document.documentElement.scrollWidth, stage: box('.stage-panel'), score: box('.score-panel'), fretboard: box('.fretboard'), transport: box('.transport') };
    });
    assert.ok(geometry.documentWidth <= entry.width + 1, `${entry.name}: horizontal document overflow`);
    if (entry.width >= 700) {
      for (const [name, rect] of Object.entries(geometry).filter(([name]) => ['stage', 'score', 'fretboard', 'transport'].includes(name))) {
        assert.ok(rect.y >= 0 && rect.bottom <= entry.height + 1, `${entry.name}: ${name} not fully within viewport: ${JSON.stringify(rect)}`);
      }
      assert.ok(geometry.score.x >= geometry.stage.right, `${entry.name}: score must sit beside stage`);
      assert.ok(geometry.transport.y >= geometry.fretboard.bottom, `${entry.name}: transport overlaps fretboard`);
    }
    await page.screenshot({ path: path.join(output, `${entry.name}-practice.png`), fullPage: true });
    results.push({ ...entry, geometry, pausedPosition: position });
    if (entry.name === 'desktop-zh-dark') {
      await page.locator('#back').click(); await page.locator('#start-free').click(); await page.locator('#play').click();
      await page.locator('#main').focus();
      await page.keyboard.press('1'); await page.keyboard.press('3'); await page.keyboard.press('5');
      assert.equal(await page.locator('#input-count').textContent(), '3');
      assert.equal(await page.locator('#recent-inputs').textContent(), 'C4E4G4');
      await page.locator('#play').click();
      await page.screenshot({ path: path.join(output, 'desktop-zh-dark-free.png'), fullPage: true });
      await page.locator('#reset').click(); assert.equal(await page.locator('#input-count').textContent(), '0');
    }
    await context.close();
  }
  assert.deepEqual(errors, [], 'Browser runtime/console errors');
  const sourceFiles = ['index.html', 'styles.css', 'app.js', 'model.js', 'locales.js', 'scripts/serve.mjs', 'scripts/hosted-check.mjs'];
  const sourceHashes = {};
  for (const filename of sourceFiles) sourceHashes[filename] = createHash('sha256').update(await readFile(path.join(root, filename))).digest('hex');
  await writeFile(path.join(output, 'results.json'), JSON.stringify({ verifiedAt: new Date().toISOString(), sourceHashes, browserVersion: browser.version(), results, errors, scope: 'Renderer interactions and geometry only; no Rust, native shell, MIDI hardware, or acoustic latency verification.' }, null, 2) + '\n');
  process.stdout.write(`Hosted checks passed; screenshots and exact-source hashes: ${output}\n`);
} finally {
  await browser?.close();
  server.kill('SIGTERM');
}

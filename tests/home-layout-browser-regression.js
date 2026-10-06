import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {assertHomeLayout, assertHomeTargetVisible, assertHomeLayoutReport, homeModeIds, homeFocusIds, HOME_LAYOUT_PREVIEW_CASE, HOME_LAYOUT_CASES, homeLayoutScreenshotNames} from './home-layout.js';

async function targetVisibility(target) {
  return target.evaluate(node => {
    const r = node.getBoundingClientRect(), home = document.querySelector('#game-home').getBoundingClientRect();
    // Stay inside the rounded corners rather than sampling transparent pixels.
    const inset = Math.min(12, r.width/4, r.height/4);
    const points = [[r.left+inset,r.top+inset],[r.right-inset,r.top+inset],[r.left+inset,r.bottom-inset],[r.right-inset,r.bottom-inset],[(r.left+r.right)/2,(r.top+r.bottom)/2]];
    return {id:node.id, left:r.left, top:r.top, right:r.right, bottom:r.bottom,
      clip:{left:Math.max(0,home.left),top:Math.max(0,home.top),right:Math.min(innerWidth,home.right),bottom:Math.min(innerHeight,home.bottom)},
      hits:points.map(([x,y]) => { const hit = document.elementFromPoint(x,y); return hit === node || node.contains(hit); })};
  });
}

// Registered only with the existing Rust-backed app suite. No standalone app,
// mock CSS fixture, browser, or server is created by this module.
export function registerHomeLayoutBrowserRegressions({test, getPage, ui, closeShellPanels, artifactDirectory}) {
  test(HOME_LAYOUT_PREVIEW_CASE, {timeout:180_000}, async () => {
    const page = getPage(), evidence = [];
    const report = {version:1, ok:false, scope:'actual-hosted-home-layout', originalFixturesOnly:true, nativeWebviewZoomVerified:false, evidence};
    try {
      await closeShellPanels();
      await page.locator('#shell-brand .brand').click();
      for (const config of HOME_LAYOUT_CASES) {
        await page.setViewportSize({width:config.viewport.width, height:config.viewport.height});
        await page.emulateMedia({reducedMotion:config.reducedMotion});
        await ui('#interface-language').selectOption(config.locale);
        await ui('#theme-mode').selectOption(config.theme);
        await closeShellPanels();
        const originals = await page.locator('.game-mode-copy strong,.game-mode-copy small').allTextContents();
        if (config.longLabels) await page.locator('.game-mode-copy strong,.game-mode-copy small').evaluateAll((nodes, locale) => {
          for (const node of nodes) node.textContent += locale === 'en' ? ' · extended appearance and performance configuration' : ' · 更多外观与音乐演奏配置选项';
        }, config.locale);
        await page.locator('#game-home').evaluate(node => { node.scrollTop = 0; });
        await page.evaluate(async () => { await document.fonts.ready; await new Promise(requestAnimationFrame); });
        const row = await page.evaluate(() => {
          const rect = node => { const r = node.getBoundingClientRect(); return {left:r.left, top:r.top, right:r.right, bottom:r.bottom, width:r.width, height:r.height}; };
          const home = document.querySelector('#game-home');
          return {screen:document.body.dataset.screen, viewport:{width:innerWidth,height:innerHeight}, documentWidth:document.documentElement.scrollWidth,
            observed:{locale:document.documentElement.lang,theme:document.documentElement.dataset.themeMode,reducedMotion:matchMedia('(prefers-reduced-motion: reduce)').matches ? 'reduce' : 'no-preference'},
            home:{...rect(home), scrollWidth:home.scrollWidth, clientWidth:home.clientWidth, scrollHeight:home.scrollHeight, clientHeight:home.clientHeight},
            intro:rect(document.querySelector('.rhythm-home-intro')), free:rect(document.querySelector('.rhythm-free-entry')),
            cards:[...document.querySelectorAll('.game-mode')].map(node => ({id:node.id, disabled:node.disabled, ...rect(node),
              text:[...node.querySelectorAll('.game-mode-copy strong,.game-mode-copy small')].map(text => { const range = document.createRange(); range.selectNodeContents(text); return {...rect(range), content:text.textContent}; }),
              badge:node.querySelector('.game-mode-badge') ? rect(node.querySelector('.game-mode-badge')) : null}))};
        });
        Object.assign(row, {config, targets:[], keyboard:[], screenshots:[]}); evidence.push(row);
        const [topPng, settingsPng, footerPng] = homeLayoutScreenshotNames(config);
        const screenshot = async name => {
          const bytes = await page.screenshot({path:join(artifactDirectory, name)});
          row.screenshots.push({name,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),width:row.viewport.width,height:row.viewport.height});
        };
        await screenshot(topPng);
        assertHomeLayout(row);
        for (const id of [...homeModeIds, 'start-free-practice']) {
          const target = page.locator(`#${id}`);
          await target.scrollIntoViewIfNeeded();
          const visible = await targetVisibility(target);
          row.targets.push(visible);
          if (id === 'home-settings') await screenshot(settingsPng);
          assertHomeTargetVisible(visible);
        }
        await screenshot(footerPng);
        await page.locator('#home-title').focus();
        for (const id of homeFocusIds) {
          await page.keyboard.press('Tab');
          const focused = await page.evaluate(() => ({id:document.activeElement.id, visible:document.activeElement.matches(':focus-visible'), outlineWidth:parseFloat(getComputedStyle(document.activeElement).outlineWidth)}));
          row.keyboard.push(focused); assert.equal(focused.id, id); assert.equal(focused.visible, true); assert.ok(focused.outlineWidth >= 3);
          focused.target = await targetVisibility(page.locator(`#${id}`)); assertHomeTargetVisible(focused.target);
        }
        // Exercise the formerly obscured home card itself, never the header shortcut.
        await page.locator('#home-settings').evaluate(node => {
          globalThis.__wmhHomeSettingsClick = null;
          node.addEventListener('click', event => { globalThis.__wmhHomeSettingsClick = {control:node.id, trusted:event.isTrusted}; }, {once:true,capture:true});
        });
        await page.locator('#home-settings').click();
        assert.equal(await page.locator('#settings-dialog').isVisible(), true);
        row.settingsActivation = await page.evaluate(() => ({...globalThis.__wmhHomeSettingsClick, dialog:'settings-dialog', open:document.querySelector('#settings-dialog').open}));
        await closeShellPanels();
        row.settingsOpened = true;
        if (config.longLabels) await page.locator('.game-mode-copy strong,.game-mode-copy small').evaluateAll((nodes, values) => nodes.forEach((node, index) => { node.textContent = values[index]; }), originals);
      }
      report.ok = true; assertHomeLayoutReport(report);
    } catch (error) {
      report.ok = false; report.error = error.message; throw error;
    } finally {
      await writeFile(join(artifactDirectory, 'worldmusichub-home-layout.json'), JSON.stringify(report, null, 2));
    }
  });
}

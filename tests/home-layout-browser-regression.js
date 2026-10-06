import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {LOCALE_CATALOGS} from '../web/i18n.js';
import {assertHomeLayout, assertHomeTargetVisible, assertHomeLayoutReport, homeModeIds, homeFocusIds, HOME_LAYOUT_PREVIEW_CASE, HOME_LAYOUT_CASES, homeLayoutScreenshotNames} from './home-layout.js';

const labelSelector = '.game-mode-copy strong,.game-mode-copy small';

export async function enterHomeLayoutFromStage(page, closeShellPanels) {
  await closeShellPanels();
  assert.equal(await page.locator('#workspace').isVisible(), true, 'The full-app bootstrap starts on stage');
  // The stage deliberately hides the shell brand. Use the same visible return
  // controls as the existing free-piano and navigation regressions.
  await page.locator('#back-to-library').click();
  await page.locator('#song-lobby').waitFor({state:'visible'});
  await page.locator('#lobby-home').click();
  await page.locator('#game-home').waitFor({state:'visible'});
  assert.equal(await page.locator('body').getAttribute('data-screen'), 'home');
}

export async function configureHomeLayoutCase({page, ui, closeShellPanels}, config) {
  assert.equal(await page.locator('#game-home').isVisible(), true);
  await page.setViewportSize({width:config.viewport.width, height:config.viewport.height});
  await page.emulateMedia({reducedMotion:config.reducedMotion});
  await ui('#interface-language').selectOption(config.locale);
  await ui('#theme-mode').selectOption(config.theme);
  await closeShellPanels();
  assert.equal(await page.locator('body').getAttribute('data-screen'), 'home');
  assert.equal(await page.locator('#settings-dialog').isVisible(), false);
  const labels = await page.locator(labelSelector).evaluateAll(nodes => nodes.map(node => ({key:node.getAttribute('data-i18n'),text:node.textContent})));
  for (const label of labels) assert.equal(label.text, LOCALE_CATALOGS[config.locale][label.key], `${label.key} must use the actual selected locale before measuring`);
  return labels.map(label => label.text);
}

// Keep the app's bound Text nodes alive. Replacing element.textContent retires
// its localization binding, even if the original string is put back afterward.
export function setHomeLabelText(nodes, values) {
  if (nodes.length !== values.length) throw new Error('Home label inventory changed');
  nodes.forEach((node, index) => {
    if (node.childNodes.length !== 1 || node.firstChild.nodeType !== 3) throw new Error('Home label no longer has its original text node');
    node.firstChild.textContent = values[index];
  });
}

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
      await enterHomeLayoutFromStage(page, closeShellPanels);
      for (const config of HOME_LAYOUT_CASES) {
        const originals = await configureHomeLayoutCase({page, ui, closeShellPanels}, config);
        if (config.longLabels) {
          const suffix = config.locale === 'en' ? ' · extended appearance and performance configuration' : ' · 更多外观与音乐演奏配置选项';
          await page.locator(labelSelector).evaluateAll(setHomeLabelText, originals.map(text => text+suffix));
        }
        await page.locator('#game-home').evaluate(node => { node.scrollTop = 0; });
        await page.evaluate(async () => { await document.fonts.ready; await new Promise(requestAnimationFrame); });
        const row = await page.evaluate(() => {
          const rect = node => { const r = node.getBoundingClientRect(); return {left:r.left, top:r.top, right:r.right, bottom:r.bottom, width:r.width, height:r.height}; };
          const home = document.querySelector('#game-home');
          return {screen:document.body.dataset.screen, viewport:{width:innerWidth,height:innerHeight}, documentWidth:document.documentElement.scrollWidth,
            observed:{locale:document.documentElement.lang,theme:document.documentElement.dataset.themeMode,reducedMotion:matchMedia('(prefers-reduced-motion: reduce)').matches ? 'reduce' : 'no-preference'},
            home:{...rect(home), scrollWidth:home.scrollWidth, clientWidth:home.clientWidth, scrollHeight:home.scrollHeight, clientHeight:home.clientHeight},
            overflowCandidates:home.scrollWidth > home.clientWidth+1 ? [...home.querySelectorAll('*')].map(node=>({tag:node.tagName,id:node.id,className:node.className,...rect(node)})).filter(box=>box.right>home.getBoundingClientRect().right+1||box.left<home.getBoundingClientRect().left-1) : [],
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
        if (config.longLabels) await page.locator(labelSelector).evaluateAll(setHomeLabelText, originals);
      }
      report.ok = true; assertHomeLayoutReport(report);
    } catch (error) {
      report.ok = false; report.error = error.message; throw error;
    } finally {
      await writeFile(join(artifactDirectory, 'worldmusichub-home-layout.json'), JSON.stringify(report, null, 2));
    }
  });
}

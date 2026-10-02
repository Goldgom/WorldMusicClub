import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseHTML} from 'linkedom';
import {freePracticeApp, fixtureScoreServer} from './free-practice-app-fixtures.js';
import {getAppI18n} from '../web/app-locale.js';
import {validateLocaleCatalogs} from '../web/i18n.js';
import {contrastRatio} from '../web/themes.js';

const onsetCount = record => record.observations.events.filter(event => event.kind === 'note_on').length;
function playKey(app) {
  const properties = {code:'KeyR', key:'r'};
  app.emit(app.$('free-practice-title'), 'keydown', properties);
  app.emit(app.$('free-practice-title'), 'keyup', properties);
}

test('rhythm entry keeps real controls, records silently and retains a draft across brand navigation', async () => {
  const app = await freePracticeApp();
  try {
    assert.ok(app.document.body.classList.contains('rhythm-shell'));
    assert.equal(app.$('start-free-practice').closest('section').className, 'rhythm-free-entry');
    assert.equal(app.document.querySelectorAll('#start-free-practice').length, 1);
    assert.equal(app.$('rhythm-location').textContent, '练习大厅');
    await app.click('start-free-practice');
    const start = app.$('free-start'), state = app.$('free-state'), input = app.$('free-practice-keys').firstElementChild;
    assert.equal(start.closest('.rhythm-free-console')?.getAttribute('role'), 'group');
    assert.equal(app.$('rhythm-free-resume').hidden, true);
    await app.click('free-sound'); await app.click('free-start'); playKey(app);
    app.emit(app.document.querySelector('#shell-brand .brand'), 'click', {button:0});
    assert.equal(app.document.body.dataset.screen, 'library');
    assert.equal(app.$('free-practice-screen').dataset.state, 'paused');
    await app.click('start-free-practice');
    assert.equal(app.$('free-start'), start); assert.equal(app.$('free-state'), state);
    assert.equal(app.$('free-practice-keys').firstElementChild, input);
    assert.equal(app.document.querySelectorAll('.rhythm-free-console').length, 1);
    await app.click('free-resume'); playKey(app); await app.click('free-stop');
    const record = await app.exported('free-export-draft');
    assert.equal(onsetCount(record), 2); assert.equal(record.segments.length, 2);
    app.$('free-record-label').value = '节奏练习 / rhythm'; await app.click('free-save');
    assert.equal(app.$('free-record-select').options.length, 1);
    assert.deepEqual(await app.exported('free-export-record'), record);
    assert.deepEqual(app.audio(), {contexts:0, unlocks:0});
    assert.equal(app.midiRequests(), 0);
  } finally { await app.close(); }
});

test('stage to free to retained stage preserves the original score take and uses existing pause boundaries', async () => {
  const app = await freePracticeApp({fetchResult:await fixtureScoreServer()});
  try {
    await app.until(() => !app.$('start-practice').disabled);
    const i18n = getAppI18n(app.document); i18n.setLocale('en');
    await app.click('start-free-practice'); await app.click('free-sound'); await app.click('free-exit');
    app.$('count-in').checked = false; await app.click('start-practice');
    await app.until(() => app.document.body.dataset.screen === 'stage' && app.$('play-button').textContent.includes('Pause'));
    const scoreNode = app.$('score-title'), originalTitle = scoreNode.textContent, sourceExport = app.$('export-button');
    await app.click('rhythm-stage-free');
    assert.equal(app.document.body.dataset.screen, 'free');
    assert.equal(app.$('rhythm-free-resume').hidden, false);
    const scoreBefore = await app.exported('export-takes');
    await app.click('free-start'); playKey(app); await app.click('free-stop');
    const freeBefore = await app.exported('free-export-draft');
    await app.click('rhythm-free-resume');
    assert.equal(app.document.body.dataset.screen, 'stage');
    assert.equal(app.$('score-title'), scoreNode); assert.equal(scoreNode.textContent, originalTitle);
    assert.equal(app.$('export-button'), sourceExport);
    assert.doesNotMatch(app.$('play-button').textContent, /Pause/);
    assert.deepEqual(await app.exported('export-takes'), scoreBefore);
    await app.click('rhythm-stage-free');
    assert.deepEqual(await app.exported('free-export-draft'), freeBefore);
    assert.equal(app.document.querySelectorAll('#rhythm-free-resume').length, 1);
    assert.deepEqual(app.audio(), {contexts:0, unlocks:0});
  } finally { await app.close(); }
});

test('language redraw preserves recording, focusable controls, authored labels and console identity', async () => {
  const app = await freePracticeApp();
  try {
    await app.click('start-free-practice'); await app.click('free-sound'); await app.click('free-start'); playKey(app);
    const i18n = getAppI18n(app.document), console = app.document.querySelector('.rhythm-free-console');
    const input = app.$('free-record-label'), mapping = app.$('free-practice-keys').firstElementChild;
    input.value = 'Keep my original title 原题';
    const audio = app.audio(), requests = app.requests.length;
    i18n.setLocale('en');
    assert.equal(app.$('rhythm-location').textContent, 'Free practice');
    assert.equal(app.$('start-free-practice').textContent, 'Enter free practice →');
    assert.equal(console.getAttribute('aria-label'), 'Free performance recording and status');
    i18n.setLocale('zh-CN');
    assert.equal(app.$('start-free-practice').textContent, '进入自由练习 →');
    assert.equal(app.document.querySelector('.rhythm-free-console'), console);
    assert.equal(app.$('free-practice-keys').firstElementChild, mapping);
    assert.equal(input.value, 'Keep my original title 原题');
    assert.equal(app.$('free-practice-screen').dataset.state, 'recording');
    assert.deepEqual(app.audio(), audio); assert.equal(app.requests.length, requests);
    assert.equal(i18n.getReports().filter(report => report.key?.startsWith('rhythm.')).length, 0);
    assert.deepEqual(validateLocaleCatalogs(), []);
  } finally { await app.close(); }
});

test('rhythm CSS scopes visual changes, reserves the falling field and leaves compact guitar rows intact', async () => {
  const css = await readFile(new URL('../web/rhythm-shell.css', import.meta.url), 'utf8');
  const {document} = parseHTML(`<style>${css}</style>`);
  const flatten = rules => [...rules].flatMap(rule => rule.cssRules ? flatten(rule.cssRules) : [rule]);
  const rules = flatten(document.querySelector('style').sheet.cssRules);
  for (const rule of rules) for (const selector of rule.selectorText.split(',')) {
    assert.match(selector, /\.rhythm-shell(?:\b|[.# ])/);
    assert.doesNotMatch(selector, /\.stage-heading\s+(?:>|)\s*span\b/);
  }
  const fields = rules.filter(rule => rule.selectorText === '.rhythm-shell #falling-notes');
  assert.ok(fields.length >= 2); for (const field of fields) assert.equal(field.style['min-height'], '100px');
  assert.equal(rules.find(rule => rule.selectorText === '.rhythm-shell .guitar-scroll').style['min-height'], '56px');
  const colors = [['#272438','#ffffff'],['#625d77','#f5f4fa'],['#6450a4','#f5f4fa'],['#f0eef9','#171b27'],['#abb4cc','#0e111a'],['#c2aff6','#0e111a'],['#122923','#80e0cb']];
  for (const [foreground, background] of colors) assert.ok(contrastRatio(foreground, background) >= 4.5, `${foreground}/${background}`);
  const html = await readFile(new URL('../web/index.html', import.meta.url), 'utf8');
  assert.ok(html.indexOf('/rhythm-shell.css') > html.indexOf('/free-practice.css'));
});

test('accepted160 beginner controls and saved appearance survive rhythm screen and locale round trips', async () => {
  const app = await freePracticeApp({fetchResult:await fixtureScoreServer()});
  try {
    await app.until(() => !app.$('start-listen').disabled);
    await app.click('start-free-practice'); await app.click('free-sound'); await app.click('free-exit');
    app.$('count-in').checked = false; await app.click('start-listen');
    await app.until(() => app.document.body.dataset.screen === 'stage'); await app.click('reset-button');
    const i18n = getAppI18n(app.document);
    const ids = ['beginner-controls','beginner-enabled','beginner-reference','beginner-numbered-mode','free-beginner-controls','free-beginner-enabled','keyboard-compact-status','theme-mode','interface-language'];
    const nodes = new Map(ids.map(id => [id, app.$(id)]));
    for (const [id, node] of nodes) assert.ok(node, `${id} must survive the integration`);
    app.$('beginner-enabled').checked = true; app.emit(app.$('beginner-enabled'), 'change');
    assert.equal(app.$('free-beginner-enabled').checked, true);
    const originalScore = await app.exported('export-button'), originalTake = await app.exported('export-takes');
    app.$('theme-mode').value = 'custom'; app.emit(app.$('theme-mode'), 'change');
    app.$('theme-accent').value = '#514798'; app.emit(app.$('theme-accent'), 'input');
    app.$('theme-background').value = '#f5f0ff'; app.emit(app.$('theme-background'), 'input');
    const originalTheme = app.document.documentElement.getAttribute('style');
    const requests = app.requests.length;
    for (const locale of ['en','zh-CN','en']) {
      await app.click('rhythm-stage-free');
      i18n.setLocale(locale);
      assert.equal(app.$('free-beginner-enabled').checked, true);
      assert.ok(app.document.querySelector('#free-practice-keys .beginner-note-label'));
      await app.click('rhythm-free-resume');
      for (const [id, node] of nodes) {
        assert.equal(app.$(id), node, `${id} keeps its original controller attachment`);
        assert.equal(app.document.querySelectorAll(`#${id}`).length, 1);
      }
      assert.equal(app.$('beginner-enabled').checked, true);
      assert.ok(app.document.querySelector('#keyboard .beginner-note-label'));
      assert.equal(app.document.documentElement.getAttribute('data-theme-mode'), 'custom');
      assert.equal(app.document.documentElement.getAttribute('style'), originalTheme);
    }
    assert.equal(app.requests.length, requests, 'Presentation navigation does not recompile or remap');
    assert.deepEqual(await app.exported('export-button'), originalScore);
    assert.deepEqual(await app.exported('export-takes'), originalTake);
    assert.deepEqual(app.audio(), {contexts:0, unlocks:0});
    assert.equal(app.midiRequests(), 0);
  } finally { await app.close(); }
});

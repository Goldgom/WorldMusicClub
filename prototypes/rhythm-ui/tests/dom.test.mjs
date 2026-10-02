import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { mountApp } from '../app.js';
const { parseHTML } = await import(process.env.WMH_LINKEDOM_MODULE || 'linkedom');
const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');

function fixture(preferences = null) {
  const { document, window: dom } = parseHTML(html);
  let now = 0;
  const listeners = new Map(), storage = new Map(preferences ? [['wmh-ui-spike.preferences', JSON.stringify(preferences)]] : []);
  for (const select of document.querySelectorAll('select')) {
    let value = select.id === 'tempo' ? '96' : 'zh-CN';
    Object.defineProperty(select, 'value', { get: () => value, set: next => { value = next; } });
  }
  document.querySelector('canvas').getContext = () => null;
  const window = {
    performance: { now: () => now }, localStorage: { getItem: k => storage.get(k), setItem: (k, v) => storage.set(k, v) },
    matchMedia: () => ({ matches: false }), requestAnimationFrame() {}, setInterval() {}, setTimeout() {}, clearTimeout() {},
    history: { replaceState() {} }, location: { hash: '' }, addEventListener: (key, handler) => listeners.set(key, handler),
  };
  const app = mountApp(document, window), $ = id => document.getElementById(id);
  const fire = (id, name = 'click') => $(id).dispatchEvent(new dom.Event(name, { bubbles: true }));
  const key = (code, kind = 'keydown', target = document.body, extra = {}) => {
    const event = new dom.Event(kind, { bubbles: true, cancelable: true }); Object.assign(event, { code, ...extra }); target.dispatchEvent(event);
  };
  return { app, document, $, fire, key, advance: ms => { now += ms; app.render(); }, blur: () => listeners.get('blur')(), storage };
}

test('mounts Chinese-first lobby and opens a complete synchronized guitar scene', () => {
  const f = fixture(); assert.equal(f.document.documentElement.lang, 'zh-CN');
  assert.equal(f.$('start-guided').textContent.includes('开始跟练'), true);
  f.fire('start-guided'); assert.equal(f.$('practice').hidden, false); assert.equal(f.$('lobby').hidden, true);
  assert.equal(f.document.querySelectorAll('.fret').length, 78);
  assert.equal(f.document.querySelectorAll('.score-note').length, 32);
  assert.equal(f.document.querySelectorAll('.score-note.active').length, 1);
  assert.equal(f.$('current-pitch').textContent, 'C4 · Do');
});
test('play advances score, pause freezes it, back and resume retain session without auto-play', () => {
  const f = fixture(); f.fire('start-guided'); f.fire('play'); f.advance(1250);
  assert.equal(f.$('current-pitch').textContent, 'E4 · Mi');
  f.fire('play'); f.advance(10000); assert.equal(f.app.snapshot().position, 2);
  f.fire('back'); assert.equal(f.$('resume-session').hidden, false); f.fire('resume-session');
  assert.equal(f.app.snapshot().status, 'paused'); assert.equal(f.app.snapshot().position, 2);
});
test('language and theme change all dynamic state labels without resetting playback', () => {
  const f = fixture(); f.fire('start-guided'); f.fire('play'); f.advance(2500);
  f.$('locale').value = 'en'; f.fire('locale', 'change');
  assert.equal(f.document.documentElement.lang, 'en'); assert.equal(f.$('status').textContent, 'Practicing');
  assert.equal(f.$('measure-label').textContent, 'Measure 2 / 8'); assert.equal(f.app.snapshot().position, 4);
  f.fire('theme'); assert.equal(f.document.documentElement.dataset.theme, 'light');
  assert.equal(f.$('theme-label').textContent, 'Light'); assert.equal(f.app.snapshot().status, 'playing');
  assert.deepEqual(JSON.parse(f.storage.get('wmh-ui-spike.preferences')), { locale: 'en', theme: 'light' });
});
test('number-key inputs require practice focus, reject repeats/modifiers, and release on blur', () => {
  const f = fixture(); f.key('Digit1'); assert.equal(f.app.snapshot().inputCount, 0);
  f.fire('start-guided'); f.fire('play'); f.key('Digit1'); f.key('Digit1', 'keydown', f.document.body, { repeat: true });
  f.key('Digit2', 'keydown', f.document.body, { ctrlKey: true }); f.key('Digit3', 'keydown', f.$('tempo'));
  assert.equal(f.app.snapshot().inputCount, 1); assert.ok(f.document.querySelector('.is-held'));
  f.blur(); assert.equal(f.app.snapshot().status, 'paused'); assert.equal(f.document.querySelectorAll('.is-held').length, 0);
});
test('free practice shows real recent inputs and reset clears both count and time', () => {
  const f = fixture(); f.fire('start-free'); assert.equal(f.$('score-heading').textContent, '最近输入');
  assert.equal(f.$('progress').disabled, true); assert.equal(f.$('tempo').disabled, true);
  f.fire('play'); f.key('Digit1'); f.key('Digit1', 'keyup'); f.key('Digit5'); f.advance(3000);
  assert.equal(f.$('input-count').textContent, '2'); assert.equal(f.$('recent-inputs').textContent, 'C4G4');
  assert.equal(f.app.snapshot().seconds, 3); f.fire('reset');
  assert.equal(f.$('input-count').textContent, '0'); assert.equal(f.app.snapshot().seconds, 0);
});
test('seeking the visible score moves the active marker and remains paused', () => {
  const f = fixture(); f.fire('start-guided'); f.fire('play'); f.fire('play');
  const note = f.document.querySelector('.score-note[data-index="18"]'); note.click();
  assert.equal(f.app.snapshot().index, 18); assert.equal(note.getAttribute('aria-current'), 'step');
  assert.equal(f.$('current-pitch').textContent, 'G4 · Sol'); assert.equal(f.app.snapshot().status, 'paused');
});

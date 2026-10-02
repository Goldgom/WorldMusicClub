import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { catalogs, translate } from '../locales.js';
test('Chinese and English catalogs have identical keys and interpolation contracts', () => {
  assert.deepEqual(Object.keys(catalogs['zh-CN']).sort(), Object.keys(catalogs.en).sort());
  for (const key of Object.keys(catalogs.en)) {
    const parameters = value => [...value.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();
    assert.deepEqual(parameters(catalogs['zh-CN'][key]), parameters(catalogs.en[key]), key);
    assert.ok(catalogs.en[key].length > 0); assert.ok(catalogs['zh-CN'][key].length > 0);
  }
});
test('all HTML translation attributes resolve in both languages', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  for (const match of html.matchAll(/data-(?:t|title|aria)="([^"]+)"/g)) {
    for (const locale of Object.keys(catalogs)) assert.equal(typeof translate(locale, match[1]), 'string');
  }
});
test('unknown locale defaults to Chinese while missing keys or parameters are explicit errors', () => {
  assert.equal(translate('unknown', 'lobby'), '练习大厅');
  assert.equal(translate('en', 'notePosition', { string: 2, fret: 3 }), 'String 2 · Fret 3');
  assert.throws(() => translate('en', 'missing'), /Missing translation/);
  assert.throws(() => translate('zh-CN', 'notePosition'), /Missing parameter/);
});

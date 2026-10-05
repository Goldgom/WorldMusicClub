import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, mkdtemp, mkdir, writeFile, symlink, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {deflateSync} from 'node:zlib';
import Ajv2020 from 'ajv/dist/2020.js';
import {DEFAULT_SKIN, SKIN_LIMITS, SKIN_FEATURES, parseSkinManifest, validateSkinManifest,
  safeSkinAssetPath, contrastRatio, inspectSkinPng, validateSkinResources, resolveSkin,
  resetSkin, skinLayoutBands} from '../web/skin-format.js';
import {validateSkinDirectory} from '../scripts/validate-skin.mjs';

const read = path => readFile(new URL(path, import.meta.url));
const sampleText = await read('../skins/original-midnight/skin.json');
const sample = JSON.parse(sampleText);
const originalPng = await read('../skins/original-midnight/assets/woven.png');
const schema = JSON.parse(await read('../schema/worldmusicclub-skin-v1.schema.json'));
const ajv = new Ajv2020({strict: true, allErrors: true});
const validateSchema = ajv.compile(schema);
const encode = value => JSON.stringify(value);
const mutate = change => { const result = structuredClone(sample); change(result); return result; };
const rejects = (value, code) => assert.throws(() => parseSkinManifest(encode(value)), code ? {code} : undefined);
const resources = bytes => new Map([[sample.assets[0].path, bytes ?? originalPng]]);

test('default and original sample satisfy strict schema, semantic validator and actual resource bounds', async () => {
  assert.equal(ajv.validateSchema(schema), true);
  for (const skin of [DEFAULT_SKIN, sample, JSON.parse(await read('../skins/default.skin.json'))]) {
    assert.equal(validateSchema(skin), true, ajv.errorsText(validateSchema.errors));
    assert.deepEqual(parseSkinManifest(encode(skin)), skin);
  }
  assert.deepEqual(JSON.parse(await read('../skins/default.skin.json')), DEFAULT_SKIN);
  const result = await validateSkinResources(sample, resources());
  assert.equal(result.assets.size, 1); assert.deepEqual(result.diagnostics, []);
  assert.notEqual(result.assets.get('woven'), originalPng);
  assert.deepEqual(await validateSkinDirectory(fileURLToPath(new URL('../skins/original-midnight', import.meta.url))),
    {format: 'worldmusicclub-skin', version: 1, id: 'original-midnight', valid: true, usable_assets: 1, diagnostics: []});
});

test('strict unknown fields and required members prevent executable, timing and song Mod overrides', () => {
  const instances = [s => s, s => s.palette, s => s.notes, s => s.notes.human, s => s.notes.machine,
    s => s.keyboard, s => s.notation, s => s.layout, s => s.background, s => s.assets[0], s => s.fallback];
  for (const select of instances) {
    const original = select(sample);
    for (const field of Object.keys(original)) {
      const missing = mutate(s => { delete select(s)[field]; });
      assert.equal(validateSchema(missing), false); rejects(missing, 'skin_missing_field');
    }
    for (const field of ['script', 'onload', 'shader', 'url', 'part_id', 'performer', 'instrument', 'tempo', 'scoring', 'notes_override']) {
      const unknown = mutate(s => { select(s)[field] = 'forbidden'; });
      assert.equal(validateSchema(unknown), false); rejects(unknown, 'skin_unknown_field');
    }
  }
});

test('manifest decoding rejects duplicate keys, malformed UTF-8, deep JSON and oversized data', () => {
  assert.throws(() => parseSkinManifest(encode(sample).replace('"version":1', '"version":2,"version":1')), {code: 'skin_duplicate_field'});
  assert.throws(() => parseSkinManifest('{"x":1,"\\u0078":2}'), {code: 'skin_duplicate_field'});
  assert.throws(() => parseSkinManifest(Uint8Array.from([0xff, 0xfe])), {code: 'skin_json'});
  for (const input of ['', '{', '[1,]', '{"x":01}', '{"x":NaN}', '{"x":true} trailing', '"unterminated', '['.repeat(14) + '0' + ']'.repeat(14)]) assert.throws(() => parseSkinManifest(input), {code: 'skin_json'});
  assert.throws(() => parseSkinManifest(' '.repeat(SKIN_LIMITS.manifest_bytes + 1)), {code: 'skin_bounds'});
  rejects(mutate(s => { s.version = 2; }), 'skin_version');
  rejects(mutate(s => { s.name = '名'.repeat(97); }));
  for (const name of ['', ' ', ' padded', 'line\nfeed']) rejects(mutate(s => { s.name = name; }));
  const frozen = parseSkinManifest(sampleText); assert.ok(Object.isFrozen(frozen.notes.human));
  assert.throws(() => { frozen.notes.human.marker = 'circle'; }, TypeError);
});

test('schema and reader reject trailing line terminators in identifiers, paths and colors', () => {
  for (const suffix of ['\n', '\r', '\r\n', '\u2028', '\u2029']) {
    for (const edit of [s => { s.id += suffix; }, s => { s.assets[0].id += suffix; },
      s => { s.assets[0].path += suffix; }, s => { s.palette.foreground += suffix; }]) {
      const skin = mutate(edit); assert.equal(validateSchema(skin), false); rejects(skin);
    }
  }
});

test('all package paths are local, canonical, portable and non-executable', () => {
  for (const path of ['../a.png', 'assets/../a.png', '/assets/a.png', 'C:/a.png', 'assets\\a.png',
    'https://example.com/a.png', 'data:image/png;base64,x', '//host/a.png', 'assets/%2e%2e/a.png',
    'assets/a.png?x', 'assets/a.png#x', 'assets//a.png', 'assets/.a.png', 'assets/a.svg',
    'assets/a.PNG', 'assets/con.png', 'assets/com1/a.png', 'assets/x/aux.png', 'assets/é.png', 'assets/a\u0000.png',
    'assets/a.png\n', 'assets/a.png\r', 'assets/a.png\u2028']) {
    assert.equal(safeSkinAssetPath(path), false, path);
    rejects(mutate(s => { s.assets[0].path = path; }), 'skin_asset_path');
  }
  assert.equal(safeSkinAssetPath('assets/original/sub_1/image-2.png'), true);
  rejects(mutate(s => { s.assets.push({...s.assets[0], id: 'copy'}); }), 'skin_asset_path');
  rejects(mutate(s => { s.assets.push({...s.assets[0], path: 'assets/copy.png'}); }), 'skin_asset_id');
  rejects(mutate(s => { s.background.asset = 'undeclared'; }), 'skin_asset_reference');
});

test('readable colors and two independent performer cues are mandatory', () => {
  assert.equal(contrastRatio('#000000', '#FFFFFF'), 21);
  assert.equal(contrastRatio('#ffffff', '#ffffff'), 1);
  for (const value of ['red', '#123', '#11111100', 'rgb(1,2,3)', 'url(x)', '#FFFFFF\n', '#FFFFFF\r', '#FFFFFF\u2028']) rejects(mutate(s => { s.palette.foreground = value; }), 'skin_color');
  for (const change of [s => { s.palette.foreground = s.palette.surface; }, s => { s.palette.muted = s.palette.background; },
    s => { s.notes.human.fill = s.palette.surface; }, s => { s.notes.machine.foreground = s.notes.machine.fill; },
    s => { s.notes.human.outline = s.notes.human.fill; }, s => { s.keyboard.white_foreground = s.keyboard.white; },
    s => { s.keyboard.pressed = s.keyboard.white; }, s => { s.keyboard.border = s.keyboard.black; },
    s => { s.notation.foreground = '#777777'; },
    s => { s.notation.background = '#FFFFFF'; s.notation.foreground = '#111111'; }]) rejects(mutate(change), 'skin_contrast');
  rejects(mutate(s => { s.notes.machine.marker = s.notes.human.marker; }), 'skin_role_distinction');
  rejects(mutate(s => { s.notes.machine.fill = s.notes.human.fill.toLowerCase(); }), 'skin_role_distinction');
});

test('notation overlays the full falling lane without shortening it and judge line stays pinned', () => {
  const bands = skinLayoutBands(sample.layout);
  assert.equal(bands.notation.y, 0); assert.equal(bands.judgment.y, 0);
  assert.equal(bands.judgment.height, 1 - sample.layout.piano_height);
  assert.ok(bands.judgment.height >= .7); assert.equal(bands.judgment_line_y, bands.piano.y);
  assert.equal(bands.piano.y + bands.piano.height, 1);
  const tallerNotation = skinLayoutBands({...sample.layout, notation_height: .35});
  assert.deepEqual(tallerNotation.judgment, bands.judgment);
  assert.deepEqual(tallerNotation.piano, bands.piano);
  assert.ok(tallerNotation.notation.height < tallerNotation.judgment.height);
  for (const field of ['notation_height', 'piano_height', 'side_margin', 'note_width_scale']) {
    for (const value of [-1, 2, null, '0.2']) rejects(mutate(s => { s.layout[field] = value; }), 'skin_bounds');
  }
  rejects(mutate(s => { s.background.opacity = .26; }), 'skin_bounds');
  assert.throws(() => skinLayoutBands({...sample.layout, piano_height: Infinity}), {code: 'skin_bounds'});
});

test('declared dimensions, byte counts, resource count and aggregate pixel budgets are bounded', () => {
  for (const [field, value] of [['bytes', SKIN_LIMITS.asset_bytes + 1], ['width', 2049], ['height', 0], ['width', 1.5]]) rejects(mutate(s => { s.assets[0][field] = value; }), 'skin_bounds');
  rejects(mutate(s => { s.assets = Array.from({length: 5}, (_, i) => ({...s.assets[0], id: `item-${i}`, path: `assets/item-${i}.png`})); }), 'skin_bounds');
  rejects(mutate(s => { s.assets = Array.from({length: 3}, (_, i) => ({...s.assets[0], id: i ? `item-${i}` : 'woven', path: `assets/item-${i}.png`, width: 2048, height: 2048})); }), 'skin_bounds');
});

function crc(bytes) { let value = 0xffffffff; for (const byte of bytes) { value ^= byte; for (let n = 0; n < 8; n++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0); } return (value ^ 0xffffffff) >>> 0; }
function chunk(name, bytes) { const type = Buffer.from(name), out = Buffer.alloc(bytes.length + 12); out.writeUInt32BE(bytes.length); type.copy(out, 4); bytes.copy(out, 8); out.writeUInt32BE(crc(out.subarray(4, -4)), out.length - 4); return out; }
function png({width = 1, height = 1, raw = Buffer.from([0, 11, 18, 32, 255]), extra = [], depth = 8, compression = 0} = {}) {
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = depth; header[9] = 6; header[10] = compression;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), ...extra, chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
async function checkPng(bytes, dimensions = {width: 1, height: 1}) {
  const skin = mutate(s => { Object.assign(s.assets[0], dimensions, {bytes: bytes.length}); });
  return validateSkinResources(skin, resources(bytes));
}

test('real PNG validation checks byte signatures, CRC, static subset and manifest dimensions', async () => {
  assert.equal((await checkPng(png())).assets.size, 1);
  const badCrc = Buffer.from(originalPng); badCrc[badCrc.length - 1] ^= 1;
  for (const bytes of [badCrc, originalPng.subarray(0, -1), Buffer.concat([originalPng, Buffer.from([0])])]) {
    const skin = mutate(s => { s.assets[0].bytes = bytes.length; });
    assert.equal((await validateSkinResources(skin, resources(bytes))).diagnostics[0].code, 'skin_png');
  }
  for (const bytes of [png({extra: [chunk('acTL', Buffer.alloc(8))]}), png({extra: [chunk('tEXt', Buffer.from('external-url'))]}), png({depth: 16}), png({compression: 1}), png({width: 2})]) {
    assert.equal((await checkPng(bytes)).diagnostics[0].code, 'skin_png');
  }
  assert.throws(() => inspectSkinPng(originalPng, {...sample.assets[0], bytes: 1}), {code: 'skin_asset_bytes'});
  assert.throws(() => inspectSkinPng(originalPng, {...sample.assets[0], width: 100000}), {code: 'skin_bounds'});
});

test('bounded decompression rejects pixel bombs, short data and invalid filters', async () => {
  for (const raw of [Buffer.alloc(2_000_000), Buffer.from([0, 1]), Buffer.from([5, 1, 2, 3, 4])]) {
    const result = await checkPng(png({raw}));
    assert.equal(result.assets.size, 0); assert.equal(result.diagnostics[0].code, 'skin_png_pixels');
  }
  const raw = Buffer.alloc((64 * 4 + 1) * 64); for (let i = 0; i < raw.length; i += 257) raw[i] = (i / 257) % 5;
  assert.equal((await checkPng(png({width: 64, height: 64, raw}), {width: 64, height: 64})).assets.size, 1);
});

test('missing, corrupt and unsupported optional resources produce explicit solid/default fallbacks', async () => {
  const missing = await resolveSkin(sampleText, {features: SKIN_FEATURES});
  assert.equal(missing.skin.id, sample.id); assert.equal(missing.background_bytes, null);
  assert.equal(missing.skin.background.asset, null); assert.equal(missing.diagnostics[0].code, 'skin_asset_missing');
  const complete = await resolveSkin(sampleText, {features: SKIN_FEATURES, resources: resources()});
  assert.deepEqual(complete.diagnostics, []); assert.equal(complete.background_bytes.length, originalPng.length);
  const limited = await resolveSkin(sampleText, {features: [], resources: resources()});
  assert.deepEqual(limited.skin.layout, DEFAULT_SKIN.layout); assert.equal(limited.background_bytes, null);
  assert.deepEqual(limited.legend.map(item => item.marker), ['circle', 'diamond']);
  assert.deepEqual(limited.legend.map(item => item.label_key), ['performer.human', 'performer.machine']);
  assert.equal(limited.diagnostics.filter(item => item.code === 'skin_feature_unsupported').length, 4);
  assert.equal(limited.skin.notes.machine.pattern, 'solid');
  assert.notEqual(limited.skin.notes.human.fill, limited.skin.notes.machine.fill);
  const invalid = await resolveSkin('{"version":999}');
  assert.equal(invalid.skin.id, DEFAULT_SKIN.id); assert.equal(invalid.diagnostics[0].fallback, 'builtin_default');
  assert.equal(resetSkin(), DEFAULT_SKIN); assert.ok(Object.isFrozen(resetSkin()));
});

test('untrusted resource maps fail closed before reading or rendering undeclared and oversized bytes', async () => {
  await assert.rejects(validateSkinResources(sample, new Map([['../secret.png', originalPng]])), {code: 'skin_asset_path'});
  await assert.rejects(validateSkinResources(sample, new Map([['assets/extra.png', originalPng]])), {code: 'skin_asset_path'});
  await assert.rejects(validateSkinResources(sample, resources(new Uint8Array(SKIN_LIMITS.asset_bytes + 1))), {code: 'skin_asset_bytes'});
  await assert.rejects(resolveSkin(sampleText, {features: ['custom_shader']}), {code: 'skin_feature'});
});

test('format resolution never mutates authored manifest or input resource bytes', async () => {
  const before = structuredClone(sample), bytes = Buffer.from(originalPng);
  await resolveSkin(encode(sample), {features: SKIN_FEATURES, resources: resources()});
  assert.deepEqual(sample, before); assert.deepEqual(originalPng, bytes);
});

test('resource validation owns all manifest and byte snapshots before asynchronous decompression', async () => {
  const skin = mutate(s => { s.assets.push({...s.assets[0], id: 'copy', path: 'assets/copy.png'}); });
  const later = Buffer.from(originalPng);
  const input = new Map([[skin.assets[0].path, originalPng], ['assets/copy.png', later]]);
  const pending = validateSkinResources(skin, input);
  // Simulate a UI replacing imported data while its first resource is decoding.
  skin.assets[1].path = '../outside.png'; skin.assets[1].width = 100000;
  input.set('assets/copy.png', new Uint8Array(SKIN_LIMITS.asset_bytes + 1)); later.fill(0);
  const result = await pending;
  assert.deepEqual(result.diagnostics, []); assert.equal(result.assets.size, 2);
  assert.deepEqual(result.assets.get('copy'), new Uint8Array(originalPng));
});

test('missing bounded decoder reports a resource fallback without returning image bytes', async () => {
  const decoder = globalThis.DecompressionStream;
  try {
    globalThis.DecompressionStream = undefined;
    const result = await validateSkinResources(sample, resources());
    assert.equal(result.assets.size, 0); assert.equal(result.diagnostics[0].code, 'skin_decoder_unavailable');
  } finally { globalThis.DecompressionStream = decoder; }
});

test('directory validator rejects symlinks, escaping resources and bounded-file violations', async t => {
  const root = await mkdtemp(join(tmpdir(), 'wmc-skin-test-')); t.after(() => rm(root, {recursive: true, force: true}));
  await mkdir(join(root, 'assets')); await writeFile(join(root, 'skin.json'), sampleText);
  assert.equal((await validateSkinDirectory(root)).diagnostics[0].code, 'skin_asset_missing');
  const outside = join(root, 'outside.png'); await writeFile(outside, originalPng);
  await symlink(outside, join(root, 'assets/woven.png'));
  await assert.rejects(validateSkinDirectory(root), {code: 'skin_asset_path'});
  await rm(join(root, 'assets/woven.png')); await rm(join(root, 'assets'), {recursive: true});
  await symlink(root, join(root, 'assets'));
  await assert.rejects(validateSkinDirectory(root), {code: 'skin_asset_path'});
  await rm(join(root, 'assets')); await mkdir(join(root, 'assets'));
  await writeFile(join(root, 'assets/woven.png'), Buffer.alloc(SKIN_LIMITS.asset_bytes + 1));
  await assert.rejects(validateSkinDirectory(root), {code: 'skin_bounds'});
});

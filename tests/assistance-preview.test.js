import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {deflateSync} from 'node:zlib';
import {ASSISTANCE_PREVIEW_CASES, verifyUiPreviewAssistance} from '../scripts/ui-preview-assistance.mjs';

// Synthetic verifier inputs only: no audio, screenshot capture or browser pass
// is fabricated, claimed or published by these pure contract tests.
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const passing = ASSISTANCE_PREVIEW_CASES.map((row, index) => `ok ${index + 1} - ${row.name}`).join('\n');
function contractPng() {
  const chunk = (type, data) => {
    const bytes = Buffer.alloc(data.length + 12); bytes.writeUInt32BE(data.length); bytes.write(type, 4); data.copy(bytes, 8);
    let crc = 0xffffffff; for (const value of bytes.subarray(4, -4)) { crc ^= value; for (let bit = 0; bit < 8; bit++) crc = crc >>> 1 ^ ((crc & 1) ? 0xedb88320 : 0); }
    bytes.writeUInt32BE((crc ^ 0xffffffff) >>> 0, bytes.length - 4); return bytes;
  };
  const header = Buffer.alloc(13); header.writeUInt32BE(2); header.writeUInt32BE(2, 4); header[8] = 8; header[9] = 2;
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header), chunk('IDAT', deflateSync(Buffer.alloc(14))), chunk('IEND', Buffer.alloc(0))]);
}
function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'wmh-assistance-verifier-')); t.after(() => rmSync(directory, {recursive: true, force: true}));
  const write = (name, bytes) => writeFileSync(join(directory, name), bytes);
  write('assistance.tap', passing);
  for (const row of ASSISTANCE_PREVIEW_CASES) {
    write(row.report, JSON.stringify({version: 1, case: row.caseId, label: 'final', scope: row.scope, pageErrors: []}));
    write(row.screenshot, contractPng());
  }
  return {directory, write, verify: () => verifyUiPreviewAssistance(directory)};
}

test('assistance preview requires all five exact non-skipped passes from its separate TAP file', t => {
  const f = fixture(t);
  for (const row of ASSISTANCE_PREVIEW_CASES) for (const replacement of [row.name + ' extra', row.name + ' # SKIP filtered', row.name + ' # TODO pending', 'different case']) {
    f.write('assistance.tap', passing.replace(row.name, replacement)); assert.throws(f.verify, /passing assistance case/);
  }
  for (const text of [passing.replace(/^ok /, 'not ok '), passing + '\nok 6 - ' + ASSISTANCE_PREVIEW_CASES[0].name,
    passing.split('\n').slice(1).join('\n'), passing + '\nBail out! interrupted']) {
    f.write('assistance.tap', text); assert.throws(f.verify);
  }
  unlinkSync(join(f.directory, 'assistance.tap')); f.write('tests.tap', passing); assert.throws(f.verify, /ENOENT/);
});

test('assistance preview hashes the separate TAP and every deterministic final JSON and PNG pair', t => {
  const f = fixture(t), files = f.verify(); assert.equal(files.length, 11);
  assert.deepEqual(files.map(row => row.name), ['assistance.tap', ...ASSISTANCE_PREVIEW_CASES.flatMap(row => [row.report, row.screenshot])]);
  for (const file of files) { const bytes = readFileSync(join(f.directory, file.name)); assert.equal(file.bytes, bytes.length); assert.equal(file.sha256, sha(bytes)); }
  assert.ok(files.filter(file => file.name.endsWith('.png')).every(file => file.width === 2 && file.height === 2));
  assert.match(ASSISTANCE_PREVIEW_CASES.at(-1).scope, /fixture replay.*not desktop native acceptance/);
});

test('assistance preview rejects wrong checkpoint identity, version, phase, scope and application errors', t => {
  const f = fixture(t);
  for (const row of ASSISTANCE_PREVIEW_CASES) {
    const source = readFileSync(join(f.directory, row.report));
    for (const mutate of [value => { value.version = 2; }, value => { value.case = 'another-source'; }, value => { value.label = 'checked'; },
      value => { delete value.pageErrors; }, value => { value.pageErrors = ['uncaught failure']; }, value => { value.scope = 'native acceptance'; }]) {
      const value = JSON.parse(source); mutate(value); f.write(row.report, JSON.stringify(value)); assert.throws(f.verify);
    }
    f.write(row.report, source);
  }
});

test('assistance preview rejects absent, unreadable JSON, oversized and non-PNG final evidence', t => {
  const f = fixture(t), row = ASSISTANCE_PREVIEW_CASES[0];
  for (const [name, invalid] of [['assistance.tap', [Buffer.alloc(1024 * 1024 + 1), Buffer.from([0xff])]],
    [row.report, [Buffer.alloc(4 * 1024 * 1024 + 1), Buffer.from('{broken'), Buffer.from([0xff])]],
    [row.screenshot, [Buffer.alloc(8 * 1024 * 1024 + 1), Buffer.from('not PNG'), contractPng().subarray(0, 33), Buffer.concat([contractPng(), Buffer.from('trailing')])]]]) {
    const original = readFileSync(join(f.directory, name)); unlinkSync(join(f.directory, name)); assert.throws(f.verify);
    for (const bytes of invalid) { f.write(name, bytes); assert.throws(f.verify); }
    f.write(name, original);
  }
  const oversized = contractPng(); oversized.writeUInt32BE(0xffffffff, 16); f.write(row.screenshot, oversized); assert.throws(f.verify, /pixel budget/);
});

test('assistance preview refuses symlinked evidence files and directories', {skip: process.platform === 'win32'}, t => {
  const f = fixture(t), row = ASSISTANCE_PREVIEW_CASES[0];
  for (const name of ['assistance.tap', row.report, row.screenshot]) {
    const path = join(f.directory, name), original = readFileSync(path), target = join(f.directory, `original-${name}`);
    writeFileSync(target, original); unlinkSync(path); symlinkSync(target, path); assert.throws(f.verify, /ordinary evidence file/);
    unlinkSync(path); writeFileSync(path, original);
  }
  const link = `${f.directory}-link`; symlinkSync(f.directory, link); t.after(() => unlinkSync(link));
  assert.throws(() => verifyUiPreviewAssistance(link), /ordinary assistance evidence directory/);
});

test('assistance browser producer and mandatory preview verifier share all five final identities', () => {
  const browser = readFileSync(new URL('./assistance-app-browser.test.js', import.meta.url), 'utf8');
  for (const row of ASSISTANCE_PREVIEW_CASES) assert.ok(browser.includes(`test('${row.name}'`), row.name);
  assert.ok(browser.includes("await checkpoint('final')")); assert.ok(browser.includes('case: caseName, label, scope'));
  const verifier = readFileSync(new URL('../scripts/verify-ui-preview.mjs', import.meta.url), 'utf8');
  assert.ok(verifier.includes('files.push(...verifyUiPreviewAssistance(directory))'));
  assert.ok(verifier.includes('names.push(...ASSISTANCE_PREVIEW_CASES.map(row=>row.name))'));
});

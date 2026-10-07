import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {lstatSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import {inflateSync} from 'node:zlib';

export const ASSISTANCE_PREVIEW_CASES = Object.freeze([
  'real Rust Mod keeps Original unchanged and applies same-part human scoring with machine audio',
  'real Rust delayed Check and Cancel cannot overwrite a newer numeric assignment',
  'saved assistance recipe waits for a fresh Rust rebuild after browser reload',
  'cross-scope exact unison explicitly blocks empty human scoring and retains complete notation',
  'Rust Basic and VSQ fixture replay retains real worklet gates and explicit empty-scope ownership',
  'explicit Off survives a checked Original response-limit fault and preserves the pinned take',
].map((name, index) => {
  const caseId = name.replace(/[^a-z0-9]+/gi, '-').slice(0, 100);
  const base = `worldmusichub-live-assistance-${caseId}-final`;
  return Object.freeze({name, caseId, report: `${base}.json`, screenshot: `${base}.png`,
    scope: index === 5 ? 'Actual Rust application with endpoint fault injection on a tiny original exercise; not large/private-song GUI acceptance'
      : index === 4 ? 'Rust fixture replay in Chromium AudioWorklets; not desktop native acceptance'
      : 'Actual Rust application in Chromium; not desktop package acceptance'});
}));

// Retained Chromium bytes only. Bounded decompression rejects header-only,
// truncated and oversized PNGs; this verifier does not manufacture pixels.
function pngSize(bytes) {
  assert.ok(bytes.length >= 45 && bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')), 'Assistance screenshot must be PNG');
  assert.equal(bytes.readUInt32BE(8), 13); assert.equal(bytes.toString('ascii', 12, 16), 'IHDR');
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20), channels = bytes[25] === 2 ? 3 : bytes[25] === 6 ? 4 : 0;
  assert.ok(width > 0 && height > 0 && width <= 4096 && height <= 4096 && width * height <= 8 * 1024 * 1024, 'Assistance screenshot exceeds the finite pixel budget');
  assert.equal(bytes[24], 8); assert.ok(channels); for (const offset of [26, 27, 28]) assert.equal(bytes[offset], 0);
  const chunks = []; let offset = 8, ended = false;
  while (offset < bytes.length) {
    assert.ok(offset + 12 <= bytes.length); const length = bytes.readUInt32BE(offset), type = bytes.toString('ascii', offset + 4, offset + 8);
    assert.ok(length <= bytes.length - offset - 12);
    if (type === 'IDAT') chunks.push(bytes.subarray(offset + 8, offset + 8 + length));
    offset += length + 12;
    if (type === 'IEND') { assert.equal(length, 0); ended = true; break; }
  }
  assert.ok(ended && chunks.length); assert.equal(offset, bytes.length);
  const stride = width * channels + 1, raw = inflateSync(Buffer.concat(chunks), {maxOutputLength: stride * height});
  assert.equal(raw.length, stride * height); for (let y = 0; y < height; y++) assert.ok(raw[y * stride] <= 4);
  return {width, height};
}

export function verifyUiPreviewAssistance(directory) {
  const root = lstatSync(directory); assert.ok(root.isDirectory() && !root.isSymbolicLink(), 'Expected ordinary assistance evidence directory');
  const read = (name, limit) => {
    const path = join(directory, name), stat = lstatSync(path);
    assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.size > 0 && stat.size <= limit, `${name}: expected bounded ordinary evidence file`);
    const bytes = readFileSync(path); assert.equal(bytes.length, stat.size); return bytes;
  };
  const decode = bytes => new TextDecoder('utf-8', {fatal: true}).decode(bytes);
  // Read the separate mandatory suite, never substitute the broad UI TAP.
  const tapBytes = read('assistance.tap', 1024 * 1024), tap = decode(tapBytes);
  const rows = tap.split(/\r?\n/).filter(line => /^(?:not )?ok \d+ - /.test(line));
  assert.equal(rows.length, ASSISTANCE_PREVIEW_CASES.length, 'Expected exactly six assistance TAP cases');
  assert.ok(!/^Bail out!/im.test(tap), 'Assistance TAP bailed out');
  for (const {name} of ASSISTANCE_PREVIEW_CASES) {
    const matching = rows.filter(line => line.replace(/^(?:not )?ok \d+ - /, '').split(/\s+#/)[0] === name);
    assert.ok(matching.length === 1 && /^ok \d+ - /.test(matching[0]) && !/\s+#\s*(?:SKIP|TODO)\b/i.test(matching[0]), `Missing executed passing assistance case: ${name}`);
  }
  const record = (name, bytes) => ({name, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex')});
  const files = [record('assistance.tap', tapBytes)];
  for (const row of ASSISTANCE_PREVIEW_CASES) {
    const json = read(row.report, 4 * 1024 * 1024), value = JSON.parse(decode(json));
    assert.equal(value.version, 1, `${row.report}: checkpoint version`);
    assert.equal(value.case, row.caseId, `${row.report}: checkpoint case`);
    assert.equal(value.label, 'final', `${row.report}: checkpoint must be final`);
    assert.equal(value.scope, row.scope, `${row.report}: browser/native scope must be explicit`);
    assert.deepEqual(value.pageErrors, [], `${row.report}: application page errors`);
    const png = read(row.screenshot, 8 * 1024 * 1024);
    files.push(record(row.report, json), {...record(row.screenshot, png), ...pngSize(png)});
  }
  return files;
}

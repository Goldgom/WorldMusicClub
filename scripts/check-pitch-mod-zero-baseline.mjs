// Finite byte-level compatibility proof using the real socket-free Rust dispatcher.
// Capture is external to the repository; it never updates checked-in goldens.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {startVsqNativeDriver} from '../tests/vsq-native-driver-fixtures.js';
import {assistanceNativeFixtures, progressionNativeFixtures} from './native-assistance-fixtures.mjs';

const [mode, binary, destination] = process.argv.slice(2);
assert.ok(['capture', 'verify'].includes(mode));
assert.ok(binary && destination, 'Pass capture|verify, an explicit Rust stdio binary, and an external baseline file');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const readFixture = async name => JSON.parse(await readFile(new URL(`../tests/fixtures/${name}.json`, import.meta.url)));
const zero = {format: 'wmc-pitch-mod', version: 1, semitones: 0};
const directory = await mkdtemp(join(tmpdir(), 'wmc-pitch-zero-'));
const driver = startVsqNativeDriver({binary: resolve(binary), directory: join(directory, 'Scores'), requestTimeoutMs: 30000});
const rows = [];
async function call(path, input, method = 'POST') {
  const response = await driver.fetcher(path, {method, headers: {'content-type': 'application/json'}, ...(input === undefined ? {} : {body: JSON.stringify(input)})});
  const bytes = await response.bytes();
  assert.equal(response.status, 200, `${path}: ${bytes}`);
  return {status: response.status, content_type: response.contentType, body_base64: bytes.toString('base64')};
}
const parsed = row => JSON.parse(Buffer.from(row.body_base64, 'base64'));
async function check(label, path, input, expected, zeroCapable = true) {
  const response = await call(path, input);
  if (expected !== undefined) assert.deepEqual(parsed(response), expected, `${label}: accepted fixture`);
  assert.deepEqual(await call(path, input), response, `${label}: deterministic full bytes`);
  if (mode === 'verify' && zeroCapable) {
    assert.deepEqual(await call(path, {...input, pitch_mod: zero}), response, `${label}: explicit zero full bytes`);
  }
  rows.push({label, path, request: input, response});
  return parsed(response);
}
async function snapshot(root, prefix = '') {
  const result = {};
  for (const entry of (await readdir(root, {withFileTypes: true})).sort((a,b) => a.name.localeCompare(b.name))) {
    const relative = join(prefix, entry.name);
    if (entry.isDirectory()) Object.assign(result, await snapshot(join(root, entry.name), relative));
    else result[relative] = hash(await readFile(join(root, entry.name)));
  }
  return result;
}
try {
  const diagnostics = parsed(await call('/api/diagnostics/build', undefined, 'GET'));
  if (mode === 'capture') {
    assert.equal(diagnostics.compiled.source_sha, 'd80918787a4afca8570cf4c36dff5c8f7b98e968', 'Capture must use accepted620 source');
    assert.equal(diagnostics.compiled.source_status, 'clean', 'Capture must use a clean accepted620 build');
  }
  const original = assistanceNativeFixtures();
  const imported = await driver.fetcher('/api/library/import/commit', {method: 'POST', headers: {'content-type': 'application/zip', 'x-wmh-filename': 'original-assistance.zip'}, body: original.bytes});
  assert.equal(imported.status, 200);
  assert.equal((await imported.json()).summary.saved, 2);
  const before = await snapshot(directory);
  const canonical = await readFixture('assistance-canonical');
  const score = canonical.compilation.score;
  const selection = canonical.original.checked.plan.selection;
  await check('canonical.compile', '/api/compile', score, canonical.compilation, false);
  await check('canonical.audio', '/api/canonical-audio-profile', score, canonical.audio_profile, false);
  for (const kind of ['original', 'automatic', 'explicit']) {
    const expected = canonical[kind], plan = expected.checked.plan;
    const suffix = {original:'original', automatic:'generate', explicit:'create'}[kind];
    const input = {score, selection, ...(kind === 'automatic' ? {settings:plan.settings} : kind === 'explicit' ? {human_source_ids:plan.human_source_ids} : {})};
    await check(`canonical.${kind}`, `/api/practice-assistance/${suffix}`, input, expected);
    await check(`canonical.${kind}.validate`, '/api/practice-assistance/validate', {score, plan}, expected);
  }
  const presets = await readFixture('assistance-presets-canonical');
  for (const [name, preset] of Object.entries(presets.presets)) {
    await check(`canonical.preset.${name}`, '/api/practice-assistance/generate', {score, selection, settings:preset.settings}, preset.response);
  }
  const progressive = await readFixture('progression-canonical');
  for (const [layer, value] of Object.entries(progressive.layers)) {
    await check(`canonical.progression.${layer}`, '/api/practice-progression/generate', {score: progressive.score, selection: progressive.selection, layer}, value.response);
    await check(`canonical.progression.${layer}.validate`, '/api/practice-progression/validate', {score: progressive.score, plan:value.response.checked.plan}, value.response);
  }
  for (const kind of ['basic', 'vsq']) {
    const fixture = original[kind], source = fixture.source;
    const selection = fixture.original.checked.plan.selection;
    for (const operation of ['original', 'automatic', ...(kind === 'basic' ? ['explicit'] : [])]) {
      const expected = fixture[operation], plan = expected.checked.plan;
      const suffix = {original:'original', automatic:'generate', explicit:'create'}[operation];
      const input = {source, selection, ...(operation === 'automatic' ? {settings:plan.settings} : operation === 'explicit' ? {human_source_ids:plan.human_source_ids} : {})};
      await check(`${kind}.${operation}`, `/api/library/assistance/${suffix}`, input, expected);
      await check(`${kind}.${operation}.validate`, '/api/library/assistance/validate', {source, plan}, expected);
    }
    const progression = progressionNativeFixtures()[kind];
    for (const [layer, value] of Object.entries(progression.layers)) {
      await check(`${kind}.progression.${layer}`, '/api/library/progression/generate', {source, selection:progression.selection, layer}, value.response);
      await check(`${kind}.progression.${layer}.validate`, '/api/library/progression/validate', {source, plan:value.response.checked.plan}, value.response);
    }
    if (kind === 'vsq') await check('vsq.runtime', '/api/library/runtime', {key:source.key, profile:source.profile, choice:source.choice}, fixture.selected_runtime, false);
  }
  assert.deepEqual(await snapshot(directory), before, 'No original, metadata, backup or library file changed');
  const report = {version: 1, source: diagnostics.compiled, driver_sha256: hash(await readFile(binary)), full_output_sha256: hash(JSON.stringify(rows)), rows};
  if (mode === 'capture') await writeFile(destination, JSON.stringify(report, null, 2)+'\n', {flag:'wx'});
  else {
    const baseline = JSON.parse(await readFile(destination));
    assert.equal(baseline.full_output_sha256, report.full_output_sha256, 'Every retained request and complete Rust response must remain byte exact');
    assert.deepEqual(report.rows, baseline.rows);
  }
  console.log(JSON.stringify({ok:true, mode, responses:rows.length, full_output_sha256:report.full_output_sha256, source:report.source, driver_sha256:report.driver_sha256, claims:{real_rust_stdio:true, browser:false, native_window:false, physical_audio:false, private_music:false}}));
} finally {
  await driver.close();
  await rm(directory, {recursive:true, force:true});
}

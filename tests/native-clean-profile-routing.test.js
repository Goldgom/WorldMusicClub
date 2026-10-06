// Original public producer fixtures only. A Rust stdio driver creates no
// listener, browser, application window or physical-audio acceptance claim.
// Run with WMH_NATIVE_IMPORT_DRIVER=<exact-source native_import_driver> node
// --test tests/native-clean-profile-routing.test.js
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {storedZip} from './native-import-driver-fixtures.js';
import {startVsqNativeDriver} from './vsq-native-driver-fixtures.js';

const binary = process.env.WMH_NATIVE_IMPORT_DRIVER;
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const fixture = async name => JSON.parse(await readFile(new URL(`./fixtures/song-authoring/${name}-request.json`, import.meta.url), 'utf8'));
const basicProfile = 'wmh-basic-keys-midi1-v1', vsqProfile = 'wmh-vsq-clean-v1';

function replaceOne(text, before, after) {
  assert.equal(text.split(before).length, 2, `Mutation must have one exact target: ${before}`);
  return text.replace(before, after);
}

// Do not parse and reserialize the complete VSQ score: its original authoring
// tokens include integers that JavaScript numbers cannot preserve exactly.
function mutatedZip(original, change) {
  const score = change(original.score_json), metadata = JSON.parse(original.metadata_json);
  metadata.score.bytes = Buffer.byteLength(score);
  metadata.score.sha256 = digest(score);
  return storedZip([['metadata.json', JSON.stringify(metadata)], ['score.json', score]]);
}

async function snapshot(directory) {
  const files = {};
  async function walk(relative = '') {
    for (const entry of await readdir(join(directory, relative), {withFileTypes: true})) {
      const path = join(relative, entry.name);
      assert.equal(entry.isSymbolicLink(), false);
      if (entry.isDirectory()) await walk(path);
      else files[path] = digest(await readFile(join(directory, path)));
    }
  }
  await walk();
  return files;
}

test('producer profiles survive native preflight, save and fresh-process strict reads', {
  skip: !binary && 'Set WMH_NATIVE_IMPORT_DRIVER to run the real Rust stdio regression',
}, async t => {
  const root = await mkdtemp(join(tmpdir(), 'wmh-original-profile-routing-'));
  const directory = join(root, 'Scores');
  let driver;
  const launch = () => { driver = startVsqNativeDriver({binary, directory}); };
  const close = async () => { await driver?.close(); driver = null; };
  const json = async (path, body, expectedStatus = 200) => {
    const response = await driver.fetcher(path, body === undefined ? {} : {
      method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(body),
    });
    const result = await response.json();
    assert.equal(response.status, expectedStatus, JSON.stringify(result));
    return result;
  };
  const upload = async (mode, bytes) => {
    const response = await driver.fetcher(`/api/library/import/${mode}`, {
      method: 'POST', headers: {'content-type': 'application/zip',
        'x-wmh-filename': 'original-profile-regression.zip', 'x-wmh-conflict': 'keep-both'}, body: bytes,
    });
    const result = await response.json();
    assert.equal(response.status, 200, JSON.stringify(result));
    return result;
  };
  const noWrite = async action => {
    const before = await snapshot(directory), result = await action();
    assert.deepEqual(await snapshot(directory), before, 'Read-only or rejected operation changed persisted bytes');
    return result;
  };
  const noAdmittedChanges = async action => {
    const admitted = files => Object.fromEntries(Object.entries(files).filter(([path]) => /^clean-(songs|backups)[/\\]/.test(path)));
    const before = admitted(await snapshot(directory)), listed = await json('/api/library/list');
    const result = await action();
    assert.deepEqual(admitted(await snapshot(directory)), before, 'Rejected/duplicate import changed an admitted package');
    assert.deepEqual(await json('/api/library/list'), listed);
    return result;
  };
  const expected = new Map();
  const checkRuntime = async (name, key, opened) => {
    const runtime = opened.clean_package.runtime;
    if (name === 'vsq') {
      assert.equal(runtime, null);
      const choice = await noWrite(() => json('/api/library/runtime', {
        key, profile: vsqProfile, choice: 'base_notes_instrumental',
      }));
      assert.equal(choice.runtime.profile, 'wmh-vsq-base-note-practice-v1');
      assert.equal(choice.runtime.notes.length, 2);
      assert.equal((await noWrite(() => json('/api/library/runtime', {
        key, profile: vsqProfile, choice: 'full_vocal',
      }, 422))).code, 'library_vocal_unsupported');
    } else {
      assert.ok(runtime && typeof runtime === 'object');
      if (name === 'basic') {
        assert.equal(runtime.compilation.timeline.notes.length, 3);
        assert.equal(runtime.reference_audio, 'basic_synthesized');
      } else if (name === 'canonical') {
        assert.equal(runtime.notes.length, 3);
      } else {
        assert.ok(runtime.events.length > 0);
      }
      // A caller cannot force a Basic/canonical/performance package through
      // the VSQ decoder merely by claiming the VSQ profile in its request.
      assert.equal((await noWrite(() => json('/api/library/runtime', {
        key, profile: vsqProfile, choice: 'base_notes_instrumental',
      }, 422))).code, 'library_runtime_profile');
    }
  };
  const verifyLibrary = async () => {
    const listed = await json('/api/library/list');
    assert.deepEqual(listed.issues, []);
    assert.deepEqual(listed.entries.map(e => e.key).sort(), [...expected.keys()].sort());
    for (const [key, row] of expected) {
      const entry = listed.entries.find(e => e.key === key);
      assert.deepEqual(entry.clean_package.capabilities, row.capabilities);
      assert.equal(entry.clean_package.profile, row.profile);
      const opened = await noWrite(() => json('/api/library/load', {key}));
      assert.equal(opened.clean_package.score_json, row.package.score_json);
      assert.equal(opened.clean_package.metadata_json, row.package.metadata_json);
      assert.deepEqual(opened.clean_package.capabilities, row.capabilities);
      assert.equal(opened.clean_package.profile, row.profile);
      await checkRuntime(row.name, key, opened);
    }
  };
  try {
    launch();
    assert.equal((await json('/api/library/list')).entries.length, 0);
    const strict = await fixture('strict'), vsq = await fixture('vsq'), events = await fixture('event-only');
    const cases = [
      ['basic', {...strict, intent: 'basic_keys'}, basicProfile, 'basic_key_candidate'],
      ['vsq', vsq, vsqProfile, 'vsq_authoring_candidate'],
      ['canonical', strict, undefined, 'strict_notation_candidate'],
      ['performance', events, 'wmh-performance-midi1-v1', 'event_only_reference_candidate'],
    ];
    for (const [name, request, profile, state] of cases) {
      await t.test(`${name}: original producer to preflight/save/load/runtime`, async () => {
        const draft = await noWrite(() => json('/api/clean-song/draft', request));
        assert.equal(draft.state, state);
        const score = JSON.parse(draft.package.score_json);
        if (name === 'basic') {
          assert.equal(score.profile, undefined);
          assert.equal(score.performance.profile, basicProfile);
          assert.equal(score.capabilities.acoustic_pitch, 'not_inferred_from_key_numbers');
          assert.equal(score.capabilities.whole_vocal_rendering, undefined);
        } else if (name === 'vsq') {
          assert.equal(score.profile, vsqProfile);
          assert.equal(score.performance, undefined);
          assert.deepEqual(score.capabilities, {
            whole_vocal_rendering: 'blocked', instrumental_practice: 'requires_explicit_base_note_choice',
          });
          assert.match(draft.package.score_json, /9007199254740993/);
        }
        const packed = await noWrite(() => json('/api/clean-song/draft/pack', {
          ...request, expected_draft_sha256: draft.draft_sha256,
        }));
        const bytes = Buffer.from(packed.zip_base64, 'base64');
        const preview = await noWrite(() => upload('preview', bytes));
        assert.equal(preview.summary.ready, 1, JSON.stringify(preview));
        assert.equal(preview.items[0].clean_package.profile, profile);
        assert.deepEqual(preview.items[0].clean_package.capabilities, score.capabilities);
        const saved = await upload('commit', bytes);
        assert.equal(saved.summary.saved, 1, JSON.stringify(saved));
        const key = saved.items[0].entry.key;
        expected.set(key, {name, profile, capabilities: score.capabilities, package: draft.package});
        await verifyLibrary();
        // Commits append an import report even for duplicates; every admitted
        // package and inventory entry must remain unchanged.
        assert.equal((await noAdmittedChanges(() => upload('commit', bytes))).summary.duplicate, 1);
      });
    }
    const priorPid = driver.pid;
    await close(); launch();
    assert.notEqual(driver.pid, priorPid);
    await t.test('fresh process lists, loads and derives all four original profiles', verifyLibrary);

    const byName = name => [...expected.values()].find(row => row.name === name).package;
    const rejects = [
      ['basic-unknown-capability', 'basic', s => replaceOne(s, '"capabilities":{', '"capabilities":{"unreviewed_capability":true,'), /unknown field `unreviewed_capability`/],
      ['basic-vsq-capability', 'basic', s => replaceOne(s, '"capabilities":{', '"capabilities":{"whole_vocal_rendering":"blocked",'), /unknown field `whole_vocal_rendering`/],
      ['basic-invalid-acoustic-claim', 'basic', s => replaceOne(s, '"acoustic_pitch":"not_inferred_from_key_numbers"', '"acoustic_pitch":"exact_acoustic_pitch"'), /projection or coverage/],
      ['basic-missing-acoustic-capability', 'basic', s => replaceOne(s, ',"acoustic_pitch":"not_inferred_from_key_numbers"', ''), /missing field `acoustic_pitch`/],
      ['basic-duplicate-acoustic-capability', 'basic', s => replaceOne(s, '"capabilities":{', '"capabilities":{"acoustic_pitch":"not_inferred_from_key_numbers",'), /duplicate field `acoustic_pitch`/],
      ['basic-root-vsq-profile', 'basic', s => s.replace('{', '{"profile":"wmh-vsq-clean-v1",'), /Unsupported complete-score version\/profile combination/],
      ['basic-unknown-performance-profile', 'basic', s => replaceOne(s, basicProfile, 'wmh-unreviewed-v1'), /Unsupported complete-score version\/profile combination/],
      ['vsq-basic-acoustic-capability', 'vsq', s => s.replace(/"capabilities"\s*:\s*\{/, '$&"acoustic_pitch":"not_inferred_from_key_numbers",'), /unknown field `acoustic_pitch`/],
      ['vsq-invalid-vocal-claim', 'vsq', s => replaceOne(s, '"whole_vocal_rendering": "blocked"', '"whole_vocal_rendering": "available"'), /unknown variant `available`/],
      ['vsq-basic-performance-profile', 'vsq', s => s.replace('{', '{"performance":{"profile":"wmh-basic-keys-midi1-v1"},'), /Unsupported complete-score version\/profile combination/],
      ['canonical-invented-capabilities', 'canonical', s => s.replace('{', '{"capabilities":{"acoustic_pitch":"not_inferred_from_key_numbers"},'), /unknown field `capabilities`/],
      ['canonical-basic-profile', 'canonical', s => replaceOne(s, 'wmh-semantic-midi1-v1', basicProfile), /unknown field|missing field/],
    ];
    for (const [name, source, change, reason] of rejects) {
      await t.test(`${name}: no clean admission; original archive retained`, async () => {
        const bytes = mutatedZip(byName(source), change);
        for (const mode of ['preview', 'commit']) {
          const response = await (mode === 'preview' ? noWrite : noAdmittedChanges)(() => upload(mode, bytes));
          assert.equal(response.summary.retained_nonplayable, 1, JSON.stringify(response));
          assert.equal(response.summary.ready, 0);
          assert.equal(response.summary.saved, 0);
          assert.equal(response.items[0].code, 'pack_source_only');
          assert.equal(response.items[0].playable, false);
          assert.equal(response.items[0].entry, undefined);
          assert.equal(response.items[0].clean_package, undefined);
          assert.match(response.items[0].message, reason);
          if (mode === 'commit') {
            assert.equal(response.source.retained, true);
            assert.deepEqual(await readFile(join(directory, 'imports', response.source.archive_key, 'source.bin')), bytes);
          }
        }
      });
    }

    // Cached capabilities remain data, but never authority: the native reader
    // compares them with the profile-selected decoder's exact package summary.
    const [basicKey] = [...expected].find(([, row]) => row.name === 'basic');
    const entryPath = join(directory, 'clean-songs', basicKey, 'entry.json');
    const originalEntry = await readFile(entryPath);
    for (const [name, mutate] of [
      ['unknown-summary-capability', entry => { entry.clean_package.capabilities.unreviewed_capability = true; }],
      ['wrong-summary-profile', entry => { entry.clean_package.profile = vsqProfile; }],
      ['vsq-capabilities-on-basic-summary', entry => { entry.clean_package.capabilities = {whole_vocal_rendering: 'blocked', instrumental_practice: 'requires_explicit_base_note_choice'}; }],
    ]) {
      await t.test(`${name}: fresh reader rejects cache/payload disagreement`, async () => {
        await close();
        const changed = JSON.parse(originalEntry); mutate(changed);
        await writeFile(entryPath, JSON.stringify(changed));
        launch();
        const listed = await noWrite(() => json('/api/library/list'));
        assert.equal(listed.entries.some(entry => entry.key === basicKey), false);
        assert.equal(listed.issues.length, 1);
        assert.equal((await noWrite(() => json('/api/library/load', {key: basicKey}, 422))).code, 'clean_package_invalid');
        await close(); await writeFile(entryPath, originalEntry); launch();
        await verifyLibrary();
      });
    }
    t.diagnostic(`Verified exact driver sha256 ${digest(await readFile(binary))}; original profile payload bytes unchanged`);
  } finally {
    await close();
    await rm(root, {recursive: true, force: true});
  }
});

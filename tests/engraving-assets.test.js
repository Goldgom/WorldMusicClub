import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp, readFile, writeFile, mkdir, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {prepareEngraving} from '../scripts/prepare-engraving.mjs';
import {ENGRAVING_BUNDLE_SHA256} from '../web/engraving.js';

test('asset preparation copies a hash-pinned bundle with all license and authors materials', async () => {
  const outputDirectory = await mkdtemp(path.join(tmpdir(), 'engraving-assets-'));
  try {
    const manifest = await prepareEngraving({outputDirectory});
    assert.equal(manifest.version, '2.1.3');
    assert.equal(manifest.bundleSha256, ENGRAVING_BUNDLE_SHA256);
    assert.equal(manifest.noticeComponents.length, 18);
    for (const [name, metadata] of Object.entries(manifest.files)) {
      const bytes = await readFile(path.join(outputDirectory, name));
      assert.equal(bytes.length, metadata.bytes);
      assert.equal(createHash('sha256').update(bytes).digest('hex'), metadata.sha256);
    }
    const notices = await readFile(path.join(outputDirectory, 'opensheetmusicdisplay.min.js.LICENSE.txt'), 'utf8');
    for (const expected of ['Copyright 2019 PhonicScore', 'Mohit Muthanna Cheppudira', 'Tomasz Ciborski', 'Jean-loup Gailly and Mark Adler', 'This notice may not be removed', 'Julian Gruber', 'WorldMusicClub elects the MIT option', 'No copyright is claimed on this font file.']) assert.ok(notices.includes(expected), expected);
    assert.ok(!manifest.noticeComponents.some(component => ['gl', 'canvas', 'node-gyp'].includes(component.name)));
    assert.ok(!notices.includes('GNU GENERAL PUBLIC LICENSE'));
    const rerun = await prepareEngraving({outputDirectory});
    assert.deepEqual(rerun, manifest);
  } finally { await rm(outputDirectory, {recursive: true, force: true}); }
});

test('asset preparation fails closed for unreviewed versions and altered bundles', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'engraving-tamper-'));
  try {
    await writeFile(path.join(directory, 'package.json'), JSON.stringify({name: 'opensheetmusicdisplay', version: '99.0.0', license: 'BSD-3-Clause'}));
    await assert.rejects(prepareEngraving({packageRoot: directory}), /audited/);
    await writeFile(path.join(directory, 'package.json'), JSON.stringify({name: 'opensheetmusicdisplay', version: '2.1.3', license: 'BSD-3-Clause'}));
    await mkdir(path.join(directory, 'build'));
    await writeFile(path.join(directory, 'build', 'opensheetmusicdisplay.min.js'), 'changed');
    await assert.rejects(prepareEngraving({packageRoot: directory}), /hash differs/);
  } finally { await rm(directory, {recursive: true, force: true}); }
});

import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {readScreenshotPixels} from '../tests/browser-png-evidence.js';
import {assertHomeLayoutReport, HOME_LAYOUT_PREVIEW_CASE} from '../tests/home-layout.js';

export {HOME_LAYOUT_PREVIEW_CASE};
export function assertExecutedHomeLayoutCase(tap) {
  const rows = tap.split('\n').filter(line => /^(?:not )?ok \d+ - /.test(line) && line.replace(/^(?:not )?ok \d+ - /, '').split(/\s+#/)[0] === HOME_LAYOUT_PREVIEW_CASE);
  assert.ok(rows.length === 1 && /^ok \d+ - /.test(rows[0]) && !/\s+#\s*(?:SKIP|TODO)\b/i.test(rows[0]), `Missing executed passing home-layout preview case: ${HOME_LAYOUT_PREVIEW_CASE}`);
}

// Revalidate retained rectangles, hit samples, focus, activation and PNG bytes.
// This does not turn a synthetic contract fixture into browser acceptance.
export function verifyUiPreviewHome(directory, tap) {
  assertExecutedHomeLayoutCase(tap);
  const name = 'worldmusichub-home-layout.json', bytes = readFileSync(join(directory, name));
  const report = JSON.parse(bytes.toString('utf8')); assertHomeLayoutReport(report);
  const files = [{name,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')}];
  for (const row of report.evidence) for (const shot of row.screenshots) {
    const png = readFileSync(join(directory, shot.name)), image = readScreenshotPixels(png);
    assert.equal(png.length, shot.bytes, `${shot.name}: byte length changed`);
    assert.equal(image.sha256, shot.sha256, `${shot.name}: retained PNG bytes changed`);
    assert.equal(image.width, shot.width, `${shot.name}: wrong viewport width`);
    assert.equal(image.height, shot.height, `${shot.name}: wrong viewport height`);
    files.push(shot);
  }
  return files;
}

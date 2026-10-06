import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {sha256} from '../tests/skin-browser-fixture.js';
import {readScreenshotPixels} from '../tests/browser-png-evidence.js';
import {assertExecutedSkinCases, validateSkinInteractionReport, validateSkinPersistenceReport, SKIN_BROWSER_CASES, SKIN_SCREENSHOTS} from '../tests/skin-browser-proof.js';

export {SKIN_BROWSER_CASES};

// Revalidate retained reports AND each actual screenshot's bytes. A green TAP
// line, an ok flag, or a file with only a plausible name cannot satisfy this gate.
export function verifyUiPreviewSkin(directory, tap) {
  assertExecutedSkinCases(tap);const files = [], screenshots = [];
  for (const [i, {file}] of SKIN_BROWSER_CASES.entries()) {
    const bytes = readFileSync(join(directory, file)), report = JSON.parse(bytes.toString('utf8'));
    (i === 0 ? validateSkinInteractionReport : validateSkinPersistenceReport)(report);
    files.push({name:file,bytes:bytes.length,sha256:sha256(bytes)});screenshots.push(...report.screenshots);
  }
  assert.deepEqual(screenshots.map(row => row.name), SKIN_SCREENSHOTS);
  for (const screenshot of screenshots) {
    const bytes = readFileSync(join(directory, screenshot.name)), image = readScreenshotPixels(bytes);
    assert.equal(bytes.length, screenshot.bytes);assert.equal(image.sha256, screenshot.sha256, `${screenshot.name}: screenshot bytes changed`);
    assert.equal(image.width, screenshot.width);assert.equal(image.height, screenshot.height);
    files.push(screenshot);
  }
  return files;
}

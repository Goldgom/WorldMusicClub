#!/usr/bin/env node
/** Copy the reviewed npm UMD bundle and its notices. No downloads or package scripts run here. */
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {readFile, readdir, mkdir, writeFile, rename} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {ENGRAVING_VERSION, ENGRAVING_BUNDLE_SHA256} from '../web/engraving.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runtimePackages = new Set(['opensheetmusicdisplay', '@types/vexflow', 'vexflow', 'jszip', 'loglevel', 'typescript-collections', 'lie', 'immediate', 'pako', 'readable-stream', 'setimmediate', 'core-util-is', 'inherits', 'isarray', 'process-nextick-args', 'safe-buffer', 'string_decoder', 'util-deprecate']);
const permittedLicenses = new Set(['BSD-3-Clause', 'MIT', 'ISC', '(MIT OR GPL-3.0-or-later)', '(MIT AND Zlib)']);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

async function licenseMaterials(directory, metadata) {
  const names = (await readdir(directory)).filter(name => /^(?:licen[cs]e|copying|notice|authors)(?:$|[.-])/i.test(name)).sort();
  const materials = [];
  for (const name of names) materials.push({name, text: await readFile(path.join(directory, name), 'utf8')});
  if (metadata.name === 'isarray') {
    const readme = await readFile(path.join(directory, 'README.md'), 'utf8');
    const start = readme.indexOf('## License');
    if (start < 0) throw new Error('isarray README license is missing');
    materials.push({name: 'README.md (License section)', text: readme.slice(start)});
  }
  if (!materials.some(item => /license|licence|copyright|permission/i.test(item.text))) throw new Error(`No license text found for ${metadata.name}`);
  if (metadata.name === 'jszip') {
    // JSZip offers a choice. This distribution elects MIT, not the alternate GPL license.
    for (const item of materials) if (item.name === 'LICENSE.markdown') {
      const end = item.text.indexOf('\nGPL version 3');
      if (end < 0 || !item.text.includes('The MIT License')) throw new Error('Unexpected JSZip license layout');
      item.text = `${item.text.slice(0, end).trim()}\n\nWorldMusicHub elects the MIT option for this component.\n`;
    }
  }
  if (metadata.name === 'pako') {
    // pako/LICENSE covers MIT code; its ported zlib files have additional mandatory notices.
    const directoryName = path.join(directory, 'lib', 'zlib');
    const seen = new Set();
    for (const name of (await readdir(directoryName)).filter(name => name.endsWith('.js')).sort()) {
      const source = await readFile(path.join(directoryName, name), 'utf8');
      const match = source.match(/\/\/ \(C\)[\s\S]*?\/\/ 3\. This notice may not be removed or altered from any source distribution\./);
      if (match && !seen.has(match[0])) { seen.add(match[0]); materials.push({name: `lib/zlib/${name} (zlib license notice)`, text: match[0]}); }
    }
    if (!seen.size) throw new Error('pako zlib license notices are missing');
  }
  if (metadata.name === 'vexflow') {
    const source = await readFile(path.join(directory, 'src', 'fonts', 'gonville_all.js'), 'utf8');
    const copyright = source.match(/'copyright':\s*'([^']+)'/);
    if (!copyright) throw new Error('VexFlow embedded font provenance is missing');
    materials.push({name: 'src/fonts/gonville_all.js (embedded font provenance)', text: `Gonville-18, original font version 0.1.8904. Font metadata states: ${copyright[1]}\nThe VexFlow code and modified glyph collection are distributed under the VexFlow MIT license above.\n`});
  }
  return materials;
}

/** Options are local build paths for tests/packaging; no URL or runtime content is accepted. */
export async function prepareEngraving({packageRoot, outputDirectory = path.join(root, 'web', 'vendor')} = {}) {
  const projectRequire = createRequire(path.join(root, 'package.json'));
  let packageFile;
  try { packageFile = packageRoot ? path.join(packageRoot, 'package.json') : projectRequire.resolve('opensheetmusicdisplay/package.json'); }
  catch { throw new Error(`Install exact opensheetmusicdisplay@${ENGRAVING_VERSION} before preparing the optional engraving assets.`); }
  const metadata = JSON.parse(await readFile(packageFile, 'utf8'));
  if (metadata.name !== 'opensheetmusicdisplay' || metadata.version !== ENGRAVING_VERSION || metadata.license !== 'BSD-3-Clause') throw new Error(`Expected the audited opensheetmusicdisplay@${ENGRAVING_VERSION} BSD-3-Clause package.`);
  const bundle = await readFile(path.join(path.dirname(packageFile), 'build', 'opensheetmusicdisplay.min.js'));
  if (sha256(bundle) !== ENGRAVING_BUNDLE_SHA256) throw new Error('The OSMD bundle hash differs from the reviewed npm release; audit it before changing the pin.');
  const components = [];
  const seen = new Set();
  async function visit(file) {
    const directory = path.dirname(file);
    if (seen.has(directory)) return;
    seen.add(directory);
    const entry = JSON.parse(await readFile(file, 'utf8'));
    if (!runtimePackages.has(entry.name) || !permittedLicenses.has(entry.license)) throw new Error(`Unreviewed engraving dependency/license: ${entry.name} (${entry.license})`);
    components.push({name: entry.name, version: entry.version, license: entry.license, materials: await licenseMaterials(directory, entry)});
    const requireHere = createRequire(file);
    // Do not include native GL, build/dev dependencies, or optional install tooling in the web release.
    for (const name of Object.keys(entry.dependencies || {}).sort()) await visit(requireHere.resolve(`${name}/package.json`));
  }
  await visit(packageFile);
  components.sort((a, b) => a.name.localeCompare(b.name, 'en'));
  const notices = [
    `WorldMusicHub optional staff engraving: OpenSheetMusicDisplay ${ENGRAVING_VERSION}`,
    'The browser bundle is copied unmodified from the official npm opensheetmusicdisplay package.',
    'OpenSheetMusicDisplay is BSD-3-Clause. WorldMusicHub source remains MIT licensed.',
    'The following conservative collection includes the installed runtime dependency closure, package authors, and embedded zlib/font notices. Installed dependency versions are provenance for these notice texts, not a reconstruction of upstream webpack internals.',
    'JSZip is used under its MIT option. OSMD paid audio/transpose plugins, native GL, CDN scripts, remote fonts and third-party scores are not included.',
    `Bundle SHA-256: ${ENGRAVING_BUNDLE_SHA256}`,
    'Source: https://github.com/opensheetmusicdisplay/opensheetmusicdisplay',
    ...components.flatMap(component => [`\n========== ${component.name} ${component.version} (${component.license}) ==========`, ...component.materials.map(item => `\n--- ${item.name} ---\n${item.text.trim()}\n`)])
  ].join('\n\n');
  const files = new Map([
    ['opensheetmusicdisplay.min.js.LICENSE.txt', notices],
    ['OSMD-LICENSE.txt', await readFile(path.join(path.dirname(packageFile), 'LICENSE'), 'utf8')],
    ['OSMD-AUTHORS.txt', await readFile(path.join(path.dirname(packageFile), 'AUTHORS'), 'utf8')],
    ['opensheetmusicdisplay.min.js', bundle]
  ]);
  const manifest = {name: 'opensheetmusicdisplay', version: ENGRAVING_VERSION, source: `https://registry.npmjs.org/opensheetmusicdisplay/-/opensheetmusicdisplay-${ENGRAVING_VERSION}.tgz`, license: 'BSD-3-Clause', bundleSha256: ENGRAVING_BUNDLE_SHA256, files: Object.fromEntries([...files].map(([name, bytes]) => [name, {sha256: sha256(bytes), bytes: Buffer.byteLength(bytes)}])), noticeComponents: components.map(({name, version, license}) => ({name, version, license}))};
  files.set('engraving-manifest.json', `${JSON.stringify(manifest, null, 2)}\n`);
  // All checks and notice reads succeed before emitting the runnable bundle. Per-file replace is atomic.
  await mkdir(outputDirectory, {recursive: true});
  for (const [name, content] of files) {
    const temporary = path.join(outputDirectory, `.${name}.${process.pid}.tmp`);
    await writeFile(temporary, content);
    await rename(temporary, path.join(outputDirectory, name));
  }
  return manifest;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { const manifest = await prepareEngraving(); console.log(`Prepared offline OSMD ${manifest.version} with ${manifest.noticeComponents.length} component notices in web/vendor/.`); }
  catch (error) { console.error(`Engraving preparation failed: ${error.message}`); process.exitCode = 1; }
}

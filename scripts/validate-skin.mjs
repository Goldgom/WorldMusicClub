import {constants} from 'node:fs';
import {lstat, open, realpath} from 'node:fs/promises';
import {resolve, join, relative, isAbsolute} from 'node:path';
import {pathToFileURL} from 'node:url';
import {parseSkinManifest, validateSkinResources, SKIN_LIMITS, SkinValidationError} from '../web/skin-format.js';

async function boundedRead(root, relativePath, maximum) {
  const parts = relativePath.split('/');
  let path = root;
  for (const part of parts) {
    path = join(path, part);
    const info = await lstat(path);
    if (info.isSymbolicLink()) throw new SkinValidationError('skin_asset_path', relativePath, 'symbolic links are forbidden');
  }
  const actual = await realpath(path), fromRoot = relative(root, actual);
  if (fromRoot.startsWith('..') || isAbsolute(fromRoot)) throw new SkinValidationError('skin_asset_path', relativePath, 'path escapes the package');
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > maximum) throw new SkinValidationError('skin_bounds', relativePath, 'expected a bounded regular file');
    // Read at most cap + 1, even if the file grows after stat.
    const bytes = new Uint8Array(maximum + 1);
    let length = 0;
    while (length < bytes.length) {
      const read = await handle.read(bytes, length, bytes.length - length, length);
      if (!read.bytesRead) break;
      length += read.bytesRead;
    }
    if (length > maximum) throw new SkinValidationError('skin_bounds', relativePath, 'file grew beyond its byte budget');
    return bytes.slice(0, length);
  } finally { await handle.close(); }
}

export async function validateSkinDirectory(directory) {
  const root = await realpath(resolve(directory));
  const skin = parseSkinManifest(await boundedRead(root, 'skin.json', SKIN_LIMITS.manifest_bytes));
  const resources = new Map();
  for (const asset of skin.assets) {
    try { resources.set(asset.path, await boundedRead(root, asset.path, SKIN_LIMITS.asset_bytes)); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const checked = await validateSkinResources(skin, resources);
  return {format: skin.format, version: skin.version, id: skin.id, valid: true,
    usable_assets: checked.assets.size, diagnostics: checked.diagnostics};
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2), strict = args.includes('--strict-assets');
  const positional = args.filter(arg => arg !== '--strict-assets');
  if (positional.length !== 1 || positional[0].startsWith('--')) {
    console.error('Usage: node scripts/validate-skin.mjs PACKAGE_DIRECTORY [--strict-assets]'); process.exitCode = 2;
  } else {
    try {
      const result = await validateSkinDirectory(positional[0]);
      console.log(JSON.stringify(result, null, 2));
      if (strict && result.diagnostics.length) process.exitCode = 1;
    } catch (error) {
      console.error(JSON.stringify({valid: false, code: error.code ?? 'skin_io', message: error.message}));
      process.exitCode = 1;
    }
  }
}

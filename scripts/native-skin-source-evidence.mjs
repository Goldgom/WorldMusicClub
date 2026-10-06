import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {lstat,readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {canonicalPracticeSourceBinding} from './canonical-practice-source-evidence.mjs';
import {sha256} from '../tests/skin-browser-fixture.js';

export const NATIVE_SKIN_SOURCE_FILES=Object.freeze([
  'crates/desktop-shell/skin-acceptance.js','scripts/native-skin-source-evidence.mjs',
  'scripts/prepare-native-skin-fixtures.mjs','scripts/verify-native-skin-evidence.mjs',
  'tests/skin-browser-fixture.js','tests/frontend-fixtures.js',
].sort());
export async function nativeSkinSourceBinding(root=fileURLToPath(new URL('../',import.meta.url))){
  const binding=await canonicalPracticeSourceBinding(root);
  for(const name of NATIVE_SKIN_SOURCE_FILES){
    let full=root;for(const part of name.split('/')){full=join(full,part);assert.equal((await lstat(full)).isSymbolicLink(),false);}
    const stat=await lstat(full);assert.ok(stat.isFile()&&stat.size>0&&stat.size<1024*1024,'Bounded skin source required');
    const bytes=await readFile(full),committed=execFileSync('git',['show',`${binding.source_sha}:${name}`],{cwd:root,maxBuffer:1024*1024});
    assert.deepEqual(bytes,committed,`Skin source differs from frozen commit: ${name}`);binding.source_hashes[name]=sha256(bytes);
  }
  return binding;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){assert.ok(process.argv.length<=3);console.log(JSON.stringify(await nativeSkinSourceBinding(process.argv[2])));}

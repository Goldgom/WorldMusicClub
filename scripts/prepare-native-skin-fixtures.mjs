// Reuse the original browser INPUT artwork and score; these are never screenshots.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {originalBrowserSkin,originalSkinScore,sha256} from '../tests/skin-browser-fixture.js';

export const NATIVE_SKIN_PHASES=Object.freeze(['skin-seed','skin-restart','skin-default-restart']);
export const NATIVE_SKIN_FILES=Object.freeze({score:'skin-original-score.json',manifest:'skin-original.json',image:'checker.png'});
export function nativeSkinFixture(){
  const skin=originalBrowserSkin(),score=originalSkinScore();
  const files=new Map([[NATIVE_SKIN_FILES.score,Buffer.from(JSON.stringify(score))],[NATIVE_SKIN_FILES.manifest,skin.json],[NATIVE_SKIN_FILES.image,skin.png]]);
  const manifest={version:1,generator:'scripts/prepare-native-skin-fixtures.mjs',originalFixturesOnly:true,rights:skin.manifest.attribution,
    skinId:skin.manifest.id,scoreId:score.id,files:[...files].map(([filename,bytes])=>({filename,bytes:bytes.length,sha256:sha256(bytes)}))};
  return{skin,score,files,manifest};
}
export async function prepareNativeSkinFixtures(directory){
  const fixture=nativeSkinFixture();await mkdir(directory,{recursive:true});
  for(const[name,bytes]of [...fixture.files,['native-skin-fixtures.json',JSON.stringify(fixture.manifest,null,2)+'\n']])await writeFile(join(directory,name),bytes,{flag:'wx'});
  return fixture.manifest;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){assert.equal(process.argv.length,3,'Usage: prepare-native-skin-fixtures.mjs <fresh-directory>');console.log(JSON.stringify(await prepareNativeSkinFixtures(resolve(process.argv[2]))));}

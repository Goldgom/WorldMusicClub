import {mkdir,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {authoredCleanPackage,digest} from '../tests/clean-song-package-fixtures.js';
export const CLEAN_FIXTURE_FILENAME='clean-authored-song.zip';
export function cleanAcceptanceFixture(){
 const fixture=authoredCleanPackage({long:true,media:true});
 return {...fixture,filename:CLEAN_FIXTURE_FILENAME,manifest:{version:1,filename:CLEAN_FIXTURE_FILENAME,sha256:digest(fixture.bytes),bytes:fixture.bytes.length,files:[...fixture.files].map(([path,bytes])=>({path,sha256:digest(bytes),bytes:bytes.length})).sort((a,b)=>a.path.localeCompare(b.path)),tracks:3,parts:2,notes:30,events:14,source_events:74,duration_ms:32000}};
}
export async function prepareCleanFixtures(directory){const fixture=cleanAcceptanceFixture();await mkdir(directory,{recursive:true});await writeFile(join(directory,fixture.filename),fixture.bytes,{flag:'wx'});await writeFile(join(directory,'clean-fixtures.json'),JSON.stringify(fixture.manifest,null,2)+'\n',{flag:'wx'});return fixture.manifest;}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){if(process.argv.length!==3)throw Error('Usage: node scripts/prepare-clean-song-fixtures.mjs <fresh-fixture-directory>');console.log(JSON.stringify(await prepareCleanFixtures(resolve(process.argv[2]))));}

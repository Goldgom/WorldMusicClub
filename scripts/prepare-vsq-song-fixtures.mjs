// Only the committed, originally authored generator output is admitted here.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {storedZip} from '../tests/native-import-driver-fixtures.js';
import {digest} from '../tests/clean-song-package-fixtures.js';
export const VSQ_FIXTURE_FILENAME='vsq-authored-song.zip';
export function vsqAcceptanceFixture({padding=false}={}) {
 const name=padding?'vsq-clean-v1-padding':'vsq-clean-v1';
 const files=new Map(['metadata.json','score.json'].map(namePart=>[namePart,readFileSync(new URL(`../tests/fixtures/${name}/${namePart}`,import.meta.url))]));
 const metadata=JSON.parse(files.get('metadata.json')),score=JSON.parse(files.get('score.json'));
 const opened=JSON.parse(readFileSync(new URL(`../tests/fixtures/${name}-native-open.json`,import.meta.url)));
 const runtime=JSON.parse(readFileSync(new URL(`../tests/fixtures/${name}-runtime.json`,import.meta.url)));
 assert.equal(metadata.rights.status,'original_authored');assert.equal(metadata.rights.license,'CC0-1.0');
 assert.equal(metadata.score.sha256,digest(files.get('score.json')));assert.equal(metadata.score.bytes,files.get('score.json').length);
 assert.equal(score.profile,'wmh-vsq-clean-v1');assert.equal(score.notation.source,null);
 assert.equal(opened.clean_package.metadata_json,files.get('metadata.json').toString());assert.equal(opened.clean_package.score_json,files.get('score.json').toString());
 assert.match(opened.clean_package.score_json,/9007199254740993/);
 const folder='songs/original-vsq',bytes=storedZip([...files].map(([name,data])=>[`${folder}/${name}`,data]).concat([['manifest.json',JSON.stringify({format:'worldmusichub-song-pack',version:2,songs:[{folder}]})]]));
 const manifest={version:1,filename:VSQ_FIXTURE_FILENAME,sha256:digest(bytes),bytes:bytes.length,fixture:name,generator:'crates/desktop-shell/examples/generate_vsq_fixture.rs',files:[...files].map(([path,data])=>({path,sha256:digest(data),bytes:data.length}))};
 const summary={version:2,content_sha256:opened.clean_package.content_sha256,bytes:[...files.values()].reduce((sum,b)=>sum+b.length,0),profile:score.profile,capabilities:score.capabilities,coverage:score.coverage,interpretation_limits:score.interpretation_limits,media:[],notation_available:true};
 return {filename:VSQ_FIXTURE_FILENAME,bytes,files,metadata,score,opened,runtime,summary,key:`song-${opened.clean_package.content_sha256}`,manifest};
}
export async function prepareVsqFixtures(directory){const fixture=vsqAcceptanceFixture();await mkdir(directory,{recursive:true});await writeFile(join(directory,fixture.filename),fixture.bytes,{flag:'wx'});await writeFile(join(directory,'vsq-fixtures.json'),JSON.stringify(fixture.manifest,null,2)+'\n',{flag:'wx'});return fixture.manifest;}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){assert.equal(process.argv.length,3,'Usage: node scripts/prepare-vsq-song-fixtures.mjs <fresh-directory>');console.log(JSON.stringify(await prepareVsqFixtures(resolve(process.argv[2]))));}

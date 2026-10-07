// Original self-authored Rust API fixtures only; never a private song or voicebank.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {mkdir,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {storedZip} from '../tests/native-import-driver-fixtures.js';
import {digest} from '../tests/clean-song-package-fixtures.js';
export const ASSISTANCE_PHASES=Object.freeze(['assistance-seed','assistance-restart']);
export const ASSISTANCE_FIXTURE='assistance-original-songs.zip';
export function assistanceNativeFixtures(){
 const read=name=>JSON.parse(readFileSync(new URL(`../tests/fixtures/${name}.json`,import.meta.url),'utf8'));
 const basic=read('assistance-native-basic'),vsq=read('assistance-native-vsq'),vsqOpened=read('vsq-clean-v1-native-open');
 const files=new Map(),sources={};
 for(const [kind,fixture,opened]of [['basic',basic,basic.opened],['vsq',vsq,vsqOpened]]){
  const p=opened.clean_package,metadata=JSON.parse(p.metadata_json);assert.equal(p.content_sha256,fixture.source.content_sha256);assert.equal(metadata.rights.status,'original_authored');assert.equal(metadata.rights.license,'CC0-1.0');
  sources[kind]={key:fixture.source.key,content_sha256:p.content_sha256,files:[]};
  for(const [name,value]of [['score.json',p.score_json],['metadata.json',p.metadata_json]]){const path=`songs/assistance-${kind}/${name}`,bytes=Buffer.from(value);files.set(path,bytes);sources[kind].files.push({path:name,sha256:digest(bytes),bytes:bytes.length});}
 }
 files.set('manifest.json',Buffer.from(JSON.stringify({format:'worldmusichub-song-pack',version:2,songs:['basic','vsq'].map(kind=>({folder:`songs/assistance-${kind}`}))})));
 const bytes=storedZip([...files]);return{basic,vsq,vsqOpened,bytes,sources,manifest:{version:1,file:ASSISTANCE_FIXTURE,sha256:digest(bytes),bytes:bytes.length,sources}};
}
export async function prepareAssistanceFixtures(directory){const f=assistanceNativeFixtures();await mkdir(directory,{recursive:true});await writeFile(join(directory,ASSISTANCE_FIXTURE),f.bytes,{flag:'wx'});await writeFile(join(directory,'assistance-fixtures.json'),JSON.stringify(f.manifest,null,2)+'\n',{flag:'wx'});return f.manifest;}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){assert.equal(process.argv.length,3);console.log(JSON.stringify(await prepareAssistanceFixtures(resolve(process.argv[2]))));}

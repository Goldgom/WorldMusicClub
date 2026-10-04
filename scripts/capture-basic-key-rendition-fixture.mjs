// Reproduce only the committed, original 130-byte acceptance source through the
// pinned socket-free native driver. This never starts a browser or listener.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,mkdtemp,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {startVsqNativeDriver} from '../tests/vsq-native-driver-fixtures.js';
import {basicKeyAcceptanceFixture} from './prepare-basic-key-fixtures.mjs';
import {digest} from '../tests/clean-song-package-fixtures.js';
export async function captureBasicKeyRenditionFixture(receiptPath,destination){
 const receipt=JSON.parse(await readFile(receiptPath,'utf8')),binary=receipt.binary_path,bytes=await readFile(binary);
 assert.equal(digest(bytes),receipt.binary_sha256);assert.equal(bytes.length,receipt.binary_bytes);for(const key of ['source_commit','source_tree'])assert.match(receipt[key],/^[a-f0-9]{40}$/);
 const fixture=basicKeyAcceptanceFixture(),directory=await mkdtemp(join(tmpdir(),'wmh-original-v2-capture-')),driver=startVsqNativeDriver({binary,directory:join(directory,'Scores')});
 async function request(path,body,raw=false){const response=await driver.fetcher(path,{method:'POST',headers:raw?{'Content-Type':'application/zip','X-WMH-Filename':'Original-basic-key.zip'}:{'Content-Type':'application/json'},body:raw?body:JSON.stringify(body)});assert.equal(response.status,200,await response.text());return response.json();}
 try{
  const saved=await request('/api/library/import/commit',fixture.bytes,true),key=saved.items[0].entry.key;assert.equal(key,`song-${fixture.manifest.package.content_sha256}`);
  const loaded=await request('/api/library/load',{key}),open={score_json:loaded.score_json,clean_package:loaded.clean_package};assert.equal(open.clean_package.score_json,fixture.files.get('score.json').toString());assert.equal(open.clean_package.metadata_json,fixture.files.get('metadata.json').toString());
  const source={key,content_sha256:fixture.manifest.package.content_sha256,profile:fixture.score.performance.profile},settings=[];
  for(const part_id of ['midi-t1-c1-r0','midi-t2-c10-r0','midi-t3-c1-r0'])for(const first_measure of [0,2,4])settings.push({part_id,first_measure});
  settings.push({part_id:'midi-t1-c1-r0',display_meter:null},{part_id:'midi-t3-c1-r0',display_meter:null},{part_id:'midi-t1-c1-r0',measure_count:8},{part_id:'midi-t3-c1-r0',measure_count:8},...[4100,8100,12020,0].map(position_ms=>({position_ms})));
  const pages=[];for(const value of settings){const body={source,settings:{part_id:'midi-t1-c1-r0',first_measure:0,measure_count:2,display_meter:{numerator:4,denominator:4},rendition_policy_id:'wmh-basic-key-rendition-fifo-v1',...value}};pages.push({request:body,response:await request('/api/library/basic-keys/notation',body),status:200});}
  const output=Buffer.from(JSON.stringify({open,pages},null,2)+'\n'),provenance={generator:'scripts/capture-basic-key-rendition-fixture.mjs',source:receipt.source_commit,source_tree:receipt.source_tree,binary_sha256:receipt.binary_sha256,source_midi_sha256:fixture.manifest.source.sha256,source_midi_bytes:fixture.source.length,package_sha256:fixture.manifest.package.sha256,output_sha256:digest(output),method:'actual original 130-byte clean ZIP import, native load projection (score_json + clean_package), and 17 source-bound part/page/meter/position POST responses; no browser/listener'};
  await mkdir(destination,{recursive:true});await writeFile(join(destination,'rendition-native.json'),output,{flag:'wx'});await writeFile(join(destination,'rendition-provenance.json'),JSON.stringify(provenance,null,2)+'\n',{flag:'wx'});return provenance;
 }finally{await driver.close();await rm(directory,{recursive:true,force:true});}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){assert.equal(process.argv.length,4,'Usage: capture-basic-key-rendition-fixture.mjs <immutable-driver-receipt.json> <fresh-output-directory>');console.log(JSON.stringify(await captureBasicKeyRenditionFixture(resolve(process.argv[2]),resolve(process.argv[3]))));}

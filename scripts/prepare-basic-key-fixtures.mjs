// Original isolated MIDI keys, authored for public acceptance (CC0-1.0).
// The committed clean files are output of the production clean-song-batch CLI.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {mkdir,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {storedZip} from '../tests/native-import-driver-fixtures.js';
import {digest} from '../tests/clean-song-package-fixtures.js';
export const BASIC_KEY_PHASES=Object.freeze(['basic-key-seed','basic-key-restart']);
export const BASIC_KEY_FILES=Object.freeze({source:'Original basic-key acceptance.mid',valid:'basic-key-original.zip',profile:'basic-key-invalid-profile.zip',coverage:'basic-key-forged-coverage.zip'});
export function originalBasicKeyMidi(){
 const tracks=[
  [0,0xb0,0,7,0,0xc0,42,0,0xb0,74,91,0,0x90,60,90,0x92,0,0x80,60,0,0,0x90,64,90,0,0x80,64,0,0,0x90,67,90,0,255,47,0],
  [0,0x99,35,100,48,0x89,35,0,0,255,47,0],
  [96,0x90,72,80,96,0x80,72,0,0,255,47,0],
  [0,255,1,4,110,111,116,101,0,255,47,0],
  [0,255,47,0],
 ];
 const header=Buffer.from([77,84,104,100,0,0,0,6,0,1,0,5,0,96]);
 return Buffer.concat([header,...tracks.flatMap(track=>{const h=Buffer.alloc(8);h.write('MTrk');h.writeUInt32BE(track.length,4);return[h,Buffer.from(track)];})]);
}
function zip(files){return storedZip([...files].map(([name,bytes])=>[`songs/original-basic-key/${name}`,bytes]).concat([['manifest.json',JSON.stringify({format:'worldmusichub-song-pack',version:2,songs:[{folder:'songs/original-basic-key'}]})]]));}
export function basicKeyAcceptanceFixture(){
 const source=originalBasicKeyMidi(),files=new Map(['metadata.json','score.json'].map(name=>[name,readFileSync(new URL(`../tests/fixtures/basic-key-acceptance/${name}`,import.meta.url))]));
 const metadata=JSON.parse(files.get('metadata.json')),score=JSON.parse(files.get('score.json'));
 assert.equal(score.source.sha256,digest(source));assert.equal(score.source.bytes,source.length);assert.equal(metadata.score.sha256,digest(files.get('score.json')));assert.equal(metadata.score.bytes,files.get('score.json').length);
 // Native metadata identity uses its declared field order, independently of
 // whitespace/property ordering in the exact retained metadata file.
 const m=metadata,identity=digest(JSON.stringify({format:m.format,version:m.version,id:m.id,title:m.title,
  score:{path:m.score.path,bytes:m.score.bytes,sha256:m.score.sha256},sources:m.sources.map(s=>({format:s.format,bytes:s.bytes,sha256:s.sha256})),
  rights:{status:m.rights.status,attribution:m.rights.attribution,license:m.rights.license},media:[]}));
 const bytes=zip(files),variants={};
 for(const id of ['profile','coverage']){const changed=structuredClone(score);if(id==='profile')changed.performance.profile='wmh-basic-keys-midi1-v999';else changed.coverage.represented_events--;const body=Buffer.from(JSON.stringify(changed)),meta=structuredClone(metadata);meta.score={...meta.score,bytes:body.length,sha256:digest(body)};variants[id]=zip(new Map([['metadata.json',Buffer.from(JSON.stringify(meta))],['score.json',body]]));}
 const manifest={version:1,generator:'scripts/prepare-basic-key-fixtures.mjs',converter:'clean-song-batch',rights:{status:'original_authored',license:'CC0-1.0',attribution:'Original isolated keys authored solely for WorldMusicHub acceptance; no private music'},source:{filename:BASIC_KEY_FILES.source,bytes:source.length,sha256:digest(source)},package:{filename:BASIC_KEY_FILES.valid,bytes:bytes.length,sha256:digest(bytes),content_sha256:identity},files:[...files].map(([path,data])=>({path,bytes:data.length,sha256:digest(data)})),coverage:score.coverage,variants:Object.fromEntries(Object.entries(variants).map(([id,data])=>[id,{filename:BASIC_KEY_FILES[id],bytes:data.length,sha256:digest(data)}]))};
 return{source,bytes,files,variants,metadata,score,manifest};
}
export async function prepareBasicKeyFixtures(directory){const f=basicKeyAcceptanceFixture();await mkdir(directory,{recursive:true});for(const[name,bytes]of [[BASIC_KEY_FILES.source,f.source],[BASIC_KEY_FILES.valid,f.bytes],...Object.entries(f.variants).map(([id,data])=>[BASIC_KEY_FILES[id],data]),['basic-key-fixtures.json',JSON.stringify(f.manifest,null,2)+'\n']])await writeFile(join(directory,name),bytes,{flag:'wx'});return f.manifest;}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){assert.equal(process.argv.length,3,'Usage: prepare-basic-key-fixtures.mjs <fresh-directory>');console.log(JSON.stringify(await prepareBasicKeyFixtures(resolve(process.argv[2]))));}

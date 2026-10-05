// Mechanical original C/E/G gates, authored for public acceptance (CC0-1.0).
// The two retained JSON files are exact production clean-song-batch output.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {mkdir,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {storedZip} from '../tests/native-import-driver-fixtures.js';
import {digest} from '../tests/clean-song-package-fixtures.js';
import {prepareVsqFixtures,vsqAcceptanceFixture} from './prepare-vsq-song-fixtures.mjs';
export const COMPLETE_PRACTICE_PHASES=Object.freeze(['complete-practice-seed','complete-practice-restart']);
export const COMPLETE_PRACTICE_FILES=Object.freeze({source:'Original complete practice.mid',valid:'complete-practice-original.zip',vsq:'vsq-authored-song.zip'});
export const COMPLETE_PARTS=Object.freeze(['midi-t3-c3-r0','midi-t1-c1-r0','midi-t2-c2-r0']);
export function originalCompletePracticeMidi(){
 const vlq=n=>{const b=[n&127];while(n>>=7)b.unshift((n&127)|128);return b;};
 const track=events=>{const b=Buffer.from(events.flatMap(([delta,bytes])=>[...vlq(delta),...bytes])),h=Buffer.alloc(8);h.write('MTrk');h.writeUInt32BE(b.length,4);return Buffer.concat([h,b]);};
 return Buffer.concat([Buffer.from([77,84,104,100,0,0,0,6,0,1,0,3,0,96]),
  track([[0,[255,81,3,7,161,32]],[288,[144,72,90]],[96,[128,72,0]],[288,[144,76,90]],[144,[128,76,0]],[144,[255,47,0]]]),
  track([[288,[145,72,80]],[192,[129,72,0]],[192,[145,79,80]],[144,[129,79,0]],[144,[255,47,0]]]),
  track([[0,[146,60,70]],[0,[146,115,70]],[960,[130,60,0]],[0,[130,115,0]],[0,[255,47,0]]])]);
}
export function completePracticeFixture(){
 const source=originalCompletePracticeMidi(),files=new Map(['metadata.json','score.json'].map(name=>[name,readFileSync(new URL(`../tests/fixtures/complete-practice-acceptance/${name}`,import.meta.url))]));
 const metadata=JSON.parse(files.get('metadata.json')),score=JSON.parse(files.get('score.json'));
 assert.equal(score.source.sha256,digest(source));assert.equal(score.source.bytes,source.length);assert.equal(metadata.score.sha256,digest(files.get('score.json')));assert.equal(metadata.score.bytes,files.get('score.json').length);
 assert.deepEqual(score.performance.parts.map(p=>p.id),COMPLETE_PARTS);assert.equal(score.coverage.key_attacks,6);
 const folder='songs/original-complete-practice',bytes=storedZip([...files].map(([name,data])=>[`${folder}/${name}`,data]).concat([['manifest.json',JSON.stringify({format:'worldmusichub-song-pack',version:2,songs:[{folder}]})]]));
 const manifest={version:1,generator:'scripts/prepare-complete-practice-fixtures.mjs',converter:'clean-song-batch',rights:{status:'original_authored',license:'CC0-1.0',attribution:'Mechanical C/E/G gates authored solely for WorldMusicHub acceptance; no supplied or third-party music'},source:{filename:COMPLETE_PRACTICE_FILES.source,bytes:source.length,sha256:digest(source)},package:{filename:COMPLETE_PRACTICE_FILES.valid,bytes:bytes.length,sha256:digest(bytes)},files:[...files].map(([path,data])=>({path,bytes:data.length,sha256:digest(data)})),parts:[...COMPLETE_PARTS],human_source_ids:['midi-t1-e2','midi-t2-e1','midi-t1-e4','midi-t2-e3'],machine_source_ids:['midi-t3-e1','midi-t3-e2'],target_ids:['midi-t1-e2','midi-t1-e4','midi-t2-e3'],unison:{midi:72,start_ms:1500,duration_ms:1000,source_ids:['midi-t1-e2','midi-t2-e1']},duration_ms:5000,vsq:vsqAcceptanceFixture().manifest};
 return{source,files,metadata,score,bytes,manifest};
}
export async function prepareCompletePracticeFixtures(directory){const f=completePracticeFixture();await mkdir(directory,{recursive:true});for(const[name,bytes]of [[COMPLETE_PRACTICE_FILES.source,f.source],[COMPLETE_PRACTICE_FILES.valid,f.bytes],['complete-practice-fixtures.json',JSON.stringify(f.manifest,null,2)+'\n']])await writeFile(join(directory,name),bytes,{flag:'wx'});await prepareVsqFixtures(directory);return f.manifest;}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){assert.equal(process.argv.length,3,'Usage: prepare-complete-practice-fixtures.mjs <fresh-directory>');console.log(JSON.stringify(await prepareCompletePracticeFixtures(resolve(process.argv[2]))));}

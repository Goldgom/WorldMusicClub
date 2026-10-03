// Wholly authored Rust-generated clean JSON. Never reads delivered/private music.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {storedZip} from '../tests/native-import-driver-fixtures.js';
import {digest} from '../tests/clean-song-package-fixtures.js';
import {loadCleanPerformance} from '../web/clean-performance-player.js';

export const PERFORMANCE_FIXTURE_FILENAME='performance-authored-songs.zip';
export const PERFORMANCE_FIXTURE_NAMES=Object.freeze(['performance-overlap-v2','performance-controls-v2','performance-controls-rpn12-route-v2','performance-bank-rpn12-route-v2']);
const generated=[];
for(const [index,name] of PERFORMANCE_FIXTURE_NAMES.entries()) {
  const files=new Map(['metadata.json','score.json'].map(path=>[path,readFileSync(new URL(`../tests/fixtures/${name}/${path}`,import.meta.url))]));
  const metadata=JSON.parse(files.get('metadata.json')),score=JSON.parse(files.get('score.json'));
  const native=JSON.parse(readFileSync(new URL(`../tests/fixtures/${name}-native-open.json`,import.meta.url)));
  const opened={score_json:native.score_json,clean_package:native.clean_package},summary=native.entry.clean_package,key=native.entry.key;
  assert.equal(metadata.rights.status,'original_authored');assert.equal(metadata.rights.license,'CC0-1.0');
  assert.equal(metadata.score.sha256,digest(files.get('score.json')));assert.equal(metadata.score.bytes,files.get('score.json').length);
  assert.equal(score.performance.profile,'wmh-performance-midi1-v1');assert.equal(score.notation,null);assert.equal(opened.score_json,null);
  assert.equal(score.coverage.targets.represented_attacks,0);assert.equal(summary.notation_available,false);
  assert.equal(opened.clean_package.metadata_json,files.get('metadata.json').toString());assert.equal(opened.clean_package.score_json,files.get('score.json').toString());
  assert.equal(native.entry.saved_at_unix_ms,1700000000000);assert.equal(key,`song-${opened.clean_package.content_sha256}`);assert.deepEqual(metadata.media,[]);
  // This is the production receiver's derived expectation, not serialized or
  // authoritative notation, targets, note pairing, or a second timing compiler.
  const reference=await loadCleanPerformance({scoreBytes:files.get('score.json'),expectedScoreSha256:metadata.score.sha256,compile:async()=>opened.clean_package.runtime});
  assert.equal(reference.playable,index!==3);assert.deepEqual(reference.blockers.map(b=>b.code),index===3?['unsupported_bank_select']:[]);assert.ok(reference.durationSeconds>=5&&reference.durationSeconds<5.01);
  const folder=`songs/original-${name.slice(0,-3)}`;
  generated.push({name,filename:PERFORMANCE_FIXTURE_FILENAME,folder,key,files,metadata,score,opened,summary,reference});
}

export function performanceAcceptanceFixtures() {
  const fixtures=generated.map(f=>({...f,files:new Map([...f.files].map(([path,bytes])=>[path,Buffer.from(bytes)])),metadata:structuredClone(f.metadata),score:structuredClone(f.score),opened:structuredClone(f.opened),summary:structuredClone(f.summary)}));
  const songs=fixtures.map(({folder})=>({folder}));
  const entries=fixtures.flatMap(f=>[...f.files].map(([path,bytes])=>[`${f.folder}/${path}`,bytes]));
  entries.push(['manifest.json',JSON.stringify({format:'worldmusichub-song-pack',version:2,songs})]);
  const bytes=storedZip(entries);
  const manifest={version:1,filename:PERFORMANCE_FIXTURE_FILENAME,sha256:digest(bytes),bytes:bytes.length,
    generator:'crates/desktop-shell/examples/generate_performance_acceptance_fixtures.rs',
    fixtures:fixtures.map(f=>({name:f.name,folder:f.folder,key:f.key,score_id:f.score.id,title:f.score.title,source_sha256:f.score.source.sha256,
      content_sha256:f.opened.clean_package.content_sha256,files:[...f.files].map(([path,data])=>({path,sha256:digest(data),bytes:data.length}))}))};
  return {filename:PERFORMANCE_FIXTURE_FILENAME,bytes,manifest,fixtures};
}

export async function preparePerformanceFixtures(directory) {
  const pack=performanceAcceptanceFixtures();await mkdir(directory,{recursive:true});
  await writeFile(join(directory,pack.filename),pack.bytes,{flag:'wx'});
  await writeFile(join(directory,'performance-fixtures.json'),JSON.stringify(pack.manifest,null,2)+'\n',{flag:'wx'});
  return pack.manifest;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  assert.equal(process.argv.length,3,'Usage: node scripts/prepare-performance-song-fixtures.mjs <fresh-directory>');
  console.log(JSON.stringify(await preparePerformanceFixtures(resolve(process.argv[2]))));
}

// Wholly authored Rust-generated clean JSON. Never reads delivered/private music.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {storedZip} from '../tests/native-import-driver-fixtures.js';
import {digest} from '../tests/clean-song-package-fixtures.js';
import {loadCleanPerformance} from '../web/clean-performance-player.js';
import {PROGRAM_FAMILIES} from '../web/midi-reference-synth.js';
assert.equal(PROGRAM_FAMILIES[1].ratio,3,'Original pitch fixture requires the declared program8 harmonic ratio');

export const PITCH_BEND_FIXTURE_FILENAME='pitch-bend-authored-songs.zip';
export const PITCH_BEND_FIXTURE_NAMES=Object.freeze(['performance-pitch-default2-v2','performance-pitch-proved12-v2','performance-pitch-bound12-v2']);
const generated=[];
for(const [index,name] of PITCH_BEND_FIXTURE_NAMES.entries()) {
  const files=new Map(['metadata.json','score.json'].map(path=>[path,readFileSync(new URL(`../tests/fixtures/${name}/${path}`,import.meta.url))]));
  const metadata=JSON.parse(files.get('metadata.json')),score=JSON.parse(files.get('score.json'));
  const native=JSON.parse(readFileSync(new URL(`../tests/fixtures/${name}-native-open.json`,import.meta.url)));
  const opened={score_json:native.score_json,clean_package:native.clean_package},summary=native.entry.clean_package,key=native.entry.key;
  assert.equal(metadata.rights.status,'original_authored');assert.equal(metadata.rights.license,'CC0-1.0');assert.ok(metadata.rights.attribution.includes('crates/desktop-shell/examples/generate_pitch_acceptance_fixtures.rs'));assert.ok(metadata.rights.attribution.includes('no supplied or third-party music'));
  assert.equal(metadata.score.sha256,digest(files.get('score.json')));assert.equal(metadata.score.bytes,files.get('score.json').length);
  assert.equal(score.performance.profile,'wmh-performance-midi1-v1');assert.equal(score.notation,null);assert.equal(opened.score_json,null);
  assert.equal(score.coverage.targets.represented_attacks,0);assert.equal(summary.notation_available,false);
  assert.equal(opened.clean_package.metadata_json,files.get('metadata.json').toString());assert.equal(opened.clean_package.score_json,files.get('score.json').toString());
  assert.equal(native.entry.saved_at_unix_ms,1700000000000);assert.equal(key,`song-${opened.clean_package.content_sha256}`);assert.deepEqual(metadata.media,[]);
  // This is the production receiver's derived expectation, not serialized or
  // authoritative notation, targets, note pairing, or a second timing compiler.
  const reference=await loadCleanPerformance({scoreBytes:files.get('score.json'),expectedScoreSha256:metadata.score.sha256,compile:async()=>opened.clean_package.runtime});
  assert.equal(reference.playable,index!==2);assert.deepEqual([...new Set(reference.blockers.map(b=>b.code))],index===2?['unsupported_pitch_range']:[]);assert.equal(reference.policy.id,'wmh-original-reference-fifo-pitch-v3');assert.ok(reference.pitchBends);assert.ok(score.performance.events.filter(e=>['key_attack','key_release'].includes(e.command.kind)).every(e=>[0,4,7].includes(e.command.key%12)));assert.ok(reference.durationSeconds>=5&&reference.durationSeconds<5.01);
  const folder=`songs/original-${name.slice(0,-3)}`;
  generated.push({name,filename:PITCH_BEND_FIXTURE_FILENAME,folder,key,files,metadata,score,opened,summary,reference});
}

export function pitchBendAcceptanceFixtures() {
  const fixtures=generated.map(f=>({...f,files:new Map([...f.files].map(([path,bytes])=>[path,Buffer.from(bytes)])),metadata:structuredClone(f.metadata),score:structuredClone(f.score),opened:structuredClone(f.opened),summary:structuredClone(f.summary)}));
  const songs=fixtures.map(({folder})=>({folder}));
  const entries=fixtures.flatMap(f=>[...f.files].map(([path,bytes])=>[`${f.folder}/${path}`,bytes]));
  entries.push(['manifest.json',JSON.stringify({format:'worldmusichub-song-pack',version:2,songs})]);
  const bytes=storedZip(entries);
  const manifest={version:1,filename:PITCH_BEND_FIXTURE_FILENAME,sha256:digest(bytes),bytes:bytes.length,
    generator:'crates/desktop-shell/examples/generate_pitch_acceptance_fixtures.rs',
    fixtures:fixtures.map(f=>({name:f.name,folder:f.folder,key:f.key,score_id:f.score.id,title:f.score.title,source_sha256:f.score.source.sha256,
      content_sha256:f.opened.clean_package.content_sha256,files:[...f.files].map(([path,data])=>({path,sha256:digest(data),bytes:data.length}))}))};
  return {filename:PITCH_BEND_FIXTURE_FILENAME,bytes,manifest,fixtures};
}

export async function preparePitchBendFixtures(directory) {
  const pack=pitchBendAcceptanceFixtures();await mkdir(directory,{recursive:true});
  await writeFile(join(directory,pack.filename),pack.bytes,{flag:'wx'});
  await writeFile(join(directory,'pitch-bend-fixtures.json'),JSON.stringify(pack.manifest,null,2)+'\n',{flag:'wx'});
  return pack.manifest;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  assert.equal(process.argv.length,3,'Usage: node scripts/prepare-pitch-bend-fixtures.mjs <fresh-directory>');
  console.log(JSON.stringify(await preparePitchBendFixtures(resolve(process.argv[2]))));
}

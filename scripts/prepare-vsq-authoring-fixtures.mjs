// One original synthetic source; all response oracles were emitted by Rust.
// Never read private music or manufacture a converter/runtime response.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {authoringDraftFingerprint} from './song-authoring-fixture-contract.mjs';
export const VSQ_AUTHORING_FIXTURE_FILENAME='authoring-original.vsq';
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const file=name=>readFileSync(new URL(`../tests/fixtures/song-authoring/${name}`,import.meta.url));
export function vsqAuthoringFixture(){
 const original=JSON.parse(file('vsq-request.json')),bytes=Buffer.from(original.source_base64,'base64'),filename=VSQ_AUTHORING_FIXTURE_FILENAME;
 const draft=JSON.parse(file('acceptance-vsq-draft.json')),opened=JSON.parse(file('acceptance-vsq-opened.json')),runtime=JSON.parse(file('acceptance-vsq-runtime.json')),provenance=JSON.parse(file('acceptance-vsq-provenance.json'));
 const request={...original,source_name:filename,title:'authoring-original'},key=`song-${opened.clean_package.content_sha256}`;
 assert.equal(provenance.request_sha256,digest(file('vsq-request.json')));assert.deepEqual(provenance.request,{source_name:request.source_name,title:request.title});assert.equal(provenance.key,key);
 for(const row of provenance.files){const value=file(row.path);assert.equal(value.length,row.bytes);assert.equal(digest(value),row.sha256);}
 const manifest={filename,bytes:bytes.length,sha256:digest(bytes),source_request_sha256:digest(file('vsq-request.json')),draft_sha256:draft.draft_sha256,source_tracks:4,source_events:152,vocal_parts:3,authored_notes:2,muted_parts:1,note_free_parts:1,large_integer_token:'9007199254740993',expected_profile:'wmh-vsq-clean-v1'};
 return{filename,bytes,request,draft,opened,runtime,key,manifest,provenance};
}
export function validateVsqAuthoringDraft(draft,fixture=vsqAuthoringFixture()){
 assert.deepEqual(draft,fixture.draft,'Actual Rust draft changed the complete original inventory or exact package strings');
 assert.equal(draft.draft_sha256,authoringDraftFingerprint(draft.package));assert.equal(draft.state,'vsq_authoring_candidate');assert.deepEqual(draft.source,{format:'vsq',bytes:fixture.bytes.length,sha256:fixture.manifest.sha256});
 assert.equal(draft.inventory.source_tracks,4);assert.equal(draft.inventory.source_events,152);assert.equal(draft.inventory.parts.length,3);assert.equal(draft.inventory.key_attacks,0);assert.equal(draft.inventory.key_releases,0);
 assert.equal(draft.inventory.parts[1].vsq.mute,true);assert.equal(draft.inventory.parts[2].vsq.notes,0);assert.ok(draft.inventory.parts.every(part=>part.channel===null));
 assert.match(draft.package.score_json,/9007199254740993/);assert.doesNotMatch(draft.package.score_json,/9007199254740992/);
 // Parse only for safe small-field checks. The exact score_json string above
 // remains the canonical comparison; JSON.parse cannot represent its large int.
 const score=JSON.parse(draft.package.score_json),metadata=JSON.parse(draft.package.metadata_json);
 assert.equal(metadata.score.sha256,digest(draft.package.score_json));assert.equal(metadata.score.bytes,Buffer.byteLength(draft.package.score_json));assert.deepEqual(metadata.media,[]);
 assert.deepEqual(score.capabilities,{whole_vocal_rendering:'blocked',instrumental_practice:'requires_explicit_base_note_choice'});assert.equal(score.authoring.tracks.length,3);assert.equal(score.notation.parts.length,3);
 return{metadata,score};
}
export async function prepareVsqAuthoringFixtures(directory){
 const fixture=vsqAuthoringFixture();validateVsqAuthoringDraft(fixture.draft,fixture);
 const manifest={version:1,generator:'scripts/prepare-vsq-authoring-fixtures.mjs',rights:{status:'original_authored',attribution:'WorldMusicHub original synthetic VSQ C/E authoring exercise',license:'CC0-1.0'},fixtures:[fixture.manifest]};
 await mkdir(directory,{recursive:true});await writeFile(join(directory,fixture.filename),fixture.bytes,{flag:'wx'});await writeFile(join(directory,'vsq-authoring-fixtures.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});return manifest;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){assert.equal(process.argv.length,3);console.log(JSON.stringify(await prepareVsqAuthoringFixtures(resolve(process.argv[2]))));}

// Original finite material only. No imported scores or user data.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {liveToneNavigationFixture} from './prepare-live-tone-navigation-fixtures.mjs';

export const HUMAN_MOD_TIMBRE_FIXTURE='human-mod-timbre-original.json';
export const HUMAN_MOD_TIMBRE_PARTS=Object.freeze(['human-one','human-two']);
export function humanModTimbreFixture(){
 const score=structuredClone(liveToneNavigationFixture().score);
 score.id='original-human-mod-timbre';score.title='Original shared human timbre exercise';
 score.provenance.attribution='Self-authored two-owner same-key Mod and live sound acceptance; no supplied or third-party music';
 score.parts=HUMAN_MOD_TIMBRE_PARTS.map((id,index)=>({id,name:`Human ${index+1}`,instrument:'piano',notes:score.parts[0].notes.map(note=>({...structuredClone(note),id:`${id}-${note.id}`}))}));
 score.source={format:'original-test-text',filename:'original-human-timbre.txt',content:'\uFEFFOriginal shared-input exercise · 原稿\r\nBoth parts own C4 at 0/1 and E4 at 63/1. Preserve all four source owners.'};
 const bytes=Buffer.from(JSON.stringify(score,null,2));
 return{score,bytes,manifest:{version:1,generator:'scripts/prepare-human-mod-timbre-fixtures.mjs',rights:score.provenance,scoreId:score.id,title:score.title,partIds:HUMAN_MOD_TIMBRE_PARTS,midi:60,keyCode:'KeyR',sourceNotes:4,defaultPerformanceProfile:'piano',targetNotes:2,targetNotesByPerformanceProfile:{piano:2,guitar:4},targetOwnershipByPerformanceProfile:{piano:'shared-unison-owners',guitar:'separate-source-events'},durationMs:64000,files:[{filename:HUMAN_MOD_TIMBRE_FIXTURE,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')}]}};
}
export async function prepareHumanModTimbreFixtures(directory){const f=humanModTimbreFixture();await mkdir(directory,{recursive:true});await writeFile(join(directory,HUMAN_MOD_TIMBRE_FIXTURE),f.bytes,{flag:'wx'});await writeFile(join(directory,'human-mod-timbre-fixtures.json'),JSON.stringify(f.manifest,null,2)+'\n',{flag:'wx'});return f.manifest;}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){assert.equal(process.argv.length,3,'Usage: prepare-human-mod-timbre-fixtures.mjs <fresh-directory>');console.log(JSON.stringify(await prepareHumanModTimbreFixtures(resolve(process.argv[2]))));}

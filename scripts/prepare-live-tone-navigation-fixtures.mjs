// Original, deterministic CC0 material for the separate native silence route.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

export const LIVE_TONE_NAVIGATION_CASES=Object.freeze(['settings','authoring'].flatMap(route=>['keyup','navigation'].map(release=>Object.freeze({phase:`live-navigation-${route}-${release}`,route,release}))));
export const LIVE_TONE_NAVIGATION_PHASES=Object.freeze(LIVE_TONE_NAVIGATION_CASES.map(row=>row.phase));
export const LIVE_TONE_NAVIGATION_FIXTURE_FILENAME='live-tone-navigation-original.json';
export const LIVE_TONE_NAVIGATION_MANIFEST_FILENAME='live-tone-navigation-fixtures.json';
export function liveToneNavigationFixture(){
 const beat=n=>({numerator:n,denominator:1});
 const note=(id,at,step)=>({id,at:beat(at),duration:beat(1),pitch:{step,alter:0,octave:4},voice:'1',staff:1,velocity:90,tie_start:false,tie_stop:false});
 const score={version:1,id:'original-live-tone-navigation',title:'Original live tone navigation exercise',composer:'WorldMusicClub test authors',provenance:{kind:'original_exercise',attribution:'Self-authored mechanical live-input navigation acceptance score; no supplied or third-party music',source_url:null,license:'CC0-1.0'},parts:[{id:'piano',name:'Piano',instrument:'piano',notes:[note('c4',0,'C'),note('e4',63,'E')]}],tempo:[{at:beat(0),bpm:60}],meters:[{at:beat(0),numerator:4,denominator:4}],keys:[{at:beat(0),fifths:0,mode:'major'}],measures:Array.from({length:16},(_,index)=>({number:index+1,at:beat(index*4),length:beat(4)})),repeats:[],source:{format:'original-test-text',filename:'original-keyboard.txt',content:'\uFEFFOriginal input exercise · 原稿\r\nC4 at 0/1; E4 at 63/1. Preserve exact source.'}};
 const bytes=Buffer.from(JSON.stringify(score,null,2));
 const manifest={version:1,generator:'scripts/prepare-live-tone-navigation-fixtures.mjs',rights:score.provenance,score_id:score.id,duration_ms:64000,key_code:'KeyR',midi:60,source_note_ids:['c4','e4'],phases:LIVE_TONE_NAVIGATION_PHASES,files:[{filename:LIVE_TONE_NAVIGATION_FIXTURE_FILENAME,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')}]};
 return{score,bytes,manifest};
}
export async function prepareLiveToneNavigationFixtures(directory){
 const f=liveToneNavigationFixture();await mkdir(directory,{recursive:true});
 await writeFile(join(directory,LIVE_TONE_NAVIGATION_FIXTURE_FILENAME),f.bytes,{flag:'wx'});
 await writeFile(join(directory,LIVE_TONE_NAVIGATION_MANIFEST_FILENAME),JSON.stringify(f.manifest,null,2)+'\n',{flag:'wx'});
 return f.manifest;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){assert.equal(process.argv.length,3,'Usage: prepare-live-tone-navigation-fixtures.mjs <fresh-directory>');console.log(JSON.stringify(await prepareLiveToneNavigationFixtures(resolve(process.argv[2]))));}

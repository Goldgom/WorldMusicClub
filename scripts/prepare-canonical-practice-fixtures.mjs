// One self-authored four-part score in canonical JSON and equivalent MusicXML.
// Public CC0 mechanical gates only; no supplied music is read by this generator.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {digest} from '../tests/clean-song-package-fixtures.js';
export const CANONICAL_PRACTICE_PHASES=Object.freeze(['canonical-practice-seed','canonical-practice-controls','canonical-practice-restart']);
export const CANONICAL_PRACTICE_FILES=Object.freeze({json:'canonical-practice-original.json',musicxml:'canonical-practice-original.musicxml'});
export const CANONICAL_PARTS=Object.freeze(['P1','P2','P3','P4']);
export function canonicalPracticeFixture(){
 const beat=n=>({numerator:n,denominator:1}),pitch=(step,octave)=>({step,alter:0,octave});
 const n=(id,at,duration,p=null,extra={})=>({id,at:beat(at),duration:beat(duration),pitch:p,voice:'1',staff:1,velocity:90,tie_start:false,tie_stop:false,...extra});
 const score={version:1,id:'original-canonical-four-part',title:'Original canonical four-part gates',composer:'WorldMusicClub test authors',provenance:{kind:'original',attribution:'Self-authored mechanical four-part acceptance score; no supplied or third-party music',source_url:null,license:'CC0-1.0'},parts:[
  {id:'P1',name:'Piano lead',instrument:'piano',notes:[n('lead-rest',0,3),n('lead-c5',3,1,pitch('C',5)),n('lead-gap',4,2),n('lead-e5',6,2,pitch('E',5))]},
  {id:'P2',name:'Piano harmony',instrument:'piano',notes:[n('harmony-rest',0,3),n('harmony-c5',3,1,pitch('C',5),{tie_start:true}),n('harmony-c5-tail',4,1,pitch('C',5),{tie_stop:true}),n('harmony-gap',5,1),n('harmony-g4',6,2,pitch('G',4))]},
  {id:'P3',name:'Piano pulse',instrument:'piano',notes:[n('pulse-g3',0,4,pitch('G',3)),n('pulse-a3',4,4,pitch('A',3))]},
  {id:'P4',name:'Piano bass',instrument:'piano',notes:[n('bass-c3',0,4,pitch('C',3),{tie_start:true}),n('bass-c3-tail',4,4,pitch('C',3),{tie_stop:true})]}
 ],tempo:[{at:beat(0),bpm:120}],meters:[{at:beat(0),numerator:4,denominator:4}],keys:[],measures:[{number:1,at:beat(0),length:beat(4)},{number:2,at:beat(4),length:beat(4)}],repeats:[],source:null};
 const noteXml=note=>`<note>${note.pitch?`<pitch><step>${note.pitch.step}</step><octave>${note.pitch.octave}</octave></pitch>`:'<rest/>'}<duration>${note.duration.numerator}</duration>${note.tie_start?'<tie type="start"/>':''}${note.tie_stop?'<tie type="stop"/>':''}<voice>1</voice><staff>1</staff></note>`;
 const xml=`<?xml version="1.0" encoding="UTF-8"?>\n<!-- Original mechanical test material, CC0-1.0. -->\n<score-partwise version="4.0"><work><work-title>${score.title}</work-title></work><identification><creator type="composer">${score.composer}</creator><rights>CC0-1.0; original authored acceptance exercise</rights></identification><part-list>${score.parts.map(p=>`<score-part id="${p.id}"><part-name>${p.name}</part-name><score-instrument id="I${p.id}"><instrument-name>Piano</instrument-name></score-instrument></score-part>`).join('')}</part-list>${score.parts.map(p=>`<part id="${p.id}">${[0,4].map((at,i)=>`<measure number="${i+1}">${i===0?'<attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes><direction><sound tempo="120"/></direction>':''}${p.notes.filter(n=>n.at.numerator>=at&&n.at.numerator<at+4).map(noteXml).join('')}</measure>`).join('')}</part>`).join('')}</score-partwise>\n`;
 const files=new Map([[CANONICAL_PRACTICE_FILES.json,Buffer.from(`\n${JSON.stringify(score,null,2)}\r\n`)],[CANONICAL_PRACTICE_FILES.musicxml,Buffer.from(xml)]]);
 const manifest={version:1,generator:'scripts/prepare-canonical-practice-fixtures.mjs',rights:score.provenance,score_id:score.id,parts:CANONICAL_PARTS,duration_ms:4000,source_note_ids:score.parts.flatMap(p=>p.notes.map(n=>n.id)),pitched_source_notes:9,compiled_occurrences:7,human_parts:['P1','P2'],human_source_ids:['lead-c5','lead-e5','harmony-c5','harmony-c5-tail','harmony-g4'],machine_parts:['P3','P4'],files:[...files].map(([filename,b])=>({filename,bytes:b.length,sha256:digest(b)}))};
 assert.equal(score.parts.flatMap(p=>p.notes).filter(n=>n.pitch).length,manifest.pitched_source_notes);
 return{score,files,manifest};
}
export async function prepareCanonicalPracticeFixtures(directory){const f=canonicalPracticeFixture();await mkdir(directory,{recursive:true});for(const[name,bytes]of [...f.files,['canonical-practice-fixtures.json',JSON.stringify(f.manifest,null,2)+'\n']])await writeFile(join(directory,name),bytes,{flag:'wx'});return f.manifest;}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){assert.equal(process.argv.length,3,'Usage: prepare-canonical-practice-fixtures.mjs <fresh-directory>');console.log(JSON.stringify(await prepareCanonicalPracticeFixtures(resolve(process.argv[2]))));}

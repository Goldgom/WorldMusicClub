import './reference-native-acceptance.test.js';
import './reference-native-evidence.test.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {verifyDownloads} from '../scripts/verify-desktop-evidence.mjs';
import {FreePracticeRecorder} from '../web/free-practice-recorder.js';
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
async function evidence() {
  const directory=await mkdtemp(join(tmpdir(),'wmh-native-evidence-'));await mkdir(join(directory,'downloads'));
  const score={id:'source-test',parts:[],source:{format:'musicxml',content:await readFile(new URL('./fixtures/original-duet.musicxml',import.meta.url),'utf8')},rational:{numerator:1,denominator:3}};
  const recorder=new FreePracticeRecorder({id:'acceptance-fixture',createdAt:'2026-10-01T00:00:00.000Z'});recorder.start(100);
  const record=recorder.stop(200,'2026-10-01T00:00:01.000Z');
  const values=[score,{format:'worldmusichub-library-backup',version:1,entries:[{score},{score}]},record,{format:'worldmusichub-performance-backup',version:1,entries:[{record}]}];
  const report={phase:'seed',ok:true,scoreHash:hash(score),performanceHash:hash(record),files:Object.fromEntries(['canonicalFile','scoreBackup','recordFile','performanceBackup'].map((kind,i)=>[kind,`seed-${i+1}.json`])),downloads:values.map((_,i)=>({file:`seed-${i+1}.json`,complete:true,success:true}))};
  for(const [index,value]of values.entries())await writeFile(join(directory,'downloads',`seed-${index+1}.json`),JSON.stringify(value));
  return{directory,report,values};
}
test('native file verifier requires actual matching canonical, backup and sealed-record bytes',async()=>{
  const {directory,report}=await evidence();try {
    const files=await verifyDownloads(directory,report);assert.equal(files.length,4);assert.ok(files.every(file=>file.bytes>0&&file.sha256.length===64));
    await writeFile(join(directory,'downloads','seed-1.json'),JSON.stringify({id:'lost source'}));
    await assert.rejects(verifyDownloads(directory,report),/Written canonical score differs/);
  }finally{await rm(directory,{recursive:true,force:true});}
});
test('a successful native event cannot stand in for a missing or altered backup file',async()=>{
  const {directory,report,values}=await evidence();try {
    values[1].entries[0]={score:{changed:true}};await writeFile(join(directory,'downloads','seed-2.json'),JSON.stringify(values[1]));
    await assert.rejects(verifyDownloads(directory,report),/lost canonical content/);
    await rm(join(directory,'downloads','seed-1.json'));
    await assert.rejects(verifyDownloads(directory,report),{code:'ENOENT'});
  }finally{await rm(directory,{recursive:true,force:true});}
});

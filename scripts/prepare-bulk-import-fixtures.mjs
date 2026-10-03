import {mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {authoredLegacyPack,storedZip} from '../tests/native-import-driver-fixtures.js';
import {authoredImportScore} from '../tests/bulk-import-fixtures.js';

export function bulkAcceptanceFixtures(){
 const pack=authoredLegacyPack(),conflict={...structuredClone(pack.scores[0]),title:'Original conflicting batch edition'},failure=authoredImportScore('authored-bulk-failure','Original blocked batch save');
 const files=new Map([[pack.filename,pack.bytes],['bulk-standard-a.json',Buffer.from(JSON.stringify(pack.scores[0]))],['bulk-standard-b.json',Buffer.from(JSON.stringify(pack.scores[1]))],['bulk-conflict.zip',storedZip([['edition/score.wmhscore.json',JSON.stringify(conflict)]])],['bulk-backup.json',Buffer.from(JSON.stringify({format:'worldmusichub-library-backup',version:1,entries:pack.scores.map(score=>({label:null,score}))}))],['bulk-failure.zip',storedZip([['failure/score.wmhscore.json',JSON.stringify(failure)]])],['bulk-malformed.zip',Buffer.from('PK\u0003\u0004Original intentionally incomplete test ZIP')]]);
 return{files,scores:[...pack.scores,conflict],failure,manifest:{format:'worldmusichub-authored-bulk-fixtures',version:1,files:[...files].map(([name,bytes])=>({name,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')})),score_ids:[...pack.scores,conflict].map(score=>score.id),score_titles:[...pack.scores,conflict].map(score=>score.title)}};
}
export async function prepareBulkFixtures(directory){const fixtures=bulkAcceptanceFixtures();await mkdir(directory,{recursive:true});for(const [name,bytes]of fixtures.files)await writeFile(path.join(directory,name),bytes,{flag:'wx'});await writeFile(path.join(directory,'bulk-fixtures.json'),JSON.stringify(fixtures.manifest,null,2)+'\n',{flag:'wx'});return fixtures.manifest}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){if(process.argv.length!==3)throw Error('Usage: node scripts/prepare-bulk-import-fixtures.mjs <fresh-fixture-directory>');console.log(JSON.stringify(await prepareBulkFixtures(path.resolve(process.argv[2]))))}

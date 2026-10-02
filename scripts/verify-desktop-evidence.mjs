import {readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {validatePerformanceRecord} from '../web/performance-library.js';
const hash=value=>createHash('sha256').update(value).digest('hex');
const objectHash=value=>hash(JSON.stringify(value));
const assert=(condition,message)=>{if(!condition)throw Error(message);};

/** Verify the bytes Windows wrote, independently of download-event success. */
export async function verifyDownloads(directory,report) {
  assert(report.ok && report.phase==='seed','Seed renderer did not pass');
  const files=report.files;assert(files && Object.keys(files).length===4,'Four actual export files are required');
  const artifacts=[],originalXml=await readFile(new URL('../tests/fixtures/original-duet.musicxml',import.meta.url),'utf8');
  for(const [kind,file]of Object.entries(files)) {
    assert(/^seed-(?:[1-9]|1[0-6])\.json$/.test(file),'Invalid evidence filename');
    assert(report.downloads.some(row=>row.file===file&&row.complete&&row.success),'Missing native download-completion event');
    const bytes=await readFile(join(directory,'downloads',file));
    assert(bytes.length>0&&bytes.length<=80*1024*1024,'Invalid exported-file size');
    const value=JSON.parse(bytes.toString('utf8'));
    if(kind==='canonicalFile'){assert(objectHash(value)===report.scoreHash,'Written canonical score differs from saved/imported score');assert(value.source?.format==='musicxml'&&value.source.content===originalXml,'Written canonical source does not retain the exact imported MusicXML fixture');}
    else if(kind==='scoreBackup') {
      assert(value.format==='worldmusichub-library-backup'&&value.version===1&&value.entries.length===2,'Wrong score backup format/count');
      assert(value.entries.every(entry=>objectHash(entry.score)===report.scoreHash),'Written score backup lost canonical content');
    } else if(kind==='recordFile') {
      validatePerformanceRecord(value);assert(objectHash(value)===report.performanceHash,'Written sealed recording changed');
    } else if(kind==='performanceBackup') {
      assert(value.format==='worldmusichub-performance-backup'&&value.version===1&&value.entries.length===1,'Wrong performance backup format/count');
      for(const entry of value.entries){validatePerformanceRecord(entry.record);assert(objectHash(entry.record)===report.performanceHash,'Written performance backup changed sealed observations');}
    } else throw Error('Unknown exported-file kind');
    artifacts.push({kind,file,bytes:bytes.length,sha256:hash(bytes),content_sha256:objectHash(value)});
  }
  return artifacts;
}
async function main() {
  const directory=resolve(process.argv[2]||'desktop-acceptance');
  const report=JSON.parse(await readFile(join(directory,'renderer-seed.json'),'utf8'));
  const artifacts=await verifyDownloads(directory,report);
  for(const phase of ['restart','close-active','reopen']) {
    const next=JSON.parse(await readFile(join(directory,`renderer-${phase}.json`),'utf8'));
    assert(next.ok&&next.phase===phase&&next.origin===report.origin,`${phase} renderer did not pass`);
    assert(next.scoreCount===4&&next.performanceCount===2,`${phase} did not retain both libraries`);
    if(phase==='close-active')assert(next.activeAtClose==='recording','Active-close gate was not recording');
  }
  await writeFile(join(directory,'downloaded-files.json'),JSON.stringify({version:1,ok:true,artifacts},null,2)+'\n');
  console.log(`Verified ${artifacts.length} actual downloaded JSON files and three profile reopens`);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(error=>{console.error(error.message);process.exitCode=1;});

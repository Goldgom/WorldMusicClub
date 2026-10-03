import {createHash} from 'node:crypto';
import {nativeScoreServer,nativeResponse,authoredScore} from './native-storage-app-fixtures.js';

export function importFile(name,content){const bytes=typeof content==='string'?Buffer.from(content):Buffer.from(content);const file=new Blob([bytes],{type:'application/octet-stream'});Object.defineProperty(file,'name',{value:name});return file}
export const importItem=(overrides={})=>({index:0,path:'score.wmhscore.json',title:'Original synthetic exercise',status:'ready',code:'pack_ready',message:'Complete score validated',playable:true,...overrides});
export function importReport(file,{mode='preview',items=[importItem()],retained=mode==='commit',sha256='a'.repeat(64)}={}){return{format:'worldmusichub-import-report',version:1,mode,source:{filename:file.name,bytes:file.size,sha256,retained,archive_key:retained?`import-${sha256}`:null},items,summary:Object.fromEntries(['ready','saved','duplicate','conflict','retained_nonplayable','error'].map(key=>[key,items.filter(item=>item.status===key).length])),inventory:{files:items.length,expanded_bytes:file.size},warnings:[]}}

/** Authored protocol fixture only; real Rust/native persistence is a separate gate. */
export async function bulkNativeFixture({scores=[],sources={}}={}){
 const server=await nativeScoreServer({scores}),originals=new Map();let override=null;
 server.setRoute(async request=>{
  const custom=await override?.(request);if(custom!==undefined)return custom;
  const {path,body,options}=request;
  if(path==='/api/library/imports')return nativeResponse({format:'worldmusichub-import-history',version:1,imports:[...originals.values()].map(({blob,...row})=>row),issues:[]});
  if(path==='/api/library/import/export'){const original=originals.get(body.archive_key);return original?{...nativeResponse(null),blob:async()=>original.blob}:nativeResponse({code:'pack_not_found',error:'Original missing'},404)}
  if(!['/api/library/import/preview','/api/library/import/commit'].includes(path))return undefined;
  const file=body,filename=decodeURIComponent(options.headers['x-wmh-filename']),bytes=Buffer.from(await file.arrayBuffer()),sha256=createHash('sha256').update(bytes).digest('hex'),source=sources[filename]||[{path:filename,score:JSON.parse(bytes.toString())}],mode=path.endsWith('/commit')?'commit':'preview',items=[];
  for(let index=0;index<source.length;index++){
   const value=source[index],score=value.score,item=importItem({index,path:value.path,title:score?.title||value.title||value.path,playable:Boolean(score)});
   if(!score){Object.assign(item,{status:'retained_nonplayable',code:'pack_unsupported',message:'Original authored events retained; no canonical score available.'});items.push(item);continue}
   const exact=[...server.records.values()].find(row=>JSON.stringify(JSON.parse(row.score_json))===JSON.stringify(score)),conflict=[...server.records.values()].find(row=>row.entry.score_id===score.id);
   if(exact)Object.assign(item,{status:'duplicate',entry:exact.entry});else if(conflict)Object.assign(item,{status:'conflict',code:'library_id_conflict',message:'A different score shares this ID.'});
   const selected=options.headers['x-wmh-item-index'];
   if(mode==='commit'&&(selected===undefined||Number(selected)===index)){
    const saved=await server.fetcher('/api/library/save',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({score_json:value.raw||JSON.stringify(score),allow_conflicting_id:options.headers['x-wmh-conflict']==='keep-both'})}),result=await saved.json();
    if(saved.ok)Object.assign(item,{status:'saved',entry:result});else Object.assign(item,{status:result.code==='library_duplicate'?'duplicate':result.code==='library_id_conflict'?'conflict':'error',code:result.code,message:result.error,...(result.existing?{entry:result.existing}:{})});
   }
   items.push(item);
  }
  const report=importReport(file,{mode,items,sha256});
  if(mode==='commit')originals.set(report.source.archive_key,{archive_key:report.source.archive_key,filename,bytes:bytes.length,sha256,report,blob:new Blob([bytes])});
  return nativeResponse(report);
 });
 return{...server,originals,setImportRoute:fn=>{override=fn}};
}

export function selectImportFiles(app,files,input='score-file'){Object.defineProperty(app.$(input),'files',{configurable:true,value:files});app.emit(app.$(input),'change')}
export const authoredImportScore=(id,title=id)=>authoredScore({id,title,source:{format:'authored-batch-fixture',filename:'retained-original.txt',content:'\uFEFFNewly authored import test only\r\n{unmodified: [1, 2, 3]}\r\n'}});

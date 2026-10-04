// CI transport only. The shipped Rust server serves its embedded, bounded web
// inventory; the native library still uses the real socket-free stdio driver.
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {createServer} from 'node:net';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
export const NATIVE_PROTOCOL_ORIGIN='https://wmh.localhost';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
export function validateHostedOrigin(origin){
 assert.match(origin,/^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}$/,'An explicit IPv4 loopback HTTP origin is required');
 assert.equal(new URL(origin).origin,origin);return origin;
}
export function validateRendererOrigin(expectedOrigin=NATIVE_PROTOCOL_ORIGIN){
 if(expectedOrigin!==NATIVE_PROTOCOL_ORIGIN)validateHostedOrigin(expectedOrigin);return expectedOrigin;
}
export function mapHostedNativeHeaders({url,method,headers},origin){
 validateHostedOrigin(origin);const target=new URL(url),authority=new URL(origin).host;
 assert.equal(target.origin,origin,'Hosted request left its exact loopback origin');assert.equal(target.username+target.password+target.hash,'');
 assert.ok(target.pathname.startsWith('/api/'),'Only application API requests may enter native stdio');
 assert.ok(['GET','POST'].includes(method),'Unsupported hosted native method');
 assert.equal(headers.host,authority,'Hosted request Host must match the actual listener');
 if(headers.origin!==undefined)assert.equal(headers.origin,origin,'Foreign hosted Origin');
 if(method==='POST')assert.equal(headers.origin,origin,'Hosted mutation requires its exact Origin');
 assert.equal(headers['sec-fetch-site'],'same-origin','Native requests require browser same-origin admission');
 const mapped={...headers,host:new URL(NATIVE_PROTOCOL_ORIGIN).host};
 if(headers.origin!==undefined)mapped.origin=NATIVE_PROTOCOL_ORIGIN;
 // Hop-by-hop browser transport headers have no meaning on socket-free stdio.
 for(const key of ['connection','content-length','transfer-encoding','accept-encoding'])delete mapped[key];
 return {headers:mapped,mapping:{hosted_origin:origin,native_protocol_origin:NATIVE_PROTOCOL_ORIGIN,incoming_host:headers.host,incoming_origin:headers.origin??null,method,path:target.pathname+target.search,sec_fetch_site:headers['sec-fetch-site']}};
}
export function createHostedNativeBridge({origin,requestTimeoutMs=10000,maxRequests=256}){
 validateHostedOrigin(origin);assert.ok([10000,30000].includes(requestTimeoutMs));
 const pending=new Set(),evidence={origin,native_protocol_origin:NATIVE_PROTOCOL_ORIGIN,requests:[],drain:null};let closing=false,drainPromise;
 return {evidence,get closing(){return closing;},stopAdmission(){closing=true;},
  async run(request,operation){
   assert.equal(closing,false,'Hosted native admission is closed');assert.ok(evidence.requests.length<maxRequests,'Hosted native request evidence bound');assert.ok(pending.size<16,'Hosted native pending request bound');
   const mapped=mapHostedNativeHeaders({url:request.url(),method:request.method(),headers:await request.allHeaders()},origin);
   assert.equal(closing,false,'Hosted native admission closed during header read');
   const row={...mapped.mapping,status:'pending',request_timeout_ms:requestTimeoutMs};evidence.requests.push(row);let timer;
   const operationPromise=Promise.resolve().then(()=>operation(mapped.headers,row));
   const task=Promise.race([operationPromise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(`Hosted native ${row.path} exceeded its ${requestTimeoutMs}ms request bound`)),requestTimeoutMs);})]);
   pending.add(task);try{const value=await task;row.status='settled';return value;}catch(error){row.status='failed';row.error=String(error?.message||error).slice(0,512);throw error;}finally{clearTimeout(timer);pending.delete(task);}
  },
  drain(){if(drainPromise)return drainPromise;closing=true;drainPromise=(async()=>{const admitted=[...pending];evidence.drain={admitted:admitted.length,pending_paths:evidence.requests.filter(row=>row.status==='pending').map(row=>row.path),status:'pending'};
   const results=await Promise.allSettled(admitted);evidence.drain.status=results.some(row=>row.status==='rejected')?'failed':'complete';
   if(evidence.drain.status==='failed')throw Error('An already-admitted hosted native request failed while draining');
  })();return drainPromise;}
 };
}
export async function boundedHostedResponse(response,maximum=1024*1024){
 assert.ok(Number(response.headers.get('content-length')||0)<=maximum,'Hosted resource Content-Length bound');
 const reader=response.body.getReader(),chunks=[];let bytes=0;
 try{for(;;){const row=await reader.read();if(row.done)break;bytes+=row.value.length;assert.ok(bytes<=maximum,'Hosted resource byte bound');chunks.push(Buffer.from(row.value));}}catch(error){await reader.cancel();throw error;}finally{reader.releaseLock();}
 return Buffer.concat(chunks);
}
export async function verifyHostedWorkletAssets({root,sourceSha,origin,fetcher=fetch,sourceReader}){
 validateHostedOrigin(origin);assert.match(sourceSha,/^[a-f0-9]{40}$/);
 const readSource=sourceReader||((name)=>execFileSync('git',['show',`${sourceSha}:web/${name}`],{cwd:root,maxBuffer:1024*1024}));
 const queue=['basic-key-audio-processor.js'],seen=new Set(),receipts=[];let total=0;
 for(const name of queue){if(seen.has(name))continue;assert.match(name,/^[a-z0-9-]+\.js$/,'Worklet import must be a checked-in sibling JavaScript asset');assert.ok(seen.size<16,'Worklet import closure bound');seen.add(name);
  const source=Buffer.from(await readSource(name));total+=source.length;assert.ok(source.length<=1024*1024&&total<=8*1024*1024,'Worklet source byte bound');
  const url=`${origin}/${name}`,response=await fetcher(url,{redirect:'error',signal:AbortSignal.timeout(10000)});assert.equal(response.status,200,`Real server did not serve ${name}`);assert.equal(response.url,url);assert.match(response.headers.get('content-type')||'',/^text\/javascript(?:;|$)/);const body=await boundedHostedResponse(response);assert.equal(hash(body),hash(source),`Embedded asset differs from frozen source: ${name}`);
  receipts.push({kind:'real-http-source-byte-probe',url,method:'GET',status:response.status,path:`web/${name}`,source_sha:sourceSha,bytes:body.length,sha256:hash(body)});
  for(const match of source.toString('utf8').matchAll(/\bimport\s+(?:[^'";]+?\s+from\s+)?['"]([^'"]+)['"]/g)){assert.match(match[1],/^\.\/[a-z0-9-]+\.js$/,'Worklet import left its same-origin sibling assets');queue.push(match[1].slice(2));}
 }
 assert.ok(receipts.length>=4,'The complete shipped Worklet import closure is required');return receipts;
}
// All injectable boundaries below exist so tests never launch a real listener,
// process or browser. Production callers still need both explicit CI gates.
export async function startHostedAssetServer({root,sourceSha,binary=resolve(root,'target/debug/practice-server'),evidence={},environment=process.env,boundary={}}){
 assert.equal(environment.GITHUB_ACTIONS,'true','Only authorized hosted Actions may launch the asset server');assert.equal(environment.WMH_HOSTED_BROWSER,'1','Only authorized hosted browser checks may launch the asset server');
 assert.match(sourceSha,/^[a-f0-9]{40}$/);const bytes=await (boundary.readFile||readFile)(binary);
 Object.assign(evidence,{kind:'exact-source-practice-server',source_sha:sourceSha,binary,server_bytes:bytes.length,server_sha256:hash(bytes),bind:'127.0.0.1',status:'starting',assets:[],log:'',cleanup:{status:'pending'}});
 const reservation=(boundary.createServer||createServer)();let server,exited,exitResult,spawnError;
 const close=async()=>{
  if(!server){evidence.cleanup={status:'not-started'};return;}
  if(exitResult){evidence.cleanup={status:'failed',...exitResult};throw Error('Hosted asset server exited before owned cleanup');}
  evidence.cleanup.status='closing';server.kill('SIGTERM');let timer;
  try{await Promise.race([exited,new Promise((_,reject)=>timer=setTimeout(()=>{server.kill('SIGKILL');reject(Error('Hosted asset server close exceeded 5000ms'));},5000))]);assert.equal(spawnError,undefined);assert.ok(exitResult.signal==='SIGTERM'||exitResult.code===0,'Unexpected asset-server exit');evidence.cleanup={status:'closed',...exitResult};}catch(error){evidence.cleanup={status:'failed',error:String(error)};throw error;}finally{clearTimeout(timer);}
 };
 try{
  await new Promise((resolve,reject)=>{reservation.once('error',reject);reservation.listen(0,'127.0.0.1',resolve);});const port=reservation.address().port;validateHostedOrigin(`http://127.0.0.1:${port}`);await new Promise((resolve,reject)=>reservation.close(error=>error?reject(error):resolve()));
  const origin=`http://127.0.0.1:${port}`;evidence.origin=origin;server=(boundary.spawn||spawn)(binary,['--no-open','--port',String(port)],{cwd:root,stdio:['ignore','pipe','pipe']});evidence.process_id=server.pid;
  exited=new Promise(resolve=>{server.once('error',error=>{spawnError=error;resolve();});server.once('exit',(code,signal)=>{exitResult={code,signal};resolve();});});
  for(const stream of [server.stdout,server.stderr])stream.on('data',chunk=>{evidence.log=(evidence.log+chunk).slice(-32768);});
  const fetcher=boundary.fetch||fetch,sleep=boundary.sleep||(ms=>new Promise(resolve=>setTimeout(resolve,ms)));let ready=false;
  for(let count=0;count<120;count++){if(spawnError)throw spawnError;if(exitResult)throw Error(`Asset server exited during startup: ${evidence.log}`);try{const response=await fetcher(`${origin}/api/health`,{redirect:'error',signal:AbortSignal.timeout(1000)});if(response.ok){await boundedHostedResponse(response,32768);ready=true;break;}}catch{}await sleep(100);}
  assert.ok(ready,'Hosted asset server did not become ready');evidence.assets=await verifyHostedWorkletAssets({root,sourceSha,origin,fetcher,sourceReader:boundary.sourceReader});evidence.status='ready';
  return {origin,evidence,close};
 }catch(error){evidence.status='failed';evidence.error=String(error?.stack||error);try{if(reservation.listening)await new Promise(resolve=>reservation.close(resolve));await close();}catch(cleanupError){evidence.cleanup.error=String(cleanupError);}throw error;}
}
export function validateHostedAssetEvidence(evidence,{origin,sourceSha}){
 validateHostedOrigin(origin);assert.match(sourceSha,/^[a-f0-9]{40}$/);assert.equal(evidence.origin,origin);assert.equal(evidence.source_sha,sourceSha);assert.equal(evidence.bind,'127.0.0.1');assert.equal(evidence.status,'ready');assert.equal(evidence.cleanup.status,'closed');assert.match(evidence.server_sha256,/^[a-f0-9]{64}$/);assert.ok(evidence.server_bytes>0);assert.ok(evidence.assets.length>=4&&evidence.assets.length<=16);
 assert.equal(new Set(evidence.assets.map(row=>row.path)).size,evidence.assets.length,'Worklet source receipts must be distinct');
 for(const row of evidence.assets){assert.equal(row.kind,'real-http-source-byte-probe');assert.equal(row.source_sha,sourceSha);assert.equal(row.status,200);assert.equal(row.method,'GET');assert.equal(row.url,`${origin}/${row.path.slice(4)}`);assert.match(row.sha256,/^[a-f0-9]{64}$/);assert.ok(row.bytes>0&&row.bytes<=1024*1024);}
 for(const name of ['processor','core','plan'])assert.ok(evidence.assets.some(row=>row.path===`web/basic-key-audio-${name}.js`));assert.ok(evidence.assets.some(row=>row.path==='web/basic-key-rendition.js'));
}

// Pure transport-boundary tests: no HTTP listener, browser or child is launched.
import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {mapHostedNativeHeaders,validateHostedOrigin,validateRendererOrigin,createHostedNativeBridge,verifyHostedWorkletAssets,startHostedAssetServer,validateHostedAssetEvidence,boundedHostedResponse} from '../scripts/hosted-worklet-assets.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),sha=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),origin='http://127.0.0.1:43210';
const headers={host:'127.0.0.1:43210',origin,'sec-fetch-site':'same-origin','content-type':'application/json','x-wmh-filename':'original.mid'};
function ownedRequest(values={}){
 const state={url:origin+'/',closed:false,detached:false,workers:[],navigation:false,serviceWorker:null,...values.state};
 const page={isClosed:()=>state.closed,url:()=>state.url,workers:()=>state.workers,mainFrame:()=>frame};
 const frame={page:()=>page,url:()=>state.url,isDetached:()=>state.detached};
 const request={url:()=>values.url??`${origin}/api/library/load`,method:()=>values.method??'POST',allHeaders:async()=>values.headers??headers,frame:()=>frame,serviceWorker:()=>state.serviceWorker,isNavigationRequest:()=>state.navigation,resourceType:()=>values.resourceType??'fetch'};
 return {state,page,frame,request};
}
const owned=ownedRequest(),browserRequest=()=>owned.request;
const request=(values={})=>({url:`${origin}/api/library/load`,method:'POST',headers,...values});
const map=value=>{const fixture=ownedRequest(value);return mapHostedNativeHeaders(fixture.request,origin,fixture.page,value.headers);};
const sourceReader=name=>readFile(new URL(`../web/${name}`,import.meta.url));
function response(url,bytes,options={}){const result=new Response(bytes,{status:200,headers:{'content-type':'text/javascript; charset=utf-8'},...options});Object.defineProperty(result,'url',{value:url});return result;}
const fetcher=async url=>response(url,await sourceReader(new URL(url).pathname.slice(1)));
test('native-origin mapping admits the owned main frame and rejects any conflicting supplied header',()=>{
 const original=structuredClone(headers),mapped=map(request());assert.deepEqual(headers,original);assert.equal(mapped.headers.origin,'https://wmh.localhost');assert.equal(mapped.headers.host,'wmh.localhost');assert.equal(mapped.headers['x-wmh-filename'],'original.mid');assert.equal(mapped.mapping.incoming_origin,origin);
 const get=map(request({method:'GET',headers:{host:headers.host,'sec-fetch-site':'same-origin'}}));assert.equal(get.headers.origin,'https://wmh.localhost');assert.equal(get.mapping.incoming_origin,null);
 for(const value of [request({url:'https://wmh.localhost/api/library/load'}),request({url:`${origin}/basic-key-audio-processor.js`}),request({method:'OPTIONS'}),request({method:'PUT'}),request({headers:{...headers,host:'localhost:43210'}}),request({headers:{...headers,origin:'https://evil.example'}}),request({headers:{...headers,'sec-fetch-site':'cross-site'}})])assert.throws(()=>map(value));
 for(const invalid of ['http://localhost:43210','http://127.0.0.2:43210','https://127.0.0.1:43210','http://127.0.0.1:65536',origin+'/',origin+'/path','https://evil.example'])assert.throws(()=>validateHostedOrigin(invalid));
 assert.equal(validateRendererOrigin(),'https://wmh.localhost');assert.equal(validateRendererOrigin(origin),origin);assert.throws(()=>validateRendererOrigin('https://evil.example'));
});
test('real-source Worklet closure receipts compare both source and persistent live transitive modules',async()=>{
 const receipts=await verifyHostedWorkletAssets({root,sourceSha:sha,origin,fetcher});assert.deepEqual(receipts.map(row=>row.path),['web/basic-key-audio-processor.js','web/live-tone-audio-processor.js','web/live-tone-receiver.js','web/canonical-audio-processor.js','web/basic-key-audio-core.js','web/live-tone-core.js','web/canonical-audio-core.js','web/basic-key-audio-plan.js','web/canonical-audio-plan.js','web/practice-selection.js','web/basic-key-rendition.js','web/canonical-audio-fingerprint.js']);assert.ok(receipts.every(row=>row.source_sha===sha&&row.status===200&&row.bytes>0));
 await assert.rejects(verifyHostedWorkletAssets({root,sourceSha:sha,origin,fetcher:async url=>response(url,'modified')}),/differs from frozen source/);
 await assert.rejects(verifyHostedWorkletAssets({root,sourceSha:sha,origin,fetcher:async url=>response(url,'not found',{status:404})}),/did not serve/);
 const remote=Buffer.from("import 'https://foreign.example/module.js';");await assert.rejects(verifyHostedWorkletAssets({root,sourceSha:sha,origin,fetcher:async url=>response(url,remote),sourceReader:async()=>remote}),/same-origin sibling/);
 await assert.rejects(boundedHostedResponse(response(origin,Buffer.alloc(32)),8),/byte bound/);
});
test('drain waits only for already-admitted work and rejects new admission',async()=>{
 const bridge=createHostedNativeBridge({origin,getOwnedPage:()=>owned.page,requestTimeoutMs:30000});let release,called=false;
 const task=bridge.run(browserRequest(),async(mapped,row)=>{called=true;assert.equal(mapped.origin,'https://wmh.localhost');row.native_status=200;await new Promise(resolve=>release=resolve);return 'actual native bytes';});
 await new Promise(resolve=>setImmediate(resolve));assert.equal(called,true);bridge.stopAdmission();let drained=false;const drain=bridge.drain().then(()=>{drained=true;});await new Promise(resolve=>setImmediate(resolve));assert.equal(drained,false);assert.equal(bridge.evidence.drain.admitted,1);await assert.rejects(bridge.run(browserRequest(),()=>{}),/admission is closed/);release();assert.equal(await task,'actual native bytes');await drain;assert.equal(bridge.evidence.requests[0].status,'settled');assert.equal(bridge.evidence.drain.status,'complete');
});
test('failed admitted requests retain their original cause and fail drain',async()=>{
 const bridge=createHostedNativeBridge({origin,getOwnedPage:()=>owned.page});let reject;const task=bridge.run(browserRequest(),()=>new Promise((_,r)=>reject=r));await new Promise(resolve=>setImmediate(resolve));const drain=bridge.drain();reject(Error('original native failure'));await assert.rejects(task,/original native failure/);await assert.rejects(drain,/already-admitted/);assert.match(bridge.evidence.requests[0].error,/original native failure/);assert.equal(bridge.evidence.drain.status,'failed');
});
function fakeBoundary(){
 const calls=[],reservation=new EventEmitter();reservation.listen=(port,host,done)=>{calls.push(['listen',port,host]);reservation.listening=true;done();};reservation.address=()=>({port:43210});reservation.close=done=>{calls.push(['release']);reservation.listening=false;done();};
 const child=new EventEmitter();child.pid=123;child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.kill=signal=>{calls.push(['kill',signal]);queueMicrotask(()=>child.emit('exit',null,signal));return true;};
 return {calls,child,boundary:{createServer:()=>reservation,readFile:async()=>Buffer.from('fake server bytes'),spawn:(binary,args,options)=>{calls.push(['spawn',binary,args,options]);return child;},fetch:async url=>url.endsWith('/api/health')?response(url,'{"engine":"rust"}'):fetcher(url),sourceReader,sleep:async()=>{}}};
}
test('CI launcher uses ephemeral IPv4 reservation, existing binary and owned close at fake boundaries',async()=>{
 const {calls,boundary}=fakeBoundary(),evidence={};const server=await startHostedAssetServer({root,sourceSha:sha,evidence,environment:{GITHUB_ACTIONS:'true',WMH_HOSTED_BROWSER:'1'},boundary});assert.deepEqual(calls.slice(0,2),[['listen',0,'127.0.0.1'],['release']]);assert.deepEqual(calls[2][2],['--no-open','--port','43210']);assert.equal(server.origin,origin);assert.equal(evidence.status,'ready');await server.close();validateHostedAssetEvidence(evidence,{origin,sourceSha:sha});assert.deepEqual(calls.at(-1),['kill','SIGTERM']);
 const bad=structuredClone(evidence);bad.origin='http://localhost:43210';assert.throws(()=>validateHostedAssetEvidence(bad,{origin,sourceSha:sha}));
});
test('launcher refuses unauthorized environments before touching any listener or process',async()=>{
 for(const environment of [{},{GITHUB_ACTIONS:'false',WMH_HOSTED_BROWSER:'1'},{GITHUB_ACTIONS:'true',WMH_HOSTED_BROWSER:'0'}]){let touched=false;await assert.rejects(startHostedAssetServer({root,sourceSha:sha,environment,boundary:{readFile:async()=>{touched=true;throw Error('must not run');}}}),/Only authorized/);assert.equal(touched,false);}
});
test('probe failure retains its cause and closes the launched fake child',async()=>{
 const {calls,boundary}=fakeBoundary(),evidence={};boundary.fetch=async url=>response(url,'wrong embedded source');await assert.rejects(startHostedAssetServer({root,sourceSha:sha,evidence,environment:{GITHUB_ACTIONS:'true',WMH_HOSTED_BROWSER:'1'},boundary}),/differs from frozen source/);assert.equal(evidence.status,'failed');assert.match(evidence.error,/differs from frozen source/);assert.equal(evidence.cleanup.status,'closed');assert.deepEqual(calls.at(-1),['kill','SIGTERM']);
});

test('existing production embedding rejects symlinks and bounds source paths and bytes',async()=>{
 const build=await readFile(new URL('../crates/practice-server/build.rs',import.meta.url),'utf8');
 for(const marker of ['symlink_metadata','file_type().is_symlink()','canonical.starts_with(root)','limits.files','limits.file_bytes','limits.total_bytes','limits.depth'])assert.ok(build.includes(marker),marker);
 const server=await readFile(new URL('../crates/practice-server/src/main.rs',import.meta.url),'utf8');assert.ok(server.includes('127.0.0.1:{port}'));assert.ok(server.includes('host != Some(authority)'));assert.ok(server.includes('web_asset(asset)'));
 for(const name of ['hosted-basic-key-check.mjs','hosted-dense-rendition-check.mjs']){const source=await readFile(new URL('../scripts/'+name,import.meta.url),'utf8');assert.ok(source.includes('startHostedAssetServer'));assert.ok(source.includes('nativeBridge.run'));assert.ok(source.includes('expectedOrigin:origin'));assert.ok(!source.includes('context.route(`${origin}/**`'));assert.ok(!source.includes('await readFile(file)'));}
});

test('only the named non-acceptance browser preview skips Windows; full acceptance stays mandatory',()=>{
 const parse=name=>JSON.parse(execFileSync('python3',['scripts/check-authoring-workflow.py','--json',`.github/workflows/${name}`],{cwd:root,encoding:'utf8'}));
 const preview=parse('basic-key-preview.yml'),full=parse('windows-desktop-acceptance.yml');
 assert.deepEqual(preview.on.push.branches,['preview/basic-key','preview/basic-key-browser']);assert.ok(Object.hasOwn(preview.on,'workflow_dispatch'));
 const skipRef='refs/heads/preview/basic-key-browser';assert.equal(preview.jobs['basic-key-windows'].if,"${{ github.ref != 'refs/heads/preview/basic-key-browser' }}");assert.equal(preview.jobs['basic-key-browser'].if,undefined);assert.match(preview['run-name'],/Linux transport preview \(non-acceptance\)/);
 for(const ref of ['refs/heads/preview/basic-key','refs/heads/validation/333','refs/heads/main'])assert.notEqual(ref,skipRef);
 assert.deepEqual(full.on.push.branches,['integration/native-desktop','validation/**']);assert.ok(Object.hasOwn(full.on,'workflow_dispatch'));
 for(const job of ['bulk-import-browser','native-feature-acceptance'])assert.equal(full.jobs[job].if,undefined);assert.deepEqual(full.jobs['acceptance-summary'].needs,['bulk-import-browser','native-feature-acceptance']);assert.equal(full.jobs['acceptance-summary'].if,'${{ always() }}');
});

test('missing source-built executable records failure before touching the listener boundary',async()=>{
 const evidence={};let touched=false;await assert.rejects(startHostedAssetServer({root,sourceSha:sha,evidence,environment:{GITHUB_ACTIONS:'true',WMH_HOSTED_BROWSER:'1'},boundary:{readFile:async()=>{throw Error('missing exact-source executable');},createServer:()=>{touched=true;}}}),/missing exact-source/);assert.equal(touched,false);assert.equal(evidence.status,'failed');assert.equal(evidence.cleanup.status,'not-started');
});

test('paused Chromium headers may omit network-added fields only with explicit live page ownership',async()=>{
 const pausedHeaders={'content-type':'application/json','x-wmh-filename':'original.mid'},fixture=ownedRequest({headers:pausedHeaders}),bridge=createHostedNativeBridge({origin,getOwnedPage:()=>fixture.page});
 let forwarded;await bridge.run(fixture.request,async(mapped,row)=>{forwarded=mapped;assert.equal(row.admission,'owned-live-main-frame');assert.equal(row.native_origin_basis,'verified-owned-frame-origin');assert.equal(row.frame_url,origin+'/');assert.equal(row.owned_main_frame,true);assert.equal(row.incoming_host,null);assert.equal(row.incoming_origin,null);assert.equal(row.sec_fetch_site,null);return 'native response';});
 assert.deepEqual(pausedHeaders,{'content-type':'application/json','x-wmh-filename':'original.mid'});assert.equal(forwarded.origin,'https://wmh.localhost');assert.equal(forwarded.host,'wmh.localhost');await bridge.drain();
});
test('foreign, detached, frameless, navigation and worker requests cannot invoke native operations',async()=>{
 const mutations=[f=>{f.state.url='https://foreign.example/';},f=>{f.state.closed=true;},f=>{f.state.detached=true;},f=>{f.request.frame=()=>null;},f=>{f.request.frame=()=>{throw Error('No frame for worker');};},f=>{f.frame.page=()=>({});},f=>{f.page.mainFrame=()=>({});},f=>{f.state.navigation=true;},f=>{f.state.serviceWorker={};},f=>{f.state.workers=[{}];},f=>{f.request.resourceType=()=> 'document';},f=>{f.request.url=()=> 'https://foreign.example/api/library/load';}];
 for(const change of mutations){const fixture=ownedRequest({headers:{}});change(fixture);const bridge=createHostedNativeBridge({origin,getOwnedPage:()=>fixture.page});let invoked=false;await assert.rejects(bridge.run(fixture.request,async()=>{invoked=true;}));assert.equal(invoked,false);assert.equal(bridge.evidence.requests.length,0);}
 const fixture=ownedRequest({headers:{}});let invoked=false;await assert.rejects(createHostedNativeBridge({origin,getOwnedPage:()=>null}).run(fixture.request,()=>{invoked=true;}),/owned page/);assert.equal(invoked,false);
});
test('ownership is rechecked after asynchronous headers before any native forwarding',async()=>{
 for(const change of [f=>{f.state.url='https://foreign.example/';},f=>{f.state.url=origin+'/changed';},f=>{f.state.detached=true;},f=>{f.state.closed=true;},f=>{f.state.workers=[{}];},f=>{f.state.serviceWorker={};},f=>{f.state.navigation=true;},f=>{f.currentPage=ownedRequest().page;},f=>{const replacement={...f.frame};f.request.frame=()=>replacement;f.page.mainFrame=()=>replacement;}]){
  const fixture=ownedRequest({headers:{}});fixture.currentPage=fixture.page;fixture.request.allHeaders=async()=>{change(fixture);return {};};const bridge=createHostedNativeBridge({origin,getOwnedPage:()=>fixture.currentPage});let invoked=false;await assert.rejects(bridge.run(fixture.request,()=>{invoked=true;}));assert.equal(invoked,false);assert.equal(bridge.evidence.requests.length,0);
 }
});

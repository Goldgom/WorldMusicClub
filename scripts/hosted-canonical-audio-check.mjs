// Engine-only real Chromium probe. No app UI or private-song acceptance claim.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {resolve,join} from 'node:path';
import {startHostedAssetServer,validateHostedAssetEvidence} from './hosted-worklet-assets.mjs';
import {canonicalProbeScore,validateCanonicalHostedCase} from './canonical-hosted-proof.mjs';
assert.equal(process.env.GITHUB_ACTIONS,'true','Only authorized hosted Actions may run this probe');
assert.equal(process.env.WMH_HOSTED_BROWSER,'1','Only authorized hosted browser runs may launch a browser');
const root=fileURLToPath(new URL('../',import.meta.url));
const sha=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();assert.equal(sha,process.env.WMH_SOURCE_SHA);
assert.equal(execFileSync('git',['status','--porcelain','--untracked-files=normal'],{cwd:root,encoding:'utf8'}).trim(),'');
const output=resolve(root,'test-results/canonical-audio');await mkdir(output,{recursive:true});
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const report={version:1,kind:'original-canonical-engine-browser-probe',source_sha:sha,source_tree:execFileSync('git',['rev-parse','HEAD^{tree}'],{cwd:root,encoding:'utf8'}).trim(),cases:[],pageErrors:[],ok:false,claims:{app_ui:false,native_window:false,private_music:false,physical_listening:false,synthetic_audio_clock:false,injected_host_stalls:true},cleanup:[]};
let server,browser,context,currentPage;
try{
 report.asset_server={};server=await startHostedAssetServer({root,sourceSha:sha,evidence:report.asset_server});
 const {chromium}=await import('playwright');browser=await chromium.launch({headless:true});report.browser=browser.version();context=await browser.newContext({viewport:{width:1280,height:720}});
 await context.route(`${server.origin}/canonical-audio-probe`,route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html lang="en"><meta charset="utf-8"><title>Original engine-only probe</title><button id="start">Start original audio-thread probe</button><pre id="state">Ready</pre></html>'}));
 for(const spec of [{seconds:2,practice:false,stall:false},{seconds:48,practice:true,stall:true}]){
  const score=canonicalProbeScore(spec),sourceBytes=Buffer.from(JSON.stringify(score));await writeFile(join(output,`source-${spec.seconds}.json`),sourceBytes);
  const page=await context.newPage();currentPage=page;page.on('pageerror',e=>report.pageErrors.push(String(e)));let assessments=0;page.on('request',r=>{if(new URL(r.url()).pathname==='/api/assess')assessments++;});await page.goto(`${server.origin}/canonical-audio-probe`);
  await page.evaluate(async ({score,spec})=>{
   const result=globalThis.__canonicalProbe={...spec,ok:false,done:false,errors:[],messages:[],pcm:[],stalls:[],rows:[],physicalListening:false};
   const call=async path=>{const response=await fetch(path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(score)});if(!response.ok)throw Error(`${path}: ${response.status} ${await response.text()}`);return response.json();};
   const [compiled,profile]=await Promise.all([call('/api/compile'),call('/api/canonical-audio-profile')]);
   result.compiledNotes=compiled.timeline.notes.length;result.profile={source_fingerprint:profile.source_fingerprint,compiled_fingerprint:profile.compiled_fingerprint};
   const {CanonicalPlayer,CANONICAL_AUDIO_POLICY}=await import('/canonical-player.js');
   document.getElementById('start').addEventListener('click',()=>{
    const context=new AudioContext(),output=context.createGain();output.gain.value=.2;output.connect(context.destination);
    const player=new CanonicalPlayer({onError:error=>result.errors.push(String(error))});player.select(compiled,profile);
    const timers=[];let probe,probeUrl;
    result.promise=(async()=>{
     await context.resume();result.sampleRate=context.sampleRate;
     const processor='class CanonicalProbe extends AudioWorkletProcessor { constructor(){ super(); this.first=-1;this.frames=0;this.energy=0;this.peak=0;this.nonzero=0;this.bins=0; } process(inputs,outputs){ const input=inputs[0]?.[0]; const length=outputs[0][0].length; if(this.first<0)this.first=currentFrame;for(let i=0;i<length;i++){const x=input?.[i]||0;this.energy+=x*x;this.peak=Math.max(this.peak,Math.abs(x));if(x!==0)this.nonzero++;}this.frames+=length;if(this.frames>=4096){ if(this.bins++>=2048)throw Error("PCM probe bound");this.port.postMessage({firstFrame:this.first,frames:this.frames,energy:this.energy,peak:this.peak,nonzeroSamples:this.nonzero});this.first=-1;this.frames=0;this.energy=0;this.peak=0;this.nonzero=0;}return true;} } registerProcessor("original-canonical-pcm-probe",CanonicalProbe);';
     probeUrl=URL.createObjectURL(new Blob([processor],{type:'text/javascript'}));await context.audioWorklet.addModule(probeUrl);
     probe=new AudioWorkletNode(context,'original-canonical-pcm-probe',{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[1]});
     output.connect(probe);probe.connect(context.destination);probe.onprocessorerror=()=>result.errors.push('PCM observer processor failed');
     probe.port.addEventListener('message',event=>{if(result.pcm.length>=2048){result.errors.push('PCM receipt bound');return;}result.pcm.push({...event.data,trusted:event.isTrusted,nativeMessage:event instanceof MessageEvent});});probe.port.start();
     await player.prepare({context,output,mode:spec.practice?'practice':'listen',practiceSelection:{kind:'parts',part_ids:['original-part-0']},acceptedPolicyId:CANONICAL_AUDIO_POLICY});
     const receiver=player.receiver;result.graph={nativeNode:receiver.node instanceof AudioWorkletNode,nativeContext:receiver.node.context===context,connectedToDestination:output.context===context&&context.destination instanceof AudioDestinationNode};
     receiver.node.port.addEventListener('message',event=>{if(result.messages.length>=64){result.errors.push('Processor receipt bound');return;}result.messages.push({type:event.data?.type,trusted:event.isTrusted,nativeMessage:event instanceof MessageEvent,nativePort:event.currentTarget===receiver.node.port&&event.currentTarget instanceof MessagePort});});
     const ended=new Promise((resolve,reject)=>{player.onEnded=resolve;player.onError=error=>{result.errors.push(String(error));reject(error);};timers.push(setTimeout(()=>reject(Error('Exact-source audio did not end within source duration plus 15 seconds')),(spec.seconds+15)*1000));});
     const anchor=await player.startPrepared({anchorTime:context.currentTime+.05});result.anchorFrame=anchor.anchorFrame;document.getElementById('state').textContent='Running real audio thread';
     if(spec.stall)for(const delay of [5000,25000])timers.push(setTimeout(()=>{const row={wallStart:performance.now(),audioStart:context.currentTime};while(performance.now()-row.wallStart<1200){}row.wallEnd=performance.now();row.audioEnd=context.currentTime;result.stalls.push(row);},delay));
     const terminal=await ended;result.terminal={started:terminal.started,ended:terminal.ended,skipped:terminal.skipped,state:terminal.state};result.clockEndMs=player.sourcePositionMs();
     for(let offset=0;offset<receiver.plan.count;){const audit=await receiver.audit({offset,count:256});if(audit.nextOffset<=offset)throw Error('Nonadvancing audit');result.rows.push(...audit.rows);offset=audit.nextOffset;}
     // Let already-posted PCM/ended messages settle, without changing the audio clock.
     await new Promise(resolve=>setTimeout(resolve,100));result.ok=result.errors.length===0;
    })().catch(error=>{result.error=String(error.stack||error);result.ok=false;}).finally(async()=>{for(const timer of timers)clearTimeout(timer);player.stop();probe?.disconnect();output.disconnect();if(probeUrl)URL.revokeObjectURL(probeUrl);await context.close();result.done=true;document.getElementById('state').textContent=result.ok?'Probe passed':'Probe failed';});
   },{once:true});
  },{score,spec});
  await page.locator('#start').click();await page.waitForFunction(()=>globalThis.__canonicalProbe.done,null,{timeout:(spec.seconds+35)*1000});
  const row=await page.evaluate(()=>{const {promise,...data}=globalThis.__canonicalProbe;return data;});row.assessmentRequests=assessments;row.source_sha256=digest(sourceBytes);report.cases.push(row);row.validation=validateCanonicalHostedCase(row,spec);
  await page.screenshot({path:join(output,`engine-probe-${spec.seconds}.png`)});await page.close();currentPage=null;
 }
 assert.deepEqual(report.pageErrors,[]);report.ok=true;
}catch(error){report.error=String(error.stack||error);process.exitCode=1;if(currentPage)try{report.failureSnapshot=await currentPage.evaluate(()=>{const {promise,...data}=globalThis.__canonicalProbe||{};return data;});await currentPage.screenshot({path:join(output,'engine-failure.png')});}catch(e){report.failureSnapshotError=String(e);}}
finally{
 for(const [name,resource] of [['context',context],['browser',browser],['server',server]])if(resource)try{await resource.close();report.cleanup.push({name,closed:true});}catch(error){report.ok=false;process.exitCode=1;report.cleanup.push({name,closed:false,error:String(error)});}
 if(report.ok)try{validateHostedAssetEvidence(report.asset_server,{origin:server.origin,sourceSha:sha});}catch(error){report.ok=false;process.exitCode=1;report.error=String(error.stack||error);}
 const bytes=Buffer.from(JSON.stringify(report,null,2));assert.ok(bytes.length<=4*1024*1024);await writeFile(join(output,'report.json'),bytes);console.log(JSON.stringify({ok:report.ok,cases:report.cases.map(c=>c.validation),error:report.error}));
}

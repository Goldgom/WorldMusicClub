import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {canonicalPracticeFixture} from '../scripts/prepare-canonical-practice-fixtures.mjs';
import {validateCanonicalMusicalScore,validateCanonicalFrameLedger,ORIGINAL_GATES} from '../scripts/verify-canonical-practice-evidence.mjs';
import {syntheticCanonicalProfile} from './canonical-dom-audio-fixture.js';
import {buildCanonicalAudioPlan,createCanonicalAudioTransfer,CANONICAL_AUDIO_POLICY} from '../web/canonical-audio-plan.js';
import {CanonicalAudioCore} from '../web/canonical-audio-core.js';
import {observeCanonicalPcm} from './canonical-pcm-observer-fixture.js';
import {BasicKeyAudioReceiver} from '../web/basic-key-audio-receiver.js';
import {BasicKeyAudioCore} from '../web/basic-key-audio-core.js';
import {buildBasicKeyAudioPlan} from '../web/basic-key-audio-plan.js';
import {basicKeySong} from './basic-key-rendition-fixtures.js';
import {vsqAcceptanceFixture} from '../scripts/prepare-vsq-song-fixtures.mjs';
import {buildVsqAudioPlan} from '../web/vsq-audio-plan.js';
import {prepareCleanSong,prepareVsqPractice} from '../web/clean-song-package.js';
const compact=runInNewContext(readFileSync(new URL('../crates/desktop-shell/canonical-practice-acceptance.js',import.meta.url),'utf8').split('(() => {')[0]+'\ncompactCanonicalPracticeAudio;',{structuredClone});
function run({range=false,pause=false,listen=false,partial=false,cancelHeld=false,instrumentOverrides}={}){
 const f=canonicalPracticeFixture(),timeline={duration_ms:4000,notes:ORIGINAL_GATES.map(([part_id,midi,start_ms,duration_ms,source_note_ids])=>({id:source_note_ids[0],part_id,midi,start_ms,duration_ms,velocity:90,source_note_id:source_note_ids[0],source_note_ids,voice:'1',staff:1}))},compilation={score:f.score,timeline},profile=syntheticCanonicalProfile(compilation),p=buildCanonicalAudioPlan(compilation,profile,{sampleRate:8000,mode:listen?'listen':'practice',practiceSelection:{kind:'parts',part_ids:['P1','P2']},acceptedPolicyId:CANONICAL_AUDIO_POLICY,instrumentOverrides,...(range?{range:{startMs:1000,endMs:3000},countInMs:2000,loop:{enabled:true,maxPasses:3},...(partial?{resumePositionMs:2000}:{})}:{})}),messages=[],core=new CanonicalAudioCore(p.sampleRate,{emit:(m,t=[])=>messages.push(structuredClone(m,{transfer:t}))}),wire=createCanonicalAudioTransfer(p);let frame=0,paused=false;
 const pcmHash=createHash('sha256');const positionFrame=range?p.initialPositionFrame-p.initialCountInFrames:-16000;core.handleMessage({type:'prepare',generation:1,positionFrame,wire:wire.wire},frame);const block=()=>{const samples=new Float32Array(128);core.process([samples],frame);pcmHash.update(Buffer.from(samples.buffer));frame+=128;};while(core.state==='preparing')block();core.handleMessage({type:'start',generation:1,anchorFrame:frame+64},frame);
 while(core.state==='running'){if((pause||cancelHeld)&&!paused&&frame>(cancelHeld?1024:20000)){paused=true;core.handleMessage({type:'pause',generation:1},frame);for(let i=0;i<(cancelHeld?128:4);i++)block();if(cancelHeld){core.handleMessage({type:'cancel',generation:2,reason:'dispose'},frame);break;}core.handleMessage({type:'resume',generation:1,anchorFrame:frame+64},frame);}block();}
 const t=messages.find(m=>m.type===(cancelHeld?'canceled':'ended')),row={pcmHash:pcmHash.digest('hex'),plan:p,planGeneration:1,positionFrame,started:messages.find(m=>m.type==='started'),terminals:[{record:{...t,ledger:{actualStarts:Array.from(t.ledger.actualStarts),actualEnds:Array.from(t.ledger.actualEnds)}}}],rawTerminals:[{record:{...t,ledger:{actualStarts:Array.from(t.ledger.actualStarts),actualEnds:Array.from(t.ledger.actualEnds)}}}]};return compact([row])[0];
}
test('canonical acceptance uses exactly one original four-part score in two deterministic source formats',()=>{const a=canonicalPracticeFixture(),b=canonicalPracticeFixture();assert.deepEqual(a.manifest,b.manifest);assert.equal(a.manifest.rights.license,'CC0-1.0');validateCanonicalMusicalScore(a.score,a);assert.equal(a.files.size,2);assert.equal(a.manifest.source_note_ids.length,13);assert.equal(ORIGINAL_GATES.length,7);for(const change of [s=>s.parts.pop(),s=>s.parts[1].notes[1].tie_start=false,s=>s.parts[0].notes[1].duration.numerator=2,s=>s.parts[0].notes[1].id='forged']){const score=structuredClone(a.score);change(score);assert.throws(()=>validateCanonicalMusicalScore(score,a));}});
for(const pause of [false,true])test(`canonical complete-frame evidence validates actual production pause=${pause} and rejects one-frame corruption`,()=>{const row=run({pause});validateCanonicalFrameLedger(row,{natural:true});for(const key of ['actualStarts','actualEnds']){const tampered=structuredClone(row);tampered.terminals[0].record.ledger[key][0]++;tampered.rawTerminals[0].record.ledger[key][0]++;assert.throws(()=>validateCanonicalFrameLedger(tampered,{natural:true}));}});
for(const pause of [false,true])test(`canonical range evidence validates production count-in/pass clipping pause=${pause}`,()=>{const row=run({range:true,pause});validateCanonicalFrameLedger(row);assert.equal(row.terminals[0].record.passCount,3);assert.equal(row.terminals[0].record.unusedLedgerEmpty,true);const changed=structuredClone(row);changed.terminals[0].record.unusedLedgerEmpty=false;assert.throws(()=>validateCanonicalFrameLedger(changed));});
test('canonical owned runner never assigns score inputs, dispatches fake events or launches outside hosted actions',()=>{const source=readFileSync(new URL('../crates/desktop-shell/canonical-practice-acceptance.js',import.meta.url),'utf8'),hosted=readFileSync(new URL('../scripts/hosted-canonical-practice-check.mjs',import.meta.url),'utf8');assert.doesNotMatch(source,/dispatchEvent|new KeyboardEvent|\.value\s*=(?!=)|\.checked\s*=(?!=)|setInputFiles|\.click\(/);assert.match(hosted,/GITHUB_ACTIONS!=='true'/);assert.match(hosted,/WMH_SOURCE_SHA,head/);assert.match(source,/readStartFrame:n=>n\[1\],readEndFrame:n=>n\[2\]/);assert.doesNotMatch(source,/sourceSha256\s*:/);});

// The production performance layout moves count-in from the transport into the
// settings dialog. A real owned hit must happen before that dialog closes.
test('canonical count-in acceptance targets the actual open settings owner',async()=>{
 const {canonicalPracticeApp}=await import('./canonical-practice-fixtures.js'),f=await canonicalPracticeApp();
 try{const {app}=f;assert.equal(app.$('count-in').closest('dialog'),app.$('settings-dialog'));await app.click('settings-button');assert.equal(app.$('settings-dialog').open,true);assert.equal(app.$('count-in').disabled,false);
 const source=readFileSync(new URL('../crates/desktop-shell/canonical-practice-acceptance.js',import.meta.url),'utf8');assert.match(source,/await click\('settings-button'\);await click\('loop-enabled'\);if\(\$\('count-in'\)\.checked\)await click\('count-in'\);await close\('settings-dialog'\);await popup\(\)/);
 }finally{await f.app.close();}
});

test('canonical Listen range skips precisely the B-boundary gates, with complete repeated ledgers',()=>{const row=run({range:true,listen:true});validateCanonicalFrameLedger(row,{natural:true});assert.equal(row.terminals[0].record.skipped,2);assert.equal(row.terminals[0].record.started,15);for(const skipped of [0,1,3]){const tampered=structuredClone(row);tampered.terminals[0].record.skipped=skipped;tampered.rawTerminals[0].record.skipped=skipped;assert.throws(()=>validateCanonicalFrameLedger(tampered,{natural:true}));}});
test('canonical partial seek skips exact prior gates and held cancellation releases at the real cancel frame',()=>{const row=run({range:true,listen:true,partial:true,cancelHeld:true});validateCanonicalFrameLedger(row);const t=row.terminals[0].record;assert.equal(t.skipped,4);assert.equal(t.started,3);assert.equal(t.pauseCount,1);assert.equal(t.pauseSpans[1],-1);assert.ok(t.ledger.actualEnds.every(end=>end===t.frame));const tampered=structuredClone(row);tampered.terminals[0].record.ledger.actualEnds[1]--;tampered.rawTerminals[0].record.ledger.actualEnds[1]--;assert.throws(()=>validateCanonicalFrameLedger(tampered));});

test('canonical range oracle rejects an omitted window onset and forged eligibility sets',()=>{const row=run({range:true,listen:true});for(const mutate of [r=>{r.plan.firstRangeOrder=r.plan.firstRangeOrder.slice(1);r.plan.firstGateCount--;},r=>{for(const t of [r.terminals[0].record,r.rawTerminals[0].record]){t.ledger.actualStarts.splice(2,1);t.ledger.actualEnds.splice(2,1);t.recordCount--;t.started--;t.ended--;}}]){const changed=structuredClone(row);mutate(changed);assert.throws(()=>validateCanonicalFrameLedger(changed,{natural:true}));}});

const rustPcmEvidence=JSON.parse(readFileSync(new URL('./fixtures/canonical-audio-evidence.json',import.meta.url)));
const pcmPlan=options=>buildCanonicalAudioPlan(rustPcmEvidence.compilation,rustPcmEvidence.profile,{sampleRate:8000,mode:'listen',acceptedPolicyId:CANONICAL_AUDIO_POLICY,...options});
test('canonical PCM observer reproduces premature exhaustion of all 64 legacy samples during nonzero A/B count-in',async()=>{
 const plan=pcmPlan({range:{startMs:500,endMs:2500},countInMs:2000}),old=await observeCanonicalPcm(plan,{legacy:true}),fixed=await observeCanonicalPcm(plan);
 assert.equal(old.row.pcm.blocks.length,64);assert.ok(old.row.pcm.blocks.every(block=>block.peak===0));
 assert.equal(old.row.pcm.sampling.offsetFrames,12000);assert.equal(fixed.row.pcm.sampling.offsetFrames,16000);
 assert.ok(old.row.pcm.blocks.at(-1).audioTime<old.firstGateFrame/plan.sampleRate,'The old observer stops before the production core first opens its gate');
 assert.equal(fixed.row.pcm.sampling.fromAudioTime,fixed.firstGateFrame/plan.sampleRate);
 assert.ok(fixed.row.pcm.blocks[4].audioTime>=fixed.firstGateFrame/plan.sampleRate,'The reserved evidence starts at the actual planned gate');
 assert.ok(fixed.row.pcm.blocks.some(block=>block.peak>1e-6&&block.rms>1e-8));
 validateCanonicalFrameLedger(fixed.row,{natural:true,pcm:true});assert.throws(()=>validateCanonicalFrameLedger(old.row,{natural:true,pcm:true}),/positive actual PCM/);
});

for(const [name,options,positionMs]of [
 ['full score',{}],['full score count-in',{countInMs:2000}],['legacy full score count-in',{},-2000],
 ['nonzero A/B',{range:{startMs:500,endMs:2500}}],
 ['nonzero A/B count-in loop',{range:{startMs:500,endMs:2500},countInMs:2000,loop:{enabled:true,maxPasses:2}}],
 ['partial seek inside gate',{range:{startMs:500,endMs:2500},countInMs:2000,resumePositionMs:750}],
 ['partial seek through rest',{range:{startMs:500,endMs:2500},countInMs:2000,resumePositionMs:1500}],
 ['empty first pass with later loop gates',{range:{startMs:500,endMs:2500},countInMs:2000,resumePositionMs:2500,loop:{enabled:true,maxPasses:2}}],
])test(`canonical PCM sampling follows the first production gate: ${name}`,async()=>{
 const plan=pcmPlan(options),{row,firstGateFrame}=await observeCanonicalPcm(plan,{positionMs});
 assert.equal(Math.round(row.pcm.sampling.fromAudioTime*plan.sampleRate),firstGateFrame);assert.ok(row.pcm.blocks[4].audioTime>=firstGateFrame/plan.sampleRate);assert.ok(row.pcm.blocks.length<=64);
 validateCanonicalFrameLedger(row,{natural:true,pcm:true});
});

for(const [name,options]of [['zero analyser',{zero:true}],['muted output',{muted:true}],['missing destination',{disconnected:true}]])test(`canonical PCM correction preserves hard failure for ${name}`,async()=>{
 const {row}=await observeCanonicalPcm(pcmPlan({range:{startMs:500,endMs:2500},countInMs:2000}),options);
 if(name==='missing destination')assert.ok(row.pcm.blocks.some(block=>block.peak>0));else assert.ok(row.pcm.blocks.every(block=>block.peak===0&&block.rms===0));
 assert.throws(()=>validateCanonicalFrameLedger(row,{natural:true,pcm:true,runName:'canonical-practice-controls/range'}),error=>{
  assert.match(error.message,/canonical-practice-controls\/range/);assert.match(error.message,/"offsetFrames":16000/);assert.match(error.message,/"firstAudioTime":/);assert.match(error.message,/"lastAudioTime":/);assert.ok(error.message.length<1600);return true;
 });
});

for(const [name,options]of [['all human',{mode:'practice',practiceSelection:{kind:'all',part_ids:rustPcmEvidence.profile.part_ids}}],['no in-range gates',{range:{startMs:1200,endMs:1800},countInMs:2000,loop:{enabled:true,maxPasses:2}}]])test(`canonical PCM observer never invents sound for ${name}`,async()=>{
 const {row,firstGateFrame}=await observeCanonicalPcm(pcmPlan(options));assert.equal(firstGateFrame,null);assert.equal(row.pcm.sampling.offsetFrames,null);assert.equal(row.pcm.sampling.fromAudioTime,null);assert.equal(row.pcm.blocks.length,4);assert.ok(row.pcm.blocks.every(block=>block.peak===0&&block.rms===0));assert.equal(row.pcm.graphToDestination,undefined);
 validateCanonicalFrameLedger(row,{natural:true});if(row.plan.count)assert.throws(()=>validateCanonicalFrameLedger(row,{natural:true,pcm:true}),/positive actual PCM/);
});

for(const name of ['Basic','VSQ'])test(`canonical PCM hook leaves ${name} default note indices, promises and sampling unchanged`,async()=>{
 let plan;if(name==='Basic')plan=buildBasicKeyAudioPlan(basicKeySong(),{sampleRate:48000});else{const f=vsqAcceptanceFixture(),song=prepareVsqPractice(prepareCleanSong(`native:${f.key}`,f.opened.clean_package,JSON.parse(f.opened.score_json)),f.runtime);plan=buildVsqAudioPlan(song,{sampleRate:48000});}
 const {row,firstGateFrame}=await observeCanonicalPcm(plan,{canonical:false,positionMs:-2000,ReceiverClass:BasicKeyAudioReceiver,Core:BasicKeyAudioCore}),first=plan.notes.find(note=>note[3]>row.positionFrame);
 assert.equal(row.pcm.sampling.offsetFrames,Math.max(first[2],row.positionFrame)-row.positionFrame);assert.equal(Math.round(row.pcm.sampling.fromAudioTime*plan.sampleRate),firstGateFrame);assert.ok(row.pcm.blocks.some(block=>block.peak>1e-6&&block.rms>1e-8));assert.equal(row.pcm.graphToDestination.at(-1).type,'AudioDestinationNode');
});

test('canonical PCM observer reserves its budget beyond all 64 actual 454 Windows range sample times',()=>{
 const observed=JSON.parse(readFileSync(new URL('./fixtures/canonical-practice-pcm-window.json',import.meta.url))),f=canonicalPracticeFixture();
 const timeline={duration_ms:4000,notes:ORIGINAL_GATES.map(([part_id,midi,start_ms,duration_ms,source_note_ids])=>({id:source_note_ids[0],part_id,midi,start_ms,duration_ms,velocity:90,source_note_id:source_note_ids[0],source_note_ids}))},compilation={score:f.score,timeline};
 const plan=buildCanonicalAudioPlan(compilation,syntheticCanonicalProfile(compilation),{sampleRate:observed.sampleRate,mode:'listen',acceptedPolicyId:CANONICAL_AUDIO_POLICY,range:{startMs:1000,endMs:3000},countInMs:2000,loop:true});
 for(const key of ['sourceFingerprint','compiledFingerprint','planFingerprint'])assert.equal(plan[key],observed[key],'Rebuilt production plan must match the recorded Rust-bound plan');
 const acceptance=readFileSync(new URL('../crates/desktop-shell/canonical-practice-acceptance.js',import.meta.url),'utf8').split('(() => {')[0],offset=runInNewContext(acceptance+';canonicalPracticeSampleOffsetFrames;');
 const oldOffset=Math.max(plan.notes.find(note=>note[2]>observed.positionFrame)[1],observed.positionFrame)-observed.positionFrame,newOffset=offset(plan,observed.positionFrame);
 assert.equal(oldOffset,44100);assert.equal(newOffset,88200);assert.equal(observed.anchorFrame+newOffset,observed.firstActualGateFrame);assert.equal(observed.firstActualGateFrame-observed.sampledAudioFrames.at(-1),3109);
 const reference=readFileSync(new URL('../crates/desktop-shell/reference-acceptance.js',import.meta.url),'utf8'),sampleSource=reference.slice(reference.indexOf(' function sample(entry,row){'),reference.indexOf(' const create=Receiver.create;'));
 for(const [label,offsetFrames,count]of [['legacy',oldOffset,64],['corrected',newOffset,4]]){
  const frames=[],context={currentTime:observed.sampledAudioFrames[0]/plan.sampleRate,state:'running'},row={started:{anchorTime:observed.anchorFrame/plan.sampleRate},pcm:{blocks:[]}},entry={sampleRow:row,sampleFromAudioTime:(observed.anchorFrame+offsetFrames)/plan.sampleRate,owner:{context,connected:true,state:'running'},analyser:{getFloatTimeDomainData:values=>values.fill(0)}};
  const sample=runInNewContext(sampleSource+';sample;',{active:true,Float32Array,clock:()=>({wallMs:context.currentTime*1000}),graphPath:()=>{throw Error('Timing replay cannot fabricate a positive graph');},root:{requestAnimationFrame:callback=>(frames.push(callback),frames.length)}});sample(entry,row);
  for(const frame of observed.sampledAudioFrames.slice(1)){context.currentTime=frame/plan.sampleRate;frames.shift()();}
  assert.equal(row.pcm.blocks.length,count,label);assert.ok(row.pcm.blocks.every(block=>block.peak===0&&block.rms===0));
  if(label==='corrected'){context.currentTime=observed.firstActualGateFrame/plan.sampleRate;frames.shift()();assert.equal(row.pcm.blocks.length,5);assert.equal(row.pcm.blocks[4].audioTime,context.currentTime);}
 }
});

// The live route retains actual native-port gates and PCM; this pure core
// contract independently proves the declared timbre changes only synthesis.
test('original Mod reed override and restore preserve exact gates and restore baseline PCM bytes',()=>{
 const original=run(),override=run({instrumentOverrides:{P4:'reed'}}),restored=run({instrumentOverrides:{}});
 for(const r of [original,override,restored])validateCanonicalFrameLedger(r,{natural:true});
 assert.deepEqual(override.plan.notes,original.plan.notes);assert.deepEqual(override.terminals[0].record.ledger,original.terminals[0].record.ledger);
 assert.equal(override.plan.sourceFingerprint,original.plan.sourceFingerprint);assert.equal(override.plan.compiledFingerprint,original.plan.compiledFingerprint);assert.notEqual(override.plan.planFingerprint,original.plan.planFingerprint);assert.notEqual(override.pcmHash,original.pcmHash);
 assert.deepEqual(restored.plan,original.plan);assert.equal(restored.pcmHash,original.pcmHash);
});


// Preserve the Windows477 readiness regression across atomic Mod preflight:
// no owned action may run behind its open draft. Real app handlers use modeled
// backend replies and an untrusted action double, never native acceptance.
for(const rejects of [false,true])test(`canonical owned controls wait for atomic Mod target admission; rejected=${rejects}`,async()=>{
 const {nativeScoreServer,nativeStorageApp,nativeResponse}=await import('./native-storage-app-fixtures.js');
 const {readPlaybackClock}=await import('../web/playback-clock-view.js');
 const original=canonicalPracticeFixture().score,server=await nativeScoreServer({scores:[original]}),app=await nativeStorageApp(server,{now:()=>1000});
 const source=readFileSync(new URL('../crates/desktop-shell/canonical-practice-acceptance.js',import.meta.url),'utf8');
 const dispatch=runInNewContext(source.split('(() => {')[0]+'\ndispatchCanonicalPracticePlay;');
 let release,pending;const nativeActions=[];
 try{
  const key=[...server.records.keys()][0];await app.until(()=>app.savedButton(key)&&!app.$('configure-song-mod').disabled);await app.click('home-single-player');app.savedButton(key).click();await app.until(()=>!app.$('configure-song-mod').disabled);
  await app.click('configure-song-mod');await app.click('song-mod-all-machine');
  for(const id of ['P1','P2']){const field=app.$('song-mod-parts').querySelector(`[data-mod-performer="${id}"]`);field.value='human';app.emit(field,'change');}
  await app.click('song-mod-apply');await app.until(()=>!app.$('song-mod-dialog').open&&!app.$('start-performance').disabled);await app.click('start-performance');await app.until(()=>app.document.body.dataset.screen==='stage'&&!app.$('play-button').disabled);await app.click('reset-button');await app.until(()=>!app.$('play-button').disabled);
  let checks=0;const requestStart=server.requests.length,priorScope=app.$('practice-scope').textContent,priorTake=await app.exported('export-takes');
  server.setRoute(({path,defaultReply})=>path==='/api/instrument-check'&&++checks===1?new Promise(resolve=>{release=()=>resolve(rejects?nativeResponse({error:'Original delayed compatibility rejection'},503):defaultReply());}):undefined);
  await app.click('edit-song-mod');await app.click('song-mod-all-human');await app.click('song-mod-apply');await app.until(()=>Boolean(release));
  assert.equal(app.$('song-mod-dialog').open,true);assert.equal(app.$('song-mod-apply').disabled,true);assert.equal(app.$('song-mod-cancel').disabled,false);assert.equal(app.$('practice-scope').textContent,priorScope);assert.deepEqual(await app.exported('export-takes'),priorTake);
  assert.equal(readPlaybackClock(app.document).phase,'ready');assert.equal(readPlaybackClock(app.document).running,false);assert.equal(app.$('hud-captured').textContent,'0');
  pending=dispatch({document:app.document,until:app.until,readClock:()=>readPlaybackClock(app.document),click:async id=>{assert.equal(app.$(id).disabled,false);assert.equal(app.$('practice-gate').hidden,true);nativeActions.push(id);}});
  await app.tick();await app.tick();assert.deepEqual(nativeActions,[],'No native action may precede the completed target/compatibility check');
  release();
  if(rejects){await app.until(()=>app.$('song-mod-error').textContent.includes('Original delayed compatibility rejection'));assert.equal(app.$('song-mod-dialog').open,true);assert.deepEqual(nativeActions,[]);assert.equal(app.$('practice-scope').textContent,priorScope);assert.deepEqual(await app.exported('export-takes'),priorTake);await app.click('song-mod-cancel');await pending;assert.deepEqual(nativeActions,['play-button']);assert.equal(app.$('practice-scope').textContent,priorScope,'Explicit Cancel keeps the old admitted assignment usable');}
  else{await pending;assert.deepEqual(nativeActions,['play-button']);assert.equal(app.$('play-button').disabled,false);assert.equal(app.$('practice-scope').textContent,'All parts · 9 physical attacks from 9 sounding events','The modeled reply is published only after its compatibility check; real Rust tie/unison counts stay in the independent source oracle');}
  const targets=server.requests.slice(requestStart).filter(row=>row.path==='/api/practice-targets');assert.equal(targets.length,1);assert.equal(checks,1);for(const row of targets)assert.deepEqual([...new Set(row.body.timeline.notes.map(note=>note.part_id))].sort(),['P1','P2','P3','P4']);
  assert.equal(server.requests.slice(requestStart).filter(row=>row.path==='/api/assess').length,0);assert.equal(server.records.get(key).score_json,JSON.stringify(original));
  assert.match(source,/async function play\(\)\{await dispatchCanonicalPracticePlay\(\{document,until,click,readClock:clock\}\);await until\(\(\)=>state\(\)==='playing'&&!\$\('play-button'\)\.disabled,'acknowledged play'\)/);
 }finally{release?.();await pending?.catch(()=>{});await app.close();}
});

test('canonical owned Play still rejects a settled stage compatibility failure without dispatching input',async()=>{
 const {nativeScoreServer,nativeStorageApp,nativeResponse}=await import('./native-storage-app-fixtures.js');
 const {readPlaybackClock}=await import('../web/playback-clock-view.js');
 const server=await nativeScoreServer(),app=await nativeStorageApp(server,{now:()=>1000}),actions=[];
 const source=readFileSync(new URL('../crates/desktop-shell/canonical-practice-acceptance.js',import.meta.url),'utf8');
 const dispatch=runInNewContext(source.split('(() => {')[0]+'\ndispatchCanonicalPracticePlay;');
 try{
  await app.until(()=>!app.$('start-performance').disabled);await app.click('home-single-player');await app.click('start-performance');await app.until(()=>app.$('canonical-audio-policy').dataset.rendererState==='playing');await app.click('reset-button');
  server.setRoute(({path})=>path==='/api/instrument-check'?nativeResponse({error:'Current profile compatibility rejected'},503):undefined);
  app.$('key-count').value='49';app.emit(app.$('key-count'),'change');await app.until(()=>!app.$('practice-gate').hidden&&!app.$('practice-gate-retry').disabled);
  await assert.rejects(dispatch({document:app.document,until:app.until,readClock:()=>readPlaybackClock(app.document),click:async id=>actions.push(id)}),/Canonical Play blocked:.*could not be verified/);
  assert.deepEqual(actions,[]);assert.equal(app.$('play-button').disabled,true);assert.equal(app.$('assess-button').disabled,true);
 }finally{await app.close();}
});

// Read-only geometry double around the actual production viewport observer.
// The old two-frame native preparation reads the same stale 100px lane twice;
// delivery and the queued production write arrive only after those reads.
async function canonicalPlayGeometryFixture(){
 const {parseHTML}=await import('linkedom'),{observePianoViewportBudget}=await import('../web/piano-viewport-budget.js');
 const {document}=parseHTML('<html lang="en"><body data-screen="stage"><main id="workspace" class="piano-workspace"><div class="piano-lanes-shared"></div><div class="piano-keybed-shared"></div><div class="piano-transport"><button id="play-button">Play</button></div><section id="practice-gate" hidden></section></main></body></html>');
 const root=document.getElementById('workspace'),lane=root.querySelector('.piano-lanes-shared'),transport=root.querySelector('.piano-transport'),keyboard=root.querySelector('.piano-keybed-shared'),play=document.getElementById('play-button'),frames=new Map(),values=new Map();
 let serial=0,laneHeight=100,pendingChrome=60,notify,extraTargetOffset=0;
 Object.defineProperty(document.body,'style',{value:{getPropertyValue:key=>values.get(key)||'',setProperty(key,value){values.set(key,value);if(key==='--piano-available-lane-height')laneHeight=Math.round(parseFloat(value)*64)/64;},removeProperty:key=>values.delete(key)}});
 root.getBoundingClientRect=()=>({top:68});lane.getBoundingClientRect=()=>({width:986,height:laneHeight});keyboard.getBoundingClientRect=()=>({height:120});transport.getBoundingClientRect=()=>({height:52,bottom:528.92+pendingChrome+laneHeight});play.getBoundingClientRect=()=>({x:67,y:485.5+laneHeight+extraTargetOffset,width:105,height:36});
 const window={innerWidth:1024,innerHeight:689,getComputedStyle:node=>({height:node===lane?`${laneHeight}px`:'',paddingBottom:'16px'}),setTimeout,clearTimeout,requestAnimationFrame:fn=>(frames.set(++serial,fn),serial),cancelAnimationFrame:id=>frames.delete(id),addEventListener(){},removeEventListener(){},ResizeObserver:class{constructor(fn){notify=fn;}observe(){}disconnect(){}}};
 const flush=()=>{const pending=[...frames.values()];frames.clear();for(const fn of pending)fn();};
 document.elementFromPoint=()=>play;
 const view=observePianoViewportBudget({document,window});flush();pendingChrome=0;
 const source=readFileSync(new URL('../crates/desktop-shell/canonical-practice-acceptance.js',import.meta.url),'utf8'),prepare=runInNewContext(source.split('(() => {')[0]+'\nprepareCanonicalPracticeTarget;');
 const samples=[];return{document,window,view,frames,flush,play,samples,notify:()=>notify(),moveTarget:amount=>{extraTargetOffset=amount;},setChrome:amount=>{pendingChrome=amount;},prepare:()=>prepare({document,window,onSample:value=>samples.push(value)})};
}

test('canonical owned controls wait through two equal stale rectangles and the actual delayed viewport commit',async()=>{
 const env=await canonicalPlayGeometryFixture();
 try{
  const pending=env.prepare();assert.equal(env.samples[0].target.y+18,603.5);
  env.flush();env.notify();env.flush();
  assert.deepEqual(env.samples.map(row=>row.committed),[100,100,100]);assert.ok(env.samples.every(row=>row.expected===144.08));
  env.flush();assert.equal(env.samples.at(-1).target.y+18,647.578125);assert.equal(env.frames.size,1,'A committed capacity must also survive a painted target check');
  env.flush();const ready=await pending;
  assert.deepEqual(env.samples.map(row=>row.committed),[100,100,100,144.08,144.08]);assert.equal(ready.target.y+ready.target.height/2,647.578125);assert.equal(env.frames.size,0);
 }finally{env.view.destroy();}
});

test('canonical owned controls fail with retained samples when the production viewport observer never commits',async()=>{
 const env=await canonicalPlayGeometryFixture();
 try{
  const pending=env.prepare(),rejected=assert.rejects(pending,/geometry did not settle within four rendered frames.*"committed":100.*"expected":144.08/);
  for(let n=0;n<4;n++)env.flush();await rejected;
  assert.equal(env.samples.length,5);assert.equal(env.frames.size,0);assert.equal(env.play.getBoundingClientRect().y+18,603.5);
 }finally{env.view.destroy();}
});

test('canonical owned controls reject a still-moving target even with a committed viewport capacity',async()=>{
 const env=await canonicalPlayGeometryFixture();
 try{
  env.notify();env.flush();const pending=env.prepare(),rejected=assert.rejects(pending,/geometry did not settle within four rendered frames/);
  for(let n=1;n<=4;n++){env.moveTarget(n);env.flush();}await rejected;
  assert.ok(env.samples.every(row=>row.committed===144.08&&row.expected===144.08));assert.equal(env.frames.size,0);
 }finally{env.view.destroy();}
});

test('canonical owned controls require the exact trusted target before action completion and reject neighbors',async()=>{
 const source=readFileSync(new URL('../crates/desktop-shell/canonical-practice-acceptance.js',import.meta.url),'utf8'),requireClick=runInNewContext(source.split('(() => {')[0]+'\nrequireCanonicalPracticeOwnedClick;');
 const event={sequence:55,id:'edit-song-mod',owned:true,trusted:true},events=[{...event,sequence:54},{...event,trusted:false}];
 let checks=0;const until=async(condition,label)=>{assert.equal(label,'trusted owned edit-song-mod click for action 55');assert.equal(await condition(),false);checks++;events.push(event);assert.equal(await condition(),true);};
 const result=await requireClick({until,events,sequence:55,id:'edit-song-mod',kind:'click'});assert.equal(result[0],event);assert.equal(checks,1);
 await assert.rejects(requireClick({until:async condition=>condition(),events:[event,event],sequence:55,id:'edit-song-mod',kind:'click'}),/Duplicate trusted canonical click for action 55/);
 await assert.rejects(requireClick({until:async condition=>condition(),events:[{...event,id:'song-mod-stage-summary',owned:false}],sequence:55,id:'edit-song-mod',kind:'click'}),/missed owned edit-song-mod.*song-mod-stage-summary/);
 await assert.rejects(requireClick({until:async condition=>{assert.equal(await condition(),false);throw Error('Missing exact trusted click');},events:[],sequence:55,id:'edit-song-mod',kind:'click'}),/Missing exact trusted click/);
 assert.ok(source.indexOf('await requireCanonicalPracticeOwnedClick')<source.indexOf("async function play(){await dispatchCanonicalPracticePlay"));
});

test('one native geometry contract follows the actual delayed viewport commit for Mod, Results, Reset and stage samples',async()=>{
 for(const id of ['edit-song-mod','results-button','reset-button','stage-title']){
  const env=await canonicalPlayGeometryFixture();
  try{
   env.play.id=id;const node=env.play;let shifted=false;node.getBoundingClientRect=()=>({x:shifted?18:515.171875,y:124.796875,width:83.890625,height:40});
   const source=readFileSync(new URL('../crates/desktop-shell/canonical-practice-acceptance.js',import.meta.url),'utf8'),prepare=runInNewContext(source.split('(() => {')[0]+'\nprepareCanonicalPracticeTarget;');
   const pending=prepare({document:env.document,window:env.window,node,onSample:row=>env.samples.push(row)});env.flush();env.notify();env.flush();
   assert.equal(env.samples.at(-1).target.x+41.9453125,557.1171875);shifted=true;env.flush();env.flush();const target=await pending;
   assert.equal(target.target.x+target.target.width/2,59.9453125);assert.equal(env.samples.length,5);assert.equal(env.frames.size,0);
  }finally{env.view.destroy();}
 }
});

test('canonical completed source waits for its delayed assessment and the later public HUD draw before another control',async()=>{
 const {canonicalPracticeApp}=await import('./canonical-practice-fixtures.js'),{readPlaybackClock}=await import('../web/playback-clock-view.js'),{nativeResponse}=await import('./native-storage-app-fixtures.js');
 const f=await canonicalPracticeApp(),{app,score}=f,source=readFileSync(new URL('../crates/desktop-shell/canonical-practice-acceptance.js',import.meta.url),'utf8');
 const waitControl=runInNewContext(source.split('(() => {')[0]+'\nwaitCanonicalPracticeControl;');let release,pending,admitted=false;
 try{
  app.$('count-in').checked=false;await app.click('start-complete-practice');for(const box of app.$('complete-practice-parts').querySelectorAll('input'))box.checked=box.value===score.parts[0].id;
  await app.click('complete-practice-apply');await app.until(()=>app.$('canonical-audio-policy').dataset.rendererState==='playing');
  f.setRoute(({path,body})=>path==='/api/assess'?new Promise(resolve=>{release=()=>resolve(nativeResponse({hits:[],misses:body.timeline.notes.map(note=>note.id),extras:[],accuracy_percent:0,mean_abs_error_ms:null,summary:{expected_notes:body.timeline.notes.length,coverage_percent:0,timing_bias_ms:null,timing_stddev_ms:null,advice:[]},pitch_breakdown:[],grade_counts:{perfect:0,good:0,early:0,late:0,missed:body.timeline.notes.length,extra:0},onset_completion:{total:body.timeline.notes.length,complete:0,longest_complete_sequence:0}}));}):undefined);
  const zero=app.sourceStartWall();f.time(zero+4300);await app.tick();app.frame();await app.until(()=>Boolean(release)&&readPlaybackClock(app.document).completed);
  const status=app.document.querySelector('.performance-status');assert.equal(status.dataset.phase,'pending');assert.equal(app.$('edit-song-mod').disabled,false,'Mod remains a valid user action while the completed take is being assessed');
  pending=waitControl({document:app.document,node:app.$('edit-song-mod'),until:app.until,readClock:()=>readPlaybackClock(app.document)}).then(()=>{admitted=true;});pending.catch(()=>{});
  await app.tick();await app.tick();assert.equal(admitted,false,'Source completion does not prove UI completion');
  release();await app.until(()=>!app.$('play-button').disabled);assert.equal(status.dataset.phase,'pending','Enabled controls do not prove the later HUD draw has run');
  await app.tick();assert.equal(admitted,false);f.time(zero+4501);app.frame();assert.equal(status.dataset.phase,'assessed');await pending;assert.equal(admitted,true);
  await app.click('edit-song-mod');assert.equal(app.$('song-mod-dialog').open,true);
 }finally{release?.();await pending?.catch(()=>{});await app.close();}
});


test('canonical controls wait for a late real status commit even when viewport capacity and target already match',async()=>{
 const env=await canonicalPlayGeometryFixture(),{observePianoStatusBudget}=await import('../web/performance-view.js');let stop;
 try{
  env.notify();env.flush();const status=env.document.createElement('div');status.className='performance-status';env.document.getElementById('workspace').append(status);let height=49;
  status.getBoundingClientRect=()=>({width:986,height});stop=observePianoStatusBudget({document:env.document,status,window:env.window});env.flush();height=68;
  const pending=env.prepare();env.flush();assert.equal(env.samples.length,2);assert.ok(env.samples.every(row=>row.committed===row.expected&&row.status.committed===49&&row.status.expected===68));
  env.notify();env.flush();env.flush();await pending;
  assert.equal(env.samples.at(-1).status.committed,68);assert.equal(env.frames.size,0);
 }finally{stop?.();env.view.destroy();}
});

test('canonical control geometry observes a pending notice commit without hiding or dismissing it',async()=>{
 const env=await canonicalPlayGeometryFixture(),{observePianoNoticeBudget}=await import('../web/piano-stage-view.js');let stop;
 try{
  env.notify();env.flush();const notice=env.document.createElement('div');notice.id='notice';env.document.body.prepend(notice);let height=36;
  notice.getBoundingClientRect=()=>({width:976,height});stop=observePianoNoticeBudget({document:env.document,window:env.window});env.flush();height=52;
  const pending=env.prepare();env.flush();assert.ok(env.samples.every(row=>row.notice.committed===36&&row.notice.expected===52));
  env.notify();env.flush();env.flush();await pending;assert.equal(env.samples.at(-1).notice.committed,52);assert.equal(notice.hidden,false);assert.equal(env.frames.size,0);
 }finally{stop?.();env.view.destroy();}
});

test('scoped canonical click observation preserves actual ownership and trust, then removes its listener',async()=>{
 const {parseHTML}=await import('linkedom'),{document,window}=parseHTML('<html><body><button id="owned"><span id="owned-child"></span></button><span id="neighbor"></span></body></html>');
 const source=readFileSync(new URL('../crates/desktop-shell/canonical-practice-acceptance.js',import.meta.url),'utf8'),observe=runInNewContext(source.split('(() => {')[0]+'\nobserveCanonicalPracticeOwnedClick;'),node=document.getElementById('owned'),observer=observe({document,node,sequence:55});
 for(const id of ['owned-child','neighbor'])document.getElementById(id).dispatchEvent(new window.Event('click',{bubbles:true}));
 assert.deepEqual([...observer.events].map(row=>row.id),['owned-child','neighbor']);assert.deepEqual([...observer.events].map(row=>row.owned),[true,false]);assert.ok(observer.events.every(row=>row.trusted===false&&row.sequence===55),'DOM doubles cannot produce trusted native evidence');
 observer.restore();node.dispatchEvent(new window.Event('click',{bubbles:true}));assert.equal(observer.events.length,2);
});


test('actual Settings to Transposition keeps both dialogs open and admits only the painted top-modal target',async()=>{
 const {canonicalPracticeApp}=await import('./canonical-practice-fixtures.js'),{readPlaybackClock}=await import('../web/playback-clock-view.js'),f=await canonicalPracticeApp(),{app}=f;
 const source=readFileSync(new URL('../crates/desktop-shell/canonical-practice-acceptance.js',import.meta.url),'utf8'),helpers=runInNewContext(source.split('(() => {')[0]+'\n({waitCanonicalPracticeControl,prepareCanonicalPracticeTarget});');
 const frames=new Map();let serial=0;const window={innerWidth:1024,innerHeight:689,setTimeout,clearTimeout,requestAnimationFrame:callback=>(frames.set(++serial,callback),serial),cancelAnimationFrame:id=>frames.delete(id)},flush=()=>{const pending=[...frames.values()];frames.clear();for(const callback of pending)callback();};
 try{
  await app.click('start-listen');await app.until(()=>app.document.body.dataset.screen==='stage'&&!app.$('play-button').disabled);await app.click('reset-button');
  await app.click('settings-button');const instrument=app.$('instrument-settings');if(!instrument.open)app.emit(instrument.querySelector('summary'),'click');await app.click('transposition-button');
  assert.equal(app.$('settings-dialog').open,true);assert.equal(app.$('transposition-dialog').open,true);assert.equal(app.document.querySelector('dialog[open]').id,'settings-dialog');
  const preview=app.$('transposition-preview'),parentControl=app.$('transposition-button'),stageControl=app.$('settings-button');
  for(const control of [preview,parentControl,stageControl])control.getBoundingClientRect=()=>({x:100,y:100,width:120,height:40});
  app.document.elementFromPoint=()=>app.$('transposition-dialog').open?preview:parentControl;
  const readiness=await helpers.waitCanonicalPracticeControl({document:app.document,node:preview,until:app.until,readClock:()=>readPlaybackClock(app.document)});assert.equal(readiness.screen,'stage');
  const samples=[],prepared=helpers.prepareCanonicalPracticeTarget({document:app.document,window,node:preview,onSample:row=>samples.push(row)});flush();await prepared;
  assert.ok(samples.every(row=>row.modalOwner==='transposition-dialog'&&row.hitId==='transposition-preview'&&row.hitOwned));
  let backgroundAllowed;await helpers.waitCanonicalPracticeControl({document:app.document,node:stageControl,readClock:()=>readPlaybackClock(app.document),until:async condition=>{backgroundAllowed=await condition();}});assert.equal(backgroundAllowed,false,'An open modal continues to block stage controls');
  const covered=[],blocked=helpers.prepareCanonicalPracticeTarget({document:app.document,window,node:parentControl,onSample:row=>covered.push(row)}),rejected=assert.rejects(blocked,/control geometry did not settle/);
  for(let n=0;n<4;n++)flush();await rejected;assert.ok(covered.every(row=>row.modalOwner==='settings-dialog'&&row.hitOwned===false&&row.hitId==='transposition-preview'));
  await app.click('transposition-close');assert.equal(app.$('transposition-dialog').open,false);assert.equal(app.$('settings-dialog').open,true);
  await helpers.waitCanonicalPracticeControl({document:app.document,node:parentControl,until:app.until,readClock:()=>readPlaybackClock(app.document)});const restored=helpers.prepareCanonicalPracticeTarget({document:app.document,window,node:parentControl});flush();await restored;assert.equal(frames.size,0);
 }finally{await app.close();}
});

async function canonicalActivityGeometryFixture({zoom=1,width=1280,height=720,padding=8,chrome=362.984375}={}){
 const env=await canonicalPlayGeometryFixture(),{document,window}=env,root=document.getElementById('workspace'),lane=root.querySelector('.piano-lanes-shared'),transport=root.querySelector('.piano-transport'),host=document.createElement('div');
 host.className='part-activity-host';root.append(host);let collapsed=false,slotHeight=56;
 const laneBox=lane.getBoundingClientRect,computed=window.getComputedStyle;
 lane.getBoundingClientRect=()=>({...laneBox(),height:laneBox().height*zoom});
 window.innerWidth=width;window.innerHeight=height;window.getComputedStyle=node=>({...computed(node),paddingBottom:`${padding}px`});
 transport.getBoundingClientRect=()=>({height:40*zoom,bottom:chrome*zoom+lane.getBoundingClientRect().height});
 host.getBoundingClientRect=()=>host.hidden||collapsed?{width:0,height:0,bottom:0}:{width:1000*zoom,height:slotHeight*zoom,bottom:transport.getBoundingClientRect().bottom+slotHeight*zoom};
 env.play.getBoundingClientRect=()=>({x:67,y:319.5625+laneBox().height,width:105,height:36});
 env.notify();env.flush();
 return{...env,host,collapse:value=>{collapsed=value;},slot:height=>{slotHeight=height;}};
}

test('native canonical readiness measures the actual activity sibling, not the stale transport-only capacity',async()=>{
 for(const zoom of [1,1.25]){
  const env=await canonicalActivityGeometryFixture({zoom});
  try{
   const pending=env.prepare();env.flush();const ready=await pending;
   assert.equal(ready.expected,zoom===1?293.01:149.01);assert.equal(ready.committed,ready.expected);
   assert.equal(ready.activityBottom-ready.transportBottom,56*zoom);assert.equal(ready.stageBottom,ready.activityBottom);
   assert.ok(ready.stageBottom+8*zoom<=720.02,'Entire visible activity slot retains viewport padding');
   assert.equal(ready.hitOwned,true);assert.equal(env.samples.length,2,'Settled budget still needs a second unchanged painted target');
   if(zoom===1){assert.equal(ready.laneHeight,293.015625);assert.equal(Math.floor((720-ready.transportBottom+ready.laneHeight-8)*100)/100,349.01,'Reproduce the stale exact692 oracle discrepancy');}
  }finally{env.view.destroy();}
 }
});

test('native activity source hiding and responsive switches retain the five-sample commitment bound',async()=>{
 const env=await canonicalActivityGeometryFixture();
 try{
  for(const change of [()=>{env.host.hidden=true;},()=>{env.host.hidden=false;},()=>{env.window.innerWidth=1000;env.collapse(true);},()=>{env.window.innerWidth=1280;env.collapse(false);},()=>env.slot(43)]){
   change();env.samples.length=0;const pending=env.prepare();env.flush();env.notify();env.flush();env.flush();env.flush();const ready=await pending;
   assert.equal(env.samples.length,5);assert.equal(ready.committed,ready.expected);assert.equal(ready.hitOwned,true);
   assert.ok(ready.stageBottom+8<=720.02);
   assert.equal(ready.expected,ready.activityBottom===null?349.01:ready.activityBottom-ready.transportBottom===43?306.01:293.01);
  }
 }finally{env.view.destroy();}
});

test('native activity readiness cannot admit stale budgets, missing ownership or a widened tolerance',async()=>{
 for(const change of [env=>env.slot(57),env=>{env.document.elementFromPoint=()=>env.host;},env=>{env.document.body.style.setProperty('--piano-available-lane-height','293.04px');}]){
  const env=await canonicalActivityGeometryFixture();
  try{
   change(env);const pending=env.prepare(),rejected=assert.rejects(pending,/did not settle within four rendered frames/);
   for(let n=0;n<4;n++)env.flush();await rejected;assert.equal(env.samples.length,5);assert.equal(env.frames.size,0);
  }finally{env.view.destroy();}
 }
});


test('native Windows 1024 by 689 readiness reserves its measured activity slot without shrinking minimum lanes',async()=>{
 const env=await canonicalActivityGeometryFixture({width:1024,height:689,padding:16,chrome:468.90625});
 // Retain the exact Windows layout quantization from the bound692 trace.
 const lane=env.document.querySelector('.piano-lanes-shared');lane.getBoundingClientRect=()=>({width:986,height:148.078125});
 try{
  const pending=env.prepare();env.flush();const ready=await pending;
  assert.equal(ready.committed,148.09);assert.equal(ready.expected,148.09);assert.equal(ready.laneHeight,148.078125);assert.equal(ready.transportBottom,616.984375);
  assert.equal(ready.activityBottom-ready.transportBottom,56);assert.ok(ready.stageBottom+16<=689.02);
  assert.equal(Math.floor((689-ready.transportBottom+ready.laneHeight-16)*100)/100,204.09);
  assert.equal(ready.hitOwned,true);assert.equal(ready.modalOwner,null);assert.equal(env.samples.length,2);
 }finally{env.view.destroy();}
});

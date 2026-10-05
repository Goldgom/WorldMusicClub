import test from 'node:test';
import assert from 'node:assert/strict';
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
function run({range=false,pause=false,listen=false,partial=false,cancelHeld=false}={}){
 const f=canonicalPracticeFixture(),timeline={duration_ms:4000,notes:ORIGINAL_GATES.map(([part_id,midi,start_ms,duration_ms,source_note_ids])=>({id:source_note_ids[0],part_id,midi,start_ms,duration_ms,velocity:90,source_note_id:source_note_ids[0],source_note_ids,voice:'1',staff:1}))},compilation={score:f.score,timeline},profile=syntheticCanonicalProfile(compilation),p=buildCanonicalAudioPlan(compilation,profile,{sampleRate:8000,mode:listen?'listen':'practice',practiceSelection:{kind:'parts',part_ids:['P1','P2']},acceptedPolicyId:CANONICAL_AUDIO_POLICY,...(range?{range:{startMs:1000,endMs:3000},countInMs:2000,loop:{enabled:true,maxPasses:3},...(partial?{resumePositionMs:2000}:{})}:{})}),messages=[],core=new CanonicalAudioCore(p.sampleRate,{emit:(m,t=[])=>messages.push(structuredClone(m,{transfer:t}))}),wire=createCanonicalAudioTransfer(p);let frame=0,paused=false;
 const positionFrame=range?p.initialPositionFrame-p.initialCountInFrames:-16000;core.handleMessage({type:'prepare',generation:1,positionFrame,wire:wire.wire},frame);const block=()=>{core.process([new Float32Array(128)],frame);frame+=128;};while(core.state==='preparing')block();core.handleMessage({type:'start',generation:1,anchorFrame:frame+64},frame);
 while(core.state==='running'){if((pause||cancelHeld)&&!paused&&frame>(cancelHeld?1024:20000)){paused=true;core.handleMessage({type:'pause',generation:1},frame);for(let i=0;i<(cancelHeld?128:4);i++)block();if(cancelHeld){core.handleMessage({type:'cancel',generation:2,reason:'dispose'},frame);break;}core.handleMessage({type:'resume',generation:1,anchorFrame:frame+64},frame);}block();}
 const t=messages.find(m=>m.type===(cancelHeld?'canceled':'ended')),row={plan:p,planGeneration:1,positionFrame,started:messages.find(m=>m.type==='started'),terminals:[{record:{...t,ledger:{actualStarts:Array.from(t.ledger.actualStarts),actualEnds:Array.from(t.ledger.actualEnds)}}}],rawTerminals:[{record:{...t,ledger:{actualStarts:Array.from(t.ledger.actualStarts),actualEnds:Array.from(t.ledger.actualEnds)}}}]};return compact([row])[0];
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

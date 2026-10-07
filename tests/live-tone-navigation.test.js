import {readPureTestFiles} from '../scripts/run-pure-tests.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {mkdtempSync,readFileSync,rmSync,unlinkSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Script} from 'node:vm';
import {syntheticLiveToneEvidence} from './live-tone-evidence-fixtures.js';
import {validateLiveToneNavigation} from './live-tone-navigation-proof.js';
import {liveToneNavigationBootstrap,registerLiveToneNavigationBrowserRegressions} from './live-tone-navigation-browser-regression.js';
import {LIVE_SILENCE_PREVIEW_CASES,verifyUiPreviewLiveSilence} from '../scripts/ui-preview-live-silence.mjs';

// Adversarial contract fixtures only. Passing these is never browser evidence.
function fixture({route='settings',release='keyup'}={}){
  const original=syntheticLiveToneEvidence({keyCode:'KeyR',midi:60}),e=structuredClone(original),r=e.ready.receiver;
  let sequence=4;
  const event=()=>({sequence:++sequence,wallMs:sequence+10,graphRevision:9});
  const stopped={...e.ready.source,activeReceivers:0,ownedNodes:[{receiverId:1,connected:false,nodeConnections:0,gateConnections:0,disposed:true,disposing:false,pendingCommands:0,pendingStarts:0}]};
  const block=audioTime=>({...original.pcm.blocks[0],...event(),audioTime,tapConnected:true});
  const checkpoint=(label,audioTime,active=false)=>({...event(),label,nodes:1,callCount:1,source:structuredClone(active?e.ready.source:stopped),receiver:{...structuredClone(r),audioTime},pcm:{method:e.pcm.method,fftSize:16384,blocks:[]}});
  const down={...e.inputs[0],...event()},call={...e.calls[0],...event(),inputSequence:down.sequence},start={...e.receipts[0],...event()};
  e.inputs=[down];e.calls=[call];e.receipts=[start];e.pcm.blocks=[block(1.036)];
  function keyup(){const up={...original.inputs[1],...event(),surface:release==='keyup'?'stage-title':null,eventTime:release==='keyup'?1140:1230};e.inputs.push(up);return up;}
  function ended(){e.receipts.push({...original.receipts[1],...event(),record:{...original.receipts[1].record,reason:release==='keyup'?'release':'stopped'}});}
  if(release==='keyup'){keyup();ended();}
  const seal=row=>{row.sampling='sealed';row.closed={...event(),label:`${row.label}-sealed`,source:structuredClone(row.source),nodes:1,receiver:{...structuredClone(r),audioTime:row.pcm.blocks.at(-1).audioTime}};};
  const navigation=checkpoint('navigation',1.08,true);navigation.pcm.blocks=release==='keyup'?[1.48,1.53,1.59].map(time=>({...block(time),peak:0,energy:0,nonzeroSamples:0})):[block(1.08)];seal(navigation);e.checkpoints=[navigation];e.actions=[];
  for(const control of route==='settings'?['settings-button']:['back-to-library','lobby-home','home-song-authoring']){
    e.actions.push({...event(),type:'pointerdown',control,isTrusted:true,eventTime:1200});
    if(release==='navigation'&&e.receipts.length===1)ended();
    e.actions.push({...event(),type:'click',control,isTrusted:true,eventTime:1201});
  }
  if(release==='navigation')keyup();
  const silent=(label,audioTime)=>{const row=checkpoint(label,audioTime);e.checkpoints.push(row);row.pcm.blocks=[audioTime+.1,audioTime+.4,audioTime+.45,audioTime+.51].map(time=>({...block(time),peak:0,energy:0,nonzeroSamples:0}));seal(row);};
  silent('entered',2);
  for(const type of ['keydown','keyup'])e.inputs.push({...event(),type,code:'KeyR',isTrusted:true,repeat:false,surface:null,eventTime:type==='keydown'?2100:2140,source:structuredClone(stopped)});
  silent('blocked-input',3);silent('returned',4);silent('finished',5);
  const firstWindow=e.checkpoints[release==='keyup'?0:1],first=firstWindow.pcm.blocks.find(block=>block.audioTime>=firstWindow.receiver.audioTime+(16384+256)/48000);e.silenceEstablished={sequence:first.sequence,audioTime:first.audioTime};e.pcmCoverage='finite-checkpoint-windows';
  e.after={...original.after,...event(),source:structuredClone(stopped),receiver:{...structuredClone(r),audioTime:5.52}};
  const take={passes:[{inputs:[{midi:60,at_ms:20}],clock_segments:[{start_ms:0,end_ms:100}]}],input_evidence:{events:[{kind:'note_on',input_kind:'typing_keyboard',encoding:'key_down',raw_timestamp_ms:down.eventTime,timestamp_basis:'event_monotonic',midi:60,velocity:90,source_id:'physical-r'},{kind:'note_off',input_kind:'typing_keyboard',encoding:'key_up',raw_timestamp_ms:e.inputs[1].eventTime,timestamp_basis:'event_monotonic',midi:null,source_id:'physical-r'}]}};
  return {e,options:{route,release,takeBefore:take,takeAfter:structuredClone(take)}};
}

test('navigation proof accepts one real-token shape across each release and visible route',()=>{
  for(const route of ['settings','authoring'])for(const release of ['keyup','navigation']){const {e,options}=fixture({route,release});validateLiveToneNavigation(e,options);}
});

test('navigation proof rejects silent-start, stale-token, disconnected, muted and suspended substitutes',()=>{
  const mutations=[
    e=>e.ready.receiver.nativeNode=false,e=>e.ready.receiver.nativePort=false,e=>e.initialization.ready.isTrusted=false,e=>e.initialization.ready.record.generation++,e=>e.initialization.tapReady.receiver.nodeId++,e=>e.initialization.tapReady.source.started++,
    e=>e.inputs[0].isTrusted=false,e=>e.inputs[0].surface=null,e=>e.inputs[0].eventTime++,e=>e.inputs[1].eventTime=e.inputs[0].eventTime,e=>e.inputs[1].isTrusted=false,e=>e.inputs.pop(),
    e=>e.calls[0].inputSequence++,e=>e.calls[0].token++,e=>e.calls[0].midi++,e=>e.calls[0].id='source-note',e=>e.calls[0].duration=0,e=>e.calls.push(structuredClone(e.calls[0])),
    e=>e.receipts.pop(),e=>e.receipts[0].nativeMessage=false,e=>e.receipts[1].portMatches=false,e=>e.receipts[1].record.reason='retrigger',e=>e.receipts[1].record.token--,e=>e.receipts[1].record.generation++,e=>e.receipts[1].record.pcmPeak=0,e=>e.receipts[1].record.pcmEnergy=0,e=>e.receipts[1].record.nonzeroSamples=0,e=>e.receipts[1].record.lastRenderedFrame++,
    e=>e.pcm.blocks=[],e=>e.pcm.blocks[0].peak=0,e=>e.pcm.blocks[0].energy=0,e=>e.pcm.blocks[0].nonzeroSamples=0,e=>e.pcm.blocks[0].audioTime=100,e=>e.pcm.blocks[0].tapConnected=false,
    e=>e.after.nodes++,e=>e.after.receiver.generation++,e=>e.after.receiver.contextState='suspended',e=>e.after.receiver.graphToDestination=null,e=>e.after.receiver.graphToDestination[1].gain=0,
    e=>e.checkpoints[1].receiver.tapConnected=false,e=>e.checkpoints[1].receiver.graphToDestination[1].gain=0,e=>e.checkpoints[1].pcm.blocks[0].tapConnected=false,e=>e.checkpoints[1].pcm.blocks[0].graphToDestination=null,e=>e.checkpoints[1].pcm.blocks[0].graphToDestination[1].gain=0,e=>e.checkpoints[1].pcm.blocks[0].contextState='suspended',
  ];
  for(const [index,mutate]of mutations.entries()){const {e,options}=fixture();mutate(e);assert.throws(()=>validateLiveToneNavigation(e,options),`Signal adversary ${index} was accepted`);}
});

test('navigation proof rejects undrained or insufficient quiet windows, later leakage, source replay and invented controls',()=>{
  const mutations=[
    e=>e.checkpoints[4].sampling='exhausted',e=>e.checkpoints[4].sampling='observing',e=>e.checkpoints[4].closed.receiver.audioTime=10,e=>e.after.receiver.audioTime=10,e=>e.after.wallMs=10000,e=>e.silenceEstablished.sequence++,e=>e.checkpoints[0].pcm.blocks[2].peak=.01,e=>e.checkpoints[0].pcm.blocks.forEach(block=>block.audioTime=1.1),e=>e.checkpoints=[],e=>e.checkpoints[1].pcm.blocks=[],e=>e.checkpoints[1].pcm.blocks.length=2,
    e=>e.checkpoints[1].pcm.blocks.forEach(block=>block.audioTime=1.3),e=>e.checkpoints[1].pcm.blocks.forEach((block,index)=>block.audioTime=1.6+index*.001),
    e=>e.checkpoints[1].pcm.blocks[2].peak=.01,e=>e.checkpoints[2].pcm.blocks[1].energy=1,e=>e.checkpoints[3].pcm.blocks[2].nonzeroSamples=1,
    e=>e.checkpoints[1].source.ownedNodes=[],e=>e.checkpoints[1].source.ownedNodes[0].nodeConnections=1,e=>e.checkpoints[1].source.ownedNodes[0].disposed=false,e=>e.checkpoints[1].source.activeReceivers=1,e=>e.checkpoints[1].source.pendingReceivers=1,e=>e.checkpoints[2].source.started++,e=>e.after.source.started++,e=>e.after.source.errors.push('processor failure'),
    e=>e.actions=[],e=>e.actions[1].isTrusted=false,e=>e.actions[1].control='unrelated',e=>e.actions[1].sequence=e.checkpoints[1].sequence+1,e=>e.inputs[2].surface='stage-title',e=>e.checkpoints[2].callCount=2,e=>e.overflow=true,
  ];
  for(const [index,mutate]of mutations.entries()){const {e,options}=fixture();mutate(e);assert.throws(()=>validateLiveToneNavigation(e,options),`Navigation adversary ${index} was accepted`);}
  for(const mutate of [e=>e.actions[0].sequence=e.receipts[1].sequence+1,e=>e.receipts[1].sequence=e.inputs[1].sequence+1,e=>e.receipts[1].record.reason='release']){const {e,options}=fixture({release:'navigation'});mutate(e);assert.throws(()=>validateLiveToneNavigation(e,options));}
});

test('a later checkpoint cannot hide a nonzero block in a newly granted FFT drain grace',()=>{
  for(const index of [2,3]){const {e,options}=fixture();const row=e.checkpoints[index];assert.ok(row.pcm.blocks[0].audioTime-row.receiver.audioTime<.2);row.pcm.blocks[0].peak=.1;row.pcm.blocks[0].energy=1;row.pcm.blocks[0].nonzeroSamples=10;assert.throws(()=>validateLiveToneNavigation(e,options),/leaked after established silence/);}
});

test('navigation proof preserves the exact human input and complete paused take',()=>{
  for(const mutate of [o=>o.takeAfter.passes[0].clock_segments.push({start_ms:100}),o=>o.takeBefore.input_evidence.events[0].raw_timestamp_ms++,o=>o.takeBefore.input_evidence.events[1].raw_timestamp_ms++,o=>o.takeBefore.input_evidence.events[1].source_id='other',o=>o.takeBefore.input_evidence.events[0].timestamp_basis='processor_frame',o=>o.takeBefore.input_evidence.events.push({kind:'started',source:'live-tone'})]){const {e,options}=fixture();mutate(options);assert.throws(()=>validateLiveToneNavigation(e,options));}
});

test('all four navigation cases remain registered in full browser acceptance and local contracts in npm test',async()=>{
  assert.doesNotThrow(()=>new Script(liveToneNavigationBootstrap));
  const registered=[];registerLiveToneNavigationBrowserRegressions({test:(name,options,run)=>registered.push({name,options,run})});
  assert.equal(registered.length,4);assert.equal(new Set(registered.map(row=>row.name)).size,4);assert.ok(registered.every(row=>typeof row.run==='function'&&row.options.timeout===60_000));
  const [suite,runner]=await Promise.all(['tests/full-app-browser.test.js','tests/live-tone-navigation-browser-regression.js'].map(path=>readFile(new URL(`../${path}`,import.meta.url),'utf8')));
  assert.match(suite,/registerLiveToneNavigationBrowserRegressions\(\{test,getPage/);assert.ok(readPureTestFiles().includes('tests/live-tone-navigation.test.js'));
  assert.match(runner,/for\(const route of \['settings','authoring'\]\)for\(const release of \['keyup','navigation'\]\)/);
  assert.ok(runner.indexOf('page.reload(')<runner.indexOf('await installCanonicalPreviewAudio(page)'));assert.ok(runner.indexOf('__wmhLiveNavigation=await')<runner.indexOf('await startPreview('));
  assert.match(runner,/page.keyboard.down\('r'\)/);assert.match(runner,/page.keyboard.up\('r'\)/);assert.match(runner,/physicalAudio:false/);assert.match(runner,/validateLiveToneNavigation\(report.audio,report\)/);
  assert.doesNotMatch(runner,/legacySynth|createOscillator|dispatchEvent|\.snapshot\(\).*===0/);
});

function previewFixture(t){
  const directory=mkdtempSync(join(tmpdir(),'wmh-finite-silence-preview-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));
  const cases=['settings','authoring'].flatMap(route=>['keyup','navigation'].map(release=>({route,release,name:`real unmuted live worklet verifies finite silence through ${route} after ${release}`,file:`worldmusichub-live-silence-${route}-${release}.json`})));
  const reports=cases.map(({route,release})=>{const {e,options}=fixture({route,release}),paused={position:100,mode:'practice',captured:'1',pass:'human-pass',revision:'1',title:'Original fixture',stageTitle:'Original fixture'},cleanup={restored:true,overflow:false,errors:[],cleanupErrors:[]};return{version:1,route,release,ok:true,physicalAudio:false,audio:e,takeBefore:options.takeBefore,takeAfter:options.takeAfter,pausedBefore:paused,pausedAfter:structuredClone(paused),cleanup:{live:structuredClone(cleanup),source:structuredClone(cleanup)}};});
  const write=(index,report=reports[index])=>writeFileSync(join(directory,cases[index].file),JSON.stringify(report,null,2)+'\n');cases.forEach((_,index)=>write(index));
  const lines=cases.map((row,index)=>`ok ${index+1} - ${row.name}`);return{directory,cases,reports,write,lines,tap:lines.join('\n')+'\n'};
}

test('hosted preview revalidates all four finite reports and hashes the exact retained JSON bytes',t=>{
  const f=previewFixture(t);assert.deepEqual(LIVE_SILENCE_PREVIEW_CASES,f.cases);
  const expected=()=>f.cases.map(({file})=>{const bytes=readFileSync(join(f.directory,file));return{name:file,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};});
  const first=verifyUiPreviewLiveSilence(f.directory,f.tap);assert.deepEqual(first,expected());
  const file=join(f.directory,f.cases[0].file);writeFileSync(file,readFileSync(file,'utf8')+' \n');const second=verifyUiPreviewLiveSilence(f.directory,f.tap);assert.deepEqual(second,expected());assert.notEqual(first[0].sha256,second[0].sha256,'Provenance hashes original bytes, not normalized or cached JSON');
});

test('hosted preview requires each exact passing case and rejects skips, TODOs, failures, duplicates and name impostors',t=>{
  const f=previewFixture(t);
  for(let index=0;index<4;index++)for(const replace of [()=>'',line=>line+' # SKIP not selected',line=>line+' # TODO later',line=>line.replace(/^ok /,'not ok '),line=>line+' extra',line=>line.replace(' - ',' - prefix '),line=>line+'\n'+line]){
    const lines=[...f.lines];lines[index]=replace(lines[index]);assert.throws(()=>verifyUiPreviewLiveSilence(f.directory,lines.join('\n')),/Missing executed passing live-silence preview case/);
  }
});

test('hosted preview rejects changed report identity, missing cleanup, stale PCM and paused-session drift despite passing TAP',t=>{
  const f=previewFixture(t),mutations=[
    r=>r.version=0,r=>r.ok=false,r=>r.route='other',r=>r.release='other',r=>r.physicalAudio=true,r=>r.error='failed',r=>r.failedAudio={},
    r=>delete r.audio,r=>r.audio.pcm.blocks[0].peak=0,r=>r.audio.after.receiver.audioTime=100,r=>r.audio.checkpoints[2].pcm.blocks[0].peak=.1,r=>r.audio.checkpoints[4].sampling='exhausted',
    r=>r.takeAfter.passes[0].inputs.push({midi:64,at_ms:30}),r=>r.pausedAfter.position++,r=>r.pausedBefore.position=0,r=>r.pausedBefore.mode='listen',r=>r.pausedBefore.captured='0',
    r=>delete r.cleanup,r=>delete r.cleanup.live,r=>r.cleanup.live.restored=false,r=>r.cleanup.live.overflow=true,r=>r.cleanup.live.errors.push('error'),r=>r.cleanup.live.cleanupErrors.push('listener'),
    r=>delete r.cleanup.source,r=>r.cleanup.source.restored=false,r=>r.cleanup.source.overflow=true,r=>r.cleanup.source.errors.push('error'),r=>r.cleanup.source.cleanupErrors.push('listener'),
  ];
  for(const [index,mutate]of mutations.entries()){const report=structuredClone(f.reports[3]);mutate(report);f.write(3,report);assert.throws(()=>verifyUiPreviewLiveSilence(f.directory,f.tap),`Preview adversary ${index} was accepted`);f.write(3);}
  const file=join(f.directory,f.cases[3].file);unlinkSync(file);assert.throws(()=>verifyUiPreviewLiveSilence(f.directory,f.tap),/ENOENT/);writeFileSync(file,'{broken');assert.throws(()=>verifyUiPreviewLiveSilence(f.directory,f.tap),SyntaxError);
});

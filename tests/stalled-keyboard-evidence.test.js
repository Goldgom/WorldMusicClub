// Synthetic validator fixtures only. These tests launch no browser or server
// and cannot establish trusted browser input or real Rust scoring by themselves.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {STALLED_KEYS,originalStalledKeyboardScore,validateStalledKeyboardEvidence} from '../scripts/stalled-keyboard-evidence.mjs';

function syntheticEvidence(){
  const timeline={duration_ms:5500,notes:STALLED_KEYS.map(key=>({id:`original-${key.id}`,midi:key.midi,start_ms:key.targetMs,duration_ms:500}))};
  const segments=[{wallStart:1000,wallEnd:1100,positionStart:0},{wallStart:2000,wallEnd:7400,positionStart:100}];
  const inputs=STALLED_KEYS.map(key=>({midi:key.midi,at_ms:key.targetMs,velocity:90}));
  const assessment=count=>({hits:timeline.notes.slice(0,count).map(note=>({note_id:note.id,midi:note.midi,expected_ms:note.start_ms,actual_ms:note.start_ms,delta_ms:0,grade:'perfect'})),misses:timeline.notes.slice(count).map(note=>note.id),extras:[]});
  const pass={id:1,revision:2,assessed_revision:2,pending:false,error:null,range:{start_ms:0,end_ms:5500},clock_segments:segments,inputs,captures:inputs.map((input,index)=>({input,event_wall_ms:3900+index*3000,received_wall_ms:5101+index*3000})),timeline,assessment:assessment(2)};
  const baseline={passes:[{id:1,assessed_revision:0,assessment:assessment(0),pending:false}]};
  const job=revision=>({revision,passId:1,inputs:inputs.slice(0,revision)});
  const trace={errors:[],restored:true,inputs:[],blocks:[],recorder:[{method:'submit',wall:1300,job:job(0)},{method:'complete',wall:1400,job:job(0),assessment:assessment(0),after:{assessedRevision:0}},{method:'resume',wall:2000,after:{id:1,assessedRevision:0}},{method:'submit',wall:8100,job:job(1)},{method:'complete',wall:8103,job:job(1),assessment:assessment(1),after:{assessedRevision:1}},{method:'submit',wall:8104,job:job(2)},{method:'complete',wall:8110,job:job(2),assessment:assessment(2),after:{assessedRevision:2}}]};
  const events=[];
  for(const[index,key]of STALLED_KEYS.entries()){
    const start=3600+index*3000,end=start+1500,eventTime=start+300,received=end+1,source=`source-${index+1}`;
    trace.blocks.push({id:key.id,start,end,afterFrame:end+0.5,durationRequestedMs:1500,clockBefore:{running:true},clockAfter:{completed:index===1}});
    for(const[type,offset]of [['keydown',0],['keyup',100]])trace.inputs.push({type,code:key.code,isTrusted:true,nativeKeyboardEvent:true,repeat:false,surface:'stage-title',focused:'stage-title',hidden:false,dialogOpen:false,eventTime:eventTime+offset,wall:received+(offset?1:0)});
    trace.recorder.push({method:'capture',entered:received,input:{midi:key.midi,eventWall:eventTime,receivedWall:received},captured:{passId:1,input:inputs[index]},before:{hasAssessment:true,assessedRevision:0,closedWall:index?7400:null,deadline:index?7580:null}});
    events.push({kind:'note_on',input_kind:'typing_keyboard',midi:key.midi,source_id:source,event_wall_ms:eventTime,raw_timestamp_ms:eventTime,received_wall_ms:received,timestamp_basis:'event_monotonic',onset_capture:{pass_id:1}},{kind:'note_off',input_kind:'typing_keyboard',source_id:source,event_wall_ms:eventTime+100,raw_timestamp_ms:eventTime+100,received_wall_ms:received+1,timestamp_basis:'event_monotonic'});
  }
  return {kind:'original-hosted-stalled-keyboard',input_driver:'playwright-chromium-cdp',ok:true,originalFixture:true,claims:{trusted_browser_input:true,physical_keyboard:false,physical_audio:false,synthetic_dom_input:false,timestamp_override:false,clock_override:false,injected_main_thread_block:true,production_source_changed:false},commands:STALLED_KEYS.flatMap(key=>['down','up'].map((type,index)=>({blockId:key.id,key:key.key,type,delayAfterNotificationMs:300+index*100,notificationHostNs:'1000000000',sentHostNs:String(1300000000+index*100000000),completedHostNs:'2600000000'}))),pageErrors:[],cleanup:{status:'complete',resources:[{status:'closed'}]},trace,baseline,take:{latency_ms:0,tolerance_ms:180,passes:[pass],input_evidence:{events}},assessments:[0,1,2].map(count=>({status:200,request:{timeline,inputs:inputs.slice(0,count),tolerance_ms:180},response:assessment(count)}))};
}

test('original two-note fixture is bounded and separate from any private song',()=>{
  const score=originalStalledKeyboardScore();assert.equal(score.provenance.kind,'original_exercise');assert.equal(score.source,null);assert.deepEqual(score.parts[0].notes.map(note=>[note.id,note.at.numerator,note.at.denominator]),[['original-midtake',4,1],['original-end',10,1]]);assert.equal(score.parts.length,1);assert.deepEqual(score.measures.map(row=>row.length.numerator),[4,4,3]);
});
test('validator accepts independently specified modeled evidence, without promoting it to browser proof',()=>{
  assert.deepEqual(validateStalledKeyboardEvidence(syntheticEvidence()),{notes:2,passes:1,provisionalRevision:0,finalRevision:2,minQueueLagMs:1102,physicalKeyboard:false});
});
test('validator rejects missing native provenance, blocked-interval overlap, endpoint correction, or exact Rust timing',()=>{
  const mutations=[
    r=>r.trace.inputs[0].isTrusted=false,r=>r.trace.inputs[0].nativeKeyboardEvent=false,r=>r.trace.inputs[0].eventTime=3500,
    r=>r.commands[0].sentHostNs='999999999',r=>r.commands.pop(),r=>r.trace.inputs[0].focused='input',r=>r.take.passes[0].timeline.duration_ms=6000,
    r=>r.trace.recorder=r.trace.recorder.filter(row=>row.method!=='complete'||row.job.revision!==2),r=>r.trace.inputs[0].wall=r.trace.blocks[0].end+0.1,
    r=>r.take.passes[0].captures.pop(),r=>r.take.input_evidence.events[1].raw_timestamp_ms++,r=>r.take.input_evidence.events[1].timestamp_basis='receipt_fallback',
    r=>r.trace.inputs[0].wall=4000,r=>r.trace.inputs[0].repeat=true,r=>r.trace.inputs[0].dialogOpen=true,
    r=>r.trace.inputs[1].eventTime=r.trace.blocks[0].end+1,r=>r.trace.blocks[1].end=7800,r=>r.trace.blocks[1].clockAfter.completed=false,
    r=>r.trace.inputs.pop(),r=>r.trace.recorder.find(row=>row.method==='capture').input.eventWall=5101,
    r=>r.trace.recorder.find(row=>row.method==='capture').captured.input.at_ms+=1200,
    r=>r.take.input_evidence.events[0].raw_timestamp_ms++,r=>r.take.input_evidence.events[0].timestamp_basis='receipt_fallback',
    r=>r.take.passes[0].clock_segments[1].positionStart=0,r=>r.take.passes[0].assessed_revision=1,
    r=>r.take.passes[0].pending=true,r=>r.assessments[1].response.misses=[],
    r=>r.assessments[2].response.hits[1].actual_ms+=1,r=>r.assessments[2].response.hits[1].delta_ms+=1,
    r=>r.trace.recorder.find(row=>row.method==='capture'&&row.input.midi===64).before.closedWall=9000,
    r=>r.trace.recorder.find(row=>row.method==='submit'&&row.job.revision===1).wall=9000,r=>r.trace.recorder.find(row=>row.method==='complete').wall=3000,
    r=>r.cleanup.status='failed',r=>r.trace.restored=false,r=>r.pageErrors.push('error'),r=>r.claims.physical_keyboard=true,
  ];
  for(const change of mutations){const value=structuredClone(syntheticEvidence());change(value);assert.throws(()=>validateStalledKeyboardEvidence(value),undefined,change.toString());}
});
test('hosted script gates launch and uses independent native keys with no synthetic dispatch or timestamp replacement',async()=>{
  const runner=await readFile(new URL('../scripts/hosted-stalled-keyboard-check.mjs',import.meta.url),'utf8');
  assert.ok(runner.indexOf("process.env.GITHUB_ACTIONS!=='true'")<runner.indexOf('await startHostedAssetServer'));
  assert.match(runner,/page\.keyboard\[type\]\(key\.key\)/);assert.doesNotMatch(runner,/dispatchEvent|new KeyboardEvent|dispatchKeyEvent|timeStamp\s*:/);
  assert.doesNotMatch(runner,/\.route\(/,'Real Rust API responses must not be intercepted');
  assert.match(runner,/await waitCompletedRevision\(0\)/);assert.match(runner,/await waitCompletedRevision\(2\)/);
});

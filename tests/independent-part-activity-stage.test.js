import test from 'node:test';
import assert from 'node:assert/strict';
import {CanonicalPracticeSession} from '../web/canonical-practice-session.js';
import {createPartActivityStage} from '../web/part-activity-stage.js';
import {capacityEvidence} from './canonical-audio-fixtures.js';
const context={screen:'stage',layout:'complete',mode:'practice',showOtherParts:true};
test('independent activity stage: replacement, stop and failed preparation invalidate rows',async()=>{
 const first=capacityEvidence({count:4}),second=capacityEvidence({count:6}),session=new CanonicalPracticeSession(),stage=createPartActivityStage({canonicalSession:session});let source=first.compilation;
 const frame=()=>({source,context,position:0,sourceClock:null,transport:'paused',countIn:false,soundEnabled:false});
 session.select(source,first.profile);assert.equal(stage.sample(frame()),null);await session.prepare({soundEnabled:false,mode:'practice',practiceSelection:{kind:'parts',part_ids:['human']}});assert.equal(stage.sample(frame()).rows.length,1);
 for(const override of [{screen:'library'},{screen:'free'},{layout:'solo'},{mode:'listen'},{showOtherParts:false}])assert.equal(stage.sample({...frame(),context:{...context,...override}}),null);
 assert.equal(stage.sample(frame()).rows.length,1);session.stop();assert.equal(stage.sample(frame()),null);source=second.compilation;session.select(source,second.profile);assert.equal(stage.sample(frame()),null);await session.prepare({soundEnabled:false,mode:'listen'});assert.equal(stage.sample(frame()).rows.length,1);await assert.rejects(session.prepare({soundEnabled:false,mode:'listen',mutedPartIds:['not-a-part']}));assert.equal(stage.sample(frame()),null);session.stop();
});
test('independent activity stage: cancelled asynchronous preparation cannot restore stale rows',async()=>{
 const fixture=capacityEvidence({count:4});let complete;const session=new CanonicalPracticeSession({api:()=>new Promise(resolve=>{complete=resolve;})}),stage=createPartActivityStage({canonicalSession:session});session.select(fixture.compilation);const frame={source:fixture.compilation,context,position:0,transport:'running',sourceClock:null,soundEnabled:false};const pending=session.prepare({soundEnabled:false,mode:'listen'});assert.equal(stage.sample(frame),null);session.stop();complete(fixture.profile);assert.equal(await pending,null);assert.equal(stage.sample(frame),null);
});

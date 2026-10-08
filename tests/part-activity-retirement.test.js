import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createPartActivityStage} from '../web/part-activity-stage.js';
import {CleanSongPlayer} from '../web/clean-song-player.js';
import {CanonicalPracticeSession} from '../web/canonical-practice-session.js';
import {basicKeySong} from './basic-key-rendition-fixtures.js';
import {originalVsqAudioSong} from './practice-assistance-audio-fixtures.js';
import {basicKeyAudioHarness} from './basic-key-audio-harness.js';
import {BASIC_KEY_RENDITION} from '../web/basic-key-player.js';
const context={screen:'stage',layout:'complete',mode:'practice',showOtherParts:true};
for(const kind of ['basic','vsq'])test(`${kind} retired rows are inactive only and reject reset, replay, ownership, source, failure and canceled reprepare`,async()=>{
 const audio=basicKeyAudioHarness(),old=Object.getOwnPropertyDescriptor(globalThis,'AudioWorkletNode');globalThis.AudioWorkletNode=class{constructor(){return audio.nodeFactory();}};
 const p=new CleanSongPlayer({getPositionMs:()=>0}),song=kind==='basic'?basicKeySong():originalVsqAudioSong(),stage=createPartActivityStage({cleanPlayer:p,canonicalSession:new CanonicalPracticeSession()}),lifecycle=[song,{},1];p.select(song);
 const options={context:audio.context,output:audio.output,acceptedPolicyId:BASIC_KEY_RENDITION,mode:'listen'},frame={cleanSong:song,source:song.compilation,context,position:0,sourceClock:null,countIn:false,soundEnabled:true,lifecycle};
 try{
  await p.start(options);assert.ok(stage.sample({...frame,transport:'running'}).rows.length);
  stage.retire({cleanSong:song,lifecycle});p.pause();assert.equal(p.activityPlayback().status,'unavailable');
  for(const transport of ['paused','ended']){const result=stage.sample({...frame,transport});assert.ok(result.rows.length);assert.ok(result.rows.every(r=>r.state===transport&&r.activeGateCount===0));}
  assert.equal(stage.sample({...frame,transport:'running'}),null,'retirement cannot resurrect audible authority');
  await p.start(options);stage.retire({cleanSong:song,lifecycle});p.pause();assert.equal(stage.sample({...frame,transport:'paused',otherRenderer:true}),null);assert.equal(stage.sample({...frame,transport:'paused'}),null,'replay clears live-take display');
  await p.start(options);stage.retire({cleanSong:song,lifecycle});p.pause();assert.equal(stage.sample({...frame,transport:'paused',lifecycle:[song,{},1]}),null);
  await p.start(options);stage.retire({cleanSong:song,lifecycle});p.pause();stage.clear();assert.equal(stage.sample({...frame,transport:'ended'}),null,'reset clears retained rows');
  await p.start(options);stage.retire({cleanSong:song,lifecycle});p.pause();await assert.rejects(p.prepare({...options,context:null}));assert.equal(stage.sample({...frame,transport:'paused'}),null,'failed new prepare cannot revive old snapshot');
  await p.start(options);stage.retire({cleanSong:song,lifecycle});p.pause();p.select(null);assert.equal(stage.sample({...frame,transport:'paused'}),null);
 }finally{p.destroy();if(old)Object.defineProperty(globalThis,'AudioWorkletNode',old);else delete globalThis.AudioWorkletNode;}
});
test('activity consumes final existing frame sample and has explicit desktop/compact flow budgets',()=>{
 const source=file=>readFileSync(new URL(`../web/${file}`,import.meta.url),'utf8'),app=source('app.js'),draw=app.slice(app.indexOf('function drawFrame('),app.indexOf('const active = position < segmentStart'));
 assert.equal((draw.match(/playbackPosition\(now/g)||[]).length,2);assert.match(draw,/advanceLoopClock\(now\)/);assert.match(draw,/position=playbackPosition\(now,activityClock\)/);assert.doesNotMatch(draw,/canonicalSession\.sourceClock\(/);assert.match(draw,/otherRenderer:referenceInputActive\(\)/);
 assert.doesNotMatch(source('part-activity-stage.js'),/performance\.now|currentTime|setTimeout|requestAnimationFrame|pressNote|physicalIndex|targetGroups|fetch\(/);
 assert.match(source('part-activity-view.css'),/flex:0 0 56px/);assert.match(source('part-activity-view.css'),/@media\(max-height:650px\),\(max-width:1000px\)/);
});

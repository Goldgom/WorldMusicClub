import test from 'node:test';
import assert from 'node:assert/strict';
import {pitchBreakdownView} from '../web/feedback-view.js';
const row=(midi,expected,matched,extra=0,mean=null,bias=null)=>({midi,expected,matched,missed:expected-matched,extra,mean_abs_error_ms:mean,timing_bias_ms:bias});
const sample=()=>({hits:[{},{}],misses:['missing'],extras:[{},{}],pitch_breakdown:[row(60,2,2,0,20,0),row(61,0,0,1),row(64,1,0),row(67,0,0,1)]});
test('per-pitch view preserves Rust counts and separate missing and extra pitches without inventing substitutions',()=>{
 const assessment=sample(),before=structuredClone(assessment),view=pitchBreakdownView(assessment,3);assert.equal(view.available,true);assert.deepEqual(view.rows.map(row=>[row.midi,row.expected,row.matched,row.missed,row.extra]),[[60,2,2,0,0],[61,0,0,0,1],[64,1,0,1,0],[67,0,0,0,1]]);assert.equal(view.rows[0].meanError,'20 ms');assert.equal(view.rows[0].bias,'0 ms');assert.equal(view.rows[0].sample,'2 matched · small sample');assert.equal(view.rows[1].bias,'—');assert.equal(view.rows[2].sample,'No matched attacks');assert.deepEqual(assessment,before);view.rows[0].matched=999;assert.equal(assessment.pitch_breakdown[0].matched,2);
});
test('older responses stay explicitly unavailable and empty takes do not fabricate pitch rows',()=>{
 for(const pitch_breakdown of[undefined,null]){const view=pitchBreakdownView({hits:[],misses:['m'],extras:[],pitch_breakdown},1);assert.equal(view.available,false);assert.equal(view.rows.length,0);assert.match(view.message,/unavailable/)}
 const empty=pitchBreakdownView({hits:[],misses:[],extras:[],pitch_breakdown:[]},0);assert.equal(empty.available,true);assert.deepEqual(empty.rows,[]);assert.match(empty.message,/no expected or extra/);
});
test('pitch rows are bounded, uniquely ordered and consistent with the complete assessment',()=>{
 for(const change of[a=>a.pitch_breakdown.push(row(67,0,0,1)),a=>a.pitch_breakdown.reverse(),a=>a.pitch_breakdown[0].midi=128,a=>a.pitch_breakdown[0].expected=1,a=>a.pitch_breakdown[0].extra=-1,a=>a.pitch_breakdown[0].mean_abs_error_ms=null,a=>a.pitch_breakdown[1].timing_bias_ms=0,a=>a.pitch_breakdown[0].timing_bias_ms=Infinity,a=>a.hits.pop(),a=>a.pitch_breakdown=Array.from({length:129},(_,midi)=>row(midi,1,0))]){const assessment=sample();change(assessment);assert.equal(pitchBreakdownView(assessment,3).available,false)}
 const assessment={hits:[],misses:Array.from({length:128},()=>''),extras:[],pitch_breakdown:Array.from({length:128},(_,midi)=>row(midi,1,0))};assert.equal(pitchBreakdownView(assessment,128).rows.length,128);
});
test('timing display retains early and late direction without displaying a signed zero',()=>{
 for(const[value,label]of[[-0.01,'<0.1 ms early'],[0.01,'<0.1 ms late'],[-15.24,'15.2 ms early'],[28.66,'28.7 ms late']]){const view=pitchBreakdownView({hits:[{}],misses:[],extras:[],pitch_breakdown:[row(60,1,1,0,Math.abs(value),value)]},1);assert.equal(view.available,true);assert.equal(view.rows[0].bias,label);assert.match(view.rows[0].sample,/small sample/)}
});

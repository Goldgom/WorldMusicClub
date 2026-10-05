import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {parseHTML} from 'linkedom';
import {createPlaybackClock,publishPlaybackClock,readPlaybackClock,nativeRangeSeekPosition} from '../web/playback-clock-view.js';
import {installRangeSerializationFixture,OBSERVED_RANGE_ENDPOINT} from './range-input-fixtures.js';

function setup(){
  const {document,window}=parseHTML('<input id="progress" type="range" step="any">');
  const progress=document.getElementById('progress'),restore=installRangeSerializationFixture(window);
  return {document,progress,restore};
}
const context={positionMs:0,durationMs:OBSERVED_RANGE_ENDPOINT.source,available:true,running:false,completed:false,hasStarted:false};

test('exact display clock and raw native fractional range are independent observations',()=>{
  const {document,progress,restore}=setup();
  try{
    progress.min='0';progress.max=String(context.durationMs);progress.value=String(context.durationMs);
    assert.equal(progress.value,OBSERVED_RANGE_ENDPOINT.raw);assert.notEqual(Number(progress.value),context.durationMs);
    const published=publishPlaybackClock(progress,{...context,positionMs:context.durationMs,completed:true,hasStarted:true});
    assert.equal(published.positionMs,context.durationMs);assert.equal(published.transportPositionMs,context.durationMs);
    assert.equal(published.durationMs,context.durationMs);assert.equal(published.phase,'ended');
    assert.deepEqual(readPlaybackClock(document),published);assert.deepEqual(readPlaybackClock(progress),published);
    assert.equal(progress.value,OBSERVED_RANGE_ENDPOINT.raw,'Publishing a clock never rewrites native control evidence');
    assert.equal(progress.max,String(context.durationMs));assert.ok(Object.isFrozen(published));
  }finally{restore();}
});

test('count-in, loop bounds and input grace retain their own meanings without inventing completion',()=>{
  const countIn=createPlaybackClock({...context,positionMs:-1500,rangeStartMs:250,rangeEndMs:750,running:true});
  assert.equal(countIn.positionMs,0);assert.equal(countIn.transportPositionMs,-1500);
  assert.equal(countIn.rangeStartMs,250);assert.equal(countIn.rangeEndMs,750);assert.equal(countIn.durationMs,context.durationMs);
  assert.equal(countIn.phase,'playing');assert.equal(countIn.completed,false);
  const grace=createPlaybackClock({...context,positionMs:context.durationMs+120,running:true,hasStarted:true});
  assert.equal(grace.positionMs,context.durationMs);assert.equal(grace.transportPositionMs,context.durationMs+120);
  assert.equal(grace.phase,'playing');assert.equal(grace.completed,false,'Being at the range end never means the transport finished');
  assert.equal(createPlaybackClock({...context,preparing:true}).phase,'preparing');
  assert.equal(createPlaybackClock({...context,hasStarted:true}).phase,'paused');
  assert.equal(createPlaybackClock({...context,available:false}).phase,'unavailable');
});

test('reader fails closed on missing, malformed, coerced and contradictory clock data',()=>{
  const {progress,restore}=setup();
  try{
    progress.value='0';assert.throws(()=>readPlaybackClock(progress),/missing or invalid/);
    for(const raw of ['', 'null','{}','[]','not-json','x'.repeat(1025)]){progress.setAttribute('data-playback-clock',raw);assert.throws(()=>readPlaybackClock(progress),/missing or invalid/);}
    const valid=createPlaybackClock(context);
    for(const mutate of [v=>delete v.positionMs,v=>v.positionMs='0',v=>v.durationMs=null,v=>v.version=2,v=>v.extra=true,v=>v.rangeEndMs=v.durationMs+1,v=>v.rangeStartMs=-1,v=>v.positionMs=1,v=>v.phase='ended',v=>v.running=true,v=>v.completed=true,v=>v.available=false]){
      const invalid=structuredClone(valid);mutate(invalid);progress.setAttribute('data-playback-clock',JSON.stringify(invalid));
      assert.throws(()=>readPlaybackClock(progress),/missing or invalid/);
    }
  }finally{restore();}
});

test('browser-evaluated reader needs no imports, closure state, or redraw',()=>{
  const {document,progress,restore}=setup();
  try{
    const published=publishPlaybackClock(progress,{...context,positionMs:2041,hasStarted:true});
    const before=progress.outerHTML;
    const read=vm.runInNewContext(`(${readPlaybackClock.toString()})(document)`,{document});
    assert.deepEqual(JSON.parse(JSON.stringify(read)),published);assert.equal(progress.outerHTML,before);
  }finally{restore();}
});

test('native endpoint serialization maps to exact bounds in either rounding direction',()=>{
  const {progress,restore}=setup();
  try{
    let inputs=0,changes=0;progress.addEventListener('input',()=>inputs++);progress.addEventListener('change',()=>changes++);
    for(const end of [OBSERVED_RANGE_ENDPOINT.source,4083.3371666666633]){
      progress.min='0';progress.max=String(end);progress.value=String(end);
      assert.notEqual(Number(progress.value),end);
      const before=[progress.min,progress.max,progress.step,progress.value];assert.equal(nativeRangeSeekPosition(progress,{start:0,end}),end);
      assert.deepEqual([progress.min,progress.max,progress.step,progress.value],before);
    }
    const start=1234.5678901234567,end=OBSERVED_RANGE_ENDPOINT.source;
    progress.min=String(start);progress.max=String(end);progress.value=String(start);
    assert.notEqual(Number(progress.value),start);assert.equal(nativeRangeSeekPosition(progress,{start,end}),start);
    progress.value='2041';assert.equal(nativeRangeSeekPosition(progress,{start,end}),2041,'Interior input remains the actual selected native value');
    assert.equal(inputs,0);assert.equal(changes,0,'Probing native serialization does not dispatch an active control event');
  }finally{restore();}
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {Synth} from '../web/transport.js';

// Deterministic automation model, not a browser/audio-output assertion. The
// original instrument envelope and the independent release multiplier are
// sampled separately so a gain jump cannot hide behind oscillator phase.
class Param {
  value=1; events=[];
  setValueAtTime(value,at){this.events.push({kind:'set',value,at});}
  linearRampToValueAtTime(value,at){this.events.push({kind:'linear',value,at});}
  exponentialRampToValueAtTime(value,at){this.events.push({kind:'exponential',value,at});}
  setTargetAtTime(value,at,tau){this.events.push({kind:'target',value,at,tau});}
  cancelScheduledValues(at){this.events=this.events.filter(event=>event.at<at);}
  at(time){
    let value=this.value,previous=0,target=null;
    const evolve=at=>target?target.value+(value-target.value)*Math.exp(-(at-previous)/target.tau):value;
    for(const event of [...this.events].sort((a,b)=>a.at-b.at)){
      if(event.at>time){
        if(event.kind==='linear')return value+(event.value-value)*(time-previous)/(event.at-previous);
        if(event.kind==='exponential')return value*(event.value/value)**((time-previous)/(event.at-previous));
        return evolve(time);
      }
      value=evolve(event.at);previous=event.at;
      if(event.kind==='target')target=event;else{value=event.value;target=null;}
    }
    return evolve(time);
  }
}
class Node {
  gain=new Param(); frequency={}; connections=[]; starts=[]; stops=[]; disconnected=false;
  connect(node){this.connections.push(node);}
  disconnect(){this.disconnected=true;}
  start(at){this.starts.push(at);}
  stop(at){this.stops.push(at);}
}
function fixture(){
  const oscillators=[],gains=[];
  const context={state:'running',currentTime:0,destination:{},createGain(){const node=new Node();gains.push(node);return node;},createOscillator(){const node=new Node();oscillators.push(node);return node;}};
  const synth=new Synth();synth.context=context;synth.output=context.createGain();
  return {synth,context,oscillators,gains};
}
const level=(voice,time)=>voice.gain.gain.at(time)*voice.releaseGain.gain.at(time);

for(const time of [0.002,0.05,0.3,0.405])test(`note release is continuous at ${time}s and reaches exact zero within 12 ms`,()=>{
  const {synth,context}=fixture();synth.play('key',60,time===0.405?400:null);
  const voice=synth.voices.get('key'),before=structuredClone(voice.gain.gain.events),expected=level(voice,time);
  assert.ok(expected>0);context.currentTime=time;synth.release('key');
  assert.deepEqual(voice.gain.gain.events,before,'Releasing cannot rewrite attack, decay or duration automation');
  assert.equal(level(voice,time),expected,'No step at the release boundary, even during attack');
  assert.ok(Math.abs(level(voice,time-1e-9)-level(voice,time+1e-9))<1e-6);
  assert.equal(voice.releaseGain.gain.at(time+0.006).toFixed(6),'0.500000');
  assert.equal(level(voice,time+0.012),0);
  assert.equal(voice.oscillator.stops.at(-1),time+0.012);
  assert.equal(synth.voices.size,0);assert.equal(synth.releasingVoices.size,1);
  voice.oscillator.onended();assert.equal(synth.releasingVoices.size,0);
  for(const node of [voice.oscillator,voice.gain,voice.releaseGain])assert.equal(node.disconnected,true);
});

test('manual tone retains frequency, velocity, waveform and zero-delay onset without a click oscillator',()=>{
  const {synth,oscillators}=fixture();synth.click=()=>assert.fail('Manual notes must not request a metronome click');
  synth.play('manual:key',69,null,0,'piano',100);const voice=synth.voices.get('manual:key');
  assert.equal(oscillators.length,1);assert.equal(synth.clickVoices.size,0);
  assert.equal(voice.oscillator.frequency.value,440);assert.equal(voice.oscillator.type,'sine');
  assert.deepEqual(voice.oscillator.starts,[0]);
  const peak=0.28*(100/127)**1.5;
  assert.deepEqual(voice.gain.gain.events,[{kind:'set',value:0,at:0},{kind:'linear',value:peak,at:0.008},{kind:'exponential',value:Math.max(0.0001,peak*0.4),at:0.18}]);
  assert.deepEqual(voice.oscillator.connections,[voice.gain]);assert.deepEqual(voice.gain.connections,[voice.releaseGain]);assert.deepEqual(voice.releaseGain.connections,[synth.output]);
});

test('future release and hard stop cancel at current time and disconnect every voice node immediately',()=>{
  for(const operation of ['release','stop']){
    const {synth,context}=fixture();synth.play('future',64,1000,500);const voice=synth.voices.get('future');
    context.currentTime=0.1;synth[operation]('future');
    assert.equal(voice.oscillator.stops.at(-1),0.1);assert.ok(voice.oscillator.stops.at(-1)<voice.start);
    assert.equal(voice.gain.gain.at(0.5),0);assert.equal(synth.voices.size,0);assert.equal(synth.releasingVoices.size,0);
    for(const node of [voice.oscillator,voice.gain,voice.releaseGain])assert.equal(node.disconnected,true);
  }
});

test('retrigger does not delay the replacement and stale onended cannot remove it',()=>{
  const {synth,context}=fixture();synth.play('key',60);const old=synth.voices.get('key');
  context.currentTime=0.05;synth.play('key',67,null,0,'guitar',41);const current=synth.voices.get('key');
  assert.deepEqual(current.oscillator.starts,[0.05]);assert.equal(current.oscillator.type,'triangle');
  assert.equal(current.oscillator.frequency.value,440*2**((67-69)/12));assert.ok(synth.releasingVoices.has(old));
  old.oscillator.onended();assert.equal(synth.voices.get('key'),current);assert.equal(current.oscillator.disconnected,false);
});

test('stop(id) and silence immediately cancel already-released tails including the old same-ID voice',()=>{
  for(const operation of ['stop','silence']){
    const {synth,context}=fixture();synth.play('key',60);const first=synth.voices.get('key');
    context.currentTime=0.05;synth.play('key',64);const second=synth.voices.get('key');
    context.currentTime=0.054;synth.release('key');assert.equal(synth.releasingVoices.size,2);
    synth[operation]('key');assert.equal(synth.releasingVoices.size,0);assert.equal(synth.voices.size,0);
    for(const voice of [first,second]){assert.equal(voice.oscillator.stops.at(-1),0.054);assert.equal(voice.oscillator.disconnected,true);assert.equal(voice.gain.gain.at(1),0);}
    synth.play('key',72);const current=synth.voices.get('key');first.oscillator.onended();second.oscillator.onended();
    assert.equal(synth.voices.get('key'),current);
  }
});

test('release tails share the 64-voice budget even when ended callbacks are delayed',()=>{
  const {synth,context,oscillators}=fixture();
  for(let i=0;i<200;i++){
    context.currentTime=i/100000;synth.play('key',60);
    assert.ok(synth.voices.size+synth.releasingVoices.size<=64);
    assert.ok(oscillators.filter(node=>!node.disconnected).length<=64);
  }
  assert.ok(synth.droppedVoices>0);const active=synth.voices.get('key');
  for(const node of oscillators.filter(node=>node.disconnected))node.onended();
  assert.equal(synth.voices.get('key'),active);synth.silence();
  assert.ok(oscillators.every(node=>node.disconnected));
});

test('scheduled tone start, automatic release and stop times are unchanged; manual release cannot extend them',()=>{
  const {synth,context}=fixture();synth.play('score',55,400,100);const voice=synth.voices.get('score');
  assert.deepEqual(voice.oscillator.starts,[0.1]);assert.deepEqual(voice.oscillator.stops,[0.65]);
  assert.deepEqual(voice.gain.gain.events.at(-1),{kind:'target',value:0.0001,at:0.5,tau:0.02});
  context.currentTime=0.646;synth.release('score');assert.equal(voice.oscillator.stops.at(-1),0.65);assert.equal(level(voice,0.65),0);
});

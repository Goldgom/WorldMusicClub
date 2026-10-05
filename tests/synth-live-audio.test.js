import test from 'node:test';
import assert from 'node:assert/strict';
import {Synth} from '../web/transport.js';

const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
// A contract-level injected receiver. Production receiver/core tests own PCM;
// these tests prove Synth's admission, route selection and graph lifecycle.
function fixture({ready=null,resume=null,failure=null}={}) {
  const graph=[],commands=[],receivers=[],events=[],errors=[];
  const param=()=>({value:1,setValueAtTime(){},linearRampToValueAtTime(){},exponentialRampToValueAtTime(){},setTargetAtTime(){},cancelScheduledValues(){}});
  const node=kind=>{graph.push(['create',kind]);return{gain:param(),frequency:{},connect(){graph.push(['connect',kind]);},disconnect(){graph.push(['disconnect',kind]);},start(){},stop(){}};};
  const context={state:'running',currentTime:0,sampleRate:48000,destination:{},createGain:()=>node('gain'),createOscillator:()=>node('oscillator'),async resume(){this.state='running';}};
  let count=0,token=0,callbacks;
  const synth=new Synth({onEvent:event=>events.push(event),onError:error=>errors.push(error),liveToneFactory:async(ctx,output,options)=>{
    count++;callbacks=options;if(ready)await ready.promise;if(failure)throw failure;
    assert.equal(ctx,context);assert.equal(output,synth.output);
    const fixed=node('live');fixed.connect(output);
    const receiver={state:'ready',disposed:false,play(...args){commands.push(['play',...args]);return ++token;},click(...args){commands.push(['click',...args]);return ++token;},
      release(...args){commands.push(['release',...args]);},stop(...args){commands.push(['stop',...args]);},silence(){commands.push(['silence']);},silenceClicks(){commands.push(['silenceClicks']);},
      async resume(){commands.push(['resume']);if(resume)await resume.promise;this.state='ready';},dispose(){this.disposed=true;fixed.disconnect();}};
    receivers.push(receiver);return receiver;
  }});
  synth.context=context;synth.output=context.createGain();
  return{synth,context,graph,commands,receivers,events,errors,count:()=>count,event:event=>callbacks.onEvent(event),fail:error=>callbacks.onError(error)};
}

test('parallel live preparation creates one silent receiver; repeated unlock never changes its graph',async()=>{
  const ready=deferred(),f=fixture({ready}),{synth}=f;
  const first=synth.prepareLiveAudio(),second=synth.prepareLiveAudio();await Promise.resolve();
  synth.play('unadmitted',60);synth.click('unadmitted');assert.equal(f.commands.length,0);assert.equal(f.count(),1);
  ready.resolve();assert.equal(await first,await second);const prepared=structuredClone(f.graph);
  await Promise.all([synth.unlock(),synth.unlock(),synth.prepareLiveAudio()]);
  assert.deepEqual(f.graph,prepared);assert.equal(f.count(),1);assert.deepEqual(f.commands,[]);
});

test('prepared notes, clicks, release tails, panic and mute use the same fixed receiver and output',async()=>{
  const f=fixture(),{synth}=f;await synth.prepareLiveAudio();const graph=structuredClone(f.graph);
  synth.output.gain.value=.31;
  const token=synth.play('manual:pc',72,null,0,'guitar',101);const voice=synth.voices.get('manual:pc');
  assert.equal(voice.liveToken,token);synth.release('manual:pc');assert.ok(synth.releasingVoices.has(voice));
  synth.click('beat',true,85,.42);synth.silenceClicks();synth.stop('manual:pc');assert.equal(voice.disposed,true);
  synth.play('preview:1',64,420,35,'piano',49);synth.silence();
  synth.muted=true;synth.play('muted',70);synth.click('muted');synth.muted=false;synth.play('fresh',67);synth.silence();
  assert.deepEqual(f.commands,[['play','manual:pc',72,null,0,'guitar',101],['release','manual:pc'],['click','beat',true,85,.42],['silenceClicks'],['stop','manual:pc'],['play','preview:1',64,420,35,'piano',49],['silence'],['play','fresh',67,null,0,'piano',90],['silence']]);
  assert.equal(synth.output.gain.value,.31);assert.deepEqual(f.graph,graph);assert.equal(synth.voices.size+synth.releasingVoices.size+synth.clickVoices.size,0);
});

test('old completion events cannot clear a newer same-ID contact or disconnect its graph',async()=>{
  const f=fixture(),{synth}=f;await synth.prepareLiveAudio();const graph=structuredClone(f.graph);
  const first=synth.play('manual:key',60);synth.release('manual:key');const tail=[...synth.releasingVoices][0];
  const second=synth.play('manual:key',64);f.event({type:'ended',token:first,id:'manual:key',actualEndFrame:900});
  assert.equal(tail.disposed,true);assert.equal(synth.releasingVoices.size,0);assert.equal(synth.voices.get('manual:key').liveToken,second);
  f.event({type:'ended',token:second,id:'manual:key',actualEndFrame:1000});assert.equal(synth.voices.size,0);assert.equal(f.events.length,2);assert.deepEqual(f.graph,graph);
});

test('preparation retires legacy note and click connections before source admission, including late callbacks',async()=>{
  const f=fixture(),{synth,context}=f;synth.play('manual:old',60);synth.click('old-click');
  const legacy=synth.voices.get('manual:old'),replaced=synth.clickVoices.get('old-click');synth.click('old-click');const click=synth.clickVoices.get('old-click');assert.equal(replaced.disposed,true);context.currentTime=.03;synth.release('manual:old');
  await synth.prepareLiveAudio();assert.equal(legacy.disposed,true);assert.equal(click.disposed,true);
  const graph=structuredClone(f.graph);legacy.oscillator.onended();replaced.oscillator.onended();click.oscillator.onended();synth.silence();
  assert.deepEqual(f.graph,graph);assert.equal(synth.voices.size+synth.releasingVoices.size+synth.clickVoices.size,0);
});

test('failed live initialization is visible and cannot fall back to per-note graph mutation',async()=>{
  const failure=Object.assign(new Error('Live processor unavailable'),{code:'live_audio_unavailable'}),f=fixture({failure}),{synth}=f;
  await assert.rejects(synth.prepareLiveAudio(),error=>error===failure);const graph=structuredClone(f.graph);
  await assert.rejects(synth.unlock(),error=>error===failure);await assert.rejects(synth.prepareLiveAudio(),error=>error===failure);
  assert.throws(()=>synth.play('manual:key',60),error=>error===failure);assert.throws(()=>synth.click('beat'),error=>error===failure);
  synth.release('manual:key');synth.stop('manual:key');synth.silence();assert.deepEqual(f.graph,graph);assert.equal(f.count(),1);
});

test('suspension cancels bookkeeping and explicit concurrent unlock resumes the same silent graph once',async()=>{
  const resume=deferred(),f=fixture({resume}),{synth,context}=f;await synth.prepareLiveAudio();synth.play('old',60);const graph=structuredClone(f.graph);
  context.state='suspended';f.receivers[0].state='interrupted';f.fail(Object.assign(new Error('Device stopped'),{code:'live_audio_interrupted'}));
  assert.equal(synth.voices.size,0);assert.equal(f.errors.length,1);assert.equal(synth.liveError,null);
  const first=synth.unlock(),second=synth.unlock();await Promise.resolve();await Promise.resolve();
  assert.equal(f.commands.filter(([kind])=>kind==='resume').length,1);resume.resolve();await Promise.all([first,second]);
  assert.deepEqual(f.graph,graph);assert.equal(f.count(),1);assert.deepEqual(f.commands,[['play','old',60,null,0,'piano',90],['resume']]);
  synth.play('fresh',67);assert.equal(f.commands.at(-1)[1],'fresh');
});

test('late readiness after final disposal is silent and cannot reopen the receiver',async()=>{
  const ready=deferred(),f=fixture({ready}),{synth}=f,pending=synth.prepareLiveAudio();await Promise.resolve();synth.dispose();ready.resolve();
  await assert.rejects(pending,{code:'live_audio_canceled'});assert.equal(f.receivers[0].disposed,true);assert.deepEqual(f.commands,[]);
  await assert.rejects(synth.unlock(),/closed/);assert.equal(synth.liveReceiver,null);
});

test('closed context is terminal before resume and does not rebuild the persistent node',async()=>{
  const f=fixture(),{synth,context}=f;await synth.prepareLiveAudio();synth.play('held',60);const graph=structuredClone(f.graph);
  context.state='closed';f.receivers[0].state='interrupted';context.resume=()=>assert.fail('A closed context must not be resumed');
  f.fail(Object.assign(new Error('Device stopped'),{code:'live_audio_interrupted'}));
  assert.equal(f.errors[0].code,'live_audio_closed');assert.equal(synth.liveError,f.errors[0]);assert.equal(synth.voices.size,0);
  await assert.rejects(synth.unlock(),{code:'live_audio_closed'});await assert.rejects(synth.prepareLiveAudio(),{code:'live_audio_closed'});
  assert.equal(f.count(),1);assert.deepEqual(f.graph,graph);assert.equal(f.commands.some(([kind])=>kind==='resume'),false);
});

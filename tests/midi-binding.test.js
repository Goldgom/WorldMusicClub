import test from 'node:test';
import assert from 'node:assert/strict';
import {setupMidi} from '../web/midi.js';

test('disconnecting or replacing one simulated MIDI port releases only its held input sources',async()=>{
 const globals=Object.fromEntries(['document','navigator','window'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
 const button={textContent:'Connect MIDI',title:'',disabled:false,listeners:{},addEventListener(name,fn){this.listeners[name]=fn}},help={hidden:true};
 const first={id:'one:port',state:'connected',name:'First',onmidimessage:null},second={id:'second',state:'connected',name:'Second',onmidimessage:null};
 const access={inputs:new Map([[first.id,first],[second.id,second]]),onstatechange:null},held=new Map([['keyboard:a',60]]),releases=[];let requests=0;
 Object.defineProperty(globalThis,'document',{configurable:true,value:{getElementById:id=>id==='midi-button'?button:help}});
 Object.defineProperty(globalThis,'navigator',{configurable:true,value:{requestMIDIAccess:async options=>{requests++;assert.equal(options.sysex,false);return access}}});
 Object.defineProperty(globalThis,'window',{configurable:true,value:{addEventListener(){}}});
 try{
  setupMidi({pressNote:(source,midi)=>held.set(source,midi),releaseNote:source=>held.delete(source),releaseMatching:prefix=>{releases.push(prefix);for(const key of held.keys())if(key.startsWith(prefix))held.delete(key)},silenceHeld:()=>assert.fail('Port cleanup must not silence unrelated keys'),notice:()=>{}});
  assert.equal(requests,0);await button.listeners.click();assert.equal(requests,1);
  first.onmidimessage({data:[0x90,64,90],timeStamp:100});second.onmidimessage({data:[0x90,67,90],timeStamp:100});
  assert.equal(held.size,3);first.state='disconnected';access.inputs.delete(first.id);access.onstatechange({port:first});
  assert.equal(first.onmidimessage,null);assert.deepEqual([...held.keys()].sort(),['keyboard:a','midi:second:0:67']);assert.deepEqual(releases,['midi:one%3Aport:']);
  const replacement={...second,onmidimessage:null};access.inputs.set(second.id,replacement);access.onstatechange({port:replacement});
  assert.equal(second.onmidimessage,null);assert.deepEqual([...held.keys()],['keyboard:a']);assert.equal(typeof replacement.onmidimessage,'function');
  replacement.onmidimessage({data:[0x91,69,100],timeStamp:120});assert.ok(held.has('midi:second:1:69'));
  assert.equal(requests,1,'Hotplug does not request expanded permission');
 }finally{for(const[key,descriptor]of Object.entries(globals)){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key]}}
});

test('MIDI callbacks retain release time, velocity, encoding and fresh binding identity through cleanup',async()=>{
 const globals=Object.fromEntries(['document','navigator','window'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
 const button={addEventListener(name,fn){this[name]=fn}},port={id:'private-port',name:'Private name',manufacturer:'Private maker',state:'connected'},events=[],listeners={};
 const access={inputs:new Map([[port.id,port]])};
 Object.defineProperty(globalThis,'document',{configurable:true,value:{getElementById:id=>id==='midi-button'?button:{hidden:true}}});
 Object.defineProperty(globalThis,'navigator',{configurable:true,value:{requestMIDIAccess:async()=>access}});
 Object.defineProperty(globalThis,'window',{configurable:true,value:{addEventListener:(name,fn)=>listeners[name]=fn}});
 try {
  setupMidi({pressNote:(...args)=>events.push(['on',...args]),releaseNote:(...args)=>events.push(['off',...args]),releaseMatching:(...args)=>events.push(['cancel',...args]),notice:()=>{}});
  await button.click();const original=port.onmidimessage;
  for(const data of [[0x92,60,50],[0x92,60,100],[0x82,60,77],[0x92,60,0],[0xb2,64,127],[0xb2,123,0]])port.onmidimessage({data,timeStamp:1234});
  assert.equal(events.length,5,'Pedal messages are still omitted');
  const token=events[0][5].generationToken;assert.equal(events[1][5].generationToken,token);assert.equal(events[0][5].retrigger,true);
  assert.deepEqual(events[2].slice(0,3),['off','midi:private-port:2:60',1234]);
  assert.equal(events[2][3].velocity,77);assert.equal(events[2][3].channel,2);assert.equal(events[2][3].encoding,'midi_note_off');
  assert.equal(events[3][3].encoding,'midi_zero_velocity_note_on');assert.equal(events[4][3].reason,'midi_cc123');
  const replacement={...port,onmidimessage:null};access.inputs.set(port.id,replacement);access.onstatechange({timeStamp:1400});
  assert.equal(port.onmidimessage,null);assert.equal(events.at(-1)[3].reason,'midi_replaced');assert.equal(events.at(-1)[2],1400);
  replacement.onmidimessage({data:[0x92,60,90],timeStamp:1500});assert.notEqual(events.at(-1)[5].generationToken,token);
  original({data:[0x82,60,0],timeStamp:1300});assert.equal(events.at(-1)[3].generationToken,token,'A queued old callback retains its old generation');
  listeners.pagehide({timeStamp:1600});assert.equal(events.at(-1)[3].reason,'pagehide');assert.equal(replacement.onmidimessage,null);
  const previous=events.findLast(event=>event[0]==='on')[5].generationToken;
  listeners.pageshow({persisted:true});replacement.onmidimessage({data:[0x92,60,90],timeStamp:1700});assert.notEqual(events.at(-1)[5].generationToken,previous);
 } finally {for(const[key,descriptor]of Object.entries(globals)){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key]}}
});

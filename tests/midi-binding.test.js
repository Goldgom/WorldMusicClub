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

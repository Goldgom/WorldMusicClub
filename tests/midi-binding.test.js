import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {setupMidi} from '../web/midi.js';

const settle=async()=>{for(let i=0;i<15;i++)await Promise.resolve();};
async function withMidi(action) {
 const {document,window}=parseHTML('<html><body><dialog id="settings-dialog"><div class="shell-dialog-content"></div></dialog><button id="midi-button">Connect MIDI</button><p id="midi-help" hidden>Input help</p></body></html>');
 Object.defineProperty(window.HTMLSelectElement.prototype,'value',{configurable:true,get(){return this.querySelector('option[selected]')?.value||this.querySelector('option')?.value||''},set(value){for(const option of this.querySelectorAll('option'))option.toggleAttribute('selected',option.value===String(value))}});
 const globals=Object.fromEntries(['document','navigator','window','localStorage'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
 const first={id:'one:port',state:'connected',name:'First',onmidimessage:null},second={id:'second',state:'connected',name:'Second',onmidimessage:null};
 const access={inputs:new Map([[first.id,first],[second.id,second]]),onstatechange:null};let requests=0;const saved=new Map();
 for(const[key,value]of Object.entries({document,window,localStorage:{getItem:key=>saved.get(key)??null,setItem:(key,value)=>saved.set(key,value)},navigator:{requestMIDIAccess:async options=>{requests++;assert.equal(options.sysex,false);return access}}}))Object.defineProperty(globalThis,key,{configurable:true,value});
 try {await action({document,window,first,second,access,requests:()=>requests});}
 finally{for(const[key,descriptor]of Object.entries(globals)){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key]}}
}

test('settings-bound MIDI disconnect and replacement release only their held input sources',async()=>withMidi(async({document,first,second,access,requests})=>{
 const held=new Map([['keyboard:a',60]]),releases=[];
 setupMidi({pressNote:(source,midi)=>held.set(source,midi),releaseNote:source=>held.delete(source),releaseMatching:prefix=>{releases.push(prefix);for(const key of held.keys())if(key.startsWith(prefix))held.delete(key)},notice:()=>{}});
 assert.equal(requests(),0);document.getElementById('midi-button').click();await settle();assert.equal(requests(),1);
 first.onmidimessage({data:[0x90,64,90],timeStamp:performance.now()});second.onmidimessage({data:[0x90,67,90],timeStamp:performance.now()});
 assert.equal(held.size,3);first.state='disconnected';access.inputs.delete(first.id);access.onstatechange({port:first,timeStamp:performance.now()});
 assert.equal(first.onmidimessage,null);assert.equal(held.size,2);assert.ok(held.has('keyboard:a'));assert.ok([...held.keys()].some(key=>key.startsWith('midi:second:')));assert.match(releases[0],/^midi:one%3Aport:binding-/);
 const replacement={...second,onmidimessage:null};access.inputs.set(second.id,replacement);access.onstatechange({port:replacement,timeStamp:performance.now()});
 assert.equal(second.onmidimessage,null);assert.deepEqual([...held.keys()],['keyboard:a']);assert.equal(typeof replacement.onmidimessage,'function');
 replacement.onmidimessage({data:[0x91,69,100],timeStamp:performance.now()});assert.ok([...held.keys()].some(key=>key.endsWith(':1:69')));
 assert.equal(requests(),1,'Hotplug does not request expanded permission');
 assert.equal(document.querySelectorAll('#midi-device-select').length,1);assert.ok(document.getElementById('midi-button').closest('#settings-dialog'));
}));

test('MIDI releases retain velocity, encoding and retired identity across replacement and page lifecycle',async()=>withMidi(async({document,window,first:port,access})=>{
 const events=[];setupMidi({pressNote:(...args)=>events.push(['on',...args]),releaseNote:(...args)=>events.push(['off',...args]),releaseMatching:(...args)=>events.push(['cancel',...args]),notice:()=>{}});
 document.getElementById('midi-button').click();await settle();const original=port.onmidimessage,observed=performance.now();
 for(const data of [[0x92,60,50],[0x92,60,100],[0x82,60,77],[0x92,60,0],[0xb2,64,127],[0xb2,123,0]])port.onmidimessage({data,timeStamp:observed});
 assert.equal(events.length,5,'Pedal messages are still omitted');const token=events[0][5].generationToken;
 assert.equal(events[1][5].generationToken,token);assert.equal(events[0][5].retrigger,true);assert.equal(events[2][0],'off');assert.equal(events[2][2],observed);
 assert.equal(events[2][3].velocity,77);assert.equal(events[2][3].channel,2);assert.equal(events[2][3].encoding,'midi_note_off');assert.equal(events[3][3].encoding,'midi_zero_velocity_note_on');assert.equal(events[4][3].reason,'midi_cc123');
 const replacement={...port,onmidimessage:null};access.inputs.set(port.id,replacement);const replacedAt=performance.now();access.onstatechange({timeStamp:replacedAt});
 assert.equal(port.onmidimessage,null);assert.equal(events.at(-1)[3].reason,'midi_replaced');assert.equal(events.at(-1)[2],replacedAt);
 replacement.onmidimessage({data:[0x92,60,90],timeStamp:performance.now()});assert.notEqual(events.at(-1)[5].generationToken,token);
 original({data:[0x82,60,0],timeStamp:observed});assert.equal(events.at(-1)[3].generationToken,token);assert.equal(events.at(-1)[3].liveInput,false);
 const previous=events.findLast(event=>event[0]==='on')[5].generationToken;window.dispatchEvent(new window.Event('pagehide'));
 assert.equal(events.at(-1)[3].reason,'pagehide');assert.equal(replacement.onmidimessage,null);assert.equal(access.onstatechange,null);
 const shown=new window.Event('pageshow');shown.persisted=true;window.dispatchEvent(shown);
 replacement.onmidimessage({data:[0x92,60,90],timeStamp:performance.now()});assert.notEqual(events.at(-1)[5].generationToken,previous);
}));

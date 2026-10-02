import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {MIDI_CHOICE_KEY,normalizeMidiChoice,readMidiChoice as sourceReadChoice,saveMidiChoice as sourceSaveChoice,midiTestReadout as sourceReadout,setupMidiSettings} from '../web/midi-settings.js';

import {createI18n} from '../web/i18n.js';
const english=createI18n({locale:'en'});
const readMidiChoice=storage=>sourceReadChoice(storage,english);
const saveMidiChoice=(value,storage)=>sourceSaveChoice(value,storage,english);
const midiTestReadout=snapshot=>sourceReadout(snapshot,english);

const model = (overrides={}) => ({phase:'ready',choice:{mode:'all',id:null},devices:[{id:'one',name:'Keyboard',state:'connected',connection:'open'}],canTest:true,configuredRange:{low:36,high:96},test:{active:false,last:null,held:[],range:null,message:''},...overrides});
const note = (overrides={}) => ({inputId:'one',kind:'on',midi:60,channel:0,velocity:90,...overrides});
function fixture() {
 const {document,window}=parseHTML('<html><body><dialog id="settings-dialog"><div class="shell-dialog-content"><div class="performance-input-settings"><button id="midi-button">Connect MIDI</button><label id="existing-label">Count-in</label></div><p id="midi-help" hidden>Existing MIDI help</p></div></dialog></body></html>');
 const prototype=window.HTMLSelectElement.prototype,descriptor=Object.getOwnPropertyDescriptor(prototype,'value');
 Object.defineProperty(prototype,'value',{configurable:true,get(){return this.querySelector('option[selected]')?.value||this.querySelector('option')?.value||''},set(value){for(const option of this.querySelectorAll('option'))option.toggleAttribute('selected',option.value===String(value))}});
 const choices=[],tests=[],button=document.getElementById('midi-button'),help=document.getElementById('midi-help');let connects=0;
 button.addEventListener('click',()=>connects++);
 const view=setupMidiSettings({document,i18n:english,onSelection:choice=>choices.push(choice),onTest:active=>tests.push(active)});
 return{document,window,view,button,help,choices,tests,get connects(){return connects},$:id=>document.getElementById(id),restore(){view.destroy();if(descriptor)Object.defineProperty(prototype,'value',descriptor);else delete prototype.value}};
}

test('MIDI choice retains exact opaque IDs and saves no device names or extra settings',()=>{
 for(const value of[null,[],{},true,{mode:'other'},{mode:'single',id:''},{mode:'single',id:3},{mode:'all',id:'one'}])assert.equal(normalizeMidiChoice(value),null);
 const choice={mode:'single',id:'none:<port>/鍵',name:'Private keyboard',manufacturer:'Private maker',sysex:true};
 assert.deepEqual(normalizeMidiChoice(choice),{mode:'single',id:choice.id});let write;
 const result=saveMidiChoice(choice,{setItem:(key,value)=>{write={key,value}}});assert.deepEqual(result,{saved:true,message:''});assert.equal(write.key,MIDI_CHOICE_KEY);assert.deepEqual(JSON.parse(write.value),{version:1,mode:'single',id:choice.id});assert.equal(write.value.includes('Private'),false);assert.equal(write.value.includes('sysex'),false);
 assert.deepEqual(readMidiChoice({getItem:()=>write.value}),{choice:{mode:'single',id:choice.id},message:''});
});

test('MIDI preference failure never broadens to All or overwrites an unreadable saved choice',()=>{
 assert.deepEqual(readMidiChoice({getItem:()=>null}),{choice:{mode:'all',id:null},message:''});
 for(const raw of['broken','null','[]','{"version":2,"mode":"all","id":null}','{"version":1,"mode":"single","id":null}']){
  const result=readMidiChoice({getItem:()=>raw,setItem:()=>assert.fail('Reading cannot overwrite a preference')});assert.deepEqual(result.choice,{mode:'none',id:null});assert.match(result.message,/invalid/);
 }
 const failure=readMidiChoice({getItem(){throw Error('Storage denied')}});assert.deepEqual(failure.choice,{mode:'none',id:null});assert.match(failure.message,/this tab/);
 const choice={mode:'single',id:'one'},before=structuredClone(choice);const saved=saveMidiChoice(choice,{setItem(){throw Error('Quota')}});assert.equal(saved.saved,false);assert.match(saved.message,/this tab.*could not be saved/);assert.deepEqual(choice,before);
 assert.equal(saveMidiChoice({mode:'single',id:null},{setItem:()=>assert.fail('Invalid data cannot be saved')}).saved,false);
});

test('MIDI readout separates observed extrema, configured endpoints and note-off velocity',()=>{
 const input=model({configuredRange:{low:60,high:72},test:{active:true,last:note({kind:'off',midi:72,channel:15,velocity:0}),held:[],range:{low:21,high:108}}});
 const before=structuredClone(input),result=midiTestReadout(input);assert.match(result.lastNote,/Note off.*C5.*72/);assert.equal(result.channel,'16');assert.equal(result.velocity,'0');assert.equal(result.observedRange,'A0–C8 · 21–108');assert.equal(result.configuredRange,'C4–C5 · 60–72');assert.equal(result.rangeState,'inside');assert.equal(result.heldText,'No held keys');assert.deepEqual(input,before);
 input.test.last=note({midi:59});assert.equal(midiTestReadout(input).rangeState,'outside');input.test.last=note({midi:60});assert.equal(midiTestReadout(input).rangeState,'inside');input.configuredRange=null;assert.equal(midiTestReadout(input).rangeState,'unknown');assert.equal(midiTestReadout(input).observedRange,result.observedRange);
 input.test.range=null;assert.match(midiTestReadout(input).observedRange,/No note-on received/,'Configured endpoints and the last event must not invent observed extrema');
});

test('MIDI held pitches preserve duplicate device/channel contacts and clear when test mode stops',()=>{
 const first=note(),second=note({inputId:'two',channel:2}),input=model({test:{active:true,last:first,held:[first,second,note({midi:64})],range:{low:60,high:64}}});
 assert.deepEqual(midiTestReadout(input).heldPitches,[60,64]);assert.match(midiTestReadout(input).heldText,/Held pitches: 2 \/ input contacts: 3/);
 input.test.held=[second];assert.deepEqual(midiTestReadout(input).heldPitches,[60]);input.test.active=false;assert.deepEqual(midiTestReadout(input).heldPitches,[]);assert.match(midiTestReadout(input).lastNote,/C4/);assert.equal(midiTestReadout(input).observedRange,'C4–E4 · 60–64');
});

test('MIDI Settings moves the original Connect control without requesting input or replacing its listener',()=>{
 const f=fixture();try{
  assert.equal(f.$('midi-button'),f.button);assert.equal(f.$('midi-help'),f.help);assert.equal(f.button.closest('dialog').id,'settings-dialog');assert.equal(f.button.closest('section').id,'midi-settings');assert.equal(f.document.querySelectorAll('#midi-button').length,1);assert.equal(f.$('existing-label').closest('.performance-input-settings')!==null,true);assert.equal(f.connects,0);assert.deepEqual(f.choices,[]);assert.deepEqual(f.tests,[]);
  f.button.click();assert.equal(f.connects,1);assert.equal(f.$('midi-test-toggle').disabled,true);assert.equal(f.$('midi-test-keyboard').getAttribute('aria-hidden'),'true');assert.equal(f.$('midi-test-view').getAttribute('aria-live'),'off');assert.equal(f.document.querySelectorAll('[data-midi-test-pitch]').length,128);assert.equal(f.$('midi-test-keyboard').querySelectorAll('[data-midi],button,.pressed').length,0);
 }finally{f.restore()}
});

test('MIDI device state distinguishes disconnected, closed, pending, opening and open error without unsafe markup',()=>{
 const f=fixture();try{
  const devices=[{id:'one',name:'<img src=x onerror=bad()>',state:'connected',connection:'closed',opening:true,error:'<script>Open failed</script>'},{id:'two',name:'Keyboard',state:'disconnected',connection:'pending'},{id:'three',name:'Keyboard',state:'connected',connection:'open'}];
  f.view.render(model({choice:{mode:'single',id:'one'},devices}));const rows=f.$('midi-device-list').children;
  assert.match(rows[0].textContent,/Connected.*Closed.*Opening requested.*Open error/s);assert.equal(rows[0].querySelector('img,script'),null);assert.match(rows[1].textContent,/Disconnected.*Pending/);assert.match(rows[2].textContent,/Connected.*Open/);assert.equal(rows[0].classList.contains('is-selected'),true);assert.equal(rows[1].classList.contains('is-selected'),false);
  f.view.render(model({choice:{mode:'single',id:'missing'},devices}));assert.equal(f.$('midi-device-select').value,'device:missing');assert.match(f.$('midi-device-select').textContent,/Saved device unavailable/);assert.equal(f.$('midi-device-select').querySelector('option[value="all"]').selected,false);
  f.view.render(model({choice:{mode:'none',id:null},devices}));assert.equal(f.document.querySelectorAll('#midi-device-list .is-selected').length,0);
 }finally{f.restore()}
});

test('MIDI Settings sends selection/test intents and waits for controller truth while keeping Stop usable',()=>{
 const f=fixture();try{
  const initial=model();f.view.render(initial);const select=f.$('midi-device-select');select.value='device:one';select.dispatchEvent(new f.window.Event('change'));assert.deepEqual(f.choices,[{mode:'single',id:'one'}]);assert.equal(select.value,'all','The view must not claim a controller selection that has not been rendered');assert.deepEqual(initial.choice,{mode:'all',id:null});
  f.$('midi-test-toggle').click();assert.deepEqual(f.tests,[true]);assert.equal(f.$('midi-settings').dataset.testing,'false');assert.match(f.$('midi-test-toggle').textContent,/Start visual/);
  f.view.render(model({canTest:false,test:{active:true,last:null,held:[],range:null}}));assert.equal(f.$('midi-test-toggle').disabled,false);assert.match(f.$('midi-test-toggle').textContent,/Stop/);f.$('midi-test-toggle').click();assert.deepEqual(f.tests,[true,false]);assert.equal(f.$('midi-settings').dataset.testing,'true','Only a controller snapshot can stop the mode');
 }finally{f.restore()}
});

test('MIDI note updates keep the selected DOM control stable and paint only independent visual keys',()=>{
 const f=fixture();try{
  const input=model({test:{active:true,last:note(),held:[note(),note({midi:64})],range:{low:60,high:64}}});f.view.render(input);const option=f.$('midi-device-select').querySelector('option[value="device:one"]');
  assert.deepEqual([...f.$('midi-test-keyboard').querySelectorAll('.midi-test-key.is-held')].map(key=>Number(key.dataset.midiTestPitch)),[60,64]);assert.match(f.$('midi-test-last-note').textContent,/C4.*60/);assert.equal(f.$('midi-test-channel').textContent,'1');assert.equal(f.$('midi-test-velocity').textContent,'90');
  input.test.last=note({kind:'off',midi:60,velocity:44});input.test.held=[note({midi:64})];f.view.render(input);assert.equal(f.$('midi-device-select').querySelector('option[value="device:one"]'),option);assert.deepEqual([...f.$('midi-test-keyboard').querySelectorAll('.midi-test-key.is-held')].map(key=>Number(key.dataset.midiTestPitch)),[64]);
  f.$('midi-test-keyboard').querySelector('[data-midi-test-pitch="64"]').click();assert.deepEqual(f.choices,[]);assert.deepEqual(f.tests,[],'The visual strip cannot play or manufacture an input');
  input.test.active=false;f.view.render(input);assert.equal(f.$('midi-test-keyboard').querySelectorAll('.is-held').length,0);assert.match(f.$('midi-test-status').textContent,/stopped/);assert.match(f.$('midi-test-range').textContent,/60–64/);
 }finally{f.restore()}
});

test('MIDI storage and timing exclusions stay explicit and extreme test pitches only pan the local strip',()=>{
 const f=fixture();try{
  Object.defineProperty(f.$('midi-test-scroll'),'clientWidth',{value:300});Object.defineProperty(f.$('midi-test-keyboard'),'clientWidth',{value:1000});f.$('midi-test-scroll').scrollLeft=0;f.$('settings-dialog').scrollTop=140;
  f.view.render(model({omittedTimingEvents:3,storageMessage:'Current tab only; saving failed.',test:{active:true,last:note({midi:127}),held:[note({midi:127})],range:{low:127,high:127}}}));
  assert.equal(f.$('midi-storage-status').hidden,false);assert.match(f.$('midi-storage-status').textContent,/reported a diagnostic/);assert.equal(f.$('midi-storage-details').querySelector('p').textContent,'Current tab only; saving failed.');assert.equal(f.$('midi-timing-status').hidden,false);assert.match(f.$('midi-timing-status').textContent,/3 timing-ambiguous.*excluded from practice/);assert.equal(f.$('midi-test-range-status').dataset.range,'outside');assert.ok(f.$('midi-test-scroll').scrollLeft>600);assert.equal(f.$('settings-dialog').scrollTop,140);
  f.view.render(model({test:{active:true,last:note({midi:0}),held:[note({midi:0})],range:{low:0,high:127}}}));assert.equal(f.$('midi-test-scroll').scrollLeft,0);assert.equal(f.$('settings-dialog').scrollTop,140);assert.equal(f.$('midi-storage-status').hidden,true);assert.equal(f.$('midi-timing-status').hidden,true);assert.equal(f.$('midi-test-range').textContent,'C-1–G9 · 0–127');
 }finally{f.restore()}
});

test('MIDI Settings cleanup restores existing controls and removes only its own UI callbacks',()=>{
 const f=fixture();try{
  const select=f.$('midi-device-select'),toggle=f.$('midi-test-toggle');f.view.render(model());f.view.destroy();assert.equal(f.$('midi-settings'),null);assert.equal(f.button.parentElement.className,'performance-input-settings');assert.equal(f.button.nextElementSibling.id,'existing-label');assert.equal(f.help.parentElement.className,'shell-dialog-content');f.button.click();assert.equal(f.connects,1);select.dispatchEvent(new f.window.Event('change'));toggle.click();assert.deepEqual(f.choices,[]);assert.deepEqual(f.tests,[]);f.view.render(model());assert.equal(f.$('midi-settings'),null);
 }finally{f.restore()}
});

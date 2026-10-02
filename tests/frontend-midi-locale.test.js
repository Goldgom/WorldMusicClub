import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {createI18n} from '../web/i18n.js';
import {setupMidi} from '../web/midi.js';
import {setupMidiSettings,readMidiChoice,saveMidiChoice} from '../web/midi-settings.js';

const settle=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
function fixture(locale='zh-CN') {
  const {document,window}=parseHTML('<html><body><dialog id="settings-dialog" open><div class="shell-dialog-content"><input id="unrelated-draft" value="1/3"></div></dialog><button id="midi-button"></button><p id="midi-help" hidden></p></body></html>');
  const prototype=window.HTMLSelectElement.prototype,descriptor=Object.getOwnPropertyDescriptor(prototype,'value');
  Object.defineProperty(prototype,'value',{configurable:true,get(){return this.querySelector('option[selected]')?.value||this.querySelector('option')?.value||''},set(value){for(const option of this.querySelectorAll('option'))option.toggleAttribute('selected',option.value===String(value))}});
  const i18n=createI18n({locale,onReport:report=>assert.fail(JSON.stringify(report))});
  const saved=new Map(),storage={getItem:key=>saved.get(key)??null,setItem:(key,value)=>saved.set(key,value)};
  return {document,window,i18n,storage,saved,$:id=>document.getElementById(id),restore(){if(descriptor)Object.defineProperty(prototype,'value',descriptor);else delete prototype.value}};
}
function port(id='private:<port>/鍵',name='<Device & 原始名称>') {
  const result={id,name,manufacturer:'Private Maker',state:'connected',connection:'closed',opens:0,closes:0,open(){this.opens++;this.connection='open';return Promise.resolve(this)},close(){this.closes++;this.connection='closed';return Promise.resolve(this)}};
  return result;
}
function setup(f,input,extras={}) {
  const events=[],counts={access:0,pause:0,notices:0},access={inputs:new Map([[input.id,input]])};
  const controller=setupMidi({document:f.document,window:f.window,i18n:f.i18n,storage:f.storage,navigator:{requestMIDIAccess:async()=>{counts.access++;return access}},pressNote:(...args)=>events.push(['on',...args]),releaseNote:(...args)=>events.push(['off',...args]),releaseMatching:(...args)=>events.push(['cancel',...args]),notice:()=>counts.notices++,pausePlayback:()=>counts.pause++,getConfiguredRange:()=>({low:48,high:84}),...extras});
  return {controller,events,counts,access};
}

test('MIDI locale changes preserve open ports, current held practice identity, and selected DOM controls',async()=>{
  const f=fixture(),input=port(),runtime=setup(f,input);
  try {
    assert.equal(f.$('midi-button').textContent,'连接 MIDI');assert.equal(f.$('midi-device-select').getAttribute('aria-label'),'输入设备');
    assert.equal(runtime.counts.access,0);await runtime.controller.connect();await settle();
    input.onmidimessage({data:[0x92,60,93],timeStamp:performance.now()});
    const handler=input.onmidimessage,on=runtime.events.at(-1),before=runtime.controller.snapshot(),counts={...runtime.counts,opens:input.opens,closes:input.closes};
    const select=f.$('midi-device-select'),option=[...select.options].find(option=>option.value===`device:${input.id}`),draft=f.$('unrelated-draft');draft.value='11/7';
    f.document.activeElement=select;
    f.i18n.setLocale('en');
    assert.equal(f.$('midi-button').textContent,'MIDI connected: 1');assert.equal(select.getAttribute('aria-label'),'Receive from');
    assert.match(f.$('midi-test-scroll').getAttribute('aria-label'),/scroll to inspect all pitches/);
    assert.equal(f.$('midi-device-select'),select);assert.equal(f.document.activeElement,select);assert.equal([...select.options].find(item=>item.value===option.value),option);
    assert.equal(draft.value,'11/7');assert.equal(input.onmidimessage,handler);assert.deepEqual(runtime.controller.snapshot(),before);
    assert.deepEqual({...runtime.counts,opens:input.opens,closes:input.closes},counts);assert.equal(runtime.events.at(-1),on);
    assert.equal(f.$('midi-device-list').querySelector('strong').textContent,input.name);assert.equal(f.$('midi-device-list').querySelector('img'),null);
    input.onmidimessage({data:[0x82,60,51],timeStamp:performance.now()});assert.equal(runtime.events.at(-1)[3].generationToken,on[5].generationToken);
    assert.equal(runtime.events.at(-1)[3].channel,2);assert.equal(runtime.events.at(-1)[3].velocity,51);
  } finally {f.restore();}
});

test('MIDI active key test retains last note, observed range, duplicate contacts and channel on locale redraw',async()=>{
  const f=fixture('en'),input=port(),runtime=setup(f,input);
  try {
    await runtime.controller.connect();await settle();f.$('midi-test-toggle').click();await settle();
    input.onmidimessage({data:[0x90,60,81],timeStamp:performance.now()});input.onmidimessage({data:[0x9f,60,97],timeStamp:performance.now()});
    const before=runtime.controller.snapshot(),handler=input.onmidimessage,eventCount=runtime.events.length,counts={...runtime.counts,opens:input.opens,closes:input.closes};
    const key=f.$('midi-test-keyboard').querySelector('[data-midi-test-pitch="60"]');assert.equal(key.classList.contains('is-held'),true);
    f.$('midi-test-scroll').scrollLeft=210;f.$('settings-dialog').scrollTop=90;f.i18n.setLocale('zh-CN');
    assert.equal(f.$('midi-test-toggle').textContent,'停止按键测试');assert.equal(f.$('midi-test-toggle').getAttribute('aria-label'),'停止按键测试');
    assert.match(f.$('midi-test-last-note').textContent,/按下：C4/);assert.equal(f.$('midi-test-channel').textContent,'16');assert.equal(f.$('midi-test-velocity').textContent,'97');
    assert.match(f.$('midi-test-held').textContent,/1 个音高／2 个输入触点/);assert.equal(f.$('midi-test-input').textContent,input.name);
    assert.deepEqual(runtime.controller.snapshot(),before);assert.equal(input.onmidimessage,handler);assert.equal(runtime.events.length,eventCount);
    assert.deepEqual({...runtime.counts,opens:input.opens,closes:input.closes},counts);assert.equal(key.classList.contains('is-held'),true);
    assert.equal(f.$('midi-test-scroll').scrollLeft,210);assert.equal(f.$('settings-dialog').scrollTop,90);
    f.$('settings-dialog').dispatchEvent(new f.window.Event('close'));await settle();
    assert.equal(runtime.controller.snapshot().test.reason,'settings_closed');assert.match(f.$('midi-test-status').textContent,/设置关闭/);
    f.i18n.setLocale('en');assert.match(f.$('midi-test-status').textContent,/Settings closed/);assert.equal(f.$('midi-test-channel').textContent,'16');
  } finally {f.restore();}
});

test('a locale change cannot settle, cancel or replace a pending MIDI port lease',async()=>{
  const f=fixture(),input=port();let finish;
  input.open=function(){this.opens++;return new Promise(resolve=>{finish=()=>{this.connection='open';resolve(this)}})};
  const runtime=setup(f,input);
  try {
    await runtime.controller.connect();await settle();assert.equal(input.opens,1);assert.equal(input.connection,'closed');
    const before=runtime.controller.snapshot();f.i18n.setLocale('en');
    assert.deepEqual(runtime.controller.snapshot(),before);assert.equal(input.opens,1);assert.equal(input.closes,0);assert.equal(input.onmidimessage,undefined);
    assert.equal(f.$('midi-button').textContent,'Opening MIDI');assert.match(f.$('midi-device-list').textContent,/Opening requested/);
    finish();await settle();assert.equal(input.opens,1);assert.equal(f.$('midi-button').textContent,'MIDI connected: 1');assert.equal(runtime.counts.access,1);
  } finally {f.restore();}
});

test('unavailable and None choices retain exact IDs across locales without broadening input or saving source metadata',()=>{
  const f=fixture(),choices=[],view=setupMidiSettings({document:f.document,i18n:f.i18n,onSelection:choice=>choices.push(choice)}),id='none:private/<鍵>';
  try {
    const snapshot={phase:'ready',choice:{mode:'single',id},devices:[],canTest:false,test:{active:false}};view.render(snapshot);
    const select=f.$('midi-device-select'),missing=[...select.options].find(option=>option.value===`device:${id}`);
    assert.equal(select.value,`device:${id}`);assert.equal(missing.disabled,true);f.i18n.setLocale('en');
    assert.equal(select.value,`device:${id}`);assert.equal([...select.options].find(option=>option.value===`device:${id}`),missing);assert.equal(missing.textContent,'Saved device unavailable');assert.deepEqual(choices,[]);
    select.value='none';f.i18n.setLocale('zh-CN');assert.equal(select.value,'none','Unsubmitted selection draft is retained');assert.deepEqual(choices,[]);
    view.render({...snapshot,choice:{mode:'none',id:null}});f.i18n.setLocale('en');assert.equal(select.value,'none');
    saveMidiChoice({mode:'single',id,name:'Secret name',manufacturer:'Secret maker'},f.storage,f.i18n);
    assert.deepEqual(readMidiChoice(f.storage,f.i18n).choice,{mode:'single',id});assert.doesNotMatch([...f.saved.values()].join(''),/Secret/);
  } finally {view.destroy();f.restore();}
});

test('MIDI preference errors redraw from codes and browser diagnostics remain labeled literal UI-only detail',async()=>{
  const f=fixture(),input=port(),detail='<script>private browser port failure & 原文</script>';
  input.open=function(){this.opens++;return Promise.reject(new Error(detail))};
  const runtime=setup(f,input);
  try {
    await runtime.controller.connect();await settle();
    assert.equal(runtime.controller.snapshot().messageCode,'midi_open_failed');assert.equal(runtime.controller.snapshot().devices[0].errorDetails,detail);
    assert.match(f.$('midi-access-status').textContent,/无法打开/);assert.equal(f.$('midi-device-list').querySelector('details p').textContent,detail);assert.equal(f.$('midi-device-list').querySelector('script'),null);
    const disclosure=f.$('midi-device-list').querySelector('details');disclosure.open=true;f.document.activeElement=disclosure.querySelector('summary');
    f.i18n.setLocale('en');assert.equal(f.$('midi-device-list').querySelector('details'),disclosure);assert.equal(disclosure.open,true);assert.equal(f.document.activeElement,disclosure.querySelector('summary'));assert.match(f.$('midi-access-status').textContent,/could not be opened/);assert.equal(f.$('midi-device-list').querySelector('details summary').textContent,'Original technical details');
    assert.equal(f.$('midi-device-list').querySelector('details p').textContent,detail);assert.equal(runtime.controller.exportRoutingData(),null);
    const failed=readMidiChoice({getItem(){throw Error('blocked')}},f.i18n);assert.equal(failed.code,'midi_choice_read_failed');assert.equal(failed.choice.mode,'none');
  } finally {f.restore();}
  const p=fixture(),view=setupMidiSettings({document:p.document,i18n:p.i18n});
  try {
    view.render({phase:'idle',choice:{mode:'none',id:null},storageCode:'midi_choice_read_failed',storageMessage:'old locale should never be displayed'});
    assert.match(p.$('midi-storage-status').textContent,/无法读取/);p.i18n.setLocale('en');assert.match(p.$('midi-storage-status').textContent,/could not be read/);assert.equal(p.$('midi-storage-details').hidden,true);
    assert.equal(p.$('midi-device-select').value,'none');
  } finally {view.destroy();p.restore();}
});


test('long MIDI translations remain complete with literal device names and owned wrapping without changing choices',()=>{
  const f=fixture(),long='很长的标签 '.repeat(100),base=f.i18n;
  const translated={t:(key,params)=>['input.midi.title','input.midi.receive','input.midi.testStart','input.midi.pitchMapAria'].includes(key)?long+base.t(key,params):base.t(key,params),formatNumber:base.formatNumber,subscribe:base.subscribe,get revision(){return base.revision}};
  const view=setupMidiSettings({document:f.document,i18n:translated});
  try {
    view.render({phase:'ready',choice:{mode:'none',id:null},devices:[{id:'opaque',name:'<Name> '.repeat(400),state:'connected',connection:'closed'}]});
    assert.equal(f.$('midi-settings-title').textContent,long+'MIDI 设备与按键测试');assert.equal(f.$('midi-device-select').getAttribute('aria-label'),long+'输入设备');
    assert.equal(f.$('midi-settings').style.overflowWrap,'anywhere');assert.equal(f.$('midi-test-toggle').style.whiteSpace,'normal');assert.equal(f.$('midi-device-select').style.maxWidth,'100%');
    const before=f.$('midi-device-list').querySelector('strong').textContent;base.setLocale('en');assert.equal(f.$('midi-device-list').querySelector('strong').textContent,before);assert.equal(f.$('midi-device-select').value,'none');
    assert.equal(f.$('midi-settings-title').textContent,long+'MIDI device and key test');assert.equal(f.$('midi-device-list').querySelector('name'),null);
  }finally{view.destroy();f.restore();}
});


test('unknown MIDI status codes do not infer meaning from English prose and preserve exact details',()=>{
  const f=fixture(),view=setupMidiSettings({document:f.document,i18n:f.i18n});
  try {
    const raw='<diagnostic> Permission denied? caller-owned detail </diagnostic>';
    view.render({phase:'error',choice:{mode:'none',id:null},messageCode:'__proto__',message:raw,storageCode:'toString',storageMessage:raw,devices:[{id:'original',state:'connected',connection:'closed',errorCode:'future_code',error:raw}],test:{active:false,code:'future_code',message:raw}});
    for(const id of ['midi-access-details','midi-storage-details','midi-test-details'])assert.equal(f.$(id).querySelector('p').textContent,raw);
    assert.equal(f.$('midi-device-list').querySelector('details p').textContent,raw);assert.equal(f.$('midi-settings').querySelector('diagnostic'),null);
    f.i18n.setLocale('en');assert.match(f.$('midi-access-status').textContent,/could not be enabled/);assert.doesNotMatch(f.$('midi-access-status').textContent,/Permission denied/);assert.equal(f.$('midi-access-details').querySelector('p').textContent,raw);
  }finally{view.destroy();f.restore();}
});

test('MIDI denied and unsupported notices redraw in the actual notice DOM without reconnecting',async()=>{
  const {setupNoticeView}=await import('../web/notice-view.js');
  for(const supported of [true,false]) {
    const f=fixture('en');
    const banner=f.document.createElement('div');banner.id='notice';banner.innerHTML='<p id="notice-message"></p><button id="notice-dismiss"></button>';f.document.body.append(banner);
    const notices=setupNoticeView({document:f.document,i18n:f.i18n});let requests=0;
    const navigator=supported?{requestMIDIAccess:async options=>{requests++;assert.deepEqual(options,{sysex:false});throw new DOMException('Original runtime denial','SecurityError');}}:{};
    setupMidi({document:f.document,window:f.window,i18n:f.i18n,storage:f.storage,navigator,notice:(...args)=>notices.show(...args),pressNote:()=>assert.fail('No input should occur'),releaseNote:()=>{},releaseMatching:()=>{}});
    try {
      f.$('midi-button').click();await settle();
      const key=supported?'input.midi.permissionDenied':'input.midi.access.unsupported';
      assert.equal(f.$('notice-message').textContent,f.i18n.t(key));
      const history=f.$('notice-history-list').firstElementChild,message=f.$('notice-message');
      f.i18n.setLocale('zh-CN');
      assert.equal(message.textContent,f.i18n.t(key));assert.equal(history.querySelector('p').textContent,f.i18n.t(key));
      f.i18n.setLocale('en');
      assert.equal(message.textContent,f.i18n.t(key));assert.equal(f.$('notice-history-list').firstElementChild,history);
      assert.equal(requests,supported?1:0,'Locale redraw cannot reconnect or manufacture permission requests');
      assert.equal(f.$('midi-button').disabled,false,'Explicit retry remains available');
    } finally {notices.destroy();f.restore();}
  }
});

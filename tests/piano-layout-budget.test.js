import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {observePianoStatusBudget} from '../web/performance-view.js';
import {observePianoNoticeBudget} from '../web/piano-stage-view.js';

function fixture(){
  const {document}=parseHTML('<html><body><div id="notice"></div><main id="workspace" class="piano-workspace"><div class="performance-status"></div></main></body></html>');
  const status=document.querySelector('.performance-status'),notice=document.getElementById('notice'),frames=new Map(),observers=[],trace=[];
  let serial=0,statusHeight=38,noticeHeight=24;
  status.getBoundingClientRect=()=>{trace.push('read:status');return{width:900,height:statusHeight};};
  notice.getBoundingClientRect=()=>{trace.push('read:notice');return{width:900,height:noticeHeight};};
  const values=new Map(),style={getPropertyValue:name=>values.get(name),setProperty(name,value){trace.push(`write:${name}:${value}`);values.set(name,value);},removeProperty(name){trace.push(`remove:${name}`);values.delete(name);}};
  Object.defineProperty(document.body,'style',{value:style});
  const listeners=new Map();
  const window={requestAnimationFrame(callback){frames.set(++serial,callback);return serial;},cancelAnimationFrame:id=>frames.delete(id),getComputedStyle:()=>({marginTop:'2px',marginBottom:'3px'}),
    addEventListener(type,callback){if(!listeners.has(type))listeners.set(type,new Set());listeners.get(type).add(callback);},removeEventListener:(type,callback)=>listeners.get(type)?.delete(callback),
    ResizeObserver:class{constructor(callback){this.callback=callback;observers.push(this);}observe(node){this.node=node;}disconnect(){this.disconnected=true;}},
    MutationObserver:class{constructor(callback){this.callback=callback;observers.push(this);}observe(node){this.node=node;}disconnect(){this.disconnected=true;}}};
  Object.defineProperty(document,'defaultView',{value:window});
  const flush=()=>{const batch=[...frames.values()];frames.clear();for(const callback of batch)callback();};
  const mountStatus=()=>observePianoStatusBudget({document,status,window}),mountNotice=()=>observePianoNoticeBudget({document,window});
  const emit=()=>observers.forEach(observer=>observer.callback());
  return{document,status,notice,window,frames,observers,trace,flush,emit,mountStatus,mountNotice,budget:name=>style.getPropertyValue(`--piano-${name}-space`),setHeights(status,notice){statusHeight=status;noticeHeight=notice;}};
}

test('ResizeObserver callbacks defer and coalesce both piano measurements before body style writes',()=>{
  const env=fixture(),stopStatus=env.mountStatus(),stopNotice=env.mountNotice();
  try{
    env.flush();env.trace.length=0;env.setHeights(61.25,49.5);
    for(let index=0;index<30;index++)env.emit();
    assert.deepEqual(env.trace,[],'Observer delivery may only queue work; it must not read layout or mutate dimensions synchronously');
    assert.equal(env.frames.size,1,'Both budgets share one pending animation frame even through a notification storm');
    env.flush();assert.deepEqual(env.trace,['read:status','read:notice','write:--piano-status-space:62px','write:--piano-notice-space:55px']);
    env.trace.length=0;env.emit();env.flush();assert.deepEqual(env.trace,['read:status','read:notice'],'Unchanged geometry produces no style mutation or feedback');
    assert.equal(env.frames.size,0);
  }finally{stopNotice();stopStatus();}
});

test('destroy cancels queued work and a late old-owner callback cannot overwrite or remove remounted budgets',()=>{
  const env=fixture(),stopFirst=env.mountStatus();env.flush();env.setHeights(70,24);env.emit();
  const cancelled=[...env.frames.values()];stopFirst();assert.equal(env.frames.size,0);env.trace.length=0;
  for(const callback of cancelled)callback();env.emit();assert.deepEqual(env.trace,[]);assert.equal(env.frames.size,0);
  const stopSecond=env.mountStatus();env.flush();assert.equal(env.budget('status'),'70px');
  env.setHeights(84,24);env.emit();const stale=[...env.frames.values()],stopThird=env.mountStatus();stopSecond();
  env.flush();assert.equal(env.budget('status'),'84px');env.trace.length=0;
  for(const callback of stale)callback();stopFirst();stopSecond();assert.deepEqual(env.trace,[],'Retired cleanup does not remove the new owner’s property');
  assert.equal(env.budget('status'),'84px');stopThird();assert.equal(env.budget('status'),undefined);assert.ok(env.observers.every(observer=>observer.disconnected));
});

test('deferred budgets retain hidden normal/Free parity, honor notice dismissal and ignore detached source nodes',()=>{
  const env=fixture(),stopStatus=env.mountStatus(),stopNotice=env.mountNotice();
  try{
    env.flush();assert.equal(env.budget('status'),'38px');assert.equal(env.budget('notice'),'29px');
    env.setHeights(0,24);env.notice.hidden=true;env.emit();env.flush();assert.equal(env.budget('status'),'38px');assert.equal(env.budget('notice'),'0px');
    env.document.getElementById('workspace').classList.remove('piano-workspace');env.setHeights(90,32);env.notice.hidden=false;env.emit();env.flush();assert.equal(env.budget('status'),'38px','A guitar row cannot replace the shared piano budget');assert.equal(env.budget('notice'),'37px');
    env.document.getElementById('workspace').classList.add('piano-workspace');env.emit();env.flush();assert.equal(env.budget('status'),'90px');
    env.emit();env.status.remove();env.notice.replaceWith(env.notice.cloneNode());env.trace.length=0;env.flush();assert.deepEqual(env.trace,[],'Retired DOM sources are neither measured nor written after replacement');
    assert.equal(env.budget('status'),'90px');assert.equal(env.budget('notice'),'37px');
  }finally{stopNotice();stopStatus();}
});

test('disposing one budget preserves the other pending owner and superseded notice observers stay inert',()=>{
  const env=fixture(),stopStatus=env.mountStatus(),stopNotice=env.mountNotice();env.flush();env.setHeights(66,42);env.emit();
  stopStatus();assert.equal(env.frames.size,1,'Notice still owns the shared pending frame');env.trace.length=0;env.flush();
  assert.deepEqual(env.trace,['read:notice','write:--piano-notice-space:47px']);assert.equal(env.budget('status'),undefined);
  env.setHeights(66,54);env.emit();const stopReplacement=env.mountNotice();stopNotice();env.flush();assert.equal(env.budget('notice'),'59px');
  env.trace.length=0;env.emit();env.flush();assert.deepEqual(env.trace,['read:notice'],'Only the current notice owner measures, even if retired callbacks arrive late');
  stopNotice();assert.equal(env.budget('notice'),'59px');env.emit();const cancelled=[...env.frames.values()];stopReplacement();env.trace.length=0;
  for(const callback of cancelled)callback();env.emit();assert.deepEqual(env.trace,[]);assert.equal(env.frames.size,0);assert.ok(env.observers.every(observer=>observer.disconnected));
});

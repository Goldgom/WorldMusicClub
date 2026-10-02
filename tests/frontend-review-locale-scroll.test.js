import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {createReviewLocale} from '../web/review-locale.js';
import {assertLocaleScrollContext} from './locale-browser-regression.js';

// Deliberately controlled layout, not a browser substitute: real Windows/Linux
// geometry and settled scroll anchoring are checked by locale-browser-regression.
function fixture(changes = {}) {
  const {document} = parseHTML('<html><body><section id="review"><p data-review-i18n="heading">en</p><input id="confirmation"><button>Activate</button></section></body></html>');
  const root=document.querySelector('#review'),heading=root.querySelector('p'),control=root.querySelector('input');
  const layouts={en:{height:300,width:400,maxTop:500,maxLeft:100,contentTop:240,contentLeft:60,controlHeight:20,controlWidth:20,originTop:40,originLeft:50},...changes};
  layouts['zh-CN']={...layouts.en,...changes['zh-CN']};
  let text='en',locale='en',top=100,left=20,listener;
  const layout=()=>layouts[text],clamp=(value,maximum)=>Math.max(0,Math.min(value,maximum));
  Object.defineProperty(heading,'textContent',{configurable:true,get:()=>text,set(value){
    text=value;
    if(layout().nativeTop!==undefined)top=layout().nativeTop;
    if(layout().nativeLeft!==undefined)left=layout().nativeLeft;
  }});
  Object.defineProperties(root,{
    clientHeight:{get:()=>layout().height},clientWidth:{get:()=>layout().width},clientTop:{value:2},clientLeft:{value:2},
    scrollHeight:{get:()=>layout().height+layout().maxTop},scrollWidth:{get:()=>layout().width+layout().maxLeft},
    scrollTop:{get:()=>clamp(top,layout().maxTop),set:value=>{top=clamp(value,layout().maxTop)}},
    scrollLeft:{get:()=>clamp(left,layout().maxLeft),set:value=>{left=clamp(value,layout().maxLeft)}},
  });
  root.getBoundingClientRect=()=>({top:layout().originTop,left:layout().originLeft,width:layout().width+4,height:layout().height+4});
  control.getBoundingClientRect=()=>({top:layout().originTop+2+layout().contentTop-root.scrollTop,
    left:layout().originLeft+2+layout().contentLeft-root.scrollLeft,height:layout().controlHeight,width:layout().controlWidth});
  document.activeElement=control;control.checked=true;control.value='literal draft';control.selectionStart=2;control.selectionEnd=6;
  control.focus=()=>assert.fail('A locale redraw must never refocus a control');
  const i18n={t:()=>locale,subscribe(callback){listener=callback;return()=>{listener=null}},setLocale(value){locale=value;listener?.()}};
  const view=createReviewLocale(root,i18n);
  const snapshot=()=>{
    const frame=root.getBoundingClientRect(),bounds=control.getBoundingClientRect();
    const focus={id:control.id,top:bounds.top-frame.top-root.clientTop,left:bounds.left-frame.left-root.clientLeft,width:bounds.width,height:bounds.height};
    focus.visible=focus.width>0&&focus.height>0&&focus.top<root.clientHeight&&focus.top+focus.height>0&&focus.left<root.clientWidth&&focus.left+focus.width>0;
    focus.fullyVisible=focus.visible&&focus.top>=-1&&focus.left>=-1&&focus.top+focus.height<=root.clientHeight+1&&focus.left+focus.width<=root.clientWidth+1;
    return {top:root.scrollTop,left:root.scrollLeft,maxTop:layout().maxTop,maxLeft:layout().maxLeft,
      viewport:{top:frame.top+2,left:frame.left+2,height:root.clientHeight,width:root.clientWidth},focus:document.activeElement===control?focus:null};
  };
  return {document,root,control,i18n,view,snapshot};
}

for(const nativeTop of [undefined,60])test(`locale redraw preserves a visible focus anchor through reflow${nativeTop===undefined?'':' already handled by browser anchoring'}`,()=>{
  const f=fixture({'zh-CN':{contentTop:200,contentLeft:50,nativeTop,originTop:80}}),before=f.snapshot();
  f.i18n.setLocale('zh-CN');
  assert.equal(f.root.scrollTop,60);assert.equal(f.root.scrollLeft,10);
  assertLocaleScrollContext(before,f.snapshot(),'translated geometry');
  assert.equal(f.document.activeElement,f.control);assert.equal(f.root.querySelector('input'),f.control);
  assert.equal(f.control.checked,true);assert.equal(f.control.value,'literal draft');assert.equal(f.control.selectionStart,2);assert.equal(f.control.selectionEnd,6);
  f.i18n.setLocale('en');assert.equal(f.root.scrollTop,100);assert.equal(f.root.scrollLeft,20);f.view.destroy();
});

test('a 127 to 59 scroll change is accepted only when new geometry makes it the nearest attainable anchor',()=>{
  const f=fixture({'zh-CN':{maxTop:59,contentTop:240}});f.root.scrollTop=127;const before=f.snapshot();
  f.i18n.setLocale('zh-CN');assert.equal(f.root.scrollTop,59);assertLocaleScrollContext(before,f.snapshot(),'shorter extent');
  assert.equal(f.snapshot().focus.visible,true);
  const unexplained=structuredClone(f.snapshot());unexplained.maxTop=500;
  assert.throws(()=>assertLocaleScrollContext(before,unexplained,'unexplained reset'),/nearest attainable top/);
  f.view.destroy();
});

test('translation that expands content moves scroll to keep the same control visible',()=>{
  const f=fixture({'zh-CN':{contentTop:640,maxTop:900}}),before=f.snapshot();
  f.i18n.setLocale('zh-CN');assert.equal(f.root.scrollTop,500);assertLocaleScrollContext(before,f.snapshot(),'expanded content');
  const lost=structuredClone(f.snapshot());lost.top=100;lost.focus.top=540;lost.focus.visible=false;
  assert.throws(()=>assertLocaleScrollContext(before,lost,'lost reading position'),/nearest attainable top/);f.view.destroy();
});

test('a shorter viewport moves the anchor only enough to keep the control fully visible',()=>{
  const f=fixture({'zh-CN':{height:150,originTop:90}}),before=f.snapshot();
  f.i18n.setLocale('zh-CN');assert.equal(f.root.scrollTop,110);assert.equal(f.snapshot().focus.top,130);
  assert.equal(f.snapshot().focus.top+f.snapshot().focus.height,150);assertLocaleScrollContext(before,f.snapshot(),'shorter viewport');f.view.destroy();
});

test('content shrinking past the start clamps the focused anchor to zero without inventing space',()=>{
  const f=fixture({'zh-CN':{contentTop:70,maxTop:0}}),before=f.snapshot();
  f.i18n.setLocale('zh-CN');assert.equal(f.root.scrollTop,0);assert.equal(f.root.scrollHeight,f.root.clientHeight);
  assert.equal(f.root.children.length,3);assertLocaleScrollContext(before,f.snapshot(),'no scrollable extent');f.view.destroy();
});

test('without a visible focused control the old offset is retained within actual scroll bounds',()=>{
  const f=fixture({'zh-CN':{maxTop:59,maxLeft:10}});f.document.activeElement=null;const before=f.snapshot();
  f.i18n.setLocale('zh-CN');assert.equal(f.root.scrollTop,59);assert.equal(f.root.scrollLeft,10);
  assertLocaleScrollContext(before,f.snapshot(),'no anchor');f.view.destroy();
});

test('a control scrolled out of view does not pull the reader back on translation',()=>{
  const f=fixture({'zh-CN':{contentTop:740}});f.root.scrollTop=450;const before=f.snapshot();assert.equal(before.focus.visible,false);
  f.i18n.setLocale('zh-CN');assert.equal(f.root.scrollTop,450);assertLocaleScrollContext(before,f.snapshot(),'offscreen focus');f.view.destroy();
});

test('unchanged layout does not permit a scroll jump and hidden dialogs are not scrolled',()=>{
  const f=fixture(),before=f.snapshot();f.i18n.setLocale('zh-CN');assert.deepEqual(f.snapshot(),before);
  const jump=structuredClone(before);jump.top=0;jump.focus.top+=100;
  assert.throws(()=>assertLocaleScrollContext(before,jump,'unjustified jump'),/nearest attainable top/);f.view.destroy();
  const hidden=fixture({en:{height:0,width:0,maxTop:100,maxLeft:20}});hidden.i18n.setLocale('zh-CN');assert.equal(hidden.root.scrollTop,100);hidden.view.destroy();
});

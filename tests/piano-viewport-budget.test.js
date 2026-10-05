import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {pianoViewportBudget,observePianoViewportBudget} from '../web/piano-viewport-budget.js';

test('viewport capacity accounts for real footer overflow, preserves spare desktop space and converts CSS zoom once',()=>{
  assert.deepEqual(pianoViewportBudget({viewportBottom:720,laneHeight:308,transportBottom:729.796875,bottomPadding:8}),{height:290.2,available:290.2,deficit:0});
  const spacious=pianoViewportBudget({viewportBottom:1080,laneHeight:488,transportBottom:995.8,bottomPadding:16});
  assert.ok(spacious.height>=540,'A 52px HUD must not remove music height when the full desktop still has room');
  const zoomed=pianoViewportBudget({viewportBottom:720,laneHeight:375,transportBottom:780,zoom:1.25,bottomPadding:8});
  assert.equal(zoomed.height,244);assert.equal(780-375+zoomed.height*1.25+8*1.25,720,'The new CSS height fits its actual zoomed pixels');
  const tight=pianoViewportBudget({viewportBottom:390,laneHeight:100,transportBottom:410,bottomPadding:6});
  assert.deepEqual(tight,{height:100,available:74,deficit:26},'An impossible chrome budget cannot silently shrink the readable lane');
  assert.equal(pianoViewportBudget({viewportBottom:720,laneHeight:0,transportBottom:700}),null);
});

test('actual heading changes and 125 percent zoom refresh one shared normal/Free capacity without synchronous observer writes',()=>{
  const tree=id=>`<main id="${id}" class="piano-workspace"><div class="piano-workspace-heading"></div><div class="piano-lanes-shared"></div><div class="piano-keybed-shared"></div><div class="piano-transport"></div></main>`;
  const {document}=parseHTML(`<html lang="en"><body data-screen="stage">${tree('workspace')}${tree('free-practice-screen')}</body></html>`);
  let laneHeight=360,zoom=1,normalChrome=300,freeChrome=260,serial=0,callback,disconnected=false;const frames=new Map(),values=new Map(),writes=[];
  Object.defineProperty(document.body,'style',{value:{getPropertyValue:key=>values.get(key)||'',setProperty(key,value){values.set(key,value);writes.push([key,value]);laneHeight=Math.min(360,parseFloat(value));},removeProperty:key=>values.delete(key)}});
  for(const [id,chrome]of [['workspace',()=>normalChrome],['free-practice-screen',()=>freeChrome]]){
    const root=document.getElementById(id);root.querySelector('.piano-lanes-shared').getBoundingClientRect=()=>({width:1000,height:laneHeight*zoom});root.querySelector('.piano-keybed-shared').getBoundingClientRect=()=>({height:110*zoom});root.querySelector('.piano-transport').getBoundingClientRect=()=>({height:50*zoom,bottom:(chrome()+laneHeight)*zoom});
  }
  const window={innerWidth:1280,innerHeight:720,getComputedStyle:node=>({height:node.classList.contains('piano-lanes-shared')?`${laneHeight}px`:'',paddingBottom:'8px'}),requestAnimationFrame:fn=>(frames.set(++serial,fn),serial),cancelAnimationFrame:id=>frames.delete(id),addEventListener(){},removeEventListener(){},ResizeObserver:class{constructor(fn){callback=fn;}observe(){}disconnect(){disconnected=true;}}};
  const flush=()=>{const pending=[...frames.values()];frames.clear();for(const fn of pending)fn();},budget=()=>values.get('--piano-available-lane-height');
  const view=observePianoViewportBudget({document,window});
  try{
    flush();assert.equal(budget(),'412px');assert.equal(laneHeight,360,'Spare space preserves the desired music size');
    normalChrome=380;writes.length=0;for(let i=0;i<20;i++)callback();assert.equal(writes.length,0);assert.equal(frames.size,1);flush();assert.equal(budget(),'332px');
    writes.length=0;callback();flush();assert.equal(writes.length,0,'Changing the lane itself cannot create a budget feedback loop');
    document.body.dataset.screen='free';view.refresh();flush();assert.equal(budget(),'332px');assert.equal(laneHeight,332,'Free retains the same current piano geometry');
    document.body.dataset.screen='stage';zoom=1.25;view.refresh();flush();assert.equal(budget(),'188px');assert.equal((normalChrome+laneHeight+8)*zoom,720);
    callback();const pending=[...frames.values()];view.destroy();writes.length=0;for(const fn of pending)fn();assert.equal(writes.length,0);assert.equal(frames.size,0);assert.equal(disconnected,true);
  }finally{view.destroy();}
});

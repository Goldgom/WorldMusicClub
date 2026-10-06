import {validateVsqOwnedControls} from '../scripts/verify-vsq-owned-controls.mjs';
// Original DOM/geometry doubles around production layout and shared acceptance
// helpers. No browser, OS click, audio process or native acceptance is claimed.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {parseHTML} from 'linkedom';
import {observePianoViewportBudget} from '../web/piano-viewport-budget.js';
const vsq=await readFile(new URL('../crates/desktop-shell/vsq-song-acceptance.js',import.meta.url),'utf8');
const canonical=await readFile(new URL('../crates/desktop-shell/canonical-practice-acceptance.js',import.meta.url),'utf8');
async function harness({afterPrepared,onPost,afterDown,emit=true,emitDown=emit,emitClick=emit,trusted=true,range=false,expireAfterPrepare=false,failResultSnapshot=false}={}){
 const {document}=parseHTML('<html><body data-screen="stage"><main id="workspace" class="piano-workspace" data-score-state="session"><div class="piano-lanes-shared"></div><div class="piano-keybed-shared"></div><div class="piano-transport"><button id="play-button">Play</button><input id="progress" type="range"></div><section id="practice-gate" hidden></section></main></body></html>');
 const root=document.getElementById('workspace'),lane=root.querySelector('.piano-lanes-shared'),transport=root.querySelector('.piano-transport'),keyboard=root.querySelector('.piano-keybed-shared'),node=document.getElementById(range?'progress':'play-button'),frames=new Map(),values=new Map(),listeners=new Set(),report={controlActions:[]},posted=[];
 let serial=0,laneHeight=100,pendingChrome=60,notify,hit=node,wall=0,clockBroken=false,targetOffset=0,sourceClock={available:true,positionMs:0,running:false,completed:false,phase:'ready'};
 Object.defineProperty(document.body,'style',{value:{getPropertyValue:key=>values.get(key)||'',setProperty(key,value){values.set(key,value);if(key==='--piano-available-lane-height')laneHeight=Math.round(parseFloat(value)*64)/64;},removeProperty:key=>values.delete(key)}});
 root.getBoundingClientRect=()=>({top:68});lane.getBoundingClientRect=()=>({width:986,height:laneHeight});keyboard.getBoundingClientRect=()=>({height:120});transport.getBoundingClientRect=()=>({height:52,bottom:528.92+pendingChrome+laneHeight});node.getBoundingClientRect=()=>({x:67,y:485.5+laneHeight+targetOffset,width:105,height:36});node.scrollIntoView=()=>{};node.focus=()=>{};
 const window={innerWidth:1024,innerHeight:689,getComputedStyle:n=>({height:n===lane?`${laneHeight}px`:'',paddingBottom:'16px'}),setTimeout,clearTimeout:id=>{clearTimeout(id);afterPrepared?.({node,document,report});if(expireAfterPrepare)wall=15001;},requestAnimationFrame:fn=>(frames.set(++serial,fn),serial),cancelAnimationFrame:id=>frames.delete(id),addEventListener(){},removeEventListener(){},ResizeObserver:class{constructor(fn){notify=fn;}observe(){}disconnect(){}}};
 Object.defineProperty(document,'defaultView',{value:window});document.elementFromPoint=()=>hit;
 document.addEventListener=(type,fn)=>{assert.ok(['click','pointerdown'].includes(type));listeners.add({type,fn});};document.removeEventListener=(type,fn)=>{for(const entry of listeners)if(entry.type===type&&entry.fn===fn)listeners.delete(entry);};
 const flush=()=>{const pending=[...frames.values()];frames.clear();for(const fn of pending)fn();};
 const view=observePianoViewportBudget({document,window});flush();pendingChrome=0;
 const until=async(condition,label)=>{for(let n=0;n<6;n++){if(await condition())return;flush();await Promise.resolve();}throw Error(`Timed out fixture: ${label}`);};
 const start=vsq.indexOf('async function native('),end=vsq.indexOf('\n const mod=',start),clock=()=>{if(clockBroken)throw Error('Original clock snapshot unavailable');return{...sourceClock};};
 const native=runInNewContext(`${canonical.split('(() => {')[0]}\n${vsq.split('(() => {')[0]}\nlet sequence=0;${vsq.slice(start,end)}\nnative`,{document,report,performance:{now:()=>wall},waits:{bounded:async operation=>operation()},innerWidth:1024,innerHeight:689,__wmhReadPlaybackClock:clock,assert:(v,m)=>assert.ok(v,m),frame:async()=>{},until,json:async(path,action)=>{
  posted.push(structuredClone(action));const context={node,document,report,action,moveTarget:dy=>{targetOffset+=dy;},setClock:value=>{sourceClock={...sourceClock,...value};}},changed=onPost?.(context);if(changed)hit=changed;
  const event={target:changed||node,isTrusted:trusted,clientX:action.x,clientY:action.y,button:0,buttons:1,isPrimary:true,pointerId:1,pointerType:'mouse',preventDefault(){throw Error('Observer must not alter input');}};
  if(emitDown)for(const {type,fn}of listeners)if(type==='pointerdown')fn({...event,type});
  afterDown?.(context);
  if(emitClick)for(const {type,fn}of listeners)if(type==='click')fn({...event,type,buttons:0});
 },fetcher:async()=>{if(failResultSnapshot){clockBroken=true;return{status:500,ok:false,json:async()=>({error:'Original host result failure'})};}return{status:200,ok:true,json:async()=>({ok:true})};}});
 async function settle(pending,{commit=true}={}){let done=false,error,value;pending.then(v=>{done=true;value=v;},e=>{done=true;error=e;});for(let step=0;step<30&&!done;step++){await Promise.resolve();await Promise.resolve();if(commit&&report.controlActions[0]?.samples.length===2)notify();flush();}if(!done)throw Error('Original fixture did not settle');if(error)throw error;return value;}
 return{node,document,report,posted,listeners,frames,native,settle,close:()=>view.destroy()};
}
test('VSQ waits through equal stale rectangles and dispatches once from committed layout',async()=>{
 const h=await harness();try{
  assert.equal(await h.settle(h.native('click',h.node)),1);assert.equal(h.posted.length,1);assert.equal(h.posted[0].y,647.578125);
  const c=h.report.controlActions[0];assert.deepEqual(Array.from(c.samples,s=>s.committed),[100,100,100,144.08,144.08]);assert.equal(c.before.target.y+18,603.5);assert.equal(c.preDispatch.target.y+18,647.578125);assert.equal(c.pointerDown[0].order,0);assert.equal(c.dispatch[0].order,1);assert.equal(c.dispatch[0].trusted,true);assert.equal(c.dispatch[0].owned,true);assert.equal(c.dispatch[0].state.identity,true);assert.equal(h.listeners.size,0);validateVsqOwnedControls(JSON.parse(JSON.stringify({...h.report,actions:h.posted.length})),{actions:h.posted});
 }finally{h.close();}
});
test('VSQ retains a stalled layout and never sends a speculative pointer action',async()=>{
 const h=await harness();try{await assert.rejects(h.settle(h.native('click',h.node),{commit:false}),/geometry did not settle/);assert.equal(h.posted.length,0);assert.equal(h.report.controlActions[0].samples.length,5);assert.match(h.report.controlActions[0].error,/geometry did not settle/);assert.equal(h.listeners.size,0);}finally{h.close();}
});
test('VSQ rejects disabled or same-ID replaced controls after preparation before dispatch',async()=>{
 for(const mutation of [({node})=>{node.disabled=true;},({node,document})=>{const replacement=document.createElement('button');replacement.id=node.id;node.replaceWith(replacement);}]){
  const h=await harness({afterPrepared:mutation});try{await assert.rejects(h.settle(h.native('click',h.node)),/original control changed/);assert.equal(h.posted.length,0);assert.equal(h.report.controlActions[0].preDispatch.disabled||!h.report.controlActions[0].preDispatch.identity,true);}finally{h.close();}
 }
});
test('VSQ reports missing, synthetic, wrong-target and replaced-at-click events without a second click',async()=>{
 const options=[{emit:false},{trusted:false},{onPost:({document})=>{const other=document.createElement('button');other.id='neighbor';document.body.append(other);return other;}},{onPost:({node,document})=>{const next=document.createElement('button');next.id=node.id;node.replaceWith(next);return next;}}];
 for(const option of options){const h=await harness(option);try{await assert.rejects(h.settle(h.native('click',h.node)),/trusted owned|missed owned|pointerdown admission/);assert.equal(h.posted.length,1);assert.ok(h.report.controlActions[0].afterDispatch);assert.ok(h.report.controlActions[0].error);assert.equal(h.listeners.size,0);}finally{h.close();}}
});
test('VSQ range admission retains exact pre-handler down and truthful layout changed by range input',async()=>{
 const h=await harness({range:true,afterDown:({moveTarget,setClock})=>{moveTarget(-4.375);setClock({positionMs:2125,phase:'paused'});}});try{
  assert.equal(await h.settle(h.native('click',h.node)),1);assert.equal(h.posted.length,1);const row=h.report.controlActions[0];
  h.report.phase='vsq-restart';h.report.seek={pointerAction:1,before:{control:{id:'progress',tag:'INPUT',type:'range'}}};
  assert.equal(row.pointerDown[0].state.target.y,row.request.target.y);assert.equal(row.pointerDown[0].state.clock.phase,'ready');assert.equal(row.dispatch[0].state.target.y,row.request.target.y-4.375);assert.equal(row.dispatch[0].state.clock.positionMs,2125);assert.equal(row.dispatch[0].state.clock.phase,'paused');
  validateVsqOwnedControls(JSON.parse(JSON.stringify({...h.report,actions:h.posted.length})),{actions:h.posted});assert.equal(h.listeners.size,0);
 }finally{h.close();}
});
test('VSQ rejects movement before pointerdown and a missing down or click without a retry',async()=>{
 for(const option of [{onPost:({moveTarget})=>{moveTarget(-4.375);}},{emitDown:false},{emitClick:false}]){
  const h=await harness(option);try{await assert.rejects(h.settle(h.native('click',h.node)),/pointerdown admission|no trusted owned click/);assert.equal(h.posted.length,1);assert.ok(h.report.controlActions[0].error);assert.equal(h.listeners.size,0);}finally{h.close();}
 }
});
test('VSQ never dispatches after the original total action budget expires',async()=>{
 const h=await harness({expireAfterPrepare:true});try{await assert.rejects(h.settle(h.native('click',h.node)),/original 15000ms action budget/);assert.equal(h.posted.length,0);assert.equal(h.listeners.size,0);}finally{h.close();}
});
test('VSQ preserves the original host failure and removes observers when final snapshot fails',async()=>{
 const h=await harness({failResultSnapshot:true});try{await assert.rejects(h.settle(h.native('click',h.node)),/Original host result failure/);assert.equal(h.posted.length,1);assert.equal(h.listeners.size,0);assert.match(h.report.controlActions[0].error,/Original host result failure/);assert.equal(h.report.controlActions[0].cleanupErrors[0].name,'after-dispatch-snapshot');assert.match(h.report.controlActions[0].cleanupErrors[0].error,/Original clock snapshot unavailable/);}finally{h.close();}
});
test('VSQ browser injects only canonical helpers ahead of its unchanged runner',async()=>{
 const hosted=await readFile(new URL('../scripts/hosted-vsq-song-check.mjs',import.meta.url),'utf8');
 assert.match(hosted,/'live-tone-acceptance.js','canonical-practice-acceptance.js','vsq-song-acceptance.js'/);
 assert.ok(hosted.includes("name==='canonical-practice-acceptance.js'?source.split('(() => {')[0]:source"));
 assert.ok(vsq.includes('await waitCanonicalPracticeControl'));assert.ok(vsq.includes('prepareCanonicalPracticeTarget({document,node'));assert.ok(vsq.includes('await requireCanonicalPracticeOwnedClick'));
});

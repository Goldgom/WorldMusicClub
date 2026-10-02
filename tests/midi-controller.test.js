import test from 'node:test';
import assert from 'node:assert/strict';
import {createMidiInputController} from '../web/midi-input-controller.js';

const tick=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
function fixture(options={}) {
 let wall=100,requests=0;const calls=[],views=[];
 const port=(id,name=id)=>({id,name,state:'connected',connection:'closed',async open(){this.connection='open';return this;},async close(){this.connection='closed';return this;}});
 const one=port('private-one'),two=port('private-two'),access={inputs:new Map([[one.id,one],[two.id,two]])};
 const controller=createMidiInputController({requestAccess:async args=>{requests++;assert.deepEqual(args,{sysex:false});return access;},
   now:()=>wall,timeOrigin:()=>10000,pressNote:(...args)=>calls.push(['on',...args]),releaseNote:(...args)=>calls.push(['off',...args]),
   releaseMatching:(...args)=>calls.push(['cancel',...args]),onChange:s=>views.push(s),...options});
 const at=value=>wall=value;
 const send=(input,data,time=wall)=>input.onmidimessage({data,timeStamp:time});
 return {controller,one,two,access,port,calls,views,at,send,requests:()=>requests};
}

test('explicit selection, unavailable identity, lease state and hotplug do not broaden permission',async()=>{
 const f=fixture({choice:{mode:'single',id:'private-one'}});assert.equal(f.requests(),0);
 const first=f.controller.connect(),second=f.controller.connect();await Promise.all([first,second]);await tick();
 assert.equal(f.requests(),1);assert.equal(f.one.connection,'open');assert.equal(f.two.connection,'closed');assert.equal(f.two.onmidimessage,undefined);
 f.send(f.one,[0x90,60,100]);assert.equal(f.calls.filter(x=>x[0]==='on').length,1);
 f.at(120);f.controller.select({mode:'single',id:'missing'});await tick();
 assert.equal(f.one.connection,'closed');assert.equal(f.controller.snapshot().canTest,false);assert.equal(f.controller.snapshot().choice.id,'missing');
 f.access.onstatechange({timeStamp:130});await tick();assert.equal(f.two.onmidimessage,undefined);
 const missing=f.port('missing','Same display name');f.access.inputs.set('missing',missing);f.access.onstatechange({timeStamp:140});await tick();
 assert.equal(missing.connection,'open');assert.equal(f.requests(),1);
 f.controller.select({mode:'none',id:null});await tick();assert.equal(missing.connection,'closed');assert.equal(f.controller.snapshot().canTest,false);
});

test('same-pitch ports, channels and same-ID replacements use distinct live source ownership',async()=>{
 const f=fixture();await f.controller.connect();await tick();f.at(110);
 const old=f.one.onmidimessage;f.send(f.one,[0x90,60,80]);f.send(f.two,[0x90,60,90]);f.send(f.one,[0x91,60,100]);
 assert.equal(new Set(f.calls.filter(c=>c[0]==='on').map(c=>c[1])).size,3);
 f.at(120);const replacement=f.port(f.one.id);f.access.inputs.set(replacement.id,replacement);f.access.onstatechange({timeStamp:120});await tick();
 f.at(130);f.send(replacement,[0x90,60,110]);const current=f.calls.at(-1);
 old({data:[0x80,60,64],timeStamp:115});const queued=f.calls.at(-1);
 assert.equal(queued[0],'off');assert.equal(queued[3].liveInput,false);assert.notEqual(queued[1],current[1]);assert.notEqual(queued[3].generationToken,current[5].generationToken);
 old({data:[0x90,60,90],timeStamp:116});assert.equal(f.calls.at(-1)[5].liveInput,false,'Late retained onset cannot play current audio');
});

test('visual test intervals exclude late test messages from practice and retain true earlier observations',async()=>{
 const f=fixture();await f.controller.connect();await tick();f.at(110);const original=f.one.onmidimessage;
 f.send(f.one,[0x90,60,90]);f.at(120);f.controller.setTest(true);await tick();
 const during=f.one.onmidimessage;f.at(125);f.send(f.one,[0x92,67,88]);f.send(f.two,[0x92,67,99]);
 assert.equal(f.controller.snapshot().test.held.length,2);assert.deepEqual(f.controller.snapshot().test.range,{low:67,high:67});
 f.send(f.one,[0x82,67,12]);assert.equal(f.controller.snapshot().test.held.length,1);assert.equal(f.controller.snapshot().test.last.velocity,12);
 original({data:[0x90,61,91],timeStamp:115});assert.equal(f.calls.at(-1)[2],61);assert.equal(f.calls.at(-1)[5].liveInput,false);
 f.at(140);f.controller.setTest(false);await tick();const before=f.calls.length;
 during({data:[0x90,68,99],timeStamp:130});f.send(f.one,[0x90,69,99],132);
 assert.equal(f.calls.length,before,'Both saved and new handlers exclude events from the prior test interval');
 f.send(f.one,[0x90,70,99],0);assert.equal(f.calls.length,before);assert.equal(f.controller.snapshot().omittedTimingEvents,1);
 assert.equal(f.controller.exportRoutingData().excluded_ambiguous_messages,1);assert.doesNotMatch(JSON.stringify(f.controller.exportRoutingData()),/private-one|private-two/);
 f.at(150);f.send(f.one,[0x90,71,99]);assert.equal(f.calls.at(-1)[2],71);assert.equal(f.calls.at(-1)[5].liveInput,true);
});

test('device removal stops key test, releases only affected generations and leaves other input live',async()=>{
 const f=fixture();await f.controller.connect();await tick();f.at(110);f.controller.setTest(true);await tick();f.at(120);f.send(f.one,[0x90,60,100]);
 f.at(130);f.one.state='disconnected';f.one.connection='pending';f.access.onstatechange({timeStamp:130});await tick();
 assert.equal(f.controller.snapshot().test.active,false);assert.deepEqual(f.controller.snapshot().test.held,[]);assert.equal(f.one.onmidimessage,null);
 f.at(140);f.send(f.two,[0x90,65,90]);assert.equal(f.calls.at(-1)[2],65);
});

test('late permission and port open results cannot bind while page is away or selection is disabled',async()=>{
 let resolveAccess;const f=fixture({requestAccess:()=>new Promise(resolve=>resolveAccess=resolve)});
 const pending=f.controller.connect();await tick();f.controller.suspend({timeStamp:110});resolveAccess(f.access);await pending;await tick();
 assert.equal(f.one.onmidimessage,undefined);assert.equal(f.access.onstatechange,undefined);
 f.controller.resume();await tick();assert.equal(typeof f.one.onmidimessage,'function');
 f.controller.suspend({timeStamp:120});await tick();assert.equal(f.one.onmidimessage,null);assert.equal(f.access.onstatechange,null);
 f.controller.resume();await tick();const before=f.calls.length;f.at(140);f.send(f.one,[0x90,60,80]);assert.equal(f.calls.length,before+1);
});

test('serialized port leases prevent delayed cleanup closing a newly selected generation',async()=>{
 const f=fixture({choice:{mode:'single',id:'private-one'}});let finishOpen;const order=[];
 f.one.open=()=>{order.push('open');return new Promise(resolve=>{finishOpen=()=>{f.one.connection='open';resolve(f.one);};});};
 f.one.close=async()=>{order.push('close');f.one.connection='closed';};
 await f.controller.connect();await tick();f.controller.select({mode:'none',id:null});f.controller.select({mode:'single',id:f.one.id});
 assert.equal(f.one.onmidimessage,undefined);finishOpen();await tick();assert.deepEqual(order,['open','close','open']);
 finishOpen();await tick();assert.equal(f.one.connection,'open');assert.equal(typeof f.one.onmidimessage,'function');
});

test('permission refusal and selected-port failure are visible and retryable without changing choice',async()=>{
 let denied=true;const f=fixture({requestAccess:async()=>{if(denied)throw Error('Denied');return f.access;},choice:{mode:'single',id:'private-one'}});
 await f.controller.connect();assert.equal(f.controller.snapshot().phase,'error');denied=false;f.one.open=async()=>{throw Error('Busy');};
 await f.controller.connect();await tick();assert.equal(f.controller.snapshot().canTest,false);assert.match(f.controller.snapshot().devices[0].error,/Could not open/);
 f.one.open=async()=>{f.one.connection='open';return f.one;};await f.controller.connect();await tick();assert.equal(f.controller.snapshot().canTest,true);assert.equal(f.controller.snapshot().choice.id,f.one.id);
});

test('a port-open failure during test transition stops the monitor and exposes the selected input error',async()=>{
 const f=fixture({choice:{mode:'single',id:'private-one'}});await f.controller.connect();await tick();
 f.one.open=async()=>{throw Error('Port became unavailable');};f.at(120);f.controller.setTest(true);await tick();
 assert.equal(f.controller.snapshot().test.active,false);assert.equal(f.controller.snapshot().canTest,false);
 assert.equal(f.controller.snapshot().test.code,'midi_test_stopped');assert.equal(f.controller.snapshot().test.reason,'input_open_failed');assert.match(f.controller.snapshot().devices[0].error,/Could not open/);
 assert.equal(f.calls.filter(event=>event[0]==='on').length,0);
});

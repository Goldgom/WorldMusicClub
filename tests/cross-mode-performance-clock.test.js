import test from 'node:test';
import assert from 'node:assert/strict';
import {Transport} from '../web/transport.js';

test('admission reads stay signed while early Pause saves only the unconsumed source position',()=>{
  for(const countIn of [0,2000]){
    const transport=new Transport();transport.start(1050,[],countIn);
    for(const now of [1000,1049,1050])assert.equal(transport.time(now),now-1050-countIn);
    assert.equal(transport.time(1100),50-countIn);
    transport.pause(1000);assert.equal(transport.position,0-countIn);
    transport.pause(1020);assert.equal(transport.position,0-countIn,'Repeated Pause cannot subtract a lead or count-in');
    transport.start(2050,[],countIn);assert.equal(transport.time(2000),-50-countIn,'Resume retains the scheduling lead without repeating count-in');
    assert.equal(transport.time(2150),100-countIn);assert.equal(transport.position,0-countIn,'Reading the clock never mutates its source origin');
  }
});

test('positive-offset resume and repeated immediate pauses preserve exact source position',()=>{
  const transport=new Transport();transport.seek(312.125);
  transport.start(50,[]);assert.equal(transport.time(0),262.125,'A fresh seek retains the signed initial lead');
  transport.pause(0);assert.equal(transport.position,312.125,'Early Pause cannot save an extrapolated seek position');
  for(const anchor of [1050,2050,3050]){
    transport.start(anchor,[]);assert.equal(transport.time(anchor-50),262.125);transport.pause(anchor-30);transport.pause(anchor-10);
    assert.equal(transport.position,312.125);assert.equal(transport.running,false);
  }
  transport.start(4050,[]);assert.equal(transport.time(4125),387.125);transport.pause(4125);assert.equal(transport.position,387.125);
});

test('future-anchor protection preserves nonzero loop bounds, count-in length, exact wrapping and later seeks',()=>{
  const transport=new Transport(),notes=[{id:'original-loop',start_ms:2000,duration_ms:300}];
  transport.seek(2000);transport.start(1050,notes,400);
  assert.equal(transport.time(1000),1550);assert.equal(transport.wrapLoop(1000,notes,{start:2000,end:2300,countIn:400}).status,'pending');
  transport.pause(1020);transport.start(2050,notes,400);assert.equal(transport.time(2000),1550);
  assert.equal(transport.time(2450),2000);
  const wrapped=transport.wrapLoop(2767,notes,{start:2000,end:2300,countIn:400});
  assert.equal(wrapped.status,'wrapped');assert.equal(wrapped.boundaryWall,2750);assert.equal(transport.time(2767),1617);
  transport.seek(375.125);transport.start(8050,[]);assert.equal(transport.time(8000),325.125);assert.equal(transport.time(8150),475.125);
  transport.finish(1000);transport.start(9050,[]);assert.equal(transport.time(9000),-50);assert.equal(transport.time(9150),100);
});

import assert from 'node:assert/strict';

// Self-authored mechanical C/E/G exercise. No imported music or source files.
export function canonicalProbeScore({seconds=48}={}) {
  assert.ok(Number.isInteger(seconds)&&seconds>=2&&seconds<=48&&seconds%2===0);
  const beat=(numerator,denominator=1)=>({numerator,denominator});
  const parts=['Human C','Machine E','Machine G'].map((name,p)=>({id:`original-part-${p}`,name,instrument:'piano',notes:Array.from({length:seconds*16},(_,n)=>({id:`original-${p}-${n}`,at:beat(n,8),duration:beat(1,8),pitch:{step:['C','E','G'][p],alter:0,octave:4},voice:'1',staff:1,velocity:80,tie_start:false,tie_stop:false}))}));
  return {version:1,id:`original-canonical-probe-${seconds}`,title:'Original canonical audio-thread probe',composer:'WorldMusicClub test authors',provenance:{kind:'original',attribution:'Self-authored mechanical C/E/G test exercise',source_url:null,license:'CC0-1.0'},parts,tempo:[{at:beat(0),bpm:120}],meters:[{at:beat(0),numerator:4,denominator:4}],keys:[],measures:Array.from({length:seconds/2},(_,i)=>({number:i+1,at:beat(i*4),length:beat(4)})),repeats:[],source:null};
}

export function validateCanonicalHostedCase(row,{seconds,practice,stall}) {
  assert.equal(row.ok,true,row.error);assert.deepEqual(row.errors,[]);
  assert.equal(row.seconds,seconds);assert.equal(row.practice,practice);
  assert.ok(Number.isInteger(row.sampleRate)&&row.sampleRate>=8000&&row.sampleRate<=384000);
  assert.equal(row.clockEndMs,seconds*1000);assert.equal(row.compiledNotes,seconds*16*3);
  const sourceParts=practice?[1,2]:[0,1,2],expectedCount=seconds*16*sourceParts.length;
  assert.equal(row.rows.length,expectedCount);assert.equal(row.terminal.started,expectedCount);assert.equal(row.terminal.ended,expectedCount);
  assert.equal(row.terminal.skipped,0);
  const seen=new Set();
  for(const gate of row.rows){
    const source=gate.sourceNoteIds;assert.equal(source.length,1);
    const match=/^original-([0-2])-(\d+)$/.exec(source[0]);assert.ok(match);const p=Number(match[1]),n=Number(match[2]);
    assert.ok(sourceParts.includes(p));assert.ok(n<seconds*16);assert.ok(!seen.has(source[0]));seen.add(source[0]);
    assert.equal(gate.partId,`original-part-${p}`);
    const start=Math.floor(n*row.sampleRate/16),end=Math.ceil((n+1)*row.sampleRate/16);
    assert.equal(gate.startFrame,start);assert.equal(gate.endFrame,end);
    assert.equal(gate.actualStartFrame,row.anchorFrame+start);assert.equal(gate.actualEndFrame,row.anchorFrame+end);
  }
  for(const type of ['started','ended'])assert.ok(row.messages.some(m=>m.type===type&&m.trusted&&m.nativeMessage&&m.nativePort),`Genuine ${type} processor receipt`);
  assert.equal(row.graph.nativeNode,true);assert.equal(row.graph.nativeContext,true);assert.equal(row.graph.connectedToDestination,true);
  const active=row.pcm.filter(b=>b.firstFrame>=row.anchorFrame&&b.firstFrame+b.frames<=row.anchorFrame+seconds*row.sampleRate);
  assert.ok(active.length>seconds*row.sampleRate/4096-3);for(const b of active){assert.ok(b.trusted&&b.nativeMessage);assert.ok(b.energy>1e-10&&b.nonzeroSamples>0&&b.peak>1e-6);}
  for(let i=1;i<active.length;i++)assert.equal(active[i].firstFrame,active[i-1].firstFrame+active[i-1].frames,'PCM bins must be continuous through host stalls');
  if(stall){assert.equal(row.stalls.length,2);for(const s of row.stalls)assert.ok(s.wallEnd-s.wallStart>=1100&&s.audioEnd>s.audioStart);}
  else assert.deepEqual(row.stalls,[]);
  assert.equal(row.assessmentRequests,0);assert.equal(row.physicalListening,false);
  return {machineNotes:expectedCount,pcmBins:active.length,exactFrameGates:true};
}

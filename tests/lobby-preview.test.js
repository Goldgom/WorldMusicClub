import test from 'node:test';
import assert from 'node:assert/strict';
import {createLobbyPreview,LOBBY_PREVIEW_MS} from '../web/lobby-preview.js';
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const source=(identity='a',pitch=60)=>({identity,status:'ready',compiled:{score:{id:identity},timeline:{duration_ms:40500,notes:[{id:'first',midi:pitch,start_ms:500,duration_ms:200,velocity:73},{id:'second',midi:pitch+2,start_ms:1000,duration_ms:400},{id:'clipped',midi:pitch+4,start_ms:30480,duration_ms:800},{id:'outside',midi:pitch+5,start_ms:35000,duration_ms:400}]}}});
function fixture(options={}) {
  let wall=0,allowed=true,serial=0,unlock=()=>Promise.resolve(),selected=null,position=null,startWall=0,end=0;const pending=new Map(),sounds=[],states=[],preparations=[],starts=[];
  const audio={output:{gain:{value:0}},muted:false,context:{state:'running',currentTime:0,sampleRate:48000},unlocks:0,unlock(){this.unlocks++;return unlock();},play(...args){sounds.push(args);}};
  const session={running:false,select(compilation){selected=compilation;this.stop();},async prepare(value){preparations.push({compilation:selected,...value});position=value.range.startMs;end=value.range.endMs;return {};},async startPrepared(value){starts.push(value);this.running=true;startWall=wall;return {positionMs:position,...value};},sourcePositionMs(){if(position===null)return null;const at=Math.min(end,position+(this.running?wall-startWall:0));if(at>=end)this.running=false;return at;},stop(){position=null;this.running=false;},bindWallClock(){},destroy(){this.stop();}};
  const player=createLobbyPreview({audio,sessionFactory:()=>session,now:()=>wall,allowed:()=>allowed,schedule:fn=>{pending.set(++serial,fn);return serial;},cancel:id=>pending.delete(id),onChange:value=>states.push(value),...options});
  return {player,audio,sounds,states,pending,preparations,starts,unlock:fn=>{unlock=fn;},allow:value=>{allowed=value;},tick(ms){wall+=ms;const work=[...pending.values()];pending.clear();for(const fn of work)fn();}};
}
test('audition sends the full compiled source to one bounded audio range without scheduling Synth notes',async()=>{
 const f=fixture(),score=source(),before=structuredClone(score);f.player.select(score);
 assert.equal(f.audio.unlocks,0);assert.equal(f.player.snapshot().duration,LOBBY_PREVIEW_MS);
 assert.equal(await f.player.play(),true);assert.equal(f.preparations.length,1);assert.equal(f.preparations[0].compilation,score.compiled);assert.deepEqual(f.preparations[0].range,{startMs:500,endMs:30500});assert.equal(f.preparations[0].mode,'listen');assert.equal(f.starts.length,1);
 for(let i=0;i<30;i++)f.tick(1000);assert.equal(f.player.snapshot().status,'ended');assert.equal(f.pending.size,0);assert.deepEqual(f.sounds,[]);assert.deepEqual(score,before);
});
test('rapid song selection, repeated click and pending unlock cannot resurrect an old preview',async()=>{
 const f=fixture(),gate=deferred();f.player.select(source());f.unlock(()=>gate.promise);const playing=f.player.play();
 assert.equal(f.audio.unlocks,1);assert.equal(await f.player.play(),false);assert.equal(f.audio.unlocks,1);
 f.player.select({identity:'b',status:'loading'});gate.resolve();assert.equal(await playing,false);assert.equal(f.sounds.length,0);
 f.player.select(source('b',72));assert.equal(f.player.snapshot().status,'ready');f.unlock(()=>Promise.resolve());await f.player.play();assert.equal(f.preparations.at(-1).compilation.score.id,'b');f.player.stop();
 assert.equal(f.pending.size,0);f.tick(1000);assert.equal(f.sounds.length,0);
});
test('cancel during unlock, leaving lobby, zero volume and mute stop without any automatic restart',async()=>{
 for(const action of ['stop','leave','mute','zero','destroy']){
  const f=fixture(),gate=deferred();f.player.select(source());f.unlock(()=>gate.promise);const playing=f.player.play();
  if(action==='stop')f.player.stop();if(action==='leave'){f.allow(false);f.player.stop();}if(action==='mute')f.player.setSound(false);if(action==='zero')f.player.setVolume(0);if(action==='destroy')f.player.destroy();
  gate.resolve();assert.equal(await playing,false,action);assert.equal(f.sounds.length,0);assert.equal(f.pending.size,0);
  f.player.setSound(true);f.player.setVolume(.8);f.allow(true);f.tick(25);assert.equal(f.sounds.length,0,action);
 }
});
test('independent sound and volume do not re-unlock, and compatibility-only updates do not restart playback',async()=>{
 const f=fixture(),score=source();f.player.select(score);await f.player.play();const timer=[...f.pending.keys()];
 f.player.select({...score,compatibility:{status:'blocked'}});assert.deepEqual([...f.pending.keys()],timer);assert.equal(f.audio.unlocks,1);
 f.player.setVolume(.8);assert.equal(f.audio.output.gain.value,.7*.8);assert.equal(f.audio.unlocks,1);assert.equal(f.player.snapshot().status,'playing');
 f.player.setSound(false);assert.equal(f.player.snapshot().status,'muted');assert.equal(f.pending.size,0);assert.equal(f.audio.muted,true);
 f.player.setSound(true);assert.equal(f.audio.muted,false);assert.equal(f.audio.unlocks,1);f.player.stop();
});
test('unlock failures permit explicit retry; late rejected unlocks do not overwrite new selection',async()=>{
 const f=fixture();f.player.select(source());f.unlock(()=>Promise.reject(Error('blocked')));assert.equal(await f.player.play(),false);assert.equal(f.player.snapshot().status,'failed');
 const gate=deferred();f.unlock(()=>gate.promise);const work=f.player.play();f.player.select(source('b'));gate.reject(Error('late'));await work;assert.equal(f.player.snapshot().status,'ready');
 f.unlock(()=>Promise.resolve());assert.equal(await f.player.play(),true);f.player.stop();
});
test('background clock gaps, suspended audio and denied surface admission stop without scheduled catch-up',async()=>{
 for(const kind of ['clock','audio','surface']){
  const f=fixture();f.player.select(source());await f.player.play();if(kind==='audio')f.audio.context.state='suspended';if(kind==='surface')f.allow(false);
  f.tick(kind==='clock'?2000:25);assert.equal(f.player.snapshot().status,'interrupted');assert.equal(f.pending.size,0);assert.equal(f.sounds.length,0);
 }
});
test('invalid and empty timelines cannot enable an audition or create audio',async()=>{
 for(const timeline of [{notes:[],duration_ms:1000},{notes:[{id:'a',midi:200,start_ms:0,duration_ms:5}],duration_ms:10},{notes:[{id:'a',midi:60,start_ms:0,duration_ms:5}],duration_ms:NaN}]){
  const f=fixture();f.player.select({identity:'a',status:'ready',compiled:{timeline}});assert.equal(f.player.snapshot().available,false);assert.equal(await f.player.play(),false);assert.equal(f.audio.unlocks,0);
 }
});

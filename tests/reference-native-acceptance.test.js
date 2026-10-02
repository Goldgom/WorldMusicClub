import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {runInNewContext} from 'node:vm';
import {originalReferenceMidiFixture} from './reference-listening-fixture.js';

// Pure contracts only: no native window, browser, server, audio device or timer.
const source=await readFile(new URL('../crates/desktop-shell/reference-acceptance.js',import.meta.url),'utf8');
const {NATIVE_REFERENCE_FIXTURE:f,observeNativeReferenceAudio}=runInNewContext(`${source}\n({NATIVE_REFERENCE_FIXTURE,observeNativeReferenceAudio})`);

test('native chooser fixture is exactly the new original three-track source with paired finite allowlists',async()=>{
  const original=originalReferenceMidiFixture(),bytes=await readFile(new URL(`./fixtures/${original.name}`,import.meta.url));
  assert.deepEqual(bytes,original.bytes);assert.equal(createHash('sha256').update(bytes).digest('hex'),f.sha256);
  assert.equal(f.name,original.name);assert.equal(f.tracks,original.expected.trackCount);assert.equal(f.events,original.expected.eventCount);assert.equal(f.onsets,original.expected.onsetCount);
  const [rust,helper,runner,contract]=await Promise.all(['../crates/desktop-shell/src/acceptance.rs','../scripts/windows-desktop-native.cs','../scripts/windows-desktop-acceptance.ps1','./windows-desktop-contract.ps1'].map(path=>readFile(new URL(path,import.meta.url),'utf8')));
  for(const text of [rust,helper,runner,contract])assert.ok(text.includes(f.name),'Native bridge, OS helper, fixture materialization and pure path contracts all name the same exact fixture');
  assert.match(rust,/include_str!\("\.\.\/reference-acceptance\.js"\)/);
  assert.match(rust,/\(1\.\.=64\)/,'Action budget is not expanded');
  assert.match(rust,/rows\.len\(\) >= 16/,'Download budget is not expanded');
  assert.match(contract,/\.\.\/original-reference-overlap\.mid/,'Traversal is explicitly rejected by hosted pure path tests');
});

function audioFixture(){
  class NativeSource {
    constructor(context,kind){this.context=context;this.kind=kind;this.calls=[];}
    start(...args){this.calls.push(['start',...args]);return 'native-start';}
    stop(...args){this.calls.push(['stop',...args]);return 'native-stop';}
    disconnect(...args){this.calls.push(['disconnect',...args]);return 'native-disconnect';}
  }
  class NativeAudio {
    constructor(){this.currentTime=10;this.creates=[];}
    createOscillator(...args){this.creates.push(['oscillator',...args]);return new NativeSource(this,'oscillator');}
    createBufferSource(...args){this.creates.push(['noise',...args]);return new NativeSource(this,'noise');}
  }
  return {NativeAudio};
}

test('native audio observation forwards actual methods unchanged and distinguishes future, active and canceled voices',()=>{
  const {NativeAudio}=audioFixture(),originalOsc=NativeAudio.prototype.createOscillator,originalBuffer=NativeAudio.prototype.createBufferSource;
  const probe=observeNativeReferenceAudio({AudioContext:NativeAudio,webkitAudioContext:NativeAudio}),context=new NativeAudio();
  const oscillator=context.createOscillator('passthrough'),noise=context.createBufferSource();
  assert.deepEqual(context.creates,[['oscillator','passthrough'],['noise']]);
  assert.equal(oscillator.start(10.2),'native-start');assert.equal(oscillator.stop(12),'native-stop');noise.start(10);noise.stop(13);
  assert.deepEqual({...probe.snapshot()},{sourceStarts:2,oscillatorStarts:1,activeSources:1,pendingSources:1});
  context.currentTime=10.3;assert.equal(probe.snapshot().activeSources,2);assert.equal(probe.snapshot().pendingSources,0);
  assert.equal(oscillator.stop(10.3),'native-stop');assert.equal(oscillator.disconnect(),'native-disconnect');noise.stop(10.3);noise.disconnect();
  assert.deepEqual({...probe.snapshot()},{sourceStarts:2,oscillatorStarts:1,activeSources:0,pendingSources:0});
  assert.deepEqual(oscillator.calls,[['start',10.2],['stop',12],['stop',10.3],['disconnect']]);
  probe.restore();assert.equal(NativeAudio.prototype.createOscillator,originalOsc);assert.equal(NativeAudio.prototype.createBufferSource,originalBuffer);
});

test('native probe reports uncanceled future audio and elapsed scheduled stops rather than trusting UI labels',()=>{
  const {NativeAudio}=audioFixture(),probe=observeNativeReferenceAudio({AudioContext:NativeAudio}),context=new NativeAudio();
  try {
    const source=context.createOscillator();source.start(11);source.stop(12);
    assert.equal(probe.snapshot().pendingSources,1);context.currentTime=11.5;assert.equal(probe.snapshot().activeSources,1);
    context.currentTime=12.1;assert.equal(probe.snapshot().activeSources,0);
    const future=context.createBufferSource();future.start(14);future.stop(15);future.disconnect(0);
    assert.equal(probe.snapshot().pendingSources,1,'Disconnecting one output is not proof all scheduling was canceled');
    future.disconnect();assert.equal(probe.snapshot().pendingSources,0);
  } finally {probe.restore();}
  assert.throws(()=>observeNativeReferenceAudio({}),/real AudioContext/);
});

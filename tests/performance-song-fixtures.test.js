import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {performanceAcceptanceFixtures,preparePerformanceFixtures,PERFORMANCE_FIXTURE_FILENAME} from '../scripts/prepare-performance-song-fixtures.mjs';
import {digest,inspectAuthoredZip} from './clean-song-package-fixtures.js';
import {preparePerformanceSong} from '../web/clean-song-package.js';
import {performanceSeconds,createCleanPerformancePlayer} from '../web/clean-performance-player.js';

test('fixed picker fixture registries agree with Rust and the compiled Windows resolver contract',async()=>{
  // Supplemental static parity check. The PowerShell contract compiles and
  // calls the actual C# resolver on Windows; this does not substitute for it.
  const [rust,native,contract,workflow]=await Promise.all([
    '../crates/desktop-shell/src/acceptance.rs','../scripts/windows-desktop-native.cs',
    './windows-desktop-contract.ps1','../.github/workflows/windows-desktop-acceptance.yml',
  ].map(path=>readFile(new URL(path,import.meta.url),'utf8')));
  const quoted=(text,pattern)=>[...text.matchAll(pattern)].map(match=>match[1]);
  const fixtures=quoted(rust.match(/let fixture = \[([\s\S]*?)\]\s*\.contains\(&file\)/)[1],/"([^"]+)"/g).filter(name=>name!=='bulk-multiple').sort();
  const nativeNames=quoted(native.match(/Array\.IndexOf\(new\[\]\{([^}]+)\},name\)/)[1],/"([^"]+)"/g).sort();
  const checkedNames=quoted(contract.match(/\$fixed=@\(([^\r\n]+)\)/)[1],/'([^']+)'/g).sort();
  assert.equal(new Set(fixtures).size,fixtures.length);assert.ok(fixtures.includes(PERFORMANCE_FIXTURE_FILENAME));
  assert.deepEqual(nativeNames,fixtures);assert.deepEqual(checkedNames,fixtures);
  assert.match(contract,/Add-Type -Path \(Join-Path \$PSScriptRoot '\.\.\/scripts\/windows-desktop-native\.cs'\)/);
  assert.match(contract,/\[NativeAcceptance\]::ResolveFixturePath\(\$fixtures,\$temporary,\$name\)/);
  const nativeJob=workflow.slice(workflow.indexOf('      - name: Test native filename ownership'));
  assert.ok(nativeJob.indexOf('run: ./tests/windows-desktop-contract.ps1')>=0);
  assert.ok(nativeJob.indexOf('run: ./tests/windows-desktop-contract.ps1')<nativeJob.indexOf('run: cargo test'));
  assert.ok(nativeJob.indexOf('run: ./tests/windows-desktop-contract.ps1')<nativeJob.indexOf('run: cargo build'));
});

test('one deterministic original pack contains all four complete native fixtures and no source/media payload',async()=>{
  const pack=performanceAcceptanceFixtures(),second=performanceAcceptanceFixtures();
  assert.equal(pack.filename,PERFORMANCE_FIXTURE_FILENAME);assert.deepEqual(pack.bytes,second.bytes);
  assert.equal(pack.manifest.sha256,digest(pack.bytes));assert.equal(pack.fixtures.length,4);
  assert.equal(new Set(pack.fixtures.map(f=>f.key)).size,4);assert.equal(Object.keys(inspectAuthoredZip(pack.bytes)).length,9);
  for(const fixture of pack.fixtures) {
    assert.deepEqual([...fixture.files.keys()],['metadata.json','score.json']);assert.equal(fixture.opened.score_json,null);
    const song=await preparePerformanceSong(`native:${fixture.key}`,fixture.opened.clean_package,null);
    assert.deepEqual(song.reference,fixture.reference);assert.equal(song.notation,null);assert.equal(song.compilation,null);
    assert.equal(song.runtime.coverage.targets.represented_attacks,0);assert.equal('notes' in song.runtime,false);
    assert.deepEqual(song.runtime.duration_microseconds,{numerator:'5000010',denominator:1});
    for(const voice of song.reference.voices) {
      const release=song.runtime.events.find(event=>event.event_id===voice.releaseEventId);
      assert.notEqual(voice.eventId,voice.releaseEventId);assert.equal(release.command.kind,'key_release');
      assert.ok(performanceSeconds(release.exact_microseconds)-performanceSeconds(voice.start)>=2);
    }
  }
  const overlap=pack.fixtures[0].reference;
  assert.equal(overlap.trackCount,11);assert.equal(overlap.voices.length,20);assert.deepEqual(overlap.tracks[0].channels,[]);
  assert.equal(overlap.voices.filter(voice=>voice.channel===9&&voice.key===85).length,2);
  const controls=pack.fixtures[1].reference;
  assert.equal(controls.extendedControls,true);assert.equal(controls.voices.length,2);
  assert.notEqual(controls.voices[0].eventId,controls.voices[1].eventId);assert.notEqual(controls.voices[0].releaseEventId,controls.voices[1].releaseEventId);
  for(const voice of controls.voices) {
    assert.equal(voice.endReason,'sustain_release');assert.equal(performanceSeconds(voice.end),4.000008);
    assert.notEqual(voice.sustainReleaseEventId,voice.releaseEventId);
    const keyRelease=controls.runtime.events.find(event=>event.event_id===voice.releaseEventId);
    assert.ok(performanceSeconds(voice.end)>performanceSeconds(keyRelease.exact_microseconds));
  }
  assert.equal(controls.voices[0].sustainReleaseEventId,controls.voices[1].sustainReleaseEventId);
});

test('preparation writes an exact pack and manifest once and isolates mutable copies',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'wmh-performance-fixture-contract-'));
  try {
    const expected=performanceAcceptanceFixtures(),manifest=await preparePerformanceFixtures(directory);
    assert.deepEqual(await readFile(join(directory,expected.filename)),expected.bytes);
    assert.deepEqual(JSON.parse(await readFile(join(directory,'performance-fixtures.json'))),manifest);
    await assert.rejects(preparePerformanceFixtures(directory),{code:'EEXIST'});
    expected.fixtures[0].files.get('score.json').fill(0);expected.fixtures[0].opened.clean_package.runtime.events.length=0;
    assert.equal(performanceAcceptanceFixtures().manifest.sha256,manifest.sha256);
    assert.ok(performanceAcceptanceFixtures().fixtures[0].opened.clean_package.runtime.events.length>0);
  } finally {await rm(directory,{recursive:true,force:true});}
});

test('new C E G sources preserve every repeated RPN12 write, exact key clock and synthetic route',()=>{
  const named=performanceAcceptanceFixtures().fixtures.slice(2);
  const steps=['select_least_significant_zero','select_most_significant_zero','select_least_significant_zero','select_most_significant_zero','set_semitones12','set_semitones12','set_cents_zero','set_cents_zero'];
  const atTick=(event,tick)=>assert.equal(BigInt(event.exact_microseconds.numerator)*6n,BigInt(tick)*500001n*BigInt(event.exact_microseconds.denominator));
  for(const [index,f]of named.entries()){
    const events=f.opened.clean_package.runtime.events,setup=events.filter(e=>e.command.kind==='initial_pitch_bend_sensitivity12');
    assert.deepEqual(setup.map(e=>e.command.step),steps);
    assert.deepEqual(setup.map(e=>e.origin),steps.map((_,i)=>({track:1,event:i+5})));
    setup.forEach((event,i)=>atTick(event,i+1));
    assert.equal(f.reference.acknowledgements.filter(e=>e.disposition==='initial_pitch_bend_sensitivity12').length,8);
    assert.deepEqual(f.reference.pitchStates[0],{pitch_bend:0,sensitivity_semitones:12,sensitivity_cents:0,rpn_most_significant:0,rpn_least_significant:0,sensitivity12_steps:steps});
    assert.deepEqual(f.reference.logical_device_mapping,{device_name:'WMH Authored Receiver A',receiver:'wmh-procedural-reference-v1',policy:'single_named_device_to_procedural_receiver'});
    assert.equal(f.reference.policy.id,'wmh-original-reference-fifo-controls-v2:single-named-device-v1');
    assert.deepEqual(events.filter(e=>e.command.role==='device_name').map(e=>e.command.text),['WMH Authored Receiver A']);
    assert.equal(events.some(e=>e.command.kind==='pitch_bend'),false);
    for(const [kind,ticks]of [['key_attack',[9,15,21]],['key_release',[33,39,45]]]){
      const keys=events.filter(e=>e.command.kind===kind);assert.deepEqual(keys.map(e=>e.command.key),[60,64,67]);keys.forEach((e,i)=>atTick(e,ticks[i]));
    }
    assert.deepEqual(f.reference.voices.map(v=>v.key),[60,64,67]);
    for(const [i,event]of events.entries()){
      const source=f.score.performance.events[i];assert.deepEqual(event.command,source.command);assert.deepEqual(event.origin,source.origin);assert.equal(event.event_id,source.event_id);
      assert.equal(BigInt(event.exact_microseconds.numerator)*BigInt(source.at.denominator),BigInt(source.at.numerator)*500001n*BigInt(event.exact_microseconds.denominator));
    }
    assert.equal(f.reference.playable,index===0);assert.deepEqual(f.reference.blockers.map(b=>b.code),index===0?[]:['unsupported_bank_select']);
  }
  // The bank-negative MIDI changes one authored byte only. Everything else in
  // its retained performance is identical apart from content-bound event IDs.
  const commands=f=>f.score.performance.events.map(({event_id,...event})=>event);
  const original=commands(named[0]),blocked=commands(named[1]);
  assert.equal(original.filter((e,i)=>JSON.stringify(e)!==JSON.stringify(blocked[i])).length,1);
  const bank=blocked.find(e=>e.command.kind==='bank_select');assert.equal(bank.command.value,1);bank.command.value=0;assert.deepEqual(blocked,original);
});

test('named fixture rejects missing or unnamed policy and bank sibling before any audio context',async()=>{
  const [named,bank]=performanceAcceptanceFixtures().fixtures.slice(2);let contexts=0;
  const contextFactory=()=>{contexts++;throw Error('Audio must not be requested by negative cases');};
  const player=createCleanPerformancePlayer(named.reference,{contextFactory});
  for(const acceptedPolicyId of [undefined,named.reference.policy.id.replace(':single-named-device-v1','')])await assert.rejects(player.play({userGesture:true,acceptedPolicyId}),{code:'reference_policy_required'});
  assert.throws(()=>createCleanPerformancePlayer(bank.reference,{contextFactory}),{code:'playback_blocked'});
  assert.equal(contexts,0);
});

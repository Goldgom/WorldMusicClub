import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {performanceAcceptanceFixtures,preparePerformanceFixtures,PERFORMANCE_FIXTURE_FILENAME} from '../scripts/prepare-performance-song-fixtures.mjs';
import {AUTHORING_PAIR_ALIAS,AUTHORING_FIXTURE_FILENAMES} from '../scripts/prepare-song-authoring-fixtures.mjs';
import {digest,inspectAuthoredZip} from './clean-song-package-fixtures.js';
import {preparePerformanceSong} from '../web/clean-song-package.js';
import {performanceSeconds,createCleanPerformancePlayer} from '../web/clean-performance-player.js';

const pickerSources=Object.fromEntries(await Promise.all(Object.entries({rust:'../crates/desktop-shell/src/acceptance.rs',native:'../scripts/windows-desktop-native.cs',contract:'./windows-desktop-contract.ps1',workflow:'../.github/workflows/windows-desktop-acceptance.yml'}).map(async([key,path])=>[key,await readFile(new URL(path,import.meta.url),'utf8')])));
function assertPickerFixtureRegistries({rust,native,contract}){
  const quoted=(text,pattern)=>[...text.matchAll(pattern)].map(match=>match[1]);
  const aliases={'bulk-multiple':['bulk-standard-a.json','bulk-standard-b.json'],[AUTHORING_PAIR_ALIAS]:[AUTHORING_FIXTURE_FILENAMES.strict,AUTHORING_FIXTURE_FILENAMES.events]};
  const common=quoted(rust.match(/let fixture = \[([\s\S]*?)\]\s*\.contains\(&file\)/)[1],/"([^"]+)"/g);
  const canonical=quoted(rust.match(/\|\| \(CANONICAL_PRACTICE_PHASES.contains\(&phase\)\s*&& \[([\s\S]*?)\]\s*\.contains\(&file\)\)/)[1],/"([^"]+)"/g);
  assert.deepEqual(canonical,['canonical-practice-original.json','canonical-practice-original.musicxml']);
  for(const file of canonical)assert.ok(!common.includes(file),'Canonical originals must remain phase-scoped');
  const live=[rust.match(/\|\| \(live_navigation && file == "([^"]+)"\)/)[1]];
  const skin=quoted(rust.match(/\|\| \(phase == "skin-seed"\s*&& \[([\s\S]*?)\]\s*\.contains\(&file\)\)/)[1],/"([^"]+)"/g);
  assert.deepEqual(live,['live-tone-navigation-original.json']);
  assert.deepEqual(skin,['skin-original-score.json','skin-original.json','checker.png']);
  for(const file of [...live,...skin])assert.ok(!common.includes(file),'New originals must remain phase-scoped');
  const admitted=[...common,...canonical,...live,...skin].sort();
  const files=quoted(native.match(/Array\.IndexOf\(new\[\]\{([^}]+)\},name\)/)[1],/"([^"]+)"/g).sort();
  const checkedFiles=quoted(contract.match(/\$fixed=@\(([^\r\n]+)\)/)[1],/'([^']+)'/g).sort();
  assert.equal(new Set(admitted).size,admitted.length);assert.equal(new Set(files).size,files.length);assert.ok(files.includes(PERFORMANCE_FIXTURE_FILENAME));
  // Rust admits request names. Windows' file table contains only single files;
  // every additional admitted name must be one of these two closed aliases.
  assert.deepEqual(admitted,[...files,...Object.keys(aliases)].sort());assert.deepEqual(checkedFiles,files);
  const resolver=native.match(/public static string ResolveFixturePath\(string fixtures,string output,string name\) \{([\s\S]*?)\n  \}/)[1],prefix=resolver.split('    string directory;')[0];
  const aliasPattern=/\s*if\(name=="([^"]+)"\) \{([\s\S]*?)\n    \}/g,blocks=[...prefix.matchAll(aliasPattern)];
  assert.equal(prefix.replace(aliasPattern,'').trim(),'','No unparsed or permissive alias dispatch');assert.deepEqual(blocks.map(row=>row[1]).sort(),Object.keys(aliases).sort());
  for(const [,alias,body]of blocks){const [first,second]=aliases[alias];assert.ok(first!==second&&files.includes(first)&&files.includes(second)&&!files.includes(alias));
    assert.deepEqual(body.trim().split(/\r?\n/).map(line=>line.trim()),[`string first=ResolveFixturePath(fixtures,output,"${first}"),second=ResolveFixturePath(fixtures,output,"${second}");`,String.raw`return "\""+first+"\" \""+second+"\"";`],`${alias} must expand exactly two ordered files through the existing regular-file guard`);
  }
  assert.match(resolver,/else throw new InvalidOperationException\("File is outside the finite acceptance fixture list"\)/);
  assert.match(resolver,/if\(!File\.Exists\(path\) \|\| \(File\.GetAttributes\(path\)&\(FileAttributes\.Directory\|FileAttributes\.ReparsePoint\)\)!=0\)/);
  const checkedAliases=quoted(contract,/\$\w+=\[NativeAcceptance\]::ResolveFixturePath\(\$fixtures,\$temporary,'([^']+)'\)/g).sort();assert.deepEqual(checkedAliases,Object.keys(aliases).sort());
  assert.ok(contract.includes(String.raw`Assert-True ($multiple -ceq ('"'+(Join-Path $fixtures 'bulk-standard-a.json')+'" "'+(Join-Path $fixtures 'bulk-standard-b.json')+'"'))`));
  assert.ok(contract.includes(String.raw`$expectedPair='"'+(Join-Path $fixtures 'authoring-original-strict.mid')+'" "'+(Join-Path $fixtures 'authoring-original-events.mid')+'"'`));
  assert.match(contract,/Assert-True \(\$authoringPair -ceq \$expectedPair\)/);
  assert.equal([...contract.matchAll(/Assert-Rejected \{ \[NativeAcceptance\]::ResolveFixturePath\(\$fixtures,\$temporary,'authoring-original-pair'\) \} "pair (?:requires both original regular files: missing|rejects directory|rejects reparse file) \$name"/g)].length,3);
  const rustAuthoring=rust.match(/fn authoring_picker_registry_accepts_only_exact_original_files_and_pair\(\) \{([\s\S]*?)\n    \}/)[1];
  assert.deepEqual(quoted(rustAuthoring.match(/for filename in \[([\s\S]*?)\]/)[1],/"([^"]+)"/g).sort(),[AUTHORING_PAIR_ALIAS,...Object.values(AUTHORING_FIXTURE_FILENAMES)].sort());
  assert.match(rustAuthoring,/for sequence in \[0, 65\][\s\S]*?assert!\(!valid_action\(&action\)\)/);assert.match(rustAuthoring,/action\["sequence"\] = json!\(64\);\s*assert!\(valid_action\(&action\)\)/);
  assert.match(rustAuthoring,/action\["file"\] = json!\(invalid\);\s*assert!\(!valid_action\(&action\)/);
}

test('fixed picker fixture registries agree with Rust and the compiled Windows resolver contract',async()=>{
  // Supplemental static parity check. The PowerShell contract compiles and
  // calls the actual C# resolver on Windows; this does not substitute for it.
  const {contract,workflow}=pickerSources;assertPickerFixtureRegistries(pickerSources);
  assert.match(contract,/Add-Type -Path \(Join-Path \$PSScriptRoot '\.\.\/scripts\/windows-desktop-native\.cs'\)/);
  assert.match(contract,/\[NativeAcceptance\]::ResolveFixturePath\(\$fixtures,\$temporary,\$name\)/);
  const nativeJob=workflow.slice(workflow.indexOf('      - name: Test native filename ownership'));
  assert.ok(nativeJob.indexOf('run: ./tests/windows-desktop-contract.ps1')>=0);
  assert.ok(nativeJob.indexOf('run: ./tests/windows-desktop-contract.ps1')<nativeJob.indexOf('run: cargo test'));
  assert.ok(nativeJob.indexOf('run: ./tests/windows-desktop-contract.ps1')<nativeJob.indexOf('run: cargo build'));
});

test('picker parity rejects unknown or missing aliases, changed pairs and removed resolver bounds',()=>{
  for(const edit of [s=>s.rust=s.rust.replace('"authoring-original-pair",','"authoring-arbitrary-pair",'),s=>s.rust=s.rust.replace('"authoring-original-pair",',''),s=>s.native=s.native.replace('name=="authoring-original-pair"','name.StartsWith("authoring-")'),s=>s.native=s.native.replace('second=ResolveFixturePath(fixtures,output,"authoring-original-events.mid")','second=ResolveFixturePath(fixtures,output,"authoring-original-blocked.mid")'),s=>s.native=s.native.replace('second=ResolveFixturePath(fixtures,output,"authoring-original-events.mid")','second=Path.Combine(fixtures,"authoring-original-events.mid")'),s=>s.native=s.native.replace('FileAttributes.Directory|FileAttributes.ReparsePoint','FileAttributes.Directory'),s=>s.contract=s.contract.replace("$expectedPair='\"'+(Join-Path $fixtures 'authoring-original-strict.mid')", "$expectedPair='\"'+(Join-Path $fixtures 'authoring-original-events.mid')"),s=>s.contract=s.contract.replace('pair rejects reparse file $name','removed reparse assertion'),s=>s.rust=s.rust.replaceAll('for sequence in [0, 65]','for sequence in [0]')]){const changed={...pickerSources};edit(changed);assert.throws(()=>assertPickerFixtureRegistries(changed),edit.toString());}
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

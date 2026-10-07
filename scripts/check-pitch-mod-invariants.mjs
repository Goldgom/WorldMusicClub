// Independent pure stdio audit. No GUI, local listener, private music or public writes.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {startVsqNativeDriver} from '../tests/vsq-native-driver-fixtures.js';
import {assistanceNativeFixtures, progressionNativeFixtures} from './native-assistance-fixtures.mjs';

const [binary, output] = process.argv.slice(2);
assert.ok(binary && output, 'Pass the actual Rust stdio binary and an external audit file');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const config = semitones => ({format:'wmc-pitch-mod',version:1,semitones});
const directory = await mkdtemp(join(tmpdir(),'wmc-pitch-invariant-'));
const start = () => startVsqNativeDriver({binary:resolve(binary),directory:join(directory,'Scores'),requestTimeoutMs:30000});
let driver = start();
const observations = [];
async function send(path,input,status=200) {
  const r=await driver.fetcher(path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input)});
  const bytes=await r.bytes();
  assert.equal(r.status,status,`${path}: ${bytes}`);
  const value=JSON.parse(bytes);
  if(status!==200) {
    assert.ok(value.code || value.error);
    for(const field of ['compilation','checked','runtime','identity','source_pitches']) assert.equal(Object.hasOwn(value,field),false,`No partial ${field} on rejection`);
  }
  observations.push({path,request:input,status:r.status,response:value,response_sha256:hash(bytes)});
  return value;
}
async function snapshot(root,prefix='') {
  const output={};
  for(const entry of (await readdir(root,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))) {
    const relative=join(prefix,entry.name);
    if(entry.isDirectory()) Object.assign(output,await snapshot(join(root,entry.name),relative));
    else output[relative]=hash(await readFile(join(root,entry.name)));
  }
  return output;
}
function compareTimeline(original,projected,shift,pitches) {
  assert.equal(projected.duration_ms,original.duration_ms);
  assert.equal(projected.notes.length,original.notes.length);
  const bySource=new Map(pitches.map(p=>[p.source_id,p]));
  for(let i=0;i<original.notes.length;i++) {
    const before=original.notes[i],after=projected.notes[i];
    const source=bySource.get(before.source_note_id);
    assert.ok(source,`Complete identity ${before.source_note_id}`);
    assert.equal(after.midi,before.midi+(source.percussion?0:shift));
    assert.deepEqual({...after,midi:before.midi},before,'Full clocks, IDs, velocity, ties and occurrence linkage');
  }
}
async function exportBytes(source) {
  const r=await driver.fetcher('/api/library/pack/export',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({keys:[source.key]})});
  assert.equal(r.status,200); return Buffer.from(await r.bytes());
}
try {
  const diagnosticResponse=await driver.fetcher('/api/diagnostics/build',{method:'GET'});
  assert.equal(diagnosticResponse.status,200);
  const diagnostics=await diagnosticResponse.json();
  const originals=assistanceNativeFixtures();
  const imported=await driver.fetcher('/api/library/import/commit',{method:'POST',headers:{'content-type':'application/zip','x-wmh-filename':'original-invariant.zip'},body:originals.bytes});
  assert.equal(imported.status,200); assert.equal((await imported.json()).summary.saved,2);
  const before=await snapshot(directory);
  for(const kind of ['basic','vsq']) {
    const fixture=originals[kind],source=fixture.source;
    const base={source,configuration:config(0)};
    const original=await send('/api/library/pitch-mod/project',base);
    assert.equal(original.identity,null);
    const selection=fixture.original.checked.plan.selection;
    const exportBefore=await exportBytes(source);
    const viewSource={key:source.key,content_sha256:source.content_sha256,profile:source.profile};
    const viewPath=kind==='basic'?'/api/library/basic-keys/notation':'/api/library/fingering/piano';
    const viewRequest=kind==='basic'
      ? {source:viewSource,settings:{part_id:selection.selected_part_ids[0],rendition_policy_id:source.runtime_policy,first_measure:0,measure_count:2,display_meter:{numerator:4,denominator:4},position_ms:null}}
      : {source:{...viewSource,choice:source.choice},settings:{part_id:null,profile:selection.profile,locks:[]}};
    const originalView=await send(viewPath,viewRequest);
    assert.deepEqual(await send(viewPath,{...viewRequest,pitch_mod:config(0)}),originalView,'Zero notation/fingering exact compatibility');
    for(const shift of [-12,-2,2,12]) {
      const projected=await send('/api/library/pitch-mod/project',{...base,configuration:config(shift)});
      assert.deepEqual(projected.source,source);
      assert.deepEqual(projected.identity.original_receipt,original.receipt);
      assert.equal(projected.identity.semitones,shift);
      assert.equal(projected.receipt.runtime_policy,'wmc-pitch-mod-v1');
      assert.notEqual(projected.receipt.runtime_digest,original.receipt.runtime_digest);
      assert.equal(projected.receipt.saved_package_sha256,source.content_sha256);
      compareTimeline(original.compilation.timeline,projected.compilation.timeline,shift,projected.source_pitches);
      const effectiveView=await send(viewPath,{...viewRequest,pitch_mod:config(shift)});
      assert.deepEqual(effectiveView.pitch_mod,projected.identity);
      assert.deepEqual(effectiveView.receipt,projected.receipt);
      if(kind==='basic') {
        assert.equal(originalView.page.key_origin,'unspecified');
        assert.equal(effectiveView.page.key_origin,'unspecified');
        assert.deepEqual(effectiveView.page.score.keys,[],'An unspecified source key must remain unspecified');
        for(const field of ['interpreted_notes','onsets','selectors','unresolved','instantaneous']) {
          const previous=originalView.page[field]??[],current=effectiveView.page[field]??[];
          assert.equal(current.length,previous.length);
          assert.equal(Object.hasOwn(effectiveView.page,field),Object.hasOwn(originalView.page,field));
          current.forEach((note,index)=>{
            const before=previous[index];
            assert.equal(note.key,projected.source_pitches.find(p=>p.source_id===note.note_id).effective_midi);
            assert.deepEqual({...note,key:before.key},before);
          });
        }
        assert.deepEqual(projected.runtime.rendition,original.runtime.rendition,'Basic release ownership, gates, channel routes and exact clocks stay byte-identical');
        for(let i=0;i<original.runtime.compilation.timeline.notes.length;i++) {
          const old=original.runtime.compilation.timeline.notes[i],current=projected.runtime.compilation.timeline.notes[i];
          assert.equal(current[2],projected.compilation.timeline.notes.find(n=>n.id===old[0]).midi);
          assert.deepEqual(current.map((v,j)=>j===2?old[2]:v),old);
        }
        const fifo=original.compilation.timeline.notes.filter(n=>n.midi===60);
        assert.deepEqual(fifo.map(n=>[n.start_ms,n.duration_ms]),[[0,250],[125,375]]);
        const percussion=projected.source_pitches.filter(p=>p.percussion);
        assert.equal(percussion.length,1);assert.equal(percussion[0].original_midi,35);assert.equal(percussion[0].effective_midi,35);
      } else {
        assert.equal(effectiveView.plan.targets.length,originalView.plan.targets.length);
        effectiveView.plan.targets.forEach((target,index)=>{
          const before=originalView.plan.targets[index];
          assert.equal(target.midi,before.midi+shift);
          assert.deepEqual({...target,midi:before.midi},before,'Fingering uses the same effective pitches and exact native gates');
        });
        assert.equal(projected.compilation.timeline.notes[0].start_ms,0);
        assert.deepEqual(projected.navigation,original.navigation);
        const restored=structuredClone(projected.runtime);
        for(let i=0;i<restored.notes.length;i++) {
          assert.equal(restored.notes[i].key,original.runtime.notes[i].key+shift);
          restored.notes[i].key=original.runtime.notes[i].key;
        }
        assert.deepEqual(restored,original.runtime,'VSQ controls and absolute/native clocks retain every field');
      }
      const shifted=await send('/api/library/assistance/generate',{source,selection,settings:fixture.automatic.checked.plan.settings,pitch_mod:config(shift)});
      assert.deepEqual(shifted.checked.receipt,projected.receipt);
      const machine=new Set(shifted.checked.machine_occurrence_ids);
      const human=new Set(shifted.checked.human_targets.groups.flatMap(g=>g.source_occurrence_ids));
      assert.deepEqual([...new Set([...human,...machine])].sort(),projected.compilation.timeline.notes.map(n=>n.id).sort());
      for(const target of shifted.checked.human_targets.timeline.notes) assert.equal(target.midi,projected.compilation.timeline.notes.find(n=>n.id===target.id).midi);
      await send('/api/library/assistance/validate',{source,plan:fixture.automatic.checked.plan,pitch_mod:config(shift)},422);
      await send('/api/library/assistance/validate',{source,plan:shifted.checked.plan},422);
      assert.deepEqual(await send('/api/library/assistance/validate',{source,plan:shifted.checked.plan,pitch_mod:config(shift)}),shifted);
      await send('/api/library/assistance/validate',{source,plan:shifted.checked.plan,pitch_mod:config(shift===12?11:shift+1)},422);
      const prior=progressionNativeFixtures()[kind].layers.balanced.response;
      await send('/api/library/progression/validate',{source,plan:prior.checked.plan,pitch_mod:config(shift)},422);
      const progressive=await send('/api/library/progression/generate',{source,selection,layer:'balanced',pitch_mod:config(shift)});
      assert.deepEqual(progressive.checked.plan.receipt,projected.receipt);
      assert.deepEqual(await send('/api/library/progression/validate',{source,plan:progressive.checked.plan,pitch_mod:config(shift)}),progressive);
    }
    for(const field of ['notes','timeline','score','score_json','runtime','compilation','source_pitches','identity','receipt','digest']) {
      await send('/api/library/pitch-mod/project',{...base,[field]:[]},400);
      await send('/api/library/pitch-mod/project',{...base,source:{...source,[field]:[]}},400);
    }
    for(const [field,value] of [['content_sha256','0'.repeat(64)],['runtime_policy','wmc-pitch-mod-v1'],['profile','fake'],['choice',source.choice===null?'base_notes_instrumental':null]]) {
      await send('/api/library/pitch-mod/project',{...base,source:{...source,[field]:value}},422);
    }
    for(const configuration of [config(13),config(-13),{...config(2),version:2},{...config(2),format:'fake'}]) await send('/api/library/pitch-mod/project',{source,configuration},422);
    for(const configuration of [config(2.5),{...config(2),digest:'f'.repeat(64)},{semitones:2}]) await send('/api/library/pitch-mod/project',{source,configuration},400);
    assert.deepEqual(await exportBytes(source),exportBefore,'Export remains the original complete package');
    assert.deepEqual(await send('/api/library/pitch-mod/project',base),original,'Return to zero discards all effective state');
  }
  await send('/api/library/save',{score_json:'{}',label:'Rejected save must not mutate original'},400);
  assert.deepEqual(await snapshot(directory),before);
  await driver.close(); driver=start();
  for(const kind of ['basic','vsq']) {
    const fixture=originals[kind];
    assert.deepEqual(await send('/api/library/assistance/original',{source:fixture.source,selection:fixture.original.checked.plan.selection}),fixture.original);
  }
  assert.deepEqual(await snapshot(directory),before,'Reopening leaves all raw library bytes unchanged');
  const canonical=JSON.parse(await readFile(new URL('../tests/fixtures/assistance-canonical.json',import.meta.url)));
  const score=structuredClone(canonical.compilation.score); score.parts[0].notes=score.parts[0].notes.slice(0,1);
  score.parts[0].notes[0].pitch={step:'C',alter:0,octave:4};
  const projected=await send('/api/pitch-mod/project',{score,configuration:config(2)});
  assert.equal(projected.compilation.timeline.notes[0].midi,62);
  const assessment=await send('/api/assess',{timeline:projected.compilation.timeline,inputs:[{midi:62,at_ms:0,velocity:90}],tolerance_ms:100});
  assert.equal(assessment.hits.length,1);assert.equal(assessment.misses.length,0);assert.equal(assessment.extras.length,0);
  for(const [pitch,shift] of [[{step:'C',alter:0,octave:-1},-1],[{step:'G',alter:0,octave:9},1]]) {
    const boundary=structuredClone(score); boundary.parts[0].notes[0].pitch=pitch;
    await send('/api/pitch-mod/project',{score:boundary,configuration:config(shift)},422);
  }
  const report={version:1,ok:true,source:diagnostics.compiled,driver_sha256:hash(await readFile(binary)),fixture_sha256:originals.manifest.sha256,response_count:observations.length,observations,claims:{real_rust_stdio:true,network_listener:false,browser:false,native_window:false,physical_audio:false,private_music:false,full_checkpoint_acceptance:false}};
  await writeFile(output,JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({...report,observations:undefined}));
} finally {await driver.close();await rm(directory,{recursive:true,force:true});}

import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync,readFileSync,writeFileSync,rmSync,unlinkSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {deflateSync} from 'node:zlib';
import Ajv2020 from 'ajv/dist/2020.js';
import {originalGuitarUnionStudy} from './guitar-union-fixture.js';
import {GUITAR_UNION_BROWSER_CASE,GUITAR_UNION_REPORT,GUITAR_UNION_VIEWPORTS,guitarUnionScreenshot,assertGuitarUnionReport} from './guitar-union-browser-proof.js';
import {verifyUiPreviewGuitarUnion} from '../scripts/ui-preview-guitar-union.mjs';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8'),sha=bytes=>createHash('sha256').update(bytes).digest('hex'),passing=`ok 25 - ${GUITAR_UNION_BROWSER_CASE}`;
// Synthetic inputs exercise verifier rejection only. These are not retained
// browser evidence and never stand in for the hosted real Rust/browser run.
function syntheticReport(){
  const score=originalGuitarUnionStudy(),notes=score.parts.map((part,index)=>({id:`synthetic-occurrence-${index}`,part_id:part.id,source_note_ids:[part.notes[0].id],midi:[64,67,60][index],start_ms:[0,4000,2000][index],duration_ms:[8000,4000,4000][index]})),profile={kind:'guitar',tuning:[64,59,55,50,45,40],frets:5,capo:0};
  const states=['ab','blocked','recovered','ac','all'].map(label=>{
    const ids=label==='ac'?['A','C']:label==='all'?['A','B','C']:['A','B'],selected=notes.filter(note=>ids.includes(note.part_id)),blocked=label==='blocked';
    const assignments=blocked?[]:selected.map(note=>({...note,occurrence_id:note.id,end_ms:note.start_ms+note.duration_ms,string:label==='ac'?(note.part_id==='A'?1:2):({A:2,B:1,C:3}[note.part_id]),fret:label==='ac'?(note.part_id==='A'?0:1):({A:5,B:3,C:5}[note.part_id]),finger:label==='ac'?(note.part_id==='A'?0:1):({A:3,B:1,C:3}[note.part_id])}));
    return {label,path:'/api/fingering/guitar',httpStatus:200,request:{score:structuredClone(score),part_id:null,selected_part_ids:ids,profile:structuredClone(profile),max_fret_span:3,locks:blocked?[{source_note_id:'held-e',string:1,fret:0,finger:0}]:[]},plan:{version:1,algorithm:'deterministic_guitar_beam_v1',score_id:score.id,max_fret_span:3,requested_locks:blocked?[{source_note_id:'held-e',string:1,fret:0,finger:0}]:[],selected_part_ids:ids,part_id:null,profile:structuredClone(profile),changed_source_notes:false,source_occurrence_count:selected.length,complete:!blocked,status:blocked?'infeasible_under_model':'ready',objective_cost:blocked?null:100,assignments,diagnostics:blocked?[{code:'guitar_fingering_incomplete'}]:[]},ui:{status:blocked?'infeasible_under_model':'ready',scope:`Human parts: ${score.parts.filter(part=>ids.includes(part.id)).map(part=>part.name).join(', ')} · ${selected.length} source occurrences in this selection`,lockSources:selected.flatMap(note=>note.source_note_ids),humanPartIds:ids,mode:'practice',firstPart:label==='all'?'':'A',diagnostics:blocked?'held-e and later-g conflict':'',recommendedCount:blocked?0:1,cards:selected.map(note=>{const choice=assignments.find(choice=>choice.occurrence_id===note.id);return{id:note.id,occurrenceIds:[note.id],sourceIds:note.source_note_ids,route:blocked?[]:[{string:choice.string,fret:choice.fret,finger:choice.finger}]};})}};
  });
  const marker=choice=>({occurrences:[choice.occurrence_id],assignments:[choice],sources:choice.source_note_ids,accessible:choice.source_note_ids.join(', '),text:`${choice.fret} / ${choice.finger} hold`,painted:true,fraction:1,width:80,height:32});
  const snapshots=['ab','ac','all'].flatMap(scope=>GUITAR_UNION_VIEWPORTS.map(viewport=>{
    const row=states.find(row=>row.label===scope),current=row.plan.assignments.filter(choice=>choice.start_ms===0),nextAt=Math.min(...row.plan.assignments.filter(choice=>choice.start_ms>0).map(choice=>choice.start_ms));
    return{scope,viewport:structuredClone(viewport),positionMs:0,controlsClosed:true,current:current.map(marker),next:[...current,...row.plan.assignments.filter(choice=>choice.start_ms===nextAt)].map(marker),scopeLabel:{text:row.ui.scope,painted:true,fraction:1,height:28},play:{painted:true,fraction:1,hit:true},document:{...viewport},transition:'Chosen frets: 5 → 3–5',screenshot:{name:guitarUnionScreenshot(scope,viewport),bytes:2000,sha256:'a'.repeat(64),...viewport}};
  }));
  const takeBefore={score_id:score.id,practice_part:'A',practice_selection:{kind:'parts',part_ids:['A','B']},target_plan:{source_note_count:2,groups:notes.filter(note=>note.part_id!=='C').map(note=>({source_occurrence_ids:[note.id]}))},passes:[{inputs:[{midi:64,at_ms:100}]}]},warning='Changing performers or sound policy restarts this session and clears its in-memory takes. Export takes first. Cancel preserves them.';
  return{version:1,scenario:'guitar-human-union',original_fixtures_only:true,physical_midi_verified:false,physical_fingering_verified:false,global_optimum_claimed:false,compilation:{score,timeline:{notes}},states,snapshots,exports:['ab','blocked','ac','all'].map(label=>({label,score:structuredClone(score)})),takeBefore,takeAfterLockRecovery:structuredClone(takeBefore),takeAfterCancel:structuredClone(takeBefore),cancelWarning:warning,applyWarning:warning,cancelHumanPartIds:['A','B'],reset:{clock:{positionMs:0,running:false,phase:'ready'},captured:'0',exportDisabled:true}};
}
function syntheticPng({width,height}){
  const crc=bytes=>{let c=0xffffffff;for(const b of bytes){c^=b;for(let i=0;i<8;i++)c=c>>>1^((c&1)?0xedb88320:0);}return(c^0xffffffff)>>>0;};
  const chunk=(type,data)=>{const bytes=Buffer.alloc(data.length+12);bytes.writeUInt32BE(data.length);bytes.write(type,4);data.copy(bytes,8);bytes.writeUInt32BE(crc(bytes.subarray(4,-4)),bytes.length-4);return bytes;};
  const header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;header[9]=2;
  return Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',header),chunk('IDAT',deflateSync(Buffer.alloc((width*3+1)*height))),chunk('IEND',Buffer.alloc(0))]);
}
function diskFixture(t){
  const directory=mkdtempSync(join(tmpdir(),'wmh-guitar-union-verifier-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));
  const value=syntheticReport();for(const row of value.snapshots){const png=syntheticPng(row.viewport);writeFileSync(join(directory,row.screenshot.name),png);row.screenshot={...row.screenshot,bytes:png.length,sha256:sha(png)};}
  const save=()=>writeFileSync(join(directory,GUITAR_UNION_REPORT),JSON.stringify(value));save();return{directory,value,save};
}

test('original guitar union fixture has all three C/E/G parts, exact held overlap and schema-valid provenance',()=>{
  const score=originalGuitarUnionStudy(),schema=JSON.parse(read('schema/worldmusichub-score-v1.schema.json')),validate=new Ajv2020({strict:true,allErrors:true}).compile(schema);
  assert.equal(validate(score),true,JSON.stringify(validate.errors));assert.deepEqual(score.parts.map(part=>[part.id,part.notes[0].id,part.notes[0].pitch.step]),[['A','held-e','E'],['B','later-g','G'],['C','middle-c','C']]);
  assert.equal(score.source,null);assert.equal(score.provenance.kind,'original_exercise');assert.deepEqual(score,originalGuitarUnionStudy());assertGuitarUnionReport(syntheticReport());
});

test('guitar union report rejects stale first-part scope, machine notes, partial conflicts, source loss and false physical claims',()=>{
  const mutations=[
    r=>delete r.states[0].request.selected_part_ids,r=>r.states[0].request.part_id='A',r=>r.states[3].request.selected_part_ids=['A','B'],r=>r.states[3].plan=r.states[0].plan,
    r=>r.states[0].plan.selected_part_ids=['A'],r=>r.states[0].plan.assignments.pop(),r=>r.states[0].plan.assignments[0].source_note_ids=['middle-c'],r=>r.states[0].request.score.parts.pop(),
    r=>r.states[0].plan.assignments[0].string=1,r=>r.states[1].plan.assignments=[r.states[0].plan.assignments[0]],r=>r.states[1].plan.objective_cost=0,r=>r.states[1].ui.diagnostics='Generic error',
    r=>r.states[3].ui.lockSources=['held-e','later-g'],r=>r.states[4].plan.assignments.pop(),r=>r.exports[3].score.parts.pop(),r=>r.takeAfterCancel.passes[0].inputs=[],
    r=>r.takeBefore.target_plan.groups.pop(),r=>r.takeBefore.practice_selection.part_ids=['A'],r=>r.takeAfterLockRecovery.passes=[],r=>r.reset.exportDisabled=false,r=>r.reset.clock.positionMs=100,r=>r.cancelHumanPartIds=['A','C'],r=>r.applyWarning='',
    r=>r.physical_midi_verified=true,r=>r.physical_fingering_verified=true,r=>r.global_optimum_claimed=true,
  ];
  for(const [index,mutate]of mutations.entries()){const report=syntheticReport();mutate(report);assert.throws(()=>assertGuitarUnionReport(report),`Union adversary ${index} accepted`);}
});

test('guitar union geometry requires readable scope and complete current/next held identities in both viewports',()=>{
  for(const mutate of [r=>r.snapshots.pop(),r=>r.snapshots[1].current[0].fraction=.5,r=>r.snapshots[1].next.shift(),r=>r.snapshots[0].next[0].sources=[],r=>r.snapshots[0].next[0].accessible='',r=>r.snapshots[1].scopeLabel.fraction=.2,r=>r.snapshots[1].play.hit=false,r=>r.snapshots[2].document.height+=200,r=>r.snapshots[2].controlsClosed=false,r=>r.snapshots[3].screenshot.name='../wrong.png']){
    const report=syntheticReport();mutate(report);assert.throws(()=>assertGuitarUnionReport(report));
  }
});

test('guitar union preview requires exactly one executed passing TAP case before reading files',()=>{
  for(const tap of ['',passing+' # SKIP filtered',passing+' # TODO pending',passing.replace(/^ok /,'not ok '),passing+' extra',passing+'\n'+passing])assert.throws(()=>verifyUiPreviewGuitarUnion('/never-read-invalid-tap',tap),/Missing executed passing guitar-union/);
});

test('guitar union preview revalidates the report and all six retained PNG bytes',t=>{
  const f=diskFixture(t),files=verifyUiPreviewGuitarUnion(f.directory,passing);assert.equal(files.length,7);assert.deepEqual(files.slice(1),f.value.snapshots.map(row=>row.screenshot));
  assert.equal(files[0].sha256,sha(readFileSync(join(f.directory,GUITAR_UNION_REPORT))));
  f.value.states[3].request.selected_part_ids=['A','B'];f.save();assert.throws(()=>verifyUiPreviewGuitarUnion(f.directory,passing));
});

test('guitar union preview rejects missing, truncated, changed, oversized and linked evidence',t=>{
  const f=diskFixture(t),shot=f.value.snapshots[0].screenshot,path=join(f.directory,shot.name),png=readFileSync(path),reportPath=join(f.directory,GUITAR_UNION_REPORT),json=readFileSync(reportPath);
  for(const [file,bytes,invalid]of [[path,png,[Buffer.from('not PNG'),png.subarray(0,33),Buffer.concat([png,Buffer.from('extra')]),Buffer.alloc(8*1024*1024+1)]],[reportPath,json,[Buffer.from('{broken'),Buffer.alloc(4*1024*1024+1)]]]){
    unlinkSync(file);assert.throws(()=>verifyUiPreviewGuitarUnion(f.directory,passing));for(const value of invalid){writeFileSync(file,value);assert.throws(()=>verifyUiPreviewGuitarUnion(f.directory,passing));}writeFileSync(file,bytes);
  }
  const oversized=Buffer.from(png);oversized.writeUInt32BE(0xffffffff,16);writeFileSync(path,oversized);assert.throws(()=>verifyUiPreviewGuitarUnion(f.directory,passing),/finite pixel budget/);writeFileSync(path,png);
  f.value.snapshots[0].screenshot.sha256='0'.repeat(64);f.save();assert.throws(()=>verifyUiPreviewGuitarUnion(f.directory,passing));writeFileSync(reportPath,json);
  if(process.platform!=='win32'){const target=join(f.directory,'original.png');writeFileSync(target,png);unlinkSync(path);symlinkSync(target,path);assert.throws(()=>verifyUiPreviewGuitarUnion(f.directory,passing),/bounded ordinary/);}
});

test('guitar union case is required by focused UI preview, full browser suite and pure npm checks',()=>{
  const workflow=read('.github/workflows/ui-preview.yml'),pattern=new RegExp(workflow.match(/--test-name-pattern='([^']+)'/)[1]);
  assert.equal(pattern.test(GUITAR_UNION_BROWSER_CASE),true);assert.equal(pattern.test(GUITAR_UNION_BROWSER_CASE+' extra'),false);
  const verifier=read('scripts/verify-ui-preview.mjs');assert.ok(verifier.includes('verifyUiPreviewGuitarUnion(directory,tap)'));assert.ok(verifier.includes('names.push(GUITAR_UNION_BROWSER_CASE)'));
  for(const existing of ['LiveSilence','Skin','Home','HumanModTimbre'])assert.ok(verifier.includes(`verifyUiPreview${existing}(directory,tap)`));
  for(const suffix of ['json','png'])assert.ok(workflow.includes(`ui-preview/worldmusichub-guitar-human-union*.${suffix}`));
  assert.ok(read('tests/full-app-browser.test.js').includes('test(GUITAR_UNION_BROWSER_CASE,{timeout:60_000}'));
  const pkg=JSON.parse(read('package.json'));assert.ok(pkg.scripts.test.includes('tests/guitar-union-preview.test.js'));assert.equal(pkg.scripts['test:full-app'],'node --test tests/full-app-browser.test.js');
});

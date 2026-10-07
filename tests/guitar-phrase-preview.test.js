import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,mkdtempSync,rmSync,unlinkSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {deflateSync} from 'node:zlib';
import Ajv2020 from 'ajv/dist/2020.js';
import {originalGuitarPhraseStudy,GUITAR_PHRASE_SCOPE,GUITAR_PHRASE_OLD_SCOPE,GUITAR_PHRASE_LOCKS} from './guitar-phrase-fixture.js';
import {GUITAR_PHRASE_PROFILE,GUITAR_PHRASE_BROWSER_CASE,GUITAR_PHRASE_REPORT,GUITAR_PHRASE_RACES,expectedPhraseInventory,assertGuitarPhraseReport} from './guitar-phrase-browser-proof.js';
import {verifyGuitarPhrasePreview} from '../scripts/verify-guitar-phrase-preview.mjs';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8'),hash=bytes=>createHash('sha256').update(bytes).digest('hex'),clone=structuredClone;
const source={sha:'a'.repeat(40),tree:'b'.repeat(40),server_sha256:'c'.repeat(64)};
// Artificial records below test the oracle, including hostile mutations. They
// are never written to a hosted artifact or presented as browser/Rust evidence.
function syntheticCompilation(score=originalGuitarPhraseStudy()){
  return{score,timeline:{duration_ms:8000,notes:[
    ['before','A',['outside-before'],60,0,2500],['entry','A',['entry-e','entry-e-tail'],64,1000,4000],['machine','C',['machine-d'],50,2750,1000],['inside','B',['inside-g'],67,3000,1500],['after','A',['outside-after'],45,4000,1000],
  ].map(([id,part_id,source_note_ids,midi,start_ms,duration_ms])=>({id,part_id,source_note_ids,midi,start_ms,duration_ms}))}};
}
function syntheticExchange(compilation,{ids=['A','B'],scope=null,locks=[],inventory=false}={}){
  const requested=scope&&expectedPhraseInventory(compilation,ids,scope),selected=compilation.timeline.notes.filter(note=>ids.includes(note.part_id)&&(!scope||requested.included_occurrence_ids.includes(note.id)));
  const positions={before:[3,5,3],entry:[2,5,3],inside:[1,3,1],after:[5,0,0],machine:[4,0,0]};
  const plan={version:1,algorithm:'deterministic_guitar_beam_v1',score_id:compilation.score.id,part_id:null,selected_part_ids:ids,profile:clone(GUITAR_PHRASE_PROFILE),changed_source_notes:false,max_fret_span:3,requested_locks:clone(locks),beam_width:64,explored_choices:100,beam_pruned:false,source_occurrence_count:selected.length,status:inventory?'unavailable':'ready',complete:!inventory,objective_cost:inventory?null:100,diagnostics:inventory?[{code:'guitar_fingering_scope_inventory'}]:[],assignments:inventory?[]:selected.map(note=>({occurrence_id:note.id,source_note_ids:note.source_note_ids,part_id:note.part_id,midi:note.midi,start_ms:note.start_ms,end_ms:note.start_ms+note.duration_ms,string:positions[note.id][0],fret:positions[note.id][1],finger:positions[note.id][2]})),...(scope?{planning_scope:requested,purpose:inventory?'scope_inventory':'phrase_plan'}:{})};
  return{path:'/api/fingering/guitar',httpStatus:200,request:{score:compilation.score,part_id:null,profile:clone(GUITAR_PHRASE_PROFILE),selected_part_ids:ids,max_fret_span:3,locks:clone(locks),...(scope?{planning_scope:scope,...(inventory?{inventory_only:true}:{})}:{})},plan};
}
function syntheticUi(plan,{draft=false,all=false,scope=GUITAR_PHRASE_SCOPE}={}){
  const choices=plan?.assignments??[],shown=choices.length?choices:[{occurrence_id:'entry',source_note_ids:['entry-e','entry-e-tail']}];
  return{instrument:'guitar',mode:'practice',firstPart:all?'':'A',status:draft?'draft':'ready',from:scope?`${scope.from.numerator}${scope.from.denominator===1?'':'/'+scope.from.denominator}`:'0',to:scope?String(scope.to.numerator):'4',phraseMode:scope?'explicit':'whole',phraseStatus:draft?'Use a valid denominator':'2 of 4 occurrences · 1 entry holds',scope:'Human parts: Entry and boundaries, Inside G tail',lockStatus:'2 session locks; 1 apply',lockList:'outside-after: outside this planning phrase; stored, inactive',lockSources:['outside-before','entry-e','entry-e-tail','outside-after','inside-g'],recommendedCount:draft?0:1,cards:shown.map(choice=>({occurrenceIds:[choice.occurrence_id],sourceIds:choice.source_note_ids,route:draft?[]:[{string:choice.string,fret:choice.fret,finger:choice.finger}]})),liveAssignments:draft?[]:choices};
}
function syntheticReport(){
  const compilation=syntheticCompilation(),whole=syntheticExchange(compilation),locked=syntheticExchange(compilation,{locks:GUITAR_PHRASE_LOCKS}),inventory=syntheticExchange(compilation,{scope:GUITAR_PHRASE_SCOPE,inventory:true}),phrase=syntheticExchange(compilation,{scope:GUITAR_PHRASE_SCOPE,locks:[GUITAR_PHRASE_LOCKS[0]]});phrase.ui=syntheticUi(phrase.plan);
  const targetNotes=compilation.timeline.notes.filter(note=>note.part_id!=='C'),pass={inputs:[{midi:64,at_ms:100}],timeline:{notes:targetNotes,duration_ms:8000},revision:1,assessed_revision:1,pending:false,assessment:{hits:[],misses:targetNotes.map(note=>({id:note.id})),extras:[{midi:64}]}};
  const assessment={path:'/api/assess',httpStatus:200,request:{timeline:pass.timeline,inputs:pass.inputs,tolerance_ms:180},result:pass.assessment};
  const before={score:compilation.score,take:{practice_selection:{kind:'parts',part_ids:['A','B']},passes:[pass],target_plan:{source_note_count:4,groups:targetNotes.map(note=>({source_occurrence_ids:[note.id]}))}},clock:{running:false,phase:'paused',positionMs:100},loop:[],assessment:{}};
  const races=GUITAR_PHRASE_RACES.map(({phase,action})=>{
    const compilation=syntheticCompilation(originalGuitarPhraseStudy(action==='source'?`-${phase}`:'')),ids=action==='source'?['A','B','C']:action==='parts'?['A','C']:['A','B'],scope=action==='source'?null:action==='apply'?GUITAR_PHRASE_SCOPE:GUITAR_PHRASE_OLD_SCOPE;
    const stale={...syntheticExchange(syntheticCompilation(),{scope:GUITAR_PHRASE_OLD_SCOPE,inventory:phase==='inventory'}),ordinal:1},replacement={...syntheticExchange(compilation,{ids,scope,inventory:!!scope}),ordinal:2},final=syntheticExchange(compilation,{ids,scope});final.ui=syntheticUi(final.plan,{all:action==='source',scope});
    const pending=syntheticUi(null,{draft:true});pending.status='loading';return{phase,action,compilation,stale,replacement,final,beforeRelease:pending,afterRelease:clone(pending),staleRelease:'aborted',newRequestsWhileReplacementHeld:[],scoreExport:compilation.score};
  });
  const entry=phrase.plan.assignments[0],routeSnapshot={clock:clone(before.clock),controlsClosed:true,current:[],next:[{occurrences:[entry.occurrence_id],sources:entry.source_note_ids,assignments:[entry],painted:true,fraction:1,width:50,height:32,text:'5 / 3',accessible:entry.source_note_ids.join(', ')}]};
  return{version:1,scenario:'guitar-written-phrase',ok:true,source:clone(source),original_fixtures_only:true,physical_midi_verified:false,physical_fingering_verified:false,global_optimum_claimed:false,accepted_package:false,windows_native_verified:false,compilation,whole,locked,inventory,phrase,invalid:{from:'1/0',requests:[],ui:syntheticUi(null,{draft:true})},reverted:{inventory:clone(inventory),plan:clone(phrase),ui:clone(phrase.ui)},assessment,before,after:clone(before),routeSnapshot,phraseRequests:[inventory,phrase].map(row=>({path:row.path,body:JSON.stringify(row.request)})),races,screenshots:['ready','route','invalid'].map(label=>({name:`worldmusichub-guitar-phrase-${label}.png`,width:1440,height:1100,bytes:200,sha256:'d'.repeat(64)}))};
}
function syntheticPng(){
  const chunk=(type,data)=>{const bytes=Buffer.alloc(data.length+12);bytes.writeUInt32BE(data.length);bytes.write(type,4);data.copy(bytes,8);return bytes;};
  const header=Buffer.alloc(13);header.writeUInt32BE(1440);header.writeUInt32BE(1100,4);header[8]=8;header[9]=2;
  return Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',header),chunk('IDAT',deflateSync(Buffer.alloc((1440*3+1)*1100))),chunk('IEND',Buffer.alloc(0))]);
}
function diskFixture(t){
  const directory=mkdtempSync(join(tmpdir(),'wmh-guitar-phrase-negative-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));
  const report=syntheticReport(),png=syntheticPng();for(const shot of report.screenshots){writeFileSync(join(directory,shot.name),png);shot.bytes=png.length;shot.sha256=hash(png);}
  const save=()=>writeFileSync(join(directory,GUITAR_PHRASE_REPORT),JSON.stringify(report));save();
  const tap=`ok 1 - ${GUITAR_PHRASE_BROWSER_CASE}\n`;writeFileSync(join(directory,'tests.tap'),tap);
  return{directory,report,save,png,tap,expected:{sha:source.sha,tree:source.tree,serverSha256:source.server_sha256}};
}

test('original phrase fixture preserves exact source, half-open boundaries, complete tie and machine part',()=>{
  const validate=new Ajv2020({strict:true,allErrors:true}).compile(JSON.parse(read('schema/worldmusichub-score-v1.schema.json'))),score=originalGuitarPhraseStudy();assert.equal(validate(score),true,JSON.stringify(validate.errors));assert.deepEqual(score,originalGuitarPhraseStudy());assert.equal(score.provenance.kind,'original_exercise');assert.match(score.source.content,/原稿/);
  const scope=expectedPhraseInventory(syntheticCompilation(),['A','B'],GUITAR_PHRASE_SCOPE);assert.deepEqual(scope.included_occurrence_ids,['entry','inside']);assert.deepEqual(scope.entry_hold_occurrence_ids,['entry']);assert.equal(scope.full_occurrence_count,4);assertGuitarPhraseReport(syntheticReport());
});

test('phrase report rejects altered bounds, clipped ties, machine targets, missing locks and invented success',()=>{
  const mutations=[r=>r.ok=false,r=>r.source.sha='bad',r=>r.compilation.score.parts.pop(),r=>r.compilation.timeline.notes[1].source_note_ids.pop(),r=>r.compilation.timeline.notes[1].duration_ms=1500,
    r=>r.whole.request.selected_part_ids=['A'],r=>r.phrase.request.score.parts.pop(),r=>r.inventory.request.locks=GUITAR_PHRASE_LOCKS,r=>r.inventory.plan.complete=true,r=>r.inventory.plan.assignments=r.phrase.plan.assignments,
    r=>r.phrase.request.planning_scope.from={numerator:2,denominator:1},r=>r.phrase.request.locks=GUITAR_PHRASE_LOCKS,r=>r.phrase.plan.planning_scope.entry_hold_occurrence_ids=[],r=>r.phrase.plan.planning_scope.included_occurrence_ids.push('machine'),r=>r.phrase.plan.assignments[0].end_ms=4000,
    r=>r.phrase.plan.assignments[0].source_note_ids=['entry-e'],r=>r.phrase.plan.assignments[0].string=1,r=>r.phrase.plan.assignments[1].end_ms=4000,r=>r.phrase.ui.cards=[],r=>r.phrase.ui.lockSources.push('machine-d'),r=>r.phrase.ui.lockList='',r=>r.invalid.requests.push({}),r=>r.invalid.ui.status='ready',r=>r.invalid.ui.liveAssignments=r.phrase.plan.assignments,
    r=>r.reverted.ui.from='1/0',r=>r.after.take.passes[0].inputs=[],r=>r.after.clock.positionMs=0,r=>r.before.take.target_plan.groups.pop(),r=>r.phraseRequests.push({path:'/api/compile'}),r=>r.physical_midi_verified=true,r=>r.global_optimum_claimed=true,r=>r.windows_native_verified=true,
    r=>r.phrase.ui.liveAssignments=[],r=>r.routeSnapshot.next=[],r=>r.routeSnapshot.next[0].painted=false,r=>r.routeSnapshot.next[0].fraction=.1,r=>r.routeSnapshot.next[0].sources=[],r=>r.routeSnapshot.controlsClosed=false,
    r=>r.assessment.httpStatus=500,r=>r.before.take.passes[0].assessment=null,r=>r.before.take.passes[0].assessed_revision=0,r=>r.before.take.passes[0].pending=true,
  ];
  for(const [index,mutate]of mutations.entries()){const report=clone(syntheticReport());mutate(report);assert.throws(()=>assertGuitarPhraseReport(report),`Rejected phrase adversary ${index}`);}
});

test('each Apply Revert source and part race requires both real response phases and a blank pending successor',()=>{
  for(let index=0;index<8;index++)for(const mutate of [row=>row.afterRelease.status='ready',row=>row.afterRelease.recommendedCount=1,row=>row.newRequestsWhileReplacementHeld.push({path:'/api/fingering/guitar'}),row=>row.replacement.ordinal=row.stale.ordinal,row=>row.staleRelease='not sent',row=>row.final.request.selected_part_ids=['A'],row=>row.final.ui.from='1/0',row=>row.stale.httpStatus=500]){
    const report=clone(syntheticReport());mutate(report.races[index]);assert.throws(()=>assertGuitarPhraseReport(report));
  }
  const report=syntheticReport();report.races.pop();assert.throws(()=>assertGuitarPhraseReport(report));
});

test('independent phrase verifier requires exact source and one unskipped executed case',t=>{
  const f=diskFixture(t);assert.equal(verifyGuitarPhrasePreview(f.directory,f.expected).files.length,5);
  for(const text of ['',f.tap+f.tap,f.tap.replace(/^ok /,'not ok '),f.tap.trim()+' # SKIP',f.tap.trim()+' # TODO',f.tap.trim()+' extra']){writeFileSync(join(f.directory,'tests.tap'),text);assert.throws(()=>verifyGuitarPhrasePreview(f.directory,f.expected));}writeFileSync(join(f.directory,'tests.tap'),f.tap);
  for(const key of ['sha','tree','serverSha256'])assert.throws(()=>verifyGuitarPhrasePreview(f.directory,{...f.expected,[key]:'0'.repeat(key==='serverSha256'?64:40)}));
  f.report.races[7].afterRelease.cards[0].route=[{string:1,fret:3,finger:1}];f.save();assert.throws(()=>verifyGuitarPhrasePreview(f.directory,f.expected));
});

test('independent phrase verifier rejects changed missing oversized linked or truncated pixel and JSON evidence',t=>{
  const f=diskFixture(t),file=join(f.directory,f.report.screenshots[0].name),json=join(f.directory,GUITAR_PHRASE_REPORT),original=readFileSync(json);
  for(const [path,valid,bad]of [[file,f.png,[Buffer.from('not PNG'),f.png.subarray(0,33),Buffer.concat([f.png,Buffer.from('tail')]),Buffer.alloc(8*1024*1024+1)]],[json,original,[Buffer.from('{broken'),Buffer.alloc(4*1024*1024+1)]]]){unlinkSync(path);assert.throws(()=>verifyGuitarPhrasePreview(f.directory,f.expected));for(const bytes of bad){writeFileSync(path,bytes);assert.throws(()=>verifyGuitarPhrasePreview(f.directory,f.expected));}writeFileSync(path,valid);}
  f.report.screenshots[0].sha256='0'.repeat(64);f.save();assert.throws(()=>verifyGuitarPhrasePreview(f.directory,f.expected));writeFileSync(json,original);
  if(process.platform!=='win32'){const target=join(f.directory,'original.png');writeFileSync(target,f.png);unlinkSync(file);symlinkSync(target,file);assert.throws(()=>verifyGuitarPhrasePreview(f.directory,f.expected),/bounded ordinary/);}
});

test('focused phrase workflow and full browser registration require original actual Rust evidence',()=>{
  const workflow=read('.github/workflows/guitar-phrase-preview.yml'),pattern=new RegExp(workflow.match(/--test-name-pattern='([^']+)'/)[1]);assert.equal(pattern.test(GUITAR_PHRASE_BROWSER_CASE),true);assert.equal(pattern.test(GUITAR_PHRASE_BROWSER_CASE+' extra'),false);
  for(const text of ['ref: ${{ github.sha }}',"node-version: '22.23.3'","toolchain: '1.99.0'",'cargo build -p practice-server --locked','node --test tests/guitar-phrase-preview.test.js','verify-guitar-phrase-preview.mjs','if: always()'])assert.ok(workflow.includes(text));
  const browser=read('tests/full-app-browser.test.js');assert.equal(browser.match(/registerGuitarPhraseBrowserRegression\(\{/g).length,1);
  const driver=read('scripts/ui-preview-guitar-phrase.mjs');assert.ok(driver.includes('await route.fetch()'));assert.ok(driver.includes('route.fulfill({response:actual,body:bytes})'));assert.ok(driver.includes('page.keyboard.press'));assert.ok(driver.includes('setInputFiles'));
  for(const forbidden of ['dispatchEvent(','.evaluate(()=>state','force:true','physical_midi_verified:true','global_optimum_claimed:true'])assert.equal(driver.includes(forbidden),false);
});

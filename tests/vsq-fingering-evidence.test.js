import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {parseHTML} from 'linkedom';
import {vsqAcceptanceFixture} from '../scripts/prepare-vsq-song-fixtures.mjs';
import {validateVsqFingering} from '../scripts/verify-vsq-fingering-evidence.mjs';
import {syntheticVsqFingering} from './vsq-fingering-evidence-fixtures.js';

const fixture=vsqAcceptanceFixture();
function report(){return {opened:structuredClone(fixture.opened),runtimeResponses:[{path:'/api/library/runtime',status:200,body:structuredClone(fixture.runtime)}],actions:32,...syntheticVsqFingering(fixture)};}
const response=(r,index=0)=>r.fingering.responses[index];
const sample=(r,index=0)=>r.fingering.samples[index];
function rejects(changes){for(const [name,change]of changes){const r=report();change(r);assert.throws(()=>validateVsqFingering(r,fixture),undefined,name);}}

test('unit-only VSQ fingering report validates complete original clock, locks and rendered states',()=>{
  const r=report(),before=structuredClone(r);assert.equal(validateVsqFingering(r,fixture),r.fingering);assert.deepEqual(r,before);
  assert.equal(response(r).body.plan.assignments[0].end_ms,1418.75116875);
  assert.equal(sample(r,1).dom.cards[0].label,'Right 5');
  assert.equal(sample(r,4).dom.cards.length,1);assert.deepEqual(sample(r,4).dom.cards[0].route,[]);
});

test('VSQ fingering refuses source key, hash, profile, choice and renderer authority changes',()=>rejects([
  ['request key',r=>r.requests[1].body.source.key='song-'+ 'b'.repeat(64)],
  ['response hash',r=>response(r).body.source.content_sha256='b'.repeat(64)],
  ['request profile',r=>r.requests[1].body.source.profile='wmh-semantic-midi1-v1'],
  ['response choice',r=>response(r).body.source.choice=null],
  ['missing choice',r=>delete response(r).body.source.choice],
  ['extra source field',r=>response(r).body.source.timeline={}],
  ['renderer score',r=>r.requests[1].body.settings.score=fixture.runtime.compilation.score],
  ['renderer timeline',r=>r.requests[1].body.timeline=fixture.runtime.compilation.timeline],
  ['changed saved bytes',r=>r.opened.clean_package.score_json+=' '],
  ['runtime substitution',r=>r.runtimeResponses[0].body.compilation.timeline.notes[0].duration_ms+=1e-9],
]));

test('VSQ production validators reject tiny native timing changes, omitted identities and settings mismatches',()=>rejects([
  ['piano onset',r=>response(r).body.plan.assignments[0].start_ms+=1e-9],
  ['piano end',r=>response(r).body.plan.assignments[0].end_ms+=1e-9],
  ['coherently forged piano clock',r=>{const p=response(r).body.plan;p.targets[0].end_ms+=1e-9;p.assignments[0].end_ms+=1e-9;}],
  ['guitar end',r=>response(r,3).body.plan.assignments[0].end_ms+=1e-9],
  ['wrong source',r=>response(r,3).body.plan.assignments[0].source_note_ids=['vsq-t2-ID#0001']],
  ['wrong part',r=>response(r,3).body.plan.part_id='vsq-track-2'],
  ['changed piano profile',r=>response(r).body.plan.profile.key_count=88],
  ['changed guitar tuning',r=>response(r,3).body.plan.profile.tuning.reverse()],
  ['missing lock',r=>response(r,2).body.plan.requested_locks=[]],
  ['wrong locked hand',r=>response(r,2).body.plan.assignments[0].hand='left'],
  ['wrong locked finger',r=>response(r,4).body.plan.assignments[0].finger=1],
  ['unsupported span',r=>r.requests[4].body.settings.max_fret_span=4],
  ['missing source diagnostic',r=>response(r,5).body.plan.diagnostics=[]],
  ['invented search limit',r=>response(r,5).body.plan.status='search_limit'],
  ['partial failed plan',r=>response(r,5).body.plan.assignments=structuredClone(response(r,4).body.plan.assignments)],
]));

test('VSQ response ownership requires every consumed appendix request and ordered sampled transitions',()=>rejects([
  ['duplicate response index',r=>response(r,1).requestIndex=1],
  ['runtime request index',r=>response(r).requestIndex=0],
  ['out-of-range index',r=>response(r).requestIndex=128],
  ['mismatched route',r=>response(r).path='/api/fingering/piano'],
  ['failed response',r=>response(r).status=422],
  ['unconsumed body',r=>r.fingering.observations[0].state='awaiting-consumption'],
  ['unmatched observation',r=>r.fingering.observations[0].requestIndex=2],
  ['missing observation',r=>r.fingering.observations.pop()],
  ['missing response',r=>r.fingering.responses.pop()],
  ['extra native request',r=>r.requests.push(structuredClone(r.requests.at(-1)))],
  ['generic fallback',r=>r.requests.push({path:'/api/fingering/guitar',body:{}})],
  ['earlier generic score route',r=>r.requests[0]={path:'/api/fingering/piano',body:{score:{id:fixture.metadata.id}}}],
  ['wrong sample response',r=>sample(r,1).requestIndex=2],
  ['wrong sample order',r=>r.fingering.samples.reverse()],
  ['wrong position',r=>sample(r).positionMs=.001],
  ['wrong selected part',r=>sample(r).partId='vsq-track-2'],
  ['missing sample',r=>r.fingering.samples.pop()],
]));

test('VSQ DOM evidence rejects stale, hidden, fabricated or mislabelled native recommendations',()=>rejects([
  ['hidden piano',r=>sample(r).dom.hidden=true],
  ['stale phase',r=>sample(r).dom.phase='loading'],
  ['missing piano card',r=>sample(r).dom.cards=[]],
  ['wrong piano source',r=>sample(r).dom.cards[0].sourceIds=['invented']],
  ['wrong piano label',r=>sample(r,1).dom.cards[0].label='Left hand · finger 5'],
  ['wrong piano title',r=>sample(r).dom.cards[0].title='Rounded unrelated clock'],
  ['wrong piano countdown',r=>sample(r).dom.cards[0].time='Soon'],
  ['wrong live guitar assignment',r=>sample(r,3).dom.choices[0].finger=1],
  ['wrong guitar card clock',r=>sample(r,2).dom.cards[0].durationMs+=1e-9],
  ['wrong guitar card route',r=>sample(r,3).dom.cards[0].route[0].fret=5],
  ['stale infeasible marker',r=>sample(r,4).dom.choices=sample(r,3).dom.choices],
  ['stale infeasible route',r=>sample(r,4).dom.cards[0].route=sample(r,3).dom.cards[0].route],
  ['stale fretboard',r=>sample(r,4).dom.recommended=1],
  ['removed original card',r=>sample(r,4).dom.cards=[]],
  ['wrong status text',r=>sample(r,4).dom.statusText='An unknown limitation'],
  ['piano still visible',r=>r.fingering.stale.pianoHidden=false],
  ['piano still ready',r=>r.fingering.stale.pianoPhase='ready'],
  ['piano stale cards',r=>r.fingering.stale.pianoCards=1],
  ['piano stale badges',r=>r.fingering.stale.pianoBadges=1],
]));

test('VSQ critical UI actions require bounded native sequence and matching trusted gestures',()=>rejects([
  ['too many actions',r=>r.actions=81],
  ['missing action',r=>r.fingering.actions.pop()],
  ['duplicate sequence',r=>r.fingering.actions[1].sequence=1],
  ['outside action count',r=>r.fingering.actions.at(-1).sequence=33],
  ['new kind',r=>r.fingering.actions[1].kind='select-value'],
  ['wrong control',r=>r.fingering.actions[1].id='piano-source-note'],
  ['wrong value',r=>r.fingering.actions[1].value='left'],
  ['synthetic selection',r=>r.trusted[1].trusted=false],
  ['missing apply click',r=>r.trusted.splice(5,1)],
  ['wrong trusted value',r=>r.trusted[1].value='left'],
  ['duplicate apply click',r=>r.trusted.push(structuredClone(r.trusted[5]))],
  ['out-of-order gestures',r=>r.trusted.reverse()],
]));

test('VSQ observer permits a bounded repeated response state and unrelated trusted keyboard noise',()=>{
  const r=report(),row=structuredClone(response(r));
  r.requests.splice(2,0,structuredClone(r.requests[1]));
  for(const item of r.fingering.responses)if(item.requestIndex>=2)item.requestIndex++;
  row.requestIndex=2;r.fingering.responses.splice(1,0,row);
  for(const item of r.fingering.samples)if(item.requestIndex>=2)item.requestIndex++;
  r.fingering.observations=r.fingering.responses.map(({path,status,requestIndex})=>({path,status,state:'consumed',requestIndex}));
  r.trusted.splice(2,0,{type:'keydown',trusted:true,id:'piano-source-hand',code:'End'},{type:'click',trusted:true,id:'piano-source-hand'});
  validateVsqFingering(r,fixture);
});

test('VSQ appendix samples read rendered DOM identities and remove stale guidance without controller access',async()=>{
  const source=await readFile(new URL('../crates/desktop-shell/vsq-song-acceptance.js',import.meta.url),'utf8');
  const read=runInNewContext(`${source.slice(0,source.indexOf('(() => {'))}\nreadVsqFingeringState`);
  const {document}=parseHTML('<html><body><details id="piano-fingering-guidance" data-phase="ready"><ol id="piano-guidance-items"></ol></details><div id="guitar-stage"><section id="guitar-planning"></section><p id="guitar-plan-status"></p><div id="guitar-live-route"></div><details><ol id="guitar-guidance-items"></ol></details><div id="fretboard"></div></div></body></html>');
  const r=report(),piano=sample(r,1).dom,guitar=sample(r,3).dom,$=id=>document.getElementById(id);
  for(const expected of piano.cards){
    const node=document.createElement('li');node.className='piano-finger-target';
    Object.assign(node.dataset,{targetId:expected.targetId,sourceIds:JSON.stringify(expected.sourceIds),occurrenceIds:JSON.stringify(expected.occurrenceIds),hand:expected.hand});node.title=expected.title;
    for(const [name,value]of [['finger',expected.label],['time',expected.time]]){const child=document.createElement('span');child.className=`piano-finger-${name}`;child.textContent=value;node.append(child);}
    $('piano-guidance-items').append(node);
  }
  $('guitar-planning').dataset.status=guitar.status;$('guitar-plan-status').textContent=guitar.statusText;
  const marker=document.createElement('span');marker.className='guitar-live-choice';marker.dataset.assignments=JSON.stringify(guitar.choices);$('guitar-live-route').append(marker);
  for(const expected of guitar.cards){const node=document.createElement('li');node.className='guitar-target';Object.assign(node.dataset,{targetId:expected.targetId,startMs:String(expected.startMs),durationMs:String(expected.durationMs),sourceIds:JSON.stringify(expected.sourceIds),occurrenceIds:JSON.stringify(expected.occurrenceIds),route:JSON.stringify(expected.route)});$('guitar-guidance-items').append(node);}
  const fret=document.createElement('button');fret.dataset.recommended='true';$('fretboard').append(fret);
  const observed=kind=>JSON.parse(JSON.stringify(read(document,kind)));
  assert.deepEqual(observed('piano'),piano);assert.deepEqual(observed('guitar'),guitar);
  assert.equal($('guitar-guidance-items').closest('details').hasAttribute('open'),false,'Rich source cards can remain collapsed');
  marker.remove();fret.dataset.recommended='false';$('guitar-guidance-items').firstElementChild.dataset.route='[]';
  $('guitar-planning').dataset.status='infeasible_under_model';$('guitar-plan-status').textContent=sample(r,4).dom.statusText;
  assert.deepEqual(observed('guitar'),sample(r,4).dom);
  $('piano-fingering-guidance').hidden=true;$('piano-fingering-guidance').dataset.phase='idle';$('piano-guidance-items').replaceChildren();
  assert.deepEqual(observed('piano'),{hidden:true,phase:'idle',cards:[]});
});

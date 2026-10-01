import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseHTML} from 'linkedom';
import {fixture} from './frontend-fixtures.js';
import {pitchMidi,beat} from '../web/music.js';
import {setupAdaptationView} from '../web/adaptation-view.js';
import {semitoneOperation,validateTranspositionPreview,validateTranspositionRestore,setupTranspositionView} from '../web/transposition-view.js';

const clone=structuredClone,steps=['C','D','E','F','G','A','B'],signed=n=>`${n>0?'+':''}${n}`;
function compile(score){return {score,timeline:{notes:score.parts.flatMap(part=>part.notes.filter(note=>note.pitch).map(note=>({id:note.id,source_note_id:note.id,source_note_ids:[note.id],part_id:part.id,midi:pitchMidi(note.pitch),start_ms:beat(note.at)*500,duration_ms:beat(note.duration)*500,voice:note.voice,staff:note.staff,velocity:note.velocity}))),duration_ms:2000},diagnostics:[]}}
function preview(original=fixture,operation={semitones:2},interval={diatonic_steps:1,fifths_delta:2},timeline=compile(original).timeline){
  const score=clone(original);let count=0;
  for(const part of score.parts)for(const note of part.notes)if(note.pitch){const midi=pitchMidi(note.pitch)+operation.semitones,position=note.pitch.octave*7+steps.indexOf(note.pitch.step)+interval.diatonic_steps,octave=Math.floor(position/7),step=steps[(position%7+7)%7];note.pitch={step,octave,alter:midi-pitchMidi({step,octave,alter:0})};count++}
  for(const key of score.keys)key.fifths+=interval.fifths_delta;
  score.id+=`:semitones:${signed(operation.semitones)}`;score.title+=` [${signed(operation.semitones)} semitones]`;
  score.source={format:'semitone-transposition',filename:null,content:JSON.stringify({version:1,operation,original}),import_diagnostics:[...(original.source?.import_diagnostics||[]),{severity:'warning',code:'explicit_semitone_transposition',message:'Whole score transposed; retain JSON.',note_id:null}]};
  const shiftedTimeline={...clone(timeline),notes:timeline.notes.map(note=>({...clone(note),midi:note.midi+operation.semitones}))};
  return {compilation:{score,timeline:shiftedTimeline,diagnostics:clone(score.source.import_diagnostics)},operation:clone(operation),written_interval:clone(interval),changed_note_count:count,original_preserved:true,scored_mode_allowed:true,instrument_report:{lowest_midi:0,highest_midi:127,note_options:shiftedTimeline.notes.map(note=>({note_id:note.id,midi:note.midi,playable:true,positions:[]})),diagnostics:[],changed_source_notes:false}};
}
function validate(result,original=fixture,operation={semitones:2},timeline=compile(original).timeline){return validateTranspositionPreview(result,original,operation,timeline)}
const settle=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return {promise,resolve,reject}};

test('semitone operation accepts only explicit nonzero bounded integers',()=>{
  for(const value of ['1',-127,'+127','-12'])assert.deepEqual(semitoneOperation(value),{semitones:Number(value)});
  for(const value of ['',0,'0','1.2',128,-128,NaN,Infinity,null,true,{},[]])assert.throws(()=>semitoneOperation(value),/nonzero whole-number/);
});
test('preview validates positive, negative and octave shifts without mutating exact sources',()=>{
  const original=clone(fixture);original.source={format:'musicxml',filename:'原稿.musicxml',content:'\uFEFF<score>\r\nExact source</score>',import_diagnostics:[{severity:'warning',code:'source_only',message:'Keep original',note_id:null}]};
  const before=clone(original);
  for(const [semitones,diatonic_steps,fifths_delta]of [[2,1,2],[-1,-1,5],[12,7,0],[-12,-7,0]]){const operation={semitones},result=preview(original,operation,{diatonic_steps,fifths_delta});assert.equal(validate(result,original,operation),result);assert.deepEqual(JSON.parse(result.compilation.score.source.content).original,original)}
  assert.deepEqual(original,before);
});
test('no-key consistent spelling permits the bounded delta beyond fourteen without inventing keys',()=>{
  const original=clone(fixture);original.keys=[];original.parts[0].notes=original.parts[0].notes.slice(0,1);original.parts[0].notes[0].pitch.alter=-2;
  const operation={semitones:-11},result=preview(original,operation,{diatonic_steps:-8,fifths_delta:19});
  assert.equal(validate(result,original,operation),result);assert.deepEqual(result.compilation.score.parts[0].notes[0].pitch,{step:'B',octave:2,alter:0});assert.deepEqual(result.compilation.score.keys,[]);
});
test('preview retains rests, metadata, source warnings, key maps and exact written spelling',()=>{
  const original=clone(fixture);original.parts[0].notes.push({...clone(original.parts[0].notes[0]),id:'rest',pitch:null});original.keys.push({at:{numerator:1,denominator:2},fifths:-3,mode:'minor'});original.source={format:'test',filename:null,content:'original\r\n',import_diagnostics:[{severity:'warning',code:'old',message:'Original warning',note_id:null}]};
  const mutations=[
    p=>p.compilation.score.parts[0].notes.pop(),p=>p.compilation.score.parts[0].notes[0].duration.numerator++,p=>p.compilation.score.parts[0].notes[0].tie_start=true,p=>p.compilation.score.parts[0].notes[0].staff=2,p=>p.compilation.score.parts[0].notes[0].voice='2',p=>p.compilation.score.parts[0].notes[0].velocity--,p=>p.compilation.score.parts[0].notes[0].id='lost',p=>p.compilation.score.provenance.attribution='different',
    p=>p.compilation.score.keys.pop(),p=>p.compilation.score.keys[1].mode='major',p=>p.compilation.score.keys[1].at.denominator=1,p=>p.compilation.score.keys[1].fifths++,p=>p.compilation.score.parts[0].notes[0].pitch={step:'C',alter:2,octave:4},
    p=>p.written_interval.fifths_delta=1,p=>p.written_interval.diatonic_steps=8,p=>p.changed_note_count++,p=>p.operation.semitones=1,p=>p.original_preserved=false,p=>p.compilation.score.source.import_diagnostics[0].message='lost warning',p=>p.compilation.score.source.import_diagnostics.pop(),p=>{const e=JSON.parse(p.compilation.score.source.content);e.original.source.content='original\n';p.compilation.score.source.content=JSON.stringify(e)},p=>p.compilation.score.source.content='{}'
  ];
  assert.ok(validate(preview(original),original));for(const mutate of mutations){const result=preview(original);mutate(result);assert.throws(()=>validate(result,original),/preserve/)}
});
test('whole-score expanded timeline and all instrument targets must agree, including tied and repeated occurrences',()=>{
  const original=clone(fixture);original.parts[0].notes[0].tie_start=true;original.parts[0].notes[1].pitch=clone(original.parts[0].notes[0].pitch);original.parts[0].notes[1].tie_stop=true;
  original.parts.push({...clone(fixture.parts[0]),id:'bass',notes:fixture.parts[0].notes.map(note=>({...clone(note),id:`bass-${note.id}`,pitch:{...note.pitch,octave:3}}))});
  const base=compile(original).timeline,joined={...base.notes[0],source_note_ids:['c4','e4'],duration_ms:1000},timeline={duration_ms:4000,notes:[joined,...base.notes.slice(2),{...clone(joined),id:'c4@repeat',start_ms:2000}]};
  const result=preview(original,{semitones:2},undefined,timeline);assert.equal(result.changed_note_count,4);assert.equal(validate(result,original,{semitones:2},timeline),result);
  for(const mutate of [p=>{p.compilation.timeline.notes.pop();p.instrument_report.note_options.pop()},p=>p.compilation.timeline.notes[0].duration_ms++,p=>p.compilation.timeline.notes[0].source_note_ids.pop(),p=>p.instrument_report.note_options.pop(),p=>p.instrument_report.note_options[1]=clone(p.instrument_report.note_options[0]),p=>p.instrument_report.note_options[0].midi++,p=>p.compilation.timeline.notes[0].velocity--]){const altered=clone(result);mutate(altered);assert.throws(()=>validate(altered,original,{semitones:2},timeline),/preserve/)}
  const reordered=clone(result);reordered.compilation.timeline.notes.reverse();assert.equal(validate(reordered,original,{semitones:2},timeline),reordered,'App timeline ordering can differ from Rust order');
});
test('preview permits explicit instrument blocking but refuses dishonest scoring admission and out-of-MIDI pitches',()=>{
  const result=preview();result.instrument_report.note_options[0].playable=false;result.scored_mode_allowed=false;assert.equal(validate(result),result);result.scored_mode_allowed=true;assert.throws(()=>validate(result),/preserve/);
  const original=clone(fixture);original.parts[0].notes[0].pitch={step:'G',alter:0,octave:9};assert.throws(()=>validate(preview(original),original),/preserve/);
  const octave=preview(fixture,{semitones:12},{diatonic_steps:8,fifths_delta:12});assert.throws(()=>validate(octave,fixture,{semitones:12}),/preserve/);
});
test('order-independent timeline validation keeps canonically equivalent Unicode source IDs distinct',()=>{
  const original=clone(fixture);original.parts[0].notes[0].id='é';original.parts[0].notes[1].id='e\u0301';
  const result=preview(original);result.compilation.timeline.notes.reverse();
  assert.equal(validate(result,original),result);assert.deepEqual(result.compilation.score.parts[0].notes.map(note=>note.id),['é','e\u0301']);
  const altered=clone(result);altered.compilation.timeline.notes[0].source_note_ids=['é'];assert.throws(()=>validate(altered,original),/preserve/);
});
test('restore requires the complete exact retained original and supported operation/version',()=>{
  const original=clone(fixture);original.source={format:'test',filename:'source.txt',content:'Exact\r\nsource',import_diagnostics:[]};const copy=preview(original).compilation.score,result=compile(clone(original));
  assert.equal(validateTranspositionRestore(result,copy),result);
  for(const mutate of [r=>r.score.title='Different',r=>r.score.source.content='Exact\nsource',r=>r.score.parts[0].notes.pop(),r=>delete r.diagnostics,r=>r.score.source.import_diagnostics.push({code:'new'})]){const altered=clone(result);mutate(altered);assert.throws(()=>validateTranspositionRestore(altered,copy),/complete recorded original/)}
  const unknown=clone(copy),envelope=JSON.parse(unknown.source.content);envelope.version=2;unknown.source.content=JSON.stringify(envelope);assert.throws(()=>validateTranspositionRestore(result,unknown),/complete recorded original/);
});

async function setup(t,overrides={}){
  const {document,window}=parseHTML(await readFile(new URL('../web/index.html',import.meta.url),'utf8')),previous=globalThis.document;
  globalThis.document=document;t.after(()=>{globalThis.document=previous});
  Object.defineProperty(window.HTMLSelectElement.prototype,'value',{configurable:true,get(){return this.querySelector('option[selected]')?.value||this.querySelector('option')?.value||''},set(value){for(const option of this.querySelectorAll('option'))option.toggleAttribute('selected',option.value===String(value))}});
  Object.defineProperty(window.HTMLElement.prototype,'open',{configurable:true,get(){return this.hasAttribute('open')}});
  window.HTMLElement.prototype.showModal=function(){this.setAttribute('open','')};window.HTMLElement.prototype.close=function(){this.removeAttribute('open');this.dispatchEvent(new window.Event('close'))};
  const $=id=>document.getElementById(id),context={score:clone(fixture),timeline:compile(fixture).timeline,part:null,profile:{kind:'piano',key_count:61,lowest_midi:36},version:1,dirty:false},calls=[],activations=[],notices=[];let pauses=0;
  const hooks={api:async(path,body,signal)=>{calls.push({path,body,signal});if(overrides.api)return overrides.api(path,body,signal);return path.endsWith('/restore')?compile(JSON.parse(body.source.content).original):preview(body.score,body.operation,{diatonic_steps:1,fifths_delta:2},context.timeline)},getContext:()=>context,onActivate:async(...args)=>{activations.push(args);return overrides.activate?overrides.activate(...args):false},pausePlayback:()=>pauses++,notice:message=>notices.push(message)};
  const view=setupTranspositionView(hooks);$('transposition-semitones').value='2';
  const open=()=>{$('transposition-button').click()},generate=async()=>{$('transposition-preview').click();await settle()},confirm=()=>{$('transposition-confirm').checked=true;$('transposition-confirm').dispatchEvent(new window.Event('change'))},change=(id,value)=>{if(value!==undefined)$(id).value=value;$(id).dispatchEvent(new window.Event('input'))};
  return {$,window,context,calls,activations,notices,view,hooks,open,generate,confirm,change,pauses:()=>pauses};
}
test('view previews every part without activation and shows explicit replacement, range and key warnings',async t=>{
  const ui=await setup(t);ui.context.part='piano';ui.open();await ui.generate();assert.equal(ui.pauses(),1);assert.equal(ui.activations.length,0);assert.equal(ui.calls.length,1);assert.deepEqual(ui.calls[0].body.operation,{semitones:2});assert.equal(ui.$('transposition-result').hidden,false);assert.equal(ui.$('transposition-activate').disabled,true);assert.equal(ui.context.score.title,fixture.title);
  assert.match(ui.$('transposition-dialog').textContent,/clears its in-memory take history/);assert.match(ui.$('transposition-result-summary').textContent,/whole score/);assert.match(ui.$('transposition-range-summary').textContent,/C4–E4 → D4–F♯4/);assert.match(ui.$('transposition-key-sample').textContent,/C major.*D major/);assert.match(ui.$('transposition-dialog').textContent,/outside A–B/);assert.match(ui.$('transposition-dialog').textContent,/no MIDI hardware/);
  ui.confirm();assert.equal(ui.$('transposition-activate').disabled,false);ui.change('transposition-semitones','-2');assert.equal(ui.$('transposition-confirm').checked,false);assert.equal(ui.$('transposition-activate').disabled,true);
});
test('late preview success or rejection cannot reopen a closed/replaced review',async t=>{
  const first=deferred(),second=deferred();let count=0;const ui=await setup(t,{api:()=>++count===1?first.promise:second.promise});ui.open();ui.$('transposition-preview').click();const oldSignal=ui.calls[0].signal;ui.$('transposition-cancel').click();assert.equal(oldSignal.aborted,true);ui.open();ui.$('transposition-preview').click();second.resolve(preview());await settle();assert.equal(ui.$('transposition-result').hidden,false);first.resolve(preview(fixture,{semitones:-1},{diatonic_steps:-1,fifths_delta:5}));await settle();assert.match(ui.$('transposition-result-summary').textContent,/\+2 semitones/);
  ui.$('transposition-close').click();assert.equal(ui.$('transposition-dialog').open,false);assert.equal(ui.$('transposition-activate').disabled,true);
});
test('Escape, external close and context changes cancel pending requests even if the API ignores abort',async t=>{
  const gate=deferred(),ui=await setup(t,{api:()=>gate.promise});ui.open();ui.$('transposition-preview').click();const signal=ui.calls[0].signal;const event=new ui.window.Event('cancel',{cancelable:true});ui.$('transposition-dialog').dispatchEvent(event);assert.equal(event.defaultPrevented,true);assert.equal(signal.aborted,true);gate.reject(Error('late failure'));await settle();assert.equal(ui.$('transposition-dialog').open,false);
  ui.open();ui.$('transposition-preview').click();ui.$('transposition-dialog').close();await settle();assert.equal(ui.$('transposition-activate').disabled,true);
});
test('changed part/profile/version or in-place score/timeline mutation prevents activation',async t=>{
  const ui=await setup(t);
  for(const mutate of [()=>ui.context.version++,()=>ui.context.part='piano',()=>ui.context.profile.key_count=49,()=>ui.context.score.title+=' edited',()=>ui.context.timeline.notes[0].start_ms++,()=>ui.context.dirty=true]){
    ui.open();await ui.generate();ui.confirm();mutate();ui.$('transposition-activate').click();await settle();assert.equal(ui.activations.length,0);assert.equal(ui.$('transposition-confirm').checked,false);assert.equal(ui.$('transposition-activate').disabled,true);ui.context.dirty=false;
  }
});
test('request refusals and invalid restore responses remain visible and usable',async t=>{
  let reject=true;const ui=await setup(t,{api:(path,body)=>{if(reject)throw Error('No single written interval fits this score.');return compile({...JSON.parse(body.source.content).original,title:'wrong'})}});ui.open();await ui.generate();assert.match(ui.$('transposition-status').textContent,/No single written interval/);assert.equal(ui.$('transposition-preview').disabled,false);assert.equal(ui.$('transposition-confirm').disabled,true);
  ui.context.score=preview().compilation.score;ui.context.timeline=preview().compilation.timeline;ui.view.scoreChanged();reject=false;ui.$('transposition-restore-preview').click();await settle();assert.match(ui.$('transposition-status').textContent,/complete recorded original/);assert.equal(ui.$('transposition-restore-preview').disabled,false);assert.equal(ui.$('transposition-activate').disabled,true);
});
test('octave and semitone copies explain restoration first without stacking operations',async t=>{
  const ui=await setup(t);ui.context.score.source={format:'octave-adaptation',content:'{}'};ui.open();assert.equal(ui.$('transposition-preview').disabled,true);assert.match(ui.$('transposition-status').textContent,/Preview octave copy/);await ui.generate();assert.equal(ui.calls.length,0);
  ui.$('transposition-close').click();ui.context.score=preview().compilation.score;setupAdaptationView(ui.hooks);ui.$('adaptation-button').click();assert.equal(ui.$('adaptation-preview').disabled,true);assert.match(ui.$('adaptation-status').textContent,/Transpose semitones/);ui.$('adaptation-preview').click();await settle();assert.equal(ui.calls.length,0);
});
test('activation double clicks share one request; cancellation or withdrawing confirmation aborts before commit',async t=>{
  const gate=deferred(),ui=await setup(t,{activate:()=>gate.promise});ui.open();await ui.generate();ui.confirm();ui.$('transposition-activate').click();ui.$('transposition-activate').click();assert.equal(ui.activations.length,1);assert.equal(ui.activations[0][2].practicePart,null);ui.$('transposition-confirm').checked=false;ui.$('transposition-confirm').dispatchEvent(new ui.window.Event('change'));assert.equal(ui.activations[0][1].aborted,true);gate.resolve(true);await settle();assert.equal(ui.context.score.title,fixture.title);assert.equal(ui.notices.length,0);assert.equal(ui.$('transposition-activate').disabled,true);
});
test('scoreChanged finishes activation at the committed score boundary without aborting pending checks',async t=>{
  const gate=deferred(),ui=await setup(t,{activate:()=>gate.promise});ui.open();await ui.generate();ui.confirm();ui.$('transposition-activate').click();const [score,signal]=ui.activations[0];ui.context.score=clone(score);ui.context.timeline=compile(score).timeline;ui.context.version++;ui.view.scoreChanged();assert.equal(ui.$('transposition-dialog').open,false);assert.equal(signal.aborted,false);assert.match(ui.notices[0],/copy loaded.*checks are updating/);ui.open();assert.equal(ui.$('transposition-preview').disabled,true);gate.resolve(true);await settle();assert.equal(ui.$('transposition-dialog').open,true,'Late activation completion does not close a newly opened review');assert.equal(ui.notices.length,1);
});
test('exact original review requires explicit activation and preserves selected Practice part',async t=>{
  const ui=await setup(t);ui.context.score=preview().compilation.score;ui.context.timeline=preview().compilation.timeline;ui.context.part='piano';ui.open();ui.$('transposition-restore-preview').click();await settle();assert.equal(ui.activations.length,0);assert.equal(ui.$('transposition-activate').disabled,true);assert.match(ui.$('transposition-status').textContent,/Original preview ready/);ui.confirm();ui.$('transposition-activate').click();await settle();assert.deepEqual(ui.activations[0][0],fixture);assert.equal(ui.activations[0][2].practicePart,'piano');assert.equal(ui.$('transposition-activate').disabled,true,'Failed activation requires another review');
});

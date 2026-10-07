import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {prepareCleanSong,prepareVsqPractice} from '../web/clean-song-package.js';
import {setupPianoFingering,defaultPianoSettings} from '../web/piano-fingering.js';
import {setupGuitarFingering,guitarSelectedNotes,guitarSelectedPartIds} from '../web/guitar-fingering.js';
import {pianoResult} from './piano-fingering-fixtures.js';
import {cleanSong,cleanDescriptor,fixtureKey} from './clean-song-fixtures.js';

const read=name=>JSON.parse(readFileSync(new URL(`./fixtures/${name}`,import.meta.url),'utf8'));
function fractionalSong(){
  const fixture=read('clean-midi-fractional-navigation.json'),descriptor=cleanDescriptor(),metadata=JSON.parse(descriptor.metadata_json);
  metadata.id=fixture.complete_score.notation.id;metadata.title=fixture.complete_score.notation.title;
  Object.assign(descriptor,{metadata_json:JSON.stringify(metadata),score_json:JSON.stringify(fixture.complete_score),runtime:fixture.runtime});
  return prepareCleanSong(fixtureKey,descriptor,fixture.runtime.compilation.score);
}
function vsqSong({chosen=true}={}){
  const opened=read('vsq-clean-v1-native-open.json'),descriptor=opened.clean_package;
  const song=prepareCleanSong(`native:song-${descriptor.content_sha256}`,descriptor,JSON.parse(opened.score_json));
  return chosen?prepareVsqPractice(song,read('vsq-clean-v1-runtime.json')):song;
}
const context=(song,kind)=>({cleanSong:song,score:song.compilation?.score??song.notation,timeline:song.compilation?.timeline??null,part_id:song.notation.parts[0].id,profile:kind==='piano'?{kind,key_count:88,lowest_midi:21}:{kind,tuning:[40,45,50,55,59,64],frets:12,capo:0},dirty:false});
const source=song=>({key:song.libraryKey.slice(7),content_sha256:song.identity,profile:song.profile,choice:song.runtime?.choice??null});
const settings=kind=>kind==='piano'?defaultPianoSettings():{max_fret_span:3,locks:[]};
const controller=(kind,options)=>(kind==='piano'?setupPianoFingering:setupGuitarFingering)(options);
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const phrase={version:1,from:{numerator:1,denominator:480},to:{numerator:1,denominator:24}};

/** Declared test positions for the existing original fixtures, not a JS planner. */
const positions={48:{string:2,fret:3,finger:3},55:{string:4,fret:0,finger:0},60:{string:5,fret:1,finger:1},63:{string:5,fret:4,finger:4},64:{string:6,fret:0,finger:0},67:{string:6,fret:3,finger:3}};
function guitarResult(ctx,requested,{included,entry=[]}={}){
  const all=guitarSelectedNotes(ctx),notes=included?all.filter(note=>included.includes(note.id)):all;
  const onsets=[...new Set(notes.map(note=>note.start_ms))].sort((a,b)=>a-b);
  const plan={version:1,algorithm:'deterministic_guitar_beam_v1',score_id:ctx.score.id,part_id:ctx.part_id,...(ctx.selected_part_ids===undefined?{}:{selected_part_ids:guitarSelectedPartIds(ctx)}),profile:structuredClone(ctx.profile),status:notes.length?'ready':'no_targets',complete:true,changed_source_notes:false,source_occurrence_count:notes.length,max_fret_span:requested.max_fret_span,beam_width:64,explored_choices:0,beam_pruned:false,objective_cost:0,requested_locks:structuredClone(requested.locks),diagnostics:[],assignments:notes.map(note=>({occurrence_id:note.id,source_note_ids:note.source_note_ids,part_id:note.part_id,midi:note.midi,start_ms:note.start_ms,end_ms:note.start_ms+note.duration_ms,...positions[note.midi],onset_index:onsets.indexOf(note.start_ms),picking_hint:notes.filter(item=>item.start_ms===note.start_ms).length>1?'simultaneous_pluck_review':onsets.indexOf(note.start_ms)%2?'upstroke_suggestion':'downstroke_suggestion'}))};
  if(requested.planning_scope){
    plan.purpose=requested.inventory_only?'scope_inventory':'phrase_plan';
    plan.planning_scope={requested:structuredClone(requested.planning_scope),start_ms:all[0].start_ms,end_ms:all.at(-1).start_ms+all.at(-1).duration_ms,full_occurrence_count:all.length,selected_occurrence_count:notes.length,included_occurrence_ids:notes.map(note=>note.id),entry_hold_occurrence_ids:entry};
    if(requested.inventory_only)Object.assign(plan,{status:'unavailable',complete:false,assignments:[],objective_cost:null});
  }
  return plan;
}
const response=(kind,ctx,requested= settings(kind),options)=>({source:source(ctx.cleanSong),plan:kind==='piano'?pianoResult(ctx,requested):guitarResult(ctx,requested,options)});

for(const kind of ['piano','guitar']){
  for(const [label,create] of [['fractional MIDI',fractionalSong],['explicit VSQ',vsqSong]]){
    test(`${kind} binds ${label} requests to saved native bytes and preserves the exact admitted clock`,async()=>{
      const ctx=context(create(),kind),before=JSON.stringify(ctx),calls=[];
      let guide;guide=controller(kind,{getContext:()=>ctx,onChange:state=>{if(state.phase==='loading')guide.prepare();},api:(path,body,signal)=>new Promise(resolve=>calls.push({path,body,signal,resolve}))});
      const pending=guide.prepare();assert.equal(guide.prepare(),pending);assert.equal(guide.state().phase,'loading');await Promise.resolve();
      assert.equal(calls.length,1);assert.equal(calls[0].path,`/api/library/fingering/${kind}`);
      assert.deepEqual(calls[0].body,{source:source(ctx.cleanSong),settings:{part_id:ctx.part_id,profile:ctx.profile,...settings(kind)}});
      assert.equal('score' in calls[0].body.settings,false);
      const expected=response(kind,ctx);calls[0].resolve(expected);assert.equal(await pending,expected.plan);
      assert.equal(guide.state().phase,'ready');assert.equal(guide.assignment(ctx.timeline.notes[0].id).start_ms,ctx.timeline.notes[0].start_ms);
      assert.equal(guide.assignment(ctx.timeline.notes[0].id).end_ms,ctx.timeline.notes[0].start_ms+ctx.timeline.notes[0].duration_ms);
      await guide.prepare();assert.equal(calls.length,1);assert.equal(JSON.stringify(ctx),before);
    });
  }

  test(`${kind} rejects wrong native source, profile, choice, score and even tiny timing changes`,async()=>{
    for(const mutate of [r=>r.source.key='song-'+'b'.repeat(64),r=>r.source.content_sha256='b'.repeat(64),r=>r.source.profile='wmh-vsq-clean-v1',r=>r.source.choice='base_notes_instrumental',r=>delete r.source.choice,r=>r.source.extra=true,r=>r.source=null,r=>r.plan.score_id='different',r=>r.plan.part_id=null,r=>r.plan.profile.kind='other',r=>r.plan.assignments[0].start_ms+=1e-9,r=>r.plan.assignments[0].end_ms+=1e-9]){
      const ctx=context(fractionalSong(),kind);let calls=0;
      const guide=controller(kind,{getContext:()=>ctx,api:async()=>{calls++;const result=response(kind,ctx);mutate(result);return result;}});
      await guide.prepare();assert.equal(guide.state().phase,'error');assert.equal(guide.state().plan,null);assert.equal(guide.assignment(ctx.timeline.notes[0].id),null);
      await guide.prepare();assert.equal(calls,1);
    }
    const ctx=context(vsqSong(),kind),guide=controller(kind,{getContext:()=>ctx,api:async()=>{const result=response(kind,ctx);result.source.choice=null;return result;}});
    await guide.prepare();assert.equal(guide.state().phase,'error');assert.equal(guide.state().plan,null);
  });

  test(`${kind} never falls back for unadmitted, missing-notation, unchosen or detached native contexts`,async()=>{
    const valid=context(fractionalSong(),kind),unchosen=context(vsqSong({chosen:false}),kind);
    const cases=[{...valid,cleanSong:structuredClone(valid.cleanSong)},{...valid,cleanSong:{...valid.cleanSong,notation:null}},{...valid,cleanSong:{...valid.cleanSong,profile:'unknown'}},{...valid,cleanSong:{}},{...valid,score:structuredClone(valid.score)},{...valid,timeline:structuredClone(valid.timeline)},unchosen,{...unchosen,timeline:valid.timeline}];
    for(const ctx of cases){
      const calls=[],guide=controller(kind,{getContext:()=>ctx,api:async(path)=>{calls.push(path);throw Error('Must not request');}});
      await guide.prepare();await guide.prepare({retry:true});assert.deepEqual(calls,[]);assert.equal(guide.state().plan,null);assert.equal(guide.assignment(valid.timeline.notes[0].id),null);
    }
  });

  test(`${kind} drops an old native response when a fresh VSQ choice replaces the same saved package`,async()=>{
    let ctx=context(vsqSong(),kind);const original=ctx,calls=[];
    const guide=controller(kind,{getContext:()=>ctx,api:(path,body,signal)=>new Promise((resolve,reject)=>calls.push({path,body,signal,resolve,reject}))});
    const old=guide.prepare();await Promise.resolve();
    // Same source hash and explicit choice, but a newly admitted runtime must own the next response.
    ctx=context(vsqSong(),kind);const current=guide.prepare();await Promise.resolve();assert.equal(calls[0].signal.aborted,true);
    calls[1].resolve(response(kind,ctx));await current;const plan=guide.state().plan;
    calls[0].resolve(response(kind,original));await old;assert.equal(guide.state().plan,plan);assert.equal(calls.length,2);
    // A source object alone changing cannot leave the cached guidance visible.
    ctx={...ctx,cleanSong:vsqSong({chosen:false})};assert.equal(guide.assignment(original.timeline.notes[0].id),null);
    await guide.prepare();assert.equal(calls.length,2);assert.equal(guide.state().phase,'error');
  });

  test(`${kind} blocks queued stale choices and requires explicit retry after a native request failure`,async()=>{
    let ctx=context(vsqSong(),kind),calls=0;
    const guide=controller(kind,{getContext:()=>ctx,api:async()=>{if(++calls===1)throw Error('Native storage temporarily unavailable');return response(kind,ctx);}});
    const stale=guide.prepare();ctx={...ctx,cleanSong:vsqSong({chosen:false})};await stale;assert.equal(calls,0);assert.equal(guide.state().plan,null);
    ctx=context(vsqSong(),kind);await guide.prepare();assert.equal(guide.state().phase,'error');await guide.prepare();assert.equal(calls,1);
    await guide.prepare({retry:true});assert.equal(calls,2);assert.equal(guide.state().phase,'ready');
  });

  test(`${kind} sends native settings and source-note locks without changing their validation`,async()=>{
    const ctx=context(fractionalSong(),kind),calls=[],guide=controller(kind,{getContext:()=>ctx,api:async(path,body)=>{calls.push({path,body});return response(kind,ctx,body.settings);}});
    const requested=kind==='piano'?{...defaultPianoSettings(),right_hand:{lowest_midi:40,highest_midi:80,max_span_semitones:9},locks:[{source_note_id:ctx.timeline.notes[0].source_note_ids[0],hand:'right',finger:1}]}:{max_fret_span:5,locks:[{source_note_id:ctx.timeline.notes[0].source_note_ids[0],string:5,fret:1,finger:1}]};
    guide.setSettings(requested);await guide.prepare();assert.equal(guide.state().phase,'ready');assert.deepEqual(calls[0].body.settings,{part_id:ctx.part_id,profile:ctx.profile,...requested});
    assert.deepEqual(guide.state().plan.requested_locks,requested.locks);
  });

  test(`${kind} cannot manufacture sounding targets when native notation is absent`,async()=>{
    // A missing notation projection is not authority to synthesize source IDs from runtime notes.
    const song=cleanSong(),ctx={...context(song,kind),score:null,cleanSong:{...song,notation:null}};
    let calls=0;const guide=controller(kind,{getContext:()=>ctx,api:async()=>{calls++;}});
    assert.ok(song.runtime.notes.length);await guide.prepare();assert.equal(calls,0);assert.equal(guide.state().plan,null);assert.equal(guide.assignment(song.runtime.notes[0].note_id),null);
  });

  test(`${kind} returns to the unchanged ordinary endpoint after the native source is cleared`,async()=>{
    let ctx=context(fractionalSong(),kind);const calls=[];
    const guide=controller(kind,{getContext:()=>ctx,api:async(path,body)=>{
      calls.push({path,body});
      const requested=body.settings??body,plan=kind==='piano'?pianoResult(ctx,requested):guitarResult(ctx,requested);
      return body.source?{source:body.source,plan}:plan;
    }});
    await guide.prepare();assert.equal(guide.state().phase,'ready');
    ctx={...ctx,cleanSong:null,score:structuredClone(ctx.score),timeline:structuredClone(ctx.timeline)};
    assert.equal(guide.assignment(ctx.timeline.notes[0].id),null);await guide.prepare();assert.equal(guide.state().phase,'ready');
    assert.equal(calls.length,2);assert.equal(calls[1].path,`/api/fingering/${kind}`);
    assert.deepEqual(calls[1].body,{score:ctx.score,part_id:ctx.part_id,profile:ctx.profile,...settings(kind)});
  });
}

test('native guitar phrases bind inventory and final plan to one source and retain outside locks',async()=>{
  const ctx=context(fractionalSong(),'guitar'),[inside,outside]=ctx.timeline.notes,calls=[];
  const guide=setupGuitarFingering({getContext:()=>ctx,api:async(path,body)=>{calls.push({path,body});return response('guitar',ctx,body.settings,{included:[inside.id],entry:[inside.id]});}});
  guide.setSettings({max_fret_span:4,locks:[{source_note_id:inside.source_note_ids[0],finger:1},{source_note_id:outside.source_note_ids[0],finger:0}]});guide.setPlanningScope(phrase);
  await guide.prepare();assert.equal(guide.state().phase,'ready');assert.equal(calls.length,2);
  for(const call of calls){assert.equal(call.path,'/api/library/fingering/guitar');assert.deepEqual(call.body.source,source(ctx.cleanSong));assert.equal('score' in call.body.settings,false);assert.deepEqual(call.body.settings.planning_scope,phrase);}
  assert.equal(calls[0].body.settings.inventory_only,true);assert.deepEqual(calls[0].body.settings.locks,[]);
  assert.deepEqual(calls[1].body.settings.locks,[{source_note_id:inside.id,string:null,fret:null,finger:1}]);assert.equal(guide.state().settings.locks.length,2);
  assert.deepEqual(guide.state().scopeInventory.entry_hold_occurrence_ids,[inside.id]);assert.equal(guide.assignment(outside.id),null);
});

test('invalid native inventory source prevents a lock-bearing request and final inventory stays exact',async()=>{
  for(const phase of ['inventory','plan']){
    const ctx=context(fractionalSong(),'guitar'),calls=[];
    const guide=setupGuitarFingering({getContext:()=>ctx,api:async(path,body)=>{calls.push({path,body});const result=response('guitar',ctx,body.settings,{included:[ctx.timeline.notes[0].id]});if(phase==='inventory')result.source.content_sha256='b'.repeat(64);else if(!body.settings.inventory_only)result.plan.planning_scope.start_ms+=1e-9;return result;}});
    guide.setPlanningScope(phrase);await guide.prepare();assert.equal(calls.length,phase==='inventory'?1:2);assert.equal(guide.state().phase,'error');assert.equal(guide.state().plan,null);
  }
});

test('replacing a native choice during either guitar phrase phase discards the old response',async()=>{
  for(const phase of ['inventory','plan']){
    let ctx=context(fractionalSong(),'guitar');const original=ctx,calls=[];
    const guide=setupGuitarFingering({getContext:()=>ctx,api:(path,body,signal)=>new Promise(resolve=>calls.push({path,body,signal,resolve}))});
    guide.setPlanningScope(phrase);const pending=guide.prepare();await Promise.resolve();
    if(phase==='plan'){calls[0].resolve(response('guitar',original,calls[0].body.settings,{included:[original.timeline.notes[0].id]}));await tick();}
    const last=calls.at(-1);ctx={...ctx,cleanSong:fractionalSong()};guide.state();assert.equal(last.signal.aborted,true);
    last.resolve(response('guitar',original,last.body.settings,{included:[original.timeline.notes[0].id]}));await pending;
    assert.equal(guide.state().plan,null);assert.equal(guide.state().scopeInventory,null);assert.equal(calls.length,phase==='inventory'?1:2);
  }
});

test('native VSQ All sends the full selected union and rejects the previous one-part scope',async()=>{
 const ctx=context(vsqSong(),'guitar');ctx.part_id=null;ctx.selected_part_ids=ctx.score.parts.map(part=>part.id).reverse();const calls=[];
 const guide=setupGuitarFingering({getContext:()=>ctx,api:async(path,body)=>{calls.push({path,body});return response('guitar',ctx,body.settings)}});
 await guide.prepare();assert.equal(guide.state().phase,'ready');assert.equal(calls[0].path,'/api/library/fingering/guitar');
 assert.deepEqual(calls[0].body.settings.selected_part_ids,ctx.score.parts.map(part=>part.id));assert.equal(calls[0].body.settings.part_id,null);
 assert.deepEqual(calls[0].body.source,source(ctx.cleanSong));assert.equal('score' in calls[0].body.settings,false);assert.equal('timeline' in calls[0].body.settings,false);
 assert.equal(guide.state().plan.assignments.length,ctx.timeline.notes.length);assert.equal(guide.state().plan.assignments[0].start_ms,0);
 const invalid=setupGuitarFingering({getContext:()=>ctx,api:async()=>{const answer=response('guitar',ctx);answer.plan.selected_part_ids=[ctx.score.parts[0].id];return answer}});await invalid.prepare();assert.equal(invalid.state().phase,'error');
});

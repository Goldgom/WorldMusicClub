import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseHTML} from 'linkedom';
import {guitarGuidanceView,setupGuitarGuidance,GUITAR_VISIBLE_TARGETS} from '../web/guitar-guidance.js';
import {Transport,TimelineIndex} from '../web/transport.js';

// Representative expanded times. The view receives milliseconds, never a score BPM
// or notation beats; the actual Rust compile/target correspondence is checked in CI.
function expandedFixture(){
 const notes=[
  {id:'tie@pass1',part_id:'lead',midi:64,start_ms:500/3,duration_ms:875,source_note_ids:['tie-head','tie-end']},
  {id:'unison@pass1',part_id:'second',midi:64,start_ms:500/3,duration_ms:250,source_note_ids:['unison']},
  {id:'tempo-change@pass1',part_id:'lead',midi:67,start_ms:1625,duration_ms:625,source_note_ids:['tempo-change']},
  {id:'tie@pass2',part_id:'lead',midi:64,start_ms:3875+500/3,duration_ms:875,source_note_ids:['tie-head','tie-end']},
  {id:'unison@pass2',part_id:'second',midi:64,start_ms:3875+500/3,duration_ms:250,source_note_ids:['unison']},
  {id:'after-rest',part_id:'lead',midi:69,start_ms:10000,duration_ms:500,source_note_ids:['after-rest']}
 ];
 const timeline={notes,duration_ms:10500},groups=new Map(notes.map(note=>[note.id,{target_id:note.id,source_occurrence_ids:[note.id],source_note_ids:note.source_note_ids,part_ids:[note.part_id]}]));
 return{timeline,index:new TimelineIndex(notes),groups,parts:[{id:'lead',name:'Lead melody'},{id:'second',name:'Second voice'}]};
}

test('guitar cards preserve fractional Rust onsets, tempo-map spacing, repeated occurrences, ties and simultaneous unisons',()=>{
 const source=expandedFixture(),before=structuredClone(source.timeline),view=guitarGuidanceView({...source,position:0,mode:'practice'});
 assert.deepEqual(view.items.map(item=>[item.id,item.startMs,item.durationMs]),source.timeline.notes.slice(0,3).map(note=>[note.id,note.start_ms,note.duration_ms]));
 assert.deepEqual(view.items.slice(0,2).map(item=>item.pitch),['E4','E4']);assert.notEqual(view.items[0].id,view.items[1].id);assert.equal(view.items[0].onset,'At 0.167s');assert.equal(view.items[2].onset,'At 1.625s');
 assert.deepEqual(view.items[0].sourceIds,['tie-head','tie-end']);assert.deepEqual(view.items[0].occurrenceIds,['tie@pass1']);
 const repeat=guitarGuidanceView({...source,position:3875,running:true,hasStarted:true,mode:'practice'});assert.deepEqual(repeat.items.map(item=>item.id),['tie@pass2','unison@pass2']);assert.deepEqual(repeat.items[0].sourceIds,view.items[0].sourceIds);assert.notDeepEqual(repeat.items[0].occurrenceIds,view.items[0].occurrenceIds);assert.deepEqual(source.timeline,before);
});

test('transport pause freezes both count-in and later onset countdowns and resume adds no new count-in',()=>{
 const source=expandedFixture(),transport=new Transport();transport.start(1000,source.timeline.notes,2000);
 const current=now=>guitarGuidanceView({...source,position:transport.time(now),running:transport.running,hasStarted:transport.hasStarted,completed:transport.completed});
 assert.equal(current(1000).phase,'count-in');assert.equal(current(1000).items[0].time,'In 2.2s');
 transport.pause(1500);assert.equal(current(1500).phase,'paused');assert.deepEqual(current(1500),current(9000));
 transport.start(9000,source.timeline.notes,2000);assert.equal(current(9000).items[0].time,'In 1.7s');transport.pause(10700);assert.equal(current(10700).items[0].phase,'sounding');assert.deepEqual(current(10700),current(40000));
 transport.finish(source.timeline.duration_ms);assert.equal(current(50000).phase,'complete');assert.equal(current(50000).items.length,0);
});

test('gaps, an empty selection and the end of upcoming attacks are explicit without guessed beats',()=>{
 const source=expandedFixture();const gap=guitarGuidanceView({...source,position:5000,running:true,hasStarted:true});assert.equal(gap.phase,'rest');assert.equal(gap.items.length,0);assert.match(gap.state,/Rest.*next onset in 5\.0s/);
 const last=guitarGuidanceView({...source,position:10100,running:true,hasStarted:true});assert.equal(last.phase,'sounding');assert.match(last.state,/no upcoming onsets/);assert.equal(last.items[0].time,'Sounding');
 const empty=guitarGuidanceView({index:new TimelineIndex([])});assert.match(empty.state,/no upcoming onsets/);assert.equal(empty.items.length,0);
 assert.equal(guitarGuidanceView({index:null}).phase,'pending');
});

test('dense presentation discloses every additional attack while preserving canonical data and loop-boundary timing',()=>{
 const notes=Array.from({length:37},(_,i)=>({id:`distinct-${i}`,part_id:'dense',midi:64,start_ms:2000,duration_ms:5000,source_note_ids:[`source-${i}`]}));const timeline={notes,duration_ms:9000},before=structuredClone(timeline);
 const view=guitarGuidanceView({index:new TimelineIndex(notes),position:2000,segmentStart:2000,segmentEnd:4000,loopIteration:3});assert.equal(view.items.length,GUITAR_VISIBLE_TARGETS);assert.equal(view.additional,29);assert.equal(new Set(view.items.map(item=>item.id)).size,8);assert.match(view.state,/Loop 3/);assert.equal(view.items[0].durationMs,5000,'A display boundary does not crop the canonical target duration');assert.deepEqual(timeline,before);
 const end=guitarGuidanceView({index:new TimelineIndex(notes),position:4000,segmentStart:4000,segmentEnd:5000,running:true,hasStarted:true});assert.equal(end.items[0].startMs,2000,'A sounding tie is not relabeled as a new boundary onset');
});

test('guitar DOM keeps separate stable cards, full source identities, explicit pending state and no live countdown announcements',async()=>{
 const{document}=parseHTML(await readFile(new URL('../web/index.html',import.meta.url),'utf8')),render=setupGuitarGuidance(document),source=expandedFixture();
 render({...source,position:0,mode:'practice'});const cards=[...document.querySelectorAll('.guitar-target')],first=cards[0];
 assert.equal(document.querySelector('#guitar-guidance').getAttribute('aria-live'),'off');assert.equal(document.querySelector('#guitar-guidance [aria-live]'),null);assert.equal(cards.length,3);
 assert.equal(first.dataset.targetId,'tie@pass1');assert.equal(Number(first.dataset.startMs),500/3);assert.deepEqual(JSON.parse(first.dataset.sourceIds),['tie-head','tie-end']);assert.deepEqual(JSON.parse(first.dataset.occurrenceIds),['tie@pass1']);assert.match(first.textContent,/Lead melody · tied/);assert.doesNotMatch(first.textContent,/tie@pass1/);assert.match(document.querySelector('#guitar-guidance-sources').textContent,/Source notes: tie-head, tie-end/);assert.match(first.getAttribute('aria-description'),/Source notes: tie-head, tie-end/);
 document.querySelector('#guitar-guidance-items').scrollLeft=85;render({...source,position:100,running:true,hasStarted:true,mode:'practice'});assert.equal(document.querySelector('.guitar-target'),first);assert.equal(document.querySelector('#guitar-guidance-items').scrollLeft,85);assert.equal(first.querySelector('.guitar-target-time').textContent,'In 0.1s');
  render({...source,position:3875,running:false,hasStarted:true});assert.deepEqual([...document.querySelectorAll('.guitar-target')].map(item=>item.dataset.targetId),['tie@pass2','unison@pass2']);
  const shifted={...source.timeline,notes:source.timeline.notes.map(note=>({...note,start_ms:note.start_ms+1000}))};render({...source,timeline:shifted,position:0});assert.match(document.querySelector('#guitar-guidance-sources').textContent,/E4 at 1\.167s/,'Recompiled onsets also refresh the source disclosure when IDs and durations are unchanged');
  render({timeline:null});assert.equal(document.querySelectorAll('.guitar-target').length,0);assert.match(document.querySelector('#guitar-guidance-state').textContent,/Waiting/);
  const dense={notes:Array.from({length:12},(_,i)=>({id:`unison-${i}`,part_id:'lead',midi:64,start_ms:0,duration_ms:1000})),duration_ms:1000};render({timeline:dense});assert.equal(document.querySelectorAll('.guitar-target').length,8);assert.equal(document.querySelector('#guitar-guidance-overflow').hidden,false);assert.match(document.querySelector('#guitar-guidance-overflow').textContent,/\+4 more: 4 sounding, 0 upcoming/);assert.equal(dense.notes.length,12);
});

test('long score durations cannot hide every upcoming attack behind the eight-card bound',()=>{
 const notes=Array.from({length:12},(_,i)=>({id:`held-${i}`,part_id:'held',midi:64,start_ms:0,duration_ms:10000}));notes.push(...Array.from({length:8},(_,i)=>({id:`next-${i}`,part_id:'lead',midi:64,start_ms:1200+i*100,duration_ms:100})));
 const before=structuredClone(notes),view=guitarGuidanceView({index:new TimelineIndex(notes),position:1000,running:true,hasStarted:true});
 assert.deepEqual(view.items.map(item=>item.id),['held-0','held-1','next-0','next-1','next-2','next-3','next-4','next-5']);assert.equal(view.additional,12);assert.equal(view.additionalSounding,10);assert.equal(view.additionalUpcoming,2);assert.deepEqual(notes,before);
});

test('a sustained loop-boundary note keeps its original onset and is labeled as continuing during count-in',()=>{
 const notes=[{id:'held-tie',source_note_ids:['tie-a','tie-b'],part_id:'lead',midi:60,start_ms:500,duration_ms:3500},{id:'next',part_id:'lead',midi:64,start_ms:2250,duration_ms:250}];
 const view=guitarGuidanceView({index:new TimelineIndex(notes),segmentStart:2000,segmentEnd:4000,position:1000,running:true,hasStarted:true,loopIteration:2});assert.equal(view.items[0].phase,'continuing');assert.equal(view.items[0].time,'Continues in 1.0s');assert.equal(view.items[0].onset,'At 0.500s');assert.equal(view.items[0].durationMs,3500);assert.equal(view.items[1].time,'In 1.3s');assert.match(view.state,/next onset in 1\.3s/);
});

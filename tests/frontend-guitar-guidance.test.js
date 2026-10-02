import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseHTML} from 'linkedom';
import {guitarGuidanceView,setupGuitarGuidance} from '../web/guitar-guidance.js';
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
 const source=expandedFixture();const gap=guitarGuidanceView({...source,position:5000,running:true,hasStarted:true});assert.equal(gap.phase,'rest');assert.equal(gap.items.length,1);assert.equal(gap.nextItems[0].id,'after-rest');assert.equal(gap.nextOnsetMs,10000);assert.match(gap.state,/Rest.*next onset in 5\.0s/);
 const last=guitarGuidanceView({...source,position:10100,running:true,hasStarted:true});assert.equal(last.phase,'sounding');assert.match(last.state,/no upcoming onsets/);assert.equal(last.items[0].time,'Sounding');
 const empty=guitarGuidanceView({index:new TimelineIndex([])});assert.match(empty.state,/no upcoming onsets/);assert.equal(empty.items.length,0);
 assert.equal(guitarGuidanceView({index:null}).phase,'pending');
});

test('every dense current group remains complete while preserving canonical data and loop-boundary timing',()=>{
 const notes=Array.from({length:37},(_,i)=>({id:`distinct-${i}`,part_id:'dense',midi:64,start_ms:2000,duration_ms:5000,source_note_ids:[`source-${i}`]}));const timeline={notes,duration_ms:9000},before=structuredClone(timeline);
 const view=guitarGuidanceView({index:new TimelineIndex(notes),position:2000,segmentStart:2000,segmentEnd:4000,loopIteration:3});assert.equal(view.items.length,37);assert.equal(view.currentItems.length,37);assert.equal(view.additional,0);assert.equal(new Set(view.items.map(item=>item.id)).size,37);assert.match(view.state,/Loop 3/);assert.equal(view.items[0].durationMs,5000,'A display boundary does not crop the canonical target duration');assert.deepEqual(timeline,before);
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
  const dense={notes:Array.from({length:12},(_,i)=>({id:`unison-${i}`,part_id:'lead',midi:64,start_ms:0,duration_ms:1000})),duration_ms:1000};render({timeline:dense});assert.equal(document.querySelectorAll('.guitar-target').length,12);assert.equal(document.querySelector('#guitar-guidance-overflow').hidden,true);assert.equal(dense.notes.length,12);
});

test('long score durations preserve all held targets and the next onset; only later details are bounded',()=>{
 const notes=Array.from({length:12},(_,i)=>({id:`held-${i}`,part_id:'held',midi:64,start_ms:0,duration_ms:10000}));notes.push(...Array.from({length:8},(_,i)=>({id:`next-${i}`,part_id:'lead',midi:64,start_ms:1200+i*100,duration_ms:100})));
 const before=structuredClone(notes),view=guitarGuidanceView({index:new TimelineIndex(notes),position:1000,running:true,hasStarted:true});
 assert.deepEqual(view.items.map(item=>item.id),[...notes.slice(0,12).map(note=>note.id),'next-0']);assert.equal(view.currentItems.length,12);assert.equal(view.nextItems.length,1);assert.equal(view.additional,7);assert.equal(view.additionalSounding,0);assert.equal(view.additionalUpcoming,7);assert.deepEqual(notes,before);
});

test('a sustained loop-boundary note keeps its original onset and is labeled as continuing during count-in',()=>{
 const notes=[{id:'held-tie',source_note_ids:['tie-a','tie-b'],part_id:'lead',midi:60,start_ms:500,duration_ms:3500},{id:'next',part_id:'lead',midi:64,start_ms:2250,duration_ms:250}];
 const view=guitarGuidanceView({index:new TimelineIndex(notes),segmentStart:2000,segmentEnd:4000,position:1000,running:true,hasStarted:true,loopIteration:2});assert.equal(view.items[0].phase,'continuing');assert.equal(view.items[0].time,'Continues in 1.0s');assert.equal(view.items[0].onset,'At 0.500s');assert.equal(view.items[0].durationMs,3500);assert.equal(view.items[1].time,'In 1.3s');assert.match(view.state,/next onset in 1\.3s/);
});

function routeFixture({strings=6,capo=0}={}){
 const profile={kind:'guitar',tuning:Array.from({length:strings},(_,i)=>64-i*4),frets:36,capo};
 const notes=[...Array.from({length:strings},(_,i)=>({id:`held-${i}@pass1`,part_id:'guitar',midi:profile.tuning[i]+capo+2,start_ms:0,duration_ms:900,source_note_ids:[`held-source-${i}`]})),...Array.from({length:strings},(_,i)=>({id:`next-${i}@pass1`,part_id:'guitar',midi:profile.tuning[i]+capo+5,start_ms:1000,duration_ms:500,source_note_ids:[`next-source-${i}`]}))];
 const plan={status:'ready',profile,assignments:notes.map((note,i)=>({...note,occurrence_id:note.id,string:i%strings+1,fret:i<strings?2:5,finger:i<strings?1:3,end_ms:note.start_ms+note.duration_ms,picking_hint:'simultaneous_pluck_review'}))};
 return{profile,timeline:{notes,duration_ms:1500},index:new TimelineIndex(notes),plan};
}

test('six held strings plus six next attacks are complete; exact release/attack endpoints are never a cap or overlap',()=>{
 const source=routeFixture(),before=structuredClone(source.timeline),planBefore=structuredClone(source.plan),view=guitarGuidanceView({...source,position:500,running:true,hasStarted:true});
 assert.equal(view.items.length,12);assert.equal(view.currentItems.length,6);assert.equal(view.nextItems.length,6);assert.equal(view.currentChoices.length,6);assert.equal(view.nextChoices.length,6);assert.equal(view.additional,0);assert.equal(view.nextOnsetMs,1000);assert.equal(view.releaseChoices.length,6);assert.equal(view.retainedChoices.length,0);
 assert.deepEqual(view.currentChoices.map(choice=>[choice.string,choice.fret,choice.finger,choice.source_note_ids]),source.plan.assignments.slice(0,6).map(choice=>[choice.string,choice.fret,choice.finger,choice.source_note_ids]));
 const rest=guitarGuidanceView({...source,position:900,running:true,hasStarted:true});assert.equal(rest.currentChoices.length,0);assert.equal(rest.nextChoices.length,6);assert.equal(rest.phase,'rest');
 const attack=guitarGuidanceView({...source,position:1000,running:true,hasStarted:true});assert.equal(attack.currentChoices.length,6);assert.equal(attack.nextChoices.length,0);assert.equal(attack.nextOnsetMs,null);assert.deepEqual(source.timeline,before);assert.deepEqual(source.plan,planBefore);
});

test('staggered score releases and a tied hold form a complete next shape without inventing repeat or loop attacks',()=>{
 const source=routeFixture(),notes=source.timeline.notes;
 notes.splice(6,1);notes[0].duration_ms=1400;notes[0].source_note_ids=['tie-head','tie-tail'];notes[1].duration_ms=700;notes[2].duration_ms=1000;
 source.index=new TimelineIndex(notes);source.plan.assignments=source.plan.assignments.filter(choice=>choice.occurrence_id!=='next-0@pass1').map(choice=>{const note=notes.find(note=>note.id===choice.occurrence_id);return{...choice,end_ms:note.start_ms+note.duration_ms,source_note_ids:note.source_note_ids};});
 const view=guitarGuidanceView({...source,position:500,segmentStart:250,segmentEnd:1300,running:true,hasStarted:true,loopIteration:2});
 assert.deepEqual(view.retainedChoices.map(choice=>choice.occurrence_id),['held-0@pass1']);assert.equal(view.nextChoices.length,5);assert.equal(view.nextShapeItems.flatMap(item=>item.choices).length,6);assert.deepEqual(view.releaseChoices.map(choice=>choice.end_ms),[700,1000,900,900,900]);
 assert.deepEqual(view.nextShapeItems[0].sourceIds,['tie-head','tie-tail']);assert.equal(view.nextShapeItems[0].phase,'held');assert.equal(view.nextShapeItems[0].startMs,0);
 const countIn=guitarGuidanceView({...source,position:-5000,segmentStart:250,segmentEnd:1300,running:true,hasStarted:true});assert.equal(countIn.currentChoices.length,6,'Boundary holds remain visible even when count-in exceeds lookahead');assert.equal(countIn.currentItems[0].phase,'continuing');assert.equal(countIn.nextOnsetMs,1000);
 const exactEnd=guitarGuidanceView({...source,position:1000,segmentStart:1000,segmentEnd:1300,running:true,hasStarted:true});assert.equal(exactEnd.currentChoices.length,6);assert.equal(exactEnd.currentChoices.some(choice=>choice.occurrence_id==='held-2@pass1'),false,'Release at the onset is not a retained hold');assert.equal(exactEnd.currentChoices[0].start_ms,0,'Tie keeps its source onset');
 const outside=guitarGuidanceView({...source,position:500,segmentStart:250,segmentEnd:1000});assert.equal(outside.nextNotes.length,0,'Onset at the loop end is outside this pass');assert.equal(outside.currentChoices[0].end_ms,1400,'Original score release is not cropped to the loop end');
});

test('grouped-unison source mapping survives while individually ended assignments leave the hand',()=>{
 const profile={kind:'guitar',tuning:[64,59],capo:0,frets:12},target={id:'physical-unison',midi:64,part_id:'lead',start_ms:0,duration_ms:2000,source_note_ids:['long','short']},next={id:'later',midi:66,part_id:'lead',start_ms:1500,duration_ms:500,source_note_ids:['later']};
 const groups=new Map([[target.id,{source_note_ids:['long','short'],source_occurrence_ids:['long-occ','short-occ'],part_ids:['lead']}]]);
 const assignments=[{occurrence_id:'long-occ',source_note_ids:['long'],midi:64,string:1,fret:0,finger:0,start_ms:0,end_ms:2000},{occurrence_id:'short-occ',source_note_ids:['short'],midi:64,string:2,fret:5,finger:4,start_ms:0,end_ms:500},{occurrence_id:'later',source_note_ids:['later'],midi:66,string:2,fret:7,finger:4,start_ms:1500,end_ms:2000}];
 const view=guitarGuidanceView({index:new TimelineIndex([target,next]),groups,plan:{status:'ready',profile,assignments},position:1000});
 assert.deepEqual(view.currentItems[0].sourceIds,['long','short']);assert.deepEqual(view.currentItems[0].occurrenceIds,['long-occ','short-occ']);assert.deepEqual(view.currentChoices.map(choice=>choice.occurrence_id),['long-occ']);assert.deepEqual(view.retainedChoices.map(choice=>choice.occurrence_id),['long-occ']);assert.equal(view.nextShapeItems.flatMap(item=>item.choices).length,2);
});

test('live matrix renders all current and next positions with non-color labels, exact identities and no dependence on input board scroll',async()=>{
 const{document}=parseHTML(await readFile(new URL('../web/index.html',import.meta.url),'utf8')),render=setupGuitarGuidance(document),source=routeFixture({capo:2});
 render({...source,position:500,running:true,hasStarted:true});
 const live=document.getElementById('guitar-live-route'),markers=[...live.querySelectorAll('.guitar-live-choice')];assert.equal(markers.length,12);assert.equal(live.dataset.currentCount,'6');assert.equal(live.dataset.nextCount,'6');assert.equal(live.dataset.stringCount,'6');assert.equal(live.dataset.nextOnsetMs,'1000');assert.equal(live.querySelector('.guitar-live-current .guitar-live-row-label').textContent,'Now');assert.equal(live.querySelector('.guitar-live-next .guitar-live-row-label').textContent,'Next');
 assert.equal(live.querySelectorAll('.guitar-live-current [data-action=release]').length,6);assert.equal(live.querySelectorAll('.guitar-live-next [data-action=new]').length,6);
 for(const marker of markers){const choice=source.plan.assignments.find(choice=>choice.occurrence_id===marker.dataset.occurrenceId);assert.deepEqual([Number(marker.dataset.string),Number(marker.dataset.fret),Number(marker.dataset.finger)],[choice.string,choice.fret,choice.finger]);assert.deepEqual(JSON.parse(marker.dataset.sourceIds),choice.source_note_ids);assert.equal(Number(marker.dataset.endMs),choice.end_ms);assert.match(marker.getAttribute('aria-label'),/Score guidance only; pitch input cannot verify/);assert.equal(marker.closest('details,.guitar-scroll,#fretboard'),null);}
 assert.match(live.textContent,/capo 2/);assert.match(live.textContent,/Chosen frets 2 → 5/);assert.equal(document.querySelector('#guitar-guidance-items').closest('details'),document.querySelector('.guitar-details'));
 const first=markers[0];document.querySelector('.guitar-scroll').scrollTop=150;render({...source,position:600,running:true,hasStarted:true});assert.equal(live.querySelector('.guitar-live-choice'),first,'Countdown ticks do not replace route markers');
 render({...source,position:600,running:false,hasStarted:true});assert.equal(live.querySelectorAll('.guitar-live-choice').length,12);assert.match(document.getElementById('guitar-guidance-state').textContent,/Paused/);
 render({...source,position:1500,completed:true});assert.equal(live.querySelectorAll('.guitar-live-choice').length,0);
 render({...source,position:0});assert.equal(live.querySelectorAll('.guitar-live-choice').length,12,'Reset immediately restores the entry and next groups');
 render({...source,plan:null});assert.equal(live.querySelectorAll('.guitar-live-choice').length,0);assert.equal(document.querySelectorAll('.guitar-target').length,12,'An unavailable route never discards the pitches');
});

test('custom one through twelve string profiles and first/last capo-relative frets have complete DOM bands',async()=>{
 for(const strings of [1,5,6,7,12]){
  const{document}=parseHTML(await readFile(new URL('../web/index.html',import.meta.url),'utf8')),render=setupGuitarGuidance(document),source=routeFixture({strings,capo:2});
  source.plan.assignments[0].fret=0;source.plan.assignments[0].finger=0;source.plan.assignments.at(-1).fret=34;
  render({...source,position:500});const live=document.getElementById('guitar-live-route');assert.equal(live.querySelectorAll('.guitar-live-band').length,Math.ceil(strings/6));assert.equal(live.querySelectorAll('.guitar-live-choice').length,strings*2);assert.deepEqual([...live.querySelectorAll('.guitar-live-current .guitar-live-cell')].map(cell=>Number(cell.dataset.string)),Array.from({length:strings},(_,i)=>i+1));assert.match(live.querySelector('.guitar-live-current .guitar-live-position').textContent,/0 \/ 0/);assert.equal(live.querySelectorAll('[data-fret="34"]').length,1);
 }
});

test('live-route CSS removes old card clipping and uses content-sized complete-string rows',async()=>{
 // Source/DOM layout contracts, not a substitute for hosted browser geometry.
 const css=await readFile(new URL('../web/guitar-live-guidance.css',import.meta.url),'utf8'),{document}=parseHTML(`<style>${css}</style>`),rules=[...document.querySelector('style').sheet.cssRules];
 const rule=rules.find(rule=>rule.selectorText==='.performance-layout #guitar-guidance,.performance-layout #workspace.with-notation #guitar-guidance');assert.equal(rule.style['max-height'],'none');assert.equal(rule.style.overflow,'visible');assert.equal(rule.style.flex,'none');
 const row=rules.find(rule=>rule.selectorText==='.guitar-live-row');assert.equal(row.style['grid-template-columns'],'42px repeat(var(--guitar-route-strings),minmax(0,1fr))');
 for(const rule of rules.filter(rule=>rule.selectorText?.includes('.guitar-live-'))){assert.equal(rule.style.getPropertyValue('text-overflow'),'');assert.equal(rule.style.getPropertyValue('-webkit-line-clamp'),'');assert.notEqual(rule.style.overflow,'hidden');assert.notEqual(rule.style.display,'none');}
});

test('a duplicate shown position consolidates its marker while retaining every source and occurrence identity',async()=>{
 const{document}=parseHTML(await readFile(new URL('../web/index.html',import.meta.url),'utf8')),render=setupGuitarGuidance(document),source=routeFixture({strings:1});
 const first=source.timeline.notes[0],duplicate={...first,id:'other-source-occurrence',source_note_ids:['<other-source>']};source.timeline.notes.splice(1,0,duplicate);source.plan.assignments.splice(1,0,{...source.plan.assignments[0],occurrence_id:duplicate.id,source_note_ids:duplicate.source_note_ids});
 render({...source,position:500});const current=document.querySelectorAll('.guitar-live-current .guitar-live-choice');assert.equal(current.length,1);assert.deepEqual(JSON.parse(current[0].dataset.occurrenceIds),[first.id,duplicate.id]);assert.deepEqual(JSON.parse(current[0].dataset.sourceIds),[...first.source_note_ids,...duplicate.source_note_ids]);assert.equal(JSON.parse(current[0].dataset.assignments).length,2);assert.match(current[0].getAttribute('aria-label'),/other-source-occurrence/);assert.equal(document.querySelector('other-source'),null);assert.equal(document.querySelectorAll('.guitar-target').length,3);
});

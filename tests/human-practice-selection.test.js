import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolvePracticeSelection,humanPracticePartIds} from '../web/practice-selection.js';
import {practiceScope} from '../web/practice-settings.js';
import {resolveNotationScope} from '../web/notation-scope.js';
import {referencePreviewBudget} from '../web/basic-key-rendition.js';
import {buildBasicKeyAudioPlan} from '../web/basic-key-audio-plan.js';
import {buildVsqAudioPlan} from '../web/vsq-audio-plan.js';
import {prepareCleanSong,prepareVsqPractice} from '../web/clean-song-package.js';
import {validateTargetPlan} from '../web/physical-targets.js';
import {basicKeySong} from './basic-key-rendition-fixtures.js';

const parts=Array.from({length:6},(_,index)=>({id:`original-part-${index+1}`}));
const timeline={duration_ms:2000,notes:parts.flatMap((part,index)=>[{id:`original-${index+1}`,part_id:part.id,midi:48+index,start_ms:0,duration_ms:1000},{id:`later-${index+1}`,part_id:part.id,midi:60+index,start_ms:1500,duration_ms:500}])};
const fixture=name=>JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`,import.meta.url)));
const vsqSong=()=>{const opened=fixture('vsq-clean-v1-native-open'),descriptor=opened.clean_package;return prepareVsqPractice(prepareCleanSong(`native:song-${descriptor.content_sha256}`,descriptor,JSON.parse(opened.score_json)),fixture('vsq-clean-v1-runtime'));};

test('explicit all and one-or-many parts retain canonical source order and cannot masquerade as a default',()=>{
  assert.deepEqual(resolvePracticeSelection(parts,{kind:'all'}),{kind:'all',part_ids:parts.map(part=>part.id)});
  assert.deepEqual(resolvePracticeSelection(parts,{kind:'parts',part_ids:[parts[4].id,parts[0].id]}),{kind:'parts',part_ids:[parts[0].id,parts[4].id]});
  for(const selection of [undefined,null,{kind:'parts',part_ids:[]},{kind:'parts',part_ids:['missing']},{kind:'parts',part_ids:[parts[0].id,parts[0].id]},{kind:'all',part_ids:[parts[0].id]},{kind:'part',part_id:parts[0].id}])assert.throws(()=>resolvePracticeSelection(parts,selection),{code:'clean_target_required'});
  assert.throws(()=>humanPracticePartIds(parts,{mode:'practice'}),{code:'clean_target_required'});
  assert.deepEqual([...humanPracticePartIds(parts,{targetPart:parts[0].id})],[parts[0].id]);
  assert.deepEqual([...humanPracticePartIds(parts,{mode:'listen',practiceSelection:{kind:'all'}})],[]);
  assert.deepEqual(resolvePracticeSelection([{id:'all'},{id:'parts'}],{kind:'parts',part_ids:['all']}).part_ids,['all']);
});

test('human set drives scoring and current notation while visibility and accompaniment controls cannot remove targets',()=>{
  const before=JSON.stringify(timeline),selection=resolvePracticeSelection(parts,{kind:'parts',part_ids:[parts[4].id,parts[0].id]});
  const selected=practiceScope(timeline,selection),expected=['original-1','later-1','original-5','later-5'];
  assert.deepEqual(selected.targets.notes.map(note=>note.id),expected);assert.equal(selected.targets.duration_ms,2000);
  assert.ok(selected.targets.notes.every(note=>timeline.notes.includes(note)),'Source objects and durations are retained');
  assert.deepEqual(resolveNotationScope({parts,scope:'current',practiceSelection:selection,mutedParts:[parts[0].id],showAccompaniment:false}).partIds,selection.part_ids);
  assert.deepEqual(resolveNotationScope({parts,scope:'all',practiceSelection:selection}).partIds,parts.map(part=>part.id));
  const all=resolvePracticeSelection(parts,{kind:'all'});assert.deepEqual(practiceScope(timeline,all).targets.notes,timeline.notes);
  assert.deepEqual(resolveNotationScope({parts,scope:'current',practiceSelection:all}).partIds,all.part_ids);
  assert.equal(resolveNotationScope({parts,scope:'current'}).status,'choose_current_part');
  const loop={start_ms:500,end_ms:2000,target_note_ids:timeline.notes.filter(note=>note.start_ms===1500).map(note=>note.id)};
  assert.deepEqual(practiceScope(timeline,selection,loop).targets.notes.map(note=>note.id),['later-1','later-5']);
  assert.equal(JSON.stringify(timeline),before);
});

for(const [name,make,build] of [['Basic MIDI',basicKeySong,buildBasicKeyAudioPlan],['chosen VSQ',vsqSong,buildVsqAudioPlan]])test(`${name} all human parts produce silent accompaniment with the full clock and multi-part exclusion retains exact source identities`,()=>{
  const song=make(),before=JSON.stringify(song),inventory=song.compilation.score.parts,full=build(song,{sampleRate:48000});
  const all=resolvePracticeSelection(inventory,{kind:'all'}),silent=build(song,{sampleRate:48000,mode:'practice',practiceSelection:all,soloParts:[inventory[0].id]});
  assert.equal(silent.notes.length,0);assert.equal(silent.sourceNotes,song.compilation.timeline.notes.length);assert.equal(silent.durationFrames,full.durationFrames);assert.equal(silent.sourceSha256,full.sourceSha256);
  const selection=resolvePracticeSelection(inventory,{kind:'parts',part_ids:inventory.slice(0,2).map(part=>part.id)}),partial=build(song,{sampleRate:48000,mode:'practice',practiceSelection:selection});
  const machineIds=new Set(song.compilation.timeline.notes.filter(note=>!selection.part_ids.includes(note.part_id)).map(note=>note.id));
  assert.deepEqual(partial.notes,full.notes.filter(row=>machineIds.has(row[0])));
  assert.equal(referencePreviewBudget(song.compilation.timeline.notes,all,song.runtime.rendition),0);
  assert.deepEqual(build(song,{sampleRate:48000,mode:'listen',practiceSelection:all}),full,'Listening ignores human ownership');
  assert.throws(()=>build(song,{sampleRate:48000,mode:'practice'}),{code:'clean_target_required'});
  assert.throws(()=>build(song,{sampleRate:48000,mode:'practice',practiceSelection:{kind:'parts',part_ids:['missing']}}),{code:'clean_target_required'});
  assert.equal(JSON.stringify(song),before);
});

test('all-human exclusion never skips Basic MIDI source gate and identity validation',()=>{
  for(const mutate of [song=>song.runtime.rendition.notes[0][7][0]='0',song=>song.runtime.rendition.notes[0][5]='unknown',song=>song.compilation.timeline.notes[0].duration_ms++,song=>song.compilation.timeline.notes[0].part_id='missing',song=>song.compilation.timeline.notes[0].source_note_ids=['replacement']]){
    const song=structuredClone(basicKeySong());mutate(song);assert.throws(()=>buildBasicKeyAudioPlan(song,{sampleRate:48000,mode:'practice',practiceSelection:{kind:'all'}}),{code:'invalid_audio_plan'});
  }
});

test('all-human exclusion never skips chosen VSQ native gate validation',()=>{
  const opened=fixture('vsq-clean-v1-native-open'),descriptor=opened.clean_package,response=fixture('vsq-clean-v1-runtime');response.runtime.notes[0].start_microseconds.numerator='1';
  const song=prepareVsqPractice(prepareCleanSong(`native:song-${descriptor.content_sha256}`,descriptor,JSON.parse(opened.score_json)),response);
  assert.throws(()=>buildVsqAudioPlan(song,{sampleRate:48000,mode:'practice',practiceSelection:{kind:'all'}}),{code:'invalid_audio_plan'});
});

test('physical target validation retains representative identity, all sources and source-derived velocity',()=>{
  const a={id:'a',source_note_id:'a',source_note_ids:['a'],part_id:'one',voice:'1',staff:1,midi:60,velocity:70,start_ms:0,duration_ms:1000};
  const b={...a,id:'b',source_note_id:'b',source_note_ids:['b'],part_id:'two',velocity:90,duration_ms:500};
  const source={duration_ms:1000,notes:[b,a]},plan={source_note_count:2,target_count:1,playable:true,diagnostics:[],timeline:{duration_ms:1000,notes:[{...a,velocity:90,source_note_ids:['a','b']}]},groups:[{target_id:'a',source_occurrence_ids:['a','b'],source_note_ids:['a','b'],part_ids:['one','two']}]};
  assert.equal(validateTargetPlan(plan,source),plan);
  for(const mutate of [p=>p.timeline.notes[0].source_note_ids=['a'],p=>p.timeline.notes[0].source_note_id='b',p=>p.timeline.notes[0].part_id='two',p=>p.timeline.notes[0].voice='2',p=>p.timeline.notes[0].velocity=127,p=>p.groups[0].part_ids.push('one'),p=>{p.timeline.notes[0].id='fabricated';p.groups[0].target_id='fabricated';}]){const bad=structuredClone(plan);mutate(bad);assert.throws(()=>validateTargetPlan(bad,source),/physical target plan/);}
});

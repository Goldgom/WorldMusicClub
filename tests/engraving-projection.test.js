import {readFileSync} from 'node:fs';
import {prepareCleanSong} from '../web/clean-song-package.js';
import {basicKeyNotationPage,basicKeyEngravingIdentity} from '../web/basic-key-notation.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {DOMParser,parseHTML} from 'linkedom';
import {validateEngravingInput, renderEngravedStaff, ENGRAVING_LIMITS} from '../web/engraving.js';
import {createEngravingProjection, validateEngravingProjectionModel, ENGRAVING_SOURCE_LIMITS} from '../web/engraving-projection.js';
import {matchEngravingModel,validateEngravingModelTies,restoreSourceBoundPageTies} from '../web/engraving-note-map.js';
import {resolveEngravingTieContext} from '../web/engraving-tie-context.js';
import {createI18n} from '../web/i18n.js';

class XmlParser extends DOMParser {
  parseFromString(source, type) {
    const document = super.parseFromString(source, type), find = document.getElementsByTagName.bind(document);
    document.getElementsByTagName = name => name === '*' ? document.querySelectorAll('*') : find(name);
    for (const element of document.querySelectorAll('*')) Object.defineProperty(element, 'namespaceURI', {value: null});
    return document;
  }
}
const beat = (numerator, denominator = 1) => ({numerator, denominator});
// Original repeated C/D/F/G test pulses, not an imported melody.
function synthetic({measures = 72, parts = 2, highRatio = false, emptyIndex = -1} = {}) {
  const score = {parts: [], measures: []}, segments = [], voiceIdMap = [], partIdMap = {}, xmlParts = [];
  let start = 0;
  for (let index = 0; index < measures; index++) { const length = index ? 1920 : 480; score.measures.push({number: index === 35 ? 7 : index + 1, at: beat(start, 480), length: beat(length, 480)}); start += length; }
  for (let p = 0; p < parts; p++) {
    const part = {id: `part-${p}`, notes: []}, xmlId = `P${p+1}`; score.parts.push(part); partIdMap[part.id] = xmlId;
    const xmlMeasures = [];
    for (const voice of ['1', '2']) voiceIdMap.push({part_id: part.id, staff: Number(voice), voice, lane: 1, xml_voice: voice});
    for (let index = 0; index < measures; index++) {
      const measure = score.measures[index], length = measure.length.numerator, contents = [];
      if (!index) contents.push('<attributes><divisions>480</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes>');
      if (index === 33) contents.push('<attributes><key><fifths>2</fifths></key><clef number="1"><sign>F</sign><line>4</line></clef></attributes>');
      if (index === 50) contents.push('<attributes><time><beats>2</beats><beat-type>2</beat-type></time></attributes>');
      if (index === emptyIndex) {contents.push(`<forward><duration>${length}</duration></forward>`);}
      else for (let voice = 1; voice <= 2; voice++) {
        let cursor = 0;
        for (let n = 0; n < length / 240; n++) {
          const at = n * 240 + (voice === 2 ? 60 : 0), duration = highRatio && voice === 1 && n === 0 ? 227 : 120;
          if (at > cursor) contents.push(`<forward><duration>${at-cursor}</duration><voice>${voice}</voice><staff>${voice}</staff></forward>`);
          const id = `source-${p}-${index}-${voice}-${n}`, xmlNote = `N${p}_${index}_${voice}_${n}`, pitch = {step: voice === 1 ? (n%2 ? 'D' : 'C') : (n%2 ? 'G' : 'F'), alter: 0, octave: voice === 1 ? 4 : 3};
          const note = {id, staff: voice, voice: String(voice), at: beat(measure.at.numerator + at, 480), duration: beat(duration, 480), pitch, tie_start: false, tie_stop: false}; part.notes.push(note);
          segments.push({xml_note_id: xmlNote, source_note_id: id, part_id: part.id, xml_part_id: xmlId, source_measure_index: index, measure_number: measure.number, staff: voice, voice: String(voice), lane: 1, xml_voice: String(voice), at: note.at, measure_at: beat(at, 480), duration: note.duration, pitch, tie_start: false, tie_stop: false, chord: false});
          const rhythm = duration === 227 ? '<type>eighth</type><time-modification><actual-notes>240</actual-notes><normal-notes>227</normal-notes><normal-type>eighth</normal-type></time-modification>' : '<type>16th</type>';
          contents.push(`<note id="${xmlNote}"><pitch><step>${pitch.step}</step><octave>${pitch.octave}</octave></pitch><duration>${duration}</duration><voice>${voice}</voice>${rhythm}<staff>${voice}</staff></note>`); cursor = at + duration;
        }
        if (voice === 1) contents.push(`<backup><duration>${cursor}</duration></backup>`);
        else contents.push(`<forward><duration>${length-cursor}</duration></forward>`);
      }
      xmlMeasures.push(`<measure number="${measure.number}"${index ? '' : ' implicit="yes"'}>${contents.join('')}</measure>`);
    }
    xmlParts.push(`<part id="${xmlId}">${xmlMeasures.join('')}</part>`);
  }
  const xml = `<score-partwise version="4.0"><part-list>${score.parts.map((_, index) => `<score-part id="P${index+1}"><part-name>Original timing fixture ${index+1}</part-name></score-part>`).join('')}</part-list>${xmlParts.join('')}</score-partwise>`;
  return {xml, identity: {score, noteMap: {version: 1, segments}, partIdMap, voiceIdMap}};
}
function project(spec, options = {}) {
  const checked = validateEngravingInput(spec.xml, {...options, identity: spec.identity}, XmlParser);
  assert.equal(checked.ok, true, checked.message); assert.equal(checked.identity.ok, true, JSON.stringify(checked.identity.diagnostics));
  const projection = createEngravingProjection(checked.document, checked.identity, checked.options, ENGRAVING_LIMITS);
  return {checked, projection};
}
function read(projection) {
  const previousSelf = globalThis.self, previousNode = globalThis.Node;
  try {
    globalThis.self = globalThis; globalThis.Node = projection.document.defaultView.Node;
    const osmd = createRequire(import.meta.url)('opensheetmusicdisplay');
    return new osmd.MusicSheetReader([], new osmd.EngravingRules()).createMusicSheet(new osmd.IXmlElement(projection.document.documentElement), 'original-bounded-projection');
  } finally {
    if (previousSelf === undefined) delete globalThis.self; else globalThis.self = previousSelf;
    if (previousNode === undefined) delete globalThis.Node; else globalThis.Node = previousNode;
  }
}
function wholeEquals(fraction, numerator, denominator) {
  assert.equal((BigInt(fraction.WholeValue) * BigInt(fraction.Denominator) + BigInt(fraction.Numerator)) * BigInt(denominator), BigInt(numerator) * BigInt(fraction.Denominator));
}

test('large complete sources project bounded later pages with original ordinals, IDs and inherited state', () => {
  const spec = synthetic(), before = JSON.stringify(spec), {checked, projection} = project(spec, {fromMeasure: 65, toMeasure: 72, partIds: ['P2']});
  assert.equal(checked.metadata.noteCount, 2280); assert.equal(ENGRAVING_LIMITS.notes, 2000); assert.equal(ENGRAVING_SOURCE_LIMITS.notes, 8192);
  assert.equal(projection.ok, true); assert.ok(projection.noteCount < 2000); assert.ok(projection.paddingNoteCount > 0);
  assert.deepEqual(projection.sourceMeasureIndices, [64,65,66,67,68,69,70,71]);
  assert.equal(projection.document.querySelectorAll('part').length, 1); assert.equal(projection.document.querySelectorAll('score-part').length, 1); assert.equal(projection.document.querySelectorAll('measure').length, 8);
  const first = projection.document.querySelector('measure');
  assert.equal(first.querySelector('divisions').textContent, '480'); assert.equal(first.querySelector('fifths').textContent, '2'); assert.equal(first.querySelector('beats').textContent, '2'); assert.equal(first.querySelector('beat-type').textContent, '2'); assert.equal(first.querySelector('clef').querySelector('sign').textContent, 'F');
  const visibleIds = [...projection.document.querySelectorAll('note')].filter(node => node.getAttribute('print-object') !== 'no').map(node => node.getAttribute('id'));
  assert.deepEqual(visibleIds, spec.identity.noteMap.segments.filter(s => s.xml_part_id === 'P2' && s.source_measure_index >= 64).map(s => s.xml_note_id));
  for (const node of projection.document.querySelectorAll('note[print-object="no"]')) {assert.equal(node.getAttribute('id'), null); assert.ok(node.querySelector('rest'));}
  assert.equal(JSON.stringify(spec), before); assert.equal(checked.document.querySelectorAll('part').length, 2); assert.equal(checked.document.querySelectorAll('note[print-object="no"]').length, 0);
});

test('pinned reader keeps pickup, all lanes, gaps, empty bars and later-page clocks exact', () => {
  const spec = synthetic({highRatio: true, emptyIndex: 67});
  for (const options of [{fromMeasure:1,toMeasure:8},{fromMeasure:65,toMeasure:72},{fromMeasure:65,toMeasure:72,partIds:['P2']}]) {
    const {checked, projection} = project(spec, options); assert.equal(projection.ok, true);
    const sheet = read(projection), base = spec.identity.score.measures[projection.sourceMeasureIndices[0]].at.numerator;
    assert.equal(sheet.SourceMeasures.length, projection.sourceMeasureIndices.length);
    assert.deepEqual(validateEngravingProjectionModel(sheet, projection, spec.identity.score, ENGRAVING_LIMITS), {ok:true});
    for (let local = 0; local < sheet.SourceMeasures.length; local++) {
      const model = sheet.SourceMeasures[local], source = spec.identity.score.measures[projection.sourceMeasureIndices[local]];
      wholeEquals(model.Duration, source.length.numerator, 1920); wholeEquals(model.AbsoluteTimestamp, source.at.numerator-base, 1920);
    }
    // OSMD 2.1.3 compares implicit-bar Fraction objects by reference across
    // instruments. Equal pickup durations can get one false warning per staff
    // of the second instrument. Exact clock assertions above remain mandatory.
    const errors = sheet.SheetErrors.measureErrors || {};
    for (const [index, messages] of Object.entries(errors)) if (options.fromMeasure !== 1 || Number(index) !== 0) assert.deepEqual(messages, []);
    if (options.fromMeasure === 1) assert.ok((errors[0] || []).every(message => message === "Given Notes don't correspond to measure duration."));
    const matched = matchEngravingModel({Sheet: sheet}, {...checked.identity, projection});
    assert.equal(matched.ok, true); assert.deepEqual(matched.diagnostics, []);
    assert.equal(matched.matches.length, checked.metadata.noteCount);
    const selected = spec.identity.noteMap.segments.filter(s => projection.partIds.includes(s.xml_part_id) && projection.sourceMeasureIndices.includes(s.source_measure_index));
    assert.equal(matched.matches.filter(m => m.note).length, selected.length);
    assert.ok(matched.matches.filter(m => m.note).every(m => m.note.PrintObject === true));
    assert.ok(matched.matches.filter(m => !m.note).every(m => m.reason === 'not-displayed'));
  }
});

test('full-source validation cannot be bypassed through a small selected page or part', () => {
  const spec = synthetic();
  assert.equal(validateEngravingInput(spec.xml, {fromMeasure:65,toMeasure:72}, XmlParser).code, 'engraving_notes');
  const missing = structuredClone(spec); missing.identity.noteMap.segments.shift();
  assert.equal(validateEngravingInput(missing.xml, {identity:missing.identity,fromMeasure:65,toMeasure:72,partIds:['P2']}, XmlParser).code, 'engraving_sourceMap');
  const changed = structuredClone(spec); changed.identity.score.parts[0].notes[0].duration.numerator++;
  assert.equal(validateEngravingInput(changed.xml, {identity:changed.identity,fromMeasure:65,toMeasure:72,partIds:['P2']}, XmlParser).code, 'engraving_sourceMap');
  const hiddenXml = spec.xml.replace('<step>C</step>', '<step>D</step>');
  assert.equal(validateEngravingInput(hiddenXml, {identity:spec.identity,fromMeasure:65,toMeasure:72,partIds:['P2']}, XmlParser).code, 'engraving_sourceMap');
});

test('third-party budget counts generated silence and rejects an oversized requested page explicitly', () => {
  const spec = synthetic();
  const {projection} = project(spec, {fromMeasure:2,toMeasure:65});
  assert.deepEqual(projection, {ok:false,key:'notes'});
  const bounded = project(spec, {fromMeasure:2,toMeasure:17}); assert.equal(bounded.projection.ok, true); assert.ok(bounded.projection.noteCount <= ENGRAVING_LIMITS.notes);
  const source = synthetic({measures:3,parts:1}), original = project(source), tiny = createEngravingProjection(original.checked.document,original.checked.identity,original.checked.options,{...ENGRAVING_LIMITS,notes:original.checked.metadata.noteCount});
  assert.deepEqual(tiny,{ok:false,key:'notes'},'Silence cannot evade the actual OSMD note budget');
});

test('projection failures retain localized clear codes', () => {
  const i18n = createI18n();
  for (const locale of ['zh-CN','en']) {i18n.setLocale(locale); for (const key of ['projection','sourceMap','sourceNotes','notes','tieContext']) assert.ok(i18n.t(`notationRuntime.${key}`).length > 20);}
  assert.deepEqual(i18n.getReports(), []);
});

test('ties crossing a page and repeated printed labels retain original source identity', () => {
  const pitch = {step:'C',alter:0,octave:4}, note = {id:'sustained-source',staff:1,voice:'line',pitch,at:beat(0),duration:beat(5),tie_start:false,tie_stop:false};
  const score = {parts:[{id:'original',notes:[note]}],measures:[{number:7,at:beat(0),length:beat(4)},{number:7,at:beat(4),length:beat(4)}]};
  const segment = (index,duration) => ({xml_note_id:`sustain-${index}`,source_note_id:note.id,part_id:'original',xml_part_id:'P1',source_measure_index:index,measure_number:7,staff:1,voice:'line',lane:1,xml_voice:'1',at:beat(index*4),measure_at:beat(0),duration:beat(duration),pitch,tie_start:index===0,tie_stop:index===1,chord:false});
  const xmlNote = (index,duration) => `<note id="sustain-${index}"><pitch><step>C</step><octave>4</octave></pitch><duration>${duration}</duration><tie type="${index?'stop':'start'}"/><voice>1</voice><type>${index?'quarter':'whole'}</type><staff>1</staff><notations><tied type="${index?'stop':'start'}"/></notations></note>`;
  const xml = `<score-partwise><part-list><score-part id="P1"><part-name>Original sustained C</part-name></score-part></part-list><part id="P1"><measure number="7"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes><barline location="left"><repeat direction="forward"/></barline>${xmlNote(0,4)}</measure><measure number="7">${xmlNote(1,1)}<forward><duration>3</duration></forward><barline location="right"><repeat direction="backward" times="2"/></barline></measure></part></score-partwise>`;
  const spec = {xml,identity:{score,noteMap:{version:1,segments:[segment(0,4),segment(1,1)]},partIdMap:{original:'P1'},voiceIdMap:[{part_id:'original',staff:1,voice:'line',lane:1,xml_voice:'1'}]}};
  for (const index of [0,1]) {
    const {checked,projection} = project(spec,{fromMeasure:index+1,toMeasure:index+1}); assert.equal(projection.ok,true);
    assert.equal(projection.document.querySelector('measure').getAttribute('number'),'7');
    const displayed=projection.document.querySelector(`note[id="sustain-${index}"]`);assert.equal(displayed.getAttribute('id'),`sustain-${index}`);
    assert.deepEqual(projection.sourceMeasureIndices,[0,1]);assert.deepEqual(projection.displayedSourceMeasureIndices,[index]);assert.equal(projection.drawFromIndex,index);assert.equal(projection.drawToIndex,index);
    assert.equal(displayed.querySelector('tie').getAttribute('type'),index?'stop':'start');
    assert.deepEqual([...projection.document.querySelectorAll('repeat')].map(node=>node.getAttribute('direction')),['forward','backward']);
    const sheet=read(projection);assert.equal(sheet.SourceMeasures[0].getPrintedMeasureNumber(),7);assert.deepEqual(validateEngravingProjectionModel(sheet,projection,score,ENGRAVING_LIMITS),{ok:true});
    const match=matchEngravingModel({Sheet:sheet},{...checked.identity,projection});assert.equal(match.ok,true);assert.deepEqual(match.diagnostics,[]);assert.deepEqual(validateEngravingModelTies({Sheet:sheet},{...checked.identity,projection}),{ok:true});
    assert.equal(match.matches.filter(entry=>entry.note).length,1);assert.equal(match.matches.find(entry=>entry.note).segment.source_measure_index,index);
  }
});

test('post-reader clock verification refuses truncation and mutated local measure tables before layout', () => {
  const spec=synthetic({measures:3,parts:1}),{projection}=project(spec,{fromMeasure:2,toMeasure:3}),sheet=read(projection);
  assert.deepEqual(validateEngravingProjectionModel(sheet,projection,spec.identity.score,ENGRAVING_LIMITS),{ok:true});
  const start=sheet.SourceMeasures[1].AbsoluteTimestamp;sheet.SourceMeasures[1].AbsoluteTimestamp={WholeValue:0,Numerator:1,Denominator:2};
  assert.deepEqual(validateEngravingProjectionModel(sheet,projection,spec.identity.score,ENGRAVING_LIMITS),{ok:false,key:'projection'});
  sheet.SourceMeasures[1].AbsoluteTimestamp=start;sheet.SourceMeasures.pop();
  assert.deepEqual(validateEngravingProjectionModel(sheet,projection,spec.identity.score,ENGRAVING_LIMITS),{ok:false,key:'projection'});
});

test('sub-display-floor silence is refused exactly instead of rounded to a renderable rest', () => {
  const spec=synthetic({measures:2,parts:1}),{checked}=project(spec);
  // This direct helper test changes only the validated presentation input clone:
  // a 1/40000 whole-note gap cannot receive a valid pinned VexFlow duration code.
  const document=checked.document.cloneNode(true),divisions=document.querySelector('divisions');divisions.textContent='10000';
  const forward=document.querySelector('forward');forward.querySelector('duration').textContent='1';
  const projection=createEngravingProjection(document,checked.identity,checked.options,ENGRAVING_LIMITS);
  assert.deepEqual(projection,{ok:false,key:'exactRhythm'});
});

test('long silence partitions exact ticks without a sub-display-floor final remainder', () => {
  const spec=synthetic({measures:2,parts:1}),{checked}=project(spec);
  const document=checked.document.cloneNode(true),part=document.querySelector('part'),measures=[...part.querySelectorAll('measure')];
  for(const node of [...measures[0].children])if(node.localName!=='attributes')node.remove();
  measures[0].querySelector('divisions').textContent='10000';
  const gap=document.createElement('forward'),duration=document.createElement('duration');duration.textContent='40001';gap.appendChild(duration);measures[0].appendChild(gap);
  const score=structuredClone(checked.identity.score);score.measures[0].length=beat(40001,10000);
  const projection=createEngravingProjection(document,{...checked.identity,score},{...checked.options,toMeasure:1},ENGRAVING_LIMITS);
  assert.equal(projection.ok,true);
  const durations=[...projection.document.querySelectorAll('note duration')].map(node=>Number(node.textContent));
  assert.deepEqual(durations,[20000,20001]);assert.equal(durations.reduce((a,b)=>a+b),40001);
});

test('attributes at the selected page boundary override inherited state in the real reader', () => {
  const spec=synthetic({parts:1});
  for(const fromMeasure of [34,51]) {
    const {projection}=project(spec,{fromMeasure,toMeasure:fromMeasure});assert.equal(projection.ok,true);
    const sheet=read(projection),instructions=sheet.SourceMeasures[0].FirstInstructionsStaffEntries[0].Instructions;
    assert.equal(instructions.find(instruction=>typeof instruction.Key==='number').Key,2);
    assert.equal(instructions.find(instruction=>typeof instruction.ClefType==='number').ClefType,1,JSON.stringify(instructions.map(i=>({key:i.Key,clef:i.ClefType,line:i.Line,rhythm:i.Rhythm?.toString()}))));
    const rhythm=instructions.find(instruction=>instruction.Rhythm)?.Rhythm;
    assert.equal(rhythm.Numerator,fromMeasure===51?2:4);assert.equal(rhythm.Denominator,fromMeasure===51?2:4);
  }
});

test('intra-measure attributes fall back explicitly rather than being hoisted to the bar start', () => {
  const spec=synthetic({measures:2,parts:1});
  spec.xml=spec.xml.replace('</attributes>','</attributes><forward><duration>240</duration></forward><attributes><key><fifths>3</fifths></key></attributes><backup><duration>240</duration></backup>');
  const before=JSON.stringify(spec),{checked,projection}=project(spec,{fromMeasure:1,toMeasure:2});
  assert.equal(checked.identity.ok,true,'The source remains valid and fully accounted');
  assert.deepEqual(projection,{ok:false,key:'projection'});assert.equal(JSON.stringify(spec),before);
});

function sustainedFixture({measures=3,parts=1,voices=1,tiedParts=Array.from({length:parts},(_,index)=>index)}={}) {
  const score={parts:[],measures:Array.from({length:measures},(_,index)=>({number:index+1,at:beat(index*4),length:beat(4)}))},segments=[],partIdMap={},voiceIdMap=[],xmlParts=[];
  for(let p=0;p<parts;p++) {
    const part={id:`sustain-part-${p}`,notes:[]},xmlPart=`P${p+1}`,tied=tiedParts.includes(p);score.parts.push(part);partIdMap[part.id]=xmlPart;
    for(let voice=1;voice<=voices;voice++)voiceIdMap.push({part_id:part.id,staff:1,voice:String(voice),lane:1,xml_voice:String(voice)});
    const bars=[];
    for(let index=0;index<measures;index++) {
      const notes=[];
      for(let voice=1;voice<=voices;voice++) {
        const id=`source-${p}-${voice}${tied?'':`-${index}`}`,xmlId=`segment-${p}-${voice}-${index}`,pitch={step:voice%2?'C':'G',alter:0,octave:3+Math.floor((voice-1)/2)%3};
        if(!tied||!index)part.notes.push({id,staff:1,voice:String(voice),pitch,at:beat(tied?0:index*4),duration:beat(tied?measures*4:4),tie_start:false,tie_stop:false});
        const flags={tie_start:tied&&index<measures-1,tie_stop:tied&&index>0};
        segments.push({xml_note_id:xmlId,source_note_id:id,part_id:part.id,xml_part_id:xmlPart,source_measure_index:index,measure_number:index+1,staff:1,voice:String(voice),lane:1,xml_voice:String(voice),at:beat(index*4),measure_at:beat(0),duration:beat(4),pitch,...flags,chord:false});
        const kinds=[...(flags.tie_stop?['stop']:[]),...(flags.tie_start?['start']:[])];
        if(voice>1)notes.push('<backup><duration>4</duration></backup>');
        notes.push(`<note id="${xmlId}"><pitch><step>${pitch.step}</step><octave>${pitch.octave}</octave></pitch><duration>4</duration>${kinds.map(kind=>`<tie type="${kind}"/>`).join('')}<voice>${voice}</voice><type>whole</type><staff>1</staff>${kinds.length?`<notations>${kinds.map(kind=>`<tied type="${kind}"/>`).join('')}</notations>`:''}</note>`);
      }
      bars.push(`<measure number="${index+1}">${index?'':'<attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>'}${notes.join('')}</measure>`);
    }
    xmlParts.push(`<part id="${xmlPart}">${bars.join('')}</part>`);
  }
  const xml=`<score-partwise><part-list>${score.parts.map((_,p)=>`<score-part id="P${p+1}"><part-name>Original sustained context ${p+1}</part-name></score-part>`).join('')}</part-list>${xmlParts.join('')}</score-partwise>`;
  return {xml,identity:{score,noteMap:{version:1,segments},partIdMap,voiceIdMap}};
}

test('complete original tie chains survive both page boundaries across multiple pages and voices',()=>{
  const spec=sustainedFixture({measures:12,parts:2,voices:2}),before=JSON.stringify(spec);
  for(const options of [{fromMeasure:1,toMeasure:2},{fromMeasure:5,toMeasure:6},{fromMeasure:11,toMeasure:12},{fromMeasure:5,toMeasure:6,partIds:['P2']}]) {
    const {checked,projection}=project(spec,options);assert.equal(projection.ok,true);
    assert.deepEqual(projection.sourceMeasureIndices,Array.from({length:12},(_,index)=>index));
    assert.deepEqual(projection.displayedSourceMeasureIndices,[options.fromMeasure-1,options.fromMeasure]);assert.equal(projection.drawFromIndex,options.fromMeasure-1);assert.equal(projection.drawToIndex,options.toMeasure-1);
    const sheet=read(projection);assert.deepEqual(validateEngravingProjectionModel(sheet,projection,spec.identity.score,ENGRAVING_LIMITS),{ok:true});
    assert.deepEqual(validateEngravingModelTies({Sheet:sheet},{...checked.identity,projection}),{ok:true});
    const displayed=matchEngravingModel({Sheet:sheet},{...checked.identity,projection}),all=matchEngravingModel({Sheet:sheet},{...checked.identity,projection},{includeContext:true});
    assert.deepEqual(displayed.diagnostics,[]);assert.equal(displayed.matches.filter(match=>match.note).length,projection.partIds.length*2*2);assert.equal(all.matches.filter(match=>match.note).length,projection.partIds.length*2*12);
    for(const match of displayed.matches.filter(match=>match.note))assert.equal(match.note.NoteTie.Notes.length,12,'A visible stop+start retains the complete original tie object');
    for(const segment of spec.identity.noteMap.segments.filter(segment=>projection.partIds.includes(segment.xml_part_id))) {
      const original=checked.document.querySelector(`note[id="${segment.xml_note_id}"]`),projected=projection.document.querySelector(`note[id="${segment.xml_note_id}"]`);
      assert.equal(projected.toString(),original.toString(),'Every context and displayed note keeps original pitch, ID, timing and tie flags');
    }
  }
  assert.equal(JSON.stringify(spec),before);
});

test('tie membership guard rejects the missing-continuation bug even when all exact clocks and note identities pass',()=>{
  const spec=sustainedFixture(),{checked,projection}=project(spec,{fromMeasure:2,toMeasure:3}),sheet=read(projection),validated={...checked.identity,projection};
  const matched=matchEngravingModel({Sheet:sheet},validated),note=matched.matches.find(match=>match.note).note;note.NoteTie=undefined;
  assert.deepEqual(validateEngravingProjectionModel(sheet,projection,spec.identity.score,ENGRAVING_LIMITS),{ok:true});assert.deepEqual(matchEngravingModel({Sheet:sheet},validated).diagnostics,[]);
  assert.deepEqual(validateEngravingModelTies({Sheet:sheet},validated),{ok:false,key:'tieContext'});
});

test('all original tie context counts toward measure and model-note budgets, while unselected parts need no context',()=>{
  const long=sustainedFixture({measures:65,parts:2,tiedParts:[0]});
  assert.deepEqual(project(long,{fromMeasure:33,toMeasure:33,partIds:['P1']}).projection,{ok:false,key:'tieContext'});
  const selected=project(long,{fromMeasure:33,toMeasure:33,partIds:['P2']}).projection;assert.equal(selected.ok,true);assert.deepEqual(selected.sourceMeasureIndices,[32]);assert.equal(selected.noteCount,1);
  const dense=sustainedFixture({measures:64,voices:32});assert.deepEqual(project(dense,{fromMeasure:33,toMeasure:33}).projection,{ok:false,key:'notes'});
});

test('explicit ties across distinct canonical IDs retain the original ordered tie membership',()=>{
  const spec=sustainedFixture({measures:4}),part=spec.identity.score.parts[0];part.notes=[];
  for(const [index,segment]of spec.identity.noteMap.segments.entries()) {
    segment.source_note_id=`explicit-canonical-${index}`;
    part.notes.push({id:segment.source_note_id,staff:segment.staff,voice:segment.voice,pitch:segment.pitch,at:segment.at,duration:segment.duration,tie_start:segment.tie_start,tie_stop:segment.tie_stop});
  }
  const {checked,projection}=project(spec,{fromMeasure:2,toMeasure:3}),sheet=read(projection),validated={...checked.identity,projection};
  assert.deepEqual(validateEngravingModelTies({Sheet:sheet},validated),{ok:true});
  const matches=matchEngravingModel({Sheet:sheet},validated).matches.filter(match=>match.note);
  assert.deepEqual(matches.map(match=>match.segment.source_note_id),['explicit-canonical-1','explicit-canonical-2']);
  assert.ok(matches.every(match=>match.note.NoteTie.Notes.length===4));
});

test('unique same-staff ties cross canonical and XML voices without losing original context or membership',()=>{
  const spec=sustainedFixture({measures:4}),part=spec.identity.score.parts[0],document=new XmlParser().parseFromString(spec.xml,'application/xml');part.notes=[];
  spec.identity.voiceIdMap=[1,2].map(voice=>({part_id:part.id,staff:1,voice:`authored-${voice}`,lane:1,xml_voice:String(voice)}));
  for(const [index,segment] of spec.identity.noteMap.segments.entries()) {
    segment.source_note_id=`cross-voice-source-${index}`;segment.voice=`authored-${index%2+1}`;segment.xml_voice=String(index%2+1);
    part.notes.push({id:segment.source_note_id,staff:segment.staff,voice:segment.voice,pitch:segment.pitch,at:segment.at,duration:segment.duration,tie_start:segment.tie_start,tie_stop:segment.tie_stop});
    document.querySelector(`note[id="${segment.xml_note_id}"] voice`).textContent=segment.xml_voice;
  }
  spec.xml=document.toString();const before=JSON.stringify(spec);
  for(const options of [{fromMeasure:1,toMeasure:1},{fromMeasure:2,toMeasure:3},{fromMeasure:4,toMeasure:4}]) {
    const {checked,projection}=project(spec,options);assert.equal(projection.ok,true);assert.deepEqual(projection.sourceMeasureIndices,[0,1,2,3]);
    const sheet=read(projection),validated={...checked.identity,projection};
    assert.deepEqual(validateEngravingProjectionModel(sheet,projection,spec.identity.score,ENGRAVING_LIMITS),{ok:true});
    assert.deepEqual(validateEngravingModelTies({Sheet:sheet},validated),{ok:true});
    const displayed=matchEngravingModel({Sheet:sheet},validated),all=matchEngravingModel({Sheet:sheet},validated,{includeContext:true});assert.deepEqual(displayed.diagnostics,[]);assert.deepEqual(all.diagnostics,[]);
    assert.equal(displayed.matches.filter(match=>match.note).length,options.toMeasure-options.fromMeasure+1);
    const notes=all.matches.map(match=>match.note);assert.deepEqual(notes[0].NoteTie.Notes,notes);assert.ok(notes.every(note=>note.NoteTie===notes[0].NoteTie));
    for(const segment of spec.identity.noteMap.segments)assert.equal(projection.document.querySelector(`note[id="${segment.xml_note_id}"]`).toString(),checked.document.querySelector(`note[id="${segment.xml_note_id}"]`).toString());
  }
  assert.equal(JSON.stringify(spec),before);
});

test('cross-voice context preserves canonical voice priority and refuses ambiguous or unsupported joins',()=>{
  const pitch={step:'C',alter:0,octave:4},note=(id,voice,start)=>({xml_note_id:id,source_note_id:id,xml_part_id:'P1',staff:1,voice,xml_voice:id,pitch,source_measure_index:start?0:1,at:beat(start?0:4),duration:beat(4),tie_start:start,tie_stop:!start});
  const segments=[note('a','line-a',true),note('b','line-b',true),note('c','line-a',false),note('d','line-b',false)],options={fromMeasure:1,toMeasure:2,partIds:['P1']};
  assert.deepEqual(resolveEngravingTieContext({segments},options,ENGRAVING_LIMITS).tieChains,[['a','c'],['b','d']],'Original voice identity has priority even when exported lane numbers differ');
  const rejects=changed=>assert.throws(()=>resolveEngravingTieContext({segments:changed},options,ENGRAVING_LIMITS),error=>error.projectionKey==='tieContext');
  const ambiguous=structuredClone(segments);ambiguous[2].voice='line-c';ambiguous[3].voice='line-d';rejects(ambiguous);
  const crossStaff=[structuredClone(segments[0]),structuredClone(segments[2])];crossStaff[1].staff=2;rejects(crossStaff);
  const spelling=[structuredClone(segments[0]),structuredClone(segments[2])];spelling[1].pitch={step:'B',alter:1,octave:3};rejects(spelling);
  const gap=[structuredClone(segments[0]),structuredClone(segments[2])];gap[1].at=beat(9,2);rejects(gap);
});

test('adapter draws the selected local range and refuses a lost model tie before any graphical layout',async()=>{
  const spec=sustainedFixture({measures:4});
  for(const lostTie of [false,true]) {
    const {document}=parseHTML('<html><body><div id="staff"></div></body></html>'),container=document.getElementById('staff'),instances=[],view={DOMParser:XmlParser};
    Object.defineProperty(document,'defaultView',{configurable:true,value:view});
    class ReaderRenderer {
      constructor(mount,options){this.mount=mount;this.options=options;this.Version='2.1.3-release';this.EngravingRules={};this.updates=0;this.renders=0;instances.push(this)}
      async load(document){this.loaded=document;this.Sheet=read({document});if(lostTie){const match=matchEngravingModel({Sheet:this.Sheet},{...project(spec,{fromMeasure:2,toMeasure:3}).checked.identity,projection:{...project(spec,{fromMeasure:2,toMeasure:3}).projection}});match.matches.find(entry=>entry.note).note.NoteTie=undefined}}
      updateGraphic(){this.updates++}render(){this.renders++;this.mount.appendChild(document.createElementNS('http://www.w3.org/2000/svg','svg'))}clear(){this.mount.replaceChildren()}
    }
    view.opensheetmusicdisplay={OpenSheetMusicDisplay:ReaderRenderer};
    const result=await renderEngravedStaff(container,spec.xml,{identity:spec.identity,fromMeasure:2,toMeasure:3,responsive:false}),renderer=instances[0];
    assert.equal(renderer.loaded.querySelectorAll('measure').length,4,'Both original ends load into the bounded model');
    if(lostTie){assert.equal(result.code,'engraving_tieContext');assert.equal(renderer.updates,0);assert.equal(renderer.renders,0);assert.equal(container.querySelector('svg'),null)}
    else{assert.equal(result.ok,true,result.message);assert.equal(renderer.EngravingRules.MinMeasureToDrawIndex,1);assert.equal(renderer.EngravingRules.MaxMeasureToDrawIndex,2);assert.equal(result.metadata.fromMeasure,2);assert.equal(result.metadata.toMeasure,3);assert.equal(result.metadata.modelFromMeasure,1);assert.equal(result.metadata.modelToMeasure,4);assert.equal(result.mappingStatus().displayedSegmentCount,2);assert.equal(result.mappingStatus().segmentCount,4);result.dispose()}
  }
});


test('source-bound basic pages retain exact pinned-reader note identities across open page-edge ties',()=>{
 const data=JSON.parse(readFileSync(new URL('./fixtures/basic-keys-notation-follow.json',import.meta.url),'utf8')),open=data.open;
 const song=prepareCleanSong(`native:song-${open.clean_package.content_sha256}`,open.clean_package,null);
 for(const item of [...data.pages,data.two_measure]){
  const page=basicKeyNotationPage(item.response,item.request,song),spec={xml:page.musicxml.xml,identity:basicKeyEngravingIdentity(song,page)},before=JSON.stringify(page);
  const {checked,projection}=project(spec,{fromMeasure:1,toMeasure:page.measure_count});assert.equal(checked.identity.ok,true,JSON.stringify(checked.identity.diagnostics));assert.equal(projection.ok,true,JSON.stringify(projection));
  const sheet=read(projection),validated={...checked.identity,projection};assert.deepEqual(validateEngravingProjectionModel(sheet,projection,page.score,ENGRAVING_LIMITS),{ok:true});
  const matched=matchEngravingModel({Sheet:sheet},validated);assert.equal(matched.ok,true);assert.deepEqual(matched.diagnostics,[]);assert.equal(matched.matches.filter(item=>item.note).length,page.musicxml.note_id_map.segments.length);assert.deepEqual(validateEngravingModelTies({Sheet:sheet},validated),{ok:true});
  for(const segment of page.musicxml.note_id_map.segments)assert.equal(projection.document.querySelector(`note[id="${segment.xml_note_id}"]`).toString(),checked.document.querySelector(`note[id="${segment.xml_note_id}"]`).toString(),'Projection retains the exact exported boundary tie flags');
  assert.equal(JSON.stringify(page),before);assert.deepEqual(song.notation.measures,[]);
  const forged={...spec,identity:structuredClone(spec.identity)};const unbound=validateEngravingInput(forged.xml,{identity:forged.identity,fromMeasure:1,toMeasure:page.measure_count},XmlParser);assert.equal(unbound.identity.ok,false,'Copying a page object cannot grant a generic source map permission for open ties');
 }
});

test('native excerpt exact rhythm pieces retain source coverage, reader clocks and internal ties',()=>{
 const fixture=JSON.parse(readFileSync(new URL('./fixtures/exact-rhythm-excerpt.json',import.meta.url),'utf8'));
 const identity=exported=>({score:fixture.score,noteMap:exported.note_id_map,partIdMap:exported.part_id_map,voiceIdMap:exported.voice_id_map});
 assert.equal(validateEngravingInput(fixture.unsplit.xml,{identity:identity(fixture.unsplit)},XmlParser).code,'engraving_exactRhythm','The original unsupported component guard remains in force');
 const spec={xml:fixture.exported.xml,identity:identity(fixture.exported)},before=JSON.stringify(fixture);
 const {checked,projection}=project(spec,{fromMeasure:1,toMeasure:1});assert.equal(projection.ok,true,JSON.stringify(projection));
 const sheet=read(projection),validated={...checked.identity,projection};assert.deepEqual(validateEngravingProjectionModel(sheet,projection,fixture.score,ENGRAVING_LIMITS),{ok:true});
 const matched=matchEngravingModel({Sheet:sheet},validated);assert.equal(matched.ok,true);assert.deepEqual(matched.diagnostics,[]);assert.equal(matched.matches.filter(item=>item.note).length,6);
 assert.deepEqual(validateEngravingModelTies({Sheet:sheet},validated),{ok:true});
 for(const source of fixture.score.parts[0].notes){const segments=fixture.exported.note_id_map.segments.filter(segment=>segment.source_note_id===source.id);assert.equal(segments.length,2);assert.equal(new Set(segments.map(segment=>segment.xml_note_id)).size,2);}
 assert.equal(JSON.stringify(fixture),before,'Canonical targets and generated XML remain unchanged by the renderer');
});

test('source-proved incoming page chain restores only real internal ties dropped by the pinned reader',()=>{
 const fixture=JSON.parse(readFileSync(new URL('./fixtures/basic-key-open-tie-page.json',import.meta.url),'utf8'));
 const song=prepareCleanSong(`native:song-${fixture.open.clean_package.content_sha256}`,fixture.open.clean_package,null),page=basicKeyNotationPage(fixture.response,fixture.request,song);
 const spec={xml:page.musicxml.xml,identity:basicKeyEngravingIdentity(song,page)},before=JSON.stringify(page),{checked,projection}=project(spec,{fromMeasure:1,toMeasure:2});
 assert.equal(projection.ok,true);const sheet=read(projection),renderer={Sheet:sheet},validated={...checked.identity,projection};
 assert.deepEqual(validateEngravingProjectionModel(sheet,projection,page.score,ENGRAVING_LIMITS),{ok:true});
 const matched=matchEngravingModel(renderer,validated);assert.deepEqual(matched.diagnostics,[]);assert.equal(matched.matches.length,2);assert.ok(matched.matches.every(match=>!match.note.NoteTie));
 assert.deepEqual(validateEngravingModelTies(renderer,validated),{ok:false,key:'tieContext'},'Authored original C4 reproduces the incoming stop+start reader failure');
 const previousSelf=globalThis.self;
 try{
  globalThis.self=globalThis;const osmd=createRequire(import.meta.url)('opensheetmusicdisplay');
  assert.deepEqual(restoreSourceBoundPageTies(renderer,{...validated,boundaryTies:null},osmd.Tie,osmd.TieTypes),{ok:true,restored:0});
  assert.deepEqual(validateEngravingModelTies(renderer,validated),{ok:false,key:'tieContext'},'Ordinary or unbound missing ties are not repaired');
  assert.deepEqual(restoreSourceBoundPageTies(renderer,validated,osmd.Tie,osmd.TieTypes),{ok:true,restored:1});
  assert.deepEqual(validateEngravingModelTies(renderer,validated),{ok:true});
  assert.deepEqual(restoreSourceBoundPageTies(renderer,validated,osmd.Tie,osmd.TieTypes),{ok:true,restored:0},'Repeated admission never duplicates a tie or note');
  assert.equal(matched.matches[0].note.NoteTie,matched.matches[1].note.NoteTie);assert.deepEqual(matched.matches[0].note.NoteTie.Notes,matched.matches.map(match=>match.note));
  assert.deepEqual(validateEngravingProjectionModel(sheet,projection,page.score,ENGRAVING_LIMITS),{ok:true});
  assert.deepEqual(matchEngravingModel(renderer,validated).diagnostics,[]);
 }finally{if(previousSelf===undefined)delete globalThis.self;else globalThis.self=previousSelf;}
 assert.equal(JSON.stringify(page),before,'Source page, clipped intervals, XML flags and IDs stay immutable');
});

test('page tie recovery refuses forged boundaries, altered membership and existing incorrect ties',()=>{
 const fixture=JSON.parse(readFileSync(new URL('./fixtures/basic-key-open-tie-page.json',import.meta.url),'utf8'));
 const song=prepareCleanSong(`native:song-${fixture.open.clean_package.content_sha256}`,fixture.open.clean_package,null),page=basicKeyNotationPage(fixture.response,fixture.request,song);
 const previousSelf=globalThis.self;
 try{
  globalThis.self=globalThis;const osmd=createRequire(import.meta.url)('opensheetmusicdisplay');
  for(const kind of ['forged-boundary','cross-source','non-adjacent','different-voice','existing-wrong-tie']){
   const {checked,projection}=project({xml:page.musicxml.xml,identity:basicKeyEngravingIdentity(song,page)},{fromMeasure:1,toMeasure:2});
   const renderer={Sheet:read(projection)},validated={...checked.identity,projection},matched=matchEngravingModel(renderer,validated),notes=matched.matches.map(match=>match.note);
   if(kind==='forged-boundary')validated.boundaryTies=new Map(validated.boundaryTies);
   if(['cross-source','non-adjacent','different-voice'].includes(kind)){
    validated.segments=validated.segments.map(segment=>({...segment}));const second=validated.segments[1];
    if(kind==='cross-source')second.source_note_id='unrelated-source';
    if(kind==='non-adjacent')second.at={numerator:5,denominator:1};
    if(kind==='different-voice')second.voice='unrelated-voice';
   }
   const wrong=kind==='existing-wrong-tie'?new osmd.Tie(notes[0],osmd.TieTypes.SIMPLE):null;
   const outcome=restoreSourceBoundPageTies(renderer,validated,osmd.Tie,osmd.TieTypes);
   if(wrong){assert.deepEqual(outcome,{ok:true,restored:0});assert.equal(notes[0].NoteTie,wrong);assert.deepEqual(wrong.Notes,[notes[0]]);}
   else{assert.deepEqual(outcome,{ok:false,key:'tieContext'},kind);assert.ok(notes.every(note=>!note.NoteTie),kind);}
   assert.equal(validateEngravingModelTies(renderer,validated).ok,false,kind);
  }
  const copied=structuredClone(basicKeyEngravingIdentity(song,page)),unbound=validateEngravingInput(page.musicxml.xml,{identity:copied,fromMeasure:1,toMeasure:2},XmlParser);
  assert.equal(unbound.identity.ok,false,'A copied/native-looking page cannot grant ordinary score input boundary privileges');
 }finally{if(previousSelf===undefined)delete globalThis.self;else globalThis.self=previousSelf;}
});

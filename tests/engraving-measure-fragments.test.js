import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {DOMParser, Node,parseHTML} from 'linkedom';
import {validateEngravingInput,renderEngravedStaff, ENGRAVING_LIMITS} from '../web/engraving.js';
import {createEngravingProjection,createSourceBoundEngravingFragments,engravingProjectionModelCoordinates,proveEngravingProjectionModelNotes,validateEngravingProjectionModel,restoreSourceBoundProjectionFractions} from '../web/engraving-projection.js';
import {createEngravingMeasureFragments, validateEngravingMeasureFragments, prepareEngravingFragmentLabels, prepareEngravingFragmentBarlines} from '../web/engraving-measure-fragments.js';
import {prepareCleanSong} from '../web/clean-song-package.js';
import {basicKeyNotationPage,basicKeyEngravingIdentity,basicKeyWrittenAt} from '../web/basic-key-notation.js';
import {matchEngravingModel} from '../web/engraving-note-map.js';

class XmlParser extends DOMParser {
  parseFromString(source, type) {
    const document = super.parseFromString(source, type), find = document.getElementsByTagName.bind(document);
    document.getElementsByTagName = name => name === '*' ? document.querySelectorAll('*') : find(name);
    for (const element of document.querySelectorAll('*')) Object.defineProperty(element, 'namespaceURI', {value: null});
    return document;
  }
}
const beat = (numerator, denominator = 1) => ({numerator, denominator});

// Entirely original diagnostic tones: an F, a later F-sharp, and an optional
// independent held C. They test key location and split identity, not a melody.
function original({sustain = false, keyTick = 8, parts = 2} = {}) {
  const score = {parts: [], keys: [{at: beat(0), fifths: 0, mode: 'major'}, {at: beat(keyTick, 4), fifths: 2, mode: 'major'}], measures: [{number: 7, at: beat(0), length: beat(4)}, {number: 7, at: beat(4), length: beat(4)}]};
  const segments = [], voiceIdMap = [], partIdMap = {}, xmlParts = [];
  for (let p = 0; p < parts; p++) {
    const part = {id: `original-${p}`, notes: []}, xmlId = `P${p + 1}`; score.parts.push(part); partIdMap[part.id] = xmlId;
    for (const voice of sustain ? [1, 2] : [1]) voiceIdMap.push({part_id: part.id, staff: voice, voice: String(voice), lane: 1, xml_voice: String(voice)});
    const note = (id, measure, atTick, durationTick, step, alter, voice) => {
      const pitch = {step, alter, octave: voice === 1 ? 4 + p : 3}, at = beat(measure * 4 * 4 + atTick, 4), duration = beat(durationTick, 4), sourceId = `${id}-${p}`;
      part.notes.push({id: sourceId, staff: voice, voice: String(voice), pitch, at, duration, tie_start: false, tie_stop: false});
      segments.push({xml_note_id: sourceId, source_note_id: sourceId, part_id: part.id, xml_part_id: xmlId, source_measure_index: measure, measure_number: 7, staff: voice, voice: String(voice), lane: 1, xml_voice: String(voice), at, measure_at: beat(atTick, 4), duration, pitch, tie_start: false, tie_stop: false, chord: false});
      return `<note id="${sourceId}"><pitch><step>${step}</step><alter>${alter}</alter><octave>${pitch.octave}</octave></pitch><duration>${durationTick}</duration><voice>${voice}</voice><type>${durationTick === 16 ? 'whole' : 'quarter'}</type><staff>${voice}</staff></note>`;
    };
    const before = note('before-F', 0, 0, 4, 'F', 0, 1), after = note('after-F-sharp', 0, keyTick, 4, 'F', 1, 1), held = sustain ? note('held-C', 0, 0, 16, 'C', 0, 2) : '', next = note('following-F-sharp', 1, 0, 16, 'F', 1, 1);
    const attributes = '<attributes><divisions>4</divisions><key><fifths>0</fifths><mode>major</mode></key><time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes>';
    const key = `<forward><duration>${keyTick}</duration></forward><attributes><key><fifths>2</fifths><mode>major</mode></key></attributes><backup><duration>${keyTick}</duration></backup>`;
    const tail = sustain ? `<backup><duration>${keyTick + 4}</duration></backup>${held}` : `<forward><duration>${12 - keyTick}</duration><voice>1</voice><staff>1</staff></forward>`;
    xmlParts.push(`<part id="${xmlId}"><measure number="7">${attributes}${key}${before}<forward><duration>${keyTick - 4}</duration><voice>1</voice><staff>1</staff></forward>${after}${tail}</measure><measure number="7">${next}</measure></part>`);
  }
  return {xml: `<score-partwise><part-list>${score.parts.map((_, p) => `<score-part id="P${p + 1}"><part-name>Original key timing ${p + 1}</part-name></score-part>`).join('')}</part-list>${xmlParts.join('')}</score-partwise>`, identity: {score, noteMap: {version: 1, segments}, partIdMap, voiceIdMap}};
}
function project(spec, options = {}, experiment) {
  const checked = validateEngravingInput(spec.xml, {identity: spec.identity, fromMeasure: 1, toMeasure: 2, ...options}, XmlParser);
  assert.equal(checked.ok, true, checked.message); assert.equal(checked.identity.ok, true, JSON.stringify(checked.identity.diagnostics));
  const projection = createEngravingMeasureFragments(checked.document, checked.identity, checked.options, ENGRAVING_LIMITS, experiment);
  return {checked, projection};
}
function read(projection) {
  const previousSelf = globalThis.self, previousNode = globalThis.Node;
  try {
    globalThis.self = globalThis; globalThis.Node = Node;
    const osmd = createRequire(import.meta.url)('opensheetmusicdisplay');
    return new osmd.MusicSheetReader([], new osmd.EngravingRules()).createMusicSheet(new osmd.IXmlElement(projection.document.documentElement), 'original-key-fragment-prototype');
  } finally {
    if (previousSelf === undefined) delete globalThis.self; else globalThis.self = previousSelf;
    if (previousNode === undefined) delete globalThis.Node; else globalThis.Node = previousNode;
  }
}

// Exercise the pinned system builder's real line selection and VexFlow drawing
// without launching a browser or substituting a test barline implementation.
function fragmentGraphic(sheet, osmd) {
  const graphic = {MeasureList: sheet.SourceMeasures.map(source => sheet.Staves.map(staff => new osmd.VexFlowMeasure(staff, source))), MusicPages: [], reCalculate() {
    const builder = new osmd.MusicSystemBuilder(), lines = [];
    Object.assign(builder, {measureList: this.MeasureList, rules: sheet.Rules, visibleStaffIndices: sheet.Staves.map((_, index) => index), graphicalMusicSheet: {ParentMusicSheet: sheet}});
    for (const [index, row] of this.MeasureList.entries()) {
      builder.measureListIndex = index;
      const type = builder.getMeasureEndLine();
      for (const [staff, measure] of row.entries()) {
        measure.clean();measure.setWidth(20);measure.setAbsoluteCoordinates(index * 200, 20 + staff * 80);
        measure.addMeasureLine(type, osmd.SystemLinePosition.MeasureEnd);
      }
      if (row.length > 1) row[1].lineTo(row[0], osmd.VexFlowConverter.line(type, osmd.SystemLinePosition.MeasureEnd));
      lines.push({lineType: type, linePosition: osmd.SystemLinePosition.MeasureEnd, topMeasure: row[0], bottomMeasure: row[1], PositionAndShape: {BorderRight: 1}});
    }
    this.MusicPages = [{MusicSystems: [{SystemLines: lines}]}];
    return 'real-pinned-boundary-layout';
  }};
  return graphic;
}

function paintBoundary(row, osmd) {
  const oldDocument = globalThis.document, oldWindow = globalThis.window;
  try {
    const {document, window} = parseHTML('<html><body><div id="drawing"></div></body></html>');
    globalThis.document = document;globalThis.window = window;
    const backend = new osmd.SvgVexFlowBackend(row[0].parentSourceMeasure.Rules);
    backend.graphicalMusicPage = {PageNumber: 1};backend.initialize(document.getElementById('drawing'), 1);
    const context = backend.getContext();
    for (const measure of row) {
      const stave = measure.getVFStave();stave.setContext(context);
      const bar = stave.getModifiers().find(modifier => modifier.getCategory() === 'barlines' && modifier.getPosition() === modifier.constructor.Position.END);
      bar.setX(stave.getX() + stave.getWidth());bar.draw(stave);
      for (const connector of measure.connectors) connector.setContext(context).draw();
    }
    return backend.getSvgElement().outerHTML;
  } finally {
    if (oldDocument === undefined) delete globalThis.document;else globalThis.document = oldDocument;
    if (oldWindow === undefined) delete globalThis.window;else globalThis.window = oldWindow;
  }
}

test('pinned key-change layout draws phantom fragment bars and the instance repair removes their actual SVG only', () => {
  const spec = original({parts: 1});
  spec.identity.score.keys.push({at: beat(4), fifths: 4, mode: 'major'});
  spec.xml = spec.xml.replace('<measure number="7"><note', '<measure number="7"><attributes><key><fifths>4</fifths><mode>major</mode></key></attributes><note').replace('</measure></part>', '<barline location="right"><bar-style>light-heavy</bar-style></barline></measure></part>');
  const before = JSON.stringify(spec), {projection} = project(spec), sheet = read(projection);
  const previousSelf = globalThis.self;globalThis.self = globalThis;
  const osmd = createRequire(import.meta.url)('opensheetmusicdisplay');
  if (previousSelf === undefined) delete globalThis.self;else globalThis.self = previousSelf;
  const graphic = fragmentGraphic(sheet, osmd), renderer = {Sheet: sheet, GraphicSheet: graphic}, originalRecalculate = graphic.reCalculate;
  const clocks = JSON.stringify(sheet.SourceMeasures.map(measure => [measure.Duration, measure.AbsoluteTimestamp]));
  assert.equal(sheet.SourceMeasures[0].endingBarStyleEnum, osmd.SystemLinesEnum.None);
  graphic.reCalculate();
  assert.equal(graphic.MusicPages[0].MusicSystems[0].SystemLines[0].lineType, osmd.SystemLinesEnum.DoubleThin, 'The real pinned builder overrides an explicit none before a key change');
  const phantom = paintBoundary(graphic.MeasureList[0], osmd);
  assert.equal((phantom.match(/<rect /g) || []).length, 6, 'Two staff double bars and their two-line connector are actual SVG paint');
  assert.ok([...phantom.matchAll(/height="([^"]+)"/g)].every(match => Number(match[1]) > 0), 'Every emitted bar and connector has positive SVG height');
  const genuine = graphic.MeasureList.slice(1).map(row => paintBoundary(row, osmd));
  assert.ok(genuine.every(svg => svg.includes('<rect ')), 'The fixture includes real source boundaries, including a key change and final bar');
  const repair = prepareEngravingFragmentBarlines(renderer, projection, spec.identity.score, ENGRAVING_LIMITS, osmd);
  assert.equal(repair.ok, true);
  const sibling = fragmentGraphic(sheet, osmd);sibling.reCalculate();
  assert.equal(paintBoundary(sibling.MeasureList[0], osmd), phantom, 'Another renderer remains untouched while this instance is repaired');
  for (let resize = 0; resize < 3; resize++) {
    assert.equal(graphic.reCalculate(), 'real-pinned-boundary-layout');
    assert.equal(paintBoundary(graphic.MeasureList[0], osmd), '<svg id="osmdSvgPage1" />', 'No vertical fragment bar or staff connector reaches SVG');
    assert.equal(graphic.MusicPages[0].MusicSystems[0].SystemLines[0].lineType, osmd.SystemLinesEnum.None);
    assert.deepEqual(graphic.MeasureList.slice(1).map(row => paintBoundary(row, osmd)), genuine, 'Source key-boundary and final-bar paint stay byte-identical');
    assert.equal(JSON.stringify(sheet.SourceMeasures.map(measure => [measure.Duration, measure.AbsoluteTimestamp])), clocks);
    assert.equal(validateEngravingMeasureFragments(sheet, projection, spec.identity.score, ENGRAVING_LIMITS).ok, true);
  }
  repair.dispose();assert.equal(graphic.reCalculate, originalRecalculate);
  graphic.reCalculate();assert.equal(paintBoundary(graphic.MeasureList[0], osmd), phantom, 'Disposal restores the owned method without modifying a global prototype');
  assert.equal(JSON.stringify(spec), before);
});

test('fragment barline repair refuses forged provenance and unknown or changed graphical models', () => {
  const previousSelf = globalThis.self;globalThis.self = globalThis;
  const osmd = createRequire(import.meta.url)('opensheetmusicdisplay');
  if (previousSelf === undefined) delete globalThis.self;else globalThis.self = previousSelf;
  for (const mutation of ['forged', 'missing', 'wrong-source', 'wrong-enum', 'changed-clock', 'unknown-bar', 'wrong-connector']) {
    const spec = original({parts: 1}), {projection} = project(spec), sheet = read(projection), graphic = fragmentGraphic(sheet, osmd), renderer = {Sheet: sheet, GraphicSheet: graphic}, originalRecalculate = graphic.reCalculate;
    if (mutation === 'missing') delete renderer.GraphicSheet;
    if (mutation === 'wrong-source') graphic.MeasureList[0][0].parentSourceMeasure = sheet.SourceMeasures[1];
    if (mutation === 'wrong-enum') sheet.SourceMeasures[0].endingBarStyleEnum = osmd.SystemLinesEnum.DoubleThin;
    const repair = prepareEngravingFragmentBarlines(renderer, mutation === 'forged' ? {...projection} : projection, spec.identity.score, ENGRAVING_LIMITS, osmd);
    if (['forged', 'missing', 'wrong-source', 'wrong-enum'].includes(mutation)) {assert.equal(repair.ok, false, mutation);assert.equal(graphic.reCalculate, originalRecalculate);continue;}
    assert.equal(repair.ok, true);
    if (mutation === 'changed-clock') sheet.SourceMeasures[0].Duration.Numerator++;
    else {
      const method = mutation === 'unknown-bar' ? 'addMeasureLine' : 'lineTo', measure = graphic.MeasureList[0][mutation === 'unknown-bar' ? 0 : 1], original = measure[method];
      measure[method] = function (...args) {const result = Reflect.apply(original, this, args);if (mutation === 'unknown-bar') this.getVFStave().getModifiers()[1].type = 99;else this.connectors[0].bottom_stave = graphic.MeasureList[1][0].getVFStave();return result;};
    }
    assert.throws(() => graphic.reCalculate(), /Exact presentation fragments/, mutation);
    repair.dispose();assert.equal(graphic.reCalculate, originalRecalculate);
  }
});

test('noncrossing key fragments preserve source IDs, exact offsets and real-reader key times', () => {
  for (const keyTick of [7, 8]) for (const options of [{}, {partIds: ['P2']}, {partIds: ['P2', 'P1']}, {fromMeasure: 1, toMeasure: 1}]) {
    const spec = original({keyTick}), before = JSON.stringify(spec), {checked, projection} = project(spec, options);
    assert.equal(projection.ok, true, JSON.stringify(projection));
    assert.deepEqual(createEngravingProjection(checked.document, checked.identity, checked.options, ENGRAVING_LIMITS), {ok: false, key: 'projection'}, 'Existing production fallback remains in force');
    assert.equal(projection.measureFragments.length, options.toMeasure === 1 ? 2 : 3);
    assert.deepEqual(projection.measureFragments.map(fragment => fragment.source_measure_index), options.toMeasure === 1 ? [0, 0] : [0, 0, 1]);
    assert.deepEqual(projection.measureFragments[1].source_offset, keyTick === 8 ? beat(2) : beat(7, 4));
    assert.ok(projection.noteFragments.every(fragment => fragment.xml_note_id === fragment.source_xml_note_id));
    const checkedModel = validateEngravingMeasureFragments(read(projection), projection, spec.identity.score, ENGRAVING_LIMITS);
    assert.equal(checkedModel.ok, true, checkedModel.key);
    assert.equal(checkedModel.matches.length, projection.noteFragments.length);
    for (const part of projection.document.querySelectorAll('part')) {
      const measures = [...part.querySelectorAll('measure')];
      assert.equal(measures[0].getAttribute('number'), '7'); assert.equal(measures[1].getAttribute('number'), '7');
      assert.equal(measures[1].getAttribute('implicit'), 'yes'); assert.equal(measures[0].querySelector('bar-style').textContent, 'none');
      assert.equal(measures[0].querySelector('fifths').textContent, '0'); assert.equal(measures[1].querySelector('fifths').textContent, '2');
      for (const originalNote of checked.document.querySelectorAll(`part[id="${part.getAttribute('id')}"] note`)) {
        const displayed = part.querySelector(`note[id="${originalNote.getAttribute('id')}"]`);
        if (displayed) assert.equal(displayed.toString(), originalNote.toString(), 'No existing source note XML is respelled, split, or renamed');
      }
    }
    assert.equal(JSON.stringify(spec), before);
  }
});

test('a sustained source note crossing the key is refused without rewriting source or adding display notes', () => {
  const spec=original({sustain:true}),before=JSON.stringify(spec);
  assert.deepEqual(project(spec).projection,{ok:false,key:'fragmentSustainedNote'});
  assert.deepEqual(project(spec,{}, {allowSourceNoteSplits:true}).projection,{ok:false,key:'fragmentSustainedNote'},'There is no production option to enable source-note splitting');
  assert.equal(JSON.stringify(spec),before);
});

test('default admission also refuses a sustained canonical note whose existing written split happens to meet the key',()=>{
  const spec=original({sustain:true,parts:1}),document=new XmlParser().parseFromString(spec.xml,'application/xml'),head=document.querySelector('note[id="held-C-0"]'),tail=head.cloneNode(true);
  tail.setAttribute('id','held-C-0-tail');head.after(tail);
  for(const [note,kind]of [[head,'start'],[tail,'stop']]){
    note.querySelector('duration').textContent='8';note.querySelector('type').textContent='half';
    const tie=document.createElement('tie');tie.setAttribute('type',kind);note.insertBefore(tie,note.querySelector('voice'));
    const notations=document.createElement('notations'),tied=document.createElement('tied');tied.setAttribute('type',kind);notations.appendChild(tied);note.appendChild(notations);
  }
  const segment=spec.identity.noteMap.segments.find(segment=>segment.xml_note_id==='held-C-0');segment.duration=beat(2);segment.tie_start=true;
  spec.identity.noteMap.segments.push({...segment,xml_note_id:'held-C-0-tail',at:beat(2),measure_at:beat(2),tie_start:false,tie_stop:true});spec.xml=document.toString();
  assert.deepEqual(project(spec).projection,{ok:false,key:'fragmentSustainedNote'},'Admission checks the complete canonical pitched interval, not only each already split written segment');
});

test('fragment proof refuses relocated keys, shifted notes, wrong clocks and source mutations', () => {
  const cases = [
    ['hoisted key', ({sheet}) => { sheet.SourceMeasures[0].FirstInstructionsStaffEntries[0].Instructions.find(instruction => typeof instruction.Key === 'number').Key = 2; }],
    ['lost key', ({sheet}) => { sheet.SourceMeasures[1].FirstInstructionsStaffEntries[0].Instructions = []; }],
    ['wrong key mode',({sheet})=>{Object.defineProperty(sheet.SourceMeasures[1].FirstInstructionsStaffEntries[0].Instructions.find(instruction=>typeof instruction.Key==='number'),'Mode',{value:1});}],
    ['shifted timestamp', ({sheet}) => { sheet.SourceMeasures[1].AbsoluteTimestamp.Numerator = 3; }],
    ['changed duration', ({sheet}) => { sheet.SourceMeasures[1].Duration.Numerator = 3; }],
    ['changed note onset', ({result}) => { result.matches.find(match => match.fragment.source_note_id === 'after-F-sharp-0').note.ParentVoiceEntry.Timestamp.Numerator = 1; }],
    ['changed second-staff key', ({sheet}) => { sheet.SourceMeasures[1].FirstInstructionsStaffEntries[1].Instructions = []; }],
    ['changed source', ({spec}) => { spec.identity.score.keys[1].at.numerator++; }],
    ['changed projection ID', ({projection}) => { projection.document.querySelector('note').setAttribute('id', 'forged'); }],
  ];
  for (const [name, mutate] of cases) {
    const spec = original(), {projection} = project(spec), sheet = read(projection), result = validateEngravingMeasureFragments(sheet, projection, spec.identity.score, ENGRAVING_LIMITS);
    assert.equal(result.ok, true); mutate({spec, projection, sheet, result});
    assert.equal(validateEngravingMeasureFragments(sheet, projection, spec.identity.score, ENGRAVING_LIMITS).ok, false, name);
  }
  const spec = original(); spec.identity.score.keys[1].at = beat(3);
  assert.deepEqual(project(spec).projection, {ok: false, key: 'fragmentKeyIdentity'}, 'XML timing needs the same canonical key event');
});

test('fragment admission is generic, bounded, and cannot erase a missing canonical key', () => {
  const spec = original(), {checked, projection} = project(spec);
  assert.deepEqual(createEngravingMeasureFragments(checked.document, checked.identity, checked.options, {...ENGRAVING_LIMITS, measuresPerView: 2}), {ok: false, key: 'fragmentBudget'});
  assert.deepEqual(createEngravingMeasureFragments(checked.document, checked.identity, checked.options, {...ENGRAVING_LIMITS, notes: projection.noteCount - 1}), {ok: false, key: 'notes'});
  assert.deepEqual(project(spec, {fromMeasure: 2, toMeasure: 2}).projection, {ok: false, key: 'fragmentNotNeeded'});
  const missing = structuredClone(spec); missing.xml = missing.xml.replaceAll('<attributes><key><fifths>2</fifths><mode>major</mode></key></attributes>', '');
  assert.deepEqual(project(missing).projection, {ok: false, key: 'fragmentKeyIdentity'});
  assert.deepEqual(validateEngravingMeasureFragments(read(projection), {...projection}, spec.identity.score, ENGRAVING_LIMITS), {ok: false, key: 'fragmentProjection'});
});

test('source numbering policy distinguishes a presentation continuation from a new source measure', () => {
  const spec = original(), {projection} = project(spec), sheet = read(projection);
  assert.equal(sheet.SourceMeasures[0].ImplicitMeasure, true, 'The pinned reader initially mistakes the first short fragment for a pickup');
  const clocks = sheet.SourceMeasures.map(measure => [measure.Duration, measure.AbsoluteTimestamp]);
  assert.deepEqual(prepareEngravingFragmentLabels(sheet, projection, spec.identity.score, ENGRAVING_LIMITS), {ok: true});
  assert.deepEqual(sheet.SourceMeasures.map(measure => measure.ImplicitMeasure), [false, true, false]);
  assert.deepEqual(sheet.SourceMeasures.map(measure => measure.getPrintedMeasureNumber()), [7, 7, 7]);
  for (const [index, measure] of sheet.SourceMeasures.entries()) { assert.equal(measure.Duration, clocks[index][0]); assert.equal(measure.AbsoluteTimestamp, clocks[index][1]); }
  assert.equal(validateEngravingMeasureFragments(sheet, projection, spec.identity.score, ENGRAVING_LIMITS).ok, true);
});

test('fragment attribute changes and byte limits use real XML serialization under browser-like toString semantics',()=>{
  const sample=new XmlParser().parseFromString('<score-partwise/>','application/xml');
  let elementPrototype=Object.getPrototypeOf(sample.documentElement),documentPrototype=Object.getPrototypeOf(sample);
  while(!Object.hasOwn(elementPrototype,'toString'))elementPrototype=Object.getPrototypeOf(elementPrototype);
  while(!Object.hasOwn(documentPrototype,'toString'))documentPrototype=Object.getPrototypeOf(documentPrototype);
  const elementString=Object.getOwnPropertyDescriptor(elementPrototype,'toString'),outerHTML=Object.getOwnPropertyDescriptor(elementPrototype,'outerHTML'),documentString=Object.getOwnPropertyDescriptor(documentPrototype,'toString'),oldSerializer=globalThis.XMLSerializer;
  const serializeElement=node=>Reflect.apply(elementString.value,node,[]);
  try{
    Object.defineProperty(elementPrototype,'toString',{configurable:true,value(){return '[object Element]';}});
    Object.defineProperty(elementPrototype,'outerHTML',{configurable:true,get(){return serializeElement(this);}});
    Object.defineProperty(documentPrototype,'toString',{configurable:true,value(){return '[object XMLDocument]';}});
    globalThis.XMLSerializer=class{serializeToString(document){return [...document.childNodes].map(node=>node.nodeType===1?serializeElement(node):String(node)).join('');}};
    const spec=original(),{checked,projection}=project(spec);assert.equal(projection.ok,true,projection.key);
    assert.equal(projection.document.toString(),'[object XMLDocument]');assert.equal(projection.document.querySelector('key').toString(),'[object Element]');
    assert.equal(validateEngravingMeasureFragments(read(projection),projection,spec.identity.score,ENGRAVING_LIMITS).ok,true,'The changed key must still reach the actual reader');
    const bytes=new TextEncoder().encode(new XMLSerializer().serializeToString(projection.document)).byteLength;
    assert.ok(bytes>1000);assert.deepEqual(createEngravingMeasureFragments(checked.document,checked.identity,checked.options,{...ENGRAVING_LIMITS,xmlBytes:bytes-1}),{ok:false,key:'fragmentBudget'});
    projection.document.querySelector('fifths').textContent='1';assert.equal(validateEngravingMeasureFragments(read(projection),projection,spec.identity.score,ENGRAVING_LIMITS).ok,false,'A real DOM mutation cannot hide behind a constant object string');
  }finally{
    Object.defineProperty(elementPrototype,'toString',elementString);Object.defineProperty(elementPrototype,'outerHTML',outerHTML);Object.defineProperty(documentPrototype,'toString',documentString);
    if(oldSerializer===undefined)delete globalThis.XMLSerializer;else globalThis.XMLSerializer=oldSerializer;
  }
});

test('explicit noncrossing factory uses the same private provenance and complete inventory as ordinary pages',()=>{
  const spec=original(),{checked}=project(spec),projection=createSourceBoundEngravingFragments(checked.document,checked.identity,checked.options,ENGRAVING_LIMITS);
  assert.equal(projection.ok,true);const sheet=read(projection);
  assert.deepEqual(restoreSourceBoundProjectionFractions(sheet,projection,spec.identity.score,ENGRAVING_LIMITS),{ok:true});
  assert.deepEqual(validateEngravingProjectionModel(sheet,projection,spec.identity.score,ENGRAVING_LIMITS),{ok:true});
  const inventory=proveEngravingProjectionModelNotes(sheet,projection,spec.identity.score,ENGRAVING_LIMITS);
  assert.equal(inventory.ok,true);assert.equal(inventory.sourceDocument,checked.document);assert.equal(inventory.notes.length,projection.noteCount);
  const coordinates=engravingProjectionModelCoordinates(projection,spec.identity.score);
  assert.deepEqual(coordinates,{ok:true,measures:[{sourceMeasureIndex:0,offset:beat(0)},{sourceMeasureIndex:0,offset:beat(2)},{sourceMeasureIndex:1,offset:beat(0)}]});
  assert.deepEqual(projection.sourceMeasureIndices,[0,1]);assert.deepEqual(projection.displayedSourceMeasureIndices,[0,1]);assert.equal(projection.drawFromIndex,0);assert.equal(projection.drawToIndex,2);
  coordinates.measures[1].offset.numerator=999;
  assert.equal(engravingProjectionModelCoordinates(projection,spec.identity.score).measures[1].offset.numerator,2,'Coordinate results cannot modify the private capability');
  const forged={...projection};assert.equal(validateEngravingProjectionModel(sheet,forged,spec.identity.score,ENGRAVING_LIMITS).ok,false);assert.equal(engravingProjectionModelCoordinates(forged,spec.identity.score).ok,false);
  checked.document.querySelector('note').setAttribute('id','changed');assert.equal(proveEngravingProjectionModelNotes(sheet,projection,spec.identity.score,ENGRAVING_LIMITS).ok,false);
  const crossing=original({sustain:true}),state=project(crossing);assert.deepEqual(createSourceBoundEngravingFragments(state.checked.document,state.checked.identity,state.checked.options,ENGRAVING_LIMITS),{ok:false,key:'projection'});
});

test('authored native key pages retain four source IDs and reject a source note crossing the key',()=>{
  const fixture=JSON.parse(readFileSync(new URL('./fixtures/basic-key-internal-key-pages.json',import.meta.url),'utf8'));
  assert.equal(fixture.provenance.license,'CC0-1.0');assert.match(fixture.provenance.driver_source,/^[a-f0-9]{40}$/);assert.match(fixture.provenance.driver_sha256,/^[a-f0-9]{64}$/);
  for(const name of ['noncrossing','crossing']){
    const data=fixture[name],song=prepareCleanSong(`native:song-${data.open.clean_package.content_sha256}`,data.open.clean_package,null),page=basicKeyNotationPage(data.response,data.request,song),identity=basicKeyEngravingIdentity(song,page);
    const checked=validateEngravingInput(page.musicxml.xml,{identity,fromMeasure:1,toMeasure:page.measure_count},XmlParser);assert.equal(checked.identity.ok,true);
    assert.deepEqual(createEngravingProjection(checked.document,checked.identity,checked.options,ENGRAVING_LIMITS),{ok:false,key:'projection'});
    const before=JSON.stringify(page),projection=createSourceBoundEngravingFragments(checked.document,checked.identity,checked.options,ENGRAVING_LIMITS);
    if(name==='crossing'){assert.deepEqual(projection,{ok:false,key:'projection'});continue;}
    assert.equal(projection.ok,true);assert.equal(projection.noteFragments.length,4);assert.equal(projection.measureFragments.length,4);
    const sheet=read(projection),model=validateEngravingMeasureFragments(sheet,projection,page.score,ENGRAVING_LIMITS),inventory=proveEngravingProjectionModelNotes(sheet,projection,page.score,ENGRAVING_LIMITS);
    assert.equal(model.ok,true);assert.equal(inventory.ok,true);assert.equal(inventory.sourceDocument,checked.document);
    const bound={...checked.identity,projection},matched=matchEngravingModel({Sheet:sheet},bound,{includeContext:true});assert.equal(matched.ok,true);assert.deepEqual(matched.diagnostics,[]);assert.equal(matched.matches.filter(match=>match.note).length,4);
    assert.deepEqual(matched.matches.map(match=>match.segment.xml_note_id).sort(),projection.noteFragments.map(note=>note.xml_note_id).sort());
    for(const match of matched.matches)assert.equal(match.segment.source_measure_index,projection.measureFragments[sheet.SourceMeasures.indexOf(match.note.SourceMeasure)].source_measure_index);
    const clockBefore=JSON.stringify(song.compilation.timeline);
    for(const interpreted of page.interpreted_notes){
      const position=(interpreted.start_ms+interpreted.end_ms)/2,active=song.compilation.timeline.notes.filter(note=>note.start_ms<=position&&note.start_ms+note.duration_ms>position),written=basicKeyWrittenAt(song,page,position,active);
      const entry=written.entries.find(entry=>entry.sourceNoteId===interpreted.note_id),match=matched.matches.find(match=>match.segment.source_note_id===interpreted.note_id);
      assert.ok(entry&&match?.note);assert.equal(entry.sourceMeasureIndex,match.segment.source_measure_index,'The actual playback follower keeps the original source ordinal across an internal key fragment');
    }
    assert.equal(JSON.stringify(song.compilation.timeline),clockBefore);
    assert.deepEqual(projection.noteFragments.map(note=>note.xml_note_id).sort(),page.musicxml.note_id_map.segments.map(note=>note.xml_note_id).sort());
    assert.deepEqual(projection.measureFragments.map(fragment=>fragment.source_offset),[beat(0),beat(1),beat(0),beat(7,4)]);
    assert.equal(JSON.stringify(page),before);
  }
});

test('production adapter permits fragments only for unchanged native v2 admission and keeps public source paging',async()=>{
  const fixture=JSON.parse(readFileSync(new URL('./fixtures/basic-key-internal-key-pages.json',import.meta.url),'utf8'));
  for(const cooperative of [false,true]) for(const kind of ['native','generic','crossing','layout-failure']){
    const data=fixture[kind==='crossing'?'crossing':'noncrossing'],song=prepareCleanSong(`native:song-${data.open.clean_package.content_sha256}`,data.open.clean_package,null),page=basicKeyNotationPage(data.response,data.request,song);
    const identity=kind==='generic'?{score:page.score,noteMap:page.musicxml.note_id_map,partIdMap:page.musicxml.part_id_map,voiceIdMap:page.musicxml.voice_id_map}:basicKeyEngravingIdentity(song,page);
    const {document}=parseHTML('<html><body><div id="staff"></div></body></html>'),instances=[],before=JSON.stringify(data);
    const previousSelf=globalThis.self;globalThis.self=globalThis;const osmd=createRequire(import.meta.url)('opensheetmusicdisplay');if(previousSelf===undefined)delete globalThis.self;else globalThis.self=previousSelf;
    class ReaderRenderer{
      constructor(mount){this.mount=mount;this.Version='2.1.3-release';this.updates=0;this.renders=0;instances.push(this);}
      async load(document){this.loaded=document;this.Sheet=read({document});this.EngravingRules=this.Sheet.Rules;}
      updateGraphic(){this.updates++;assert.deepEqual(this.Sheet.SourceMeasures.map(measure=>measure.ImplicitMeasure),[false,true,false,true]);this.GraphicSheet=fragmentGraphic(this.Sheet,osmd);this.originalRecalculate=this.GraphicSheet.reCalculate;}
      render(){this.renders++;this.GraphicSheet.reCalculate();if(kind==='layout-failure')throw Error('original-layout-failure');this.mount.appendChild(document.createElementNS('http://www.w3.org/2000/svg','svg'));}
      clear(){assert.equal(this.GraphicSheet?.reCalculate,this.originalRecalculate,'Disposal restores the owned layout hook before clearing');this.mount.replaceChildren();}
    }
    Object.defineProperty(document,'defaultView',{configurable:true,value:{DOMParser:XmlParser,opensheetmusicdisplay:{...osmd,OpenSheetMusicDisplay:ReaderRenderer}}});
    const result=await renderEngravedStaff(document.getElementById('staff'),page.musicxml.xml,{identity,fromMeasure:1,toMeasure:2,responsive:false,cooperative});
    if(kind==='layout-failure'){assert.equal(result.code,'engraving_renderFailed');assert.equal(result.cause.message,'original-layout-failure');assert.equal(document.querySelector('svg'),null);assert.equal(instances[0].GraphicSheet.reCalculate,instances[0].originalRecalculate);}
    else if(kind!=='native'){assert.equal(result.code,'engraving_projection');assert.equal(instances.length,0,'Ineligible data never reaches the renderer');}
    else{
      assert.equal(result.ok,true,result.message);assert.equal(instances[0].updates,1);assert.equal(instances[0].renders,1);
      assert.equal(result.metadata.measureCount,2);assert.equal(result.metadata.fromMeasure,1);assert.equal(result.metadata.toMeasure,2);assert.equal(result.metadata.modelFragmentCount,4);
      assert.deepEqual(result.metadata.modelMeasureFragments.map(fragment=>fragment.source_measure_index),[0,0,1,1]);
      assert.equal(result.mappingStatus().segmentCount,4);assert.equal(result.mappingStatus().displayedSegmentCount,4);result.dispose();
    }
    assert.equal(JSON.stringify(data),before);
  }
});

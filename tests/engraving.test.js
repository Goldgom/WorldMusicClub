import test from 'node:test';
import assert from 'node:assert/strict';
import {DOMParser} from 'linkedom';
import {createRequire} from 'node:module';
import {createI18n} from '../web/i18n.js';
import {validateEngravingInput, renderEngravedStaff, disposeEngravedStaff, ENGRAVING_LIMITS, EXACT_RHYTHM_LIMITS} from '../web/engraving.js';
import {createEngravingRenderScheduler,notationAudioAdmission} from '../web/engraving-render-scheduler.js';

// Deliberately small DOM/renderer doubles. These exercise the adapter, not OSMD's glyph/layout code.
class Element {
  constructor(name, document) { this.localName = name; this.nodeType = 1; this.ownerDocument = document; this.childNodes = []; this.attributes = []; this.style = {}; this.namespaceURI = ''; this.clientWidth = 900; }
  get children() { return this.childNodes.filter(node => node.nodeType === 1); }
  get textContent() { return this.childNodes.map(node => node.nodeValue ?? node.textContent ?? '').join(''); }
  set textContent(text) { this.childNodes = [{nodeType: 3, nodeValue: text, parentNode: this}]; }
  setAttribute(name, value) { const item = this.attributes.find(item => item.name === name); if (item) item.value = String(value); else this.attributes.push({name, value: String(value)}); }
  getAttribute(name) { return this.attributes.find(item => item.name === name)?.value ?? null; }
  appendChild(child) { child.remove?.(); this.childNodes.push(child); child.parentNode = this; this.onAppend?.(child); return child; }
  replaceChildren(...children) { for (const child of this.children) child.parentNode = null; this.childNodes = []; for (const child of children) this.appendChild(child); }
  remove() { if (this.parentNode) { const index = this.parentNode.childNodes.indexOf(this); if (index >= 0) this.parentNode.childNodes.splice(index, 1); this.parentNode = null; } }
  querySelector(name) { return this.children.find(child => child.localName === name) ?? this.children.map(child => child.querySelector(name)).find(Boolean) ?? null; }
}
function scoreDocument({notes = 3, parts = 1, measures = 4, badTag, attribute, musicalValue, malformed = false} = {}) {
  const document = {createElement(name) { return new Element(name, this); }};
  const root = document.createElement(malformed ? 'parsererror' : 'score-partwise');
  document.documentElement = root;
  document.getElementsByTagName = name => { const all = []; const visit = node => { if (name === '*' || node.localName === name) all.push(node); for (const child of node.children) visit(child); }; visit(root); return all; };
  for (let partIndex = 0; partIndex < parts; partIndex++) {
    const part = root.appendChild(document.createElement('part')); part.setAttribute('id', `P${partIndex + 1}`);
    for (let index = 0; index < measures; index++) { const measure = part.appendChild(document.createElement('measure')); measure.setAttribute('number', index + 1); if (!index) for (let noteIndex = 0; noteIndex < notes; noteIndex++) measure.appendChild(document.createElement('note')); }
  }
  if (badTag) root.children[0].children[0].appendChild(document.createElement(badTag));
  if (attribute) root.setAttribute(...attribute);
  if (musicalValue) { const node = root.children[0].children[0].appendChild(document.createElement(musicalValue[0])); node.textContent = musicalValue[1]; }
  return document;
}
const xml = '<?xml version="1.0"?><score-partwise/>';
const parserFor = document => class { parseFromString(input, type) { assert.equal(typeof input, 'string'); assert.equal(type, 'application/xml'); return document; } };
const validate = (blueprint = {}, options = {}) => validateEngravingInput(xml, options, parserFor(scoreDocument(blueprint)));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return {promise, resolve, reject}; };
const tick = () => new Promise(resolve => setImmediate(resolve));
function environment({load, failure, parts = 1, notes = 3, version = '2.1.3-release', withoutBundle = false, empty = false} = {}) {
  const instances = [], observers = [], frames = new Map(), scripts = [];
  const document = {createElement(name) { return new Element(name, this); }};
  const sourceDocument = scoreDocument({parts, notes});
  const view = {DOMParser: parserFor(sourceDocument), ResizeObserver: class {constructor(callback) {this.callback = callback; observers.push(this);} observe(target) {this.target = target;} disconnect() {this.disconnected = true;}}, requestAnimationFrame(callback) {const id = frames.size + 1; frames.set(id, callback); return id;}, cancelAnimationFrame(id) {frames.delete(id);}};
  document.defaultView = view;
  class Renderer {
    constructor(mount, options) { this.mount = mount; this.options = options; this.Version = version; this.EngravingRules = {}; this.Sheet = {Instruments: Array.from({length: parts}, (_, index) => ({IdString: `P${index + 1}`, Visible: true}))}; this.renders = 0; instances.push(this); }
    load(content) { assert.equal(content, sourceDocument); this.loaded = content; return load ? load(this, instances.length) : Promise.resolve(); }
    updateGraphic() { this.updated = true; }
    render() { this.renders++; if (failure) throw Error('layout failure'); if (!empty) this.mount.appendChild(document.createElement('svg')); }
    clear() { this.cleared = true; this.mount.replaceChildren(); }
  }
  if (!withoutBundle) view.opensheetmusicdisplay = {OpenSheetMusicDisplay: Renderer};
  document.head = document.createElement('head');
  document.head.onAppend = script => { scripts.push(script); queueMicrotask(() => script.onerror?.()); };
  const container = document.createElement('section');
  return {document, view, container, instances, observers, frames, scripts, Renderer};
}

test('preflight rejects URL, DTD, entities and processing instructions before parsing or loading', () => {
  const mustNotParse = class {constructor() {throw Error('unexpected parser');}};
  for (const input of ['https://example.test/score.xml', 'data:text/xml,<score-partwise/>', new URL('https://example.test')]) assert.equal(validateEngravingInput(input, {}, mustNotParse).status, 'invalid');
  for (const input of ['<!DOCTYPE score-partwise SYSTEM "http://example.test/dtd"><score-partwise/>', '<!ENTITY x "hi"><score-partwise/>', '<?xml-stylesheet href="test"?><score-partwise/>']) assert.equal(validateEngravingInput(input, {}, mustNotParse).status, 'unsupported');
  assert.equal(validateEngravingInput('<' + 'x'.repeat(ENGRAVING_LIMITS.xmlBytes), {}, mustNotParse).status, 'unsupported');
});

test('preflight accepts canonical XML declaration and bounds all score parts before paging', () => {
  assert.equal(validate().ok, true);
  assert.equal(validate({notes: 2001}).status, 'unsupported');
  assert.equal(validate({notes: 8193}, {identity: {}}).code, 'engraving_sourceNotes');
  assert.equal(validate({measures: 513}).status, 'unsupported');
  assert.equal(validate({parts: 17}).status, 'unsupported');
  assert.equal(validate({notes: 1001, parts: 2}).status, 'unsupported');
  assert.equal(validate({notes: 0}).status, 'unsupported');
  assert.equal(validate({malformed: true}).status, 'invalid');
  assert.equal(validateEngravingInput(xml, {}, undefined).status, 'unavailable');
});

test('preflight rejects executable/resource markup and extreme numerical layout requests', () => {
  for (const badTag of ['script', 'image', 'credit-image', 'link', 'iframe', 'opus', 'foreignObject']) assert.equal(validate({badTag}).status, 'unsupported');
  for (const attribute of [['onclick', 'bad()'], ['href', 'https://bad.test'], ['xlink:href', '#reference'], ['xml:base', '/other/'], ['style', 'color:red'], ['color', 'url(https://bad.test)']]) assert.equal(validate({attribute}).status, 'unsupported');
  for (const musicalValue of [['staves', '999999'], ['staff', '99'], ['duration', '1e99'], ['beats', '999999'], ['divisions', '0'], ['voice', 'wmh-lane-1'], ['voice', 'track-0'], ['voice', '01'], ['voice', '0']]) assert.equal(validate({musicalValue}).status, 'unsupported');
  assert.equal(validate({musicalValue: ['fifths', '-3']}).ok, true);
});

// Original synthetic pitches only. These ratios describe timing, not a private melody.
function exactRhythmXml({actual = 240, normal = 227, duration = 227, divisions = 480, type = 'eighth', normalType = type, extra = '', tail = ''} = {}) {
  return `<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Synthetic rhythm</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>${divisions}</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes><note id="synthetic-C"><pitch><step>C</step><octave>4</octave></pitch><duration>${duration}</duration><voice>1</voice><type>${type}</type><time-modification><actual-notes>${actual}</actual-notes><normal-notes>${normal}</normal-notes><normal-type>${normalType}</normal-type></time-modification><staff>1</staff>${extra}</note></measure>${tail}</part></score-partwise>`;
}
class XmlParser extends DOMParser {
  parseFromString(source, type) {
    const document = super.parseFromString(source, type), find = document.getElementsByTagName.bind(document);
    // Linkedom 0.18's XML wildcard lookup is empty and its unnamespaced XML uses
    // the HTML namespace. Normalize these two DOM limitations for this test.
    document.getElementsByTagName = name => name === '*' ? document.querySelectorAll('*') : find(name);
    for (const element of document.querySelectorAll('*')) Object.defineProperty(element, 'namespaceURI', {value: null});
    return document;
  }
}
const validateExactRhythm = (source, options = {}) => validateEngravingInput(source, options, XmlParser);

test('exact canonical rhythms accept bounded ratios without changing XML, note counts or range', () => {
  assert.deepEqual(EXACT_RHYTHM_LIMITS, {component: 2048, divisions: 2048});
  for (const spelling of [
    {}, // 227/480 quarter beats, written eighth with 240:227
    {actual: 1920, normal: 1919, duration: 1919, type: 'whole'},
    {actual: 960, normal: 911, duration: 911, type: 'half'},
    {actual: 129, normal: 128, duration: 128, divisions: 129, type: 'quarter'},
    {actual: 2048, normal: 2047, duration: 2047, divisions: 2048, type: 'quarter'},
    {actual: 129, normal: 128, duration: 4, divisions: 129, type: '128th'},
  ]) {
    const source = exactRhythmXml(spelling), before = new DOMParser().parseFromString(source, 'application/xml').toString();
    const checked = validateExactRhythm(source);
    assert.equal(checked.ok, true, checked.code);
    assert.equal(checked.document.toString(), before, 'Preflight never rewrites rhythm or source identity');
    assert.deepEqual(checked.metadata, {noteCount: 1, measureCount: 1, partIds: ['P1'], fromMeasure: 1, toMeasure: 1});
  }
  assert.equal(validateExactRhythm(exactRhythmXml({actual: 240, normal: 227, duration: 227, divisions: 1920, type: '32nd'})).ok, true);
});

test('extended rhythm admission is paired, reduced, source-wide and limited to canonical plain notation', () => {
  const source = exactRhythmXml();
  const refused = [
    exactRhythmXml({actual: 2049}), exactRhythmXml({normal: 2049}),
    exactRhythmXml({duration: 228}), exactRhythmXml({duration: 0}),
    exactRhythmXml({actual: 480, normal: 454}),
    exactRhythmXml({actual: 240, normal: 120, duration: 120}),
    exactRhythmXml({actual: 160, normal: 227, duration: 681}),
    exactRhythmXml({type: '256th'}), exactRhythmXml({type: '__proto__'}),
    exactRhythmXml({normalType: 'quarter'}), exactRhythmXml({extra: '<dot/>'}),
    exactRhythmXml({divisions: 3840, duration: 1816}),
    source.replace('<normal-notes>227</normal-notes>', ''),
    source.replace('<actual-notes>240</actual-notes>', '<actual-notes><type>240</type></actual-notes>'),
    source.replace('<actual-notes>240</actual-notes>', '<actual-notes>240</actual-notes><actual-notes>240</actual-notes>'),
    source.replace('</time-modification>', '<normal-dot/></time-modification>'),
    source.replace('<normal-type>eighth</normal-type>', ''),
    source.replace('</time-modification>', '</time-modification><time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>'),
    source.replace('<divisions>480</divisions>', ''),
    source.replace('<note id="synthetic-C">', '<note id="synthetic-C"><notations><tuplet type="start" number="1"/></notations>'),
    source.replace('</part></score-partwise>', '</part><part id="P2"><measure number="1"><attributes><divisions>960</divisions></attributes></measure></part></score-partwise>'),
  ];
  for (const input of refused) assert.equal(validateExactRhythm(input).code, 'engraving_exactRhythm', input);
  assert.equal(validate({musicalValue: ['actual-notes', '240']}).code, 'engraving_exactRhythm');
  const later = source.replace('<duration>227</duration>', '<duration>228</duration>').replace('<measure number="1">', '<measure number="2">');
  const paged = later.replace('<part id="P1">', '<part id="P1"><measure number="1"><note/></measure>');
  assert.equal(validateExactRhythm(paged, {fromMeasure: 1, toMeasure: 1}).code, 'engraving_exactRhythm', 'Paging never bypasses full-source rhythm validation');
  const tooManyNotes = source.replace('</measure>', `${'<note><rest/><duration>1</duration></note>'.repeat(2000)}</measure>`);
  assert.equal(validateExactRhythm(tooManyNotes).code, 'engraving_notes', 'Extended ratios never increase the full-score note/rest budget');
  // Ordinary existing tuplets retain their former admission path.
  assert.equal(validateExactRhythm(exactRhythmXml({actual: 3, normal: 2, duration: 160, extra: '<notations><tuplet type="start" number="1"/></notations>'})).ok, true);
});

test('unsupported exact rhythm diagnostics keep their code and translate without changing source', () => {
  const i18n = createI18n(), source = exactRhythmXml({actual: 2049});
  const checked = validateExactRhythm(source, {i18n});
  assert.equal(checked.code, 'engraving_exactRhythm');assert.match(checked.message, /2,048/);
  i18n.setLocale('en');assert.match(checked.message, /score timing is preserved/);
  assert.deepEqual(i18n.getReports(), []);
});

test('pinned OSMD reader preserves exact extended fractions and source note IDs without layout', () => {
  const previousSelf = globalThis.self, previousNode = globalThis.Node;
  try {
    globalThis.self = globalThis;
    const osmd = createRequire(import.meta.url)('opensheetmusicdisplay');
    const source = exactRhythmXml().replace('</note></measure>', '</note><note id="synthetic-D"><pitch><step>D</step><octave>4</octave></pitch><duration>1693</duration><voice>1</voice><type>whole</type><time-modification><actual-notes>1920</actual-notes><normal-notes>1693</normal-notes><normal-type>whole</normal-type></time-modification><staff>1</staff></note></measure>');
    const checked = validateExactRhythm(source);
    assert.equal(checked.ok, true);
    const xmlBefore = checked.document.toString();
    globalThis.Node = checked.document.defaultView.Node;
    const reader = new osmd.MusicSheetReader([], new osmd.EngravingRules());
    const sheet = reader.createMusicSheet(new osmd.IXmlElement(checked.document.documentElement), 'original-exact-rhythm');
    const measure = sheet.SourceMeasures[0], notes = measure.VerticalSourceStaffEntryContainers.flatMap(container => container.StaffEntries.flatMap(staff => staff?.VoiceEntries.flatMap(voice => voice.Notes) || []));
    const equalWhole = (fraction, n, d) => {
      const numerator = BigInt(fraction.Numerator) + BigInt(fraction.WholeValue) * BigInt(fraction.Denominator);
      assert.equal(numerator * BigInt(d), BigInt(n) * BigInt(fraction.Denominator));
    };
    assert.equal(notes.length, 2, 'No ratio-sized note duplication or lost canonical notes');
    equalWhole(notes[0].Length, 227, 1920);equalWhole(notes[1].Length, 1693, 1920);
    equalWhole(notes[0].ParentVoiceEntry.Timestamp, 0, 1);equalWhole(notes[1].ParentVoiceEntry.Timestamp, 227, 1920);
    equalWhole(measure.Duration, 1, 1);
    assert.equal(checked.document.getElementsByTagName('note')[0].getAttribute('id'), 'synthetic-C');
    assert.equal(checked.document.toString(), xmlBefore, 'The original XML and IDs remain unchanged');
  } finally {
    if (previousSelf === undefined) delete globalThis.self; else globalThis.self = previousSelf;
    if (previousNode === undefined) delete globalThis.Node; else globalThis.Node = previousNode;
  }
});

test('range and part options are explicit and never silently clamp user requests', () => {
  const checked = validate({measures: 90, parts: 2});
  assert.deepEqual([checked.options.fromMeasure, checked.options.toMeasure], [1, 32]);
  assert.equal(validate({measures: 90}, {fromMeasure: 1, toMeasure: 65}).status, 'unsupported');
  for (const options of [{fromMeasure: 0}, {toMeasure: 5}, {partIds: []}, {partIds: ['missing']}, {partIds: ['P1', 'P1']}, {zoom: 9}, {width: 100}, {compactHeader:'false'}, {cooperative:'false'}, null]) assert.equal(validate({}, options).status, 'invalid');
  assert.deepEqual(validate({parts: 2}, {partIds: ['P2']}).options.partIds, ['P2']);
});

test('renderer receives a parsed Document with SVG-only bounded options and selected parts', async () => {
  const env = environment({parts: 2});
  const outcome = await renderEngravedStaff(env.container, xml, {dark: true, partIds: ['P2'], fromMeasure: 2, toMeasure: 3});
  assert.equal(outcome.status, 'ready');
  assert.equal(env.container.children.length, 1);
  assert.ok(env.container.querySelector('svg'));
  const renderer = env.instances[0];
  assert.equal(renderer.options.backend, 'svg');
  assert.equal(renderer.options.autoResize, false);
  assert.equal(renderer.options.autoGenerateMultipleRestMeasuresFromRestMeasures, false);
  assert.equal(renderer.options.disableCursor, true);
  assert.equal(renderer.options.darkMode, true);
  assert.equal(renderer.options.drawFromMeasureNumber, 2);
  assert.equal(renderer.options.drawTitle,true);assert.equal(renderer.options.drawComposer,true);
  assert.deepEqual(renderer.EngravingRules, {MinMeasureToDrawIndex: 1, MaxMeasureToDrawIndex: 2, MinMeasureToDrawNumber: 0, MaxMeasureToDrawNumber: 0});
  assert.deepEqual(renderer.Sheet.Instruments.map(part => part.Visible), [false, true]);
  assert.equal(renderer.updated, true);
  outcome.dispose();
  assert.equal(env.container.children.length, 0);
  assert.equal(env.observers[0].disconnected, true);
  assert.equal(outcome.resize(), false);
});

test('compact dock headers change only renderer layout and preserve all source measure metadata',async()=>{
  const env=environment();const output=await renderEngravedStaff(env.container,xml,{compactHeader:true});assert.equal(output.status,'ready');
  const renderer=env.instances[0];assert.equal(renderer.options.drawTitle,false);assert.equal(renderer.options.drawSubtitle,false);assert.equal(renderer.options.drawComposer,false);assert.equal(renderer.options.drawPartNames,true);assert.equal(renderer.options.drawTimeSignatures,true);assert.equal(renderer.EngravingRules.PageTopMargin,1);assert.equal(renderer.EngravingRules.PageTopMarginNarrow,1);assert.equal(output.metadata.noteCount,validate().metadata.noteCount);assert.equal(output.metadata.measureCount,validate().metadata.measureCount);output.dispose();
});

test('missing assets fail clearly without replacing the existing basic view', async () => {
  const env = environment({withoutBundle: true});
  const fallback = env.container.appendChild(env.document.createElement('svg'));
  const outcome = await renderEngravedStaff(env.container, xml);
  assert.equal(outcome.status, 'unavailable');
  assert.equal(env.container.children[0], fallback);
  assert.match(env.scripts[0].src, /\/web\/vendor\/opensheetmusicdisplay\.min\.js$/);
  assert.match(env.scripts[0].integrity, /^sha256-/);
  assert.equal(env.scripts[0].parentNode, null);
  assert.equal(env.scripts[0].onload, null);
});

test('failed loader can retry, but concurrent callers share a single fixed asset load', async () => {
  const env = environment({withoutBundle: true});
  await renderEngravedStaff(env.container, xml);
  env.document.head.onAppend = script => { env.scripts.push(script); queueMicrotask(() => {env.view.opensheetmusicdisplay = {OpenSheetMusicDisplay: env.Renderer}; script.onload?.();}); };
  const second = env.document.createElement('section');
  const outcomes = await Promise.all([renderEngravedStaff(env.container, xml), renderEngravedStaff(second, xml)]);
  assert.ok(outcomes.every(outcome => outcome.ok));
  assert.equal(env.scripts.length, 2); // one failed request and one shared successful retry
  outcomes.forEach(outcome => outcome.dispose());
});

test('out-of-order loads never overwrite a newer score or dispose its DOM', async () => {
  const oldLoad = deferred();
  const env = environment({load: (_, count) => count === 1 ? oldLoad.promise : Promise.resolve()});
  const first = renderEngravedStaff(env.container, xml);
  await tick();
  const latest = await renderEngravedStaff(env.container, xml);
  assert.equal(latest.ok, true);
  const published = env.container.children[0];
  assert.equal((await first).status, 'cancelled');
  oldLoad.resolve(); await tick();
  assert.equal(env.container.children[0], published);
  assert.equal(env.instances[0].renders, 0);
  assert.equal(env.instances[0].cleared, true);
  latest.dispose();
});

test('abort during load and after display releases observers, listeners and owned DOM', async () => {
  const pending = deferred();
  const env = environment({load: () => pending.promise});
  const listeners = new Set();
  const signal = {aborted: false, addEventListener(type, listener) {listeners.add(listener);}, removeEventListener(type, listener) {listeners.delete(listener);}};
  const run = renderEngravedStaff(env.container, xml, {}, signal);
  await tick(); signal.aborted = true; [...listeners].forEach(listener => listener());
  assert.equal((await run).status, 'cancelled');
  pending.reject(Error('late failure')); await tick();
  assert.equal(listeners.size, 0);
  assert.equal(env.container.children.length, 0);
  const readyEnv = environment(); const controller = new AbortController();
  assert.equal((await renderEngravedStaff(readyEnv.container, xml, {}, controller.signal)).ok, true);
  controller.abort();
  assert.equal(readyEnv.observers[0].disconnected, true);
  assert.equal(readyEnv.container.children.length, 0);
});

test('responsive render coalesces width changes and cleanup cancels queued work', async () => {
  const env = environment();
  const outcome = await renderEngravedStaff(env.container, xml);
  env.container.clientWidth = 700;
  env.observers[0].callback(); env.observers[0].callback();
  assert.equal(env.frames.size, 1);
  const callbacks = [...env.frames.values()]; env.frames.clear(); callbacks.forEach(callback => callback());
  assert.equal(env.instances[0].renders, 2);
  assert.equal(env.container.children[0].style.width, '700px');
  env.container.clientWidth = 800; env.observers[0].callback();
  disposeEngravedStaff(env.container);
  assert.equal(env.frames.size, 0);
  assert.equal(outcome.resize(), false);
  disposeEngravedStaff(env.container); // idempotent
});

test('audio admission defers first bundle injection and cancels superseded notation before any parse', async () => {
  const env = environment({withoutBundle:true}), admission = notationAudioAdmission(env.view), audio = await admission.acquireAudio();
  const controller = new AbortController(), pending = renderEngravedStaff(env.container,xml,{},controller.signal);
  await tick(); assert.equal(env.scripts.length,0); assert.equal(env.instances.length,0);
  controller.abort(); assert.equal((await pending).status,'cancelled'); audio.release(); await tick();
  assert.equal(env.scripts.length,0); assert.equal(env.instances.length,0);
});

test('a canceled in-flight bundle retains its native evaluation fence until actual load finishes', async () => {
  const env = environment({withoutBundle:true}), admission = notationAudioAdmission(env.view), controller = new AbortController();
  env.document.head.onAppend = script => env.scripts.push(script);
  const pending = renderEngravedStaff(env.container,xml,{},controller.signal); await tick(); assert.equal(env.scripts.length,1);
  let admitted = false; const audio = admission.acquireAudio().then(lease => { admitted=true; return lease; });
  controller.abort(); assert.equal((await pending).status,'cancelled'); await tick(); assert.equal(admitted,false);
  env.view.opensheetmusicdisplay={OpenSheetMusicDisplay:env.Renderer}; env.scripts[0].onload();
  const lease = await audio; assert.equal(admitted,true); assert.equal(env.instances.length,0); lease.release();
});

test('the original bundle deadline rejects pending audio without admitting a later native evaluation', async () => {
  const env=environment({withoutBundle:true}),admission=notationAudioAdmission(env.view);let timeout;
  env.view.setTimeout=(callback,milliseconds)=>{assert.equal(milliseconds,8000);timeout=callback;return 1;};env.view.clearTimeout=()=>{};
  env.document.head.onAppend=script=>env.scripts.push(script);
  const rendering=renderEngravedStaff(env.container,xml);await tick();
  const audio=admission.acquireAudio(),rejected=assert.rejects(audio,{code:'notation_audio_reload_required'});
  timeout();assert.equal((await rendering).status,'unavailable');await rejected;
  // Removing/hiding the failed score is not proof that its requested script
  // cannot still execute. Every explicit Start fails promptly, without a timer.
  disposeEngravedStaff(env.container);env.container.remove();
  for(let attempt=0;attempt<3;attempt++){
    let settled=false;const start=admission.acquireAudio().catch(error=>{settled=true;assert.equal(error.code,'notation_audio_reload_required');});
    await tick();assert.equal(settled,true,'A future Start must reject rather than remain pending');await start;
  }
  env.view.opensheetmusicdisplay={OpenSheetMusicDisplay:env.Renderer};env.scripts[0].onload();await tick();
  const explicit=await admission.acquireAudio();assert.equal(env.instances.length,0);explicit.release();
});

test('audio admission waits for owned renderer load while new renders and resize cannot overtake it', async () => {
  const held = deferred(), env = environment({load:(_,count)=>count===1?held.promise:Promise.resolve()}), admission=notationAudioAdmission(env.view);
  const first = renderEngravedStaff(env.container,xml); await tick();
  let admitted=false;const audio=admission.acquireAudio().then(lease=>{admitted=true;return lease;});
  const next=env.document.createElement('section'),second=renderEngravedStaff(next,xml);await tick();assert.equal(env.instances.length,1);assert.equal(admitted,false);
  held.resolve();const painted=await first,lease=await audio;assert.equal(env.instances.length,1);
  env.container.clientWidth=700;env.observers[0].callback();const frames=[...env.frames.values()];env.frames.clear();frames.forEach(frame=>frame());
  assert.equal(env.instances[0].renders,1);assert.equal(painted.resize(),true);env.container.clientWidth=600;
  lease.release();const other=await second;await tick();assert.equal(env.instances[0].renders,2);assert.equal(env.container.children[0].style.width,'600px');
  const nextAudio=await admission.acquireAudio();env.container.clientWidth=500;painted.resize();painted.dispose();nextAudio.release();await tick();assert.equal(env.instances[0].renders,2);other.dispose();
});

test('layout errors, empty output and mismatched bundle versions return truthful status', async () => {
  for (const settings of [{failure: true}, {empty: true}, {version: '1.0'}]) {
    const env = environment(settings);
    const outcome = await renderEngravedStaff(env.container, xml);
    assert.equal(outcome.status, settings.version ? 'unavailable' : 'error');
    assert.equal(env.container.children.length, 0);
    assert.equal(env.instances[0].cleared, true);
  }
});


test('pre-aborted render does not parse or request a bundle', async () => {
  const env = environment({withoutBundle: true});
  env.view.DOMParser = class {constructor() {throw Error('must not parse');}};
  const controller = new AbortController(); controller.abort();
  assert.equal((await renderEngravedStaff(env.container, xml, {}, controller.signal)).status, 'cancelled');
  assert.equal(env.scripts.length, 0);
});

test('a later resize failure releases resources and reports an explicit fallback reason', async () => {
  const env = environment(); const failures = [];
  const outcome = await renderEngravedStaff(env.container, xml, {onError: failure => failures.push(failure)});
  env.instances[0].render = () => {throw Error('resize failure');};
  env.container.clientWidth = 1000;
  assert.equal(outcome.resize(), false);
  assert.equal(failures[0].status, 'error');
  assert.equal(failures[0].code, 'engraving_resize');
  assert.match(failures[0].message, /简化视图/);
  assert.equal(env.observers[0].disconnected, true);
  assert.equal(env.container.children.length, 0);
});

import "./engraving-note-map.test.js";

test('OSMD loading and mounted ARIA follow the shared locale without restarting rendering or changing source XML',async()=>{
  const i18n=createI18n(),pending=deferred(),env=environment({load:()=>pending.promise});
  const request=renderEngravedStaff(env.container,xml,{i18n,fromMeasure:2,toMeasure:3});
  await tick();
  const mount=env.container.children[0],renderer=env.instances[0],source=renderer.loaded;
  assert.match(mount.getAttribute('aria-label'),/第 2 至 3 小节/);
  i18n.setLocale('en');
  assert.equal(env.container.children[0],mount);assert.equal(env.instances.length,1);assert.equal(renderer.renders,0);
  assert.match(mount.getAttribute('aria-label'),/measures 2 to 3/);
  pending.resolve();const result=await request;
  assert.equal(result.status,'ready');assert.equal(renderer.loaded,source);assert.equal(renderer.renders,1);
  const svg=mount.querySelector('svg');
  i18n.setLocale('zh-CN');i18n.invalidate();
  assert.equal(env.container.children[0],mount);assert.equal(mount.querySelector('svg'),svg);assert.equal(renderer.renders,1);
  assert.match(result.message,/已使用/);assert.match(mount.getAttribute('aria-label'),/第 2 至 3 小节/);
  assert.deepEqual(result.metadata,{noteCount:3,measureCount:4,partIds:['P1'],fromMeasure:2,toMeasure:3});
  const lastLabel=mount.getAttribute('aria-label');result.dispose();i18n.setLocale('en');
  assert.equal(mount.getAttribute('aria-label'),lastLabel,'Disposed mounts release locale observers');
  assert.deepEqual(i18n.getReports(),[]);
});

test('preflight failures retain stable codes and redraw messages from the selected locale',()=>{
  const i18n=createI18n(),value=validateEngravingInput('https://example.test/score.xml',{i18n});
  assert.equal(value.code,'engraving_input');assert.match(value.message,/不能使用网址或文件/);
  i18n.setLocale('en');assert.match(value.message,/MusicXML string/);assert.equal(value.code,'engraving_input');
  assert.deepEqual(i18n.getReports(),[]);
});

test('a locale switch cannot let a superseded pending renderer republish or change its successor',async()=>{
  const i18n=createI18n(),pending=deferred(),env=environment({load:(_,count)=>count===1?pending.promise:Promise.resolve()});
  const first=renderEngravedStaff(env.container,xml,{i18n});await tick();
  const firstMount=env.container.children[0];i18n.setLocale('en');
  const second=await renderEngravedStaff(env.container,xml,{i18n});const mount=env.container.children[0];
  i18n.setLocale('zh-CN');pending.resolve();assert.equal((await first).status,'cancelled');await tick();
  assert.equal(env.container.children[0],mount);assert.notEqual(mount,firstMount);assert.equal(env.instances[0].renders,0);
  assert.match(mount.getAttribute('aria-label'),/五线谱/);assert.equal(env.instances[1].renders,1);
  second.dispose();assert.deepEqual(i18n.getReports(),[]);
});

test('unknown OSMD failures retain the original exception behind a localized technical label',async()=>{
  const cause=Error('<literal OSMD failure>'),i18n=createI18n(),env=environment({load:()=>Promise.reject(cause)});
  const output=await renderEngravedStaff(env.container,xml,{i18n});
  assert.equal(output.code,'engraving_renderFailed');assert.equal(output.cause,cause);
  assert.match(output.message,/原始技术详情：<literal OSMD failure>/);i18n.setLocale('en');
  assert.match(output.message,/Original technical details: <literal OSMD failure>/);assert.equal(output.cause,cause);
  assert.equal(env.container.children.length,0);assert.deepEqual(i18n.getReports(),[]);
});

// An explicit event-loop double establishes phase ordering and cancellation,
// not wall-clock performance, actual browser paint, or OSMD glyph geometry.
function cooperativeEnvironment(settings = {}) {
  const env = environment(settings), timers = new Map(), events = [];
  let timerId = 0;
  env.view.setTimeout = callback => { const id = ++timerId; timers.set(id, callback); return id; };
  env.view.clearTimeout = id => timers.delete(id);
  const Parser = env.view.DOMParser;
  env.view.DOMParser = class extends Parser {
    parseFromString(...args) { events.push('validate'); return super.parseFromString(...args); }
  };
  env.view.opensheetmusicdisplay.OpenSheetMusicDisplay = class extends env.Renderer {
    load(...args) { events.push('load'); return super.load(...args); }
    updateGraphic() { events.push('graph'); return super.updateGraphic(); }
    render() { events.push('svg'); return super.render(); }
  };
  function frame() {
    const callbacks = [...env.frames.values()]; env.frames.clear();
    callbacks.forEach(callback => callback());
  }
  function task() {
    const callbacks = [...timers.values()]; timers.clear();
    callbacks.forEach(callback => callback());
  }
  return {...env, timers, events, frame, task, async advance() { frame(); task(); await tick(); }};
}

test('cooperative phases wait for a task after the frame, sharing only one outstanding wait', async () => {
  const env = cooperativeEnvironment(), scheduler = createEngravingRenderScheduler(env.view);
  let settled = false;
  const pending = scheduler.yield(); pending.then(() => { settled = true; });
  assert.equal(scheduler.yield(), pending);
  assert.equal(env.frames.size, 1); assert.equal(env.timers.size, 0);
  env.frame(); await tick();
  assert.equal(settled, false, 'Resolving inside rAF would extend the same pre-paint microtask chain');
  assert.equal(env.frames.size, 0); assert.equal(env.timers.size, 1);
  env.task(); assert.equal(await pending, true);
  assert.equal(env.frames.size + env.timers.size, 0);
  scheduler.dispose(); assert.equal(await scheduler.yield(), false);
});

test('cooperative waits cancel in hidden frames and queued tasks, with a task-only fallback', async () => {
  for (const afterFrame of [false, true]) {
    const env = cooperativeEnvironment(), scheduler = createEngravingRenderScheduler(env.view);
    const pending = scheduler.yield(); if (afterFrame) env.frame();
    scheduler.dispose(); scheduler.dispose();
    assert.equal(await pending, false); assert.equal(env.frames.size + env.timers.size, 0);
    env.frame(); env.task(); assert.equal(await scheduler.yield(), false);
  }
  const env = cooperativeEnvironment(); delete env.view.requestAnimationFrame;
  const scheduler = createEngravingRenderScheduler(env.view), pending = scheduler.yield();
  assert.equal(env.timers.size, 1); env.task(); assert.equal(await pending, true); scheduler.dispose();
});

test('four dense synthetic part renders cannot chain parsing, loading, graph, SVG and mapping in one frame', async () => {
  const env = cooperativeEnvironment({notes: 512}), outcomes = [], mappings = [];
  let finished = false;
  const batch = (async () => {
    for (let index = 0; index < 4; index++) {
      const container = env.document.createElement('section');
      outcomes.push(await renderEngravedStaff(container, xml, {cooperative: true, onMappingChange: () => mappings.push(index)}));
    }
    finished = true;
  })();
  let turns = 0;
  while (!finished && turns < 30) {
    const before = env.events.length;
    assert.equal(env.frames.size, 1); assert.equal(env.timers.size, 0);
    env.frame(); await tick();
    assert.equal(env.events.length, before, 'Animation frame callbacks do not execute the next expensive phase');
    assert.equal(env.frames.size, 0); assert.equal(env.timers.size, 1);
    env.task(); await tick();
    assert.ok(env.events.length - before <= 1, 'No second indivisible phase starts in the same task turn');
    turns++;
  }
  assert.equal(finished, true); await batch;
  assert.equal(turns, 24); assert.equal(outcomes.length, 4);
  assert.ok(outcomes.every(outcome => outcome.ok));
  assert.equal(outcomes.reduce((sum, outcome) => sum + outcome.metadata.noteCount, 0), 2048);
  assert.deepEqual(env.events, Array.from({length: 4}, () => ['validate', 'load', 'graph', 'svg']).flat());
  assert.deepEqual(mappings, [0, 1, 2, 3]);
  assert.ok(env.instances.every(renderer => renderer.renders === 1));
  assert.equal(env.frames.size + env.timers.size, 0);
  outcomes.forEach(outcome => outcome.dispose());
});

test('aborting at every cooperative phase settles immediately and never publishes a partial successor', async () => {
  for (let completedPhases = 0; completedPhases < 6; completedPhases++) {
    const env = cooperativeEnvironment(), controller = new AbortController();
    const pending = renderEngravedStaff(env.container, xml, {cooperative: true}, controller.signal);
    for (let index = 0; index < completedPhases; index++) await env.advance();
    const events = [...env.events]; controller.abort();
    assert.equal((await pending).status, 'cancelled');
    assert.equal(env.frames.size + env.timers.size, 0);
    assert.equal(env.container.children.length, 0);
    assert.ok(env.instances.every(renderer => renderer.cleared));
    env.frame(); env.task(); await tick(); assert.deepEqual(env.events, events);
  }
});

test('cancellation between a completed task and its promise continuation still prevents source parsing', async () => {
  const env = cooperativeEnvironment(), controller = new AbortController();
  const pending = renderEngravedStaff(env.container, xml, {cooperative: true}, controller.signal);
  env.frame(); env.task(); controller.abort();
  assert.equal((await pending).status, 'cancelled');
  assert.deepEqual(env.events, []); assert.equal(env.instances.length, 0);
});

test('a replacement owns the container before an older cooperative parse or SVG can resume', async () => {
  for (const completedPhases of [0, 5]) {
    const env = cooperativeEnvironment();
    const first = renderEngravedStaff(env.container, xml, {cooperative: true});
    for (let index = 0; index < completedPhases; index++) await env.advance();
    const latest = await renderEngravedStaff(env.container, xml);
    const published = env.container.children[0];
    assert.equal((await first).status, 'cancelled'); assert.equal(latest.ok, true);
    env.frame(); env.task(); await tick();
    assert.equal(env.container.children[0], published);
    assert.equal(env.frames.size + env.timers.size, 0); latest.dispose();
  }
});

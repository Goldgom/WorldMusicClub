import test from 'node:test';
import assert from 'node:assert/strict';
import {validateEngravingInput, renderEngravedStaff, disposeEngravedStaff, ENGRAVING_LIMITS} from '../web/engraving.js';

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
function environment({load, failure, parts = 1, version = '2.1.3-release', withoutBundle = false, empty = false} = {}) {
  const instances = [], observers = [], frames = new Map(), scripts = [];
  const document = {createElement(name) { return new Element(name, this); }};
  const sourceDocument = scoreDocument({parts});
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

test('range and part options are explicit and never silently clamp user requests', () => {
  const checked = validate({measures: 90, parts: 2});
  assert.deepEqual([checked.options.fromMeasure, checked.options.toMeasure], [1, 32]);
  assert.equal(validate({measures: 90}, {fromMeasure: 1, toMeasure: 65}).status, 'unsupported');
  for (const options of [{fromMeasure: 0}, {toMeasure: 5}, {partIds: []}, {partIds: ['missing']}, {partIds: ['P1', 'P1']}, {zoom: 9}, {width: 100}, {compactHeader:'false'}, null]) assert.equal(validate({}, options).status, 'invalid');
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
  assert.match(failures[0].message, /basic view/);
  assert.equal(env.observers[0].disconnected, true);
  assert.equal(env.container.children.length, 0);
});

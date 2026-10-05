import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {BasicKeyAudioReceiver} from '../web/basic-key-audio-receiver.js';
import {CanonicalAudioReceiver} from '../web/canonical-audio-receiver.js';
import {CanonicalAudioCore} from '../web/canonical-audio-core.js';
import {buildCanonicalAudioPlan, CANONICAL_AUDIO_POLICY} from '../web/canonical-audio-plan.js';
import {basicKeyAudioHarness} from './basic-key-audio-harness.js';
import {observeAudioAdmission, prepareAudioAdmissionDiagnostics, installAudioAdmissionDiagnostics} from './browser-audio-admission-diagnostics.js';

function originalPlan() {
  const f = JSON.parse(readFileSync(new URL('./fixtures/canonical-audio-evidence.json', import.meta.url)));
  return buildCanonicalAudioPlan(f.compilation, f.profile, {mode: 'practice', practiceSelection: {kind: 'parts', part_ids: ['人 手 🎹']}, acceptedPolicyId: CANONICAL_AUDIO_POLICY, sampleRate: 48000});
}

test('audio diagnostics keep the application CSP and use no runtime string compiler', () => {
  for (const path of ['./browser-audio-admission-diagnostics.js', './full-app-browser.test.js']) {
    const source = readFileSync(new URL(path, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /\beval\b|\bFunction\s*\(/, path);
    assert.doesNotMatch(source, /bypassCSP|setBypassCSP|unsafe-eval|content-security-policy/i, path);
  }
});

test('two-stage installer registers only a factory before navigation and observes receivers after readiness', async () => {
  const calls = []; let navigated = false, ready = false;
  const page = {
    async addInitScript(script) {
      assert.equal(navigated, false);
      assert.deepEqual(script, {content: `globalThis.__wmhObserveAudioAdmission = (${observeAudioAdmission.toString()});`});
      assert.doesNotMatch(script.content, /\bimport\s*\(|new\s+(?:AudioContext|AudioWorkletNode|OpenSheetMusicDisplay)\b/);
      calls.push('register factory');
    },
    async goto() { navigated = true; calls.push('navigate'); },
    async appReady() { assert.equal(navigated, true); ready = true; calls.push('app ready'); },
    async evaluate(callback, ...args) {
      assert.equal(ready, true); assert.equal(typeof callback, 'function'); assert.deepEqual(args, []);
      const source = callback.toString();
      assert.match(source, /import\('\/basic-key-audio-receiver\.js'\)/);
      assert.match(source, /import\('\/canonical-audio-receiver\.js'\)/);
      assert.match(source, /globalThis\.__wmhObserveAudioAdmission\(BasicKeyAudioReceiver, CanonicalAudioReceiver, globalThis\)/);
      assert.doesNotMatch(source, /opensheetmusicdisplay|renderEngravedStaff/);
      calls.push('observe receivers');
    },
  };
  await prepareAudioAdmissionDiagnostics(page);
  assert.deepEqual(calls, ['register factory'], 'Registration neither imports modules nor invokes observation');
  await page.goto(); await page.appReady(); await installAudioAdmissionDiagnostics(page);
  assert.deepEqual(calls, ['register factory', 'navigate', 'app ready', 'observe receivers']);
  const suite = readFileSync(new URL('./full-app-browser.test.js', import.meta.url), 'utf8');
  const bootstrap = suite.slice(suite.indexOf('beforeEach(async t =>'));
  const order = ['await prepareAudioAdmissionDiagnostics(page)', 'page.goto(origin,', 'await waitForPlaybackClock(page)', 'await installAudioAdmissionDiagnostics(page)', 'await startPreview()'].map(step => bootstrap.indexOf(step));
  assert.ok(order.every((index, i) => index >= 0 && (i === 0 || index > order[i - 1])), 'The real suite preserves the tested two-stage order before Play');
});

for (const lateSide of ['processor', 'main']) test(`actual canonical protocol evidence distinguishes a late ${lateSide} start without changing cancellation`, async () => {
  const h = basicKeyAudioHarness({autoMessages: false});
  const target = {performance: {now: () => h.context.currentTime * 1000}, document: {querySelector: () => ({textContent: 'Preparing generated staff preview'})}};
  const originalRequest = BasicKeyAudioReceiver.prototype.request, originalReceive = CanonicalAudioReceiver.prototype.receive;
  const diagnostics = observeAudioAdmission(BasicKeyAudioReceiver, CanonicalAudioReceiver, target);
  const r = await CanonicalAudioReceiver.create(h.context, h.output, {nodeFactory: () => h.nodeFactory({Core: CanonicalAudioCore})});
  try {
    const plan = originalPlan(), prep = r.prepare(plan);
    h.deliverCore(); h.finishPreparation(); h.deliverMain(); await prep;
    const starting = r.start(), rejected = assert.rejects(starting, {code: 'clean_late_start'});
    if (lateSide === 'main') h.deliverCore();
    for (let block = 0; block < 24; block++) h.renderBlock();
    if (lateSide === 'processor') h.deliverCore();
    h.deliverMain(); await rejected;
    const report = diagnostics.snapshot(), command = report.events.find(row => row.kind === 'command' && row.type === 'start');
    const receipt = report.events.find(row => row.kind === 'receipt' && row.requestId === command.requestId);
    assert.equal(command.anchorFrame - Math.round(command.audioTime * 48000), 2400, 'The existing 50 ms lead is unchanged');
    assert.equal(receipt.generation, command.generation);
    assert.equal(receipt.planGeneration, command.planGeneration);
    assert.equal(receipt.planFingerprint, plan.planFingerprint);
    assert.ok(receipt.audioTime * 48000 >= command.anchorFrame);
    if (lateSide === 'processor') { assert.equal(receipt.type, 'error'); assert.ok(receipt.frame >= command.anchorFrame); }
    else { assert.equal(receipt.type, 'started'); assert.ok(receipt.frame < command.anchorFrame); }
    const failure = report.events.find(row => row.kind === 'failure');
    assert.equal(failure.code, 'clean_late_start');
    assert.match(failure.message, lateSide === 'main' ? /acknowledgement arrived after/ : /anchor must be in the future/);
    assert.equal(failure.engravingStatus, 'Preparing generated staff preview');
    assert.equal(r.state, 'error'); assert.equal(h.nodes[0].connected, false);
    h.deliverCore(); assert.ok(h.renderBlock()[0].every(value => value === 0));
    assert.equal(report.longTasksSupported, false);
    assert.doesNotMatch(JSON.stringify(report), /"(?:notes|wire|ledger|buffer|source_note_ids)":/);
  } finally {
    r.dispose(); h.deliverCore(); h.deliverMain(); diagnostics.dispose();
    assert.equal(BasicKeyAudioReceiver.prototype.request, originalRequest);
    assert.equal(CanonicalAudioReceiver.prototype.receive, originalReceive);
  }
});

test('diagnostics preserve returned promises, bound records and drain pending long tasks', () => {
  const exact = Promise.resolve('unchanged'), queued = [], delivered = [];
  class Receiver {
    constructor() { this.context = {currentTime: 1, state: 'running', sampleRate: 48000}; this.generation = 1; this.planGeneration = 1; this.requestId = 1; this.state = 'ready'; }
    request() { return exact; }
    receive(message) { delivered.push(message); }
    fail(error) { delivered.push(error); }
  }
  class Canonical extends Receiver { receive(message) { return super.receive(message); } }
  class Observer {
    static supportedEntryTypes = ['longtask'];
    observe(options) { assert.deepEqual(options, {type: 'longtask', buffered: true}); }
    takeRecords() { return queued.splice(0); }
    disconnect() {}
  }
  const diagnostics = observeAudioAdmission(Receiver, Canonical, {performance: {now: () => 10}, PerformanceObserver: Observer});
  try {
    const r = new Canonical(); assert.equal(r.request('start', {anchorFrame: 50400}), exact);
    for (let index = 0; index < 150; index++) r.receive({type: 'started', requestId: index, ledger: new Float64Array(10), source_note_ids: ['private']});
    for (let index = 0; index < 70; index++) queued.push({startTime: index, duration: 55, name: 'self'});
    const first = diagnostics.snapshot();
    assert.equal(first.events.length, 128); assert.equal(first.droppedEvents, 23);
    assert.equal(delivered.length, 150, 'Canonical receipts are forwarded exactly once');
    assert.equal(first.longTasks.length, 64); assert.equal(first.droppedLongTasks, 6); assert.equal(first.longTasksSupported, true);
    first.events[0].type = 'mutated'; assert.equal(diagnostics.snapshot().events[0].type, 'started');
    assert.equal(diagnostics.snapshot().longTasks.length, 64, 'Drained tasks are not duplicated');
    assert.doesNotMatch(JSON.stringify(first), /private|ledger|source_note_ids/);
  } finally { diagnostics.dispose(); }
});

test('bundle load capture measures actual synchronous render overlap and preserves async load identity', () => {
  let wall = 20, capture;
  const exact = Promise.resolve(), failure = new Error('Original renderer failure');
  class Receiver { request() {} receive() {} fail() {} }
  class Canonical extends Receiver { receive() {} }
  class Renderer {
    load() { wall += 3; return exact; }
    updateGraphic() { wall += 65; return 'updated'; }
    render() { wall += 70; throw failure; }
  }
  const originalRender = Renderer.prototype.render;
  const target = {performance: {now: () => wall}, document: {
    addEventListener(type, callback, useCapture) { assert.equal(type, 'load'); assert.equal(useCapture, true); capture = callback; },
    removeEventListener(type, callback, useCapture) { assert.equal(type, 'load'); assert.equal(callback, capture); assert.equal(useCapture, true); },
  }};
  const diagnostics = observeAudioAdmission(Receiver, Canonical, target);
  try {
    assert.equal(diagnostics.snapshot().observedRenderer, false);
    target.opensheetmusicdisplay = {OpenSheetMusicDisplay: Renderer};
    capture({target: {tagName: 'SCRIPT', src: 'https://example.invalid/vendor/opensheetmusicdisplay.min.js'}});
    const renderer = new Renderer(); assert.equal(renderer.load('private XML'), exact);
    assert.equal(renderer.updateGraphic(), 'updated'); assert.throws(() => renderer.render(), error => error === failure);
    const report = diagnostics.snapshot(); assert.equal(report.observedRenderer, true);
    assert.deepEqual(report.renderPhases, [{phase: 'load_sync', startTime: 20, endTime: 23, duration: 3}, {phase: 'updateGraphic_sync', startTime: 23, endTime: 88, duration: 65}, {phase: 'render_sync', startTime: 88, endTime: 158, duration: 70}]);
    assert.doesNotMatch(JSON.stringify(report), /private XML/);
  } finally { diagnostics.dispose(); assert.equal(Renderer.prototype.render, originalRender); }
});

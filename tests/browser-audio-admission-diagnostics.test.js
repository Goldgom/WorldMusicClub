import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createContext, runInContext} from 'node:vm';
import {BasicKeyAudioReceiver} from '../web/basic-key-audio-receiver.js';
import {CanonicalAudioReceiver} from '../web/canonical-audio-receiver.js';
import {CanonicalAudioCore} from '../web/canonical-audio-core.js';
import {buildCanonicalAudioPlan, CANONICAL_AUDIO_POLICY} from '../web/canonical-audio-plan.js';
import {basicKeyAudioHarness} from './basic-key-audio-harness.js';
import {observeAudioAdmission, prepareAudioAdmissionDiagnostics, installAudioAdmissionDiagnostics, waitForOverlayPlayback, readPlaybackFailureState} from './browser-audio-admission-diagnostics.js';

function originalPlan(sampleRate = 48000) {
  const f = JSON.parse(readFileSync(new URL('./fixtures/canonical-audio-evidence.json', import.meta.url)));
  return buildCanonicalAudioPlan(f.compilation, f.profile, {mode: 'practice', practiceSelection: {kind: 'parts', part_ids: ['人 手 🎹']}, acceptedPolicyId: CANONICAL_AUDIO_POLICY, sampleRate});
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

for (const sampleRate of [44100, 48000]) for (const [kind, delta] of [['gap', 128], ['repeat', -128], ['backward', -256]]) {
  test(`canonical ${sampleRate} Hz ${kind} preserves actual discontinuity evidence without changing cancellation`, async () => {
    const h = basicKeyAudioHarness({sampleRate, autoMessages: false}), errors = [];
    const diagnostics = observeAudioAdmission(BasicKeyAudioReceiver, CanonicalAudioReceiver, {performance: {now: () => h.context.currentTime * 1000}});
    const r = await CanonicalAudioReceiver.create(h.context, h.output, {nodeFactory: () => h.nodeFactory({Core: CanonicalAudioCore}), onError: error => errors.push(error)});
    try {
      const preparation = r.prepare(originalPlan(sampleRate)); h.deliverCore(); h.finishPreparation(); h.deliverMain(); await preparation;
      const startedAfter = h.context.currentTime * 1000, start = r.start(); h.deliverCore(); h.deliverMain(); await start;
      for (let block = 0; block < 30; block++) h.renderBlock();
      const expectedFrame = h.frame, actualFrame = expectedFrame + delta, core = h.nodes[0].core;
      assert.ok(core.activeCount > 0, 'The discontinuity interrupts actual production voices');
      const channel = new Float32Array(128).fill(1); h.context.currentTime = actualFrame / sampleRate;
      core.process([channel], actualFrame); h.deliverMain();
      const details = {discontinuityKind: 'block-frame', expectedFrame, actualFrame, previousBlockFrame: expectedFrame - 128, previousBlockLength: 128, blockLength: 128, frameDelta: delta, successfulBlocks: 30};
      const report = diagnostics.snapshot(), receipt = report.events.find(row => row.type === 'error'), failure = report.events.find(row => row.kind === 'failure');
      assert.deepEqual(receipt.details, details); assert.deepEqual(failure.details, details);
      assert.deepEqual(diagnostics.failureSince(startedAfter).details, details);
      assert.equal(receipt.frame, actualFrame); assert.equal(receipt.sampleRate, sampleRate); assert.equal(receipt.planFingerprint, r.plan.planFingerprint);
      assert.equal(errors.length, 1); assert.equal(errors[0].code, 'audio_render_discontinuity');
      assert.equal(core.state, 'error'); assert.equal(core.activeCount, 0); assert.equal(r.state, 'error'); assert.equal(h.nodes[0].connected, false); assert.ok(channel.every(value => value === 0));
      failure.details.actualFrame = -1; assert.deepEqual(diagnostics.snapshot().events.find(row => row.kind === 'failure').details, details);
      const latest = diagnostics.failureSince(startedAfter); latest.details.frameDelta = 0; assert.deepEqual(diagnostics.failureSince(startedAfter).details, details);
      assert.equal(diagnostics.failureSince(latest.wallTime + 1), null, 'An already recorded older failure is excluded by the later observation boundary');
    } finally { r.dispose(); h.deliverCore(); h.deliverMain(); diagnostics.dispose(); }
  });
}

test('discontinuity evidence rejects unbounded nested data and unreadable fields while retaining the original failure', () => {
  const received = [];
  class Receiver {
    constructor() { this.context = {currentTime: 1, state: 'running', sampleRate: 44100}; }
    request() {} receive(message) { received.push(message); } fail(error) { received.push(error); }
  }
  class Canonical extends Receiver { receive(message) { return super.receive(message); } }
  const diagnostics = observeAudioAdmission(Receiver, Canonical, {performance: {now: () => 10}}), r = new Canonical();
  try {
    const details = Object.assign(Object.create({previousBlockFrame: 100}), {discontinuityKind: 'missed-attack', expectedFrame: 128, actualFrame: 256, previousBlockLength: 0, blockLength: 128, frameDelta: 128, successfulBlocks: 0, missedAttackIndex: 99999, notes: ['private-source'], arbitrary: new Float64Array(1024)});
    Object.defineProperty(details, 'previousBlockFrame', {get() { throw Error('Unreadable optional history'); }});
    const original = {type: 'error', code: 'audio_render_discontinuity', message: 'Original failure', details}; r.receive(original); r.fail(original);
    const expected = {discontinuityKind: 'missed-attack', expectedFrame: 128, actualFrame: 256, previousBlockLength: 0, blockLength: 128, frameDelta: 128, successfulBlocks: 0, missedAttackIndex: 99999};
    assert.deepEqual(diagnostics.snapshot().events[0].details, expected); assert.equal(received[0], original); assert.equal(received[1], original);
    const invalid = {discontinuityKind: 'unknown', expectedFrame: NaN, actualFrame: Infinity, previousBlockFrame: -1, previousBlockLength: 2 ** 32, blockLength: 0, frameDelta: Number.MAX_SAFE_INTEGER, successfulBlocks: '1', missedAttackIndex: 100000};
    for (const value of [invalid, ['private-source'], null]) { r.fail({...original, details: value}); assert.equal(diagnostics.failureSince(0).details, undefined); }
    r.fail(Object.defineProperty({...original}, 'details', {get() { throw Error('Unreadable details'); }}));
    assert.equal(diagnostics.failureSince(0).code, 'audio_render_discontinuity'); assert.equal(diagnostics.failureSince(0).message, 'Original failure');
    r.fail({...original, code: 'different_failure'}); assert.equal(diagnostics.failureSince(0).details, undefined);
    for (let index = 0; index < 150; index++) r.receive({type: 'snapshot'});
    assert.equal(diagnostics.snapshot().events.length, 128); assert.equal(diagnostics.failureSince(0).code, 'different_failure', 'The bounded terminal failure survives lifecycle event eviction');
    assert.doesNotMatch(JSON.stringify(diagnostics.snapshot()), /private-source|arbitrary/);
  } finally { diagnostics.dispose(); }
});

test('overlay waiter keeps its exact progress and cue condition and the original polling timeout', async () => {
  const states = [{positionMs: 0, hidden: false}, {positionMs: 300, hidden: true}, {positionMs: 301, hidden: false}, {positionMs: 301, hidden: true}];
  let disposed = 0, polls = 0;
  const realm = createContext({after: 123, __wmhAudioAdmissionDiagnostics: {failureSince: after => {assert.equal(after, 123); return null;}}});
  const page = {async waitForFunction(predicate, ...args) {
    assert.deepEqual(args, [123], 'No timeout or polling override is introduced');
    for (const state of states) {
      polls++; realm.__wmhReadPlaybackClock = () => ({positionMs: state.positionMs});
      realm.document = {querySelector: selector => {assert.equal(selector, '#stage-cue'); return {hidden: state.hidden};}};
      if (runInContext(`(${predicate.toString()})(after)`, realm)) return {async dispose() { disposed++; }};
    }
    throw Error('The original overlay condition was not reached');
  }};
  await waitForOverlayPlayback(page, 123); assert.equal(polls, 4); assert.equal(disposed, 1);
  const timeout = Object.assign(new Error('Original timeout'), {name: 'TimeoutError'});
  await assert.rejects(waitForOverlayPlayback({async waitForFunction() { throw timeout; }}, 123), error => error === timeout);
});

test('overlay waiter fails on a newly observed audio failure before a stale positive clock can pass', async () => {
  const failure = {code: 'audio_render_discontinuity', wallTime: 125, details: {expectedFrame: 128, actualFrame: 256, frameDelta: 128}};
  const realm = createContext({after: 123, __wmhAudioAdmissionDiagnostics: {failureSince: () => failure}, __wmhReadPlaybackClock() { throw Error('A failed audio clock cannot admit this overlay'); }});
  let calls = 0;
  await assert.rejects(waitForOverlayPlayback({async waitForFunction(predicate) { calls++; return runInContext(`(${predicate.toString()})(after)`, realm); }}, 123), error => {
    assert.match(error.message, /Newly observed audio failure during overlay playback/); assert.match(error.message, /audio_render_discontinuity/); assert.match(error.message, /"expectedFrame":128/); assert.match(error.message, /"frameDelta":128/); return true;
  });
  assert.equal(calls, 1);
});

test('failure-only playback observation preserves exact clock and bounded UI state without copying notation', () => {
  const clock = {positionMs: 74.80725623582766, phase: 'paused', running: false};
  const nodes = {'#stage-cue': {hidden: false, dataset: {cueState: 'paused'}}, '#written-cursor-status': {dataset: {sourceMeasureIndex: '0', sourceNoteIds: 'private-source'}}, '#session-mode': {value: 'listen'}, '#jianpu-button': {getAttribute: () => 'true'}, '#count-in': {checked: false}, '#engraving-follow': {checked: true}, '#notation-lane-overlay': {hidden: false}};
  const target = {innerWidth: 844, innerHeight: 390, __wmhReadPlaybackClock: () => clock, document: {querySelector: selector => nodes[selector], querySelectorAll: selector => selector.startsWith('#notation') ? [{}, {}] : []}};
  const result = readPlaybackFailureState(target);
  assert.equal(result.clock, clock); assert.deepEqual(result, {viewport: {width: 844, height: 390}, clock, sessionMode: 'listen', notationView: 'jianpu', cueHidden: false, cueState: 'paused', countIn: false, following: true, overlayHidden: false, sourceMeasureIndex: 0, currentMarkers: {staff: 0, jianpu: 2}});
  assert.doesNotMatch(JSON.stringify(result), /private-source/);
  target.__wmhReadPlaybackClock = () => { throw Error('Malformed published clock'); };
  assert.deepEqual(readPlaybackFailureState(target).clock, {observationError: 'Malformed published clock'});
});

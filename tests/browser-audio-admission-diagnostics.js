/** Test-only observation of the real production receiver. No audio command,
 * promise, deadline, generation or clock is replaced. Keep only bounded scalar
 * lifecycle evidence; never copy source notes, transfer buffers or PCM. */
export function observeAudioAdmission(BasicReceiver, CanonicalReceiver, target = globalThis) {
  const events = [], longTasks = [], renderPhases = [], receivers = new WeakMap(), renderers = new WeakSet(), restores = [];
  let serial = 0, droppedEvents = 0, droppedLongTasks = 0, droppedRenderPhases = 0, observedRenderer = false, observer = null, lastFailure = null;
  const fields = ['type', 'generation', 'planGeneration', 'requestId', 'frame', 'anchorFrame', 'resumeFrame', 'positionFrame', 'sampleRate', 'sourceFingerprint', 'compiledFingerprint', 'selectionFingerprint', 'planFingerprint', 'sourceSha256', 'policyId', 'identityKind', 'code', 'message'];
  const integer = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;
  const maxFrame = 2 ** 48, maxBlock = 0xffffffff, maxBlockEnd = maxFrame + maxBlock;
  const discontinuityFields = {
    discontinuityKind: value => value === 'block-frame' || value === 'missed-attack',
    expectedFrame: value => integer(value, 0, maxBlockEnd), actualFrame: value => integer(value, 0, maxFrame),
    previousBlockFrame: value => value === null || integer(value, 0, maxFrame), previousBlockLength: value => integer(value, 0, maxBlock),
    blockLength: value => integer(value, 1, maxBlock), frameDelta: value => integer(value, -maxBlockEnd, maxBlockEnd),
    successfulBlocks: value => integer(value, 0, maxFrame), missedAttackIndex: value => integer(value, 0, 99999),
  };
  const copyEvent = row => ({...row, ...(row.details ? {details: {...row.details}} : {})});
  const scalars = value => {
    const row = {};
    for (const key of fields) {
      const item = value?.[key];
      if (item === null || typeof item === 'number' && Number.isFinite(item) || typeof item === 'string') row[key] = typeof item === 'string' ? item.slice(0, 512) : item;
    }
    // Preserve only the actual processor's bounded scalar failure history.
    // No transfer buffers, note identities or arbitrary nested data are copied.
    if (row.code === 'audio_render_discontinuity') {
      const details = {};
      try {
        const source = value.details;
        if (source && typeof source === 'object' && !Array.isArray(source)) for (const [key, valid] of Object.entries(discontinuityFields)) {
          try { const item = source[key]; if (Object.hasOwn(source, key) && valid(item)) details[key] = item; } catch { /* Preserve the original failure. */ }
        }
      } catch { /* Unreadable optional details cannot hide the original failure. */ }
      if (Object.keys(details).length) row.details = details;
    }
    return row;
  };
  function record(kind, receiver, value = {}) {
    try {
      if (!receivers.has(receiver)) receivers.set(receiver, ++serial);
      const context = receiver.context;
      if (events.length === 128) { events.shift(); droppedEvents++; }
      const row = {kind, receiver: receivers.get(receiver), wallTime: target.performance.now(), contextState: context.state, audioTime: context.currentTime, sampleRate: context.sampleRate, receiverState: receiver.state, generation: receiver.generation, planGeneration: receiver.planGeneration, engravingStatus: target.document?.querySelector('#engraving-status')?.textContent?.slice(0, 256) ?? null, ...scalars(value)};
      events.push(row);
      if (kind === 'failure') lastFailure = row;
    } catch { /* Evidence cannot change a production outcome. */ }
  }
  function wrap(prototype, name, observe) {
    const original = prototype[name];
    prototype[name] = function(...args) { observe.call(this, ...args); return original.apply(this, args); };
    restores.push(() => { prototype[name] = original; });
  }
  wrap(BasicReceiver.prototype, 'request', function(type, payload = {}) { if (['prepare', 'start', 'pause', 'resume'].includes(type)) record('command', this, {type, requestId: this.requestId + 1, anchorFrame: payload.anchorFrame}); });
  wrap(BasicReceiver.prototype, 'receive', function(message) { if (!(this instanceof CanonicalReceiver)) record('receipt', this, message); });
  wrap(CanonicalReceiver.prototype, 'receive', function(message) { record('receipt', this, message); });
  wrap(BasicReceiver.prototype, 'fail', function(error) { record('failure', this, error); });
  function observeRenderer() {
    const prototype = target.opensheetmusicdisplay?.OpenSheetMusicDisplay?.prototype;
    if (!prototype || renderers.has(prototype)) return;
    renderers.add(prototype); observedRenderer = true;
    for (const phase of ['load', 'updateGraphic', 'render']) {
      const original = prototype[phase];
      if (typeof original !== 'function') continue;
      prototype[phase] = function(...args) {
        const startTime = target.performance.now();
        try { return original.apply(this, args); }
        finally {
          try {
            const endTime = target.performance.now();
            if (renderPhases.length === 64) { renderPhases.shift(); droppedRenderPhases++; }
            // Record only synchronous work. In particular load's original
            // promise returns unchanged; its asynchronous tail is not timed.
            renderPhases.push({phase: `${phase}_sync`, startTime, endTime, duration: endTime - startTime});
          } catch { /* Diagnostics cannot change rendering. */ }
        }
      };
      restores.push(() => { prototype[phase] = original; });
    }
  }
  function rendererLoaded(event) {
    try { if (event.target?.tagName === 'SCRIPT' && new URL(event.target.src, target.location?.href).pathname.endsWith('/vendor/opensheetmusicdisplay.min.js')) observeRenderer(); }
    catch { /* Optional bundle observation cannot interrupt its load event. */ }
  }
  // Capture precedes the bundle's onload promise resolution, so the first
  // actual render is observed without preloading or postponing the bundle.
  target.document?.addEventListener?.('load', rendererLoaded, true);
  observeRenderer();
  function collect(entries) {
    for (const entry of entries) {
      if (longTasks.length === 64) { longTasks.shift(); droppedLongTasks++; }
      longTasks.push({startTime: entry.startTime, duration: entry.duration, name: String(entry.name).slice(0, 128)});
    }
  }
  try {
    if (target.PerformanceObserver?.supportedEntryTypes?.includes('longtask')) {
      observer = new target.PerformanceObserver(list => collect(list.getEntries()));
      observer.observe({type: 'longtask', buffered: true});
    }
  } catch { observer = null; }
  return {
    snapshot() { if (observer) collect(observer.takeRecords()); return {events: events.map(copyEvent), longTasks: longTasks.map(row => ({...row})), renderPhases: renderPhases.map(row => ({...row})), longTasksSupported: Boolean(observer), observedRenderer, droppedEvents, droppedLongTasks, droppedRenderPhases}; },
    failureSince(wallTime) { return Number.isFinite(wallTime) && lastFailure && lastFailure.wallTime >= wallTime ? copyEvent(lastFailure) : null; },
    dispose() { observer?.disconnect(); target.document?.removeEventListener?.('load', rendererLoaded, true); for (const restore of restores.reverse()) restore(); },
  };
}

// Register only the trusted observer factory before navigation. Browser module
// imports and receiver observation still wait for the app's existing readiness.
export async function prepareAudioAdmissionDiagnostics(page) {
  await page.addInitScript({content: `globalThis.__wmhObserveAudioAdmission = (${observeAudioAdmission.toString()});`});
}

export async function installAudioAdmissionDiagnostics(page) {
  await page.evaluate(async () => {
    const [{BasicKeyAudioReceiver}, {CanonicalAudioReceiver}] = await Promise.all([import('/basic-key-audio-receiver.js'), import('/canonical-audio-receiver.js')]);
    globalThis.__wmhAudioAdmissionDiagnostics?.dispose();
    globalThis.__wmhAudioAdmissionDiagnostics = globalThis.__wmhObserveAudioAdmission(BasicKeyAudioReceiver, CanonicalAudioReceiver, globalThis);
  });
}

export async function readAudioAdmissionDiagnostics(page) {
  return page.evaluate(() => globalThis.__wmhAudioAdmissionDiagnostics?.snapshot() ?? {unavailable: true}).catch(error => ({observationError: error.message}));
}

// Failure-only, read-only UI observations. Do not copy source notes or labels.
export function readPlaybackFailureState(target = globalThis) {
  const document = target.document, query = selector => document.querySelector(selector);
  let clock;
  try { clock = target.__wmhReadPlaybackClock(); } catch (error) { clock = {observationError: String(error.message).slice(0, 256)}; }
  const cue = query('#stage-cue'), cursor = query('#written-cursor-status');
  const sourceMeasureIndex = cursor?.dataset.sourceMeasureIndex;
  return {
    viewport: {width: target.innerWidth, height: target.innerHeight}, clock,
    sessionMode: ['listen', 'practice'].includes(query('#session-mode')?.value) ? query('#session-mode').value : null,
    notationView: ['engraved', 'staff', 'jianpu'].find(view => query(`#${view}-button`)?.getAttribute('aria-pressed') === 'true') ?? null,
    cueHidden: cue?.hidden ?? null, cueState: String(cue?.dataset.cueState ?? '').slice(0, 64),
    countIn: query('#count-in')?.checked ?? null, following: query('#engraving-follow')?.checked ?? null,
    overlayHidden: query('#notation-lane-overlay')?.hidden ?? null,
    sourceMeasureIndex: sourceMeasureIndex !== undefined && /^\d+$/.test(sourceMeasureIndex) && Number.isSafeInteger(Number(sourceMeasureIndex)) ? Number(sourceMeasureIndex) : null,
    currentMarkers: {staff: document.querySelectorAll('.engraving-expected-cue:not([hidden])').length, jianpu: document.querySelectorAll('#notation .score-note.active').length},
  };
}

// Keep the overlay's actual-clock and cue condition and the configured browser
// timeout. Newly observed receiver failures are conservatively terminal here.
// The boundary is observation time after Reset/before Play, not receiver or
// generation identity; a late failure from an older receiver is also retained.
export async function waitForOverlayPlayback(page, startedAfter) {
  const ready = await page.waitForFunction(after => {
    const failure = globalThis.__wmhAudioAdmissionDiagnostics?.failureSince(after);
    if (failure) throw new Error(`Newly observed audio failure during overlay playback: ${JSON.stringify(failure)}`);
    return globalThis.__wmhReadPlaybackClock().positionMs > 300 && document.querySelector('#stage-cue').hidden;
  }, startedAfter);
  await ready.dispose();
}

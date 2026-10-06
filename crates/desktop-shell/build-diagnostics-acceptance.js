// Process-owner-only focused native Settings gate. No scores are imported and
// no audio is started. Active-practice regressions remain separate full gates.
// Passive observers preserve the exact native return value/promise. Evidence
// work runs on a separate bounded chain and must settle before a passing report.
function createNativeBuildDiagnosticsObservers({fetchOwner, clipboard, readSequence, onRequest, onOtherRequest, onWrite, onError, timeoutMs = 5000}) {
  const originalFetch = fetchOwner.fetch, pending = new Set(), readers = new Set();
  let closed = false, failed = false, clipboardDescriptor, wrappedWrite;
  const fail = error => { if (closed) return;failed = true;try {onError(String(error?.message || error).slice(0,512));} catch {} };
  const safely = action => { try {return action();} catch (error) {fail(error);return undefined;} };
  function track(operation) {
    if (closed) return;
    if (pending.size >= 8) {fail('Diagnostic observer pending bound');return;}
    let observation, result;
    try {result = operation();} catch (error) {fail(error);return;}
    observation = Promise.resolve(result).catch(fail).finally(() => pending.delete(observation));
    pending.add(observation);
  }
  function cancelReaders() {
    for (const reader of readers) {try {void Promise.resolve(reader.cancel()).catch(() => {});} catch {}try {reader.releaseLock();} catch {}}
    readers.clear();
  }
  async function boundedResponse(response) {
    const reader = response.clone().body.getReader(), chunks = [];let length = 0, complete = false;readers.add(reader);
    try {
      while (!closed) {const row = await reader.read();if (row.done) {complete = true;break;}length += row.value.byteLength;if (length > 32768) throw Error('Diagnostic response bound');chunks.push(row.value);}
      if (closed) return null;
      const bytes = new Uint8Array(length);let offset = 0;for (const chunk of chunks) {bytes.set(chunk, offset);offset += chunk.byteLength;}return bytes;
    } finally {
      readers.delete(reader);
      if (!complete) {try {void Promise.resolve(reader.cancel()).catch(() => {});} catch {}}
      try {reader.releaseLock();} catch {}
    }
  }
  function observeFetch(...args) {
    const result = Reflect.apply(originalFetch, this, args);
    safely(() => {
      const path = String(args[0]), options = args[1] || {}, sequence = readSequence();
      if (path === '/api/diagnostics/build') track(() => Promise.resolve(result).then(response => boundedResponse(response).then(bytes => {
        if (closed) return;
        onRequest({sequence, path, method: options.method || 'GET', body: options.body ?? null, status: response.status, data: JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes))});
      })));
      else if (path.startsWith('/api/')) onOtherRequest(path);
    });
    return result;
  }
  fetchOwner.fetch = observeFetch;
  try {
    if (typeof clipboard?.writeText === 'function') {
      const original = clipboard.writeText;clipboardDescriptor = Object.getOwnPropertyDescriptor(clipboard, 'writeText');
      wrappedWrite = function(...args) {
        const row = safely(() => ({sequence: readSequence(), text: String(args[0]), outcome: 'pending'}));
        let result;
        try {result = Reflect.apply(original, this, args);}
        catch (error) {if (row) safely(() => {row.outcome = 'rejected';onWrite(row);});throw error;}
        if (row) safely(() => onWrite(row));
        track(async () => {try {await result;if (!closed && row) row.outcome = 'fulfilled';} catch {if (!closed && row) row.outcome = 'rejected';}});
        return result;
      };
      Object.defineProperty(clipboard, 'writeText', {value: wrappedWrite, configurable: true, writable: true});
    }
  } catch {wrappedWrite = null;}
  return {
    clipboardObserved: Boolean(wrappedWrite),
    async settle() {
      let timer;
      try {
        await Promise.race([(async () => {while (pending.size) await Promise.all([...pending]);})(), new Promise((_, reject) => {timer = setTimeout(() => reject(Error('Diagnostic observations did not settle')), timeoutMs);})]);
        if (failed || closed) throw Error('Diagnostic observation failed');
        return true;
      } catch (error) {fail(error);cancelReaders();throw error;}
      finally {clearTimeout(timer);}
    },
    restore() {
      closed = true;cancelReaders();
      if (fetchOwner.fetch === observeFetch) fetchOwner.fetch = originalFetch;
      if (wrappedWrite && clipboard.writeText === wrappedWrite) {if (clipboardDescriptor) Object.defineProperty(clipboard, 'writeText', clipboardDescriptor);else delete clipboard.writeText;}
      return fetchOwner.fetch === originalFetch && (!wrappedWrite || clipboard.writeText !== wrappedWrite);
    },
  };
}
(() => {
  const phase = globalThis.__WMH_ACCEPTANCE_PHASE__, $ = id => document.getElementById(id);
  const assert = (value, message) => { if (!value) throw Error(message); };
  assert(phase === 'build-diagnostics', 'Unexpected diagnostic acceptance phase');
  const waits = createAcceptanceWait(), originalFetch = globalThis.fetch, fetcher = originalFetch.bind(globalThis);
  const report = {version: 1, scenario: 'build-diagnostics', phase, origin: location.origin, ok: false, errors: [], actions: 0, controls: [], requests: [], writes: [], summaries: [], roles: {}, physicalAudio: false};
  let sequence = 0, restored = false;
  const until = (predicate, label) => waits.until(predicate, `${phase}: ${label}`, 15000);
  const frame = () => new Promise(requestAnimationFrame);
  const json = (path, body) => waits.json(fetcher, path, body === undefined ? undefined : {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)}, 10000);
  let diagnosticClipboard;try {diagnosticClipboard = navigator.clipboard;} catch {}
  const observers = createNativeBuildDiagnosticsObservers({fetchOwner: globalThis, clipboard: diagnosticClipboard, readSequence: () => sequence,
    onRequest: row => {assert(report.requests.length < 4, 'Diagnostic read bound');report.requests.push(row);},
    onOtherRequest: path => {if (report.interval && report.errors.length < 16) report.errors.push(`Unexpected API during diagnostic interval: ${path.slice(0,128)}`);},
    onWrite: row => {assert(report.writes.length < 4, 'Diagnostic clipboard bound');report.writes.push(row);},
    onError: message => {if (report.errors.length < 16) report.errors.push(message);},
  });
  report.clipboardObserved = observers.clipboardObserved;
  const error = event => { if (report.errors.length < 16) report.errors.push(String(event.message || event.reason).slice(0,512)); };
  addEventListener('error', error);addEventListener('unhandledrejection', error);
  async function click(node) {
    if (typeof node === 'string') node = $(node);
    assert(node && node.isConnected && !node.disabled, 'Diagnostic control unavailable');
    await waitCanonicalPracticeControl({document, node, until, readClock: () => __wmhReadPlaybackClock(document)});
    node.scrollIntoView({block: 'center', inline: 'center'});await frame();await frame();
    const row = {sequence: sequence + 1, id: node.id || null, closePanel: node.dataset.closePanel || null, samples: []};
    await prepareCanonicalPracticeTarget({document, node, onSample: value => row.samples.push(value)});
    const bounds = node.getBoundingClientRect();assert(sequence < 32, 'Diagnostic action bound');
    const action = {version: 1, sequence: ++sequence, kind: 'click', x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2, width: innerWidth, height: innerHeight};
    const observer = observeCanonicalPracticeOwnedClick({document, node, sequence});row.clicks = observer.events;row.request = {...action, target: {x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height}};report.controls.push(row);
    try {
      await json('/__desktop_smoke/action', action);let result;
      await until(async () => { const response = await fetcher(`/__desktop_smoke/result/${sequence}`);if (response.status === 404) return false;result = await response.json();return true; }, 'owned native click');
      assert(result.ok, result.error || 'Native diagnostic click failed');
      await requireCanonicalPracticeOwnedClick({until, events: observer.events, sequence, id: node.id, kind: 'click'});
    } finally { observer.restore(); }
    return sequence;
  }
  const clock = () => { const value = __wmhReadPlaybackClock(document);return {running: value.running, positionMs: value.positionMs, phase: value.phase}; };
  async function summary(label, includePath) {
    const copyAction = await click('build-diagnostics-copy');
    await until(() => ['Diagnostic text copied.', 'Clipboard access is unavailable. Select the diagnostic text and copy it manually.'].includes($('build-diagnostics-copy-status').textContent), 'real copy result or visible fallback');
    const copyStatus = $('build-diagnostics-copy-status').textContent;
    const selectAction = await click('build-diagnostics-select');
    const text = $('build-diagnostics-text');
    await until(() => document.activeElement === text && text.selectionStart === 0 && text.selectionEnd === text.value.length, 'actual selectable diagnostic text');
    report.summaries.push({label, includePath, copyAction, selectAction, copyStatus, text: text.value, selection: {active: document.activeElement.id, start: text.selectionStart, end: text.selectionEnd, direction: text.selectionDirection}, checkbox: $('build-diagnostics-include-path').checked});
  }
  function cleanup() {
    if (restored) return;restored = true;
    report.observersRestored = observers.restore();
    removeEventListener('error', error);removeEventListener('unhandledrejection', error);
  }
  addEventListener('DOMContentLoaded', async () => {
    try {
      await prepareNativePlaybackClock({document, until});
      (await import('/app-locale.js')).getAppI18n(document).setLocale('en');
      await until(() => $('build-diagnostics') && $('settings-button'), 'production bootstrap diagnostics');
      assert(report.requests.length === 0 && report.writes.length === 0, 'Diagnostics must remain lazy');
      report.initial = {state: $('build-diagnostics').dataset.state, clock: clock(), checkbox: $('build-diagnostics-include-path').checked};
      report.roles.open = await click('settings-button');
      assert($('settings-dialog').open && !clock().running, 'Existing Settings must own playback pause');
      assert(report.requests.length === 0 && report.writes.length === 0, 'Opening Settings cannot read or copy diagnostics');
      report.interval = true;
      report.roles.read = await click('build-diagnostics-read');
      await until(() => $('build-diagnostics').dataset.state === 'ready' && report.requests.length === 1, 'actual native diagnostic response');
      assert(report.writes.length === 0, 'Read cannot write the clipboard');
      report.visible = Object.fromEntries([...$('build-diagnostics-fields').querySelectorAll('dd')].map(node => [node.id, node.textContent]));
      await summary('default', false);
      report.roles.include = await click('build-diagnostics-include-path');assert($('build-diagnostics-include-path').checked, 'Path inclusion requires its checkbox');
      await summary('with-path', true);
      report.roles.close = await click($('settings-dialog').querySelector('[data-close-panel]'));
      assert(!$('settings-dialog').open && !$('build-diagnostics-include-path').checked, 'Closing Settings must reset path consent');
      report.roles.reopen = await click('settings-button');assert(!$('build-diagnostics-include-path').checked, 'Reopening cannot restore path consent');
      report.roles.refresh = await click('build-diagnostics-read');
      await until(() => $('build-diagnostics').dataset.state === 'ready' && report.requests.length === 2, 'cached diagnostic refresh');
      await summary('reopened', false);
      report.roles.finalClose = await click($('settings-dialog').querySelector('[data-close-panel]'));
      report.final = {clock: clock(), checkbox: $('build-diagnostics-include-path').checked, open: $('settings-dialog').open};
      assert(!report.final.clock.running && report.final.clock.positionMs === report.initial.clock.positionMs, 'Diagnostic operations cannot start or move transport');
      report.evidenceSettled = await observers.settle();
      assert(report.errors.length === 0, report.errors.join('; '));report.ok = true;
    } catch (cause) { report.error = String(cause.stack || cause).slice(0,4096); }
    finally {
      report.actions = sequence;delete report.interval;
      try { cleanup(); } catch (cause) { report.ok = false;report.error ??= String(cause).slice(0,512); }
      const bytes = new TextEncoder().encode(JSON.stringify(report)).length;
      if (bytes >= 256 * 1024) { await json('/__desktop_smoke/report', {version: 1, phase, ok: false, error: 'Diagnostic renderer report exceeds 256 KiB'}); }
      else await json('/__desktop_smoke/report', report);
    }
  }, {once: true});
})();

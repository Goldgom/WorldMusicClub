/** Optional, offline OSMD presentation adapter. Rust remains the score/timing authority. */
export const ENGRAVING_VERSION = '2.1.3';
export const ENGRAVING_BUNDLE_SHA256 = '099b2125aef055ca4faae75957037404973f9451544b52d9b3a0b1f788b33581';
export const ENGRAVING_LIMITS = Object.freeze({xmlBytes: 8 * 1024 * 1024, notes: 2000, elements: 50000, depth: 32, parts: 16, measures: 512, measuresPerView: 64, textLength: 8192});
const active = new WeakMap();
const loaders = new WeakMap();
const allowedTags = new Set(('score-partwise work work-title movement-title identification creator rights encoding software encoding-date supports defaults scaling millimeters tenths part-list score-part part-name part-abbreviation score-instrument instrument-name instrument-abbreviation midi-instrument midi-channel midi-program part measure attributes divisions key cancel fifths mode time beats beat-type senza-misura staves clef sign line clef-octave-change staff-details staff-lines transpose diatonic chromatic octave-change double measure-style multiple-rest note chord pitch step alter octave rest display-step display-octave duration tie voice type dot accidental time-modification actual-notes normal-notes normal-type normal-dot stem staff beam notations tied slur tuplet tuplet-actual tuplet-normal tuplet-number tuplet-type tuplet-dot articulations accent strong-accent staccato tenuto detached-legato staccatissimo spiccato scoop plop doit falloff breath-mark caesura fermata ornaments trill-mark turn delayed-turn inverted-turn shake mordent inverted-mordent tremolo technical fingering string fret backup forward direction direction-type words metronome beat-unit beat-unit-dot per-minute offset sound dynamics p pp ppp pppp ppppp pppppp f ff fff ffff fffff ffffff mp mf sf sfp sfpp fp rf rfz sfz sffz fz other-dynamics wedge rehearsal segno coda pedal octave-shift barline bar-style repeat ending print system-layout system-margins left-margin right-margin system-distance top-system-distance staff-layout staff-distance page-layout page-height page-width page-margins top-margin bottom-margin lyric syllabic text elision extend').split(' '));
const numericLimits = Object.freeze({staves: [1, 8], staff: [1, 8], voice: [1, 2000], 'staff-lines': [1, 12], divisions: [1, 1000000], duration: [0, 1000000000], fifths: [-7, 7], octave: [-1, 9], alter: [-2, 2], beats: [1, 64], 'beat-type': [1, 128], 'actual-notes': [1, 128], 'normal-notes': [1, 128]});
const unsupported = message => ({ok: false, status: 'unsupported', message});
const invalid = message => ({ok: false, status: 'invalid', message});
const noop = () => {};
const result = (status, message, extra = {}) => ({ok: status === 'ready', status, message, dispose: noop, resize: () => false, ...extra});

/** Validate the entire input BEFORE loading third-party code; never treat a string as a URL. */
export function validateEngravingInput(xml, options = {}, Parser = globalThis.DOMParser) {
  if (typeof xml !== 'string' || !xml.trimStart().startsWith('<')) return invalid('Engraving requires a MusicXML string, not a URL or file.');
  if (xml.length > ENGRAVING_LIMITS.xmlBytes || new TextEncoder().encode(xml).byteLength > ENGRAVING_LIMITS.xmlBytes) return unsupported('Engraving is limited to 8 MiB of MusicXML.');
  if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(xml) || /<\?(?!xml(?:\s|\?>))/i.test(xml)) return unsupported('DTD, entities and processing instructions are not accepted. Use the canonical MusicXML export.');
  if (typeof Parser !== 'function') return result('unavailable', 'This browser does not provide an XML parser.');
  let document;
  try { document = new Parser().parseFromString(xml, 'application/xml'); } catch { return invalid('MusicXML could not be parsed.'); }
  if (!document?.documentElement || document.getElementsByTagName('parsererror').length) return invalid('MusicXML could not be parsed.');
  const root = document.documentElement;
  if (root.localName !== 'score-partwise') return unsupported('Only canonical score-partwise MusicXML is supported.');
  const elements = Array.from(document.getElementsByTagName('*'));
  if (elements.length > ENGRAVING_LIMITS.elements) return unsupported('This score exceeds the engraving element limit.');
  let noteCount = 0;
  for (const element of elements) {
    if (!allowedTags.has(element.localName) || (element.namespaceURI && element.namespaceURI !== 'http://www.musicxml.org/ns/musicxml')) return unsupported('This MusicXML contains unsupported elements or embedded resources. Use the canonical export.');
    let depth = 0;
    for (let parent = element; parent?.nodeType === 1; parent = parent.parentNode) if (++depth > ENGRAVING_LIMITS.depth) return unsupported('This MusicXML is nested too deeply.');
    for (const attribute of Array.from(element.attributes || [])) {
      const name = attribute.name.toLowerCase();
      if (/^(?:on|href$|src$|style$)|(?:^|:)href$/.test(name) || name === 'xml:base' || (/url\s*\(|(?:https?|file|data|javascript):/i.test(attribute.value) && !name.startsWith('xmlns'))) return unsupported('External resources and active attributes are not accepted.');
      if (name === 'number' && element.localName !== 'measure' && (!/^\d+$/.test(attribute.value) || Number(attribute.value) < 1 || Number(attribute.value) > 16)) return unsupported('A MusicXML numbered staff or notation exceeds the engraving limit.');
      if (/^(?:width|height|font-size|default-[xy]|relative-[xy]|spread)$/.test(name) && (!Number.isFinite(Number(attribute.value)) || Math.abs(Number(attribute.value)) > 10000)) return unsupported('A MusicXML layout value exceeds the engraving limit.');
      if (attribute.value.length > 512) return unsupported('An engraving attribute exceeds the size limit.');
    }
    if (element.localName === 'voice' && !/^[1-9]\d*$/.test(element.textContent.trim())) return unsupported('OSMD requires integer voice identifiers. Use the canonical MusicXML exporter so separate voices remain distinct.');
    const numericLimit = numericLimits[element.localName];
    if (numericLimit) {
      const value = element.textContent.trim();
      if (!/^-?\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < numericLimit[0] || Number(value) > numericLimit[1]) return unsupported('A MusicXML musical value exceeds the supported engraving range.');
    }
    if (element.localName === 'note' && ++noteCount > ENGRAVING_LIMITS.notes) return unsupported('Engraving is limited to 2,000 notes and rests. Use the basic view for this score.');
    for (const node of Array.from(element.childNodes || [])) if ((node.nodeType === 3 || node.nodeType === 4) && node.nodeValue.length > ENGRAVING_LIMITS.textLength) return unsupported('An engraving text field exceeds the size limit.');
  }
  const parts = Array.from(root.children).filter(node => node.localName === 'part');
  if (!parts.length || !noteCount) return unsupported('The score has no notes or rests to engrave.');
  if (parts.length > ENGRAVING_LIMITS.parts) return unsupported('Engraving is limited to 16 parts.');
  const partIds = parts.map(part => part.getAttribute('id'));
  if (partIds.some(id => !id) || new Set(partIds).size !== parts.length) return invalid('MusicXML part identifiers must be present and unique.');
  const measureCounts = parts.map(part => Array.from(part.children).filter(node => node.localName === 'measure').length);
  const measureCount = Math.max(...measureCounts);
  if (!measureCount || measureCount > ENGRAVING_LIMITS.measures) return unsupported('Engraving is limited to 512 measures per part.');
  if (!options || typeof options !== 'object' || Array.isArray(options)) return invalid('Engraving options must be an object.');
  const fromMeasure = options.fromMeasure ?? 1;
  const toMeasure = options.toMeasure ?? Math.min(fromMeasure + 31, measureCount);
  if (!Number.isInteger(fromMeasure) || !Number.isInteger(toMeasure) || fromMeasure < 1 || toMeasure < fromMeasure || fromMeasure > measureCount || toMeasure > measureCount) return invalid('Choose a valid one-based measure range within the score.');
  if (toMeasure - fromMeasure + 1 > ENGRAVING_LIMITS.measuresPerView) return unsupported('Display at most 64 measures at a time.');
  const selectedIds = options.partIds ?? partIds;
  if (!Array.isArray(selectedIds) || !selectedIds.length || selectedIds.some(id => typeof id !== 'string' || !partIds.includes(id)) || new Set(selectedIds).size !== selectedIds.length) return invalid('Choose existing, unique MusicXML part identifiers.');
  const zoom = options.zoom ?? 1;
  if (!Number.isFinite(zoom) || zoom < 0.5 || zoom > 2) return invalid('Engraving zoom must be between 0.5 and 2.');
  if (options.width !== undefined && (!Number.isFinite(options.width) || options.width < 320 || options.width > 4096)) return invalid('Engraving width must be between 320 and 4096 pixels.');
  return {ok: true, status: 'validated', document, options: {dark: options.dark === true, responsive: options.responsive !== false, fromMeasure, toMeasure, partIds: selectedIds, zoom, width: options.width}, metadata: {noteCount, measureCount, partIds, fromMeasure, toMeasure}};
}

function loadRenderer(document) {
  const view = document.defaultView ?? globalThis;
  if (typeof view.opensheetmusicdisplay?.OpenSheetMusicDisplay === 'function') return Promise.resolve(view.opensheetmusicdisplay.OpenSheetMusicDisplay);
  if (loaders.has(document)) return loaders.get(document);
  const promise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    const finish = (error) => {
      clearTimeout(timer);
      script.onload = script.onerror = null;
      script.remove();
      const Renderer = view.opensheetmusicdisplay?.OpenSheetMusicDisplay;
      if (error || typeof Renderer !== 'function') reject(new Error('The optional offline engraving bundle is unavailable.'));
      else resolve(Renderer);
    };
    // This URL is fixed by the module location; it is never derived from score/user input.
    script.src = new URL('./vendor/opensheetmusicdisplay.min.js', import.meta.url).href;
    script.async = true;
    script.integrity = 'sha256-CZshJa7wVcpPqudZVwN0BJc/lFFUS1LZs6Cx94izNYE=';
    script.onload = () => finish();
    script.onerror = () => finish(true);
    const timer = setTimeout(() => finish(true), 8000);
    try { document.head.appendChild(script); } catch { finish(true); }
  });
  loaders.set(document, promise);
  promise.catch(() => { if (loaders.get(document) === promise) loaders.delete(document); });
  return promise;
}

/** Stop a pending render or detach a completed one, including all owned observers/listeners. */
export function disposeEngravedStaff(container) { active.get(container)?.dispose(); }

/**
 * Returns {ok,status,message,metadata,dispose,resize}; never falls back silently.
 * Only the newest call for a container may publish DOM. `signal` cancels at async boundaries;
 * OSMD's synchronous render cannot be interrupted mid-call. See docs/ENGRAVING.md.
 */
export async function renderEngravedStaff(container, xml, options = {}, signal) {
  if (!container?.ownerDocument || typeof container.appendChild !== 'function' || typeof container.replaceChildren !== 'function') return result('invalid', 'Engraving requires a DOM container.');
  disposeEngravedStaff(container);
  const document = container.ownerDocument;
  const view = document.defaultView ?? globalThis;
  if (signal?.aborted) return result('cancelled', 'Engraving cancelled.');
  const checked = validateEngravingInput(xml, options, view.DOMParser ?? globalThis.DOMParser);
  if (!checked.ok) return result(checked.status, checked.message);
  let renderer, mount, observer, frame, ready = false, cancelled = false, width = 0;
  const useAnimationFrame = typeof view.requestAnimationFrame === 'function' && typeof view.cancelAnimationFrame === 'function';
  let cancelWait;
  const cancellation = new Promise(resolve => { cancelWait = () => resolve(null); });
  const cancelFrame = () => { if (frame !== undefined) { if (useAnimationFrame) view.cancelAnimationFrame(frame); else clearTimeout(frame); frame = undefined; } };
  const state = {dispose() {
    if (cancelled) return;
    cancelled = true;
    cancelWait();
    observer?.disconnect();
    cancelFrame();
    signal?.removeEventListener('abort', state.dispose);
    try { renderer?.clear(); } catch { /* Cleanup must not strand an observer or newer render. */ }
    mount?.remove();
    renderer = undefined;
    if (active.get(container) === state) active.delete(container);
  }};
  active.set(container, state);
  signal?.addEventListener('abort', state.dispose, {once: true});
  const isCurrent = () => !cancelled && active.get(container) === state;
  const getWidth = () => Math.max(320, Math.min(4096, Math.round(checked.options.width ?? container.clientWidth ?? 800) || 800));
  const resize = () => {
    if (!isCurrent() || !ready) return false;
    const nextWidth = getWidth();
    if (nextWidth === width) return true;
    width = nextWidth;
    mount.style.width = `${width}px`;
    try { renderer.render(); return true; } catch {
      state.dispose();
      if (typeof options.onError === 'function') { try { options.onError(result('error', 'The staff could not be resized. Use the basic view.')); } catch { /* Consumer callbacks do not own cleanup. */ } }
      return false;
    }
  };
  try {
    const Renderer = await Promise.race([loadRenderer(document), cancellation]);
    if (!isCurrent() || !Renderer) return result('cancelled', 'Engraving cancelled.');
    mount = document.createElement('div');
    mount.className = 'engraved-staff';
    mount.setAttribute('role', 'img');
    mount.setAttribute('aria-label', `Engraved staff, measures ${checked.options.fromMeasure} to ${checked.options.toMeasure}`);
    mount.style.visibility = 'hidden';
    mount.style.position = 'absolute';
    width = getWidth();
    mount.style.width = `${width}px`;
    container.appendChild(mount);
    renderer = new Renderer(mount, {backend: 'svg', autoResize: false, disableCursor: true, followCursor: false, drawingParameters: 'default', drawTitle: true, drawPartNames: true, drawTimeSignatures: true, drawMeasureNumbers: true, darkMode: checked.options.dark, pageBackgroundColor: checked.options.dark ? '#171c1a' : '#ffffff', defaultColorMusic: checked.options.dark ? '#f3f5ef' : '#17251d', defaultColorLabel: checked.options.dark ? '#f3f5ef' : '#17251d', useGeometricSkyBottomLineCalculation: true, pageFormat: 'Endless', drawFromMeasureNumber: checked.options.fromMeasure, drawUpToMeasureNumber: checked.options.toMeasure});
    if (renderer.Version !== `${ENGRAVING_VERSION}-release`) { state.dispose(); return result('unavailable', `Engraving requires the pinned OSMD ${ENGRAVING_VERSION} bundle.`); }
    renderer.setLogLevel?.('error');
    // Passing a parsed Document avoids OSMD.load(string)'s automatic URL/MXL detection entirely.
    const loaded = renderer.load(checked.document);
    await Promise.race([loaded, cancellation]);
    if (!isCurrent()) return result('cancelled', 'Engraving cancelled.');
    const instruments = renderer.Sheet?.Instruments;
    if (!Array.isArray(instruments) || !instruments.length || checked.options.partIds.some(id => !instruments.some(instrument => instrument.IdString === id))) {
      state.dispose(); return result('unsupported', 'The renderer could not resolve the requested score parts.');
    }
    for (const instrument of instruments) instrument.Visible = checked.options.partIds.includes(instrument.IdString);
    // OSMD treats an initial implicit/pickup bar specially for its public number options.
    // Pin source indexes instead, so the adapter's ordinal range remains exact for pickups too.
    const rules = renderer.EngravingRules;
    rules.MinMeasureToDrawIndex = checked.options.fromMeasure - 1;
    rules.MaxMeasureToDrawIndex = checked.options.toMeasure - 1;
    rules.MinMeasureToDrawNumber = 0;
    rules.MaxMeasureToDrawNumber = 0;
    renderer.Zoom = checked.options.zoom;
    renderer.updateGraphic();
    renderer.render();
    if (!isCurrent()) return result('cancelled', 'Engraving cancelled.');
    if (!mount.querySelector('svg')) { state.dispose(); return result('error', 'The renderer produced no staff engraving.'); }
    // OSMD draws with DOM/SVG primitives. No imported source is inserted with innerHTML.
    container.replaceChildren(mount);
    mount.style.position = '';
    mount.style.visibility = '';
    ready = true;
    if (checked.options.responsive && checked.options.width === undefined && typeof view.ResizeObserver === 'function') {
      observer = new view.ResizeObserver(() => {
        if (!isCurrent() || frame !== undefined || getWidth() === width) return;
        const callback = () => { frame = undefined; resize(); };
        frame = useAnimationFrame ? view.requestAnimationFrame(callback) : setTimeout(callback, 16);
      });
      observer.observe(container);
    }
    return result('ready', 'Staff engraved with OpenSheetMusicDisplay.', {metadata: checked.metadata, dispose: state.dispose, resize});
  } catch {
    const wasCancelled = !isCurrent();
    const hadRenderer = Boolean(renderer);
    state.dispose();
    return wasCancelled ? result('cancelled', 'Engraving cancelled.') : result(hadRenderer ? 'error' : 'unavailable', hadRenderer ? 'This score could not be engraved. The original score is unchanged.' : 'The optional offline engraving bundle is unavailable. Build the engraving assets or use the basic view.');
  }
}

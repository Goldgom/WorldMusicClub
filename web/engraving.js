/** Optional, offline OSMD presentation adapter. Rust remains the score/timing authority. */
import {validateEngravingNoteMap,createEngravingNoteBindings} from './engraving-note-map.js';
import {getAppI18n} from './app-locale.js';
export const ENGRAVING_VERSION = '2.1.3';
export const ENGRAVING_BUNDLE_SHA256 = '099b2125aef055ca4faae75957037404973f9451544b52d9b3a0b1f788b33581';
export const ENGRAVING_LIMITS = Object.freeze({xmlBytes: 8 * 1024 * 1024, notes: 2000, elements: 50000, depth: 32, parts: 16, measures: 512, measuresPerView: 64, textLength: 8192});
const active = new WeakMap();
const loaders = new WeakMap();
const allowedTags = new Set(('score-partwise work work-title movement-title identification creator rights encoding software encoding-date supports defaults scaling millimeters tenths part-list score-part part-name part-abbreviation score-instrument instrument-name instrument-abbreviation midi-instrument midi-channel midi-program part measure attributes divisions key cancel fifths mode time beats beat-type senza-misura staves clef sign line clef-octave-change staff-details staff-lines transpose diatonic chromatic octave-change double measure-style multiple-rest note chord pitch step alter octave rest display-step display-octave duration tie voice type dot accidental time-modification actual-notes normal-notes normal-type normal-dot stem staff beam notations tied slur tuplet tuplet-actual tuplet-normal tuplet-number tuplet-type tuplet-dot articulations accent strong-accent staccato tenuto detached-legato staccatissimo spiccato scoop plop doit falloff breath-mark caesura fermata ornaments trill-mark turn delayed-turn inverted-turn shake mordent inverted-mordent tremolo technical fingering string fret backup forward direction direction-type words metronome beat-unit beat-unit-dot per-minute offset sound dynamics p pp ppp pppp ppppp pppppp f ff fff ffff fffff ffffff mp mf sf sfp sfpp fp rf rfz sfz sffz fz other-dynamics wedge rehearsal segno coda pedal octave-shift barline bar-style repeat ending print system-layout system-margins left-margin right-margin system-distance top-system-distance staff-layout staff-distance page-layout page-height page-width page-margins top-margin bottom-margin lyric syllabic text elision extend').split(' '));
const numericLimits = Object.freeze({staves: [1, 8], staff: [1, 8], voice: [1, 2000], 'staff-lines': [1, 12], divisions: [1, 1000000], duration: [0, 1000000000], fifths: [-7, 7], octave: [-1, 9], alter: [-2, 2], beats: [1, 64], 'beat-type': [1, 128], 'actual-notes': [1, 128], 'normal-notes': [1, 128]});
const noop = () => {};
const unavailableMapping=()=>({status:'unavailable',version:1,segmentCount:0,displayedSegmentCount:0,verifiedGlyphCount:0,bindings:[],diagnostics:[]});
const result = (status, key, i18n, extra = {}, messageParams = {}) => ({ok: status === 'ready', status, code:`engraving_${key}`, messageKey:`notationRuntime.${key}`, messageParams, get message(){return i18n.t(this.messageKey, messageParams)+(typeof this.cause?.message==='string'?' '+i18n.t('notationRuntime.technical',{detail:this.cause.message}):'')}, dispose: noop, resize: () => false, setExpectedWrittenNotes:()=>false,clearExpectedWrittenNotes:()=>false,mappingStatus:unavailableMapping, ...extra});

/** Validate the entire input BEFORE loading third-party code; never treat a string as a URL. */
export function validateEngravingInput(xml, options = {}, Parser = globalThis.DOMParser) {
  const i18n=options?.i18n??getAppI18n();
  const unsupported=key=>result('unsupported',key,i18n),invalid=key=>result('invalid',key,i18n);
  if (typeof xml !== 'string' || !xml.trimStart().startsWith('<')) return invalid('input');
  if (xml.length > ENGRAVING_LIMITS.xmlBytes || new TextEncoder().encode(xml).byteLength > ENGRAVING_LIMITS.xmlBytes) return unsupported('xmlLimit');
  if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(xml) || /<\?(?!xml(?:\s|\?>))/i.test(xml)) return unsupported('entities');
  if (typeof Parser !== 'function') return result('unavailable', 'parser', i18n);
  let document;
  try { document = new Parser().parseFromString(xml, 'application/xml'); } catch { return invalid('parse'); }
  if (!document?.documentElement || document.getElementsByTagName('parsererror').length) return invalid('parse');
  const root = document.documentElement;
  if (root.localName !== 'score-partwise') return unsupported('scoreType');
  const elements = Array.from(document.getElementsByTagName('*'));
  if (elements.length > ENGRAVING_LIMITS.elements) return unsupported('elements');
  let noteCount = 0;
  for (const element of elements) {
    if (!allowedTags.has(element.localName) || (element.namespaceURI && element.namespaceURI !== 'http://www.musicxml.org/ns/musicxml')) return unsupported('unsupportedElements');
    let depth = 0;
    for (let parent = element; parent?.nodeType === 1; parent = parent.parentNode) if (++depth > ENGRAVING_LIMITS.depth) return unsupported('depth');
    for (const attribute of Array.from(element.attributes || [])) {
      const name = attribute.name.toLowerCase();
      if (/^(?:on|href$|src$|style$)|(?:^|:)href$/.test(name) || name === 'xml:base' || (/url\s*\(|(?:https?|file|data|javascript):/i.test(attribute.value) && !name.startsWith('xmlns'))) return unsupported('resources');
      if (name === 'number' && element.localName !== 'measure' && (!/^\d+$/.test(attribute.value) || Number(attribute.value) < 1 || Number(attribute.value) > 16)) return unsupported('numbered');
      if (/^(?:width|height|font-size|default-[xy]|relative-[xy]|spread)$/.test(name) && (!Number.isFinite(Number(attribute.value)) || Math.abs(Number(attribute.value)) > 10000)) return unsupported('layout');
      if (attribute.value.length > 512) return unsupported('attribute');
    }
    if (element.localName === 'voice' && !/^[1-9]\d*$/.test(element.textContent.trim())) return unsupported('voice');
    const numericLimit = numericLimits[element.localName];
    if (numericLimit) {
      const value = element.textContent.trim();
      if (!/^-?\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < numericLimit[0] || Number(value) > numericLimit[1]) return unsupported('musicalValue');
    }
    if (element.localName === 'note' && ++noteCount > ENGRAVING_LIMITS.notes) return unsupported('notes');
    for (const node of Array.from(element.childNodes || [])) if ((node.nodeType === 3 || node.nodeType === 4) && node.nodeValue.length > ENGRAVING_LIMITS.textLength) return unsupported('textLimit');
  }
  const parts = Array.from(root.children).filter(node => node.localName === 'part');
  if (!parts.length || !noteCount) return unsupported('empty');
  if (parts.length > ENGRAVING_LIMITS.parts) return unsupported('partsLimit');
  const partIds = parts.map(part => part.getAttribute('id'));
  if (partIds.some(id => !id) || new Set(partIds).size !== parts.length) return invalid('partIds');
  const measureCounts = parts.map(part => Array.from(part.children).filter(node => node.localName === 'measure').length);
  const measureCount = Math.max(...measureCounts);
  if (!measureCount || measureCount > ENGRAVING_LIMITS.measures) return unsupported('measureLimit');
  if (!options || typeof options !== 'object' || Array.isArray(options)) return invalid('options');
  const fromMeasure = options.fromMeasure ?? 1;
  const toMeasure = options.toMeasure ?? Math.min(fromMeasure + 31, measureCount);
  if (!Number.isInteger(fromMeasure) || !Number.isInteger(toMeasure) || fromMeasure < 1 || toMeasure < fromMeasure || fromMeasure > measureCount || toMeasure > measureCount) return invalid('range');
  if (toMeasure - fromMeasure + 1 > ENGRAVING_LIMITS.measuresPerView) return unsupported('pageLimit');
  const selectedIds = options.partIds ?? partIds;
  if (!Array.isArray(selectedIds) || !selectedIds.length || selectedIds.some(id => typeof id !== 'string' || !partIds.includes(id)) || new Set(selectedIds).size !== selectedIds.length) return invalid('selectedParts');
  const zoom = options.zoom ?? 1;
  if (!Number.isFinite(zoom) || zoom < 0.5 || zoom > 2) return invalid('zoom');
  if (options.width !== undefined && (!Number.isFinite(options.width) || options.width < 320 || options.width > 4096)) return invalid('width');
  if(options.compactHeader!==undefined&&typeof options.compactHeader!=='boolean')return invalid('compactHeader');
  return {ok: true, status: 'validated', document, options: {dark: options.dark === true, responsive: options.responsive !== false, compactHeader:options.compactHeader===true, fromMeasure, toMeasure, partIds: selectedIds, zoom, width: options.width}, metadata: {noteCount, measureCount, partIds, fromMeasure, toMeasure}};
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
      if (error || typeof Renderer !== 'function') reject(Object.assign(new Error('The optional offline engraving bundle is unavailable.'),{code:'engraving_bundle'}));
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
  const i18n=options?.i18n??getAppI18n(container?.ownerDocument);
  if (!container?.ownerDocument || typeof container.appendChild !== 'function' || typeof container.replaceChildren !== 'function') return result('invalid', 'container', i18n);
  disposeEngravedStaff(container);
  const document = container.ownerDocument;
  const view = document.defaultView ?? globalThis;
  if (signal?.aborted) return result('cancelled', 'cancelled', i18n);
  const checked = validateEngravingInput(xml, options&&typeof options==='object'&&!Array.isArray(options)?{...options,i18n}:options, view.DOMParser ?? globalThis.DOMParser);
  if (!checked.ok) return checked;
  const identity=validateEngravingNoteMap(checked.document,options.identity);
  let unsubscribeLocale, renderer, mount, observer, frame, bindings=null, expected=null, renderGeneration=0, ready = false, cancelled = false, width = 0;
  const useAnimationFrame = typeof view.requestAnimationFrame === 'function' && typeof view.cancelAnimationFrame === 'function';
  let cancelWait;
  const cancellation = new Promise(resolve => { cancelWait = () => resolve(null); });
  const cancelFrame = () => { if (frame !== undefined) { if (useAnimationFrame) view.cancelAnimationFrame(frame); else clearTimeout(frame); frame = undefined; } };
  const state = {dispose() {
    if (cancelled) return;
    cancelled = true;
    unsubscribeLocale?.();
    bindings?.dispose();bindings=null;expected=null;
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
  const reportMapping=mapping=>{if(isCurrent()&&typeof options.onMappingChange==='function'){try{options.onMappingChange(mapping)}catch{/* A presentation callback does not own this renderer. */}}};
  const rebind=()=>{
    bindings=createEngravingNoteBindings(renderer,mount,identity,{...checked.options,color:checked.options.dark?'#f7cf68':'#925b12',cueColor:checked.options.dark?'#f3f5ef':'#17251d',onChange:reportMapping});renderGeneration++;
    if(expected)bindings.setExpectedWrittenNotes(expected);
    reportMapping(bindings.mappingStatus());
  };
  const getWidth = () => Math.max(320, Math.min(4096, Math.round(checked.options.width ?? container.clientWidth ?? 800) || 800));
  const resize = () => {
    if (!isCurrent() || !ready) return false;
    const nextWidth = getWidth();
    if (nextWidth === width) return true;
    width = nextWidth;
    mount.style.width = `${width}px`;
    try { bindings?.dispose();bindings=null;renderer.render();rebind();return true; } catch (error) {
      state.dispose();
      if (typeof options.onError === 'function') { try { options.onError(result('error', 'resize', i18n, {cause:error})); } catch { /* Consumer callbacks do not own cleanup. */ } }
      return false;
    }
  };
  try {
    const Renderer = await Promise.race([loadRenderer(document), cancellation]);
    if (!isCurrent() || !Renderer) return result('cancelled', 'cancelled', i18n);
    mount = document.createElement('div');
    mount.className = 'engraved-staff';
    mount.setAttribute('role', 'img');
    const redrawAria=()=>{if(isCurrent())mount.setAttribute('aria-label',i18n.t('notationRuntime.staffAria',{from:checked.options.fromMeasure,to:checked.options.toMeasure}))};
    redrawAria();unsubscribeLocale=i18n.subscribe(redrawAria);
    if(document.getElementById?.('written-cursor-status'))mount.setAttribute('aria-describedby','written-cursor-status');
    mount.style.visibility = 'hidden';
    mount.style.position = 'absolute';
    width = getWidth();
    mount.style.width = `${width}px`;
    container.appendChild(mount);
    // Collapsing visible-part rests can erase the continuation measures inside a
    // later source-index window. Keep every source measure available for paging.
    renderer = new Renderer(mount, {backend: 'svg', autoResize: false, autoGenerateMultipleRestMeasuresFromRestMeasures: false, disableCursor: true, followCursor: false, drawingParameters: 'default', drawTitle: !checked.options.compactHeader, drawSubtitle: !checked.options.compactHeader, drawComposer: !checked.options.compactHeader, drawPartNames: true, drawTimeSignatures: true, drawMeasureNumbers: true, darkMode: checked.options.dark, pageBackgroundColor: checked.options.dark ? '#171c1a' : '#ffffff', defaultColorMusic: checked.options.dark ? '#f3f5ef' : '#17251d', defaultColorLabel: checked.options.dark ? '#f3f5ef' : '#17251d', useGeometricSkyBottomLineCalculation: true, pageFormat: 'Endless', drawFromMeasureNumber: checked.options.fromMeasure, drawUpToMeasureNumber: checked.options.toMeasure});
    if (renderer.Version !== `${ENGRAVING_VERSION}-release`) { state.dispose(); return result('unavailable', 'version', i18n, {}, {version:ENGRAVING_VERSION}); }
    renderer.setLogLevel?.('error');
    // Passing a parsed Document avoids OSMD.load(string)'s automatic URL/MXL detection entirely.
    const loaded = renderer.load(checked.document);
    await Promise.race([loaded, cancellation]);
    if (!isCurrent()) return result('cancelled', 'cancelled', i18n);
    const instruments = renderer.Sheet?.Instruments;
    if (!Array.isArray(instruments) || !instruments.length || checked.options.partIds.some(id => !instruments.some(instrument => instrument.IdString === id))) {
      state.dispose(); return result('unsupported', 'rendererParts', i18n);
    }
    for (const instrument of instruments) instrument.Visible = checked.options.partIds.includes(instrument.IdString);
    // OSMD treats an initial implicit/pickup bar specially for its public number options.
    // Pin source indexes instead, so the adapter's ordinal range remains exact for pickups too.
    const rules = renderer.EngravingRules;
    rules.MinMeasureToDrawIndex = checked.options.fromMeasure - 1;
    rules.MaxMeasureToDrawIndex = checked.options.toMeasure - 1;
    rules.MinMeasureToDrawNumber = 0;
    rules.MaxMeasureToDrawNumber = 0;
    if(checked.options.compactHeader){rules.PageTopMargin=1;rules.PageTopMarginNarrow=1;}
    renderer.Zoom = checked.options.zoom;
    renderer.updateGraphic();
    renderer.render();
    if (!isCurrent()) return result('cancelled', 'cancelled', i18n);
    if (!mount.querySelector('svg')) { state.dispose(); return result('error', 'noStaff', i18n); }
    // OSMD draws with DOM/SVG primitives. No imported source is inserted with innerHTML.
    container.replaceChildren(mount);
    mount.style.position = 'relative';
    mount.style.visibility = '';
    ready = true;
    rebind();
    if (checked.options.responsive && checked.options.width === undefined && typeof view.ResizeObserver === 'function') {
      observer = new view.ResizeObserver(() => {
        if (!isCurrent() || frame !== undefined || getWidth() === width) return;
        const callback = () => { frame = undefined; resize(); };
        frame = useAnimationFrame ? view.requestAnimationFrame(callback) : setTimeout(callback, 16);
      });
      observer.observe(container);
    }
    return result('ready', 'ready', i18n, {metadata: checked.metadata, dispose: state.dispose, resize,
      mappingStatus:()=>bindings?.mappingStatus()||unavailableMapping(),
      renderGeneration:()=>renderGeneration,
      expectedNoteBounds:()=>bindings?.expectedNoteBounds()||{status:'unavailable',rects:[],unavailableSourceNoteIds:[]},
      setExpectedWrittenNotes(value){if(!isCurrent()||!bindings)return false;const accepted=bindings.setExpectedWrittenNotes(value);expected=accepted?{sourceNoteIds:[...value.sourceNoteIds],sourceMeasureIndex:value.sourceMeasureIndex}:null;return accepted},
      clearExpectedWrittenNotes(){expected=null;return bindings?.clearExpectedWrittenNotes()||false},
    });
  } catch (error) {
    const wasCancelled = !isCurrent();
    const hadRenderer = Boolean(renderer);
    state.dispose();
    return wasCancelled ? result('cancelled', 'cancelled', i18n) : result(hadRenderer ? 'error' : 'unavailable', hadRenderer ? 'renderFailed' : 'bundle', i18n, error?.code==='engraving_bundle'?{}:{cause:error});
  }
}

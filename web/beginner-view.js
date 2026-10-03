import {setupBeginnerNoteLabels} from './beginner-notes.js';

const ZERO = Object.freeze({numerator: 0, denominator: 1});
const compare = (a, b) => BigInt(a.numerator) * BigInt(b.denominator) - BigInt(b.numerator) * BigInt(a.denominator);
const sameKey = (a, b) => a?.fifths === b?.fifths && a?.mode === b?.mode;
const scoreKeys = new WeakMap();

/** Exact written ranges from Rust only; a key change inside a measure has no
 * key-event clock in the cursor contract, so it deliberately stays unresolved.
 * Never use note onsets or a tempo-derived beat as a proxy for that missing clock. */
export function beginnerScoreKey(score, written = null) {
  if (!score?.keys?.length) return {key: null, keyStatus: 'missing'};
  let keys = scoreKeys.get(score);
  if (!keys) {
    keys = score.keys.filter((key, index, all) => !index || !sameKey(key, all[index - 1]));
    scoreKeys.set(score, keys);
  }
  if (keys.length === 1 && compare(keys[0].at, ZERO) <= 0n) return {key: keys[0], keyStatus: 'known'};
  const occurrence = written?.occurrence;
  if (!occurrence) return {key: null, keyStatus: 'unresolved'};
  let low = 0, high = keys.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (compare(keys[middle].at, occurrence.source_from) <= 0n) low = middle + 1;
    else high = middle;
  }
  if (keys[low] && compare(keys[low].at, occurrence.source_to) < 0n) return {key: null, keyStatus: 'unresolved'};
  const current = keys[low - 1] || null;
  return {key: current, keyStatus: current ? 'known' : 'missing'};
}

/** Session-only opt-in display. Owns no performance input, score, or recorder. */
export function setupBeginnerView({document, i18n, getContext, onNumberedMode}) {
  const $ = id => document.getElementById(id);
  const create = (tag, id, className) => {
    const node = document.createElement(tag);
    if (id) node.id = id;
    if (className) node.className = className;
    return node;
  };
  let enabled = false, lastSignature = '', lastMapping = null, disposed = false;
  const translations = [], controls = [];
  const localized = (tag, id, key) => {const node = create(tag, id); translations.push([node, key]); return node;};
  function control(prefix, host, before) {
    const panel = create('div', `${prefix}beginner-controls`, 'beginner-controls');
    panel.dataset.keyboardInput = 'off';
    const label = create('label', null, 'beginner-toggle-label');
    const toggle = create('input', `${prefix}beginner-enabled`); toggle.type = 'checkbox';
    const labelText = localized('span', null, 'beginner.enabled'); labelText.className = 'beginner-full-label';
    const shortLabel = create('span', null, 'beginner-short-label'); shortLabel.textContent = '1·2·3'; shortLabel.setAttribute('aria-hidden', 'true');
    label.append(toggle, labelText, shortLabel);
    const modeLabel = create('label');
    const mode = create('select', `${prefix}beginner-numbered-mode`);
    for (const value of ['fixed', 'movable']) {const option = localized('option', null, `beginner.${value}`); option.value = value; mode.append(option);}
    modeLabel.append(localized('span', null, 'beginner.numberedMode'), mode);
    const reference = create('p', `${prefix}beginner-reference`, 'beginner-reference');
    // No live region: a musical key can change during playback. Players may read
    // the current reference on demand without continuous screen-reader speech.
    const details = create('details');
    const summary = create('summary'), summaryText = localized('span', null, 'beginner.title'); summaryText.className = 'beginner-full-label';
    const shortSummary = create('span', null, 'beginner-short-label'); shortSummary.textContent = '?'; shortSummary.setAttribute('aria-hidden', 'true');
    summary.append(summaryText, shortSummary);
    const body = create('div', null, 'beginner-help-body');
    body.append(modeLabel, localized('p', `${prefix}beginner-help`, 'beginner.help'), localized('p', null, 'beginner.spellingPolicy'));
    details.append(summary, body);
    toggle.setAttribute('aria-describedby', `${prefix}beginner-help ${reference.id}`);
    mode.setAttribute('aria-describedby', reference.id);
    panel.append(label, reference, details);
    host.insertBefore(panel, before || null);
    toggle.addEventListener('change', () => {enabled = toggle.checked; refresh(true);});
    mode.addEventListener('change', () => {onNumberedMode(mode.value); refresh(true);});
    const control = {panel, toggle, label, summary, details, body, mode, modeLabel, reference, free: prefix === 'free-'};
    controls.push(control); return control;
  }
  // The keyboard footer already lives in Settings on an initial compact load.
  // Anchor to the instrument's stable transport instead of that movable footer.
  const transport = document.querySelector('.play-panel>.transport');
  const stageControl = control('', transport.parentElement, transport);
  const stageHome = document.createComment('Beginner guide stage position'); stageControl.panel.before(stageHome);
  const heading = $('stage-title')?.parentElement;
  const shortLandscape = document.defaultView?.matchMedia?.('(max-height:800px), (max-width:650px)');
  const freeControlsHost=document.querySelector('.free-stage-footer')||$('free-practice-keys').parentElement;
  const freeControl=control('free-', freeControlsHost, freeControlsHost.firstElementChild);
  const freeHome=document.createComment('Free guide stage position');freeControl.panel.before(freeHome);
  const freeHeading=$('free-practice-title')?.parentElement;
  function arrangeControls() {
    for(const [item,home,target]of [[stageControl,stageHome,heading],[freeControl,freeHome,freeHeading]]){
      const compact=Boolean(shortLandscape?.matches&&target),{panel,reference,body,details}=item;
      panel.classList.toggle('beginner-controls-compact',compact);
      if(compact){if(panel.parentElement!==target)target.append(panel);if(reference.parentElement!==body)body.prepend(reference);}
      else{if(home.parentNode&&panel.previousSibling!==home)home.after(panel);if(reference.parentElement!==panel)panel.insertBefore(reference,details);}
    }
  }
  shortLandscape?.addEventListener('change', arrangeControls); arrangeControls();
  const surfaces = [
    {root: $('keyboard')}, {root: $('fretboard')},
    {root: $('free-practice-keys'), free: true},
    {root: $('keyboard-map'), selector: '[data-note-midi]', getMidi: key => key.dataset.enabled === 'true' && /^\d+$/.test(key.dataset.noteMidi) ? Number(key.dataset.noteMidi) : null},
  ].map(surface => ({...surface, labels: setupBeginnerNoteLabels({...surface, i18n})}));
  function refresh(force = false) {
    if (disposed) return;
    const context = getContext();
    const scoreContext = context.numberedMode === 'movable' ? beginnerScoreKey(context.score, context.written) : {key: null};
    const signature = JSON.stringify([enabled, context.numberedMode, scoreContext.key?.fifths, scoreContext.key?.mode, scoreContext.keyStatus, i18n.revision]);
    if (!force && signature === lastSignature) return;
    lastSignature = signature;
    for (const [node, key] of translations) node.textContent = i18n.t(key);
    let stageDisplay, freeDisplay;
    for (const surface of surfaces) {
      surface.root.classList.toggle('beginner-labels-enabled', enabled);
      if (surface.root.id === 'fretboard') surface.root.style.setProperty('--beginner-string-count', String(surface.root.querySelectorAll('.string-name').length || 6));
      const display = surface.labels.render({enabled, numberedMode: context.numberedMode, ...(surface.free ? {key: null} : scoreContext)});
      if (surface.free) freeDisplay = display; else stageDisplay = display;
    }
    for (const control of controls) {
      control.toggle.checked = enabled;
      control.mode.value = context.numberedMode;
      control.modeLabel.hidden = !enabled;
      control.reference.hidden = !enabled;
      control.reference.textContent = (control.free ? freeDisplay : stageDisplay).reference;
      control.label.title = i18n.t('beginner.enabled');
      control.summary.title = i18n.t('beginner.title');
    }
  }
  const unsubscribe = i18n.subscribe(() => refresh(true));
  refresh(true);
  return {refresh, enabled: () => enabled, refreshMapping(configurationId) {
    const changed = configurationId !== lastMapping; lastMapping = configurationId;
    refresh(changed);
  }, dispose() {
    if (disposed) return;
    disposed = true; unsubscribe(); shortLandscape?.removeEventListener('change', arrangeControls); stageHome.remove();freeHome.remove();
    for (const {root, labels} of surfaces) {labels.dispose(); root.classList.remove('beginner-labels-enabled');}
    for (const {panel} of controls) panel.remove();
  }};
}

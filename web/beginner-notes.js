import {jianpu, keyTonic, pitchMidi} from './music.js';

const STEPS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const SEMITONES = [0, 2, 4, 5, 7, 9, 11];
const FIXED_TONIC = keyTonic({fifths: 0, mode: 'major'});
let descriptionSequence = 0;

/** Display context only. A missing/unsupported movable key explicitly falls back to C4. */
export function resolveBeginnerContext({numberedMode = 'fixed', key = null, keyStatus = null} = {}) {
  if (!['fixed', 'movable'].includes(numberedMode)) throw new RangeError('Unknown beginner numbered mode.');
  const movable = numberedMode === 'movable' ? keyTonic(key) : null;
  const tonic = movable || FIXED_TONIC;
  return Object.freeze({
    numberedMode, effectiveMode: movable ? 'movable' : 'fixed',
    key: movable ? Object.freeze({fifths: key.fifths, mode: key.mode}) : null,
    fallback: numberedMode !== 'movable' || movable ? null : key == null ? keyStatus === 'unresolved' ? 'unresolved-key' : 'missing-key' : 'unsupported-key',
    tonic: Object.freeze({...tonic, signature: Object.freeze({...tonic.signature})}),
    referenceMidi: pitchMidi({step: tonic.step, alter: tonic.signature[tonic.step], octave: tonic.octave}),
  });
}

/**
 * An anonymous key has no source spelling. Prefer a signature tone; otherwise
 * minimize its alteration from the signature, choosing a raised degree on ties.
 * This gives fixed-C sharps and also handles C-flat / B-sharp octave boundaries.
 */
export function beginnerNoteLabel(midi, options = {}) {
  if (!Number.isInteger(midi) || midi < 0 || midi > 127) throw new RangeError('Beginner note MIDI must be an integer from 0 to 127.');
  const context = resolveBeginnerContext(options);
  let best;
  STEPS.forEach((step, index) => {
    const signatureAlter = context.tonic.signature[step];
    const base = SEMITONES[index] + signatureAlter;
    let octave = Math.floor((midi - base) / 12) - 1;
    let deviation = midi - (12 * (octave + 1) + base);
    if (deviation > 6) { octave++; deviation -= 12; }
    if (!best || Math.abs(deviation) < Math.abs(best.deviation)
      || Math.abs(deviation) === Math.abs(best.deviation) && deviation > best.deviation) {
      best = {step, octave, alter: signatureAlter + deviation, deviation};
    }
  });
  const pitch = Object.freeze({step: best.step, octave: best.octave, alter: best.alter});
  const numbered = jianpu(pitch, context.key);
  return Object.freeze({midi, pitch, context, ...numbered, deviation: best.deviation,
    aboveDots: Math.max(0, numbered.octave), belowDots: Math.max(0, -numbered.octave),
    pitchName: `${pitch.step}${pitch.alter > 0 ? '♯'.repeat(pitch.alter) : '♭'.repeat(-pitch.alter)}${pitch.octave}`,
  });
}

export function beginnerReferenceText(context, i18n) {
  if (context.fallback) return i18n.t(context.fallback === 'unresolved-key' ? 'beginner.referenceUnresolved' : context.fallback === 'missing-key' ? 'beginner.referenceMissing' : 'beginner.referenceUnsupported');
  if (context.effectiveMode === 'fixed') return i18n.t('beginner.referenceFixed');
  return i18n.t(context.key.mode === 'minor' ? 'beginner.referenceMinor' : 'beginner.referenceMajor', {tonic: `${context.tonic.name}${context.tonic.octave}`});
}

export function beginnerNoteDescription(label, i18n) {
  const degree = i18n.t(label.deviation > 0 ? 'beginner.degreeRaised' : label.deviation < 0 ? 'beginner.degreeLowered' : 'beginner.degree', {degree: label.number});
  const octave = label.octave === 0 ? i18n.t('beginner.octaveReference')
    : i18n.t(label.octave > 0 ? 'beginner.octaveAbove' : 'beginner.octaveBelow', {count: Math.abs(label.octave)});
  return i18n.t('beginner.noteDescription', {degree, octave, reference: beginnerReferenceText(label.context, i18n), pitch: label.pitchName});
}

function attributeMidi(key) {
  const value = key.getAttribute('data-midi');
  return /^(0|[1-9][0-9]{0,2})$/.test(value ?? '') ? Number(value) : null;
}

/**
 * Opt-in supplementary display. Call render after the owning view updates keys.
 * getMidi must return the actual sounded MIDI, with any input transpose already
 * applied. A score transpose changes key context separately. No input is sent.
 */
export function setupBeginnerNoteLabels({root, i18n, selector = '[data-midi]', getMidi = attributeMidi}) {
  if (!root?.querySelectorAll || !i18n?.t) throw new TypeError('Beginner labels require a root and the shared locale service.');
  const document = root.ownerDocument, records = new Map();
  let lastOptions = {enabled: false}, disposed = false;
  function remove(key, record) {
    record.glyph.remove(); record.description.remove();
    const ids = (key.getAttribute('aria-describedby') || '').split(/\s+/).filter(id => id && id !== record.description.id);
    if (ids.length) key.setAttribute('aria-describedby', ids.join(' '));
    else key.removeAttribute('aria-describedby');
    records.delete(key);
  }
  function create(key) {
    const span = className => { const node = document.createElement('span'); node.className = className; return node; };
    const glyph = span('beginner-note-label'), above = span('beginner-note-above'), tone = span('beginner-note-tone'), below = span('beginner-note-below');
    glyph.setAttribute('aria-hidden', 'true');
    glyph.style.cssText = 'display:inline-grid;grid-template-rows:auto auto auto;text-align:center;pointer-events:none;line-height:1';
    for (const dots of [above, below]) dots.style.cssText = 'white-space:pre;line-height:.5;min-height:.5em;font-size:.7em';
    glyph.append(above, tone, below);
    const description = span('beginner-note-description'); description.hidden = true;
    do { description.id = `beginner-note-description-${++descriptionSequence}`; } while (document.getElementById(description.id));
    key.append(glyph, description);
    const record = {glyph, above, tone, below, description}; records.set(key, record); return record;
  }
  function render(options = lastOptions) {
    if (disposed) return null;
    const context = resolveBeginnerContext(options);
    lastOptions = {enabled: options.enabled === true, numberedMode: context.numberedMode,
      key: options.key == null ? null : {fifths: options.key.fifths, mode: options.key.mode}, keyStatus: options.keyStatus};
    const present = new Set();
    if (lastOptions.enabled) for (const key of root.querySelectorAll(selector)) {
      const midi = getMidi(key);
      if (!Number.isInteger(midi) || midi < 0 || midi > 127 || key.disabled) continue;
      const label = beginnerNoteLabel(midi, lastOptions);
      let record = records.get(key);
      if (record && (record.glyph.parentNode !== key || record.description.parentNode !== key)) { remove(key, record); record = null; }
      record ||= create(key); present.add(key);
      record.glyph.dataset.octaveDots = String(Math.abs(label.octave));
      record.above.textContent = Array(label.aboveDots).fill('•').join('\n');
      record.tone.textContent = `${label.accidental}${label.number}`;
      record.below.textContent = Array(label.belowDots).fill('•').join('\n');
      record.description.textContent = beginnerNoteDescription(label, i18n);
      const ids = new Set((key.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean));
      ids.add(record.description.id); key.setAttribute('aria-describedby', [...ids].join(' '));
    }
    for (const [key, record] of records) if (!present.has(key)) remove(key, record);
    return {enabled: lastOptions.enabled, count: present.size, context, reference: beginnerReferenceText(context, i18n)};
  }
  const unsubscribe = i18n.subscribe?.(() => render());
  return {render, dispose() {
    if (disposed) return;
    disposed = true; unsubscribe?.();
    for (const [key, record] of records) remove(key, record);
  }};
}

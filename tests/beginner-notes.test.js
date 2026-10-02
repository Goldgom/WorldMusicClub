import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {jianpu, keyAt, keyTonic, pitchMidi} from '../web/music.js';
import {beginnerNoteLabel, resolveBeginnerContext, beginnerReferenceText, beginnerNoteDescription, setupBeginnerNoteLabels} from '../web/beginner-notes.js';
import schema from '../web/locales/beginner-schema.js';
import en from '../web/locales/beginner-en.js';
import zh from '../web/locales/beginner-zh-CN.js';

const STEPS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'], NATURAL = [0, 2, 4, 5, 7, 9, 11];
const compact = label => [label.accidental + label.number, label.octave];
// Isolated bundle adapter: the coordinator registers these keys with the shared
// createI18n service. This fixture also rejects undeclared/missing parameters.
function localeService(locale = 'en') {
  const observers = new Set();
  return {locale, t(key, values = {}) {
    assert.ok(schema[key], `Known key ${key}`);
    assert.deepEqual(Object.keys(values).sort(), Object.keys(schema[key].params).sort(), key);
    let template = (this.locale === 'en' ? en : zh)[key];
    if (typeof template !== 'string') template = template[new Intl.PluralRules(this.locale).select(values[schema[key].plural])] ?? template.other;
    return template.replace(/\{(\w+)\}/g, (_, name) => values[name]);
  }, subscribe(callback) { observers.add(callback); return () => observers.delete(callback); },
  setLocale(next) { this.locale = next; for (const callback of observers) callback(); },
  observerCount() { return observers.size; }};
}

test('fixed C4 covers all white/black keys and both extreme MIDI octaves', () => {
  assert.deepEqual(Array.from({length: 12}, (_, offset) => compact(beginnerNoteLabel(60 + offset))),
    [['1', 0], ['♯1', 0], ['2', 0], ['♯2', 0], ['3', 0], ['4', 0], ['♯4', 0], ['5', 0], ['♯5', 0], ['6', 0], ['♯6', 0], ['7', 0]]);
  assert.deepEqual(compact(beginnerNoteLabel(0)), ['1', -5]);
  assert.equal(beginnerNoteLabel(0).pitchName, 'C-1');
  assert.equal(beginnerNoteLabel(0).belowDots, 5);
  assert.deepEqual(compact(beginnerNoteLabel(59)), ['7', -1]);
  assert.deepEqual(compact(beginnerNoteLabel(72)), ['1', 1]);
  assert.deepEqual(compact(beginnerNoteLabel(127)), ['5', 5]);
  assert.equal(beginnerNoteLabel(127).aboveDots, 5);
});

test('movable mode respects major/minor signatures, enharmonic octaves and tonic=1', () => {
  const movable = (midi, fifths, mode = 'major') => beginnerNoteLabel(midi, {numberedMode: 'movable', key: {fifths, mode}});
  assert.deepEqual(compact(movable(67, 1)), ['1', 0]);
  assert.deepEqual(compact(movable(66, 1)), ['7', -1]);
  assert.deepEqual(compact(movable(65, 1)), ['♯6', -1], 'Anonymous F is consistently spelled E-sharp relative to G major');
  assert.deepEqual(compact(movable(69, 0, 'minor')), ['1', 0]);
  assert.deepEqual(compact(movable(72, 0, 'minor')), ['3', 0], 'Natural minor signature is preserved, not major intervals from the minor tonic');
  assert.deepEqual(compact(movable(60, 0, 'minor')), ['3', -1]);
  assert.deepEqual(compact(movable(68, 0, 'minor')), ['♯7', -1]);
  assert.deepEqual(compact(movable(59, -7)), ['1', 0]);
  assert.equal(movable(59, -7).pitchName, 'C♭4');
  assert.deepEqual(compact(movable(60, 7)), ['7', -1]);
  assert.equal(movable(60, 7).pitchName, 'B♯3');
  assert.equal(movable(0, 7, 'minor').pitchName, 'B♯-2');
  assert.equal(movable(0, 7, 'minor').belowDots, 6);
});

test('all MIDI pitches in every supported signature reconstruct exactly from displayed degree and octave', () => {
  for (const mode of ['major', 'minor']) for (let fifths = -7; fifths <= 7; fifths++) {
    const key = Object.freeze({fifths, mode}), tonic = keyTonic(key);
    for (let midi = 0; midi <= 127; midi++) {
      const label = beginnerNoteLabel(midi, {numberedMode: 'movable', key});
      assert.equal(pitchMidi(label.pitch), midi, `${mode}/${fifths}/${midi}`);
      assert.deepEqual({number: label.number, accidental: label.accidental, octave: label.octave}, jianpu(label.pitch, key));
      // Independently decode the number and octave from the written tonic.
      const diatonic = 4 * 7 + STEPS.indexOf(tonic.step) + label.octave * 7 + Number(label.number) - 1;
      const stepIndex = ((diatonic % 7) + 7) % 7;
      const decoded = 12 * (Math.floor(diatonic / 7) + 1) + NATURAL[stepIndex] + tonic.signature[STEPS[stepIndex]] + label.deviation;
      assert.equal(decoded, midi);
      assert.ok(label.deviation === 0 || label.deviation === 1, 'Every chromatic tie chooses the raised degree');
      const signatureClasses = STEPS.map((step, i) => ((NATURAL[i] + tonic.signature[step]) % 12 + 12) % 12);
      assert.equal(label.deviation === 0, signatureClasses.includes(midi % 12), 'Key-signature tones win over enharmonic accidentals');
      assert.equal(label.aboveDots, Math.max(label.octave, 0));
      assert.equal(label.belowDots, Math.max(-label.octave, 0));
      if (midi <= 115) {
        const next = beginnerNoteLabel(midi + 12, {numberedMode: 'movable', key});
        assert.equal(next.number, label.number); assert.equal(next.accidental, label.accidental);
        assert.equal(next.octave, label.octave + 1);
      }
    }
  }
});

test('context reports missing/unsupported keys explicitly and never changes an input key', () => {
  const i18n = localeService(), key = Object.freeze({fifths: -7, mode: 'major', source: 'unchanged'});
  const context = resolveBeginnerContext({numberedMode: 'movable', key});
  assert.equal(context.referenceMidi, 59);
  assert.equal(context.tonic.name, 'C♭');
  assert.deepEqual(key, {fifths: -7, mode: 'major', source: 'unchanged'});
  assert.throws(() => { context.tonic.signature.C = 0; }, TypeError);
  assert.equal(resolveBeginnerContext({key}).referenceMidi, 60, 'Fixed mode ignores score key');
  const missing = resolveBeginnerContext({numberedMode: 'movable'});
  assert.equal(missing.fallback, 'missing-key'); assert.match(beginnerReferenceText(missing, i18n), /No score key.*C4/);
  for (const invalid of [{fifths: 8, mode: 'major'}, {fifths: 1.5, mode: 'major'}, {fifths: 0, mode: 'dorian'}, {}]) {
    const options = {numberedMode: 'movable', key: invalid}, fallback = resolveBeginnerContext(options);
    assert.equal(fallback.fallback, 'unsupported-key'); assert.equal(fallback.effectiveMode, 'fixed');
    assert.match(beginnerReferenceText(fallback, i18n), /Unsupported score key/);
    assert.deepEqual(compact(beginnerNoteLabel(61, options)), ['♯1', 0]);
  }
  for (const invalid of [-1, 128, 60.5, NaN, Infinity, '60', null, undefined]) assert.throws(() => beginnerNoteLabel(invalid), RangeError);
  assert.throws(() => beginnerNoteLabel(60, {numberedMode: 'unknown'}), RangeError);
});

test('score key changes, score transposition and sounded-input transposition are separate display inputs', () => {
  const score = {keys: [{at: {numerator: 0, denominator: 1}, fifths: 0, mode: 'major'}, {at: {numerator: 3, denominator: 2}, fifths: 2, mode: 'major'}]};
  const before = structuredClone(score);
  const at = position => ({numberedMode: 'movable', key: keyAt(score, position)});
  assert.deepEqual(compact(beginnerNoteLabel(60, at(1))), ['1', 0]);
  assert.deepEqual(compact(beginnerNoteLabel(60, at(1.5))), ['♯6', -1]);
  assert.deepEqual(compact(beginnerNoteLabel(62, at(1.5))), ['1', 0]);
  assert.deepEqual(compact(beginnerNoteLabel(62, at(1))), ['2', 0], 'Input +2 changes actual pitch without changing the score tonic');
  assert.deepEqual(score, before);
});

test('locale bundles have equal explicit contracts and complete named parameters', () => {
  for (const catalog of [en, zh]) {
    assert.deepEqual(Object.keys(catalog).sort(), Object.keys(schema).sort());
    for (const [key, spec] of Object.entries(schema)) {
      const templates = typeof catalog[key] === 'string' ? [catalog[key]] : Object.values(catalog[key]);
      assert.equal(typeof catalog[key] === 'object', Boolean(spec.plural), key);
      for (const template of templates) assert.deepEqual([...new Set([...template.matchAll(/\{(\w+)\}/g)].map(match => match[1]))].sort(), Object.keys(spec.params).sort(), key);
    }
  }
  const i18n = localeService();
  assert.match(beginnerNoteDescription(beginnerNoteLabel(49), i18n), /raised degree 1; 1 octave below.*C♯3/);
  assert.match(beginnerNoteDescription(beginnerNoteLabel(24), i18n), /3 octaves below/);
  i18n.setLocale('zh-CN');
  assert.match(beginnerNoteDescription(beginnerNoteLabel(61), i18n), /升高音级 1.*实际发声音高 C♯4/);
});

function fixture() {
  const {document, window} = parseHTML('<html><body><p id="existing-help">Existing help</p><div id="keys"><button data-midi="60" aria-label="Play C4" aria-describedby="existing-help" aria-pressed="true" class="held"><span class="note-name">C4</span><kbd>A</kbd></button><button data-midi="61"><span>C♯4</span></button><button data-midi="72"><span>C5</span></button><button data-midi="0"><span>C-1</span></button><button disabled data-midi="62">Disabled</button><button data-midi="128">Invalid</button><button data-midi="">Empty</button></div></body></html>');
  const root = document.getElementById('keys'), i18n = localeService();
  return {document, window, root, i18n, ui: setupBeginnerNoteLabels({root, i18n})};
}

test('opt-in decoration preserves keys, nested controls, held state, listeners and existing accessible description', () => {
  const {root, document, window, i18n, ui} = fixture();
  const key = root.firstElementChild, name = key.querySelector('.note-name'), legend = key.querySelector('kbd');
  let clicks = 0; key.addEventListener('click', () => clicks++);
  assert.equal(root.querySelector('.beginner-note-label'), null);
  assert.equal(ui.render().count, 0);
  assert.equal(ui.render({enabled: true}).count, 4);
  const glyph = key.querySelector('.beginner-note-label'), description = key.querySelector('.beginner-note-description');
  assert.equal(key.querySelector('.note-name'), name); assert.equal(key.querySelector('kbd'), legend);
  assert.equal(glyph.getAttribute('aria-hidden'), 'true'); assert.equal(glyph.style.pointerEvents, 'none');
  assert.equal(description.hidden, true); assert.match(description.textContent, /degree 1; reference octave.*C4/);
  assert.deepEqual(key.getAttribute('aria-describedby').split(' '), ['existing-help', description.id]);
  assert.equal(key.getAttribute('aria-label'), 'Play C4'); assert.equal(key.getAttribute('aria-pressed'), 'true'); assert.equal(key.className, 'held');
  key.dispatchEvent(new window.Event('click')); assert.equal(clicks, 1);
  for (let i = 0; i < 3; i++) ui.render({enabled: true});
  assert.equal(key.querySelector('.beginner-note-label'), glyph); assert.equal(key.querySelector('.beginner-note-description'), description);
  assert.equal(key.querySelectorAll('.beginner-note-label').length, 1);
  assert.equal(document.querySelector('[data-midi="0"] .beginner-note-below').textContent, '•\n•\n•\n•\n•');
  assert.equal(document.querySelector('[data-midi="72"] .beginner-note-above').textContent, '•');
  i18n.setLocale('zh-CN'); assert.match(description.textContent, /简谱：音级 1/); assert.equal(key.querySelector('.beginner-note-label'), glyph);
  key.setAttribute('aria-describedby', `${key.getAttribute('aria-describedby')} another-owner`);
  ui.render({enabled: false});
  assert.equal(root.querySelector('.beginner-note-label'), null); assert.equal(root.querySelector('.beginner-note-description'), null);
  assert.equal(key.getAttribute('aria-describedby'), 'existing-help another-owner'); assert.equal(key.querySelector('kbd'), legend);
  key.dispatchEvent(new window.Event('click')); assert.equal(clicks, 2);
  ui.dispose(); ui.dispose(); assert.equal(i18n.observerCount(), 0); assert.equal(ui.render({enabled: true}), null);
});

test('rerenders reflect actual sounded MIDI/context and recover after an owning view replaces key content', () => {
  const {root, ui, i18n} = fixture(), key = root.firstElementChild;
  ui.render({enabled: true}); const glyph = key.querySelector('.beginner-note-label');
  key.setAttribute('data-midi', '62'); key.setAttribute('aria-label', 'Play D4');
  ui.render({enabled: true}); assert.equal(glyph.querySelector('.beginner-note-tone').textContent, '2');
  assert.equal(key.getAttribute('aria-label'), 'Play D4');
  ui.render({enabled: true, numberedMode: 'movable', key: {fifths: 2, mode: 'major'}});
  assert.equal(glyph.querySelector('.beginner-note-tone').textContent, '1');
  assert.match(key.querySelector('.beginner-note-description').textContent, /Movable major reference: 1 = D4/);
  key.replaceChildren(root.ownerDocument.createTextNode('Renderer changed this key'));
  ui.render({enabled: true}); assert.equal(key.querySelectorAll('.beginner-note-label').length, 1);
  assert.equal(key.getAttribute('aria-describedby').split(' ').length, 2, 'Old owned description ID was removed');
  const replacementGlyph = key.querySelector('.beginner-note-label'); key.remove(); ui.render({enabled: true});
  assert.equal(replacementGlyph.parentNode, null); assert.equal(key.getAttribute('aria-describedby'), 'existing-help');
  ui.dispose(); assert.equal(i18n.observerCount(), 0);
});

test('custom input mapping labels its final sounded MIDI once; invalid or disabled keys get no guide', () => {
  const {root, i18n} = fixture();
  const ui = setupBeginnerNoteLabels({root, i18n, getMidi: key => Number(key.getAttribute('data-midi')) + 12});
  const state = ui.render({enabled: true, numberedMode: 'movable'});
  assert.equal(state.context.fallback, 'missing-key'); assert.match(state.reference, /No score key/);
  assert.equal(root.firstElementChild.querySelector('.beginner-note-above').textContent, '•');
  assert.match(root.firstElementChild.querySelector('.beginner-note-description').textContent, /Sounded pitch C5/);
  assert.equal(root.querySelector('[disabled] .beginner-note-label'), null);
  assert.equal(root.querySelector('[data-midi="128"] .beginner-note-label'), null);
  root.firstElementChild.disabled = true; ui.render({enabled: true}); assert.equal(root.firstElementChild.querySelector('.beginner-note-label'), null);
  ui.dispose();
});

test('descriptions render literal locale text without introducing markup or changing source labels', () => {
  const {root, i18n} = fixture(), original = i18n.t;
  i18n.t = function(key, params) { return key === 'beginner.noteDescription' ? '<img src=x onerror=bad> & literal' : original.call(this, key, params); };
  const ui = setupBeginnerNoteLabels({root, i18n}); ui.render({enabled: true});
  assert.equal(root.querySelector('img'), null);
  assert.equal(root.querySelector('.beginner-note-description').textContent, '<img src=x onerror=bad> & literal');
  assert.equal(root.querySelector('.note-name').textContent, 'C4');
  ui.dispose();
});

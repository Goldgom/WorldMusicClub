import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {renderNotation} from '../web/music.js';
import {createBasicNotationReveal} from '../web/notation-follow.js';
import {fixture} from './frontend-fixtures.js';
import {originalStaffRegisterScore} from './staff-register-fixtures.js';

const render = (score, options = {}) => parseHTML(renderNotation(score, 'staff', {width: 720, spanBeats: 4, ...options})).document.querySelector('svg');
const n = (element, name) => Number(element.getAttribute(name));

// Independent geometric envelopes for the SVG primitives, with stroke/font
// allowance. Actual font boxes and ancestor clipping are checked by the hosted
// browser regression; this Node test never launches a browser.
function noteExtent(note) {
  const bounds = [...note.children].map(element => {
    if (element.localName === 'ellipse') return [n(element, 'cy') - 9, n(element, 'cy') + 9];
    if (element.localName === 'line') return [Math.min(n(element, 'y1'), n(element, 'y2')) - 1, Math.max(n(element, 'y1'), n(element, 'y2')) + 1];
    if (element.localName === 'path') {
      const [, y] = element.getAttribute('d').match(/^M[\d.]+ ([\d.-]+)/);
      return [Number(y) - 1.5, Number(y) + 19.5];
    }
    const y = n(element, 'y');
    return element.classList.contains('rest') ? [y - 28, y + 7] : [y - 21, y + 6];
  });
  return {top: Math.min(...bounds.map(value => value[0])), bottom: Math.max(...bounds.map(value => value[1]))};
}

for (const register of ['low', 'high', 'extremes', 'chord']) test(`basic staff contains every ${register} note, accidental, flag and ledger line at every responsive width`, () => {
  const score = originalStaffRegisterScore(register), before = structuredClone(score);
  for (const width of [240, 288, 600, 1050]) {
    const svg = render(score, {width}), height = n(svg, 'height'), notes = [...svg.querySelectorAll('.score-note')];
    assert.equal(n(svg, 'width'), width);
    assert.ok(height > 170 && height < 700, `${register} has finite content-driven height: ${height}`);
    assert.deepEqual(svg.getAttribute('viewBox').split(' ').map(Number), [0, 0, width, height]);
    assert.deepEqual(notes.map(note => note.dataset.noteId), score.parts[0].notes.map(note => note.id));
    for (const note of notes) {
      const bounds = noteExtent(note);
      assert.ok(bounds.top >= 32 && bounds.bottom < height - 8, `${note.dataset.noteId}: ${JSON.stringify(bounds)} in ${height}`);
    }
    assert.equal(svg.querySelector('.clef').textContent, '𝄞', 'Guide retains its declared treble reference');
  }
  assert.deepEqual(score, before, 'Exact source pitches, onset/duration rationals, voices and IDs stay intact');
});

test('normal staff geometry and empty-page height remain unchanged', () => {
  const svg = render(fixture);
  assert.equal(n(svg, 'height'), 170);
  assert.deepEqual([...svg.querySelectorAll('.staff-line')].map(line => n(line, 'y1')), [38, 50, 62, 74, 86]);
  assert.deepEqual([...svg.querySelectorAll('.note-head')].map(head => [n(head, 'cx'), n(head, 'cy')]), [[90, 98], [246, 86]]);
  assert.equal(n(render(originalStaffRegisterScore('extremes'), {startBeat: 4}), 'height'), 170);
});

test('whole and half heads and short flags each reserve their own complete vertical extent', () => {
  for (const duration of [{numerator: 4, denominator: 1}, {numerator: 2, denominator: 1}, {numerator: 1, denominator: 1}, {numerator: 1, denominator: 64}]) {
    const score = originalStaffRegisterScore('extremes');
    score.parts[0].notes = score.parts[0].notes.filter(note => note.pitch).map(note => ({...note, duration}));
    const svg = render(score), height = n(svg, 'height');
    for (const note of svg.querySelectorAll('.score-note')) {
      const bounds = noteExtent(note);
      assert.ok(bounds.top >= 32 && bounds.bottom < height - 8);
    }
    assert.equal(svg.querySelectorAll('.note-flag').length, duration.denominator === 64 ? 4 : 0);
    assert.equal(svg.querySelectorAll('.open-head').length, duration.numerator >= 2 ? 4 : 0);
  }
});

test('all parts reserve independent vertical extents and off-page extremes cannot enlarge the current page', () => {
  const score = originalStaffRegisterScore('low');
  score.parts.push({...originalStaffRegisterScore('high').parts[0], id: 'upper'});
  const svg = render(score, {allParts: true}), labels = [...svg.querySelectorAll('.part-name')];
  const first = [...svg.querySelectorAll('.score-note')].filter(note => note.dataset.noteId.startsWith('register-low-'));
  const last = [...svg.querySelectorAll('.score-note')].filter(note => note.dataset.noteId.startsWith('register-high-'));
  assert.ok(Math.max(...first.map(note => noteExtent(note).bottom)) < n(labels[1], 'y') - 12);
  assert.ok(Math.min(...last.map(note => noteExtent(note).top)) > n(labels[1], 'y') + 6);
  assert.ok(Math.max(...last.map(note => noteExtent(note).bottom)) < n(svg, 'height'));
  const selected = render(score, {partId: 'piano'});
  assert.equal(n(selected, 'height'), n(render(originalStaffRegisterScore('low')), 'height'));
  const ordinary = structuredClone(fixture), before = render(ordinary).outerHTML;
  ordinary.parts[0].notes.push(...originalStaffRegisterScore('extremes').parts[0].notes.map(note => ({...note, at: {numerator: 1000000, denominator: 1}})));
  assert.equal(render(ordinary).outerHTML, before);
});

test('expanded basic staff keeps exact current-note identities and reveal uses the full current glyph', () => {
  const score = originalStaffRegisterScore('low'), source = score.parts[0].notes[0];
  source.id = 'low " & é';
  const {document} = parseHTML(`<aside id="dock"><div id="notation">${renderNotation(score, 'staff', {width: 720, spanBeats: 4})}</div></aside>`);
  const dock = document.getElementById('dock'), container = document.getElementById('notation');
  const note = [...container.querySelectorAll('.score-note')].find(node => node.dataset.noteId === source.id);
  note.classList.add('active');
  assert.equal(container.querySelectorAll('.score-note.active').length, 1);
  assert.equal(note.dataset.noteId, source.id);
  const bounds = noteExtent(note), box = {left: 60, right: 105, top: bounds.top, bottom: bounds.bottom, width: 45, height: bounds.bottom - bounds.top};
  note.getBoundingClientRect = () => box;
  for (const node of [dock, container]) {
    Object.assign(node, {clientTop: 0, clientLeft: 0, clientWidth: 720, clientHeight: 180, scrollTop: 0, scrollLeft: 0,
      scrollHeight: n(container.querySelector('svg'), 'height'), scrollWidth: 720});
    node.getBoundingClientRect = () => ({left: 0, right: 720, top: 0, bottom: 180});
    node.scrollTo = ({top, left}) => {node.scrollTop = top; node.scrollLeft = left;};
  }
  const result = createBasicNotationReveal({container, dock}).reveal('original-current', [source.id]);
  assert.equal(result.status, 'ready');
  assert.ok(dock.scrollTop > 0 && bounds.bottom - dock.scrollTop <= 180, 'The low note can be revealed inside the dock');
});

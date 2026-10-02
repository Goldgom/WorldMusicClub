import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {notationLayout, renderNotation} from '../web/music.js';
import {fixture} from './frontend-fixtures.js';

// Original isolated geometry fixtures. No imported score, melody or source data.
const rational = (numerator, denominator = 1) => ({numerator, denominator});
const value = (element, name) => Number(element.getAttribute(name));
const render = (score, options) => parseHTML(renderNotation(score, 'staff', options)).document.querySelector('svg');
function originalScore(notes, {startBeat = 0, spanBeats = 4} = {}) {
  const score = structuredClone(fixture), seed = score.parts[0].notes[0];
  score.id = 'original-staff-edge';
  score.title = 'Original isolated staff edge exercise';
  score.composer = '';
  score.provenance.attribution = 'WorldMusicHub original staff geometry regression fixture';
  score.parts[0].notes = notes.map((note, index) => ({...structuredClone(seed),
    id: `edge-${index}`, at: rational(startBeat), duration: rational(1, 64), ...note}));
  score.measures = Array.from({length: Math.ceil(spanBeats / 4)}, (_, index) => ({
    number: index + 1, at: rational(startBeat + index * 4), length: rational(4),
  }));
  return score;
}

// Independently bound the emitted SVG primitives, including rotated ellipses,
// quadratic-curve extrema and strokes. Text uses conservative font allowances;
// actual font boxes and ancestor clipping require separate hosted-browser QA.
function extent(element) {
  if (element.localName === 'ellipse') {
    const angle = -18 * Math.PI / 180, rx = value(element, 'rx'), ry = value(element, 'ry');
    const dx = Math.hypot(rx * Math.cos(angle), ry * Math.sin(angle)) + 0.75;
    const dy = Math.hypot(rx * Math.sin(angle), ry * Math.cos(angle)) + 0.75;
    return [value(element, 'cx') - dx, value(element, 'cy') - dy, value(element, 'cx') + dx, value(element, 'cy') + dy];
  }
  if (element.localName === 'line') return [Math.min(value(element, 'x1'), value(element, 'x2')) - 0.75,
    Math.min(value(element, 'y1'), value(element, 'y2')) - 0.75,
    Math.max(value(element, 'x1'), value(element, 'x2')) + 0.75, Math.max(value(element, 'y1'), value(element, 'y2')) + 0.75];
  if (element.localName === 'path') {
    const match = element.getAttribute('d').match(/^M([\d.e+-]+) ([\d.e+-]+)q([\d.e+-]+) ([\d.e+-]+) ([\d.e+-]+) ([\d.e+-]+)$/);
    assert.ok(match, 'Every flag must have a measured quadratic envelope');
    const [x, y, cx, cy, ex, ey] = match.slice(1).map(Number);
    const axisBounds = (control, end) => {
      const values = [0, end], t = control / (2 * control - end);
      if (t > 0 && t < 1) values.push(2 * (1 - t) * t * control + t * t * end);
      return [Math.min(...values), Math.max(...values)];
    };
    const [left, right] = axisBounds(cx, ex), [top, bottom] = axisBounds(cy, ey);
    return [x + left - 1.5, y + top - 1.5, x + right + 1.5, y + bottom + 1.5];
  }
  assert.equal(element.localName, 'text');
  const x = value(element, 'x'), y = value(element, 'y');
  return element.classList.contains('rest') ? [x - 2, y - 28, x + 30, y + 7]
    : [x - 2, y - 21, x + [...element.textContent].length * 20 + 2, y + 6];
}
function assertContained(svg) {
  const width = value(svg, 'width'), height = value(svg, 'height');
  assert.deepEqual(svg.getAttribute('viewBox').split(' ').map(Number), [0, 0, width, height]);
  for (const note of svg.querySelectorAll('.score-note')) for (const glyph of note.children) {
    const [left, top, right, bottom] = extent(glyph);
    assert.ok(left >= 0 && right <= width && top >= 32 && bottom < height - 8,
      `${note.dataset.noteId} ${glyph.localName}: ${[left, top, right, bottom]} within ${width} × ${height}`);
  }
}

for (const width of [240, 288, 539, 540, 600, 959, 960, 1050]) {
  test(`staff edge glyphs fit at width ${width}, including a sixty-fourth-quarter onset before page end`, () => {
    const {spanBeats} = notationLayout(width);
    for (const startBeat of [0, 12]) for (const octave of [1, 4, 8]) {
      for (const duration of [rational(4), rational(2), rational(1), rational(1, 64)]) {
        const notes = [{at: rational((startBeat + spanBeats) * 64 - 1, 64), duration,
          pitch: {step: 'C', alter: 0, octave}}];
        const score = originalScore(notes, {startBeat, spanBeats}), before = structuredClone(score);
        const svg = render(score, {width, spanBeats, startBeat});
        assertContained(svg);
        assert.equal(svg.querySelector('.score-note').dataset.noteId, 'edge-0');
        assert.equal(svg.querySelectorAll('.note-flag').length, duration.denominator === 64 ? 1 : 0);
        assert.deepEqual(score, before, 'Notes, IDs and exact source timing are unchanged');
      }
    }
  });
}

test('both edges retain extreme registers, double accidentals and rests for short and long pages', () => {
  for (const width of [240, 600, 1050]) for (const spanBeats of [4, 8, 16, 32]) {
    const notes = [];
    for (const at of [rational(0), rational(spanBeats * 64 - 1, 64)]) {
      for (const pitch of [{step: 'C', alter: 0, octave: -1}, {step: 'G', alter: 0, octave: 9},
        ...[-2, -1, 0, 1, 2].map(alter => ({step: 'C', alter, octave: 1}))]) notes.push({at, pitch});
      notes.push({at, pitch: null, velocity: 0});
    }
    const score = originalScore(notes, {spanBeats}), before = structuredClone(score);
    const svg = render(score, {width, spanBeats});
    assertContained(svg);
    assert.deepEqual([...svg.querySelectorAll('.score-note')].map(note => note.dataset.noteId), score.parts[0].notes.map(note => note.id));
    assert.deepEqual(score, before);
  }
});

test('page boundaries stay half-open and hidden events cannot change current-page geometry', () => {
  const startBeat = 8, spanBeats = 4, width = 240;
  const score = originalScore([
    {id: 'at-start', at: rational(startBeat)},
    {id: 'before-end', at: rational((startBeat + spanBeats) * 64 - 1, 64)},
  ], {startBeat, spanBeats});
  const options = {width, spanBeats, startBeat}, original = render(score, options).outerHTML;
  for (const [id, at] of [['before-start', rational(startBeat * 64 - 1, 64)], ['at-end', rational(startBeat + spanBeats)],
    ['after-end', rational((startBeat + spanBeats) * 64 + 1, 64)]]) score.parts[0].notes.push({
    ...structuredClone(score.parts[0].notes[0]), id, at, pitch: {step: 'G', alter: 0, octave: 9},
  });
  const before = structuredClone(score), svg = render(score, options);
  assert.equal(svg.outerHTML, original);
  assert.deepEqual([...svg.querySelectorAll('.score-note')].map(note => note.dataset.noteId), ['at-start', 'before-end']);
  assertContained(svg);
  assert.deepEqual(score, before);
});

test('shared spacing preserves distinct close onsets, chords, part alignment and bar positions', () => {
  const startBeat = 12, spanBeats = 8, width = 600;
  const onsets = [rational(startBeat), rational(startBeat + 4), rational((startBeat + spanBeats) * 64 - 2, 64), rational((startBeat + spanBeats) * 64 - 1, 64)];
  const score = originalScore(onsets.map(at => ({at})), {startBeat, spanBeats});
  const lower = structuredClone(score.parts[0]);
  lower.id = 'lower';
  lower.notes = lower.notes.map(note => ({...note, id: `lower-${note.id}`, pitch: {step: 'C', alter: 0, octave: 1}}));
  score.parts.push(lower);
  score.parts[0].notes.push({...structuredClone(score.parts[0].notes.at(-1)), id: 'chord-tone', pitch: {step: 'G', alter: 0, octave: 5}});
  const before = structuredClone(score), svg = render(score, {width, spanBeats, startBeat, allParts: true});
  const heads = [...svg.querySelectorAll('.note-head')].map(head => value(head, 'cx'));
  assert.equal(heads[0], 90);
  for (let index = 1; index < 4; index++) assert.ok(heads[index] > heads[index - 1], 'Distinct onsets must not collapse to an edge clamp');
  assert.equal(heads[3], heads[4], 'Chord members share their onset column');
  assert.deepEqual(heads.slice(0, 4), heads.slice(5), 'Every part uses the same columns');
  const scale = (heads[1] - heads[0]) / 4;
  assert.ok(Math.abs((heads[3] - heads[2]) * 64 - scale) < 1e-9, 'The page retains one linear time scale');
  const bars = [...svg.querySelectorAll('.bar-line')].map(line => value(line, 'x1'));
  assert.deepEqual(bars, [heads[0] - 18, heads[1] - 18, heads[0] - 18, heads[1] - 18]);
  assertContained(svg);
  assert.deepEqual(score, before);
});

test('ordinary charts, empty pages and unrelated parts retain their existing coordinates', () => {
  const options = {width: 720, spanBeats: 4};
  const svg = render(fixture, options);
  assert.equal(value(svg, 'height'), 170);
  assert.deepEqual([...svg.querySelectorAll('.staff-line')].map(line => value(line, 'y1')), [38, 50, 62, 74, 86]);
  assert.deepEqual([...svg.querySelectorAll('.note-head')].map(head => [value(head, 'cx'), value(head, 'cy')]), [[90, 98], [246, 86]]);
  assertContained(svg);
  const score = structuredClone(fixture);
  score.parts.push({...originalScore([{at: rational(255, 64), pitch: {step: 'G', alter: 0, octave: 9}}]).parts[0], id: 'other'});
  assert.equal(render(score, options).outerHTML, svg.outerHTML);
  const empty = render(score, {...options, startBeat: 4});
  assert.equal(value(empty, 'height'), 170);
  assert.equal(empty.querySelectorAll('.score-note').length, 0);
});

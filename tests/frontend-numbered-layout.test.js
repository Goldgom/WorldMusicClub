import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {parseHTML} from 'linkedom';
import {numberedNotationLayout, renderNotation, notationPageCount} from '../web/music.js';
import {fixture} from './frontend-fixtures.js';
import {densePianoforte} from './numbered-layout-fixtures.js';
import {createI18n} from '../web/i18n.js';

const rational = (numerator, denominator = 1) => ({numerator, denominator});
const event = (id, at = rational(0), pitch = {step: 'C', alter: 0, octave: 4}, extra = {}) => ({
  ...structuredClone(fixture.parts[0].notes[0]), id, at, pitch, ...extra,
});
function scoreWith(notes) {
  const score = structuredClone(fixture);
  score.parts[0].notes = notes;
  return score;
}
function svgFor(score, options = {}) {
  return parseHTML(renderNotation(score, 'jianpu', options)).document.querySelector('svg');
}
const noteGroups = svg => [...svg.querySelectorAll('.score-note')];
const allEntries = layout => layout.parts.flatMap(part => part.entries);
function assertNoCollisions(layout) {
  const entries = allEntries(layout);
  for (const entry of entries) {
    const {box} = entry;
    assert.ok(box.left >= 0 && box.top >= 0 && box.right <= layout.width && box.bottom <= layout.height, `${entry.note.id} stays in the viewBox`);
  }
  for (let i = 0; i < entries.length; i++) for (let j = i + 1; j < entries.length; j++) {
    const a = entries[i].box, b = entries[j].box;
    assert.ok(a.right < b.left || b.right < a.left || a.bottom < b.top || b.bottom < a.top,
      `${entries[i].note.id} and ${entries[j].note.id} have disjoint glyph budgets`);
  }
}

test('dense chords and voices have disjoint glyph budgets at mobile, tablet and desktop widths', () => {
  const score = densePianoforte(), before = structuredClone(score);
  for (const width of [240, 354, 600, 1050]) {
    const options = {width, startBeat: 32, spanBeats: 8}, layout = numberedNotationLayout(score, options);
    assert.equal(allEntries(layout).length, 193);
    assert.equal(layout.parts[0].lanes.length, 3);
    assert.ok(layout.width > width, 'dense pages grow instead of shrinking the digits');
    assertNoCollisions(layout);
    const svg = svgFor(score, options);
    assert.equal(svg.style.maxWidth, 'none');
    assert.equal(svg.getAttribute('width'), String(layout.width));
    assert.equal(noteGroups(svg).length, score.parts[0].notes.length);
    assert.deepEqual(noteGroups(svg).map(group => group.dataset.noteId), score.parts[0].notes.map(note => note.id));
    assert.ok([...svg.querySelectorAll('.jianpu-note')].every(note => note.style.fontSize === '25px'));
  }
  assert.deepEqual(score, before, 'layout and rendering do not rewrite source timing, IDs, pitches or voices');
});

test('same-onset chords stack by pitch while equal-pitch source events remain distinct', () => {
  const notes = [event('low', rational(0), {step: 'C', alter: 0, octave: 3}),
    event('high', rational(0), {step: 'G', alter: 0, octave: 5}), event('unison-a'), event('unison-b'), event('rest', rational(0), null)];
  const layout = numberedNotationLayout(scoreWith(notes)), entries = allEntries(layout);
  const byId = Object.fromEntries(entries.map(entry => [entry.note.id, entry]));
  assert.equal(new Set(entries.map(entry => entry.x)).size, 1);
  assert.equal(new Set(entries.map(entry => entry.y)).size, 5);
  assert.ok(byId.high.y < byId['unison-a'].y && byId['unison-b'].y < byId.low.y && byId.low.y < byId.rest.y);
  assertNoCollisions(layout);
});

test('canonical staff and voice pairs own separate labeled lanes without merging numeric-looking IDs', () => {
  const notes = [event('one', rational(0), null, {voice: '1', staff: 1}), event('zero-one', rational(0), null, {voice: '01', staff: 1}),
    event('staff-two', rational(0), null, {voice: '1', staff: 2}), event('string-delimiter', rational(0), null, {voice: '1:2', staff: 1})];
  const score = scoreWith(notes), layout = numberedNotationLayout(score);
  assert.equal(layout.parts[0].lanes.length, 4);
  assert.equal(new Set(allEntries(layout).map(entry => entry.y)).size, 4);
  assert.equal(new Set(allEntries(layout).map(entry => entry.x)).size, 1);
  const svg = svgFor(score);
  assert.equal(svg.querySelectorAll('.numbered-lane-label').length, 4);
  assert.deepEqual(noteGroups(svg).map(group => [group.dataset.staff, group.dataset.voice]), notes.map(note => [String(note.staff), note.voice]));
  assertNoCollisions(layout);
});

test('a voice keeps a common digit baseline across octave, accidental and rhythm changes', () => {
  const notes = [event('middle', rational(0)), event('above', rational(1), {step: 'F', alter: 2, octave: 7}),
    event('below', rational(2), {step: 'B', alter: -2, octave: 1}, {duration: rational(1, 64)})];
  const layout = numberedNotationLayout(scoreWith(notes));
  assert.equal(new Set(allEntries(layout).map(entry => entry.y)).size, 1);
  assertNoCollisions(layout);
});

test('equivalent rational onsets share a column but nearby distinct fractions never collapse', () => {
  const notes = [event('third', rational(1, 3)), event('two-sixths', rational(2, 6)),
    event('almost-a', rational(999998, 999999)), event('almost-b', rational(999999, 1000000))];
  const score = scoreWith(notes), layout = numberedNotationLayout(score, {width: 240, spanBeats: 4}), entries = allEntries(layout);
  assert.equal(entries[0].x, entries[1].x);
  assert.ok(entries[2].x + entries[2].glyph.right < entries[3].x - entries[3].glyph.left);
  assert.equal(entries[0].column.key, '1/3');
  assert.deepEqual(noteGroups(svgFor(score)).map(group => group.dataset.at), ['1/3', '2/6', '999998/999999', '999999/1000000']);
  assertNoCollisions(layout);
});

test('short subdivisions, dotted notes, rests and nonbinary durations remain explicit', () => {
  const durations = [[1, 8], [1, 16], [1, 32], [1, 64], [3, 4], [7, 8], [15, 16], [3, 2], [1, 3], [9, 1], [21, 5]];
  const notes = durations.map(([n, d], index) => event(`rhythm-${index}`, rational(index, 16), index % 2 ? null : undefined, {duration: rational(n, d)}));
  const score = scoreWith(notes), layout = numberedNotationLayout(score, {width: 288});
  assert.deepEqual(allEntries(layout).map(entry => entry.glyph.rhythm.beams), [3, 4, 5, 6, 1, 1, 1, 0, 0, 0, 0]);
  assert.deepEqual(allEntries(layout).slice(4, 8).map(entry => entry.glyph.rhythm.dots), [1, 2, 3, 1]);
  const groups = noteGroups(svgFor(score));
  assert.equal(groups[8].querySelector('.duration-dash').textContent, '[1/3 q]');
  assert.equal(groups[9].querySelector('.duration-dash').textContent, '[9/1 q]');
  assert.equal(groups[10].querySelector('.duration-dash').textContent, '[21/5 q]');
  assert.ok(groups.filter((_, index) => index % 2).every(group => group.querySelector('.jianpu-note').textContent === '0'));
  assert.deepEqual(groups.map(group => group.dataset.duration), durations.map(([n, d]) => `${n}/${d}`));
  assertNoCollisions(layout);
});

test('accidentals sit beside digits and octave dots sit beyond the rhythm underlines without a four-dot cap', () => {
  const score = scoreWith([event('double-sharp-high', rational(0), {step: 'C', alter: 2, octave: 9}),
    event('double-flat-low', rational(0), {step: 'D', alter: -2, octave: -1}, {duration: rational(1, 64)})]);
  const groups = noteGroups(svgFor(score));
  for (const group of groups) {
    const accidental = group.querySelector('.accidental'), digit = group.querySelector('.jianpu-note');
    assert.equal(Number(accidental.getAttribute('x')), Number(digit.getAttribute('x')) - 13);
    assert.equal(accidental.getAttribute('textLength'), '32');
    assert.equal(group.querySelectorAll('.octave-dots').length, 5);
  }
  const low = groups[1], bottomBeam = Math.max(...[...low.querySelectorAll('.note-line')].map(line => Number(line.getAttribute('y1'))));
  assert.ok([...low.querySelectorAll('.octave-dots')].every(dot => Number(dot.getAttribute('y')) - 8 >= bottomBeam + 4));
  assertNoCollisions(numberedNotationLayout(score));
});

test('long duration marks reserve horizontal width even when a later onset overlaps the sustain', () => {
  const score = scoreWith([event('held', rational(0), undefined, {duration: rational(7)}), event('reattack', rational(1, 64))]);
  const layout = numberedNotationLayout(score, {width: 240, spanBeats: 4}), [held, next] = allEntries(layout);
  assert.equal(held.glyph.rhythm.text, '––––––');
  assert.ok(next.box.left > held.box.right);
  assert.deepEqual(held.note.duration, rational(7));
  assert.deepEqual(next.note.at, rational(1, 64));
  assertNoCollisions(layout);
});

test('page boundaries keep each source onset exactly once and preserve existing page count semantics', () => {
  const score = scoreWith([event('previous-held', rational(31), undefined, {duration: rational(4)}), event('start', rational(32)),
    event('last', rational(639, 16)), event('next', rational(40))]);
  const count = notationPageCount(score, 8);
  assert.equal(count, 6);
  assert.deepEqual(noteGroups(svgFor(score, {startBeat: 32, spanBeats: 8})).map(group => group.dataset.noteId), ['start', 'last']);
  assert.deepEqual(noteGroups(svgFor(score, {startBeat: 40, spanBeats: 8})).map(group => group.dataset.noteId), ['next']);
  assert.equal(noteGroups(svgFor(score, {startBeat: 48, spanBeats: 8})).length, 0);
  assert.match(svgFor(score, {startBeat: 48, spanBeats: 8}).textContent, /No note onsets/);
});

test('declared trailing empty measures remain reachable by page navigation and following', () => {
  const score = scoreWith([event('first')]);
  score.measures = Array.from({length: 10}, (_, index) => ({number: index + 1, at: rational(index * 4), length: rational(4)}));
  const before = structuredClone(score);
  assert.equal(notationPageCount(score, 8), 5);
  assert.equal(notationPageCount(score, 4), 10);
  const svg = svgFor(score, {startBeat: 32, spanBeats: 8});
  assert.equal(noteGroups(svg).length, 0);
  assert.match(svg.textContent, /No note onsets/);
  assert.deepEqual([...svg.querySelectorAll('.measure-number')].map(label => label.textContent), ['9', '10']);
  score.parts[0].notes = [];
  assert.equal(notationPageCount(score, 8), 5, 'entirely silent declared score still has every page');
  assert.deepEqual(score.measures, before.measures);
});

test('part selection works for multipart scores, including a literal all ID, without altering the other parts', () => {
  const score = scoreWith([event('first')]);
  score.parts.push({id: 'all', name: 'Second part', instrument: 'piano', notes: [event('second-a'), event('second-b', rational(0), undefined, {voice: '2'})]});
  const before = structuredClone(score);
  assert.deepEqual(noteGroups(svgFor(score)).map(group => group.dataset.noteId), ['first']);
  assert.deepEqual(noteGroups(svgFor(score, {partId: 'all'})).map(group => group.dataset.noteId), ['second-a', 'second-b']);
  assert.deepEqual(noteGroups(svgFor(score, {allParts: true})).map(group => group.dataset.noteId), ['first', 'second-a', 'second-b']);
  const allParts = numberedNotationLayout(score, {allParts: true});
  assert.equal(allParts.parts.length, 2);
  assert.equal(new Set(allEntries(allParts).map(entry => entry.x)).size, 1, 'parts share the exact-onset column');
  assertNoCollisions(allParts);
  const staff = parseHTML(renderNotation(score, 'staff', {allParts: true})).document;
  assert.deepEqual([...staff.querySelectorAll('.score-note')].map(group => group.dataset.noteId), ['first', 'second-a', 'second-b']);
  assert.equal(noteGroups(svgFor(score, {partId: 'missing'})).length, 0);
  assert.deepEqual(score, before);
});

test('current-note classes can independently highlight same-time unisons and exact Unicode source IDs', () => {
  const ids = ['é', 'e\u0301', 'rest', 'other-voice'];
  const score = scoreWith(ids.map((id, index) => event(id, rational(0), index === 2 ? null : undefined, {voice: index === 3 ? '2' : '1'})));
  const svg = svgFor(score), groups = noteGroups(svg);
  for (const active of [['é'], ['e\u0301', 'rest'], ['other-voice'], []]) {
    const wanted = new Set(active);
    groups.forEach(group => group.classList.toggle('active', wanted.has(group.dataset.noteId)));
    assert.deepEqual([...svg.querySelectorAll('.score-note.active')].map(group => group.dataset.noteId), active);
  }
  assert.equal(groups.length, 4);
  assertNoCollisions(numberedNotationLayout(score));
});

test('movable references and exact onsets retain key changes without colliding with notes', () => {
  const score = scoreWith([event('initial', rational(0), {step: 'G', alter: 0, octave: 4}), event('new-key', rational(1, 64), {step: 'G', alter: 0, octave: 4})]);
  score.keys.push({at: rational(1, 64), fifths: 1, mode: 'major'});
  const options = {numberedMode: 'movable', width: 240}, layout = numberedNotationLayout(score, options), svg = svgFor(score, options);
  assert.deepEqual(noteGroups(svg).map(group => group.querySelector('.jianpu-note').textContent), ['5', '1']);
  assert.deepEqual([...svg.querySelectorAll('.tonic-reference')].map(text => text.textContent), ['1 = C4 (major)', '1 = G4 (major)']);
  assert.ok(Number(svg.querySelector('.tonic-reference').getAttribute('y')) > Math.max(...allEntries(layout).map(entry => entry.box.bottom)));
  assertNoCollisions(layout);
  assert.doesNotThrow(() => svgFor(score, {...options, startBeat: 0.5}));
});

test('untrusted names, voices, IDs and key modes cannot create SVG markup or handlers', () => {
  const id = '\" onload=\"alert(1)<&\'', voice = '<script>bad()</script> & \"';
  const score = scoreWith([event(id, rational(0), undefined, {voice})]);
  score.parts[0].name = '<script>part()</script>';
  score.keys[0].mode = '<script>key()</script>';
  const svg = svgFor(score, {numberedMode: 'movable'}), [group] = noteGroups(svg);
  assert.equal(group.dataset.noteId, id); assert.equal(group.dataset.voice, voice);
  assert.equal(svg.querySelector('script, [onload], [onclick]'), null);
  assert.match(svg.textContent, /Unknown mode: fixed C reference/);
  assert.ok(svg.textContent.includes('<script>part()</script>'));
});

test('explicit renderer locale changes interface text once while exact source text and event identities stay intact', () => {
  const sourceId = '<源音符>&\"', sourceVoice = '<旋律>&\"';
  const score = scoreWith([event(sourceId, rational(0), undefined, {voice: sourceVoice})]);
  score.parts[0].name = 'Authored source title 原文';
  const before = structuredClone(score), reports = [];
  const zh = createI18n({locale: 'zh-CN', onReport: issue => reports.push(issue)}), en = createI18n({locale: 'en', onReport: issue => reports.push(issue)});
  for (const i18n of [zh, en]) {
    const svg = svgFor(score, {numberedMode: 'movable', i18n}), [group] = noteGroups(svg);
    assert.equal(group.dataset.noteId, sourceId); assert.equal(group.dataset.voice, sourceVoice);
    assert.equal(svg.querySelector('源音符, 旋律, [onload]'), null);
    assert.equal(svg.getAttribute('aria-label'), i18n.t('notation.ariaMovable'));
    assert.equal(svg.querySelector('desc').textContent, i18n.t('notation.description'));
    assert.equal(svg.querySelector('.numbered-lane-label').textContent, i18n.t('notation.staffVoice', {staff: 1, voice: sourceVoice}));
    assert.equal(svg.querySelector('.tonic-reference').textContent, i18n.t('notation.tonicMajor', {tonic: 'C4'}));
    assert.equal(group.querySelector('title').textContent, i18n.t('notation.noteDetail', {id: sourceId, staff: 1, voice: sourceVoice, onset: '0/1', duration: '1/1'}));
    assert.ok(svg.textContent.includes('Authored source title 原文'));
    assert.match(svgFor(score, {i18n, startBeat: 4}).textContent, new RegExp(i18n.t('notation.empty')));
  }
  assert.deepEqual(reports, []);
  assert.deepEqual(score, before);
});

test('the 1,000-event cap is explicit on narrow pages and never changes the complete source', () => {
  const score = scoreWith(Array.from({length: 1001}, (_, index) => event(`cap-${index}`))), before = structuredClone(score);
  const options = {width: 240}, layout = numberedNotationLayout(score, options), svg = svgFor(score, options);
  assert.equal(allEntries(layout).length, 1000); assert.equal(noteGroups(svg).length, 1000);
  assert.equal(layout.parts[0].truncated, true);
  assert.match(svg.querySelector('.numbered-limit').getAttribute('aria-label'), /first 1,000 notation events shown; complete score retained/);
  assert.ok(svg.querySelectorAll('.numbered-limit text').length > 1, 'warning wraps instead of clipping');
  assert.deepEqual(score, before);
});

test('long part and voice labels wrap above the lane and cannot consume note coordinates', () => {
  const score = scoreWith([event('label', rational(0), undefined, {voice: 'Long voice '.repeat(5)})]);
  score.parts[0].name = 'Pianoforte part '.repeat(12);
  const layout = numberedNotationLayout(score, {width: 240}), part = layout.parts[0], lane = part.lanes[0];
  assert.ok(part.nameLines.length > 1 && lane.labelLines.length > 1);
  assert.ok(part.nameY + (part.nameLines.length - 1) * 18 < lane.labelY);
  assert.ok(lane.labelY + (lane.labelLines.length - 1) * 18 < lane.top);
  assertNoCollisions(layout);
});

test('English staff SVG remains byte-for-byte unchanged for existing simple and responsive fixtures', () => {
  // Baselines recorded before locale integration; explicit English retains the original bytes.
  const i18n = createI18n({locale:'en',onReport:report=>assert.fail(JSON.stringify(report))});
  for (const [options, expected] of [
    [{}, '91d168fe82c47eb819aaf50fa1b84bbbc13681f68d9be4b47bad5084c6544f35'],
    [{width: 288, spanBeats: 4}, 'f54a01031d54b9c51e9294bac722e67aa029e6c8d0f684e773931d78d8758f70'],
    [{width: 600, startBeat: 1, spanBeats: 8}, 'd4d68ec2535b04e86c1ceee5ec343d361d9592c5aca346e2d55d0b671c6024ff'],
  ]) assert.equal(createHash('sha256').update(renderNotation(fixture, 'staff', {...options,i18n})).digest('hex'), expected);
});

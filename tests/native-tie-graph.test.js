import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {DOMParser} from 'linkedom';
import {prepareCleanSong} from '../web/clean-song-package.js';
import {basicKeyNotationPage, basicKeyEngravingIdentity} from '../web/basic-key-notation.js';
import {validateEngravingInput, ENGRAVING_LIMITS} from '../web/engraving.js';
import {createEngravingProjection, restoreSourceBoundProjectionFractions, validateEngravingProjectionModel} from '../web/engraving-projection.js';
import {matchEngravingModel, restoreSourceBoundPageTies, validateEngravingModelTies} from '../web/engraving-note-map.js';

// These are original authored fixtures. The tests exercise the pinned model
// reader only; model correctness does not establish SVG rendering acceptance.
class XmlParser extends DOMParser {
  parseFromString(source, type) {
    const document = super.parseFromString(source, type), find = document.getElementsByTagName.bind(document);
    document.getElementsByTagName = name => name === '*' ? document.querySelectorAll('*') : find(name);
    for (const element of document.querySelectorAll('*')) Object.defineProperty(element, 'namespaceURI', {value: null});
    return document;
  }
}
const fixture = name => JSON.parse(readFileSync(new URL(`./fixtures/${name.endsWith('.json') ? name : `basic-key-${name}-page.json`}`, import.meta.url), 'utf8'));
const withOsmd = callback => {
  const previous = globalThis.self;
  try { globalThis.self = globalThis; return callback(createRequire(import.meta.url)('opensheetmusicdisplay')); }
  finally { if (previous === undefined) delete globalThis.self; else globalThis.self = previous; }
};
const inventory = sheet => {
  const rows = [];
  for (const measure of sheet.SourceMeasures) for (const container of measure.VerticalSourceStaffEntryContainers)
    for (const entry of container.StaffEntries) for (const voice of entry?.VoiceEntries || [])
      for (const note of voice.Notes) rows.push({measure, container, entry, voice, note});
  return rows;
};
function prepare(name = 'accidental-tie', {mutateFixture, identityKind = 'native', variant = 'melodic'} = {}) {
  const data = fixture(name), item = variant === 'legacy' ? {response: data.legacy, request: structuredClone(data.melodic.request)} : data[variant] || data;
  if (variant === 'legacy') delete item.request.settings.rendition_policy_id;
  mutateFixture?.(data, item);
  const song = prepareCleanSong(`native:song-${data.open.clean_package.content_sha256}`, data.open.clean_package, null);
  const page = basicKeyNotationPage(item.response, item.request, song);
  let identity = basicKeyEngravingIdentity(song, page);
  if (identityKind === 'copied') identity = structuredClone(identity);
  const checked = validateEngravingInput(page.musicxml.xml, {identity, fromMeasure: 1, toMeasure: page.measure_count}, XmlParser);
  assert.equal(checked.ok, true, checked.message);
  assert.equal(checked.identity.ok, true, JSON.stringify(checked.identity.diagnostics));
  const projection = createEngravingProjection(checked.document, checked.identity, checked.options, ENGRAVING_LIMITS);
  assert.equal(projection.ok, true, JSON.stringify(projection));
  const sheet = withOsmd(osmd => {
    const previous = globalThis.Node;
    try {
      globalThis.Node = projection.document.defaultView.Node;
      return new osmd.MusicSheetReader([], new osmd.EngravingRules()).createMusicSheet(new osmd.IXmlElement(projection.document.documentElement), 'original-native-tie-partition');
    } finally { if (previous === undefined) delete globalThis.Node; else globalThis.Node = previous; }
  });
  assert.deepEqual(restoreSourceBoundProjectionFractions(sheet, projection, page.score, ENGRAVING_LIMITS), {ok: true});
  const renderer = {Sheet: sheet}, validated = {...checked.identity, projection};
  const matched = matchEngravingModel(renderer, validated, {includeContext: true});
  assert.equal(matched.ok, true);
  assert.deepEqual(matched.diagnostics, []);
  assert.ok(matched.matches.every(match => match.note));
  const byId = new Map(matched.matches.map(match => [match.segment.xml_note_id, match.note]));
  // Expected groups come from canonical sources and exact source ordering,
  // independently of the reader's ties and projection.tieChains.
  const groups = page.score.parts.flatMap(part => part.notes.map(source => ({source,
    notes: page.musicxml.note_id_map.segments.filter(segment => segment.source_note_id === source.id)
      .sort((a, b) => Number(BigInt(a.at.numerator) * BigInt(b.at.denominator) - BigInt(b.at.numerator) * BigInt(a.at.denominator)))
      .map(segment => byId.get(segment.xml_note_id)),
  })));
  const rows = inventory(sheet), notes = rows.map(row => row.note);
  assert.equal(new Set(notes).size, notes.length);
  assert.equal(notes.length, projection.noteCount);
  const canonical = new Set(groups.flatMap(group => group.notes));
  const padding = notes.filter(note => !canonical.has(note));
  assert.ok(padding.every(note => note.isRest() && note.PrintObject === false));
  return {data, item, song, page, checked, projection, renderer, validated, groups, rows, notes, padding};
}
const restore = (context, Tie, types) => withOsmd(osmd => restoreSourceBoundPageTies(context.renderer, context.validated, Tie || osmd.Tie, types || osmd.TieTypes, ENGRAVING_LIMITS));
const clearTies = context => { for (const note of context.notes) note.NoteTie = undefined; };
const connect = (notes, Type) => withOsmd(osmd => {
  const tie = new (Type || osmd.Tie)(notes[0], osmd.TieTypes.SIMPLE);
  for (const note of notes.slice(1)) tie.AddNote(note);
  return tie;
});
function snapshot(context, extra = []) {
  const notes = [...new Set([...context.notes, ...inventory(context.renderer.Sheet).map(row => row.note), ...extra])];
  const pointers = notes.map(note => [note, note.NoteTie]);
  const ties = [...new Set(pointers.map(([, tie]) => tie).filter(Boolean))].map(tie => [tie, tie.Notes, Array.isArray(tie.Notes) ? [...tie.Notes] : tie.Notes]);
  return () => {
    for (const [note, tie] of pointers) assert.equal(note.NoteTie, tie, 'Every pre-transaction NoteTie pointer is retained');
    for (const [tie, array, members] of ties) {
      assert.equal(tie.Notes, array, 'Existing Tie.Notes array identity is retained');
      assert.deepEqual(tie.Notes, members, 'Existing tie membership is retained');
    }
  };
}
function assertPartition(context) {
  const ties = new Set();
  for (const {source, notes} of context.groups) {
    if (source.pitch && notes.length > 1) {
      const tie = notes[0].NoteTie;
      assert.ok(tie, `A multi-segment source has one tie: ${source.id}`);
      withOsmd(osmd => assert.ok(tie instanceof osmd.Tie, 'A reconstructed relation is an official pinned Tie'));
      assert.equal(tie.Type, '');
      assert.ok(!ties.has(tie), 'Different canonical sources never share a tie');
      ties.add(tie);
      assert.deepEqual(tie.Notes, notes, 'Tie members follow the full exact source order');
      for (const note of notes) assert.equal(note.NoteTie, tie);
    } else for (const note of notes) assert.ok(!note.NoteTie, 'A canonical singleton or rest has no tie');
  }
  for (const note of context.padding) assert.ok(!note.NoteTie, 'Generated padding has no tie');
  assert.deepEqual(validateEngravingModelTies(context.renderer, context.validated), {ok: true}, 'The original strict model tie check still passes');
  assert.deepEqual(validateEngravingProjectionModel(context.renderer.Sheet, context.projection, context.page.score, ENGRAVING_LIMITS), {ok: true});
  assert.deepEqual(matchEngravingModel(context.renderer, context.validated).diagnostics, []);
}
const rejectedWithoutWrites = (context, extra = []) => {
  const unchanged = snapshot(context, extra);
  assert.deepEqual(restore(context), {ok: false, key: 'tieContext'});
  unchanged();
};

test('native v2 reconstructs the complete source partition from missing, singleton and partial ties', async t => {
  for (const scenario of ['all missing', 'reader accidental collision', 'singleton', 'partial', 'reversed', 'duplicate member', 'nonreciprocal', 'mixed sources']) {
    await t.test(scenario, () => {
      const context = prepare(), [first, second] = context.groups.map(group => group.notes), sourceBefore = JSON.stringify(context.page);
      if (scenario !== 'reader accidental collision') clearTies(context);
      if (scenario === 'singleton') for (const note of context.notes) connect([note]);
      if (scenario === 'partial') { connect(first.slice(0, 2)); connect([second[0]]); }
      if (scenario === 'reversed') { connect([...first].reverse()); connect([...second].reverse()); }
      if (scenario === 'duplicate member') { const tie = connect(first); tie.Notes.push(first[1]); connect(second); }
      if (scenario === 'nonreciprocal') { connect(first); const tie = connect(second); first[1].NoteTie = tie; }
      if (scenario === 'mixed sources') connect([first[0], second[0], ...first.slice(1), ...second.slice(1)]);
      assert.equal(restore(context).ok, true);
      assertPartition(context);
      const unchanged = snapshot(context);
      assert.deepEqual(restore(context), {ok: true, restored: 0}, 'A second invocation is a pointer-preserving no-op');
      unchanged();
      assert.equal(JSON.stringify(context.page), sourceBefore, 'Canonical notes, exact timing, XML and boundary metadata are unchanged');
    });
  }
});

test('equal-pitch attacks in separate engraving voices remain distinct canonical sources', async t => {
  for (const scenario of ['missing', 'crossed', 'one mixed tie']) await t.test(scenario, () => {
    const context = prepare('unison-tie'), groups = context.groups.map(group => group.notes), [short, long] = groups;
    assert.equal(short.length, 2); assert.equal(long.length, 3);
    assert.notEqual(short[0].ParentVoiceEntry.ParentVoice.VoiceId, long[0].ParentVoiceEntry.ParentVoice.VoiceId);
    clearTies(context);
    if (scenario === 'crossed') { connect([short[0], ...long.slice(1)]); connect([long[0], short[1]]); }
    if (scenario === 'one mixed tie') connect([short[0], long[0], short[1], ...long.slice(1)]);
    const result = restore(context);
    assert.equal(result.ok, true); assert.equal(result.restored, 2);
    assertPartition(context);
  });
});

test('genuine one-segment native notes and all generated padding lose incorrect tie edges', async t => {
  for (const scenario of ['melodic source edges', 'singleton ties', 'mixed pitched and padding', 'padding-only tie']) await t.test(scenario, () => {
    const context = prepare('rendition-notation', {variant: scenario === 'melodic source edges' ? 'melodic' : 'third_part'});
    assert.ok(context.groups.every(group => group.notes.length === 1));
    if (scenario !== 'melodic source edges') assert.ok(context.padding.length > 0);
    clearTies(context);
    if (scenario === 'singleton ties') for (const note of context.notes) connect([note]);
    if (scenario === 'mixed pitched and padding' || scenario === 'melodic source edges') connect(context.notes);
    if (scenario === 'padding-only tie') connect(context.padding);
    assert.equal(restore(context).ok, true);
    assertPartition(context);
    assert.deepEqual(restore(context), {ok: true, restored: 0});
  });
});

test('incoming boundary reconstruction preserves complete continuation metadata', () => {
  const context = prepare('open-tie'), before = JSON.stringify(context.page.continuations);
  assert.equal(context.groups[0].notes.length, 2);
  assert.ok([...context.validated.boundaryTies.values()].some(flags => flags.incoming));
  connect([context.groups[0].notes[0]]);
  assert.equal(restore(context).ok, true);
  assertPartition(context);
  assert.equal(JSON.stringify(context.page.continuations), before);
});

test('a genuine incoming-and-outgoing boundary singleton retains metadata without an internal tie', () => {
  const context = prepare('basic-key-boundary-singleton.json'), before = JSON.stringify(context.page);
  assert.equal(context.page.view_version, 2);
  assert.equal(context.groups.length, 1);
  assert.equal(context.groups[0].notes.length, 1);
  assert.equal(context.notes.length, 1);
  assert.deepEqual(context.validated.boundaryTies.get(context.groups[0].source.id), {incoming: true, outgoing: true});
  const segment = context.page.musicxml.note_id_map.segments[0];
  assert.equal(segment.tie_start, true); assert.equal(segment.tie_stop, true);
  assert.deepEqual(restore(context), {ok: true, restored: 0});
  assertPartition(context);
  connect([context.notes[0]]);
  assert.deepEqual(restore(context), {ok: true, restored: 0}, 'Removing a stray singleton relation does not invent an internal chain');
  assertPartition(context);
  const unchanged = snapshot(context);
  assert.deepEqual(restore(context), {ok: true, restored: 0});
  unchanged();
  assert.equal(JSON.stringify(context.page), before, 'Both original outside-page continuations stay intact');
});

test('copied authored identities never receive the native reconstruction privilege', async t => {
  for (const scenario of ['missing ties', 'incorrect existing graph']) await t.test(scenario, () => {
    const context = prepare('accidental-tie', {identityKind: 'copied'});
    clearTies(context);
    if (scenario === 'incorrect existing graph') connect(context.notes);
    const unchanged = snapshot(context);
    assert.deepEqual(restore(context), {ok: true, restored: 0});
    unchanged();
    assert.deepEqual(validateEngravingModelTies(context.renderer, context.validated), {ok: false, key: 'tieContext'});
  });
});

test('genuine native v1 singleton behavior remains unchanged', () => {
  const context = prepare('rendition-notation', {variant: 'legacy'});
  assert.equal(context.page.view_version, 1);
  assert.ok(context.groups.every(group => group.notes.length === 1));
  for (const note of context.notes) connect([note]);
  const unchanged = snapshot(context);
  assert.deepEqual(restore(context), {ok: true, restored: 0});
  unchanged();
});

test('native source XML with authored tie styling cannot authorize reconstruction', async t => {
  for (const [name, xml] of [
    ['numbered sounding tie', value => value.replace('<tie type="start"', '<tie number="2" type="start"')],
    ['placed written tie', value => value.replace('<tied type="start"', '<tied placement="above" type="start"')],
    ['dashed written tie', value => value.replace('<tied type="start"', '<tied line-type="dashed" type="start"')],
  ]) await t.test(name, () => {
    const context = prepare('accidental-tie', {mutateFixture: (_data, item) => {
      const before = item.response.page.musicxml.xml;
      item.response.page.musicxml.xml = xml(before);
      assert.notEqual(item.response.page.musicxml.xml, before);
    }});
    clearTies(context);
    rejectedWithoutWrites(context);
  });
});

test('native rendition admission rejects noncanonical spelling, flags, voice and staff', async t => {
  const alterations = {
    'enharmonic C-sharp to D-flat': page => { page.score.parts[0].notes[1].pitch = {step: 'D', alter: -1, octave: 4}; },
    'authored tie start': page => { page.score.parts[0].notes[0].tie_start = true; },
    'authored tie stop': page => { page.score.parts[0].notes[0].tie_stop = true; },
    'missing false tie flag': page => { delete page.score.parts[0].notes[0].tie_stop; },
    'canonical voice': page => { page.score.parts[0].notes[0].voice = '2'; },
    'canonical staff': page => { page.score.parts[0].notes[0].staff = 2; },
  };
  for (const [name, mutate] of Object.entries(alterations)) await t.test(name, () => {
    const data = fixture('accidental-tie');
    const song = prepareCleanSong(`native:song-${data.open.clean_package.content_sha256}`, data.open.clean_package, null);
    mutate(data.response.page);
    assert.throws(() => basicKeyNotationPage(data.response, data.request, song), {code: 'basic_keys_notation_identity'});
  });
});

test('native reconstruction binds the original source, manifest, document and projection objects', async t => {
  const alterations = {
    'copied native proof key': c => { c.validated.boundaryTies = new Map(c.validated.boundaryTies); },
    'substituted canonical score': c => { c.validated.score = structuredClone(c.validated.score); },
    'substituted source lookup': c => { c.validated.sources = new Map(c.validated.sources); },
    'substituted source record': c => { const [id, source] = c.validated.sources.entries().next().value; c.validated.sources.set(id, {...source}); },
    'substituted source note': c => { const source = c.validated.sources.values().next().value; source.note = {...source.note}; },
    'substituted segment array': c => { c.validated.segments = [...c.validated.segments]; },
    'substituted segment object': c => { c.validated.segments[0] = {...c.validated.segments[0]}; },
    'substituted part map': c => { c.validated.partIdMap = {...c.validated.partIdMap}; },
    'changed original XML': c => { c.checked.document.documentElement.setAttribute('changed', 'yes'); },
    'copied projection': c => { c.validated.projection = {...c.projection}; },
    'substituted projection document': c => { c.projection.document = c.projection.document.cloneNode(true); },
    'changed projection XML': c => { c.projection.document.querySelector('note').setAttribute('changed', 'yes'); },
    'projection from a different admission': c => { c.validated.projection = prepare().projection; },
    'changed count': c => { c.projection.noteCount++; },
    'changed source indices': c => { c.projection.sourceMeasureIndices.reverse(); },
    'omitted caller tie chains': c => { c.projection.tieChains = []; },
    'cross-source caller tie chains': c => { c.projection.tieChains[0] = [...c.projection.tieChains[0], ...c.projection.tieChains[1]]; },
    'gapped source map': c => { c.validated.segments[2] = {...c.validated.segments[2], at: {numerator: 5, denominator: 1}}; },
    'cross-source map': c => { c.validated.segments[2] = {...c.validated.segments[2], source_note_id: c.validated.segments[1].source_note_id}; },
  };
  for (const [name, mutate] of Object.entries(alterations)) await t.test(name, () => {
    const context = prepare(); clearTies(context); mutate(context); rejectedWithoutWrites(context);
  });
});

test('complete model proof rejects added, missing, duplicate and hidden pitched notes before changing ties', async t => {
  const alterations = {
    'missing canonical note': c => { c.rows[0].voice.Notes.splice(c.rows[0].voice.Notes.indexOf(c.rows[0].note), 1); },
    'duplicate model reference': c => { c.rows[0].voice.Notes.push(c.rows[0].note); },
    'extra cloned note': c => { const row = c.rows[0]; row.voice.Notes.push(Object.assign(Object.create(Object.getPrototypeOf(row.note)), row.note)); },
    'hidden canonical pitch': c => { c.rows[0].note.PrintObject = false; },
    'hidden extra pitch': c => { const row = c.rows[0], note = Object.assign(Object.create(Object.getPrototypeOf(row.note)), row.note); note.PrintObject = false; row.voice.Notes.push(note); },
    'missing generated padding': c => { const note = c.padding[0], voice = note.ParentVoiceEntry; voice.Notes.splice(voice.Notes.indexOf(note), 1); },
    'visible generated padding': c => { c.padding[0].PrintObject = true; },
    'changed padding duration': c => { c.padding[0].Length = withOsmd(osmd => new osmd.Fraction(1, 8)); },
    'pitched generated padding': c => { const note = c.padding[0]; note.isRestFlag = false; note.pitch = c.groups[0].notes[0].Pitch; },
  };
  for (const [name, mutate] of Object.entries(alterations)) await t.test(name, () => {
    const context = prepare(); assert.ok(context.padding.length); clearTies(context); mutate(context); rejectedWithoutWrites(context);
  });
});

test('model ancestry and exact timing are re-proved on every invocation including already correct graphs', async t => {
  const alterations = {
    'note source measure': c => { c.rows[0].note.sourceMeasure = c.renderer.Sheet.SourceMeasures[1]; },
    'note voice parent': c => { c.rows[0].note.ParentVoiceEntry = c.rows.find(row => row.voice !== c.rows[0].voice).voice; },
    'note staff entry parent': c => { c.rows[0].note.ParentStaffEntry = c.rows.find(row => row.entry !== c.rows[0].entry).entry; },
    'voice staff entry parent': c => { c.rows[0].voice.ParentSourceStaffEntry = c.rows.find(row => row.entry !== c.rows[0].entry).entry; },
    'staff entry container parent': c => { c.rows[0].entry.verticalContainerParent = c.rows.find(row => row.container !== c.rows[0].container).container; },
    'container measure parent': c => { c.rows[0].container.ParentMeasure = c.renderer.Sheet.SourceMeasures[1]; },
    'container timestamp': c => { c.rows[0].container.Timestamp = withOsmd(osmd => new osmd.Fraction(1, 4)); },
    'voice timestamp': c => { c.rows[0].voice.Timestamp = withOsmd(osmd => new osmd.Fraction(1, 4)); },
    'note duration': c => { c.rows[0].note.Length = withOsmd(osmd => new osmd.Fraction(1, 4)); },
    'measure timestamp': c => { c.renderer.Sheet.SourceMeasures[1].AbsoluteTimestamp = withOsmd(osmd => new osmd.Fraction(3, 1)); },
    'voice identity': c => { c.rows[0].voice.ParentVoice.voiceId = 99; },
  };
  for (const [name, mutate] of Object.entries(alterations)) await t.test(name, () => {
    const context = prepare();
    assert.equal(restore(context).ok, true); assertPartition(context);
    mutate(context); rejectedWithoutWrites(context);
  });
});

test('foreign tie members and non-simple authored tie types reject the whole transaction', async t => {
  for (const scenario of ['foreign member', 'foreign member without backlink', 'non-simple tie']) await t.test(scenario, () => {
    const context = prepare(); clearTies(context);
    const tie = connect(context.groups[0].notes), extra = [];
    if (scenario.startsWith('foreign')) {
      const foreign = prepare().groups[0].notes[0];
      if (scenario === 'foreign member') foreign.NoteTie = tie;
      tie.Notes.push(foreign); extra.push(foreign);
    } else tie.type = 'H';
    rejectedWithoutWrites(context, extra);
  });
});

test('constructor, AddNote and postcondition failures roll back all tie pointers synchronously', async t => {
  for (const scenario of ['second constructor', 'midway AddNote', 'postcondition']) await t.test(scenario, () => {
    const context = prepare(); clearTies(context);
    for (const note of context.notes) connect([note]);
    const unchanged = snapshot(context);
    withOsmd(osmd => {
      let constructors = 0, additions = 0;
      class InterruptedTie extends osmd.Tie {
        constructor(...args) {
          super(...args);
          if (scenario === 'second constructor' && ++constructors === 2) throw Error('Original test constructor interruption');
        }
        AddNote(note) {
          super.AddNote(note);
          additions++;
          if (scenario === 'midway AddNote' && additions === 2) throw Error('Original test AddNote interruption');
          if (scenario === 'postcondition' && additions === 2) note.NoteTie = undefined;
        }
      }
      assert.deepEqual(restore(context, InterruptedTie, osmd.TieTypes), {ok: false, key: 'tieContext'});
    });
    unchanged();
    assert.equal(restore(context).ok, true, 'An ordinary retry after rollback succeeds');
    assertPartition(context);
  });
});

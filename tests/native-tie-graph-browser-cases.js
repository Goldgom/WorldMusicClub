import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';

// Registered inside the real engraving suite so it inherits its pinned bundle,
// Rust server, same-origin checks, real Chromium and evidence lifecycle. This
// module never starts a second server or substitutes OSMD/model/SVG data.
export function registerNativeTieGraphBrowserTests({
  test, options, getPage, renderBinding, expectBinding, clearBinding, bindingEvidence,
}) {
  test('native v2 reconstructs complete same-key source ties with exact real SVG endpoints through follow and resize', options, async () => {
    const fixture = JSON.parse(await readFile(new URL('./fixtures/basic-key-native-tie-graph-browser.json', import.meta.url), 'utf8'));
    const page = getPage(), native = fixture.response.page, score = native.score, exported = native.musicxml;
    const fixtureBefore = JSON.stringify(fixture), source = JSON.parse(fixture.open.clean_package.score_json);
    const sourceIds = ['midi-t1-e1', 'midi-t1-e2', 'midi-t1-e5'];
    assert.equal(native.view_version, 2);
    assert.equal(native.measure_count, 3);
    assert.equal(native.meter_origin, 'chosen_display_meter');
    assert.equal(source.performance.ppq, 96);
    assert.equal(source.performance.end_tick, 1152);
    assert.equal(fixture.provenance.native_driver_sha256, '3222b0e1d72558d9fca5fbf0e5012cc8acb681c895cd03e042b7d289e73febc7');
    assert.equal(createHash('sha256').update(Buffer.from(fixture.provenance.source_base64, 'base64')).digest('hex'), source.source.sha256);
    assert.equal(fixture.provenance.source_sha256, source.source.sha256);
    assert.equal(fixture.provenance.rights.status, 'original_authored');
    assert.equal(fixture.provenance.rights.license, 'CC0-1.0');
    assert.deepEqual(score.parts.flatMap(part => part.notes.map(note => note.id)), sourceIds);
    assert.deepEqual(native.interpreted_notes.map(note => note.receiver_end_tick), [888, 972, 1056]);
    assert.deepEqual(native.interpreted_notes.map(note => note.start_ms), [0, 500, 5250]);
    assert.deepEqual(sourceIds.map(id => exported.note_id_map.segments.filter(segment => segment.source_note_id === id).length), [3, 3, 1]);

    // This is the production entry point with a genuinely admitted native-v2
    // identity. The test does not import or invoke the reconstruction function.
    const shown = await renderBinding(score, exported, {fromMeasure: 1, toMeasure: 3}, fixture);
    assert.equal(shown.result.mapping.displayedSegmentCount, 7);
    assert.ok(shown.result.mapping.bindings.every(binding => binding.status === 'bound' || binding.reason === 'engraving_shared_glyph'));
    for (const id of sourceIds) {
      const attack = shown.rows.find(row => row.sourceId === id);
      assert.equal(attack.bindingStatus, 'bound', `The separately timed ${id} attack owns its actual head`);
    }

    await page.evaluate(async fixture => {
      const {basicKeyWrittenAt} = await import('/basic-key-notation.js');
      const watch = window.__wmhBinding, song = watch.nativeSong, nativePage = watch.nativePage;
      watch.assert(song && nativePage && typeof watch.nativeSourceBefore === 'string', 'The harness observes the exact admitted objects passed to the production renderer');
      watch.assert(JSON.stringify({song, nativePage}) === watch.nativeSourceBefore, 'Initial production rendering preserves its original admitted source/page/runtime');
      window.__wmhNativeTieSource = {fixture, song, nativePage, basicKeyWrittenAt,
        sourceBefore: watch.nativeSourceBefore, fixtureBefore: JSON.stringify(fixture),
        inputBefore: JSON.stringify({score: window.__wmhBinding.score, exported: window.__wmhBinding.exported}),
      };
    }, fixture);

    const inspect = () => page.evaluate(() => {
      const watch = window.__wmhBinding, renderer = watch.renderer, osmd = window.opensheetmusicdisplay;
      const state = window.__wmhNativeTieSource, mapping = window.lastEngraving.mappingStatus();
      const check = watch.assert, model = [], graphNotes = new Set(), graphicalTies = new Set();
      const measures = renderer.Sheet.SourceMeasures;
      check(measures.length === 3 && watch.modelFrom === 1 && watch.modelTo === 3, 'The model retains all three native source bars');
      for (const measure of measures) for (const vertical of measure.VerticalSourceStaffEntryContainers)
        for (const staff of vertical.StaffEntries || []) for (const voice of staff?.VoiceEntries || [])
          for (const note of voice.Notes || []) {
            check(!model.includes(note), 'Every complete model note occurs exactly once');
            check(note.SourceMeasure === measure && note.ParentVoiceEntry === voice && note.ParentStaffEntry === staff,
              'Model notes retain their exact owning measure, voice and staff-entry objects');
            model.push(note);
          }
      for (const row of renderer.GraphicSheet.MeasureList) for (const measure of row || [])
        for (const staff of measure?.staffEntries || []) {
          for (const tie of staff.GraphicalTies || []) graphicalTies.add(tie);
          for (const voice of staff.graphicalVoiceEntries || []) for (const note of voice.notes || []) graphNotes.add(note);
        }

      // Independent exact tuple matching from every source segment. Neither
      // NoteTie nor any caller-provided tieChains is used to establish identity.
      const byXmlId = new Map(), canonical = new Set(), modelEvidence = [], glyphs = [];
      for (const segment of watch.exported.note_id_map.segments) {
        const candidates = model.filter(note => {
          const staff = note.ParentStaff;
          return staff.ParentInstrument.IdString === segment.xml_part_id
            && staff.ParentInstrument.Staves.indexOf(staff) + 1 === segment.staff
            && measures.indexOf(note.SourceMeasure) === segment.source_measure_index
            && String(note.ParentVoiceEntry.ParentVoice.VoiceId) === segment.xml_voice
            && watch.sameBeat(note.ParentVoiceEntry.Timestamp, segment.measure_at)
            && watch.sameBeat(note.getAbsoluteTimestamp(), segment.at, watch.origin)
            && watch.sameBeat(note.Length, segment.duration)
            && watch.samePitch(watch.sourcePitch(note), segment.pitch);
        });
        check(candidates.length === 1, `Exact unique model tuple for ${segment.xml_note_id}`);
        const note = candidates[0];
        check(note.PrintObject === true && !canonical.has(note), 'Each canonical segment owns one distinct visible model note');
        canonical.add(note); byXmlId.set(segment.xml_note_id, note);
        const graphical = [...graphNotes].filter(graph => graph.sourceNote === note);
        check(graphical.length === 1 && renderer.EngravingRules.GNote(note) === graphical[0], 'The pinned graphic lookup retains the exact source model object');
        const binding = mapping.bindings.find(binding => binding.xmlNoteId === segment.xml_note_id);
        check(binding?.sourceNoteId === segment.source_note_id && binding.sourceMeasureIndex === segment.source_measure_index,
          'Every exact source segment is retained in the public map');
        check(binding.status === 'bound' || binding.status === 'unavailable' && binding.reason === 'engraving_shared_glyph',
          'A coincident unison may disclose shared glyphs, but must not lose model identity');
        const graph = graphical[0], head = graph.getNoteheadSVGs()[graph.vfnoteIndex];
        check(head?.isConnected, 'Every proved canonical model note has its real mounted notehead');
        glyphs.push({segment, binding, head, box: head.getBoundingClientRect()});
        modelEvidence.push({xmlNoteId: segment.xml_note_id, sourceNoteId: segment.source_note_id,
          sourceMeasureIndex: segment.source_measure_index, xmlVoice: segment.xml_voice,
          at: segment.at, duration: segment.duration, bindingStatus: binding.status, reason: binding.reason || null});
      }
      check(canonical.size === 7, 'All seven canonical segments have exact distinct model identities');
      for (const glyph of glyphs) {
        const collisions = glyphs.filter(other => other !== glyph && (other.head === glyph.head
          || other.segment.xml_part_id === glyph.segment.xml_part_id && other.segment.staff === glyph.segment.staff
          && other.segment.source_measure_index === glyph.segment.source_measure_index
          && BigInt(other.segment.measure_at.numerator) * BigInt(glyph.segment.measure_at.denominator)
            === BigInt(glyph.segment.measure_at.numerator) * BigInt(other.segment.measure_at.denominator)
          && ['x', 'y', 'width', 'height'].every(axis => Math.abs(other.box[axis] - glyph.box[axis]) < 0.5)));
        check(glyph.binding.status === 'bound' ? collisions.length === 0
          : collisions.length > 0 && collisions.every(other => other.binding.reason === 'engraving_shared_glyph'),
        'Bound heads have unique ownership, and shared-glyph status has a real coincident source peer');
      }
      const padding = model.filter(note => !canonical.has(note));
      check(padding.length > 0, 'The composite actually exercises generated silent padding');
      for (const note of padding) check(note.isRest() && note.PrintObject === false && !note.NoteTie, 'Generated hidden padding remains untied');

      const compare = (a, b) => {
        const delta = BigInt(a.at.numerator) * BigInt(b.at.denominator) - BigInt(b.at.numerator) * BigInt(a.at.denominator);
        return delta < 0n ? -1 : delta > 0n ? 1 : 0;
      };
      const expectedPairs = [], sourceTies = new Set(), groups = [];
      for (const source of watch.score.parts.flatMap(part => part.notes)) {
        const segments = watch.exported.note_id_map.segments.filter(segment => segment.source_note_id === source.id).sort(compare);
        const notes = segments.map(segment => byXmlId.get(segment.xml_note_id));
        if (notes.length === 1) {
          check(source.id === 'midi-t1-e5' && !notes[0].NoteTie, 'The isolated G4 remains a truly untied singleton');
        } else {
          check(notes.length === 3 && segments.every((segment, index) => segment.source_measure_index === index), 'Each same-key source crosses the complete intermediate bar');
          const tie = notes[0].NoteTie;
          check(tie instanceof osmd.Tie && tie.Type === osmd.TieTypes.SIMPLE, 'Every reconstructed chain is an official pinned simple Tie');
          check(!sourceTies.has(tie), 'Separate same-key attacks own separate Tie objects');
          sourceTies.add(tie);
          check(tie.Notes.length === notes.length && tie.Notes.every((note, index) => note === notes[index]), 'Tie membership follows exact full source order');
          for (const note of notes) check(note.NoteTie === tie, 'All three source notes have the same reciprocal tie pointer');
          for (let index = 0; index + 1 < notes.length; index++) expectedPairs.push({sourceId: source.id,
            startId: segments[index].xml_note_id, endId: segments[index + 1].xml_note_id,
            start: notes[index], end: notes[index + 1], tie});
        }
        groups.push({sourceId: source.id, xmlNoteIds: segments.map(segment => segment.xml_note_id),
          voiceIds: segments.map(segment => segment.xml_voice), tied: notes.length > 1});
      }
      check(sourceTies.size === 2 && expectedPairs.length === 4, 'Expected partition has exactly two 3-segment ties and four adjacent pairs');
      check(new Set(model.map(note => note.NoteTie).filter(Boolean)).size === 2, 'There are no extra model ties');
      check(groups[0].voiceIds[0] !== groups[1].voiceIds[0], 'Overlapping unisons occupy different engraving voices');
      check(graphicalTies.size === expectedPairs.length, 'There are no missing or extra GraphicalTie objects');

      const ownedElements = new Set(), ownedPaths = new Set(), curves = [];
      for (const pair of expectedPairs) {
        const candidates = [...graphicalTies].filter(tie => tie.StartNote?.sourceNote === pair.start
          && tie.EndNote?.sourceNote === pair.end && tie.Tie === pair.tie);
        check(candidates.length === 1, `Exactly one GraphicalTie joins ${pair.startId} to ${pair.endId}`);
        const tie = candidates[0], element = tie.SVGElement;
        check(tie.vfTie && element?.isConnected && document.querySelector('#staff').contains(element)
          && element.closest('svg') && element.classList.contains('vf-stavetie'), 'The exact graphical pair owns a mounted VexFlow SVG tie');
        check(tie.vfTie.first_note === tie.StartNote.vfnote[0] && tie.vfTie.last_note === tie.EndNote.vfnote[0]
          && tie.vfTie.first_indices.length === 1 && tie.vfTie.first_indices[0] === tie.StartNote.vfnoteIndex
          && tie.vfTie.last_indices.length === 1 && tie.vfTie.last_indices[0] === tie.EndNote.vfnoteIndex,
        'The actual VexFlow curve endpoints use the exact graphical note objects and indexed heads');
        check(!ownedElements.has(element), 'Two source pairs never claim the same mutable curve element');
        ownedElements.add(element);
        const paths = [...element.querySelectorAll('path')];
        check(paths.length === 1, 'Each adjacent source pair owns exactly one actual SVG curve');
        const path = paths[0], box = path.getBoundingClientRect(), css = getComputedStyle(path);
        check(!ownedPaths.has(path) && path.getTotalLength() > 0 && box.width > 0 && box.height > 0,
          'Each independently owned curve has actual nonempty path geometry');
        check(css.display !== 'none' && css.visibility === 'visible' && Number(css.opacity) > 0
          && (css.fill !== 'none' && css.fill !== 'rgba(0, 0, 0, 0)' || css.stroke !== 'none' && css.stroke !== 'rgba(0, 0, 0, 0)'),
        'The actual curve is visibly painted');
        ownedPaths.add(path);
        curves.push({sourceId: pair.sourceId, startXmlNoteId: pair.startId, endXmlNoteId: pair.endId,
          startMeasure: measures.indexOf(pair.start.SourceMeasure), endMeasure: measures.indexOf(pair.end.SourceMeasure),
          width: box.width, height: box.height, pathLength: path.getTotalLength()});
      }
      const mounted = [...document.querySelectorAll('#staff svg .vf-stavetie')];
      check(mounted.length === 4 && mounted.every(element => ownedElements.has(element)), 'The mounted SVG has exactly the four source-owned tie elements and no extras');
      const mountedPaths = [...document.querySelectorAll('#staff svg .vf-stavetie path')];
      check(mountedPaths.length === 4 && mountedPaths.every(path => ownedPaths.has(path)), 'No extra visible tie curve is hidden outside the proved pairs');
      if (state.modelSnapshot) {
        check(state.modelSnapshot.renderer === renderer, 'Resize retains the actual renderer object');
        for (const [id, note] of state.modelSnapshot.byXmlId) check(byXmlId.get(id) === note, 'Resize preserves exact model-note identity');
        for (const [note, tie] of state.modelSnapshot.tiePointers) check(note.NoteTie === tie, 'Resize preserves complete source tie identity');
      } else state.modelSnapshot = {renderer, byXmlId: new Map(byXmlId), tiePointers: model.map(note => [note, note.NoteTie])};
      check(JSON.stringify({song: state.song, nativePage: state.nativePage}) === state.sourceBefore
        && JSON.stringify(state.fixture) === state.fixtureBefore,
        'Native source event bytes, admitted page and runtime remain unchanged');
      check(JSON.stringify({score: watch.score, exported: watch.exported}) === state.inputBefore,
        'Canonical score, exact source IDs and downloadable MusicXML remain unchanged');
      return {groups, curves, modelNotes: model.length, canonicalSegments: canonical.size, paddingNotes: padding.length,
        graphicalTies: graphicalTies.size, visibleTieElements: mounted.length, visibleTiePaths: mountedPaths.length,
        mapping, modelEvidence, rows: watch.reindex()};
    });

    const first = await inspect();
    const activity = () => page.evaluate(() => ({loads: window.__wmhBinding.loadCalls,
      renders: window.__wmhBinding.renderCalls, generation: window.lastEngraving.renderGeneration(),
      graphColors: window.__wmhBinding.graphicColorCalls}));
    const follow = async () => {
      const evidence = [];
      for (const position of [0, 500, 5250, 0]) {
        const view = await page.evaluate(position => {
          const {song, nativePage, basicKeyWrittenAt} = window.__wmhNativeTieSource;
          const timed = song.compilation.timeline.notes.filter(note => note.start_ms <= position && position < note.start_ms + note.duration_ms);
          const view = basicKeyWrittenAt(song, nativePage, position, timed);
          window.__wmhBinding.assert(view && view.entries.length === timed.length, 'Native follow retains every currently active source identity');
          window.__wmhBinding.assert(view.entries.every((entry, index) => entry.sourceNoteId === timed[index].id
            && entry.sourceMeasureIndex === view.occurrence.source_measure_index), 'Native source following preserves runtime IDs and exact source measure ordinals');
          return {position, sourceIds: view.entries.map(entry => entry.sourceNoteId), sourceMeasureIndex: view.occurrence.source_measure_index};
        }, position);
        assert.deepEqual(view.sourceIds, position === 0 ? ['midi-t1-e1'] : position === 500 ? ['midi-t1-e1', 'midi-t1-e2'] : ['midi-t1-e5']);
        await expectBinding(view.sourceIds, view.sourceMeasureIndex);
        const bounds = await page.evaluate(() => window.lastEngraving.expectedNoteBounds());
        assert.equal(bounds.status, 'ready');
        assert.deepEqual(bounds.rects.map(rect => rect.sourceNoteId).sort(), [...view.sourceIds].sort());
        assert.ok(bounds.rects.every(rect => rect.sourceMeasureIndex === view.sourceMeasureIndex && rect.width > 0 && rect.height > 0));
        evidence.push({...view, bounds});
      }
      await clearBinding();
      return evidence;
    };

    const beforeFollow = await activity(), followed = await follow();
    assert.deepEqual(await activity(), beforeFollow, 'Source following and exact-head highlights never reload, redraw, recolor the graph or replace the generation');
    await expectBinding(['midi-t1-e5'], 2);
    await bindingEvidence('native-complete-tie-graph-initial', {provenance: fixture.provenance, proof: first, followed});

    // Keep all three short bars on one system so a split system-edge curve is
    // not mistaken for a second adjacent-source edge. Resize still redraws and
    // rebinds every current SVG node through the production ResizeObserver.
    const resizing = await page.evaluate(() => {
      const watch = window.__wmhBinding;
      window.__wmhNativeTieSource.oldHeads = [...watch.groups.values()];
      window.__wmhNativeTieSource.oldCurves = [...document.querySelectorAll('#staff svg .vf-stavetie')];
      return {events: watch.events.length, loads: watch.loadCalls, renders: watch.renderCalls, generation: window.lastEngraving.renderGeneration()};
    });
    await page.setViewportSize({width: 1200, height: 900});
    await page.waitForFunction(events => window.__wmhBinding.events.length > events, resizing.events);
    const resized = await page.evaluate(() => {
      const watch = window.__wmhBinding, state = window.__wmhNativeTieSource;
      const result = {loads: watch.loadCalls, renders: watch.renderCalls, generation: window.lastEngraving.renderGeneration(),
        oldHeadsDetached: state.oldHeads.every(node => !node.isConnected), oldCurvesDetached: state.oldCurves.every(node => !node.isConnected),
        bounds: window.lastEngraving.expectedNoteBounds()};
      window.lastEngraving.clearExpectedWrittenNotes();
      return result;
    });
    assert.equal(resized.loads, resizing.loads, 'Resize never reloads the native source');
    assert.ok(resized.renders > resizing.renders && resized.generation > resizing.generation);
    assert.equal(resized.oldHeadsDetached, true);
    assert.equal(resized.oldCurvesDetached, true);
    assert.equal(resized.bounds.status, 'ready');
    assert.deepEqual(resized.bounds.rects.map(rect => [rect.sourceNoteId, rect.sourceMeasureIndex]), [['midi-t1-e5', 2]]);
    const afterResize = await inspect();
    assert.deepEqual(afterResize.groups, first.groups);
    assert.deepEqual(afterResize.modelEvidence, first.modelEvidence, 'Resize retains every exact source/model tuple and truthful glyph status');
    assert.equal(afterResize.paddingNotes, first.paddingNotes);
    const afterResizeActivity = await activity(), followedAfterResize = await follow();
    assert.deepEqual(await activity(), afterResizeActivity, 'Source following after resize does not reload or redraw');
    const final = await inspect();
    assert.equal(JSON.stringify(fixture), fixtureBefore, 'The original source, native page, runtime, canonical notes and exports are unchanged');
    await expectBinding(['midi-t1-e1', 'midi-t1-e2'], 0);
    await bindingEvidence('native-complete-tie-graph-resized', {resized, proof: final, followed: followedAfterResize,
      sourceUnchanged: true, runtimeUnchanged: true, canonicalIdsUnchanged: true, exportUnchanged: true});
    await clearBinding();
  });
}

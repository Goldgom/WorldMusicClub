import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {originalStaffRegisterScore} from './staff-register-fixtures.js';

// Registration only. The hosted full-app suite owns the real browser and Rust
// server. Importing or syntax-checking this module launches neither.
export function registerStaffRegisterBrowserRegressions({test, getPage, ui, readyForTitle, exportScore, closeShellPanels, actualMarkerVisibility, artifactDirectory}) {
  test('real basic staff retains complete low, high and extreme glyphs and follows the current low note', {timeout: 60_000}, async () => {
    const page = getPage(), evidence = [];
    await ui('#staff-button').click();
    for (const register of ['low', 'high', 'extremes', 'chord']) {
      const score = originalStaffRegisterScore(register);
      // Leave enough time to pause the real first note without replacing the
      // playback clock. This is an original synthetic exercise, not user music.
      if (register === 'low') {score.tempo[0].bpm = 30; score.parts[0].notes[0].duration = {numerator: 2, denominator: 1};}
      await ui('#score-file').setInputFiles({name: `${score.id}.json`, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(score))});
      await readyForTitle(score.title);
      await ui('#staff-button').click();
      await ui('#engraving-follow').uncheck();
      const viewports = register === 'low' ? [{width: 1280, height: 720}, {width: 844, height: 390}, {width: 390, height: 844}] : [{width: 1280, height: 720}];
      for (const viewport of viewports) {
        await page.setViewportSize(viewport);
        await page.waitForFunction(count => document.querySelectorAll('#notation .score-note').length === count, score.parts[0].notes.length);
        await page.evaluate(async () => {await document.fonts.ready; await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));});
        const geometry = await page.locator('#notation svg').evaluate(svg => {
          const view = svg.viewBox.baseVal;
          return {width: view.width, height: view.height, actual: svg.getBoundingClientRect().toJSON(),
            notes: [...svg.querySelectorAll('.score-note')].map(note => ({id: note.dataset.noteId,
              glyphs: [...note.children].map(glyph => {const box = glyph.getBBox();return {kind: glyph.localName, className: glyph.getAttribute('class'), x: box.x, y: box.y, width: box.width, height: box.height, stroke: parseFloat(getComputedStyle(glyph).strokeWidth) || 0};})}))};
        });
        assert.ok(geometry.height > 170 && geometry.height < 700);
        assert.deepEqual(geometry.notes.map(note => note.id), score.parts[0].notes.map(note => note.id));
        for (const note of geometry.notes) for (const glyph of note.glyphs) {
          assert.ok(glyph.y - glyph.stroke / 2 >= 0 && glyph.y + glyph.height + glyph.stroke / 2 <= geometry.height,
            `The SVG contains the actual painted ${glyph.className} for ${note.id}: ${JSON.stringify({glyph, geometry})}`);
        }
        // Scroll each extreme notehead through the real pane. A very long
        // ledger stack need not fit on screen all at once to remain accessible.
        const first = `#notation [data-note-id="${score.parts[0].notes[0].id}"] .note-head`;
        const lastPitched = score.parts[0].notes.filter(note => note.pitch).at(-1);
        for (const selector of [first, `#notation [data-note-id="${lastPitched.id}"] .note-head`]) {
          await page.locator(selector).scrollIntoViewIfNeeded();
          const visible = await actualMarkerVisibility(selector);
          assert.ok(visible.length === 1 && visible[0].painted && visible[0].fraction >= .95, JSON.stringify(visible));
        }
        evidence.push({register, viewport, geometry});
      }
      if (register === 'low') {
        await page.setViewportSize({width: 844, height: 390});
        await ui('#theme-mode').selectOption('dark');
        await ui('#session-mode').selectOption('listen');
        await ui('#count-in').uncheck();
        await ui('#engraving-follow').check();
        await closeShellPanels();
        await ui('#reset-button').click();
        await page.locator('#play-button:not([disabled])').click();
        await page.waitForFunction(() => document.querySelector('#notation [data-note-id="register-low-0"]')?.classList.contains('active'));
        await page.locator('#play-button').click();
        const active = '#notation [data-note-id="register-low-0"]';
        const visible = await actualMarkerVisibility(active);
        assert.ok(visible[0]?.painted && visible[0].fraction >= .95, `Current low note is completely visible in the dock: ${JSON.stringify(visible)}`);
        assert.equal(await ui('#engraving-follow').isChecked(), true);
        const colors = await page.locator(active).evaluate(note => ({head: getComputedStyle(note.querySelector('.note-head')).fill,
          accidental: getComputedStyle(note.querySelector('.accidental')).fill,
          inactive: getComputedStyle(document.querySelector('#notation .score-note:not(.active) .note-head')).fill}));
        assert.equal(colors.head, colors.accidental);
        assert.notEqual(colors.head, colors.inactive, 'The complete low note retains the current-note highlight');
        evidence.push({currentLowNote: visible, colors, following: true});
        await page.screenshot({path: join(artifactDirectory, 'worldmusichub-live-low-staff-current-dark.png'), fullPage: true, animations: 'disabled'});
      }
      assert.deepEqual(await exportScore(), score, 'Display geometry never changes any canonical pitch, rational, voice or note ID');
      await closeShellPanels();
      await page.screenshot({path: join(artifactDirectory, `worldmusichub-live-${register}-staff-register.png`), fullPage: true, animations: 'disabled'});
    }
    await writeFile(join(artifactDirectory, 'worldmusichub-live-staff-register.json'), JSON.stringify({original_fixtures_only: true, canonical_score_unchanged: true, evidence}, null, 2));
  });
}

import {installPlaybackClockReader, waitForPlaybackClock} from './browser-playback-clock.js';
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {keyboardBrowserScore,observeRealAudio} from './browser-input-fixtures.js';
import {originalReferenceMidiFixture} from './reference-listening-fixture.js';

// Registration only. The full-app suite owns the actual browser, real Rust
// executable, page and teardown. Importing this module starts no process.
export function registerReferenceListeningBrowserRegressions({test,getPage,ui,readyForTitle,
  exportScore,exportTakeData,closeShellPanels,artifactDirectory}) {
  test('real complete MIDI reference listener preserves every source event and the paused scored take through transport, mute and locale changes',
    {timeout:60_000},async()=>{
      const page = getPage(), source = originalReferenceMidiFixture();
      await installPlaybackClockReader(page);await waitForPlaybackClock(page);
      const score = keyboardBrowserScore('original-reference-beside-paused-take');
      const evidence = [], midiRequests = [], forbiddenRequests = [];
      const audio = () => page.evaluate(()=>({...window.audioObservation}));
      const state = value => page.waitForFunction(expected => document.querySelector('#reference-status').dataset.state === expected,value);
      const track = index => page.locator(`#reference-tracks [data-track-index="${index}"] input[type="checkbox"]`);
      const scoredState = () => page.evaluate(()=>({
        title:document.querySelector('#score-title').textContent,
        stageTitle:document.querySelector('#stage-title').textContent,
        position:globalThis.__wmhReadPlaybackClock().positionMs,
        mode:document.querySelector('#session-mode').value,
        pass:document.querySelector('.performance-status').dataset.passId,
        revision:document.querySelector('.performance-status').dataset.revision,
        captured:document.querySelector('#hud-captured').textContent,
        pressed:[...document.querySelectorAll('#keyboard .piano-key.pressed')].map(key=>key.dataset.midi),
      }));
      const referenceClock = () => page.locator('#reference-clock').textContent();
      const observeRequest = request => {
        const path = new URL(request.url()).pathname;
        if (path === '/api/midi/events') midiRequests.push(request);
        if (['/api/compile','/api/import/midi','/api/assess','/api/practice-targets'].includes(path)) forbiddenRequests.push(path);
      };

      await closeShellPanels();
      if (await page.locator('#notation-dock').isVisible()) await page.locator('#notation-toggle').click();
      await ui('#score-file').setInputFiles({name:'original-reference-score.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(score))});
      await readyForTitle(score.title);
      await ui('#session-mode').selectOption('practice');await ui('#count-in').uncheck();await closeShellPanels();
      if (await page.locator('#sound-button').getAttribute('aria-pressed') === 'false') await page.locator('#sound-button').click();
      await page.locator('#play-button').click();
      await page.waitForFunction(()=>globalThis.__wmhReadPlaybackClock().positionMs>0);
      await page.locator('#stage-title').click();await page.keyboard.press('r');
      await page.waitForFunction(()=>document.querySelector('#hud-captured').textContent==='1');
      await page.locator('#play-button').click();
      await page.waitForFunction(()=>document.querySelector('.performance-status').dataset.phase!=='grace');
      const beforeTake = await exportTakeData(), beforeScore = await exportScore();await closeShellPanels();
      assert.equal(beforeTake.passes.length,1);
      assert.deepEqual(beforeTake.passes[0].inputs.map(input=>input.midi),[60]);
      assert.deepEqual(beforeScore,score);
      const beforeState = await scoredState();
      await page.evaluate(observeRealAudio);
      page.on('request',observeRequest);

      async function unchanged(phase) {
        const current = await scoredState();
        assert.deepEqual(current,beforeState,`${phase}: reference listening must not move or record into the scored session`);
        evidence.push({phase,scoredState:current,referenceClock:await referenceClock(),audio:await audio()});
      }
      async function open() {
        await ui('#reference-listening-entry').click();
        await page.locator('#reference-listening-dialog').waitFor({state:'visible'});
        assert.equal(await page.locator('#import-tools-dialog').isVisible(),false);
      }
      async function playThrough(expectedOscillators, label) {
        const before = await audio();
        await page.locator('#reference-play').click();await state('playing');
        await state('ended');
        const after = await audio();
        assert.equal(after.oscillator-before.oscillator,expectedOscillators,`${label}: actual synthesis includes every selected onset, including overlapping identical keys and the declared drum recipes`);
        assert.equal(after.start-before.start,expectedOscillators,`${label}: every observed oscillator really starts`);
        assert.equal(await referenceClock(),'0:06.0 / 0:06.0');
        await unchanged(label);
      }

      try {
        await open();
        assert.equal(await page.locator('#reference-play').isEnabled(),false);
        const [chooser] = await Promise.all([page.waitForEvent('filechooser'),page.locator('#reference-choose-file').click()]);
        const responsePromise = page.waitForResponse(response=>new URL(response.url()).pathname==='/api/midi/events');
        await chooser.setFiles({name:source.name,mimeType:'audio/midi',buffer:source.bytes});
        const response = await responsePromise;
        assert.equal(response.status(),200);
        assert.equal(response.request().method(),'POST');
        assert.equal(response.request().headers()['content-type'],'application/octet-stream');
        assert.deepEqual(response.request().postDataBuffer(),source.bytes,'The real Rust endpoint receives complete original SMF bytes');
        assert.deepEqual(await response.json(),source.timeline,'Real Rust retains every exact source identity, byte span, program, release and rational time');
        await page.waitForFunction(()=>document.querySelector('#reference-counts').dataset.eventCount==='26');
        assert.equal(await page.locator('#reference-source-name').textContent(),source.name);
        assert.deepEqual(await page.locator('#reference-counts').evaluate(element=>({...element.dataset})),
          {trackCount:'3',eventCount:'26',onsetCount:'8'});
        const rows = await page.locator('#reference-tracks [data-track-index]').evaluateAll(elements=>elements.map(element=>({
          trackIndex:Number(element.dataset.trackIndex),eventCount:Number(element.dataset.eventCount),onsetCount:Number(element.dataset.onsetCount),
          text:element.textContent,muted:element.querySelector('input[type="checkbox"]').checked,
        })));
        assert.equal(rows.length,3);
        for (const [index,row] of rows.entries()) {
          const expected = source.expected.tracks[index];
          assert.deepEqual({trackIndex:row.trackIndex,eventCount:row.eventCount,onsetCount:row.onsetCount,muted:row.muted},
            {trackIndex:expected.trackIndex,eventCount:expected.eventCount,onsetCount:expected.onsetCount,muted:false});
          assert.ok(row.text.includes(expected.name),'Literal source track names survive the UI');
        }
        assert.match(await page.locator('#reference-programs').textContent(),/118/,'The unusual original percussion program remains disclosed');
        assert.equal(await page.locator('#reference-policy-accept').isChecked(),false);
        await page.locator('#reference-sound').check();await state('stopped');
        assert.equal(await page.locator('#sound-button').getAttribute('aria-pressed'),'false','Reference sound uses the shared sound setting');
        assert.equal(await page.locator('#reference-play').isEnabled(),false,'Loading and enabling sound cannot bypass the explicit reference-rendition choice');
        assert.deepEqual(await audio(),{construct:0,resume:0,oscillator:0,start:0,stop:0},'Opening, loading and choosing sound do not eagerly create or start audio');
        await unchanged('complete-source-loaded');

        const [download] = await Promise.all([page.waitForEvent('download'),page.locator('#reference-download').click()]);
        assert.equal(await download.failure(),null);
        assert.equal(download.suggestedFilename(),source.name);
        assert.deepEqual(await readFile(await download.path()),source.bytes,'Download returns the exact original bytes, including metadata and encoding');
        await page.locator('#reference-policy-accept').check();
        assert.equal(await page.locator('#reference-play').isEnabled(),true);
        await page.locator('#reference-play').click();await state('playing');
        await page.waitForFunction(()=>window.audioObservation.start>0);
        await page.waitForFunction(()=>!document.querySelector('#reference-clock').textContent.startsWith('0:00.0 /'));
        assert.equal(await track(1).isEnabled(),false,'Track mute cannot change an active rendition');
        await page.locator('#reference-source-name').click();await page.keyboard.press('r');
        await unchanged('playing-with-keyboard-input-routed-away');
        await page.locator('#reference-pause').click();await state('paused');
        const pausedClock = await referenceClock(), pausedAudio = await audio();
        assert.notEqual(pausedClock,'0:00.0 / 0:06.0');
        assert.equal(await track(1).isEnabled(),false,'Changing the reference mix requires Stop, including while paused');

        await page.locator('#reference-policy-accept').focus();
        const localized = await page.evaluate(async()=>{
          const {getAppI18n} = await import('/app-locale.js');
          const i18n=getAppI18n(document),dialog=document.querySelector('#reference-listening-dialog'),focused=document.activeElement;
          const controls=[...dialog.querySelectorAll('input,button')],rows=[...document.querySelectorAll('#reference-tracks [data-track-index]')];
          const snapshot=()=>({clock:document.querySelector('#reference-clock').textContent,
            source:document.querySelector('#reference-source-name').textContent,
            counts:{...document.querySelector('#reference-counts').dataset},
            values:controls.map(element=>({id:element.id,checked:element.checked,disabled:element.disabled,value:element.value})),
            audio:{...window.audioObservation},status:document.querySelector('#reference-status').dataset.state});
          const before=snapshot();
          return ['zh-CN','en'].map(locale=>{
            i18n.setLocale(locale);
            return {locale,before,after:snapshot(),countsText:document.querySelector('#reference-counts').textContent,
              statusText:document.querySelector('#reference-status').textContent,
              sameFocus:document.activeElement===focused,sameControls:controls.every(element=>document.getElementById(element.id)===element),
              sameRows:rows.every(element=>document.querySelector(`#reference-tracks [data-track-index="${element.dataset.trackIndex}"]`)===element),
              reports:i18n.getReports()};
          });
        });
        for (const snapshot of localized) {
          assert.deepEqual(snapshot.after,snapshot.before,'Live language updates preserve the paused reference clock, policy, source, mix, audio and controls');
          assert.equal(snapshot.sameFocus,true);assert.equal(snapshot.sameControls,true);assert.equal(snapshot.sameRows,true);
          assert.deepEqual(snapshot.reports,[]);
        }
        assert.match(localized[0].countsText,/[\u3400-\u9fff]/);
        assert.match(localized[1].countsText,/tracks/i);
        assert.notEqual(localized[0].countsText,localized[1].countsText);
        assert.notEqual(localized[0].statusText,localized[1].statusText);
        assert.equal(await referenceClock(),pausedClock);
        assert.deepEqual(await audio(),pausedAudio,'Paused time and locale changes schedule no additional sound');
        await unchanged('paused-and-live-localized');
        await page.locator('#reference-play').click();await state('playing');
        await page.waitForFunction(previous=>document.querySelector('#reference-clock').textContent!==previous,pausedClock);
        await unchanged('resumed');
        await page.locator('#reference-stop').click();await state('stopped');
        assert.equal(await referenceClock(),'0:00.0 / 0:06.0');
        await unchanged('stopped');

        await playThrough(source.expected.oscillatorCount,'all-three-tracks-ended');
        await page.locator('#reference-stop').click();await state('stopped');
        await track(1).check();
        assert.equal(await track(1).isChecked(),true);
        assert.equal(await page.locator('#reference-counts').getAttribute('data-event-count'),'26','Track mute retains all raw events');
        assert.equal(await page.locator('#reference-counts').getAttribute('data-onset-count'),'8','Track mute retains all source onsets');
        await playThrough(source.expected.oscillatorCountWithoutLower,'independent-lower-track-muted');
        await page.locator('#reference-stop').click();await state('stopped');await track(1).uncheck();
        await page.locator('#reference-play').click();await state('playing');
        await page.locator('#reference-sound').uncheck();await state('muted');
        assert.equal(await page.locator('#reference-play').isEnabled(),false);
        assert.equal(await page.locator('#sound-button').getAttribute('aria-pressed'),'true');
        assert.equal(await referenceClock(),'0:00.0 / 0:06.0','Shared mute cancels and resets reference playback');
        await unchanged('shared-sound-muted');
        await page.locator('#reference-sound').check();await state('stopped');
        await page.locator('#reference-play').click();await state('playing');
        await page.locator('#reference-close').click();await page.locator('#reference-listening-dialog').waitFor({state:'hidden'});
        await unchanged('closed-during-playback');
        await open();await state('stopped');
        assert.equal(await referenceClock(),'0:00.0 / 0:06.0','Closing cancels the reference rendition before reopening');
        assert.equal(await page.locator('#reference-source-name').textContent(),source.name);
        const afterCloseAudio = await audio();
        // Use advancing real animation frames, not synthetic timers or an audio mock.
        await page.evaluate(()=>new Promise(resolve=>{const start=performance.now();const frame=now=>now-start>=200?resolve():requestAnimationFrame(frame);requestAnimationFrame(frame);}));
        assert.deepEqual(await audio(),afterCloseAudio,'No old reference timer schedules sound after Close');
        await page.locator('#reference-close').click();await page.locator('#reference-listening-dialog').waitFor({state:'hidden'});
        assert.deepEqual(await exportTakeData(),beforeTake,'Every scored input, evidence record, target, pass and clock segment survives reference listening unchanged');
        assert.deepEqual(await exportScore(),beforeScore,'Reference listening does not replace or normalize the active score or its original source');
        assert.equal(midiRequests.length,1,'Playback, mute and locale updates reuse the original parse without importing a score');
        assert.deepEqual(forbiddenRequests,[],'Reference operations do not compile, import, assess or create practice targets');
        if (artifactDirectory) await writeFile(join(artifactDirectory,'worldmusichub-live-reference-listening.json'),JSON.stringify({
          original_synthetic_fixture:true,source_sha256:source.timeline.source_sha256,source_bytes:source.bytes.length,
          real_rust_response_exact:true,source_download_byte_exact:true,paused_take_unchanged:true,canonical_score_unchanged:true,
          expected:source.expected,locale:localized.map(({locale,countsText,statusText})=>({locale,countsText,statusText})),evidence,
        },null,2));
      } finally {
        page.off('request',observeRequest);
        if (await page.locator('#reference-listening-dialog').isVisible()) await page.locator('#reference-close').click();
      }
    });
}

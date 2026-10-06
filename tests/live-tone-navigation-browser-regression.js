import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {canonicalPreviewAudioBootstrap,installCanonicalPreviewAudio} from './browser-canonical-preview-audio.js';
import {waitForPlaybackClock,waitForPlaybackClockAdvance} from './browser-playback-clock.js';
import {selectLegacyEnglish} from './browser-input-fixtures.js';
import {validateLiveToneCleanup} from '../scripts/live-tone-proof.mjs';
import {validateLiveToneNavigation} from './live-tone-navigation-proof.js';

const liveSource=readFileSync(new URL('../crates/desktop-shell/live-tone-acceptance.js',import.meta.url),'utf8');
export const liveToneNavigationBootstrap=`${canonicalPreviewAudioBootstrap}\n${liveSource}\nglobalThis.__wmhObserveLiveNavigation=observeLiveToneAudio;`;

export function registerLiveToneNavigationBrowserRegressions({test,getPage,startPreview,prepareKeyboardBrowserPractice,ui,closeShellPanels,exportTakeData,exportScore,pausedTakeSnapshot,artifactDirectory}){
  for(const route of ['settings','authoring'])for(const release of ['keyup','navigation']){
    test(`real unmuted live worklet verifies finite silence through ${route} after ${release}`,{timeout:60_000},async()=>{
      const page=getPage(),report={version:1,route,release,physicalAudio:false,method:'finite live-output-gate PCM windows with continuous native token/call observation; destination path remains connected; source receivers dispose normally',ok:false};
      let installed=false;
      const checkpoint=label=>page.evaluate(label=>__wmhLiveNavigation.checkpoint(label),label);
      const quiet=async(label,{seal=true}={})=>{await page.waitForFunction(label=>{__wmhLiveNavigation.assertHealthy();__wmhPreviewAudio.assertHealthy();return __wmhLiveNavigation.quiet(label);},label);if(seal)await page.evaluate(label=>__wmhLiveNavigation.sealCheckpoint(label),label);};
      try{
        // The ordinary suite bootstrap already played a preview. Observe a fresh
        // document before any audio preparation, including the first Mod Start.
        await page.addInitScript(liveToneNavigationBootstrap);await page.reload({waitUntil:'domcontentloaded'});await waitForPlaybackClock(page);
        await installCanonicalPreviewAudio(page);
        await page.evaluate(async()=>{globalThis.__wmhLiveNavigation=await __wmhObserveLiveNavigation(document,{keyCode:'KeyR',midi:60,readSource:()=>__wmhPreviewAudio.status()});});installed=true;
        await selectLegacyEnglish(page);await startPreview({mode:'practice',performers:'all',notation:false});
        const score=await prepareKeyboardBrowserPractice(`original-live-silence-${route}-${release}`);
        if(!await ui('.practice-options').evaluate(node=>node.open))await ui('.practice-options>summary').click();
        await ui('#metronome-enabled').uncheck();await ui('#count-in').uncheck();await closeShellPanels();
        assert.equal(await page.locator('#sound-button').getAttribute('aria-pressed'),'false','The observed session must stay unmuted');
        await page.locator('#play-button').click();await waitForPlaybackClockAdvance(page);await page.locator('#stage-title').click();
        await page.evaluate(()=>__wmhLiveNavigation.begin());await page.keyboard.down('r');await page.waitForTimeout(40);
        await page.waitForFunction(()=>{__wmhLiveNavigation.assertHealthy();return __wmhLiveNavigation.sounding();});
        assert.equal(await page.locator('#keyboard [data-midi="60"]').getAttribute('aria-pressed'),'true');
        if(release==='keyup'){
          await page.keyboard.up('r');await page.waitForFunction(()=>__wmhLiveNavigation.settled());
        }
        await checkpoint('navigation');if(release==='keyup')await quiet('navigation');else await page.evaluate(()=>__wmhLiveNavigation.sealCheckpoint('navigation',{requireSilence:false}));
        if(route==='settings')await page.locator('#settings-button').click();
        else{
          await page.locator('#back-to-library').click();await page.locator('#lobby-home').click();await page.locator('#home-song-authoring').click();
          await page.locator('#song-authoring-screen').waitFor({state:'visible'});
        }
        if(release==='navigation'){
          // Observe cancellation while the physical key is still held. A later
          // real keyup cannot retroactively supply the missing cleanup proof.
          await page.waitForFunction(()=>__wmhLiveNavigation.failureEvidence().current.receipts.some(row=>row.record.type==='ended'));
          await page.keyboard.up('r');
        }
        await page.waitForFunction(()=>__wmhPreviewAudio.quiet());await checkpoint('entered');await quiet('entered');
        assert.equal(await page.locator('#keyboard .pressed').count(),0);assert.equal(await page.locator('#keyboard-map .held').count(),0);
        assert.equal(await page.locator('#sound-button').getAttribute('aria-pressed'),'false','Cleanup cannot hide behind the Sound switch');
        report.pausedBefore=await pausedTakeSnapshot();report.takeBefore=await exportTakeData();
        // Results export closes Settings; reopen the real panel for the blocked
        // key probe. Authoring remains on its real screen after export.
        if(route==='settings'){await page.locator('#settings-button').click();await page.locator('#settings-title').click();}
        else await page.locator('#song-authoring-title').click();
        await page.keyboard.press('r',{delay:40});await checkpoint('blocked-input');await quiet('blocked-input');
        await closeShellPanels();
        if(route==='authoring'){await page.locator('#authoring-library').click();await page.locator('#resume-session').click();}
        await page.locator('#workspace').waitFor({state:'visible'});await checkpoint('returned');await quiet('returned');
        report.pausedAfter=await pausedTakeSnapshot();report.takeAfter=await exportTakeData();
        assert.deepEqual(report.pausedAfter,report.pausedBefore,'Returning to the stage cannot resume, rewind or reset the paused human take');
        assert.deepEqual(await exportScore(),score,'The original score and exact source bytes remain untouched');
        await checkpoint('finished');await quiet('finished',{seal:false});
        report.audio=await page.evaluate(()=>{__wmhPreviewAudio.assertHealthy();__wmhLiveNavigation.assertHealthy();return __wmhLiveNavigation.finish();});
        validateLiveToneNavigation(report.audio,report);report.ok=true;
      }catch(error){report.error=error.stack||String(error);if(installed)try{report.failedAudio=await page.evaluate(()=>__wmhLiveNavigation.failureEvidence());}catch{}throw error;}
      finally{
        if(installed){const cleanup=await page.evaluate(()=>({live:__wmhLiveNavigation.restore(),source:__wmhPreviewAudio.restore()}));report.cleanup=cleanup;}
        await writeFile(join(artifactDirectory,`worldmusichub-live-silence-${route}-${release}.json`),JSON.stringify(report,null,2));
        if(report.cleanup){validateLiveToneCleanup(report.cleanup.live);assert.equal(report.cleanup.source.restored,true);}
      }
    });
  }
}

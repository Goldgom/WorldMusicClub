import {canonicalPreviewAudioBootstrap,installCanonicalPreviewAudio,readCanonicalPreviewAudio,assertCanonicalPreviewOutput,assertCanonicalPreviewStopped,canonicalPreviewAudioCheckpoint} from './browser-canonical-preview-audio.js';
import {configureSongMod, openSongMod, startSongModPerformance} from '../scripts/hosted-song-mod-controls.mjs';
import {readPlaybackClock, installPlaybackClockReader, waitForPlaybackClock} from './browser-playback-clock.js';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {observeRealAudio} from './browser-input-fixtures.js';
import {assertHomeHoverBoundary} from './home-hover-boundary.js';

// Registration only. The real full-app/hosted runner supplies the browser and
// Rust-backed page. Importing this module does not start a browser or server.
export function registerGameLobbyBrowserRegressions({test,getPage,ui,closeShellPanels,exportScore,exportTakeData,artifactDirectory}) {
  test('real home menu keeps its hitbox stable at the hover boundary', {timeout:45_000}, async()=>{
    const page=getPage(),evidence=[];
    try{
      for(const {viewport,reducedMotion}of [...[{width:1024,height:689},{width:1280,height:720},{width:1920,height:1080}].map(viewport=>({viewport,reducedMotion:'no-preference'})),{viewport:{width:1024,height:689},reducedMotion:'reduce'}]){
        await page.emulateMedia({reducedMotion});
        await page.setViewportSize(viewport);await page.mouse.move(0,0);await page.reload();await waitForPlaybackClock(page);
        await page.locator('#home-single-player').waitFor({state:'visible'});await page.evaluate(()=>document.fonts.ready);
        const baseline=await page.locator('#home-single-player').evaluate(node=>{
          const r=node.getBoundingClientRect();return{target:{x:r.x,y:r.y,width:r.width,height:r.height},copyY:node.querySelector('.game-mode-copy').getBoundingClientRect().y,hovered:node.matches(':hover'),transform:getComputedStyle(node).transform};
        });
        // The original 2px button transform ejects a stationary pointer here on
        // alternate rendered frames. Mouse coordinates are real integer pixels.
        const pointer={x:Math.floor(baseline.target.x+baseline.target.width/2),y:Math.ceil(baseline.target.y+baseline.target.height)-1};
        const row={id:'home-single-player',viewport,reducedMotion,screen:'home',baseline,pointer,samples:[],clicks:[],destination:null,returnedHome:false};evidence.push(row);
        await page.mouse.move(pointer.x,pointer.y);
        row.samples=await page.evaluate(async pointer=>{
          const node=document.getElementById('home-single-player'),samples=[];
          for(let frame=0;frame<5;frame++){
            await new Promise(requestAnimationFrame);
            const r=node.getBoundingClientRect(),hit=document.elementFromPoint(pointer.x,pointer.y);
            samples.push({frame,target:{x:r.x,y:r.y,width:r.width,height:r.height},copyY:node.querySelector('.game-mode-copy').getBoundingClientRect().y,
              hovered:node.matches(':hover'),transform:getComputedStyle(node).transform,hitId:hit?.id||null,hitOwned:hit===node||node.contains(hit),screen:document.body.dataset.screen,viewport:{width:innerWidth,height:innerHeight}});
          }
          return samples;
        },pointer);
        await page.screenshot({path:join(artifactDirectory,`worldmusichub-home-hover-boundary-${viewport.width}x${viewport.height}-${reducedMotion}.png`)});
        await page.evaluate(()=>{
          const node=document.getElementById('home-single-player');globalThis.__wmhHomeBoundaryClicks=[];
          node.addEventListener('click',event=>globalThis.__wmhHomeBoundaryClicks.push({trusted:event.isTrusted,owned:event.target===node||node.contains(event.target),x:event.clientX,y:event.clientY}),{once:true,capture:true});
        });
        await page.mouse.click(pointer.x,pointer.y);await page.locator('#song-lobby').waitFor({state:'visible'});
        row.clicks=await page.evaluate(()=>globalThis.__wmhHomeBoundaryClicks);row.destination=await page.locator('body').getAttribute('data-screen');
        await page.locator('#lobby-home').click();row.returnedHome=await page.locator('#home-single-player').isVisible();
        await page.mouse.move(0,0);await page.keyboard.press('Tab');
        row.keyboard=await page.locator('#home-single-player').evaluate(node=>{
          const r=node.getBoundingClientRect();globalThis.__wmhHomeBoundaryKeyboardClicks=[];
          node.addEventListener('click',event=>globalThis.__wmhHomeBoundaryKeyboardClicks.push({trusted:event.isTrusted,owned:event.target===node||node.contains(event.target)}),{once:true,capture:true});
          return{focusId:document.activeElement?.id,focusVisible:node.matches(':focus-visible'),outlineWidth:parseFloat(getComputedStyle(node).outlineWidth),target:{x:r.x,y:r.y,width:r.width,height:r.height}};
        });
        await page.keyboard.press('Enter');await page.locator('#song-lobby').waitFor({state:'visible'});
        row.keyboard.clicks=await page.evaluate(()=>globalThis.__wmhHomeBoundaryKeyboardClicks);row.keyboard.destination=await page.locator('body').getAttribute('data-screen');
        assertHomeHoverBoundary(row);
      }
    }finally{
      await writeFile(join(artifactDirectory,'worldmusichub-home-hover-boundary.json'),JSON.stringify({version:1,evidence},null,2));
    }
  });
  test('game menu and audible song preview keep equal library halves and independent session state at 1280 and 1920', {timeout:90_000}, async()=>{
    const page=getPage(),evidence=[];await installPlaybackClockReader(page);
    await page.addInitScript(observeRealAudio);await page.addInitScript(canonicalPreviewAudioBootstrap);
    for(const viewport of [{width:1280,height:720},{width:1920,height:1080}]) {
      await page.setViewportSize(viewport);const compiledResponse=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/compile'&&response.request().method()==='POST');await page.reload();await waitForPlaybackClock(page);const compilation=await(await compiledResponse).json();await installCanonicalPreviewAudio(page);
      await page.locator('#home-single-player').waitFor({state:'visible'});
      await ui('#interface-language').selectOption('zh-CN');await closeShellPanels();
      await page.evaluate(()=>document.fonts.ready);
      assert.equal(await page.locator('#song-lobby').isVisible(),false);
      assert.equal(await page.locator('#home-collaboration').isDisabled(),true);
      assert.equal(await page.locator('#home-online').isDisabled(),true);
      const home=await page.evaluate(()=>{
        const rect=element=>{const r=element.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom,right:r.right};};
        return {screen:document.body.dataset.screen,width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth,
          modes:[...document.querySelectorAll('.game-mode')].map(node=>({id:node.id,...rect(node)})),free:rect(document.querySelector('#start-free-practice')),audio:window.audioObservation};
      });
      assert.equal(home.screen,'home');assert.ok(home.scrollWidth<=viewport.width+1);assert.equal(home.audio.construct,0);
      for(const control of [...home.modes,home.free]) {
        assert.ok(control.width>=44&&control.height>=40);assert.ok(control.right<=viewport.width+1);
        const target=page.locator(`#${control.id||'start-free-practice'}`);await target.scrollIntoViewIfNeeded();
        assert.equal(await target.evaluate(node=>{const r=node.getBoundingClientRect(),home=document.querySelector('#game-home').getBoundingClientRect();return r.top>=home.top-1&&r.bottom<=Math.min(home.bottom,innerHeight)+1;}),true,'Every home route is fully reachable in the home scroller');
      }
      await page.locator('#game-home').evaluate(node=>{node.scrollTop=0;});
      await page.screenshot({path:join(artifactDirectory,`worldmusichub-game-home-${viewport.width}x${viewport.height}.png`),fullPage:true});
      await page.locator('#home-single-player').click();await page.locator('#lobby-preview-play:not([disabled])').waitFor();await configureSongMod(page,{performers:'none'});
      const visibleLabels={
        '#lobby-preview-heading':'曲目试听',
        '.lobby-preview-sound span':'试听声音',
        '.lobby-preview-volume span':'试听音量',
        '.lobby-preview-scope':'乐谱正弦音参考 · 最多 30 秒 · 不计入演奏记录',
        '.lobby-options label>span':'演奏乐器',
        '#lobby-edition>span':'当前谱面',
        '#lobby-edition>strong':'原谱',
      };
      for(const [selector,text]of Object.entries(visibleLabels)) {
        const label=page.locator(selector);await label.scrollIntoViewIfNeeded();
        assert.equal(await label.innerText(),text,`${viewport.width}: ${selector} has a visible label`);
        const visible=await label.evaluate(element=>{const r=element.getBoundingClientRect(),pane=element.closest('.preview-copy').getBoundingClientRect();return r.width>0&&r.height>0&&r.top>=pane.top-1&&r.bottom<=pane.bottom+1&&r.right<=innerWidth+1;});
        assert.equal(visible,true,`${viewport.width}: ${selector} is reachable inside the detail pane`);
      }
      const instrument=page.locator('#lobby-instrument');await instrument.scrollIntoViewIfNeeded();
      assert.equal(await instrument.evaluate(element=>element.selectedOptions[0]?.textContent),'钢琴音色');
      const mod=await openSongMod(page);assert.ok(mod.parts.length>0);
      assert.equal(await page.locator('#song-mod-title').innerText(),'歌曲 Mod');
      assert.equal(await page.locator('#song-mod-all-human').innerText(),'全部真人');
      assert.equal(await page.locator('#song-mod-all-machine').innerText(),'全部机器 · 聆听');
      const performer=page.locator('#song-mod-dialog [data-mod-performer]').first();await performer.scrollIntoViewIfNeeded();
      assert.equal(await performer.evaluate(element=>element.selectedOptions[0]?.textContent),'机器');
      assert.equal(await performer.evaluate(element=>{const r=element.getBoundingClientRect(),pane=element.closest('dialog').getBoundingClientRect();return r.height>0&&r.top>=pane.top-1&&r.bottom<=pane.bottom+1;}),true);
      await page.locator('#song-mod-cancel').click();
      await page.locator('#lobby-preview-heading').scrollIntoViewIfNeeded();
      const lobby=await page.evaluate(()=>{
        const rect=selector=>{const r=document.querySelector(selector).getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom,right:r.right};};
        return {library:rect('.song-browser'),preview:rect('.song-preview'),start:rect('#start-performance'),mod:rect('#configure-song-mod'),audition:rect('#lobby-preview-play'),
          scrollWidth:document.documentElement.scrollWidth,screen:document.body.dataset.screen};
      });
      assert.equal(lobby.screen,'library');assert.ok(Math.abs(lobby.library.width-lobby.preview.width)<2,'The entire library pane takes half the available lobby');
      assert.ok(lobby.library.height>viewport.height*.65);assert.ok(lobby.preview.x>=lobby.library.right);
      assert.ok(lobby.start.width>0&&lobby.start.height>0);assert.ok(lobby.start.bottom<=viewport.height+1);assert.ok(lobby.mod.width>0&&lobby.mod.height>0&&lobby.mod.bottom<=viewport.height+1);assert.ok(lobby.audition.bottom<=viewport.height+1);assert.ok(lobby.scrollWidth<=viewport.width+1);
      const profileResponse=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/canonical-audio-profile'&&response.request().method()==='POST');
      await page.locator('#lobby-preview-play').click();
      await page.waitForFunction(()=>document.querySelector('#lobby-preview-status').dataset.state==='playing'&&globalThis.__wmhPreviewAudio.snapshot()[0]?.pcm.blocks.some(block=>block.peak>1e-6&&block.rms>1e-8));
      const response=await profileResponse;assert.equal(response.status(),200);assert.deepEqual(response.request().postDataJSON(),compilation.score);const profile=await response.json();
      const checkpoint=async(phase,audio,index)=>writeFile(join(artifactDirectory,'worldmusichub-lobby-audio-checkpoint.json'),JSON.stringify(canonicalPreviewAudioCheckpoint(audio,index,{viewport,phase,physicalAudio:false}),null,2));
      const playingAudio=await readCanonicalPreviewAudio(page);await checkpoint('playing',playingAudio,0);assert.equal(playingAudio.runs.length,1);assertCanonicalPreviewOutput(playingAudio.runs[0],compilation,profile);
      const audio=await page.evaluate(()=>({...window.audioObservation,states:window.audioObservedContexts.map(context=>context.state)}));
      assert.equal(audio.construct,1);assert.ok(audio.states.every(state=>state==='running'));
      await page.screenshot({path:join(artifactDirectory,`worldmusichub-game-lobby-${viewport.width}x${viewport.height}.png`),fullPage:true});
      await page.locator('#lobby-preview-play').click();await page.waitForFunction(()=>globalThis.__wmhPreviewAudio.quiet());
      const stoppedAudio=await readCanonicalPreviewAudio(page);await checkpoint('stopped',stoppedAudio,0);assertCanonicalPreviewStopped(stoppedAudio,0,{pcm:true});assertCanonicalPreviewOutput(stoppedAudio.runs[0],compilation,profile);
      await page.locator('#settings-button').click();await page.locator('#count-in').uncheck();await closeShellPanels();
      await startSongModPerformance(page,{performers:'all'});await page.waitForFunction(()=>document.querySelector('.performance-status').dataset.phase==='capturing');await page.locator('#back-to-library').click();
      await page.waitForFunction(()=>!['capturing','grace'].includes(document.querySelector('.performance-status').dataset.phase));
      const beforeScore=await exportScore(),beforeTakes=await exportTakeData();await closeShellPanels();
      if(await page.locator('#workspace').isVisible())await page.locator('#back-to-library').click();
      const position=(await page.locator('#progress').evaluate(readPlaybackClock)).positionMs;
      const resumedPreviewIndex=(await readCanonicalPreviewAudio(page)).runs.length;
      await page.locator('#lobby-preview-play').click();await page.waitForFunction(index=>document.querySelector('#lobby-preview-status').dataset.state==='playing'&&globalThis.__wmhPreviewAudio.snapshot()[index]?.pcm.blocks.some(block=>block.peak>1e-6&&block.rms>1e-8),resumedPreviewIndex);
      const resumedPreviewAudio=await readCanonicalPreviewAudio(page);await checkpoint('resumed-preview',resumedPreviewAudio,resumedPreviewIndex);assertCanonicalPreviewOutput(resumedPreviewAudio.runs[resumedPreviewIndex],compilation,profile);
      await page.locator('#lobby-preview-volume').focus();
      for(let step=0;step<19;step++)await page.locator('#lobby-preview-volume').press('ArrowLeft');
      assert.equal(await page.locator('#lobby-preview-volume').inputValue(),'26');
      await page.locator('#lobby-preview-sound').uncheck();
      assert.equal(await page.locator('#lobby-preview-status').getAttribute('data-state'),'muted');await page.waitForFunction(index=>globalThis.__wmhPreviewAudio.snapshot()[index]?.lifecycle.disposed,resumedPreviewIndex);
      const mutedAudio=await readCanonicalPreviewAudio(page);await checkpoint('muted',mutedAudio,resumedPreviewIndex);assertCanonicalPreviewStopped(mutedAudio,resumedPreviewIndex,{pcm:true});
      await page.locator('#lobby-preview-sound').check();assert.equal(await page.locator('#lobby-preview-status').getAttribute('data-state'),'stopped');
      const exitPreviewIndex=(await readCanonicalPreviewAudio(page)).runs.length;await page.locator('#lobby-preview-play').click();await page.waitForFunction(index=>globalThis.__wmhPreviewAudio.snapshot()[index]?.started,exitPreviewIndex);await page.locator('#lobby-home').click();await page.waitForFunction(index=>globalThis.__wmhPreviewAudio.snapshot()[index]?.lifecycle.disposed,exitPreviewIndex);
      const exitedAudio=await readCanonicalPreviewAudio(page);await checkpoint('exited',exitedAudio,exitPreviewIndex);assertCanonicalPreviewStopped(exitedAudio,exitPreviewIndex);
      await page.locator('#home-single-player').click();assert.equal(await page.locator('#lobby-preview-status').getAttribute('data-state'),'stopped');
      assert.equal((await page.locator('#progress').evaluate(readPlaybackClock)).positionMs,position);
      assert.deepEqual(await exportScore(),beforeScore);assert.deepEqual(await exportTakeData(),beforeTakes);await closeShellPanels();
      const observerCleanup=await page.evaluate(()=>globalThis.__wmhPreviewAudio.restore());assert.deepEqual(observerCleanup,{restored:true,overflow:false,errors:[],cleanupErrors:[]});
      evidence.push({viewport,home,lobby,audio,playingAudio,stoppedAudio,mutedAudio,exitedAudio,observerCleanup,physicalAudio:false,visibleLabels,canonicalScoreUnchanged:true,retainedTakeUnchanged:true,noAutomaticResume:true});
    }
    await writeFile(join(artifactDirectory,'worldmusichub-game-menu-preview-evidence.json'),JSON.stringify(evidence,null,2));
  });
}

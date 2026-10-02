import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fixture} from './frontend-fixtures.js';

// Authored for this regression. No user score, retained source, or external music.
export function originalAboveKeyboardScore() {
  const score=structuredClone(fixture),seed=score.parts[0].notes[0];
  score.id='original-above-keyboard-grand-staff';score.title='Original above-keyboard grand staff exercise';score.composer='WorldMusicHub';
  score.provenance.attribution='WorldMusicHub original above-keyboard layout and follow regression';
  score.tempo[0].bpm=240;
  score.measures=Array.from({length:12},(_,index)=>({number:index+1,at:{numerator:index*4,denominator:1},length:{numerator:4,denominator:1}}));
  score.parts[0].notes=score.measures.flatMap((measure,index)=>[1,2].map(staff=>({...structuredClone(seed),id:`band-${index}-${staff}`,at:measure.at,duration:{numerator:4,denominator:1},staff,voice:String(staff),pitch:{step:['C','D','E','G'][index%4],alter:0,octave:staff===1?5:2}})));
  return score;
}

// Registration only. The authorized hosted full-app runner owns its browser and
// real Rust server; importing/syntax-checking this file launches neither.
export function registerAboveKeyboardBrowserRegressions({test,getPage,ui,readyForTitle,exportScore,exportTakeData,closeShellPanels,waitForEngraving,actualMarkerVisibility,simultaneousStageGeometry,assertSimultaneousPiano,artifactDirectory}) {
  test('original grand staff and Jianpu follow above playable keys with an honest short-window fallback',{timeout:90_000},async()=>{
    const page=getPage(),score=originalAboveKeyboardScore(),evidence=[];
    const settle=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))));
    const dismissNotice=async()=>{await closeShellPanels();if(await page.locator('#notice-dismiss').isVisible())await page.locator('#notice-dismiss').click();await settle();};
    await page.setViewportSize({width:1280,height:720});
    await ui('#instrument').selectOption('piano');await ui('#session-mode').selectOption('practice');await ui('#count-in').uncheck();
    await ui('#score-file').setInputFiles({name:`${score.id}.json`,mimeType:'application/json',buffer:Buffer.from(JSON.stringify(score))});await readyForTitle(score.title);
    await ui('#engraved-button').click();await waitForEngraving();
    await ui('#engraving-page-size').selectOption('8');
    if(await page.locator('.dock-help').evaluate(node=>node.open))await page.locator('.dock-help>summary').click();
    await ui('#engraving-follow').check();await dismissNotice();
    await page.waitForFunction(()=>document.querySelector('#workspace').classList.contains('notation-above'));
    const initial=await simultaneousStageGeometry();assertSimultaneousPiano(initial);assert.equal(initial.above,true);
    await page.locator('#play-button').click();
    await page.locator('#stage-title').click();await page.keyboard.press('a');
    await page.waitForFunction(()=>Number(document.querySelector('#written-cursor-status').dataset.sourceMeasureIndex)>=8);
    await page.locator('#play-button').click();await waitForEngraving();
    const expected=await page.locator('.engraving-expected-cue:not([hidden])').count();assert.equal(expected,2,'Both original staff voices retain exact current-note cues');
    assert.match(await page.locator('#engraving-range').textContent(),/9/,'Automatic following crosses the eight-measure page boundary');
    const cues=await actualMarkerVisibility('.engraving-expected-cue:not([hidden])');
    assert.ok(cues.every(cue=>cue.painted&&cue.fraction>=.9),'Both staff cues remain inside the reserved score band');
    // Pausing closes the input grace period; assessment remains an explicit
    // Results action. A retained, ungraded take is valid display-test evidence.
    await page.waitForFunction(()=>document.querySelector('.performance-status').dataset.phase!=='grace');
    const take=await exportTakeData();assert.equal(take.passes.length,1);assert.equal(take.passes[0].inputs.length,1);
    await ui('#interface-language').selectOption('zh-CN');await dismissNotice();
    const verifyPlacement=async geometry=>{
      if(geometry.viewport.width>650||geometry.above){assertSimultaneousPiano(geometry);return;}
      assert.equal(await page.locator('#notation-toggle').isVisible(),true,'Compact score keeps its native keyboard-accessible return control');
      assert.equal(await page.locator('#notation-dock').isVisible(),true);
      assert.ok(geometry.dock.y>=0&&geometry.dock.bottom<=geometry.viewport.height+1);
      assert.ok(geometry.transport.bottom<=geometry.viewport.height+1);
    };
    for(const viewport of [{width:1920,height:1080},{width:1280,height:720},{width:1033,height:403},{width:844,height:390},{width:390,height:844},{width:1280,height:720}]){
      await page.setViewportSize(viewport);await settle();
      const geometry=await simultaneousStageGeometry();await verifyPlacement(geometry);
      if(viewport.width>650)assert.equal(geometry.above,viewport.height>=700,`Expected deliberate placement at ${viewport.width}×${viewport.height}`);
      assert.equal(await page.locator('#engraving-follow').isChecked(),true,'Resizing does not become manual navigation');
      const currentNotes=[];
      for(const button of ['#jianpu-button','#engraved-button']){
        await ui(button).click();await settle();
        if(button==='#engraved-button'){await waitForEngraving();await page.waitForFunction(()=>document.querySelectorAll('.engraving-expected-cue:not([hidden])').length===2);await settle();}
        else{await page.waitForFunction(()=>document.querySelector('#notation .score-note.active'));const digits=await page.locator('#notation .jianpu-note').evaluateAll(nodes=>nodes.map(node=>parseFloat(getComputedStyle(node).fontSize)));assert.ok(digits.length&&digits.every(size=>size>=25),'Jianpu is never shrunk to fit the band');}
        await verifyPlacement(await simultaneousStageGeometry());
        const markers=await actualMarkerVisibility(button==='#engraved-button'?'.engraving-expected-cue:not([hidden])':'#notation .score-note.active');
        assert.equal(markers.length,2,'Both original voices retain a current-note marker after every resize and view switch');
        assert.ok(markers.every(marker=>marker.painted&&marker.fraction>=.9),`${button}: current notes stay readable at ${viewport.width}×${viewport.height}`);
        const view=button==='#engraved-button'?'staff':'jianpu';
        await page.screenshot({path:join(artifactDirectory,`worldmusichub-above-keyboard-${viewport.width}x${viewport.height}-${view}.png`),fullPage:true,animations:'disabled'});
        currentNotes.push({view,markers});
      }
      await page.screenshot({path:join(artifactDirectory,`worldmusichub-above-keyboard-${viewport.width}x${viewport.height}.png`),fullPage:true,animations:'disabled'});
      if(viewport.width<=650&&!geometry.above){
        const toggle=page.locator('#notation-toggle');await toggle.focus();await page.keyboard.press('Space');await settle();
        assert.equal(await page.locator('#piano-stage').isVisible(),true,'Compact fallback can return to the actual playable piano by keyboard');
        assert.equal(await page.locator('#notation-dock').isVisible(),false);
        await page.keyboard.press('Space');await waitForEngraving();await settle();
        assert.equal(await page.locator('#engraving-follow').isChecked(),true);
      }
      evidence.push({viewport,geometry,currentNotes});
    }
    await ui('#engraving-prev').click();assert.equal(await page.locator('#engraving-follow').isChecked(),false,'Manual pages still suspend following');
    const manualRange=await page.locator('#engraving-range').textContent();
    await page.locator('#notation-toggle').click();await page.locator('#notation-toggle').click();await waitForEngraving();
    assert.equal(await page.locator('#engraving-follow').isChecked(),false);assert.equal(await page.locator('#engraving-range').textContent(),manualRange);
    assert.deepEqual(await exportTakeData(),take,'Placement, modes and pages never alter the paused performance');
    assert.deepEqual(await exportScore(),score,'The complete original two-staff score is preserved');
    await dismissNotice();
    const heldKeys=()=>page.locator('#keyboard .piano-key.pressed').evaluateAll(nodes=>nodes.map(node=>({midi:node.dataset.midi,pressed:node.getAttribute('aria-pressed')})));
    const contact=[{midi:'60',pressed:'true'}],resizeContacts=[];
    // Choose a view before holding input: a real click deliberately moves focus
    // to a protected, nonmusical control and releases typing-key ownership.
    for(const button of ['#jianpu-button','#engraved-button']){
      await page.locator(button).click();await settle();if(button==='#engraved-button')await waitForEngraving();
      await page.locator('#stage-title').focus();await page.keyboard.down('r');
      try{
        await page.waitForFunction(()=>document.querySelector('#keyboard .piano-key.pressed'));
        assert.deepEqual(await heldKeys(),contact);
        for(const viewport of [{width:1920,height:1080},{width:1280,height:720}]){
          await page.setViewportSize(viewport);await settle();if(button==='#engraved-button')await waitForEngraving();
          assert.equal(await page.evaluate(()=>document.activeElement.id),'stage-title','Resize keeps performance focus');
          assert.deepEqual(await heldKeys(),contact,'Resize alone retains the exact typing contact in either notation view');
          resizeContacts.push({view:button,viewport,held:await heldKeys()});
        }
      }finally{await page.keyboard.up('r');}
      await page.waitForFunction(()=>!document.querySelector('#keyboard .piano-key.pressed'));
    }
    await page.locator('#stage-title').focus();await page.keyboard.down('r');
    try{
      await page.waitForFunction(()=>document.querySelector('#keyboard .piano-key.pressed'));
      await page.locator('#jianpu-button').click();
      assert.equal(await page.evaluate(()=>document.activeElement.id),'jianpu-button','The real notation button receives focus');
      await page.waitForFunction(()=>!document.querySelector('#keyboard .piano-key.pressed'));
    }finally{await page.keyboard.up('r');}
    await page.locator('#stage-title').focus();await page.keyboard.down('r');
    try{await page.waitForFunction(()=>document.querySelector('#keyboard .piano-key.pressed'));assert.deepEqual(await heldKeys(),contact,'Fresh input works after protected control focus and the physical keyup');}
    finally{await page.keyboard.up('r');}
    await page.waitForFunction(()=>!document.querySelector('#keyboard .piano-key.pressed'));
    await writeFile(join(artifactDirectory,'worldmusichub-above-keyboard.json'),JSON.stringify({original_fixtures_only:true,initial,cues,evidence,resizeContacts,paused_take_unchanged:true,canonical_score_unchanged:true,held_typing_key_survived_resize:true,notation_control_focus_released_typing_key:true,typing_input_recovered_after_control_focus:true,notation_switches_preserved_current_score_cues:true},null,2));
  });
}

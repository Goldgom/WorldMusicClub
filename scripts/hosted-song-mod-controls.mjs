// Real Playwright controls for hosted acceptance. Reads inspect the rendered
// dialog; all changes use visible buttons, selects and checkboxes.
import assert from 'node:assert/strict';
import {readPlaybackClock} from '../web/playback-clock-view.js';

export async function waitForSongMod(page,{origin='preview'}={}) {
  assert.ok(['preview','stage'].includes(origin));
  const selector=origin==='preview'?'#configure-song-mod':'#edit-song-mod';
  await page.locator(selector).waitFor({state:'visible'});
  await page.waitForFunction(selector=>document.querySelector(selector)?.disabled===false,selector);
}

export async function waitForStartPerformance(page) {
  await page.locator('#start-performance').waitFor({state:'visible'});
  await page.waitForFunction(()=>document.querySelector('#start-performance')?.disabled===false);
}

export async function readSongModDraft(page) {
  await page.locator('#song-mod-dialog').waitFor({state:'visible'});
  return page.locator('#song-mod-dialog').evaluate(dialog=>({
    layout:dialog.querySelector('#song-mod-layout').value,
    showOtherParts:dialog.querySelector('#song-mod-show-others').checked,
    parts:[...dialog.querySelectorAll('.song-mod-part')].map(row=>({
      partId:row.dataset.partId,
      performer:row.querySelector('[data-mod-performer]').value,
      instrument:row.querySelector('[data-mod-instrument]').value,
      muted:row.querySelector('[data-mod-mute]').checked,
      visible:row.querySelector('[data-mod-visible]').checked,
      instrumentDisabled:row.querySelector('[data-mod-instrument]').disabled,
    })),
  }));
}

export async function openSongMod(page,{origin='preview'}={}) {
  await waitForSongMod(page,{origin});
  await page.locator(origin==='preview'?'#configure-song-mod':'#edit-song-mod').click();
  return readSongModDraft(page);
}

export async function configureSongMod(page,{origin='preview',performers,layout,showOtherParts,parts=[],restore=false,beforeApply}={}) {
  const initial=await openSongMod(page,{origin});
  assert.ok(initial.parts.length,'The visible Mod must include source parts');
  if(restore)await page.locator('#song-mod-restore').click();
  if(performers!==undefined){
    assert.ok(performers==='all'||performers==='none'||Array.isArray(performers),'Use all, none or explicit human part IDs');
    await page.locator(performers==='all'?'#song-mod-all-human':'#song-mod-all-machine').click();
    if(Array.isArray(performers)){
      assert.equal(new Set(performers).size,performers.length,'Human part IDs must be unique');
      for(const partId of performers){
        assert.ok(initial.parts.some(part=>part.partId===partId),`Missing source part ${partId}`);
        await page.locator('#song-mod-dialog').locator(`[data-mod-performer=${JSON.stringify(partId)}]`).selectOption('human');
      }
    }
  }
  if(layout!==undefined){assert.ok(['complete','solo'].includes(layout));await page.locator('#song-mod-layout').selectOption(layout);}
  if(showOtherParts!==undefined)await page.locator('#song-mod-show-others').setChecked(showOtherParts);
  for(const change of parts){
    assert.ok(initial.parts.some(part=>part.partId===change.partId),`Missing source part ${change.partId}`);
    const field=name=>page.locator('#song-mod-dialog').locator(`[data-mod-${name}=${JSON.stringify(change.partId)}]`);
    if(change.performer!==undefined)await field('performer').selectOption(change.performer);
    if(change.instrument!==undefined)await field('instrument').selectOption(change.instrument);
    if(change.muted!==undefined)await field('mute').setChecked(change.muted);
    if(change.visible!==undefined)await field('visible').setChecked(change.visible);
  }
  const draft=await readSongModDraft(page);
  assert.deepEqual(draft.parts.map(part=>part.partId),initial.parts.map(part=>part.partId),'Mod preserves source part order');
  if(performers!==undefined){
    const expected=performers==='all'?initial.parts.map(part=>part.partId):performers==='none'?[]:performers;
    const overrides=new Map(parts.filter(part=>part.performer!==undefined).map(part=>[part.partId,part.performer]));
    const expectedHumans=initial.parts.filter(part=>(overrides.get(part.partId)??(expected.includes(part.partId)?'human':'machine'))==='human').map(part=>part.partId);
    assert.deepEqual(draft.parts.filter(part=>part.performer==='human').map(part=>part.partId),expectedHumans,'Visible Mod performer choices must match the requested human set');
  }
  if(layout!==undefined)assert.equal(draft.layout,layout);
  if(showOtherParts!==undefined)assert.equal(draft.showOtherParts,showOtherParts);
  for(const change of parts)for(const key of ['performer','instrument','muted','visible'])if(change[key]!==undefined)assert.equal(draft.parts.find(part=>part.partId===change.partId)[key],change[key]);
  if(beforeApply)await beforeApply(draft);
  await page.locator('#song-mod-apply').click();
  // Applying performs asynchronous compatibility checks. Never race Start
  // against an open or still-busy dialog.
  await page.locator('#song-mod-dialog').waitFor({state:'hidden'});
  return draft;
}

export async function startSongModPerformance(page,options={}) {
  const draft=await configureSongMod(page,{restore:true,layout:'solo',showOtherParts:true,...options,origin:'preview'});
  await waitForStartPerformance(page);
  await page.locator('#start-performance').click();
  await page.waitForFunction(()=>document.body.dataset.screen==='stage'&&document.querySelector('#play-button')?.disabled===false&&JSON.parse(document.querySelector('#progress')?.getAttribute('data-playback-clock')||'null')?.running===true);
  return draft;
}

export async function resetSongModPerformance(page) {
  await page.locator('#reset-button').click();
  await page.waitForFunction(()=>document.querySelector('#play-button')?.disabled===false&&JSON.parse(document.querySelector('#progress')?.getAttribute('data-playback-clock')||'null')?.phase==='ready');
  const clock=await page.locator('#progress').evaluate(readPlaybackClock);
  assert.equal(clock.positionMs,0);assert.equal(clock.running,false);
}

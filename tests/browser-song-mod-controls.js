import assert from 'node:assert/strict';
import {configureSongMod, openSongMod, startSongModPerformance, resetSongModPerformance} from '../scripts/hosted-song-mod-controls.mjs';

// Suite routing only. The shared hosted helper owns every real Mod click,
// selection and checkbox change; no hidden legacy control is activated here.
export function browserSongModControls({getPage, closeShellPanels}) {
  async function stage() {
    const page=getPage();
    await closeShellPanels();
    if(await page.locator('#song-lobby').isVisible())await page.locator('#resume-session').click();
    await page.locator('#edit-song-mod').waitFor({state:'visible'});
    return page;
  }
  async function selectedPerformers(page,origin,mode) {
    assert.ok(mode==='listen'||mode==='practice');
    if(mode==='listen')return 'none';
    const draft=await openSongMod(page,{origin});
    const humans=draft.parts.filter(part=>part.performer==='human').map(part=>part.partId);
    await page.locator('#song-mod-cancel').click();
    return humans.length?humans:'all';
  }
  async function configureStageMod(options) {
    const page=await stage();
    return configureSongMod(page,{...options,origin:'stage'});
  }
  async function setSessionMode(mode) {
    const page=await stage(),performers=await selectedPerformers(page,'stage',mode);
    return configureSongMod(page,{origin:'stage',performers,layout:'solo'});
  }
  async function selectPracticePart(partId) {
    // A target choice is an explicit human assignment. Empty means all human.
    return configureStageMod({performers:partId?[partId]:'all',layout:'solo'});
  }
  async function startPreview({reset=true,notation=true,mode='listen',performers}={}) {
    const page=getPage();await closeShellPanels();
    if(await page.locator('#game-home').isVisible())await page.locator('#home-single-player').click();
    if(await page.locator('#workspace').isVisible())await page.locator('#back-to-library').click();
    const selected=performers??await selectedPerformers(page,'preview',mode);
    await startSongModPerformance(page,{restore:false,performers:selected,layout:'solo',showOtherParts:true});
    if(reset)await resetSongModPerformance(page);
    // A deliberate view choice, independent of desktop startup preferences.
    if((await page.locator('#notation-toggle').getAttribute('aria-expanded')==='true')!==notation)await page.locator('#notation-toggle').click();
  }
  return {configureStageMod,setSessionMode,selectPracticePart,startPreview};
}

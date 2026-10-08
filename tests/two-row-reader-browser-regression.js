import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {originalAboveKeyboardScore} from './above-keyboard-browser-regression.js';

/** Real app/Rust/OSMD, registered in the full-app suite. No API or layout mocks. */
export function registerTwoRowReaderBrowserRegression({test,getPage,ui,readyForTitle,closeShellPanels,waitForEngraving,exportScore,artifactDirectory}){
 test('two-row score and complete reader retain all original measures across compact viewports',{timeout:120_000},async()=>{
  const page=getPage(),score=originalAboveKeyboardScore(),evidence=[];
  await ui('#score-file').setInputFiles({name:'two-row-original.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(score))});await readyForTitle(score.title);
  await ui('#engraved-button').click();await waitForEngraving();await ui('#engraving-follow').check();await closeShellPanels();
  for(const viewport of [{width:1280,height:720},{width:844,height:390},{width:390,height:844}]){
   await page.setViewportSize(viewport);await page.waitForFunction(()=>document.querySelector('#notation-lane-overlay').dataset.notationRows==='2');
   await page.locator('#complete-score-button').click();
   const dialog=page.locator('#complete-score-reader');await dialog.waitFor({state:'visible'});
   while(await dialog.locator('.complete-score-reader-more').isVisible()){
    await dialog.locator('.complete-score-reader-more').waitFor({state:'visible'});
    await page.waitForFunction(()=>!document.querySelector('.complete-score-reader-more').disabled||document.querySelector('.complete-score-reader-sentinel').hidden);
    if(await dialog.locator('.complete-score-reader-more').isVisible())await dialog.locator('.complete-score-reader-more').click();
   }
   const report=await dialog.evaluate(node=>{const bounds=node.getBoundingClientRect(),scroll=node.querySelector('.complete-score-reader-scroll');return{status:node.dataset.readerStatus,viewport:{width:innerWidth,height:innerHeight},bounds:{left:bounds.left,top:bounds.top,right:bounds.right,bottom:bounds.bottom},sections:[...node.querySelectorAll('.complete-score-reader-section')].map(row=>({from:Number(row.dataset.fromMeasure),to:Number(row.dataset.toMeasure),parts:JSON.parse(row.dataset.partIds),status:row.dataset.status,svgs:row.querySelectorAll('svg').length})),scrollHeight:scroll.scrollHeight,clientHeight:scroll.clientHeight};});
   assert.equal(report.status,'end');assert.ok(report.bounds.left>=0&&report.bounds.top>=0&&report.bounds.right<=viewport.width&&report.bounds.bottom<=viewport.height);
   for(const part of score.parts)for(let measure=1;measure<=score.measures.length;measure++)assert.ok(report.sections.some(row=>row.from<=measure&&row.to>=measure&&row.parts.includes(part.id)&&row.svgs>0),`Missing ${part.id} measure ${measure}`);
   const scroller=dialog.locator('.complete-score-reader-scroll');await scroller.evaluate(node=>{node.scrollTop=node.scrollHeight;});const before=await scroller.evaluate(node=>node.scrollTop);await page.waitForTimeout(150);assert.equal(await scroller.evaluate(node=>node.scrollTop),before,'Browsing is not forced to the playback page');
   await page.screenshot({path:join(artifactDirectory,`worldmusichub-two-row-reader-${viewport.width}x${viewport.height}.png`),fullPage:true});evidence.push(report);
   await page.keyboard.press('Escape');assert.equal(await dialog.isVisible(),false);assert.equal(await page.locator('#engraving-follow').isChecked(),true);
  }
  assert.deepEqual(await exportScore(),score);await writeFile(join(artifactDirectory,'worldmusichub-two-row-reader.json'),JSON.stringify({complete:true,evidence},null,2));
 });
}

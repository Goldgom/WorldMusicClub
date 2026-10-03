import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';

// Registered by the real Rust/full-app suite. Importing starts no browser or server.
export function registerFreePianoBrowserRegressions({test,getPage,closeShellPanels,artifactDirectory}) {
  test('real free piano fills desktop and compact stages, records actual key input and preserves held keys across locale redraw', {timeout:60_000}, async()=>{
    const page=getPage(),evidence=[];
    await closeShellPanels();await page.locator('#settings-button').click();await page.locator('#interface-language').selectOption('zh-CN');await page.locator('#key-count').selectOption('88');await closeShellPanels();
    await page.locator('#back-to-library').click();await page.locator('#lobby-home').click();await page.locator('#start-free-practice').click();
    if(await page.locator('#free-sound').getAttribute('aria-pressed')==='true')await page.locator('#free-sound').click();
    assert.equal(await page.locator('#free-practice-keys button').count(),88,'Free mode uses the explicitly configured 88-key range shared with normal mode');
    assert.equal(await page.locator('#keyboard button').count(),88);
    assert.equal(await page.locator('#free-practice-keys .white').count(),52);
    assert.equal(await page.locator('#free-practice-keys .black').count(),36);
    assert.equal(await page.locator('#free-practice-keys [data-code="KeyR"]').getAttribute('data-midi'),'60');
    assert.equal(await page.locator('#free-recordings').evaluate(node=>node.open),false);
    const layouts=[{width:1280,height:720},{width:1920,height:1080},{width:900,height:560},{width:390,height:844}];
    for(const size of layouts){
      await page.setViewportSize(size);
      await page.evaluate(async()=>{const {getAppI18n}=await import('/app-locale.js');getAppI18n(document).setLocale('zh-CN');document.querySelector('#free-practice-screen').scrollTop=0;});
      const layout=await page.evaluate(()=>{
        const rect=id=>{const r=document.querySelector(id).getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom};};
        const scroller=document.querySelector('#free-keyboard-scroll');
        return{liveDiagnostics:{copy:rect('.free-live-copy'),lane:rect('#free-live-field'),scroll:rect('#free-keyboard-scroll'),scrollLeft:scroller.scrollLeft,copyStyle:Object.fromEntries(['position','display','width','minWidth','maxWidth','left','right','fontSize','overflowWrap','transform'].map(name=>[name,getComputedStyle(document.querySelector('.free-live-copy'))[name]])),noteStyle:Object.fromEntries(['fontSize','lineHeight','letterSpacing','overflowWrap','whiteSpace','width','maxWidth'].map(name=>[name,getComputedStyle(document.querySelector('#free-live-notes'))[name]]))},stage:rect('#free-piano-stage'),keys:rect('#free-practice-keys'),white:rect('#free-practice-keys [data-midi="60"]'),black:rect('#free-practice-keys [data-midi="61"]'),next:rect('#free-practice-keys [data-midi="62"]'),controls:rect('.rhythm-free-console'),live:rect('#free-live-notes'),viewport:innerWidth,documentWidth:document.documentElement.scrollWidth,keyScrollWidth:scroller.scrollWidth,keyClientWidth:scroller.clientWidth,stageColumns:getComputedStyle(document.querySelector('#free-practice-screen')).display};
      });
      await writeFile(join(artifactDirectory,'worldmusichub-free-piano-layout-checkpoint.json'),JSON.stringify({complete:false,completed_layouts:evidence,current:{size,layout}},null,2));
      await page.screenshot({path:join(artifactDirectory,`worldmusichub-free-piano-${size.width}x${size.height}-zh-CN.png`),fullPage:true,animations:'disabled'});
      assert.ok(layout.stage.width>size.width*.88,'The piano takes the stage width instead of a dashboard column');
      assert.ok(layout.white.x<layout.black.x&&layout.black.x<layout.next.x,'The black key lies between its white neighbours');
      assert.ok(layout.black.height<layout.white.height*.7&&layout.black.width<layout.white.width*.7,'A black key has actual piano geometry');
      assert.ok(layout.white.width>=21,'Compact mode retains usable key widths and scrolls');
      assert.ok(layout.documentWidth<=size.width,'The keyboard must not widen the document');
      assert.ok(layout.live.x>=0&&layout.live.right<=size.width,'The idle/live note display remains readable on compact screens');
      if(size.width>=1280){assert.ok(layout.keys.bottom<size.height,'The full keybed is visible at desktop sizes');assert.ok(layout.keyScrollWidth<=layout.keyClientWidth+1,'Full 88-key piano fits the desktop stage');}
      else assert.ok(layout.keyScrollWidth>layout.keyClientWidth,'Compact mode has an explicit horizontal keybed scroller');
      evidence.push({size,layout});
    }
    await page.setViewportSize({width:1280,height:720});
    assert.equal(await page.locator('#free-practice-screen').getAttribute('data-state'),'idle');assert.equal(await page.locator('#free-export-draft').isDisabled(),true);
    await page.locator('#free-practice-title').focus();await page.keyboard.down('r');
    await page.waitForFunction(()=>document.querySelector('#free-practice-keys [data-midi="60"]').getAttribute('aria-pressed')==='true');assert.equal(await page.locator('#free-live-notes').textContent(),'C4');assert.equal(await page.locator('#free-practice-screen').getAttribute('data-state'),'idle');assert.equal(await page.locator('#free-export-draft').isDisabled(),true);
    await page.keyboard.up('r');await page.waitForFunction(()=>!document.querySelector('#free-practice-keys [aria-pressed="true"]'));assert.equal(await page.locator('#free-practice-screen').getAttribute('data-state'),'idle');
    await page.locator('#free-start').click();await page.locator('#free-practice-title').focus();await page.keyboard.down('r');
    await page.waitForFunction(()=>document.querySelector('#free-practice-keys [data-midi="60"]').getAttribute('aria-pressed')==='true');
    assert.equal(await page.locator('#free-live-notes').textContent(),'C4');
    const held=await page.evaluate(async()=>{
      const {getAppI18n}=await import('/app-locale.js'),i18n=getAppI18n(document),key=document.querySelector('#free-practice-keys [data-midi="60"]');
      return ['en','zh-CN'].map(locale=>{i18n.setLocale(locale);return{locale,same:document.querySelector('#free-practice-keys [data-midi="60"]')===key,pressed:key.getAttribute('aria-pressed'),state:document.querySelector('#free-practice-screen').dataset.state};});
    });
    assert.ok(held.every(row=>row.same&&row.pressed==='true'&&row.state==='recording'));
    await page.screenshot({path:join(artifactDirectory,'worldmusichub-free-piano-live-held.png'),fullPage:true,animations:'disabled'});
    await page.keyboard.up('r');
    // Real pointer hits independently playable A0 and an overlapping black key.
    await page.locator('#free-practice-keys [data-midi="21"]').click();
    await page.locator('#free-practice-keys [data-midi="61"]').click();
    await page.locator('#free-exit').click();await page.locator('#lobby-home').click();await page.locator('#start-free-practice').click();
    assert.equal(await page.locator('#free-practice-screen').getAttribute('data-state'),'paused','Returning must never resume recording');
    assert.equal(await page.locator('#free-practice-keys [aria-pressed="true"]').count(),0);
    await page.locator('#free-stop').click();
    if(!await page.locator('#free-recordings').evaluate(node=>node.open))await page.locator('#free-recordings-toggle').click();
    assert.equal(await page.locator('#free-export-draft').isVisible(),true,'Opening the real recording/history disclosure exposes draft export');
    const [download]=await Promise.all([page.waitForEvent('download'),page.locator('#free-export-draft').click()]);
    const stream=await download.createReadStream();let json='';for await(const chunk of stream)json+=chunk;
    const record=JSON.parse(json);assert.deepEqual(record.observations.events.filter(event=>event.kind==='note_on').map(event=>event.midi),[60,21,61]);
    await page.locator('#free-practice-title').focus();await page.keyboard.down('i');await page.waitForFunction(()=>document.querySelector('#free-practice-keys [data-midi="64"]').getAttribute('aria-pressed')==='true');assert.equal(await page.locator('#free-live-notes').textContent(),'E4');assert.equal(await page.locator('#free-practice-screen').getAttribute('data-state'),'stopped');await page.keyboard.up('i');await page.waitForFunction(()=>!document.querySelector('#free-practice-keys [aria-pressed="true"]'));
    const [sealedDownload]=await Promise.all([page.waitForEvent('download'),page.locator('#free-export-draft').click()]);const sealedStream=await sealedDownload.createReadStream();let sealedJson='';for await(const chunk of sealedStream)sealedJson+=chunk;assert.equal(sealedJson,json,'A fresh stopped live key preserves every byte of the sealed draft');
    await page.locator('#free-record-label').fill('自由钢琴回归');await page.locator('#free-save').click();await page.locator('#free-start:not([disabled])').waitFor();
    assert.equal(await page.locator('#free-recordings').evaluate(node=>node.open),true);
    assert.equal(await page.locator('#free-preview').isDisabled(),true,'Silent recording remains independent of audio');
    await writeFile(join(artifactDirectory,'worldmusichub-free-piano-stage.json'),JSON.stringify({evidence,held,idle_live_input:true,stopped_live_input:true,sealed_draft_unchanged:true,muted:true,actual_inputs:record.observations.events,paused_after_navigation:true},null,2));
  });
}

import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

// Registration only. The host owns its browser, Rust process and lifecycle.
// Service notifications let an already-open modal keep its focus; the existing
// picker regression separately exercises the visible Settings language control.
export async function assertLocaleRoundTrip(page, {root, message, stableText = []}) {
  const snapshots = await page.evaluate(async ({root, message, stableText}) => {
    const {getAppI18n} = await import('/app-locale.js'), i18n = getAppI18n(document);
    const surface = document.querySelector(root), selector = 'input,select,textarea,button,option,details';
    const nodes = [...surface.querySelectorAll(selector)], active = document.activeElement;
    const retained = stableText.map(selector => document.querySelector(selector));
    const state = () => nodes.map(node => ({value:node.value,checked:node.checked,disabled:node.disabled,
      open:node.open,selectionStart:node.selectionStart,selectionEnd:node.selectionEnd}));
    const before = state(), sourceText = retained.map(node => node.textContent), scroll = {top:surface.scrollTop,left:surface.scrollLeft};
    return ['zh-CN','en'].map(locale => {
      i18n.setLocale(locale);
      const current = [...surface.querySelectorAll(selector)];
      return {locale,before,after:state(),sameRoot:document.querySelector(root)===surface,
        sameNodes:current.length===nodes.length&&current.every((node,index)=>node===nodes[index]),
        sameFocus:document.activeElement===active,sameSourceNodes:retained.every((node,index)=>node===document.querySelector(stableText[index])),
        sourceText,afterSourceText:retained.map(node=>node.textContent),scroll,afterScroll:{top:surface.scrollTop,left:surface.scrollLeft},
        message:document.querySelector(message.selector).textContent,expected:i18n.t(message.key,message.params||{}),reports:i18n.getReports()};
    });
  }, {root,message,stableText});
  for (const snapshot of snapshots) {
    for (const key of ['sameRoot','sameNodes','sameFocus','sameSourceNodes']) assert.equal(snapshot[key],true,`${root} ${snapshot.locale}: ${key}`);
    assert.deepEqual(snapshot.after,snapshot.before,`${root}: language changes retain drafts, selection, confirmations and enabled states`);
    assert.deepEqual(snapshot.afterSourceText,snapshot.sourceText,`${root}: original text remains literal`);
    assert.deepEqual(snapshot.afterScroll,snapshot.scroll,`${root}: language changes preserve modal scroll`);
    assert.equal(snapshot.message,snapshot.expected);
    assert.deepEqual(snapshot.reports,[]);
  }
  assert.notEqual(snapshots[0].message,snapshots[1].message,'The runtime message changes to the requested language');
  return snapshots;
}

export function registerLocaleBrowserRegressions({test,getPage,ui,closeShellPanels,waitForEngraving,readyForTitle,exportScore,getRequests}) {
  const options = {timeout:45_000};

  test('real notation language changes retain pending export, then the exact mounted staff and source',options,async()=>{
    const page=getPage(),score=await exportScore();
    await ui('#staff-button').click();
    score.id+='-locale-notation';score.title+=' · Locale notation original';
    await ui('#score-file').setInputFiles({name:'locale-notation-original.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(score))});
    await readyForTitle(score.title);
    let release,arrived;
    const gate=new Promise(resolve=>{release=resolve;}),seen=new Promise(resolve=>{arrived=resolve;});
    const held=async route=>{arrived();await gate;await route.continue().catch(()=>{});};
    await page.route('**/api/export/musicxml',held);
    const requestStart=getRequests().length;
    try {
      await ui('#engraved-button').click();await seen;
      await page.locator('#engraving-part').focus();
      await assertLocaleRoundTrip(page,{root:'#notation-dock',message:{selector:'#engraving-status',key:'notationRuntime.preparing'}});
      assert.equal(getRequests().slice(requestStart).filter(request=>request.path==='/api/export/musicxml').length,1,'Locale changes cannot restart a pending export');
    } finally { release();await page.unroute('**/api/export/musicxml',held); }
    await waitForEngraving();
    const readyStart=getRequests().length;
    const retained=await page.evaluate(async()=>{
      const {getAppI18n}=await import('/app-locale.js'),i18n=getAppI18n(document),root=document.querySelector('#engraved-staff'),mount=root.firstElementChild;
      const svg=[...root.querySelectorAll('svg')],heads=[...root.querySelectorAll('.vf-notehead')];
      const geometry=()=>{const origin=mount.getBoundingClientRect();return heads.map(node=>{const r=node.getBoundingClientRect();return{x:r.x-origin.x,y:r.y-origin.y,width:r.width,height:r.height};});};
      const before=geometry(),markup=svg.map(node=>node.outerHTML),range=document.querySelector('#engraving-range').textContent;
      return ['zh-CN','en'].map(locale=>{
        i18n.setLocale(locale);
        return {locale,sameMount:root.firstElementChild===mount,sameSvg:root.querySelectorAll('svg').length===svg.length&&[...root.querySelectorAll('svg')].every((node,index)=>node===svg[index]),
          sameHeads:root.querySelectorAll('.vf-notehead').length===heads.length&&[...root.querySelectorAll('.vf-notehead')].every((node,index)=>node===heads[index]),headCount:heads.length,markup,afterMarkup:svg.map(node=>node.outerHTML),
          before,after:geometry(),aria:mount.getAttribute('aria-label'),status:document.querySelector('#engraving-status').textContent,
          rangeBefore:range,rangeAfter:document.querySelector('#engraving-range').textContent};
      });
    });
    for(const snapshot of retained){
      for(const key of ['sameMount','sameSvg','sameHeads'])assert.equal(snapshot[key],true,key);
      assert.ok(snapshot.headCount>0);assert.deepEqual(snapshot.afterMarkup,snapshot.markup,'Relabeling retains exact rendered musical geometry');
      for(const [index,bounds]of snapshot.after.entries())for(const key of ['x','y','width','height'])assert.ok(Math.abs(bounds[key]-snapshot.before[index][key])<1e-6,'Notehead bounds relative to the staff stay unchanged');
      assert.match(snapshot.aria,snapshot.locale==='en'?/Engraved staff, measures/:/五线谱/);
      assert.match(snapshot.status,snapshot.locale==='en'?/Generated staff preview/:/生成的五线谱预览/);
    }
    assert.equal(retained[1].rangeAfter,retained[1].rangeBefore);
    assert.deepEqual(getRequests().slice(readyStart),[],'Relabeling a ready staff makes no API request');
    assert.deepEqual(await exportScore(),score);
  });

  test('real image, numbered text and semitone review retain authored drafts and explicit confirmation across languages',options,async()=>{
    const page=getPage(),score=await exportScore();
    await ui('#jianpu-editor-button').click();
    const draft='format=worldmusichub-jianpu-text-v1\ntitle=原稿 & literal draft\n1=C4\n1:1/3 2:2/3 0 |\n';
    await page.locator('#jianpu-text').fill(draft);await page.locator('#jianpu-syntax>summary').click();
    await page.locator('#jianpu-text').focus();await page.locator('#jianpu-text').evaluate(node=>node.setSelectionRange(8,23));
    let requestStart=getRequests().length;
    await assertLocaleRoundTrip(page,{root:'#jianpu-editor',message:{selector:'#jianpu-editor-load',key:'review.jianpu.load'}});
    assert.equal(await page.locator('#jianpu-text').inputValue(),draft);assert.deepEqual(getRequests().slice(requestStart),[]);
    await page.locator('#jianpu-editor-cancel').click();

    const image=await readFile(new URL('./fixtures/omr-original-scale.png',import.meta.url));
    await ui('#score-image-file').setInputFiles({name:'原稿-fragment.png',mimeType:'image/png',buffer:image});
    await page.locator('#image-review-dialog').waitFor();await page.locator('#review-add-note').click();
    await page.getByLabel('Pitch for note 1',{exact:true}).fill('F##4');await page.getByLabel('Duration for note 1',{exact:true}).selectOption('1/3');
    await page.locator('#review-title').fill('Original 图片 fragment');await page.locator('#review-confirm').check();
    await page.getByLabel('Pitch for note 1',{exact:true}).focus();requestStart=getRequests().length;
    await assertLocaleRoundTrip(page,{root:'#image-review-dialog',message:{selector:'#review-create',key:'review.image.load'}});
    assert.equal(await page.locator('#review-confirm').isChecked(),true);assert.equal(await page.locator('#review-create').isEnabled(),true);
    assert.equal(await page.getByLabel('Pitch for note 1',{exact:true}).inputValue(),'F##4');assert.equal(await page.getByLabel('Duration for note 1',{exact:true}).inputValue(),'1/3');
    assert.deepEqual(getRequests().slice(requestStart),[],'Language changes neither recognize nor activate an image draft');
    await page.locator('#review-cancel').click();

    if(!await ui('#instrument-settings').evaluate(node=>node.open))await ui('#instrument-settings>summary').click();
    await ui('#transposition-button').click();await page.locator('#transposition-semitones').fill('2');
    const response=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/transposition/preview');
    await page.locator('#transposition-preview').click();const previewResponse=await response;assert.equal(previewResponse.status(),200);
    const preview=await previewResponse.json();await page.locator('#transposition-result').waitFor();
    assert.deepEqual(JSON.parse(preview.compilation.score.source.content).original,score);
    await page.locator('#transposition-confirm').check();await page.locator('#transposition-confirm').focus();requestStart=getRequests().length;
    await assertLocaleRoundTrip(page,{root:'#transposition-dialog',message:{selector:'#transposition-status',key:'review.pitch.previewReady'},stableText:['#transposition-result-title','#transposition-note-sample']});
    assert.equal(await page.locator('#transposition-confirm').isChecked(),true);assert.equal(await page.locator('#transposition-activate').isEnabled(),true);
    assert.deepEqual(getRequests().slice(requestStart),[],'Language changes neither regenerate nor activate an approved preview');
    await page.locator('#transposition-cancel').click();await closeShellPanels();assert.deepEqual(await exportScore(),score);
  });
}

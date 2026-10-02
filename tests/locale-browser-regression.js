import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

// CSSOM scroll extents are integer pixels; control bounds may be fractional.
// A changed offset is valid only when measured reflow or a smaller extent
// explains it. An arbitrary jump (even with focus retained) must still fail.
export function assertLocaleScrollContext(before, after, context) {
  const evidence = `${context}: ${JSON.stringify({before,after})}`;
  const clamp = (value, maximum) => Math.max(0, Math.min(value, maximum));
  const anchored = before.focus?.visible;
  if (anchored) assert.equal(after.focus?.id, before.focus.id, `Retain the reading anchor; ${evidence}`);
  for (const [axis, size, maximum] of [['top','height','maxTop'],['left','width','maxLeft']]) {
    const desiredOffset = anchored ? clamp(before.focus[axis], Math.max(0, after.viewport[size] - after.focus[size])) : null;
    const contentPosition = anchored ? after.focus[axis] + after[axis] : null;
    const expected = clamp(anchored ? contentPosition - desiredOffset : before[axis], after[maximum]);
    assert.ok(Math.abs(after[axis] - expected) <= 1, `Preserve the nearest attainable ${axis} reading position; ${evidence}`);
    assert.ok(after[axis] >= -1 && after[axis] <= after[maximum] + 1, `Stay within the real ${axis} scroll range; ${evidence}`);
  }
  if (anchored) assert.equal(after.focus.visible, true, `The focused reading control stays visible; ${evidence}`);
  if (before.focus?.fullyVisible && after.focus.height <= after.viewport.height && after.focus.width <= after.viewport.width)
    assert.equal(after.focus.fullyVisible, true, `Keep the whole focused control visible when it fits; ${evidence}`);
}

// Registration only. The host owns its browser, Rust process and lifecycle.
// Service notifications let an already-open modal keep its focus; the existing
// picker regression separately exercises the visible Settings language control.
export async function assertLocaleRoundTrip(page, {root, message, stableText = [], reviewScroll = false}) {
  const snapshots = await page.evaluate(async ({root, message, stableText, reviewScroll}) => {
    const {getAppI18n} = await import('/app-locale.js'), i18n = getAppI18n(document);
    const surface = document.querySelector(root), selector = 'input,select,textarea,button,option,details';
    const nodes = [...surface.querySelectorAll(selector)], active = document.activeElement;
    const retained = stableText.map(selector => document.querySelector(selector));
    const state = () => nodes.map(node => ({value:node.value,checked:node.checked,disabled:node.disabled,
      open:node.open,selectionStart:node.selectionStart,selectionEnd:node.selectionEnd}));
    const geometry = () => {
      const rect=surface.getBoundingClientRect(),viewport={top:rect.top+surface.clientTop,left:rect.left+surface.clientLeft,
        width:surface.clientWidth,height:surface.clientHeight};
      const bounds=active&&active!==surface&&surface.contains(active)?active.getBoundingClientRect():null;
      const focus=bounds?{id:active.id||`${active.localName}[${nodes.indexOf(active)}]`,top:bounds.top-viewport.top,left:bounds.left-viewport.left,
        width:bounds.width,height:bounds.height}:null;
      if(focus){
        focus.visible=focus.width>0&&focus.height>0&&focus.top<viewport.height&&focus.top+focus.height>0&&focus.left<viewport.width&&focus.left+focus.width>0;
        focus.fullyVisible=focus.visible&&focus.top>=-1&&focus.left>=-1&&focus.top+focus.height<=viewport.height+1&&focus.left+focus.width<=viewport.width+1;
      }
      return {top:surface.scrollTop,left:surface.scrollLeft,maxTop:Math.max(0,surface.scrollHeight-surface.clientHeight),
        maxLeft:Math.max(0,surface.scrollWidth-surface.clientWidth),viewport,focus};
    };
    const before = state(), sourceText = retained.map(node => node.textContent), snapshots=[];
    for(const locale of ['zh-CN','en']) {
      const scrollBefore=geometry();
      i18n.setLocale(locale);
      const scrollAfter=geometry();
      // These real review flows use the host's normal animation clock. Generic
      // callers retain their existing synchronous contract, including clock fixtures.
      if(reviewScroll)await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      const current = [...surface.querySelectorAll(selector)];
      snapshots.push({locale,before,after:state(),sameRoot:document.querySelector(root)===surface,
        sameNodes:current.length===nodes.length&&current.every((node,index)=>node===nodes[index]),
        sameFocus:document.activeElement===active,sameSourceNodes:retained.every((node,index)=>node===document.querySelector(stableText[index])),
        sourceText,afterSourceText:retained.map(node=>node.textContent),scrollBefore,scrollAfter,afterPaint:geometry(),
        message:document.querySelector(message.selector).textContent,expected:i18n.t(message.key,message.params||{}),reports:i18n.getReports()});
    }
    return snapshots;
  }, {root,message,stableText,reviewScroll});
  console.info('Locale reading context:',JSON.stringify({root,transitions:snapshots.map(({locale,scrollBefore,scrollAfter,afterPaint})=>({locale,scrollBefore,scrollAfter,afterPaint}))}));
  for (const snapshot of snapshots) {
    for (const key of ['sameRoot','sameNodes','sameFocus','sameSourceNodes']) assert.equal(snapshot[key],true,`${root} ${snapshot.locale}: ${key}`);
    assert.deepEqual(snapshot.after,snapshot.before,`${root}: language changes retain drafts, selection, confirmations and enabled states`);
    assert.deepEqual(snapshot.afterSourceText,snapshot.sourceText,`${root}: original text remains literal`);
    if(reviewScroll){
      assertLocaleScrollContext(snapshot.scrollBefore,snapshot.scrollAfter,`${root} ${snapshot.locale} after redraw`);
      assertLocaleScrollContext(snapshot.scrollBefore,snapshot.afterPaint,`${root} ${snapshot.locale} after paint`);
    }else{
      assert.deepEqual({top:snapshot.scrollAfter.top,left:snapshot.scrollAfter.left},{top:snapshot.scrollBefore.top,left:snapshot.scrollBefore.left},`${root}: language changes preserve modal scroll; ${JSON.stringify({before:snapshot.scrollBefore,after:snapshot.scrollAfter})}`);
    }
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
    await assertLocaleRoundTrip(page,{root:'#jianpu-editor',reviewScroll:true,message:{selector:'#jianpu-editor-load',key:'review.jianpu.load'}});
    assert.equal(await page.locator('#jianpu-text').inputValue(),draft);assert.deepEqual(getRequests().slice(requestStart),[]);
    await page.locator('#jianpu-editor-cancel').click();

    const image=await readFile(new URL('./fixtures/omr-original-scale.png',import.meta.url));
    await ui('#score-image-file').setInputFiles({name:'原稿-fragment.png',mimeType:'image/png',buffer:image});
    await page.locator('#image-review-dialog').waitFor();await page.locator('#review-add-note').click();
    await page.getByLabel('Pitch for note 1',{exact:true}).fill('F##4');await page.getByLabel('Duration for note 1',{exact:true}).selectOption('1/3');
    await page.locator('#review-title').fill('Original 图片 fragment');await page.locator('#review-confirm').check();
    await page.getByLabel('Pitch for note 1',{exact:true}).focus();requestStart=getRequests().length;
    await assertLocaleRoundTrip(page,{root:'#image-review-dialog',reviewScroll:true,message:{selector:'#review-create',key:'review.image.load'}});
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
    await assertLocaleRoundTrip(page,{root:'#transposition-dialog',reviewScroll:true,message:{selector:'#transposition-status',key:'review.pitch.previewReady'},stableText:['#transposition-result-title','#transposition-note-sample']});
    assert.equal(await page.locator('#transposition-confirm').isChecked(),true);assert.equal(await page.locator('#transposition-activate').isEnabled(),true);
    assert.deepEqual(getRequests().slice(requestStart),[],'Language changes neither regenerate nor activate an approved preview');
    await page.locator('#transposition-cancel').click();await closeShellPanels();assert.deepEqual(await exportScore(),score);
  });
}

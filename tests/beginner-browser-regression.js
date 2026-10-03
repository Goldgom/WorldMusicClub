import assert from 'node:assert/strict';
import {readFile, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {keyboardBrowserScore} from './browser-input-fixtures.js';

export async function readBeginnerHelpGeometry(page,prefix='') {
  return page.evaluate(prefix=>{
    const panel=document.getElementById(`${prefix}beginner-controls`),body=panel.querySelector('.beginner-help-body');
    const rect=node=>{const r=node.getBoundingClientRect();return{x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height};};
    const control=node=>{const r=rect(node),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return{id:node.id||node.tagName,rect:r,hit:node===hit||node.contains(hit),hitTarget:hit?.id||hit?.className||hit?.tagName||null};};
    return{prefix,viewport:{width:innerWidth,height:innerHeight},heading:rect(panel.closest('.piano-workspace-heading')),body:rect(body),open:panel.querySelector('details').open,
      controls:[...panel.querySelectorAll('summary,input,select')].filter(node=>node.getBoundingClientRect().width>0&&node.getBoundingClientRect().height>0).map(control)};
  },prefix);
}
export function assertBeginnerHelpGeometry(proof) {
  assert.equal(proof.open,true);
  assert.ok(proof.body.y>=proof.heading.bottom+3,'Expanded guide starts below the complete heading, so its opener stays uncovered');
  assert.ok(proof.body.x>=0&&proof.body.right<=proof.viewport.width+1&&proof.body.bottom<=proof.viewport.height+1,`Expanded guide stays in the viewport: ${JSON.stringify(proof)}`);
  for(const control of proof.controls)assert.equal(control.hit,true,`Open guide keeps ${control.id} clickable: ${JSON.stringify(proof)}`);
}

// Registration only: the host suite owns its already-authorized real browser,
// Rust server, fixtures and lifecycle. Importing this module launches nothing.
export function registerBeginnerBrowserRegressions({test, getPage, ui, readyForTitle, exportScore, exportTakeData, closeShellPanels, artifactDirectory}) {
  const options = {timeout:45_000};
  async function hideNotation(page) {
    await closeShellPanels();
    if(await page.locator('#notation-toggle').getAttribute('aria-expanded')==='true')await page.locator('#notation-toggle').click();
  }
  async function prepare(id) {
    const page=getPage(), score=keyboardBrowserScore(id); score.title=`Original ${id} exercise`;
    await ui('#score-file').setInputFiles({name:`${id}.json`,mimeType:'application/json',buffer:Buffer.from(JSON.stringify(score))});
    await readyForTitle(score.title); await hideNotation(page);
    return {page,score};
  }
  async function numberedMode(page, id, value) {
    const details=page.locator(`#${id.startsWith('free-') ? 'free-' : ''}beginner-controls details`);
    if(!await details.evaluate(element=>element.open))await details.locator('summary').click();
    await page.locator(`#${id}`).selectOption(value);
    await details.locator('summary').click();
  }
  async function glyph(page, selector) {
    return page.locator(selector).evaluate(key=>{
      const label=key.querySelector('.beginner-note-label');
      if(!label)throw new Error(`No beginner guide on ${key.outerHTML}`);
      return {midi:Number(key.dataset.midi ?? key.dataset.noteMidi),tone:label.querySelector('.beginner-note-tone').textContent,
        above:label.querySelector('.beginner-note-above').textContent,below:label.querySelector('.beginner-note-below').textContent,
        count:key.querySelectorAll('.beginner-note-label').length,decoratesKey:label.parentElement===key,
        pointerEvents:getComputedStyle(label).pointerEvents,ariaHidden:label.getAttribute('aria-hidden'),
        description:key.querySelector('.beginner-note-description')?.textContent,
        described:(key.getAttribute('aria-describedby')||'').split(/\s+/).includes(key.querySelector('.beginner-note-description')?.id)};
    });
  }
  function assertGlyph(actual,{midi,tone,above='',below=''}) {
    assert.deepEqual({midi:actual.midi,tone:actual.tone,above:actual.above,below:actual.below},{midi,tone,above,below});
    assert.equal(actual.count,1); assert.equal(actual.decoratesKey,true); assert.equal(actual.pointerEvents,'none');
    assert.equal(actual.ariaHidden,'true'); assert.equal(actual.described,true);
  }
  async function geometry(page, selector) {
    await page.locator(selector).scrollIntoViewIfNeeded();
    return page.locator(selector).evaluate(key=>{
      const rect=element=>{const r=element.getBoundingClientRect();return{x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height};};
      const label=key.querySelector('.beginner-note-label'), r=label.getBoundingClientRect();
      let left=Math.max(0,r.left),right=Math.min(innerWidth,r.right),top=Math.max(0,r.top),bottom=Math.min(innerHeight,r.bottom);
      for(let ancestor=label.parentElement;ancestor;ancestor=ancestor.parentElement){
        const css=getComputedStyle(ancestor),box=ancestor.getBoundingClientRect();
        if(/auto|hidden|scroll|clip/.test(css.overflowX)){left=Math.max(left,box.left);right=Math.min(right,box.right);}
        if(/auto|hidden|scroll|clip/.test(css.overflowY)){top=Math.max(top,box.top);bottom=Math.min(bottom,box.bottom);}
      }
      return {key:rect(key),label:rect(label),children:[...label.children].map(node=>({className:node.className,text:node.textContent,...rect(node)})),
        visibleFraction:Math.max(0,right-left)*Math.max(0,bottom-top)/Math.max(1,r.width*r.height),
        viewport:{width:innerWidth,height:innerHeight},documentWidth:document.documentElement.scrollWidth};
    });
  }
  async function downloadFree(page) {
    if(!await page.locator('#free-recordings').evaluate(node=>node.open))await page.locator('#free-recordings-toggle').click();
    assert.equal(await page.locator('#free-export-draft').isVisible(),true);
    const [download]=await Promise.all([page.waitForEvent('download'),page.locator('#free-export-draft').click()]);
    assert.equal(await download.failure(),null);
    return JSON.parse(await readFile(await download.path(),'utf8'));
  }
  async function artifact(name, value) {
    if(artifactDirectory)await writeFile(join(artifactDirectory,`worldmusichub-${name}.json`),JSON.stringify(value,null,2));
  }
  async function resizeStage(page, viewport, name) {
    // setViewportSize acknowledges the emulation command, not a rendered frame.
    // CSS may already use the new size before MediaQueryList change handlers
    // have moved the guide/footer. The rendering algorithm delivers those
    // events before animation-frame callbacks; inspect exactly that first
    // frame, rather than polling until geometry happens to satisfy the test.
    // https://html.spec.whatwg.org/multipage/webappapis.html#update-the-rendering
    await page.evaluate(()=>{
      const media=matchMedia('(max-height:600px) and (min-width:651px)'),samples=[];
      const sample=phase=>{
        const panel=document.querySelector('#beginner-controls'),reference=document.querySelector('#beginner-reference');
        samples.push({phase,time:performance.now(),width:innerWidth,height:innerHeight,compact:media.matches,
          guideCompact:panel.classList.contains('beginner-controls-compact'),guideParent:panel.parentElement.className,
          referenceInHelp:reference.parentElement===panel.querySelector('.beginner-help-body'),
          footerInSettings:Boolean(document.querySelector('.keyboard-input-footer').closest('#keyboard-input-settings')),
          statusHidden:document.querySelector('#keyboard-compact-status').hidden,
          notationOverlay:document.querySelector('#workspace').classList.contains('notation-on-lanes'),
          notationCompact:document.querySelector('#notation-dock .notation-panel').classList.contains('short-notation')});
      };
      const resized=()=>sample('resize'),changed=()=>sample('media-change');
      addEventListener('resize',resized);media.addEventListener('change',changed);sample('before');
      window.beginnerResizeObservation={samples,sample,stop(){removeEventListener('resize',resized);media.removeEventListener('change',changed);}};
    });
    try {
      await page.setViewportSize(viewport);
      const samples=await page.evaluate(()=>{
        const observation=window.beginnerResizeObservation;observation.sample('protocol-complete');
        return new Promise((resolve,reject)=>{
          const timeout=setTimeout(()=>{cancelAnimationFrame(frame);reject(new Error(`No resize frame within 2000ms: ${JSON.stringify(observation.samples)}`));},2000);
          const frame=requestAnimationFrame(()=>{clearTimeout(timeout);observation.sample('first-frame');resolve(observation.samples);});
        });
      });
      await artifact(name,{requested:viewport,samples});
      const before=samples[0],settled=samples.at(-1),compact=viewport.height<=600&&viewport.width>=651,guideCompact=viewport.height<=800||viewport.width<=650;
      assert.deepEqual({width:settled.width,height:settled.height},viewport,JSON.stringify(samples));
      assert.deepEqual({compact:settled.compact,guide:settled.guideCompact,reference:settled.referenceInHelp,footer:settled.footerInSettings,statusHidden:settled.statusHidden,notation:settled.notationCompact},
        {compact,guide:guideCompact,reference:guideCompact,footer:compact,statusHidden:!compact,notation:compact||settled.notationOverlay},`All responsive handlers finish before the first rendered frame: ${JSON.stringify(samples)}`);
      assert.equal(settled.guideParent,guideCompact?'stage-heading':'play-panel panel',JSON.stringify(samples));
      assert.equal(samples.filter(sample=>sample.phase==='media-change').length,Number(before.compact!==compact),`Observe the actual breakpoint notification: ${JSON.stringify(samples)}`);
      return samples;
    } finally {
      await page.evaluate(()=>{window.beginnerResizeObservation.stop();delete window.beginnerResizeObservation;});
    }
  }
  async function compactStageGeometry(page) {
    return page.evaluate(()=>{
      const rect=element=>{const r=element.getBoundingClientRect();return{x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height};};
      const control=selector=>{const element=document.querySelector(selector),r=rect(element),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return{selector,...r,reachable:element===hit||element.contains(hit),hitTarget:hit?.id||hit?.className||hit?.tagName||null};};
      const canvas=document.querySelector('#falling-notes'),r=canvas.getBoundingClientRect();let top=Math.max(0,r.top),bottom=Math.min(innerHeight,r.bottom),left=Math.max(0,r.left),right=Math.min(innerWidth,r.right);
      for(let ancestor=canvas.parentElement;ancestor;ancestor=ancestor.parentElement){const css=getComputedStyle(ancestor),box=ancestor.getBoundingClientRect();if(/auto|hidden|scroll|clip/.test(css.overflowY)){top=Math.max(top,box.top+ancestor.clientTop);bottom=Math.min(bottom,box.top+ancestor.clientTop+ancestor.clientHeight);}if(/auto|hidden|scroll|clip/.test(css.overflowX)){left=Math.max(left,box.left+ancestor.clientLeft);right=Math.min(right,box.left+ancestor.clientLeft+ancestor.clientWidth);}}
      const notice=document.querySelector('#notice'),controls=['#beginner-enabled','#beginner-controls summary','#keyboard-compact-status','#reset-button','#play-button','#sound-button'];if(!notice.hidden)controls.push('#notice-dismiss');
      return{viewport:{width:innerWidth,height:innerHeight},document:{width:document.documentElement.scrollWidth,height:document.documentElement.scrollHeight},canvas:{...rect(canvas),visibleHeight:Math.max(0,bottom-top),visibleWidth:Math.max(0,right-left)},keybed:rect(document.querySelector('#keyboard')),stage:rect(document.querySelector('#workspace')),heading:rect(document.querySelector('.stage-hud')),notice:notice.hidden?null:rect(notice),transport:rect(document.querySelector('.piano-compact-transport')),play:rect(document.querySelector('.play-panel')),overlay:rect(document.querySelector('#notation-lane-overlay')),overlayInLane:Boolean(document.querySelector('#notation-lane-overlay').closest('.piano-lanes-shared')),panControls:document.querySelector('.keyboard-pan').hidden?[]:['#keyboard-pan-left','#keyboard-pan-right'].map(control),controls:controls.map(control),stagePanel:document.querySelector('#beginner-controls').parentElement.className,range:document.querySelector('#keyboard-compact-status').textContent};
    });
  }
  function assertCompactStage(layout) {
    assert.ok(layout.document.width<=layout.viewport.width+1&&layout.document.height<=layout.viewport.height+1,JSON.stringify(layout));
    assert.ok(layout.canvas.visibleHeight>=100&&layout.canvas.visibleWidth>=250,`The existing falling-note acceptance remains unchanged: ${JSON.stringify(layout)}`);
    assert.ok(layout.keybed.height>=70);assert.equal(layout.overlayInLane,true);assert.ok(Math.min(layout.overlay.right,layout.canvas.right)-Math.max(layout.overlay.x,layout.canvas.x)>=250&&Math.min(layout.overlay.bottom,layout.canvas.bottom)-Math.max(layout.overlay.y,layout.canvas.y)>=100,'Notation occupies the actual falling-lane background');
    for(const control of [...layout.controls,...layout.panControls])assert.ok(control.width>0&&control.height>0&&control.x>=0&&control.y>=0&&control.right<=layout.viewport.width+1&&control.bottom<=layout.viewport.height+1&&control.reachable,`Compact control remains visible and clickable: ${JSON.stringify(control)}`);
    for(const control of layout.panControls)assert.ok(control.width>=40&&control.height>=34,`Compact panning retains its full arrow target: ${JSON.stringify(control)}`);
    if(layout.notice)assert.ok(layout.controls.find(control=>control.selector==='#notice-dismiss').height>=34,'Compact notices keep their existing dismissal target');
    assert.equal(layout.stagePanel,'stage-heading');assert.match(layout.range,/C2.*A♯5/);
  }

  test('real initial compact guide stays on stage through tall and short resizes without losing held input or playfield space',{timeout:60_000},async()=>{
    const page=getPage();await page.setViewportSize({width:844,height:390});await page.reload();
    await page.locator('#home-single-player').click();await page.locator('#start-listen:not([disabled])').waitFor();
    const {score}=await prepare('beginner-initial-compact');
    assert.equal(await page.locator('#beginner-enabled').isChecked(),false);
    assert.equal(await page.locator('#beginner-controls').evaluate(element=>element.closest('dialog')),null);
    await ui('#session-mode').selectOption('practice');await ui('#count-in').uncheck();await closeShellPanels();
    await page.locator('#notation-toggle').click();await page.waitForFunction(()=>document.querySelector('#engraved-staff svg .vf-notehead path'));
    const off=await compactStageGeometry(page);assertCompactStage(off);
    await page.locator('#play-button:not([disabled])').click();await page.locator('#stage-title').click();await page.keyboard.down('r');
    await page.waitForFunction(()=>document.querySelector('#keyboard [data-midi="60"]').getAttribute('aria-pressed')==='true');
    await page.evaluate(()=>{window.beginnerResponsiveNodes=Object.fromEntries(['beginner-controls','beginner-enabled','beginner-reference','keyboard-compact-status','keyboard-map'].map(id=>[id,document.getElementById(id)]));});
    await page.locator('#beginner-enabled').check();
    const on=await compactStageGeometry(page);assertCompactStage(on);
    const layouts=[],resizes=[];
    for(const viewport of [{width:1440,height:900},{width:844,height:390},{width:1280,height:720},{width:844,height:390}]){
      resizes.push(await resizeStage(page,viewport,`beginner-resize-${resizes.length+1}-${viewport.width}x${viewport.height}`));
      const state=await page.evaluate(()=>({same:Object.entries(window.beginnerResponsiveNodes).every(([id,node])=>document.getElementById(id)===node),held:document.querySelector('#keyboard [data-midi="60"]').getAttribute('aria-pressed'),mapHeld:document.querySelector('#keyboard-map [data-code="KeyR"]').classList.contains('held'),inDialog:Boolean(document.querySelector('#beginner-controls').closest('dialog')),unique:['beginner-enabled','beginner-reference','keyboard-compact-status'].every(id=>document.querySelectorAll(`#${id}`).length===1)}));
      assert.deepEqual(state,{same:true,held:'true',mapHeld:true,inDialog:false,unique:true});
      assert.equal(await page.locator('#beginner-enabled').isVisible(),true);
      if(viewport.height<600){const layout=await compactStageGeometry(page);assertCompactStage(layout);layouts.push(layout);}
    }
    const help=page.locator('#beginner-controls details'),helpCycles=[];
    for(let cycle=0;cycle<2;cycle++){
      await help.locator('summary').click();
      assert.equal(await page.locator('#beginner-help').isVisible(),true);assert.equal(await page.locator('#beginner-numbered-mode').isVisible(),true);assert.equal(await page.locator('#beginner-reference').isVisible(),true);
      const proof=await readBeginnerHelpGeometry(page);helpCycles.push(proof);await artifact('live-beginner-initial-compact-help',{helpCycles});assertBeginnerHelpGeometry(proof);
      if(cycle===0&&artifactDirectory)await page.screenshot({path:join(artifactDirectory,'worldmusichub-beginner-initial-compact-help.png'),fullPage:false,animations:'disabled'});
      await help.locator('summary').click();assert.equal(await help.evaluate(node=>node.open),false);assert.equal(await page.locator('#beginner-help').isVisible(),false);
    }
    await page.locator('#beginner-enabled').uncheck();await page.locator('#beginner-enabled').check();
    assert.equal(await page.locator('#keyboard [data-midi="60"]').getAttribute('aria-pressed'),'true');
    await page.keyboard.up('r');await page.locator('#play-button').click();
    const take=await exportTakeData();assert.deepEqual(take.passes.at(-1).inputs.map(input=>input.midi),[60]);
    assert.deepEqual(take.input_evidence.events.filter(event=>['note_on','note_off','synthetic_release'].includes(event.kind)).map(event=>event.kind),['note_on','note_off']);
    assert.deepEqual(await exportScore(),score);
    await artifact('beginner-initial-compact',{off,on,layouts,resizes,helpCycles,score_preserved:true,contacts:['note_on','note_off']});
  });

  test('real compact 88-key and custom extreme guides retain every octave dot beside the unchanged falling-note field',{timeout:60_000},async()=>{
    const {page,score}=await prepare('beginner-compact-extremes');
    score.keys[0].fifths=5;score.title='Original compact B-major extreme guide';
    await ui('#score-file').setInputFiles({name:'beginner-extremes.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(score))});await readyForTitle(score.title);await hideNotation(page);
    await page.setViewportSize({width:844,height:390});
    await page.locator('#beginner-enabled').check();await page.locator('#notation-toggle').click();
    await page.waitForFunction(()=>document.querySelector('#engraved-staff svg .vf-notehead path'));
    const cases=[];
    for(const configuration of [{count:'88',midis:[21,22,60,61,108]},{count:'custom',midis:[0,1,60,61,126,127]}]){
      await ui('#key-count').selectOption(configuration.count);
      if(configuration.count==='custom'){
        if(!await ui('#instrument-settings').evaluate(element=>element.open))await ui('#instrument-settings>summary').click();
        await ui('#custom-key-count').fill('128');await ui('#custom-lowest').fill('C-1');await ui('#instrument-apply').click();
      }
      await page.waitForFunction(midi=>Boolean(document.querySelector(`#keyboard [data-midi="${midi}"] .beginner-note-label`)),configuration.midis.at(-1));await closeShellPanels();
      const layout=await compactStageGeometry(page);await artifact(`live-beginner-compact-extremes-${configuration.count}`,{configuration,layout});assertCompactStage(layout);assert.equal(layout.panControls.length,2,'Every wide keyboard keeps both visible pan arrows');const labels=[];
      for(const midi of configuration.midis){
        const selector=`#keyboard [data-midi="${midi}"]`,actual=await glyph(page,selector),octave=Math.floor(midi/12)-5;
        assertGlyph(actual,{midi,tone:['1','♯1','2','♯2','3','4','♯4','5','♯5','6','♯6','7'][midi%12],above:'•\n'.repeat(Math.max(0,octave)).trim(),below:'•\n'.repeat(Math.max(0,-octave)).trim()});
        const visible=await geometry(page,selector);assert.ok(visible.visibleFraction>=.98,JSON.stringify({midi,visible}));
        assert.ok(visible.label.y>=visible.key.y-.5&&visible.label.bottom<=visible.key.bottom+.5,'The entire numbered pitch fits inside its actual playable key');
        const overlap=await page.locator(selector).evaluate(key=>{const label=key.querySelector('.beginner-note-label').getBoundingClientRect();return [...key.querySelectorAll('.key-shortcut,.piano-finger-label')].filter(node=>node.textContent).map(node=>{const r=node.getBoundingClientRect();return{kind:node.className,area:Math.max(0,Math.min(label.right,r.right)-Math.max(label.left,r.left))*Math.max(0,Math.min(label.bottom,r.bottom)-Math.max(label.top,r.top))};});});
        assert.ok(overlap.every(item=>item.area<1),`Pitch and existing input/fingering labels have separate space: ${JSON.stringify({midi,overlap})}`);labels.push({midi,...visible});
      }
      cases.push({configuration,layout,labels});
    }
    await numberedMode(page,'beginner-numbered-mode','movable');
    assertGlyph(await glyph(page,'#keyboard [data-midi="1"]'),{midi:1,tone:'2',below:'•\n•\n•\n•\n•\n•'});
    const sixDots=await geometry(page,'#keyboard [data-midi="1"]');
    assert.ok(sixDots.visibleFraction>=.98&&sixDots.label.y>=sixDots.key.y-.5&&sixDots.label.bottom<=sixDots.key.bottom+.5,`All six lower-octave dots fit in a black key: ${JSON.stringify(sixDots)}`);
    assertCompactStage(await compactStageGeometry(page));cases.push({reference:'B4',sixDots});
    assert.deepEqual(await exportScore(),score);await artifact('beginner-compact-extremes',{cases,score_preserved:true});
  });

  test('real beginner guide preserves held input, source and take while desktop and mobile octave labels remain visible',options,async()=>{
    const {page,score}=await prepare('beginner-visible-keys');
    assert.equal(await page.locator('#beginner-enabled').isChecked(),false);
    assert.equal(await page.locator('.beginner-note-label').count(),0);
    assert.equal(await page.locator('#beginner-controls').isVisible(),true);
    await ui('#session-mode').selectOption('practice'); await ui('#count-in').uncheck(); await closeShellPanels();
    await page.locator('#play-button:not([disabled])').click(); await page.locator('#stage-title').click(); await page.keyboard.down('r');
    await page.waitForFunction(()=>document.querySelector('#keyboard [data-midi="60"]').getAttribute('aria-pressed')==='true');
    await page.evaluate(()=>{window.beginnerHeldNodes={key:document.querySelector('#keyboard [data-midi="60"]'),map:document.querySelector('#keyboard-map [data-code="KeyR"]')};});
    await page.locator('#beginner-enabled').check();
    assert.equal(await page.locator('#keyboard [data-midi="60"]').getAttribute('aria-pressed'),'true','Visible opt-in does not synthesize a release');
    const localized=await page.evaluate(async()=>{
      const {getAppI18n}=await import('/app-locale.js'),i18n=getAppI18n(document),{key,map}=window.beginnerHeldNodes;
      const label=key.querySelector('.beginner-note-label'),mapLabel=map.querySelector('.beginner-note-label');
      return ['zh-CN','en'].map(locale=>{i18n.setLocale(locale);return{locale,sameKey:document.querySelector('#keyboard [data-midi="60"]')===key,sameMap:document.querySelector('#keyboard-map [data-code="KeyR"]')===map,sameLabel:key.querySelector('.beginner-note-label')===label,sameMapLabel:map.querySelector('.beginner-note-label')===mapLabel,held:key.getAttribute('aria-pressed'),mapHeld:map.classList.contains('held'),description:key.querySelector('.beginner-note-description').textContent};});
    });
    for(const snapshot of localized){for(const property of ['sameKey','sameMap','sameLabel','sameMapLabel','mapHeld'])assert.equal(snapshot[property],true);assert.equal(snapshot.held,'true');assert.match(snapshot.description,snapshot.locale==='en'?/Numbered pitch/:/简谱/);}
    await page.locator('#beginner-enabled').uncheck(); await page.locator('#beginner-enabled').check();
    assert.equal(await page.locator('#keyboard [data-midi="60"]').getAttribute('aria-pressed'),'true');
    await page.keyboard.up('r'); await page.locator('#play-button').click();
    const take=await exportTakeData();
    assert.deepEqual(take.passes.at(-1).inputs.map(input=>input.midi),[60]);
    const contacts=take.input_evidence.events.filter(event=>['note_on','note_off','synthetic_release'].includes(event.kind));
    assert.deepEqual(contacts.map(event=>event.kind),['note_on','note_off']);
    const evidence=[];
    for(const viewport of [{width:1440,height:900},{width:390,height:844},{width:844,height:390}]){
      await page.setViewportSize(viewport); await hideNotation(page);
      await page.locator('#beginner-enabled').scrollIntoViewIfNeeded(); assert.equal(await page.locator('#beginner-enabled').isVisible(),true);
      assert.match(await page.locator('#beginner-reference').textContent(),/1 = C4/);
      const labels=[];
      for(const expected of [{midi:48,tone:'1',below:'•'},{midi:60,tone:'1'},{midi:61,tone:'♯1'},{midi:72,tone:'1',above:'•'}]){
        const selector=`#keyboard [data-midi="${expected.midi}"]`;
        assertGlyph(await glyph(page,selector),expected);
        const layout=await geometry(page,selector);
        assert.ok(layout.label.width>=5&&layout.label.height>=10&&layout.visibleFraction>=.98,`The complete numbered pitch is visible: ${JSON.stringify({viewport,expected,layout})}`);
        const [above,tone,below]=layout.children;
        assert.ok(above.bottom<=tone.y+.5&&tone.bottom<=below.y+.5,'Octave dots have separate vertical positions');
        assert.ok(layout.documentWidth<=viewport.width+1,'Beginner guide does not introduce document-wide horizontal scrolling');
        labels.push({expected,layout});
      }
      await page.locator('#keyboard [data-midi="60"]').scrollIntoViewIfNeeded();
      if(artifactDirectory){
        await page.screenshot({path:join(artifactDirectory,`worldmusichub-beginner-${viewport.width}x${viewport.height}.png`),fullPage:true});
        if(viewport.width!==390){
          await page.evaluate(async()=>{const {getAppI18n}=await import('/app-locale.js');getAppI18n(document).setLocale('zh-CN');});
          try {
            assert.equal(await page.locator('html').getAttribute('lang'),'zh-CN');assert.match(await page.locator('#beginner-enabled').locator('..').getAttribute('title'),/简谱/);
            await page.screenshot({path:join(artifactDirectory,`worldmusichub-beginner-zh-CN-${viewport.width}x${viewport.height}.png`),fullPage:true});
          } finally {await page.evaluate(async()=>{const {getAppI18n}=await import('/app-locale.js');getAppI18n(document).setLocale('en');});}
        }
      }
      evidence.push({viewport,labels});
    }
    assert.deepEqual(await exportTakeData(),take,'Responsive display and octave guides preserve the paused recording');
    assert.deepEqual(await exportScore(),score);
    await artifact('beginner-layout',{localized,evidence,score_preserved:true,take_preserved:true});
  });

  test('real Rust score transposition changes movable context separately from the already shifted physical keyboard',options,async()=>{
    const {page,score}=await prepare('beginner-separate-transposes');
    await page.locator('#beginner-enabled').check();
    await numberedMode(page,'beginner-numbered-mode','movable');
    await page.locator('#keyboard-semitone-up').click();
    assertGlyph(await glyph(page,'#keyboard-map [data-code="KeyR"]'),{midi:61,tone:'♯1'});
    assertGlyph(await glyph(page,'#keyboard [data-midi="60"]'),{midi:60,tone:'1'});
    const before=await exportScore(); assert.deepEqual(before,score);
    if(!await ui('#instrument-settings').evaluate(element=>element.open))await ui('#instrument-settings>summary').click();
    await ui('#transposition-button').click(); await ui('#transposition-semitones').fill('2');
    const [response]=await Promise.all([page.waitForResponse(response=>new URL(response.url()).pathname==='/api/transposition/preview'),ui('#transposition-preview').click()]);
    assert.equal(response.status(),200); const preview=await response.json();
    await ui('#transposition-result').waitFor(); await ui('#transposition-confirm').check(); await ui('#transposition-activate').click();
    await ui('#transposition-dialog').waitFor({state:'hidden'}); await readyForTitle(preview.compilation.score.title); await hideNotation(page);
    assert.match(await page.locator('#beginner-reference').textContent(),/Movable major.*1 = D4/);
    assertGlyph(await glyph(page,'#keyboard [data-midi="62"]'),{midi:62,tone:'1'});
    assertGlyph(await glyph(page,'#keyboard [data-midi="60"]'),{midi:60,tone:'♯6',below:'•'});
    assertGlyph(await glyph(page,'#keyboard-map [data-code="KeyR"]'),{midi:61,tone:'7',below:'•'});
    const copy=await exportScore(); assert.deepEqual(copy,preview.compilation.score); assert.deepEqual(JSON.parse(copy.source.content).original,score);
    await closeShellPanels(); await page.locator('#back-to-library').click(); await page.locator('#lobby-home').click(); await page.locator('#start-free-practice').click();
    assert.equal(await page.locator('#free-beginner-enabled').isChecked(),true);
    assert.equal(await page.locator('#free-beginner-numbered-mode').inputValue(),'movable');
    assert.match(await page.locator('#free-beginner-reference').textContent(),/No score key.*C4/);
    assertGlyph(await glyph(page,'#free-practice-keys [data-code="KeyR"]'),{midi:61,tone:'♯1'});
    await numberedMode(page,'free-beginner-numbered-mode','fixed');
    assert.equal(await page.locator('#jianpu-reference').inputValue(),'fixed');
    assert.equal(await page.locator('#beginner-numbered-mode').inputValue(),'fixed');
    await artifact('beginner-transposition',{original:score,copy,input_midi:61,score_tonic:'D4',free_reference:'C4'});
  });

  test('real free guide keeps held keys and immutable records, and guitar guide uses actual capo pitches',options,async()=>{
    const {page,score}=await prepare('beginner-free-and-guitar');
    await closeShellPanels(); await page.locator('#back-to-library').click(); await page.locator('#lobby-home').click(); await page.locator('#start-free-practice').click();
    if(await page.locator('#free-sound').getAttribute('aria-pressed')==='true')await page.locator('#free-sound').click();
    await page.locator('#free-start').click(); await page.locator('#free-practice-title').focus(); await page.keyboard.down('r');
    await page.locator('#free-beginner-enabled').check();
    assert.equal(await page.locator('#free-practice-keys [data-code="KeyR"]').evaluate(key=>key.classList.contains('held')),true);
    assertGlyph(await glyph(page,'#free-practice-keys [data-code="KeyR"]'),{midi:60,tone:'1'});
    const identity=await page.evaluate(async()=>{
      const {getAppI18n}=await import('/app-locale.js'),i18n=getAppI18n(document),key=document.querySelector('#free-practice-keys [data-code="KeyR"]'),label=key.querySelector('.beginner-note-label'),legend=key.querySelector('kbd');
      return ['zh-CN','en'].map(locale=>{i18n.setLocale(locale);return{locale,key:document.querySelector('#free-practice-keys [data-code="KeyR"]')===key,label:key.querySelector('.beginner-note-label')===label,legend:key.querySelector('kbd')===legend,held:key.classList.contains('held')};});
    });
    for(const snapshot of identity)for(const property of ['key','label','legend','held'])assert.equal(snapshot[property],true);
    await page.keyboard.up('r'); await page.locator('#free-stop').click();
    const record=await downloadFree(page);
    assert.equal(record.score_context,null);assert.deepEqual(record.observations.events.filter(event=>['note_on','note_off','synthetic_release'].includes(event.kind)).map(event=>event.kind),['note_on','note_off']);
    assert.equal(record.configuration.filter(row=>row.key==='keyboard_configuration').length,1);
    await page.locator('#free-beginner-enabled').uncheck();await page.locator('#free-beginner-enabled').check();
    assert.deepEqual(await downloadFree(page),record);
    await page.locator('#free-exit').click();await page.locator('#resume-session').click();
    await ui('#instrument').selectOption('guitar');
    if(!await ui('#instrument-settings').evaluate(element=>element.open))await ui('#instrument-settings>summary').click();
    await ui('#guitar-capo').fill('2');await ui('#instrument-apply').click();
    await page.waitForFunction(()=>document.querySelector('#fretboard [data-string="0"][data-fret="0"]')?.dataset.midi==='66');await closeShellPanels();
    assertGlyph(await glyph(page,'#fretboard [data-string="0"][data-fret="0"]'),{midi:66,tone:'♯4'});
    const fretLayout=await geometry(page,'#fretboard [data-string="0"][data-fret="0"]');
    assert.ok(fretLayout.visibleFraction>=.98,'The capo fret guide is visible inside its actual playable button');
    assert.deepEqual(await exportScore(),score);
    await artifact('beginner-free-and-guitar',{identity,record,fretLayout,score_preserved:true});
  });

  test('real beginner movable reference follows the Rust measure occurrence and explains an interior key-change fallback',options,async()=>{
    const {page,score}=await prepare('beginner-current-key-context');
    score.title='Original beginner measure-key changes';
    score.keys.push({at:{numerator:4,denominator:1},fifths:1,mode:'major'});
    await ui('#score-file').setInputFiles({name:'beginner-measure-keys.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(score))});
    await readyForTitle(score.title);await hideNotation(page);
    await page.locator('#beginner-enabled').check();await numberedMode(page,'beginner-numbered-mode','movable');
    await page.waitForFunction(()=>/Movable major.*1 = C4/.test(document.querySelector('#beginner-reference').textContent));
    assertGlyph(await glyph(page,'#keyboard [data-midi="60"]'),{midi:60,tone:'1'});
    await ui('#count-in').uncheck();await closeShellPanels();await page.locator('#play-button:not([disabled])').click();
    await page.waitForFunction(()=>/Movable major.*1 = G4/.test(document.querySelector('#beginner-reference').textContent),null,{timeout:10_000});
    await page.locator('#play-button').click();
    assertGlyph(await glyph(page,'#keyboard [data-midi="67"]'),{midi:67,tone:'1'});
    assertGlyph(await glyph(page,'#keyboard [data-midi="60"]'),{midi:60,tone:'4',below:'•'});
    const currentPosition=await page.locator('#progress').evaluate(element=>Number(element.value));
    assert.ok(currentPosition>=4000,'The live guide uses the current written occurrence instead of the notation page start');
    assert.deepEqual(await exportScore(),score);
    const interior=structuredClone(score);interior.id='beginner-interior-change';interior.title='Original beginner interior key change';
    interior.keys[1].at={numerator:3,denominator:2};
    await ui('#score-file').setInputFiles({name:'beginner-interior-key.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(interior))});
    await readyForTitle(interior.title);await hideNotation(page);
    await page.waitForFunction(()=>/not resolved.*fixed C.*C4/i.test(document.querySelector('#beginner-reference').textContent));
    assertGlyph(await glyph(page,'#keyboard [data-midi="60"]'),{midi:60,tone:'1'});
    assert.deepEqual(await exportScore(),interior);
    await artifact('beginner-current-key-context',{current_position_ms:currentPosition,proven_reference:'G4',interior_change_reference:'explicit fixed C fallback',source_preserved:true});
  });
}

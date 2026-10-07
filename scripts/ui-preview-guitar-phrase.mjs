import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {isDeepStrictEqual} from 'node:util';
import {readPlaybackClock,waitForPlaybackClockAdvance} from '../tests/browser-playback-clock.js';
import {browserMarkerVisibility} from '../tests/browser-marker-visibility.js';
import {originalGuitarPhraseStudy,GUITAR_PHRASE_SCOPE,GUITAR_PHRASE_OLD_SCOPE,GUITAR_PHRASE_LOCKS} from '../tests/guitar-phrase-fixture.js';
import {GUITAR_PHRASE_BROWSER_CASE,GUITAR_PHRASE_REPORT,GUITAR_PHRASE_RACES,assertGuitarPhraseReport,assertPhraseCompilation,assertPhraseExchange,assertPhraseUi} from '../tests/guitar-phrase-browser-proof.js';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const beatText=beat=>`${beat.numerator}${beat.denominator===1?'':'/'+beat.denominator}`;
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});promise.catch(()=>{});return{promise,resolve,reject};};
async function bounded(promise,label){let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Timed out awaiting '+label)),12_000);})]);}finally{clearTimeout(timer);}}

// Registered in the real app suite so bootstrap, ordinary trusted gestures,
// browser errors, Rust server lifetime and downloads use its existing contract.
// No controller/test-state injection and no fabricated server responses.
export function registerGuitarPhraseBrowserRegression({test,getPage,ui,configureStageMod,setSessionMode,hideNotation,readyForTitle,closeShellPanels,exportTakeData,exportScore,getRequests,artifactDirectory,binary}) {
  test(GUITAR_PHRASE_BROWSER_CASE,{timeout:180_000},async()=>{
    const page=getPage(),score=originalGuitarPhraseStudy(),report={version:1,scenario:'guitar-written-phrase',ok:false,original_fixtures_only:true,physical_midi_verified:false,physical_fingering_verified:false,global_optimum_claimed:false,accepted_package:false,windows_native_verified:false,races:[],screenshots:[]};
    const git=(...args)=>execFileSync('git',args,{encoding:'utf8'}).trim();
    report.source={sha:git('rev-parse','HEAD'),tree:git('rev-parse','HEAD^{tree}'),server_sha256:hash(await readFile(binary))};
    if(process.env.WMH_SOURCE_SHA){assert.equal(report.source.sha,process.env.WMH_SOURCE_SHA);assert.equal(git('status','--porcelain','--untracked-files=normal'),'','Hosted proof starts from exact clean source');}
    const write=()=>writeFile(join(artifactDirectory,GUITAR_PHRASE_REPORT),JSON.stringify(report,null,2));
    const watch=(predicate=()=>true)=>page.waitForResponse(response=>new URL(response.url()).pathname==='/api/fingering/guitar'&&response.request().method()==='POST'&&predicate(response.request().postDataJSON()),{timeout:12_000});
    const pair=(scope=GUITAR_PHRASE_SCOPE)=>[watch(body=>body.inventory_only===true&&isDeepStrictEqual(body.planning_scope,scope)),watch(body=>!body.inventory_only&&isDeepStrictEqual(body.planning_scope,scope))];
    const exchange=async response=>({path:new URL(response.url()).pathname,httpStatus:response.status(),request:response.request().postDataJSON(),plan:await response.json()});
    async function observe(){return page.evaluate(()=>{
      const node=id=>document.getElementById(id),text=id=>node(id).textContent;
      return {status:node('guitar-planning').dataset.status,instrument:node('instrument').value,mode:node('session-mode').value,firstPart:node('practice-part').value,
        from:node('guitar-phrase-from').value,to:node('guitar-phrase-to').value,phraseMode:node('guitar-phrase-mode').value,phraseStatus:text('guitar-phrase-status'),scope:text('guitar-selected-parts'),lockStatus:text('guitar-lock-count'),lockList:text('guitar-lock-list'),
        lockSources:[...node('guitar-lock-source').options].map(option=>option.value),recommendedCount:document.querySelectorAll('#fretboard [data-recommended="true"]').length,
        cards:[...document.querySelectorAll('.guitar-target')].map(card=>({occurrenceIds:JSON.parse(card.dataset.occurrenceIds),sourceIds:JSON.parse(card.dataset.sourceIds),route:JSON.parse(card.dataset.route)})),
        liveAssignments:[...document.querySelectorAll('.guitar-live-choice')].flatMap(node=>JSON.parse(node.dataset.assignments)),
      };
    });}
    async function ready(plan=null){await page.waitForFunction(plan=>{
      if(document.querySelector('#guitar-planning').dataset.status!=='ready')return false;
      if(!plan)return true;
      // Source/Mod invalidation completes lazily on the regular drawing loop.
      // A planning-panel status alone can precede its accepted visible route.
      const live=[...document.querySelectorAll('.guitar-live-choice')].flatMap(node=>JSON.parse(node.dataset.assignments));
      return live.length>0&&live.every(choice=>JSON.stringify(choice)===JSON.stringify(plan.assignments.find(expected=>expected.occurrence_id===choice.occurrence_id)));
    },plan);}
    async function controls(){await closeShellPanels();if(!await page.locator('#guitar-plan-controls').evaluate(node=>node.open))await page.locator('#guitar-plan-controls>summary').click();}
    async function draft(scope){await controls();await page.locator('#guitar-phrase-mode').selectOption('explicit');await page.locator('#guitar-phrase-from').fill(beatText(scope.from));await page.locator('#guitar-phrase-to').fill(beatText(scope.to));}
    async function importScore(value){
      const response=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/compile'&&isDeepStrictEqual(response.request().postDataJSON(),value));
      await ui('#score-file').setInputFiles({name:value.id+'.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(value))});
      const compiled=await (await response).json();assertPhraseCompilation(compiled,value);await readyForTitle(value.title);await hideNotation();return compiled;
    }
    async function snapshot(){
      const take=await exportTakeData(),canonical=await exportScore();await closeShellPanels();
      return {take,score:canonical,clock:await page.locator('#progress').evaluate(readPlaybackClock),loop:await page.locator('#loop-from,#loop-to,#loop-enabled').evaluateAll(nodes=>nodes.map(node=>({id:node.id,value:node.value,checked:node.checked}))),assessment:await page.locator('.performance-status').evaluate(node=>({pass:node.dataset.passId,revision:node.dataset.revision,captured:document.querySelector('#hud-captured').textContent,feedback:document.querySelector('#feedback-results').textContent}))};
    }
    async function picture(name,selector='#guitar-phrase-status'){await page.locator(selector).scrollIntoViewIfNeeded();const bytes=await page.screenshot({path:join(artifactDirectory,name),fullPage:false,animations:'disabled'});report.screenshots.push({name,bytes:bytes.length,sha256:hash(bytes),...page.viewportSize()});}
    async function routeSnapshot(){
      await page.locator('#guitar-plan-controls>summary').click();await page.locator('#guitar-live-route').scrollIntoViewIfNeeded();
      const markers=async selector=>{
        const visibility=await page.locator(selector).evaluateAll(browserMarkerVisibility),identities=await page.locator(selector).evaluateAll(nodes=>nodes.map(node=>({assignments:JSON.parse(node.dataset.assignments),sources:JSON.parse(node.dataset.sourceIds),accessible:node.getAttribute('aria-label')})));
        return visibility.map((row,index)=>({...row,...identities[index]}));
      };
      const result={clock:await page.locator('#progress').evaluate(readPlaybackClock),controlsClosed:!await page.locator('#guitar-plan-controls').evaluate(node=>node.open),current:await markers('.guitar-live-current .guitar-live-choice'),next:await markers('.guitar-live-next .guitar-live-choice')};
      await picture('worldmusichub-guitar-phrase-route.png','#guitar-live-route');await controls();return result;
    }
    try{
      await page.setViewportSize({width:1440,height:1100});await page.emulateMedia({reducedMotion:'reduce'});await hideNotation();
      await ui('#instrument').selectOption('guitar');await setSessionMode('listen');await ui('#count-in').uncheck();
      await ui('#guitar-frets').fill('5');await ui('#instrument-apply').click();
      await page.waitForFunction(()=>document.querySelector('#fretboard .fret-button[data-fret="5"]')&&!document.querySelector('#fretboard .fret-button[data-fret="6"]'));
      report.compilation=await importScore(score);
      const whole=watch(body=>body.score.id===score.id&&isDeepStrictEqual(body.selected_part_ids,['A','B'])&&!body.planning_scope);
      await configureStageMod({performers:['A','B'],layout:'solo'});report.whole=await exchange(await whole);await ready(report.whole.plan);assertPhraseExchange(report.whole,report.compilation);
      await ui('.practice-options>summary').click();await ui('#loop-from').fill('0');await ui('#loop-to').fill('8');await ui('#loop-apply').click();
      await page.waitForFunction(()=>document.querySelector('#loop-enabled').checked);await closeShellPanels();
      await page.locator('#play-button').click();await waitForPlaybackClockAdvance(page);await page.locator('#stage-title').click();await page.keyboard.press('i');
      await page.waitForFunction(()=>document.querySelector('#hud-captured').textContent==='1');await page.locator('#play-button').click();
      const scoring=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/assess'&&response.request().method()==='POST'&&response.request().postDataJSON().inputs.length===1);
      await ui('#assess-button').click();const assessed=await scoring;
      report.assessment={path:'/api/assess',httpStatus:assessed.status(),request:assessed.request().postDataJSON(),result:await assessed.json()};
      await page.waitForFunction(()=>{const result=document.querySelector('#result-summary');return result.dataset.phase==='assessed'&&result.dataset.revision==='1'&&result.dataset.assessedRevision==='1';});
      report.before=await snapshot();await controls();
      for(const [index,lock]of GUITAR_PHRASE_LOCKS.entries()){
        await page.locator('#guitar-lock-source').selectOption(lock.source_note_id);
        for(const key of ['string','fret','finger'])await page.locator('#guitar-lock-'+key).selectOption(String(lock[key]));
        const pending=watch(body=>body.score.id===score.id&&!body.planning_scope&&body.locks.length===index+1);
        await page.locator('#guitar-apply-lock').click();report.locked=await exchange(await pending);await ready(report.locked.plan);
      }
      const start=getRequests().length;await draft(GUITAR_PHRASE_SCOPE);assert.equal(getRequests().length,start,'Drafts make no request');assertPhraseUi(await observe(),null,{draft:true});
      const [inventory,plan]=pair();await page.locator('#guitar-phrase-apply').click();
      report.inventory=await exchange(await inventory);report.phrase=await exchange(await plan);await ready(report.phrase.plan);report.phrase.ui=await observe();report.phraseRequests=getRequests().slice(start);
      assertPhraseExchange(report.phrase,report.compilation,{scope:GUITAR_PHRASE_SCOPE,locks:[GUITAR_PHRASE_LOCKS[0]]});await picture('worldmusichub-guitar-phrase-ready.png');
      report.routeSnapshot=await routeSnapshot();
      const invalidStart=getRequests().length;await page.locator('#guitar-phrase-from').fill('1/0');assertPhraseUi(await observe(),null,{draft:true});await page.locator('#guitar-phrase-apply').click();
      report.invalid={from:await page.locator('#guitar-phrase-from').inputValue(),ui:await observe(),requests:getRequests().slice(invalidStart)};await picture('worldmusichub-guitar-phrase-invalid.png');
      const [revertInventory,revertPlan]=pair();await page.locator('#guitar-phrase-revert').click();
      report.reverted={inventory:await exchange(await revertInventory),plan:await exchange(await revertPlan)};await ready(report.reverted.plan.plan);report.reverted.ui=await observe();report.after=await snapshot();assert.deepEqual(report.after,report.before);await write();

      for(const {phase,action}of GUITAR_PHRASE_RACES){
        // Each row starts through an ordinary source import and explicit Mod
        // ownership. This also clears session-only locks and previous ranges.
        await importScore(score);const base=watch(body=>body.score.id===score.id&&isDeepStrictEqual(body.selected_part_ids,['A','B'])&&!body.planning_scope);
        await configureStageMod({performers:['A','B'],layout:'solo'});await base;await ready();await draft(GUITAR_PHRASE_OLD_SCOPE);
        const stale={arrived:deferred(),release:deferred(),done:deferred()},replacement={arrived:deferred(),release:deferred(),done:deferred()};let stage='old';
        const held=[];
        const handler=async route=>{
          const request=route.request(),body=request.postDataJSON();
          const slot=stage==='old'&&body.score.id===score.id&&isDeepStrictEqual(body.planning_scope,GUITAR_PHRASE_OLD_SCOPE)&&Boolean(body.inventory_only)===(phase==='inventory')?stale:stage==='replacement'?replacement:null;
          if(!slot)return route.continue();stage='holding';held.push(slot);
          try{
            const ordinal=getRequests().filter(row=>row.path==='/api/fingering/guitar').length;
            const actual=await route.fetch();const bytes=await actual.body();assert.equal(actual.status(),200);
            const row={ordinal,path:'/api/fingering/guitar',httpStatus:actual.status(),request:body,plan:JSON.parse(bytes.toString('utf8'))};slot.arrived.resolve(row);
            await slot.release.promise;
            // Replay the exact Rust response bytes, merely delayed. Aborts are
            // expected when the real app invalidates an in-flight generation.
            try{await route.fulfill({response:actual,body:bytes});slot.done.resolve('fulfilled');}catch(error){assert.match(error.message,/closed|canceled|cancelled|aborted|Invalid InterceptionId|Invalid interception/i);slot.done.resolve('aborted');}
          }catch(error){slot.arrived.reject(error);slot.done.reject(error);}
        };
        await page.route('**/api/fingering/guitar',handler);
        try{
          await page.locator('#guitar-phrase-apply').click();const row={phase,action,stale:await bounded(stale.arrived.promise,'old '+phase+' Rust reply')};stage='replacement';
          if(action==='apply'){await draft(GUITAR_PHRASE_SCOPE);await page.locator('#guitar-phrase-apply').click();}
          if(action==='revert'){await page.locator('#guitar-phrase-from').fill('1/0');await page.locator('#guitar-phrase-revert').click();}
          if(action==='parts')await configureStageMod({performers:['A','C'],layout:'solo'});
          row.compilation=action==='source'?await importScore(originalGuitarPhraseStudy(`-${phase}`)):report.compilation;
          row.replacement=await bounded(replacement.arrived.promise,'replacement Rust reply');
          row.beforeRelease=await observe();assert.equal(row.beforeRelease.status,'loading');
          const requestStart=getRequests().filter(row=>row.path==='/api/fingering/guitar').length;
          stale.release.resolve();row.staleRelease=await stale.done.promise;
          await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
          row.afterRelease=await observe();row.newRequestsWhileReplacementHeld=getRequests().filter(row=>row.path==='/api/fingering/guitar').slice(requestStart);
          assert.deepEqual(row.afterRelease,row.beforeRelease);assert.deepEqual(row.newRequestsWhileReplacementHeld,[]);
          const final=watch(body=>body.score.id===row.compilation.score.id&&!body.inventory_only);
          replacement.release.resolve();await replacement.done.promise;row.final=await exchange(await final);await ready(row.final.plan);row.final.ui=await observe();row.scoreExport=await exportScore();await closeShellPanels();
          report.races.push(row);await write();
        }finally{for(const slot of held)slot.release.resolve();await page.unroute('**/api/fingering/guitar',handler);}
      }
      report.ok=true;assertGuitarPhraseReport(report);await write();
    }catch(error){report.ok=false;report.failure=error.message;report.lastUi=await observe().catch(()=>null);await write();throw error;}
  });
}

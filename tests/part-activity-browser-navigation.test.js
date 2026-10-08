import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resumePartActivityStage,waitForPartActivityModSource} from './part-activity-browser-navigation.js';

// Routing-only double: it has no admission, audio, score mutation or UI bypass.
// Invisible controls reject clicks just as the real browser must.
function navigation(screen, title='Imported activity source') {
  const clicks=[];
  const visible=selector=>selector==='#game-home'||selector==='#home-single-player'?screen==='home':selector==='#song-lobby'||selector==='#resume-session'?screen==='library':selector==='#edit-song-mod'?screen==='stage':false;
  return {clicks,page:{locator(selector){return {
    async isVisible(){return visible(selector);},
    async click(...args){assert.deepEqual(args,[]);assert.ok(visible(selector),`Hidden click: ${selector}`);clicks.push(selector);if(selector==='#home-single-player')screen='library';else if(selector==='#resume-session')screen='stage';else assert.fail(`Unexpected control: ${selector}`);},
    async waitFor(options){assert.deepEqual(options,{state:'visible'});assert.ok(visible(selector),`Hidden stage: ${screen}`);},
    async textContent(){assert.equal(selector,'#stage-title');return title;},
  };}}};
}
for(const [screen,expected] of [['home',['#home-single-player','#resume-session']],['library',['#resume-session']],['stage',[]]])test(`activity import resumes from ${screen} using visible controls without starting the preview`,async()=>{
  const {page,clicks}=navigation(screen);await resumePartActivityStage(page,'Imported activity source');assert.deepEqual(clicks,expected);
});
test('activity navigation rejects an unrelated imported source',async()=>{
  await assert.rejects(resumePartActivityStage(navigation('home','Unrelated preview source').page,'Imported activity source'),/Resume must preserve the imported activity source/);
});
test('both initial and replacement uploads use explicit activity stage routing',()=>{
  const source=readFileSync(new URL('./part-activity-browser-regression.js',import.meta.url),'utf8');
  assert.match(source,/const upload=async\(score,name\)=>\{[^\n]*await waitForPartActivityModSource\(page,score.title\);await closeShellPanels\(\);await resumePartActivityStage\(page,score.title\);\};/);
  assert.match(source,/await upload\(score,'original-machine-activity.json'\)/);
  assert.match(source,/await upload\(replacement.score,'original-replacement-activity.json'\)/);
  assert.match(source,/performers:\[human\],layout:'complete',showOtherParts:true/);
});

test('replacement import waits for exact editable source while blocked Play can await human Mod selection',async()=>{
 let checked=false;
 const page={async waitForFunction(predicate,expected){
  assert.equal(expected,'Replacement activity');const prior=globalThis.document;
  const nodes={'#score-title':{textContent:expected},'#edit-song-mod':{disabled:false},'#play-button':{disabled:true}};
  globalThis.document={querySelector:selector=>nodes[selector]};
  try{
   assert.equal(predicate(expected),true,'Out-of-range all-human Play is not a prerequisite for selecting the intended human part');
   nodes['#score-title'].textContent='Old activity';assert.equal(predicate(expected),false,'Never configure the previous source');nodes['#score-title'].textContent=expected;
   nodes['#edit-song-mod'].disabled=true;assert.equal(predicate(expected),false,'Admission in progress still blocks configuration');delete nodes['#edit-song-mod'];assert.equal(predicate(expected),false,'A missing Mod is not ready');checked=true;
  }finally{if(prior===undefined)delete globalThis.document;else globalThis.document=prior;}
 }};
 await waitForPartActivityModSource(page,'Replacement activity');assert.equal(checked,true);
 const source=readFileSync(new URL('./part-activity-browser-regression.js',import.meta.url),'utf8');assert.doesNotMatch(source,/readyForTitle/);
 assert.match(source,/await upload\(replacement.score,'original-replacement-activity.json'\);await configureSongMod\(page,\{origin:'stage',performers:\[replacement.score.parts.find/);
 assert.match(source,/Replacement cannot retain old admission/);assert.match(source,/await waitForPlaybackClockAdvance\(page\);const replaced=await waitState/);
});

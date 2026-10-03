import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseHTML} from 'linkedom';
import {IDBFactory} from 'fake-indexeddb';
import {createI18n,validateLocaleCatalogs,MESSAGE_SCHEMA,LOCALE_CATALOGS} from '../web/i18n.js';
import freeSchema from '../web/locales/free-schema.js';
import {createFreePracticeSession,createFreePracticePreview} from '../web/free-practice.js';
import {setupFreePracticeView} from '../web/free-practice-view.js';
import {openPerformanceLibrary,PERFORMANCE_LIBRARY_LIMITS} from '../web/performance-library.js';
import {FreePracticeRecorder} from '../web/free-practice-recorder.js';

const settle=()=>new Promise(resolve=>setImmediate(resolve)),date='2026-10-02T00:00:00.000Z';
const deferred=()=>{let resolve;const promise=new Promise(yes=>{resolve=yes;});return {promise,resolve};};
function sealed(id='saved',midi=60){const r=new FreePracticeRecorder({id,createdAt:date});r.start(10);r.observe('note_on',{source:'input',inputKind:'midi',midi,velocity:85,eventWall:20});return r.stop(30,date);}
async function setup(t,options={}){
 const {document,window}=parseHTML('<!doctype html><html><body><main id="score-screen">Retained score and take</main></body></html>');
 Object.defineProperty(window.HTMLSelectElement.prototype,'value',{configurable:true,get(){return this.querySelector('option[selected]')?.value||this.querySelector('option')?.value||'';},set(value){for(const option of this.querySelectorAll('option'))option.toggleAttribute('selected',option.value===String(value));}});
 let focused=null;window.HTMLElement.prototype.focus=function(){focused=this;};Object.defineProperty(document,'activeElement',{configurable:true,get:()=>focused});
 Object.defineProperty(document,'hidden',{configurable:true,writable:true,value:false});
 const library=options.library||await openPerformanceLibrary({factory:new IDBFactory(),name:'view'});let wall=10,id=0,sound=false,exits=0,connects=0,settings=0;
 const inputs=[],boundaries=[],downloads=[],reports=[],audioCalls=[];const i18n=createI18n({locale:options.locale||'en',onReport:issue=>reports.push(issue)});
 const session=createFreePracticeSession({now:()=>wall,dateNow:()=>date,newId:()=>`view-${++id}`,openLibrary:()=>library,onBoundary:reason=>boundaries.push(reason),recorderOptions:options.recorderOptions});
 const preview=createFreePracticePreview({audio:options.audio||{unlock:async()=>audioCalls.push('unlock'),play:(...args)=>audioCalls.push(args),stop:()=>audioCalls.push('stop')},soundEnabled:()=>sound});
 const view=setupFreePracticeView({document,session,preview,i18n,onExit:()=>exits++,onConnectMidi:()=>connects++,onConfigureKeyboard:()=>settings++,getSoundEnabled:()=>sound,onSoundChange:value=>{sound=value;},getConfiguration:()=>({sound,instrument:'piano'}),getPianoRange:options.getPianoRange||(()=>({keyCount:61,lowestMidi:36})),
 onInput:(kind,input)=>{inputs.push({kind,...input});if(kind==='cleanup')session.cleanup(wall,input.reason,{source:input.source});else session.observe(kind,{...input,eventWall:wall,receivedWall:wall},input.owner);},download:(text,name)=>downloads.push({text,name})});
 t.after(()=>{view.destroy();library.close?.();});
 const $=id=>document.getElementById(id),click=async id=>{$(id).click();for(let i=0;i<1000;i++){await settle();if($('free-practice-screen').getAttribute('aria-busy')!=='true')return;}throw Error('UI operation did not settle');},event=(node,type,props={})=>{const value=new window.Event(type,{bubbles:true,cancelable:true});Object.assign(value,props);node.dispatchEvent(value);return value;};
 return {document,window,library,session,preview,view,i18n,$,click,event,inputs,boundaries,downloads,reports,audioCalls,at(value){wall=value;},exits:()=>exits,connects:()=>connects,settings:()=>settings};
}

test('free locale bundles match typed schemas with complete single-language entries',()=>{
 assert.deepEqual(validateLocaleCatalogs(),[]);for(const [key,value]of Object.entries(freeSchema)){assert.deepEqual(MESSAGE_SCHEMA[key],value);for(const locale of ['en','zh-CN'])assert.equal(typeof LOCALE_CATALOGS[locale][key],'string');}
 assert.match(LOCALE_CATALOGS.en['free.previewHelp'],/160 ms.*2 minutes.*4,096/);assert.match(LOCALE_CATALOGS['zh-CN']['free.previewHelp'],/160 毫秒.*2 分钟.*4,096/);
});
test('independent screen provides accessible controls, silent recording and explicit immutable save',async t=>{
 const ui=await setup(t);await ui.view.enter();assert.equal(ui.$('free-practice-screen').hidden,false);assert.equal(ui.document.activeElement,ui.$('free-practice-title'));assert.equal(ui.$('free-start').disabled,false);assert.equal(ui.$('free-save-panel').hidden,true);await ui.click('free-start');assert.equal(ui.session.snapshot().state,'recording');assert.equal(ui.$('free-start').disabled,true);assert.equal(ui.$('free-stop').disabled,false);
 ui.at(20);const key=ui.$('free-practice-keys').querySelector('[data-midi="60"]');ui.event(key,'pointerdown',{pointerId:1,button:0});ui.at(25);ui.event(key,'pointerup',{pointerId:1});ui.at(30);await ui.click('free-stop');assert.equal(ui.$('free-save-panel').hidden,false);assert.equal(ui.$('free-save').disabled,false);assert.equal(ui.$('free-start').disabled,true);assert.equal(ui.audioCalls.length,0);ui.$('free-record-label').value='My original title';await ui.click('free-save');assert.equal(ui.session.snapshot().saveStatus,'saved');assert.equal(ui.$('free-start').disabled,false);assert.match(ui.$('free-save-status').textContent,/Saved/);assert.equal(ui.$('score-screen').textContent,'Retained score and take');assert.equal((await ui.library.list())[0].label,'My original title');assert.deepEqual(ui.reports,[]);
});
test('storage loading cannot become a prerequisite for recording',async t=>{
 const gate=deferred();const ui=await setup(t,{library:{list:()=>gate.promise,close:()=>{}}});ui.view.enter();assert.equal(ui.$('free-start').disabled,false);await ui.click('free-start');assert.equal(ui.session.snapshot().state,'recording');gate.resolve([]);await settle();
});
test('save failure retains draft, export action, title and explicit retry',async t=>{
 const ui=await setup(t,{library:{list:async()=>[],save:async()=>{throw Object.assign(Error(),{code:'performance.quota'});},close:()=>{}}});await ui.view.enter();await ui.click('free-start');ui.at(30);await ui.click('free-stop');ui.$('free-record-label').value='Keep me';await ui.click('free-save');assert.equal(ui.session.snapshot().saveStatus,'failed');assert.equal(ui.$('free-save').disabled,false);assert.equal(ui.$('free-export-draft').disabled,false);assert.equal(ui.$('free-record-label').value,'Keep me');assert.match(ui.$('free-operation-status').textContent,/storage/);await ui.click('free-export-draft');assert.equal(JSON.parse(ui.downloads[0].text).state,'stopped');assert.equal(ui.$('free-discard').disabled,true);ui.$('free-discard-confirm').checked=true;ui.event(ui.$('free-discard-confirm'),'change');assert.equal(ui.$('free-discard').disabled,false);await ui.click('free-discard');assert.equal(ui.session.snapshot().state,'idle');
});
test('locale switching preserves controls, typed title, focus, session ownership and recorded values',async t=>{
 const ui=await setup(t);await ui.view.enter();await ui.click('free-start');const owner=ui.session.owner(),button=ui.$('free-pause'),key=ui.$('free-practice-keys').querySelector('button');ui.$('free-record-label').value='原始 title';button.focus();ui.i18n.setLocale('zh-CN');assert.equal(ui.$('free-pause'),button);assert.equal(ui.document.activeElement,button);assert.equal(ui.$('free-practice-keys').querySelector('button'),key);assert.equal(ui.$('free-record-label').value,'原始 title');assert.equal(ui.session.owner(),owner);assert.equal(ui.session.snapshot().state,'recording');assert.equal(ui.$('free-stop').textContent,'停止录制');assert.doesNotMatch(ui.$('free-practice-screen').textContent,/Preview saved|Start recording|Saved performances/);assert.deepEqual(ui.reports,[]);
});
test('focus loss pauses recording, releases only owned free contacts and cancels pending preview unlock',async t=>{
 const gate=deferred(),plays=[];const ui=await setup(t,{audio:{unlock:()=>gate.promise,play:(...args)=>plays.push(args),stop:()=>{}}});await ui.view.enter();await ui.click('free-start');const key=ui.$('free-practice-keys').querySelector('button');ui.at(20);ui.event(key,'pointerdown',{pointerId:7,button:0});ui.at(25);ui.window.dispatchEvent(new ui.window.Event('blur'));assert.equal(ui.session.snapshot().state,'paused');assert.equal(ui.inputs.at(-1).kind,'cleanup');assert.match(ui.inputs.at(-1).source,/^free-input:/);assert.equal(ui.inputs.at(-1).reason,'free_focus_loss');ui.at(30);await ui.click('free-stop');await ui.click('free-save');await ui.click('free-sound');ui.$('free-preview').click();await settle();assert.equal(ui.preview.snapshot().status,'preparing');ui.document.hidden=true;ui.document.dispatchEvent(new ui.window.Event('visibilitychange'));gate.resolve();await settle();assert.equal(plays.length,0);assert.equal(ui.preview.snapshot().status,'stopped');
});
test('on-screen accessible activation owns release across focus changes and ignores key repeat',async t=>{
 const ui=await setup(t);await ui.view.enter();await ui.click('free-start');const key=ui.$('free-practice-keys').querySelector('button');ui.at(20);ui.event(key,'keydown',{key:'Enter',repeat:false});ui.event(key,'keydown',{key:'Enter',repeat:true});assert.equal(ui.inputs.filter(row=>row.kind==='note_on').length,1);ui.at(25);ui.event(key,'focusout');assert.equal(ui.inputs.at(-1).kind,'cleanup');ui.event(key,'keyup',{key:'Enter'});assert.equal(ui.inputs.filter(row=>row.kind==='note_off').length,0);assert.equal(ui.inputs[0].inputKind,'on_screen_keyboard');
});
test('configured chromatic piano uses shared geometry, retains live contacts, and displays the actual PC mapping',async t=>{
 const ui=await setup(t);await ui.view.enter();const mapping={configurationId:1,bindings:[{code:'KeyA',label:'用户键',midi:70,enabled:true,held:false},{code:'KeyS',label:'S',midi:null,enabled:false}]};ui.view.setKeyboard(mapping);
 const piano=ui.$('free-practice-keys'),first=piano.querySelector('[data-midi="70"]');
 assert.equal(piano.querySelectorAll('button').length,61);assert.equal(piano.querySelectorAll('.white').length,36);assert.equal(piano.querySelectorAll('.black').length,25);assert.equal(piano.firstElementChild.dataset.midi,'36');assert.equal(piano.lastElementChild.dataset.midi,'96');
 assert.equal(piano.querySelector('[data-code="KeyS"]'),null,'A disabled PC mapping must not become a playable shortcut');assert.equal(piano.querySelectorAll('button:disabled').length,0,'The piano stays playable independently of PC shortcut availability');
 assert.equal(first.querySelector('.key-shortcut').textContent,'用户键');assert.equal(first.dataset.code,'KeyA');assert.equal(first.classList.contains('black'),true);
 const c=piano.querySelector('[data-midi="60"]'),sharp=piano.querySelector('[data-midi="61"]'),d=piano.querySelector('[data-midi="62"]');
 assert.ok(parseFloat(c.style.left)<parseFloat(sharp.style.left)&&parseFloat(sharp.style.left)<parseFloat(d.style.left));assert.ok(parseFloat(sharp.style.width)<parseFloat(c.style.width));
 ui.view.setKeyboard({...mapping,bindings:mapping.bindings.map(row=>({...row,held:true}))});assert.equal(piano.querySelector('[data-midi="70"]'),first);
 ui.view.setHeldNotes([70,60,70]);assert.equal(first.classList.contains('held'),true);assert.equal(first.getAttribute('aria-pressed'),'true');assert.equal(ui.$('free-live-notes').textContent,'C4 · A♯4');assert.match(first.getAttribute('aria-label'),/A♯4/);
 ui.i18n.setLocale('zh-CN');assert.equal(piano.querySelector('[data-midi="70"]'),first);assert.equal(first.getAttribute('aria-pressed'),'true');assert.equal(ui.$('free-recordings-toggle').textContent,'演奏记录与回放');
 ui.view.setKeyboard({...mapping,configurationId:2,bindings:[{code:'KeyA',label:'用户键',midi:127,enabled:true}]});assert.equal(piano.querySelector('[data-code="KeyA"]'),null,'An input binding outside the configured visual range never silently expands the piano');assert.equal(piano.lastElementChild.dataset.midi,'96');assert.equal(piano.querySelector('[data-midi="70"]').classList.contains('held'),true);
 ui.view.setHeldNotes([]);assert.equal(ui.$('free-live-notes').textContent,'从任意琴键开始');assert.equal(piano.querySelectorAll('[aria-pressed="true"]').length,0);
});
test('explicit 88-key configuration keeps the complete A0–C8 piano while input beyond the visual range remains available',async t=>{
 const ui=await setup(t,{getPianoRange:()=>({keyCount:88,lowestMidi:21})});await ui.view.enter();ui.view.setKeyboard({configurationId:1,bindings:[{code:'KeyR',label:'R',midi:60,enabled:true},{code:'KeyP',label:'P',midi:127,enabled:true}]});
 const piano=ui.$('free-practice-keys');assert.equal(piano.children.length,88);assert.equal(piano.querySelectorAll('.white').length,52);assert.equal(piano.querySelectorAll('.black').length,36);assert.equal(piano.firstElementChild.dataset.midi,'21');assert.equal(piano.lastElementChild.dataset.midi,'108');
 ui.view.setHeldNotes([21,108,127]);assert.equal(piano.querySelectorAll('[aria-pressed="true"]').length,2);assert.match(ui.$('free-live-notes').textContent,/G9/,'Out-of-view musical input is still reported without changing the explicit range');
});
test('recordings start collapsed, open on explicit saved selection and preserve disclosure state during live input',async t=>{
 const ui=await setup(t);await ui.view.enter();assert.ok(!ui.$('free-recordings').open);await ui.click('free-start');assert.ok(!ui.$('free-recordings').open);ui.at(30);await ui.click('free-stop');assert.equal(ui.$('free-save-panel').hidden,false);await ui.click('free-save');assert.equal(ui.$('free-recordings').open,true);
 ui.$('free-recordings').open=false;ui.i18n.setLocale('zh-CN');ui.view.setHeldNotes([60]);assert.equal(ui.$('free-recordings').open,false);assert.equal(ui.$('free-input-help').querySelector('summary').textContent,'演奏说明');
});
test('saved records load without autoplay and compare explicitly selected immutable A/B snapshots',async t=>{
 const ui=await setup(t);const a=await ui.library.save(sealed('a',60),{label:'A <script>'}),b=await ui.library.save(sealed('b',72),{label:'B 原作'});await ui.view.enter();ui.$('free-record-select').value=a.key;await ui.click('free-load');await ui.click('free-choose-baseline');ui.$('free-record-select').value=b.key;await ui.click('free-load');assert.equal(ui.$('free-comparison').hidden,false);assert.match(ui.$('free-comparison-body').textContent,/A <script>.*C4.*B 原作.*C5/);assert.equal(ui.$('free-practice-screen').querySelector('script'),null);assert.equal(ui.audioCalls.length,0);assert.equal(ui.session.comparison().baseline_selection.key,a.key);assert.equal(ui.$('free-preview').disabled,true);await ui.click('free-sound');assert.equal(ui.$('free-preview').disabled,false);assert.match(ui.$('free-practice-screen').textContent,/fixed 160 ms tones/);
});
test('import and restore use explicit file actions, enforce pre-read size bounds and preserve source labels',async t=>{
 const ui=await setup(t);await ui.view.enter();await ui.click('free-import-record');assert.match(ui.$('free-operation-status').textContent,/Choose/);let read=false;Object.defineProperty(ui.$('free-import-file'),'files',{configurable:true,value:[{size:PERFORMANCE_LIBRARY_LIMITS.recordBytes+1,text:async()=>{read=true;return '{}';}}]});await ui.click('free-import-record');assert.equal(read,false);assert.match(ui.$('free-operation-status').textContent,/size limit/);Object.defineProperty(ui.$('free-import-file'),'files',{configurable:true,value:[{size:100,text:async()=>JSON.stringify(sealed())}]});await ui.click('free-import-record');assert.equal((await ui.library.list()).length,1);assert.match(ui.$('free-operation-status').textContent,/Added 1/);const backup=await ui.library.exportBackup();Object.defineProperty(ui.$('free-import-file'),'files',{configurable:true,value:[{size:backup.length,text:async()=>backup}]});await ui.click('free-restore-backup');assert.equal((await ui.library.list()).length,2);
});
test('input budget omission and navigation are visible without losing prior score markup',async t=>{
 const ui=await setup(t,{recorderOptions:{evidenceLimit:3}});await ui.view.enter();await ui.click('free-start');const key=ui.$('free-practice-keys').querySelector('button');ui.at(20);ui.event(key,'pointerdown',{pointerId:1,button:0});assert.equal(ui.$('free-capture-full').hidden,false);ui.at(30);await ui.click('free-exit');assert.equal(ui.exits(),1);assert.equal(ui.$('free-practice-screen').hidden,true);assert.equal(ui.session.snapshot().state,'paused');assert.equal(ui.$('score-screen').textContent,'Retained score and take');
});

test('locale switching retains an expanded distribution and its focused summary node',async t=>{
 const ui=await setup(t);const saved=await ui.library.save(sealed());await ui.view.enter();ui.$('free-record-select').value=saved.key;await ui.click('free-load');const details=ui.$('free-summary').querySelector('details'),heading=details.querySelector('summary');details.open=true;heading.focus();ui.i18n.setLocale('zh-CN');assert.equal(ui.$('free-summary').querySelector('details'),details);assert.equal(details.open,true);assert.equal(ui.document.activeElement,heading);assert.equal(heading.textContent,'音高与输入来源分布');assert.match(details.textContent,/MIDI 输入/);
});
test('on-screen keys reject IME composition, legacy composition events and open dialogs',async t=>{
 const ui=await setup(t);await ui.view.enter();await ui.click('free-start');const key=ui.$('free-practice-keys').querySelector('button');ui.at(20);ui.document.dispatchEvent(new ui.window.Event('compositionstart'));ui.event(key,'keydown',{key:'Enter'});ui.document.dispatchEvent(new ui.window.Event('compositionend'));ui.event(key,'keydown',{key:'Enter',keyCode:229});const dialog=ui.document.createElement('dialog');dialog.setAttribute('open','');ui.document.body.append(dialog);ui.event(key,'pointerdown',{pointerId:1,button:0});assert.equal(ui.inputs.length,0);dialog.remove();ui.event(key,'keydown',{key:'Enter',repeat:false});assert.equal(ui.inputs.length,1);assert.ok(ui.inputs[0].liveOwner);assert.equal(ui.inputs[0].owner,ui.session.owner());
});
test('muting a pending preview cancels it immediately and never blocks a new silent recording',async t=>{
 const gate=deferred(),plays=[];const ui=await setup(t,{audio:{unlock:()=>gate.promise,play:(...args)=>plays.push(args),stop:()=>{}}});const saved=await ui.library.save(sealed());await ui.view.enter();ui.$('free-record-select').value=saved.key;await ui.click('free-load');await ui.click('free-sound');await ui.click('free-preview');assert.equal(ui.preview.snapshot().status,'preparing');await ui.click('free-sound');assert.equal(ui.preview.snapshot().status,'muted');await ui.click('free-start');assert.equal(ui.session.snapshot().state,'recording');gate.resolve();await settle();assert.equal(plays.length,0);
});

// A DOM-only view test cannot see the linked CSS cascade. Read the production
// stylesheet order and compare all matching declarations for this layout only.
async function freePianoStylesheetRules(){
 const {document}=parseHTML(await readFile(new URL('../web/index.html',import.meta.url),'utf8'));const result=[];
 for(const link of document.querySelectorAll('link[rel="stylesheet"]')){
  const href=link.getAttribute('href'),css=await readFile(new URL(`../web${href}`,import.meta.url),'utf8');
  const {document:styles}=parseHTML(`<style>${css}</style>`);
  function collect(rules,media=[]){for(const rule of rules){if(rule.cssRules)collect(rule.cssRules,[...media,...(rule.media?[rule.media.mediaText]:[])]);else if(rule.selectorText)result.push({rule,media,href});}}
  collect(styles.querySelector('style').sheet.cssRules);
 }
 return result;
}
function cascadeLayout(element,rules,size){
 const properties=['display','flex-direction','align-items','align-self','gap','max-width','padding','padding-top','padding-right','padding-bottom','padding-left','grid-area','order'],winners={};
 const mediaMatches=media=>media.every(query=>query.split(',').some(branch=>{
  if(/prefers-/.test(branch))return false;
  return [...branch.matchAll(/\((min|max)-(width|height):\s*(\d+)px\)/g)].every(([,bound,axis,value])=>bound==='min'?size[axis]>=Number(value):size[axis]<=Number(value));
 }));
 for(const {rule,media,href}of rules){
  if(!mediaMatches(media)||!properties.some(property=>rule.style.getPropertyValue(property)))continue;
  // Split only selector-list commas, not commas inside a functional selector.
  const selectors=rule.selectorText.split(/,(?![^()]*\))/);
  for(const selector of selectors){
   if(selector.includes('::')||!element.matches(selector))continue;
   const specificity=value=>{
    let adjusted=value;
    while(/:(?:is|not|where|has)\(/.test(adjusted))adjusted=adjusted.replace(/:(is|not|where|has)\(([^()]*)\)/g,(_,kind,args)=>{
      if(kind==='where')return '';const maximum=args.split(',').map(specificity).sort((a,b)=>b[0]-a[0]||b[1]-a[1]||b[2]-a[2])[0];return '#specificity'.repeat(maximum[0])+'.specificity'.repeat(maximum[1])+' type'.repeat(maximum[2]);
    });
    return [(adjusted.match(/#[\w-]+/g)||[]).length,(adjusted.match(/\.[\w-]+|\[[^\]]+\]|:(?!:)[\w-]+/g)||[]).length,(adjusted.replace(/#[\w-]+|\.[\w-]+|\[[^\]]+\]|:(?!:)[\w-]+/g,'').match(/[a-zA-Z][\w-]*/g)||[]).length];
   };
   const [ids,classes,types]=specificity(selector);
   const declarations=[];for(let index=0;index<rule.style.length;index++){const property=rule.style[index],value=rule.style.getPropertyValue(property),priority=rule.style.getPropertyPriority(property);if(!properties.includes(property))continue;declarations.push({property,value,priority});if(property==='padding'){const [top,right=top,bottom=top,left=right]=value.trim().split(/\s+/);for(const [edge,part]of Object.entries({top,right,bottom,left}))declarations.push({property:`padding-${edge}`,value:part,priority});}}
   for(const {property,value,priority}of declarations){const rank=[priority==='important'?1:0,ids,classes,types];
    const old=winners[property],comparison=old?rank.reduce((difference,part,index)=>difference||part-old.rank[index],0):1;
    if(comparison>=0)winners[property]={value,rank,selector,href};
   }
  }
 }
 return winners;
}
test('production stylesheet order keeps the free piano full-width and recordings below it at every viewport',async t=>{
 const ui=await setup(t);ui.document.body.classList.add('game-shell','rhythm-shell');await ui.view.enter();const rules=await freePianoStylesheetRules();
 assert.ok(rules.findIndex(({href})=>href==='/rhythm-shell.css')>rules.findIndex(({href})=>href==='/free-practice.css'),'Exercise the real order that previously let the dashboard win');
 const cases=[{width:1280,height:720,padding:['6px','18px','8px','18px'],gap:'6px'},{width:1920,height:1080,padding:['12px','18px','16px','18px'],gap:'10px'},{width:900,height:560,padding:['4px','10px','6px','10px'],gap:'4px'},{width:390,height:844,padding:['8px','8px','8px','8px'],gap:'8px'}];
 for(const size of cases){const styles=cascadeLayout(ui.$('free-practice-screen'),rules,size);
  for(const [property,value]of Object.entries({display:'flex','flex-direction':'column','align-items':'stretch','max-width':'none',...Object.fromEntries(['top','right','bottom','left'].map((edge,index)=>[`padding-${edge}`,size.padding[index]])),gap:size.gap}))assert.equal(styles[property]?.value,value,`${size.width}×${size.height}: ${property} winner ${JSON.stringify(styles[property])}`);
  for(const id of ['.free-performance-panel','#free-recordings']){const child=cascadeLayout(ui.document.querySelector(id),rules,size);assert.equal(child['grid-area']?.value??'auto','auto',`${id} cannot retain a legacy grid row`);assert.equal(child.order?.value??'0','0');assert.ok(['auto','stretch'].includes(child['align-self']?.value??'auto'),'A flex child uses the shared root stretch alignment');}
 }
 const children=[...ui.$('free-practice-screen').children];assert.ok(children.indexOf(ui.document.querySelector('.free-performance-panel'))<children.indexOf(ui.$('free-recordings')),'Normal flex order keeps recording/history below the piano');assert.equal(ui.$('free-save-panel').closest('#free-recordings'),ui.$('free-recordings'),'Saving and history remain in the dedicated disclosure below the shared stage');
});

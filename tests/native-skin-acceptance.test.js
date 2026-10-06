// Pure Node contracts and production-DOM driver checks; never native acceptance.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runInNewContext,Script} from 'node:vm';
import {IDBFactory} from 'fake-indexeddb';
import {nativeSkinFixture,prepareNativeSkinFixtures,NATIVE_SKIN_PHASES,NATIVE_SKIN_FILES} from '../scripts/prepare-native-skin-fixtures.mjs';
import {validateNativeSkinRecord,validateNativeSkinProfiles,validateNativeSkinPicker,validateNativeSkinExports,validateNativeSkinHostAction,validateNativeSkinControlClicks} from '../scripts/verify-native-skin-evidence.mjs';
import {nativeScoreServer,nativeStorageApp} from './native-storage-app-fixtures.js';

const source=readFileSync(new URL('../crates/desktop-shell/skin-acceptance.js',import.meta.url),'utf8');
const helpers=runInNewContext(source.split('(() => {')[0]+'\n({driveNativeSkinRound,readNativeSkinRecord,observeNativeSkinPicker});',{Error,Promise,Array,Boolean});
const modalScope=runInNewContext(readFileSync(new URL('../crates/desktop-shell/canonical-practice-acceptance.js',import.meta.url),'utf8').split('(() => {')[0]+'\ncanonicalPracticeModalScope;');
const f=nativeSkinFixture(),record=selected=>({version:1,selected,manifest:f.skin.json.toString(),resources:[['assets/checker.png',Array.from(f.skin.png)]]});

// Contract data follows the actual Windows537 host field shape, including a
// half-pixel renderer coordinate and the native helper's floor conversion.
function hostAction(){
  return{action:{version:1,sequence:7,kind:'picker',x:504.5,y:344.375,width:1024,height:689,file:NATIVE_SKIN_FILES.score},host:{process_id:101},result:{ok:true,
    client_click:{client:[0,0,1024,689],origin:[0,31],viewport:[1024,689],requested:[504,375],actual:[504,375],work_area:[0,0,1024,720],app_hwnd:42,foreground:42,hit_hwnd:43,hit_root:42},
    owned_dialog:{hwnd:44,process_id:101,class:'#32770',root_owner_hwnd:42,app_hwnd:42,app_process_id:101},
    picker_completion:{dialog_exists:false,dialog_visible:false,foreground_hwnd:42,owned_popup_visible:false,app_foreground:true,app_enabled:true,dialog_dismissed:true,elapsed_ms:110},
    filename_entry_method:'UIA_ValuePattern'}};
}
test('native host gate rejects absent identities, foreign dialogs, unbound points and incomplete picker dismissal',()=>{
  const good=hostAction();assert.equal(validateNativeSkinHostAction(good.action,good.result,good.host),42);assert.equal(validateNativeSkinHostAction(good.action,good.result,good.host,42),42);
  const mutations=[v=>v.result.client_click={viewport:[1024,689]},v=>delete v.result.client_click.app_hwnd,v=>v.result.client_click.app_hwnd=0,
    v=>v.result.client_click.hit_hwnd=undefined,v=>v.result.client_click.hit_root=undefined,v=>v.result.client_click.foreground=99,v=>v.result.client_click.hit_root=99,
    v=>{v.result.client_click.actual=undefined;v.result.client_click.requested=undefined;},v=>{v.result.client_click.actual=[NaN,0];v.result.client_click.requested=[NaN,0];},
    v=>{v.result.client_click.actual=[1,2];v.result.client_click.requested=[1,2];},v=>v.result.client_click.viewport=[1280,720],v=>v.result.client_click.work_area=[0,0,100,100],
    v=>v.result.owned_dialog.process_id=999,v=>delete v.result.owned_dialog.process_id,v=>v.result.owned_dialog.app_process_id=999,
    v=>v.result.owned_dialog.class='Unowned',v=>v.result.owned_dialog.hwnd=0,v=>v.result.owned_dialog.app_hwnd=7,v=>v.result.owned_dialog.root_owner_hwnd=7,
    v=>v.result.picker_completion.app_enabled=false,v=>delete v.result.picker_completion.owned_popup_visible,v=>v.result.picker_completion.owned_popup_visible=true,
    v=>v.result.picker_completion.foreground_hwnd=7,v=>v.result.picker_completion.app_foreground=false,v=>v.result.picker_completion.dialog_visible=true,v=>v.result.picker_completion.dialog_dismissed=false,
    v=>{v.result.client_click={viewport:[1024,689]};v.result.owned_dialog={app_process_id:101,process_id:999,class:'Unowned',root_owner_hwnd:7,app_hwnd:1};v.result.picker_completion={dialog_dismissed:true,app_enabled:false,owned_popup_visible:true};}];
  for(const [i,mutate]of mutations.entries()){const v=hostAction();mutate(v);assert.throws(()=>validateNativeSkinHostAction(v.action,v.result,v.host),`Host ownership adversary ${i} accepted`);}
  assert.throws(()=>validateNativeSkinHostAction(good.action,good.result,good.host,99),/window changed/);
  const fallback=hostAction();fallback.result.filename_entry_method='native_ComboBoxEx32_edit';fallback.result.filename_native_edit={hwnd:45,process_id:101,class:'Edit',host_descendant:true,enabled:true,visible:true,exact_readback:true,read_only:false,entry_method:'WM_SETTEXT'};
  assert.equal(validateNativeSkinHostAction(fallback.action,fallback.result,fallback.host),42);fallback.result.filename_native_edit.process_id=999;assert.throws(()=>validateNativeSkinHostAction(fallback.action,fallback.result,fallback.host));
});
test('raw click gate retains precisely the observed native score delegation and rejects every extra untrusted click',()=>{
  const row={sequence:7,kind:'picker',id:'import-button',request:{file:NATIVE_SKIN_FILES.score},clicks:[{sequence:7,id:'import-button',owned:true,trusted:true},{sequence:7,id:'score-file',owned:false,trusted:false}]};
  const pickers=[{sequence:7,filename:NATIVE_SKIN_FILES.score,completed:true,delegatedClicks:[{type:'click',trusted:false,id:'score-file',sequence:7,originalControl:true}]}];
  validateNativeSkinControlClicks(row,pickers);
  for(const mutate of [r=>r.clicks.pop(),r=>r.clicks.reverse(),r=>r.clicks[1].id='skin-image',r=>r.clicks[1].trusted=true,r=>r.clicks[1].owned=true,r=>r.clicks[1].sequence=8,r=>r.clicks.push({...r.clicks[1]}),r=>r.clicks[0].owned=false,r=>r.request.file='private.json']){const r=structuredClone(row);mutate(r);assert.throws(()=>validateNativeSkinControlClicks(r,pickers));}
  assert.throws(()=>validateNativeSkinControlClicks(row,[]));const unrelated=structuredClone(pickers);unrelated[0].delegatedClicks[0].originalControl=false;assert.throws(()=>validateNativeSkinControlClicks(row,unrelated));
  // The observed home-button child is id-less. Detached export anchors produce
  // no secondary document event; exports and direct skin pickers stay single.
  for(const [kind,id]of [['click','home-single-player'],['click','export-button'],['click','export-takes'],['picker','skin-image']]){
    const r={sequence:8,kind,id,clicks:[{sequence:8,id:id==='home-single-player'?null:id,owned:true,trusted:true}]};validateNativeSkinControlClicks(r);
    r.clicks.push({sequence:8,id:null,owned:false,trusted:false});assert.throws(()=>validateNativeSkinControlClicks(r));
  }
});

test('native skin fixture reuses deterministic original JSON, PNG and exact source payload without clobbering files',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'native-skin-fixtures-'));
  try{assert.deepEqual(await prepareNativeSkinFixtures(directory),f.manifest);for(const[name,bytes]of f.files)assert.deepEqual(await readFile(join(directory,name)),bytes);await assert.rejects(prepareNativeSkinFixtures(directory),{code:'EEXIST'});}
  finally{await rm(directory,{recursive:true,force:true});}
  assert.deepEqual([...f.files.keys()],Object.values(NATIVE_SKIN_FILES));assert.equal(f.score.source.content[0],'\uFEFF');assert.match(f.score.source.content,/\r\n/);
});
test('exact stored skin gate rejects absent artwork, modified manifest and wrong selection',()=>{
  for(const selected of ['imported','default'])validateNativeSkinRecord(record(selected),selected);
  for(const mutate of [r=>r.selected='default',r=>r.manifest+=' ',r=>r.resources=[],r=>r.resources[0][1][25]^=1,r=>r.resources[0][0]='checker.png',r=>r.unexpected=true]){const r=record('imported');mutate(r);assert.throws(()=>validateNativeSkinRecord(r,'imported'));}
});
function profiles(){
  const directory='C:\\Acceptance\\Scores',profile='C:\\Acceptance\\webview-profiles\\skin-seed';
  const rows=NATIVE_SKIN_PHASES.map((phase,i)=>({phase,process_id:100+i,launched_new_process:true,normal_close:true,renderer_ok:true,renderer_origin:'https://wmh.localhost',executable_tcp_listeners:0,profile_directory:profile,profile_absent_before_launch:i===0,profile_fresh:i===0,profile_reused:i>0}));
  return{native:{directory,profile_reused:true,phases:rows},profiles:rows.map((r,i)=>({version:1,phase:r.phase,process_id:r.process_id,profile_directory:profile,library_directory:directory,fresh_required:i===0,created_new:i===0}))};
}
test('native restart gate needs three normally closed distinct processes and exact host-owned predecessor profile records',()=>{
  let p=profiles();validateNativeSkinProfiles(p.native,p.profiles);
  for(const mutate of [p=>p.native.phases[1].normal_close=false,p=>p.native.phases[1].process_id=100,p=>p.profiles[1].created_new=true,p=>p.native.phases[2].profile_directory+='-copy',p=>p.native.phases[1].profile_reused=false,p=>p.profiles[2].library_directory='C:\\User\\Scores',p=>p.native.phases.reverse()]){p=profiles();mutate(p);assert.throws(()=>validateNativeSkinProfiles(p.native,p.profiles));}
});
test('read-only stored record observer rejects an absent database and reads production-typed bytes',async()=>{
  const factory=new IDBFactory();await assert.rejects(helpers.readNativeSkinRecord(factory),/absent/);
  const {openSkinStorage}=await import('../web/skin-storage.js'),storage=await openSkinStorage({factory});
  const r=record('imported');r.resources[0][1]=new Uint8Array(r.resources[0][1]);await storage.write(r);
  validateNativeSkinRecord(JSON.parse(JSON.stringify(await helpers.readNativeSkinRecord(factory))),'imported');storage.close();
});
test('direct Settings picker gate requires actual owned modal input/change following the pointer gesture',()=>{
  const id='skin-image',filename='checker.png',row={id,filename,sequence:4,events:['pointerdown','pointerup','click','input','change'].map(type=>({type,trusted:true,sequence:4,id,tag:'INPUT',typeAttribute:'file',disabled:false,connected:true,multiple:false,dialog:'settings-dialog',modal:true,filename:['input','change'].includes(type)?filename:null,fileCount:['input','change'].includes(type)?1:null}))};
  validateNativeSkinPicker(row,id,filename);
  for(const mutate of [r=>r.events.pop(),r=>r.events[4].trusted=false,r=>r.events[0].disabled=undefined,r=>r.events[3].modal=false,r=>r.events[4].filename='private.png',r=>r.events[4].fileCount=2,r=>r.events[2].id='score-file']){const r=structuredClone(row);mutate(r);assert.throws(()=>validateNativeSkinPicker(r,id,filename));}
});
test('native skin driver obeys real production Settings/Results/Score modal ownership and preserves exports',async()=>{
  const server=await nativeScoreServer({scores:[f.score]}),app=await nativeStorageApp(server,{now:()=>1000});const calls=[],downloads=[];
  try{
    const key=[...server.records.keys()][0];await app.until(()=>app.savedButton(key)&&!app.$('start-practice').disabled);await app.click('home-single-player');app.savedButton(key).click();await app.until(()=>!app.$('start-practice').disabled);
    app.$('count-in').checked=false;await app.click('start-practice');await app.until(()=>app.document.body.dataset.screen==='stage'&&!app.$('play-button').disabled);if(!app.$('play-button').textContent.includes('Pause'))await app.click('play-button');await app.until(()=>app.$('play-button').textContent.includes('Pause'));await app.click('play-button');await app.until(()=>!app.$('play-button').disabled);
    assert.equal(app.$('stage-title').disabled,undefined,'A heading must not be patched to look like a button');
    const native=async(kind,node,filename)=>{
      assert.ok(node?.isConnected);assert.equal(Boolean(node.disabled),false);assert.equal(node.closest('[hidden]'),null);assert.equal(modalScope(app.document,node),true,`${node.id||node.tagName} has no active modal ownership`);
      calls.push({kind,id:node.id||null,modal:node.closest('dialog')?.id??null});
      if(kind==='picker'){
        assert.equal(node.closest('dialog'),app.$('settings-dialog'));assert.equal(node.type,'file');const bytes=f.files.get(filename);assert.ok(bytes);
        Object.defineProperty(node,'files',{configurable:true,value:[{name:filename,size:bytes.length,arrayBuffer:async()=>Uint8Array.from(bytes).buffer}]});app.emit(node,'input');app.emit(node,'change');
      }else{assert.equal(kind,'click');node.click();}await app.tick();return calls.length;
    };
    const click=id=>native('click',typeof id==='string'?app.$(id):id);
    const download=async(kind)=>{
      assert.equal(app.document.querySelector('dialog[open]'),null,'Settings must close before a sibling export panel');const score=kind==='score',panel=score?'score-tools-dialog':'results-dialog',button=score?'export-button':'export-takes';
      await click(score?'score-tools-button':'results-button');assert.equal(app.$(panel).open,true);const before=app.downloads.length;await click(button);await app.until(()=>app.downloads.length>before);const data=JSON.parse(await app.downloads.at(-1).text());downloads.push({kind,data});await click(app.$(panel).querySelector('[data-close-panel]'));return `test-${downloads.length}.json`;
    };
    const readSettings=()=>({selected:app.$('skin-settings').dataset.selected,choice:app.$('skin-choice').value,active:app.document.documentElement.dataset.skin??null,importedDisabled:Boolean(app.$('skin-choice').querySelector('[value="imported"]').disabled)});
    for(const phase of NATIVE_SKIN_PHASES){
      const requestStart=app.requests.length;
      const r=await helpers.driveNativeSkinRound({phase,document:app.document,native,until:app.until,download,readStored:()=>helpers.readNativeSkinRecord(app.factory),readSettings,boundary:()=>({screen:app.document.body.dataset.screen,captured:app.$('hud-captured').textContent}),settle:async()=>app.frame()});
      const selected=phase==='skin-seed'?'imported':'default';assert.equal(r.final.selected,selected);validateNativeSkinRecord(JSON.parse(JSON.stringify(r.storedFinal)),selected);assert.deepEqual(r.before,r.after);assert.equal(app.$('settings-dialog').open,true);
      const [scoreBefore,takeBefore,scoreAfter,takeAfter]=downloads.slice(-4);assert.deepEqual(scoreBefore.data,f.score);assert.deepEqual(scoreAfter.data,scoreBefore.data);assert.deepEqual(takeAfter.data,takeBefore.data);
      assert.deepEqual(app.requests.slice(requestStart),[],'The public Settings/export driver must not submit source or assessment requests');
    }
    assert.equal(calls.filter(c=>c.id==='skin-reset').length,1);assert.equal(calls.filter(c=>c.kind==='picker').length,2);
    assert.ok(calls.filter(c=>c.id?.startsWith('skin-')).every(c=>c.modal==='settings-dialog'));
  }finally{await app.close();}
});
test('take/source oracle rejects changed rational source, erased input and machine input leakage',()=>{
  const take={score_id:f.score.id,practice_selection:{kind:'parts',part_ids:['human']},view_configuration:{practice_layout:'complete'},passes:[{inputs:[{midi:60}]}],input_evidence:{events:[{kind:'note_on',encoding:'key_down',source_id:'test-key'},{kind:'note_off',encoding:'key_up',source_id:'test-key'}]}};
  const files=()=>({scoreBefore:structuredClone(f.score),scoreAfter:structuredClone(f.score),takeBefore:structuredClone(take),takeAfter:structuredClone(take)});validateNativeSkinExports(files());
  for(const mutate of [v=>v.scoreAfter.parts[0].notes[0].duration.numerator++,v=>v.scoreBefore.source.content=v.scoreBefore.source.content.trim(),v=>v.takeAfter.passes[0].inputs=[],v=>{v.takeBefore.passes[0].inputs.push({midi:67});v.takeAfter=structuredClone(v.takeBefore);},v=>{v.takeBefore.input_evidence.events.push({kind:'synthetic_release'});v.takeAfter=structuredClone(v.takeBefore);}]){const value=files();mutate(value);assert.throws(()=>validateNativeSkinExports(value));}
});
test('native driver stays behind trusted controls and uses read-only storage with existing geometry guards',()=>{
  assert.doesNotThrow(()=>new Script(source));
  assert.doesNotMatch(source,/dispatchEvent|new KeyboardEvent|\.value\s*=(?!=)|\.checked\s*=(?!=)|setInputFiles|\.click\(/);
  assert.match(source,/db\.transaction\('settings','readonly'\)/);assert.doesNotMatch(source,/readwrite|store\.put|\.write\(/);
  assert.match(source,/prepareCanonicalPracticeTarget/);assert.match(source,/requireCanonicalPracticeOwnedClick/);assert.match(source,/disabled=Boolean\(node.disabled\)/);
});

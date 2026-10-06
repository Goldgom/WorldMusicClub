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
import {validateNativeSkinRecord,validateNativeSkinProfiles,validateNativeSkinPicker,validateNativeSkinExports} from '../scripts/verify-native-skin-evidence.mjs';
import {nativeScoreServer,nativeStorageApp} from './native-storage-app-fixtures.js';

const source=readFileSync(new URL('../crates/desktop-shell/skin-acceptance.js',import.meta.url),'utf8');
const helpers=runInNewContext(source.split('(() => {')[0]+'\n({driveNativeSkinRound,readNativeSkinRecord,observeNativeSkinPicker});',{Error,Promise,Array,Boolean});
const modalScope=runInNewContext(readFileSync(new URL('../crates/desktop-shell/canonical-practice-acceptance.js',import.meta.url),'utf8').split('(() => {')[0]+'\ncanonicalPracticeModalScope;');
const f=nativeSkinFixture(),record=selected=>({version:1,selected,manifest:f.skin.json.toString(),resources:[['assets/checker.png',Array.from(f.skin.png)]]});

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

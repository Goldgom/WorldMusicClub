import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseHTML} from 'linkedom';
import {fixture} from './frontend-fixtures.js';
import {pitchMidi,beat} from '../web/music.js';
import {getAppI18n} from '../web/app-locale.js';
import {octaveOperation,validateAdaptationPreview,setupAdaptationView} from '../web/adaptation-view.js';
import {semitoneOperation,validateTranspositionPreview,validateTranspositionRestore,setupTranspositionView} from '../web/transposition-view.js';
import en from '../web/locales/pitch-review-en.js';
import zh from '../web/locales/pitch-review-zh-CN.js';
import schema from '../web/locales/pitch-review-schema.js';

const clone=structuredClone,settle=()=>new Promise(resolve=>setImmediate(resolve));
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return {promise,resolve,reject}}
function compilation(score){return {score,timeline:{notes:score.parts.flatMap(part=>part.notes.filter(note=>note.pitch).map(note=>({id:note.id,source_note_id:note.id,source_note_ids:[note.id],part_id:part.id,midi:pitchMidi(note.pitch),start_ms:beat(note.at)*500,duration_ms:beat(note.duration)*500,voice:note.voice,staff:note.staff,velocity:note.velocity}))),duration_ms:2000},diagnostics:clone(score.source?.import_diagnostics||[])}}
function copyResult(original,operation,kind){
  const score=clone(original),semitones=kind==='transposition'?operation.semitones:operation.octaves*12;let count=0;
  for(const part of score.parts)for(const note of part.notes)if(note.pitch&&(kind==='transposition'||operation.part_id===null||part.id===operation.part_id)){note.pitch.octave+=semitones/12;count++}
  score.id+=kind==='transposition'?`:semitones:${semitones>0?'+':''}${semitones}`:':octave-copy';
  score.title+=kind==='transposition'?` [${semitones>0?'+':''}${semitones} semitones]`:' [octave +1]';
  const diagnostic={severity:'warning',code:kind==='transposition'?'explicit_semitone_transposition':'explicit_octave_adaptation',message:'Engine source detail <img src=x onerror=bad()> 原文',note_id:null};
  score.source={format:kind==='transposition'?'semitone-transposition':'octave-adaptation',filename:null,content:JSON.stringify({version:1,operation,original}),import_diagnostics:[...(original.source?.import_diagnostics||[]),diagnostic]};
  const compiled=compilation(score),targets=compiled.timeline.notes.filter(note=>kind==='transposition'||operation.part_id===null||note.part_id===operation.part_id);
  return {compilation:compiled,operation:clone(operation),written_interval:{diatonic_steps:semitones/12*7,fifths_delta:0},changed_note_count:count,original_preserved:true,scored_mode_allowed:true,instrument_report:{lowest_midi:0,highest_midi:127,note_options:targets.map(note=>({note_id:note.id,midi:note.midi,playable:true,positions:[]})),diagnostics:[],changed_source_notes:false}};
}
async function setup(t,kind,overrides={}){
  const {document,window}=parseHTML(await readFile(new URL('../web/index.html',import.meta.url),'utf8'));
  Object.defineProperty(window.HTMLSelectElement.prototype,'value',{configurable:true,get(){return this.querySelector('option[selected]')?.value||this.querySelector('option')?.value||''},set(value){for(const option of this.querySelectorAll('option'))option.toggleAttribute('selected',option.value===String(value))}});
  Object.defineProperty(window.HTMLElement.prototype,'open',{configurable:true,get(){return this.hasAttribute('open')}});
  window.HTMLElement.prototype.showModal=function(){this.setAttribute('open','')};window.HTMLElement.prototype.close=function(){this.removeAttribute('open');this.dispatchEvent(new window.Event('close'))};
  let focused=null;Object.defineProperty(document,'activeElement',{configurable:true,get:()=>focused});window.HTMLElement.prototype.focus=function(){focused=this};
  const original=clone(overrides.original||fixture);original.title='<source title> 原稿';original.provenance.attribution='保留权利 <rights> & exact';
  original.source={format:'musicxml',filename:'原稿 unchanged.musicxml',content:'\uFEFF<score>\r\nExact original 音符</score>',import_diagnostics:[{code:'source_only',severity:'warning',message:'Original source warning',note_id:null}]};
  const context={score:original,timeline:compilation(original).timeline,part:null,profile:{kind:'piano',key_count:61,lowest_midi:36},version:1,dirty:false};
  const $=id=>document.getElementById(id),i18n=getAppI18n(document),calls=[],activations=[],notices=[];let pauses=0,reads=0;
  const hooks={document,api:async(path,body,signal)=>{calls.push({path,body,signal});return overrides.api?overrides.api(path,body,signal):path.endsWith('/restore')?compilation(JSON.parse(body.source.content).original):copyResult(body.score,body.operation,kind)},getContext:()=>{reads++;return context},onActivate:async(...args)=>{activations.push(args);return overrides.activate?overrides.activate(...args):true},pausePlayback:()=>pauses++,notice:message=>notices.push(message)};
  const view=kind==='adaptation'?setupAdaptationView(hooks):setupTranspositionView(hooks);t.after(()=>view.destroy());
  const input=$(`${kind}-${kind==='adaptation'?'octaves':'semitones'}`);input.value=kind==='adaptation'?'1':'12';
  const open=()=>$(`${kind}-button`).click(),generate=async()=>{$(`${kind}-preview`).click();await settle()},confirm=()=>{const checkbox=$(`${kind}-confirm`);checkbox.checked=true;checkbox.dispatchEvent(new window.Event('change'))};
  return {$,document,window,i18n,context,original,view,input,calls,activations,notices,open,generate,confirm,pauses:()=>pauses,reads:()=>reads};
}

test('pitch catalog contracts are paired, explicit and safely renderable in both locales',async t=>{
  assert.deepEqual(Object.keys(en).sort(),Object.keys(zh).sort());assert.deepEqual(Object.keys(en).sort(),Object.keys(schema).sort());
  const ui=await setup(t,'transposition');
  for(const language of ['zh-CN','en']){
    ui.i18n.setLocale(language);
    for(const [key,contract] of Object.entries(schema)){
      const params=Object.fromEntries(Object.entries(contract.params).map(([name,type])=>[name,type==='text'?'<source & literal>':type==='integer'?-1:2]));
      const value=ui.i18n.t(key,params);assert.equal(typeof value,'string');assert.notEqual(value,ui.i18n.t('i18n.unavailable'),key);
    }
  }
  assert.deepEqual(ui.i18n.getReports(),[]);
});

for(const kind of ['adaptation','transposition']){
  test(`${kind}: default Chinese and pending locale changes preserve controls, focus, draft, source and request`,async t=>{
    const pending=deferred(),ui=await setup(t,kind,{api:()=>pending.promise});ui.open();
    assert.equal(ui.i18n.locale,'zh-CN');assert.match(ui.$(`${kind}-title`).textContent,kind==='adaptation'?/调整音区/:/全谱移调/);
    assert.match(ui.$(`${kind}-close`).getAttribute('aria-label'),/关闭/);
    const controls=[...ui.$(`${kind}-dialog`).querySelectorAll('input,select,button')],before=clone(ui.context),inputValue=ui.input.value;
    ui.input.focus();ui.$(`${kind}-preview`).click();const request=ui.calls[0],reads=ui.reads();
    assert.match(ui.$(`${kind}-status`).textContent,/正在/);
    ui.i18n.setLocale('en');
    assert.match(ui.$(`${kind}-status`).textContent,/Preparing/);assert.equal(ui.$(`${kind}-close`).getAttribute('aria-label'),kind==='adaptation'?'Close octave adaptation':'Close semitone transposition');
    assert.deepEqual([...ui.$(`${kind}-dialog`).querySelectorAll('input,select,button')],controls);assert.equal(ui.document.activeElement,ui.input);assert.equal(ui.input.value,inputValue);assert.equal(ui.calls.length,1);assert.equal(ui.activations.length,0);assert.equal(ui.reads(),reads);assert.equal(ui.pauses(),1);assert.equal(request.signal.aborted,false);assert.deepEqual(ui.context,before);
    ui.i18n.setLocale('zh-CN');pending.resolve(copyResult(request.body.score,request.body.operation,kind));await settle();
    assert.match(ui.$(`${kind}-status`).textContent,/预览已就绪/);assert.equal(ui.$(`${kind}-result`).hidden,false);assert.equal(ui.calls.length,1);assert.deepEqual(ui.context,before);assert.deepEqual(ui.i18n.getReports(),[]);
  });

  test(`${kind}: reviewed and confirmed previews redraw in place, then activate exact preserved data once`,async t=>{
    const pending=deferred(),ui=await setup(t,kind,{activate:()=>pending.promise});ui.open();await ui.generate();ui.confirm();
    const dialog=ui.$(`${kind}-dialog`),confirm=ui.$(`${kind}-confirm`),button=ui.$(`${kind}-activate`),row=ui.$(`${kind}-diagnostics`).firstElementChild,note=ui.$(`${kind}-note-sample`).firstElementChild,resultTitle=ui.$(`${kind}-result-title`).textContent,sourceBytes=ui.context.score.source.content,rights=clone(ui.context.score.provenance),reads=ui.reads();
    confirm.focus();dialog.querySelector('details').setAttribute('open','');
    ui.i18n.setLocale('en');
    assert.equal(confirm.checked,true);assert.equal(button.disabled,false);assert.equal(ui.document.activeElement,confirm);assert.equal(dialog.querySelector('details').hasAttribute('open'),true);assert.equal(ui.$(`${kind}-diagnostics`).firstElementChild,row);assert.equal(ui.$(`${kind}-note-sample`).firstElementChild,note);assert.equal(ui.$(`${kind}-result-title`).textContent,resultTitle);assert.match(ui.$(`${kind}-result-summary`).textContent,kind==='adaptation'?/\+1 octave/:/\+12 semitones/);assert.equal(ui.reads(),reads);assert.equal(ui.calls.length,1);assert.equal(ui.activations.length,0);assert.equal(ui.context.score.source.content,sourceBytes);assert.deepEqual(ui.context.score.provenance,rights);
    assert.match(ui.$(`${kind}-diagnostics`).textContent,/Original technical details/);assert.match(ui.$(`${kind}-diagnostics`).textContent,/<img src=x onerror=bad\(\)> 原文/);assert.equal(dialog.querySelector('img'),null);
    button.click();assert.equal(ui.activations.length,1);const [activated,signal]=ui.activations[0],envelope=JSON.parse(activated.source.content);assert.deepEqual(envelope.original,ui.original);
    const counts={reads:ui.reads(),calls:ui.calls.length};ui.i18n.setLocale('zh-CN');assert.match(ui.$(`${kind}-status`).textContent,/正在载入/);assert.equal(signal.aborted,false);assert.equal(ui.activations.length,1);assert.equal(ui.calls.length,counts.calls);assert.equal(ui.reads(),counts.reads);assert.equal(confirm.checked,true);
    pending.resolve(true);await settle();assert.equal(dialog.open,false);assert.equal(ui.notices.length,1);assert.equal(typeof ui.notices[0],'function');assert.match(ui.notices[0](),/已载入/);ui.i18n.setLocale('en');assert.match(ui.notices[0](),/copy loaded/);assert.equal(ui.notices.length,1);assert.deepEqual(ui.i18n.getReports(),[]);
  });

  test(`${kind}: local validation errors translate by identity and unknown engine prose stays literal`,async t=>{
    const literal='Choose a nonzero whole-number shift from −127 to +127 semitones. <svg onload=bad()> 原文 '+ 'x'.repeat(9000),ui=await setup(t,kind,{api:()=>{throw Error(literal)}});ui.open();ui.input.value='0';await ui.generate();
    assert.match(ui.$(`${kind}-status`).textContent,/非零的整数/);assert.equal(ui.calls.length,0);ui.i18n.setLocale('en');assert.match(ui.$(`${kind}-status`).textContent,/Choose a nonzero whole-number/);assert.equal(ui.calls.length,0);
    ui.input.value=kind==='adaptation'?'1':'12';await ui.generate();assert.ok(ui.$(`${kind}-status`).textContent.endsWith(literal));ui.i18n.setLocale('zh-CN');assert.ok(ui.$(`${kind}-status`).textContent.endsWith(literal));assert.match(ui.$(`${kind}-status`).textContent,/原始技术/);assert.equal(ui.$(`${kind}-status`).querySelector('svg'),null);assert.equal(ui.calls.length,1);assert.equal(ui.activations.length,0);assert.deepEqual(ui.i18n.getReports(),[]);
  });

  test(`${kind}: restore review and confirmation remain intact across language changes`,async t=>{
    const ui=await setup(t,kind),operation=kind==='adaptation'?{part_id:null,octaves:1}:{semitones:12},copy=copyResult(ui.original,operation,kind).compilation;
    ui.context.score=copy.score;ui.context.timeline=copy.timeline;ui.view.scoreChanged();ui.open();ui.$(`${kind}-restore-preview`).click();await settle();ui.confirm();
    assert.equal(ui.$(`${kind}-activate`).textContent,'恢复原稿');assert.equal(ui.$(`${kind}-confirm`).checked,true);const request=ui.calls[0],reads=ui.reads();
    ui.i18n.setLocale('en');assert.equal(ui.$(`${kind}-activate`).textContent,'Restore original now');assert.match(ui.$(`${kind}-status`).textContent,/Original preview ready/);assert.equal(ui.$(`${kind}-confirm`).checked,true);assert.equal(ui.$(`${kind}-activate`).disabled,false);assert.equal(ui.reads(),reads);assert.equal(request.signal.aborted,false);assert.equal(ui.calls.length,1);
    ui.$(`${kind}-activate`).click();await settle();assert.deepEqual(ui.activations[0][0],ui.original);assert.equal(ui.activations.length,1);assert.deepEqual(ui.i18n.getReports(),[]);
  });
}

test('source part names and unknown modes stay complete literal text, while known mode chrome translates',async t=>{
  const original=clone(fixture),literal='<untrusted mode & name> '+ '源'.repeat(9000);original.parts[0].name=literal;original.keys.push({at:{numerator:1,denominator:3},fifths:0,mode:literal});
  const semitone=await setup(t,'transposition',{original});semitone.open();await semitone.generate();const keys=semitone.$('transposition-key-sample'),rows=[...keys.children];assert.match(keys.textContent,/C 大调/);assert.ok(keys.textContent.includes(literal));semitone.i18n.setLocale('en');assert.match(keys.textContent,/C major/);assert.ok(keys.textContent.includes(literal));assert.deepEqual([...keys.children],rows);assert.equal(keys.querySelector('untrusted'),null);assert.deepEqual(semitone.i18n.getReports(),[]);
  const octave=await setup(t,'adaptation',{original});octave.context.part='piano';octave.open();octave.$('adaptation-scope').value='selected';await octave.generate();assert.ok(octave.$('adaptation-scope-note').textContent.endsWith(literal));assert.ok(octave.$('adaptation-result-summary').textContent.endsWith(literal));octave.i18n.setLocale('en');assert.ok(octave.$('adaptation-scope-note').textContent.endsWith(literal));assert.ok(octave.$('adaptation-result-summary').textContent.endsWith(literal));assert.deepEqual(octave.i18n.getReports(),[]);
});

test('no-key preview and empty-pitch restored range translate without inventing source metadata',async t=>{
  const original=clone(fixture);original.keys=[];const ui=await setup(t,'transposition',{original});ui.open();await ui.generate();const noKeys=ui.$('transposition-key-sample').firstElementChild;assert.equal(noKeys.textContent,'原稿没有调号，不会自动添加。');ui.i18n.setLocale('en');assert.equal(noKeys.textContent,'No key signatures in the original; none invented.');assert.equal(ui.context.score.keys.length,0);
  ui.$('transposition-close').click();const silent=clone(ui.original);silent.parts[0].notes.forEach(note=>note.pitch=null);const silentCopy=copyResult(silent,{semitones:12},'transposition').compilation;ui.context.score=silentCopy.score;ui.context.timeline=silentCopy.timeline;ui.view.scoreChanged();ui.open();ui.$('transposition-restore-preview').click();await settle();assert.match(ui.$('transposition-range-summary').textContent,/No pitched notes → No pitched notes/);ui.i18n.setLocale('zh-CN');assert.match(ui.$('transposition-range-summary').textContent,/没有带音高的音符 → 没有带音高的音符/);assert.deepEqual(ui.i18n.getReports(),[]);
});

test('pure pitch validation errors retain English diagnostics and explicit stable review keys',()=>{
  for(const [action,key,fragment] of [
    [()=>octaveOperation('all',null,0),'octaveInvalid',/nonzero whole-number/],
    [()=>octaveOperation('selected',null,1),'partInvalid',/specific Practice part/],
    [()=>validateAdaptationPreview({},fixture,{part_id:null,octaves:1}),'octavePreviewInvalid',/preserve/],
    [()=>semitoneOperation(0),'semitoneInvalid',/nonzero whole-number/],
    [()=>validateTranspositionPreview({},fixture,{semitones:12},compilation(fixture).timeline),'semitonePreviewInvalid',/preserve/],
    [()=>validateTranspositionRestore({},fixture),'restoreInvalid',/complete recorded original/],
  ])assert.throws(action,error=>{assert.equal(error.reviewKey,`review.pitch.${key}`);assert.match(error.message,fragment);return true});
});

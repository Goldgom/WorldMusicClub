import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {pitchModErrorText,setupPitchModView} from '../web/pitch-mod-view.js';

const tick=()=>new Promise(resolve=>setImmediate(resolve));
const categories=[
 ['pitch_mod_spelling',/note spellings and key signatures/,/音名拼写和调号/],
 ['pitch_mod_midi_range',/MIDI 0–127/,/MIDI 0–127/],
 ['response_body_limit',/processing or response-size limit/,/处理资源或响应大小限制/],
 ['library_response_limit',/processing or response-size limit/,/处理资源或响应大小限制/],
 ['pitch_mod_renderer',/source renderer/,/来源渲染器/],
];
for(const locale of ['en','zh-CN'])test(`typed pitch errors distinguish notation, MIDI, budget and renderer from hardware: ${locale}`,()=>{
 const outputs=[];
 for(const [code,en,zh]of categories){const result=pitchModErrorText(locale,{code,message:'Backend source-specific detail'});assert.match(result,locale==='en'?en:zh);assert.doesNotMatch(result,/Backend/);assert.match(result,locale==='en'?/instrument/:/乐器/);outputs.push(result);}
 assert.equal(new Set(outputs).size,4,'Both response budget routes intentionally share one message');
 const spelling=outputs[0];assert.match(spelling,locale==='en'?/another shift or restore 0/:/其他半音数，或恢复为 0/);assert.match(spelling,locale==='en'?/whole shift was rejected/:/整次移调已被拒绝/);
});

for(const locale of ['en','zh-CN'])test(`spelling rejection retains the draft and current song and supports locale refresh: ${locale}`,async()=>{
 const {document,window}=parseHTML('<html><body><main></main></body></html>'),i18n={locale},context={score:{id:'original-generic-exercise',parts:[]},compiled:{timeline:{notes:[{midi:60}],duration_ms:1000}},cleanSong:null},before=JSON.stringify(context);let requests=0,prepared=0;
 const view=setupPitchModView({document,parent:document.querySelector('main'),i18n,onCheck:async()=>{requests++;throw Object.assign(new Error('Private backend detail'),{code:'pitch_mod_spelling'});},onPrepared:()=>prepared++});view.open(context);
 const input=document.getElementById('song-mod-pitch-shift'),status=document.getElementById('song-mod-pitch-status');input.value='-2';input.dispatchEvent(new window.Event('input'));document.getElementById('song-mod-pitch-check').click();await tick();
 assert.equal(requests,1);assert.equal(prepared,0);assert.equal(input.value,'-2');assert.equal(view.canApply(),false);assert.equal(status.dataset.pitchModStatus,'rejected');assert.equal(status.textContent,pitchModErrorText(locale,{code:'pitch_mod_spelling'}));assert.equal(JSON.stringify(context),before);assert.equal(document.getElementById('song-mod-pitch-summary').dataset.pitchModSemitones,'0');
 i18n.locale=locale==='en'?'zh-CN':'en';view.update();assert.equal(status.textContent,pitchModErrorText(i18n.locale,{code:'pitch_mod_spelling'}));assert.equal(input.value,'-2');assert.equal(view.canApply(),false);
 document.getElementById('song-mod-pitch-zero').click();assert.equal(input.value,'0');assert.equal(view.canApply(),true);assert.equal(requests,1);view.close();assert.equal(JSON.stringify(context),before);
});

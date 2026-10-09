import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {sourceInstrumentDetailPage,sourceInstrumentDetailRows,sourceInstrumentSummary,renderSourceInstrumentDetails,SOURCE_DETAIL_PAGE_SIZE,SOURCE_DETAIL_TEXT_PAGE_SIZE} from '../web/source-instrument-details-view.js';
import {setupSongModView} from '../web/song-mod-view.js';
import {createSongMod} from '../web/song-mod.js';

const part={id:'p1',name:'Piano named in a part',notes:[]};
function numericDetails(name='Name supplied by the file'){
 return {parts:[{part_id:part.id,track_id:'t1',route_id:'r1',channel_id:'c1',source_attack_count:9,notated_note_count:8,key_range:{lowest:30,highest:100},selection_summary:{status:'known',observed_selections:[{program:40,bank_most_significant:121,bank_least_significant:0}]}}],tracks:[{id:'t1',source_track_index:0,names:[{role:'instrument_name',source_route_index:0,utf8:name,channel_prefix_scope:'unscoped'}]}],routes:[{id:'r1',source_route_index:0}],channels:[{id:'c1',channel:0}]};
}
function identityIndex(overrides={}){
 return {parts:new Map([[part.id,{part_id:part.id,attack_count:9,supported_count:0,known_unsupported_count:9,unresolved_count:0,mixed:false,classification:'known_unsupported',identities:[{identity_key:'gm1:40',label:'Violin',count:9}],reasons:[],...overrides}]])};
}
function allRows(details,index,locale='en'){
 const options={identityIndex:index,identityStatus:'ready'},first=sourceInstrumentDetailPage(part,details,locale,'ready',null,0,options),rows=[];
 for(let page=0;page<first.pageCount;page++)rows.push(...sourceInstrumentDetailRows(part,details,locale,'ready',null,page,options));
 return rows;
}
function render(details,index,extra={}){
 const {document,window}=parseHTML('<dl></dl>'),root=document.querySelector('dl');
 renderSourceInstrumentDetails({document,root,part,details,locale:'en',status:'ready',identityIndex:index,identityStatus:'ready',...extra});
 return {document,window,root};
}

test('known analyzed identity, unchanged Rust label and counts remain separate from literal file names',()=>{
 const details=numericDetails('Piano declared in metadata'),index=identityIndex(),before=JSON.stringify(details),rows=allRows(details,index),value=label=>rows.find(row=>row[0]===label)?.[1];
 assert.equal(value('Analyzed original identity'),'Violin · 9 source attacks');
 assert.equal(value('Identity analysis classification'),'Known unsupported by the provisional product list');
 assert.match(value('Instrument name in file'),/^Piano declared in metadata · track-wide declaration/);
 assert.equal(value('Attack classification counts'),'0 supported · 9 known unsupported · 0 unresolved');
 assert.equal(value('MIDI program / bank MSB / LSB (0–127)'),'40 / 121 / 0');
 assert.match(value('Instrument namespace'),/Unknown in numeric-only evidence.*Independent identity analysis/);
 assert.match(value('Identity analysis scope'),/limited reviewed identity subset.*Unreviewed entries remain unresolved.*Informational only.*do not decide practice support/);
 const summary=sourceInstrumentSummary(part,details,'en',index);
 assert.match(summary,/^Analyzed original instrument: Violin × 9/);
 assert.match(summary,/9 known unsupported.*Informational only.*Instrument name in file: Piano declared in metadata/);
 assert.doesNotMatch(summary,/cannot practice|machine.only|blocked|not identified/);
 assert.equal(JSON.stringify(details),before);
});

test('mixed identity preserves all known names and supported, known-unsupported and unresolved attack counts',()=>{
 const index=identityIndex({supported_count:4,known_unsupported_count:3,unresolved_count:2,mixed:true,classification:'unresolved',identities:[{identity_key:'gm1:0',label:'Acoustic Grand Piano',count:4},{identity_key:'gm1:40',label:'Violin',count:3}],reasons:[{code:'unknown_tuple',count:2}]}),rows=allRows(numericDetails(),index),flat=rows.flat().join(' ');
 assert.match(flat,/Acoustic Grand Piano · 4 source attacks/);
 assert.match(flat,/Violin · 3 source attacks/);
 assert.match(flat,/4 supported · 3 known unsupported · 2 unresolved/);
 assert.match(flat,/Mixed · Unresolved/);
 assert.match(flat,/outside the reviewed identity subset · 2 source attacks/);
 const summary=sourceInstrumentSummary(part,numericDetails(),'en',index);
 assert.match(summary,/Acoustic Grand Piano × 4 · Violin × 3.*Mixed.*4 supported · 3 known unsupported · 2 unresolved/);
 assert.doesNotMatch(summary,/Original instrument: not identified/);
});

test('unresolved and no-attack parts never acquire an identity from file or part names',()=>{
 const unresolved=identityIndex({known_unsupported_count:0,unresolved_count:9,classification:'unresolved',identities:[],reasons:[{code:'missing_gm_declaration',count:9}]}),empty=identityIndex({attack_count:0,known_unsupported_count:0,classification:'unresolved',identities:[]});
 const details=numericDetails('Acoustic Grand Piano');
 for(const index of [unresolved,empty]){
  const rows=allRows(details,index),summary=sourceInstrumentSummary(part,details,'en',index);
  assert.equal(rows.find(([label])=>label==='Original instrument')[1],'Not identified');
  assert.equal(rows.some(([label])=>label==='Analyzed original identity'),false);
  assert.match(summary,/^Analyzed original instrument: not identified/);
  assert.match(summary,/Instrument name in file: Acoustic Grand Piano/);
  assert.doesNotMatch(summary,/Piano named in a part/);
 }
 assert.match(allRows(details,unresolved).flat().join(' '),/No admitted General MIDI declaration · 9 source attacks/);
 assert.match(allRows(details,empty).flat().join(' '),/No source note attacks; no instrument identity was inferred/);
 assert.match(sourceInstrumentSummary(part,details,'en',empty),/No source note attacks; identity unresolved/);
 // A missing part ID must not borrow another part's analysis.
 assert.doesNotMatch(sourceInstrumentSummary({id:'other',name:'Violin'},details,'en',identityIndex()),/Violin/);
});

test('both locales translate headings, classifications, limits and every reason while Rust instrument labels stay unchanged',()=>{
 const codes=['missing_gm_declaration','gm_off','missing_program','missing_explicit_bank','unknown_tuple','explicit_routing_out_of_scope','targeted_sysex','fragment_or_escape','opaque_sound_boundary','cross_track_order_uncertain','invalid_program','optional_drum_channel_behavior','non_basic_profile','analysis_limit'];
 const index=identityIndex({supported_count:1,known_unsupported_count:0,unresolved_count:8,classification:'unresolved',mixed:true,identities:[{identity_key:'opaque-key-from-rust',label:'Untranslated Rust Label',count:1}],reasons:codes.map(code=>({code,count:1}))});
 for(const locale of ['en','zh-CN']){
  const rows=allRows(numericDetails('Literal file label'),index,locale),flat=rows.flat().join(' '),summary=sourceInstrumentSummary(part,numericDetails('Literal file label'),locale,index);
  assert.match(flat,/Untranslated Rust Label/);assert.match(summary,/Untranslated Rust Label/);assert.match(flat,/Literal file label/);
  assert.equal(rows.filter(([label])=>label===(locale==='en'?'Unresolved identity reason':'身份未解析原因')).length,codes.length);
  for(const code of codes)assert.equal(flat.includes(code),false);
  assert.match(flat,locale==='en'?/Mixed · Unresolved/:/混合 · 未解析/);
  assert.match(flat,locale==='en'?/limited reviewed identity subset/:/有限的已核对身份子集/);
  assert.match(flat,locale==='en'?/Informational only/:/仅供参考/);
 }
 const supported=identityIndex({classification:'supported',supported_count:9,known_unsupported_count:0});
 assert.match(allRows(null,supported).flat().join(' '),/Supported by the provisional product list/);
 assert.match(allRows(null,supported,'zh-CN').flat().join(' '),/在临时产品支持列表内/);
});

test('optional loading, unsupported, absent and error states are truthful without altering canonical numeric disclosure',()=>{
 const numeric=numericDetails(),canonical=sourceInstrumentDetailRows(part,numeric);
 assert.equal(canonical.find(([label])=>label==='Instrument namespace')[1],'Unknown; numeric program values do not identify an acoustic instrument or confirm General MIDI.');
 assert.equal(canonical.some(([label])=>label==='Identity analysis scope'),false);
 for(const locale of ['en','zh-CN']){
  const text=(status,error)=>sourceInstrumentDetailRows(part,numeric,locale,'ready',null,0,{identityStatus:status,identityError:error}).flat().join(' ');
  assert.match(text('loading'),locale==='en'?/Identity analysis Loading/:/身份分析 加载中/);
  assert.match(text('unsupported'),locale==='en'?/Available only for Basic MIDI sources/:/仅适用于 Basic MIDI 来源/);
  assert.match(text('absent'),locale==='en'?/No analyzed identity is available/:/没有可用的已分析身份/);
  assert.match(text('error','<img src=x> failure'),/<img src=x> failure/);
 }
 const {root}=render(null,null,{identityStatus:'error',identityError:'<script>unsafe()</script>'});
 assert.equal(root.querySelector('script'),null);assert.match(root.textContent,/<script>unsafe\(\)<\/script>/);
});

test('hostile long identity labels and metadata stay literal and paginated without splitting surrogate pairs',()=>{
 const hostile='<img src=x onerror=unsafe()> '+'🎻'.repeat(1100),index=identityIndex({identities:[{identity_key:'opaque',label:hostile,count:9}]}),details=numericDetails('<script>unsafe()</script>');
 const summary=sourceInstrumentSummary(part,details,'en',index);
 assert.ok(summary.length<500);assert.match(summary,/<img src=x/);assert.match(summary,/continued in details/);assert.doesNotMatch(summary,/\uFFFD/);
 const {root}=render(details,index);assert.equal(root.querySelector('img'),null);assert.equal(root.querySelector('script'),null);assert.match(root.textContent,/<img src=x/);
 assert.ok(root.querySelectorAll('dt').length<=SOURCE_DETAIL_PAGE_SIZE+1);
 const identityTerm=[...root.querySelectorAll('dt')].find(node=>node.textContent==='Analyzed original identity'),description=identityTerm.nextElementSibling;
 assert.ok(description.querySelector('span').textContent.length<=SOURCE_DETAIL_TEXT_PAGE_SIZE+30);
 assert.match(description.textContent,/Remaining text is on other pages/);
 const before=description.querySelector('span').textContent;
 [...description.querySelectorAll('button')].find(button=>button.textContent==='Next text').click();
 const nextDescription=[...root.querySelectorAll('dt')].find(node=>node.textContent==='Analyzed original identity').nextElementSibling;
 assert.notEqual(nextDescription.querySelector('span').textContent,before);assert.match(nextDescription.textContent,/Text positions 501–/);
 for(const value of [before,nextDescription.querySelector('span').textContent])assert.doesNotMatch(value,/(?:^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]|[\uD800-\uDBFF](?:$|[^\uDC00-\uDFFF])/);
});

test('large identity and reason lists are read lazily, counted truthfully and bounded on every detail page',()=>{
 let reads=0;
 const identities=Array.from({length:50000},(_,index)=>({identity_key:`key${index}`,count:1,get label(){reads++;return `Label ${index} `+'x'.repeat(600);}}));
 const index=identityIndex({attack_count:50000,known_unsupported_count:50000,identities,reasons:Array.from({length:50000},()=>({code:'unknown_tuple',count:1}))}),options={identityIndex:index,identityStatus:'ready'};
 const first=sourceInstrumentDetailPage(part,null,'en','absent',null,0,options);
 assert.equal(first.totalRows,100007);assert.equal(first.pageCount,5001);assert.equal(first.rows.length,SOURCE_DETAIL_PAGE_SIZE);assert.ok(reads<=SOURCE_DETAIL_PAGE_SIZE);
 reads=0;const summary=sourceInstrumentSummary(part,null,'en',index);assert.equal(reads,3);assert.ok(summary.length<700);assert.match(summary,/49997 more identities in details/);
 const rows=sourceInstrumentDetailRows(part,null,'en','absent',null,0,options);assert.ok(rows.every(([,value])=>value.length<SOURCE_DETAIL_TEXT_PAGE_SIZE+50));
 const {root,window}=render(null,index,{status:'absent'});
 assert.ok(root.textContent.length<15000);assert.ok(root.querySelectorAll('dt').length<=SOURCE_DETAIL_PAGE_SIZE+1);
 assert.match(root.textContent,/Details 1–20 of 100007/);
 const jump=root.querySelector('.song-mod-detail-pages input');jump.value='5001';jump.dispatchEvent(Object.assign(new window.Event('keydown'),{key:'Enter'}));
 assert.match(root.textContent,/Details 100001–100007 of 100007/);assert.ok(root.querySelectorAll('dt').length<=SOURCE_DETAIL_PAGE_SIZE+1);
 assert.equal([...root.querySelectorAll('button')].find(node=>node.textContent==='Next details').disabled,true);
 assert.equal(identities.length,50000);assert.equal(index.parts.get(part.id).reasons.length,50000);
});

function songModFixture(){
 const {document,window}=parseHTML('<html><body><section class="preview-copy"></section><div class="preview-actions"></div><div id="stage-hud"></div><div id="workspace"></div></body></html>');
 Object.defineProperty(window.HTMLSelectElement.prototype,'value',{configurable:true,get(){return this.querySelector('option[selected]')?.value||this.querySelector('option')?.value||'';},set(value){for(const option of this.querySelectorAll('option'))option.toggleAttribute('selected',option.value===String(value));}});
 window.HTMLElement.prototype.showModal=function(){this.open=true;};window.HTMLElement.prototype.close=function(){this.open=false;};
 const listeners=[],i18n={locale:'en',subscribe:fn=>listeners.push(fn),setLocale(locale){this.locale=locale;listeners.forEach(fn=>fn());}};
 const score={id:'source',parts:[part]},mod=createSongMod({songId:score.id,sourceRevision:{kind:'canonical-score-v1',value:'e'.repeat(64)}},{layout:'complete',showOtherParts:true,parts:[{partId:part.id,performer:'human',instrument:'reed',liveInstrument:'follow',muted:false,visible:true}]});
 let context={score,mod,original:mod,capabilities:{instruments:true,liveAudio:true},sourceInstrumentDetails:numericDetails(),sourceInstrumentDetailsToken:{},sourceInstrumentDetailsStatus:'ready',sourceIdentityToken:{},sourceIdentityStatus:'loading'},applied=null;
 const view=setupSongModView({document,i18n,getContext:()=>context,onApply:async options=>{applied=options.mod;context={...context,mod:options.mod};}});
 const update=next=>{context={...context,...next};view.update({preview:context,canStart:true});};update({});view.open('preview');
 return {document,window,i18n,view,update,get context(){return context;},get applied(){return applied;},$:id=>document.getElementById(id)};
}

test('identity refresh is independently token-gated and does not alter drafts, admission or activity summaries',async()=>{
 const f=songModFixture(),details=f.document.querySelector('[data-source-details="p1"]'),actor=f.document.querySelector('[data-mod-performer="p1"]'),identityToken=f.context.sourceIdentityToken,numericToken=f.context.sourceInstrumentDetailsToken;
 details.open=true;details.dispatchEvent(new f.window.Event('toggle'));actor.value='machine';actor.dispatchEvent(new f.window.Event('change'));
 const previewBefore=f.$('song-mod-preview-summary').textContent,policyBefore=f.$('song-mod-input-routing').textContent;
 // Identity is allowed to finish even if numeric metadata has a different token.
 f.update({sourceInstrumentDetailsToken:{},sourceIdentityIndex:identityIndex(),sourceIdentityStatus:'ready'});
 assert.match(details.textContent,/Violin/);assert.equal(details.open,true);assert.equal(actor.value,'machine');assert.equal(f.$('song-mod-apply').disabled,false);
 assert.equal(f.$('song-mod-preview-summary').textContent,previewBefore);assert.equal(f.$('song-mod-input-routing').textContent,policyBefore);
 // Matching numeric token and part ID must never authorize a different identity source.
 f.update({sourceInstrumentDetailsToken:numericToken,sourceIdentityToken:{},sourceIdentityIndex:identityIndex({identities:[{identity_key:'new-source',label:'Wrong Source Identity',count:9}]})});
 assert.doesNotMatch(details.textContent,/Wrong Source Identity/);assert.match(details.textContent,/Violin/);
 f.i18n.setLocale('zh-CN');assert.match(details.textContent,/分析所得原始乐器/);assert.match(details.textContent,/Violin/);
 f.i18n.setLocale('en');
 f.update({sourceIdentityToken:identityToken,sourceIdentityIndex:null,sourceIdentityStatus:'error',sourceIdentityError:'Read failed'});
 assert.match(details.textContent,/Read failed/);assert.doesNotMatch(details.textContent,/Analyzed original instrument: Violin/);
 assert.equal(actor.value,'machine');assert.equal(f.$('song-mod-apply').disabled,false);
 f.$('song-mod-apply').click();await new Promise(resolve=>setImmediate(resolve));
 assert.equal(f.applied.config.parts[0].performer,'machine');assert.equal(f.applied.config.parts[0].instrument,'reed');
 assert.doesNotMatch(JSON.stringify(f.applied),/sourceIdentity|Violin|identity_key/);
});

test('closing and reopening the dialog uses the new source identity even when part IDs are reused',()=>{
 const f=songModFixture();f.update({sourceIdentityStatus:'ready',sourceIdentityIndex:identityIndex()});assert.match(f.$('song-mod-parts').textContent,/Violin/);
 f.view.close();f.update({sourceIdentityToken:{},sourceIdentityStatus:'ready',sourceIdentityIndex:identityIndex({identities:[{identity_key:'second-source',label:'Second source label',count:9}]})});f.view.open('preview');
 assert.match(f.$('song-mod-parts').textContent,/Second source label/);assert.doesNotMatch(f.$('song-mod-parts').textContent,/Violin/);
 f.view.close();f.update({sourceIdentityToken:undefined,sourceIdentityIndex:null,sourceIdentityStatus:'unsupported'});f.view.open('preview');
 assert.doesNotMatch(f.$('song-mod-parts').textContent,/Second source label/);
 const details=f.document.querySelector('[data-source-details="p1"]');details.open=true;details.dispatchEvent(new f.window.Event('toggle'));assert.match(details.textContent,/Available only for Basic MIDI sources/);
});

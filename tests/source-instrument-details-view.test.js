import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {sourceInstrumentDetailRows,sourceInstrumentDetailPage,renderSourceInstrumentDetails,SOURCE_DETAIL_PAGE_SIZE,SOURCE_DETAIL_TEXT_PAGE_SIZE} from '../web/source-instrument-details-view.js';
import {setupSongModView} from '../web/song-mod-view.js';
import {createSongMod} from '../web/song-mod.js';

const evidence=()=>({parts:[{part_id:'p1',track_id:'t1',route_id:'r1',channel_id:'c1',source_attack_count:8,notated_note_count:7,key_range:{lowest:30,highest:100},selection_summary:{status:'changes',observed_selections:[{program:0,bank_most_significant:0,bank_least_significant:null},{program:127,bank_most_significant:1,bank_least_significant:2}],attacks_without_declared_program:1,attacks_with_ambiguous_selection:2}}],tracks:[{id:'t1',source_track_index:0,names:[{role:'track_name',utf8:'Lead',channel_prefix_scope:'unscoped'},{role:'instrument_name',utf8:'<img src=x onerror=alert(1)> Violin',channel_prefix_scope:'declared_channel',channel_prefix:0},{role:'program_name',utf8:null,bytes:[255],channel_prefix_scope:'invalid_declaration'}]}],routes:[{id:'r1'}],channels:[{id:'c1',channel:0}]});

test('source details retain declared names and numeric zero values without guessing a GM instrument',()=>{
 const rows=sourceInstrumentDetailRows({id:'p1'},evidence());
 const value=label=>rows.find(row=>row[0]===label)?.[1];
 assert.equal(value('Original instrument'),'Not identified');assert.equal(value('MIDI channel (1–16)'),'1');
 assert.equal(value('MIDI program / bank MSB / LSB (0–127)'),'0 / 0 / Unknown');
 assert.equal(value('Source note attacks / notated notes'),'8 / 7');assert.equal(value('MIDI key range'),'30–100');
 assert.match(value('Track name in file'),/Lead.*track-wide/);assert.match(value('Instrument name in file'),/Violin.*channel 1/);
 assert.match(value('Program name in file'),/encoding unknown.*invalid channel/);
 assert.match(value('Instrument namespace'),/do not identify/);assert.doesNotMatch(JSON.stringify(rows),/Acoustic Grand Piano|machine-only/);
 const {document}=parseHTML('<dl></dl>'),root=document.querySelector('dl');renderSourceInstrumentDetails({document,root,part:{id:'p1'},details:evidence(),locale:'en'});
 assert.equal(root.querySelector('img'),null);assert.match(root.textContent,/<img src=x/);
});

test('missing metadata, loading, format limitation and failures remain distinct and bilingual',()=>{
 const part={id:'missing',name:'Piano',notes:[{pitch:{step:'C'}},{pitch:null}]};
 for(const locale of ['en','zh-CN']){
  const flat=(status,error)=>sourceInstrumentDetailRows(part,null,locale,status,error).flat().join(' ');
  assert.match(flat('loading'),locale==='en'?/Loading/:/加载中/);
  assert.match(flat('unsupported'),locale==='en'?/does not determine practice support/:/不代表不支持演奏/);
  assert.match(flat('error','test error'),/test error/);
  assert.match(flat('absent'),locale==='en'?/not an instrument identification/:/不能作为乐器识别/);
  assert.doesNotMatch(flat('absent'),/Original instrument Piano/);
 }
});

function fixture({conflict=false}={}){
 const {document,window}=parseHTML('<html><body><section class="preview-copy"></section><div class="preview-actions"></div><div id="stage-hud"></div><div id="workspace"></div></body></html>');
 Object.defineProperty(window.HTMLSelectElement.prototype,'value',{configurable:true,get(){return this.querySelector('option[selected]')?.value||this.querySelector('option')?.value||'';},set(value){for(const option of this.querySelectorAll('option'))option.toggleAttribute('selected',option.value===String(value));}});
 window.HTMLElement.prototype.showModal=function(){this.open=true;};window.HTMLElement.prototype.close=function(){this.open=false;};
 const listeners=[],i18n={locale:'en',subscribe:fn=>listeners.push(fn),setLocale(locale){this.locale=locale;listeners.forEach(fn=>fn());}};
 const score={id:'source',parts:[{id:'p1',name:'Lead',notes:[]},{id:'p2',name:'Other',notes:[]}]};
 const mod=createSongMod({songId:score.id,sourceRevision:{kind:'canonical-score-v1',value:'e'.repeat(64)}},{layout:'complete',showOtherParts:true,parts:score.parts.map((part,index)=>({partId:part.id,performer:index&&!conflict?'machine':'human',instrument:'reed',liveInstrument:index?'piano':'guitar',muted:false,visible:true}))});
 let context={score,mod,original:mod,capabilities:{instruments:true,liveAudio:true},sourceInstrumentDetailsToken:{},sourceInstrumentDetailsStatus:'loading'},applied=null;
 const view=setupSongModView({document,i18n,getContext:()=>context,onApply:async options=>{applied=options.mod;context={...context,mod:options.mod};}});
 const update=next=>{context={...context,...next};view.update({preview:context,canStart:true});};update({});view.open('preview');
 return {document,window,view,i18n,update,get context(){return context;},get applied(){return applied;},$:id=>document.getElementById(id)};
}
const settle=()=>new Promise(resolve=>setImmediate(resolve));

test('the live column is absent while Apply, Cancel, restore and locale changes preserve stored overrides',async()=>{
 const f=fixture(),before=structuredClone(f.context.mod);
 assert.equal(f.document.querySelector('[data-mod-live-instrument]'),null);assert.equal(f.document.querySelector('#song-mod-unify-sound'),null);assert.equal(f.$('song-mod-unify-row').hidden,true);
 f.i18n.setLocale('zh-CN');assert.doesNotMatch(f.$('song-mod-parts').textContent,/真人现场音色/);f.i18n.setLocale('en');
 f.$('song-mod-cancel').click();assert.deepEqual(f.context.mod,before);f.view.open('preview');f.$('song-mod-restore').click();f.$('song-mod-apply').click();await settle();
 assert.deepEqual(f.applied,before);assert.equal(f.applied.config.parts[0].liveInstrument,'guitar');
});

test('legacy conflict recovery is draft-only until Apply and resets only human overrides',async()=>{
 const f=fixture({conflict:true}),before=structuredClone(f.context.mod);
 assert.equal(f.$('song-mod-unify-row').hidden,false);assert.equal(f.$('song-mod-apply').disabled,true);
 f.$('song-mod-unify-human').click();assert.equal(f.$('song-mod-unify-row').hidden,true);assert.equal(f.$('song-mod-apply').disabled,false);assert.deepEqual(f.context.mod,before);
 f.$('song-mod-cancel').click();f.view.open('preview');assert.equal(f.$('song-mod-unify-row').hidden,false);
 f.$('song-mod-unify-human').click();f.$('song-mod-apply').click();await settle();assert.ok(f.applied.config.parts.every(part=>part.liveInstrument==='follow'));assert.ok(f.applied.config.parts.every(part=>part.instrument==='reed'));
});

test('same-source async metadata refresh preserves open disclosure and draft; stale-source update cannot repaint it',async()=>{
 const f=fixture(),details=f.document.querySelector('[data-source-details="p1"]');details.open=true;
 const actor=f.document.querySelector('[data-mod-performer="p1"]');actor.value='machine';actor.dispatchEvent(new f.window.Event('change'));
 f.update({sourceInstrumentDetails:evidence(),sourceInstrumentDetailsStatus:'ready'});assert.match(details.textContent,/Lead.*track-wide/);assert.equal(details.open,true);assert.equal(actor.value,'machine');
 const other=evidence();other.tracks[0].names[0].utf8='Wrong source';f.update({sourceInstrumentDetailsToken:{},sourceInstrumentDetails:other});assert.doesNotMatch(details.textContent,/Wrong source/);
 f.$('song-mod-apply').click();await settle();assert.equal(f.applied.config.parts[0].performer,'machine');assert.equal(f.applied.config.parts[0].liveInstrument,'guitar');
});


test('large evidence is lazy and paginated with truthful totals, bounded text, and native keyboard controls',()=>{
 const data=evidence(),names=Array.from({length:50000},(_,index)=>({role:'track_name',utf8:`Name ${index} `+'x'.repeat(600),channel_prefix_scope:'unscoped'}));
 data.tracks[0].names=names;data.parts[0].selection_summary.observed_selections=Array.from({length:50000},(_,index)=>({program:index%128,bank_most_significant:Math.floor(index/128)%128,bank_least_significant:null}));
 const first=sourceInstrumentDetailPage({id:'p1'},data);assert.equal(first.rows.length,SOURCE_DETAIL_PAGE_SIZE);assert.equal(first.totalRows,100011);assert.equal(first.pageCount,5001);
 assert.ok(first.rows.some(([label])=>label==='Source note attacks / notated notes'),'Core part facts remain on page one');
 const f=fixture();f.update({sourceInstrumentDetails:data,sourceInstrumentDetailsStatus:'ready'});const details=f.document.querySelector('[data-source-details="p1"]'),body=details.querySelector('dl');assert.equal(body.children.length,0,'Closed rows never duplicate source metadata');
 details.open=true;details.dispatchEvent(new f.window.Event('toggle'));assert.ok(body.querySelectorAll('dt').length<=SOURCE_DETAIL_PAGE_SIZE+1);assert.ok(body.textContent.length<20000);assert.match(body.textContent,/Details 1–20 of 100011/);assert.match(body.textContent,/Remaining text is on other pages/);
 const find=label=>[...body.querySelectorAll('button')].find(button=>button.textContent===label);
 assert.equal(find('Next details').tagName,'BUTTON');assert.equal(find('Next details').type,'button');find('Next details').click();assert.match(body.textContent,/Details 21–40 of 100011/);
 find('Next text').click();assert.match(body.textContent,/Text positions 501–/);assert.ok(body.querySelectorAll('dt').length<=SOURCE_DETAIL_PAGE_SIZE+1);
 const jump=body.querySelector('.song-mod-detail-pages input');jump.value='5001';jump.dispatchEvent(Object.assign(new f.window.Event('keydown'),{key:'Enter'}));assert.match(body.textContent,/Details 100001–100011 of 100011/);assert.equal(find('Next details').disabled,true);assert.ok(body.querySelectorAll('dt').length<=SOURCE_DETAIL_PAGE_SIZE+1);
 assert.equal(data.tracks[0].names.length,50000);assert.equal(data.parts[0].selection_summary.observed_selections.length,50000);
});

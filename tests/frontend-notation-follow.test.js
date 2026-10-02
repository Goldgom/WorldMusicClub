import test from 'node:test';
import assert from 'node:assert/strict';
import {createI18n} from '../web/i18n.js';
import {getAppI18n} from '../web/app-locale.js';
import {parseHTML} from 'linkedom';
import {setupWrittenCursor,WrittenCursorIndex} from '../web/written-cursor.js';
import {fixture} from './frontend-fixtures.js';
import {NotationNavigationIndex,sourceMeasurePage,setupNotationFollowing,basicNotationPage,createBasicNotationReveal} from '../web/notation-follow.js';
function setup(){
 const score=structuredClone(fixture);score.measures=[7,7,19,0].map((number,index)=>({number,at:{numerator:index,denominator:1},length:{numerator:1,denominator:1}}));score.parts[0].notes.push({id:'rest',pitch:null,at:{numerator:2,denominator:1},duration:{numerator:1,denominator:1}});score.repeats=[{from:{numerator:1,denominator:1},to:{numerator:3,denominator:1},times:2}];
 const notes=[['attack-0','c4',0],['attack-1','e4',500],['attack-2','e4',1500]].map(([id,source,start_ms])=>({id,source_note_id:source,source_note_ids:[source],part_id:'piano',start_ms,duration_ms:500}));const timeline={notes,duration_ms:3000};
 const occurrences=[0,1,2,1,2,3].map((index,position)=>({id:`m-${position}`,source_measure_index:index,measure_number:score.measures[index].number,source_from:score.measures[index].at,source_to:{numerator:index+1,denominator:1},start_ms:position*500,end_ms:(position+1)*500,repeat_region_index:position>0&&position<5?0:null,repeat_pass:position>0&&position<5?position<3?1:2:null,repeat_times:position>0&&position<5?2:null,written_note_ids:index===0?['c4']:index===1?['e4']:index===2?['rest']:[],continuing_note_ids:[]}));
 return{score,timeline,response:{version:1,source_measure_count:4,duration_ms:3000,occurrences,sounding_groups:notes.map(note=>({occurrence_id:note.id,part_id:note.part_id,source_note_ids:note.source_note_ids,start_ms:note.start_ms,end_ms:note.start_ms+note.duration_ms})),diagnostics:[]}};
}
test('Rust occurrence lookup uses half-open boundaries through duplicate labels, repeat passes and rests',()=>{const{score,timeline,response}=setup(),before=JSON.stringify({score,timeline,response}),index=new NotationNavigationIndex(response,score,timeline);assert.equal(index.at(-1),null);assert.equal(index.at(0).source_measure_index,0);assert.equal(index.at(499.999).repeat_pass,null);assert.equal(index.at(500).source_measure_index,1);assert.equal(index.at(1000).written_note_ids[0],'rest');assert.equal(index.at(1500).source_measure_index,1);assert.equal(index.at(1500).repeat_pass,2);assert.equal(index.at(2999).measure_number,0);for(const value of [3000,3001,Infinity,NaN])assert.equal(index.at(value),null);assert.equal(index.soundingGroups.get('attack-2').source_note_ids[0],'e4');assert.equal(index.sourceNotes.get('rest').note.pitch,null);assert.equal(JSON.stringify({score,timeline,response}),before);});
test('source measure paging uses ordinal indices rather than printed labels and is bounded',()=>{assert.equal(sourceMeasurePage(0,8),1);assert.equal(sourceMeasurePage(7,8),1);assert.equal(sourceMeasurePage(8,8),9);assert.equal(sourceMeasurePage(31,16),17);for(const[index,size]of[[-1,8],[0,0],[1,65],[1.5,8]])assert.throws(()=>sourceMeasurePage(index,size));});
test('navigation schema, source identities, repeat metadata and compiled tie identities must agree before following',()=>{for(const mutate of[r=>r.version=2,r=>r.source_measure_count=5,r=>r.duration_ms=2999,r=>r.occurrences[1].start_ms=501,r=>r.occurrences[1].measure_number=8,r=>r.occurrences[1].repeat_pass=3,r=>r.occurrences[1].repeat_region_index=1,r=>r.occurrences[0].written_note_ids=['unknown'],r=>r.occurrences[0].written_note_ids=['e4'],r=>r.occurrences[0].source_to={numerator:2,denominator:1},r=>r.occurrences[0].continuing_note_ids=['c4'],r=>r.sounding_groups[0].source_note_ids=['e4'],r=>r.sounding_groups[0].end_ms=501]){const{score,timeline,response}=setup();mutate(response);assert.throws(()=>new NotationNavigationIndex(response,score,timeline),{code:'notation_followInvalid'})}});
function environment(i18n=createI18n({locale:'en'})){const prior={document:globalThis.document,window:globalThis.window},checkbox={checked:false,addEventListener(_,handler){this.change=handler}},status={textContent:'',setAttribute(){}},calls=[],pages=[];let context=setup(),playback={position:1500,running:true};const view={isActive:()=>true,followMeasure:index=>pages.push(index),navigationState:()=>({ready:true})};globalThis.document={getElementById:id=>id==='engraving-follow'?checkbox:status};globalThis.window={addEventListener(){}};const follow=setupNotationFollowing({i18n,api:()=>new Promise((resolve,reject)=>calls.push({resolve,reject})),getContext:()=>context,getPlayback:()=>playback,view});return{follow,checkbox,status,calls,pages,context,setContext:value=>context=value,setPlayback:value=>playback=value,restore(){follow.suspend();for(const[key,value]of Object.entries(prior))if(value===undefined)delete globalThis[key];else globalThis[key]=value}}}
test('following prepares lazily, reuses a validated response, and manual suspension prevents late activation',async()=>{const env=environment();try{assert.equal(env.calls.length,0);env.checkbox.checked=true;const pending=env.checkbox.change();env.follow.suspend();env.calls[0].resolve(env.context.response);await pending;assert.equal(env.pages.length,0);assert.equal(env.checkbox.checked,false);env.checkbox.checked=true;const ready=env.checkbox.change();env.calls[1].resolve(env.context.response);await ready;assert.equal(env.pages.at(-1),1);assert.match(env.status.textContent,/pass 2\/2/);env.follow.suspend();env.checkbox.checked=true;await env.checkbox.change();assert.equal(env.calls.length,2);env.follow.tick(3000,false);assert.match(env.status.textContent,/End of performance/);env.follow.tick(-1,true);assert.match(env.status.textContent,/Count-in/);}finally{env.restore()}});
test('replacement drops stale replies and failed preparation disables only following',async()=>{const env=environment();try{env.checkbox.checked=true;const pending=env.checkbox.change();env.follow.scoreChanged();env.setContext(setup());env.calls[0].resolve(env.context.response);await pending;assert.equal(env.pages.length,0);env.checkbox.checked=true;const failing=env.checkbox.change();env.calls[1].reject(Error('No complete measure map'));await failing;assert.equal(env.checkbox.checked,false);assert.match(env.status.textContent,/No complete measure map/);assert.match(env.status.textContent,/playback is unchanged/);assert.equal(env.pages.length,0);}finally{env.restore()}});


test('shared following defaults on, retains the user choice across views, dock reopening and score replacement',async()=>{
 const env=environment();
 try {
  assert.equal(env.checkbox.checked,true);assert.equal(env.calls.length,0);
  env.follow.tick(-100,true);assert.equal(env.calls.length,1);
  env.calls[0].resolve(env.context.response);await env.follow.prepare();
  env.follow.tick(-100,true);assert.match(env.status.textContent,/Count-in/);
  for(const position of [0,500,1000,1500,2000,2500])env.follow.tick(position,true);
  assert.deepEqual(env.pages.slice(-6),[0,1,2,1,2,3],'Empty measures, rests and backward repeats follow Rust occurrences');
  env.setPlayback({position:1000,running:false});env.follow.tick(1000,false);assert.equal(env.pages.at(-1),2);assert.match(env.status.textContent,/Paused at/);
  env.follow.suspend();const pages=env.pages.length;
  for(const position of [0,2500,500])env.follow.tick(position,true);
  env.follow.scoreChanged();env.setContext(setup());env.follow.tick(1500,true);
  assert.equal(env.pages.length,pages);assert.equal(env.checkbox.checked,false);assert.equal(env.calls.length,1,'Score loads cannot override an explicit manual/off choice');
  env.checkbox.checked=true;const ready=env.checkbox.change();env.calls[1].resolve(env.context.response);await ready;
  assert.equal(env.pages.at(-1),2);assert.equal(env.checkbox.checked,true);
 }finally{env.restore()}
});

test('hidden notation and view switches retain following and use the current seek/loop position when shown',async()=>{
 const prior={document:globalThis.document,window:globalThis.window};
 const {document,window}=parseHTML('<input id="engraving-follow" type="checkbox"><p id="engraving-follow-status"></p>');
 globalThis.document=document;globalThis.window=window;
 const data=setup(),navigation=new NotationNavigationIndex(data.response,data.score,data.timeline),calls=[];let visible=true,mode='staff',playback={position:0,running:true},preparations=0;
 const follow=setupNotationFollowing({getContext:()=>data,getPlayback:()=>playback,prepareNavigation:async()=>{preparations++;return navigation},view:{isActive:()=>visible,followMeasure:index=>calls.push({mode,index}),navigationState:()=>({ready:true})}});
 try{
  await follow.prepare();assert.deepEqual(calls.at(-1),{mode:'staff',index:0});
  visible=false;playback={position:2000,running:true};follow.tick(2000,true);assert.equal(calls.length,1);assert.equal(follow.isEnabled(),true);
  visible=true;mode='jianpu';follow.tick(2000,true);assert.deepEqual(calls.at(-1),{mode:'jianpu',index:2});
  mode='engraved';follow.tick(1500,true);assert.deepEqual(calls.at(-1),{mode:'engraved',index:1});
  follow.tick(-1,true);assert.equal(calls.length,3);follow.tick(500,true);assert.equal(calls.at(-1).index,1,'Loop/count-in resumes at its actual A position');
  follow.tick(2500,false);assert.equal(calls.at(-1).index,3,'Paused seeks reveal empty written measures too');
  assert.equal(preparations,1);assert.deepEqual(playback,{position:2000,running:true},'Presentation never writes the playback clock');
  document.getElementById('engraving-follow').checked=false;document.getElementById('engraving-follow').dispatchEvent(new window.Event('change'));
  const count=calls.length;visible=false;follow.tick(0,true);visible=true;mode='staff';follow.tick(0,true);assert.equal(calls.length,count);assert.equal(follow.isEnabled(),false);
 }finally{follow.suspend();for(const[key,value]of Object.entries(prior))if(value===undefined)delete globalThis[key];else globalThis[key]=value}
});

test('written cursor and page following share one validated request without requiring optional spans',async()=>{
 const prior={document:globalThis.document,window:globalThis.window};
 const {document,window}=parseHTML('<input id="engraving-follow" type="checkbox"><p id="engraving-follow-status"></p>');globalThis.document=document;globalThis.window=window;
 let data=setup(),requests=0;const pages=[];
 const cursor=setupWrittenCursor({getContext:()=>data,api:async()=>{requests++;return data.response}});
 const follow=setupNotationFollowing({getContext:()=>data,getPlayback:()=>({position:1000,running:true}),prepareNavigation:async options=>{await cursor.prepare(options);return cursor.navigation()},view:{isActive:()=>true,followMeasure:index=>pages.push(index),navigationState:()=>({ready:true})}});
 try {
  await Promise.all([cursor.prepare(),follow.prepare()]);
  assert.equal(requests,1);assert.equal(cursor.state().status,'unavailable','Missing exact spans cannot become a ready written cursor');assert.equal(cursor.at(1000),null);
  assert.ok(cursor.navigation() instanceof NotationNavigationIndex);assert.equal(pages.at(-1),2,'Validated measure following survives unavailable optional note spans');
  follow.tick(1500,true);await cursor.prepare();assert.equal(requests,1);assert.equal(pages.at(-1),1);
  data=setup();assert.equal(cursor.navigation(),null,'A changed score cannot reuse stale navigation');cursor.reset();assert.equal(cursor.navigation(),null);
 }finally{follow.suspend();cursor.reset();for(const[key,value]of Object.entries(prior))if(value===undefined)delete globalThis[key];else globalThis[key]=value}
});

test('basic pages use Rust measure source positions through silence, ties and rational note positions',()=>{
 const occurrence={source_measure_index:7,source_from:{numerator:32,denominator:1},source_to:{numerator:48,denominator:1}};
 const entry=(at,partId='piano',sourceMeasureIndex=7)=>({partId,sourceMeasureIndex,note:{at}});
 assert.equal(basicNotationPage(occurrence,[],'piano',4),8);
 assert.equal(basicNotationPage(occurrence,[entry({numerator:12,denominator:1})],'piano',4),8,'Continuing tie origins cannot pull the page into an earlier measure');
 assert.equal(basicNotationPage(occurrence,[entry({numerator:95,denominator:2}),entry({numerator:36,denominator:1})],'piano',4),11);
 assert.equal(basicNotationPage(occurrence,[entry({numerator:47,denominator:1},'other'),entry({numerator:49,denominator:1})],'piano',4),8);
 assert.equal(basicNotationPage(occurrence,[entry({numerator:47,denominator:1},'other')],null,4),11,'All-parts display follows every displayed written onset');
 assert.equal(basicNotationPage(occurrence,[],'piano',0),null);
});

test('basic focus reveals simultaneous exact IDs vertically and horizontally without touching the outer page',()=>{
 const {document}=parseHTML('<aside id="dock"><div id="notation"><svg><g class="score-note" data-note-id="é"></g><g class="score-note" data-note-id="é"></g><g class="score-note" data-note-id="unused"></g></svg></div></aside>');
 const dock=document.getElementById('dock'),container=document.getElementById('notation');
 let reads=0;const nodes=[...container.querySelectorAll('.score-note')];
 const bounds=[{left:320,right:330,top:220,bottom:230},{left:350,right:360,top:240,bottom:250},{left:999,right:1000,top:999,bottom:1000}];
 for(const[index,node]of nodes.entries())node.getBoundingClientRect=()=>{reads++;return bounds[index]};
 for(const node of [dock,container])Object.assign(node,{clientTop:0,clientLeft:0,clientWidth:200,clientHeight:150,scrollWidth:600,scrollHeight:700,scrollLeft:0,scrollTop:0,scrollTo({left,top}){if(left!==undefined)this.scrollLeft=left;if(top!==undefined)this.scrollTop=top},getBoundingClientRect:()=>({left:100,right:300,top:50,bottom:200})});
 const focus=createBasicNotationReveal({container,dock});
 assert.deepEqual(focus.reveal('pass-1',['é','é']),{status:'ready'});assert.equal(container.scrollLeft,72);assert.equal(dock.scrollTop,62);assert.equal(dock.scrollLeft,0);assert.equal(container.scrollTop,0);assert.equal(reads,2);
 for(let frame=0;frame<30;frame++)focus.reveal('pass-1',['é','é']);assert.equal(reads,2,'Stable frames do not repeatedly force DOM geometry');
 focus.reset();dock.scrollTop=0;container.scrollLeft=0;focus.reveal('pass-1',['é','é']);assert.equal(reads,4);
 focus.reveal('pass-2',['é','é']);assert.equal(reads,6,'Repeated occurrences are fresh focus targets');
 assert.equal(focus.reveal('pass-2',['unknown']).status,'unavailable');assert.equal(reads,6,'Unknown identities never become scroll targets');
 nodes[0].getBoundingClientRect=()=>{throw Error('Detached SVG')};assert.doesNotThrow(()=>focus.reveal('pass-3',['é']));assert.equal(focus.reveal('pass-3',['é']).status,'unavailable');
});


test('long-measure trailing gaps retain the last Rust-written onset and backward seeks find the preceding page',()=>{
 const data=setup(),note=data.score.parts[0].notes[0];
 data.score.repeats=[];data.score.measures=[{number:1,at:{numerator:0,denominator:1},length:{numerator:16,denominator:1}}];
 data.score.parts[0].notes=[{...note,id:'early',at:{numerator:0,denominator:1},duration:{numerator:1,denominator:1}},{...note,id:'late',at:{numerator:9,denominator:1},duration:{numerator:1,denominator:1}}];
 const notes=data.score.parts[0].notes.map(note=>({id:note.id,source_note_ids:[note.id],part_id:'piano',start_ms:note.at.numerator*500,duration_ms:500}));
 const timeline={notes,duration_ms:8000},occurrence={id:'long',source_measure_index:0,measure_number:1,source_from:{numerator:0,denominator:1},source_to:{numerator:16,denominator:1},start_ms:0,end_ms:8000,repeat_region_index:null,repeat_pass:null,repeat_times:null,written_note_ids:['early','late'],continuing_note_ids:[]};
 const navigation=new NotationNavigationIndex({version:1,source_measure_count:1,duration_ms:8000,occurrences:[occurrence],sounding_groups:notes.map(note=>({occurrence_id:note.id,part_id:note.part_id,source_note_ids:note.source_note_ids,start_ms:note.start_ms,end_ms:note.start_ms+note.duration_ms})),diagnostics:[]},data.score,timeline);
 const cursor=new WrittenCursorIndex({version:1,source_note_ids:['early','late'],spans:[{source_note_index:0,measure_occurrence_index:0,start_ms:0,end_ms:500},{source_note_index:1,measure_occurrence_index:0,start_ms:4500,end_ms:5000}]},navigation);
 const page=position=>basicNotationPage(occurrence,cursor.at(position).entries,'piano',4,cursor.pageAnchor(position,'piano'));
 assert.equal(page(0),0);assert.equal(page(4499),0);assert.equal(page(4500),2);assert.equal(page(5000),2);assert.equal(page(7999),2);
 assert.deepEqual(cursor.at(6000).entries,[]);assert.equal(page(6000),2,'An ended event is still the exact preceding written display anchor');
 assert.equal(page(1000),0,'A backward seek does not retain a later local page');assert.equal(page(5500),2);
 assert.deepEqual(cursor.pageAnchor(6000,'silent-part'),occurrence.source_from);assert.equal(cursor.pageAnchor(-1),null);assert.equal(cursor.pageAnchor(8000),null);
});


test('shared preparation ignores replaced-score replies and survives explicit suspension during a request',async()=>{
 const prior={document:globalThis.document,window:globalThis.window};const{document,window}=parseHTML('<input id="engraving-follow" type="checkbox"><p id="engraving-follow-status"></p>');globalThis.document=document;globalThis.window=window;
 let data=setup();const calls=[],pages=[];
 const cursor=setupWrittenCursor({getContext:()=>data,api:(_path,score,signal)=>new Promise(resolve=>calls.push({score,signal,resolve}))});
 const follow=setupNotationFollowing({getContext:()=>data,getPlayback:()=>({position:1500,running:true}),prepareNavigation:async options=>{await cursor.prepare(options);return cursor.navigation()},view:{isActive:()=>true,followMeasure:index=>pages.push(index),navigationState:()=>({ready:true})}});
 try{
  const old=data,first=follow.prepare();data=setup();follow.scoreChanged();const second=follow.prepare();
  assert.equal(calls.length,2);assert.equal(calls[0].signal.aborted,true);
  calls[0].resolve(old.response);await first;assert.equal(pages.length,0);assert.equal(follow.isEnabled(),true);
  follow.suspend();calls[1].resolve(data.response);await second;assert.equal(pages.length,0);assert.ok(cursor.navigation(),'Suspending display following does not cancel the independent written cursor request');
  document.getElementById('engraving-follow').checked=true;await follow.prepare();assert.equal(calls.length,2);assert.equal(pages.at(-1),1);
 }finally{follow.suspend();cursor.reset();for(const[key,value]of Object.entries(prior))if(value===undefined)delete globalThis[key];else globalThis[key]=value}
});

test('locale redraw preserves pending follow requests, repeat position, focusable controls and scroll suspension',async()=>{
 const prior={document:globalThis.document,window:globalThis.window};
 const {document,window}=parseHTML('<html><body><input id="engraving-follow" type="checkbox"><p id="engraving-follow-status"></p></body></html>');
 globalThis.document=document;globalThis.window=window;
 const i18n=createI18n(),data=setup(),before=JSON.stringify(data),checkbox=document.getElementById('engraving-follow'),status=document.getElementById('engraving-follow-status');
 let resolve,requests=0,clockReads=0,reveals=0,resets=0;const pages=[];
 const view={isActive:()=>true,followMeasure:index=>pages.push(index),navigationState:()=>({ready:false}),revealExpectedWrittenNotes(){reveals++;return{status:'partial'}},resetReveal(){resets++}};
 const follow=setupNotationFollowing({document,i18n,api:()=>{requests++;return new Promise(done=>resolve=done)},getContext:()=>data,getPlayback:()=>{clockReads++;return{position:1500,running:true}},view});
 try{
  assert.match(status.textContent,/已开启跟随/);const pending=follow.prepare();assert.match(status.textContent,/正在准备/);
  i18n.setLocale('en');i18n.invalidate();assert.match(status.textContent,/Preparing score following/);assert.equal(follow.prepare(),pending);assert.equal(requests,1);assert.equal(clockReads,0);assert.equal(reveals,0);
  resolve(data.response);await pending;assert.match(status.textContent,/pass 2\/2/);assert.match(status.textContent,/Loading display/);assert.match(status.textContent,/Some expected notes/);assert.equal(status.getAttribute('aria-live'),'off');
  const calls=[requests,clockReads,reveals,resets,pages.length];i18n.setLocale('zh-CN');
  assert.match(status.textContent,/第 2\/2 遍/);assert.match(status.textContent,/正在加载显示/);assert.match(status.title,/不会改变播放时钟/);assert.deepEqual([requests,clockReads,reveals,resets,pages.length],calls);
  assert.equal(document.getElementById('engraving-follow'),checkbox);assert.equal(document.getElementById('engraving-follow-status'),status);assert.equal(checkbox.checked,true);
  follow.tick(1500,false);assert.match(status.textContent,/已暂停于/);assert.equal(status.getAttribute('aria-live'),'polite');
  follow.suspend();const suspended=[requests,clockReads,reveals,resets,pages.length];i18n.setLocale('en');assert.match(status.textContent,/Manual navigation suspended/);assert.equal(checkbox.checked,false);assert.deepEqual([requests,clockReads,reveals,resets,pages.length],suspended);
  assert.equal(JSON.stringify(data),before);assert.deepEqual(i18n.getReports(),[]);
 }finally{follow.suspend();for(const[key,value]of Object.entries(prior))if(value===undefined)delete globalThis[key];else globalThis[key]=value}
});

test('follow failures use stable owned codes and literal labelled unknown details in the latest locale',async()=>{
 const i18n=createI18n(),env=environment(i18n);
 try{
  const first=env.follow.prepare();i18n.setLocale('en');env.calls[0].reject(Object.assign(Error('Legacy internal wording'),{code:'notation_followMap'}));await first;
  assert.match(env.status.textContent,/complete validated measure map/);assert.doesNotMatch(env.status.textContent,/Legacy internal/);
  i18n.setLocale('zh-CN');assert.match(env.status.textContent,/完整且经过验证的小节映射/);assert.equal(env.checkbox.checked,false);
  env.checkbox.checked=true;const second=env.follow.prepare();const detail='<img src=x onerror=alert(1)> exact engine detail 原文';env.calls[1].reject(Error(detail));await second;
  assert.ok(env.status.textContent.includes('原始技术详情：'+detail));i18n.setLocale('en');assert.ok(env.status.textContent.includes('Original technical details: '+detail));assert.equal(env.calls.length,2);
  assert.deepEqual(i18n.getReports(),[]);
 }finally{env.restore()}
});

test('default follow setup shares the document locale service and starts in Chinese',()=>{
 const prior={document:globalThis.document,window:globalThis.window};const {document,window}=parseHTML('<html><body><input id="engraving-follow" type="checkbox"><p id="engraving-follow-status"></p></body></html>');globalThis.document=document;globalThis.window=window;
 const follow=setupNotationFollowing({document,getContext:()=>({}),getPlayback:()=>assert.fail('Locale redraw must not read the clock'),view:{isActive:()=>false}});
 try{
  assert.match(document.getElementById('engraving-follow-status').textContent,/已开启跟随/);
  getAppI18n(document).setLocale('en');assert.match(document.getElementById('engraving-follow-status').textContent,/Following is on/);assert.equal(document.documentElement.lang,'en');assert.equal(follow.isEnabled(),true);
 }finally{follow.suspend();for(const[key,value]of Object.entries(prior))if(value===undefined)delete globalThis[key];else globalThis[key]=value}
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseHTML} from 'linkedom';
import {prepareCleanSong,prepareVsqPractice} from '../web/clean-song-package.js';
import {cleanSong as midiSong} from './clean-song-fixtures.js';
import {inspectCleanRendition} from '../web/clean-song-player.js';
import {VsqNavigationIndex,isVsqNavigationIndex} from '../web/vsq-navigation.js';
import {NotationNavigationIndex,basicNotationPage,setupNotationFollowing} from '../web/notation-follow.js';
import {WrittenCursorIndex,setupWrittenCursor} from '../web/written-cursor.js';
import {nativeScoreServer,nativeStorageApp,nativeResponse,deferred} from './native-storage-app-fixtures.js';

const read=name=>JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`,import.meta.url),'utf8'));
function fixture(change=()=>{},prefix='vsq-clean-v1'){
  const opened=read(`${prefix}-native-open`),response=read(`${prefix}-runtime`);change(response);
  const descriptor=opened.clean_package,key=`native:song-${descriptor.content_sha256}`,score=JSON.parse(opened.score_json);
  const cleanSong=prepareVsqPractice(prepareCleanSong(key,descriptor,score),response);
  return{opened,response,cleanSong,score:cleanSong.compilation.score,timeline:cleanSong.compilation.timeline};
}
function index(data=fixture()) {return new VsqNavigationIndex(data.cleanSong.navigation,data.cleanSong,data.score,data.timeline);}
const ids=(cursor,position)=>cursor.at(position).entries.map(entry=>entry.sourceNoteId).sort();

test('native VSQ map preserves project measures while start, gap, tail and end use the exact practice clock',()=>{
  const data=fixture(),before=JSON.stringify(data),navigation=index(data),cursor=new WrittenCursorIndex(data.cleanSong.navigation.written_cursor,navigation),map=data.response.navigation;
  assert.ok(isVsqNavigationIndex(navigation));assert.equal(isVsqNavigationIndex(structuredClone(navigation)),false);assert.equal(navigation.occurrences.length,data.score.measures.length);
  assert.equal(map.clock_start_ms,-2000);assert.equal(navigation.occurrences[0].start_ms,-2000);assert.equal(navigation.occurrences[0].end_ms,0);assert.deepEqual(navigation.occurrences[0].written_note_ids,[]);
  assert.equal(navigation.at(0).source_measure_index,1);assert.deepEqual(ids(cursor,0),['vsq-t1-ID#0001','vsq-t2-ID#0001']);assert.deepEqual(ids(cursor,1418.75116875),[]);assert.equal(navigation.at(2000).source_measure_index,1);
  assert.equal(navigation.at(map.written_end_ms-0.001).source_measure_index,1);assert.equal(navigation.at(map.written_end_ms),null);assert.equal(navigation.at(4000),null);
  for(const position of [-2000,-1,data.timeline.duration_ms,data.timeline.duration_ms+1,NaN,Infinity]){assert.equal(navigation.at(position),null);assert.deepEqual(cursor.at(position),{occurrence:null,entries:[]});}
  assert.equal(data.timeline.duration_ms,4083.3371666666667);assert.deepEqual(data.score.keys,[]);assert.equal(JSON.stringify(data),before);
});

test('VSQ cursor includes the source-muted part and scopes display anchors without altering source identities',()=>{
  const data=fixture(),navigation=index(data),cursor=new WrittenCursorIndex(data.cleanSong.navigation.written_cursor,navigation),occurrence=navigation.at(0);
  assert.equal(data.cleanSong.runtime.parts[1].audible,false);assert.deepEqual(ids(cursor,1000),data.score.parts.flatMap(part=>part.notes.map(note=>note.id)));
  for(const part of data.score.parts){const entries=cursor.at(1000).entries.filter(entry=>entry.partId===part.id);assert.equal(entries.length,1);assert.equal(entries[0].sourceNoteId,part.notes[0].id);assert.deepEqual(cursor.pageAnchor(2000,part.id),part.notes[0].at);assert.equal(basicNotationPage(occurrence,entries,part.id,4,cursor.pageAnchor(2000,part.id)),1);}
  assert.deepEqual(cursor.pageAnchor(2000,'silent-unselected-part'),occurrence.source_from);assert.equal(cursor.pageAnchor(data.response.navigation.written_end_ms),null);assert.deepEqual(data.cleanSong.runtime.notes.map(note=>note.dynamics),[0,0]);
});

test('native written measure padding never extends the playable or followable end',()=>{
  const data=fixture(()=>{},'vsq-clean-v1-padding'),navigation=index(data),cursor=new WrittenCursorIndex(data.response.navigation.written_cursor,navigation),original=fixture();
  assert.equal(data.timeline.duration_ms,2000.00175);assert.equal(data.response.navigation.written_end_ms,3750.0035);assert.equal(navigation.at(data.timeline.duration_ms-0.001).source_measure_index,1);assert.deepEqual(ids(cursor,data.timeline.duration_ms-0.001),[]);
  for(const position of [data.timeline.duration_ms,3000,data.response.navigation.written_end_ms]){assert.equal(navigation.at(position),null);assert.deepEqual(cursor.at(position),{occurrence:null,entries:[]});assert.equal(cursor.pageAnchor(position),null);}
  assert.equal(data.cleanSong.runtime.source_sha256,original.cleanSong.runtime.source_sha256);assert.notEqual(data.cleanSong.identity,original.cleanSong.identity);assert.throws(()=>new VsqNavigationIndex(data.response.navigation,original.cleanSong,original.score,original.timeline),{code:'notation_followInvalid'});
});

test('VSQ navigation rejects wrong package, runtime profile, choice, clock, measures, source IDs and cursor intervals',()=>{
  const mutations=[n=>n.profile='unknown',n=>n.content_sha256='0'.repeat(64),n=>n.source_sha256='0'.repeat(64),n=>n.runtime_profile='unknown',n=>n.choice='full_vocal',n=>n.practice_origin_tick++,n=>n.duration_ms++,n=>n.clock_start_ms++,n=>n.written_end_ms++,n=>n.occurrences.shift(),n=>n.occurrences[1].source_measure_index=0,n=>n.occurrences[1].measure_number++,n=>n.occurrences[1].source_from.numerator++,n=>n.occurrences[1].written_note_ids.pop(),n=>n.occurrences[1].repeat_region_index=0,n=>n.sounding_groups.pop(),n=>n.sounding_groups[0].part_id='vsq-track-2',n=>n.sounding_groups[0].source_note_ids=['wrong'],n=>n.sounding_groups[0].end_ms++,n=>n.written_cursor.source_note_ids[0]='wrong',n=>n.written_cursor.spans.pop(),n=>n.written_cursor.spans[0].start_ms++,n=>n.written_cursor.spans[0].end_ms--,n=>n.written_cursor.spans[0].measure_occurrence_index=0];
  for(const mutate of mutations){const data=fixture(response=>mutate(response.navigation));assert.throws(()=>index(data),{code:'notation_followInvalid'});}
  const data=fixture();assert.throws(()=>new VsqNavigationIndex(data.response.navigation,structuredClone(data.cleanSong),data.score,data.timeline),{code:'notation_followInvalid'});
  assert.throws(()=>new VsqNavigationIndex(data.response.navigation,data.cleanSong,{...data.score,title:'Different score'},data.timeline),{code:'notation_followInvalid'});
  const changed=structuredClone(data.timeline);changed.notes[0].start_ms=1;assert.throws(()=>new VsqNavigationIndex(data.response.navigation,data.cleanSong,data.score,changed),{code:'notation_followInvalid'});
});

test('ordinary navigation invariants never accept the profiled VSQ negative origin or independent written end',()=>{
  const data=fixture();assert.throws(()=>new NotationNavigationIndex(data.response.navigation,data.score,data.timeline),{code:'notation_followInvalid'});
  const positive=structuredClone(data.response.navigation);positive.occurrences.shift();positive.source_measure_count=1;positive.occurrences[0].source_measure_index=0;const score={...data.score,measures:data.score.measures.slice(1)};
  assert.equal(positive.occurrences[0].start_ms,0);assert.notEqual(positive.occurrences[0].end_ms,data.timeline.duration_ms);assert.throws(()=>new NotationNavigationIndex(positive,score,data.timeline),{code:'notation_followInvalid'});
});

test('VSQ written preparation uses only the bound native map and invalidates on a new load of the same score',async()=>{
  let data=fixture(response=>response.navigation.content_sha256='0'.repeat(64));const statuses=[];let requests=0;
  const cursor=setupWrittenCursor({getContext:()=>data,api:()=>{requests++;throw Error('No generic recompilation allowed');},onStatus:value=>statuses.push(value.status)});
  const stale=cursor.prepare(),old=data;data={...fixture(),score:old.score,timeline:old.timeline};assert.equal(cursor.at(0),null);const latest=cursor.prepare();assert.equal(await stale,null);assert.ok(await latest);assert.equal(cursor.state().status,'ready');assert.equal(statuses.includes('unavailable'),false);assert.equal(requests,0);assert.ok(isVsqNavigationIndex(cursor.navigation()));assert.deepEqual(ids(cursor,0),['vsq-t1-ID#0001','vsq-t2-ID#0001']);
  cursor.reset();const cancelled=cursor.prepare();cursor.reset();assert.equal(await cancelled,null);assert.equal(cursor.state().status,'idle');assert.equal(cursor.navigation(),null);assert.equal(requests,0);
});

test('a late ordinary navigation response cannot replace a newer native VSQ map',async()=>{
  const current=fixture(),pending=deferred();let data={score:current.score,timeline:current.timeline},calls=0;
  const cursor=setupWrittenCursor({getContext:()=>data,api:()=>{calls++;return pending.promise;}}),stale=cursor.prepare();data=current;await cursor.prepare();assert.equal(cursor.state().status,'ready');pending.resolve({version:99});assert.equal(await stale,null);assert.ok(isVsqNavigationIndex(cursor.navigation()));assert.equal(cursor.at(0).occurrence.source_measure_index,1);assert.equal(calls,1);
});

test('unavailable or invalid native navigation leaves practice playable and never falls back to BPM navigation',async()=>{
  for(const mutate of [response=>{response.navigation=null;response.navigation_unavailable={code:'vsq_navigation_budget',message:'Original synthetic navigation limit'};},response=>{response.navigation.profile='unknown';}]){
    const data=fixture(mutate);let calls=0;const cursor=setupWrittenCursor({getContext:()=>data,api:()=>{calls++;throw Error('No generic fallback');}});
    assert.equal(inspectCleanRendition(data.cleanSong).supported,true);await cursor.prepare();assert.equal(cursor.state().status,'unavailable');assert.equal(cursor.navigation(),null);assert.equal(cursor.at(0),null);await cursor.prepare();await cursor.prepare({retry:true});assert.equal(calls,0);assert.equal(cursor.state().status,'unavailable');assert.equal(data.timeline.notes.length,2);
  }
});

test('page following accepts only the validated VSQ index and keeps its native source measure',async()=>{
  const prior={document:globalThis.document,window:globalThis.window},{document,window}=parseHTML('<input id="engraving-follow" type="checkbox"><p id="engraving-follow-status"></p>');globalThis.document=document;globalThis.window=window;
  const data=fixture(),navigation=index(data),pages=[],cursor=new WrittenCursorIndex(data.response.navigation.written_cursor,navigation);let position=0;
  const follow=setupNotationFollowing({getContext:()=>data,getPlayback:()=>({position,running:true,written:cursor.at(position)}),prepareNavigation:async()=>navigation,view:{isActive:()=>true,followMeasure:value=>pages.push(value),navigationState:()=>({ready:true})}});
  try{await follow.prepare();assert.deepEqual(pages,[1]);position=2000;follow.tick(position,true,cursor.at(position));assert.equal(pages.at(-1),1);const count=pages.length;position=data.response.navigation.written_end_ms;follow.tick(position,true,cursor.at(position));assert.equal(pages.length,count);assert.equal(follow.isEnabled(),true);}
  finally{follow.suspend();for(const[key,value]of Object.entries(prior))if(value===undefined)delete globalThis[key];else globalThis[key]=value;}
});

test('the ordinary app follows both native VSQ parts at practice zero without a canonical navigation request',async()=>{
  const data=fixture(),server=await nativeScoreServer(),descriptor=data.opened.clean_package,storageKey=`song-${descriptor.content_sha256}`,score=data.score;let wall=1000;
  const entry={key:storageKey,revision:1,title:score.title,composer:score.composer,score_id:score.id,label:score.title,score_bytes:Buffer.byteLength(data.opened.score_json),saved_at_unix_ms:1700000000000,clean_package:{version:2,content_sha256:descriptor.content_sha256,profile:descriptor.profile,capabilities:descriptor.capabilities,interpretation_limits:descriptor.interpretation_limits,media:[]}};
  server.records.set(storageKey,{...data.opened,entry});server.setRoute(({path})=>path==='/api/library/runtime'?nativeResponse(data.response):undefined);const app=await nativeStorageApp(server,{now:()=>wall});
  try{await app.until(()=>app.savedButton(storageKey)&&!app.$('start-listen').disabled);await app.click('home-single-player');app.savedButton(storageKey).click();await app.until(()=>app.$('song-lobby').dataset.previewStatus==='choice');await app.click('vsq-choose-base-notes');await app.until(()=>!app.$('start-listen').disabled);app.$('count-in').checked=false;await app.click('start-listen');await app.click('notation-toggle');await app.until(()=>{app.frame();return app.$('written-cursor-status').dataset.status==='ready';},'VSQ written cursor did not become ready');wall=1050;app.frame();await app.tick();assert.deepEqual(JSON.parse(app.$('written-cursor-status').dataset.sourceNoteIds),['vsq-t1-ID#0001','vsq-t2-ID#0001']);assert.equal(app.$('written-cursor-status').dataset.sourceMeasureIndex,'1');assert.equal(server.requests.filter(request=>request.path==='/api/notation-navigation').length,0);
    wall=3050;app.frame();assert.deepEqual(JSON.parse(app.$('written-cursor-status').dataset.sourceNoteIds),[]);assert.equal(app.$('written-cursor-status').dataset.sourceMeasureIndex,'1');wall=5050;app.frame();assert.equal(app.$('written-cursor-status').dataset.sourceMeasureIndex,'');assert.equal(app.$('written-cursor-status').dataset.status,'ready');assert.equal(server.requests.filter(request=>request.path==='/api/notation-navigation').length,0);
  }finally{await app.close();}
});


test('switching MIDI and VSQ native packages preserves exact admitted clocks and bounded cursor fallback',async()=>{
  let song=midiSong(),calls=0;
  const cursor=setupWrittenCursor({getContext:()=>({score:song.compilation.score,timeline:song.compilation.timeline,cleanSong:song,nativeRuntime:song.runtime}),api:()=>{calls++;throw Error('Native packages must never recompile through BPM');}});
  assert.equal(song.compilation,song.runtime.compilation);
  await cursor.prepare();assert.equal(cursor.state().status,'ready');assert.ok(cursor.navigation() instanceof NotationNavigationIndex);assert.ok(cursor.at(0).entries.length);
  song=fixture().cleanSong;assert.equal(cursor.navigation(),null);assert.equal(cursor.at(0),null);
  await cursor.prepare();assert.ok(isVsqNavigationIndex(cursor.navigation()));assert.equal(cursor.at(0).occurrence.source_measure_index,1);assert.equal(cursor.navigation().at(song.navigation.written_end_ms),null);
  song=midiSong(({runtime})=>{runtime.navigation.written_cursor=null;runtime.navigation.diagnostics.push({code:'notation_written_cursor_unavailable',message:'Synthetic bounded cursor fallback'});});
  assert.equal(cursor.at(0),null);await cursor.prepare();assert.equal(cursor.state().status,'unavailable');assert.equal(cursor.at(0),null);assert.ok(cursor.navigation() instanceof NotationNavigationIndex);assert.ok(cursor.navigation().at(0));
  song=midiSong();assert.equal(cursor.navigation(),null);await cursor.prepare();assert.equal(cursor.state().status,'ready');assert.ok(cursor.at(0).entries.length);assert.equal(calls,0);
});

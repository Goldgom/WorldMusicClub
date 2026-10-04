import test from 'node:test';
import assert from 'node:assert/strict';
import {SongAuthoringModel,createAuthoringTransport,checkAuthoringDraft,AUTHORING_LIMITS} from '../web/song-authoring-model.js';
import {AUTHORING_COPY,AUTHORING_ERRORS,AUTHORING_DIAGNOSTICS} from '../web/song-authoring-locale.js';
import {authoredDraft,authoredVsqDraft,vsqFile,authoredConversionMidi,midiFile,packageBlob,importReport,importItem} from './song-authoring-fixtures.js';
import {deferred,nativeResponse} from './native-storage-app-fixtures.js';
const setup=({kind='native',transport={},imports={},onCommitted=async()=>{}}={})=>new SongAuthoringModel({getStorageKind:async()=>kind,onCommitted,transport:{draft:async(file,{title})=>authoredDraft({sourceName:file.name,title}),pack:async()=>packageBlob(),...transport},imports:{preview:async file=>importReport(file),commit:async file=>importReport(file,{mode:'commit',items:[importItem({status:'saved',entry:{key:`song-${'f'.repeat(64)}`}})]}),...imports}});
const until=async predicate=>{for(let count=0;count<50&&!predicate();count++)await new Promise(resolve=>setImmediate(resolve));assert.ok(predicate());};

test('Rust draft and fingerprint pack requests preserve original C/E/G bytes and opaque exact JSON strings',async()=>{
 const calls=[],file=midiFile(),draft=authoredDraft();draft.package.score_json='{"clock":9007199254740993,"message":"原题"}\n';draft.package.metadata_json='\n{"title":"Original <title> 原题"}\r\n';
 const transport=createAuthoringTransport({origin:'https://wmh.localhost',fetcher:async(path,options)=>{calls.push({path,options,body:JSON.parse(options.body)});return nativeResponse(path.endsWith('/pack')?{draft_sha256:draft.draft_sha256,zip_base64:Buffer.from(await packageBlob().arrayBuffer()).toString('base64'),filename:'song.wmhpack'}:draft);}});
 const result=await transport.draft(file,{title:'original-ceg'}),blob=await transport.pack(result);
 assert.deepEqual(Buffer.from(calls[0].body.source_base64,'base64'),authoredConversionMidi());assert.deepEqual(calls[1].body,{...calls[0].body,expected_draft_sha256:draft.draft_sha256});assert.equal(result.package.score_json,draft.package.score_json);assert.equal(result.package.metadata_json,draft.package.metadata_json);assert.equal((await blob.text()).startsWith('PK'),true);assert.equal(calls[0].options.redirect,'error');assert.equal(calls[0].options.credentials,'same-origin');
});
test('held HTTP422 responses remain reviewable while changed fingerprints and foreign redirects are refused',async()=>{
 const draft=authoredDraft({state:'rejected'}),transport=createAuthoringTransport({origin:'https://wmh.localhost',fetcher:async()=>nativeResponse(draft,422)});assert.equal((await transport.draft(midiFile(),{title:'original-ceg'})).state,'rejected');
 let calls=0;const altered=createAuthoringTransport({origin:'https://wmh.localhost',fetcher:async()=>nativeResponse(++calls===1?authoredDraft():{draft_sha256:'0'.repeat(64),zip_base64:'UEsDBA==',filename:'a.zip'})});const good=await altered.draft(midiFile(),{title:'original-ceg'});await assert.rejects(altered.pack(good),{code:'authoring_invalid_response'});
 const redirected=createAuthoringTransport({origin:'https://wmh.localhost',fetcher:async()=>({...nativeResponse(authoredDraft()),redirected:true,url:'https://other.invalid'})});await assert.rejects(redirected.draft(midiFile(),{title:'original-ceg'}),{code:'authoring_environment'});
});
test('full inventory validator rejects omitted tracks, changed totals and package-bearing held reports',()=>{
 for(const change of [value=>value.inventory.tracks.pop(),value=>value.inventory.source_events++,value=>value.inventory.tracks[1].source_index=0,value=>value.inventory.parts[0].channel=16,value=>value.state='rejected']){const draft=authoredDraft();change(draft);assert.throws(()=>checkAuthoringDraft(draft,{sourceName:draft.source_name,title:draft.title}),{code:'authoring_invalid_response'});}
});
test('preflight is read-only and title edits invalidate package until complete Rust regeneration',async()=>{
 let commits=0;const titles=[],queue=setup({transport:{draft:async(file,{title})=>{titles.push(title);return authoredDraft({sourceName:file.name,title});}},imports:{commit:async()=>{commits++;}}});
 await queue.select([midiFile()]);assert.equal(commits,0);const id=queue.snapshot().rows[0].id;assert.equal(queue.snapshot().rows[0].phase,'ready');queue.editTitle(id,'原题 <safe>');assert.equal(queue.snapshot().rows[0].phase,'edited');assert.equal(queue.artifacts.size,0);assert.equal(await queue.save(id),false);await queue.retry(id);assert.deepEqual(titles,['original-ceg','原题 <safe>']);assert.equal(commits,0);assert.equal(queue.snapshot().rows[0].draft.title,'原题 <safe>');
});
test('new selection and cancellation suppress late conversion and pack completions',async()=>{
 const gate=deferred(),packGate=deferred();let first=true;
 const queue=setup({transport:{draft:async(file,{title})=>{if(first){first=false;await gate.promise;}return authoredDraft({sourceName:file.name,title});}}});
 const old=queue.select([midiFile('old.mid')]);await until(()=>queue.snapshot().phase==='converting');await queue.select([midiFile('new.mid')]);gate.resolve();await old;assert.equal(queue.snapshot().rows.length,1);assert.equal(queue.snapshot().rows[0].name,'new.mid');assert.equal(queue.snapshot().rows[0].phase,'ready');
 const second=setup({transport:{pack:async()=>{await packGate.promise;return packageBlob();}}});const pending=second.select([midiFile()]);await until(()=>second.snapshot().rows[0]?.draft);second.cancel();packGate.resolve();await pending;assert.equal(second.snapshot().phase,'cancelled');assert.equal(second.artifacts.size,0);
});
test('cancel during a native write leaves an actionable uncertain result, refreshes inventory and stops later files',async()=>{
 const gate=deferred();let commits=0,refreshes=0;const queue=setup({imports:{commit:async file=>{commits++;await gate.promise;return importReport(file,{mode:'commit',items:[importItem({status:'saved'})]});}},onCommitted:async()=>{refreshes++;}});
 await queue.select([midiFile('first.mid'),midiFile('second.mid')]);const saving=queue.save();await until(()=>commits===1);queue.cancel();assert.equal(queue.snapshot().rows[0].phase,'uncertain');assert.equal(await queue.select([midiFile('new.mid')]),false);gate.resolve();await saving;assert.equal(commits,1);assert.equal(refreshes,1);assert.equal(queue.snapshot().rows[0].phase,'uncertain');assert.equal(queue.snapshot().rows[1].phase,'ready');assert.equal(queue.snapshot().pendingWrites,0);
});
test('lost native result retries the identical reviewed package and duplicate outcome is distinct',async()=>{
 let commits=0;const bytes=[],queue=setup({imports:{commit:async(file,{sha256})=>{bytes.push([await file.text(),sha256]);if(++commits===1)throw Object.assign(new Error('Original lost reply'),{code:'library_commit_uncertain',persistence:'unknown'});return importReport(file,{mode:'commit',items:[importItem({status:'duplicate',entry:{key:`song-${'f'.repeat(64)}`}})]});}}});
 await queue.select([midiFile()]);const id=queue.snapshot().rows[0].id;await queue.save(id);assert.equal(queue.snapshot().rows[0].phase,'uncertain');await queue.save(id);assert.equal(queue.snapshot().rows[0].phase,'duplicate');assert.deepEqual(bytes[0],bytes[1]);
});
test('conflict resolution requires explicit keep-both and event-only candidate does not become notation-ready',async()=>{
 const calls=[],queue=setup({transport:{draft:async(file,{title})=>authoredDraft({sourceName:file.name,title,state:'event_only_reference_candidate'})},imports:{preview:async file=>importReport(file,{items:[importItem({status:'conflict',playable:false})]}),commit:async(file,options)=>{calls.push(options);return importReport(file,{mode:'commit',items:[importItem({status:'saved',playable:false})]});}}});
 await queue.select([midiFile()]);const id=queue.snapshot().rows[0].id;assert.equal(await queue.save(id),false);await queue.save(id,{keepBoth:true});assert.equal(calls.length,1);assert.equal(calls[0].keepBoth,true);assert.equal(calls[0].index,0);assert.equal(queue.snapshot().rows[0].draft.state,'event_only_reference_candidate');
});
test('rejected conversions never request a ZIP, preflight or save',async()=>{
 let sideEffects=0;const queue=setup({transport:{draft:async(file,{title})=>authoredDraft({sourceName:file.name,title,state:'rejected'}),pack:async()=>{sideEffects++;}},imports:{preview:async()=>{sideEffects++;},commit:async()=>{sideEffects++;}}});await queue.select([midiFile()]);const id=queue.snapshot().rows[0].id;assert.equal(queue.snapshot().rows[0].phase,'held');assert.equal(await queue.save(id),false);assert.equal(await queue.export(id),null);assert.equal(sideEffects,0);
});
test('browser mode exposes complete ZIP export without invoking native save or browser score persistence',async()=>{
 let native=0;const queue=setup({kind:'browser',imports:{preview:async()=>{native++;},commit:async()=>{native++;}}});await queue.select([midiFile()]);const id=queue.snapshot().rows[0].id;assert.equal(await queue.save(id),false);const result=await queue.export(id);assert.equal(await result.blob.text(),await packageBlob().text());queue.exported(result);assert.equal(queue.snapshot().rows[0].downloaded,true);assert.equal(queue.snapshot().rows[0].phase,'ready');assert.equal(native,0);
});
test('oversized entire selection is refused without truncation; individual invalid sources remain visible',async()=>{
 let conversions=0;const queue=setup({transport:{draft:async(file,{title})=>{conversions++;return authoredDraft({sourceName:file.name,title});}}});assert.equal(await queue.select(Array.from({length:11},()=>midiFile())),false);assert.equal(queue.snapshot().rows.length,0);assert.equal(conversions,0);await queue.select([midiFile(),{name:'large.mid',size:AUTHORING_LIMITS.fileBytes+1},{name:'future.vsqx',size:100}]);assert.equal(queue.snapshot().rows.length,3);assert.deepEqual(queue.snapshot().rows.map(row=>row.phase),['ready','failed','failed']);assert.equal(conversions,1);
});
test('locale copy has exact keys and placeholder parity and every mapped error is localized',()=>{
 assert.deepEqual(Object.keys(AUTHORING_COPY.en).sort(),Object.keys(AUTHORING_COPY['zh-CN']).sort());for(const key of Object.keys(AUTHORING_COPY.en)){const tokens=value=>[...value.matchAll(/\{(\w+)\}/g)].map(match=>match[1]).sort();assert.deepEqual(tokens(AUTHORING_COPY.en[key]),tokens(AUTHORING_COPY['zh-CN'][key]),key);}for(const key of Object.values(AUTHORING_ERRORS))assert.ok(AUTHORING_COPY['zh-CN'][key]&&AUTHORING_COPY.en[key]);
});
test('failed native preflight cannot be bypassed with retry-save even when Rust ZIP construction succeeded',async()=>{
 let commits=0;const queue=setup({imports:{preview:async()=>{throw Object.assign(new Error('Native preflight unavailable'),{code:'pack_transport'});},commit:async()=>{commits++;}}});await queue.select([midiFile()]);const item=queue.snapshot().rows[0];assert.equal(item.phase,'failed');assert.equal(queue.artifacts.size,1);assert.equal(await queue.save(item.id),false);assert.equal(commits,0);
});
test('inventory refresh stays inside the save lock and prevents repeated commit during a delayed refresh',async()=>{
 const refreshGate=deferred();let refreshStarted=false,commits=0;const queue=setup({imports:{commit:async file=>{commits++;return importReport(file,{mode:'commit',items:[importItem({status:'saved'})]});}},onCommitted:async()=>{refreshStarted=true;await refreshGate.promise;}});await queue.select([midiFile()]);const running=queue.save();await until(()=>refreshStarted);assert.equal(await queue.save(),false);assert.equal(await queue.select([midiFile('new.mid')]),false);assert.equal(commits,1);refreshGate.resolve();await running;assert.equal(queue.snapshot().pendingWrites,0);
});
test('exact Rust API fixtures for all three states pass UI admission with unchanged opaque package strings',async()=>{
 const {readFile}=await import('node:fs/promises');
 for(const name of ['strict','event-only','rejected']){
  const request=JSON.parse(await readFile(new URL(`./fixtures/song-authoring/${name}-request.json`,import.meta.url),'utf8')),value=JSON.parse(await readFile(new URL(`./fixtures/song-authoring/${name}-response.json`,import.meta.url),'utf8')),before=structuredClone(value);
  const draft=checkAuthoringDraft(value,{sourceName:request.source_name,title:request.title});assert.deepEqual(draft,before);assert.ok(draft.inventory.source_events>=10);assert.equal(draft.inventory.tracks.length,1);assert.equal(draft.inventory.key_attacks,3);assert.equal(draft.inventory.key_releases,3);for(const note of draft.diagnostics){assert.ok(AUTHORING_DIAGNOSTICS[note.code],note.code);assert.match(AUTHORING_COPY['zh-CN'][AUTHORING_DIAGNOSTICS[note.code]],/[\u4e00-\u9fff]/);}assert.equal(draft.state,name==='strict'?'strict_notation_candidate':name==='event-only'?'event_only_reference_candidate':'rejected');
 }
});
test('a malformed commit response is uncertain rather than a claim that nothing was saved',async()=>{
 const queue=setup({imports:{commit:async file=>importReport(file,{mode:'commit',items:[]})}});await queue.select([midiFile()]);await queue.save();assert.equal(queue.snapshot().rows[0].phase,'uncertain');assert.equal(queue.snapshot().rows[0].error.persistence,'unknown');
});

test('actual Rust VSQ envelope keeps raw SMF events separate from all logical parts and exact authoring JSON',async()=>{
 const {readFile}=await import('node:fs/promises'),request=JSON.parse(await readFile(new URL('./fixtures/song-authoring/vsq-request.json',import.meta.url),'utf8')),value=JSON.parse(await readFile(new URL('./fixtures/song-authoring/vsq-response.json',import.meta.url),'utf8')),before=structuredClone(value);
 const draft=checkAuthoringDraft(value,{sourceName:request.source_name,title:request.title});assert.equal(draft,value);assert.deepEqual(draft,before);assert.equal(draft.state,'vsq_authoring_candidate');assert.equal(draft.source.format,'vsq');assert.equal(draft.inventory.source_tracks,4);assert.equal(draft.inventory.source_events,152);assert.equal(draft.inventory.key_attacks,0);assert.equal(draft.inventory.key_releases,0);assert.equal(draft.inventory.parts.length,3);assert.equal(draft.inventory.parts.reduce((sum,part)=>sum+part.vsq.notes,0),2);
 for(const part of draft.inventory.parts){assert.equal(part.channel,null);assert.equal(draft.inventory.tracks.find(track=>track.source_index===part.vsq.source_track_index).track_id,part.track_id);}assert.equal(draft.inventory.parts[1].vsq.mute,true);assert.equal(draft.inventory.parts[2].vsq.notes,0);assert.match(draft.package.score_json,/9007199254740993/);for(const note of draft.diagnostics)assert.ok(AUTHORING_DIAGNOSTICS[note.code]);
});

test('VSQ envelope rejects inferred channels, conflicting source mappings and malformed preservation summaries',()=>{
 const changes=[value=>value.source.format='midi',value=>value.state='strict_notation_candidate',value=>value.inventory.parts=[],value=>value.inventory.parts[0].channel=0,value=>value.inventory.parts[0].vsq.source_track_index=0,value=>value.inventory.parts[0].track_id='track-3',value=>value.inventory.parts[0].id='midi-part',value=>value.inventory.parts[0].vsq.curve_points=9007199254740992,value=>value.inventory.parts[0].vsq.notes=-1,value=>value.inventory.parts[0].vsq.mute=1,value=>delete value.inventory.parts[0].vsq.singers,value=>value.inventory.parts.push(structuredClone(value.inventory.parts[0])),value=>value.inventory.tracks[1].track_id=value.inventory.tracks[0].track_id,value=>value.inventory.source_events--];
 for(const change of changes){const value=authoredVsqDraft();change(value);assert.throws(()=>checkAuthoringDraft(value,{sourceName:value.source_name,title:value.title}),{code:'authoring_invalid_response'});}
 const midi=authoredDraft();midi.inventory.parts[0].channel=null;assert.throws(()=>checkAuthoringDraft(midi,{sourceName:midi.source_name,title:midi.title}),{code:'authoring_invalid_response'});
});

test('VSQ transport binds original bytes and reviewed fingerprint without parsing or rewriting large coefficients',async()=>{
 for(const name of ['original.vsq','container.mid','container.MIDI']){
  const calls=[],file=vsqFile(name),draft=authoredVsqDraft({sourceName:name,title:'Exact VSQ'}),before=structuredClone(draft),transport=createAuthoringTransport({origin:'https://wmh.localhost',fetcher:async(path,options)=>{calls.push({path,body:JSON.parse(options.body)});return nativeResponse(path.endsWith('/pack')?{draft_sha256:draft.draft_sha256,zip_base64:Buffer.from(await packageBlob().arrayBuffer()).toString('base64')}:draft);}});
  const result=await transport.draft(file,{title:'Exact VSQ'});await transport.pack(result);assert.deepEqual(Buffer.from(calls[0].body.source_base64,'base64'),Buffer.from(await file.arrayBuffer()));assert.deepEqual(calls[1].body,{...calls[0].body,expected_draft_sha256:before.draft_sha256});assert.deepEqual(result,before);assert.match(result.package.score_json,/9007199254740993/);
 }
});

test('VSQ filenames enter read-only authoring while unsupported extensions stay actionable and held projects cannot export',async()=>{
 let drafts=0,packs=0,commits=0;const queue=setup({kind:'browser',transport:{draft:async(file,{title})=>{drafts++;return authoredVsqDraft({sourceName:file.name,title,state:file.name.startsWith('held')?'rejected':'vsq_authoring_candidate'});},pack:async()=>{packs++;return packageBlob();}},imports:{commit:async()=>{commits++;}}});
 await queue.select([vsqFile('Original.VSQ'),vsqFile('container.mid'),vsqFile('held-original.vsq'),vsqFile('future.vsqx')]);const rows=queue.snapshot().rows;assert.deepEqual(rows.map(row=>row.phase),['ready','ready','held','failed']);assert.equal(rows[0].title,'Original');assert.equal(rows[3].error.code,'authoring_format');assert.equal(drafts,3);assert.equal(packs,2);assert.equal(rows[2].draft.inventory.parts.length,3);assert.equal(await queue.export(rows[2].id),null);assert.equal(await queue.save(),false);assert.equal(commits,0);assert.ok(await queue.export(rows[0].id));
 const held=rows[2].draft;assert.equal(checkAuthoringDraft(held,{sourceName:held.source_name,title:held.title}),held);
});

test('VSQ title edits regenerate the exact package and stale VSQ completion cannot replace a newer MIDI draft',async()=>{
 const gate=deferred();let waiting=false;const queue=setup({kind:'browser',transport:{draft:async(file,{title})=>{if(file.name==='late.vsq'){waiting=true;await gate.promise;}return file.name.endsWith('.vsq')?authoredVsqDraft({sourceName:file.name,title}):authoredDraft({sourceName:file.name,title});}}});
 await queue.select([vsqFile()]);const id=queue.snapshot().rows[0].id,first=queue.snapshot().rows[0].draft;queue.editTitle(id,'Original <safe> $& 改题');assert.equal(queue.snapshot().rows[0].draft,null);assert.equal(await queue.export(id),null);await queue.retry(id);const edited=queue.snapshot().rows[0].draft;assert.equal(edited.title,'Original <safe> $& 改题');assert.notEqual(edited.draft_sha256,first.draft_sha256);assert.equal(edited.source.sha256,first.source.sha256);assert.match(edited.package.score_json,/9007199254740993/);
 const pending=queue.select([vsqFile('late.vsq')]);await until(()=>waiting);await queue.select([midiFile('new.mid')]);gate.resolve();await pending;assert.equal(queue.snapshot().rows[0].name,'new.mid');assert.equal(queue.snapshot().rows[0].draft.state,'strict_notation_candidate');assert.equal(queue.artifacts.size,1);
});

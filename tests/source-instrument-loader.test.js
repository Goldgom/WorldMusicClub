import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {SourceInstrumentDetailsLoader} from '../web/source-instrument-loader.js';

const hash='a'.repeat(64);
const score=(id='first')=>({id,source:{format:'midi-base64',content:'retained'},parts:[{id:'part-a'},{id:'part-b'}]});
const response=(sourceScore,extra={})=>({request_sha256:createHash('sha256').update(JSON.stringify(sourceScore)).digest('hex'),details:{revision:1,source_binding:{domain:'wmc-canonical-score-serde-json',serialization_revision:1,digest:hash},original_midi_sha256:hash,parts:sourceScore.parts.map(part=>({part_id:part.id,selection_status:'unknown'}))},...extra});
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};

test('canonical details are fetched once from the complete original source, never pitch/progression views',async()=>{
 const original={score:score()},requests=[],loader=new SourceInstrumentDetailsLoader({api:async(path,body)=>{requests.push({path,body});return response(body);}});
 assert.equal(loader.read(original).sourceInstrumentDetailsStatus,'loading');
 const shifted={score:{...score(),parts:[{id:'part-a'}]},pitchView:{sourceView:original},practiceSelection:{part_ids:['part-a']},assistance:{human_targets:[]}};
 assert.equal(loader.read(shifted).sourceInstrumentDetailsToken,original.score);await flush();
 assert.equal(requests.length,1);assert.equal(requests[0].path,'/api/source-instrument-details/canonical');assert.deepEqual(requests[0].body,original.score);assert.notEqual(requests[0].body,original.score);
 assert.equal(loader.read(shifted).sourceInstrumentDetailsStatus,'ready');assert.equal(loader.read(shifted).sourceInstrumentDetails.parts.length,2);
 assert.equal(loader.read(shifted).sourceInstrumentDetails.parts[0].selection_status,'unknown');
});

test('late A response cannot become B metadata, even with the same song/part IDs',async()=>{
 const a={score:score()},b={score:score()},first=deferred(),second=deferred();let calls=0,changes=0;
 const loader=new SourceInstrumentDetailsLoader({api:()=>++calls===1?first.promise:second.promise,onChange:()=>changes++});
 loader.read(a);loader.read(b);await flush();first.resolve(response(a.score));await flush();
 assert.equal(loader.read(b).sourceInstrumentDetailsStatus,'loading');assert.equal(loader.read(b).sourceInstrumentDetails,null);
 second.resolve(response(b.score));await flush();assert.equal(loader.read(b).sourceInstrumentDetailsStatus,'ready');assert.equal(changes,2);
});

test('absent, unsupported, loading and failed disclosure remain distinct and do not retry on redraw',async()=>{
 let calls=0;const loader=new SourceInstrumentDetailsLoader({api:async()=>{calls++;throw Object.assign(Error('metadata failed'),{code:'source_projection_mismatch'});}});
 assert.equal(loader.read(null).sourceInstrumentDetailsStatus,'absent');assert.equal(loader.read({score:{parts:[]}}).sourceInstrumentDetailsStatus,'absent');
 assert.equal(loader.read({score:{parts:[],source:{format:'musicxml'}}}).sourceInstrumentDetailsStatus,'unsupported');assert.equal(calls,0);
 const context={score:score()};assert.equal(loader.read(context).sourceInstrumentDetailsStatus,'loading');await flush();
 for(let i=0;i<10;i++)assert.equal(loader.read(context).sourceInstrumentDetailsStatus,'error');assert.equal(calls,1);
 const unsupportedLoader=new SourceInstrumentDetailsLoader({api:async()=>{throw Object.assign(Error('profile'),{code:'unsupported_source_profile'});}});
 unsupportedLoader.read(context);await flush();assert.equal(unsupportedLoader.read(context).sourceInstrumentDetailsStatus,'unsupported');
});

test('metadata rejects incomplete, duplicate, foreign parts and invalid source binding',async()=>{
 for(const corrupt of [r=>r.details.parts.pop(),r=>r.details.parts[1].part_id='part-a',r=>r.details.parts[1].part_id='foreign',r=>r.details.source_binding.digest='bad',r=>r.details.source_binding.domain='other']){
  const context={score:score()},result=response(context.score);corrupt(result);
  const loader=new SourceInstrumentDetailsLoader({api:async()=>result});loader.read(context);await flush();assert.equal(loader.read(context).sourceInstrumentDetailsStatus,'error');assert.equal(loader.read(context).sourceInstrumentDetails,null);
 }
});

test('Basic native request carries original saved source and requires matching response descriptor',async()=>{
 const original={score:score(),cleanSong:{libraryKey:`native:song-${hash}`,identity:hash,profile:'wmh-basic-keys-midi1-v1',runtime:{rendition:{}}}},requests=[];
 const loader=new SourceInstrumentDetailsLoader({api:async(path,body)=>{requests.push({path,body});const result=response(original.score,{source:body.source});result.details.source_binding.domain='wmc-basic-complete-wire-json';return result;}});
 loader.read({score:score('shifted'),pitchView:{sourceView:original}});await flush();
 assert.equal(loader.read(original).sourceInstrumentDetailsStatus,'ready');assert.equal(requests[0].path,'/api/library/source-instrument-details');
 assert.deepEqual(requests[0].body,{source:{key:`song-${hash}`,content_sha256:hash,profile:'wmh-basic-keys-midi1-v1',choice:null,runtime_policy:'wmh-basic-key-rendition-fifo-v1'}});
 const mismatched=new SourceInstrumentDetailsLoader({api:async()=>response(original.score,{source:{...requests[0].body.source,content_sha256:'b'.repeat(64)}})});
 mismatched.read(original);await flush();assert.equal(mismatched.read(original).sourceInstrumentDetailsStatus,'error');
});


test('same part IDs with a foreign valid request digest are rejected',async()=>{
 const context={score:score()},foreign=response(score('other-source'));
 const loader=new SourceInstrumentDetailsLoader({api:async()=>foreign});loader.read(context);await flush();
 assert.equal(loader.read(context).sourceInstrumentDetailsStatus,'error');
});

test('in-place mutation during disclosure cannot install old metadata',async()=>{
 const context={score:score()},pending=deferred(),requests=[];
 const loader=new SourceInstrumentDetailsLoader({api:async(path,body)=>{requests.push(body);return pending.promise;}});
 loader.read(context);await flush();context.score.source.content='changed in place';
 pending.resolve(response(requests[0]));await flush();
 assert.equal(loader.read(context).sourceInstrumentDetailsStatus,'error');assert.equal(loader.read(context).sourceInstrumentDetails,null);
 assert.equal(requests[0].source.content,'retained');assert.equal(requests.length,1);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {SourceIdentityLoader} from '../web/source-identity-loader.js';
import {SourceInstrumentDetailsLoader} from '../web/source-instrument-loader.js';
import {identityContext,identityResponse,numericResponse} from './source-identity-fixtures.js';
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};

test('identity is deferred, cached once and bound to the complete original Basic source through pitch views',async()=>{
 const original=identityContext(),before=JSON.stringify(original),requests=[],loader=new SourceIdentityLoader({api:async(path,body)=>{requests.push({path,body});return identityResponse(original);}});
 for(let i=0;i<20;i++)assert.equal(loader.read(original,{load:false}).sourceIdentityStatus,'idle');await flush();assert.equal(requests.length,0);
 assert.equal(loader.read(original).sourceIdentityStatus,'loading');await flush();const value=loader.read(original);assert.equal(value.sourceIdentityStatus,'ready');
 assert.equal(value.sourceIdentityIndex.parts.get(original.score.parts[0].id).attack_count,3,'Includes zero-length and unresolved-end attacks omitted from notation');
 assert.equal(original.cleanSong.score.performance.notes,undefined,'Real compact wire omits expanded notes');
 const shifted={score:{parts:[]},cleanSong:{profile:'wrong'},pitchView:{sourceView:original}};
 for(let i=0;i<30;i++)assert.equal(loader.read(shifted,{load:Boolean(i%2)}).sourceIdentityIndex,value.sourceIdentityIndex);
 assert.equal(requests.length,1);assert.equal(requests[0].path,'/api/library/source-identity');assert.deepEqual(requests[0].body,{source:identityResponse(original).source});assert.equal(JSON.stringify(original),before);
 assert.notEqual(value.sourceIdentityIndex.sourceBinding.digest,original.cleanSong.identity,'Package and core digests are independent domains');
});

test('canonical, missing and other clean profiles never request or reinterpret GM identity',async()=>{
 const loader=new SourceIdentityLoader({api:()=>{throw Error('must not request');}});
 assert.equal(loader.read(null).sourceIdentityStatus,'absent');
 for(const context of [{score:{parts:[],source:{format:'midi-base64'}}},{score:{parts:[]},cleanSong:{profile:'wmh-vsq-clean-v1',get libraryKey(){throw Error('Unsupported identity read');}}}])for(const load of [true,false])assert.equal(loader.read(context,{load}).sourceIdentityStatus,'unsupported');
});

test('late A never installs into B with equal part IDs, and each result index stays source scoped',async()=>{
 const a=identityContext(),b=identityContext(),held=deferred();b.cleanSong.identity='b'.repeat(64);b.cleanSong.libraryKey=`native:song-${b.cleanSong.identity}`;let count=0,changes=0;
 const loader=new SourceIdentityLoader({api:()=>++count===1?held.promise:Promise.resolve(identityResponse(b,{known:true})),onChange:()=>changes++});
 loader.read(a);loader.read(b);await flush();const ready=loader.read(b);assert.equal(ready.sourceIdentityStatus,'ready');
 held.resolve(identityResponse(a));await flush();assert.equal(loader.read(b).sourceIdentityIndex,ready.sourceIdentityIndex);assert.equal(loader.read(a).sourceIdentityIndex.parts.get(a.score.parts[0].id).unresolved_count,3);assert.equal(changes,2);
});

test('reject stale descriptors, policy revisions, forged provenance, wrong references and incomplete summaries',async()=>{
 const corruptions=[
  r=>r.source.content_sha256='b'.repeat(64),r=>r.source.key='song-'+('b'.repeat(64)),r=>r.source.choice='base_notes_instrumental',r=>r.source.extra='cached',
  r=>r.details.revision=2,r=>r.details.analysis_policy_id='future',r=>r.details.identity_table_revision='full-gm',r=>r.details.product_policy_id='future',r=>r.details.source_profile='canonical',r=>r.details.original_bytes_verification='verified',r=>r.details.original_midi_sha256='f'.repeat(64),
  r=>r.details.source_binding.domain='saved-package',r=>r.details.source_binding.serialization_revision=2,r=>r.details.source_binding.digest='not-a-hash',r=>r.details.source_binding.extra=1,
  r=>r.details.parts.pop(),r=>r.details.parts[1].part_id=r.details.parts[0].part_id,r=>r.details.parts[0].attack_count--,r=>r.details.parts[0].unresolved_count--,r=>r.details.parts[0].mixed=true,r=>r.details.parts[0].classification='supported',
  r=>r.details.attacks.pop(),r=>r.details.attacks[1]=r.details.attacks[0],r=>r.details.attacks[0].note_id='foreign',r=>r.details.attacks[0].part_id=r.details.parts[1].part_id,r=>r.details.attacks[0].route_index=12,r=>r.details.attacks[0].tick++,r=>r.details.attacks[0].beat.numerator++,r=>r.details.attacks[0].epoch_index=12,r=>r.details.attacks[0].attack_coordinate.event=0,r=>r.details.attacks[0].reason_indices=[999],
  r=>r.details.routes[0].source_route_index=12,r=>r.details.routes[0].port=1,r=>r.details.routes[0].declaration_coordinates=[{track:0,event:3}],r=>r.details.epochs[0].id=1,r=>r.details.diagnostics[0].code='invented',
  r=>r.details.attacks[0].label='Piano',r=>r.details.attacks[0].committed_selection={program:42,program_coordinate:{track:0,event:3}},
 ];
 for(const corrupt of corruptions){const context=identityContext(),result=identityResponse(context);corrupt(result);const loader=new SourceIdentityLoader({api:async()=>result});loader.read(context);await flush();assert.equal(loader.read(context).sourceIdentityStatus,'error',String(corrupt));assert.equal(loader.read(context).sourceIdentityIndex,null);}
});

test('known labels come from Rust response, never from part names, and inconsistent identity counts reject',async()=>{
 for(const corrupt of [r=>r.details.parts[0].identity_counts[0].count++,r=>r.details.parts[0].identity_counts.push(r.details.parts[0].identity_counts[0]),r=>r.details.attacks[0].label='Different label',r=>r.details.attacks[0].reason_indices=[0],r=>r.details.attacks[0].label='x'.repeat(257)]){
  const context=identityContext(),response=identityResponse(context,{known:true});corrupt(response);const loader=new SourceIdentityLoader({api:async()=>response});loader.read(context);await flush();assert.equal(loader.read(context).sourceIdentityStatus,'error');
 }
 const context=identityContext(),loader=new SourceIdentityLoader({api:async()=>identityResponse(context,{known:true,label:'<img src=x> Rust label'})});context.score.parts[0].name='Untrusted violin';loader.read(context);await flush();assert.equal(loader.read(context).sourceIdentityIndex.parts.get(context.score.parts[0].id).identities[0].label,'<img src=x> Rust label');
});

test('in-place original-source mutation while loading cannot publish stale identity',async()=>{
 for(const mutate of [c=>c.cleanSong.identity='f'.repeat(64),c=>c.cleanSong.score.performance.tracks[0].events[3][1][1]++,c=>c.cleanSong.score_json+=' ',c=>c.score={...c.score}]){
  const context=identityContext(),response=identityResponse(context),held=deferred(),loader=new SourceIdentityLoader({api:()=>held.promise});loader.read(context);await flush();mutate(context);held.resolve(response);await flush();assert.equal(loader.read(context).sourceIdentityStatus,'error');
 }
});

test('failed or older identity endpoint stays cached while numeric details load independently, and vice versa',async()=>{
 for(const code of ['not_found','source_identity_response_limit','analysis_limit','internal_error']){
  const context=identityContext(),requests=[],api=async(path)=>{requests.push(path);if(path==='/api/library/source-identity')throw Object.assign(Error(code),{code});return numericResponse(context);},identity=new SourceIdentityLoader({api}),numeric=new SourceInstrumentDetailsLoader({api});
  identity.read(context);numeric.read(context);await flush();for(let i=0;i<10;i++){assert.equal(identity.read(context).sourceIdentityStatus,'error');assert.equal(numeric.read(context).sourceInstrumentDetailsStatus,'ready');}assert.equal(requests.length,2);
 }
 const context=identityContext(),api=async path=>{if(path.includes('source-instrument'))throw Error('numeric failed');return identityResponse(context,{known:true});},identity=new SourceIdentityLoader({api}),numeric=new SourceInstrumentDetailsLoader({api});identity.read(context);numeric.read(context);await flush();assert.equal(identity.read(context).sourceIdentityStatus,'ready');assert.equal(numeric.read(context).sourceInstrumentDetailsStatus,'error');
});

test('identity output budgets reject complete over-budget data without affecting immutable source',async()=>{
 const context=identityContext(),before=JSON.stringify(context),result=identityResponse(context);result.details.large_unknown_field='a'.repeat(32*1024*1024);
 const loader=new SourceIdentityLoader({api:async()=>result});loader.read(context);await flush();assert.equal(loader.read(context).sourceIdentityStatus,'error');assert.equal(loader.read(context).sourceIdentityIndex,null);assert.equal(JSON.stringify(context),before);
});

test('zero-attack parts remain unresolved and redraws never rescan compact events or identity attacks',async()=>{
 const context=identityContext();for(const track of context.cleanSong.score.performance.tracks)for(const record of track.events)if((record[1][0]&240)===144)record[1][2]=0;context.cleanSong.score.coverage.key_attacks=0;
 const result=identityResponse(context),loader=new SourceIdentityLoader({api:async()=>result});loader.read(context);await flush();const value=loader.read(context);assert.equal(value.sourceIdentityStatus,'ready');
 for(const part of value.sourceIdentityIndex.parts.values()){assert.equal(part.attack_count,0);assert.equal(part.classification,'unresolved');assert.deepEqual(part.identities,[]);}
 Object.defineProperty(context.cleanSong.score.performance,'tracks',{get(){throw Error('A redraw rescanned source events');}});Object.defineProperty(result.details,'attacks',{get(){throw Error('A redraw rescanned identity attacks');}});
 for(let i=0;i<100;i++)assert.equal(loader.read(context,{load:Boolean(i%2)}).sourceIdentityIndex,value.sourceIdentityIndex);
});

test('source attack references cannot be reassigned across explicit logical routes on one channel',async()=>{
 // Transport fixture with two source-declared route segments and equal channel.
 // It exercises reference joining only; core route admission is tested in Rust.
 const context=identityContext(),source=context.cleanSong.score,track=source.performance.tracks[0],part=source.performance.parts[0],extra={...part,id:part.id+'-second',route:1};
 source.performance.routes.push({port:1,device_name_bytes:null});source.performance.parts.push(extra);context.score.parts.push({id:extra.id,name:'Route 2',notes:[]});
 track.events.splice(5,0,[0,[255,33,1]]);source.coverage.source_events++;
 const result=identityResponse(context);for(const attack of result.details.attacks)if(attack.attack_coordinate.track===0&&attack.attack_coordinate.event>5){attack.part_id=extra.id;attack.route_index=1;}
 result.details.parts.find(item=>item.part_id===part.id).attack_count=1;result.details.parts.find(item=>item.part_id===part.id).unresolved_count=1;result.details.parts.find(item=>item.part_id===extra.id).attack_count=2;result.details.parts.find(item=>item.part_id===extra.id).unresolved_count=2;
 const loader=new SourceIdentityLoader({api:async()=>result});loader.read(context);await flush();assert.equal(loader.read(context).sourceIdentityStatus,'ready');
 const forged=structuredClone(result);const attack=forged.details.attacks.find(attack=>attack.part_id===extra.id);attack.part_id=part.id;attack.route_index=0;
 const rejected=new SourceIdentityLoader({api:async()=>forged});rejected.read(context);await flush();assert.equal(rejected.read(context).sourceIdentityStatus,'error');
});

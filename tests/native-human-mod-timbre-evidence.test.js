import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {humanModTimbreFixture,HUMAN_MOD_TIMBRE_PARTS} from '../scripts/prepare-human-mod-timbre-fixtures.mjs';
import {HUMAN_MOD_TIMBRE_PHASES,HUMAN_MOD_TIMBRE_SOURCE_LIMIT,HUMAN_MOD_TIMBRE_SOURCE_FILES,validateHumanModSourceBinding,validateHumanModStorageSequence,validateHumanModRenderer,validateHumanModNativeActions,validateHumanNativeSelectActivations} from '../scripts/verify-native-human-mod-timbre-evidence.mjs';
import {defaultSongMod,songModIdentity,songModConfigFingerprint,SongModStore,SONG_MOD_LEGACY_STORAGE_PREFIX} from '../web/song-mod.js';
import {syntheticFixture,addSyntheticReleasedCheckpoint} from './human-mod-proof-fixtures.js';
import {humanModFixtureCompilation,humanModFixtureTargets} from '../scripts/human-mod-timbre-sample-proof.mjs';
import {validateHostedHumanModTimbre} from '../scripts/verify-human-mod-timbre-hosted.mjs';
import {liveToneCleanup} from './live-tone-evidence-fixtures.js';
import {syntheticNativeLiveToneNavigationCase} from './native-live-tone-navigation-fixtures.js';

function storage(){const {score}=humanModTimbreFixture(),identity=songModIdentity({score}),store=new SongModStore(),mod=defaultSongMod({score,practiceSelection:{kind:'all'}});mod.config.parts.forEach((p,i)=>p.instrument=i?'triangle':'reed');mod.configFingerprint=songModConfigFingerprint(mod.config,2);const legacy=structuredClone(mod);legacy.version=1;legacy.config.parts.forEach(p=>delete p.liveInstrument);legacy.configFingerprint=songModConfigFingerprint(legacy.config,1);const keys={legacyKey:store.key(identity,SONG_MOD_LEGACY_STORAGE_PREFIX),v2Key:store.key(identity)},empty={...keys,legacy:null,v2:null},old={...keys,legacy:JSON.stringify(legacy),v2:null},saved={...old,v2:JSON.stringify(mod)};return{empty,old,saved};}
function reports(){const s=storage();return[{phase:HUMAN_MOD_TIMBRE_PHASES[0],storageBefore:s.empty,storageAfter:s.old},{phase:HUMAN_MOD_TIMBRE_PHASES[1],storageBefore:s.old,storageAfter:s.saved},{phase:HUMAN_MOD_TIMBRE_PHASES[2],storageBefore:s.saved,storageAfter:s.saved}].map(value=>structuredClone(value));}

test('original fixture bytes and legacy/profile transitions are deterministic and source-bound',()=>{const a=humanModTimbreFixture(),b=humanModTimbreFixture();assert.deepEqual(a,b);assert.equal(a.manifest.rights.kind,'original_exercise');assert.equal(a.manifest.rights.license,'CC0-1.0');assert.deepEqual(a.score.parts.map(p=>p.notes.map(n=>[n.at,n.duration,n.pitch])),[a.score.parts[0].notes.map(n=>[n.at,n.duration,n.pitch]),a.score.parts[0].notes.map(n=>[n.at,n.duration,n.pitch])]);assert.deepEqual(a.score.parts.map(p=>p.id),HUMAN_MOD_TIMBRE_PARTS);validateHumanModStorageSequence(reports());});
for(const [name,mutate]of [
 ['missing original legacy bytes',r=>r[1].storageBefore.legacy=null],['wrong process order',r=>r.reverse()],['silent v1 overwrite',r=>r[1].storageAfter.legacy+=' '],['missing successful v2 save',r=>r[2].storageBefore.v2=null],['saved source mismatch',r=>{const m=JSON.parse(r[1].storageAfter.v2);m.songId='another';r[1].storageAfter.v2=JSON.stringify(m);}],['restart preference rewrite',r=>{const m=JSON.parse(r[2].storageAfter.v2);m.config.parts[0].liveInstrument='guitar';m.configFingerprint=songModConfigFingerprint(m.config);r[2].storageAfter.v2=JSON.stringify(m);}]
])test(`storage proof rejects ${name}`,()=>{const r=reports();mutate(r);assert.throws(()=>validateHumanModStorageSequence(r));});

test('native proof source inventory includes exact live recipes, input, controls and closed host admission',()=>{assert.equal(HUMAN_MOD_TIMBRE_SOURCE_LIMIT,160);assert.equal(HUMAN_MOD_TIMBRE_SOURCE_FILES.length,135);assert.ok(HUMAN_MOD_TIMBRE_SOURCE_FILES.length<=HUMAN_MOD_TIMBRE_SOURCE_LIMIT);assert.equal(new Set(HUMAN_MOD_TIMBRE_SOURCE_FILES).size,HUMAN_MOD_TIMBRE_SOURCE_FILES.length);for(const name of ['web/transport.js','web/app.js','web/part-instrument-policy.js','web/live-tone-core.js','crates/desktop-shell/src/acceptance.rs','scripts/windows-live-tone-navigation.cs'])assert.ok(HUMAN_MOD_TIMBRE_SOURCE_FILES.includes(name));const binding={source_sha:'1'.repeat(40),source_tree:'2'.repeat(40),source_hashes:Object.fromEntries(HUMAN_MOD_TIMBRE_SOURCE_FILES.map(p=>[p,'3'.repeat(64)]))};validateHumanModSourceBinding(binding,structuredClone(binding));for(const change of [v=>delete v.source_hashes['web/app.js'],v=>v.source_sha='4'.repeat(40),v=>v.source_hashes['web/transport.js']='5'.repeat(64)]){const value=structuredClone(binding);change(value);assert.throws(()=>validateHumanModSourceBinding(value,binding));}});

function renderer(){
 const fixture=humanModTimbreFixture(),s=storage(),compilation=humanModFixtureCompilation();
 const report={version:1,scenario:'human-mod-timbre',phase:'human-timbre-migrate',origin:'https://wmh.localhost',ok:true,stage:'complete',physicalAudio:false,errors:[],actions:40,sourceScoreJson:fixture.bytes.toString(),compilation,cleanup:{live:liveToneCleanup,source:liveToneCleanup},storageBefore:s.old,storageAfter:s.saved,states:[{label:'legacy-read',parts:HUMAN_MOD_TIMBRE_PARTS.map((partId,i)=>({partId,performer:'human',instrument:i?'triangle':'reed',liveInstrument:'follow'}))},{label:'draft-conflict',applyDisabled:true,routing:'Human 1 piano; Human 2 guitar'},{label:'unify-guitar',unify:'Human 1, Human 2: Guitar-style basic synthesis'}],files:{},samples:[]},exported={};
 for(const [i,instrument]of ['guitar','piano'].entries()){
  const f=syntheticFixture({instrument}),e=addSyntheticReleasedCheckpoint(f.e),converted=structuredClone(f.options.take);
  const groups=[[compilation.timeline.notes[0],compilation.timeline.notes[1]],[compilation.timeline.notes[2],compilation.timeline.notes[3]]];
  converted.score_id=fixture.score.id;converted.practice_part=null;converted.practice_selection={kind:'all',part_ids:[...HUMAN_MOD_TIMBRE_PARTS]};
  converted.target_plan=humanModFixtureTargets('piano');
  converted.passes[0].timeline=structuredClone(converted.target_plan.timeline);converted.passes[0].range={start_ms:0,end_ms:64000};
  const hit=converted.passes[0].assessment.hits[0];hit.note_id=groups[0][0].id;hit.expected_ms=0;hit.delta_ms=hit.actual_ms;converted.passes[0].assessment.misses=[groups[1][0].id];
  const mod=JSON.parse(s.saved.v2);mod.config.parts.forEach(part=>part.liveInstrument=instrument);mod.configFingerprint=songModConfigFingerprint(mod.config);converted.song_mod=mod;
  const file=`human-timbre-migrate-${i+1}.json`;report.files[`${instrument}Take`]=file;exported[`${instrument}Take`]=Buffer.from(JSON.stringify(converted));report.samples.push({label:instrument,expectedInstrument:instrument,performanceInstrument:'piano',keyDown:10+i*10,keyUp:11+i*10,audio:e,transport:f.options.transport,takeFile:file});
 }
 report.files.afterCancel='human-timbre-migrate-3.json';exported.afterCancel=Buffer.from(exported.guitarTake);report.files.score='human-timbre-migrate-4.json';exported.score=fixture.bytes;return{report,exported};
}
function hosted(){
 const f=renderer(),fixture=humanModTimbreFixture(),saved=storage();const samples=f.report.samples.map(row=>({...structuredClone(row),take:JSON.parse(f.exported[`${row.label}Take`])}));
 for(const sample of samples){sample.performanceInstrument=sample.expectedInstrument;sample.take.song_mod=JSON.parse(saved.saved.v2);sample.take.target_plan=humanModFixtureTargets(sample.performanceInstrument);sample.take.passes[0].timeline=structuredClone(sample.take.target_plan.timeline);sample.take.passes[0].assessment.misses=sample.take.target_plan.timeline.notes.filter(note=>note.id!==sample.take.passes[0].assessment.hits[0]?.note_id).map(note=>note.id);}
 for(const [label,index,performanceInstrument]of [['follow-guitar-after-mode',0,'guitar'],['follow-after-reload',1,'piano']]){const sample=structuredClone(samples[index]);sample.label=label;sample.performanceInstrument=performanceInstrument;sample.take.song_mod=JSON.parse(saved.saved.v2);sample.take.target_plan=humanModFixtureTargets(performanceInstrument);sample.take.passes[0].timeline=structuredClone(sample.take.target_plan.timeline);sample.take.passes[0].assessment.misses=sample.take.target_plan.timeline.notes.filter(note=>note.id!==sample.take.passes[0].assessment.hits[0]?.note_id).map(note=>note.id);samples.push(sample);}
 const conflictMod=JSON.parse(saved.saved.v2);conflictMod.config.parts[0].liveInstrument='piano';conflictMod.config.parts[1].liveInstrument='guitar';conflictMod.configFingerprint=songModConfigFingerprint(conflictMod.config);const conflictBytes=JSON.stringify(conflictMod);
 return{conflictBeforeCancel:conflictBytes,conflictAfterCancel:conflictBytes,version:1,scenario:'human-mod-timbre',ok:true,physicalAudio:false,fixture:fixture.manifest,sourceScore:fixture.score,compilation:f.report.compilation,samples,cleanup:[f.report.cleanup,structuredClone(f.report.cleanup)],storage:{legacy:saved.saved.legacy,v2:saved.saved.v2},legacy:{key:saved.saved.legacyKey,v2Key:saved.saved.v2Key,raw:saved.old.legacy},states:[{...f.report.states[1],repairVisible:true},{label:'legacy-read',repairVisible:false},{label:'repaired-draft',repairVisible:false},{label:'changed-default-conflict',startDisabled:true,summary:'Human 1 piano, Human 2 guitar'},{label:'listen-mode',mode:'listen'},{label:'human-mode',mode:'practice'},{label:'v2-reopened',performanceInstrument:'piano',repairVisible:false}].map(state=>({...state,liveToneControls:0}))};
}

test('synthetic renderer contract requires both real-recipe accounting shapes and byte-identical Cancel exports',()=>{const f=renderer();validateHumanModRenderer(f.report,f.exported);});
for(const [name,mutate]of [['missing PCM sample',f=>f.report.samples.pop()],['recipe swap',f=>f.report.samples[0].expectedInstrument='piano'],['source changed',f=>f.exported.score=Buffer.from('{}')],['Cancel take changed',f=>f.exported.afterCancel=Buffer.from('{}')],['conflict accepted',f=>f.report.states[1].applyDisabled=false],['silence leaked',f=>f.report.samples[0].audio.checkpoints[0].pcm.blocks[1].peak=.1],['failed cleanup',f=>f.report.cleanup.live={...liveToneCleanup,restored:false}]])test(`renderer contract rejects ${name}`,()=>{const f=renderer();mutate(f);assert.throws(()=>validateHumanModRenderer(f.report,f.exported));});

function nativeActions(){const f=syntheticNativeLiveToneNavigationCase();const r=f.report;const sample={keyDown:r.actionRoles.keyDown,keyUp:r.actionRoles.keyUp,audio:r.audio};r.samples=[sample];r.phase='human-timbre-migrate';// Keep only a self-contained owned click and the original held-key pair.
 const keep=[r.actionRoles.keyFocus,r.actionRoles.keyDown,r.actionRoles.keyUp],map=new Map(keep.map((v,i)=>[v,i+1]));const actions=f.actions.filter(a=>map.has(a.sequence)).map(a=>({...a,sequence:map.get(a.sequence)})),results=keep.map(n=>f.results[n-1]);r.actions=3;r.controlActions=r.controlActions.filter(c=>map.has(c.sequence)).map(c=>({...c,sequence:map.get(c.sequence),request:{...c.request,sequence:map.get(c.sequence)},clicks:c.clicks.map(v=>({...v,sequence:map.get(v.sequence)}))}));r.trustedActions=r.trustedActions.filter(v=>map.has(v.sequence)).map(v=>({...v,sequence:map.get(v.sequence)}));r.keyPreparations=r.keyPreparations.map(p=>({...p,sequence:map.get(p.sequence)}));sample.keyDown=2;sample.keyUp=3;const host={...f.host,actions:3};
 Object.assign(results[0].client_click,{client:[0,0,1280,720],origin:[0,31],work_area:[0,0,1280,751],requested:[160,151],actual:[160,151]});
 return{r,host,actions,results};
}

test('native actions reject forged foreground, key ownership, timestamps and selector changes',()=>{const {r,host,actions,results}=nativeActions();validateHumanModNativeActions(r,host,actions,results);for(const change of [x=>x[1].native_key.foreground=99,x=>x[2].native_key.held_before=false,x=>x[1].native_key.pointer_clicked=true,x=>x[0].client_click.hit_root=99]){const copy=structuredClone(results);change(copy);assert.throws(()=>validateHumanModNativeActions(r,host,actions,copy));}const altered=structuredClone(r);altered.trustedActions.find(v=>v.type==='keydown').eventTime++;assert.throws(()=>validateHumanModNativeActions(altered,host,actions,results));
 // Successful navigation, Apply, Cancel and Close can remove the clicked node.
 // Its truthful empty post-dispatch rect is retained, not rewritten as pre-click.
 const disappeared=structuredClone(r);disappeared.controlActions[0].afterDispatch.target={x:0,y:0,width:0,height:0};validateHumanModNativeActions(disappeared,host,actions,results);
 for(const change of [c=>c.samples.at(-1).hitOwned=false,c=>{for(const sample of c.samples)sample.target.x+=10;},c=>c.request.target.width=0]){const wrong=structuredClone(disappeared);change(wrong.controlActions[0]);assert.throws(()=>validateHumanModNativeActions(wrong,host,actions,results));}
});

// These original geometry fixtures model Win32 records only; they do not
// establish a real Windows run or replace retained native artifact inspection.
function pointerCase({x=744.75,y=160,viewport=[1024,689],client=[0,0,1024,689],origin=[0,31],workArea=[0,0,1024,720],point=[744,191]}={}){
 const value=nativeActions(),action=value.actions[0],control=value.r.controlActions[0],target={x:x-20,y:y-10,width:40,height:20};
 Object.assign(action,{x,y,width:viewport[0],height:viewport[1]});control.request={...action,target:structuredClone(target)};
 for(const sample of control.samples)Object.assign(sample,{target:structuredClone(target),width:viewport[0],height:viewport[1]});
 control.afterDispatch.target=structuredClone(target);
 Object.assign(value.results[0].client_click,{client,origin,viewport,work_area:workArea,requested:[...point],actual:[...point]});return value;
}
function validatePointerCase({r,host,actions,results}){return validateHumanModNativeActions(r,host,actions,results);}
for(const [name,geometry]of [
 ['fractional CSS target with the native title-bar origin',{}],
 ['fractional CSS target at nonunit DPI',{x:307.3,y:245.7,viewport:[1000,680],client:[0,0,1250,850],origin:[12,31],workArea:[0,0,1280,900],point:[396,338]}],
 ['nonunit DPI and a negative monitor origin',{x:307.3,y:245.7,viewport:[1000,680],client:[0,0,1250,850],origin:[-1268,-869],workArea:[-1280,-900,0,0],point:[-884,-562]}],
])test(`native pointer maps ${name} exactly`,()=>{validatePointerCase(pointerCase(geometry));});
for(const [name,mutate]of [
 ['missing client bounds',p=>delete p.client],['missing origin',p=>delete p.origin],['missing work area',p=>delete p.work_area],
 ['malformed client bounds',p=>p.client.pop()],['fractional native coordinate',p=>p.origin[0]=.5],['nonzero client origin',p=>p.client[0]=1],
 ['empty physical client',p=>p.client[2]=0],['wrong physical client width',p=>p.client[2]+=100],['wrong physical client height',p=>p.client[3]+=100],
 ['wrong screen origin',p=>p.origin[1]++],['changed CSS viewport',p=>p.viewport[0]++],
 ['empty work area',p=>p.work_area[2]=p.work_area[0]],['point before work area',p=>p.work_area[0]=p.actual[0]+1],
 ['point at exclusive right edge',p=>p.work_area[2]=p.actual[0]],['point at exclusive bottom edge',p=>p.work_area[3]=p.actual[1]],
 ['out-of-range native coordinate',p=>p.origin[0]=2147483648],['mapped Win32 overflow',p=>p.origin[0]=2147483647],
 ['CSS coordinates copied as screen pixels',p=>p.requested=p.actual=[744.75,160]],['ceil instead of floor',p=>p.requested=p.actual=[745,191]],
 ['changed requested point',p=>p.requested[0]++],['moved actual pointer',p=>p.actual[0]++],
 ['lost foreground ownership',p=>p.foreground=99],['foreign root window',p=>p.hit_root=99],['foreign app window',p=>p.app_hwnd=p.foreground=p.hit_root=99],
])test(`native pointer rejects ${name}`,()=>{const value=pointerCase();mutate(value.results[0].client_click);assert.throws(()=>validatePointerCase(value));});

function idlessControl(){const value=pointerCase(),control=value.r.controlActions[0],raw=value.r.trustedActions.find(row=>row.type==='click');value.r.key='song-'+'a'.repeat(64);control.id=null;control.selector=`#catalog [data-library-key="native:${value.r.key}"]`;control.clicks[0].id=null;Object.assign(raw,{id:null,controlId:null,controlSelector:control.selector,controlPathOwned:true,actionSequence:control.sequence});return value;}
test('ID-less native raw clicks remain bound to their exact requested selector and original identity',()=>{for(const selector of [undefined,'#settings-dialog .practice-options > summary']){const value=idlessControl();if(selector){value.r.controlActions[0].selector=selector;value.r.trustedActions.find(row=>row.type==='click').controlSelector=selector;}validatePointerCase(value);}});
for(const [name,mutate]of [
 ['missing raw click',v=>v.r.trustedActions=v.r.trustedActions.filter(row=>row.type!=='click')],
 ['missing requested selector',(v,c,r)=>delete c.selector],['missing both selectors',(v,c,r)=>{delete c.selector;delete r.controlSelector;}],
 ['missing selector binding',(v,c,r)=>delete r.controlSelector],['foreign selector',(v,c,r)=>r.controlSelector='#catalog button'],
 ['foreign requested selector',(v,c,r)=>c.selector=r.controlSelector='#catalog button'],['wrong original source selector',(v,c,r)=>c.selector=r.controlSelector='#catalog [data-library-key="native:song-'+ 'b'.repeat(64)+'"]'],
 ['missing composed path',(v,c,r)=>delete r.controlPathOwned],['unowned composed path',(v,c,r)=>r.controlPathOwned=false],
 ['untrusted raw event',(v,c,r)=>r.isTrusted=false],['changed raw target',(v,c,r)=>r.id='invented'],['wrong action sequence',(v,c,r)=>r.actionSequence++],
 ['nonfinite event timestamp',(v,c,r)=>r.eventTime=NaN],['wrong event type',(v,c,r)=>r.type='change'],['duplicated raw click',(v,c,r)=>v.r.trustedActions.push(structuredClone(r))],
])test(`ID-less native event proof rejects ${name}`,()=>{const value=idlessControl(),control=value.r.controlActions[0],raw=value.r.trustedActions.find(row=>row.type==='click');mutate(value,control,raw);assert.throws(()=>validatePointerCase(value));});

const windowsSelectEvidence=JSON.parse(readFileSync(new URL('./fixtures/native-human-timbre/windows-select-activation.json',import.meta.url),'utf8'));
test('native human selections accept unchanged original Windows popup activation receipts',()=>{
 assert.equal(windowsSelectEvidence.provenance.run_id,37480384264);for(const report of windowsSelectEvidence.reports)validateHumanNativeSelectActivations(report);
 validateHumanNativeSelectActivations({phase:'human-timbre-seed',controlActions:[],trustedActions:[]});
});
for(const [name,mutate]of [
 ['missing selection',r=>r.controlActions=r.controlActions.filter(c=>c.sequence!==10)],['extra selection',r=>r.controlActions.push(structuredClone(r.controlActions.find(c=>c.sequence===10)))],
 ['wrong closed position',(r,c)=>c.kind=c.request.kind='select-last'],['unowned modal',(r,c)=>c.samples[0].modalOwner='settings-dialog'],['occluded selector',(r,c)=>c.samples[0].hitOwned=false],
 ['missing commit click',(r,c)=>c.clicks.pop()],['third selector click',(r,c)=>c.clicks.push(structuredClone(c.clicks[0]))],['untrusted commit click',(r,c)=>c.clicks[1].trusted=false],['foreign commit click',(r,c)=>c.clicks[1].owned=false],
 ['missing input',r=>r.trustedActions=r.trustedActions.filter(e=>e.sequence!==10||e.type!=='input')],['missing change',r=>r.trustedActions=r.trustedActions.filter(e=>e.sequence!==10||e.type!=='change')],
 ['changed part identity',(r,c,e)=>e.part='human-two'],['changed field identity',(r,c,e)=>e.modField='instrument'],['changed selected value',(r,c,e)=>e.value='guitar'],['changed initial value',r=>r.trustedActions.find(e=>e.sequence===10).value='piano'],
 ['untrusted change',(r,c,e)=>e.isTrusted=false],['wrong action sequence',(r,c,e)=>e.actionSequence++],['forged input timestamp',(r,c,e)=>e.eventTime=0],
 ['unordered change',r=>r.trustedActions.find(e=>e.sequence===10&&e.type==='change').eventTime=1],
 ['missing following action',r=>r.controlActions=r.controlActions.filter(c=>c.sequence!==13)],['untrusted following pointer',r=>r.trustedActions.find(e=>e.sequence===13).isTrusted=false],
 ['foreign Enter release',r=>r.trustedActions.find(e=>e.sequence===11&&e.type==='keyup').code='Escape'],['repeated Enter release',r=>r.trustedActions.find(e=>e.sequence===11&&e.type==='keyup').repeat=true],
 ['Enter before its native activation',r=>r.trustedActions.find(e=>e.sequence===11&&e.type==='keyup').eventTime=0],['Enter after following pointer',r=>r.trustedActions.find(e=>e.sequence===11&&e.type==='keyup').eventTime=r.trustedActions.find(e=>e.sequence===12).eventTime],
 ['extra hardware event',r=>r.trustedActions.push({...structuredClone(r.trustedActions.find(e=>e.sequence===11&&e.type==='keyup')),type:'keydown'})],
])test(`native human select proof rejects ${name}`,()=>{const report=structuredClone(windowsSelectEvidence.reports[0]),control=report.controlActions.find(c=>c.sequence===10),event=report.trustedActions.find(e=>e.sequence===10&&e.type==='input');mutate(report,control,event);assert.throws(()=>validateHumanNativeSelectActivations(report));});
test('a second click remains forbidden for an ordinary native human pointer',()=>{const value=pointerCase();value.r.controlActions[0].clicks.push(structuredClone(value.r.controlActions[0].clicks[0]));assert.throws(()=>validatePointerCase(value));});

test('hosted and native use the same strict original compilation, target, Mod and released-window contract',()=>{
 const f=renderer();validateHumanModRenderer(f.report,f.exported);validateHostedHumanModTimbre(hosted());
});
const proofMutations=[
 ['missing late original target',({take})=>{take.target_plan.timeline.notes.pop();take.passes[0].timeline.notes.pop();take.target_plan.groups.pop();take.target_plan.target_count=1;take.target_plan.source_note_count=2;take.passes[0].assessment.misses=[];}],
 ['foreign source occurrence IDs',({take})=>{for(const [i,g]of take.target_plan.groups.entries())g.source_occurrence_ids=[`fabricated-${i}-one`,`fabricated-${i}-two`];}],
 ['foreign source note owners',({take})=>{for(const g of take.target_plan.groups)g.source_note_ids=['unrelated-a','unrelated-b'];}],
 ['one millisecond source clock',({take})=>{take.target_plan.timeline.duration_ms=take.passes[0].timeline.duration_ms=1;take.passes[0].range.end_ms=1;}],
 ...[['duration_ms',1],['part_id','nonexistent-human'],['source_note_id','nonexistent-source'],['velocity',1],['voice','imaginary'],['staff',999]].map(([field,value])=>[`fabricated representative ${field}`,({take})=>{for(const timeline of [take.target_plan.timeline,take.passes[0].timeline])for(const note of timeline.notes)note[field]=value;}]),
 ['missing saved Mod',({take})=>{delete take.song_mod;}],
 ['foreign Mod source',({take})=>{take.song_mod.songId='unrelated-original';}],
 ['wrong Mod live recipe',({take})=>{take.song_mod.config.parts.forEach(p=>p.liveInstrument='piano');take.song_mod.configFingerprint=songModConfigFingerprint(take.song_mod.config);} ],
 ['lost dormant machine recipe',({take})=>{take.song_mod.config.parts[0].instrument='source';take.song_mod.configFingerprint=songModConfigFingerprint(take.song_mod.config);} ],
 ['foreign compilation source',({compilation})=>{compilation.score.id='foreign';}],
 ['edited compilation occurrence',({compilation})=>{compilation.timeline.notes[0].id='invented';}],
 ['missing compilation late notes',({compilation})=>{compilation.timeline.notes=compilation.timeline.notes.slice(0,2);}],
 ['missing released checkpoint',({sample})=>{delete sample.audio.checkpoints;}],
 ['foreign released receiver',({sample})=>{sample.audio.checkpoints[0].receiver.receiverId=999;}],
 ['foreign released node',({sample})=>{sample.audio.checkpoints[0].receiver.nodeId=999;}],
 ['foreign released generation',({sample})=>{sample.audio.checkpoints[0].receiver.generation=999;}],
 ['foreign closed receiver',({sample})=>{sample.audio.checkpoints[0].closed.receiver.nodeId=999;}],
 ['empty quiet output path',({sample})=>{for(const b of sample.audio.checkpoints[0].pcm.blocks)b.graphToDestination=[];}],
 ['zero quiet sample count',({sample})=>{for(const b of sample.audio.checkpoints[0].pcm.blocks)b.samples=0;}],
 ['zero quiet sequence',({sample})=>{for(const b of sample.audio.checkpoints[0].pcm.blocks)b.sequence=0;}],
 ['huge quiet audio clocks',({sample})=>{sample.audio.checkpoints[0].pcm.blocks.forEach((b,i)=>b.audioTime=(i+1)*100000);} ],
 ['reordered quiet blocks',({sample})=>{sample.audio.checkpoints[0].pcm.blocks.reverse();}],
 ['quiet observation outside final boundary',({sample})=>{sample.audio.checkpoints[0].pcm.blocks[0].wallMs=sample.audio.after.wallMs+1000;}],
 ['unsealed released window',({sample})=>{sample.audio.checkpoints[0].sampling='observing';}],
 ['missing window closure',({sample})=>{delete sample.audio.checkpoints[0].closed;}],
 ['stale window closure',({sample})=>{sample.audio.checkpoints[0].closed.wallMs+=1000;}],
 ['missing established silence',({sample})=>{delete sample.audio.silenceEstablished;}],
 ['muted quiet graph',({sample})=>{sample.audio.checkpoints[0].pcm.blocks[0].graphToDestination[1].gain=0;}],
 ['different source receiver during silence',({sample})=>{sample.audio.checkpoints[0].source.started++;}],
];
for(const consumer of ['native','hosted'])for(const [name,mutate]of proofMutations)test(`${consumer} original fixture proof rejects ${name}`,()=>{
 if(consumer==='native'){const f=renderer(),sample=f.report.samples[0],take=JSON.parse(f.exported.guitarTake);mutate({sample,take,compilation:f.report.compilation});f.exported.guitarTake=Buffer.from(JSON.stringify(take));f.exported.afterCancel=Buffer.from(f.exported.guitarTake);assert.throws(()=>validateHumanModRenderer(f.report,f.exported));}
 else{const report=hosted();mutate({sample:report.samples[0],take:report.samples[0].take,compilation:report.compilation});assert.throws(()=>validateHostedHumanModTimbre(report));}
});

test('hosted Follow must resolve from the actual performance control and retained preference',()=>{const report=hosted();report.samples[2].performanceInstrument='piano';assert.throws(()=>validateHostedHumanModTimbre(report));});

for(const [name,mutate]of [['removed live-tone control returns',r=>r.states[0].liveToneControls=1],['normal repair visible',r=>r.states.find(s=>s.label==='legacy-read').repairVisible=true],['cancel rewrites conflict',r=>r.conflictAfterCancel+=' '],['missing saved conflict',r=>delete r.conflictBeforeCancel],['repair stays visible',r=>r.states.find(s=>s.label==='repaired-draft').repairVisible=true]])test(`hosted legacy recovery rejects ${name}`,()=>{const r=hosted();mutate(r);assert.throws(()=>validateHostedHumanModTimbre(r));});

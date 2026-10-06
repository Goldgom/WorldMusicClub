import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync,readFileSync,writeFileSync,rmSync,unlinkSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {deflateSync} from 'node:zlib';
import {HUMAN_MOD_TIMBRE_PREVIEW_CASE,verifyUiPreviewHumanModTimbre} from '../scripts/ui-preview-human-mod-timbre.mjs';
import {HUMAN_MOD_TIMBRE_BROWSER_CASE} from './human-mod-timbre-browser-regression.js';
import {LIVE_SILENCE_PREVIEW_CASES} from '../scripts/ui-preview-live-silence.mjs';
import {SKIN_BROWSER_CASES} from '../scripts/ui-preview-skin.mjs';
import {HOME_LAYOUT_PREVIEW_CASE} from '../scripts/ui-preview-home.mjs';
import {humanModTimbreFixture,HUMAN_MOD_TIMBRE_PARTS} from '../scripts/prepare-human-mod-timbre-fixtures.mjs';
import {humanModFixtureCompilation} from '../scripts/human-mod-timbre-sample-proof.mjs';
import {defaultSongMod,songModConfigFingerprint} from '../web/song-mod.js';
import {syntheticFixture,addSyntheticReleasedCheckpoint} from './human-mod-proof-fixtures.js';
import {liveToneCleanup} from './live-tone-evidence-fixtures.js';

const {name,report,screenshot}=HUMAN_MOD_TIMBRE_PREVIEW_CASE,passing=`ok 24 - ${name}`,sha=bytes=>createHash('sha256').update(bytes).digest('hex');
// These invented records and pixels exercise admission only. They are never
// retained or presented as actual hosted/native application evidence.
function syntheticReport(){
  const fixture=humanModTimbreFixture(),compilation=humanModFixtureCompilation(),mod=defaultSongMod({score:fixture.score,practiceSelection:{kind:'all'}});
  mod.config.parts.forEach((part,index)=>part.instrument=index?'triangle':'reed');mod.configFingerprint=songModConfigFingerprint(mod.config);
  const legacy=structuredClone(mod);legacy.version=1;legacy.config.parts.forEach(part=>delete part.liveInstrument);legacy.configFingerprint=songModConfigFingerprint(legacy.config,1);
  const samples=[['guitar','guitar','piano'],['piano','piano','piano'],['follow-guitar-after-mode','guitar','guitar'],['follow-after-reload','piano','piano']].map(([label,instrument,performanceInstrument])=>{
    const f=syntheticFixture({instrument}),take=f.options.take,groups=[compilation.timeline.notes.slice(0,2),compilation.timeline.notes.slice(2)];
    take.score_id=fixture.score.id;take.practice_part=null;take.practice_selection={kind:'all',part_ids:[...HUMAN_MOD_TIMBRE_PARTS]};take.song_mod=structuredClone(mod);
    take.song_mod.config.parts.forEach(part=>part.liveInstrument=label.startsWith('follow-')?'follow':instrument);take.song_mod.configFingerprint=songModConfigFingerprint(take.song_mod.config);
    take.target_plan={playable:true,diagnostics:[],source_note_count:4,target_count:2,timeline:{duration_ms:64000,notes:groups.map(notes=>({...structuredClone(notes[0]),source_note_ids:notes.map(note=>note.source_note_id)}))},groups:groups.map(notes=>({target_id:notes[0].id,source_occurrence_ids:notes.map(note=>note.id),source_note_ids:notes.map(note=>note.source_note_id),part_ids:notes.map(note=>note.part_id)}))};
    take.passes[0].timeline=structuredClone(take.target_plan.timeline);take.passes[0].range={start_ms:0,end_ms:64000};const hit=take.passes[0].assessment.hits[0];hit.note_id=groups[0][0].id;hit.expected_ms=0;hit.delta_ms=hit.actual_ms;take.passes[0].assessment.misses=[groups[1][0].id];
    return{label,expectedInstrument:instrument,performanceInstrument,audio:addSyntheticReleasedCheckpoint(f.e),transport:f.options.transport,take};
  });
  return{version:1,scenario:'human-mod-timbre',ok:true,physicalAudio:false,fixture:fixture.manifest,sourceScore:fixture.score,compilation,samples,cleanup:Array.from({length:2},()=>({live:structuredClone(liveToneCleanup),source:structuredClone(liveToneCleanup)})),legacy:{raw:JSON.stringify(legacy)},storage:{legacy:JSON.stringify(legacy),v2:JSON.stringify(mod)},states:[{label:'draft-conflict',applyDisabled:true,routing:'Human 1 Human 2'},{label:'changed-default-conflict',startDisabled:true,summary:'Human 1 Human 2'},{label:'listen-mode',mode:'listen'},{label:'human-mode',mode:'practice'},{label:'v2-reopened',performanceInstrument:'piano'}]};
}
function syntheticPng(){
  const crc=bytes=>{let c=0xffffffff;for(const b of bytes){c^=b;for(let i=0;i<8;i++)c=c>>>1^((c&1)?0xedb88320:0);}return(c^0xffffffff)>>>0;};
  const chunk=(type,data)=>{const bytes=Buffer.alloc(data.length+12);bytes.writeUInt32BE(data.length);bytes.write(type,4);data.copy(bytes,8);bytes.writeUInt32BE(crc(bytes.subarray(4,-4)),bytes.length-4);return bytes;};
  const {width,height}=HUMAN_MOD_TIMBRE_PREVIEW_CASE.viewport,header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;header[9]=2;
  return Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',header),chunk('IDAT',deflateSync(Buffer.alloc((width*3+1)*height))),chunk('IEND',Buffer.alloc(0))]);
}
function fixture(t){const directory=mkdtempSync(join(tmpdir(),'wmh-human-timbre-preview-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));const value=syntheticReport(),png=syntheticPng();const save=()=>writeFileSync(join(directory,report),JSON.stringify(value));save();writeFileSync(join(directory,screenshot),png);return{directory,value,png,save};}

test('focused UI preview selects human timbre plus all 23 existing cases and keeps mandatory evidence gates',()=>{
  assert.equal(name,HUMAN_MOD_TIMBRE_BROWSER_CASE);
  const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8'),workflow=read('.github/workflows/ui-preview.yml'),pattern=new RegExp(workflow.match(/--test-name-pattern='([^']+)'/)[1]);
  const old=['real free piano fills desktop','original grand staff and Jianpu follow','game menu and audible song preview','normal and free piano share','original falling bars visibly cross',...['1280 by 720','1920 by 1080','844 by 390','390 by 844'].map(size=>`real D768 lobby and compact performance fit ${size}`),'short-landscape following reveals','real guitar current and next six-note','real initial compact guide stays','real compact 88-key and custom extreme guides','real piano hands preserve merged ties','real short-landscape guitar keeps a complete labelled row and transport beside notation','real home menu keeps its hitbox stable at the hover boundary',...LIVE_SILENCE_PREVIEW_CASES.map(row=>row.name),...SKIN_BROWSER_CASES.map(row=>row.name),HOME_LAYOUT_PREVIEW_CASE];
  assert.equal(old.length,23);for(const item of [...old,name])assert.ok(pattern.test(item),item);assert.equal(pattern.test(name+' extra'),false);
  for(const extension of ['json','png'])assert.ok(workflow.includes(`ui-preview/worldmusichub-human-mod-*.${extension}`));
  const verifier=read('scripts/verify-ui-preview.mjs');for(const helper of ['LiveSilence','Skin','Home','HumanModTimbre'])assert.ok(verifier.includes(`verifyUiPreview${helper}(directory,tap)`));assert.ok(verifier.includes('names.push(HOME_LAYOUT_PREVIEW_CASE)'));assert.ok(verifier.includes('names.push(HUMAN_MOD_TIMBRE_PREVIEW_CASE.name)'));
  for(const flag of ['accepted_package','windows_native_verified','physical_midi_verified','actual_speaker_output_verified'])assert.ok(verifier.includes(`${flag}:false`));
});

test('human timbre preview requires one exact executed passing TAP case before reading files',()=>{
  for(const tap of ['',passing+' # SKIP filtered',passing+' # TODO pending',passing.replace(/^ok /,'not ok '),passing+' extra',passing+'\n'+passing,passing.replace(name,'old evidence')])assert.throws(()=>verifyUiPreviewHumanModTimbre('/never-read-on-invalid-tap',tap),/Missing executed passing human-timbre preview case/);
});

test('human timbre preview revalidates retained report bytes and inventories both original files',t=>{
  const f=fixture(t),first=verifyUiPreviewHumanModTimbre(f.directory,passing);assert.deepEqual(first,[{name:report,bytes:readFileSync(join(f.directory,report)).length,sha256:sha(readFileSync(join(f.directory,report)))},{name:screenshot,bytes:f.png.length,sha256:sha(f.png),...HUMAN_MOD_TIMBRE_PREVIEW_CASE.viewport}]);
  writeFileSync(join(f.directory,report),readFileSync(join(f.directory,report),'utf8')+'\n ');const second=verifyUiPreviewHumanModTimbre(f.directory,passing);assert.notEqual(second[0].sha256,first[0].sha256);assert.equal(second[0].bytes,first[0].bytes+2);
  f.value.samples[0].audio.checkpoints[0].receiver.nodeId++;f.save();assert.throws(()=>verifyUiPreviewHumanModTimbre(f.directory,passing),'Passing TAP must not admit a forged report');
});

test('human timbre preview fails for absent, malformed, oversized or linked report and PNG evidence',t=>{
  const f=fixture(t),json=readFileSync(join(f.directory,report));
  for(const [file,original,invalid]of [[report,json,[Buffer.from('{broken'),Buffer.alloc(4*1024*1024+1)]],[screenshot,f.png,[Buffer.from('not PNG'),f.png.subarray(0,33),Buffer.alloc(8*1024*1024+1)]]]){
    const path=join(f.directory,file);unlinkSync(path);assert.throws(()=>verifyUiPreviewHumanModTimbre(f.directory,passing));for(const bytes of invalid){writeFileSync(path,bytes);assert.throws(()=>verifyUiPreviewHumanModTimbre(f.directory,passing));}writeFileSync(path,original);
  }
  const oversized=Buffer.from(f.png);oversized.writeUInt32BE(0xffffffff,16);writeFileSync(join(f.directory,screenshot),oversized);assert.throws(()=>verifyUiPreviewHumanModTimbre(f.directory,passing),/finite pixel budget/);writeFileSync(join(f.directory,screenshot),f.png);
  if(process.platform!=='win32'){const path=join(f.directory,report),target=join(f.directory,'original.json');writeFileSync(target,json);unlinkSync(path);symlinkSync(target,path);assert.throws(()=>verifyUiPreviewHumanModTimbre(f.directory,passing),/bounded ordinary/);}
});

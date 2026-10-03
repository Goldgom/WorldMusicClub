import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';

const directory=resolve(process.argv[2]||'ui-preview'),tap=readFileSync(join(directory,'tests.tap'),'utf8');
const names=['real free piano fills desktop','original grand staff and Jianpu follow','game menu and audible song preview','normal and free piano share','original falling bars visibly cross'];
for(const name of names)assert.ok(tap.split('\n').some(line=>/^ok \d+ - /.test(line)&&line.includes(name)&&!line.includes('# SKIP')),`Missing executed passing preview case: ${name}`);
const files=[];
function record(name,{size,png=false}={}){
  const bytes=readFileSync(join(directory,name)),entry={name,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
  if(png){assert.ok(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),`${name}: not PNG`);entry.width=bytes.readUInt32BE(16);entry.height=bytes.readUInt32BE(20);assert.ok(entry.width>0&&entry.height>0);if(size){const [width,height]=size.split('x').map(Number);assert.equal(entry.width,width,`${name}: wrong viewport width`);assert.ok(entry.height>=height,`${name}: incomplete image`);}}
  files.push(entry);return png?entry:JSON.parse(bytes.toString('utf8'));
}
for(const size of ['1280x720','1920x1080'])for(const name of [
  `worldmusichub-free-piano-${size}-zh-CN.png`,
  `worldmusichub-above-keyboard-${size}-staff.png`,
  `worldmusichub-above-keyboard-${size}-jianpu.png`,
  `worldmusichub-game-home-${size}.png`,
  `worldmusichub-game-lobby-${size}.png`,
  `worldmusichub-lane-overlay-live-${size}-staff.png`,
  `worldmusichub-lane-overlay-live-${size}-jianpu.png`,
])record(name,{size,png:true});
for(const size of ['1280x720','1920x1080','844x390','390x844'])for(const theme of ['light',...(size.startsWith('1280')||size.startsWith('1920')?['dark']:[])])for(const mode of ['normal','free'])record(`worldmusichub-shared-piano-${size}-${theme}-${mode}.png`,{size,png:true});
for(const mode of ['normal','free'])record(`worldmusichub-shared-piano-1280x720-${mode}-held.png`,{size:'1280x720',png:true});
for(const theme of ['light','dark'])for(const view of ['staff','jianpu'])for(const state of ['opacity100','opacity35','hidden'])record(`worldmusichub-lane-overlay-${theme}-${view}-${state}.png`,{png:true});
record('worldmusichub-free-piano-stage.json');record('worldmusichub-game-menu-preview-evidence.json');
const overlay=record('worldmusichub-above-keyboard.json');assert.equal(overlay.original_fixtures_only,true);assert.equal(overlay.paused_take_unchanged,true);assert.equal(overlay.canonical_score_unchanged,true);assert.equal(overlay.paintEvidence.length,4);
for(const paint of overlay.paintEvidence){assert.ok(paint.geometry.inside&&paint.geometry.rootInside);assert.ok(paint.geometry.intersection.width>=250&&paint.geometry.intersection.height>=100);assert.ok(paint.visiblePixels.changed>=50&&paint.visiblePixels.fraction<.55);assert.ok(paint.opacityPixels.changed>=30);assert.equal(paint.geometry_unchanged,true);assert.equal(paint.key_node_preserved,true);assert.equal(paint.redundant_musicxml_exports,0);}
const paired=record('worldmusichub-shared-piano-stage.json');assert.equal(paired.original_fixtures_only,true);assert.equal(paired.actual_paired_screenshots,true);assert.equal(paired.normal_take_preserved,true);assert.equal(paired.score_preserved,true);assert.deepEqual(paired.configured_range,{key_count:61,lowest_midi:36,highest_midi:96});assert.equal(paired.evidence.length,6);
for(const pair of paired.evidence){assert.equal(pair.normal.keys.length,61);assert.equal(pair.free.keys.length,61);assert.deepEqual(pair.normal.style,pair.free.style);assert.deepEqual(pair.normal.viewport,pair.free.viewport);}
const live=record('worldmusichub-lane-overlay-live.json');assert.equal(live.original_fixtures_only,true);assert.equal(live.actual_playback,true);assert.equal(live.evidence.length,4);for(const frame of live.evidence){assert.equal(frame.playing,true);assert.equal(frame.controls_closed,true);assert.equal(frame.current_markers,2);assert.ok(frame.geometry.canvasAlpha.opaque>20);}
const git=(...args)=>execFileSync('git',args,{encoding:'utf8'}).trim();
const result={version:2,scope:'Actual hosted Rust/browser UI preview only',source_sha:git('rev-parse','HEAD'),source_tree:git('rev-parse','HEAD^{tree}'),commit_count:Number(git('rev-list','--count','HEAD')),accepted_package:false,windows_native_verified:false,physical_midi_verified:false,actual_speaker_output_verified:false,cases:names,files};
writeFileSync(join(directory,'worldmusichub-ui-preview.json'),JSON.stringify(result,null,2));
console.log(`Verified ${files.length} source-bound UI preview files. Full checkpoint and Windows acceptance remain separate.`);

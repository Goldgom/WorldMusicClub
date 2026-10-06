import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {assertNotationHudClear} from '../tests/notation-hud-geometry.js';
import {assertHomeHoverBoundary} from '../tests/home-hover-boundary.js';
import {LIVE_SILENCE_PREVIEW_CASES,verifyUiPreviewLiveSilence} from './ui-preview-live-silence.mjs';
import {SKIN_BROWSER_CASES,verifyUiPreviewSkin} from './ui-preview-skin.mjs';
import {HOME_LAYOUT_PREVIEW_CASE,verifyUiPreviewHome} from './ui-preview-home.mjs';
import {HUMAN_MOD_TIMBRE_PREVIEW_CASE,verifyUiPreviewHumanModTimbre} from './ui-preview-human-mod-timbre.mjs';

const directory=resolve(process.argv[2]||'ui-preview'),tap=readFileSync(join(directory,'tests.tap'),'utf8');
const names=['real free piano fills desktop','original grand staff and Jianpu follow','game menu and audible song preview','normal and free piano share','original falling bars visibly cross',...['1280 by 720','1920 by 1080','844 by 390','390 by 844'].map(size=>`real D768 lobby and compact performance fit ${size}`),'short-landscape following reveals','real guitar current and next six-note','real initial compact guide stays','real compact 88-key and custom extreme guides','real piano hands preserve merged ties','real short-landscape guitar keeps a complete labelled row and transport beside notation','real home menu keeps its hitbox stable at the hover boundary',...LIVE_SILENCE_PREVIEW_CASES.map(row=>row.name),...SKIN_BROWSER_CASES.map(row=>row.name)];
for(const name of names)assert.ok(tap.split('\n').some(line=>/^ok \d+ - /.test(line)&&line.includes(name)&&!line.includes('# SKIP')),`Missing executed passing preview case: ${name}`);
const files=[...verifyUiPreviewLiveSilence(directory,tap),...verifyUiPreviewSkin(directory,tap)];
// Preserve the existing executed-case and finite-live/skin failure gates before
// adding home evidence, so absent home data cannot mask their diagnostics.
files.push(...verifyUiPreviewHome(directory,tap));names.push(HOME_LAYOUT_PREVIEW_CASE);
files.push(...verifyUiPreviewHumanModTimbre(directory,tap));names.push(HUMAN_MOD_TIMBRE_PREVIEW_CASE.name);
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
for(const size of ['1280x720','1920x1080','844x390','700x390','390x844'])for(const theme of ['light',...(size.startsWith('1280')||size.startsWith('1920')?['dark']:[])])for(const mode of ['normal','free'])record(`worldmusichub-shared-piano-${size}-${theme}-${mode}.png`,{size,png:true});
for(const mode of ['normal','free'])record(`worldmusichub-shared-piano-1280x720-${mode}-held.png`,{size:'1280x720',png:true});
for(const theme of ['light','dark'])for(const view of ['staff','jianpu'])for(const state of ['opacity100','opacity35','hidden'])record(`worldmusichub-lane-overlay-${theme}-${view}-${state}.png`,{png:true});
const homeHover=record('worldmusichub-home-hover-boundary.json');assert.equal(homeHover.version,1);
assert.deepEqual(homeHover.evidence.map(row=>[row.viewport.width,row.viewport.height,row.reducedMotion]),[[1024,689,'no-preference'],[1280,720,'no-preference'],[1920,1080,'no-preference'],[1024,689,'reduce']]);
for(const row of homeHover.evidence){assertHomeHoverBoundary(row);const size=`${row.viewport.width}x${row.viewport.height}`;record(`worldmusichub-home-hover-boundary-${size}-${row.reducedMotion}.png`,{size,png:true});}
record('worldmusichub-free-piano-stage.json');record('worldmusichub-game-menu-preview-evidence.json');
const overlay=record('worldmusichub-above-keyboard.json');assert.equal(overlay.original_fixtures_only,true);assert.equal(overlay.paused_take_unchanged,true);assert.equal(overlay.canonical_score_unchanged,true);assert.equal(overlay.paintEvidence.length,4);
for(const paint of overlay.paintEvidence){assert.ok(paint.geometry.inside&&paint.geometry.rootInside);assert.ok(paint.geometry.intersection.width>=250&&paint.geometry.intersection.height>=100);assert.ok(paint.visiblePixels.changed>=50&&paint.visiblePixels.fraction<.55);assert.ok(paint.opacityPixels.changed>=30);assert.equal(paint.geometry_unchanged,true);assert.equal(paint.key_node_preserved,true);assert.equal(paint.redundant_musicxml_exports,0);}
const paired=record('worldmusichub-shared-piano-stage.json');assert.equal(paired.original_fixtures_only,true);assert.equal(paired.actual_paired_screenshots,true);assert.equal(paired.normal_take_preserved,true);assert.equal(paired.score_preserved,true);assert.deepEqual(paired.configured_range,{key_count:61,lowest_midi:36,highest_midi:96});assert.equal(paired.evidence.length,7);
assert.deepEqual(paired.localeProof.map(row=>row.locale),['en','zh-CN']);
const portraitHeadings=paired.compactHeaderProof.filter(row=>row.normal.viewport.width===390&&row.normal.viewport.height===844);assert.deepEqual(portraitHeadings.map(row=>row.normal.locale),['en','zh-CN']);
for(const row of portraitHeadings){assert.equal(row.normal.notationExpanded,'true');for(const mode of ['normal','free']){assert.ok(row[mode].controls.every(control=>control.hit));record(`worldmusichub-compact-heading-${row[mode].locale}-390x844-${mode}.png`,{size:'390x844',png:true});}}
assert.deepEqual(paired.normalProbe.map(event=>[event.kind,event.midi,event.encoding,event.onset_capture]),[['note_on',60,'key_down',null],['note_off',null,'key_up',null]]);
assert.equal(paired.sharedFooter.one_original_node,true);assert.equal(paired.sharedFooter.score_passes_preserved,true);assert.deepEqual(paired.sharedFooter.actual_free_onsets,[60,60,60,61]);assert.deepEqual(paired.sharedFooter.transpose_configuration.map(row=>row.value.transpose_semitones),[0,1]);
for(const pair of paired.evidence){assert.equal(pair.normal.locale,'zh-CN');assert.equal(pair.free.locale,'zh-CN');assert.equal(pair.normal.keys.length,61);assert.equal(pair.free.keys.length,61);assert.deepEqual(pair.normal.style,pair.free.style);assert.deepEqual(pair.normal.viewport,pair.free.viewport);}
for(const row of overlay.evidence)for(const notes of row.currentNotes)assertNotationHudClear(notes.hud);
const live=record('worldmusichub-lane-overlay-live.json');assert.equal(live.original_fixtures_only,true);assert.equal(live.actual_playback,true);assert.equal(live.evidence.length,10);assert.deepEqual([...new Set(live.evidence.map(frame=>frame.locale))].sort(),['en','zh-CN']);for(const frame of live.evidence){assert.equal(frame.playing,true);assert.equal(frame.controls_closed,true);assert.equal(frame.current_markers,2);assert.ok(frame.geometry.canvasAlpha.opaque>20);assertNotationHudClear(frame.hud);assertNotationHudClear(frame.pausedHud);assert.equal(frame.pausedHud.cueState,'paused');}
for(const size of ['1033x403','844x390','390x844'])for(const view of ['staff','jianpu'])record(`worldmusichub-lane-overlay-live-${size}-${view}.png`,{size,png:true});
record('worldmusichub-live-piano-two-hand-guidance-844x390.png',{size:'844x390',png:true});
const piano=record('worldmusichub-live-piano-two-hands.json'),notice=record('worldmusichub-live-piano-notice-layout.json');
assert.equal(piano.notice_dismissed_by_user,true);assert.equal(piano.paused_take_unchanged,true);assert.equal(piano.canonical_score_unchanged,true);
assert.equal(notice.withNotice.notice.hidden,false);assert.equal(notice.dismissed.notice.hidden,true);assert.equal(notice.dismissed.notice.focus,'stage-title');
for(const phase of ['withNotice','dismissed']){assert.equal(notice[phase].settlementError,undefined);const samples=notice[phase].budget;assert.ok(samples.length>=1&&samples.length<=4);const last=samples.at(-1);assert.ok(Number.isFinite(last.committed)&&Number.isFinite(last.expected)&&Math.abs(last.committed-last.expected)<=.02);}
assert.deepEqual(notice.withNotice.geometry,piano.withNotice);assert.deepEqual(notice.dismissed.geometry,piano.geometry);assert.ok(piano.geometry.canvasVisible.height>piano.withNotice.canvasVisible.height);
const guitar=record('worldmusichub-live-simultaneous-844x390-guitar.json'),guitarPending=record('worldmusichub-live-guitar-render-precompletion.json'),guitarPublication=record('worldmusichub-live-guitar-render-publication.json');
record('worldmusichub-live-guitar-render-precompletion.png',{size:'844x390',png:true});record('worldmusichub-live-simultaneous-844x390-guitar.png',{size:'844x390',png:true});
const guitarVisibility=record('worldmusichub-live-simultaneous-844x390-guitar-visibility.json');
assert.equal(guitar.cold_open_before_play,true);record('worldmusichub-live-guitar-render-paused.png',{size:'844x390',png:true});assert.ok(record('worldmusichub-live-guitar-render-paused-visibility.json').meaningfullyVisibleCount>0);record('worldmusichub-live-guitar-render-follow-restored.png',{size:'844x390',png:true});assert.ok(record('worldmusichub-live-guitar-render-follow-restored-visibility.json').meaningfullyVisibleCount>0);assert.equal(guitar.manual_scroll_suspended,true);assert.equal(guitar.follow_reenabled,true);assert.equal(guitar.original_fixtures_only,true);assert.equal(guitar.paused_take_unchanged,true);assert.equal(guitar.canonical_score_unchanged,true);assert.equal(guitarPending.navigationReady,true);assert.equal(guitarPending.renderStatus,'pending');assert.equal(guitarPending.heads,0);assert.deepEqual(guitar.precompletion,guitarPending);assert.deepEqual(guitar.publication,guitarPublication);
assert.equal(guitarPublication.follow,true);assert.ok(guitarPublication.sourceIds.length>0);assert.ok(guitarPublication.heads.some(head=>head.width>=4&&head.height>=3&&head.top>=guitarPublication.clipTop&&head.bottom<=guitarPublication.clipBottom));assert.ok(guitarVisibility.meaningfullyVisibleCount>0);assert.deepEqual(guitar.notation,guitarVisibility);assert.ok(guitar.geometry.scroll.height>=56);assert.ok(guitar.firstVisible.visibleFraction>=.98);
const git=(...args)=>execFileSync('git',args,{encoding:'utf8'}).trim();
const result={version:2,scope:'Actual hosted Rust/browser UI preview only',source_sha:git('rev-parse','HEAD'),source_tree:git('rev-parse','HEAD^{tree}'),commit_count:Number(git('rev-list','--count','HEAD')),accepted_package:false,windows_native_verified:false,physical_midi_verified:false,actual_speaker_output_verified:false,live_audio_pcm_coverage:'finite-checkpoint-windows',cases:names,files};
writeFileSync(join(directory,'worldmusichub-ui-preview.json'),JSON.stringify(result,null,2));
console.log(`Verified ${files.length} source-bound UI preview files. Full checkpoint and Windows acceptance remain separate.`);

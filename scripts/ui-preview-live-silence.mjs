import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {validateLiveToneNavigation} from '../tests/live-tone-navigation-proof.js';
import {validateLiveToneCleanup} from './live-tone-proof.mjs';

export const LIVE_SILENCE_PREVIEW_CASES=Object.freeze(['settings','authoring'].flatMap(route=>['keyup','navigation'].map(release=>Object.freeze({
  route,release,name:`real unmuted live worklet verifies finite silence through ${route} after ${release}`,
  file:`worldmusichub-live-silence-${route}-${release}.json`,
}))));

// Re-read actual retained bytes at provenance verification time. An earlier
// passing TAP line or report.ok cannot replace the finite-window oracle.
export function verifyUiPreviewLiveSilence(directory,tap){
  const files=[];
  for(const {name}of LIVE_SILENCE_PREVIEW_CASES){
    const rows=tap.split('\n').filter(line=>/^(?:not )?ok \d+ - /.test(line)&&line.replace(/^(?:not )?ok \d+ - /,'').split(/\s+#/)[0]===name);
    assert.ok(rows.length===1&&/^ok \d+ - /.test(rows[0])&&!/\s+#\s*(?:SKIP|TODO)\b/i.test(rows[0]),`Missing executed passing live-silence preview case: ${name}`);
  }
  for(const {route,release,file}of LIVE_SILENCE_PREVIEW_CASES){
    const bytes=readFileSync(join(directory,file)),report=JSON.parse(bytes.toString('utf8'));
    assert.equal(report.version,1,`${file}: unsupported report version`);assert.equal(report.ok,true,`${file}: live-silence case failed`);
    assert.equal(report.route,route,`${file}: route mismatch`);assert.equal(report.release,release,`${file}: release mismatch`);assert.equal(report.physicalAudio,false,`${file}: digital observation cannot claim physical listening`);
    assert.equal(report.error,undefined,`${file}: report retains a failure`);assert.equal(report.failedAudio,undefined,`${file}: report retains failed audio`);
    validateLiveToneNavigation(report.audio,{route,release,takeBefore:report.takeBefore,takeAfter:report.takeAfter});
    assert.ok(report.pausedBefore&&Number.isFinite(report.pausedBefore.position)&&report.pausedBefore.position>0,`${file}: actual paused position required`);
    assert.equal(report.pausedBefore.mode,'practice');assert.equal(report.pausedBefore.captured,'1');assert.deepEqual(report.pausedAfter,report.pausedBefore,`${file}: paused session changed`);
    validateLiveToneCleanup(report.cleanup?.live);
    assert.deepEqual(report.cleanup?.source,{restored:true,overflow:false,errors:[],cleanupErrors:[]},`${file}: source observer cleanup incomplete`);
    files.push({name:file,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
  }
  return files;
}

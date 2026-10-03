import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {performanceAcceptanceFixtures,preparePerformanceFixtures,PERFORMANCE_FIXTURE_FILENAME} from '../scripts/prepare-performance-song-fixtures.mjs';
import {digest,inspectAuthoredZip} from './clean-song-package-fixtures.js';
import {preparePerformanceSong} from '../web/clean-song-package.js';
import {performanceSeconds} from '../web/clean-performance-player.js';

test('one deterministic original pack contains both complete native fixtures and no source/media payload',async()=>{
  const pack=performanceAcceptanceFixtures(),second=performanceAcceptanceFixtures();
  assert.equal(pack.filename,PERFORMANCE_FIXTURE_FILENAME);assert.deepEqual(pack.bytes,second.bytes);
  assert.equal(pack.manifest.sha256,digest(pack.bytes));assert.equal(pack.fixtures.length,2);
  assert.equal(new Set(pack.fixtures.map(f=>f.key)).size,2);assert.equal(Object.keys(inspectAuthoredZip(pack.bytes)).length,5);
  for(const fixture of pack.fixtures) {
    assert.deepEqual([...fixture.files.keys()],['metadata.json','score.json']);assert.equal(fixture.opened.score_json,null);
    const song=await preparePerformanceSong(`native:${fixture.key}`,fixture.opened.clean_package,null);
    assert.deepEqual(song.reference,fixture.reference);assert.equal(song.notation,null);assert.equal(song.compilation,null);
    assert.equal(song.runtime.coverage.targets.represented_attacks,0);assert.equal('notes' in song.runtime,false);
    assert.deepEqual(song.runtime.duration_microseconds,{numerator:'5000010',denominator:1});
    for(const voice of song.reference.voices) {
      const release=song.runtime.events.find(event=>event.event_id===voice.releaseEventId);
      assert.notEqual(voice.eventId,voice.releaseEventId);assert.equal(release.command.kind,'key_release');
      assert.ok(performanceSeconds(release.exact_microseconds)-performanceSeconds(voice.start)>=2);
    }
  }
  const overlap=pack.fixtures[0].reference;
  assert.equal(overlap.trackCount,11);assert.equal(overlap.voices.length,20);assert.deepEqual(overlap.tracks[0].channels,[]);
  assert.equal(overlap.voices.filter(voice=>voice.channel===9&&voice.key===85).length,2);
  const controls=pack.fixtures[1].reference;
  assert.equal(controls.extendedControls,true);assert.equal(controls.voices.length,2);
  assert.notEqual(controls.voices[0].eventId,controls.voices[1].eventId);assert.notEqual(controls.voices[0].releaseEventId,controls.voices[1].releaseEventId);
  for(const voice of controls.voices) {
    assert.equal(voice.endReason,'sustain_release');assert.equal(performanceSeconds(voice.end),4.000008);
    assert.notEqual(voice.sustainReleaseEventId,voice.releaseEventId);
    const keyRelease=controls.runtime.events.find(event=>event.event_id===voice.releaseEventId);
    assert.ok(performanceSeconds(voice.end)>performanceSeconds(keyRelease.exact_microseconds));
  }
  assert.equal(controls.voices[0].sustainReleaseEventId,controls.voices[1].sustainReleaseEventId);
});

test('preparation writes an exact pack and manifest once and isolates mutable copies',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'wmh-performance-fixture-contract-'));
  try {
    const expected=performanceAcceptanceFixtures(),manifest=await preparePerformanceFixtures(directory);
    assert.deepEqual(await readFile(join(directory,expected.filename)),expected.bytes);
    assert.deepEqual(JSON.parse(await readFile(join(directory,'performance-fixtures.json'))),manifest);
    await assert.rejects(preparePerformanceFixtures(directory),{code:'EEXIST'});
    expected.fixtures[0].files.get('score.json').fill(0);expected.fixtures[0].opened.clean_package.runtime.events.length=0;
    assert.equal(performanceAcceptanceFixtures().manifest.sha256,manifest.sha256);
    assert.ok(performanceAcceptanceFixtures().fixtures[0].opened.clean_package.runtime.events.length>0);
  } finally {await rm(directory,{recursive:true,force:true});}
});

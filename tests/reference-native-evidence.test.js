import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {originalReferenceMidiFixture} from './reference-listening-fixture.js';
import {verifyReferenceNativeEvidence,REFERENCE_NATIVE_REQUIRED_CHECKS,REFERENCE_NATIVE_FILE_KINDS,
  REFERENCE_NATIVE_MIN_CLEANUP_CHECKS} from '../scripts/verify-reference-native-evidence.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const run = promisify(execFile);
// Authored JSON observations, independent of the application recorder and MIDI
// parser. No browser, native process, server or pre-existing acceptance bundle.
function originalScore() {
  return {version:1,id:'original-native-reference-score',title:'Original native reference exercise',
    source:{format:'original-test-text',filename:'original.txt',content:'\uFEFFOriginal exercise · 原稿\r\nC4 at 0/1'},
    parts:[{id:'piano',notes:[{id:'original-c4',at:{numerator:0,denominator:1},duration:{numerator:1,denominator:3},pitch:{step:'C',alter:0,octave:4}}]}]};
}
function originalTake() {
  const input = {midi:60,at_ms:100,velocity:90};
  return {version:1,latency_ms:0,tolerance_ms:180,interruptions:[],unassigned_captures:[],
    passes:[{id:1,label:'Original native take',capture_enabled:true,inputs:[input],
      captures:[{event_id:1,event_wall_ms:1100,received_wall_ms:1101,input:{...input}}],
      clock_segments:[{wallStart:1000,wallEnd:1200,positionStart:0}],
      timeline:{duration_ms:2000,notes:[{id:'original-c4',midi:60,start_ms:100,duration_ms:500}]},
      assessment:{hits:[{note_id:'original-c4',input_index:0}],misses:[],extra_inputs:[]}}],
    input_evidence:{version:1,truncated:false,omitted_observations:0,events:[
      {event_id:1,kind:'note_on',source_id:'source-1',input_kind:'typing_keyboard',encoding:'key_down',
        midi:60,velocity:90,event_wall_ms:1100,received_wall_ms:1101,timestamp_basis:'event_monotonic',
        raw_timestamp_ms:1100,onset_capture:{pass_id:1,event_id:1}},
      {event_id:2,kind:'note_off',source_id:'source-1',input_kind:'typing_keyboard',encoding:'key_up',
        midi:null,velocity:null,event_wall_ms:1150,received_wall_ms:1151,onset_capture:null},
    ]}};
}
async function evidence(t) {
  const directory = await mkdtemp(join(tmpdir(),'wmh-native-reference-'));
  t.after(() => rm(directory,{recursive:true,force:true}));
  await mkdir(join(directory,'downloads'));
  const fixture = originalReferenceMidiFixture();
  const files = Object.fromEntries(REFERENCE_NATIVE_FILE_KINDS.map((kind,index) => [kind,`seed-${index+5}.json`]));
  const report = {ok:true,phase:'seed',files:{canonicalFile:'seed-1.json',scoreBackup:'seed-2.json',recordFile:'seed-3.json',performanceBackup:'seed-4.json'},
    downloads:Object.values(files).map(file => ({file,complete:true,success:true})),referenceListening:{ok:true,fixture:fixture.name,
      sourceSha256:fixture.timeline.source_sha256,...Object.fromEntries(['trackCount','eventCount','onsetCount'].map(key => [key,fixture.expected[key]])),
      files,checks:[...REFERENCE_NATIVE_REQUIRED_CHECKS],audio:{sourceStarts:14,cleanupChecks:REFERENCE_NATIVE_MIN_CLEANUP_CHECKS,activeSources:0,pendingSources:0}}};
  const score = originalScore(), take = originalTake();
  const values = {original:fixture.bytes,beforeScore:score,afterScore:structuredClone(score),beforeTake:take,afterTake:structuredClone(take)};
  async function write(kind,value = values[kind]) {
    await writeFile(join(directory,'downloads',files[kind]),Buffer.isBuffer(value) ? value : JSON.stringify(value));
  }
  for (const kind of REFERENCE_NATIVE_FILE_KINDS) await write(kind);
  return {directory,report,fixture,files,values,write};
}

test('native reference verifier reads all five actual payloads, including MIDI under a native JSON filename',async t => {
  const f = await evidence(t), result = await verifyReferenceNativeEvidence(f.directory,f.report);
  assert.equal(result.ok,true);assert.equal(result.fixture,'original-reference-overlap.mid');
  assert.deepEqual([result.track_count,result.event_count,result.onset_count],[3,26,8]);
  assert.equal(result.typing_note_on_count,1);assert.equal(result.scored_input_count,1);
  assert.deepEqual(result.artifacts.map(row => row.kind),REFERENCE_NATIVE_FILE_KINDS);
  assert.equal(result.artifacts[0].sha256,hash(f.fixture.bytes));
  assert.equal(result.artifacts[0].bytes,f.fixture.bytes.length);
  assert.equal(Object.hasOwn(result.artifacts[0],'content_sha256'),false);
  for (const row of result.artifacts) {
    assert.equal(row.sha256,hash(await readFile(join(f.directory,'downloads',row.file))));
    if (row.kind !== 'original') assert.match(row.content_sha256,/^[a-f0-9]{64}$/);
  }
});

test('successful native callback cannot replace a missing or altered original file',async t => {
  const f = await evidence(t), altered = Buffer.from(f.fixture.bytes);altered[altered.length-1] ^= 1;
  await f.write('original',altered);
  await assert.rejects(verifyReferenceNativeEvidence(f.directory,f.report),/complete original bytes/);
  await rm(join(f.directory,'downloads',f.files.original));
  await assert.rejects(verifyReferenceNativeEvidence(f.directory,f.report),{code:'ENOENT'});
});

test('every reference file requires its own successful native download completion',async t => {
  const f = await evidence(t);
  for (const kind of REFERENCE_NATIVE_FILE_KINDS) {
    const copy = structuredClone(f.report), row = copy.downloads.find(item => item.file === f.files[kind]);
    for (const field of ['complete','success']) {
      row[field] = false;
      await assert.rejects(verifyReferenceNativeEvidence(f.directory,copy),new RegExp(`download-completion event for ${kind}`));
      row[field] = true;
    }
    copy.downloads.push({...row});
    await assert.rejects(verifyReferenceNativeEvidence(f.directory,copy),/download-completion/);
  }
});

test('evidence paths cannot escape, alias another role, reuse base exports or swap score and take',async t => {
  const f = await evidence(t);
  for (const file of ['../seed-5.json','seed-0.json','seed-17.json','seed-05.json','Seed-5.json','seed-5.json\n','C:\\seed-5.json','original-reference-overlap.mid']) {
    const copy = structuredClone(f.report);copy.referenceListening.files.original = file;
    await assert.rejects(verifyReferenceNativeEvidence(f.directory,copy),/Invalid native reference evidence filename/);
  }
  const aliased = structuredClone(f.report);aliased.referenceListening.files.afterScore = f.files.beforeScore;
  await assert.rejects(verifyReferenceNativeEvidence(f.directory,aliased),/paths must be distinct/);
  const reused = structuredClone(f.report);reused.referenceListening.files.original = 'seed-1.json';
  await assert.rejects(verifyReferenceNativeEvidence(f.directory,reused),/reuses a base evidence path/);
  const swapped = structuredClone(f.report);
  [swapped.referenceListening.files.beforeScore,swapped.referenceListening.files.beforeTake] = [f.files.beforeTake,f.files.beforeScore];
  await assert.rejects(verifyReferenceNativeEvidence(f.directory,swapped),/beforeScore is not a canonical score/);
  const wrongPayload = structuredClone(f.report);
  [wrongPayload.referenceListening.files.original,wrongPayload.referenceListening.files.beforeScore] = [f.files.beforeScore,f.files.original];
  await assert.rejects(verifyReferenceNativeEvidence(f.directory,wrongPayload),/complete original bytes/);
});

test('canonical source, rational times, scored inputs, observations and assessment hits must stay unchanged',async t => {
  const f = await evidence(t);
  for (const edit of [score => score.source.content += '\n',score => score.parts[0].notes[0].duration.denominator = 4]) {
    const score = structuredClone(f.values.afterScore);edit(score);await f.write('afterScore',score);
    await assert.rejects(verifyReferenceNativeEvidence(f.directory,f.report),/Canonical score changed/);
  }
  await f.write('afterScore');
  for (const edit of [
    take => take.passes[0].inputs.push({midi:64,at_ms:200,velocity:90}),
    take => take.input_evidence.events.push({...take.input_evidence.events[0],event_id:3}),
    take => take.passes[0].assessment.hits.push({note_id:'fake-reference-hit',input_index:1}),
    take => take.passes[0].clock_segments[0].wallEnd += 1,
  ]) {
    const take = structuredClone(f.values.afterTake);edit(take);await f.write('afterTake',take);
    await assert.rejects(verifyReferenceNativeEvidence(f.directory,f.report),/Scored take changed/);
  }
});

test('positive typed onset must route to a genuine scored capture and matching input',async t => {
  const f = await evidence(t);
  const edits = [
    take => take.passes[0].inputs = [],
    take => delete take.input_evidence,
    take => take.input_evidence.truncated = true,
    take => take.input_evidence.events[0].input_kind = 'midi',
    take => take.input_evidence.events[0].velocity = 0,
    take => take.input_evidence.events[0].encoding = 'synthetic_reference',
    take => take.input_evidence.events[0].onset_capture = null,
    take => take.input_evidence.events[0].onset_capture.pass_id = 2,
    take => take.input_evidence.events[0].onset_capture.event_id = 2,
    take => take.passes[0].capture_enabled = false,
    take => take.passes[0].captures[0].input.midi = 61,
    take => take.passes[0].inputs[0].at_ms = 999,
    take => take.passes[0].captures[0].received_wall_ms = 999,
    take => take.passes[0].captures.push(structuredClone(take.passes[0].captures[0])),
    take => take.input_evidence.events.push({...take.input_evidence.events[0],event_id:3}),
  ];
  for (const edit of edits) {
    const take = structuredClone(f.values.beforeTake);edit(take);
    await f.write('beforeTake',take);await f.write('afterTake',take);
    await assert.rejects(verifyReferenceNativeEvidence(f.directory,f.report),/Before take|Typing keyboard/);
  }
});

test('counts and source hash are checked against the complete fixture, never a renderer claim',async t => {
  const f = await evidence(t);
  for (const [key,value] of [['trackCount',2],['eventCount',25],['onsetCount',7],['eventCount','26'],['sourceSha256','0'.repeat(64)],['fixture','smaller.mid']]) {
    const copy = structuredClone(f.report);copy.referenceListening[key] = value;
    await assert.rejects(verifyReferenceNativeEvidence(f.directory,copy),/differs from the complete original fixture/);
  }
});

test('renderer status, required checks and real audio cleanup cannot be replaced by truthy claims',async t => {
  const f = await evidence(t);
  for (const edit of [report => report.ok = false,report => report.ok = 'true',report => report.phase = 'restart',
    report => delete report.referenceListening,report => report.referenceListening.ok = false]) {
    const copy = structuredClone(f.report);edit(copy);
    await assert.rejects(verifyReferenceNativeEvidence(f.directory,copy),/renderer did not pass/);
  }
  for (const check of REFERENCE_NATIVE_REQUIRED_CHECKS) {
    const copy = structuredClone(f.report);copy.referenceListening.checks = copy.referenceListening.checks.filter(value => value !== check);
    await assert.rejects(verifyReferenceNativeEvidence(f.directory,copy),new RegExp(`Missing native reference check: ${check}`));
  }
  for (const [key,value] of [['sourceStarts',0],['sourceStarts',1.5],['sourceStarts','14'],['cleanupChecks',REFERENCE_NATIVE_MIN_CLEANUP_CHECKS-1],
    ['cleanupChecks','4'],['activeSources',1],['pendingSources',1],['pendingSources','0']]) {
    const copy = structuredClone(f.report);copy.referenceListening.audio[key] = value;
    await assert.rejects(verifyReferenceNativeEvidence(f.directory,copy),/Native reference audio/);
  }
});

test('standalone CLI writes byte hashes only after validating renderer-seed.json and all downloads',async t => {
  const f = await evidence(t), reportBytes = JSON.stringify(f.report,null,2)+'\n';
  await writeFile(join(f.directory,'renderer-seed.json'),reportBytes);
  const script = fileURLToPath(new URL('../scripts/verify-reference-native-evidence.mjs',import.meta.url));
  const {stdout} = await run(process.execPath,[script,f.directory]);
  assert.match(stdout,/Verified 5 native reference downloads/);
  const result = JSON.parse(await readFile(join(f.directory,'native-reference-files.json'),'utf8'));
  assert.equal(result.ok,true);assert.equal(result.renderer_seed_sha256,hash(reportBytes));
  assert.equal(result.artifacts.length,5);assert.equal(result.artifacts[0].sha256,f.fixture.timeline.source_sha256);
  await f.write('original',Buffer.from('not the original MIDI'));
  await assert.rejects(run(process.execPath,[script,f.directory]),error => error.code === 1 && /complete original bytes/.test(error.stderr));
  await assert.rejects(readFile(join(f.directory,'native-reference-files.json')),{code:'ENOENT'});
});

test('CLI --check revalidates the complete stored proof and leaves its original bytes unchanged',async t => {
  const f = await evidence(t);
  const script = fileURLToPath(new URL('../scripts/verify-reference-native-evidence.mjs',import.meta.url));
  await writeFile(join(f.directory,'renderer-seed.json'),JSON.stringify(f.report));
  await run(process.execPath,[script,f.directory]);
  const output = join(f.directory,'native-reference-files.json');
  const proof = JSON.parse(await readFile(output,'utf8'));
  // Formatting is outside the semantic certificate. A read-only check must not
  // rewrite a valid certificate even when its whitespace differs from the writer.
  const storedBytes = Buffer.from(JSON.stringify(proof)+'\n\n');
  await writeFile(output,storedBytes);
  for (const args of [['--check',f.directory],[f.directory,'--check']]) {
    const {stdout} = await run(process.execPath,[script,...args]);
    assert.match(stdout,/stored proof matches/);
    assert.deepEqual(await readFile(output),storedBytes);
  }
  for (const edit of [
    value => value.typing_note_on_count = 999,
    value => value.scored_input_count = 999,
    value => value.renderer_seed_sha256 = '0'.repeat(64),
    value => value.artifacts[0].sha256 = '0'.repeat(64),
    value => value.extra_fabricated_claim = true,
  ]) {
    const changed = structuredClone(proof);edit(changed);
    const alteredBytes = Buffer.from(JSON.stringify(changed));await writeFile(output,alteredBytes);
    await assert.rejects(run(process.execPath,[script,'--check',f.directory]),
      error => error.code === 1 && /Stored native reference proof differs/.test(error.stderr));
    assert.deepEqual(await readFile(output),alteredBytes,'A failed read-only check preserves the stored proof');
  }
  await rm(output);
  await assert.rejects(run(process.execPath,[script,'--check',f.directory]),error => error.code === 1 && /ENOENT/.test(error.stderr));
  await assert.rejects(readFile(output),{code:'ENOENT'});
});

test('CLI --check rejects fabricated keyboard routing even when all altered payload hashes match the certificate',async t => {
  const f = await evidence(t);
  const script = fileURLToPath(new URL('../scripts/verify-reference-native-evidence.mjs',import.meta.url));
  await writeFile(join(f.directory,'renderer-seed.json'),JSON.stringify(f.report));
  await run(process.execPath,[script,f.directory]);
  const output = join(f.directory,'native-reference-files.json');
  const proof = JSON.parse(await readFile(output,'utf8'));
  const take = structuredClone(f.values.beforeTake);take.input_evidence.events[0].onset_capture.pass_id = 99;
  for (const kind of ['beforeTake','afterTake']) {
    await f.write(kind,take);
    const bytes = await readFile(join(f.directory,'downloads',f.files[kind]));
    const artifact = proof.artifacts.find(row => row.kind === kind);
    Object.assign(artifact,{bytes:bytes.length,sha256:hash(bytes),content_sha256:hash(JSON.stringify(take))});
  }
  const storedBytes = Buffer.from(JSON.stringify(proof));await writeFile(output,storedBytes);
  await assert.rejects(run(process.execPath,[script,'--check',f.directory]),
    error => error.code === 1 && /Typing keyboard onset routes to a missing or disabled pass/.test(error.stderr));
  assert.deepEqual(await readFile(output),storedBytes);
});

import {readFile,writeFile,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {originalReferenceMidiFixture} from '../tests/reference-listening-fixture.js';

// These are assertions made by the native renderer, not substitutes for the
// downloaded-byte and input-routing checks below. Keep the producer aligned.
export const REFERENCE_NATIVE_REQUIRED_CHECKS = Object.freeze([
  'native-filechooser',
  'complete-original-source',
  'explicit-rendition-policy',
  'play-pause-resume-stop',
  'all-tracks-complete',
  'independent-track-mute',
  'shared-sound-mute',
  'close-cleanup',
  'live-locale-preserved',
  'reference-input-isolated',
  'canonical-score-unchanged',
  'scored-take-unchanged',
]);
export const REFERENCE_NATIVE_FILE_KINDS = Object.freeze(['original','beforeScore','afterScore','beforeTake','afterTake']);
export const REFERENCE_NATIVE_MIN_CLEANUP_CHECKS = 4;
const hash = value => createHash('sha256').update(value).digest('hex');
const assert = (condition,message) => { if (!condition) throw new Error(message); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const positiveInteger = value => Number.isSafeInteger(value) && value > 0;
const midi = value => Number.isInteger(value) && value >= 0 && value <= 127;
const velocity = value => Number.isInteger(value) && value > 0 && value <= 127;

function validateScore(value,kind) {
  assert(object(value) && value.version === 1 && typeof value.id === 'string' && value.id.length > 0 &&
    Array.isArray(value.parts) && value.parts.length > 0 && value.parts.every(part => object(part) && Array.isArray(part.notes)),
  `${kind} is not a canonical score export`);
  assert(!Object.hasOwn(value,'passes') && !Object.hasOwn(value,'input_evidence'),`${kind} contains a take instead of a score`);
}

function validateScoredInput(value) {
  assert(object(value) && value.version === 1 && Array.isArray(value.passes) && value.passes.length > 0,
    'Before take is not a scored take export');
  assert(value.passes.every(pass => object(pass) && positiveInteger(pass.id) && Array.isArray(pass.inputs) && Array.isArray(pass.captures)),
    'Before take has invalid scored passes');
  assert(new Set(value.passes.map(pass => pass.id)).size === value.passes.length,'Before take has duplicate pass identities');
  const inputCount = value.passes.reduce((count,pass) => count + pass.inputs.length,0);
  assert(inputCount > 0,'Before take must retain positive scored inputs');
  const evidence = value.input_evidence;
  assert(object(evidence) && evidence.version === 1 && Array.isArray(evidence.events),
    'Before take is missing input evidence');
  assert(evidence.truncated === false && evidence.omitted_observations === 0,'Before take input evidence is incomplete');
  const onsets = evidence.events.filter(event => object(event) && event.kind === 'note_on' && event.input_kind === 'typing_keyboard');
  assert(onsets.length > 0,'Before take must retain a typing_keyboard note_on');
  const routed = new Set();
  for (const event of onsets) {
    assert(positiveInteger(event.event_id) && typeof event.source_id === 'string' && event.source_id.length > 0 &&
      event.encoding === 'key_down' && midi(event.midi) && velocity(event.velocity) &&
      Number.isFinite(event.event_wall_ms) && Number.isFinite(event.received_wall_ms),
    'Before take contains invalid typing_keyboard onset evidence');
    const route = event.onset_capture;
    assert(object(route) && positiveInteger(route.pass_id) && positiveInteger(route.event_id),
      'Typing keyboard onset lacks scored capture routing');
    const pass = value.passes.find(candidate => candidate.id === route.pass_id);
    assert(pass?.capture_enabled === true,'Typing keyboard onset routes to a missing or disabled pass');
    const captures = pass.captures.filter(capture => capture?.event_id === route.event_id);
    assert(captures.length === 1,'Typing keyboard onset routes to a missing or ambiguous capture');
    const capture = captures[0], input = capture.input;
    assert(object(input) && input.midi === event.midi && input.velocity === event.velocity && Number.isFinite(input.at_ms) &&
      capture.event_wall_ms === event.event_wall_ms && capture.received_wall_ms === event.received_wall_ms &&
      pass.inputs.some(candidate => isDeepStrictEqual(candidate,input)),
    'Typing keyboard onset does not match its scored input and capture');
    const key = `${route.pass_id}:${route.event_id}`;
    assert(!routed.has(key),'Typing keyboard onsets share a scored capture');
    routed.add(key);
  }
  return {typingNoteOnCount:onsets.length,scoredInputCount:inputCount};
}

/** Verify files actually written by Windows after the native reference UI run.
 * The native callback intentionally gives every payload a seed-N.json name,
 * including MIDI; the original payload is compared as bytes, never parsed as JSON.
 */
export async function verifyReferenceNativeEvidence(directory,report) {
  assert(report?.ok === true && report.phase === 'seed','Seed renderer did not pass');
  const reference = report.referenceListening, fixture = originalReferenceMidiFixture();
  assert(object(reference) && reference.ok === true,'Native reference-listening renderer did not pass');
  assert(reference.fixture === fixture.name,'Native reference fixture name differs from the complete original fixture');
  assert(reference.sourceSha256 === fixture.timeline.source_sha256,'Native reference source hash differs from the complete original fixture');
  for (const kind of ['trackCount','eventCount','onsetCount']) {
    assert(reference[kind] === fixture.expected[kind],`Native reference ${kind} differs from the complete original fixture`);
  }
  assert(Array.isArray(reference.checks) && reference.checks.every(check => typeof check === 'string') &&
    new Set(reference.checks).size === reference.checks.length,'Native reference checks must be unique labels');
  for (const check of REFERENCE_NATIVE_REQUIRED_CHECKS) assert(reference.checks.includes(check),`Missing native reference check: ${check}`);
  const audio = reference.audio;
  assert(object(audio) && positiveInteger(audio.sourceStarts),'Native reference audio sources never started');
  assert(Number.isSafeInteger(audio.cleanupChecks) && audio.cleanupChecks >= REFERENCE_NATIVE_MIN_CLEANUP_CHECKS,
    'Native reference audio cleanup checks are incomplete');
  assert(audio.activeSources === 0 && audio.pendingSources === 0,'Native reference audio sources remain active or pending');
  const files = reference.files;
  assert(object(files) && Object.keys(files).length === REFERENCE_NATIVE_FILE_KINDS.length &&
    REFERENCE_NATIVE_FILE_KINDS.every(kind => Object.hasOwn(files,kind)),'Five native reference export file roles are required');
  assert(new Set(Object.values(files)).size === REFERENCE_NATIVE_FILE_KINDS.length,'Native reference export paths must be distinct');
  assert(Array.isArray(report.downloads),'Native download-completion events are missing');
  const baseFiles = object(report.files) ? new Set(Object.values(report.files)) : new Set();
  const artifacts = [], values = {};
  for (const kind of REFERENCE_NATIVE_FILE_KINDS) {
    const file = files[kind];
    // The final length check rejects trailing newlines, which JavaScript's $
    // would otherwise allow before the final line terminator.
    assert(typeof file === 'string' && /^seed-(?:[1-9]|1[0-6])\.json$/.test(file) && !/[\r\n]/.test(file),
      `Invalid native reference evidence filename for ${kind}`);
    assert(!baseFiles.has(file),`Native reference export reuses a base evidence path: ${kind}`);
    const downloads = report.downloads.filter(row => object(row) && row.file === file);
    assert(downloads.length === 1 && downloads[0].complete === true && downloads[0].success === true,
      `Missing successful native download-completion event for ${kind}`);
    const bytes = await readFile(join(directory,'downloads',file));
    assert(bytes.length > 0 && bytes.length <= 80 * 1024 * 1024,`Invalid native reference exported-file size for ${kind}`);
    const artifact = {kind,file,bytes:bytes.length,sha256:hash(bytes)};
    if (kind === 'original') {
      assert(bytes.equals(fixture.bytes),'Downloaded original MIDI differs from the complete original bytes');
    } else {
      try { values[kind] = JSON.parse(bytes.toString('utf8')); }
      catch { throw new Error(`Native reference ${kind} is not a JSON export`); }
      artifact.content_sha256 = hash(JSON.stringify(values[kind]));
    }
    artifacts.push(artifact);
  }
  validateScore(values.beforeScore,'beforeScore');validateScore(values.afterScore,'afterScore');
  assert(isDeepStrictEqual(values.beforeScore,values.afterScore),'Canonical score changed during reference listening');
  const counts = validateScoredInput(values.beforeTake);
  assert(isDeepStrictEqual(values.beforeTake,values.afterTake),'Scored take changed during reference listening (inputs, evidence or assessment)');
  return {version:1,ok:true,fixture:fixture.name,source_sha256:fixture.timeline.source_sha256,
    track_count:fixture.expected.trackCount,event_count:fixture.expected.eventCount,onset_count:fixture.expected.onsetCount,
    typing_note_on_count:counts.typingNoteOnCount,scored_input_count:counts.scoredInputCount,artifacts};
}

async function main() {
  const args = process.argv.slice(2), check = args.includes('--check'), directories = args.filter(value => value !== '--check');
  assert(directories.length <= 1 && !directories.some(value => value.startsWith('--')),
    'Usage: node scripts/verify-reference-native-evidence.mjs [--check] [evidence-directory]');
  const directory = resolve(directories[0] || 'desktop-acceptance');
  const output = join(directory,'native-reference-files.json');
  // A failed rerun must not leave an earlier successful certificate behind.
  // Packaging uses --check to compare the existing certificate without writes.
  if (!check) await rm(output,{force:true});
  const reportBytes = await readFile(join(directory,'renderer-seed.json'));
  const result = await verifyReferenceNativeEvidence(directory,JSON.parse(reportBytes.toString('utf8')));
  const proof = {...result,renderer_seed_sha256:hash(reportBytes)};
  if (check) {
    const stored = JSON.parse(await readFile(output,'utf8'));
    assert(isDeepStrictEqual(stored,proof),'Stored native reference proof differs from verified renderer and downloaded bytes');
  } else {
    await writeFile(output,JSON.stringify(proof,null,2)+'\n');
  }
  console.log(`Verified ${result.artifacts.length} native reference downloads, complete original MIDI and unchanged scored input evidence${check ? '; stored proof matches' : ''}`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => {console.error(error.message);process.exitCode = 1;});
}

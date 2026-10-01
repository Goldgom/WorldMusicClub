import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import {fixture} from './frontend-fixtures.js';
import {APP_VERSION,SCORE_SCHEMA_REVISION,currentFormatMetadata} from '../web/format-metadata.js';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const schema = JSON.parse(read('../schema/worldmusichub-score-v1.schema.json'));
const documentation = read('../docs/SCORE_FORMAT.md');
const rust = read('../crates/score-core/src/lib.rs');
const examples = [...documentation.matchAll(/```json\s*\n([\s\S]*?)\n```/g)].map(match => JSON.parse(match[1]));
// Strict schema checks, with no defaults, coercion, or removal of unknown properties.
const ajv = new Ajv2020({strict: true, allErrors: true});
const validate = ajv.compile(schema);
const beat = (numerator, denominator = 1) => ({numerator, denominator});
const complete = () => ({
  ...structuredClone(fixture),
  format_metadata: currentFormatMetadata(),
  repeats: [{from: beat(0), to: beat(4), times: 2}],
  source: {format: 'original-test-text', filename: 'original.txt', content: 'Original schema test only.', import_diagnostics: [{severity:'warning',code:'source_only',message:'Original import observation.',note_id:null}]},
});
function valid(score) {
  assert.equal(validate(score), true, ajv.errorsText(validate.errors, {separator: '\n'}));
}
function invalid(score) {
  assert.equal(validate(score), false, 'Expected structural validation to fail');
}
function changed(edit) {
  const score = complete();
  edit(score);
  return score;
}
function objectExamples(score) {
  return {
    Score: score,
    FormatMetadata: score.format_metadata,
    Beat: score.parts[0].notes[0].at,
    PositiveBeat: score.parts[0].notes[0].duration,
    Pitch: score.parts[0].notes[0].pitch,
    Note: score.parts[0].notes[0],
    Part: score.parts[0],
    Tempo: score.tempo[0],
    Meter: score.meters[0],
    Key: score.keys[0],
    Measure: score.measures[0],
    Repeat: score.repeats[0],
    Provenance: score.provenance,
    Source: score.source,
    Diagnostic: score.source.import_diagnostics[0],
  };
}

test('published schema is strict Draft 2020-12 and covers a canonical score only', () => {
  assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema');
  assert.equal(schema.$id, 'urn:worldmusichub:score:v1');
  assert.equal(ajv.validateSchema(schema), true);
  valid(fixture);
  invalid({score: fixture, timeline: {notes: [], duration_ms: 0}, diagnostics: []});
  invalid({notes: [], duration_ms: 0});
  invalid({...fixture, $schema: schema.$id});
});

test('bundled complete CC0 edition is strict schema-valid without modifying retained sources', () => {
  const edition=JSON.parse(read('../catalog/editions/cc0-schubert-wandrers-nachtlied-d768/score.json'));
  const before=JSON.stringify(edition);valid(edition);
  assert.equal(JSON.stringify(edition),before);
  assert.equal(edition.parts.flatMap(part=>part.notes).length,334);
  assert.equal(edition.provenance.kind,'curated_cc0_edition');
});

test('the complete original bilingual documentation example remains schema-valid', () => {
  assert.equal(examples.length, 1, 'Keep one executable, complete JSON example in the contract');
  valid(examples[0]);
  assert.equal(examples[0].id, 'original-tied-step');
  assert.equal(examples[0].parts[0].notes.length, 4);
  assert.equal(examples[0].parts[0].notes[2].pitch, null);
  assert.equal(examples[0].parts[0].notes[0].tie_start, true);
  assert.equal(examples[0].parts[0].notes[1].tie_stop, true);
  assert.deepEqual(examples[0].parts[0].notes[3].at, beat(5, 2));
});

test('schema property sets and required fields track strict Serde declarations', () => {
  for (const [name, object] of Object.entries({Score: schema, ...schema.$defs})) {
    const rustName = name === 'PositiveBeat' ? 'Beat' : name;
    const declaration = rust.match(new RegExp(`#\\[serde\\(deny_unknown_fields\\)\\]\\s*pub struct ${rustName} \\{([\\s\\S]*?)\\n\\}`));
    assert.ok(declaration, `${name} must correspond to a strict public Serde struct`);
    const fields = [...declaration[1].matchAll(/(?:#\[serde\(default\)\]\s*)?pub (\w+): ([^\n]+),/g)];
    assert.deepEqual(Object.keys(object.properties).sort(), fields.map(field => field[1]).sort(), `${name} properties`);
    const required = fields.filter(field => !field[0].includes('#[serde(default)]') && !field[2].startsWith('Option<')).map(field => field[1]).sort();
    assert.deepEqual([...object.required].sort(), required, `${name} required fields`);
    assert.equal(object.type, 'object');
    assert.equal(object.additionalProperties, false, `${name} must reject unknown fields`);
  }
});

test('unknown fields are rejected at every canonical object level', () => {
  for (const name of Object.keys(objectExamples(complete()))) {
    const score = complete();
    objectExamples(score)[name].unsupported_extension = 'must not disappear silently';
    invalid(score);
  }
});

test('every schema-required field is enforced and may not be null', () => {
  for (const [name, object] of Object.entries({Score: schema, ...schema.$defs})) {
    for (const field of object.required) {
      const missing = complete();
      delete objectExamples(missing)[name][field];
      invalid(missing);
      const nullable = complete();
      objectExamples(nullable)[name][field] = null;
      invalid(nullable);
    }
  }
});

test('Serde Option absence and defaults are accepted without modifying input', () => {
  const score = complete();
  delete score.source.filename;
  delete score.provenance.source_url;
  delete score.provenance.license;
  delete score.repeats;
  for (const note of score.parts[0].notes) {
    delete note.pitch;
    delete note.tie_start;
    delete note.tie_stop;
  }
  const before = structuredClone(score);
  valid(score);
  assert.deepEqual(score, before, 'Validation must not insert defaults or otherwise mutate canonical data');
  delete score.source;
  valid(score);
  score.source = null;
  valid(score);
  for (const field of ['repeats']) invalid({...score, [field]: null});
  for (const field of ['tie_start', 'tie_stop']) {
    const bad = structuredClone(score);
    bad.parts[0].notes[0][field] = null;
    invalid(bad);
  }
  assert.deepEqual(schema.properties.repeats.default, []);
  for (const name of ['tie_start', 'tie_stop']) assert.equal(schema.$defs.Note.properties[name].default, false);
  for (const [name, field] of [['Note', 'pitch'], ['Source', 'filename'], ['Provenance', 'license'], ['Provenance', 'source_url']]) {
    assert.equal(schema.$defs[name].properties[field].default, null);
  }
  assert.equal(schema.properties.source.default, null);
});

test('rest ties are rejected for both null and absent pitch; pitched ties are accepted', () => {
  for (const absent of [false, true]) {
    for (const tie of ['tie_start', 'tie_stop']) {
      invalid(changed(score => {
        const note = score.parts[0].notes[0];
        note.pitch = null;
        if (absent) delete note.pitch;
        note[tie] = true;
      }));
    }
  }
  valid(changed(score => {score.parts[0].notes[0].tie_start = true;}));
  valid(changed(score => {score.parts[0].notes[0].velocity = 0;}));
});

test('exact rational structure rejects floats, strings, zero durations and invalid ranges', () => {
  for (const timing of ['at', 'duration']) {
    for (const value of [0.5, '1/2', null, {numerator: 1}, beat(1, 0), beat(1, -1), beat(1, 1000001), beat(-1), beat(1000000001), beat(1.5)]) {
      invalid(changed(score => {score.parts[0].notes[0][timing] = value;}));
    }
  }
  invalid(changed(score => {score.parts[0].notes[0].duration = beat(0);}));
  invalid(changed(score => {score.measures[0].length = beat(0);}));
  valid(changed(score => {
    score.parts[0].notes[0].at = beat(2, 4);
    score.parts[0].notes[0].duration = beat(1, 3);
  }));
});

test('all canonical numeric scalar bounds are enforced', () => {
  const cases = [
    [s => s, 'version', [0, 2, '1', null]],
    [s => s.parts[0].notes[0], 'staff', [0, 256, 1.5, '1']],
    [s => s.parts[0].notes[0], 'velocity', [-1, 128, 1.5]],
    [s => s.parts[0].notes[0].pitch, 'step', ['c', 'H', '', 1]],
    [s => s.parts[0].notes[0].pitch, 'alter', [-3, 3, 0.5]],
    [s => s.parts[0].notes[0].pitch, 'octave', [-129, 128, 4.5]],
    [s => s.tempo[0], 'bpm', [9.99, 600.01, '120', null]],
    [s => s.meters[0], 'numerator', [0, 65536, 1.5]],
    [s => s.meters[0], 'denominator', [0, 3, 65536]],
    [s => s.keys[0], 'fifths', [-8, 8, 0.5]],
    [s => s.measures[0], 'number', [-1, 4294967296, 1.5]],
    [s => s.repeats[0], 'times', [1, 17, 2.5]],
  ];
  for (const [select, field, values] of cases) {
    for (const value of values) invalid(changed(score => {select(score)[field] = value;}));
  }
  valid(changed(score => {
    score.parts[0].notes[0].staff = 255;
    score.parts[0].notes[0].velocity = 127;
    score.tempo[0].bpm = 10;
    score.tempo.push({at: beat(4), bpm: 600});
    score.meters[0].numerator = 65535;
    score.meters[0].denominator = 32768;
    score.measures[0].number = 4294967295;
    score.repeats[0].times = 16;
  }));
});

test('array bounds distinguish required-but-empty collections from missing collections', () => {
  for (const field of ['parts', 'tempo']) invalid(changed(score => {score[field] = [];}));
  valid(changed(score => {
    for (const field of ['meters', 'keys', 'measures', 'repeats']) score[field] = [];
    score.parts[0].notes = [];
  }));
  const caps = {parts: 128, tempo: 100000, meters: 100000, keys: 100000, measures: 100000, repeats: 10000};
  for (const [field, maximum] of Object.entries(caps)) {
    assert.equal(schema.properties[field].maxItems, maximum);
    invalid(changed(score => {score[field] = Array(maximum + 1).fill(score[field][0]);}));
  }
  assert.equal(schema.$defs.Part.properties.notes.maxItems, 100000);
  invalid(changed(score => {score.parts[0].notes = Array(100001).fill(score.parts[0].notes[0]);}));
});

test('bounded strings reject excessive code-point length without inventing enum restrictions', () => {
  const limits = {
    Score: {id: 128, title: 1000, composer: 1024},
    Part: {id: 128, name: 256, instrument: 64},
    Note: {id: 128, voice: 64},
    Provenance: {kind: 64, attribution: 8192, source_url: 4096, license: 256},
    Source: {format: 64, filename: 1024, content: 8388608},
  };
  for (const [name, fields] of Object.entries(limits)) {
    for (const [field, maximum] of Object.entries(fields)) {
      const objectSchema = name === 'Score' ? schema : schema.$defs[name];
      assert.equal(objectSchema.properties[field].maxLength, maximum);
      invalid(changed(score => {objectExamples(score)[name][field] = 'a'.repeat(maximum + 1);}));
    }
  }
  valid(changed(score => {
    score.parts[0].instrument = 'violin';
    score.keys[0].mode = 'dorian';
    score.provenance.kind = 'local-original-test';
    score.provenance.source_url = 'not-a-validated-url';
    score.source.format = 'opaque-original-test';
    score.source.content = 'Do not parse or execute retained source text.';
  }));
});

test('score, part, note and voice identity cannot be empty strings', () => {
  for (const [name, field] of [['Score', 'id'], ['Score', 'title'], ['Part', 'id'], ['Note', 'id'], ['Note', 'voice']]) {
    invalid(changed(score => {objectExamples(score)[name][field] = '';}));
  }
});

test('schema intentionally leaves cross-field and byte-level checks to Rust', () => {
  const semanticCases = [
    score => {score.title = '音'.repeat(400);}, // 400 code points, 1200 UTF-8 bytes.
    score => {score.title = '   ';},
    score => {score.parts[0].notes[1].id = score.parts[0].notes[0].id;},
    score => {score.parts.push(structuredClone(score.parts[0]));},
    score => {score.parts[0].notes[0].pitch.octave = 127;},
    score => {score.tempo[0].at = beat(1);},
    score => {score.tempo.push({at: beat(0), bpm: 120});},
    score => {
      score.parts[0].notes[0].at = beat(1, 999983);
      score.parts[0].notes[0].duration = beat(1, 1000000);
    },
    score => {score.repeats[0].from = beat(4); score.repeats[0].to = beat(2);},
    score => {score.repeats.push({from: beat(1), to: beat(2), times: 2});},
  ];
  for (const change of semanticCases) valid(changed(change));
  const total = complete();
  total.parts[0].notes = Array(50001).fill(total.parts[0].notes[0]);
  total.parts.push({...total.parts[0], id: 'second'});
  valid(total); // Per-part caps are structural; Rust checks the whole-score sum and IDs.
});

test('schema mirrors permissive core measure, map and label semantics honestly', () => {
  valid(changed(score => {
    score.measures[0].number = 0;
    score.measures.push({...score.measures[0]});
    score.keys = [{at: beat(3), fifths: 0, mode: ''}, {at: beat(1), fifths: -7, mode: 'x'.repeat(2000)}];
    score.meters = [{at: beat(2), numerator: 3, denominator: 4}, {at: beat(1), numerator: 4, denominator: 4}];
    score.composer = '';
    score.parts[0].name = '';
    score.parts[0].instrument = '';
    score.provenance.kind = '';
    score.provenance.attribution = '';
  }));
});

 test('canonical origin version metadata agrees with Rust and npm and does not invent legacy producers',()=>{
  assert.equal(APP_VERSION, JSON.parse(read('../package.json')).version);
  assert.match(read('../Cargo.toml'),new RegExp(`version = "${APP_VERSION.replaceAll('.','\\.')}"`));
  assert.match(rust,new RegExp(`SCORE_SCHEMA_REVISION: u32 = ${SCORE_SCHEMA_REVISION}`));
  valid(fixture);valid(complete());
  invalid(changed(score=>score.format_metadata.schema_revision=3));
  invalid(changed(score=>score.format_metadata.producer=''));
 });

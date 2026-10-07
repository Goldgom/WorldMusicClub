import {readFileSync} from 'node:fs';
import {canonicalFingerprint} from '../web/canonical-audio-fingerprint.js';
import {admitPracticeAssistance} from '../web/practice-assistance-receipt.js';
import {prepareCleanSong, prepareVsqPractice} from '../web/clean-song-package.js';

export const audioFixture = name => JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url)));
export function originalVsqAudioSong() {
  const opened = audioFixture('vsq-clean-v1-native-open'), descriptor = opened.clean_package;
  return prepareVsqPractice(prepareCleanSong(`native:song-${descriptor.content_sha256}`, descriptor, JSON.parse(opened.score_json)), audioFixture('vsq-clean-v1-runtime'));
}

/** Mock route response for consumer-boundary tests only. This does not claim
 * to run the Rust selector or certify native receipt digests. */
export function audioAssistanceFixture(sourceToken, {partIds, humanIds = [], mode = 'explicit', modify = () => {}} = {}) {
  const native = Boolean(sourceToken.runtime), compilation = sourceToken.compilation ?? sourceToken, timeline = compilation.timeline;
  const sourceProfile = native ? sourceToken.profile : 'wmc-canonical-score-v1';
  const runtimePolicy = native ? sourceToken.runtime.rendition?.policy_id ?? sourceToken.runtime.profile : 'wmc-canonical-practice-v1';
  const source = native ? {key: `song-${sourceToken.identity}`, content_sha256: sourceToken.identity, profile: sourceProfile, choice: sourceToken.runtime.choice ?? null, runtime_policy: runtimePolicy} : null;
  const binding = {source, sourceToken, runtimeToken: native ? sourceToken.runtime : timeline, selection: {selected_part_ids: [...partIds].sort(), profile: {kind: 'piano', key_count: 88, lowest_midi: 21}}, mode, settings: null, revision: 1};
  const selected = new Set(partIds), humans = new Set(humanIds), units = new Map();
  for (const note of timeline.notes) for (const sourceId of note.source_note_ids) units.set(sourceId, {source_id: sourceId, part_id: note.part_id, owner: humans.has(sourceId) ? 'human' : 'machine', in_selected_scope: selected.has(note.part_id)});
  const humanNotes = timeline.notes.filter(note => humans.has(note.source_note_ids[0]));
  const groupNotes = notes => {
    const groups = new Map();
    for (const note of notes) { const key = `${note.start_ms}:${note.midi}`; if (!groups.has(key)) groups.set(key, []); groups.get(key).push(note); }
    return [...groups.values()];
  };
  const groups = groupNotes(humanNotes).map(notes => ({target_id: notes[0].id, source_occurrence_ids: notes.map(note => note.id), source_note_ids: [...new Set(notes.flatMap(note => note.source_note_ids))], part_ids: [...new Set(notes.map(note => note.part_id))]}));
  const targets = groups.map(group => ({...humanNotes.find(note => note.id === group.target_id), source_note_ids: group.source_note_ids}));
  const selectedUnits = [...units.values()].filter(unit => unit.in_selected_scope).length, selectedTargets = groupNotes(timeline.notes.filter(note => selected.has(note.part_id))).length;
  const receipt = {source_binding: {domain: ({'wmh-basic-keys-midi1-v1': 'wmc-basic-complete-serde-json', 'wmh-vsq-clean-v1': 'wmc-vsq-complete-serde-json'})[sourceProfile] ?? 'wmc-canonical-score-serde-json', serialization_revision: 1, digest: canonicalFingerprint('test-source', compilation.score ?? sourceToken.score)}, saved_package_sha256: native ? sourceToken.identity : null, source_profile: sourceProfile, runtime_policy: runtimePolicy, choice: source?.choice ?? null, runtime_digest: canonicalFingerprint('test-runtime', timeline)};
  const plan = {format: 'wmc-practice-assistance', schema_version: 1, planner_revision: 1, revision: 1, receipt, selection: binding.selection, mode, settings: null, human_source_ids: [...humans], selection_digest: canonicalFingerprint('test-selection', [...humans].sort())};
  const checked = {plan, receipt, human_targets: {timeline: {notes: targets, duration_ms: timeline.duration_ms}, groups, diagnostics: [], source_note_count: humanNotes.length, target_count: targets.length, playable: targets.length > 0}, machine_occurrence_ids: timeline.notes.filter(note => !humans.has(note.source_note_ids[0])).map(note => note.id), source_ownership: [...units.values()], coverage: {source_unit_count: units.size, selected_source_unit_count: selectedUnits, human_source_unit_count: humans.size, machine_source_unit_count: units.size - humans.size, occurrence_count: timeline.notes.length, human_occurrence_count: humanNotes.length, machine_occurrence_count: timeline.notes.length - humanNotes.length, selected_target_count: selectedTargets, human_target_count: targets.length, machine_selected_target_count: selectedTargets - targets.length}, exclusion_reasons: [], all_selected_human: selectedUnits > 0 && humans.size === selectedUnits, scored_mode_allowed: targets.length > 0, diagnostics: []};
  const response = {source: source ?? {kind: 'canonical', source_binding: receipt.source_binding, profile: sourceProfile, choice: null, runtime_policy: runtimePolicy}, checked};
  binding.expected_selection_digest = plan.selection_digest;
  modify(response, binding);
  return {response, binding, assistance: admitPracticeAssistance(response, binding)};
}

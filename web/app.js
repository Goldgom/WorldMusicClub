import {feedbackView} from './feedback-view.js';
import {STANDARD_TUNING, guitarProfile, pianoProfile} from './instrument-profile.js';
import {compensateInput, validLatency, loadLatency, saveLatency, parseBeatInput, practiceScope} from './practice-settings.js';
import {setupMidi} from './midi.js';
import {setupImageReview} from './image-review.js';
import {setupThemes} from './themes.js';
import {PIANO_RANGES, SHORTCUTS, beat, midiName, keyboardGeometry, transposeTempo, fretPositions, scoreSummary, renderNotation, notationPageCount, notationLayout, keyAt, keyTonic} from './music.js';
import {Transport, Synth, TimelineIndex} from './transport.js';
import {formatTime} from './music.js';

const $ = id => document.getElementById(id);
setupThemes();
const transport = new Transport();
const synth = new Synth();
const state = {catalog: [], score: null, compiled: null, importDiagnostics: [], mode: 'listen', practicePart: null, practiceTimeline: null, targetTimeline: null, practiceIndex: null, practiceVersion: 0, instrument: 'piano', notation: 'staff', numberedMode: 'fixed', latency: loadLatency(), loop: null, loopIteration: 1, loopRequest: 0, notationPage: 0, notationSpan: 16, notationPart: null, timelineIndex: null, sourceNotes: new Map(), keys: 61, lowestMidi: null, customKeys: false, guitar: {tuning: [...STANDARD_TUNING], frets: 12, capo: 0}, instrumentRequest: 0, instrumentOutOfRange: null, instrumentConflict: false, octave: 4, inputs: [], held: new Map(), geometry: keyboardGeometry(61), generation: 0, loadIntent: 0, compileController: null, frame: 0, lastHighlight: '', finishing: false, playTicket: 0, noticeTimer: null, audioLimitWarned: false};

function notice(message, error = false) {
  $('notice').textContent = message;
  $('notice').classList.toggle('error', error);
  $('notice').hidden = false;
}
function clearNotice() { $('notice').hidden = true; }
async function api(path, body, signal) {
  const response = await fetch(path, {method: body === undefined ? 'GET' : 'POST', headers: body === undefined ? {} : {'Content-Type': 'application/json'}, body: body === undefined ? undefined : JSON.stringify(body), signal});
  let result;
  try { result = await response.json(); } catch { throw new Error('The local server returned an unreadable response. Restart the Rust server and try again.'); }
  if (!response.ok) throw new Error(result.error || `The server returned ${response.status}. Check the score and try again.`);
  return result;
}
function updateButtons() {
  const ready = Boolean(state.compiled);
  $('play-button').disabled = !ready;
  $('reset-button').disabled = !ready;
  $('export-button').disabled = !state.score;
  $('loop-apply').disabled = !ready;
  $('assess-button').disabled = !ready || state.mode !== 'practice' || state.finishing;
  $('play-button').textContent = transport.running ? 'Ⅱ Pause · 暂停' : transport.completed ? '↻ Play again · 重来' : '▶ Play · 播放';
}
function silenceHeld() {
  state.held.clear();
  synth.silence();
  document.querySelectorAll('.pressed').forEach(el => el.classList.remove('pressed'));
}
function pausePlayback(reason = 'Paused · 已暂停') {
  state.playTicket++;
  if (transport.running) { transport.pause(performance.now()); $('transport-status').textContent = reason; }
  silenceHeld();
  updateButtons();
  drawFrame();
}
function resetPlayback() {
  pausePlayback();
  transport.reset();
  if (state.loop) transport.seek(state.loop.start_ms);
  state.loopIteration = 1;
  state.loopRequest++; $('loop-enabled').checked = Boolean(state.loop);
  state.inputs = [];
  state.generation++;
  state.finishing = false;
  state.audioLimitWarned = false; synth.droppedVoices = 0;
  state.lastHighlight = '';
  $('feedback-results').hidden = true;
  $('transport-status').textContent = 'Ready when you are';
  $('feedback-description').textContent = state.mode === 'practice' ? 'Play along using the on-screen keys or your computer keyboard. Your note-on timing is measured locally.' : 'Switch to Practice mode, play along, then see your timing and pitch feedback.';
  updateButtons(); drawFrame();
}
async function compileScore(score, preserveTempo = false, expectedIntent = null, importDiagnostics = []) {
  if (preserveTempo) importDiagnostics = state.importDiagnostics;
  if (expectedIntent !== null && expectedIntent !== state.loadIntent) return false;
  if (expectedIntent === null) state.loadIntent++;
  if (new TextEncoder().encode(JSON.stringify(score)).byteLength > 8 * 1024 * 1024) { notice('This score exceeds 8 MiB. Reduce its source image or split it into smaller fragments.', true); return false; }
  pausePlayback();
  state.compileController?.abort();
  const controller = new AbortController();
  state.compileController = controller;
  const generation = ++state.generation;
  $('play-button').disabled = true;
  $('transport-status').textContent = 'Preparing score…';
  try {
    const compiled = await api('/api/compile', score, controller.signal);
    if (generation !== state.generation || controller.signal.aborted) return;
    const previousPart = preserveTempo ? state.practicePart : null;
    state.score = compiled.score;
    state.importDiagnostics = importDiagnostics;
    const diagnostics = [...new Map([...compiled.diagnostics, ...importDiagnostics].map(item => [`${item.code}:${item.note_id || ''}:${item.message}`, item])).values()];
    state.compiled = {...compiled, diagnostics, timeline: {...compiled.timeline, notes: [...compiled.timeline.notes].sort((a, b) => a.start_ms - b.start_ms || a.midi - b.midi)}};
    state.instrumentOutOfRange = null; state.instrumentConflict = false;
    state.timelineIndex = new TimelineIndex(state.compiled.timeline.notes);
    state.sourceNotes = new Map(state.score.parts.flatMap(part => part.notes.map(note => [`${part.id}:${note.id}`, {note, partId: part.id}])));
    state.loop = null; state.loopRequest++; state.practicePart = previousPart !== null && state.score.parts.some(part => part.id === previousPart) ? previousPart : null; rebuildPracticeScope(); $('loop-enabled').checked = false; $('loop-status').textContent = 'Loop cleared. Choose A and B, then Set loop. Beats start at 0; B is exclusive.';
    state.notationPage = 0; state.notationPart = state.practicePart || state.score.parts[0].id;
    if (!preserveTempo) $('tempo').value = String(compiled.score.tempo[0]?.bpm || 100);
    clearNotice();
    resetPlayback();
    renderScore(); renderCatalog(); updateRangeWarning(); checkInstrument();
    return true;
  } catch (error) {
    if (error.name === 'AbortError') return;
    if (generation !== state.generation) return;
    notice(`Could not load this score. ${error.message}`, true);
    $('tempo').value = String(state.score?.tempo[0]?.bpm || 100);
    $('transport-status').textContent = state.compiled ? 'Previous score is still available' : 'Score unavailable';
    updateButtons();
  }
}
function renderCatalog() {
  $('catalog').replaceChildren();
  $('catalog-count').textContent = String(state.catalog.length);
  state.catalog.forEach((score, index) => {
    const button = document.createElement('button');
    button.className = 'catalog-item';
    button.classList.toggle('selected', state.score?.id === score.id);
    button.setAttribute('aria-pressed', String(state.score?.id === score.id));
    const number = document.createElement('span'); number.className = 'number'; number.textContent = String(index + 1).padStart(2, '0');
    const label = document.createElement('span');
    const title = document.createElement('strong'); title.textContent = score.title;
    const meta = document.createElement('small'); meta.textContent = `${scoreSummary(score).count} notes · ${score.tempo[0]?.bpm || 100} BPM · ${score.provenance.kind === 'public_domain_practice_arrangement' ? 'Public-domain excerpt' : 'Original'}`;
    label.append(title, meta); button.append(number, label);
    button.addEventListener('click', () => compileScore(structuredClone(score)));
    $('catalog').append(button);
  });
}
function renderScore() {
  if (!state.score) return;
  const score = state.score;
  const summary = scoreSummary(score);
  $('score-title').textContent = score.title;
  $('score-meta').textContent = `${score.composer || 'Original exercise'} · ${summary.count} notes · ${summary.measures} measures · ${summary.parts} part${summary.parts === 1 ? '' : 's'}`;
  $('score-key').textContent = `${score.meters[0]?.numerator || 4}/${score.meters[0]?.denominator || 4} time · 1 = C display`;
  $('notation-part').replaceChildren();
  for (const part of score.parts) { const option = document.createElement('option'); option.value = part.id; option.textContent = part.name; $('notation-part').append(option); }
  $('notation-part').value = state.notationPart;
  $('practice-part').replaceChildren();
  const all = document.createElement('option'); all.value = ''; all.textContent = 'All parts · 所有声部'; $('practice-part').append(all);
  for (const part of score.parts) { const option = document.createElement('option'); option.value = part.id; option.textContent = part.name; $('practice-part').append(option); }
  $('practice-part').value = state.practicePart || '';
  updatePracticeScopeLabel();
  renderNotationPage();
  $('provenance').textContent = `Source: ${score.provenance.kind}. ${score.provenance.attribution || ''}${score.provenance.license ? ` License: ${score.provenance.license}.` : ' Rights information stays with this score; no external reuse permission is implied.'}`;
  $('provenance-link').hidden = true;
  if (score.provenance.source_url) { try { const url = new URL(score.provenance.source_url); if (url.protocol === 'https:') { $('provenance-link').href = url.href; $('provenance-link').hidden = false; } } catch { /* Preserve invalid source text in exported score, but never turn it into an unsafe link. */ } }
  $('diagnostic-count').textContent = state.compiled.diagnostics.length ? `(${state.compiled.diagnostics.length})` : '';
  $('diagnostic-list').replaceChildren();
  state.compiled.diagnostics.forEach(diagnostic => {
    const li = document.createElement('li'); li.className = diagnostic.severity; li.textContent = `${diagnostic.code}: ${diagnostic.message}`; $('diagnostic-list').append(li);
  });
  state.lastHighlight = '';
  drawFrame();
}
function rebuildPracticeScope() {
  if (!state.compiled) return;
  const scope = practiceScope(state.compiled.timeline, state.practicePart, state.loop);
  state.practiceTimeline = scope.selected; state.targetTimeline = scope.targets;
  state.practiceIndex = new TimelineIndex(scope.selected.notes); state.practiceVersion++;
  state.instrumentOutOfRange = null; state.instrumentConflict = false;
  if (state.loop) { state.loop.notes = scope.playbackNotes; state.loop.index = new TimelineIndex(scope.playbackNotes); state.loop.targetIds = scope.targetIds; updateLoopStatus(); }
  updatePracticeScopeLabel();
}
function updatePracticeScopeLabel() {
  if (!state.score) return;
  const name = state.practicePart === null ? 'All parts · 所有声部' : state.score.parts.find(part => part.id === state.practicePart)?.name || state.practicePart;
  $('practice-scope').textContent = `${name} · ${state.targetTimeline?.notes.length || 0} note-on targets${state.loop ? ' in A–B' : ''}`;
}
function updateLoopStatus() {
  if (!state.loop) return;
  const loop = state.loop;
  $('loop-status').textContent = `Loop A–B ready · ${formatTime(loop.start_ms)}–${formatTime(loop.end_ms)} · ${loop.targetIds.size} selected target notes. ${loop.crossing_notes ? `${loop.crossing_notes} sustained notes in the full score cross a boundary; only selected note-ons inside A–B are scored. ` : ''}${(loop.diagnostics || []).map(d => d.message).join(' ')}`;
}
function renderNotationPage() {
  if (!state.score) return;
  const layout = notationLayout(Math.max(240, $('notation').clientWidth - 36));
  const previousBeat = state.notationPage * state.notationSpan;
  if (layout.spanBeats !== state.notationSpan) { state.notationSpan = layout.spanBeats; state.notationPage = Math.floor(previousBeat / state.notationSpan); }
  const count = notationPageCount(state.score, state.notationSpan);
  state.notationPage = Math.max(0, Math.min(count - 1, state.notationPage));
  $('notation').innerHTML = renderNotation(state.score, state.notation, {startBeat: state.notationPage * state.notationSpan, spanBeats: state.notationSpan, width: layout.width, partId: state.notationPart, numberedMode: state.numberedMode});
  const tonic = keyTonic(keyAt(state.score, state.notationPage * state.notationSpan));
  $('score-key').textContent = state.notation === 'jianpu' && state.numberedMode === 'movable' ? (tonic ? `1 = ${tonic.name}${tonic.octave} · tonic-based numbering (minor too)` : 'Unknown key mode: fixed C display') : `${state.score.meters[0]?.numerator || 4}/${state.score.meters[0]?.denominator || 4} time · 1 = C4 display`;
  $('notation-page').textContent = `Page ${state.notationPage + 1} / ${count}`;
  $('notation-prev').disabled = state.notationPage <= 0;
  $('notation-next').disabled = state.notationPage >= count - 1;
  state.lastHighlight = '';
}
function updateRangeWarning() {
  if (!state.compiled) return;
  const [min, max] = state.instrument === 'guitar' ? [Math.min(...state.guitar.tuning) + state.guitar.capo, Math.max(...state.guitar.tuning) + state.guitar.frets] : [state.geometry[0].midi, state.geometry.at(-1).midi];
  const outside = state.instrumentOutOfRange ?? (state.targetTimeline?.notes || state.compiled.timeline.notes).filter(n => n.midi < min || n.midi > max).length;
  $('practice-hint').textContent = state.instrumentConflict ? 'Some chords need a guitar arrangement · 同时发音存在弦位冲突' : outside ? `${outside} notes unavailable in this ${state.instrument === 'guitar' ? 'guitar fret display' : 'keyboard range'}; change range or exercise` : state.mode === 'practice' ? 'Play each note as it reaches the line · 到线时弹奏' : 'Listen first. Then make it your own. · 先听，再弹';
}
function renderKeyboard() {
  state.geometry = keyboardGeometry(state.keys, state.lowestMidi);
  const fragment = document.createDocumentFragment();
  for (const key of state.geometry) {
    const button = document.createElement('button');
    button.type = 'button'; button.className = `piano-key${key.black ? ' black' : ''}`;
    button.style.left = `${key.x * 100}%`; button.style.width = `${key.width * 100}%`;
    button.dataset.midi = String(key.midi);
    button.setAttribute('aria-label', `Play ${midiName(key.midi)}`); button.title = midiName(key.midi);
    button.setAttribute('aria-pressed', 'false');
    const name = document.createElement('span'); name.textContent = key.midi % 12 === 0 ? midiName(key.midi) : '';
    const shortcut = document.createElement('span'); shortcut.className = 'key-shortcut';
    const matched = Object.entries(SHORTCUTS).find(([, offset]) => (state.octave + 1) * 12 + offset === key.midi);
    shortcut.textContent = matched ? matched[0].toUpperCase() : '';
    button.append(shortcut, name); fragment.append(button);
  }
  $('keyboard').replaceChildren(fragment);
  $('piano-surface').style.minWidth = `${Math.max(640, state.geometry.filter(key => !key.black).length * 22)}px`;
  requestAnimationFrame(() => { const center = state.geometry.find(k => k.midi === (state.octave + 1) * 12); if (center) $('piano-scroll').scrollLeft = Math.max(0, center.x * $('piano-surface').clientWidth - $('piano-scroll').clientWidth / 2.5); drawFrame(); });
}
function renderFretboard() {
  const board = $('fretboard'); board.replaceChildren();
  const {tuning, frets, capo} = state.guitar; const last = frets - capo;
  board.setAttribute('aria-label', `Guitar fretboard: tuning ${tuning.map(midiName).join(', ')}, capo ${capo}`);
  board.style.gridTemplateColumns = `35px repeat(${last + 1}, 1fr)`;
  board.style.gridTemplateRows = `22px repeat(${tuning.length}, 34px)`;
  board.style.minWidth = `${Math.max(600, 35 + (last + 1) * 54)}px`;
  board.style.height = `${22 + tuning.length * 34}px`;
  board.append(document.createElement('span'));
  for (let fret = 0; fret <= last; fret++) { const label = document.createElement('span'); label.className = 'fret-number'; label.textContent = fret === 0 ? capo ? `CAPO ${capo}` : 'OPEN' : String(fret); board.append(label); }
  tuning.forEach((open, string) => {
    const label = document.createElement('span'); label.className = 'string-name'; label.textContent = midiName(open + capo); board.append(label);
    for (let fret = 0; fret <= last; fret++) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'fret-button';
      button.dataset.midi = String(open + capo + fret); button.dataset.string = String(string); button.dataset.fret = String(fret);
      button.setAttribute('aria-label', `String ${string + 1}, fret ${fret}${capo ? ` after capo ${capo}` : ''}: ${midiName(open + capo + fret)}`);
      button.setAttribute('aria-pressed', 'false');
      const text = document.createElement('span'); text.textContent = midiName(open + capo + fret); button.append(text); board.append(button);
    }
  });
  $('guitar-description').textContent = `${tuning.map(midiName).join(' · ')} tuning, string 1 → ${tuning.length}. ${frets} physical frets; capo ${capo}. Displayed fret numbers are relative to the capo. Highlighted positions are pitch options, not a validated fingering.`;
}
function currentProfile() {
  return state.instrument === 'guitar' ? {kind:'guitar',...state.guitar} : {kind:'piano',key_count:state.keys,lowest_midi:state.lowestMidi};
}
function profileControls() {
  $('custom-piano-controls').hidden = state.instrument !== 'piano' || !state.customKeys;
  $('guitar-controls').hidden = state.instrument !== 'guitar';
  $('instrument-apply').hidden = state.instrument !== 'guitar' && !state.customKeys;
}
async function checkInstrument(profile = currentProfile(), apply = false) {
  if (!state.compiled) return;
  const request = ++state.instrumentRequest; const compiled = state.compiled; const selection = state.practiceVersion;
  state.instrumentOutOfRange = null; state.instrumentConflict = false;
  $('instrument-report').textContent = 'Checking note range and pitch-compatible positions with Rust…';
  try {
    const report = await api('/api/instrument-check', {timeline:state.targetTimeline || compiled.timeline, profile});
    if (request !== state.instrumentRequest || compiled !== state.compiled || selection !== state.practiceVersion) return;
    if (apply) {
      pausePlayback();
      if (profile.kind === 'piano') { state.keys = profile.key_count; state.lowestMidi = profile.lowest_midi; state.customKeys = true; $('key-count').value = 'custom'; renderKeyboard(); }
      else { state.guitar = {tuning:profile.tuning, frets:profile.frets, capo:profile.capo}; renderFretboard(); }
      updateRangeWarning();
    }
    const outside = report.note_options.filter(note => !note.playable).length;
    state.instrumentOutOfRange = outside; state.instrumentConflict = report.diagnostics.some(d => d.code === 'guitar_string_conflict'); updateRangeWarning();
    $('instrument-report').textContent = `${midiName(report.lowest_midi)}–${midiName(report.highest_midi)} · ${outside} notes outside playable range · original pitches preserved`;
    $('instrument-diagnostics').replaceChildren();
    for (const diagnostic of report.diagnostics) { const li = document.createElement('li'); li.textContent = diagnostic.message; $('instrument-diagnostics').append(li); }
    $('instrument-settings').classList.toggle('has-warnings', report.diagnostics.some(d => d.code !== 'guitar_fingering_advisory'));
  } catch (error) { if (request === state.instrumentRequest) $('instrument-report').textContent = `Instrument setup not applied: ${error.message}`; }
}
$('instrument-apply').addEventListener('click', () => {
  try { const profile = state.instrument === 'guitar' ? guitarProfile($('guitar-tuning').value, $('guitar-frets').value, $('guitar-capo').value) : pianoProfile($('custom-key-count').value, $('custom-lowest').value); checkInstrument(profile, true); }
  catch (error) { $('instrument-report').textContent = error.message; }
});
async function pressNote(source, midi, velocity = 90) {
  if (state.held.has(source)) return;
  state.held.set(source, midi);
  const inputTime = transport.time(performance.now());
  const correctedTime = compensateInput(inputTime, state.latency);
  if (transport.running && state.mode === 'practice' && correctedTime >= (state.loop?.start_ms || 0) - 180 && correctedTime <= (state.loop?.end_ms || state.compiled.timeline.duration_ms) + 180) {
    state.inputs.push({midi, at_ms: correctedTime, velocity});
    $('feedback-description').textContent = `${state.inputs.length} note${state.inputs.length === 1 ? '' : 's'} recorded in this take · 已记录 ${state.inputs.length} 个音`;
  }
  highlightKeys();
  try { await synth.unlock(); if (state.held.get(source) === midi) synth.play(`manual:${source}`, midi, null, 0, state.instrument, velocity); }
  catch (error) { notice(error.message, true); }
}
function releaseNote(source) { state.held.delete(source); synth.stop(`manual:${source}`); highlightKeys(); }
function highlightKeys(activeNotes = []) {
  const held = new Set(state.held.values());
  const active = new Set(activeNotes.map(n => n.midi));
  document.querySelectorAll('[data-midi]').forEach(button => { const midi = Number(button.dataset.midi); button.classList.toggle('pressed', held.has(midi)); button.classList.toggle('playing', active.has(midi)); button.setAttribute('aria-pressed', String(held.has(midi))); });
}
function connectPlayable(container) {
  container.addEventListener('pointerdown', event => {
    const key = event.target.closest('[data-midi]');
    if (!key || event.button > 0) return;
    event.preventDefault(); key.setPointerCapture(event.pointerId);
    pressNote(`pointer:${event.pointerId}`, Number(key.dataset.midi));
  });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) container.addEventListener(type, event => releaseNote(`pointer:${event.pointerId}`));
  container.addEventListener('keydown', event => {
    if ((event.key === 'Enter' || event.key === ' ') && !event.repeat && event.target.dataset.midi) { event.preventDefault(); event.stopPropagation(); pressNote('accessible-key', Number(event.target.dataset.midi)); }
  });
  container.addEventListener('focusout', () => releaseNote('accessible-key'));
  container.addEventListener('keyup', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); releaseNote('accessible-key'); } });
}
async function togglePlayback() {
  if (!state.compiled) return;
  if (transport.running) { pausePlayback(); return; }
  const generation = state.generation;
  const ticket = ++state.playTicket;
  try { await synth.unlock(); } catch (error) { notice(error.message, true); return; }
  if (generation !== state.generation || ticket !== state.playTicket || transport.running || !state.compiled) return;
  if (transport.completed) resetPlayback();
  const beatMs = 60000 / (Number($('tempo').value) || 100);
  transport.start(performance.now(), state.loop?.notes || state.practiceTimeline?.notes || state.compiled.timeline.notes, $('count-in').checked ? beatMs * 4 : 0);
  updateButtons();
}
async function assess(options = {}) {
  if (!state.compiled || state.mode !== 'practice' || state.finishing) return;
  if (!options.keepPlaying) pausePlayback();
  state.finishing = true; updateButtons();
  const generation = state.generation;
  try {
    const timeline = state.targetTimeline || state.compiled.timeline;
    const assessment = await api('/api/assess', {timeline, inputs: options.inputs || state.inputs, tolerance_ms: 180});
    if (generation !== state.generation) return;
    $('feedback-results').hidden = false;
    const view = feedbackView(assessment, timeline.notes.length);
    $('accuracy').textContent = view.accuracy;
    $('hits').textContent = view.hits;
    $('misses').textContent = view.misses;
    $('timing').textContent = view.meanError;
    $('coverage').textContent = view.coverage;
    $('timing-bias').textContent = view.bias;
    $('timing-spread').textContent = view.spread;
    $('feedback-advice').replaceChildren();
    for (const advice of view.advice) { const item = document.createElement('li'); item.textContent = advice.message; item.className = advice.severity === 'warning' ? 'warning' : 'info'; $('feedback-advice').append(item); }
    $('feedback-calibration-note').textContent = `${view.hasSummary ? 'Rust-derived timing statistics.' : 'Timing bias and variability are unavailable in this server response.'} Your ${state.latency} ms manual offset is already applied. Device/audio latency can resemble consistent early or late playing; use repeated takes before adjusting calibration. Accuracy includes extra inputs; coverage counts matched expected note-ons.`;
    $('feedback-detail').textContent = `${assessment.hits.filter(h => h.grade === 'perfect').length} perfect · ${assessment.hits.filter(h => h.grade === 'good').length} good · ${assessment.hits.filter(h => h.grade === 'early').length} early · ${assessment.hits.filter(h => h.grade === 'late').length} late. Matching window: ±180 ms. Input offset: ${state.latency} ms. Browser/audio latency can affect your result.`;
    $('feedback-description').textContent = (options.iteration ? `Loop ${options.iteration}: ` : '') + (view.expected === 0 ? 'No note-on targets were selected. Choose a range containing notes.' : assessment.hits.length ? 'A useful snapshot, not a verdict. Slow the tempo and try another take.' : 'No notes matched yet. Try a slower tempo and the four-beat count-in.');
  } catch (error) { if (generation === state.generation) notice(`Could not check this take. ${error.message}`, true); }
  finally { if (generation === state.generation) { state.finishing = false; updateButtons(); } }
}
function drawFrame() {
  const now = performance.now();
  const position = transport.time(now);
  if (synth.droppedVoices && !state.audioLimitWarned) { state.audioLimitWarned = true; notice('This dense passage exceeded the 64-voice synth preview limit. Some overlapping sounds were cut short; the full score and assessment targets remain unchanged.'); }
  const timeline = state.compiled?.timeline;
  const duration = timeline?.duration_ms || 0;
  const segmentStart = state.loop?.start_ms || 0;
  const segmentEnd = state.loop?.end_ms || duration;
  const playbackNotes = state.loop?.notes || state.practiceTimeline?.notes || timeline?.notes || [];
  const playbackIndex = state.loop?.index || state.practiceIndex || state.timelineIndex;
  if (transport.running && timeline) {
    for (const note of transport.due(now, playbackNotes)) if (state.mode === 'listen') synth.play(`score:${note.id}:${note.part_id}:${note.start_ms}`, note.midi, note.remaining_ms, note.delay_ms, state.instrument, note.velocity ?? 90);
    if (state.loop && position >= segmentEnd) {
      const inputs = state.inputs; const iteration = state.loopIteration++;
      silenceHeld(); transport.seek(segmentStart); state.inputs = [];
      if (state.mode === 'practice') assess({keepPlaying: true, inputs, iteration});
      const beatMs = 60000 / (Number($('tempo').value) || 100);
      transport.start(now, playbackNotes, $('count-in').checked ? beatMs * 4 : 0);
      updateButtons(); $('transport-status').textContent = `Loop ${state.loopIteration} · 循环`;
    } else if (position >= duration + (state.mode === 'practice' ? 200 : 80)) { transport.finish(duration); silenceHeld(); updateButtons(); $('transport-status').textContent = 'Complete · 已完成'; if (state.mode === 'practice') assess(); }
    else $('transport-status').textContent = position < segmentStart ? `Count in · ${Math.ceil((segmentStart - position) / (60000 / (Number($('tempo').value) || 100)))}` : state.mode === 'practice' ? `Your turn${state.loop ? ` · Loop ${state.loopIteration}` : ''} · 跟着弹` : `Listening${state.loop ? ` · Loop ${state.loopIteration}` : ''} · 正在聆听`;
  }
  const active = position < segmentStart ? [] : playbackIndex?.range(position) || [];
  if (transport.running && active.length) {
    const first = active.find(note => note.part_id === state.notationPart);
    const source = first && state.sourceNotes.get(`${first.part_id}:${first.source_note_id || first.id}`);
    const page = source ? Math.floor(beat(source.note.at) / state.notationSpan) : state.notationPage;
    if (page !== state.notationPage) { state.notationPage = page; renderNotationPage(); }
  }
  const signature = active.map(n => n.id).join('|');
  if (signature !== state.lastHighlight) {
    document.querySelectorAll('.score-note').forEach(note => note.classList.toggle('active', active.some(n => (n.source_note_id || n.id) === note.dataset.noteId)));
    state.lastHighlight = signature;
    const focused = $('notation').querySelector('.score-note.active');
    if (transport.running && focused) { const box = focused.getBoundingClientRect(); const view = $('notation').getBoundingClientRect(); if (box.left < view.left + 20 || box.right > view.right - 20) $('notation').scrollLeft += box.left - view.left - view.width * 0.35; }
  }
  highlightKeys(active);
  $('progress').max = Math.max(1, duration); $('progress').value = Math.min(duration, Math.max(0, position));
  $('time-label').textContent = `${formatTime(position)} / ${formatTime(duration)}`;
  if (state.instrument !== 'piano') return;
  const canvas = $('falling-notes'); const width = canvas.clientWidth; const height = canvas.clientHeight;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) { canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr); }
  const ctx = canvas.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#263a31'; ctx.fillRect(0, 0, width, height);
  for (const key of state.geometry.filter(k => !k.black)) { ctx.strokeStyle = '#ffffff08'; ctx.beginPath(); ctx.moveTo(key.x * width, 0); ctx.lineTo(key.x * width, height); ctx.stroke(); }
  const beatMs = 60000 / (Number($('tempo').value) || 100);
  const windowMs = beatMs * 4;
  for (let b = Math.floor(position / beatMs); b <= Math.ceil((position + windowMs) / beatMs); b++) { const y = height - (b * beatMs - position) / windowMs * height; if (y < 0 || y > height) continue; ctx.strokeStyle = b % 4 === 0 ? '#a7c09435' : '#a7c09416'; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke(); }
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  for (const note of reducedMotion ? active : playbackIndex?.range(position, position + windowMs) || []) {
    if (note.start_ms + note.duration_ms < position || note.start_ms > position + windowMs) continue;
    const key = state.geometry.find(k => k.midi === note.midi); if (!key) continue;
    const bottom = reducedMotion ? height : height - (note.start_ms - position) / windowMs * height;
    const noteHeight = reducedMotion ? 40 : Math.max(8, note.duration_ms / windowMs * height - 4);
    const x = key.x * width + 2; const y = bottom - noteHeight;
    ctx.fillStyle = note.start_ms <= position ? '#dfb45e' : key.black ? '#76975e' : '#a6c887';
    ctx.beginPath(); ctx.roundRect(x, y, Math.max(2, key.width * width - 4), noteHeight, 4); ctx.fill();
    if (noteHeight > 23 && key.width * width > 27) { ctx.fillStyle = '#29422a'; ctx.font = '10px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(midiName(note.midi), x + (key.width * width - 4) / 2, Math.max(y + 14, 12)); }
  }
  if (reducedMotion && timeline) { ctx.fillStyle = '#b2c2a6'; ctx.font = '11px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('Reduced motion · Active notes only', width / 2, 30); }
  if (!timeline) { ctx.fillStyle = '#a9bba2'; ctx.font = '12px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('Choose an exercise to begin · 选择练习曲', width / 2, height / 2); }
}
let lastIdleDraw = 0;
function animate(now) { if (transport.running || now - lastIdleDraw > 100) { drawFrame(); lastIdleDraw = now; } state.frame = requestAnimationFrame(animate); }

async function applyLoop() {
  if (!state.score) return;
  pausePlayback();
  const request = ++state.loopRequest;
  const generation = state.generation;
  $('loop-status').textContent = 'Validating loop boundaries with the Rust score clock…';
  $('loop-apply').disabled = true;
  try {
    const from = parseBeatInput($('loop-from').value); const to = parseBeatInput($('loop-to').value);
    if (beat(to) <= beat(from)) throw new Error('B must be later than A.');
    const window = await api('/api/practice-window', {score: state.score, from, to});
    if (request !== state.loopRequest || generation !== state.generation) return;
    if (window.end_ms - window.start_ms < 250) throw new Error('Choose a loop at least 250 ms long so playback and feedback can remain usable.');
    state.loop = {...window, notes: [], index: null, targetIds: new Set()};
    rebuildPracticeScope();
    $('loop-enabled').checked = true;
    updateLoopStatus();
    resetPlayback(); checkInstrument();
  } catch (error) { if (request === state.loopRequest) { state.loop = null; rebuildPracticeScope(); checkInstrument(); $('loop-enabled').checked = false; $('loop-status').textContent = `Loop not set: ${error.message}`; resetPlayback(); } }
  finally { if (request === state.loopRequest) updateButtons(); }
}
$('loop-apply').addEventListener('click', applyLoop);
$('loop-enabled').addEventListener('change', () => { if ($('loop-enabled').checked) applyLoop(); else { state.loop = null; state.loopRequest++; rebuildPracticeScope(); resetPlayback(); checkInstrument(); $('loop-status').textContent = 'Loop off. Full-length playback and assessment for the selected part restored.'; } });
for (const id of ['loop-from', 'loop-to']) $(id).addEventListener('input', () => { state.loopRequest++; if (state.loop || $('loop-enabled').checked) { state.loop = null; rebuildPracticeScope(); $('loop-enabled').checked = false; resetPlayback(); checkInstrument(); } $('loop-status').textContent = 'Bounds changed. Set loop to validate the new range.'; });

$('latency-offset').value = String(state.latency);
$('latency-offset').addEventListener('change', () => {
  const value = $('latency-offset').value;
  if (!validLatency(value)) { $('latency-offset').value = String(state.latency); notice('Latency offset must be a whole number from −500 to 500 ms.', true); return; }
  state.latency = Number(value); saveLatency(state.latency); resetPlayback();
});
$('practice-part').addEventListener('change', () => { state.practicePart = $('practice-part').value || null; rebuildPracticeScope(); resetPlayback(); if (state.practicePart !== null) { state.notationPart = state.practicePart; $('notation-part').value = state.practicePart; renderNotationPage(); } updateRangeWarning(); checkInstrument(); });
$('jianpu-reference').addEventListener('change', () => { state.numberedMode = $('jianpu-reference').value; renderNotationPage(); });
$('notation-part').addEventListener('change', () => { state.notationPart = $('notation-part').value; renderNotationPage(); });
$('notation-prev').addEventListener('click', () => { state.notationPage--; renderNotationPage(); });
$('notation-next').addEventListener('click', () => { state.notationPage++; renderNotationPage(); });
$('play-button').addEventListener('click', togglePlayback);
$('reset-button').addEventListener('click', resetPlayback);
$('assess-button').addEventListener('click', () => assess());
$('session-mode').addEventListener('change', () => { state.mode = $('session-mode').value; resetPlayback(); updateRangeWarning(); });
$('instrument').addEventListener('change', () => { pausePlayback(); state.instrument = $('instrument').value; profileControls(); if (state.instrument === 'guitar') $('instrument-settings').open = true; checkInstrument(); $('piano-stage').hidden = state.instrument !== 'piano'; $('guitar-stage').hidden = state.instrument !== 'guitar'; $('key-count').disabled = state.instrument !== 'piano'; updateRangeWarning(); drawFrame(); });
$('key-count').addEventListener('change', () => { pausePlayback(); state.customKeys = $('key-count').value === 'custom'; profileControls(); if (state.customKeys) { $('instrument-settings').open = true; $('custom-key-count').value = String(state.keys); $('custom-lowest').value = midiName(state.geometry[0].midi).replace('♯','#'); return; } state.keys = Number($('key-count').value); state.lowestMidi = null; renderKeyboard(); updateRangeWarning(); checkInstrument(); });
$('typing-octave').addEventListener('change', () => { pausePlayback(); state.octave = Number($('typing-octave').value); renderKeyboard(); });
$('tempo').addEventListener('change', () => {
  const bpm = Number($('tempo').value);
  if (!Number.isFinite(bpm) || bpm < 10 || bpm > 600) { notice('Choose a tempo from 10 to 600 BPM.', true); $('tempo').value = String(state.score?.tempo[0]?.bpm || 100); return; }
  if (state.score) compileScore(transposeTempo(state.score, bpm), true);
});
for (const mode of ['staff', 'jianpu']) $(mode + '-button').addEventListener('click', () => { state.notation = mode; $('jianpu-reference-label').hidden = mode !== 'jianpu'; ['staff', 'jianpu'].forEach(m => { $(m + '-button').classList.toggle('selected', m === mode); $(m + '-button').setAttribute('aria-pressed', String(m === mode)); }); renderScore(); });
$('sound-button').addEventListener('click', () => { synth.muted = !synth.muted; if (synth.muted) synth.silence(); $('sound-button').textContent = synth.muted ? 'Sound off ♫' : 'Sound on ♫'; $('sound-button').setAttribute('aria-pressed', String(synth.muted)); });
$('import-button').addEventListener('click', () => $('score-file').click());
$('mobile-import-button').addEventListener('click', () => $('score-file').click());
$('score-file').addEventListener('change', async event => {
  const file = event.target.files[0]; event.target.value = ''; if (!file) return;
  const intent = ++state.loadIntent;
  if (file.size > 8 * 1024 * 1024) { notice('This score is too large. Choose a score file smaller than 8 MiB.', true); return; }
  try {
    const compressed = /\.mxl$/i.test(file.name);
    const midiFile = /\.(mid|midi)$/i.test(file.name);
    const content = compressed || midiFile ? await file.arrayBuffer() : await file.text();
    if (compressed || midiFile || /\.(musicxml|xml)$/i.test(file.name)) {
      pausePlayback();
      const response = await fetch(midiFile ? '/api/import/midi' : compressed ? '/api/import/mxl' : '/api/import/musicxml', {method: 'POST', headers: {'Content-Type': midiFile ? 'audio/midi' : compressed ? 'application/zip' : 'application/xml'}, body: content});
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Score import failed.');
      const loaded = await compileScore(result.score, false, intent, result.diagnostics || []);
      if (loaded && Array.isArray(result.diagnostics) && result.diagnostics.length) notice(result.diagnostics.map(d => d.message).join(' '));
    } else { const score = JSON.parse(content); await compileScore(score, false, intent); }
  }
  catch (error) { if (intent !== state.loadIntent) return; notice(`Could not read “${file.name}”. Choose valid score JSON, MusicXML (.musicxml/.xml), compressed MusicXML (.mxl), or MIDI (.mid/.midi). ${error.message}`, true); }
});
$('export-button').addEventListener('click', () => { if (!state.score) return; const blob = new Blob([JSON.stringify(state.score, null, 2)], {type: 'application/json'}); const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = `${state.score.id.replace(/[^\w.-]/g, '_')}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); });
connectPlayable($('keyboard')); connectPlayable($('fretboard'));
document.addEventListener('keydown', event => {
  if (event.defaultPrevented || event.repeat || event.ctrlKey || event.metaKey || event.altKey || /^(INPUT|SELECT|TEXTAREA)$/.test(event.target.tagName) || event.target.isContentEditable) return;
  if (event.code === 'Space') { if (event.target.tagName === 'BUTTON') return; event.preventDefault(); togglePlayback(); return; }
  const key = event.key.toLowerCase();
  if (Object.hasOwn(SHORTCUTS, key)) { event.preventDefault(); pressNote(`key:${event.code}`, (state.octave + 1) * 12 + SHORTCUTS[key]); }
});
document.addEventListener('keyup', event => { releaseNote(`key:${event.code}`); if (event.key === 'Enter' || event.key === ' ') releaseNote('accessible-key'); });
window.addEventListener('blur', () => pausePlayback('Paused when focus moved · 已暂停'));
document.addEventListener('visibilitychange', () => { if (document.hidden) pausePlayback('Paused in background · 已暂停'); });
window.addEventListener('pagehide', () => { pausePlayback(); cancelAnimationFrame(state.frame); });
let notationResizeFrame = 0;
window.addEventListener('resize', () => { cancelAnimationFrame(notationResizeFrame); notationResizeFrame = requestAnimationFrame(() => { renderNotationPage(); drawFrame(); }); });
window.addEventListener('pageshow', event => { if (event.persisted) { cancelAnimationFrame(state.frame); state.frame = requestAnimationFrame(animate); } });

async function loadCatalog() {
  const intent = state.loadIntent;
  try { state.catalog = await api('/api/catalog'); if (!Array.isArray(state.catalog) || !state.catalog.length) throw new Error('No bundled exercises are available. Import a score JSON or restart the server.'); renderCatalog(); await compileScore(structuredClone(state.catalog[0]), false, intent); }
  catch (error) { $('catalog').replaceChildren(); const retry = document.createElement('button'); retry.className = 'button secondary'; retry.textContent = 'Retry exercise library'; retry.addEventListener('click', loadCatalog); $('catalog').append(retry); notice(`Could not load the exercise library. ${error.message}`, true); }
}
setupImageReview({compileScore, pausePlayback, notice});
setupMidi({pressNote, releaseNote, silenceHeld, notice});
renderKeyboard(); renderFretboard(); updateButtons(); requestAnimationFrame(animate); loadCatalog();

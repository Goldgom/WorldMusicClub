import {setupMidi} from './midi.js';
import {setupImageReview} from './image-review.js';
import {setupThemes} from './themes.js';
import {PIANO_RANGES, SHORTCUTS, beat, midiName, keyboardGeometry, transposeTempo, fretPositions, scoreSummary, renderNotation} from './music.js';
import {Transport, Synth} from './transport.js';
import {formatTime} from './music.js';

const $ = id => document.getElementById(id);
setupThemes();
const transport = new Transport();
const synth = new Synth();
const state = {catalog: [], score: null, compiled: null, mode: 'listen', instrument: 'piano', notation: 'staff', keys: 61, octave: 4, inputs: [], held: new Map(), geometry: keyboardGeometry(61), generation: 0, compileController: null, frame: 0, lastHighlight: '', finishing: false, playTicket: 0, noticeTimer: null};

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
  state.inputs = [];
  state.generation++;
  state.finishing = false;
  state.lastHighlight = '';
  $('feedback-results').hidden = true;
  $('transport-status').textContent = 'Ready when you are';
  $('feedback-description').textContent = state.mode === 'practice' ? 'Play along using the on-screen keys or your computer keyboard. Your note-on timing is measured locally.' : 'Switch to Practice mode, play along, then see your timing and pitch feedback.';
  updateButtons(); drawFrame();
}
async function compileScore(score, preserveTempo = false) {
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
    state.score = compiled.score;
    state.compiled = {...compiled, timeline: {...compiled.timeline, notes: [...compiled.timeline.notes].sort((a, b) => a.start_ms - b.start_ms || a.midi - b.midi)}};
    if (!preserveTempo) $('tempo').value = String(compiled.score.tempo[0]?.bpm || 100);
    clearNotice();
    resetPlayback();
    renderScore(); renderCatalog(); updateRangeWarning();
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
    const meta = document.createElement('small'); meta.textContent = `${scoreSummary(score).count} notes · ${score.tempo[0]?.bpm || 100} BPM · Original`;
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
  $('notation').innerHTML = renderNotation(score, state.notation);
  $('provenance').textContent = `Source: ${score.provenance.kind}. ${score.provenance.attribution || ''}${score.provenance.license ? ` License: ${score.provenance.license}.` : ' Rights information stays with this score; no external reuse permission is implied.'}`;
  $('diagnostic-count').textContent = state.compiled.diagnostics.length ? `(${state.compiled.diagnostics.length})` : '';
  $('diagnostic-list').replaceChildren();
  state.compiled.diagnostics.forEach(diagnostic => {
    const li = document.createElement('li'); li.className = diagnostic.severity; li.textContent = `${diagnostic.code}: ${diagnostic.message}`; $('diagnostic-list').append(li);
  });
  state.lastHighlight = '';
  drawFrame();
}
function updateRangeWarning() {
  if (!state.compiled) return;
  const [min, max] = state.instrument === 'guitar' ? [40, 76] : PIANO_RANGES[state.keys];
  const outside = state.compiled.timeline.notes.filter(n => n.midi < min || n.midi > max).length;
  $('practice-hint').textContent = outside ? `${outside} notes outside this ${state.instrument === 'guitar' ? '0–12 fret display' : 'keyboard range'}; change range or exercise` : state.mode === 'practice' ? 'Play each note as it reaches the line · 到线时弹奏' : 'Listen first. Then make it your own. · 先听，再弹';
}
function renderKeyboard() {
  state.geometry = keyboardGeometry(state.keys);
  const fragment = document.createDocumentFragment();
  for (const key of state.geometry) {
    const button = document.createElement('button');
    button.type = 'button'; button.className = `piano-key${key.black ? ' black' : ''}`;
    button.style.left = `${key.x * 100}%`; button.style.width = `${key.width * 100}%`;
    button.dataset.midi = String(key.midi);
    button.setAttribute('aria-label', `Play ${midiName(key.midi)}`);
    button.setAttribute('aria-pressed', 'false');
    const name = document.createElement('span'); name.textContent = key.midi % 12 === 0 || key.black ? midiName(key.midi) : '';
    const shortcut = document.createElement('span'); shortcut.className = 'key-shortcut';
    const matched = Object.entries(SHORTCUTS).find(([, offset]) => (state.octave + 1) * 12 + offset === key.midi);
    shortcut.textContent = matched ? matched[0].toUpperCase() : '';
    button.append(shortcut, name); fragment.append(button);
  }
  $('keyboard').replaceChildren(fragment);
  $('piano-surface').style.minWidth = `${state.keys === 88 ? 1050 : state.keys === 76 ? 960 : 840}px`;
  requestAnimationFrame(() => { const center = state.geometry.find(k => k.midi === (state.octave + 1) * 12); if (center) $('piano-scroll').scrollLeft = Math.max(0, center.x * $('piano-surface').clientWidth - $('piano-scroll').clientWidth / 2.5); drawFrame(); });
}
function renderFretboard() {
  const board = $('fretboard'); board.replaceChildren();
  board.append(document.createElement('span'));
  for (let fret = 0; fret <= 12; fret++) { const label = document.createElement('span'); label.className = 'fret-number'; label.textContent = fret === 0 ? 'OPEN' : String(fret); board.append(label); }
  [64, 59, 55, 50, 45, 40].forEach((open, string) => {
    const label = document.createElement('span'); label.className = 'string-name'; label.textContent = midiName(open); board.append(label);
    for (let fret = 0; fret <= 12; fret++) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'fret-button';
      button.dataset.midi = String(open + fret); button.dataset.string = String(string); button.dataset.fret = String(fret);
      button.setAttribute('aria-label', `String ${string + 1}, fret ${fret}: ${midiName(open + fret)}`);
      button.setAttribute('aria-pressed', 'false');
      const text = document.createElement('span'); text.textContent = midiName(open + fret); button.append(text); board.append(button);
    }
  });
}
async function pressNote(source, midi, velocity = 90) {
  if (state.held.has(source)) return;
  state.held.set(source, midi);
  const inputTime = transport.time(performance.now());
  if (transport.running && state.mode === 'practice' && inputTime >= 0 && inputTime <= state.compiled.timeline.duration_ms + 300) {
    state.inputs.push({midi, at_ms: inputTime, velocity});
    $('feedback-description').textContent = `${state.inputs.length} note${state.inputs.length === 1 ? '' : 's'} recorded in this take · 已记录 ${state.inputs.length} 个音`;
  }
  highlightKeys();
  try { await synth.unlock(); if (state.held.get(source) === midi) synth.play(`manual:${source}`, midi, null, 0, state.instrument); }
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
  transport.start(performance.now(), state.compiled.timeline.notes, $('count-in').checked ? beatMs * 4 : 0);
  updateButtons();
}
async function assess() {
  if (!state.compiled || state.mode !== 'practice' || state.finishing) return;
  pausePlayback();
  state.finishing = true; updateButtons();
  const generation = state.generation;
  try {
    const assessment = await api('/api/assess', {timeline: state.compiled.timeline, inputs: state.inputs, tolerance_ms: 180});
    if (generation !== state.generation) return;
    $('feedback-results').hidden = false;
    $('accuracy').textContent = `${Math.round(assessment.accuracy_percent)}%`;
    $('hits').textContent = String(assessment.hits.length);
    $('misses').textContent = `${assessment.misses.length} / ${assessment.extras.length}`;
    $('timing').textContent = assessment.mean_abs_error_ms === null ? '—' : `${Math.round(assessment.mean_abs_error_ms)} ms`;
    $('feedback-detail').textContent = `${assessment.hits.filter(h => h.grade === 'perfect').length} perfect · ${assessment.hits.filter(h => h.grade === 'good').length} good · ${assessment.hits.filter(h => h.grade === 'early').length} early · ${assessment.hits.filter(h => h.grade === 'late').length} late. Matching window: ±180 ms. Browser/audio latency can affect your result.`;
    $('feedback-description').textContent = assessment.hits.length ? 'A useful snapshot, not a verdict. Slow the tempo and try another take.' : 'No notes matched yet. Try a slower tempo and the four-beat count-in.';
  } catch (error) { if (generation === state.generation) notice(`Could not check this take. ${error.message}`, true); }
  finally { if (generation === state.generation) { state.finishing = false; updateButtons(); } }
}
function drawFrame() {
  const now = performance.now();
  const position = transport.time(now);
  const timeline = state.compiled?.timeline;
  const duration = timeline?.duration_ms || 0;
  if (transport.running && timeline) {
    for (const note of transport.due(now, timeline.notes)) if (state.mode === 'listen') synth.play(`score:${note.id}:${note.part_id}:${note.start_ms}`, note.midi, note.remaining_ms, note.delay_ms, state.instrument);
    if (position >= duration + (state.mode === 'practice' ? 200 : 80)) { transport.finish(duration); silenceHeld(); updateButtons(); $('transport-status').textContent = 'Complete · 已完成'; if (state.mode === 'practice') assess(); }
    else $('transport-status').textContent = position < 0 ? `Count in · ${Math.ceil(-position / (60000 / (Number($('tempo').value) || 100)))}` : state.mode === 'practice' ? 'Your turn · 跟着弹' : 'Listening · 正在聆听';
  }
  const active = timeline?.notes.filter(n => n.start_ms <= position && n.start_ms + n.duration_ms > position) || [];
  const signature = active.map(n => n.id).join('|');
  if (signature !== state.lastHighlight) { document.querySelectorAll('.score-note').forEach(note => note.classList.toggle('active', active.some(n => (n.source_note_id || n.id) === note.dataset.noteId))); state.lastHighlight = signature; }
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
  for (const note of reducedMotion ? active : timeline?.notes || []) {
    if (note.start_ms + note.duration_ms < position || note.start_ms > position + windowMs) continue;
    const key = state.geometry.find(k => k.midi === note.midi); if (!key) continue;
    const bottom = reducedMotion ? height : height - (note.start_ms - position) / windowMs * height;
    const noteHeight = reducedMotion ? 40 : Math.max(8, note.duration_ms / windowMs * height - 4);
    const x = key.x * width + 2; const y = bottom - noteHeight;
    ctx.fillStyle = note.start_ms <= position ? '#dfb45e' : key.black ? '#76975e' : '#a6c887';
    ctx.beginPath(); ctx.roundRect(x, y, Math.max(2, key.width * width - 4), noteHeight, 4); ctx.fill();
    if (noteHeight > 23 && key.width * width > 18) { ctx.fillStyle = '#29422a'; ctx.font = '8px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(midiName(note.midi), x + (key.width * width - 4) / 2, Math.max(y + 14, 12)); }
  }
  if (reducedMotion && timeline) { ctx.fillStyle = '#b2c2a6'; ctx.font = '11px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('Reduced motion · Active notes only', width / 2, 30); }
  if (!timeline) { ctx.fillStyle = '#a9bba2'; ctx.font = '12px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('Choose an exercise to begin · 选择练习曲', width / 2, height / 2); }
}
let lastIdleDraw = 0;
function animate(now) { if (transport.running || now - lastIdleDraw > 100) { drawFrame(); lastIdleDraw = now; } state.frame = requestAnimationFrame(animate); }

$('play-button').addEventListener('click', togglePlayback);
$('reset-button').addEventListener('click', resetPlayback);
$('assess-button').addEventListener('click', assess);
$('session-mode').addEventListener('change', () => { state.mode = $('session-mode').value; resetPlayback(); updateRangeWarning(); });
$('instrument').addEventListener('change', () => { pausePlayback(); state.instrument = $('instrument').value; $('piano-stage').hidden = state.instrument !== 'piano'; $('guitar-stage').hidden = state.instrument !== 'guitar'; $('key-count').disabled = state.instrument !== 'piano'; updateRangeWarning(); drawFrame(); });
$('key-count').addEventListener('change', () => { pausePlayback(); state.keys = Number($('key-count').value); renderKeyboard(); updateRangeWarning(); });
$('typing-octave').addEventListener('change', () => { pausePlayback(); state.octave = Number($('typing-octave').value); renderKeyboard(); });
$('tempo').addEventListener('change', () => {
  const bpm = Number($('tempo').value);
  if (!Number.isFinite(bpm) || bpm < 20 || bpm > 300) { notice('Choose a tempo from 20 to 300 BPM.', true); $('tempo').value = String(state.score?.tempo[0]?.bpm || 100); return; }
  if (state.score) compileScore(transposeTempo(state.score, bpm), true);
});
for (const mode of ['staff', 'jianpu']) $(mode + '-button').addEventListener('click', () => { state.notation = mode; ['staff', 'jianpu'].forEach(m => { $(m + '-button').classList.toggle('selected', m === mode); $(m + '-button').setAttribute('aria-pressed', String(m === mode)); }); renderScore(); });
$('sound-button').addEventListener('click', () => { synth.muted = !synth.muted; if (synth.muted) synth.silence(); $('sound-button').textContent = synth.muted ? 'Sound off ♫' : 'Sound on ♫'; $('sound-button').setAttribute('aria-pressed', String(synth.muted)); });
$('import-button').addEventListener('click', () => $('score-file').click());
$('mobile-import-button').addEventListener('click', () => $('score-file').click());
$('score-file').addEventListener('change', async event => {
  const file = event.target.files[0]; event.target.value = ''; if (!file) return;
  if (file.size > 8 * 1024 * 1024) { notice('This score is too large. Choose a score JSON smaller than 8 MiB.', true); return; }
  try {
    const content = await file.text();
    if (/\.(musicxml|xml)$/i.test(file.name)) {
      pausePlayback();
      const response = await fetch('/api/import/musicxml', {method: 'POST', headers: {'Content-Type': 'application/xml'}, body: content});
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'MusicXML import failed.');
      await compileScore(result.score);
      if (Array.isArray(result.diagnostics) && result.diagnostics.length) notice(result.diagnostics.map(d => d.message).join(' '));
    } else { const score = JSON.parse(content); await compileScore(score); }
  }
  catch (error) { notice(`Could not read “${file.name}”. Choose a valid score JSON or an uncompressed .musicxml/.xml file. ${error.message}`, true); }
});
$('export-button').addEventListener('click', () => { if (!state.score) return; const blob = new Blob([JSON.stringify(state.score, null, 2)], {type: 'application/json'}); const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = `${state.score.id.replace(/[^\w.-]/g, '_')}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); });
connectPlayable($('keyboard')); connectPlayable($('fretboard'));
document.addEventListener('keydown', event => {
  if (event.defaultPrevented || event.repeat || event.ctrlKey || event.metaKey || event.altKey || /^(INPUT|SELECT|TEXTAREA)$/.test(event.target.tagName) || event.target.isContentEditable) return;
  if (event.code === 'Space') { if (event.target.tagName === 'BUTTON') return; event.preventDefault(); togglePlayback(); return; }
  const key = event.key.toLowerCase();
  if (Object.hasOwn(SHORTCUTS, key)) { event.preventDefault(); pressNote(`key:${event.code}`, (state.octave + 1) * 12 + SHORTCUTS[key]); }
});
document.addEventListener('keyup', event => releaseNote(`key:${event.code}`));
window.addEventListener('blur', () => pausePlayback('Paused when focus moved · 已暂停'));
document.addEventListener('visibilitychange', () => { if (document.hidden) pausePlayback('Paused in background · 已暂停'); });
window.addEventListener('pagehide', () => { pausePlayback(); cancelAnimationFrame(state.frame); });
window.addEventListener('resize', drawFrame);

async function loadCatalog() {
  try { state.catalog = await api('/api/catalog'); if (!Array.isArray(state.catalog) || !state.catalog.length) throw new Error('No original exercises are available. Import a score JSON or restart the server.'); renderCatalog(); await compileScore(structuredClone(state.catalog[0])); }
  catch (error) { $('catalog').replaceChildren(); const retry = document.createElement('button'); retry.className = 'button secondary'; retry.textContent = 'Retry exercise library'; retry.addEventListener('click', loadCatalog); $('catalog').append(retry); notice(`Could not load the exercise library. ${error.message}`, true); }
}
setupImageReview({compileScore, pausePlayback, notice});
setupMidi({pressNote, releaseNote, silenceHeld, notice});
renderKeyboard(); renderFretboard(); updateButtons(); requestAnimationFrame(animate); loadCatalog();

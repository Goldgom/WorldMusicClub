import {setupSourceArchiveView} from './source-archive-view.js';
import {setupGameShell} from './game-shell.js';
import {ScorePreview,filterCatalog,stageShortcutAllowed} from './score-preview.js';
import {prepareScoreDownload} from './score-download.js';
import {validateCatalogIndex,CatalogScoreCache,fetchCatalogScore} from './catalog-loader.js';
import {setupNotationFollowing} from './notation-follow.js';
import {setupExternalOmrReview} from './external-omr-view.js';
import {setupAdaptationView} from './adaptation-view.js';
import {setupSourceDirectory,unsupportedImportHint} from './score-sources.js';
import {setupMetronome} from './metronome.js';
import {setupJianpuExport} from './jianpu-export.js';
import {setupScoreLibrary} from './library-view.js';
import {validateTargetPlan, mappedSourceIds} from './physical-targets.js';
import {PracticeRecorder} from './practice-recorder.js';
import {setupEngravedView} from './engraved-view.js';
import {setupJianpuEditor} from './jianpu-editor.js';
import {feedbackView,pitchBreakdownView} from './feedback-view.js';
import {STANDARD_TUNING, guitarProfile, pianoProfile, compatibilityStatus} from './instrument-profile.js';
import {validLatency, readLatencyPreference, saveLatency, parseBeatInput, practiceScope, windowNotes} from './practice-settings.js';
import {setupMidi, normalizeEventTime} from './midi.js';
import {setupImageReview} from './image-review.js';
import {setupThemes} from './themes.js';
import {PIANO_RANGES, SHORTCUTS, beat, midiName, keyboardGeometry, transposeTempo, fretPositions, scoreSummary, catalogOriginLabel, renderNotation, notationPageCount, notationLayout, keyAt, keyTonic} from './music.js';
import {Transport, Synth, TimelineIndex} from './transport.js';
import {formatTime} from './music.js';

const $ = id => document.getElementById(id);
setupThemes();
const transport = new Transport();
const synth = new Synth();
let metronome = null;
let adaptationView = null;
let externalOmrView = null;
let notationFollowing = null;
let sourceArchiveView=null;
let shell=null,preview=null,startingPreview=false,previewRefreshQueued=false,startRequest=0,enteringPreview=false;
const catalogCache=new CatalogScoreCache();
const latencyPreference=readLatencyPreference();
let catalogIndexController=null,catalogIndexRequest=0,catalogIndexFailed=false;
const state = {catalog: [], score: null, compiled: null, importDiagnostics: [], mode: 'listen', practicePart: null, practiceTimeline: null, sourceTargetTimeline: null, practicePlan: null, targetGroups: new Map(), physicalIndex: null, targetTimeline: null, practiceIndex: null, practiceVersion: 0, instrument: 'piano', notation: 'staff', engravingActive: false, numberedMode: 'fixed', latency: latencyPreference.value, loop: null, loopIteration: 1, loopRequest: 0, loopPending: false, notationPage: 0, notationSpan: 16, notationPart: null, timelineIndex: null, sourceNotes: new Map(), keys: 61, lowestMidi: null, customKeys: false, guitar: {tuning: [...STANDARD_TUNING], frets: 12, capo: 0}, instrumentRequest: 0, profileDirty: false, compatibility: {status:'pending',reason:'Waiting for an instrument compatibility check.'}, instrumentOutOfRange: null, instrumentConflict: false, octave: 4, inputs: [], recorder: null, assessmentBusy: false, held: new Map(), geometry: keyboardGeometry(61), generation: 0, loadIntent: 0, compileController: null, frame: 0, lastHighlight: '', finishing: false, playTicket: 0, noticeTimer: null, audioLimitWarned: false};

state.recorder = new PracticeRecorder({latencyMs:state.latency});
shell=setupGameShell({pausePlayback,onPanel:()=>cancelPendingStart(),onScreen:()=>{if(!enteringPreview)cancelPendingStart();engravedView.surfaceChanged();drawFrame()},onNotation:visible=>{if(!visible)notationFollowing?.suspend('Following suspended while the notation dock is closed.');engravedView.surfaceChanged();requestAnimationFrame(()=>{renderNotationPage();drawFrame()})}});
preview=new ScorePreview({compile:(score,signal)=>api('/api/compile',score,signal),check:checkPreview,onChange:()=>{renderPreview();renderCatalog()}});

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
  state.finishing = state.recorder.pending || state.assessmentBusy;
  const activePass = state.recorder.active;
  const checkingCurrent = Boolean(activePass && (activePass.manualDeadline !== null || activePass.inFlight || (activePass.closedWall !== null && activePass.assessedRevision < activePass.revision && !activePass.error)));
  const allowed = state.mode !== 'practice' || state.compatibility.status === 'ready';
  $('play-button').disabled = !ready || (!transport.running && (!allowed || checkingCurrent));
  $('reset-button').disabled = !ready;
  $('export-takes').disabled = state.recorder.passes.length === 0;
  $('retry-assessments').hidden = !state.recorder.passes.some(pass=>pass.error);
  $('export-button').disabled = !state.score;
  $('export-jianpu').disabled = !state.score;
  $('loop-apply').disabled = !ready;
  $('assess-button').disabled = !ready || state.mode !== 'practice' || checkingCurrent || !allowed;
  $('practice-gate').hidden = state.mode !== 'practice' || state.compatibility.status === 'ready';
  $('practice-gate-reason').textContent = state.compatibility.reason;
  $('practice-gate-retry').disabled = !ready || state.compatibility.status === 'pending';
  $('play-button').textContent = transport.running ? 'Ⅱ Pause · 暂停' : transport.completed ? '↻ Play again · 重来' : '▶ Play · 播放';
  shell?.update({score:state.score,mode:state.mode,part:state.score?.parts.find(part=>part.id===state.practicePart)?.name,compatibility:state.compatibility,passes:state.recorder.passes.length});
}
function silenceHeld() {
  state.held.clear();
  synth.silence();
  document.querySelectorAll('.pressed').forEach(el => el.classList.remove('pressed'));
}
function pausePlayback(reason = 'Paused · 已暂停') {
  state.playTicket++;
  const pauseTime = performance.now(); advanceLoopClock(pauseTime); state.recorder.pause(pauseTime);
  if (transport.running) { transport.pause(pauseTime); $('transport-status').textContent = reason; }
  silenceHeld();metronome?.pause();
  updateButtons();
  drawFrame();
}
function resetPlayback() {
  pausePlayback();
  transport.reset();
  if (state.loop) transport.seek(state.loop.start_ms);
  state.loopIteration = 1;metronome?.reset();
  if (state.loopPending && !state.loop) $('loop-status').textContent = 'Loop validation cancelled. Set loop to check the range again.';
  state.loopPending = false;
  state.loopRequest++; $('loop-enabled').checked = Boolean(state.loop);
  state.inputs = []; state.recorder = new PracticeRecorder({latencyMs:state.latency}); state.assessmentBusy = false;
  $('feedback-pass').value = ''; refreshPassHistory();
  state.generation++;
  state.finishing = false;
  state.audioLimitWarned = false; synth.droppedVoices = 0;
  state.lastHighlight = '';
  $('feedback-results').hidden = true;
  $('transport-status').textContent = 'Ready when you are';
  $('feedback-description').textContent = state.mode === 'practice' ? 'Play along using the on-screen keys or your computer keyboard. Your note-on timing is measured locally.' : 'Switch to Practice mode, play along, then see your timing and pitch feedback.';
  updateButtons(); drawFrame();
}
async function compileScore(score, preserveTempo = false, expectedIntent = null, importDiagnostics = [], requestedPracticePart = undefined, requestedMode = undefined) {
  if (preserveTempo) importDiagnostics = state.importDiagnostics;
  if (expectedIntent !== null && expectedIntent !== state.loadIntent) return false;
  if (expectedIntent === null) {state.loadIntent++;cancelCatalogSelection();}
  if (new TextEncoder().encode(JSON.stringify(score)).byteLength > 8 * 1024 * 1024) { notice('This score exceeds 8 MiB. Reduce its source image or split it into smaller fragments.', true); return false; }
  pausePlayback();
  state.compileController?.abort();
  const controller = new AbortController();
  state.compileController = controller;
  const generation = ++state.generation;
  state.finishing = false;
  $('play-button').disabled = true;
  $('transport-status').textContent = 'Preparing score…';
  try {
    const compiled = await api('/api/compile', score, controller.signal);
    if (generation !== state.generation || controller.signal.aborted || expectedIntent!==null&&expectedIntent!==state.loadIntent) return;
    const previousPart = requestedPracticePart !== undefined ? requestedPracticePart : preserveTempo ? state.practicePart : null;
    state.score = compiled.score;
    if(requestedMode!==undefined){state.mode=requestedMode;$('session-mode').value=requestedMode;}
    state.importDiagnostics = importDiagnostics;
    const diagnostics = [...new Map([...compiled.diagnostics, ...importDiagnostics].map(item => [`${item.code}:${item.note_id || ''}:${item.message}`, item])).values()];
    state.compiled = {...compiled, diagnostics, timeline: {...compiled.timeline, notes: [...compiled.timeline.notes].sort((a, b) => a.start_ms - b.start_ms || a.midi - b.midi)}};
    state.instrumentOutOfRange = null; state.instrumentConflict = false;
    state.timelineIndex = new TimelineIndex(state.compiled.timeline.notes);
    metronome?.cancelForScore();
    state.sourceNotes = new Map(state.score.parts.flatMap(part => part.notes.map(note => [note.id, {note, partId: part.id}])));
    state.loop = null; state.loopRequest++; state.practicePart = previousPart !== null && state.score.parts.some(part => part.id === previousPart) ? previousPart : null; rebuildPracticeScope(); $('loop-enabled').checked = false; $('loop-status').textContent = 'Loop cleared. Choose A and B, then Set loop. Beats start at 0; B is exclusive.';
    state.notationPage = 0; state.notationPart = state.practicePart || state.score.parts[0].id;
    if (!preserveTempo) $('tempo').value = String(compiled.score.tempo[0]?.bpm || 100);
    clearNotice();
    resetPlayback();
    renderScore(); notationFollowing?.scoreChanged(); sourceArchiveView?.scoreChanged(); libraryView.scoreChanged(); adaptationView?.scoreChanged(); renderCatalog(); updateRangeWarning();
    $('catalog-status').textContent=`Current session: ${state.score.title}. Browsing a preview keeps this take intact.`;
    const clockScore=state.score;await checkInstrument();if(state.score===clockScore){metronome?.setScore();preview.adopt(state.compiled,state.compatibility,state.practicePart);}
    return state.score===clockScore&&(expectedIntent===null||expectedIntent===state.loadIntent);
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
  const catalog=$('catalog');
  $('catalog-count').textContent=String(state.catalog.length);
  const filtered=filterCatalog(state.catalog,$('catalog-search').value,$('catalog-origin').value),wanted=new Set(filtered.map(score=>score.id));
  for(const child of [...catalog.children])if(!child.classList.contains('catalog-item')||!wanted.has(child.dataset.scoreId))child.remove();
  const existing=new Map([...catalog.children].map(button=>[button.dataset.scoreId,button]));
  filtered.forEach((score,index)=>{
    let button=existing.get(score.id);
    if(!button){
      button=document.createElement('button');button.className='catalog-item';button.dataset.scoreId=score.id;
      const number=document.createElement('span');number.className='number';const label=document.createElement('span');label.append(document.createElement('strong'),document.createElement('small'));button.append(number,label);
      button.addEventListener('click',()=>selectCatalogScore(score.id));
    }
    const selected=preview?.value.identity===score.id,loading=preview?.value.status==='loading'&&selected;
    button.classList.toggle('selected',selected);button.setAttribute('aria-pressed',String(selected));button.setAttribute('aria-busy',String(loading));button.classList.toggle('loading',loading);
    button.querySelector('.number').textContent=String(index+1).padStart(2,'0');button.querySelector('strong').textContent=score.title;
    button.querySelector('small').textContent=`${score.written_event_count} written events · ${score.opening_bpm} BPM · ${catalogOriginLabel(score)}${loading?' · Loading…':''}`;
    // Unchanged entries stay attached, retaining focus while preview/tempo work resolves.
    if(catalog.children[index]!==button)catalog.insertBefore(button,catalog.children[index]||null);
  });
  if(!filtered.length&&state.catalog.length){const empty=document.createElement('p');empty.className='catalog-empty';empty.textContent='No matching title or composer. Clear the search or change the edition filter.';catalog.append(empty)}
  if(catalogIndexFailed){const retry=document.createElement('button');retry.className='button secondary';retry.textContent='Retry catalog index';retry.disabled=Boolean(catalogIndexController);retry.addEventListener('click',loadCatalog);catalog.append(retry)}
}
function renderScore() {
  if (!state.score) return;
  const score = state.score;
  const summary = scoreSummary(score,state.compiled.timeline);
  $('score-title').textContent = score.title;
  $('score-meta').textContent = `${score.composer || 'Composer not specified'} · Full score: ${summary.writtenCount} written events · ${summary.playbackCount} playback note events · ${summary.measures} measures · ${summary.parts} part${summary.parts === 1 ? '' : 's'}`;
  $('score-origin-label').textContent=catalogOriginLabel(score);
  $('score-details-button').textContent=`Source, credits & limitations${state.compiled.diagnostics.length?` · ${state.compiled.diagnostics.length} notice${state.compiled.diagnostics.length===1?'':'s'}`:''} · 来源说明`;
  $('score-retention-note').textContent=`Written events: ${summary.count} pitched note segments + ${summary.rests} rests. Ties can join segments; repeats can create additional playback events. ${score.provenance.kind==='curated_cc0_edition'?'This complete source edition retains its written notes/rests; some expressive or visual instructions may be source-only.':'Event counts do not certify expressive playback.'} Review the source notices; onset-only practice targets are a separate count.`;
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
  engravedView.updateScore();
  updateButtons();
  drawFrame();
}
function rebuildPracticeScope() {
  if (!state.compiled) return;
  const scope = practiceScope(state.compiled.timeline, state.practicePart, state.loop);
  state.practiceTimeline = scope.selected; state.sourceTargetTimeline = scope.targets; state.targetTimeline = null; state.practicePlan = null; state.targetGroups = new Map(); state.physicalIndex = null;
  state.practiceIndex = new TimelineIndex(scope.selected.notes); state.practiceVersion++;
  state.instrumentOutOfRange = null; state.instrumentConflict = false;
  state.compatibility = {status:'pending',reason:'Checking the selected targets against your instrument setup…'};
  if (state.loop) { state.loop.notes = scope.playbackNotes; state.loop.index = new TimelineIndex(scope.playbackNotes); state.loop.targetIds = scope.targetIds; updateLoopStatus(); }
  updatePracticeScopeLabel();
}
function updatePracticeScopeLabel() {
  if (!state.score) return;
  const name = state.practicePart === null ? 'All parts · 所有声部' : state.score.parts.find(part => part.id === state.practicePart)?.name || state.practicePart;
  const plan=state.practicePlan;
  $('practice-scope').textContent = plan ? `${name} · ${plan.target_count} physical attacks from ${plan.source_note_count} sounding events${state.loop?' in A–B':''}` : `${name} · ${state.sourceTargetTimeline?.notes.length || 0} source events · physical targets pending`;
  $('physical-target-note').textContent = !plan ? 'Rust prepares physical targets after part, loop and instrument selection. Listening and score export preserve the sounding source events.' : state.instrument==='piano' ? 'Exact same-time, same-pitch piano voices share one attack. The block uses the longest duration; separate voice releases and sustain are not scored.' : 'Guitar targets keep distinct source events. Pitch-only input cannot identify strings; fingering, same-pitch string choice and sustain require review.';

}
function updateLoopStatus() {
  if (!state.loop) return;
  const loop = state.loop;
  $('loop-status').textContent = `Loop A–B ready · ${formatTime(loop.start_ms)}–${formatTime(loop.end_ms)} · ${loop.targetIds.size} selected source onset events. ${loop.crossing_notes ? `${loop.crossing_notes} sustained notes in the full score cross a boundary; only selected note-ons inside A–B are scored. ` : ''}${(loop.diagnostics || []).map(d => d.message).join(' ')}`;
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
  if (!state.engravingActive) $('score-key').textContent = state.notation === 'jianpu' && state.numberedMode === 'movable' ? (tonic ? `1 = ${tonic.name}${tonic.octave} · tonic-based numbering (minor too)` : 'Unknown key mode: fixed C display') : `${state.score.meters[0]?.numerator || 4}/${state.score.meters[0]?.denominator || 4} time · 1 = C4 display`;
  $('notation-page').textContent = `Page ${state.notationPage + 1} / ${count}`;
  $('notation-prev').disabled = state.notationPage <= 0;
  $('notation-next').disabled = state.notationPage >= count - 1;
  state.lastHighlight = '';
}
function updateRangeWarning() {
  if (!state.compiled) return;
  const [min, max] = state.instrument === 'guitar' ? [Math.min(...state.guitar.tuning) + state.guitar.capo, Math.max(...state.guitar.tuning) + state.guitar.frets] : [state.geometry[0].midi, state.geometry.at(-1).midi];
  const outside = state.instrumentOutOfRange ?? (state.sourceTargetTimeline?.notes || state.compiled.timeline.notes).filter(n => n.midi < min || n.midi > max).length;
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
  if (!state.compiled) {
    if(apply){state.profileDirty=false;if(profile.kind==='piano'){state.keys=profile.key_count;state.lowestMidi=profile.lowest_midi;state.customKeys=true;renderKeyboard()}else{state.guitar={tuning:profile.tuning,frets:profile.frets,capo:profile.capo};renderFretboard()}refreshPreview();}
    return;
  }
  if (state.profileDirty && !apply) { state.compatibility = {status:'dirty',reason:'Instrument settings were edited. Apply and validate the setup before practicing.'}; updateButtons(); return; }
  if (state.mode === 'practice' && transport.running) pausePlayback();
  state.practicePlan=null;state.targetGroups=new Map();state.targetTimeline=null;state.physicalIndex=null;updatePracticeScopeLabel();renderTargetMappings();
  state.compatibility = {status:'pending',reason:'Preparing physical attack targets and checking every selected source note with Rust…'}; updateButtons();
  const request = ++state.instrumentRequest; const compiled = state.compiled; const selection = state.practiceVersion; const sourceTargets=state.sourceTargetTimeline||compiled.timeline;
  state.instrumentOutOfRange = null; state.instrumentConflict = false;
  $('instrument-report').textContent = 'Checking note range and pitch-compatible positions with Rust…';
  try {
    const plan = validateTargetPlan(await api('/api/practice-targets',{timeline:sourceTargets,profile}),sourceTargets);
    if(request!==state.instrumentRequest||compiled!==state.compiled||selection!==state.practiceVersion)return;
    const report = await api('/api/instrument-check', {timeline:sourceTargets, profile});
    if (request !== state.instrumentRequest || compiled !== state.compiled || selection !== state.practiceVersion) return;
    if (apply) {
      state.profileDirty = false;
      resetPlayback();
      if (profile.kind === 'piano') { state.keys = profile.key_count; state.lowestMidi = profile.lowest_midi; state.customKeys = true; $('key-count').value = 'custom'; renderKeyboard(); }
      else { state.guitar = {tuning:profile.tuning, frets:profile.frets, capo:profile.capo}; renderFretboard(); }
      updateRangeWarning();
      refreshPreview();
    }
    state.practicePlan=plan;state.targetTimeline=plan.timeline;state.targetGroups=new Map(plan.groups.map(group=>[group.target_id,group]));
    state.physicalIndex=new TimelineIndex(state.loop?windowNotes(plan.timeline.notes,state.loop.start_ms,state.loop.end_ms):plan.timeline.notes);
    state.compatibility = compatibilityStatus(report, sourceTargets.notes);
    if(!plan.playable&&state.compatibility.status==='ready')state.compatibility={status:'blocked',reason:'Rust marked the selected physical target plan as unplayable. Review its diagnostics or choose another setup.'};
    updatePracticeScopeLabel();renderTargetMappings();
    const outside = report.note_options.filter(note => !note.playable).length;
    state.instrumentOutOfRange = outside; state.instrumentConflict = report.diagnostics.some(d => d.code === 'guitar_string_conflict'); updateRangeWarning();
    $('instrument-report').textContent = `${midiName(report.lowest_midi)}–${midiName(report.highest_midi)} · ${outside} notes outside playable range · original pitches preserved`;
    $('instrument-diagnostics').replaceChildren();
    const diagnostics=[...new Map([...report.diagnostics,...plan.diagnostics].map(item=>[`${item.code}:${item.message}`,item])).values()];
    for (const diagnostic of diagnostics) { const li = document.createElement('li'); li.textContent = diagnostic.message; $('instrument-diagnostics').append(li); }
    $('instrument-settings').classList.toggle('has-warnings', diagnostics.some(d => !['guitar_fingering_advisory','guitar_pitch_only_targets'].includes(d.code)));
  } catch (error) { if (request === state.instrumentRequest) { state.compatibility = {status:'error',reason:`Compatibility could not be verified: ${error.message}`}; $('instrument-report').textContent = `Instrument setup not verified: ${error.message}`; } }
  finally { if (request === state.instrumentRequest) updateButtons(); }
}
function renderTargetMappings() {
  $('target-group-list').replaceChildren();
  const mapped=state.practicePlan?.groups.filter(group=>group.source_occurrence_ids.length>1||group.source_note_ids.length>1)||[];
  $('target-mapping-summary').textContent=state.practicePlan ? `Physical target source mapping · ${mapped.length} grouped / tied targets` : 'Physical target source mapping · pending verification';
  const targets=new Map((state.practicePlan?.timeline.notes||[]).map(note=>[note.id,note]));
  for(const group of mapped.slice(0,100)){const note=targets.get(group.target_id);const item=document.createElement('li');item.textContent=`${midiName(note.midi)} at ${(note.start_ms/1000).toFixed(3)}s: ${group.source_occurrence_ids.length} sounding events; source notes ${group.source_note_ids.join(', ')}; parts ${group.part_ids.join(', ')}`;$('target-group-list').append(item)}
  $('target-mapping-limit').textContent=!state.practicePlan?'Verify the current part, loop and instrument selection to view its mapping.':mapped.length>100?'Showing the first 100 mappings. The complete physical plan is included in Export take data.':'All mapped occurrences and tied source-note IDs are retained. Canonical score export is unchanged.';
}
function syncProfileFields() {
  $('custom-key-count').value=String(state.keys); $('custom-lowest').value=midiName(state.geometry[0].midi).replace('♯','#');
  $('guitar-tuning').value=state.guitar.tuning.map(midiName).join(' ').replaceAll('♯','#'); $('guitar-frets').value=String(state.guitar.frets); $('guitar-capo').value=String(state.guitar.capo);
}
function markProfileDirty() {
  state.profileDirty=true; state.instrumentRequest++;
  state.practicePlan=null;state.targetTimeline=null;state.physicalIndex=null;state.targetGroups=new Map();updatePracticeScopeLabel();renderTargetMappings();
  state.compatibility={status:'dirty',reason:'Instrument settings were edited. Apply and validate the setup before practicing.'};
  resetPlayback();
  $('instrument-report').textContent=state.compatibility.reason; updateButtons();
}
for(const id of ['custom-key-count','custom-lowest','guitar-tuning','guitar-frets','guitar-capo'])$(id).addEventListener('input',markProfileDirty);
$('score-details-button').addEventListener('click',()=>{const details=$('score-details');details.open=true;$('score-details-button').setAttribute('aria-expanded','true');details.querySelector('summary').focus({preventScroll:true});details.scrollIntoView({block:'start',behavior:'auto'})});
$('score-details').addEventListener('toggle',()=>{$('score-details-button').setAttribute('aria-expanded',String($('score-details').open))});
$('practice-gate-retry').addEventListener('click',()=>{if(state.profileDirty)$('instrument-apply').click();else checkInstrument()});
$('instrument-apply').addEventListener('click', () => {
  try { const profile = state.instrument === 'guitar' ? guitarProfile($('guitar-tuning').value, $('guitar-frets').value, $('guitar-capo').value) : pianoProfile($('custom-key-count').value, $('custom-lowest').value); checkInstrument(profile, true); }
  catch (error) { state.compatibility = {status:'error',reason:error.message}; $('instrument-report').textContent = error.message; updateButtons(); }
});
async function pressNote(source, midi, velocity = 90, eventTime = null, options = {}) {
  if (state.held.has(source) && !options.retrigger) return;
  const receivedWall = performance.now();
  advanceLoopClock(receivedWall);
  const captureTime = normalizeEventTime(eventTime,{now:receivedWall,timeOrigin:performance.timeOrigin});
  if (state.mode === 'practice' && state.compatibility.status === 'ready') {
    const captured = state.recorder.capture({midi,eventWall:captureTime,receivedWall,velocity});
    if (captured?.unassigned) {
      refreshPassHistory();
      $('feedback-description').textContent=`${state.recorder.unassignedCaptures.length} input events retained from an interrupted loop gap. They are unscored and included in Export take data.`;
    } else if (captured) {
      state.inputs = state.recorder.active?.inputs || [];
      $('feedback-description').textContent = captured.pass === state.recorder.active ? `${captured.pass.inputs.length} note-on events recorded in ${captured.pass.label} · 已记录 ${captured.pass.inputs.length} 个音` : `Delayed input retained for ${captured.pass.label}; its feedback will be updated.`;
      if(captured.pass.boundaryReviews.length)displayChosenPass();
      drainAssessments();
    }
  }
  if(document.hidden||shell.screen()!=='stage'||document.querySelector('dialog[open]'))return;
  state.held.set(source,midi);
  highlightKeys();
  try { await synth.unlock(); if (state.held.get(source) === midi) synth.play(`manual:${source}`, midi, null, 0, state.instrument, velocity); }
  catch (error) { notice(error.message, true); }
}
function releaseMatching(prefix) { for(const source of [...state.held.keys()]) if(source.startsWith(prefix)) releaseNote(source); }
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
    pressNote(`pointer:${event.pointerId}`, Number(key.dataset.midi), 90, event.timeStamp);
  });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) container.addEventListener(type, event => releaseNote(`pointer:${event.pointerId}`));
  container.addEventListener('keydown', event => {
    if ((event.key === 'Enter' || event.key === ' ') && !event.repeat && event.target.dataset.midi) { event.preventDefault(); event.stopPropagation(); pressNote('accessible-key', Number(event.target.dataset.midi), 90, event.timeStamp); }
  });
  container.addEventListener('focusout', () => releaseNote('accessible-key'));
  container.addEventListener('keyup', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); releaseNote('accessible-key'); } });
}
async function togglePlayback() {
  if (!state.compiled) return;
  if (transport.running) { pausePlayback(); return; }
  if (state.mode === 'practice' && state.compatibility.status !== 'ready') { notice(state.compatibility.reason, true); return; }
  const waiting=state.recorder.active;
  if(waiting&&(waiting.manualDeadline!==null||waiting.inFlight||(transport.completed&&state.recorder.pending))){notice('Receiving delayed input or checking this take. You can export the session while it finishes.');return}
  const generation = state.generation;
  const ticket = ++state.playTicket;
  try { await synth.unlock(); } catch (error) { notice(error.message, true); return; }
  if (generation !== state.generation || ticket !== state.playTicket || transport.running || !state.compiled || (state.mode === 'practice' && state.compatibility.status !== 'ready')) return;
  if (transport.completed) { if(state.mode==='practice') { transport.reset(); if(state.loop)transport.seek(state.loop.start_ms); state.lastHighlight=''; } else resetPlayback(); }
  const beatMs = 60000 / (Number($('tempo').value) || 100);
  const now = performance.now();
  transport.start(now, state.loop?.notes || state.practiceTimeline?.notes || state.compiled.timeline.notes, $('count-in').checked ? beatMs * 4 : 0);
  if(state.mode==='practice')beginPracticePass(now);
  updateButtons();
}
function beginPracticePass(now, captureEnabled = true) {
  const recorder=state.recorder;let pass=recorder.active;
  if(pass&&pass.closedWall===null&&pass.captureEnabled&&captureEnabled) recorder.resume(now,transport.position);
  else pass=recorder.begin({wallTime:now,position:transport.position,startMs:state.loop?.start_ms||0,endMs:state.loop?.end_ms||state.compiled.timeline.duration_ms,timeline:state.targetTimeline,label:state.loop?`Loop ${state.loopIteration}`:`Take ${recorder.passes.length+1}`,captureEnabled});
  state.inputs=pass.inputs;refreshPassHistory();displayChosenPass();return pass;
}
function showPassAssessment(pass) {
  if(!pass?.assessment){$('feedback-results').hidden=true;return}
  const assessment=pass.assessment;
    $('feedback-results').hidden = false;
    const view = feedbackView(assessment, pass.timeline.notes.length);
    $('accuracy').textContent = view.accuracy + (pass.boundaryReviews.length && view.accuracy !== '—' ? '*' : '');
    $('hits').textContent = view.hits;
    $('misses').textContent = view.misses;
    $('timing').textContent = view.meanError;
    $('coverage').textContent = view.coverage;
    $('timing-bias').textContent = view.bias;
    $('timing-spread').textContent = view.spread;
    $('feedback-advice').replaceChildren();
    for (const advice of view.advice) { const item = document.createElement('li'); item.textContent = advice.message; item.className = advice.severity === 'warning' ? 'warning' : 'info'; $('feedback-advice').append(item); }
    if(state.recorder.interruptions.some(gap=>gap.from_wall_ms===pass.closedWall)){const warning=document.createElement('li');warning.className='warning';warning.textContent='A clock interruption followed this take. Skipped loop cycles were not graded or created as takes; unassigned gap events are preserved in the session export.';$('feedback-advice').append(warning)}
    if(pass.boundaryReviews.length){const warning=document.createElement('li');warning.className='warning';warning.textContent='* Boundary review: some onsets are eligible near an adjacent pass. These provisional scores use deterministic corrected-clock ownership; continuous cross-pass matching has not been evaluated. All events are retained in the take-data export.';$('feedback-advice').append(warning)}
    const pitches=pitchBreakdownView(assessment,pass.timeline.notes.length);
    $('pitch-breakdown-status').textContent=pitches.message;$('pitch-breakdown-table').hidden=!pitches.available||!pitches.rows.length;$('pitch-breakdown-region').hidden=!pitches.available||!pitches.rows.length;$('pitch-breakdown-body').replaceChildren();
    $('pitch-breakdown-summary').textContent=`By pitch · 单音反馈${pitches.available?` · ${pitches.rows.length} pitches`:''}`;
    for(const row of pitches.rows){const tr=document.createElement('tr');tr.dataset.pitchMidi=String(row.midi);const heading=document.createElement('th');heading.scope='row';heading.textContent=`${midiName(row.midi)} · ${row.midi}`;tr.append(heading);for(const value of [row.expected,row.matched,row.missed,row.extra,row.meanError,row.bias,row.sample]){const cell=document.createElement('td');cell.textContent=String(value);tr.append(cell)}$('pitch-breakdown-body').append(tr)}
    $('pitch-breakdown-note').textContent=`Missed targets and extra inputs are independent unmatched attacks; they do not identify a proven wrong-note substitution. Rows share MIDI pitch (C4 = 60), including enharmonic spellings and guitar strings. Timing averages use matched attacks only, with your ${state.recorder.latencyMs} ms manual offset already applied. Fewer than five matches per pitch is a small sample; device/audio latency can resemble early or late playing. Duration, pedal and fingering are not scored.`;
    $('feedback-calibration-note').textContent = `${view.hasSummary ? 'Rust-derived timing statistics.' : 'Timing bias and variability are unavailable in this server response.'} Your ${state.recorder.latencyMs} ms manual offset is already applied. Device/audio latency can resemble consistent early or late playing; use repeated takes before adjusting calibration. Accuracy includes extra inputs; coverage counts matched expected note-ons.`;
    $('feedback-detail').textContent = `${assessment.hits.filter(h => h.grade === 'perfect').length} perfect · ${assessment.hits.filter(h => h.grade === 'good').length} good · ${assessment.hits.filter(h => h.grade === 'early').length} early · ${assessment.hits.filter(h => h.grade === 'late').length} late. Matching window: ±180 ms. Input offset: ${state.recorder.latencyMs} ms. Browser/audio latency can affect your result.`;
    $('feedback-description').textContent = `${pass.label}${pass.boundaryReviews.length?' (boundary review)':''}: ` + (view.expected === 0 ? 'No note-on targets were selected. Choose a range containing notes.' : assessment.hits.length ? 'A useful snapshot, not a verdict. Slow the tempo and try another take.' : 'No notes matched yet. Try a slower tempo and the four-beat count-in.');
}
function refreshPassHistory() {
  const selected=$('feedback-pass').value;
  $('feedback-pass').replaceChildren();const latest=document.createElement('option');latest.value='';latest.textContent='Latest completed · 最新结果';$('feedback-pass').append(latest);
  for(const pass of state.recorder.passes){const option=document.createElement('option');option.value=String(pass.id);option.textContent=`${pass.label}${pass.error?' · retry needed':pass.assessedRevision<pass.revision?' · pending':pass.assessment?(pass.boundaryReviews.length?' · boundary review':' · checked'):''}`;$('feedback-pass').append(option)}
  $('feedback-pass').value=selected;$('take-history').hidden=state.recorder.passes.length===0;
  $('take-interruption-note').hidden=state.recorder.interruptions.length===0;
  $('take-interruption-note').textContent=`${state.recorder.interruptions.length} loop clock interruptions · ${state.recorder.unassignedCaptures.length} unassigned input events preserved for review. Skipped passes are not included in scores. Export take data to keep the clock gaps and every captured event.`;
  $('export-takes').disabled=state.recorder.passes.length===0;
  $('retry-assessments').hidden=!state.recorder.passes.some(pass=>pass.error);
}
function displayChosenPass() {
  const selected=Number($('feedback-pass').value);
  const pass=selected?state.recorder.passes.find(item=>item.id===selected):[...state.recorder.passes].reverse().find(item=>item.assessment);
  if(pass)showPassAssessment(pass);
}
async function drainAssessments() {
  if(state.assessmentBusy)return;
  const recorder=state.recorder;state.assessmentBusy=true;
  try {
    while(recorder===state.recorder){
      const pass=recorder.ready(performance.now())[0];if(!pass)break;
      const job=recorder.submit(pass);updateButtons();refreshPassHistory();
      try{
        const assessment=await api('/api/assess',{timeline:job.timeline,inputs:job.inputs,tolerance_ms:recorder.toleranceMs});
        if(recorder!==state.recorder)return;
        recorder.complete(job,assessment);if(pass===recorder.active&&pass.closedWall===null&&!transport.running)$('transport-status').textContent='Paused · 已暂停';refreshPassHistory();displayChosenPass();
      }catch(error){if(recorder!==state.recorder)return;recorder.fail(job,error.message);notice(`Could not check ${pass.label}. ${error.message} Its inputs are retained; use Retry checks or export the session.`,true);refreshPassHistory()}
    }
  }finally{if(recorder===state.recorder){state.assessmentBusy=false;updateButtons();refreshPassHistory()}}
}
function assess() {
  if(!state.compiled||state.mode!=='practice')return;
  if(state.compatibility.status!=='ready'){notice(state.compatibility.reason,true);return}
  const played=Boolean(state.recorder.active?.captureEnabled);
  pausePlayback();const now=performance.now();if(!state.recorder.active)beginPracticePass(now,false);
  state.recorder.requestAssessment(now,{grace:played});
  $('transport-status').textContent=played?'Receiving delayed input · 等待延迟输入':'Checking take · 正在评分';
  updateButtons();refreshPassHistory();drainAssessments();
}
$('feedback-pass').addEventListener('change',displayChosenPass);
$('retry-assessments').addEventListener('click',()=>{state.recorder.retryFailed();drainAssessments()});
$('export-takes').addEventListener('click',()=>{const data={...state.recorder.exportData(),score_id:state.score?.id,practice_part:state.practicePart,target_plan:state.practicePlan};const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download='worldmusichub-practice-session.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000)});
function advanceLoopClock(now) {
  if(!state.loop||!transport.running)return;
  const beatMs=60000/(Number($('tempo').value)||100);
  const result=transport.wrapLoop(now,state.loop.notes,{start:state.loop.start_ms,end:state.loop.end_ms,countIn:$('count-in').checked?beatMs*4:0});
  if(result.status==='pending')return;
  if(state.mode==='practice')state.recorder.closeAtEnd(result.boundaryWall);
  state.loopIteration++;silenceHeld();
  if(result.status==='stalled'){
    if(state.mode==='practice')state.recorder.recordInterruption({boundaryWall:result.boundaryWall,observedWall:now,skippedPasses:result.skippedPasses});
    $('transport-status').textContent='Paused after a loop clock interruption · 循环中断';
    notice(`The browser clock advanced across ${result.skippedPasses} complete loop cycles before the app could respond. Playback is paused; no missing takes were invented. Existing inputs are retained. Unassigned events from the gap remain unscored in the session export. Press Play to start a fresh loop.`,true);
  }else{
    if(state.mode==='practice')beginPracticePass(result.boundaryWall);
    $('transport-status').textContent=`Loop ${state.loopIteration} · 循环`;
  }
  updateButtons();refreshPassHistory();
}
function drawFrame() {
  const now = performance.now();
  advanceLoopClock(now);
  const position = transport.time(now);
  if (synth.droppedVoices && !state.audioLimitWarned) { state.audioLimitWarned = true; notice('This dense passage exceeded the 64-voice synth preview limit. Some overlapping sounds were cut short; the full score and assessment targets remain unchanged.'); }
  const timeline = state.compiled?.timeline;
  const duration = timeline?.duration_ms || 0;
  const segmentStart = state.loop?.start_ms || 0;
  const playbackNotes = state.loop?.notes || state.practiceTimeline?.notes || timeline?.notes || [];
  const playbackIndex = state.mode==='practice'&&state.physicalIndex ? state.physicalIndex : state.loop?.index || state.practiceIndex || state.timelineIndex;
  if (transport.running && timeline) {
    metronome?.advance({running:true,position,segment:transport.startedAt,startPosition:transport.position});
    for (const note of transport.due(now, playbackNotes)) if (state.mode === 'listen') synth.play(`score:${note.id}:${note.part_id}:${note.start_ms}`, note.midi, note.remaining_ms, note.delay_ms, state.instrument, note.velocity ?? 90);
    if (!state.loop && state.mode==='practice' && position>=duration) {
      const previouslyClosed=state.recorder.active?.closedWall!==null;
      const pass=state.recorder.closeAtEnd(now);
      if(!previouslyClosed){updateButtons();refreshPassHistory()}
      if(pass&&now<pass.deadline)$('transport-status').textContent='Receiving delayed input · 等待延迟输入';
      else{transport.finish(duration);silenceHeld();updateButtons();$('transport-status').textContent='Complete · 已完成'}
    } else if (state.mode==='listen' && position>=duration+80) {transport.finish(duration);silenceHeld();updateButtons();$('transport-status').textContent='Complete · 已完成'}
    else $('transport-status').textContent = position < segmentStart ? `Count in · ${Math.ceil((segmentStart - position) / (60000 / (Number($('tempo').value) || 100)))}` : state.mode === 'practice' ? `Your turn${state.loop ? ` · Loop ${state.loopIteration}` : ''} · 跟着弹` : `Listening${state.loop ? ` · Loop ${state.loopIteration}` : ''} · 正在聆听`;
  }
  if(state.mode==='practice'){
    const pass=state.recorder.active;
    if(!transport.running&&!state.loop&&pass&&pass.closedWall!==null&&pass.deadline!==null&&now>=pass.deadline&&!transport.completed){transport.finish(duration);$('transport-status').textContent='Complete · 已完成';updateButtons()}
    if(state.recorder.ready(now).length)drainAssessments();
  }
  $('progress').max = Math.max(1, duration); $('progress').value = Math.min(duration, Math.max(0, position));
  $('time-label').textContent = `${formatTime(position)} / ${formatTime(duration)}`;
  if(shell.screen()!=='stage')return;
  if(shell.notationVisible())notationFollowing?.tick(position < segmentStart ? -1 : position,transport.running);
  const active = position < segmentStart ? [] : playbackIndex?.range(position) || [];
  if (shell.notationVisible() && !state.engravingActive && transport.running && active.length) {
    const source = active.flatMap(note=>mappedSourceIds(note,state.mode==='practice'?state.targetGroups.get(note.id):null)).map(id=>state.sourceNotes.get(id)).find(item=>item?.partId===state.notationPart);
    const page = source ? Math.floor(beat(source.note.at) / state.notationSpan) : state.notationPage;
    if (page !== state.notationPage) { state.notationPage = page; renderNotationPage(); }
  }
  const signature = active.map(n => n.id).join('|');
  if (signature !== state.lastHighlight) {
    const activeSources=new Set(active.flatMap(note=>mappedSourceIds(note,state.mode==='practice'?state.targetGroups.get(note.id):null)));
    document.querySelectorAll('.score-note').forEach(note => note.classList.toggle('active', activeSources.has(note.dataset.noteId)));
    state.lastHighlight = signature;
    const focused = $('notation').querySelector('.score-note.active');
    if (!state.engravingActive && transport.running && focused) { const box = focused.getBoundingClientRect(); const view = $('notation').getBoundingClientRect(); if (box.left < view.left + 20 || box.right > view.right - 20) $('notation').scrollLeft += box.left - view.left - view.width * 0.35; }
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
  // Equal screen-space guides are decorative, not guessed beats or barlines.
  const windowMs = 4000;
  for(let line=1;line<5;line++){const y=line*height/5;ctx.strokeStyle='#a7c09416';ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(width,y);ctx.stroke();}
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
  const request = ++state.loopRequest; state.loopPending = true;
  const generation = state.generation;
  $('loop-status').textContent = 'Validating loop boundaries with the Rust score clock…';
  $('loop-apply').disabled = true;
  try {
    const from = parseBeatInput($('loop-from').value); const to = parseBeatInput($('loop-to').value);
    if (beat(to) <= beat(from)) throw new Error('B must be later than A.');
    const window = await api('/api/practice-window', {score: state.score, from, to});
    if (request !== state.loopRequest || generation !== state.generation) return;
    if (window.end_ms - window.start_ms < 250) throw new Error('Choose a loop at least 250 ms long so playback and feedback can remain usable.');
    state.loopPending = false;
    state.loop = {...window, notes: [], index: null, targetIds: new Set()};
    rebuildPracticeScope();
    $('loop-enabled').checked = true;
    updateLoopStatus();
    resetPlayback(); checkInstrument();
  } catch (error) { if (request === state.loopRequest) { state.loopPending = false; state.loop = null; rebuildPracticeScope(); checkInstrument(); $('loop-enabled').checked = false; $('loop-status').textContent = `Loop not set: ${error.message}`; resetPlayback(); } }
  finally { if (request === state.loopRequest) updateButtons(); }
}
$('loop-apply').addEventListener('click', applyLoop);
$('loop-enabled').addEventListener('change', () => { if ($('loop-enabled').checked) applyLoop(); else { state.loop = null; state.loopRequest++; rebuildPracticeScope(); resetPlayback(); checkInstrument(); $('loop-status').textContent = 'Loop off. Full-length playback and assessment for the selected part restored.'; } });
for (const id of ['loop-from', 'loop-to']) $(id).addEventListener('input', () => { state.loopRequest++; if (state.loop || $('loop-enabled').checked) { state.loop = null; rebuildPracticeScope(); $('loop-enabled').checked = false; resetPlayback(); checkInstrument(); } $('loop-status').textContent = 'Bounds changed. Set loop to validate the new range.'; });

$('latency-offset').value = String(state.latency);
$('latency-storage-status').textContent=latencyPreference.message;$('latency-storage-status').hidden=!latencyPreference.message;
$('latency-offset').addEventListener('change', () => {
  const value = $('latency-offset').value;
  if (!validLatency(value)) { $('latency-offset').value = String(state.latency); notice('Latency offset must be a whole number from −500 to 500 ms.', true); return; }
  state.latency = Number(value);const saved=saveLatency(state.latency);$('latency-storage-status').textContent=saved?'Latency saved in this browser profile and site.':'Latency applies to this tab but could not be saved in browser storage.';$('latency-storage-status').hidden=false;resetPlayback();
});
$('practice-part').addEventListener('change', () => { state.practicePart = $('practice-part').value || null; rebuildPracticeScope(); resetPlayback(); if (state.practicePart !== null) { state.notationPart = state.practicePart; $('notation-part').value = state.practicePart; renderNotationPage(); } engravedView.selectPart(state.practicePart); updateRangeWarning(); checkInstrument(); });
$('jianpu-reference').addEventListener('change', () => { state.numberedMode = $('jianpu-reference').value; renderNotationPage(); });
$('notation-part').addEventListener('change', () => { state.notationPart = $('notation-part').value; renderNotationPage(); });
$('notation-prev').addEventListener('click', () => { state.notationPage--; renderNotationPage(); });
$('notation-next').addEventListener('click', () => { state.notationPage++; renderNotationPage(); });
$('play-button').addEventListener('click', togglePlayback);
$('reset-button').addEventListener('click', resetPlayback);
$('assess-button').addEventListener('click', () => assess());
$('session-mode').addEventListener('change', () => { state.mode = $('session-mode').value; resetPlayback(); updateRangeWarning(); });
$('instrument').addEventListener('change', () => { resetPlayback(); state.instrument = $('instrument').value; state.profileDirty = false; syncProfileFields(); profileControls(); if (state.instrument === 'guitar') $('instrument-settings').open = true; checkInstrument(); $('piano-stage').hidden = state.instrument !== 'piano'; $('guitar-stage').hidden = state.instrument !== 'guitar'; $('key-count').disabled = state.instrument !== 'piano'; updateRangeWarning(); drawFrame(); });
$('key-count').addEventListener('change', () => { resetPlayback(); state.customKeys = $('key-count').value === 'custom'; profileControls(); if (state.customKeys) { markProfileDirty(); $('instrument-settings').open = true; $('custom-key-count').value = String(state.keys); $('custom-lowest').value = midiName(state.geometry[0].midi).replace('♯','#'); return; } state.keys = Number($('key-count').value); state.lowestMidi = null; state.profileDirty = false; renderKeyboard(); updateRangeWarning(); checkInstrument(); });
$('typing-octave').addEventListener('change', () => { pausePlayback(); state.octave = Number($('typing-octave').value); renderKeyboard(); });
$('tempo').addEventListener('change', () => {
  const bpm = Number($('tempo').value);
  if (!Number.isFinite(bpm) || bpm < 10 || bpm > 600) { notice('Choose a tempo from 10 to 600 BPM.', true); $('tempo').value = String(state.score?.tempo[0]?.bpm || 100); return; }
  if (state.score) compileScore(transposeTempo(state.score, bpm), true);
});
function selectBasicNotation(mode,{remember=true}={}) { engravedView.hide({remember}); state.notation = mode; $('engraved-button').setAttribute('aria-pressed','false'); $('engraved-button').classList.remove('selected'); $('jianpu-reference-label').hidden = mode !== 'jianpu'; ['staff', 'jianpu'].forEach(m => { $(m + '-button').classList.toggle('selected', m === mode); $(m + '-button').setAttribute('aria-pressed', String(m === mode)); }); renderScore(); }
for (const mode of ['staff', 'jianpu']) $(mode + '-button').addEventListener('click', () => selectBasicNotation(mode));
$('engraved-button').addEventListener('click', () => {notationFollowing?.suspend();engravedView.show()});
$('sound-button').addEventListener('click', () => { synth.muted = !synth.muted; if (synth.muted) synth.silence(); $('sound-button').textContent = synth.muted ? 'Sound off ♫' : 'Sound on ♫'; $('sound-button').setAttribute('aria-pressed', String(synth.muted));metronome?.updateMute(); });
$('import-button').addEventListener('click', () => $('score-file').click());
$('mobile-import-button').addEventListener('click', () => $('score-file').click());
$('score-file').addEventListener('change', async event => {
  const file = event.target.files[0]; event.target.value = ''; if (!file) return;
  const intent = ++state.loadIntent;cancelCatalogSelection();state.compileController?.abort();
  const guidance=unsupportedImportHint(file.name);if(guidance){notice(guidance+' Open Find score sources for format and provenance guidance.',true);return}
  if (file.size > 8 * 1024 * 1024) { notice('This score is too large. Choose a score file smaller than 8 MiB.', true); return; }
  try {
    const jianpuText = /\.jianpu$/i.test(file.name);
    if (jianpuText && file.size > 1024 * 1024) throw new Error('WorldMusicHub numbered text is limited to 1 MiB.');
    const compressed = /\.mxl$/i.test(file.name);
    const midiFile = /\.(mid|midi)$/i.test(file.name);
    const xmlFile = /\.(musicxml|xml)$/i.test(file.name);
    const content = compressed || midiFile || jianpuText || xmlFile ? await file.arrayBuffer() : await file.text();
    if (jianpuText || compressed || midiFile || xmlFile) {
      pausePlayback();
      const response = await fetch(jianpuText ? '/api/import/jianpu' : midiFile ? '/api/import/midi' : compressed ? '/api/import/mxl' : '/api/import/musicxml', {method: 'POST', headers: {'Content-Type': jianpuText ? 'text/plain' : midiFile ? 'audio/midi' : compressed ? 'application/zip' : 'application/xml'}, body: content});
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Score import failed.');
      const loaded = await compileScore(result.score, false, intent, result.diagnostics || []);
      if (loaded && jianpuText) activateJianpuView();
      if (loaded && Array.isArray(result.diagnostics) && result.diagnostics.length) notice(result.diagnostics.map(d => d.message).join(' '));
    } else { const score = JSON.parse(content); await compileScore(score, false, intent); }
  }
  catch (error) { if (intent !== state.loadIntent) return; notice(`Could not read “${file.name}”. Choose valid score JSON, MusicXML (.musicxml/.xml), compressed MusicXML (.mxl), MIDI (.mid/.midi), or WorldMusicHub numbered text (.jianpu). ${error.message}`, true); }
});
$('export-button').addEventListener('click', () => {
  if (!state.score) return;
  try {
    const download = prepareScoreDownload(state.score);
    const blob = new Blob([download.text], {type: 'application/json'});
    const url = URL.createObjectURL(blob); const link = document.createElement('a');
    link.href = url; link.download = `${state.score.id.replace(/[^\w.-]/g, '_')}.json`;
    link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    notice(!download.reimportable
      ? 'Complete score download requested. It exceeds this build’s 8 MiB reimport limit; every note and retained source was kept. Keep this full copy and the original input.'
      : download.formatting === 'compact'
      ? 'Complete score download requested in compact JSON to fit the 8 MiB reimport limit. Every note and retained source is unchanged.'
      : 'Complete score download requested, including every retained source.');
  } catch (error) { notice(`Could not export this score. ${error.message}`, true); }
});
connectPlayable($('keyboard')); connectPlayable($('fretboard'));
document.addEventListener('keydown', event => {
  if(!stageShortcutAllowed({screen:shell.screen(),target:event.target,defaultPrevented:event.defaultPrevented,repeat:event.repeat,ctrlKey:event.ctrlKey,metaKey:event.metaKey,altKey:event.altKey,dialogOpen:Boolean(document.querySelector('dialog[open]'))}))return;
  if (event.code === 'Space') { if (event.target.tagName === 'BUTTON') return; event.preventDefault(); togglePlayback(); return; }
  const key = event.key.toLowerCase();
  if (Object.hasOwn(SHORTCUTS, key)) { event.preventDefault(); pressNote(`key:${event.code}`, (state.octave + 1) * 12 + SHORTCUTS[key], 90, event.timeStamp); }
});
document.addEventListener('keyup', event => { releaseNote(`key:${event.code}`); if (event.key === 'Enter' || event.key === ' ') releaseNote('accessible-key'); });
window.addEventListener('blur', () => pausePlayback('Paused when focus moved · 已暂停'));
document.addEventListener('visibilitychange', () => { if (document.hidden) pausePlayback('Paused in background · 已暂停'); });
window.addEventListener('pagehide', () => { pausePlayback(); cancelAnimationFrame(state.frame);cancelPendingStart();if(preview.controller){preview.cancel();preview.publish({...preview.value,status:'error',message:'Preview stopped when the page was left. Choose this score again to retry.'})} });
let notationResizeFrame = 0;
window.addEventListener('resize', () => { cancelAnimationFrame(notationResizeFrame); notationResizeFrame = requestAnimationFrame(() => { renderNotationPage(); drawFrame(); }); });
window.addEventListener('pageshow', event => { if (event.persisted) { cancelAnimationFrame(state.frame); state.frame = requestAnimationFrame(animate); } });

function cancelCatalogSelection(){
  preview?.cancel();
  if(startingPreview){startRequest++;state.compileController?.abort();startingPreview=false;}
}
function cancelPendingStart(){if(startingPreview){state.loadIntent++;cancelCatalogSelection();renderPreview();updateButtons();}}
async function checkPreview(compiled,part,signal){
  if(state.profileDirty)return{status:'dirty',reason:'Apply your edited instrument setup before starting Practice.'};
  const profile=currentProfile(),targets=practiceScope(compiled.timeline,part,null).targets;
  const plan=validateTargetPlan(await api('/api/practice-targets',{timeline:targets,profile},signal),targets);
  const report=await api('/api/instrument-check',{timeline:targets,profile},signal);
  const result=compatibilityStatus(report,targets.notes);
  return !plan.playable&&result.status==='ready'?{status:'blocked',reason:'Rust marked this target selection as unplayable. Review the instrument setup.'}:result;
}
function renderPreview(){
  const value=preview.value;$('song-lobby').dataset.previewStatus=value.status;$('song-lobby').dataset.previewId=value.identity||'';
  const item=value.score||state.catalog.find(item=>item.id===value.identity);
  $('preview-title').textContent=item?.title||'Choose your first score';
  $('preview-meta').textContent=value.compiled?`${item.composer||'Composer not specified'} · ${scoreSummary(item,value.compiled.timeline).writtenCount} written events · ${item.parts.length} parts · ${catalogOriginLabel(item)}`:item?`${item.composer||'Composer not specified'} · ${item.written_event_count} written events`:'Browse the list or import a local score.';
  $('preview-status').textContent=startingPreview?'Preparing the selected session…':value.status==='loading'?'Loading and validating this preview. Your current take is unchanged.':value.status==='error'?`Preview unavailable: ${value.message} Select it again to retry.`:value.status==='ready'?'Ready to listen. Practice uses Rust-checked physical note-on targets.':'Browsing keeps your current session intact.';
  $('preview-gate').textContent=value.compatibility.reason;$('preview-gate').classList.toggle('preview-blocked',['blocked','error','dirty'].includes(value.compatibility.status));
  $('start-listen').disabled=startingPreview||!preview.canStart('listen');$('start-practice').disabled=startingPreview||!preview.canStart('practice');
  const diagnostics=value.compiled?.diagnostics||[];$('preview-notices').hidden=!diagnostics.length;$('preview-notices-title').textContent=`Source & preparation notices · ${diagnostics.length}`;$('preview-notice-list').replaceChildren();for(const diagnostic of diagnostics.slice(0,20)){const row=document.createElement('li');row.textContent=diagnostic.message;$('preview-notice-list').append(row)}if(diagnostics.length>20){const row=document.createElement('li');row.textContent=`${diagnostics.length-20} further notices are retained in the full score view.`;$('preview-notice-list').append(row)}
  const select=$('preview-part'),signature=JSON.stringify(item?.parts?.map(part=>[part.id,part.name])||[]);
  if(select.dataset.parts!==signature){select.replaceChildren();const all=document.createElement('option');all.value='';all.textContent='All parts · 所有声部';select.append(all);for(const part of item?.parts||[]){const option=document.createElement('option');option.value=part.id;option.textContent=part.name;select.append(option)}select.dataset.parts=signature;}
  select.value=value.part||'';$('preview-part-label').hidden=!value.compiled;
}
async function selectCatalogScore(id){
  const item=state.catalog.find(entry=>entry.id===id);if(!item)return;
  cancelPendingStart();
  $('catalog-status').textContent=`Previewing ${item.title}. Start explicitly to replace the current take.`;
  await preview.select(id,signal=>fetchCatalogScore(item,api,catalogCache,signal));
}
function refreshPreview(){
  const candidate=preview.value;
  if(candidate.score){preview.cancel();preview.publish({...candidate,compatibility:{status:state.profileDirty?'dirty':'pending',reason:state.profileDirty?'Apply your edited instrument setup before starting Practice.':'Instrument setup changed. Rechecking this preview…'}});}
  if(previewRefreshQueued)return;previewRefreshQueued=true;
  queueMicrotask(()=>{previewRefreshQueued=false;const value=preview.value;if(value.score)preview.select(value.identity,async()=>value.score,{part:value.part});});
}
async function startPreview(mode){
  if(startingPreview||!preview.canStart(mode))return;
  const candidate=preview.value,version=preview.version,request=++startRequest;startingPreview=true;renderPreview();
  try{
    await synth.unlock();if(request!==startRequest||version!==preview.version||candidate.score!==preview.value.score)return;
    const intent=++state.loadIntent;
    const loaded=await compileScore(candidate.score,false,intent,candidate.compiled.diagnostics||[],candidate.part,mode);
    if(!loaded||request!==startRequest||intent!==state.loadIntent)return;
    enteringPreview=true;try{shell.show('stage')}finally{enteringPreview=false;}
    if(mode==='practice'&&state.compatibility.status!=='ready'){notice(state.compatibility.reason,true);return;}
    await togglePlayback();
  }catch(error){notice(`Could not start this session. ${error.message}`,true);}
  finally{if(request===startRequest){startingPreview=false;renderPreview();updateButtons();}}
}
$('start-listen').addEventListener('click',()=>startPreview('listen'));
$('start-practice').addEventListener('click',()=>startPreview('practice'));
$('preview-part').addEventListener('change',()=>{const value=preview.value;if(value.score)preview.select(value.identity,async()=>value.score,{part:$('preview-part').value||null});});
for(const id of ['catalog-search','catalog-origin'])$(id).addEventListener(id==='catalog-search'?'input':'change',renderCatalog);
for(const id of ['instrument','key-count','custom-key-count','custom-lowest','guitar-tuning','guitar-frets','guitar-capo'])$(id).addEventListener(['instrument','key-count'].includes(id)?'change':'input',refreshPreview);
async function loadCatalog() {
  const initial=state.loadIntent===0&&!state.score,intent=state.loadIntent,current=++catalogIndexRequest;catalogIndexController?.abort();const controller=new AbortController();catalogIndexController=controller;renderCatalog();$('catalog-status').textContent='Loading lightweight catalog metadata…';
  try {const response=await api('/api/catalog/index',undefined,controller.signal);if(controller.signal.aborted||current!==catalogIndexRequest)return;state.catalog=validateCatalogIndex(response);catalogIndexFailed=false;catalogCache.clear();renderCatalog();$('catalog-status').textContent=state.catalog.length?`${state.catalog.length} scores. Complete notes and originals load only when selected.`:'No bundled entries. You can still import a local score.';if(initial&&intent===state.loadIntent&&state.catalog.length)await selectCatalogScore(state.catalog[0].id);}
  catch(error){if(controller.signal.aborted||current!==catalogIndexRequest)return;catalogIndexFailed=true;renderCatalog();$('catalog-status').textContent='Catalog metadata is unavailable. Local imports and the current score remain available.';notice(`Could not load the catalog index. ${error.message}`,true)}
  finally{if(catalogIndexController===controller){catalogIndexController=null;renderCatalog()}}
}
function activateJianpuView() { state.numberedMode = 'movable'; $('jianpu-reference').value = 'movable'; $('jianpu-button').click(); }
async function importJianpuText(text, signal) {
  const intent = ++state.loadIntent;cancelCatalogSelection();state.compileController?.abort();
  pausePlayback();
  const cancel = () => { if (intent === state.loadIntent) { state.loadIntent++; state.compileController?.abort(); resetPlayback(); } };
  signal.addEventListener('abort', cancel, {once:true});
  try {
    const response = await fetch('/api/import/jianpu', {method:'POST',headers:{'Content-Type':'text/plain'},body:text,signal});
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Numbered-notation import failed.');
    if (signal.aborted || intent !== state.loadIntent) return false;
    const loaded = await compileScore(result.score, false, intent, result.diagnostics || []);
    if (loaded) { activateJianpuView(); if (result.diagnostics?.length) notice(result.diagnostics.map(item => item.message).join(' ')); }
    return loaded;
  } finally { signal.removeEventListener('abort', cancel); }
}
async function importCanonicalScore(score, signal, {practicePart=undefined,diagnostics=[]} = {}) {
  if(signal.aborted)return false;
  const intent=++state.loadIntent;cancelCatalogSelection();state.compileController?.abort();
  const cancel=()=>{if(intent===state.loadIntent){state.loadIntent++;state.compileController?.abort();$('transport-status').textContent=state.compiled?'Previous score is still available':'Score unavailable';updateButtons()}};
  signal.addEventListener('abort',cancel,{once:true});
  try{return await compileScore(score,false,intent,diagnostics,practicePart)}
  finally{signal.removeEventListener('abort',cancel)}
}
const libraryView = setupScoreLibrary({getScore:()=>state.score,onLoad:importCanonicalScore,validate:(score,signal)=>api('/api/compile',score,signal),pausePlayback,notice});
const engravedView = setupEngravedView({getScore:()=>state.score,getPracticePart:()=>state.practicePart,isVisible:()=>shell.screen()==='stage'&&shell.notationVisible(),pausePlayback,notice,onVisibility:active=>{
  if(!active)notationFollowing?.suspend('Following suspended because the engraved view changed. Enable it again after returning.');
  state.engravingActive=active;$('engraving-view').hidden=!active;$('notation-controls').hidden=active;$('notation').hidden=active;$('basic-notation-note').hidden=active;
  if(active){$('score-key').textContent='Generated MusicXML · static staff preview';for(const id of ['staff-button','jianpu-button']){$(id).classList.remove('selected');$(id).setAttribute('aria-pressed','false')}$('engraved-button').classList.add('selected');$('engraved-button').setAttribute('aria-pressed','true')}
},onFallback:()=>selectBasicNotation('staff',{remember:false}),onManualNavigation:()=>notationFollowing?.suspend()});
notationFollowing = setupNotationFollowing({api,getContext:()=>({score:state.score,timeline:state.compiled?.timeline}),getPlayback:()=>{const position=transport.time(performance.now());return{position:position<(state.loop?.start_ms||0)?-1:position,running:transport.running}},view:engravedView});
setupJianpuEditor({onImport:importJianpuText,pausePlayback});
setupJianpuExport({getScore:()=>state.score,pausePlayback,api});
setupSourceDirectory({pausePlayback,onScoreFile:()=>$('score-file').click(),onImageFile:()=>$('score-image-file').click(),onExternalOmr:()=>externalOmrView.open()});
setupImageReview({onImport:importCanonicalScore, pausePlayback, notice,onExternalOmr:imageFile=>externalOmrView.open({imageFile})});
setupMidi({pressNote, releaseNote, releaseMatching, silenceHeld, notice});
sourceArchiveView=setupSourceArchiveView({getContext:()=>({score:state.score,version:state.loadIntent}),pausePlayback});
externalOmrView = setupExternalOmrReview({api,onActivate:importCanonicalScore,pausePlayback,notice,getSourceVersion:()=>state.loadIntent});
adaptationView = setupAdaptationView({api,pausePlayback,notice,onActivate:importCanonicalScore,getContext:()=>({score:state.score,part:state.practicePart,profile:currentProfile(),dirty:state.profileDirty,version:`${state.loadIntent}:${state.practiceVersion}:${state.instrumentRequest}`})});
metronome = setupMetronome({api,getScore:()=>state.score,getDuration:()=>state.compiled?.timeline.duration_ms||0,getWindow:()=>state.loop,getPlayback:()=>({running:transport.running,position:transport.time(performance.now()),segment:transport.startedAt}),getCountInMs:()=>$('count-in').checked?4*60000/(Number($('tempo').value)||100):0,synth});
renderKeyboard(); renderFretboard(); updateButtons(); requestAnimationFrame(animate); loadCatalog();

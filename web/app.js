import {setupReferenceListening} from './reference-listening.js';
import {getAppI18n} from './app-locale.js';
import {createFreePracticeSession, createFreePracticePreview} from './free-practice.js';
import {setupFreePracticeView} from './free-practice-view.js';
import {createKeyboardInput, keyboardInputAllowed} from './keyboard-input.js';
import {setupKeyboardInputView} from './keyboard-input-view.js';
import {setupBeginnerView} from './beginner-view.js';
import {setupSourceArchiveView} from './source-archive-view.js';
import {setupGameShell} from './game-shell.js';
import {setupNoticeView} from './notice-view.js';
import {ScorePreview,filterCatalog} from './score-preview.js';
import {setupPerformanceView,FIELD_COLORS,previewMusicMetadata} from './performance-view.js';
import {setupGuitarGuidance} from './guitar-guidance.js';
import {setupPianoFingeringView} from './piano-fingering-view.js';
import {setupGuitarFingering} from './guitar-fingering.js';
import {setupGuitarFingeringView,highlightGuitarRoute} from './guitar-fingering-view.js';
import {prepareScoreDownload} from './score-download.js';
import {validateCatalogIndex,CatalogScoreCache,fetchCatalogScore} from './catalog-loader.js';
import {setupNotationFollowing,basicNotationPage,createBasicNotationReveal} from './notation-follow.js';
import {setupExternalOmrReview} from './external-omr-view.js';
import {setupAdaptationView} from './adaptation-view.js';
import {setupTranspositionView} from './transposition-view.js';
import {setupSourceDirectory,unsupportedImportHint} from './score-sources.js';
import {setupMetronome} from './metronome.js';
import {setupJianpuExport} from './jianpu-export.js';
import {setupScoreLibrary} from './library-view.js';
import {validateTargetPlan, mappedSourceIds} from './physical-targets.js';
import {PracticeRecorder} from './practice-recorder.js';
import {setupResultsSummary} from './results-summary.js';
import {setupEngravedView} from './engraved-view.js';
import {setupWrittenCursor} from './written-cursor.js';
import {setupJianpuEditor} from './jianpu-editor.js';
import {feedbackView,pitchBreakdownView} from './feedback-view.js';
import {STANDARD_TUNING, guitarProfile, pianoProfile, compatibilityStatus} from './instrument-profile.js';
import {validLatency, readLatencyPreference, writeLatencyPreference, PRACTICE_SETTING_MESSAGE_KEYS, parseBeatInput, practiceScope, windowNotes} from './practice-settings.js';
import {setupMidi, eventTimeEvidence} from './midi.js';
import {setupImageReview} from './image-review.js';
import {setupThemes} from './themes.js';
import {PIANO_RANGES, beat, midiName, pitchMidi, keyboardGeometry, transposeTempo, fretPositions, scoreSummary, renderNotation, notationPageCount, notationLayout, keyAt, keyTonic} from './music.js';
import {Transport, Synth, TimelineIndex} from './transport.js';
import {formatTime} from './music.js';

const $ = id => document.getElementById(id);
const i18n = getAppI18n(document);

const displayBindings = new Map(), passDisplayLabels = new WeakMap();
// Audio admission is per contact, including reused MIDI/pointer source IDs.
// Tokens never enter the recorder, evidence stream, target plan or exports.
const heldAudioTokens = new Map();
let bindingPruneQueued=false;
function newDisplayBinding(node) {
  const binding={};displayBindings.set(node,binding);
  if(!bindingPruneQueued){bindingPruneQueued=true;queueMicrotask(()=>{bindingPruneQueued=false;for(const node of displayBindings.keys())if(!node.isConnected)displayBindings.delete(node);});}
  return binding;
}
function t(key, params = {}) {
  return i18n.t(key, Object.fromEntries(Object.entries(params).map(([name, value]) => [name, typeof value === 'number' ? i18n.formatNumber(value) : String(value ?? '')])));
}
function bindText(node, render) {
  if (!node) return;
  let binding=displayBindings.get(node);if(!binding)binding=newDisplayBinding(node);
  binding.text=render;node.textContent=render();
}
function bindAttribute(node, name, render) {
  if (!node) return;
  let binding=displayBindings.get(node);if(!binding)binding=newDisplayBinding(node);
  (binding.attributes ||= {})[name]=render;node.setAttribute(name,render());
}
function redrawAppText() {
  for (const [node,binding] of displayBindings) {
    if (!node.isConnected) {displayBindings.delete(node);continue;}
    if(binding.text)node.textContent=binding.text();
    for(const [name,render] of Object.entries(binding.attributes||{}))node.setAttribute(name,render());
  }
}
function originalDetail(detail) {return detail ? t('app.originalDetail',{detail}) : '';}
const PROFILE_ERROR_KEYS=Object.freeze({instrument_tuning_count:'app.instrumentTuningCount',instrument_tuning_pitch:'app.instrumentTuningPitch',instrument_guitar_range:'app.instrumentGuitarRange',instrument_piano_pitch:'app.instrumentPianoPitch',instrument_piano_range:'app.instrumentPianoRange'});
function errorDetail(error) {
  if(error?.appMessageKey)return t(error.appMessageKey,error.appMessageParams);
  if(Object.hasOwn(PROFILE_ERROR_KEYS,error?.code))return t(PROFILE_ERROR_KEYS[error.code]);
  if(Object.hasOwn(PRACTICE_SETTING_MESSAGE_KEYS,error?.code))return t(PRACTICE_SETTING_MESSAGE_KEYS[error.code]);
  return originalDetail(error?.message||'');
}
function appError(key, params={}) {const error=new Error(t(key,params));error.appMessageKey=key;error.appMessageParams=params;return error;}
function originLabel(score) {return t(({original_exercise:'app.originOriginal',public_domain_practice_arrangement:'app.originExcerpt',curated_cc0_edition:'app.originCC0'})[score.provenance.kind]||'app.originSource');}
function passLabel(pass) {const label=passDisplayLabels.get(pass);return label?t(label.kind==='loop'?'app.loopLabel':'app.takeLabel',{number:label.number}):pass.label;}
function compatibilityText(result) {
  if(result.reasonKey)return t(result.reasonKey,result.reasonParams);
  const reasonKey=({instrument_report_incomplete:'app.instrumentReportIncomplete',instrument_report_coverage:'app.instrumentReportCoverage',instrument_no_targets:'app.instrumentNoTargets'})[result.reasonCode];
  if(reasonKey)return t(reasonKey);
  if(result.reasonCode==='instrument_unplayable')return t('app.instrumentUnplayable',{outside:result.reasonParams.outside?t('app.instrumentOutside',{count:result.reasonParams.outside}):'',conflict:result.reasonParams.conflict?t('app.instrumentConflict'):''});
  return t(({ready:state.instrument==='piano'?'app.compatibilityPianoReady':'app.compatibilityGuitarReady',dirty:'app.previewDirty',blocked:'app.compatibilityBlocked',pending:'app.compatibilityChecking',error:'app.compatibilityError'})[result.status]||'app.compatibilityWaiting');
}

const renderResultsSummary=setupResultsSummary(document,{i18n});
const renderGuitarGuidance=setupGuitarGuidance(document);
setupThemes();
const transport = new Transport();
const synth = new Synth();
let metronome = null;
let adaptationView = null;
let transpositionView = null;
let externalOmrView = null;
let notationFollowing = null;
let writtenCursor = null, writtenCursorStatus = null, writtenCursorRetry = null;
let sourceArchiveView=null,referenceListening=null;
let midiController=null;
let freeSession=null,freeView=null,freePreview=null,freeLiveOwner=null,freeLiveStart=0,freeCaptureState='idle',freeRecordInstrument=null,freeClockWall=0;
const inputRoutes=[],inputContacts=new Map();
const midiQuarantine={events:[],sources:new Map(),generations:new Map(),bytes:2,omitted:0,firstOmitted:null,omissionReason:null};
const MIDI_QUARANTINE_LIMITS=Object.freeze({observations:4096,observationBytes:1024*1024});
const midiQuarantineViews=[],quarantineEncoder=new TextEncoder();
let midiRouteAmbiguous=false;
let routedScoreRecorder=null;
let keyboardInput=null, keyboardInputView=null, cleaningAllInputs=false, keyboardComposing=false;
let guitarFingering=null,guitarFingeringView=null;
let pianoFingering=null, beginnerView=null;
let shell=null,preview=null,performanceView=null,startingPreview=false,previewRefreshQueued=false,startRequest=0,enteringPreview=false;
const catalogCache=new CatalogScoreCache();
const latencyPreference=readLatencyPreference();
let catalogIndexController=null,catalogIndexRequest=0,catalogIndexFailed=false;
const state = {catalog: [], score: null, compiled: null, importDiagnostics: [], mode: 'listen', practicePart: null, practiceTimeline: null, sourceTargetTimeline: null, practicePlan: null, targetGroups: new Map(), physicalIndex: null, targetTimeline: null, practiceIndex: null, practiceVersion: 0, instrument: 'piano', notation: 'staff', engravingActive: false, numberedMode: 'fixed', latency: latencyPreference.value, loop: null, loopIteration: 1, loopRequest: 0, loopPending: false, notationPage: 0, notationSpan: 16, notationPart: null, timelineIndex: null, sourceNotes: new Map(), keys: 61, lowestMidi: null, customKeys: false, guitar: {tuning: [...STANDARD_TUNING], frets: 12, capo: 0}, instrumentRequest: 0, profileDirty: false, compatibility: {status:'pending',reasonKey:'app.compatibilityWaiting'}, instrumentOutOfRange: null, instrumentConflict: false, inputs: [], recorder: null, assessmentBusy: false, held: new Map(), geometry: keyboardGeometry(61), generation: 0, loadIntent: 0, compileController: null, frame: 0, lastHighlight: '', finishing: false, playTicket: 0, noticeTimer: null, audioLimitWarned: false};

function createRecorder() {
  return new PracticeRecorder({latencyMs:state.latency,onEvidenceLimit:()=>{
    $('take-evidence-limit').hidden=false;
    notice(() => t('app.evidenceLimit'),true);
  }});
}
state.recorder = createRecorder();routedScoreRecorder=state.recorder;
inputRoutes.push({kind:'score',recorder:state.recorder,start:0,end:null});
function refreshFreeTone(){bindText($('free-live-tone'),()=>`${i18n.t('ui.instrument')}: ${i18n.t(`free.timbre.${state.instrument}`)}`);}
function changeScreen(screen){
  referenceListening?.close();
  keyboardInput?.contextChanged('screen_changed');
  if(screen==='free'){
    if(freeRecordInstrument!==state.instrument){try{if(freeSession?.configure('instrument',state.instrument))freeRecordInstrument=state.instrument;}catch{/* Free displays the retained configuration error. */}}
    freeView?.enter();refreshFreeTone();
  }else if(freeSession?.snapshot().entered)freeView?.leave();
  syncInputRoute();if(!enteringPreview)cancelPendingStart();
  performanceView?.screenChanged(screen);engravedView.surfaceChanged();drawFrame();
}
shell=setupGameShell({i18n,pausePlayback,onPanel:name=>{referenceListening?.close();cancelPendingStart();if(name==='results')updateResultsSummary()},onScreen:changeScreen,
  onNotation:()=>{engravedView.surfaceChanged();requestAnimationFrame(()=>{renderNotationPage();drawFrame()})}});
const noticeView=setupNoticeView({document,i18n,getScope:()=>state.score?.title});
preview=new ScorePreview({compile:(score,signal)=>api('/api/compile',score,signal),check:checkPreview,onChange:()=>{renderPreview();renderCatalog()}});

function notice(message, error = false) {
  noticeView.show(message,error);
}
function clearNotice() { noticeView.clear(); }
function compatibilityNotice(result) {const snapshot={...result,reasonParams:{...result.reasonParams}};return()=>compatibilityText(snapshot);}
async function api(path, body, signal) {
  const response = await fetch(path, {method: body === undefined ? 'GET' : 'POST', headers: body === undefined ? {} : {'Content-Type': 'application/json'}, body: body === undefined ? undefined : JSON.stringify(body), signal});
  let result;
  try { result = await response.json(); } catch { throw appError('app.serverUnreadable'); }
  if (!response.ok) throw result.error ? new Error(result.error) : appError('app.serverStatus',{status:response.status});
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
  bindText($('practice-gate-reason'), () => compatibilityText(state.compatibility));
  $('practice-gate-retry').disabled = !ready || state.compatibility.status === 'pending';
  bindText($('play-button'), () => transport.running ? t('app.pause') : transport.completed ? t('app.playAgain') : t('app.play'));
  shell?.update({score:state.score,mode:state.mode,part:state.score?.parts.find(part=>part.id===state.practicePart)?.name,compatibility:{...state.compatibility,reason:compatibilityText(state.compatibility)},passes:state.recorder.passes.length});
}
function silenceHeld(reason = 'application_cleanup', eventWall = performance.now(), boundaryWall = null, recordEvidence = true) {
  if (recordEvidence) state.recorder.evidence.cancel({reason,eventWall,receivedWall:performance.now(),boundaryWall});
  // The all-input evidence boundary above already owns these cancellations.
  // Synchronize physical ownership without appending a duplicate key boundary.
  cleaningAllInputs=true;
  try { keyboardInput?.releaseAll(reason,eventWall); } finally { cleaningAllInputs=false; }
  for(const contact of inputContacts.values())contact.active=false;
  state.held.clear(); heldAudioTokens.clear();
  synth.silence();
  document.querySelectorAll('.pressed').forEach(el => el.classList.remove('pressed'));
}
function pausePlayback(reason = 'app.paused', evidenceReason = 'pause') {
  if(referenceListening?.isOpen()){referenceListening.pause();return;}
  state.playTicket++;
  if(shell?.screen()==='free'){freeView?.interrupt(evidenceReason);cleanupFreeInputs(evidenceReason);return;}
  // Opening a panel or browsing an already-paused session is not a new input
  // boundary. Real lifecycle events still matter even before a late onset arrives.
  const recordEvidence = evidenceReason !== 'pause' || transport.running || state.held.size > 0 || state.recorder.evidence.active.size > 0;
  const pauseTime = performance.now(); advanceLoopClock(pauseTime); state.recorder.pause(pauseTime);
  if (transport.running) { transport.pause(pauseTime); bindText($('transport-status'), () => typeof reason==='function'?reason():reason.startsWith('app.')?t(reason):reason); }
  silenceHeld(evidenceReason,pauseTime,pauseTime,recordEvidence);metronome?.pause();
  updateButtons();
  drawFrame();
}
function resetPlayback() {
  pausePlayback();
  transport.reset();
  if (state.loop) transport.seek(state.loop.start_ms);
  state.loopIteration = 1;metronome?.reset();
  if (state.loopPending && !state.loop) bindText($('loop-status'), () => t('app.loopCancelled'));
  state.loopPending = false;
  state.loopRequest++; $('loop-enabled').checked = Boolean(state.loop);
  state.inputs = []; state.recorder = createRecorder(); state.assessmentBusy = false;syncInputRoute();
  $('take-evidence-limit').hidden=true;
  $('feedback-pass').value = ''; refreshPassHistory();
  state.generation++;
  state.finishing = false;
  state.audioLimitWarned = false; synth.droppedVoices = 0;
  state.lastHighlight = '';
  $('feedback-results').hidden = true;
  bindText($('transport-status'), () => t('app.ready'));
  bindText($('feedback-description'), () => state.mode === 'practice' ? t('app.practiceHelp') : t('app.listenHelp'));
  updateButtons(); drawFrame();
}
async function compileScore(score, preserveTempo = false, expectedIntent = null, importDiagnostics = [], requestedPracticePart = undefined, requestedMode = undefined) {
  if (preserveTempo) importDiagnostics = state.importDiagnostics;
  if (expectedIntent !== null && expectedIntent !== state.loadIntent) return false;
  if (expectedIntent === null) {state.loadIntent++;cancelCatalogSelection();}
  if (new TextEncoder().encode(JSON.stringify(score)).byteLength > 8 * 1024 * 1024) { notice(() => t('app.scoreTooLarge'), true); return false; }
  pausePlayback();
  state.compileController?.abort();
  const controller = new AbortController();
  state.compileController = controller;
  const generation = ++state.generation;
  state.finishing = false;
  $('play-button').disabled = true;
  bindText($('transport-status'), () => t('app.preparingScore'));
  try {
    const compiled = await api('/api/compile', score, controller.signal);
    if (generation !== state.generation || controller.signal.aborted || expectedIntent!==null&&expectedIntent!==state.loadIntent) return;
    // Reset before publishing the new score: resetPlayback() can immediately
    // draw and start the new score's lazy cursor request.
    writtenCursor?.reset();
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
    state.loop = null; state.loopRequest++; state.practicePart = previousPart !== null && state.score.parts.some(part => part.id === previousPart) ? previousPart : null; rebuildPracticeScope(); $('loop-enabled').checked = false; bindText($('loop-status'), () => t('app.loopCleared'));
    state.notationPage = 0; state.notationPart = state.practicePart || state.score.parts[0].id;
    if (!preserveTempo) $('tempo').value = String(compiled.score.tempo[0]?.bpm || 100);
    clearNotice();
    notationFollowing?.scoreChanged();
    resetPlayback();
    renderScore(); sourceArchiveView?.scoreChanged(); libraryView.scoreChanged(); adaptationView?.scoreChanged(); transpositionView?.scoreChanged(); renderCatalog(); updateRangeWarning();
    bindText($('catalog-status'), () => t('app.currentSession', {title:state.score.title}));
    const clockScore=state.score;await checkInstrument();if(state.score===clockScore){metronome?.setScore();preview.adopt(state.compiled,previewCompatibility(state.compatibility),state.practicePart);}
    return state.score===clockScore&&(expectedIntent===null||expectedIntent===state.loadIntent);
  } catch (error) {
    if (error.name === 'AbortError') return;
    if (generation !== state.generation) return;
    notice(() => t('app.loadError', {detail:errorDetail(error)}), true);
    $('tempo').value = String(state.score?.tempo[0]?.bpm || 100);
    bindText($('transport-status'), () => state.compiled ? t('app.previousScoreAvailable') : t('app.scoreUnavailable'));
    updateButtons();
  }
}
function renderCatalog() {
  const catalog=$('catalog');
  bindText($('catalog-count'), () => String(state.catalog.length));
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
    bindText(button.querySelector('.number'), () => String(index+1).padStart(2,'0'));bindText(button.querySelector('strong'), () => score.title);
    bindText(button.querySelector('small'), () => t('app.catalogItem', {count:score.written_event_count,bpm:score.opening_bpm,origin:originLabel(score),loading:loading?t('app.loadingSuffix'):''}));
    // Unchanged entries stay attached, retaining focus while preview/tempo work resolves.
    if(catalog.children[index]!==button)catalog.insertBefore(button,catalog.children[index]||null);
  });
  if(!filtered.length&&state.catalog.length){const empty=document.createElement('p');empty.className='catalog-empty';bindText(empty, () => t('app.catalogNoMatch'));catalog.append(empty)}
  if(catalogIndexFailed){const retry=document.createElement('button');retry.className='button secondary';bindText(retry, () => t('app.catalogRetry'));retry.disabled=Boolean(catalogIndexController);retry.addEventListener('click',loadCatalog);catalog.append(retry)}
}
function renderScore() {
  if (!state.score) return;
  const score = state.score;
  const summary = scoreSummary(score,state.compiled.timeline);
  bindText($('score-title'), () => score.title);
  bindText($('score-meta'), () => t('app.scoreMeta', {composer:score.composer||t('app.composerUnknown'),written:summary.writtenCount,playback:summary.playbackCount,measures:summary.measures,parts:summary.parts}));
  bindText($('score-origin-label'), () => originLabel(score));
  bindText($('score-details-button'), () => t('app.sourceDetails', {count:state.compiled.diagnostics.length}));
  bindText($('score-retention-note'), () => t('app.retention', {notes:summary.count,rests:summary.rests,edition:score.provenance.kind==='curated_cc0_edition'?t('app.retentionSourceEdition'):t('app.retentionCounts')}));
  bindText($('score-key'), () => t('app.scoreMeter', {numerator:score.meters[0]?.numerator||4,denominator:score.meters[0]?.denominator||4}));
  $('notation-part').replaceChildren();
  const shownAll=document.createElement('option');shownAll.value='';bindText(shownAll, () => t('app.allParts'));$('notation-part').append(shownAll);
  for (const part of score.parts) { const option = document.createElement('option'); option.value = part.id; bindText(option, () => part.name); $('notation-part').append(option); }
  $('notation-part').value = state.notationPart || '';
  $('practice-part').replaceChildren();
  const all = document.createElement('option'); all.value = ''; bindText(all, () => t('app.allParts')); $('practice-part').append(all);
  for (const part of score.parts) { const option = document.createElement('option'); option.value = part.id; bindText(option, () => part.name); $('practice-part').append(option); }
  $('practice-part').value = state.practicePart || '';
  updatePracticeScopeLabel();
  renderNotationPage();
  bindText($('provenance'), () => t('app.provenance', {kind:score.provenance.kind,attribution:score.provenance.attribution||'',license:score.provenance.license?t('app.license',{license:score.provenance.license}):t('app.rightsNote')}));
  $('provenance-link').hidden = true;
  if (score.provenance.source_url) { try { const url = new URL(score.provenance.source_url); if (url.protocol === 'https:') { $('provenance-link').href = url.href; $('provenance-link').hidden = false; } } catch { /* Preserve invalid source text in exported score, but never turn it into an unsafe link. */ } }
  bindText($('diagnostic-count'), () => state.compiled.diagnostics.length ? `(${state.compiled.diagnostics.length})` : '');
  $('diagnostic-list').replaceChildren();
  state.compiled.diagnostics.forEach(diagnostic => {
    const li = document.createElement('li'); li.className = diagnostic.severity; bindText(li, () => `${diagnostic.code}: ${diagnostic.message}`); $('diagnostic-list').append(li);
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
  state.compatibility = {status:'pending',reasonKey:'app.compatibilityChecking'};
  if (state.loop) { state.loop.notes = scope.playbackNotes; state.loop.index = new TimelineIndex(scope.playbackNotes); state.loop.targetIds = scope.targetIds; updateLoopStatus(); }
  updatePracticeScopeLabel();
}
function updatePracticeScopeLabel() {
  if (!state.score) return;
  const name = () => state.practicePart === null ? t('app.allParts') : state.score.parts.find(part => part.id === state.practicePart)?.name || state.practicePart;
  const plan=state.practicePlan;
  bindText($('practice-scope'), () => plan ? t('app.practiceScope', {name:name(),targets:plan.target_count,events:plan.source_note_count,loop:state.loop?t('app.inLoop'):''}) : t('app.practiceScopePending', {name:name(),count:state.sourceTargetTimeline?.notes.length||0}));
  bindText($('physical-target-note'), () => !plan ? t('app.targetsPending') : state.instrument==='piano' ? t('app.pianoTargets') : t('app.guitarTargets'));

}
function updateLoopStatus() {
  if (!state.loop) return;
  const loop = state.loop;
  bindText($('loop-status'), () => t('app.loopReady', {start:formatTime(loop.start_ms),end:formatTime(loop.end_ms),count:loop.targetIds.size,crossing:loop.crossing_notes?t('app.loopCrossing',{count:loop.crossing_notes}):'',diagnostics:(loop.diagnostics||[]).map(d=>d.message).join(' ')}));
}
function renderNotationPage() {
  if (!state.score) return;
  const layout = notationLayout(Math.max(240, $('notation').clientWidth - 36));
  const previousBeat = state.notationPage * state.notationSpan;
  if (layout.spanBeats !== state.notationSpan) { state.notationSpan = layout.spanBeats; state.notationPage = Math.floor(previousBeat / state.notationSpan); }
  const count = notationPageCount(state.score, state.notationSpan);
  state.notationPage = Math.max(0, Math.min(count - 1, state.notationPage));
  $('notation').innerHTML = renderNotation(state.score, state.notation, {startBeat: state.notationPage * state.notationSpan, spanBeats: state.notationSpan, width: layout.width, partId: state.notationPart, allParts: state.notationPart===null, numberedMode: state.numberedMode,i18n});
  const tonic = keyTonic(keyAt(state.score, state.notationPage * state.notationSpan));
  if (!state.engravingActive) bindText($('score-key'), () => state.notation === 'jianpu' && state.numberedMode === 'movable' ? (tonic ? t('app.tonicNumbering', {tonic:`${tonic.name}${tonic.octave}`}) : t('app.unknownKey')) : t('app.notationMeter', {numerator:state.score.meters[0]?.numerator||4,denominator:state.score.meters[0]?.denominator||4}));
  bindText($('notation-page'), () => t('app.notationPage', {page:state.notationPage+1,count}));
  $('notation-prev').disabled = state.notationPage <= 0;
  $('notation-next').disabled = state.notationPage >= count - 1;
  state.lastHighlight = '';
}
function updateRangeWarning() {
  if (!state.compiled) return;
  const [min, max] = state.instrument === 'guitar' ? [Math.min(...state.guitar.tuning) + state.guitar.capo, Math.max(...state.guitar.tuning) + state.guitar.frets] : [state.geometry[0].midi, state.geometry.at(-1).midi];
  const outside = state.instrumentOutOfRange ?? (state.sourceTargetTimeline?.notes || state.compiled.timeline.notes).filter(n => n.midi < min || n.midi > max).length;
  bindText($('practice-hint'), () => state.instrumentConflict ? t('app.guitarConflict') : outside ? t('app.rangeWarning', {count:outside,range:state.instrument==='guitar'?t('app.guitarRange'):t('app.pianoRange')}) : state.instrument === 'guitar' ? t('app.guitarHint') : state.mode === 'practice' ? t('app.practiceHint') : t('app.listenHint'));
}
function renderKeyboard() {
  state.geometry = keyboardGeometry(state.keys, state.lowestMidi);
  const fragment = document.createDocumentFragment();
  for (const key of state.geometry) {
    const button = document.createElement('button');
    button.type = 'button'; button.className = `piano-key${key.black ? ' black' : ''}`;
    button.style.left = `${key.x * 100}%`; button.style.width = `${key.width * 100}%`;
    button.dataset.midi = String(key.midi);
    bindAttribute(button, 'aria-label', () => t('app.playNote', {note:midiName(key.midi)})); button.title = midiName(key.midi);
    button.setAttribute('aria-pressed', 'false');
    const name = document.createElement('span'); bindText(name, () => key.midi % 12 === 0 ? midiName(key.midi) : '');
    const shortcut = document.createElement('span'); shortcut.className = 'key-shortcut';
    button.append(shortcut, name); fragment.append(button);
  }
  $('keyboard').replaceChildren(fragment);
  keyboardInputView?.refreshRange();
  beginnerView?.refresh(true);
  $('piano-surface').style.minWidth = `${Math.max(640, state.geometry.filter(key => !key.black).length * 22)}px`;
  midiController?.refresh();
  requestAnimationFrame(() => { const center = state.geometry.find(k => k.midi === (keyboardInput?.snapshot().range.low ?? 60)); if (center) $('piano-scroll').scrollLeft = Math.max(0, center.x * $('piano-surface').clientWidth - $('piano-scroll').clientWidth / 2.5); drawFrame(); });
}
function renderFretboard() {
  keyboardInputView?.refreshRange();
  const board = $('fretboard'); board.replaceChildren();
  const {tuning, frets, capo} = state.guitar; const last = frets - capo;
  bindAttribute(board, 'aria-label', () => t('app.fretboardAria', {tuning:tuning.map(midiName).join(', '),capo}));
  board.style.gridTemplateColumns = `64px repeat(${last + 1}, 1fr)`;
  board.style.gridTemplateRows = `22px repeat(${tuning.length}, 34px)`;
  board.style.minWidth = `${Math.max(600, 64 + (last + 1) * 54)}px`;
  board.style.height = `${22 + tuning.length * 34}px`;
  board.append(document.createElement('span'));
  for (let fret = 0; fret <= last; fret++) { const label = document.createElement('span'); label.className = 'fret-number'; bindText(label, () => fret === 0 ? capo ? t('app.capo', {capo}) : t('app.openString') : String(fret)); board.append(label); }
  tuning.forEach((open, string) => {
    const label = document.createElement('span'); label.className = 'string-name'; bindText(label, () => `${string+1} · ${midiName(open)}`);bindAttribute(label,'title',()=>t('app.tuningRow', {string:string+1,note:midiName(open),capo:capo?t('app.capoOpen',{note:midiName(open+capo)}):''})); board.append(label);
    for (let fret = 0; fret <= last; fret++) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'fret-button';
      button.dataset.midi = String(open + capo + fret); button.dataset.string = String(string); button.dataset.fret = String(fret);
      bindAttribute(button, 'aria-label', () => t('app.fretAria', {string:string+1,tuning:midiName(open),fret,capo:capo?t('app.afterCapo',{capo}):'',note:midiName(open+capo+fret)}));
      button.setAttribute('aria-pressed', 'false');
      const text = document.createElement('span'); bindText(text, () => midiName(open + capo + fret)); button.append(text); board.append(button);
    }
  });
  beginnerView?.refresh(true);
  bindText($('guitar-description'), () => t('app.guitarDescription', {tuning:tuning.map(midiName).join(' · '),strings:tuning.length,frets,capo}));
  midiController?.refresh();
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
  if (state.profileDirty && !apply) { state.compatibility = {status:'dirty',reasonKey:'app.compatibilityDirty'}; updateButtons(); return; }
  if (state.mode === 'practice' && transport.running) pausePlayback();
  state.practicePlan=null;state.targetGroups=new Map();state.targetTimeline=null;state.physicalIndex=null;updatePracticeScopeLabel();renderTargetMappings();
  state.compatibility = {status:'pending',reasonKey:'app.compatibilityPreparing'}; updateButtons();
  const request = ++state.instrumentRequest; const compiled = state.compiled; const selection = state.practiceVersion; const sourceTargets=state.sourceTargetTimeline||compiled.timeline;
  state.instrumentOutOfRange = null; state.instrumentConflict = false;
  bindText($('instrument-report'), () => t('app.checkingRange'));
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
    if(!plan.playable&&state.compatibility.status==='ready')state.compatibility={status:'blocked',reasonKey:'app.compatibilityPlanBlocked'};
    updatePracticeScopeLabel();renderTargetMappings();
    const outside = report.note_options.filter(note => !note.playable).length;
    state.instrumentOutOfRange = outside; state.instrumentConflict = report.diagnostics.some(d => d.code === 'guitar_string_conflict'); updateRangeWarning();
    bindText($('instrument-report'), () => t('app.instrumentReport', {low:midiName(report.lowest_midi),high:midiName(report.highest_midi),count:outside}));
    $('instrument-diagnostics').replaceChildren();
    const diagnostics=[...new Map([...report.diagnostics,...plan.diagnostics].map(item=>[`${item.code}:${item.message}`,item])).values()];
    for (const diagnostic of diagnostics) { const li = document.createElement('li'); bindText(li, () => diagnostic.message); $('instrument-diagnostics').append(li); }
    $('instrument-settings').classList.toggle('has-warnings', diagnostics.some(d => !['guitar_fingering_advisory','guitar_pitch_only_targets'].includes(d.code)));
  } catch (error) { if (request === state.instrumentRequest) { state.compatibility = {status:'error',reasonKey:'app.compatibilityError',originalReason:error.message}; bindText($('instrument-report'), () => t('app.instrumentUnverified', {detail:errorDetail(error)})); } }
  finally { if (request === state.instrumentRequest) updateButtons(); }
}
function renderTargetMappings() {
  $('target-group-list').replaceChildren();
  const mapped=state.practicePlan?.groups.filter(group=>group.source_occurrence_ids.length>1||group.source_note_ids.length>1)||[];
  bindText($('target-mapping-summary'), () => state.practicePlan ? t('app.mappingSummary', {count:mapped.length}) : t('app.mappingPending'));
  const targets=new Map((state.practicePlan?.timeline.notes||[]).map(note=>[note.id,note]));
  for(const group of mapped.slice(0,100)){const note=targets.get(group.target_id);const item=document.createElement('li');bindText(item, () => t('app.mappingItem', {note:midiName(note.midi),seconds:i18n.formatNumber(note.start_ms/1000,{minimumFractionDigits:3,maximumFractionDigits:3}),count:group.source_occurrence_ids.length,sources:group.source_note_ids.join(', '),parts:group.part_ids.join(', ')}));$('target-group-list').append(item)}
  bindText($('target-mapping-limit'), () => !state.practicePlan?t('app.mappingVerify'):mapped.length>100?t('app.mappingLimit'):t('app.mappingRetained'));
}
function syncProfileFields() {
  $('custom-key-count').value=String(state.keys); $('custom-lowest').value=midiName(state.geometry[0].midi).replace('♯','#');
  $('guitar-tuning').value=state.guitar.tuning.map(midiName).join(' ').replaceAll('♯','#'); $('guitar-frets').value=String(state.guitar.frets); $('guitar-capo').value=String(state.guitar.capo);
}
function markProfileDirty() {
  state.profileDirty=true; state.instrumentRequest++;
  state.practicePlan=null;state.targetTimeline=null;state.physicalIndex=null;state.targetGroups=new Map();updatePracticeScopeLabel();renderTargetMappings();
  state.compatibility={status:'dirty',reasonKey:'app.compatibilityDirty'};
  resetPlayback();
  bindText($('instrument-report'), () => compatibilityText(state.compatibility)); updateButtons();
}
for(const id of ['custom-key-count','custom-lowest','guitar-tuning','guitar-frets','guitar-capo'])$(id).addEventListener('input',markProfileDirty);
$('score-details-button').addEventListener('click',()=>{const details=$('score-details');details.open=true;$('score-details-button').setAttribute('aria-expanded','true');details.querySelector('summary').focus({preventScroll:true});details.scrollIntoView({block:'start',behavior:'auto'})});
$('score-details').addEventListener('toggle',()=>{$('score-details-button').setAttribute('aria-expanded',String($('score-details').open))});
$('practice-gate-retry').addEventListener('click',()=>{if(state.profileDirty)$('instrument-apply').click();else checkInstrument()});
$('instrument-apply').addEventListener('click', () => {
  try { const profile = state.instrument === 'guitar' ? guitarProfile($('guitar-tuning').value, $('guitar-frets').value, $('guitar-capo').value) : pianoProfile($('custom-key-count').value, $('custom-lowest').value); checkInstrument(profile, true); }
  catch (error) { state.compatibility = {status:'error',reasonKey:'app.profileInvalid',originalReason:error.message}; bindText($('instrument-report'), () => errorDetail(error)); updateButtons(); }
});
// Routing is chosen from normalized event time before score capture or audio.
// Completed intervals and contacts are bounded; an event older than retained
// history is excluded rather than assigned to a newer recording.
function syncInputRoute(boundaryWall=performance.now()) {
  const next=referenceListening?.isOpen()?{kind:'reference'}:shell?.screen()==='free'?{kind:'free',owner:freeSession?.owner() ?? null}:{kind:'score',recorder:state.recorder};
  // A score reset already discarded its take. Keep only a routing tombstone,
  // so history cannot retain hundreds of obsolete scored evidence buffers.
  if(routedScoreRecorder!==state.recorder){
    for(const route of [...inputRoutes,...[...inputContacts.values()].map(contact=>contact.route)])if(route.kind==='score'&&route.recorder!==state.recorder)route.recorder=null;
    routedScoreRecorder=state.recorder;
  }
  const previous=inputRoutes.at(-1);
  if(previous?.kind===next.kind && previous.owner===next.owner && previous.recorder===next.recorder)return previous;
  if(previous){previous.end=boundaryWall;midiRouteAmbiguous=true;}
  const route={...next,start:boundaryWall,end:null};inputRoutes.push(route);
  if(inputRoutes.length>512)inputRoutes.shift();return route;
}
function isAmbiguousMidi(time,options){return options.inputKind==='midi' && time.timestampBasis==='receipt_fallback' && (midiRouteAmbiguous || options.liveInput!==true);}
function timestampIssue(value){
  if(value===null || value===undefined)return 'missing';
  if(typeof value!=='number')return 'non_numeric';
  if(!Number.isFinite(value))return 'non_finite';
  return value<=0?'non_positive':'out_of_range';
}
function refreshMidiQuarantine(){
  for(const {panel,status,button}of midiQuarantineViews){
    panel.hidden=!midiQuarantine.events.length&&!midiQuarantine.omitted;
    status.textContent=i18n.t('midiQuarantine.status',{retained:midiQuarantine.events.length,omitted:midiQuarantine.omitted});
    button.disabled=!midiQuarantine.events.length&&!midiQuarantine.omitted;
  }
}
function quarantineMidi(kind,source,time,rawTime,options={},midi=null,velocity=null){
  if(!isAmbiguousMidi(time,options))return false;
  const journal=midiQuarantine,first=!journal.events.length&&!journal.omitted;
  const omit=reason=>{journal.omitted++;journal.firstOmitted??=time.receivedWall;journal.omissionReason??=reason;};
  if(journal.omissionReason)omit(journal.omissionReason);
  else if(journal.events.length>=MIDI_QUARANTINE_LIMITS.observations)omit('observation_count_limit');
  else{
    const token=options.generationToken ?? null;
    const generation=journal.generations.get(token) ?? `generation-${journal.generations.size+1}`;
    const sourceKey=`${generation}:${source}`,sourceId=journal.sources.get(sourceKey) ?? `source-${journal.sources.size+1}`;
    const encoding=['midi_note_on','midi_note_off','midi_zero_velocity_note_on'].includes(options.encoding)?options.encoding:null;
    const cleanupReason=['midi_cc120','midi_cc123'].includes(options.reason)?options.reason:null;
    const note=value=>Number.isInteger(value)&&value>=0&&value<=127?value:null;
    const observation={sequence:journal.events.length+1,kind,input_kind:'midi',source_id:sourceId,source_generation:generation,
      channel:Number.isInteger(options.channel)&&options.channel>=0&&options.channel<=15?options.channel:null,
      midi:note(midi),velocity:note(velocity),encoding,cleanup_reason:cleanupReason,
      received_wall_ms:time.receivedWall,raw_timestamp_ms:Number.isFinite(rawTime)?rawTime:null,
      timestamp_issue:timestampIssue(rawTime),timestamp_basis:'receipt_fallback',event_wall_ms:null,segment_id:null,
      recording_id:null,routing:'timing_ambiguous'};
    const bytes=quarantineEncoder.encode(JSON.stringify(observation)).byteLength+1;
    if(journal.bytes+bytes>MIDI_QUARANTINE_LIMITS.observationBytes)omit('observation_byte_limit');
    else{journal.generations.set(token,generation);journal.sources.set(sourceKey,sourceId);journal.events.push(Object.freeze(observation));journal.bytes+=bytes;}
  }
  refreshMidiQuarantine();
  if(first)notice(()=>i18n.t('midiQuarantine.help'),true);
  return true;
}
function exportMidiQuarantine(){
  const journal=midiQuarantine;
  const report={format:'worldmusichub-midi-timing-quarantine',version:1,
    scope:'This page lifetime: unassigned MIDI observations excluded from performances, scoring and sound.',
    receipt_clock_basis:'performance.now milliseconds within this page; not the physical event time',
    event_order:'receipt_order',event_time_policy:'unknown; no event time or recording segment inferred',
    retained_count:journal.events.length,omitted_count:journal.omitted,first_omitted_received_wall_ms:journal.firstOmitted,omission_reason:journal.omissionReason,
    observation_byte_accounting:'UTF-8 JSON observations with array delimiters and a conservative comma budget',
    limits:MIDI_QUARANTINE_LIMITS,estimated_retained_observation_bytes:journal.bytes,observations:journal.events};
  const url=URL.createObjectURL(new Blob([JSON.stringify(report,null,2)],{type:'application/json'}));
  const link=document.createElement('a');link.href=url;link.download='worldmusichub-unassigned-midi-observations.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function setupMidiQuarantinePanel(host,id){
  if(!host)return;
  const panel=document.createElement('section');panel.id=id;panel.className='notice error';panel.hidden=true;panel.dataset.keyboardInput='off';panel.setAttribute('aria-labelledby',`${id}-title`);
  const title=document.createElement('h3');title.id=`${id}-title`;bindText(title,()=>i18n.t('midiQuarantine.title'));
  const status=document.createElement('p');status.id=`${id}-status`;status.setAttribute('role','status');status.setAttribute('aria-live','polite');
  const help=document.createElement('p');bindText(help,()=>i18n.t('midiQuarantine.help'));
  const button=document.createElement('button');button.id=`${id}-export`;button.type='button';button.className='button secondary';bindText(button,()=>i18n.t('midiQuarantine.export'));button.addEventListener('click',exportMidiQuarantine);
  panel.append(title,status,help,button);host.append(panel);midiQuarantineViews.push({panel,status,button});refreshMidiQuarantine();
}
function referenceInputInterval(time){return inputRoutes.some(route=>route.kind==='reference'&&time.eventWall>=route.start&&(route.end===null||time.eventWall<route.end));}
function inputRoute(source,time,options={},release=false) {
  if(referenceInputInterval(time))return null;
  if(Object.hasOwn(options,'owner'))return {kind:'free',owner:options.owner};
  const contact=inputContacts.get(source);
  if(options.inputKind!=='midi' && release)return contact?.route ?? heldAudioTokens.get(source)?.route ?? null;
  // The shared adapter quarantines these before scored/free evidence or sound.
  if(isAmbiguousMidi(time,options))return null;
  const route=inputRoutes.findLast(route=>time.eventWall>=route.start && (route.end===null || time.eventWall<route.end));
  return route?.kind==='reference'?null:route ?? null;
}
function rememberMidiCleanup(route,prefix,eventWall){
  if(!route)return;
  const cutoffs=route.midiCleanupCutoffs ||= new Map();
  const previous=cutoffs.get(prefix);if(previous!==undefined && previous>=eventWall)return;
  cutoffs.delete(prefix);cutoffs.set(prefix,eventWall);
  if(cutoffs.size>256){
    const [expired,wall]=cutoffs.entries().next().value;cutoffs.delete(expired);
    // Conservatively suppress older live callbacks when exact prefix history
    // expires. Their raw observations still enter the appropriate recording.
    route.midiCleanupFloor=Math.max(route.midiCleanupFloor ?? 0,wall);
  }
}
function afterMidiCleanup(route,source,eventWall){
  let cutoff=route.midiCleanupFloor ?? -Infinity;
  for(const [prefix,wall]of route.midiCleanupCutoffs || [])if(source.startsWith(prefix))cutoff=Math.max(cutoff,wall);
  return eventWall>=cutoff;
}
function rememberContact(source,value) {
  inputContacts.delete(source);inputContacts.set(source,value);
  if(inputContacts.size>2048){
    // Completed contacts are a bounded history, not a reason to lose a held
    // key's release route after a long session of unique keyboard contacts.
    let expired=null;for(const [key,contact]of inputContacts)if(!contact.active){expired=key;break;}
    inputContacts.delete(expired ?? inputContacts.keys().next().value);
  }
}
function cleanupFreeInputs(reason='free_boundary') {
  if(shell?.screen()==='free'){cleaningAllInputs=true;try{keyboardInput?.releaseAll(reason);}finally{cleaningAllInputs=false;}}
  for(const contact of inputContacts.values())if(contact.route.kind==='free')contact.active=false;
  for(const source of [...state.held.keys()])if((heldAudioTokens.get(source)??inputContacts.get(source))?.route.kind==='free'){state.held.delete(source);heldAudioTokens.delete(source);synth.stop(`manual:${source}`);}
  freePreview?.stop();highlightKeys();
}
function releaseOwnedSound(source,time,route) {
  const token=heldAudioTokens.get(source)??inputContacts.get(source);
  if(token && (time.eventWall<token.eventWall || token.route.kind!==route?.kind || token.route.owner!==route?.owner || token.route.recorder!==route?.recorder))return;
  state.held.delete(source);heldAudioTokens.delete(source);synth.stop(`manual:${source}`);
}
async function pressNote(source, midi, velocity = 90, eventTime = null, options = {}) {
  const observationTime=eventTimeEvidence(eventTime,{now:performance.now(),timeOrigin:performance.timeOrigin});
  if(referenceInputInterval(observationTime))return;
  if(quarantineMidi('note_on',source,observationTime,eventTime,options,midi,velocity))return;
  const route=inputRoute(source,observationTime,options);
  if(!route)return;
  if(state.held.has(source) && !options.retrigger)return;
  const {receivedWall,eventWall:captureTime}=observationTime;
  let admitted=true;
  if(route.kind==='free'){
    const result=freeSession?.observe('note_on',{...observationTime,...options,source,midi,velocity},route.owner);
    admitted=Boolean(result?.accepted);
  }else{
    const recorder=route.recorder;
    if(recorder!==state.recorder)return;
    advanceLoopClock(receivedWall);
    let captured=null;
    if(state.mode==='practice' && state.compatibility.status==='ready'){
      captured=recorder.capture({midi,eventWall:captureTime,receivedWall,velocity});
      if(captured?.unassigned){refreshPassHistory();bindText($('feedback-description'),()=>t('app.unassignedInputs',{count:recorder.unassignedCaptures.length}));}
      else if(captured){
        state.inputs=recorder.active?.inputs || [];
        bindText($('feedback-description'),()=>captured.pass===recorder.active?t('app.recordedInputs',{count:captured.pass.inputs.length,pass:passLabel(captured.pass)}):t('app.delayedInput',{pass:passLabel(captured.pass)}));
        if(captured.pass.boundaryReviews.length)displayChosenPass();drainAssessments();
      }
    }
    recorder.observeOnset({...observationTime,...options,source,midi,velocity},captured);
  }
  if(!admitted)return;
  // Retain reordered input as evidence, but an older observation cannot replace
  // the latest contact or reopen its sound after a newer release.
  if(captureTime<(inputContacts.get(source)?.eventWall ?? -Infinity))return;
  if(options.inputKind==='midi' && !afterMidiCleanup(route,source,captureTime))return;
  rememberContact(source,{route,eventWall:captureTime,active:true});
  const freeLive=route.kind==='free' && shell.screen()==='free' && route.owner===freeSession.owner() && freeSession.snapshot().state==='recording' && captureTime>=freeLiveStart && (!Object.hasOwn(options,'liveOwner') || options.liveOwner===freeSession.liveOwner());
  const scoreLive=route.kind==='score' && shell.screen()==='stage';
  if(options.liveInput===false || document.hidden || document.querySelector('dialog[open]') || (!freeLive&&!scoreLive))return;
  const audioToken={route,eventWall:captureTime,liveOwner:freeLive?freeSession.liveOwner():null};heldAudioTokens.set(source,audioToken);
  state.held.set(source,midi);highlightKeys();
  // Silent capture never constructs or resumes an AudioContext.
  if(synth.muted)return;
  try{
    await synth.unlock();
    if(!synth.muted && heldAudioTokens.get(source)===audioToken && state.held.get(source)===midi && (!freeLive || (freeSession.liveOwner()===audioToken.liveOwner && freeSession.owner()===route.owner)))synth.play(`manual:${source}`,midi,null,0,state.instrument,velocity);
  }catch(error){notice(route.kind==='free'?()=>i18n.t('error.audioUnavailable'):()=>errorDetail(error),true);}
}
function releaseMatching(prefix, eventTime = null, options = {}) {
  const time=eventTimeEvidence(eventTime),routes=new Set();
  if(referenceInputInterval(time))return;
  if(quarantineMidi('cleanup',prefix,time,eventTime,options))return;
  const current=inputRoute('',time,options);if(current)routes.add(current);
  if(options.inputKind==='midi')rememberMidiCleanup(current,prefix,time.eventWall);
  const sameRoute=route=>route?.kind===current?.kind && route?.owner===current?.owner && route?.recorder===current?.recorder;
  // A delayed device panic belongs to its event-time session, not every newer
  // contact sharing the port prefix. Local cleanup may still span live routes.
  for(const [source,contact]of inputContacts)if(source.startsWith(prefix) && contact.active
    && (options.inputKind!=='midi' || (sameRoute(contact.route) && contact.eventWall<=time.eventWall))){routes.add(contact.route);contact.active=false;contact.eventWall=Math.max(contact.eventWall,time.eventWall);}
  const seenOwners=new Set();
  for(const route of routes){
    const owner=route.kind==='free'?route.owner:route.recorder;if(seenOwners.has(owner))continue;seenOwners.add(owner);
    if(route.kind==='free')freeSession?.cleanup(time.receivedWall,options.reason||'input_cleanup',{prefix,...(options.generationToken?{generationToken:options.generationToken}:{}),...(options.inputKind==='midi'?{notAfterEventWall:time.eventWall}:{})},route.owner);
    else route.recorder?.evidence.cancel({...time,...options,prefix,...(options.inputKind==='midi'?{notAfterEventWall:time.eventWall}:{})});
  }
  for(const source of [...state.held.keys()])if(source.startsWith(prefix)){const token=heldAudioTokens.get(source)??inputContacts.get(source);releaseOwnedSound(source,time,token?.route);}
  highlightKeys();
}
function releaseNote(source, eventTime = null, options = {}) {
  const time=eventTimeEvidence(eventTime);
  if(referenceInputInterval(time))return;
  if(quarantineMidi(options.synthetic?'cleanup':'note_off',source,time,eventTime,options,options.midi,options.velocity))return;
  const route=inputRoute(source,time,options,true);
  if(!route || (route.kind==='score'&&!route.recorder))return;
  const observation={...time,...options,source};
  if(route.kind==='free'){
    if(options.synthetic)freeSession?.cleanup(time.receivedWall,options.reason||'input_cleanup',{source,...(options.generationToken?{generationToken:options.generationToken}:{})},route.owner);
    else freeSession?.observe('note_off',observation,route.owner);
  }else if(options.synthetic)route.recorder.evidence.cancel(observation);
  else route.recorder.evidence.release(observation);
  const contact=inputContacts.get(source);
  if(contact && time.eventWall>=contact.eventWall){contact.active=false;contact.eventWall=time.eventWall;}
  else if(!contact && options.inputKind==='midi' && !options.synthetic)rememberContact(source,{route,eventWall:time.eventWall,active:false});
  releaseOwnedSound(source,time,route);highlightKeys();
}
function highlightKeys(activeNotes = []) {
  const held = new Set(state.held.values());
  freeView?.setHeldNotes([...held]);
  const active = new Set(activeNotes.map(n => n.midi));
  document.querySelectorAll('[data-midi]').forEach(button => { const midi = Number(button.dataset.midi); button.classList.toggle('pressed', held.has(midi)); if(!button.classList.contains('fret-button'))button.classList.toggle('playing', active.has(midi)); button.setAttribute('aria-pressed', String(held.has(midi))); });
  highlightGuitarRoute(document,{notes:activeNotes,groups:state.mode==='practice'?state.targetGroups:new Map(),plan:guitarFingering?.state().plan,...guitarFingeringView?.options()});
}
function connectPlayable(container) {
  container.addEventListener('pointerdown', event => {
    const key = event.target.closest('[data-midi]');
    if (!key || event.button > 0) return;
    event.preventDefault(); key.setPointerCapture(event.pointerId);
    pressNote(`pointer:${event.pointerId}`, Number(key.dataset.midi), 90, event.timeStamp,{inputKind:'on_screen_pointer',encoding:'pointer_down'});
  });
  container.addEventListener('pointerup', event => releaseNote(`pointer:${event.pointerId}`,event.timeStamp,{inputKind:'on_screen_pointer',encoding:'pointer_up'}));
  for (const type of ['pointercancel', 'lostpointercapture']) container.addEventListener(type, event => releaseNote(`pointer:${event.pointerId}`,event.timeStamp,{synthetic:true,reason:type}));
  container.addEventListener('keydown', event => {
    if ((event.key === 'Enter' || event.key === ' ') && !event.repeat && event.target.dataset.midi && keyboardInputAllowed(event,keyboardContext())) { event.preventDefault(); event.stopPropagation(); pressNote('accessible-key', Number(event.target.dataset.midi), 90, event.timeStamp,{inputKind:'on_screen_keyboard',encoding:'key_down'}); }
  });
  container.addEventListener('focusout', event => releaseNote('accessible-key',event.timeStamp,{synthetic:true,reason:'focusout'}));
  container.addEventListener('keyup', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); releaseNote('accessible-key',event.timeStamp,{inputKind:'on_screen_keyboard',encoding:'key_up'}); } });
}
async function togglePlayback() {
  if(referenceListening?.isOpen())return;
  if (shell.screen()!=='stage' || !state.compiled) return;
  if (transport.running) { pausePlayback(); return; }
  if (state.mode === 'practice' && state.compatibility.status !== 'ready') { notice(compatibilityNotice(state.compatibility), true); return; }
  const waiting=state.recorder.active;
  if(waiting&&(waiting.manualDeadline!==null||waiting.inFlight||(transport.completed&&state.recorder.pending))){notice(() => t('app.assessmentWaiting'));return}
  const generation = state.generation;
  const ticket = ++state.playTicket;
  try { if(!synth.muted)await synth.unlock(); } catch (error) { notice(() => errorDetail(error), true); return; }
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
  else {pass=recorder.begin({wallTime:now,position:transport.position,startMs:state.loop?.start_ms||0,endMs:state.loop?.end_ms||state.compiled.timeline.duration_ms,timeline:state.targetTimeline,label:state.loop?`Loop ${state.loopIteration}`:`Take ${recorder.passes.length+1}`,captureEnabled});passDisplayLabels.set(pass,{kind:state.loop?'loop':'take',number:state.loop?state.loopIteration:recorder.passes.length});}
  state.inputs=pass.inputs;refreshPassHistory();displayChosenPass();return pass;
}

function timingText(value,{signed=false,decimals=0}={}) {
  if(!Number.isFinite(value))return '—';
  const magnitude=Math.round(Math.abs(value)*10**decimals)/10**decimals;
  const amount=magnitude===0&&value!==0&&decimals===1?'<'+i18n.formatNumber(0.1):i18n.formatNumber(magnitude,{maximumFractionDigits:decimals});
  return t(signed&&value!==0?(value<0?'app.timingEarly':'app.timingLate'):'app.milliseconds',{value:amount});
}
function adviceText(advice,assessment) {
  const key=({empty_target:'app.adviceNoTargets',no_targets:'app.adviceNoTargets',missed_targets:'app.adviceMissed',variable_timing:'app.adviceVariable',small_sample:'app.adviceSmallSample'})[advice.code];
  if(key)return t(key);
  if(advice.code==='extra_onsets')return t('app.adviceExtra',{count:assessment.extras.length});
  if(advice.code==='timing_bias')return t('app.adviceBias',{timing:timingText(assessment.summary?.timing_bias_ms,{signed:true})});
  return originalDetail(advice.message);
}
function pitchMessage(view) {
  const key=({pitch_breakdown_absent:'app.pitchAbsent',pitch_breakdown_rows_invalid:'app.pitchRowsInvalid',pitch_breakdown_inconsistent:'app.pitchInconsistent',pitch_breakdown_timing_invalid:'app.pitchTimingInvalid',pitch_breakdown_totals_mismatch:'app.pitchTotalsMismatch',pitch_breakdown_ready:'app.pitchReady',pitch_breakdown_empty:'app.pitchEmpty'})[view.messageCode];
  return key?t(key):originalDetail(view.message);
}

function showPassAssessment(pass) {
  updateResultsSummary(pass);
  if(!pass?.assessment){$('feedback-results').hidden=true;return}
  const assessment=pass.assessment;
    $('feedback-results').hidden = false;
    const view = feedbackView(assessment, pass.timeline.notes.length);
    bindText($('accuracy'), () => view.accuracy + (pass.boundaryReviews.length && view.accuracy !== '—' ? '*' : ''));
    bindText($('hits'), () => view.hits);
    bindText($('misses'), () => view.misses);
    bindText($('timing'), () => timingText(assessment.mean_abs_error_ms));
    bindText($('coverage'), () => view.coverage);
    bindText($('timing-bias'), () => timingText(view.timingBiasMs,{signed:true}));
    bindText($('timing-spread'), () => timingText(assessment.summary?.timing_stddev_ms));
    $('feedback-advice').replaceChildren();
    for (const advice of view.advice) {
      const item=document.createElement('li'),summary=document.createElement('span');
      bindText(summary,()=>adviceText(advice,assessment));item.append(summary);
      // Keep the server diagnostic and stable code available without treating its
      // prose as a translation key or replacing the retained assessment payload.
      const details=document.createElement('details'),label=document.createElement('summary'),original=document.createElement('p');
      bindText(label,()=>i18n.t('error.technicalDetails'));original.textContent=`${advice.code}: ${advice.message}`;details.append(label,original);item.append(details);
      item.className=advice.severity==='warning'?'warning':'info';$('feedback-advice').append(item);
    }
    if(state.recorder.interruptions.some(gap=>gap.from_wall_ms===pass.closedWall)){const warning=document.createElement('li');warning.className='warning';bindText(warning, () => t('app.clockInterruption'));$('feedback-advice').append(warning)}
    if(pass.boundaryReviews.length){const warning=document.createElement('li');warning.className='warning';bindText(warning, () => t('app.boundaryReview'));$('feedback-advice').append(warning)}
    const pitches=pitchBreakdownView(assessment,pass.timeline.notes.length);
    bindText($('pitch-breakdown-status'), () => pitchMessage(pitches));$('pitch-breakdown-table').hidden=!pitches.available||!pitches.rows.length;$('pitch-breakdown-region').hidden=!pitches.available||!pitches.rows.length;$('pitch-breakdown-body').replaceChildren();
    bindText($('pitch-breakdown-summary'), () => t('app.pitchSummary', {count:pitches.available?t('app.pitchCount',{count:pitches.rows.length}):''}));
    for(const row of pitches.rows){const tr=document.createElement('tr');tr.dataset.pitchMidi=String(row.midi);const heading=document.createElement('th');heading.scope='row';bindText(heading, () => `${midiName(row.midi)} · ${row.midi}`);tr.append(heading);for(const render of [()=>i18n.formatNumber(row.expected),()=>i18n.formatNumber(row.matched),()=>i18n.formatNumber(row.missed),()=>i18n.formatNumber(row.extra),()=>timingText(row.mean_abs_error_ms,{decimals:1}),()=>timingText(row.timing_bias_ms,{signed:true,decimals:1}),()=>row.sampleCode==='pitch_sample_none'?t('app.pitchSampleNone'):t(row.sampleCode==='pitch_sample_small'?'app.pitchSampleSmall':'app.pitchSampleMatched',{count:row.matched})]){const cell=document.createElement('td');bindText(cell, render);tr.append(cell)}$('pitch-breakdown-body').append(tr)}
    bindText($('pitch-breakdown-note'), () => t('app.pitchNote', {offset:state.recorder.latencyMs}));
    bindText($('feedback-calibration-note'), () => t('app.calibrationNote', {summary:view.hasSummary?t('app.timingRust'):t('app.timingUnavailable'),offset:state.recorder.latencyMs}));
    bindText($('feedback-detail'), () => t('app.feedbackDetail', {tolerance:state.recorder.toleranceMs,offset:state.recorder.latencyMs}));
    bindText($('feedback-description'), () => t('app.passPrefix', {pass:passLabel(pass),boundary:pass.boundaryReviews.length?t('app.boundarySuffix'):''}) + (view.expected === 0 ? t('app.noSelectedTargets') : assessment.hits.length ? t('app.tryAgain') : t('app.noMatches')));
}
function refreshPassHistory() {
  const selected=$('feedback-pass').value;
  $('feedback-pass').replaceChildren();const latest=document.createElement('option');latest.value='';bindText(latest, () => t('app.latestCompleted'));$('feedback-pass').append(latest);
  for(const pass of state.recorder.passes){const option=document.createElement('option');option.value=String(pass.id);bindText(option, () => `${passLabel(pass)}${pass.error?t('app.passRetry'):pass.assessedRevision<pass.revision?t('app.passPending'):pass.assessment?(pass.boundaryReviews.length?t('app.passBoundary'):t('app.passChecked')):''}`);$('feedback-pass').append(option)}
  $('feedback-pass').value=selected;$('take-history').hidden=state.recorder.passes.length===0;
  $('take-interruption-note').hidden=state.recorder.interruptions.length===0;
  bindText($('take-interruption-note'), () => t('app.interruptionNote', {interruptions:state.recorder.interruptions.length,events:state.recorder.unassignedCaptures.length}));
  $('export-takes').disabled=state.recorder.passes.length===0;
  $('retry-assessments').hidden=!state.recorder.passes.some(pass=>pass.error);
}
function chosenPass() {
  const selected=Number($('feedback-pass').value);
  return selected?state.recorder.passes.find(item=>item.id===selected):[...state.recorder.passes].reverse().find(item=>item.assessment);
}
function updateResultsSummary(pass=chosenPass(),now=performance.now()) {
  renderResultsSummary({pass,passLabel:()=>pass?passLabel(pass):'',now,running:transport.running&&pass===state.recorder.active,latencyMs:state.recorder.latencyMs,toleranceMs:state.recorder.toleranceMs,interrupted:state.recorder.interruptions.some(gap=>gap.from_wall_ms===pass?.closedWall)});
}
function displayChosenPass() {
  showPassAssessment(chosenPass());
}
async function waitForReferenceClose(){while(referenceListening?.isOpen())await referenceListening.whenClosed();}
async function drainAssessments() {
  if(state.assessmentBusy||referenceListening?.isOpen())return;
  const recorder=state.recorder;state.assessmentBusy=true;
  try {
    while(recorder===state.recorder){
      if(referenceListening?.isOpen())break;
      const pass=recorder.ready(performance.now())[0];if(!pass)break;
      const job=recorder.submit(pass);updateButtons();refreshPassHistory();
      try{
        const assessment=await api('/api/assess',{timeline:job.timeline,inputs:job.inputs,tolerance_ms:recorder.toleranceMs});
        await waitForReferenceClose();
        if(recorder!==state.recorder)return;
        recorder.complete(job,assessment);if(pass===recorder.active&&pass.closedWall===null&&!transport.running)bindText($('transport-status'), () => t('app.paused'));refreshPassHistory();displayChosenPass();
      }catch(error){await waitForReferenceClose();if(recorder!==state.recorder)return;recorder.fail(job,error.message);notice(() => t('app.assessmentError', {pass:passLabel(pass),detail:errorDetail(error)}),true);refreshPassHistory()}
    }
  }finally{if(recorder===state.recorder){state.assessmentBusy=false;updateButtons();refreshPassHistory()}}
}
function assess() {
  if(referenceListening?.isOpen())return;
  if(!state.compiled||state.mode!=='practice')return;
  if(state.compatibility.status!=='ready'){notice(compatibilityNotice(state.compatibility),true);return}
  const played=Boolean(state.recorder.active?.captureEnabled);
  pausePlayback();const now=performance.now();if(!state.recorder.active)beginPracticePass(now,false);
  state.recorder.requestAssessment(now,{grace:played});
  bindText($('transport-status'), () => played?t('app.receivingInput'):t('app.checkingTake'));
  updateButtons();refreshPassHistory();drainAssessments();
}
$('feedback-pass').addEventListener('change',displayChosenPass);
$('retry-assessments').addEventListener('click',()=>{state.recorder.retryFailed();drainAssessments()});
$('export-takes').addEventListener('click',()=>{const routing=midiController?.exportRoutingData();const data={...state.recorder.exportData(),score_id:state.score?.id,practice_part:state.practicePart,target_plan:state.practicePlan,...(routing?{midi_routing:routing}:{}),keyboard_input_configuration:keyboardInput.exportConfigurationData()};const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download='worldmusichub-practice-session.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000)});
function advanceLoopClock(now) {
  if(!state.loop||!transport.running)return;
  const beatMs=60000/(Number($('tempo').value)||100);
  const result=transport.wrapLoop(now,state.loop.notes,{start:state.loop.start_ms,end:state.loop.end_ms,countIn:$('count-in').checked?beatMs*4:0});
  if(result.status==='pending')return;
  if(state.mode==='practice')state.recorder.closeAtEnd(result.boundaryWall);
  state.loopIteration++;silenceHeld(result.status==='stalled'?'loop_clock_stall':'loop_boundary',now,result.boundaryWall);
  if(result.status==='stalled'){
    if(state.mode==='practice')state.recorder.recordInterruption({boundaryWall:result.boundaryWall,observedWall:now,skippedPasses:result.skippedPasses});
    bindText($('transport-status'), () => t('app.loopInterrupted'));
    notice(() => t('app.loopClockGap', {count:result.skippedPasses}),true);
  }else{
    if(state.mode==='practice')beginPracticePass(result.boundaryWall);
    bindText($('transport-status'), () => t('app.loopIteration', {count:state.loopIteration}));
  }
  updateButtons();refreshPassHistory();
}
// Displayed parts are independent of playback keys and assessed practice targets.
function displayedPartId(){return state.engravingActive?$('engraving-part').value||null:state.notationPart}
function displayedWrittenEntries(written) {
  const part=displayedPartId();
  return (written?.entries||[]).filter(entry=>part===null||entry.partId===part);
}
function drawFrame(displayOnly = false) {
  const now = performance.now();
  if(displayOnly!==true)advanceLoopClock(now);
  const position = transport.time(now);
  if (displayOnly!==true && synth.droppedVoices && !state.audioLimitWarned) { state.audioLimitWarned = true; notice(() => t('app.audioLimit')); }
  const timeline = state.compiled?.timeline;
  const duration = timeline?.duration_ms || 0;
  const segmentStart = state.loop?.start_ms || 0;
  const playbackNotes = state.loop?.notes || state.practiceTimeline?.notes || timeline?.notes || [];
  const playbackIndex = state.mode==='practice'&&state.physicalIndex ? state.physicalIndex : state.loop?.index || state.practiceIndex || state.timelineIndex;
  if (displayOnly!==true && transport.running && timeline) {
    metronome?.advance({running:true,position,segment:transport.startedAt,startPosition:transport.position});
    for (const note of transport.due(now, playbackNotes)) if (state.mode === 'listen') synth.play(`score:${note.id}:${note.part_id}:${note.start_ms}`, note.midi, note.remaining_ms, note.delay_ms, state.instrument, note.velocity ?? 90);
    if (!state.loop && state.mode==='practice' && position>=duration) {
      const previouslyClosed=state.recorder.active?.closedWall!==null;
      const pass=state.recorder.closeAtEnd(now);
      if(!previouslyClosed){updateButtons();refreshPassHistory()}
      if(pass&&now<pass.deadline)bindText($('transport-status'), () => t('app.receivingInput'));
      else{transport.finish(duration);silenceHeld('completion',now,pass?.closedWall);updateButtons();bindText($('transport-status'), () => t('app.complete'))}
    } else if (state.mode==='listen' && position>=duration+80) {transport.finish(duration);silenceHeld('completion',now);updateButtons();bindText($('transport-status'), () => t('app.complete'))}
    else bindText($('transport-status'), () => position < segmentStart ? t('app.countIn', {count:Math.ceil((segmentStart-position)/(60000/(Number($('tempo').value)||100)))}) : state.mode === 'practice' ? t('app.yourTurn', {loop:state.loop?t('app.loopSuffix',{count:state.loopIteration}):''}) : t('app.listening', {loop:state.loop?t('app.loopSuffix',{count:state.loopIteration}):''}));
  }
  if(displayOnly!==true&&state.mode==='practice'&&!referenceListening?.isOpen()){
    const pass=state.recorder.active;
    if(!transport.running&&!state.loop&&pass&&pass.closedWall!==null&&pass.deadline!==null&&now>=pass.deadline&&!transport.completed){transport.finish(duration);bindText($('transport-status'), () => t('app.complete'));updateButtons()}
    if(state.recorder.ready(now).length)drainAssessments();
  }
  $('progress').max = Math.max(1, duration); $('progress').value = Math.min(duration, Math.max(0, position));
  bindText($('time-label'), () => `${formatTime(position)} / ${formatTime(duration)}`);
  performanceView?.update();
  if($('results-dialog').open)updateResultsSummary(undefined,now);
  if(displayOnly!==true)pianoFingering?.render({position,segmentStart,segmentEnd:state.loop?.end_ms||duration,running:transport.running,hasStarted:transport.hasStarted,completed:transport.completed});
  beginnerView?.refresh();
  if(shell.screen()!=='stage')return;
  const active = position < segmentStart ? [] : playbackIndex?.range(position) || [];
  if(displayOnly!==true&&(shell.notationVisible()||beginnerView?.enabled()&&state.numberedMode==='movable'))writtenCursor?.prepare();
  const written = position < segmentStart ? null : writtenCursor?.at(position);
  const soundingSources = new Set(active.flatMap(note=>mappedSourceIds(note,state.mode==='practice'?state.targetGroups.get(note.id):null)));
  const currentWritten = (written?.entries || []).filter(entry=>entry.note.pitch?soundingSources.has(entry.sourceNoteId):state.practicePart===null||entry.partId===state.practicePart);
  const displayedWritten=displayedWrittenEntries(written);
  if(shell.notationVisible()&&state.engravingActive&&written?.occurrence)engravedView.setExpectedWrittenNotes?.({sourceNoteIds:displayedWritten.map(entry=>entry.sourceNoteId),sourceMeasureIndex:written.occurrence.source_measure_index});
  else engravedView.clearExpectedWrittenNotes?.();
  if(displayOnly!==true&&shell.notationVisible())notationFollowing?.tick(position < segmentStart ? -1 : position,transport.running,{...written,entries:displayedWritten,pageAnchor:writtenCursor?.pageAnchor(position,displayedPartId())});
  const signature = JSON.stringify([i18n.revision,written?.occurrence?.id || null,currentWritten.map(entry=>entry.sourceNoteId),displayedWritten.map(entry=>entry.sourceNoteId)]);
  if (signature !== state.lastHighlight) {
    const activeSources=new Set(displayedWritten.map(entry=>entry.sourceNoteId));
    document.querySelectorAll('.score-note').forEach(note => note.classList.toggle('active', activeSources.has(note.dataset.noteId)));
    state.lastHighlight = signature;
    if(writtenCursor?.state().status==='ready'&&writtenCursorStatus){
      const pitches=currentWritten.filter(entry=>entry.note.pitch),rests=currentWritten.length-pitches.length;
      const labels=pitches.slice(0,8).map(({note})=>`${note.pitch.step}${({'-2':'𝄫','-1':'♭','0':'','1':'♯','2':'𝄪'})[note.pitch.alter]}${note.pitch.octave} → ${midiName(pitchMidi(note.pitch))}`);
      bindText(writtenCursorStatus, () => t('app.writtenNotes', {notes:labels.join(', ')||'—',more:pitches.length>8?t('app.moreNotes',{count:pitches.length-8}):'',rests:rests?t('app.writtenRests',{count:rests}):''}));
      writtenCursorStatus.dataset.sourceNoteIds=JSON.stringify(currentWritten.map(entry=>entry.sourceNoteId));
      writtenCursorStatus.dataset.sourceMeasureIndex=written?.occurrence?String(written.occurrence.source_measure_index):'';
    }
  }
  highlightKeys(active);
  $('progress').max = Math.max(1, duration); $('progress').value = Math.min(duration, Math.max(0, position));
  bindText($('time-label'), () => `${formatTime(position)} / ${formatTime(duration)}`);
  if (state.instrument === 'guitar') {
    if(displayOnly!==true)guitarFingering?.prepare();
    const guidance=renderGuitarGuidance({profile:currentProfile(),plan:guitarFingering?.state().plan,...guitarFingeringView?.options(),timeline:state.mode==='practice'?state.targetTimeline:state.practiceTimeline||timeline,groups:state.mode==='practice'?state.targetGroups:new Map(),parts:state.score?.parts||[],position,segmentStart,segmentEnd:state.loop?.end_ms||duration,running:transport.running,hasStarted:transport.hasStarted,completed:transport.completed,mode:state.mode,loopIteration:state.loop?state.loopIteration:null});
    highlightGuitarRoute(document,{notes:guidance.currentNotes,nextNotes:guidance.nextNotes,nextOnsetMs:guidance.nextOnsetMs,position,groups:state.mode==='practice'?state.targetGroups:new Map(),plan:guitarFingering?.state().plan,...guitarFingeringView?.options()});
    return;
  }
  const canvas = $('falling-notes'); const width = canvas.clientWidth; const height = canvas.clientHeight;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) { canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr); }
  const ctx = canvas.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, width, height);
  const background=ctx.createLinearGradient(0,0,width,height);background.addColorStop(0,FIELD_COLORS.background);background.addColorStop(1,FIELD_COLORS.backgroundEnd);
  ctx.fillStyle = background; ctx.fillRect(0, 0, width, height);
  for(const key of state.geometry.filter(key=>key.black)){ctx.fillStyle='#07162130';ctx.fillRect(key.x*width,0,key.width*width,height);}
  for (const key of state.geometry.filter(k => !k.black)) { ctx.strokeStyle = '#88aac518'; ctx.beginPath(); ctx.moveTo(key.x * width, 0); ctx.lineTo(key.x * width, height); ctx.stroke(); }
  // Equal screen-space guides are decorative, not guessed beats or barlines.
  const windowMs = 4000;
  for(let line=1;line<5;line++){const y=line*height/5;ctx.strokeStyle='#88aac51c';ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(width,y);ctx.stroke();}
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  for (const note of reducedMotion ? active : playbackIndex?.range(position, position + windowMs) || []) {
    if (note.start_ms + note.duration_ms < position || note.start_ms > position + windowMs) continue;
    const key = state.geometry.find(k => k.midi === note.midi); if (!key) continue;
    const bottom = reducedMotion ? height : height - (note.start_ms - position) / windowMs * height;
    const noteHeight = reducedMotion ? 40 : Math.max(8, note.duration_ms / windowMs * height - 4);
    const x = key.x * width + 2; const y = bottom - noteHeight;
    const color=note.start_ms<=position?FIELD_COLORS.scheduled:key.black?FIELD_COLORS.accidental:FIELD_COLORS.natural;
    ctx.fillStyle=color;ctx.shadowColor=color+'66';ctx.shadowBlur=reducedMotion?0:6;
    ctx.beginPath(); ctx.roundRect(x, y, Math.max(2, key.width * width - 4), noteHeight, 5); ctx.fill();ctx.shadowBlur=0;ctx.strokeStyle='#eaffff55';ctx.lineWidth=1;ctx.stroke();
    if (noteHeight > 23 && key.width * width > 27) { ctx.fillStyle = FIELD_COLORS.noteText; ctx.font = '12px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(midiName(note.midi), x + (key.width * width - 4) / 2, Math.min(height-13,Math.max(y+17,85))); }
  }
  if (reducedMotion && timeline) { ctx.fillStyle = '#d4e4f1'; ctx.font = '12px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(t('app.reducedMotion'), width / 2, Math.min(height-12,100)); }
  if (!timeline) { ctx.fillStyle = '#a9bba2'; ctx.font = '12px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(t('app.chooseExercise'), width / 2, height / 2); }
}
let lastIdleDraw = 0;
function animate(now) { if (transport.running || now - lastIdleDraw > 100) { drawFrame(); lastIdleDraw = now; } state.frame = requestAnimationFrame(animate); }

async function applyLoop() {
  if (!state.score) return;
  pausePlayback();
  const request = ++state.loopRequest; state.loopPending = true;
  const generation = state.generation;
  bindText($('loop-status'), () => t('app.loopValidating'));
  $('loop-apply').disabled = true;
  try {
    const from = parseBeatInput($('loop-from').value); const to = parseBeatInput($('loop-to').value);
    if (beat(to) <= beat(from)) throw appError('app.loopOrder');
    const window = await api('/api/practice-window', {score: state.score, from, to});
    if (request !== state.loopRequest || generation !== state.generation) return;
    if (window.end_ms - window.start_ms < 250) throw appError('app.loopMinimum');
    state.loopPending = false;
    state.loop = {...window, notes: [], index: null, targetIds: new Set()};
    rebuildPracticeScope();
    $('loop-enabled').checked = true;
    updateLoopStatus();
    resetPlayback(); checkInstrument();
  } catch (error) { if (request === state.loopRequest) { state.loopPending = false; state.loop = null; rebuildPracticeScope(); checkInstrument(); $('loop-enabled').checked = false; bindText($('loop-status'), () => t('app.loopError', {detail:errorDetail(error)})); resetPlayback(); } }
  finally { if (request === state.loopRequest) updateButtons(); }
}
$('loop-apply').addEventListener('click', applyLoop);
$('loop-enabled').addEventListener('change', () => { if ($('loop-enabled').checked) applyLoop(); else { state.loop = null; state.loopRequest++; rebuildPracticeScope(); resetPlayback(); checkInstrument(); bindText($('loop-status'), () => t('app.loopOff')); } });
for (const id of ['loop-from', 'loop-to']) $(id).addEventListener('input', () => { state.loopRequest++; if (state.loop || $('loop-enabled').checked) { state.loop = null; rebuildPracticeScope(); $('loop-enabled').checked = false; resetPlayback(); checkInstrument(); } bindText($('loop-status'), () => t('app.loopBoundsChanged')); });

$('latency-offset').value = String(state.latency);
bindText($('latency-storage-status'), () => latencyPreference.message?errorDetail(latencyPreference):'');$('latency-storage-status').hidden=!latencyPreference.message;
$('latency-offset').addEventListener('change', () => {
  const value = $('latency-offset').value;
  if (!validLatency(value)) { $('latency-offset').value = String(state.latency); notice(() => t('app.latencyInvalid'), true); return; }
  state.latency = Number(value);const result=writeLatencyPreference(state.latency);bindText($('latency-storage-status'), () => result.saved?t('app.latencySaved'):errorDetail(result));$('latency-storage-status').hidden=false;resetPlayback();
});
$('practice-part').addEventListener('change', () => { state.practicePart = $('practice-part').value || null; rebuildPracticeScope(); resetPlayback(); if (state.practicePart !== null) { state.notationPart = state.practicePart; $('notation-part').value = state.practicePart; renderNotationPage(); } engravedView.selectPart(state.practicePart); updateRangeWarning(); checkInstrument(); });
function setNumberedMode(mode) { state.numberedMode = mode; $('jianpu-reference').value = mode; renderNotationPage(); beginnerView?.refresh(true); }
$('jianpu-reference').addEventListener('change', () => setNumberedMode($('jianpu-reference').value));
$('notation-part').addEventListener('change', () => { notationFollowing?.suspend();state.notationPart = $('notation-part').value || null; renderNotationPage(); });
$('notation-prev').addEventListener('click', () => { notationFollowing?.suspend();state.notationPage--; renderNotationPage(); });
$('notation-next').addEventListener('click', () => { notationFollowing?.suspend();state.notationPage++; renderNotationPage(); });
$('play-button').addEventListener('click', togglePlayback);
$('reset-button').addEventListener('click', resetPlayback);
$('assess-button').addEventListener('click', () => assess());
$('session-mode').addEventListener('change', () => { state.mode = $('session-mode').value; resetPlayback(); updateRangeWarning(); });
$('instrument').addEventListener('change', () => { resetPlayback(); state.instrument = $('instrument').value; state.profileDirty = false; syncProfileFields(); profileControls(); if (state.instrument === 'guitar') $('instrument-settings').open = true; checkInstrument(); $('piano-stage').hidden = state.instrument !== 'piano'; $('guitar-stage').hidden = state.instrument !== 'guitar'; $('key-count').disabled = state.instrument !== 'piano'; updateRangeWarning(); keyboardInputView?.refreshRange(); drawFrame(); });
$('key-count').addEventListener('change', () => { resetPlayback(); state.customKeys = $('key-count').value === 'custom'; profileControls(); if (state.customKeys) { markProfileDirty(); $('instrument-settings').open = true; $('custom-key-count').value = String(state.keys); $('custom-lowest').value = midiName(state.geometry[0].midi).replace('♯','#'); return; } state.keys = Number($('key-count').value); state.lowestMidi = null; state.profileDirty = false; renderKeyboard(); updateRangeWarning(); checkInstrument(); });
$('tempo').addEventListener('change', () => {
  const bpm = Number($('tempo').value);
  if (!Number.isFinite(bpm) || bpm < 10 || bpm > 600) { notice(() => t('app.tempoInvalid'), true); $('tempo').value = String(state.score?.tempo[0]?.bpm || 100); return; }
  if (state.score) compileScore(transposeTempo(state.score, bpm), true);
});
function selectBasicNotation(mode,{remember=true}={}) { engravedView.hide({remember}); state.notation = mode; $('engraved-button').setAttribute('aria-pressed','false'); $('engraved-button').classList.remove('selected'); $('jianpu-reference-label').hidden = mode !== 'jianpu'; ['staff', 'jianpu'].forEach(m => { $(m + '-button').classList.toggle('selected', m === mode); $(m + '-button').setAttribute('aria-pressed', String(m === mode)); }); renderScore(); }
for (const mode of ['staff', 'jianpu']) $(mode + '-button').addEventListener('click', () => selectBasicNotation(mode));
$('engraved-button').addEventListener('click', () => {engravedView.show();drawFrame()});
function setSoundEnabled(enabled){
  synth.muted=!enabled;if(enabled&&transport.running)synth.unlock().catch(error=>notice(()=>errorDetail(error),true));if(synth.muted){synth.silence();heldAudioTokens.clear();freePreview?.stop('muted');}
  bindText($('sound-button'),()=>synth.muted?t('app.soundOff'):t('app.soundOn'));$('sound-button').setAttribute('aria-pressed',String(synth.muted));metronome?.updateMute();referenceListening?.soundChanged();
  try{freeSession?.configure('sound',enabled);}catch{/* Session reports configuration failures without losing retained input. */}freeView?.render();
}
$('sound-button').addEventListener('click',()=>setSoundEnabled(synth.muted));
$('import-button').addEventListener('click', () => {referenceListening?.close();$('score-file').click();});
$('mobile-import-button').addEventListener('click', () => {referenceListening?.close();$('score-file').click();});
$('score-file').addEventListener('change', async event => {
  const file = event.target.files[0]; event.target.value = ''; if (!file) return;
  referenceListening?.close();
  const intent = ++state.loadIntent;cancelCatalogSelection();state.compileController?.abort();
  const guidance=unsupportedImportHint(file.name,i18n);if(guidance){notice(() => unsupportedImportHint(file.name,i18n),true);return}
  if (file.size > 8 * 1024 * 1024) { notice(() => t('app.fileTooLarge'), true); return; }
  try {
    const jianpuText = /\.jianpu$/i.test(file.name);
    if (jianpuText && file.size > 1024 * 1024) throw appError('app.jianpuTooLarge');
    const compressed = /\.mxl$/i.test(file.name);
    const midiFile = /\.(mid|midi)$/i.test(file.name);
    const xmlFile = /\.(musicxml|xml)$/i.test(file.name);
    const content = compressed || midiFile || jianpuText || xmlFile ? await file.arrayBuffer() : await file.text();
    if (jianpuText || compressed || midiFile || xmlFile) {
      pausePlayback();
      const response = await fetch(jianpuText ? '/api/import/jianpu' : midiFile ? '/api/import/midi' : compressed ? '/api/import/mxl' : '/api/import/musicxml', {method: 'POST', headers: {'Content-Type': jianpuText ? 'text/plain' : midiFile ? 'audio/midi' : compressed ? 'application/zip' : 'application/xml'}, body: content});
      const result = await response.json();
      if (!response.ok) throw result.error ? new Error(result.error) : appError('app.importFailed');
      const loaded = await compileScore(result.score, false, intent, result.diagnostics || []);
      if (loaded && jianpuText) activateJianpuView();
      if (loaded && Array.isArray(result.diagnostics) && result.diagnostics.length) notice(result.diagnostics.map(d => d.message).join(' '));
    } else { const score = JSON.parse(content); await compileScore(score, false, intent); }
  }
  catch (error) { if (intent !== state.loadIntent) return; notice(() => t('app.readError', {name:file.name,detail:errorDetail(error)}), true); }
});
$('export-button').addEventListener('click', () => {
  if (!state.score) return;
  try {
    const download = prepareScoreDownload(state.score);
    const blob = new Blob([download.text], {type: 'application/json'});
    const url = URL.createObjectURL(blob); const link = document.createElement('a');
    link.href = url; link.download = `${state.score.id.replace(/[^\w.-]/g, '_')}.json`;
    link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    notice(() => !download.reimportable
      ? t('app.downloadLarge')
      : download.formatting === 'compact'
      ? t('app.downloadCompact')
      : t('app.downloadComplete'));
  } catch (error) { notice(() => t('app.exportError', {detail:errorDetail(error)}), true); }
});
// Explicit performance focus targets preserve arrow controls without hijacking widgets.
for (const id of ['stage-title','keyboard','fretboard']) $(id).dataset.keyboardPerformance='';
const keyboardContext = () => ({composing:keyboardComposing,screen:shell.screen(),hidden:document.hidden,dialogOpen:Boolean(document.querySelector('dialog[open]')),settingsOpen:Boolean($('settings-dialog')?.open)});
keyboardInput=createKeyboardInput({pressNote,releaseNote,releaseMatching:(...args)=>{if(!cleaningAllInputs)releaseMatching(...args)},getContext:keyboardContext,
  onChange:snapshot=>{keyboardInputView?.render(snapshot);freeView?.setKeyboard(snapshot);beginnerView?.refreshMapping(snapshot.configurationId);},
  onConfiguration:()=>{if(!keyboardInput||!freeSession)return;try{freeSession.configure('keyboard_configuration',keyboardInput.exportConfigurationData().current_configuration);}catch{/* The session retains the failure and blocks PC input until corrected. */}}});
keyboardInputView=setupKeyboardInputView({document,controller:keyboardInput,i18n,onConfigure:()=>shell.open('settings'),
  getVisualRange:()=>state.instrument==='guitar'?{low:Math.min(...state.guitar.tuning)+state.guitar.capo,high:Math.max(...state.guitar.tuning)+state.guitar.frets}:state.geometry.length?{low:state.geometry[0].midi,high:state.geometry.at(-1).midi}:null});
freeSession=createFreePracticeSession({now:()=>{freeClockWall=performance.now();return freeClockWall;},onBoundary:cleanupFreeInputs,onChange:snapshot=>{
  const starting=snapshot.state==='recording'&&['idle','stopped'].includes(freeCaptureState);
  const stopping=snapshot.state==='stopped'&&freeCaptureState!=='stopped';
  // Use the recorder's exact Start/Stop/Leave boundary, not a later render clock.
  syncInputRoute(starting||stopping||!snapshot.entered?freeClockWall:undefined);
  const next=freeSession?.liveOwner();if(next!==freeLiveOwner){freeLiveOwner=next;freeLiveStart=performance.now();}
  if(snapshot.entered&&snapshot.state==='recording'&&freeCaptureState!=='recording')$('free-practice-title')?.focus();freeCaptureState=snapshot.state;
}});
freePreview=createFreePracticePreview({audio:synth,soundEnabled:()=>!synth.muted});
freeView=setupFreePracticeView({document,i18n,session:freeSession,preview:freePreview,host:document.querySelector('.app-shell'),
  onExit:()=>shell.show('library'),onConnectMidi:()=>{$('midi-button').click();shell.open('settings');},onConfigureKeyboard:()=>shell.open('settings'),
  getSoundEnabled:()=>!synth.muted,onSoundChange:setSoundEnabled,
  getConfiguration:()=>{freeRecordInstrument=state.instrument;return {sound:!synth.muted,instrument:state.instrument,keyboard_configuration:keyboardInput.exportConfigurationData().current_configuration};},
  onInput:(kind,{source,midi,velocity,eventTime,...options})=>kind==='note_on'?pressNote(source,midi,velocity,eventTime,options):releaseNote(source,eventTime,{...options,midi,velocity,synthetic:kind==='cleanup'})});
freeView.element.setAttribute('role','main');freeView.setKeyboard(keyboardInput.snapshot());
setupMidiQuarantinePanel(document.querySelector('#free-practice-screen .free-input-section'),'free-midi-quarantine');
setupMidiQuarantinePanel(document.querySelector('#settings-dialog .shell-dialog-content'),'settings-midi-quarantine');
i18n.subscribe(refreshMidiQuarantine);
const freeLiveTone=document.createElement('span');freeLiveTone.id='free-live-tone';$('free-sound').after(freeLiveTone);refreshFreeTone();
connectPlayable($('keyboard')); connectPlayable($('fretboard'));
document.addEventListener('keydown', event => {
  if (keyboardInput.keydown(event)) return;
  if (shell.screen()!=='stage' || event.code !== 'Space' || !keyboardInputAllowed(event,keyboardContext(),{control:true})) return;
  event.preventDefault(); togglePlayback();
});
document.addEventListener('keyup', event => {
  keyboardInput.keyup(event);
  if (event.key === 'Enter' || event.key === ' ') releaseNote('accessible-key',event.timeStamp,{encoding:'key_up'});
});
document.addEventListener('compositionstart',event=>{keyboardComposing=true;keyboardInput.compositionStart(event)});
document.addEventListener('compositionend',()=>{keyboardComposing=false;keyboardInput.compositionEnd()});
document.addEventListener('focusin',event=>{if(event.target.closest?.('.beginner-controls'))return;if(!keyboardInputAllowed(event,keyboardContext()))keyboardInput.contextChanged('keyboard_focus_changed',event.timeStamp)});
window.addEventListener('blur', () => {keyboardComposing=false;keyboardInput.compositionEnd();pausePlayback('app.blurPaused','blur')});
document.addEventListener('visibilitychange', () => { if (document.hidden) pausePlayback('app.hiddenPaused','hidden'); });
window.addEventListener('pagehide', () => { pausePlayback(undefined,'pagehide'); cancelAnimationFrame(state.frame);cancelPendingStart();if(preview.controller){preview.cancel();preview.publish({...preview.value,status:'error',message:t('app.previewStopped')})} });
let notationResizeFrame = 0;
window.addEventListener('resize', () => { cancelAnimationFrame(notationResizeFrame); notationResizeFrame = requestAnimationFrame(() => { renderNotationPage(); drawFrame(); }); });
$('workspace').addEventListener('notationlayoutchange', () => { cancelAnimationFrame(notationResizeFrame); notationResizeFrame = requestAnimationFrame(() => { renderNotationPage(); drawFrame(); }); });
window.addEventListener('pageshow', event => { if (event.persisted) { cancelAnimationFrame(state.frame); state.frame = requestAnimationFrame(animate); } });

function cancelCatalogSelection(){
  preview?.cancel();
  if(startingPreview){startRequest++;state.compileController?.abort();startingPreview=false;}
}
function cancelPendingStart(){if(startingPreview){state.loadIntent++;cancelCatalogSelection();renderPreview();updateButtons();}}
function previewCompatibility(result,profile=currentProfile()){
  return result.status==='ready'?{...result,reasonKey:profile.kind==='piano'?'app.compatibilityPianoReady':'app.compatibilityGuitarReady'}:result;
}
async function checkPreview(compiled,part,signal){
  if(state.profileDirty)return{status:'dirty',reasonKey:'app.previewDirty'};
  const profile=currentProfile(),targets=practiceScope(compiled.timeline,part,null).targets;
  const plan=validateTargetPlan(await api('/api/practice-targets',{timeline:targets,profile},signal),targets);
  const report=await api('/api/instrument-check',{timeline:targets,profile},signal);
  const result=compatibilityStatus(report,targets.notes);
  if(!plan.playable&&result.status==='ready')return{status:'blocked',reasonKey:'app.previewBlocked'};
  return previewCompatibility(result,profile);
}
function renderPreview(){
  const value=preview.value,changedIdentity=$('song-lobby').dataset.previewId!==(value.identity||'');$('song-lobby').dataset.previewStatus=value.status;$('song-lobby').dataset.previewId=value.identity||'';
  const item=value.score||state.catalog.find(item=>item.id===value.identity);
  bindText($('preview-title'), () => item?.title||t('app.chooseScore'));
  bindAttribute($('preview-title'),'title',()=>item?.title||t('app.chooseScore'));
  bindText($('preview-meta'), () => item?t('app.previewMeta', {composer:item.composer||t('app.composerUnknown'),origin:originLabel(item)}):t('app.browseScores'));
  bindAttribute($('preview-meta'),'title',()=>item?t('app.previewMeta',{composer:item.composer||t('app.composerUnknown'),origin:originLabel(item)}):t('app.browseScores'));
  if($('preview-music-meta'))bindText($('preview-music-meta'), () => previewMusicMetadata(value.compiled?.score,i18n));
  bindText($('preview-status'), () => startingPreview?t('app.preparingSession'):value.status==='loading'?t('app.preparingPreview'):value.status==='error'?t('app.previewError', {detail:originalDetail(value.message)}):value.status==='ready'?t('app.previewReady'):t('app.previewBrowsing'));
  bindText($('preview-gate'), () => compatibilityText(value.compatibility));$('preview-gate').classList.toggle('preview-blocked',['blocked','error','dirty'].includes(value.compatibility.status));
  $('start-listen').disabled=startingPreview||!preview.canStart('listen');$('start-practice').disabled=startingPreview||!preview.canStart('practice');
  const diagnostics=value.compiled?.diagnostics||[];$('preview-notices').hidden=!diagnostics.length;bindText($('preview-notices-title'), () => t('app.previewNotices', {count:diagnostics.length}));$('preview-notice-list').replaceChildren();for(const diagnostic of diagnostics.slice(0,20)){const row=document.createElement('li');bindText(row, () => diagnostic.message);$('preview-notice-list').append(row)}if(diagnostics.length>20){const row=document.createElement('li');bindText(row, () => t('app.moreNotices', {count:diagnostics.length-20}));$('preview-notice-list').append(row)}
  const select=$('preview-part'),signature=JSON.stringify([i18n.revision,item?.parts?.map(part=>[part.id,part.name])||[]]);
  if(select.dataset.parts!==signature){select.replaceChildren();const all=document.createElement('option');all.value='';bindText(all, () => t('app.allParts'));select.append(all);for(const part of item?.parts||[]){const option=document.createElement('option');option.value=part.id;bindText(option, () => part.name);select.append(option)}select.dataset.parts=signature;}
  select.value=value.part||'';$('preview-part-label').hidden=!value.compiled;
  if(changedIdentity){$('preview-notices').open=false;document.querySelector('.preview-copy').scrollTop=0;}
}
async function selectCatalogScore(id){
  const item=state.catalog.find(entry=>entry.id===id);if(!item)return;
  cancelPendingStart();
  bindText($('catalog-status'), () => t('app.previewing', {title:item.title}));
  await preview.select(id,signal=>fetchCatalogScore(item,api,catalogCache,signal));
}
function refreshPreview(){
  const candidate=preview.value;
  if(candidate.score){preview.cancel();preview.publish({...candidate,compatibility:{status:state.profileDirty?'dirty':'pending',reasonKey:state.profileDirty?'app.previewDirty':'app.previewRechecking'}});}
  if(previewRefreshQueued)return;previewRefreshQueued=true;
  queueMicrotask(()=>{previewRefreshQueued=false;const value=preview.value;if(value.score)preview.select(value.identity,async()=>value.score,{part:value.part});});
}
async function startPreview(mode){
  if(startingPreview||!preview.canStart(mode))return;
  const candidate=preview.value,version=preview.version,request=++startRequest;startingPreview=true;renderPreview();
  try{
    if(!synth.muted)await synth.unlock();if(request!==startRequest||version!==preview.version||candidate.score!==preview.value.score)return;
    const intent=++state.loadIntent;
    const loaded=await compileScore(candidate.score,false,intent,candidate.compiled.diagnostics||[],candidate.part,mode);
    if(!loaded||request!==startRequest||intent!==state.loadIntent)return;
    enteringPreview=true;try{shell.show('stage')}finally{enteringPreview=false;}
    if(mode==='practice'&&state.compatibility.status!=='ready'){notice(compatibilityNotice(state.compatibility),true);return;}
    await togglePlayback();
  }catch(error){notice(() => t('app.startError', {detail:errorDetail(error)}),true);}
  finally{if(request===startRequest){startingPreview=false;renderPreview();updateButtons();}}
}
i18n.subscribe(()=>{redrawAppText();if(state.score&&!state.engravingActive)renderNotationPage();state.lastHighlight='';drawFrame(true);});
$('start-listen').addEventListener('click',()=>startPreview('listen'));
$('start-practice').addEventListener('click',()=>startPreview('practice'));
$('preview-part').addEventListener('change',()=>{const value=preview.value;if(value.score)preview.select(value.identity,async()=>value.score,{part:$('preview-part').value||null});});
for(const id of ['catalog-search','catalog-origin'])$(id).addEventListener(id==='catalog-search'?'input':'change',renderCatalog);
for(const id of ['instrument','key-count','custom-key-count','custom-lowest','guitar-tuning','guitar-frets','guitar-capo'])$(id).addEventListener(['instrument','key-count'].includes(id)?'change':'input',refreshPreview);
async function loadCatalog() {
  const initial=state.loadIntent===0&&!state.score,intent=state.loadIntent,current=++catalogIndexRequest;catalogIndexController?.abort();const controller=new AbortController();catalogIndexController=controller;renderCatalog();bindText($('catalog-status'), () => t('app.catalogLoading'));
  try {const response=await api('/api/catalog/index',undefined,controller.signal);if(controller.signal.aborted||current!==catalogIndexRequest)return;state.catalog=validateCatalogIndex(response);catalogIndexFailed=false;catalogCache.clear();renderCatalog();bindText($('catalog-status'), () => state.catalog.length?t('app.catalogReady', {count:state.catalog.length}):t('app.catalogEmpty'));if(initial&&intent===state.loadIntent&&state.catalog.length)await selectCatalogScore(state.catalog[0].id);}
  catch(error){if(controller.signal.aborted||current!==catalogIndexRequest)return;catalogIndexFailed=true;renderCatalog();bindText($('catalog-status'), () => t('app.catalogUnavailable'));notice(() => t('app.catalogError', {detail:errorDetail(error)}),true)}
  finally{if(catalogIndexController===controller){catalogIndexController=null;renderCatalog()}}
}
function activateJianpuView() { setNumberedMode('movable'); $('jianpu-button').click(); }
async function importJianpuText(text, signal) {
  const intent = ++state.loadIntent;cancelCatalogSelection();state.compileController?.abort();
  pausePlayback();
  const cancel = () => { if (intent === state.loadIntent) { state.loadIntent++; state.compileController?.abort(); resetPlayback(); } };
  signal.addEventListener('abort', cancel, {once:true});
  try {
    const response = await fetch('/api/import/jianpu', {method:'POST',headers:{'Content-Type':'text/plain'},body:text,signal});
    const result = await response.json();
    if (!response.ok) throw result.error ? new Error(result.error) : appError('app.jianpuImportFailed');
    if (signal.aborted || intent !== state.loadIntent) return false;
    const loaded = await compileScore(result.score, false, intent, result.diagnostics || []);
    if (loaded) { activateJianpuView(); if (result.diagnostics?.length) notice(result.diagnostics.map(item => item.message).join(' ')); }
    return loaded;
  } finally { signal.removeEventListener('abort', cancel); }
}
async function importCanonicalScore(score, signal, {practicePart=undefined,diagnostics=[]} = {}) {
  if(signal.aborted)return false;
  const intent=++state.loadIntent;cancelCatalogSelection();state.compileController?.abort();
  const cancel=()=>{if(intent===state.loadIntent){state.loadIntent++;state.compileController?.abort();bindText($('transport-status'), () => state.compiled?t('app.previousScoreAvailable'):t('app.scoreUnavailable'));updateButtons()}};
  signal.addEventListener('abort',cancel,{once:true});
  try{return await compileScore(score,false,intent,diagnostics,practicePart)}
  finally{signal.removeEventListener('abort',cancel)}
}
const libraryView = setupScoreLibrary({getScore:()=>state.score,onLoad:importCanonicalScore,validate:(score,signal)=>api('/api/compile',score,signal),pausePlayback,notice});
const engravedView = setupEngravedView({i18n,getScore:()=>state.score,getPracticePart:()=>state.practicePart,isVisible:()=>shell.screen()==='stage'&&shell.notationVisible(),notice,onVisibility:active=>{
  state.engravingActive=active;
  document.querySelector('.engraving-pages').hidden=!active;
  const displayOptions=document.querySelector('.notation-display-options');if(displayOptions)displayOptions.hidden=!active;
  $('engraving-view').hidden=!active;$('notation-controls').hidden=active;$('notation').hidden=active;$('basic-notation-note').hidden=active;
  $('score-key').hidden=active;
  if($('dock-warning-count'))$('dock-warning-count').hidden=!active&&$('engraving-fallback').hidden;
  if(active){bindText($('score-key'), () => t('app.generatedStaff'));for(const id of ['staff-button','jianpu-button']){$(id).classList.remove('selected');$(id).setAttribute('aria-pressed','false')}$('engraved-button').classList.add('selected');$('engraved-button').setAttribute('aria-pressed','true')}
},onFallback:()=>selectBasicNotation('staff',{remember:false}),onManualNavigation:()=>notationFollowing?.suspend()});
const basicNotationReveal=createBasicNotationReveal({container:$('notation'),dock:$('notation-dock')});
$('notation-dock').addEventListener('toggle',()=>basicNotationReveal.reset(),true);
const followingView={
  isActive:()=>shell.screen()==='stage'&&shell.notationVisible(),
  resetReveal(){basicNotationReveal.reset();engravedView.resetReveal()},
  navigationState:()=>state.engravingActive?engravedView.navigationState():{ready:true},
  followMeasure(index,occurrence,written){
    if(state.engravingActive)return engravedView.followMeasure(index);
    const page=basicNotationPage(occurrence,written?.entries,state.notationPart,state.notationSpan,written?.pageAnchor);
    if(page!==null&&page!==state.notationPage){state.notationPage=page;renderNotationPage()}
  },
  revealExpectedWrittenNotes(occurrenceId,index,written){
    return state.engravingActive?engravedView.revealExpectedWrittenNotes(occurrenceId,index):basicNotationReveal.reveal(occurrenceId,(written?.entries||[]).filter(entry=>state.notationPart===null||entry.partId===state.notationPart).map(entry=>entry.sourceNoteId));
  },
};
notationFollowing = setupNotationFollowing({i18n,getContext:()=>({score:state.score,timeline:state.compiled?.timeline}),
  prepareNavigation:async options=>{const cached=writtenCursor.navigation();if(cached)return cached;await writtenCursor.prepare(options);const navigation=writtenCursor.navigation();if(!navigation){const detail=writtenCursor.state().message;throw Object.assign(new Error(detail),{code:'notation_followMap',cause:{message:detail}})}return navigation},
  getPlayback:()=>{const position=transport.time(performance.now()),written=writtenCursor?.at(position);return{position:position<(state.loop?.start_ms||0)?-1:position,running:transport.running,written:{...written,entries:displayedWrittenEntries(written),pageAnchor:writtenCursor?.pageAnchor(position,displayedPartId())}}},view:followingView});
setupJianpuEditor({onImport:importJianpuText,pausePlayback});
setupJianpuExport({getScore:()=>state.score,pausePlayback,api});
setupSourceDirectory({pausePlayback,onScoreFile:()=>{referenceListening?.close();$('score-file').click();},onImageFile:()=>$('score-image-file').click(),onExternalOmr:()=>externalOmrView.open()});
setupImageReview({onImport:importCanonicalScore, pausePlayback, notice,onExternalOmr:imageFile=>externalOmrView.open({imageFile})});
referenceListening=setupReferenceListening({document,i18n,synth,pausePlayback,onActiveChange:()=>syncInputRoute(),getSoundEnabled:()=>!synth.muted,onSoundChange:setSoundEnabled});
sourceArchiveView=setupSourceArchiveView({getContext:()=>({score:state.score,version:state.loadIntent}),pausePlayback});
externalOmrView = setupExternalOmrReview({api,onActivate:importCanonicalScore,pausePlayback,notice,getSourceVersion:()=>state.loadIntent});
adaptationView = setupAdaptationView({api,pausePlayback,notice,onActivate:importCanonicalScore,getContext:()=>({score:state.score,part:state.practicePart,profile:currentProfile(),dirty:state.profileDirty,version:`${state.loadIntent}:${state.practiceVersion}:${state.instrumentRequest}`})});
transpositionView = setupTranspositionView({api,pausePlayback,notice,onActivate:importCanonicalScore,getContext:()=>({score:state.score,timeline:state.compiled?.timeline,part:state.practicePart,profile:currentProfile(),dirty:state.profileDirty,version:`${state.loadIntent}:${state.practiceVersion}:${state.instrumentRequest}`})});
const guitarContext=()=>({score:state.score,timeline:state.compiled?.timeline,part_id:state.practicePart,profile:currentProfile(),dirty:state.profileDirty});
guitarFingering=setupGuitarFingering({api,getContext:guitarContext,onChange:()=>guitarFingeringView?.render()});
guitarFingeringView=setupGuitarFingeringView({document,controller:guitarFingering,getContext:guitarContext,onRefresh:drawFrame});
guitarFingeringView.render();
metronome = setupMetronome({api,getScore:()=>state.score,getDuration:()=>state.compiled?.timeline.duration_ms||0,getWindow:()=>state.loop,getPlayback:()=>({running:transport.running,position:transport.time(performance.now()),segment:transport.startedAt}),getCountInMs:()=>$('count-in').checked?4*60000/(Number($('tempo').value)||100):0,synth});
performanceView=setupPerformanceView({i18n,getContext:()=>({geometry:state.geometry,rangeLabel:`${midiName(state.geometry[0].midi)}–${midiName(state.geometry.at(-1).midi)}`,mode:state.mode,instrument:state.instrument,position:transport.time(performance.now()),segmentStart:state.loop?.start_ms||0,countInBeatMs:60000/(Number($('tempo').value)||100),running:transport.running,hasStarted:transport.hasStarted,completed:transport.completed,now:performance.now(),recorder:state.recorder})});
pianoFingering=setupPianoFingeringView({document,api,getContext:()=>({score:state.score,timeline:state.compiled?.timeline,part_id:state.practicePart,profile:currentProfile(),dirty:state.profileDirty}),onChange:()=>drawFrame(),openSettings:()=>shell.open('settings')});
writtenCursorStatus=document.createElement('p');writtenCursorStatus.id='written-cursor-status';writtenCursorStatus.setAttribute('aria-live','off');
writtenCursorRetry=document.createElement('button');writtenCursorRetry.id='written-cursor-retry';writtenCursorRetry.type='button';writtenCursorRetry.className='button compact';bindText(writtenCursorRetry, () => t('app.retryNotePositions'));writtenCursorRetry.hidden=true;
document.querySelector('#notation-dock .dock-help').append(writtenCursorStatus,writtenCursorRetry);
writtenCursor=setupWrittenCursor({api,getContext:()=>({score:state.score,timeline:state.compiled?.timeline}),onStatus:({status,message})=>{writtenCursorStatus.dataset.status=status;writtenCursorStatus.dataset.sourceNoteIds='[]';bindText(writtenCursorStatus, () => t(({idle:'app.cursorIdle',loading:'app.cursorLoading',ready:'app.cursorReady',unavailable:'app.cursorUnavailable'})[status]||'app.cursorUnavailable'));bindAttribute(writtenCursorStatus,'title',()=>originalDetail(message));writtenCursorRetry.hidden=status!=='unavailable';state.lastHighlight='';beginnerView?.refresh();}});
beginnerView=setupBeginnerView({document,i18n,getContext:()=>({score:state.score,numberedMode:state.numberedMode,written:beginnerView?.enabled()&&state.numberedMode==='movable'?writtenCursor?.at(transport.time(performance.now())):null}),onNumberedMode:setNumberedMode});
writtenCursorRetry.addEventListener('click',()=>writtenCursor.prepare({retry:true}));
window.addEventListener('pagehide',()=>writtenCursor.reset());
midiController=setupMidi({pressNote, releaseNote, releaseMatching, notice, pausePlayback,
  getConfiguredRange:()=>state.instrument==='guitar'?{low:Math.min(...state.guitar.tuning)+state.guitar.capo,high:Math.max(...state.guitar.tuning)+state.guitar.frets}:state.geometry.length?{low:state.geometry[0].midi,high:state.geometry.at(-1).midi}:null});
renderKeyboard(); renderFretboard(); updateButtons(); requestAnimationFrame(animate); loadCatalog();

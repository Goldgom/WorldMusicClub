import {createPartActivityPolicyStamp} from './part-activity-lifecycle.js';
import {createPartActivityStage} from './part-activity-stage.js';
import {setupLibraryManagementView} from './library-management-view.js';
import {basicKeyWrittenAt} from './basic-key-notation.js';
import {renderBasicKeyPage} from './basic-key-numbered.js';
import {isVsqSong,isPerformanceSong,isBasicKeysSong,basicKeysParts,hasBasicKeyRendition} from './clean-song-package.js';
const hasAudioThreadRendition=song=>hasBasicKeyRendition(song)||isVsqSong(song)&&Boolean(song.runtime);
import {CleanSongPlayer,inspectCleanRendition} from './clean-song-player.js';
import {createCleanSongMedia} from './clean-song-media.js';
import {setupCleanSongView} from './clean-song-view.js';
import {cleanErrorText} from './clean-song-text.js';
import {setupLobbyPreview} from './lobby-preview.js';
import {setupReferenceListening} from './reference-listening.js';
import {setupCompletePerformanceListening} from './complete-performance-listening.js';
import {getAppI18n} from './app-locale.js';
import {createFreePracticeSession, createFreePracticePreview} from './free-practice.js';
import {setupFreePracticeView} from './free-practice-view.js';
import {createKeyboardInput, keyboardInputAllowed} from './keyboard-input.js';
import {setupKeyboardInputView} from './keyboard-input-view.js';
import {setupBeginnerView} from './beginner-view.js';
import {setupSourceArchiveView} from './source-archive-view.js';
import {setupGameShell} from './game-shell.js';
import {setupNoticeView} from './notice-view.js';
import {resolvePracticeSelection,humanPracticePartIds} from './practice-selection.js';
import {createBasicPracticeAdmissionRequest,createBasicPracticeAdmissionBinding,admitBasicPractice,assertBasicPracticeCurrent} from './basic-practice-admission.js';
import {SongModStore,createSongMod,songModChanges,songModOptions,songModCapabilities,assertSongModSupported,validateSongMod} from './song-mod.js';
import {createPartInstrumentPolicy,assertPartInstrumentPolicyCurrent,assertPartInstrumentPolicyReady,resolvePartInstrumentInput,partInstrumentPolicyIssue} from './part-instrument-policy.js';
import {setupSongModView} from './song-mod-view.js';
import {SourceInstrumentDetailsLoader} from './source-instrument-loader.js';
import {SourceIdentityLoader} from './source-identity-loader.js';
import {PitchModStore,preparePitchModView,pitchViewContext,originalPitchContext,pitchModSemitones,pitchModConfiguration} from './pitch-mod.js';
import {createProgressiveAssistanceController as createPracticeAssistanceController,PracticeProgressionStore} from './practice-progression.js';
import {progressionForAssistance} from './practice-progression-receipt.js';
import {assertPracticeAssistanceCurrent} from './practice-assistance-receipt.js';
import {appAssistanceContext,currentAppAssistanceBinding,AppAssistanceStore,assistancePracticeGate,scopedAssistanceTargets,assistanceTakeIdentity} from './app-assistance.js';
import {setupCompletePracticeView} from './complete-practice-view.js';
import {CanonicalPracticeSession,canonicalPracticeOptions,canonicalDisplayNotes} from './canonical-practice-session.js';
import {buildCanonicalAudioPlan,CANONICAL_AUDIO_POLICY} from './canonical-audio-plan.js';
import {buildBasicKeyAudioPlan} from './basic-key-audio-plan.js';
import {buildVsqAudioPlan} from './vsq-audio-plan.js';
import {canonicalAudioPolicyText,canonicalAudioErrorText,canonicalLoopBudgetText} from './canonical-practice-text.js';
import {practiceStageNotes,markPracticeNotation,createPracticeDisplayCache,createPracticeAssistanceDisplayIndex} from './practice-stage-display.js';
import {setupFallingNoteLabels} from './falling-note-labels.js';
import {ScorePreview,filterCatalog} from './score-preview.js';
import {openScoreStorage} from './native-score-storage.js';
import {ScoreStorageModel,createImportPersistenceTicket,buildSongList,loadSongListItem} from './score-storage-model.js';
import {setupScoreStorageView,setupScoreStorageLobbyStatus,describePersistenceResult} from './score-storage-view.js';
import {setupSongAuthoringView} from './song-authoring-view.js';
import {setupBulkImportView} from './bulk-import-view.js';
import {isImportEnvelope} from './bulk-import.js';
import {importDirectMidiFallback,directMidiImportText} from './direct-midi-import.js';
import {practiceRangeRepair} from './practice-range-repair.js';
import {setupPerformanceView,FIELD_COLORS,previewMusicMetadata,updateWrittenNoteHighlights,fallingNoteShadow} from './performance-view.js';
import {renderPianoKeybed,renderPianoRails,pianoMinimumWidth} from './piano-stage-view.js';
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
import {notationMeasuresPerRow} from './notation-row-window.js';
import {setupCompleteScoreReader} from './complete-score-reader.js';
import {setupEngravedView} from './engraved-view.js';
import {setupWrittenCursor} from './written-cursor.js';
import {setupJianpuEditor} from './jianpu-editor.js';
import {feedbackView,pitchBreakdownView} from './feedback-view.js';
import {STANDARD_TUNING, guitarProfile, pianoProfile, compatibilityStatus} from './instrument-profile.js';
import {validLatency, readLatencyPreference, writeLatencyPreference, PRACTICE_SETTING_MESSAGE_KEYS, parseBeatInput, practiceScope, windowNotes} from './practice-settings.js';
import {setupMidi, eventTimeEvidence} from './midi.js';
import {setupImageReview} from './image-review.js';
import {setupThemes} from './themes.js';
import {createSkinRuntime,paintSkinNote} from './skin-runtime.js';
import {setupSkinSettings} from './skin-settings.js';
import {setupBuildDiagnosticsView} from './build-diagnostics-view.js';
import {PIANO_RANGES, beat, midiName, pitchMidi, keyboardGeometry, transposeTempo, fretPositions, scoreSummary, renderNotation, notationPageCount, notationLayout, keyAt, keyTonic} from './music.js';
import {Transport, Synth, TimelineIndex} from './transport.js';
import {notationAudioAdmission} from './engraving-render-scheduler.js';
import {publishPlaybackClock,nativeRangeSeekPosition} from './playback-clock-view.js';
import {formatTime} from './music.js';

const $ = id => document.getElementById(id);
const i18n = getAppI18n(document);

const displayBindings = new Map(), passDisplayLabels = new WeakMap(),passInterpretations=new WeakMap();
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
const IMPORT_DIAGNOSTIC_KEYS=Object.freeze({midi_notation_inferred:'app.midiNotationInferred',midi_key_release_timing:'app.midiKeyReleaseTiming',midi_initial_tempo_projection:'app.initialTempoProjection'});
function diagnosticText(diagnostic) {
  return Object.hasOwn(IMPORT_DIAGNOSTIC_KEYS,diagnostic.code) ? t(IMPORT_DIAGNOSTIC_KEYS[diagnostic.code]) : diagnostic.message;
}
function attributionText(score) {
  const provenance=score.provenance;
  // Only this exact standard-importer statement is ours to localize. Author
  // credits, rights declarations and other source formats stay literal.
  return score.source?.format==='midi-base64'&&provenance.kind==='user_import'&&provenance.source_url==null&&provenance.license==null&&provenance.attribution==='User-supplied MIDI performance; ownership and usage rights are not verified. Notation is inferred, not original sheet music.'
    ? t('app.midiImportAttribution') : provenance.attribution||'';
}
function bindText(node, render) {
  if (!node) return;
  let binding=displayBindings.get(node);if(!binding)binding=newDisplayBinding(node);
  binding.text=render;const value=render(),text=value==null?'':String(value);if(node.textContent!==text)node.textContent=text;
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
  if(result.basicPractice&&result.reason)return result.reason;
  if(result.assistanceReason==='infeasible')return i18n.locale==='en'?'This Original assignment is infeasible under the checked model. Change the assignment in Mod or choose Listen.':'当前原始分配在已验证模型下不可行。请在 Mod 中更改分配，或选择聆听。';
  if(result.assistanceReason==='noHuman')return i18n.locale==='en'?'No human targets remain in this scope. Choose a scope with human targets or intentional Listen.':'当前范围没有真人目标。请选择包含真人目标的范围，或明确选择聆听。';
  if(result.assistance&&result.reason)return result.reason;
  if(result.reasonKey)return t(result.reasonKey,result.reasonParams);
  const reasonKey=({instrument_report_incomplete:'app.instrumentReportIncomplete',instrument_report_coverage:'app.instrumentReportCoverage',instrument_no_targets:'app.instrumentNoTargets'})[result.reasonCode];
  if(reasonKey)return t(reasonKey);
  if(result.reasonCode==='instrument_unplayable')return t('app.instrumentUnplayable',{outside:result.reasonParams.outside?t('app.instrumentOutside',{count:result.reasonParams.outside}):'',conflict:result.reasonParams.conflict?t('app.instrumentConflict'):''});
  return t(({ready:state.instrument==='piano'?'app.compatibilityPianoReady':'app.compatibilityGuitarReady',dirty:'app.previewDirty',blocked:'app.compatibilityBlocked',pending:'app.compatibilityChecking',error:'app.compatibilityError'})[result.status]||'app.compatibilityWaiting');
}

const renderResultsSummary=setupResultsSummary(document,{i18n});
const renderGuitarGuidance=setupGuitarGuidance(document);
setupThemes();
const skinRuntime=createSkinRuntime({document});
const transport = new Transport();
const synth = new Synth({onError:error=>{partActivityStage?.clear();pausePlayback(undefined,'audio_failure');notice(()=>liveAudioErrorText(error),true);}});
function liveAudioErrorText(error) { return cleanErrorText(i18n.locale,{code:error?.code,message:error?.message,details:error?.details,liveAudioTerminal:synth.liveError===error}); }
let cleanView=null,previewMedia=null,activeMedia=null,previewMediaKey=null,activeMediaKey=null;
const cleanMutedParts=new Set(),cleanSoloParts=new Set();
const cleanPlayer=new CleanSongPlayer({getPositionMs:()=>transport.time(performance.now()),onError:error=>{partActivityStage?.clear();pausePlayback(undefined,'audio_failure');notice(()=>cleanErrorText(i18n.locale,error),true);}});
const canonicalSession=new CanonicalPracticeSession({api,onError:error=>{partActivityStage?.clear();pausePlayback(undefined,'audio_failure');notice(()=>canonicalAudioErrorText(i18n.locale,error),true);}});
function playbackPosition(now=performance.now(),sample=null){return !state.cleanSong&&transport.running?(now<transport.startedAt?transport.position:canonicalSession.sourcePositionMs(now,sample)??transport.time(now)):transport.time(now);}
let partActivityStage=null;
let metronome = null;
let adaptationView = null;
let transpositionView = null;
let externalOmrView = null;
let notationFollowing = null, completeScoreReader = null;
let writtenCursor = null, writtenCursorStatus = null, writtenCursorRetry = null;
let sourceArchiveView=null,referenceListening=null,performanceListening=null,lobbyPreview=null,scoreStorage=null,scoreStorageView=null,bulkImportView=null,songAuthoringView=null,libraryManagement=null,fileSelectionVersion=0;
let pendingScoreSaveOwner=null,scoreSaveNavigation=0,noticeRevision=0;
let directMidiImportOwner=null;
let midiController=null;
let freeSession=null,freeView=null,freePreview=null,freeLiveOwner=null,freeLiveStart=0,freeCaptureState='idle',freeRecordInstrument=null,freeClockWall=0,freeWindowFocused=true;
const inputRoutes=[],inputContacts=new Map();
const midiQuarantine={events:[],sources:new Map(),generations:new Map(),bytes:2,omitted:0,firstOmitted:null,omissionReason:null};
const MIDI_QUARANTINE_LIMITS=Object.freeze({observations:4096,observationBytes:1024*1024});
const midiQuarantineViews=[],quarantineEncoder=new TextEncoder();
let midiRouteAmbiguous=false;
let routedScoreRecorder=null;
let scoreLiveStart=0;
let keyboardInput=null, keyboardInputView=null, cleaningAllInputs=false, keyboardComposing=false;
let guitarFingering=null,guitarFingeringView=null;
let pianoFingering=null, beginnerView=null;
const songMods=new SongModStore(),pitchMods=new PitchModStore();
const sourceInstrumentDetails=new SourceInstrumentDetailsLoader({api,onChange:()=>refreshSongModView()});
const sourceIdentity=new SourceIdentityLoader({api,onChange:()=>refreshSongModView()});
let songModView=null,completePracticeView=null,fallingNoteLabels=null;
const practiceDisplayCache=createPracticeDisplayCache({getParts:basicKeysParts});
let shell=null,preview=null,performanceView=null,startingPreview=false,previewRefreshQueued=false,startRequest=0,enteringPreview=false;
const catalogCache=new CatalogScoreCache();
const latencyPreference=readLatencyPreference();
let catalogIndexController=null,catalogIndexRequest=0,catalogIndexFailed=false;
const state = {basicPracticeAdmission:null,basicPracticeTokens:null,basicPracticePlan:null,songMod:null,pitchView:null,hiddenPartIds:new Set(),inspection:false,cleanSong:null,catalog: [], score: null, compiled: null, importDiagnostics: [], mode: 'listen', practicePart: null, practiceSelection:null, practiceLayout:'solo', showOtherParts:true, practiceTimeline: null, sourceTargetTimeline: null, practicePlan: null, targetGroups: new Map(), physicalIndex: null, targetTimeline: null, practiceIndex: null, practiceVersion: 0, instrument: 'piano', notation: 'staff', engravingActive: false, numberedMode: 'fixed', latency: latencyPreference.value, loop: null, loopIteration: 1, loopRequest: 0, loopPending: false, notationPage: 0, notationSpan: 16, notationPart: null, timelineIndex: null, sourceNotes: new Map(), keys: 61, lowestMidi: null, customKeys: false, guitar: {tuning: [...STANDARD_TUNING], frets: 12, capo: 0}, instrumentRequest: 0, profileDirty: false, compatibility: {status:'pending',reasonKey:'app.compatibilityWaiting'}, instrumentOutOfRange: null, instrumentConflict: false, inputs: [], recorder: null, assessmentBusy: false, held: new Map(), geometry: keyboardGeometry(61), generation: 0, loadIntent: 0, compileController: null, frame: 0, lastHighlight: '', finishing: false, playTicket: 0, playPending: false, noticeTimer: null, audioLimitWarned: false};

const assistanceStore=new AppAssistanceStore({storage:pitchMods.preferences}),progressionStore=new PracticeProgressionStore({storage:pitchMods.preferences});
let assistanceRefreshQueued=false,assistanceDisplayCache=null,basicHumanRequest=0;
function assistanceContext(where){const value=where==='preview'?preview?.value:state;if(!value?.compiled||!value.score)return null;return {...appAssistanceContext(value,currentProfile(),songMods.identity(value)),admissionKey:JSON.stringify(where==='stage'&&state.loop?[state.loop.start_ms,state.loop.end_ms,state.loop.target_note_ids]:null)};}
function assistanceChanged(){
  if(assistanceRefreshQueued)return;assistanceRefreshQueued=true;
  queueMicrotask(()=>{assistanceRefreshQueued=false;if(!preview||!songModView)return;renderPreview();updateButtons();drawFrame();});
}
let previewAssistance=createPracticeAssistanceController({api,store:assistanceStore,progressionStore,getContext:()=>assistanceContext('preview'),onChange:assistanceChanged});
let stageAssistance=createPracticeAssistanceController({api,store:assistanceStore,progressionStore,getContext:()=>assistanceContext('stage'),onChange:assistanceChanged});
const stageAssistanceBinding=()=>currentAppAssistanceBinding(stageAssistance,assistanceContext('stage'));
const previewAssistanceBinding=()=>currentAppAssistanceBinding(previewAssistance,assistanceContext('preview'));
function getPracticeAssistanceDisplay(){
  const assistance=stageAssistance.current();if(!assistance)return {};
  if(assistanceDisplayCache?.assistance!==assistance||assistanceDisplayCache.timeline!==state.compiled.timeline)assistanceDisplayCache={assistance,timeline:state.compiled.timeline,ownershipIndex:createPracticeAssistanceDisplayIndex({assistance,sourceNotes:state.compiled.timeline.notes})};
  return assistanceDisplayCache;
}
function isHumanWritten(entry){const display=getPracticeAssistanceDisplay();return display.assistance?display.ownershipIndex.isHumanSource(entry.sourceNoteId,entry.partId):humanPartIds().has(entry.partId);}
function fingeringAssistanceContext(){const assistance=stageAssistance.current(),gate=state.compiled?assistancePracticeGate(stageAssistance):null;return{assistance,assistanceUnavailable:Boolean(gate||assistance&&!assistance.all_selected_human)};}
function assistancePlaybackOptions(){const assistance=stageAssistance.current();return assistance?{assistance,assistanceContext:stageAssistanceBinding,...(!assistance.plan.selection.selected_part_ids.length?{practiceSelection:{kind:'parts',part_ids:[]}}:{})}:{};}

function createRecorder() {
  return new PracticeRecorder({latencyMs:state.latency,onEvidenceLimit:()=>{
    $('take-evidence-limit').hidden=false;
    notice(() => t('app.evidenceLimit'),true);
  }});
}
state.recorder = createRecorder();routedScoreRecorder=state.recorder;
inputRoutes.push({kind:'score',recorder:state.recorder,start:0,end:null});
function refreshFreeTone(){bindText($('free-live-tone'),()=>`${i18n.t('ui.instrument')}: ${i18n.t(`free.timbre.${state.instrument}`)}`);}
// Default has no receipt, saved recipe, request or draft to revoke. Preserve
// this no-op state so ordinary navigation does not invalidate fingering caches.
// A resumable stage owns its admitted assignment independently from lobby edits.
// Cancel pending drafts on navigation; current() still fences its live tokens.
function resetAssistanceOnNavigation(controller){const snapshot=controller.state();if(controller===stageAssistance&&snapshot.active)controller.cancelDraft();else if(!['default','off'].includes(snapshot.phase))controller.reset();}
function changeScreen(screen){
  if(screen!=='stage')resetAssistanceOnNavigation(stageAssistance);
  else if(state.compiled&&stageAssistance.state().phase==='idle'){void stageAssistance.restore();if(!['default','off'].includes(stageAssistance.state().phase))void checkInstrument();}
  if(screen!=='library')resetAssistanceOnNavigation(previewAssistance);
  else if(preview?.value.compiled&&previewAssistance.state().phase==='idle')restorePreviewAssistance();
  state.audioAdmissionController?.abort();
  state.playTicket++;state.playPending=false;
  songAuthoringView?.screenChanged(screen);
  scoreSaveNavigation++;
  referenceListening?.close();
  performanceListening?.screenChanged();
  cleanPlayer.stop();activeMedia?.clear();activeMediaKey=null;previewMedia?.clear();previewMediaKey=null;
  if(screen==='stage')syncCleanMedia();else if(screen==='library')renderCleanPreview();
  keyboardInput?.contextChanged('screen_changed');
  if(screen==='free'){
    if(freeRecordInstrument!==state.instrument){try{if(freeSession?.configure('instrument',state.instrument))freeRecordInstrument=state.instrument;}catch{/* Free displays the retained configuration error. */}}
    freeView?.enter();refreshFreeTone();
  }else if(freeSession?.snapshot().entered)freeView?.leave();
  syncInputRoute();if(!enteringPreview)cancelPendingStart();
  keyboardInputView?.setScreen(screen);
  performanceView?.screenChanged(screen);engravedView.surfaceChanged();drawFrame();
}
shell=setupGameShell({i18n,pausePlayback,onPanel:name=>{scoreSaveNavigation++;referenceListening?.close();performanceListening?.stop({revokePolicy:true});cancelPendingStart();if(name==='results')updateResultsSummary()},onScreen:changeScreen,
  onNotation:()=>{engravedView.surfaceChanged();requestAnimationFrame(()=>{renderNotationPage();drawFrame()})}});
const noticeView=setupNoticeView({document,i18n,getScope:()=>state.score?.title});
lobbyPreview=setupLobbyPreview({document,i18n,api,allowed:()=>shell.screen()==='library'&&!startingPreview&&!document.hidden&&!document.querySelector('dialog[open]')});
preview=new ScorePreview({assistanceController:previewAssistance,assistanceContext:previewAssistanceBinding,resolveOptions:context=>{if(context.score.parts.length>128)return null;const saved=pitchMods.read(context);if(saved?.error)throw saved.error;const entry=saved?{mod:saved.song_mod,explicit:true}:songMods.read(context);return entry.explicit?{...songModOptions(entry.mod),songMod:entry.mod}:null;},prepareView:async(context,signal)=>{const saved=pitchMods.read(context);if(saved?.error)throw saved.error;return saved?.configuration.semitones?pitchViewContext(context,await preparePitchModView(context,saved.configuration.semitones,{api,signal})):context;},compile:(score,signal)=>api('/api/compile',score,signal),check:checkPreview,onChange:()=>{renderPreview();renderCatalog()}});

function notice(message, error = false) {
  noticeRevision++;
  noticeView.show(message,error);
}
function clearNotice() { noticeRevision++;noticeView.clear(); }
function compatibilityNotice(result) {const snapshot={...result,reasonParams:{...result.reasonParams}};return()=>compatibilityText(snapshot);}
async function api(path, body, signal) {
  const response = await fetch(path, {method: body === undefined ? 'GET' : 'POST', headers: body === undefined ? {} : {'Content-Type': 'application/json'}, body: body === undefined ? undefined : JSON.stringify(body), signal});
  let result;
  try { result = await response.json(); } catch { throw appError('app.serverUnreadable'); }
  if (!response.ok) throw result.error ? Object.assign(new Error(result.error),{code:result.code}) : appError('app.serverStatus',{status:response.status});
  return result;
}
const activityPolicyStamp=createPartActivityPolicyStamp();
function activityLifecycle(){return [state.cleanSong,state.compiled,state.score,state.generation,activityPolicyStamp(state.songMod,state.practiceSelection),state.practiceVersion,state.pitchView,stageAssistance.current()];}
function retireActivity(){partActivityStage?.retire({cleanSong:state.cleanSong,lifecycle:activityLifecycle()});}
function updateButtons() {
  refreshPracticeView();
  renderCanonicalAudio();
  const ready = Boolean(state.compiled);
  state.finishing = state.recorder.pending || state.assessmentBusy;
  const activePass = state.recorder.active;
  const checkingCurrent = Boolean(activePass && (activePass.manualDeadline !== null || activePass.inFlight || (activePass.closedWall !== null && activePass.assessedRevision < activePass.revision && !activePass.error)));
  const allowed = (!isBasicKeysSong(state.cleanSong)||hasBasicKeyRendition(state.cleanSong)||state.mode==='practice')&&(state.mode !== 'practice' || state.compatibility.status === 'ready'&&!assistancePracticeGate(stageAssistance)&&!basicPracticeGate());
  const liveSoundIssue=state.songMod?partInstrumentPolicyIssue(modInputPolicy(state.songMod,state,state.mode),state.score.parts,i18n.locale):'';
  const audioUnavailable=(!state.cleanSong||hasAudioThreadRendition(state.cleanSong)||modNeedsLiveAudio(state.songMod,state.mode))&&!synth.muted&&liveAudioUnavailable();
  $('play-button').disabled = !ready || canonicalSession.pausePending || (!transport.running && (!allowed || checkingCurrent || audioUnavailable || Boolean(liveSoundIssue)));
  bindAttribute($('play-button'),'title',()=>liveSoundIssue||(audioUnavailable?liveAudioUnavailableReason():''));
  $('reset-button').disabled = !ready;
  $('export-takes').disabled = state.recorder.passes.length === 0||canonicalSession.pausePending;
  $('retry-assessments').hidden = !state.recorder.passes.some(pass=>pass.error);
  $('export-button').disabled = !state.score||Boolean(state.cleanSong);
  $('export-jianpu').disabled = !state.score||isBasicKeysSong(state.cleanSong);
  bindAttribute($('export-jianpu'),'title',()=>isBasicKeysSong(state.cleanSong)?(i18n.locale==='en'?'This complete MIDI key projection is not supported by the single-part .jianpu text format. The numbered view and complete song-pack export remain available.':'完整 MIDI 按键投影不支持单声部 .jianpu 文本格式；仍可查看简谱并导出完整歌曲包。'):'');
  $('loop-apply').disabled = !ready||Boolean(state.cleanSong);
  for(const id of ['tempo','loop-enabled','loop-from','loop-to','metronome-enabled','metronome-pulse'])$(id).disabled=Boolean(state.cleanSong);
  $('count-in').disabled=isBasicKeysSong(state.cleanSong);
  if(!transport.running&&!state.playPending){if(transport.completed)retireActivity();cleanPlayer.stop();if(!canonicalSession.held)canonicalSession.stop();activeMedia?.pause();}
  renderCleanActive();
  $('assess-button').disabled = !ready || state.mode !== 'practice' || checkingCurrent || !allowed;
  $('practice-gate').hidden = state.mode !== 'practice' || state.compatibility.status === 'ready'&&!assistancePracticeGate(stageAssistance)&&!basicPracticeGate();
  bindText($('practice-gate-reason'), () => compatibilityText(basicPracticeGate()||assistancePracticeGate(stageAssistance)||state.compatibility));
  $('practice-gate-retry').disabled = !ready || state.compatibility.status === 'pending';
  bindText($('play-button'), () => transport.running ? t('app.pause') : transport.completed ? t('app.playAgain') : t('app.play'));
  $('workspace').dataset.scoreState=state.inspection?'inspection':'session';
  shell?.update({score:state.score,mode:state.mode,inspection:state.inspection,part:state.score?.parts.find(part=>part.id===state.practicePart)?.name,compatibility:{...state.compatibility,reason:compatibilityText(state.compatibility)},passes:state.recorder.passes.length});
}
function silenceHeld(reason = 'application_cleanup', eventWall = performance.now(), boundaryWall = null, recordEvidence = true) {
  scoreLiveStart=Math.max(scoreLiveStart,reason==='loop_clock_stall'?eventWall:boundaryWall??eventWall);
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
function pausePlayback(reason = 'app.paused', evidenceReason = 'pause', {redraw = true,preserveCanonical=false} = {}) {
  state.audioAdmissionController?.abort();
  lobbyPreview?.stop(['blur','hidden','pagehide'].includes(evidenceReason)?'interrupted':'stopped');
  if(referenceListening?.isOpen()){referenceListening.pause();return;}
  if(performanceListening?.isActive()){if(['blur','hidden','pagehide'].includes(evidenceReason))performanceListening.stop();else performanceListening.pause();return;}
  if(evidenceReason==='pause'&&!state.playPending&&transport.hasStarted)retireActivity();else partActivityStage?.clear();
  state.playTicket++;state.playPending=false;cleanPlayer.pause();activeMedia?.pause();
  if(shell?.screen()==='free'){freeView?.interrupt(evidenceReason);cleanupFreeInputs(evidenceReason);return;}
  // Opening a panel or browsing an already-paused session is not a new input
  // boundary. Real lifecycle events still matter even before a late onset arrives.
  const recordEvidence = evidenceReason !== 'pause' || transport.running || state.held.size > 0 || state.recorder.evidence.active.size > 0;
  const pauseTime = performance.now(); advanceLoopClock(pauseTime); const canonicalPosition=!state.cleanSong?canonicalSession.sourcePositionMs():null;
  const preserve=preserveCanonical&&!state.cleanSong&&canonicalSession.running,recorder=state.recorder,generation=state.generation;
  if(preserve){
    const pending=canonicalSession.pause();
    pending.then(result=>{if(!result||recorder!==state.recorder||generation!==state.generation||!canonicalSession.paused)return;transport.position=result.positionMs;recorder.pause(result.wallTime);updateButtons();drawFrame();}).catch(error=>{if(recorder!==state.recorder||generation!==state.generation)return;recorder.pause(pauseTime);notice(()=>canonicalAudioErrorText(i18n.locale,error),true);updateButtons();});
  }else{canonicalSession.stop();state.recorder.pause(pauseTime);}
  if (transport.running) {
    if(!state.loop&&(!state.cleanSong||hasAudioThreadRendition(state.cleanSong))&&(canonicalPosition??playbackPosition(pauseTime))>=state.compiled.timeline.duration_ms){
      if(state.mode==='practice')state.recorder.closeAtEnd(pauseTime);
      transport.finish(state.compiled.timeline.duration_ms);bindText($('transport-status'),()=>t('app.complete'));
    }else{transport.pause(pauseTime);if(canonicalPosition!==null)transport.position=canonicalPosition;bindText($('transport-status'),()=>typeof reason==='function'?reason():reason.startsWith('app.')?t(reason):reason);}
  }
  silenceHeld(evidenceReason,pauseTime,pauseTime,recordEvidence);metronome?.pause();
  if(redraw){updateButtons();drawFrame();}
}
function resetPlayback() {
  // Score/loop changes may already have published their new bounds in state.
  // Keep the ordinary pause cleanup/evidence boundary, but render only after
  // this reset has replaced the old completed transport with the new clock.
  pausePlayback(undefined,'pause',{redraw:false});
  partActivityStage?.clear();
  transport.reset();canonicalSession.interpretation=null;activeMedia?.sync({positionMs:0,running:false});
  if (state.loop) transport.seek(state.loop.start_ms);
  state.loopIteration = 1;state.canonicalPassIndex=0;state.canonicalBudgetEnded=false;metronome?.reset();
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
function playbackSeekBounds() {
  const duration=state.compiled?.timeline.duration_ms;
  if(!Number.isFinite(duration)||duration<=0)return null;
  return {start:state.loop?.start_ms??0,end:state.loop?.end_ms??duration};
}
function canSeekPlayback() {
  return state.mode==='listen'&&Boolean(playbackSeekBounds())&&shell?.screen()==='stage'&&!referenceInputActive();
}
function updateProgress(position,duration) {
  const progress=$('progress'),bounds=playbackSeekBounds();
  const scheduled=!state.cleanSong&&transport.running&&performance.now()<transport.startedAt;
  const clock=publishPlaybackClock(progress,{positionMs:position,durationMs:duration,rangeStartMs:bounds?.start??0,rangeEndMs:bounds?.end??duration,available:Boolean(state.compiled),running:transport.running&&!scheduled,completed:transport.completed,hasStarted:transport.hasStarted,preparing:state.playPending||scheduled});
  progress.min=bounds?.start??0;progress.max=bounds?.end??Math.max(1,duration);
  progress.value=Math.min(clock.rangeEndMs,Math.max(clock.rangeStartMs,clock.positionMs));
  progress.disabled=!canSeekPlayback();
  const help=()=>t(!bounds?'app.seekUnavailable':state.mode==='practice'?'app.seekPracticeDisabled':state.loop?'app.seekLoopHelp':'app.seekHelp');
  bindText($('progress-help'),help);bindAttribute(progress,'title',help);
  bindAttribute(progress,'aria-valuetext',()=>`${formatTime(position)} / ${formatTime(duration)}`);
  bindText($('time-label'),()=>state.inspection&&!state.compiled?(i18n.locale==='en'?'Source clock unavailable':'来源时钟不可用'):`${formatTime(position)} / ${formatTime(duration)}`);
}
function seekPlayback(value) {
  // Read the requested position before pausePlayback redraws the range control.
  const position=Number(value),bounds=playbackSeekBounds();
  if(!canSeekPlayback()||!Number.isFinite(position)){drawFrame();return;}
  pausePlayback('app.seekPaused','seek');
  transport.seek(Math.max(bounds.start,Math.min(bounds.end,position)));
  // Seeking establishes a source position. An explicit Play resumes it exactly,
  // without subtracting the four-beat initial count-in or replacing take history.
  transport.hasStarted=true;state.lastHighlight='';metronome?.reset();
  // There is no remaining source at the selected endpoint. Use the existing
  // explicit Replay path from source/loop start, never prepare beyond the end.
  const completed=transport.position===bounds.end;
  if(completed)transport.finish(bounds.end);
  activeMedia?.sync({positionMs:transport.position,running:false});
  bindText($('transport-status'),()=>t(completed?'app.complete':'app.seekPaused'));
  updateButtons();drawFrame();
}
async function compileScore(score, preserveTempo = false, expectedIntent = null, importDiagnostics = [], requestedPracticePart = undefined, requestedMode = undefined, requestedIdentity = undefined, cleanSong = null, inspection = false, practiceOptions = null) {
  if(preserveTempo&&state.cleanSong){notice(()=>cleanErrorText(i18n.locale,{code:'clean_derived_runtime_required'}),true);return false;}
  if (preserveTempo) importDiagnostics = state.importDiagnostics;
  const carryPitch=preserveTempo?state.pitchView:null,carryProfile=JSON.stringify(currentProfile()),carryNavigation=scoreSaveNavigation,carryScreen=shell.screen();
  if (expectedIntent !== null && expectedIntent !== state.loadIntent) return false;
  if (expectedIntent === null) {state.loadIntent++;cancelCatalogSelection();}
  if (new TextEncoder().encode(JSON.stringify(score)).byteLength > (isBasicKeysSong(cleanSong)?16:8) * 1024 * 1024) { notice(() => t('app.scoreTooLarge'), true); return false; }
  pausePlayback();
  state.compileController?.abort();
  const controller = new AbortController();
  state.compileController = controller;
  controller.signal.addEventListener('abort',()=>{if(state.compileController===controller){renderPreview();updateButtons();}},{once:true});
  const generation = ++state.generation, previewVersion = preview.version;
  // An imported title can render before Rust target admission finishes. Keep
  // the previous preview's actions unavailable until this source is adopted.
  renderPreview();
  state.finishing = false;
  $('play-button').disabled = true;
  bindText($('transport-status'), () => t('app.preparingScore'));
  try {
    let compiled = practiceOptions?.pitchView?practiceOptions.compiled:cleanSong?cleanSong.compilation:await api('/api/compile', score, controller.signal);
    let tempoPitch=null;
    if(carryPitch){tempoPitch=await prepareTempoPitchCarry(compiled,carryPitch.configuration.semitones,controller.signal);compiled=tempoPitch.effective.compiled;practiceOptions={...tempoPitch.options,compiled,pitchView:tempoPitch.effective.pitchView,songMod:tempoPitch.mod};}
    if (generation !== state.generation || controller.signal.aborted || expectedIntent!==null&&expectedIntent!==state.loadIntent || carryPitch&&(state.pitchView!==carryPitch||carryProfile!==JSON.stringify(currentProfile())||carryNavigation!==scoreSaveNavigation||carryScreen!==shell.screen()||document.hidden)) return;
    if(isBasicKeysSong(cleanSong)&&compiled&&!inspection&&(requestedMode??state.mode)==='practice'){
      const selection=resolvePracticeSelection(compiled.score.parts,practiceOptions?.practiceSelection??{kind:'parts',part_ids:[requestedPracticePart||compiled.score.parts[0]?.id].filter(Boolean)}),candidate={...practiceOptions,score:compiled.score,compiled,cleanSong};
      const current=()=>generation===state.generation&&!controller.signal.aborted&&(expectedIntent===null||expectedIntent===state.loadIntent)&&carryProfile===JSON.stringify(currentProfile())&&carryNavigation===scoreSaveNavigation&&!document.hidden;
      const admission=await preparePracticeAdmission(compiled,selection,currentProfile(),practiceOptions?.assistance||null,null,controller.signal,candidate,current);
      if(admission?.basicAdmission&&!current())return;assertBasicHumanAssignment(admission);
      if(admission.compatibility.status!=='ready')throw new Error(compatibilityText(admission.compatibility));
    }
    if(tempoPitch){tempoPitch.commit();songMods.commitSaved(tempoPitch.source,tempoPitch.mod);}
    // A rejected or cancelled replacement still owns the previous take and
    // checked assignment. Invalidate them only when a new source is accepted.
    stageAssistance.reset();
    // Reset before publishing the new score: resetPlayback() can immediately
    // draw and start the new score's lazy cursor request.
    writtenCursor?.reset();
    const previousPart = requestedPracticePart !== undefined ? requestedPracticePart : preserveTempo ? state.practicePart : null;
    state.pitchView=practiceOptions?.pitchView||null;state.cleanSong=cleanSong;libraryManagement?.catalog.sessionChanged();if(!cleanSong){previewMedia?.clear();previewMediaKey=null;}cleanMutedParts.clear();cleanSoloParts.clear();cleanPlayer.select(cleanSong);activeMedia?.clear();activeMediaKey=null;
    state.score = compiled?.score||score;state.songMod=practiceOptions?.songMod||(preserveTempo?state.songMod:null);if(state.songMod){const context={score:state.score,cleanSong,pitchView:state.pitchView,practiceSelection:state.practiceSelection,practiceLayout:state.practiceLayout,showOthers:state.showOtherParts},identity=songMods.identity(context),changed=state.songMod.songId!==identity.songId||state.songMod.sourceRevision.kind!==identity.sourceRevision.kind||state.songMod.sourceRevision.value!==identity.sourceRevision.value;state.songMod=createSongMod(identity,state.songMod.config);if(changed)songMods.save(context,state.songMod);}state.hiddenPartIds=new Set(state.songMod?songModOptions(state.songMod).hiddenPartIds:[]);if(state.songMod)for(const id of songModOptions(state.songMod).mutedPartIds)cleanMutedParts.add(id);state.inspection=inspection;
    if(requestedMode!==undefined){state.mode=requestedMode;$('session-mode').value=requestedMode;}
    state.importDiagnostics = importDiagnostics;
    const diagnostics = [...new Map([...(compiled?.diagnostics||[]), ...importDiagnostics].map(item => [`${item.code}:${item.note_id || ''}:${item.message}`, item])).values()];
    // Complete songs keep the exact admitted runtime identity for navigation.
    state.compiled = state.pitchView||isBasicKeysSong(cleanSong)?compiled:compiled?{...compiled, diagnostics}:null;
    canonicalSession.select(cleanSong?null:state.compiled,state.pitchView?.audioProfile||null);
    state.instrumentOutOfRange = null; state.instrumentConflict = false;
    state.timelineIndex = state.compiled?new TimelineIndex(state.compiled.timeline.notes):null;
    invalidateBasicPracticeAdmission();state.practiceTimeline=null;state.sourceTargetTimeline=null;state.targetTimeline=null;state.practicePlan=null;state.targetGroups=new Map();state.physicalIndex=null;state.practiceIndex=null;
    state.compatibility={status:'blocked',reasonKey:'app.compatibilityPlanBlocked'};
    metronome?.cancelForScore();
    state.sourceNotes = new Map(state.score.parts.flatMap(part => part.notes.map(note => [note.id, {note, partId: part.id}])));
    state.practiceLayout=practiceOptions?.practiceLayout||(preserveTempo?state.practiceLayout:'solo');state.showOtherParts=practiceOptions?.showOthers??(preserveTempo?state.showOtherParts:true);
    state.loop = null; state.loopRequest++; state.practicePart = previousPart !== null && state.score.parts.some(part => part.id === previousPart) ? previousPart : cleanSong?state.score.parts[0]?.id:null; state.practiceSelection=resolvePracticeSelection(state.score.parts,practiceOptions?.practiceSelection??(preserveTempo?state.practiceSelection:null)??(state.practicePart===null?{kind:'all'}:{kind:'parts',part_ids:[state.practicePart]}));if(tempoPitch)tempoPitch.install();else void stageAssistance.restore();rebuildPracticeScope(); $('loop-enabled').checked = false; bindText($('loop-status'), () => t('app.loopCleared'));
    state.notationPage = 0; state.notationPart = hasBasicKeyRendition(cleanSong)?state.practicePart:cleanSong ? null : state.practicePart || state.score.parts[0].id;
    if (!preserveTempo) $('tempo').value = String(displayOpeningTempo(state.score,cleanSong));
    clearNotice();
    notationFollowing?.scoreChanged();completeScoreReader?.scoreChanged();
    resetPlayback();
    renderScore(); sourceArchiveView?.scoreChanged(); libraryView.scoreChanged(); scoreStorageView?.render(); adaptationView?.scoreChanged(); transpositionView?.scoreChanged(); renderCatalog(); updateRangeWarning();
    bindText($('catalog-status'), () => t('app.currentSession', {title:state.score.title}));
    const clockScore=state.score;if(tempoPitch){if(tempoPitch.admission)installPracticeAdmission(tempoPitch.admission);else{state.compatibility={status:'ready'};updateButtons();}}else await checkInstrument();
    const current=()=>state.compileController===controller&&!controller.signal.aborted&&state.score===clockScore&&(expectedIntent===null||expectedIntent===state.loadIntent);
    if(current()){if(!state.cleanSong)metronome?.setScore();if(state.compiled&&preview.version===previewVersion)preview.adopt(state.compiled,previewCompatibility(state.compatibility),state.practicePart,requestedIdentity,state.cleanSong,{practiceSelection:state.practiceSelection,practiceLayout:state.practiceLayout,showOthers:state.showOtherParts,songMod:state.songMod,pitchView:state.pitchView});syncCleanMedia();}
    return current();
  } catch (error) {
    if (error.name === 'AbortError') return;
    if (generation !== state.generation) return;
    notice(() => t('app.loadError', {detail:errorDetail(error)}), true);
    $('tempo').value = String(displayOpeningTempo(state.score));
    bindText($('transport-status'), () => state.compiled ? t('app.previousScoreAvailable') : t('app.scoreUnavailable'));
    updateButtons();
  } finally {
    if(state.compileController===controller){if(carryPitch&&state.pitchView===carryPitch)$('tempo').value=String(displayOpeningTempo(state.score));state.compileController=null;renderPreview();updateButtons();}
  }
}
function songRows() {
  // Keep shipped catalog identifiers compatible; saved editions have their own
  // backend/copy identity even when their canonical score.id matches a catalog.
  return buildSongList(state.catalog,scoreStorage?.snapshot().entries||[],{catalogIdentity:item=>item.id});
}
function savedStorageLabel(kind) {return i18n.locale==='en'?(kind==='native'?'Saved on this computer':'Saved in this browser'):(kind==='native'?'本机已存谱面':'浏览器已存谱面');}
function rowScore(row) {return row?.catalog||(row?.saved?{...row.saved,provenance:row.saved.provenance||{kind:'user_import'}}:null);}
function renderCatalog() {
  const catalog=$('catalog'),rows=songRows(),origin=$('catalog-origin').value;
  bindText($('catalog-count'), () => String(rows.length));
  const filtered=rows.filter(row=>filterCatalog([rowScore(row)],$('catalog-search').value,origin).length),wanted=new Set(filtered.map(row=>row.selectionKey));
  for(const child of [...catalog.children])if(!child.classList.contains('catalog-item')||!wanted.has(child.dataset.songKey))child.remove();
  const existing=new Map([...catalog.children].map(button=>[button.dataset.songKey,button]));
  filtered.forEach((row,index)=>{
    let button=existing.get(row.selectionKey);
    if(!button){
      button=document.createElement('button');button.className='catalog-item';button.dataset.songKey=row.selectionKey;
      if(row.source==='catalog')button.dataset.scoreId=row.scoreId;else button.dataset.libraryKey=row.libraryKey;
      const number=document.createElement('span');number.className='number';const label=document.createElement('span');label.append(document.createElement('strong'),document.createElement('small'));button.append(number,label);
      button.addEventListener('click',()=>selectSongScore(row.selectionKey));
    }
    const selected=preview?.value.identity===row.selectionKey,loading=preview?.value.status==='loading'&&selected;
    button.classList.toggle('selected',selected);button.setAttribute('aria-pressed',String(selected));button.setAttribute('aria-busy',String(loading));button.classList.toggle('loading',loading);
    bindText(button.querySelector('.number'), () => String(index+1).padStart(2,'0'));bindText(button.querySelector('strong'), () => row.title);
    bindText(button.querySelector('small'), () => row.source==='saved'?`${savedStorageLabel(row.saved.storageKind)} · ${row.composer||t('app.composerUnknown')}${loading?` · ${t('app.loadingSuffix')}`:''}`:t('app.catalogItem', {count:row.catalog.written_event_count,bpm:row.catalog.opening_bpm,origin:originLabel(row.catalog),loading:loading?t('app.loadingSuffix'):''}));
    if(catalog.children[index]!==button)catalog.insertBefore(button,catalog.children[index]||null);
  });
  if(!filtered.length&&rows.length){const empty=document.createElement('p');empty.className='catalog-empty';bindText(empty, () => t('app.catalogNoMatch'));catalog.append(empty)}
  if(catalogIndexFailed){const retry=document.createElement('button');retry.className='button secondary';bindText(retry, () => t('app.catalogRetry'));retry.disabled=Boolean(catalogIndexController);retry.addEventListener('click',loadCatalog);catalog.append(retry)}
}
function scoreSaveContext(owner) {
  return owner?{...owner,previewVersion:preview.version,navigation:scoreSaveNavigation,noticeRevision}:null;
}
function beginExplicitScoreSave(action) {
  if(action==='saveCurrent')pendingScoreSaveOwner={score:state.score,intent:state.loadIntent};
  // Retry/Keep both still belong to the original import or explicit save,
  // even when another score with the same canonical ID is now active.
  return scoreSaveContext(pendingScoreSaveOwner);
}
function finishScoreSave(result,context) {
  // Disk/model results remain in settings. Only the matching live source and
  // uninterrupted preview/navigation may update the app's current selection.
  if(result.status==='skipped'||!context||state.score!==context.score||state.loadIntent!==context.intent||preview.value.score!==context.score||preview.version!==context.previewVersion||preview.controller||scoreSaveNavigation!==context.navigation)return;
  if(['saved','duplicate'].includes(result.status)){
    const entry=result.entry||result.existing;if(entry)preview.publish({...preview.value,identity:entry.libraryKey});
  }
  if(noticeRevision===context.noticeRevision)notice(()=>describePersistenceResult(result,{kind:scoreStorage.snapshot().kind,locale:i18n.locale}),['failed','uncertain','conflict'].includes(result.status));
}
function persistAcceptedImport(ticket,score,{intent,signal,scoreJson}={}) {
  if(intent!==state.loadIntent||signal?.aborted)return;
  pendingScoreSaveOwner={score:state.score,intent};
  const context=scoreSaveContext(pendingScoreSaveOwner);
  void scoreStorage.persistImported(ticket,score,{activated:true,signal,scoreJson}).then(result=>finishScoreSave(result,context));
}
function basicMeterLabel() {
  return isBasicKeysSong(state.cleanSong)&&state.cleanSong.score.performance.timing.meter!=='source_declared'?(i18n.locale==='en'?'Source meter unavailable · MIDI key projection':'源拍号未确定 · MIDI 按键投影'):null;
}
function displayOpeningTempo(score,song=state.cleanSong) {
  if(isBasicKeysSong(song))return score?.tempo.find(change=>change.at.numerator===0)?.bpm??(song.score.performance.timing.smf_default_tempo_used?120:'');
  return score?.tempo[0]?.bpm||100;
}
function renderScore() {
  if (!state.score) return;
  const score = state.score;engravedView.updateScore();const viewScope=engravedView.scopeInfo();state.notationPart=viewScope.scope==='all'?null:viewScope.partId;
  const summary = scoreSummary(score,state.compiled?.timeline),diagnostics=state.compiled?.diagnostics||state.importDiagnostics;
  bindText($('score-title'), () => score.title);
  bindText($('score-meta'), () => state.compiled?t('app.scoreMeta', {composer:score.composer||t('app.composerUnknown'),written:summary.writtenCount,playback:summary.playbackCount,measures:summary.measures,parts:summary.parts}):(i18n.locale==='en'?`${summary.writtenCount} determined written keys · ${summary.parts} parts · timed practice unavailable`:`${summary.writtenCount} 个已确定谱面按键 · ${summary.parts} 个声部 · 定时练习不可用`));
  bindText($('score-origin-label'), () => originLabel(score));
  bindText($('score-details-button'), () => t('app.sourceDetails', {count:diagnostics.length}));
  bindText($('score-retention-note'), () => t('app.retention', {notes:summary.count,rests:summary.rests,edition:score.provenance.kind==='curated_cc0_edition'?t('app.retentionSourceEdition'):t('app.retentionCounts')}));
  bindText($('score-key'), () => basicMeterLabel()||t('app.scoreMeter', {numerator:score.meters[0]?.numerator||4,denominator:score.meters[0]?.denominator||4}));
  $('notation-part').replaceChildren();
  const shownAll=document.createElement('option');shownAll.value='';bindText(shownAll, () => t('app.allParts'));$('notation-part').append(shownAll);
  for (const part of score.parts) { const option = document.createElement('option'); option.value = part.id; bindText(option, () => part.name); $('notation-part').append(option); }
  $('notation-part').value = state.notationPart || '';
  $('practice-part').replaceChildren();
  if(!state.cleanSong){const all = document.createElement('option'); all.value = ''; bindText(all, () => t('app.allParts')); $('practice-part').append(all);}
  for (const part of score.parts) { const option = document.createElement('option'); option.value = part.id; option.disabled=isBasicKeysSong(state.cleanSong)&&!basicKeysParts(state.cleanSong).some(item=>item.id===part.id&&item.practice_available); bindText(option, () => part.name); $('practice-part').append(option); }
  $('practice-part').value = state.practicePart || '';
  updatePracticeScopeLabel();
  renderNotationPage();
  bindText($('provenance'), () => t('app.provenance', {kind:score.provenance.kind,attribution:attributionText(score),license:score.provenance.license?t('app.license',{license:score.provenance.license}):t('app.rightsNote')}));
  $('provenance-link').hidden = true;
  if (score.provenance.source_url) { try { const url = new URL(score.provenance.source_url); if (url.protocol === 'https:') { $('provenance-link').href = url.href; $('provenance-link').hidden = false; } } catch { /* Preserve invalid source text in exported score, but never turn it into an unsafe link. */ } }
  bindText($('diagnostic-count'), () => diagnostics.length ? `(${diagnostics.length})` : '');
  $('diagnostic-list').replaceChildren();
  diagnostics.forEach(diagnostic => {
    const li = document.createElement('li'); li.className = diagnostic.severity; bindText(li, () => `${diagnostic.code}: ${diagnosticText(diagnostic)}`); $('diagnostic-list').append(li);
  });
  state.lastHighlight = '';
  engravedView.updateScore();
  updateButtons();
  drawFrame();
}
function humanPartIds(){if(!state.score||!state.practiceSelection)return new Set();return humanPracticePartIds(state.score?.parts||[],{mode:state.mode,practiceSelection:state.practiceSelection,targetPart:state.practicePart});}
function refreshPracticeView(){$('practice-part')?.closest('label')?.toggleAttribute('hidden',state.mode==='practice'&&state.practiceLayout==='complete');const available=value=>Boolean(value?.compiled)&&(!value.cleanSong||hasBasicKeyRendition(value.cleanSong)||isVsqSong(value.cleanSong)&&Boolean(value.cleanSong.runtime));completePracticeView?.update({previewAvailable:available(preview?.value),previewReady:!startingPreview&&preview?.value.status==='ready'&&available(preview.value),stageReady:available(state),mode:state.mode,layout:state.practiceLayout,selection:state.practiceSelection,parts:state.score?.parts||[],showOthers:state.showOtherParts});refreshSongModView();}
function proceduralMachineOnly(song,mode){return Boolean(song&&mode==='listen'&&!hasAudioThreadRendition(song)&&inspectCleanRendition(song).supported);}
function modNeedsLiveAudio(mod,mode=mod?songModOptions(mod).mode:'listen'){return Boolean(mod&&mode==='practice'&&mod.config.parts.some(part=>part.performer==='human'));}
function liveAudioUnavailable(){return Boolean(synth.liveError)||typeof globalThis.AudioWorkletNode!=='function'||Boolean(synth.context&&!synth.context.audioWorklet);}
function liveAudioUnavailableReason(){return synth.liveError?liveAudioErrorText(synth.liveError):cleanErrorText(i18n.locale,{code:'clean_audio_worklet_unavailable'});}
function assertModLiveAudioSupported(mod,mode){if(!synth.muted&&modNeedsLiveAudio(mod,mode)&&liveAudioUnavailable())throw synth.liveError||Object.assign(new Error(liveAudioUnavailableReason()),{code:'clean_audio_worklet_unavailable'});}
function modInputBinding(mod,context,mode=songModOptions(mod).mode){return {mod,identity:songMods.identity(context),parts:context.score.parts,performanceInstrument:state.instrument,mode,assistance:context.assistance??(context===state?stageAssistance.current():null)};}
function modInputPolicy(mod,context,mode){return createPartInstrumentPolicy(mod,modInputBinding(mod,context,mode));}
function modContext(origin,{loadSourceDetails=false}={}) {
  const value=origin==='preview'?preview.value:{score:state.score,compiled:state.compiled,cleanSong:state.cleanSong,pitchView:state.pitchView,mode:state.mode,practiceSelection:state.practiceSelection,practiceLayout:state.practiceLayout,showOthers:state.showOtherParts};
  if(!value?.score||!value.compiled||value.score.parts.length>128)return null;
  const storedPitch=pitchMods.read(value),baseEntry=songMods.read(value),entry=storedPitch&&!storedPitch.error?{...baseEntry,mod:storedPitch.song_mod,status:'saved',explicit:true}:baseEntry,assistanceController=origin==='stage'?stageAssistance:previewAssistance,assistance=assistanceController.current(),persistence=assistanceController.state().persistence;
  return {...value,...entry,...sourceInstrumentDetails.read(value,{load:loadSourceDetails}),...sourceIdentity.read(value,{load:loadSourceDetails}),origin,pitchPreferenceRaw:storedPitch?.raw??null,pitchError:storedPitch?.error||null,assistanceController,assistance,assistanceStatus:assistance&&persistence.status==='off'?'session':persistence.storageUnavailable?'sessionDefault':persistence.status,performanceInstrument:state.instrument,mod:origin==='stage'&&state.songMod?state.songMod:entry.mod,capabilities:{...songModCapabilities(value),liveAudio:synth.muted||!liveAudioUnavailable(),liveAudioReason:synth.liveError?liveAudioErrorText(synth.liveError):''},previewVersion:preview.version,navigation:scoreSaveNavigation,generation:state.generation,hasTakes:origin==='stage'&&(transport.hasStarted||state.recorder.passes.length>0)};
}
function scoreAdmissionPending(){return Boolean(state.compileController&&!state.compileController.signal.aborted||directMidiImportOwner?.current());}
function refreshSongModView(){
  if(!songModView)return;
  const candidate=modContext('preview'),active=modContext('stage');let reason='',canStart=false,rangeRepair=null;
  if(candidate){try{if(candidate.pitchError)throw candidate.pitchError;assertSongModSupported(candidate.mod,candidate.capabilities,{assistance:candidate.assistance});assertPartInstrumentPolicyReady(modInputPolicy(candidate.mod,candidate),candidate.score.parts,i18n.locale);const options=songModOptions(candidate.mod);canStart=!startingPreview&&preview.canStart(options.mode);if(!canStart){reason=compatibilityText(preview.value.compatibility);rangeRepair=previewRangeRepair(candidate,options.mode);}if((candidate.capabilities.audioThread||modNeedsLiveAudio(candidate.mod))&&!synth.muted&&liveAudioUnavailable()){canStart=false;reason=liveAudioUnavailableReason();}}catch(error){reason=i18n.locale==='en'?error.message:'当前 Mod 无法播放：'+error.message;}}
  if(preview.value.score?.parts.length>128)reason=i18n.locale==='en'?'This source exceeds the 128-part Mod budget. Inspect the complete source below.':'此来源超出 Mod 的 128 声部预算；可在下方查看完整来源。';if(!candidate&&preview.value.status==='choice')reason=i18n.locale==='en'?'Choose the basic instrumental renderer below to configure this source.':'请先在下方选择基础器乐渲染器，再配置此来源。';songModView.update({preview:candidate,stage:active,stageReason:active?partInstrumentPolicyIssue(modInputPolicy(active.mod,active,state.mode),active.score.parts,i18n.locale):'',canStart:canStart&&!scoreAdmissionPending(),rangeRepair,admitting:scoreAdmissionPending(),reason:scoreAdmissionPending()?t('app.preparingScore'):reason,inspectionOnly:(preview.value.status==='inspection'||preview.value.score?.parts.length>128)&&Boolean(preview.value.score)});
}
function previewRangeRepair(candidate,mode=songModOptions(candidate.mod).mode){
  const targets=candidate.assistance?scopedAssistanceTargets(candidate.assistance,candidate.compiled.timeline,null).sourceTimeline.notes:practiceScope(candidate.compiled.timeline,candidate.practiceSelection,null).targets.notes;
  return practiceRangeRepair({mode,compatibility:preview.value.compatibility,profile:currentProfile(),targets});
}
function repairPreviewRange(kind){
  // Re-read the current candidate after navigation or a pending admission. The
  // explicit click changes only the device profile, never source notes or Mod.
  if(scoreAdmissionPending()||startingPreview)return;
  const candidate=modContext('preview');if(!candidate)return;
  const repair=previewRangeRepair(candidate);if(repair?.kind!==kind)return;
  if(kind==='piano88'){$('key-count').value='88';$('key-count').dispatchEvent(new window.Event('change',{bubbles:true}));}
  else openCleanRangeSetup();
}
async function prepareTempoPitchCarry(compiled,semitones,signal){
  const source={score:compiled.score,compiled,cleanSong:null,mode:state.mode,practiceSelection:state.practiceSelection,practiceLayout:state.practiceLayout,showOthers:state.showOtherParts},mod=createSongMod(songMods.identity(source),state.songMod?.config||songMods.read(source).mod.config),options=songModOptions(mod);
  source.songMod=mod;const view=await preparePitchModView(source,semitones,{api,signal}),effective=pitchViewContext(source,view),saved=pitchMods.read(source);if(saved?.error)throw saved.error;
  const previous=stageAssistance.state(),active=stageAssistance.current(),draft=createPitchDraftController(source,view);let checked=null;
  if(active){draft.assistanceController.beginDraft();draft.assistanceController.setDraft({mode:previous.progression?'progression':active.plan.mode,settings:active.plan.settings,layer:previous.progression?.plan.layer});checked=await draft.assistanceController.prepareDraft();if(!checked)throw new Error('The tempo change needs a fresh checked assignment. The previous song is unchanged.');}
  else if(previous.persistence.recipe||!['default','off'].includes(previous.persistence.status))throw new Error('Check the current assignment in Mod before changing tempo. The previous song is unchanged.');
  else if(previous.persistence.status==='off'){draft.assistanceController.beginDraft();draft.assistanceController.disableDraft({resetConfirmed:true});}
  if(signal.aborted)throw Object.assign(new Error('Tempo change cancelled.'),{name:'AbortError'});
  const admission=options.mode==='practice'?await preparePracticeAdmission(effective.compiled,options.practiceSelection,currentProfile(),checked,null):null;
  const binding=checked?()=>({...appAssistanceContext({...effective,songMod:mod},currentProfile(),songMods.identity(source)),mode:checked.plan.mode,settings:checked.plan.settings,revision:checked.plan.revision,expected_selection_digest:checked.plan.selection_digest}):undefined;
  const playbackOptions=songModOptions(mod,{assistance:checked});buildCanonicalAudioPlan(effective.compiled,view.audioProfile,{sampleRate:synth.context?.sampleRate||48000,...playbackOptions,...(checked&&!checked.plan.selection.selected_part_ids.length?{practiceSelection:{kind:'parts',part_ids:[]}}:{}),assistance:checked,assistanceContext:binding,acceptedPolicyId:CANONICAL_AUDIO_POLICY});
  return {source,effective,mod,options:playbackOptions,admission,install:()=>draft.install('stage'),commit(){if(checked)draft.assistanceController.commitDraft({resetConfirmed:true});pitchMods.save(source,view.configuration,mod,{records:Object.fromEntries(draft.records),expectedRaw:saved?.raw??null});}};
}
function createPitchDraftController(context,view,{restore=false}={}){
  let installed=null,bindingMod=context.songMod||context.mod;const effective=view?pitchViewContext(context,view):context,records=new Map(),storage={getItem:key=>installed?pitchMods.preferences.getItem(key):records.get(key)??null,setItem:(key,raw)=>installed?pitchMods.preferences.setItem(key,raw):records.set(key,raw)},profile=currentProfile(),admissionKey=context.origin==='stage'?assistanceContext('stage')?.admissionKey:'null',binding=()=>installed?assistanceContext(installed):({...appAssistanceContext({...effective,songMod:bindingMod},profile,songMods.identity(context)),admissionKey});
  if(restore){for(const store of [assistanceStore,progressionStore]){const key=store.key(binding()),raw=pitchMods.preferences.getItem(key);if(raw!==null)records.set(key,raw);}}
  const controller=createPracticeAssistanceController({api,store:new AppAssistanceStore({storage}),progressionStore:new PracticeProgressionStore({storage}),getContext:binding,onChange:assistanceChanged});
  // A detached draft may reuse the current immutable receipt until its settings
  // change. Display/mute edits must not turn a fresh pitch view into a new take.
  const current=restore?context.assistance:null,assistanceController=current?{...controller,state(){const value=controller.state();return {...value,active:value.active||current};},current(){return controller.current()||current;}}:controller;
  return {view,assistanceController,records,effective,prepareUnassisted(mod){bindingMod=mod;controller.beginDraft();},install(where){installed=where;if(where==='stage')stageAssistance=controller;else{previewAssistance=controller;preview.assistanceController=controller;}return controller;}};
}
function getSongModAssistanceController(where,context){return context.pitchView||pitchMods.read(context)?createPitchDraftController(context,context.pitchView,{restore:true}):context.assistanceController;}
async function checkSongPitchMod(context,semitones){
  const view=await preparePitchModView(context,semitones,{api});return createPitchDraftController(context,view);
}
async function applySongMod({origin,context,mod,pitchView=null,pitchChanged=false,pitchResetConfirmed=false,assistance=null,assistanceChanged=false,assistanceDisabled=false,resetConfirmed=false,commitAssistance=()=>assistance,isCurrent=()=>true,commit=()=>true}) {
  validateSongMod(mod,{identity:songMods.identity(context),parts:context.score.parts});assertSongModSupported(mod,songModCapabilities(context),{assistance});assertModLiveAudioSupported(mod);
  const effective=pitchChanged?pitchViewContext(context,pitchView):context;
  if(pitchChanged&&(!pitchView||pitchView.sourceView.score!==originalPitchContext(context).score))throw new Error('Check the pitch against the current original song before applying.');
  if(pitchChanged&&origin==='stage'&&context.hasTakes&&!pitchResetConfirmed)throw new Error('Confirm that applying this pitch restarts the session and clears its takes.');
  const prospective={...effective,songMod:mod,mod,assistance},livePolicy=assertPartInstrumentPolicyReady(modInputPolicy(mod,prospective),context.score.parts,i18n.locale);
  const options=songModOptions(mod,{assistance}),changes=songModChanges(context.mod,mod),requiresReset=changes.requiresReset||assistanceChanged||pitchChanged;
  if(origin==='stage'&&requiresReset&&(assistanceChanged||context.assistance||context.assistanceController?.state().persistence.recipe)&&(context.hasTakes||context.assistance||context.assistanceController?.state().persistence.recipe)&&!resetConfirmed)throw new Error('Confirm that changing this assignment restarts the session and clears its takes.');
  const profileSnapshot=JSON.stringify(currentProfile()),loop=origin==='stage'?state.loop:null,loopRequest=state.loopRequest,practiceVersion=state.practiceVersion;
  const current=()=>isCurrent()&&profileSnapshot===JSON.stringify(currentProfile())&&!scoreAdmissionPending()&&context.generation===state.generation&&!document.hidden&&context.navigation===scoreSaveNavigation&&(origin==='stage'?context.mode===state.mode&&context.score===state.score&&state.loop===loop&&state.loopRequest===loopRequest&&state.practiceVersion===practiceVersion&&shell.screen()==='stage':context.score===preview.value.score&&context.identity===preview.value.identity&&context.previewVersion===preview.version&&shell.screen()==='library');
  function assertCandidate(){
    if(!assistance)return;
    const live=appAssistanceContext({...effective,songMod:mod},currentProfile(),songMods.identity(context));
    const binding={...live,mode:assistance.plan.mode,settings:assistance.plan.settings,revision:assistance.plan.revision,expected_selection_digest:assistance.plan.selection_digest};assertPracticeAssistanceCurrent(assistance,binding);return binding;
  }
  if(!current())return;assertCandidate();
  let admission=null;
  if(options.mode==='practice'&&(origin==='preview'||requiresReset||isBasicKeysSong(effective.cleanSong))){
    try{admission=await preparePracticeAdmission(effective.compiled,options.practiceSelection,currentProfile(),assistance,loop,undefined,effective,current);}
    catch(error){if(!current())return;throw error;}
  }
  if(admission?.basicAdmission&&!current())return;assertBasicHumanAssignment(admission);
  const compatibility=admission?.compatibility||(origin==='preview'?{status:'ready'}:state.compatibility);
  // The lobby always starts the full source. A valid stage A/B range must not
  // make out-of-range notes elsewhere appear admitted in that preview.
  const fullCompatibility=loop&&requiresReset&&options.mode==='practice'?(await preparePracticeAdmission(effective.compiled,options.practiceSelection,currentProfile(),assistance,null,undefined,effective,current)).compatibility:compatibility;
  if(admission?.basicAdmission&&!current())return;assertBasicHumanAssignment(admission);
  if(assistance||assistanceDisabled||pitchChanged){
    const audioOptions={sampleRate:synth.context?.sampleRate||48000,mode:options.mode,practiceSelection:assistance&&!assistance.plan.selection.selected_part_ids.length?{kind:'parts',part_ids:[]}:options.practiceSelection,instrumentOverrides:options.instrumentOverrides,mutedPartIds:options.mutedPartIds,mutedParts:options.mutedPartIds,instrument:state.instrument,assistance,assistanceContext:assertCandidate,...(loop?{range:{startMs:loop.start_ms,endMs:loop.end_ms},loop:{enabled:true}}:{})};
    if(!effective.cleanSong){const audioProfile=effective.pitchView?.audioProfile||await api('/api/canonical-audio-profile',effective.compiled.score);if(!current())return;buildCanonicalAudioPlan(effective.compiled,audioProfile,{...audioOptions,acceptedPolicyId:CANONICAL_AUDIO_POLICY});}
    else if(hasBasicKeyRendition(effective.cleanSong))buildBasicKeyAudioPlan(effective.cleanSong,audioOptions);
    else if(isVsqSong(effective.cleanSong))buildVsqAudioPlan(effective.cleanSong,audioOptions);
  }
  if(origin==='stage'&&changes.mix&&canonicalSession.pendingPause){await canonicalSession.pendingPause;await Promise.resolve();}
  if(!current())return;assertCandidate();
  assertPartInstrumentPolicyCurrent(livePolicy,modInputBinding(mod,prospective));assertModLiveAudioSupported(mod);
  if(context.pitchDraft&&!assistance&&!assistanceChanged)context.pitchDraft.prepareUnassisted(mod);
  // No callbacks, DOM publication or await may split checked ownership from
  // its matching Mod/selection. All fallible preparation precedes this boundary.
  assertBasicHumanAssignment(admission);
  commitAssistance();
  const usesPitchPreference=pitchChanged||Boolean(context.pitchView)||Boolean(pitchMods.read(context));
  if(usesPitchPreference){
    try{pitchMods.save(context,pitchModConfiguration(pitchModSemitones(effective)),mod,{records:context.pitchDraft?Object.fromEntries(context.pitchDraft.records):undefined,expectedRaw:context.pitchPreferenceRaw});}
    catch(error){if(context.pitchDraft)context.assistanceController.beginDraft();throw error;}
    songMods.commitSaved(context,mod);
  }
  if(origin==='preview'){
    preview.value={...preview.value,...(pitchChanged?{score:effective.score,compiled:effective.compiled,cleanSong:effective.cleanSong,pitchView:effective.pitchView}:{}),...options,songMod:mod,assistance,compatibility};
  }else{
    if(pitchChanged){
      writtenCursor?.reset();state.pitchView=effective.pitchView;state.score=effective.score;state.compiled=effective.compiled;state.cleanSong=effective.cleanSong;state.timelineIndex=new TimelineIndex(state.compiled.timeline.notes);state.sourceNotes=new Map(state.score.parts.flatMap(part=>part.notes.map(note=>[note.id,{note,partId:part.id}])));cleanPlayer.select(state.cleanSong);canonicalSession.select(state.cleanSong?null:state.compiled,state.pitchView?.audioProfile||null);stageAssistance.reset();
    }
    state.songMod=mod;state.mode=options.mode;state.practiceSelection=resolvePracticeSelection(state.score.parts,options.practiceSelection);
    state.practicePart=state.practiceSelection.kind==='all'&&!state.cleanSong?null:state.practiceSelection.part_ids[0]||null;
    state.practiceLayout=options.practiceLayout;state.showOtherParts=options.showOthers;state.hiddenPartIds=new Set(options.hiddenPartIds);
    if(requiresReset){state.loopRequest++;rebuildPracticeScope({publish:false});if(admission)installPracticeAdmission(admission,{publish:false,committed:true});else{state.compatibility={status:'ready'};state.targetTimeline=null;state.practicePlan=null;}}
    else if(admission)installPracticeAdmission(admission,{publish:false,committed:true});
  }
  if(!usesPitchPreference)songMods.save(context,mod);
  const installedPitchDraft=context.pitchDraft&&(pitchChanged||assistanceChanged);if(installedPitchDraft)context.pitchDraft.install(origin);
  if(!commit())throw new Error('The Mod dialog changed during the synchronous commit.');
  if(!installedPitchDraft)void (origin==='preview'?previewAssistance:stageAssistance).restore();
  if(origin==='preview'){
    preview.cancel({preserveAssistance:true});preview.publish(preview.value);
  }else{
    cleanMutedParts.clear();cleanSoloParts.clear();for(const id of options.mutedPartIds)cleanMutedParts.add(id);
    $('session-mode').value=state.mode;$('practice-part').value=state.practicePart||'';
    if(requiresReset){
      $('loop-enabled').checked=Boolean(state.loop);updateLoopStatus();updatePracticeScopeLabel();renderTargetMappings();resetPlayback();
    }else if(changes.mix)canonicalSession.stop();
    if(pitchChanged){notationFollowing?.scoreChanged();renderScore();adaptationView?.scoreChanged();transpositionView?.scoreChanged();}
    if(requiresReset||changes.display){engravedView.practicePartChanged();state.notationPart=engravedView.scopeInfo().partId;$('notation-part').value=state.notationPart||'';}
    renderNotationPage();drawFrame(true);updateRangeWarning();updateButtons();
    const candidate=preview.value,identity=candidate.status==='ready'&&candidate.compiled&&candidate.score?songMods.identity(candidate):null;
    if(identity&&identity.songId===mod.songId&&identity.sourceRevision.kind===mod.sourceRevision.kind&&identity.sourceRevision.value===mod.sourceRevision.value){if(!requiresReset&&candidate.compatibility.status==='pending')preview.publish({...candidate,...options,songMod:mod});else preview.adopt(pitchChanged?effective.compiled:candidate.compiled,requiresReset?fullCompatibility:candidate.compatibility,options.part,candidate.identity,pitchChanged?effective.cleanSong:candidate.cleanSong,{practiceSelection:options.practiceSelection,practiceLayout:options.practiceLayout,showOthers:options.showOthers,songMod:mod,pitchView:pitchChanged?effective.pitchView:candidate.pitchView});}
  }
  refreshSongModView();
}
async function startUnifiedPerformance(){
  if(startingPreview||scoreAdmissionPending())return;const context=modContext('preview');if(!context)return;
  try{if(context.pitchError)throw context.pitchError;assertSongModSupported(context.mod,context.capabilities,{assistance:context.assistance});assertModLiveAudioSupported(context.mod);assertPartInstrumentPolicyReady(modInputPolicy(context.mod,context),context.score.parts,i18n.locale);const options=songModOptions(context.mod,{assistance:context.assistance});
    if(isBasicKeysSong(context.cleanSong)&&options.mode==='practice'){
      const request=++basicHumanRequest,profile=JSON.stringify(currentProfile());
      const current=()=>request===basicHumanRequest&&context.previewVersion===preview.version&&context.score===preview.value.score&&context.navigation===scoreSaveNavigation&&profile===JSON.stringify(currentProfile())&&shell.screen()==='library'&&!document.hidden;
      if(!synth.muted)await synth.unlock({live:!proceduralMachineOnly(context.cleanSong,options.mode)});if(!current())return;
      const admission=await preparePracticeAdmission(context.compiled,options.practiceSelection,currentProfile(),context.assistance,null,undefined,context,current);
      if(admission?.basicAdmission&&!current())return;assertBasicHumanAssignment(admission);
      if(admission.compatibility.status!=='ready'){preview.publish({...preview.value,compatibility:admission.compatibility});return;}
    }
    preview.publish({...preview.value,...options,songMod:context.mod});await startPreview(options.mode);}
  catch(error){notice(()=>error.message,true);}
}
function markNotationRoles(){markPracticeNotation($('workspace'),{...getPracticeAssistanceDisplay(),sourceNotes:state.sourceNotes,humanPartIds:humanPartIds(),mode:state.mode,layout:state.practiceLayout,showOthers:state.showOtherParts});}
async function applyHumanSelection(selection,{layout='complete',showOthers=state.showOtherParts,mode=state.mode}={}){
  if(!state.score)return;
  const selected=resolvePracticeSelection(state.score.parts,selection),basic=isBasicKeysSong(state.cleanSong);
  let admission=null;
  if(basic){
    const request=++basicHumanRequest,compiled=state.compiled,version=state.practiceVersion,generation=state.generation,navigation=scoreSaveNavigation,profile=JSON.stringify(currentProfile()),originalMode=state.mode,assistance=stageAssistance.current();
    const current=()=>request===basicHumanRequest&&compiled===state.compiled&&version===state.practiceVersion&&generation===state.generation&&navigation===scoreSaveNavigation&&profile===JSON.stringify(currentProfile())&&originalMode===state.mode&&assistance===stageAssistance.current()&&shell.screen()==='stage'&&!document.hidden;
    try{
      if(assistancePracticeGate(stageAssistance))throw new Error('Check the saved note assignment in Mod before changing Human parts.');
      admission=await preparePracticeAdmission(compiled,selected,currentProfile(),assistance,state.loop,undefined,state,current);
      if(admission?.basicAdmission&&!current())return;assertBasicHumanAssignment(admission);
    }catch(error){if(current()){ $('practice-part').value=state.practicePart||'';notice(()=>error.message,true);}return;}
  }
  // The selected set is published only after its mandatory original-source
  // ownership check. A failed proposal leaves the saved Mod and active take intact.
  pausePlayback();state.mode=mode;$('session-mode').value=mode;state.practiceSelection=selected;state.practicePart=selected.kind==='all'&&!state.cleanSong?null:selected.part_ids[0]||null;state.practiceLayout=layout;state.showOtherParts=showOthers;
  void stageAssistance.restore();$('practice-part').value=state.practicePart||'';rebuildPracticeScope();
  if(admission)installPracticeAdmission(admission,{publish:false,committed:true});
  resetPlayback();engravedView.practicePartChanged();state.notationPart=engravedView.scopeInfo().partId;$('notation-part').value=state.notationPart||'';renderNotationPage();updateRangeWarning();refreshPracticeView();
  await checkInstrument();
}
async function applyCompletePracticeChoice({origin,context,selection,showOthers}) {
  if(origin==='stage'){
    if(context.score!==state.score)return;
    await applyHumanSelection(selection,{layout:'complete',showOthers,mode:'practice'});return;
  }
  const version=preview.version,navigation=scoreSaveNavigation;
  const current=()=>context.score===preview.value.score&&context.identity===preview.value.identity&&context.previewVersion===version&&preview.version===version&&navigation===scoreSaveNavigation&&shell.screen()==='library'&&!document.hidden;
  if(!current())return;
  // This call is still on the Apply gesture stack. Native/browser audio must
  // be unlocked before compatibility checks introduce an asynchronous gap.
  if(!synth.muted)await synth.unlock();
  if(!current())return;
  if(isBasicKeysSong(context.cleanSong)){const admission=await preparePracticeAdmission(context.compiled,resolvePracticeSelection(context.score.parts,selection),currentProfile(),context.assistance,null,undefined,context,current);if(!current())return;assertBasicHumanAssignment(admission);}
  const part=selection.kind==='all'&&!context.cleanSong?null:selection.part_ids?.[0]||context.score.parts[0]?.id;
  const pending=preview.select(context.identity,async()=>context.cleanSong?{score:context.score,cleanSong:context.cleanSong}:context.score,{part,practiceSelection:selection,practiceLayout:'complete',showOthers});
  const selectedVersion=preview.version,chosen=await pending;
  if(!chosen||preview.version!==selectedVersion||navigation!==scoreSaveNavigation||shell.screen()!=='library'||document.hidden)return;
  if(preview.canStart('practice'))await startPreview('practice');
}
function rebuildPracticeScope({publish=true}={}) {
  invalidateBasicPracticeAdmission();
  if (!state.compiled) return;
  const scope = practiceScope(state.compiled.timeline, state.practiceSelection??state.practicePart, state.loop);
  state.practiceTimeline = scope.selected; state.sourceTargetTimeline = scope.targets; state.targetTimeline = null; state.practicePlan = null; state.targetGroups = new Map(); state.physicalIndex = null;
  state.practiceIndex = new TimelineIndex(scope.selected.notes); state.practiceVersion++;
  state.sourceDisplayIndex=new TimelineIndex(canonicalDisplayNotes(state.compiled.timeline,state.loop));
  state.instrumentOutOfRange = null; state.instrumentConflict = false;
  state.compatibility = {status:'pending',reasonKey:'app.compatibilityChecking'};
  if (state.loop) { state.loop.notes = scope.playbackNotes; state.loop.index = new TimelineIndex(scope.playbackNotes); state.loop.targetIds = scope.targetIds; if(publish)updateLoopStatus(); }
  if(publish)updatePracticeScopeLabel();
}
function updatePracticeScopeLabel() {
  if (!state.score) return;
  const name = () => state.practiceSelection?.kind==='all' ? t('app.allParts') : state.score.parts.filter(part=>state.practiceSelection?.part_ids.includes(part.id)).map(part=>part.name).join(' · ')||state.practicePart;
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
  if(hasBasicKeyRendition(state.cleanSong)&&!engravedView.sourceInspection()){
    const pages=engravedView.basicPages(),page=pages[0],host=$('notation');host.replaceChildren();$('basic-notation-note').removeAttribute('data-i18n');bindText($('basic-notation-note'),()=>i18n.locale==='en'?'Basic interpretation v1: all interpreted targets share playback IDs and timing. Positive gates use this pitch/numbered view; synthetic onsets and percussion selectors stay explicitly labeled above. Original source notation is unchanged.':'基础解释 v1：全部解释目标与播放共用标识和时间。正时长门限显示在此音高／简谱视图，合成起音与打击乐选择键在上方明确标记。原始源记谱保持不变。');
    if(page?.view_version===2&&page.source_sha256===state.cleanSong.score.source.sha256){
      const backgroundRows=$('workspace').classList.contains('notation-on-lanes'),rowSpan=Math.max(1,Math.min(notationMeasuresPerRow(host.clientWidth),Math.floor(page.measure_count/2)));
      const batches=backgroundRows?engravedView.basicRowBatches():[{pages,firstMeasure:page.first_measure}];
      const ranges=batches.flatMap(batch=>backgroundRows?Array.from({length:Math.ceil(batch.pages[0].measure_count/rowSpan)},(_,index)=>({measureFrom:index*rowSpan,measureTo:Math.min(batch.pages[0].measure_count,(index+1)*rowSpan),pages:batch.pages,firstMeasure:batch.firstMeasure})):[null]);
      for(const range of ranges){const rowHost=range?document.createElement('section'):host;if(range){rowHost.className='notation-system-row';rowHost.dataset.notationNativeRow=String(range.firstMeasure+range.measureFrom);rowHost.dataset.notationMeasureCount=String(range.measureTo-range.measureFrom);host.append(rowHost);}
      for(const displayed of range?.pages||pages){const mount=document.createElement('section');mount.dataset.notationPartId=displayed.part_id;const heading=document.createElement('p');heading.className='notation-part-title';heading.textContent=state.score.parts.find(part=>part.id===displayed.part_id)?.name||displayed.part_id;mount.append(heading);const body=document.createElement('div'),rendered=renderBasicKeyPage(displayed,state.notation,{...range,width:Math.max(240,host.clientWidth-36),numberedMode:state.numberedMode,i18n});body.innerHTML=rendered.html;if(!rendered.html&&!rendered.fallback.length)body.textContent=(displayed.interpreted_notes||[]).length?t(displayed.status==='percussion_selectors'?'notationRuntime.basicSelectorPage':'notationRuntime.basicOnsetPage'):t('notation.empty');mount.append(body);
        if(rendered.fallback.length){const list=document.createElement('ul');for(const item of rendered.fallback){const row=document.createElement('li');row.className='score-note';row.dataset.noteId=item.note_id;row.textContent=i18n.locale==='en'?`MIDI key ${item.key} · interpreted gate · ${item.note_id}`:`MIDI 键 ${item.key} · 解释门限 · ${item.note_id}`;list.append(row);}mount.append(list);}rowHost.append(mount);
      }}
      if(backgroundRows&&!state.engravingActive){const rows=[...host.querySelectorAll('[data-notation-native-row]')].slice(0,2),height=rows.reduce((sum,row)=>sum+row.getBoundingClientRect().height,0);$('workspace').style.setProperty('--notation-row-height',`${Math.ceil(height+24)}px`);$('notation-lane-overlay').dataset.notationRows=String(rows.length);}
      if(!state.engravingActive)engravedView.reportPaint(pages.filter(item=>(['ready','rendering_unavailable','onset_page','percussion_selectors'].includes(item.status)||item.status==='empty_page'&&item.measures?.length>0&&item.follow_end_ms>item.source_start_ms)).map(item=>item.part_id),engravedView.basicBatch()?.status||'ready');
      bindText($('notation-page'),()=>i18n.locale==='en'?`Rendition measures ${page.first_measure+1}–${page.first_measure+page.measure_count} / ${page.total_measures}`:`解释小节 ${page.first_measure+1}～${page.first_measure+page.measure_count} / ${page.total_measures}`);$('notation-prev').disabled=page.first_measure===0;$('notation-next').disabled=page.next_measure===null;
    }else{const status=shell.notationVisible()?engravedView.followPosition(Math.max(0,playbackPosition(performance.now()))):null;bindText($('notation-page'),()=>status?.status==='unavailable'?(i18n.locale==='en'?'The native rendition page is unavailable. Reopen Staff to retry.':'本机解释页面不可用。请重新打开五线谱重试。'):(i18n.locale==='en'?'Preparing the shared rendition page…':'正在准备共用解释页面…'));$('notation-prev').disabled=$('notation-next').disabled=true;}
    bindText($('score-key'),()=>i18n.locale==='en'?'Basic interpretation v1':'基础解释 v1');state.lastHighlight='';markNotationRoles();return;
  }
  const layout = notationLayout(Math.max(240, $('notation').clientWidth - 36));
  const previousBeat = state.notationPage * state.notationSpan;
  if (layout.spanBeats !== state.notationSpan) { state.notationSpan = layout.spanBeats; state.notationPage = Math.floor(previousBeat / state.notationSpan); }
  $('basic-notation-note').removeAttribute('data-i18n');bindText($('basic-notation-note'),()=>hasBasicKeyRendition(state.cleanSong)?(i18n.locale==='en'?'Source-only pitch/numbered projection: this view preserves the original proved-note subset. Choose Staff for the complete interpreted gates, onset markers and percussion selectors used by playback and scoring.':'仅源数据的音高／简谱投影：此视图保留原始已确定音符子集。请选择五线谱，查看与播放、评分一致的完整解释门限、起音标记及打击乐选择键。'):t('ui.basic-notation-note'));
  const count = notationPageCount(state.score, state.notationSpan);
  const rowMode=$('workspace').classList.contains('notation-on-lanes'),lastPage=Math.max(0,count-(rowMode?2:1));
  state.notationPage = Math.max(0, Math.min(lastPage, state.notationPage));
  const visibleParts=new Set(engravedView.displayedPartIds()),displayScore={...state.score,parts:state.score.parts.filter(part=>visibleParts.has(part.id))};
  $('notation').innerHTML = Array.from({length:rowMode?Math.min(2,count):1},(_,offset)=>`<section class="notation-system-row" data-notation-row="${state.notationPage+offset}">${renderNotation(displayScore, state.notation, {startBeat: (state.notationPage+offset) * state.notationSpan, spanBeats: state.notationSpan, width: layout.width, partId: state.notationPart, allParts: state.notationPart===null, numberedMode: state.numberedMode,i18n})}</section>`).join('');
  if(rowMode&&!state.engravingActive){const height=$('notation').getBoundingClientRect().height;$('workspace').style.setProperty('--notation-row-height',`${Math.ceil(height+24)}px`);$('notation-lane-overlay').dataset.notationRows=String(Math.min(2,count));}
  if(!state.engravingActive)engravedView.reportPaint(displayScore.parts.map(part=>part.id));
  const tonic = keyTonic(keyAt(state.score, state.notationPage * state.notationSpan));
  if (!state.engravingActive) bindText($('score-key'), () => basicMeterLabel()||(state.notation === 'jianpu' && state.numberedMode === 'movable' ? (tonic ? t('app.tonicNumbering', {tonic:`${tonic.name}${tonic.octave}`}) : t('app.unknownKey')) : t('app.notationMeter', {numerator:state.score.meters[0]?.numerator||4,denominator:state.score.meters[0]?.denominator||4})));
  bindText($('notation-page'), () => t('app.notationPage', {page:state.notationPage+1,count}));
  $('notation-prev').disabled = state.notationPage <= 0;
  $('notation-next').disabled = state.notationPage >= lastPage;
  state.lastHighlight = '';markNotationRoles();
}
function updateRangeWarning() {
  renderCleanActive();
  if (!state.compiled) return;
  const [min, max] = state.instrument === 'guitar' ? [Math.min(...state.guitar.tuning) + state.guitar.capo, Math.max(...state.guitar.tuning) + state.guitar.frets] : [state.geometry[0].midi, state.geometry.at(-1).midi];
  const outside = state.instrumentOutOfRange ?? (state.sourceTargetTimeline?.notes || state.compiled.timeline.notes).filter(n => n.midi < min || n.midi > max).length;
  bindText($('practice-hint'), () => state.instrumentConflict ? t('app.guitarConflict') : outside ? t('app.rangeWarning', {count:outside,range:state.instrument==='guitar'?t('app.guitarRange'):t('app.pianoRange')}) : state.instrument === 'guitar' ? t('app.guitarHint') : state.mode === 'practice' ? t('app.practiceHint') : t('app.listenHint'));
}
function renderKeyboard() {
  state.geometry = keyboardGeometry(state.keys, state.lowestMidi);
  renderPianoKeybed({document,keyboard:$('keyboard'),geometry:state.geometry,labelForNote:note=>t('app.playNote',{note:midiName(note)}),decorateKey:(button,key)=>bindAttribute(button,'aria-label',()=>t('app.playNote',{note:midiName(key.midi)}))});
  const rails=$('piano-stage').querySelector('.piano-rails-shared');if(rails)renderPianoRails({document,rails,geometry:state.geometry});
  freeView?.setKeyboard(keyboardInput?.snapshot());
  keyboardInputView?.refreshRange();
  beginnerView?.refresh(true);
  $('piano-surface').style.minWidth = `${pianoMinimumWidth(state.geometry)}px`;
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
  if(isBasicKeysSong(state.cleanSong)&&!hasBasicKeyRendition(state.cleanSong)&&state.practiceSelection.part_ids.some(id=>!basicKeysParts(state.cleanSong).some(part=>part.id===id&&part.practice_available))){state.compatibility={status:'blocked',reasonKey:'app.compatibilityPlanBlocked'};state.targetTimeline=null;state.practicePlan=null;updateButtons();return;}
  invalidateBasicPracticeAdmission();state.practicePlan=null;state.targetGroups=new Map();state.targetTimeline=null;state.physicalIndex=null;updatePracticeScopeLabel();renderTargetMappings();
  state.compatibility = {status:'pending',reasonKey:'app.compatibilityPreparing'}; updateButtons();
  if(apply){state.profileDirty=false;if(profile.kind==='piano'){state.keys=profile.key_count;state.lowestMidi=profile.lowest_midi;}else state.guitar={tuning:profile.tuning,frets:profile.frets,capo:profile.capo};}
  const request = ++state.instrumentRequest; const compiled = state.compiled; const selection = state.practiceVersion;
  const song=state.cleanSong,generation=state.generation,mode=state.mode,profileKey=JSON.stringify(profile);
  const current=()=>request===state.instrumentRequest&&compiled===state.compiled&&selection===state.practiceVersion&&(!isBasicKeysSong(song)||song===state.cleanSong&&generation===state.generation&&mode===state.mode&&profileKey===JSON.stringify(currentProfile()));
  state.instrumentOutOfRange = null; state.instrumentConflict = false;
  bindText($('instrument-report'), () => t('app.checkingRange'));
  try {
    const assistance=await stageAssistance.restore();
    if(!current())return;
    const gate=assistancePracticeGate(stageAssistance);if(gate){state.compatibility=gate;return;}
    const admission=await preparePracticeAdmission(compiled,state.practiceSelection,profile,assistance,state.loop,undefined,state,current),{plan,report,sourceTargets}=admission;
    if(!current())return;assertPreparedPracticeAdmission(admission);
    if (apply) {
      state.profileDirty = false;
      resetPlayback();
      if (profile.kind === 'piano') { state.keys = profile.key_count; state.lowestMidi = profile.lowest_midi; state.customKeys = true; $('key-count').value = 'custom'; renderKeyboard(); }
      else { state.guitar = {tuning:profile.tuning, frets:profile.frets, capo:profile.capo}; renderFretboard(); }
      updateRangeWarning();
      refreshPreview();
    }
    if(assistance)stageAssistanceBinding();
    installPracticeAdmission(admission);
    updatePracticeScopeLabel();renderTargetMappings();
    const outside = report.note_options.filter(note => !note.playable).length;
    state.instrumentOutOfRange = outside; state.instrumentConflict = report.diagnostics.some(d => d.code === 'guitar_string_conflict'); updateRangeWarning();
    bindText($('instrument-report'), () => t('app.instrumentReport', {low:midiName(report.lowest_midi),high:midiName(report.highest_midi),count:outside}));
    $('instrument-diagnostics').replaceChildren();
    const diagnostics=[...new Map([...report.diagnostics,...plan.diagnostics].map(item=>[`${item.code}:${item.message}`,item])).values()];
    for (const diagnostic of diagnostics) { const li = document.createElement('li'); bindText(li, () => diagnostic.message); $('instrument-diagnostics').append(li); }
    $('instrument-settings').classList.toggle('has-warnings', diagnostics.some(d => !['guitar_fingering_advisory','guitar_pitch_only_targets'].includes(d.code)));
  } catch (error) { if (current()&&error.name!=='AbortError') { state.compatibility = isBasicKeysSong(state.cleanSong)?basicPracticeBlocker(error):{status:'error',reasonKey:'app.compatibilityError',originalReason:error.message}; bindText($('instrument-report'), () => t('app.instrumentUnverified', {detail:errorDetail(error)})); } }
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
  invalidateBasicPracticeAdmission();
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
  const next=referenceInputActive()?{kind:'reference'}:shell?.screen()==='free'?{kind:'free',owner:freeSession?.owner() ?? null}:{kind:'score',recorder:state.recorder};
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
function soundingManualSources() {
  return new Set([...state.held.keys(),...[...synth.releasingVoices].filter(voice=>voice.id.startsWith('manual:')).map(voice=>voice.id.slice(7))]);
}
function cleanupFreeInputs(reason='free_boundary',stopPreview=true) {
  freeLiveStart=performance.now();
  if(shell?.screen()==='free'){cleaningAllInputs=true;try{keyboardInput?.releaseAll(reason);}finally{cleaningAllInputs=false;}}
  for(const contact of inputContacts.values())if(contact.route.kind==='free')contact.active=false;
  for(const source of soundingManualSources())if((heldAudioTokens.get(source)??inputContacts.get(source))?.route.kind==='free'){state.held.delete(source);heldAudioTokens.delete(source);synth.stop(`manual:${source}`);}
  if(stopPreview)freePreview?.stop();highlightKeys();
}
function releaseOwnedSound(source,time,route,smooth=false) {
  const token=heldAudioTokens.get(source)??inputContacts.get(source);
  if(token && (time.eventWall<token.eventWall || token.route.kind!==route?.kind || token.route.owner!==route?.owner || token.route.recorder!==route?.recorder))return;
  state.held.delete(source);heldAudioTokens.delete(source);if(smooth)synth.release(`manual:${source}`);else synth.stop(`manual:${source}`);
}
function freeLiveInputAllowed(route,captureTime,options={}) {
  return route.kind==='free' && shell.screen()==='free' && freeWindowFocused
    && route.owner===freeSession.owner() && ['idle','recording','stopped'].includes(freeSession.snapshot().state)
    && captureTime>=freeLiveStart && (!Object.hasOwn(options,'liveOwner') || options.liveOwner===freeSession.liveOwner())
    && options.liveInput!==false && !document.hidden && !document.querySelector('dialog[open]')
    && !['preparing','playing'].includes(freePreview?.snapshot().status);
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
    // Idle/stopped contacts own live sound only. They never enter a recorder;
    // event-time routes with a recording owner retain their evidence path.
    if(route.owner===null)admitted=freeLiveInputAllowed(route,captureTime,options);
    else admitted=Boolean(freeSession?.observe('note_on',{...observationTime,...options,source,midi,velocity},route.owner)?.accepted);
  }else{
    const recorder=route.recorder;
    if(recorder!==state.recorder)return;
    // Reject before both scored capture and raw onset evidence, even muted.
    if(state.mode==='practice'&&basicPracticeGate())return;
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
  const freeLive=freeLiveInputAllowed(route,captureTime,options);
  const scoreLive=route.kind==='score' && shell.screen()==='stage'&&captureTime>=scoreLiveStart;
  if(options.liveInput===false || document.hidden || document.querySelector('dialog[open]') || (!freeLive&&!scoreLive))return;
  const livePolicy=scoreLive&&state.songMod?modInputPolicy(state.songMod,state,state.mode):null;
  const liveRoute=livePolicy?resolvePartInstrumentInput(livePolicy):null;
  if(liveRoute&&liveRoute.status!=='ready')return;
  const liveInstrument=liveRoute?.instrument||state.instrument;
  const audioToken={route,eventWall:captureTime,liveOwner:freeLive?freeSession.liveOwner():null};heldAudioTokens.set(source,audioToken);
  state.held.set(source,midi);highlightKeys();
  // Silent capture never constructs or resumes an AudioContext.
  if(synth.muted)return;
  try{
    await synth.unlock();
    if(synth.muted||heldAudioTokens.get(source)!==audioToken||state.held.get(source)!==midi||scoreLive&&basicPracticeGate())return;
    if(livePolicy){await synth.prepareLiveAudio();if(synth.muted||heldAudioTokens.get(source)!==audioToken||state.held.get(source)!==midi||scoreLive&&basicPracticeGate())return;assertPartInstrumentPolicyCurrent(livePolicy,modInputBinding(state.songMod,state,state.mode));}
    if(!synth.muted && (!scoreLive||!basicPracticeGate()) && heldAudioTokens.get(source)===audioToken && state.held.get(source)===midi && (!freeLive || (freeSession.liveOwner()===audioToken.liveOwner && freeLiveInputAllowed(route,captureTime,options))))synth.play(`manual:${source}`,midi,null,0,liveInstrument,velocity);
  }catch(error){notice(synth.liveError===error?()=>liveAudioErrorText(error):route.kind==='free'?()=>i18n.t('error.audioUnavailable'):()=>errorDetail(error),true);}
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
  for(const source of soundingManualSources())if(source.startsWith(prefix)){const token=heldAudioTokens.get(source)??inputContacts.get(source);releaseOwnedSound(source,time,token?.route);}
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
  }else if(!basicPracticeGate()){if(options.synthetic)route.recorder.evidence.cancel(observation);else route.recorder.evidence.release(observation);}
  const contact=inputContacts.get(source);
  if(contact && time.eventWall>=contact.eventWall){contact.active=false;contact.eventWall=time.eventWall;}
  else if(!contact && options.inputKind==='midi' && !options.synthetic)rememberContact(source,{route,eventWall:time.eventWall,active:false});
  releaseOwnedSound(source,time,route,!options.synthetic);highlightKeys();
}
function highlightKeys(activeNotes = []) {
  const held = new Set(state.held.values());
  freeView?.setHeldNotes([...held]);
  const active = new Set(activeNotes.filter(note=>note.practice_role!=='machine').map(n => n.midi)),machine=new Set(activeNotes.filter(note=>note.practice_role==='machine').map(note=>note.midi));
  document.querySelectorAll('[data-midi]').forEach(button => { const midi = Number(button.dataset.midi); button.classList.toggle('pressed', held.has(midi)); if(!button.classList.contains('fret-button'))button.classList.toggle('playing', active.has(midi)); button.classList.toggle('accompaniment',!active.has(midi)&&machine.has(midi));button.setAttribute('aria-pressed', String(held.has(midi))); });
  for(const rail of document.querySelectorAll('#piano-stage .piano-rails-shared [data-pitch]'))rail.classList.toggle('held',held.has(Number(rail.dataset.pitch)));
  highlightGuitarRoute(document,{notes:activeNotes.filter(note=>note.practice_role!=='machine'),groups:state.mode==='practice'?state.targetGroups:new Map(),plan:guitarFingering?.state().plan,...guitarFingeringView?.options()});
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
  if(referenceInputActive())return;
  if (shell.screen()!=='stage' || !state.compiled) return;
  if (canonicalSession.pausePending)return;
  if (transport.running || state.playPending) { pausePlayback(undefined,'pause',{preserveCanonical:transport.running}); return; }
  if(state.cleanSong&&!inspectCleanRendition(state.cleanSong).supported&&!(isBasicKeysSong(state.cleanSong)&&state.mode==='practice'&&state.targetTimeline?.notes.length)){notice(()=>cleanErrorText(i18n.locale,{code:'clean_renderer_unsupported'}),true);return;}
  if (state.mode === 'practice' && (state.compatibility.status !== 'ready'||assistancePracticeGate(stageAssistance)||basicPracticeGate())) { notice(compatibilityNotice(state.compatibility), true); return; }
  if(state.songMod){try{assertModLiveAudioSupported(state.songMod,state.mode);assertPartInstrumentPolicyReady(modInputPolicy(state.songMod,state,state.mode),state.score.parts,i18n.locale);}catch(error){notice(()=>error.message,true);return;}}
  try{assertCurrentPassAssignment();}catch(error){notice(()=>error.message,true);return;}
  const waiting=state.recorder.active;
  if(waiting&&(waiting.manualDeadline!==null||waiting.inFlight||(transport.completed&&state.recorder.pending))){notice(() => t('app.assessmentWaiting'));return}
  if (transport.completed) { if(state.mode==='practice') { transport.reset(); if(state.loop)transport.seek(state.loop.start_ms); state.lastHighlight=''; } else resetPlayback(); }
  const generation=state.generation,ticket=++state.playTicket,song=state.cleanSong,score=state.score,mode=state.mode,targetPart=state.practicePart,practiceSelection=state.practiceSelection,instrument=state.instrument,mod=state.songMod,muted=synth.muted;
  const current=()=>generation===state.generation&&ticket===state.playTicket&&song===state.cleanSong&&score===state.score&&mode===state.mode&&targetPart===state.practicePart&&practiceSelection===state.practiceSelection&&instrument===state.instrument&&mod===state.songMod&&muted===synth.muted&&!transport.running&&Boolean(state.compiled)&&shell.screen()==='stage'&&!document.hidden&&!document.querySelector('dialog[open]')&&(mode!=='practice'||state.compatibility.status==='ready'&&!assistancePracticeGate(stageAssistance)&&!basicPracticeGate());
  partActivityStage?.clear();
  state.playPending=true;
  const admissionController=new AbortController();state.audioAdmissionController=admissionController;let admissionLease=null;
  try {
    if(!muted)await synth.unlock({live:!proceduralMachineOnly(song,mode)});
    if(!current())return;
    if(mode==='practice'&&isBasicKeysSong(song)){
      const checked=await preparePracticeAdmission(state.compiled,state.practiceSelection,currentProfile(),stageAssistance.current(),state.loop,admissionController.signal,state,current);
      if(!current())return;assertBasicHumanAssignment(checked);installPracticeAdmission(checked);
      if(checked.compatibility.status!=='ready'){notice(compatibilityNotice(checked.compatibility),true);return;}
      assertCurrentPassAssignment();
    }
    const audioThread=!muted&&(!song||hasAudioThreadRendition(song)),beatMs=60000/(Number($('tempo').value)||100),countIn=$('count-in').checked&&!isBasicKeysSong(song)?beatMs*4:0;
    // Count-in belongs to the same prepared source position as every audio gate,
    // transport frame and recorder timestamp; never subtract it after admission.
    const modOptions=state.songMod?songModOptions(state.songMod,{assistance:stageAssistance.current()}):null;
    const options={context:synth.context,output:synth.output,mode,targetPart,practiceSelection,...assistancePlaybackOptions(),...(modOptions?{instrumentOverrides:modOptions.instrumentOverrides,mutedPartIds:modOptions.mutedPartIds}:{}),mutedParts:[...cleanMutedParts],soloParts:[...cleanSoloParts],instrument,resumePositionMs:!song&&state.loop&&!transport.hasStarted?undefined:transport.position-(audioThread&&!transport.hasStarted?countIn:0),acceptedPolicyId:song?inspectCleanRendition(song).rendition:null};
    let now;
    // Human live sound needs its worklet even when the unchanged source
    // renderer is procedural. Admit it before starting a clock or human take.
    if(audioThread||(!muted&&modNeedsLiveAudio(mod,mode))){await synth.prepareLiveAudio();if(!current())return;}
    if(audioThread){
      const resumeCanonical=!song&&canonicalSession.paused;
      if(!resumeCanonical){const prepared=await (song?cleanPlayer.prepare(options):canonicalSession.prepare({...options,soundEnabled:true,audiblePartIds:mode==='listen'&&targetPart&&!state.songMod?[targetPart]:undefined,range:state.loop?{startMs:state.loop.start_ms,endMs:state.loop.end_ms}:undefined,countInMs:countIn,loop:state.loop?{enabled:true}:undefined}));if(!prepared||!current())return;}
      // All plan building, transfer and renderer preparation precede this lead.
      // Drain only already-owned notation preparation; new renders have lower
      // priority until the native ACK and shared recorder/transport bind finish.
      admissionLease=await notationAudioAdmission(window).acquireAudio(admissionController.signal);
      if(!admissionLease||!current())return;
      const anchor=await (resumeCanonical?canonicalSession.resume({anchorTime:synth.context.currentTime+.05,...assistancePlaybackOptions()}):(song?cleanPlayer:canonicalSession).startPrepared({anchorTime:synth.context.currentTime+.05,...assistancePlaybackOptions()}));
      if(!anchor||!current())return;
      if(synth.context.state!=='running'||synth.context.currentTime>=anchor.anchorTime)throw Object.assign(new Error('The shared audio start anchor elapsed before transport admission.'),{code:'clean_late_start'});
      // Use the renderer's quantized sample anchor for both transport and inputs.
      const wallTime=performance.now(),audioTime=synth.context.currentTime;
      if(!song&&!resumeCanonical){canonicalSession.bindWallClock({wallTime,audioTime,sampleRate:synth.context.sampleRate});state.canonicalPassIndex=0;state.canonicalBudgetEnded=false;}
      now=song?wallTime+(anchor.anchorTime-audioTime)*1000:canonicalSession.wallAtFrame(resumeCanonical?anchor.resumeFrame:anchor.anchorFrame);
      transport.position=anchor.positionMs;
    }else{if(!song){const prepared=await canonicalSession.prepare({...options,soundEnabled:false,audiblePartIds:mode==='listen'&&targetPart&&!state.songMod?[targetPart]:undefined,range:state.loop?{startMs:state.loop.start_ms,endMs:state.loop.end_ms}:undefined,countInMs:countIn,loop:state.loop?{enabled:true}:undefined});if(!prepared||!current())return;state.canonicalPassIndex=0;state.canonicalBudgetEnded=false;}now=performance.now()+(state.cleanSong?50:0);}
    if(!current())return;
    state.playPending=false;state.inspection=false;
    transport.start(now,state.loop?.notes||state.practiceTimeline?.notes||state.compiled.timeline.notes,audioThread?0:countIn);
    if(mode==='practice')beginPracticePass(now);
    if(song){
      if(!muted&&!audioThread&&!isBasicKeysSong(song))cleanPlayer.start(options);
      activeMedia?.sync({positionMs:playbackPosition(performance.now()),running:true,userGesture:true});
    }
    updateButtons();
  }catch(error){
    if(ticket!==state.playTicket)return;
    if(mode==='practice'&&isBasicKeysSong(song)&&error.basicPractice){invalidateBasicPracticeAdmission();state.compatibility=basicPracticeBlocker(error);}
    pausePlayback();notice(()=>error.basicPractice?error.message:song?liveAudioErrorText(error):canonicalAudioErrorText(i18n.locale,error),true);
  }finally{
    admissionLease?.release();if(state.audioAdmissionController===admissionController)state.audioAdmissionController=null;
    if(ticket===state.playTicket&&state.playPending){state.playPending=false;cleanPlayer.stop();canonicalSession.stop();updateButtons();}
  }
}
function assertCurrentPassAssignment(){
  if(state.mode==='practice')assertStageBasicPracticeAdmission();
  const pass=state.recorder.active;if(!pass||pass.closedWall!==null||!pass.captureEnabled)return;
  const saved=passInterpretations.get(pass),checked=stageAssistance.current();
  assertBasicPassAdmission(pass);
  if(!saved||saved.practice_progression?.plan_digest!==progressionForAssistance(checked)?.plan.plan_digest||saved.practice_assistance?.plan.selection_digest!==(checked?.plan.selection_digest)||JSON.stringify(saved.practice_assistance?.receipt??null)!==JSON.stringify(checked?.receipt??null)||JSON.stringify(saved.source_revision)!==JSON.stringify(songMods.identity(state))||JSON.stringify(saved.pitch_mod??null)!==JSON.stringify(state.pitchView?.identity??null)||JSON.stringify(pass.timeline)!==JSON.stringify(state.targetTimeline))throw Object.assign(new Error('This take belongs to another note assignment. Reset the session before playing.'),{code:'assistance_take_reset_required'});
}
function assertBasicPassAdmission(pass){
  if(!isBasicKeysSong(state.cleanSong))return;
  const admission=assertStageBasicPracticeAdmission(),saved=passInterpretations.get(pass)?.basic_practice_admission;
  if(!saved||saved.selection_digest!==admission.checked.plan.selection_digest||JSON.stringify(saved.receipt)!==JSON.stringify(admission.checked.receipt)||JSON.stringify(pass.timeline)!==JSON.stringify(state.targetTimeline))throw Object.assign(new Error('This take has no current original-source Human admission. Reset and recheck before scoring.'),{code:'basic_practice_take_stale'});
}
function beginPracticePass(now, captureEnabled = true) {
  assertStageBasicPracticeAdmission();
  assertCurrentPassAssignment();
  const checked=stageAssistance.current();if(assistancePracticeGate(stageAssistance)||checked&&!checked.scored_mode_allowed||!state.targetTimeline?.notes.length)throw new Error('This assignment has no admitted human practice targets.');
  const recorder=state.recorder;let pass=recorder.active;
  if(pass&&pass.closedWall===null&&pass.captureEnabled&&captureEnabled) recorder.resume(now,transport.position);
  else {pass=recorder.begin({wallTime:now,position:transport.position,startMs:state.loop?.start_ms||0,endMs:state.loop?.end_ms||state.compiled.timeline.duration_ms,timeline:state.targetTimeline,label:state.loop?`Loop ${state.loopIteration}`:`Take ${recorder.passes.length+1}`,captureEnabled});passDisplayLabels.set(pass,{kind:state.loop?'loop':'take',number:state.loop?state.loopIteration:recorder.passes.length});}
  if(!passInterpretations.has(pass)&&state.cleanSong){const song=state.cleanSong,rendition=song.runtime?.rendition;passInterpretations.set(pass,{package_content_sha256:song.identity,source_sha256:song.score.source.sha256,runtime_profile:song.runtime?.profile||song.profile,policy_id:rendition?.policy_id||(isVsqSong(song)?'wmh-vsq-base-note-reference-v1':null),practice_part:state.practicePart,practice_selection:structuredClone(state.practiceSelection),source_target_ids:state.sourceTargetTimeline.notes.map(note=>note.id),scoring:'selected_human_parts_key_and_onset_only',...(rendition?{policy:structuredClone(rendition.policy),source_clock_available:rendition.source_clock_available}:{})});}
  if(!state.cleanSong&&canonicalSession.interpretation){
    if(!passInterpretations.has(pass))passInterpretations.set(pass,{...structuredClone(canonicalSession.interpretation),practice_part:state.practicePart,practice_selection:structuredClone(state.practiceSelection),practice_layout:state.practiceLayout,source_target_ids:state.sourceTargetTimeline.notes.map(note=>note.id),scoring:'selected_human_parts_key_and_onset_only',playback_segments:[]});
    const clock=canonicalSession.sourceClock();
    passInterpretations.get(pass).playback_segments.push({wall_start_ms:now,position_start_ms:transport.position,...structuredClone(canonicalSession.interpretation),...(canonicalSession.clockOrigin?{audio_wall_clock:structuredClone(canonicalSession.clockOrigin)}:{}),...(clock?{audio_clock:{player_epoch:clock.playerEpoch,generation:clock.generation,pass_index:clock.passIndex,cycle_start_frame:clock.cycleStartFrame,pass_start_frame:clock.passStartFrame,next_boundary_frame:clock.nextBoundaryFrame,initial_anchor_frame:clock.initialAnchorFrame}}:{})});
  }
  const interpretation=passInterpretations.get(pass)||{};
  if(!Object.hasOwn(interpretation,'practice_assistance')){interpretation.practice_assistance=assistanceTakeIdentity(stageAssistance.current());interpretation.practice_progression=progressionForAssistance(stageAssistance.current())?.plan??null;if(!stageAssistance.current()&&stageAssistance.state().persistence.status==='off')interpretation.practice_assistance_disabled=true;interpretation.song_mod=state.songMod?structuredClone(state.songMod):null;if(state.pitchView)interpretation.pitch_mod=state.pitchView.identity;interpretation.source_revision=structuredClone(songMods.identity(state));passInterpretations.set(pass,interpretation);}
  if(isBasicKeysSong(state.cleanSong)){const admission=assertStageBasicPracticeAdmission();passInterpretations.get(pass).basic_practice_admission=structuredClone({receipt:admission.checked.receipt,selection_digest:admission.checked.plan.selection_digest});}
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
function referenceInputActive(){return referenceListening?.isOpen()||performanceListening?.isActive();}
async function waitForReferenceClose(){while(referenceInputActive())await Promise.all([referenceListening?.whenClosed(),performanceListening?.whenClosed()]);}
async function drainAssessments() {
  if(state.assessmentBusy||referenceInputActive()||basicPracticeGate())return;
  const recorder=state.recorder;state.assessmentBusy=true;
  try {
    while(recorder===state.recorder){
      if(referenceInputActive())break;
      const pass=recorder.ready(performance.now())[0];if(!pass)break;
      try{assertBasicPassAdmission(pass);}catch(error){notice(()=>error.message,true);break;}
      const job=recorder.submit(pass);updateButtons();refreshPassHistory();
      try{
        const assessment=await api('/api/assess',{timeline:job.timeline,inputs:job.inputs,tolerance_ms:recorder.toleranceMs});
        if(recorder!==state.recorder)return;assertBasicPassAdmission(pass);
        await waitForReferenceClose();
        if(recorder!==state.recorder)return;assertBasicPassAdmission(pass);
        recorder.complete(job,assessment);if(pass===recorder.active&&pass.closedWall===null&&!transport.running)bindText($('transport-status'), () => t('app.paused'));refreshPassHistory();displayChosenPass();
      }catch(error){await waitForReferenceClose();if(recorder!==state.recorder)return;recorder.fail(job,error.message);notice(() => t('app.assessmentError', {pass:passLabel(pass),detail:errorDetail(error)}),true);refreshPassHistory()}
    }
  }finally{if(recorder===state.recorder){state.assessmentBusy=false;updateButtons();refreshPassHistory()}}
}
async function assess() {
  if(referenceInputActive())return;
  if(!state.compiled||state.mode!=='practice')return;
  if(state.compatibility.status!=='ready'||assistancePracticeGate(stageAssistance)||basicPracticeGate()){notice(compatibilityNotice(basicPracticeGate()||assistancePracticeGate(stageAssistance)||state.compatibility),true);return}
  const played=Boolean(state.recorder.active?.captureEnabled);
  pausePlayback();const generation=state.generation,recorder=state.recorder;
  if(!state.cleanSong&&!recorder.active){
    try{const prepared=await canonicalSession.prepare({soundEnabled:false,mode:'practice',practiceSelection:state.practiceSelection,...assistancePlaybackOptions(),...(state.songMod?songModOptions(state.songMod,{assistance:stageAssistance.current()}):{}),range:state.loop?{startMs:state.loop.start_ms,endMs:state.loop.end_ms}:undefined,loop:state.loop?{enabled:true}:undefined});if(!prepared||generation!==state.generation||recorder!==state.recorder)return;}
    catch(error){if(generation===state.generation)notice(()=>canonicalAudioErrorText(i18n.locale,error),true);return;}
  }
  if(basicPracticeGate())return;
  const now=performance.now();if(!state.recorder.active)beginPracticePass(now,false);
  assertBasicPassAdmission(state.recorder.active);
  state.recorder.requestAssessment(now,{grace:played});
  bindText($('transport-status'), () => played?t('app.receivingInput'):t('app.checkingTake'));
  updateButtons();refreshPassHistory();drainAssessments();
}
$('feedback-pass').addEventListener('change',displayChosenPass);
$('retry-assessments').addEventListener('click',()=>{state.recorder.retryFailed();drainAssessments()});
$('export-takes').addEventListener('click',async()=>{const recorder=state.recorder;if(canonicalSession.pendingPause){try{await canonicalSession.pendingPause;await Promise.resolve();}catch{return;}if(recorder!==state.recorder)return;}const routing=midiController?.exportRoutingData(),exported=state.recorder.exportData();exported.passes=exported.passes.map((pass,index)=>({...pass,...(passInterpretations.has(state.recorder.passes[index])?{interpretation:passInterpretations.get(state.recorder.passes[index])}:{})}));const data={...exported,score_id:state.score?.id,practice_part:state.practicePart,practice_selection:structuredClone(state.practiceSelection),song_mod:state.songMod?structuredClone(state.songMod):null,...(state.pitchView?{pitch_mod:state.pitchView.identity}:{}),view_configuration:{practice_layout:state.practiceLayout,show_other_parts:state.showOtherParts,falling_note_labels:fallingNoteLabels?.enabled()===true},target_plan:state.practicePlan,practice_assistance:assistanceTakeIdentity(stageAssistance.current()),practice_progression:progressionForAssistance(stageAssistance.current())?.plan??null,...(!stageAssistance.current()&&stageAssistance.state().persistence.status==='off'?{practice_assistance_disabled:true}:{}),...(routing?{midi_routing:routing}:{}),keyboard_input_configuration:keyboardInput.exportConfigurationData()};const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download='worldmusichub-practice-session.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000)});
function advanceLoopClock(now) {
  if(!state.loop||!transport.running)return;
  const clock=!state.cleanSong?canonicalSession.sourceClock(now):null;
  if(clock&&canonicalSession.plan?.rangeMode){advanceCanonicalLoopClock(now,clock);return;}
  // A failed/suspended source renderer must never fall through to a wall-clock
  // wrap that could create a new pass after its audio generation was canceled.
  if(!state.cleanSong&&!synth.muted&&canonicalSession.interpretation?.sound_enabled)return;
  const silentBudget=!state.cleanSong&&synth.muted?canonicalSession.interpretation?.loop_budget:null;
  if(silentBudget&&(state.canonicalPassIndex||0)>=silentBudget.max_passes-1&&transport.time(now)>=state.loop.end_ms){
    const boundaryWall=transport.startedAt+state.loop.end_ms-transport.position;if(state.mode==='practice')state.recorder.closeAtEnd(boundaryWall);
    state.canonicalBudgetEnded=true;transport.finish(state.loop.end_ms);silenceHeld('completion',now,boundaryWall);notice(()=>canonicalLoopBudgetText(i18n.locale,silentBudget,{ended:true}));bindText($('transport-status'),()=>t('app.complete'));updateButtons();refreshPassHistory();return;
  }
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
    if(silentBudget)state.canonicalPassIndex=(state.canonicalPassIndex||0)+1;
    if(state.mode==='practice')beginPracticePass(result.boundaryWall);
    bindText($('transport-status'), () => t('app.loopIteration', {count:state.loopIteration}));
  }
  updateButtons();refreshPassHistory();
}
function advanceCanonicalLoopClock(now,clock){
  const previous=state.canonicalPassIndex||0,difference=clock.passIndex-previous;
  if(difference<0)return;
  const cycleWall=canonicalSession.wallAtFrame(clock.cycleStartFrame),endWall=canonicalSession.wallAtFrame(clock.nextBoundaryFrame);
  if(!Number.isFinite(cycleWall)||!Number.isFinite(endWall))return;
  if(difference>0){
    const active=state.recorder.active,segment=active?.segments.at(-1),boundaryWall=segment?segment.wallStart+Math.max(0,active.endMs-segment.positionStart):cycleWall;
    if(state.mode==='practice')state.recorder.closeAtEnd(boundaryWall);
    const missed=difference>1||clock.ended,skippedPasses=difference-(clock.ended?0:1);
    silenceHeld(missed?'loop_clock_stall':'loop_boundary',now,boundaryWall);
    state.canonicalPassIndex=clock.passIndex;
    if(missed){
      if(state.mode==='practice')state.recorder.recordInterruption({boundaryWall,observedWall:now,skippedPasses});
      canonicalSession.stop();transport.pause(now);transport.position=clock.positionMs;
      notice(()=>t('app.loopClockGap',{count:skippedPasses}),true);bindText($('transport-status'),()=>t('app.loopInterrupted'));
      if(clock.ended){state.canonicalBudgetEnded=true;transport.finish(state.loop.end_ms);}
      updateButtons();refreshPassHistory();return;
    }
    state.loopIteration++;
    const plan=canonicalSession.plan;
    transport.position=(plan.rangeStartFrame-plan.countInFrames)*1000/plan.sampleRate;transport.startedAt=cycleWall;
    if(state.mode==='practice'&&!clock.ended)beginPracticePass(cycleWall);
    bindText($('transport-status'),()=>t('app.loopIteration',{count:state.loopIteration}));refreshPassHistory();
  }
  if(clock.ended){
    if(state.mode==='practice')state.recorder.closeAtEnd(endWall);
    state.canonicalBudgetEnded=true;transport.finish(state.loop.end_ms);silenceHeld('completion',now,endWall);
    const budget=canonicalSession.interpretation?.loop_budget;notice(()=>canonicalLoopBudgetText(i18n.locale,budget,{ended:true}));bindText($('transport-status'),()=>t('app.complete'));updateButtons();refreshPassHistory();
  }
}
// Displayed parts are independent of playback keys and assessed practice targets.
function displayedPartId(){return state.engravingActive?$('engraving-part').value||null:state.notationPart}
function displayedWrittenEntries(written) {
  const part=displayedPartId(),visible=new Set(engravedView.displayedPartIds());
  return (written?.entries||[]).filter(entry=>(part===null||entry.partId===part)&&visible.has(entry.partId));
}
function drawFrame(displayOnly = false) {
  const now = performance.now();
  if(displayOnly!==true)advanceLoopClock(now);
  let position = playbackPosition(now);
  if (displayOnly!==true && synth.droppedVoices && !state.audioLimitWarned) { state.audioLimitWarned = true; notice(() => t('app.audioLimit')); }
  const timeline = state.compiled?.timeline;
  const duration = timeline?.duration_ms || 0;
  const segmentStart = state.loop?.start_ms || 0;
  const playbackIndex = state.mode==='practice'&&stageAssistance.current()?state.physicalIndex:state.mode==='practice'&&state.physicalIndex ? state.physicalIndex : state.cleanSong?state.timelineIndex:state.loop?.index || state.practiceIndex || state.timelineIndex;
  if (displayOnly!==true && transport.running && timeline) {
    if(!state.cleanSong)metronome?.advance({running:true,position,segment:transport.startedAt,startPosition:transport.position});
    // Source notes are scheduled only by their admitted audio-thread renderer.
    // Synth is reserved for explicit human input and metronome clicks.
    if (!state.loop && state.mode==='practice' && position>=duration) {
      const previouslyClosed=state.recorder.active?.closedWall!==null;
      const pass=state.recorder.closeAtEnd(now);
      if(!previouslyClosed){updateButtons();refreshPassHistory()}
      if((pass&&now<pass.deadline)||cleanPlayer.audioThreadRunning||canonicalSession.running)bindText($('transport-status'), () => t('app.receivingInput'));
      else{transport.finish(duration);silenceHeld('completion',now,pass?.closedWall);updateButtons();bindText($('transport-status'), () => t('app.complete'))}
    } else if (!state.loop&&state.mode==='listen' && position>=duration+(state.cleanSong?80:0) && !cleanPlayer.audioThreadRunning&&!canonicalSession.running) {transport.finish(duration);silenceHeld('completion',now);updateButtons();bindText($('transport-status'), () => t('app.complete'))}
    else bindText($('transport-status'), () => position < segmentStart ? t('app.countIn', {count:Math.ceil((segmentStart-position)/(60000/(Number($('tempo').value)||100)))}) : state.mode === 'practice' ? t('app.yourTurn', {loop:state.loop?t('app.loopSuffix',{count:state.loopIteration}):''}) : t('app.listening', {loop:state.loop?t('app.loopSuffix',{count:state.loopIteration}):''}));
  }
  if(displayOnly!==true&&state.mode==='practice'&&!referenceInputActive()){
    const pass=state.recorder.active;
    // Replay retains the old take while a new source is preparing. Its closed
    // deadline can finish only an already-started transport, never the reset
    // clock during admission or after a canceled/failed admission.
    if(!state.playPending&&transport.hasStarted&&!transport.running&&!state.loop&&pass&&pass.closedWall!==null&&pass.deadline!==null&&now>=pass.deadline&&!transport.completed){transport.finish(duration);bindText($('transport-status'), () => t('app.complete'));updateButtons()}
    if(state.recorder.ready(now).length)drainAssessments();
  }
  // Completion above may have replaced an overshooting frame time with the
  // exact source endpoint. Every display below, including written-note lookup,
  // uses this same frame's current transport sample, never range readback.
  const activityClock={};
  position=playbackPosition(now,activityClock);
  if(displayOnly!==true&&state.cleanSong)activeMedia?.sync({positionMs:position,running:transport.running});
  updateProgress(position,duration);
  const activityContext={screen:shell.screen(),layout:state.practiceLayout,mode:state.mode,showOtherParts:state.showOtherParts};
  const activity=partActivityStage?.sample({cleanSong:state.cleanSong,source:state.compiled,context:activityContext,position,lifecycle:activityLifecycle(),otherRenderer:referenceInputActive(),sourceClock:activityClock.sourceClock??null,transport:state.playPending?'preparing':transport.completed?'ended':transport.running?'running':transport.hasStarted?'paused':'ready',countIn:now<transport.startedAt||position<segmentStart,soundEnabled:!synth.muted,hiddenPartIds:[...state.hiddenPartIds]});
  performanceView?.updateActivity(activity,activityContext);
  performanceView?.update();
  if($('results-dialog').open)updateResultsSummary(undefined,now);
  if(displayOnly!==true)pianoFingering?.render({position,segmentStart,segmentEnd:state.loop?.end_ms||duration,running:transport.running,hasStarted:transport.hasStarted,completed:transport.completed});
  beginnerView?.refresh();
  if(shell.screen()!=='stage')return;
  const active = position < segmentStart ? [] : playbackIndex?.range(position) || [];
  if(displayOnly!==true&&!isBasicKeysSong(state.cleanSong)&&(shell.notationVisible()||beginnerView?.enabled()&&state.numberedMode==='movable'))writtenCursor?.prepare();
  const written = position < segmentStart ? null : isBasicKeysSong(state.cleanSong)?basicKeyWrittenAt(state.cleanSong,engravedView.basicPages(),position,state.timelineIndex?.range(position)||[]):writtenCursor?.at(position);
  const soundingSources = new Set(active.flatMap(note=>mappedSourceIds(note,state.mode==='practice'?state.targetGroups.get(note.id):null)));
  const humanIds=humanPartIds();
  const currentWritten = (written?.entries || []).filter(entry=>(state.mode!=='practice'||isHumanWritten(entry))&&(entry.note.pitch||entry.role==='percussion_selector'?soundingSources.has(entry.sourceNoteId):true));
  const displayedWritten=displayedWrittenEntries(written);
  if(shell.notationVisible()&&state.engravingActive&&written?.occurrence)engravedView.setExpectedWrittenNotes?.({sourceNoteIds:displayedWritten.filter(entry=>state.mode!=='practice'||isHumanWritten(entry)).map(entry=>entry.sourceNoteId),sourceMeasureIndex:written.occurrence.source_measure_index});
  else engravedView.clearExpectedWrittenNotes?.({preserveRenditionRows:hasBasicKeyRendition(state.cleanSong)&&shell.notationVisible()});
  if(displayOnly!==true&&shell.notationVisible())notationFollowing?.tick(position < segmentStart ? -1 : position,transport.running,{...written,entries:displayedWritten,pageAnchor:writtenCursor?.pageAnchor(position,displayedPartId())});
  const signature = JSON.stringify([i18n.revision,written?.occurrence?.id || null,currentWritten.map(entry=>entry.sourceNoteId),displayedWritten.map(entry=>entry.sourceNoteId)]);
  if (signature !== state.lastHighlight) {
    updateWrittenNoteHighlights(document,displayedWritten.filter(entry=>state.mode!=='practice'||isHumanWritten(entry)).map(entry=>entry.sourceNoteId),written?.occurrence?.source_measure_index);
    state.lastHighlight = signature;
    if((writtenCursor?.state().status==='ready'||isBasicKeysSong(state.cleanSong)&&written?.occurrence)&&writtenCursorStatus){
      if(isBasicKeysSong(state.cleanSong)){writtenCursorStatus.dataset.status='ready';writtenCursorRetry.hidden=true;}
      const pitches=currentWritten.filter(entry=>entry.note.pitch),selectors=currentWritten.filter(entry=>entry.role==='percussion_selector'),rests=currentWritten.length-pitches.length-selectors.length;
      const labels=pitches.slice(0,8).map(({note})=>`${note.pitch.step}${({'-2':'𝄫','-1':'♭','0':'','1':'♯','2':'𝄪'})[note.pitch.alter]}${note.pitch.octave} → ${midiName(pitchMidi(note.pitch))}`);
      bindText(writtenCursorStatus, () => selectors.length?(i18n.locale==='en'?`Percussion selectors: ${selectors.map(entry=>entry.key).join(', ')}`:`打击乐选择键：${selectors.map(entry=>entry.key).join('、')}`):t('app.writtenNotes', {notes:labels.join(', ')||'—',more:pitches.length>8?t('app.moreNotes',{count:pitches.length-8}):'',rests:rests?t('app.writtenRests',{count:rests}):''}));
      writtenCursorStatus.dataset.sourceNoteIds=JSON.stringify(currentWritten.map(entry=>entry.sourceNoteId));
      writtenCursorStatus.dataset.sourceMeasureIndex=written?.occurrence?String(written.occurrence.source_measure_index):'';
    }else if(isBasicKeysSong(state.cleanSong)&&writtenCursorStatus){writtenCursorStatus.dataset.sourceNoteIds='[]';writtenCursorStatus.dataset.sourceMeasureIndex='';writtenCursorStatus.dataset.status=position>=duration?'ended':'pending';bindText(writtenCursorStatus,()=>position>=duration?(i18n.locale==='en'?'End of the interpreted timeline':'解释时间线已结束'):(i18n.locale==='en'?'Following is waiting for a matching native page. Playback targets keep their original timeline.':'跟随正在等待匹配的本机页面。播放目标仍使用原时间线。'));}
  }
  const displayRange=state.instrument==='piano'?[state.geometry[0].midi,state.geometry.at(-1).midi]:[Math.min(...state.guitar.tuning)+state.guitar.capo,Math.max(...state.guitar.tuning)+state.guitar.frets];
  const {availableMidi,excludedMachinePartIds}=practiceDisplayCache(state);
  const stageNotes=(humanNotes,sourceNotes)=>practiceStageNotes({...getPracticeAssistanceDisplay(),humanNotes,hiddenPartIds:state.hiddenPartIds,targetGroups:state.targetGroups,sourceNotes:state.mode==='listen'&&!state.cleanSong?humanNotes:sourceNotes,availableMidi,excludedMachinePartIds,humanPartIds:humanIds,mode:state.mode,layout:state.practiceLayout,showOthers:state.showOtherParts,range:displayRange});
  const activeDisplay=stageNotes(active,position<segmentStart?[]:state.sourceDisplayIndex?.range(position)||[]);
  highlightKeys(activeDisplay);
  if (state.instrument === 'guitar') {
    if(displayOnly!==true)guitarFingering?.prepare();
    const guidance=renderGuitarGuidance({profile:currentProfile(),plan:guitarFingering?.state().plan,...guitarFingeringView?.options(),timeline:state.mode==='practice'?state.targetTimeline:state.cleanSong?timeline:state.practiceTimeline||timeline,groups:state.mode==='practice'?state.targetGroups:new Map(),parts:state.score?.parts||[],position,segmentStart,segmentEnd:state.loop?.end_ms||duration,running:transport.running,hasStarted:transport.hasStarted,completed:transport.completed,mode:state.mode,loopIteration:state.loop?state.loopIteration:null});
    highlightGuitarRoute(document,{notes:guidance.currentNotes,nextNotes:guidance.nextNotes,nextOnsetMs:guidance.nextOnsetMs,position,groups:state.mode==='practice'?state.targetGroups:new Map(),plan:guitarFingering?.state().plan,...guitarFingeringView?.options()});
    return;
  }
  const canvas = $('falling-notes'); const width = canvas.clientWidth; const height = canvas.clientHeight;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) { canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr); }
  const ctx = canvas.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, width, height);
  // Shared DOM rails and notation remain behind this transparent note layer.
  const windowMs = 4000;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const fallingNotes=reducedMotion?activeDisplay:stageNotes(playbackIndex?.range(position,position+windowMs)||[],state.sourceDisplayIndex?.range(position,position+windowMs)||[]);
  canvas.dataset.skin=skinRuntime.current()?.id||'builtin';
  canvas.dataset.humanNoteIds=JSON.stringify(fallingNotes.filter(note=>note.practice_role==='human').map(note=>note.id));canvas.dataset.machineNoteIds=JSON.stringify(fallingNotes.filter(note=>note.practice_role==='machine').map(note=>note.id));canvas.dataset.noteLabels=String(fallingNoteLabels?.enabled()===true);
  for (const note of fallingNotes) {
    if (note.start_ms + note.duration_ms < position || note.start_ms > position + windowMs) continue;
    const key = state.geometry.find(k => k.midi === note.midi); if (!key) continue;
    const bottom = reducedMotion ? height : height - (note.start_ms - position) / windowMs * height;
    const noteHeight = reducedMotion ? 40 : Math.max(8, note.duration_ms / windowMs * height - 4);
    const x = key.x * width + 2; const y = bottom - noteHeight;
    if(paintSkinNote(ctx,skinRuntime.current(),{x,y,width:Math.max(2,key.width*width-4),height:noteHeight,viewportHeight:height,role:note.practice_role,label:fallingNoteLabels?.enabled()&&noteHeight>23&&key.width*width>27?midiName(note.midi):null,labelY:Math.min(height-13,Math.max(y+17,85))}))continue;
    const machine=note.practice_role==='machine',color=machine?'#8a91ac':note.start_ms<=position?FIELD_COLORS.scheduled:key.black?FIELD_COLORS.accidental:FIELD_COLORS.natural;
    ctx.fillStyle=color;ctx.shadowColor=color+'66';ctx.shadowBlur=machine?0:fallingNoteShadow(note,position,fallingNotes.length,reducedMotion);
    ctx.beginPath(); ctx.roundRect(x, y, Math.max(2, key.width * width - 4), noteHeight, 5); ctx.fill();ctx.shadowBlur=0;ctx.strokeStyle='#eaffff55';ctx.lineWidth=machine?2:1;ctx.setLineDash(machine?[5,4]:[]);ctx.stroke();ctx.setLineDash([]);
    if (fallingNoteLabels?.enabled() && noteHeight > 23 && key.width * width > 27) { ctx.fillStyle = FIELD_COLORS.noteText; ctx.font = '12px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(midiName(note.midi), x + (key.width * width - 4) / 2, Math.min(height-13,Math.max(y+17,85))); }
  }
  if (reducedMotion && timeline) { ctx.fillStyle = '#d4e4f1'; ctx.font = '12px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(t('app.reducedMotion'), width / 2, Math.min(height-12,100)); }
  if (!timeline) { ctx.fillStyle = '#a9bba2'; ctx.font = '12px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(t('app.chooseExercise'), width / 2, height / 2); }
}
let lastIdleDraw = 0;
function animate(now) { if (transport.running || now - lastIdleDraw > 100) { drawFrame(); lastIdleDraw = now; } state.frame = requestAnimationFrame(animate); }

async function applyLoop() {
  if(state.cleanSong){$('loop-enabled').checked=false;notice(()=>cleanErrorText(i18n.locale,{code:'clean_derived_runtime_required'}),true);return;}
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
$('practice-part').addEventListener('change', () => { const part=$('practice-part').value || (state.cleanSong?state.score.parts[0].id:null);applyHumanSelection({kind:part===null?'all':'parts',...(part===null?{}:{part_ids:[part]})},{layout:'solo'}); });
function setNumberedMode(mode) { state.numberedMode = mode; $('jianpu-reference').value = mode; renderNotationPage(); beginnerView?.refresh(true); }
$('jianpu-reference').addEventListener('change', () => setNumberedMode($('jianpu-reference').value));
$('notation-part').addEventListener('change', () => { notationFollowing?.suspend();state.notationPart = $('notation-part').value || null;engravedView.selectPart(state.notationPart);renderNotationPage(); });
$('notation-prev').addEventListener('click', () => { notationFollowing?.suspend();if(hasBasicKeyRendition(state.cleanSong)){engravedView.turnBasicPage(-1);return;}state.notationPage--; renderNotationPage(); });
$('notation-next').addEventListener('click', () => { notationFollowing?.suspend();if(hasBasicKeyRendition(state.cleanSong)){engravedView.turnBasicPage(1);return;}state.notationPage++; renderNotationPage(); });
$('play-button').addEventListener('click', togglePlayback);
$('count-in').addEventListener('change',()=>{if(!state.cleanSong){pausePlayback();if(!$('count-in').checked&&transport.position<(state.loop?.start_ms||0)){transport.position=state.loop?.start_ms||0;drawFrame();}}});
$('reset-button').addEventListener('click', resetPlayback);
$('progress').addEventListener('pointerdown',event=>{if(event.button===0&&canSeekPlayback())pausePlayback('app.seekPaused','seek');});
$('progress').addEventListener('input',event=>{const bounds=playbackSeekBounds();seekPlayback(bounds&&canSeekPlayback()?nativeRangeSeekPosition(event.target,bounds):NaN);});
$('progress').addEventListener('keydown',event=>{
  if(!canSeekPlayback()||event.altKey||event.ctrlKey||event.metaKey)return;
  const bounds=playbackSeekBounds(),position=playbackPosition(performance.now());
  const target=({ArrowLeft:position-1000,ArrowDown:position-1000,ArrowRight:position+1000,ArrowUp:position+1000,PageDown:position-10000,PageUp:position+10000,Home:bounds.start,End:bounds.end})[event.key];
  if(target===undefined)return;
  event.preventDefault();seekPlayback(target);
});
$('assess-button').addEventListener('click', () => assess());
$('session-mode').addEventListener('change', async () => { const mode=$('session-mode').value;if(mode==='practice'&&isBasicKeysSong(state.cleanSong)){try{assertStageBasicPracticeAdmission();}catch{await applyHumanSelection(state.practiceSelection,{layout:state.practiceLayout,showOthers:state.showOtherParts,mode});$('session-mode').value=state.mode;return;}}state.mode=mode; resetPlayback();engravedView.modeChanged();const scope=engravedView.scopeInfo();state.notationPart=scope.scope==='all'?null:scope.partId;$('notation-part').value=state.notationPart||'';renderNotationPage(); updateRangeWarning(); });
$('instrument').addEventListener('change', () => { resetPlayback(); state.instrument = $('instrument').value; state.profileDirty = false; syncProfileFields(); profileControls(); if (state.instrument === 'guitar') $('instrument-settings').open = true; checkInstrument(); $('piano-stage').hidden = state.instrument !== 'piano'; $('guitar-stage').hidden = state.instrument !== 'guitar'; $('key-count').disabled = state.instrument !== 'piano'; updateRangeWarning(); keyboardInputView?.refreshRange(); drawFrame(); });
$('key-count').addEventListener('change', () => { resetPlayback(); state.customKeys = $('key-count').value === 'custom'; profileControls(); if (state.customKeys) { markProfileDirty(); $('instrument-settings').open = true; $('custom-key-count').value = String(state.keys); $('custom-lowest').value = midiName(state.geometry[0].midi).replace('♯','#'); return; } state.keys = Number($('key-count').value); state.lowestMidi = null; state.profileDirty = false; renderKeyboard(); updateRangeWarning(); checkInstrument(); });
$('tempo').addEventListener('change', () => {
  if(state.cleanSong){$('tempo').value=String(displayOpeningTempo(state.score));notice(()=>cleanErrorText(i18n.locale,{code:'clean_derived_runtime_required'}),true);return;}
  const bpm = Number($('tempo').value);
  if (!Number.isFinite(bpm) || bpm < 10 || bpm > 600) { notice(() => t('app.tempoInvalid'), true); $('tempo').value = String(displayOpeningTempo(state.score)); return; }
  if (state.score) compileScore(transposeTempo(originalPitchContext(state).score, bpm), true);
});
function selectBasicNotation(mode,{remember=true}={}) { engravedView.hide({remember}); state.notation = mode; $('engraved-button').setAttribute('aria-pressed','false'); $('engraved-button').classList.remove('selected'); $('jianpu-reference-label').hidden = mode !== 'jianpu'; ['staff', 'jianpu'].forEach(m => { $(m + '-button').classList.toggle('selected', m === mode); $(m + '-button').setAttribute('aria-pressed', String(m === mode)); }); renderScore(); }
for (const mode of ['staff', 'jianpu']) $(mode + '-button').addEventListener('click', () => selectBasicNotation(mode));
$('engraved-button').addEventListener('click', () => {engravedView.show();drawFrame()});
function setSoundEnabled(enabled){
  const resumeCanonical=!state.cleanSong&&transport.running;
  if(transport.running||state.playPending)pausePlayback();
  synth.muted=!enabled;if(enabled&&transport.running)synth.unlock({live:!proceduralMachineOnly(state.cleanSong,state.mode)}).catch(error=>notice(()=>errorDetail(error),true));if(synth.muted){synth.silence();heldAudioTokens.clear();freePreview?.stop('muted');}
  bindText($('sound-button'),()=>synth.muted?t('app.soundOff'):t('app.soundOn'));bindAttribute($('sound-button'),'title',()=>synth.muted?t('app.soundOff'):t('app.soundOn'));$('sound-button').setAttribute('aria-pressed',String(synth.muted));metronome?.updateMute();referenceListening?.soundChanged();performanceListening?.soundChanged();
  updateButtons();
  try{freeSession?.configure('sound',enabled);}catch{/* Session reports configuration failures without losing retained input. */}freeView?.render();
  if(resumeCanonical)void togglePlayback();
}
$('sound-button').addEventListener('click',()=>setSoundEnabled(synth.muted));
$('import-button').addEventListener('click', () => {referenceListening?.close();performanceListening?.stop({revokePolicy:true});$('score-file').click();});
$('mobile-import-button').addEventListener('click', () => {referenceListening?.close();performanceListening?.stop({revokePolicy:true});$('score-file').click();});
$('score-file').addEventListener('change', async event => {
  const files=Array.from(event.target.files||[]),file=files[0],selection=++fileSelectionVersion;event.target.value='';if(!file)return;
  referenceListening?.close();
  performanceListening?.stop({revokePolicy:true});
  // The same visible picker accepts packs and multiple scores. Review owns no
  // active score or take; saving a batch only updates the storage inventory.
  if(files.length>1||/\.(zip|wmhpack)$/i.test(file.name)||(/\.json$/i.test(file.name)&&file.size>8*1024*1024)){void bulkImportView.select(files);return}
  const intent = ++state.loadIntent;cancelCatalogSelection();state.compileController?.abort();
  const importPreviewVersion=preview.version,importNavigation=scoreSaveNavigation;
  const currentImport=()=>selection===fileSelectionVersion&&intent===state.loadIntent&&importPreviewVersion===preview.version&&importNavigation===scoreSaveNavigation;
  let initialText;
  if(/\.json$/i.test(file.name)){
    const previewVersion=preview.version,navigation=scoreSaveNavigation;
    const current=()=>selection===fileSelectionVersion&&intent===state.loadIntent&&previewVersion===preview.version&&navigation===scoreSaveNavigation;
    try{initialText=await file.text();if(!current())return;const value=JSON.parse(initialText);if(isImportEnvelope(value)){void bulkImportView.select(files);return}}catch{/* Ordinary malformed JSON keeps the existing explicit source error. */}
    if(!current())return;
  }
  const persistenceTicket=createImportPersistenceTicket('file-import');
  const guidance=unsupportedImportHint(file.name,i18n);if(guidance){notice(() => unsupportedImportHint(file.name,i18n),true);return}
  if (file.size > 8 * 1024 * 1024) { notice(() => t('app.fileTooLarge'), true); return; }
  try {
    const jianpuText = /\.jianpu$/i.test(file.name);
    if (jianpuText && file.size > 1024 * 1024) throw appError('app.jianpuTooLarge');
    const compressed = /\.mxl$/i.test(file.name);
    const midiFile = /\.(mid|midi)$/i.test(file.name);
    const xmlFile = /\.(musicxml|xml)$/i.test(file.name);
    const content = compressed || midiFile || jianpuText || xmlFile ? await file.arrayBuffer() : initialText??await file.text();
    if(midiFile&&!currentImport())return;
    if (jianpuText || compressed || midiFile || xmlFile) {
      pausePlayback();
      const response = await fetch(jianpuText ? '/api/import/jianpu' : midiFile ? '/api/import/midi' : compressed ? '/api/import/mxl' : '/api/import/musicxml', {method: 'POST', headers: {'Content-Type': jianpuText ? 'text/plain' : midiFile ? 'audio/midi' : compressed ? 'application/zip' : 'application/xml'}, body: content});
      const result = await response.json();
      if(midiFile&&!currentImport())return;
      // Keep the strict canonical path unchanged when it succeeds. A source
      // rejection may instead use Rust's complete native MIDI-key admission;
      // transport/server failures are not evidence for reinterpreting a file.
      if(midiFile&&!response.ok&&response.status===400&&typeof result.error==='string'){
        const owner={current:currentImport};directMidiImportOwner=owner;renderPreview();
        try{
          const imported=await importDirectMidiFallback(file,{getStorage:()=>scoreStorage.storage(),current:currentImport,onCommitted:async()=>{libraryManagement?.invalidate();if(!await scoreStorage.rescan())throw new Error('The MIDI save was attempted, but the library could not be refreshed. Refresh the saved-song list before retrying.');}});
          if(!imported||!currentImport())return;
          // The saved identity is reloaded through the same complete-package
          // validator as every library selection. Never compile its projection
          // as a new canonical score, or replace an active take before Start.
          const pending=preview.select(imported.libraryKey,signal=>scoreStorage.load(imported.libraryKey,{signal})),version=preview.version;
          await pending;
          if(selection!==fileSelectionVersion||intent!==state.loadIntent||importNavigation!==scoreSaveNavigation||version!==preview.version)return;
          if(preview.value.status==='error')return;
          if(preview.value.score)bindPreviewCaption(preview.value.score.title);
          const inspection=preview.value.status==='inspection';
          shell.show('library');
          notice(()=>directMidiImportText(i18n.locale,{reason:result.error,warnings:imported.warnings,inspection}));
        }catch(error){if(currentImport())notice(()=>t('app.readError',{name:file.name,detail:`${result.error} ${errorDetail(error)}`}),true);}
        finally{if(directMidiImportOwner===owner){directMidiImportOwner=null;renderPreview();updateButtons();}}
        return;
      }
      if (!response.ok) throw result.error ? new Error(result.error) : appError('app.importFailed');
      const loaded = await compileScore(result.score, false, intent, result.diagnostics || []);
      if (loaded) persistAcceptedImport(persistenceTicket,result.score,{intent});
      if (loaded && jianpuText) activateJianpuView();
      if (loaded && Array.isArray(result.diagnostics) && result.diagnostics.length) notice(() => result.diagnostics.map(diagnosticText).join(' '));
    } else { const score = JSON.parse(content); const loaded=await compileScore(score, false, intent); if(loaded)persistAcceptedImport(persistenceTicket,score,{intent,scoreJson:content}); }
  }
  catch (error) { if (intent !== state.loadIntent||/\.(mid|midi)$/i.test(file.name)&&!currentImport()) return; notice(() => t('app.readError', {name:file.name,detail:errorDetail(error)}), true); }
});
$('export-button').addEventListener('click', () => {
  if (!state.score) return;
  try {
    const download = prepareScoreDownload(originalPitchContext(state).score);
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
  getVisualRange:()=>state.instrument==='guitar'&&shell.screen()!=='free'?{low:Math.min(...state.guitar.tuning)+state.guitar.capo,high:Math.max(...state.guitar.tuning)+state.guitar.frets}:state.geometry.length?{low:state.geometry[0].midi,high:state.geometry.at(-1).midi}:null});
freeSession=createFreePracticeSession({now:()=>{freeClockWall=performance.now();return freeClockWall;},onBoundary:cleanupFreeInputs,onChange:snapshot=>{
  const starting=snapshot.state==='recording'&&['idle','stopped'].includes(freeCaptureState);
  const stopping=snapshot.state==='stopped'&&freeCaptureState!=='stopped';
  // Use the recorder's exact Start/Stop/Leave boundary, not a later render clock.
  syncInputRoute(starting||stopping||!snapshot.entered?freeClockWall:undefined);
  const next=freeSession?.liveOwner();if(next!==freeLiveOwner){freeLiveOwner=next;freeLiveStart=performance.now();}
  if(snapshot.entered&&snapshot.state==='recording'&&freeCaptureState!=='recording')$('free-practice-title')?.focus();freeCaptureState=snapshot.state;
}});
freePreview=createFreePracticePreview({audio:synth,soundEnabled:()=>!synth.muted,onChange:snapshot=>{
  if(snapshot.status==='preparing')cleanupFreeInputs('free_preview',false);
  else if(snapshot.status!=='playing')freeLiveStart=performance.now();
}});
freeView=setupFreePracticeView({document,i18n,session:freeSession,preview:freePreview,host:document.querySelector('.app-shell'),
  onExit:()=>shell.show('library'),onConnectMidi:()=>{$('midi-button').click();shell.open('settings');},onConfigureKeyboard:()=>shell.open('settings'),
  getSoundEnabled:()=>!synth.muted,onSoundChange:setSoundEnabled,
  getPianoRange:()=>({keyCount:state.keys,lowestMidi:state.lowestMidi}),
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
window.addEventListener('blur', () => {freeWindowFocused=false;keyboardComposing=false;keyboardInput.compositionEnd();pausePlayback('app.blurPaused','blur')});
window.addEventListener('focus', () => {if(!freeWindowFocused)freeLiveStart=performance.now();freeWindowFocused=true;});
document.addEventListener('visibilitychange', () => { if (document.hidden) pausePlayback('app.hiddenPaused','hidden');else freeLiveStart=performance.now(); });
window.addEventListener('pagehide', () => { resetAssistanceOnNavigation(stageAssistance);resetAssistanceOnNavigation(previewAssistance);bulkImportView?.queue.cancel();scoreSaveNavigation++;pausePlayback(undefined,'pagehide'); cancelAnimationFrame(state.frame);cancelPendingStart();if(preview.controller){preview.cancel();preview.publish({...preview.value,status:'error',message:t('app.previewStopped')})} });
let notationResizeFrame = 0;
window.addEventListener('resize', () => { cancelAnimationFrame(notationResizeFrame); notationResizeFrame = requestAnimationFrame(() => { renderNotationPage(); drawFrame(); }); });
$('workspace').addEventListener('notationlayoutchange', () => { cancelAnimationFrame(notationResizeFrame); notationResizeFrame = requestAnimationFrame(() => { renderNotationPage(); drawFrame(); }); });
window.addEventListener('pageshow', event => { if (event.persisted) { if(state.compiled)void checkInstrument();if(preview.value.compiled)refreshPreview();cancelAnimationFrame(state.frame); state.frame = requestAnimationFrame(animate); } });

function cancelCatalogSelection(){
  // Cancelling candidate work does not replace its retained source. Keep that
  // source's checked assignment usable if the replacement fails or is cancelled.
  preview?.cancel({preserveAssistance:true});
  if(startingPreview){startRequest++;state.compileController?.abort();startingPreview=false;}
}
function cancelPendingStart(){if(startingPreview){state.loadIntent++;cancelCatalogSelection();renderPreview();updateButtons();}}
function previewCompatibility(result,profile=currentProfile()){
  return result.status==='ready'?{...result,reasonKey:profile.kind==='piano'?'app.compatibilityPianoReady':'app.compatibilityGuitarReady'}:result;
}
function basicPracticeBlocker(error){
  return {status:'blocked',basicPractice:true,reason:error?.message||'Human practice needs a current check against the original saved source. Choose Listen or retry the check.'};
}
function invalidateBasicPracticeAdmission(){state.basicPracticeAdmission=null;state.basicPracticeTokens=null;state.basicPracticePlan=null;}
function assertStageBasicPracticeAdmission(){
  if(!isBasicKeysSong(state.cleanSong))return null;
  const admission=state.basicPracticeAdmission,tokens=state.basicPracticeTokens;
  if(!admission||!tokens||state.profileDirty||state.compatibility.status!=='ready'||state.practicePlan!==state.basicPracticePlan||state.targetTimeline!==state.basicPracticePlan?.timeline)throw Object.assign(new Error('Human practice needs a current check against the original saved source. Choose Listen or retry the check.'),{code:'basic_practice_admission_required'});
  const binding=createBasicPracticeAdmissionBinding(state,{selection:state.practiceSelection,profile:currentProfile(),assistance:stageAssistance.current(),...tokens});
  return assertBasicPracticeCurrent(admission,binding);
}
function basicPracticeGate(){
  if(state.mode!=='practice'||!isBasicKeysSong(state.cleanSong))return null;
  if(state.compatibility.status!=='ready')return state.compatibility;
  try{assertStageBasicPracticeAdmission();return null;}catch(error){return basicPracticeBlocker(error);}
}
function assertPreparedPracticeAdmission(admission){
  if(!admission?.basicAdmission)return;
  if(!admission.current())throw Object.assign(new Error('The Human assignment changed while its original source was being checked. Retry the current selection.'),{code:'basic_practice_admission_stale'});
  assertBasicPracticeCurrent(admission.basicAdmission,admission.binding());
}
function assertBasicHumanAssignment(admission){
  assertPreparedPracticeAdmission(admission);
  // Device-range infeasibility is a visible practice blocker, not an ownership
  // rewrite. Native unsupported-source errors never reach this commit boundary.
}
async function preparePracticeAdmission(compiled,selection,profile,assistance=null,loop=null,signal,context=null,current=()=>true){
  // Basic ownership can only come from the saved-source native route. A caller
  // timeline and the optional instrument-identity disclosure grant no ownership.
  const value=context||(preview?.value.compiled===compiled?preview.value:state.compiled===compiled?state:null);
  let basicAdmission=null,tokens=null,binding=null;
  if(isBasicKeysSong(value?.cleanSong)){
    if(value.compiled!==compiled)throw new Error('The Human assignment belongs to another source compilation.');
    tokens={intentToken:{},sessionToken:{}};
    binding=()=>createBasicPracticeAdmissionBinding(value,{selection,profile,assistance,...tokens});
    const initial=createBasicPracticeAdmissionRequest(value,{selection,profile,assistance,...tokens});let response;
    try{response=await api(initial.path,initial.body,signal);}catch(error){error.basicPractice=true;throw error;}
    if(signal?.aborted||!current())throw Object.assign(new Error('The Human assignment check was superseded.'),{name:'AbortError',code:'basic_practice_admission_stale'});
    basicAdmission=admitBasicPractice(response,initial.binding);
    assertBasicPracticeCurrent(basicAdmission,binding());
  }
  const checked=basicAdmission?scopedAssistanceTargets(basicAdmission.checked,compiled.timeline,loop):assistance?scopedAssistanceTargets(assistance,compiled.timeline,loop):null;
  const sourceTargets=checked?.sourceTimeline||practiceScope(compiled.timeline,selection,loop).targets;
  const plan=checked?.plan||validateTargetPlan(await api('/api/practice-targets',{timeline:sourceTargets,profile},signal),sourceTargets);
  if(basicAdmission&&(signal?.aborted||!current()))throw Object.assign(new Error('Practice check was superseded.'),{name:'AbortError'});
  if(basicAdmission)assertBasicPracticeCurrent(basicAdmission,binding());
  const report=await api('/api/instrument-check',{timeline:sourceTargets,profile},signal);
  if(basicAdmission&&(signal?.aborted||!current()))throw Object.assign(new Error('Practice check was superseded.'),{name:'AbortError'});
  if(basicAdmission)assertBasicPracticeCurrent(basicAdmission,binding());
  let compatibility=compatibilityStatus(report,sourceTargets.notes);
  if(checked&&!checked.allowed)compatibility={status:'blocked',assistance:true,assistanceReason:plan.target_count?'infeasible':'noHuman'};
  else if(!plan.playable&&compatibility.status==='ready')compatibility={status:'blocked',reasonKey:'app.compatibilityPlanBlocked'};
  return {plan,report,sourceTargets,compatibility:previewCompatibility(compatibility,profile),basicAdmission,tokens,binding,current};
}
function installPracticeAdmission(admission,{publish=true,committed=false}={}){
  // committed is used only inside the synchronous, prechecked ownership commit.
  if(!committed)assertPreparedPracticeAdmission(admission);
  const {plan,report,sourceTargets,compatibility,basicAdmission,tokens}=admission;
  state.basicPracticeAdmission=basicAdmission||null;state.basicPracticeTokens=tokens||null;state.basicPracticePlan=basicAdmission?plan:null;
  state.sourceTargetTimeline=sourceTargets;state.practicePlan=plan;state.targetTimeline=plan.timeline;state.targetGroups=new Map(plan.groups.map(group=>[group.target_id,group]));
  state.physicalIndex=new TimelineIndex(state.loop?windowNotes(plan.timeline.notes,state.loop.start_ms,state.loop.end_ms):plan.timeline.notes);state.compatibility=compatibility;
  state.instrumentOutOfRange=report.note_options.filter(note=>!note.playable).length;state.instrumentConflict=report.diagnostics.some(d=>d.code==='guitar_string_conflict');
  if(publish){updatePracticeScopeLabel();renderTargetMappings();}
}
async function checkPreview(compiled,part,signal,{assistance=null}={}){
  if(state.profileDirty)return{status:'dirty',reasonKey:'app.previewDirty'};
  const candidate=preview.value,version=preview.version,profile=JSON.stringify(currentProfile());
  const current=()=>candidate.compiled===compiled&&preview.value.compiled===compiled&&preview.version===version&&profile===JSON.stringify(currentProfile());
  try{return (await preparePracticeAdmission(compiled,part,currentProfile(),assistance,null,signal,candidate,current)).compatibility;}
  catch(error){if(isBasicKeysSong(candidate.cleanSong)&&error.name!=='AbortError')return basicPracticeBlocker(error);throw error;}
}
function renderPreview(){
  refreshPracticeView();
  renderCanonicalAudio();
  lobbyPreview?.select(preview.value.cleanSong?{status:'empty'}:preview.value);
  renderCleanPreview();
  const value=preview.value,changedIdentity=$('song-lobby').dataset.previewId!==(value.identity||'');$('song-lobby').dataset.previewStatus=value.status;$('song-lobby').dataset.previewId=value.identity||'';
  const performance=isPerformanceSong(value.cleanSong),basicKeys=isBasicKeysSong(value.cleanSong),vsq=isVsqSong(value.cleanSong),allPartListen=hasBasicKeyRendition(value.cleanSong)||vsq;
  // The existing explicit VSQ policy action occupies the Listen slot until chosen.
  $('start-listen').hidden=vsq&&!value.cleanSong.runtime;
  bindText($('start-listen'),()=>t(allPartListen?'shell.listenAllParts':'shell.startListen'));
  bindText($('preview-part-label').firstChild,()=>t(value.cleanSong?'shell.humanPracticePart':'shell.targetPart'));
  bindText($('preview-part-help'),()=>t('shell.cleanPartHelp'));$('preview-part-help').hidden=!allPartListen||!value.compiled;
  const item=value.score||rowScore(songRows().find(item=>item.selectionKey===value.identity));
  bindText($('preview-title'), () => item?.title||t('app.chooseScore'));
  bindAttribute($('preview-title'),'title',()=>item?.title||t('app.chooseScore'));
  bindText($('preview-meta'), () => item?t('app.previewMeta', {composer:item.composer||t('app.composerUnknown'),origin:originLabel(item)}):t('app.browseScores'));
  bindAttribute($('preview-meta'),'title',()=>item?t('app.previewMeta',{composer:item.composer||t('app.composerUnknown'),origin:originLabel(item)}):t('app.browseScores'));
  if($('preview-music-meta'))bindText($('preview-music-meta'), () => performance?(i18n.locale==='en'?'Notation unavailable':'记谱不可用'):previewMusicMetadata(value.compiled?.score||value.score,i18n));
  bindText($('preview-status'), () => basicKeys?(hasBasicKeyRendition(value.cleanSong)?(i18n.locale==='en'?'Listen to every part, or choose your part for scored practice with accompaniment':'聆听全部声部，或选择人演奏的声部进行带伴奏评分练习'):(i18n.locale==='en'?'Choose a determined MIDI-key part to practice · reference audio unavailable':'请选择已确定的 MIDI 按键声部练习 · 参考音频不可用')):vsq?(startingPreview||value.status==='choosing'?t('app.preparingSession'):value.errorCode?(i18n.locale==='en'?'Instrumental playback could not be prepared. Retry the basic-instrument choice.':'未能准备基础器乐播放，请重试基础乐器选项。'):t(value.status==='choice'?'shell.vsqListenChoice':'shell.cleanListenScope')):performance?(i18n.locale==='en'?'Complete performance saved · Choose reference listening below':'完整演奏已保存 · 请在下方选择参考聆听'):startingPreview?t('app.preparingSession'):['loading','choosing'].includes(value.status)?t('app.preparingPreview'):value.status==='choice'?(i18n.locale==='en'?'Choose base-note instrumental practice to continue':'请选择基础音符器乐练习以继续'):value.status==='error'?(value.errorCode?.startsWith('clean_')?cleanErrorText(i18n.locale,{code:value.errorCode}):t('app.previewError', {detail:originalDetail(value.message)})):value.status==='ready'?t('app.previewReady'):t('app.previewBrowsing'));
  bindText($('preview-gate'), () => basicKeys&&value.status==='inspection'?(i18n.locale==='en'?'Practice clock unavailable; all parts and attacks retained':'练习时钟不可用；完整保留所有声部与按键'):performance?(i18n.locale==='en'?'Notation, practice targets and grades unavailable':'记谱、练习目标与评分不可用'):['choice','choosing'].includes(value.status)?(value.errorCode?(i18n.locale==='en'?'The instrumental choice failed; it can be retried.':'基础器乐选项准备失败，可以重试。'):(i18n.locale==='en'?'Basic instruments play the authored notes; original vocal synthesis is unsupported.':'基础乐器播放创作音符；暂不支持原歌声合成。')):compatibilityText(value.compatibility));$('preview-gate').classList.toggle('preview-blocked',['blocked','error','dirty'].includes(value.compatibility.status));
  $('open-score').hidden=!basicKeys&&!(isVsqSong(value.cleanSong)&&value.cleanSong.runtime);$('open-score').disabled=startingPreview||!value.score||!['ready','inspection'].includes(value.status);
  $('start-listen').disabled=startingPreview||scoreAdmissionPending()||!preview.canStart('listen');$('start-practice').disabled=startingPreview||scoreAdmissionPending()||!preview.canStart('practice');
  const diagnostics=value.compiled?.diagnostics||[];$('preview-notices').hidden=!diagnostics.length;bindText($('preview-notices-title'), () => t('app.previewNotices', {count:diagnostics.length}));$('preview-notice-list').replaceChildren();for(const diagnostic of diagnostics.slice(0,20)){const row=document.createElement('li');bindText(row, () => diagnosticText(diagnostic));$('preview-notice-list').append(row)}if(diagnostics.length>20){const row=document.createElement('li');bindText(row, () => t('app.moreNotices', {count:diagnostics.length-20}));$('preview-notice-list').append(row)}
  if(['catalog_in_trash','library_not_found'].includes(value.errorCode))bindText($('preview-status'),()=>i18n.t('management.catalog.previewUnavailable'));
  const select=$('preview-part'),signature=JSON.stringify([i18n.revision,Boolean(value.cleanSong),item?.parts?.map(part=>[part.id,part.name])||[]]);
  if(select.dataset.parts!==signature){select.replaceChildren();if(!value.cleanSong){const all=document.createElement('option');all.value='';bindText(all, () => t('app.allParts'));select.append(all);}for(const part of item?.parts||[]){const option=document.createElement('option');option.value=part.id;option.disabled=basicKeys&&!basicKeysParts(value.cleanSong).some(item=>item.id===part.id&&item.practice_available);bindText(option, () => part.name);select.append(option)}select.dataset.parts=signature;}
  select.value=value.part||'';$('preview-part-label').hidden=!value.compiled;
  if(changedIdentity){$('preview-notices').open=false;document.querySelector('.preview-copy').scrollTop=0;}
  refreshSongModView();
}
function renderCanonicalAudio(){
  for(const [id,host,visible]of [['canonical-audio-policy',$('progress-help')?.parentElement,Boolean(state.compiled)&&!state.cleanSong],['canonical-preview-policy',$('preview-part-help')?.parentElement,Boolean(preview?.value.compiled)&&!preview?.value.cleanSong]]){
    if(!host)continue;let node=$(id);if(!node){node=document.createElement('p');node.id=id;node.className='progress-help';host.append(node);}node.hidden=!visible;bindText(node,()=>canonicalAudioPolicyText(i18n.locale));
  }
  const node=$('canonical-audio-policy');if(node){bindText(node,()=>canonicalAudioPolicyText(i18n.locale)+(state.loop?' '+canonicalLoopBudgetText(i18n.locale,canonicalSession.interpretation?.loop_budget,{ended:state.canonicalBudgetEnded}):''));node.dataset.rendererState=state.playPending?'preparing':canonicalSession.running?'playing':transport.completed?'ended':transport.running?'silent':'stopped';node.dataset.sourceFingerprint=canonicalSession.interpretation?.source_fingerprint||'';node.dataset.planFingerprint=canonicalSession.interpretation?.plan_fingerprint||'';}
}
function bindPreviewCaption(title){bindText($('catalog-status'),()=>t('app.previewing',{title}));}
async function selectSongScore(identity){
  const row=songRows().find(entry=>entry.selectionKey===identity);if(!row)return;
  cancelPendingStart();
  bindPreviewCaption(row.title);
  await preview.select(identity,async signal=>{if(row.source==='saved'){const loaded=await scoreStorage.load(row.libraryKey,{signal});return loaded.cleanSong?loaded:loaded.score;}return loadSongListItem(row,{model:scoreStorage,signal,loadCatalog:(item,signal)=>fetchCatalogScore(item,api,catalogCache,signal)});});
}
async function selectCatalogScore(id){return selectSongScore(id)}
function restorePreviewAssistance(){
  const version=preview.version,compiled=preview.value.compiled,pending=previewAssistance.restore();
  if(['default','off'].includes(previewAssistance.state().phase))return;
  void pending.then(async assistance=>{if(version!==preview.version||compiled!==preview.value.compiled)return;const compatibility=assistancePracticeGate(previewAssistance)||await checkPreview(compiled,preview.value.practiceSelection,undefined,{assistance});if(version===preview.version&&compiled===preview.value.compiled)preview.publish({...preview.value,assistance,compatibility});}).catch(error=>{if(version===preview.version)preview.publish({...preview.value,compatibility:{status:'blocked',assistance:true,reason:error.message}});});
}
function refreshPreview(){
  const candidate=preview.value;
  if(candidate.score){preview.cancel();preview.publish({...candidate,compatibility:{status:state.profileDirty?'dirty':'pending',reasonKey:state.profileDirty?'app.previewDirty':'app.previewRechecking'}});}
  if(previewRefreshQueued)return;previewRefreshQueued=true;
  queueMicrotask(()=>{previewRefreshQueued=false;const value=preview.value;if(value.score)preview.select(value.identity,async()=>{const source=originalPitchContext(value);return source.cleanSong?{score:source.score,cleanSong:source.cleanSong}:source.score;},{part:value.part,practiceSelection:value.practiceSelection,practiceLayout:value.practiceLayout,showOthers:value.showOthers});});
}
async function startPreview(mode){
  if(startingPreview||scoreAdmissionPending()||!preview.canStart(mode))return;
  lobbyPreview?.stop();
  const candidate=preview.value,version=preview.version,request=++startRequest,profile=JSON.stringify(currentProfile()),navigation=scoreSaveNavigation;startingPreview=true;renderPreview();
  const current=()=>request===startRequest&&version===preview.version&&candidate.score===preview.value.score&&profile===JSON.stringify(currentProfile())&&navigation===scoreSaveNavigation&&!document.hidden;
  try{
    if(!synth.muted)await synth.unlock({live:!proceduralMachineOnly(candidate.cleanSong,mode)});if(!current())return;
    if(mode==='practice'&&isBasicKeysSong(candidate.cleanSong)){const admission=await preparePracticeAdmission(candidate.compiled,candidate.practiceSelection,currentProfile(),previewAssistance.current(),null,undefined,candidate,current);if(!current())return;assertBasicHumanAssignment(admission);if(admission.compatibility.status!=='ready'){preview.publish({...preview.value,compatibility:admission.compatibility});return;}}
    if(candidate.identity?.startsWith('native:')){const storage=await scoreStorage.storage();if(request!==startRequest||version!==preview.version||candidate!==preview.value)return;await storage.requireActive(candidate.identity);if(request!==startRequest||version!==preview.version||candidate!==preview.value)return;}
    const intent=++state.loadIntent;
    const loaded=await compileScore(candidate.score,false,intent,candidate.compiled.diagnostics||[],candidate.part,mode,candidate.identity,candidate.cleanSong,false,candidate);
    if(!loaded||request!==startRequest||intent!==state.loadIntent)return;
    enteringPreview=true;try{shell.show('stage')}finally{enteringPreview=false;}
    if(mode==='practice'&&state.compatibility.status!=='ready'){notice(compatibilityNotice(state.compatibility),true);return;}
    await togglePlayback();
  }catch(error){if(['catalog_in_trash','library_not_found'].includes(error.code)&&preview.value===candidate){preview.cancel();preview.publish({...candidate,status:'error',errorCode:error.code,message:error.message});}notice(() => t('app.startError', {detail:errorDetail(error)}),true);}
  finally{if(request===startRequest){startingPreview=false;renderPreview();updateButtons();}}
}
async function chooseVsqAndStart(mode){
  const candidate=preview.value;if(startingPreview||candidate.status!=='choice'||!isVsqSong(candidate.cleanSong))return;
  const version=preview.version,request=++startRequest;startingPreview=true;renderPreview();
  // Unlock in the actual button gesture before waiting for native derivation.
  try{if(!synth.muted)await synth.unlock();if(request!==startRequest||version!==preview.version||candidate.cleanSong!==preview.value.cleanSong||shell.screen()==='stage')return;
    const chosen=await preview.chooseVsqPractice(async(song,signal)=>(await scoreStorage.storage()).chooseVsqPractice(song,{signal}));
    if(!chosen||request!==startRequest||preview.value.cleanSong?.identity!==candidate.cleanSong.identity)return;
    startingPreview=false;
    await startPreview(mode);
  }catch(error){notice(()=>cleanErrorText(i18n.locale,error),true);}
  finally{if(request===startRequest){startingPreview=false;renderPreview();}}
}
async function openPreviewScore(){
  const candidate=preview.value;if(startingPreview||!(isBasicKeysSong(candidate.cleanSong)||isVsqSong(candidate.cleanSong)&&candidate.cleanSong.runtime)||!candidate.score||!['ready','inspection'].includes(candidate.status))return;
  const request=++startRequest,version=preview.version;startingPreview=true;renderPreview();
  try{
    if(candidate.identity?.startsWith('native:')){const storage=await scoreStorage.storage();if(request!==startRequest||version!==preview.version||candidate!==preview.value)return;await storage.requireActive(candidate.identity);if(request!==startRequest||version!==preview.version||candidate!==preview.value)return;}
    if(state.cleanSong?.identity!==candidate.cleanSong.identity||state.cleanSong?.libraryKey!==candidate.cleanSong.libraryKey){const intent=++state.loadIntent;const loaded=await compileScore(candidate.score,false,intent,candidate.compiled?.diagnostics||[],candidate.part,'practice',candidate.identity,candidate.cleanSong,true,candidate);if(!loaded||request!==startRequest)return;}
    else{pausePlayback();state.inspection=true;updateButtons();}
    enteringPreview=true;try{shell.show('stage');if(!shell.notationVisible())$('notation-toggle').click();engravedView.show();}finally{enteringPreview=false;}
  }catch(error){notice(()=>t('app.startError',{detail:errorDetail(error)}),true);}
  finally{if(request===startRequest){startingPreview=false;renderPreview();updateButtons();}}
}
$('open-score').addEventListener('click',()=>openPreviewScore());
i18n.subscribe(()=>{redrawAppText();refreshSongModView();if(state.score&&!state.engravingActive)renderNotationPage();state.lastHighlight='';drawFrame(true);});
$('start-listen').addEventListener('click',()=>startPreview('listen'));
$('start-practice').addEventListener('click',async()=>{const value=preview.value;if(value.practiceLayout==='complete'){if(!synth.muted)await synth.unlock();await preview.select(value.identity,async()=>{const source=originalPitchContext(value);return source.cleanSong?{score:source.score,cleanSong:source.cleanSong}:source.score;},{part:value.part,practiceLayout:'solo'});}await startPreview('practice');});
$('preview-part').addEventListener('change',async()=>{
  const value=preview.value,part=$('preview-part').value||null;if(!value.score)return;
  if(isBasicKeysSong(value.cleanSong)){
    const request=++basicHumanRequest,version=preview.version,navigation=scoreSaveNavigation,profile=JSON.stringify(currentProfile());
    const current=()=>request===basicHumanRequest&&version===preview.version&&value.score===preview.value.score&&navigation===scoreSaveNavigation&&profile===JSON.stringify(currentProfile())&&!document.hidden;
    preview.publish({...value,compatibility:{status:'pending',reasonKey:'app.previewRechecking'}});
    try{const admission=await preparePracticeAdmission(value.compiled,resolvePracticeSelection(value.score.parts,part===null?{kind:'all'}:{kind:'parts',part_ids:[part]}),currentProfile(),previewAssistance.current(),null,undefined,value,current);if(!current())return;assertBasicHumanAssignment(admission);}
    catch(error){if(current()){preview.publish({...value,compatibility:value.compatibility});$('preview-part').value=value.part||'';notice(()=>error.message,true);}return;}
  }
  preview.select(value.identity,async()=>{const source=originalPitchContext(value);return source.cleanSong?{score:source.score,cleanSong:source.cleanSong}:source.score;},{part});
});
for(const id of ['catalog-search','catalog-origin'])$(id).addEventListener(id==='catalog-search'?'input':'change',renderCatalog);
for(const id of ['instrument','key-count','custom-key-count','custom-lowest','guitar-tuning','guitar-frets','guitar-capo'])$(id).addEventListener(['instrument','key-count'].includes(id)?'change':'input',refreshPreview);
async function loadCatalog() {
  const initial=state.loadIntent===0&&!state.score,intent=state.loadIntent,previewVersion=preview.version,current=++catalogIndexRequest;catalogIndexController?.abort();const controller=new AbortController();catalogIndexController=controller;renderCatalog();bindText($('catalog-status'), () => t('app.catalogLoading'));
  try {const response=await api('/api/catalog/index',undefined,controller.signal);if(controller.signal.aborted||current!==catalogIndexRequest)return;state.catalog=validateCatalogIndex(response);catalogIndexFailed=false;catalogCache.clear();renderCatalog();bindText($('catalog-status'), () => state.catalog.length?t('app.catalogReady', {count:state.catalog.length}):t('app.catalogEmpty'));if(initial&&intent===state.loadIntent&&preview.version===previewVersion&&preview.value.status==='empty'&&state.catalog.length)await selectCatalogScore(state.catalog[0].id);}
  catch(error){if(controller.signal.aborted||current!==catalogIndexRequest)return;catalogIndexFailed=true;renderCatalog();bindText($('catalog-status'), () => t('app.catalogUnavailable'));notice(() => t('app.catalogError', {detail:errorDetail(error)}),true)}
  finally{if(catalogIndexController===controller){catalogIndexController=null;renderCatalog()}}
}
function activateJianpuView() { setNumberedMode('movable'); $('jianpu-button').click(); }
async function importJianpuText(text, signal) {
  const persistenceTicket=createImportPersistenceTicket('jianpu-import');
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
    if (loaded) { persistAcceptedImport(persistenceTicket,result.score,{intent,signal}); activateJianpuView(); if (result.diagnostics?.length) notice(result.diagnostics.map(item => item.message).join(' ')); }
    return loaded;
  } finally { signal.removeEventListener('abort', cancel); }
}
async function importCanonicalScore(score, signal, {practicePart=undefined,diagnostics=[],practiceOptions=null} = {}) {
  if(signal.aborted)return false;
  const intent=++state.loadIntent;cancelCatalogSelection();state.compileController?.abort();
  const cancel=()=>{if(intent===state.loadIntent){state.loadIntent++;state.compileController?.abort();bindText($('transport-status'), () => state.compiled?t('app.previousScoreAvailable'):t('app.scoreUnavailable'));updateButtons()}};
  signal.addEventListener('abort',cancel,{once:true});
  try{return await compileScore(score,false,intent,diagnostics,practicePart,undefined,undefined,null,false,practiceOptions)}
  finally{signal.removeEventListener('abort',cancel)}
}
function activateCanonicalTransformation(score,signal,options={}) {
  const practiceOptions={...canonicalPracticeOptions(score.parts,{practiceSelection:state.practiceSelection,practiceLayout:state.practiceLayout,showOthers:state.showOtherParts}),...(state.songMod?{songMod:state.songMod}:{})};
  return importCanonicalScore(score,signal,{...options,practicePart:practiceOptions.part,practiceOptions});
}
async function importReviewedScore(kind,score,signal,options) {
  const ticket=createImportPersistenceTicket(kind);
  const loading=importCanonicalScore(score,signal,options),intent=state.loadIntent;
  const loaded=await loading;if(loaded)persistAcceptedImport(ticket,score,{intent,signal});return loaded;
}
const libraryView = setupScoreLibrary({getScore:()=>state.cleanSong?null:originalPitchContext(state).score,onLoad:importCanonicalScore,validate:(score,signal)=>api('/api/compile',score,signal),pausePlayback,notice});
// Retain access to older browser-profile copies without implying migration.
const legacyLibraryButton=$('library-button');legacyLibraryButton.removeAttribute('data-i18n');
bindText(legacyLibraryButton,()=>i18n.locale==='en'?(scoreStorage?.snapshot().kind==='native'?'Legacy browser archives':'Browser archives'):(scoreStorage?.snapshot().kind==='native'?'旧版浏览器收藏':'浏览器收藏管理'));
scoreStorage=new ScoreStorageModel({openStorage:()=>openScoreStorage({origin:location.origin,validateScore:(score,signal)=>api('/api/compile',score,signal)})});
libraryManagement=setupLibraryManagementView({document,i18n,getStorage:()=>scoreStorage.storage(),getProtectedSong:()=>isBasicKeysSong(state.cleanSong)?state.cleanSong:null,onCommitted:async()=>{if(!await scoreStorage.rescan())throw new Error('Saved-song inventory refresh failed.');}});
window.addEventListener('pagehide',()=>libraryManagement.destroy());
bulkImportView=setupBulkImportView({document,i18n,getStorageKind:async()=>(await scoreStorage.storage()).info.kind,
  onOpen:()=>{scoreSaveNavigation++;state.loadIntent++;state.compileController?.abort();referenceListening?.close();performanceListening?.stop({revokePolicy:true});cancelPendingStart();},pausePlayback,
  onCommitted:async()=>{libraryManagement.invalidate();if(!await scoreStorage.rescan())throw new Error('Saved-song inventory refresh failed.');},
  onBrowse:identity=>{shell.show('library');void selectSongScore(identity);},onDone:()=>shell.show('library'),getSavedEntries:()=>scoreStorage.snapshot().entries});
$('bulk-import-history-button').addEventListener('click',()=>bulkImportView.open());
songAuthoringView=setupSongAuthoringView({document,i18n,getStorageKind:async()=>(await scoreStorage.storage()).info.kind,onCommitted:async()=>{libraryManagement.invalidate();if(!await scoreStorage.rescan())throw new Error('Saved-song inventory refresh failed.');},onHome:()=>shell.show('home'),onLibrary:()=>shell.show('library'),onBrowse:identity=>{shell.show('library');void selectSongScore(identity);}});
window.addEventListener('pagehide',()=>songAuthoringView.destroy());
scoreStorageView=setupScoreStorageView({model:scoreStorage,host:document.querySelector('#settings-dialog .shell-dialog-content'),document,i18n,getScore:()=>state.cleanSong?null:originalPitchContext(state).score,onSaveStart:beginExplicitScoreSave,onSaveResult:finishScoreSave});
$('settings-dialog').addEventListener('close',()=>{scoreSaveNavigation++});
const storageLobbyHost=document.createElement('div');$('catalog').before(storageLobbyHost);
setupScoreStorageLobbyStatus({model:scoreStorage,host:storageLobbyHost,document,i18n,onConfigure:()=>shell.open('settings')});
let managementInventorySignature=null;
scoreStorage.subscribe(snapshot=>{const signature=JSON.stringify(snapshot.entries.map(row=>row.libraryKey));if(managementInventorySignature!==null&&signature!==managementInventorySignature)libraryManagement.invalidate();managementInventorySignature=signature;const candidate=preview.value;if(snapshot.kind==='native'&&!snapshot.reading&&!snapshot.error&&candidate.identity?.startsWith('native:')&&candidate.status!=='error'&&!snapshot.entries.some(row=>row.libraryKey===candidate.identity)){preview.cancel();preview.publish({...candidate,status:'error',errorCode:'library_not_found',message:i18n.t('management.catalog.previewUnavailable')});}renderCatalog();const binding=displayBindings.get(legacyLibraryButton);if(binding?.text)legacyLibraryButton.textContent=binding.text()});
$('score-library').addEventListener('close',()=>{if(scoreStorage.snapshot().kind==='browser')void scoreStorage.rescan()});
// A completed paint needs current source IDs before its first reveal. The
// display-only refresh cannot advance transport, schedule sound or grade input.
const engravedView = setupEngravedView({getExportScore:()=>originalPitchContext(state).score,getPracticeAssistanceDisplay,i18n,onRenderComplete:()=>{drawFrame(true);notationFollowing?.viewportChanged();},onBasicPage:(page,batch)=>{if(hasBasicKeyRendition(state.cleanSong)){if(page){state.notationPart=batch?.scope==='all'?null:page.part_id;$('notation-part').value=state.notationPart||'';}if(!state.engravingActive)renderNotationPage();}},getScore:()=>state.score,getCleanSong:()=>state.cleanSong,getPracticePart:()=>state.practicePart,getPracticeSelection:()=>state.practiceSelection,getPracticeDisplay:()=>({layout:state.inspection?'inspection':state.practiceLayout,showOthers:state.inspection||state.showOtherParts,hiddenPartIds:state.inspection?[]:[...state.hiddenPartIds]}),getMode:()=>state.mode,isVisible:()=>shell.screen()==='stage'&&shell.notationVisible(),notice,onVisibility:active=>{
  state.engravingActive=active;
  document.querySelector('.engraving-pages').hidden=!active;
  const displayOptions=document.querySelector('.notation-display-options');if(displayOptions)displayOptions.hidden=!active;
  $('engraving-view').hidden=!active;$('notation-controls').hidden=active;$('notation').hidden=active;$('basic-notation-note').hidden=active;
  $('score-key').hidden=active;
  if($('dock-warning-count'))$('dock-warning-count').hidden=!active&&$('engraving-fallback').hidden;
  if(active){bindText($('score-key'), () => t('app.generatedStaff'));for(const id of ['staff-button','jianpu-button']){$(id).classList.remove('selected');$(id).setAttribute('aria-pressed','false')}$('engraved-button').classList.add('selected');$('engraved-button').setAttribute('aria-pressed','true')}
},onFallback:()=>selectBasicNotation('staff',{remember:false}),onManualNavigation:()=>notationFollowing?.suspend()});
$('workspace').addEventListener('notationscopechange',event=>{engravedView.setScope(event.detail);const scope=engravedView.scopeInfo();state.notationPart=scope.scope==='all'?null:scope.partId;$('notation-part').value=state.notationPart||'';renderNotationPage();});
completeScoreReader=setupCompleteScoreReader({document,i18n,getScore:()=>state.score,getExportScore:()=>originalPitchContext(state).score,getCleanSong:()=>state.cleanSong,onVisibility:open=>{if(!open)notationFollowing?.viewportChanged();}});
const completeScoreButton=document.createElement('button');completeScoreButton.id='complete-score-button';completeScoreButton.className='button secondary';completeScoreButton.type='button';completeScoreButton.setAttribute('aria-haspopup','dialog');bindText(completeScoreButton,()=>i18n.locale==='en'?'Complete score':'完整乐谱');$('notation-toggle').after(completeScoreButton);completeScoreButton.addEventListener('click',()=>completeScoreReader.open());
const basicNotationReveal=createBasicNotationReveal({container:$('notation'),dock:$('notation-dock')});
$('notation-dock').addEventListener('toggle',()=>basicNotationReveal.reset(),true);
$('workspace').addEventListener('notationviewportchange',()=>notationFollowing?.viewportChanged());
const followingView={
  usesPositionFollowing:()=>isBasicKeysSong(state.cleanSong),
  followPosition(position,running,written){
    if(!isBasicKeysSong(state.cleanSong))return null;
    const page=engravedView.followPosition(position);if(page?.status!=='ready')return page;
    const current=written?.occurrence?written:basicKeyWrittenAt(state.cleanSong,engravedView.basicPages(),position,state.timelineIndex?.range(position)||[]);
    if(!current)return{status:'pending'};
    if(!state.engravingActive)this.followMeasure(current.occurrence.source_measure_index,current.occurrence,current);
    return{...page,occurrence:current.occurrence};
  },
  isActive:()=>shell.screen()==='stage'&&shell.notationVisible(),
  resetReveal(){basicNotationReveal.reset();engravedView.resetReveal()},
  navigationState:()=>state.engravingActive?engravedView.navigationState():{ready:true},
  followMeasure(index,occurrence,written){
    if(state.engravingActive)return engravedView.followMeasure(index);
    if(hasBasicKeyRendition(state.cleanSong))return false;
    let page=basicNotationPage(occurrence,written?.entries,state.notationPart,state.notationSpan,written?.pageAnchor);
    if(page!==null&&$('workspace').classList.contains('notation-on-lanes'))page=Math.min(page,Math.max(0,notationPageCount(state.score,state.notationSpan)-2));
    if(page!==null&&page!==state.notationPage){state.notationPage=page;renderNotationPage()}
  },
  revealExpectedWrittenNotes(occurrenceId,index,written){
    if(!state.engravingActive&&$('workspace').classList.contains('notation-on-lanes'))return basicNotationReveal.reveal(occurrenceId,(written?.entries||[]).map(entry=>entry.sourceNoteId),index);
    return state.engravingActive?engravedView.revealExpectedWrittenNotes(occurrenceId,index):engravedView.revealRenditionEvents(written?.entries?.map(entry=>entry.sourceNoteId))||basicNotationReveal.reveal(occurrenceId,(written?.entries||[]).filter(entry=>state.notationPart===null||entry.partId===state.notationPart).map(entry=>entry.sourceNoteId));
  },
};
notationFollowing = setupNotationFollowing({i18n,getContext:()=>({score:state.score,timeline:state.compiled?.timeline}),
  prepareNavigation:async options=>{const cached=writtenCursor.navigation();if(cached)return cached;await writtenCursor.prepare(options);const navigation=writtenCursor.navigation();if(!navigation){const detail=writtenCursor.state().message;throw Object.assign(new Error(detail),{code:'notation_followMap',cause:{message:detail}})}return navigation},
  getPlayback:()=>{const position=playbackPosition(performance.now()),written=writtenCursor?.at(position);return{position:position<(state.loop?.start_ms||0)?-1:position,running:transport.running,written:{...written,entries:displayedWrittenEntries(written),pageAnchor:writtenCursor?.pageAnchor(position,displayedPartId())}}},view:followingView});
setupJianpuEditor({onImport:importJianpuText,pausePlayback});
setupJianpuExport({getScore:()=>originalPitchContext(state).score,getCleanSong:()=>originalPitchContext(state).cleanSong,pausePlayback,api});
setupSourceDirectory({pausePlayback,onScoreFile:()=>{referenceListening?.close();performanceListening?.stop({revokePolicy:true});$('score-file').click();},onImageFile:()=>$('score-image-file').click(),onExternalOmr:()=>externalOmrView.open()});
setupImageReview({onImport:(score,signal)=>importReviewedScore('confirmed-image-import',score,signal), pausePlayback, notice,onExternalOmr:imageFile=>externalOmrView.open({imageFile})});
referenceListening=setupReferenceListening({document,i18n,synth,pausePlayback:()=>{performanceListening?.stop({revokePolicy:true});pausePlayback();},onActiveChange:()=>syncInputRoute(),getSoundEnabled:()=>!synth.muted,onSoundChange:setSoundEnabled});
sourceArchiveView=setupSourceArchiveView({getContext:()=>({score:originalPitchContext(state).score,version:state.loadIntent}),pausePlayback});
externalOmrView = setupExternalOmrReview({api,onActivate:(score,signal,options)=>importReviewedScore('confirmed-omr-import',score,signal,options),pausePlayback,notice,getSourceVersion:()=>state.loadIntent});
// A one-part All-human Mod still identifies one unambiguous part for a
// selected-part octave copy. Keep the session's All ownership unchanged.
adaptationView = setupAdaptationView({api,pausePlayback,notice,onActivate:activateCanonicalTransformation,getContext:()=>({score:state.cleanSong?null:originalPitchContext(state).score,part:state.practicePart??(state.score?.parts.length===1?state.score.parts[0].id:null),profile:currentProfile(),dirty:state.profileDirty,version:`${state.loadIntent}:${state.practiceVersion}:${state.instrumentRequest}`})});
transpositionView = setupTranspositionView({api,pausePlayback,notice,onActivate:activateCanonicalTransformation,getContext:()=>({score:state.cleanSong?null:originalPitchContext(state).score,timeline:originalPitchContext(state).compiled?.timeline,part:state.practicePart,profile:currentProfile(),dirty:state.profileDirty,version:`${state.loadIntent}:${state.practiceVersion}:${state.instrumentRequest}`})});
const guitarContext=()=>({pitchView:state.pitchView,score:state.score,timeline:state.compiled?.timeline,cleanSong:state.cleanSong,...(state.practiceSelection?{part_id:null,selected_part_ids:state.practiceSelection.part_ids}:{part_id:state.practicePart}),profile:currentProfile(),dirty:state.profileDirty,...fingeringAssistanceContext()});
guitarFingering=setupGuitarFingering({api,getContext:guitarContext,onChange:()=>guitarFingeringView?.render()});
guitarFingeringView=setupGuitarFingeringView({document,controller:guitarFingering,getContext:guitarContext,onRefresh:drawFrame});
guitarFingeringView.render();
metronome = setupMetronome({api,getScore:()=>state.cleanSong?null:originalPitchContext(state).score,getDuration:()=>state.compiled?.timeline.duration_ms||0,getWindow:()=>state.loop,getPlayback:()=>({running:transport.running,position:playbackPosition(performance.now()),segment:transport.startedAt}),getCountInMs:()=>$('count-in').checked?4*60000/(Number($('tempo').value)||100):0,synth});
partActivityStage=createPartActivityStage({canonicalSession,cleanPlayer});
performanceView=setupPerformanceView({i18n,getContext:()=>({geometry:state.geometry,rangeLabel:`${midiName(state.geometry[0].midi)}–${midiName(state.geometry.at(-1).midi)}`,mode:state.mode,instrument:state.instrument,position:playbackPosition(performance.now()),segmentStart:state.loop?.start_ms||0,countInBeatMs:60000/(Number($('tempo').value)||100),running:transport.running,hasStarted:transport.hasStarted,completed:transport.completed,now:performance.now(),recorder:state.recorder})});
pianoFingering=setupPianoFingeringView({document,api,getContext:()=>({pitchView:state.pitchView,score:state.score,timeline:state.compiled?.timeline,cleanSong:state.cleanSong,part_id:state.practiceSelection?.kind==='parts'?state.practiceSelection.part_ids[0]:state.practicePart,profile:currentProfile(),dirty:state.profileDirty,...fingeringAssistanceContext()}),onChange:()=>drawFrame(),openSettings:()=>shell.open('settings')});
performanceView.setPianoGuidance($('piano-fingering-guidance'));
writtenCursorStatus=document.createElement('p');writtenCursorStatus.id='written-cursor-status';writtenCursorStatus.setAttribute('aria-live','off');
writtenCursorRetry=document.createElement('button');writtenCursorRetry.id='written-cursor-retry';writtenCursorRetry.type='button';writtenCursorRetry.className='button compact';bindText(writtenCursorRetry, () => t('app.retryNotePositions'));writtenCursorRetry.hidden=true;
document.querySelector('#notation-dock .dock-help').append(writtenCursorStatus,writtenCursorRetry);
writtenCursor=setupWrittenCursor({api,getContext:()=>({score:state.score,timeline:state.compiled?.timeline,cleanSong:state.cleanSong,nativeRuntime:state.cleanSong?.runtime}),onStatus:({status,message})=>{writtenCursorStatus.dataset.status=status;writtenCursorStatus.dataset.sourceNoteIds='[]';bindText(writtenCursorStatus, () => t(({idle:'app.cursorIdle',loading:'app.cursorLoading',ready:'app.cursorReady',unavailable:'app.cursorUnavailable'})[status]||'app.cursorUnavailable'));bindAttribute(writtenCursorStatus,'title',()=>originalDetail(message));writtenCursorRetry.hidden=status!=='unavailable';state.lastHighlight='';beginnerView?.refresh();if(status==='ready'){const source=state.score,timeline=state.compiled?.timeline;void Promise.resolve().then(()=>notationFollowing?.prepare()).then(()=>{if(source===state.score&&timeline===state.compiled?.timeline)return engravedView.refreshCompletedPaint();}).catch(()=>{});}}});
beginnerView=setupBeginnerView({document,i18n,getContext:()=>({score:state.score,numberedMode:state.numberedMode,written:beginnerView?.enabled()&&state.numberedMode==='movable'?writtenCursor?.at(playbackPosition(performance.now())):null}),onNumberedMode:setNumberedMode});
writtenCursorRetry.addEventListener('click',()=>writtenCursor.prepare({retry:true}));
window.addEventListener('pagehide',()=>writtenCursor.reset());
midiController=setupMidi({pressNote, releaseNote, releaseMatching, notice, pausePlayback,
  getConfiguredRange:()=>state.instrument==='guitar'?{low:Math.min(...state.guitar.tuning)+state.guitar.capo,high:Math.max(...state.guitar.tuning)+state.guitar.frets}:state.geometry.length?{low:state.geometry[0].midi,high:state.geometry.at(-1).midi}:null});
// End blocked intervals without changing native focus or recording ownership.
for(const dialog of document.querySelectorAll('dialog'))dialog.addEventListener('close',()=>{freeLiveStart=performance.now();});

function renderCleanActive(){
  if(!cleanView)return;
  const range=state.instrument==='piano'?[state.geometry[0].midi,state.geometry.at(-1).midi]:[Math.min(...state.guitar.tuning)+state.guitar.capo,Math.max(...state.guitar.tuning)+state.guitar.frets];
  cleanView.renderActive({song:state.cleanSong,songMod:state.songMod,score:state.score,timeline:state.compiled?.timeline,targetPart:state.practicePart,practiceSelection:state.practiceSelection,practiceLayout:state.practiceLayout,mode:state.mode,mutedParts:cleanMutedParts,soloParts:cleanSoloParts,soundEnabled:!synth.muted,running:transport.running,hasStarted:transport.hasStarted,completed:transport.completed,range,instrument:state.instrument});
}
function renderCleanPreview(){
  if(!cleanView)return;const song=preview?.value.cleanSong||null;const deviceRange=state.instrument==='guitar'?[Math.min(...state.guitar.tuning)+state.guitar.capo,Math.max(...state.guitar.tuning)+state.guitar.frets]:[state.geometry[0].midi,state.geometry.at(-1).midi];cleanView.renderPreview(song,{...preview?.value,deviceProfile:currentProfile(),deviceRange});
  performanceListening?.select(song);
  if(previewMediaKey!==song?.identity){previewMediaKey=song?.identity||null;void previewMedia.select(song?.libraryKey,song);}
  const lobby=document.querySelector('.lobby-audition');if(lobby)lobby.hidden=Boolean(song);
  const options=document.querySelector('.lobby-options');if(options)options.hidden=isPerformanceSong(song);
}
function syncCleanMedia(){
  if(!activeMedia)return;const song=state.cleanSong;
  if(activeMediaKey!==song?.identity){activeMediaKey=song?.identity||null;void activeMedia.select(song?.libraryKey,song);}
  renderCleanActive();
}
function openCleanRangeSetup(){
  // Open the shell's body-level dialog before focusing the existing controls.
  // Selecting Custom starts the normal draft/reset lifecycle without applying
  // a larger range; reopening an existing custom draft must preserve its inputs.
  shell.open('settings');
  if(state.instrument==='piano'&&!state.customKeys){$('key-count').value='custom';$('key-count').dispatchEvent(new window.Event('change',{bubbles:true}));}
  $('instrument-settings').open=true;
  $(state.instrument==='piano'?'custom-key-count':'guitar-tuning').focus();
}
fallingNoteLabels=setupFallingNoteLabels({document,i18n,onChange:()=>drawFrame(true)});
completePracticeView=setupCompletePracticeView({document,i18n,replacedByMod:true,getContext:origin=>origin==='preview'?{...preview.value,selection:preview.value.practiceSelection,previewVersion:preview.version}:({score:state.score,compiled:state.compiled,cleanSong:state.cleanSong,selection:state.practiceSelection,showOthers:state.showOtherParts,hasTakes:transport.hasStarted||state.recorder.passes.length>0}),onOpen:()=>pausePlayback(),onDisplay:show=>{state.showOtherParts=show;engravedView.practicePartChanged();renderNotationPage();drawFrame(true);refreshPracticeView();},onApply:applyCompletePracticeChoice});
songModView=setupSongModView({document,i18n,getContext:origin=>modContext(origin,{loadSourceDetails:true}),onOpen:()=>pausePlayback(),onPitchCheck:checkSongPitchMod,getAssistanceController:getSongModAssistanceController,onApply:applySongMod,onStart:startUnifiedPerformance,onRangeRepair:repairPreviewRange});
cleanView=setupCleanSongView({document,i18n,unifiedEntry:true,onRangeSetup:openCleanRangeSetup,onVsqStart:chooseVsqAndStart,onVsqChoice:()=>preview.chooseVsqPractice(async(song,signal)=>(await scoreStorage.storage()).chooseVsqPractice(song,{signal})),onOpen:()=>pausePlayback(),onTarget:part=>{if(!state.cleanSong||transport.running)return;void applyHumanSelection({kind:'parts',part_ids:[part]},{layout:'solo'});},onMute:(part,muted)=>{if(transport.running)return;if(muted)cleanMutedParts.add(part);else cleanMutedParts.delete(part);resetPlayback();},onSolo:(part,solo)=>{if(transport.running)return;if(solo)cleanSoloParts.add(part);else cleanSoloParts.delete(part);resetPlayback();},onResetMix:()=>{if(transport.running)return;cleanMutedParts.clear();cleanSoloParts.clear();resetPlayback();},onRange:()=>{$('key-count').value='88';$('key-count').dispatchEvent(new window.Event('change',{bubbles:true}));}});
performanceListening=setupCompletePerformanceListening({document,i18n,synth,host:$('clean-song-preview'),isVisible:()=>shell.screen()==='library',allowed:()=>!document.hidden&&!document.querySelector('dialog[open]'),onBeforePlay:()=>pausePlayback(),onActiveChange:()=>syncInputRoute(),getSoundEnabled:()=>!synth.muted,onSoundChange:setSoundEnabled});
const loadCleanAsset=async(key,handle,options)=>(await scoreStorage.storage()).loadAsset(key,handle,options);
previewMedia=createCleanSongMedia({loadAsset:loadCleanAsset,cover:cleanView.cover,onStatus:value=>cleanView.renderPreviewMedia(value)});
activeMedia=createCleanSongMedia({loadAsset:loadCleanAsset,background:cleanView.background,video:cleanView.video,onStatus:value=>cleanView.renderMedia(value)});
window.addEventListener('pagehide',()=>{canonicalSession.destroy();cleanPlayer.destroy();performanceListening.stop({revokePolicy:true});previewMedia.destroy();activeMedia.destroy();});

setupSkinSettings({document,i18n,runtime:skinRuntime,onChange:()=>drawFrame(true)});
setupBuildDiagnosticsView({document,i18n});
renderKeyboard(); renderFretboard(); updateButtons(); requestAnimationFrame(animate); void scoreStorage.start(); loadCatalog();

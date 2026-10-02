import {createMidiInputController} from './midi-input-controller.js';
import {setupMidiSettings, readMidiChoice, saveMidiChoice} from './midi-settings.js';
import {getAppI18n} from './app-locale.js';
export {normalizeEventTime, eventTimeEvidence, decodeMidi} from './midi-messages.js';

/** User-triggered Web MIDI access; the settings view never routes practice data. */
export function setupMidi({pressNote, releaseNote, releaseMatching, notice, pausePlayback = () => {}, getConfiguredRange = () => null,
  document:doc = globalThis.document, window:win = globalThis.window, navigator:nav = globalThis.navigator, storage, i18n = getAppI18n(doc)}) {
  const button=doc.getElementById('midi-button'), initial=readMidiChoice(storage,i18n), t=(key,params)=>i18n.t(`input.midi.${key}`,params);
  let view=null, preference=initial, lastPhase='idle', userRequested=false, model=null;
  function renderButton(snapshot) {
    const opened=snapshot.devices.filter(device=>device.connection==='open'&&(snapshot.choice.mode==='all'||snapshot.choice.id===device.id));
    button.disabled=snapshot.phase==='requesting';
    button.textContent=snapshot.phase==='requesting'?t('requesting'):opened.length?t('connectedCount',{count:opened.length}):snapshot.devices.some(device=>device.opening)?t('opening'):snapshot.phase==='ready'?t('ready'):t('connect');
    button.setAttribute('aria-label',button.textContent);
    button.title=opened.map(input=>input.name).join(', ');
  }
  function render(snapshot) {
    model=snapshot;renderButton(snapshot);
    if(snapshot.phase==='ready')doc.getElementById('midi-help').hidden=false;
    if(userRequested&&snapshot.phase!==lastPhase&&['error','unsupported'].includes(snapshot.phase))notice(()=>t(snapshot.phase==='unsupported'?'access.unsupported':'permissionDenied'),true);
    lastPhase=snapshot.phase;view?.render({...snapshot,storageCode:preference.code || '',storageMessage:preference.message});
  }
  const controller=createMidiInputController({requestAccess:typeof nav?.requestMIDIAccess==='function'?options=>nav.requestMIDIAccess(options):null,
    pressNote,releaseNote,releaseMatching,onChange:render,choice:initial.choice,getConfiguredRange});
  view=setupMidiSettings({document:doc,i18n,onSelection:choice=>{controller.select(choice);preference=saveMidiChoice(choice,storage,i18n);controller.refresh();},
    onTest:active=>{if(active)pausePlayback(t('testPausedPlayback'),'midi_key_test');controller.setTest(active);}});
  button.addEventListener('click',()=>{userRequested=true;lastPhase='idle';return controller.connect();});
  const stopTest=reason=>{if(controller.snapshot().test.active)controller.setTest(false,reason);};
  doc.getElementById('settings-dialog').addEventListener('close',()=>stopTest('settings_closed'));
  doc.addEventListener('visibilitychange',()=>{if(doc.hidden)stopTest('page_hidden');});
  doc.addEventListener('change',()=>controller.refresh());
  win.addEventListener('blur',()=>stopTest('window_blur'));
  win.addEventListener('pageshow',event=>{if(event.persisted)controller.resume();});
  win.addEventListener('pagehide',event=>controller.suspend(event));
  i18n.subscribe(()=>{if(model)renderButton(model);});
  controller.refresh();return controller;
}

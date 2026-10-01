import {createMidiInputController} from './midi-input-controller.js';
import {setupMidiSettings, readMidiChoice, saveMidiChoice} from './midi-settings.js';
export {normalizeEventTime, eventTimeEvidence, decodeMidi} from './midi-messages.js';

/** User-triggered Web MIDI access; the settings view never routes practice data. */
export function setupMidi({pressNote, releaseNote, releaseMatching, notice, pausePlayback = () => {}, getConfiguredRange = () => null}) {
  const button=document.getElementById('midi-button'), initial=readMidiChoice();
  let view=null, storageMessage=initial.message, lastPhase='idle', userRequested=false;
  function render(snapshot) {
    const opened=snapshot.devices.filter(device=>device.connection==='open'&&(snapshot.choice.mode==='all'||snapshot.choice.id===device.id));
    button.disabled=snapshot.phase==='requesting';
    button.textContent=snapshot.phase==='requesting'?'Requesting MIDI · 请求中':opened.length?`MIDI connected · ${opened.length}`:snapshot.devices.some(device=>device.opening)?'Opening MIDI · 正在打开':snapshot.phase==='ready'?'MIDI ready · Select input':'Connect MIDI · 连接电子琴';
    button.title=opened.map(input=>input.name).join(', ');
    if(snapshot.phase==='ready')document.getElementById('midi-help').hidden=false;
    if(userRequested&&snapshot.phase!==lastPhase&&['error','unsupported'].includes(snapshot.phase))notice(snapshot.message||'MIDI input is not available in this browser. Use a supported desktop browser or the on-screen keyboard. · 当前浏览器不支持 MIDI 输入',true);
    lastPhase=snapshot.phase;view?.render({...snapshot,storageMessage});
  }
  const controller=createMidiInputController({requestAccess:typeof navigator.requestMIDIAccess==='function'?options=>navigator.requestMIDIAccess(options):null,
    pressNote,releaseNote,releaseMatching,onChange:render,choice:initial.choice,getConfiguredRange});
  view=setupMidiSettings({document,onSelection:choice=>{controller.select(choice);storageMessage=saveMidiChoice(choice).message;controller.refresh();},
    onTest:active=>{if(active)pausePlayback('Paused for MIDI key test · 已暂停以测试电子琴','midi_key_test');controller.setTest(active);}});
  button.addEventListener('click',()=>{userRequested=true;lastPhase='idle';return controller.connect();});
  const stopTest=reason=>{if(controller.snapshot().test.active)controller.setTest(false,reason);};
  document.getElementById('settings-dialog').addEventListener('close',()=>stopTest('settings closed'));
  document.addEventListener('visibilitychange',()=>{if(document.hidden)stopTest('page hidden');});
  document.addEventListener('change',()=>controller.refresh());
  window.addEventListener('blur',()=>stopTest('window focus lost'));
  window.addEventListener('pageshow',event=>{if(event.persisted)controller.resume();});
  window.addEventListener('pagehide',event=>controller.suspend(event));
  controller.refresh();return controller;
}

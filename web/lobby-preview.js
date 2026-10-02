import {Synth, Transport} from './transport.js';
import {localizeStatic} from './locale-view.js';

export const LOBBY_PREVIEW_MS = 30000;

/** A separate transport and Synth consume Rust's compiled source timeline.
 * There is no recorder, score mutation, adaptation, or input ownership here. */
export function createLobbyPreview({audio = new Synth(), now = () => performance.now(),
  schedule = callback => setTimeout(callback, 25), cancel = clearTimeout,
  allowed = () => true, onChange = () => {}} = {}) {
  const transport = new Transport();
  let compiled = null, identity = null, notes = [], start = 0, end = 0;
  let generation = 0, timer = null, status = 'empty', sound = true, volume = .45;
  let lastTick = 0, instrument = 'piano', disposed = false;
  const snapshot = () => ({status, identity, sound, volume, available: notes.length > 0,
    position: Math.max(0, Math.min(end - start, transport.time(now()) - start)), duration: end - start});
  const emit = () => onChange(snapshot());
  function gain() {
    audio.muted = !sound;
    if (audio.output) audio.output.gain.value = .7 * volume;
  }
  function stop(reason = 'stopped') {
    generation++;
    if (timer !== null) cancel(timer);
    timer = null;
    transport.pause(now());
    audio.silence();
    status = reason; emit();
  }
  function tick(token) {
    if (disposed || token !== generation) return;
    if (!allowed() || now() - lastTick > 1000 || audio.context?.state === 'suspended') {stop('interrupted');return;}
    lastTick = now();
    if (transport.time(lastTick) >= end) {transport.finish(end);stop('ended');return;}
    try {
      for (const note of transport.due(lastTick, notes, 80)) {
        if (note.start_ms >= end) continue;
        audio.play(`lobby:${token}:${transport.cursor}:${note.id}`, note.midi,
          Math.min(note.remaining_ms, end - Math.max(transport.time(lastTick), note.start_ms)),
          note.delay_ms, instrument, note.velocity ?? 90);
      }
    } catch {stop('failed');return;}
    emit(); timer = schedule(() => tick(token));
  }
  function select(value) {
    const next = value?.status === 'ready' ? value.compiled : null;
    if (next === compiled && (value?.identity ?? null) === identity) return;
    stop(); compiled = next; identity = value?.identity ?? null; notes = []; start = 0; end = 0;
    const timeline = next?.timeline;
    if (timeline && Array.isArray(timeline.notes) && Number.isFinite(timeline.duration_ms)) {
      // Work on a sorted array; never sort or alter the canonical compiled data.
      const valid = timeline.notes.every(note => Number.isFinite(note.start_ms) && note.start_ms >= 0 &&
        Number.isFinite(note.duration_ms) && note.duration_ms > 0 && Number.isInteger(note.midi) && note.midi >= 0 && note.midi <= 127);
      if (valid && timeline.notes.length) {
        const sorted = [...timeline.notes].sort((a,b) => a.start_ms-b.start_ms);
        start = sorted[0].start_ms;end = Math.min(timeline.duration_ms, start + LOBBY_PREVIEW_MS);
        if (end > start) notes = sorted.filter(note => note.start_ms < end);
      }
    }
    transport.seek(start);
    status = value?.status === 'loading' ? 'loading' : next ? (notes.length ? 'ready' : 'noNotes') : 'empty';emit();
  }
  async function play() {
    if (disposed || !allowed() || !notes.length || !sound || volume === 0 || ['playing','loadingAudio'].includes(status)) return false;
    stop(); const token = generation, source = compiled; status = 'loadingAudio';emit();
    try {
      // Called synchronously from the button gesture, before any await.
      await audio.unlock();
      if (disposed || token !== generation || source !== compiled) return false;
      if (!allowed() || !sound || volume === 0) {stop('interrupted');return false;}
      gain();transport.seek(start);lastTick = now();transport.start(lastTick,notes);status = 'playing';emit();tick(token);return true;
    } catch {if (token === generation) stop('failed');return false;}
  }
  return {select,play,stop,snapshot,
    setSound(value) {sound=Boolean(value);gain();if(!sound)stop('muted');else {if(status==='muted')status='stopped';emit();}},
    setVolume(value) {const next=Number(value);if(!Number.isFinite(next))return;volume=Math.max(0,Math.min(1,next));gain();if(volume===0)stop('muted');else {if(status==='muted')status='stopped';emit();}},
    setInstrument(value) {if(!['piano','guitar'].includes(value)||instrument===value)return;instrument=value;stop();},
    destroy() {stop();disposed=true;}
  };
}

const time = ms => `${Math.floor(ms/60000)}:${String(Math.floor(ms/1000)%60).padStart(2,'0')}`;
export function setupLobbyPreview({document,i18n,allowed,audio,now,schedule,cancel}) {
  const $ = id => document.getElementById(id), host=document.querySelector('.preview-copy');
  const panel=document.createElement('section');panel.className='lobby-audition';panel.setAttribute('aria-labelledby','lobby-preview-heading');
  panel.dataset.keyboardInput='off';
  panel.innerHTML=`<div class="lobby-audition-heading"><h3 id="lobby-preview-heading" data-i18n="rhythm.previewTitle"></h3><span id="lobby-preview-clock">0:00 / 0:00</span></div>
    <div class="lobby-audition-controls"><button id="lobby-preview-play" type="button" class="button secondary"></button><label class="lobby-preview-sound"><input id="lobby-preview-sound" type="checkbox" checked><span data-i18n="rhythm.previewSound"></span></label><label class="lobby-preview-volume"><span data-i18n="rhythm.previewVolume"></span><input id="lobby-preview-volume" type="range" min="0" max="100" value="45"></label></div>
    <progress id="lobby-preview-progress" max="1" value="0" data-i18n-aria-label="rhythm.previewTitle"></progress><p id="lobby-preview-status" role="status"></p><p class="lobby-preview-scope" data-i18n="rhythm.previewScope"></p>`;
  host.prepend(panel);
  const options=document.createElement('div');options.className='lobby-options';
  options.innerHTML=`<label><span data-i18n="rhythm.previewInstrument"></span><select id="lobby-instrument"><option value="piano" data-i18n="free.timbre.piano"></option><option value="guitar" data-i18n="free.timbre.guitar"></option></select></label><div class="lobby-edition" id="lobby-edition"><span data-i18n="rhythm.currentEdition"></span><strong data-i18n="rhythm.originalDifficulty"></strong><small data-i18n="rhythm.difficultyHelp"></small></div>`;
  panel.after(options);
  let current;
  function render(value=current) {
    if(!value)return;current=value;
    const active=['playing','loadingAudio'].includes(value.status);
    $('lobby-preview-play').textContent=i18n.t(active?'rhythm.previewStop':'rhythm.previewPlay');
    $('lobby-preview-play').disabled=!active&&(!value.available||!value.sound||value.volume===0);
    $('lobby-preview-play').setAttribute('aria-pressed',String(active));
    $('lobby-preview-play').setAttribute('aria-busy',String(value.status==='loadingAudio'));
    const key=({empty:'previewEmpty',loading:'previewLoading',loadingAudio:'previewLoading',ready:'previewReady',playing:'previewPlaying',stopped:'previewStopped',ended:'previewEnded',failed:'previewFailed',muted:'previewMuted',noNotes:'previewNoNotes',interrupted:'previewInterrupted'})[value.status];
    const status=$('lobby-preview-status'),text=i18n.t(`rhythm.${key}`);if(status.textContent!==text)status.textContent=text;status.dataset.state=value.status;
    $('lobby-preview-clock').textContent=`${time(value.position)} / ${time(value.duration)}`;
    $('lobby-preview-progress').max=value.duration||1;$('lobby-preview-progress').value=value.position;
    $('lobby-preview-sound').checked=value.sound;
    $('lobby-preview-volume').value=String(Math.round(value.volume*100));
    $('lobby-preview-volume').setAttribute('aria-valuetext',`${Math.round(value.volume*100)}%`);
  }
  const player=createLobbyPreview({audio,now,schedule,cancel,allowed,onChange:render});
  const cleanups=[];
  const listen=(node,event,callback)=>{node.addEventListener(event,callback);cleanups.push(()=>node.removeEventListener(event,callback));};
  listen($('lobby-preview-play'),'click',()=>['playing','loadingAudio'].includes(player.snapshot().status)?player.stop():player.play());
  listen($('lobby-preview-sound'),'change',()=>player.setSound($('lobby-preview-sound').checked));
  listen($('lobby-preview-volume'),'input',()=>player.setVolume(Number($('lobby-preview-volume').value)/100));
  listen($('lobby-instrument'),'change',()=>{
    const control=$('instrument');control.value=$('lobby-instrument').value;
    control.dispatchEvent(new document.defaultView.Event('change',{bubbles:true}));
  });
  listen($('instrument'),'change',()=>{$('lobby-instrument').value=$('instrument').value;player.setInstrument($('instrument').value);});
  listen(document,'visibilitychange',()=>{if(document.hidden)player.stop('interrupted');});
  for(const event of ['pagehide','blur'])listen(document.defaultView,event,()=>player.stop('interrupted'));
  const localize=()=>{localizeStatic(panel,i18n);localizeStatic(options,i18n);render();};
  localize();render(player.snapshot());const unsubscribe=i18n.subscribe(localize);
  return {...player,destroy(){for(const cleanup of cleanups)cleanup();unsubscribe();player.destroy();}};
}

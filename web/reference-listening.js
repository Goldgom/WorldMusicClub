import referenceSchema from './locales/reference-listening-schema.js';
import {loadMidiReference, createMidiReferencePlayer} from './midi-reference-player.js';

const MAX_BYTES = 5 * 1024 * 1024;
const clock = seconds => {
  const value = Math.max(0, Number(seconds) || 0), whole = Math.floor(value);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}.${Math.floor((value - whole) * 10)}`;
};

/** An in-session complete-source listener, never a score or a capture producer. */
export function setupReferenceListening({document, i18n, synth, pausePlayback,
  onActiveChange = () => {}, getSoundEnabled, onSoundChange,
  request = globalThis.fetch, crypto = globalThis.crypto,
  timers = {setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms), clearTimeout: id => globalThis.clearTimeout(id)},
  urls = globalThis.URL,
}) {
  const importDialog = document.getElementById('import-tools-dialog');
  const entry = document.createElement('button');
  entry.id = 'reference-listening-entry'; entry.type = 'button'; entry.className = 'button secondary';
  importDialog.querySelector('.shell-dialog-content').prepend(entry);
  const dialog = document.createElement('dialog');
  dialog.id = 'reference-listening-dialog'; dialog.className = 'shell-dialog reference-listening';
  dialog.dataset.keyboardInput = 'off'; dialog.setAttribute('aria-labelledby', 'reference-title');
  dialog.innerHTML = `<header class="shell-dialog-heading"><h2 id="reference-title"></h2><button id="reference-close" type="button" class="button secondary"></button></header>
  <div class="shell-dialog-content">
    <p id="reference-scope"></p><p id="reference-session-scope"></p>
    <div class="reference-actions"><button id="reference-choose-file" type="button" class="button primary"></button><input id="reference-file" type="file" accept=".mid,.midi,audio/midi" hidden><button id="reference-download" type="button" class="button secondary" disabled></button></div>
    <p id="reference-source-name"></p><p id="reference-counts"></p><p id="reference-source-hash" class="reference-hash"></p>
    <section aria-labelledby="reference-policy-title"><h3 id="reference-policy-title"></h3><p id="reference-policy-tone"></p><p id="reference-policy-percussion"></p><p id="reference-policy-events"></p><p id="reference-policy-resume"></p><p id="reference-policy-limits"></p><ul id="reference-programs"></ul>
      <label class="reference-choice"><input id="reference-policy-accept" type="checkbox"><span id="reference-policy-label"></span></label>
    </section>
    <section aria-labelledby="reference-tracks-title"><h3 id="reference-tracks-title"></h3><p id="reference-mute-help"></p><ul id="reference-tracks"></ul></section>
    <p id="reference-problems" role="alert" hidden></p>
    <label class="reference-choice"><input id="reference-sound" type="checkbox"><span id="reference-sound-label"></span></label>
    <div class="reference-actions"><button id="reference-play" type="button" class="button primary" disabled></button><button id="reference-pause" type="button" class="button secondary" disabled></button><button id="reference-stop" type="button" class="button secondary" disabled></button><output id="reference-clock" aria-label=""></output></div>
    <p id="reference-status" role="status" aria-live="polite"></p>
  </div>`;
  document.body.append(dialog);
  const $ = id => document.getElementById(`reference-${id}`);
  const t = (key, params) => i18n.t(`reference.${key}`, params);
  let source = null, player = null, loading = false, loadToken = 0, errorCode = null, clockTimer = null, active = false, destroyed = false;
  let trackRows = [], programRows = [];
  const closedWaiters = [];
  const snapshot = () => player?.snapshot() ?? {state:'stopped', positionSeconds:0, mutedTracks:[], error:null};
  function clearClock() { if (clockTimer !== null) timers.clearTimeout(clockTimer); clockTimer = null; }
  function refreshClock() {
    clearClock();
    const current = snapshot();
    $('clock').textContent = `${clock(current.positionSeconds)} / ${clock(source?.prepared?.durationSeconds)}`;
    if (active && current.state === 'playing') clockTimer = timers.setTimeout(refreshClock, 100);
  }
  function render() {
    entry.textContent = t('entry');
    for (const [id, key] of Object.entries({title:'title',close:'close',scope:'scope','session-scope':'sessionScope','choose-file':'choose',download:'download','policy-title':'policyTitle','policy-tone':'policyTone','policy-percussion':'policyPercussion','policy-events':'policyEvents','policy-resume':'policyResume','policy-limits':'policyLimits','policy-label':'policyAccept','tracks-title':'tracksTitle','mute-help':'muteHelp','sound-label':'sound',pause:'pause',stop:'stop'})) $(id).textContent = t(key);
    const current = snapshot(), prepared = source?.prepared;
    $('source-name').textContent = source?.name ?? t('noSource');
    $('source-hash').textContent = source?.hash ? t('hash', {hash:source.hash}) : '';
    $('counts').textContent = prepared ? t('counts', {tracks:prepared.trackCount, events:prepared.eventCount, onsets:prepared.voices.length}) : '';
    for (const [key, value] of Object.entries({trackCount:prepared?.trackCount ?? '',eventCount:prepared?.eventCount ?? '',onsetCount:prepared?.voices.length ?? ''})) $('counts').dataset[key] = String(value);
    $('download').disabled = !source?.bytes;
    const ready = Boolean(prepared?.playable && player && !loading), stopped = current.state === 'stopped';
    $('play').textContent = t(current.state === 'paused' ? 'resume' : 'play');
    $('play').disabled = !ready || !$('policy-accept').checked || !getSoundEnabled() || ['playing','starting','error'].includes(current.state);
    $('pause').disabled = !['playing','starting'].includes(current.state);
    $('stop').disabled = !player || stopped;
    $('sound').checked = getSoundEnabled();
    $('policy-accept').disabled = !prepared?.playable || loading || ['playing','starting'].includes(current.state);
    $('clock').setAttribute('aria-label', t('elapsed'));
    for (const row of trackRows) {
      row.label.textContent = t('track', {track:row.index + 1, name:row.name || t('unnamed')});
      row.counts.textContent = t('trackCounts', {events:row.events, onsets:row.onsets});
      row.description.textContent = t(row.independent ? 'independent' : 'shared');
      row.muteLabel.textContent = t('mute'); row.input.disabled = !ready || !stopped || !row.independent;
      row.input.checked = current.mutedTracks.includes(row.index);
    }
    for (const row of programRows) row.element.textContent = t('program', {channel:row.channel, program:row.program, family:t(row.channel === 9 ? 'percussionName' : `family${row.program >> 3}`)});
    const codes = [...new Set([errorCode, current.error?.code, ...(prepared?.blockers.map(item => item.code) ?? [])].filter(Boolean))];
    $('problems').hidden = !codes.length;
    $('problems').textContent = codes.map(code => `${t('problem')} ${code}: ${t(`error.${Object.hasOwn(referenceSchema, `reference.error.${code}`) ? code : 'generic'}`)}`).join('\n');
    // Error codes are retained identifiers; all application explanations are translated.
    const status = loading ? 'loading' : codes.length ? 'error' : !source ? 'empty' : !getSoundEnabled() ? 'muted' : prepared ? current.state : 'empty';
    $('status').dataset.state = status; $('status').textContent = t(`state.${status}`);
    refreshClock();
  }
  function rebuildSourceRows() {
    $('tracks').replaceChildren(); $('programs').replaceChildren(); trackRows = []; programRows = [];
    const prepared = source?.prepared; if (!prepared) return;
    const stats = prepared.tracks.map(track => ({...track, events:0, onsets:0, name:''}));
    for (const event of prepared.timeline.events) {
      const row = stats[event.id.track_index]; row.events++;
      if (event.kind.kind === 'meta' && event.kind.meta_type === 3 && !row.name) row.name = new TextDecoder().decode(Uint8Array.from(event.kind.data));
    }
    for (const voice of prepared.voices) stats[voice.trackIndex].onsets++;
    for (const row of stats) {
      const li = document.createElement('li'); li.dataset.trackIndex = String(row.trackIndex); li.dataset.eventCount = String(row.events); li.dataset.onsetCount = String(row.onsets);
      const label = document.createElement('strong'), counts = document.createElement('span'), description = document.createElement('span');
      const choice = document.createElement('label'), input = document.createElement('input'), muteLabel = document.createElement('span');
      input.type = 'checkbox'; input.id = `reference-mute-${row.trackIndex}`; choice.append(input,muteLabel); choice.className = 'reference-choice';
      li.append(label,counts,description,choice); $('tracks').append(li);
      input.addEventListener('change', () => {try {player?.setTrackMuted(row.trackIndex,input.checked);} catch (error) {errorCode=error.code || 'generic';render();}});
      trackRows.push({...row,index:row.trackIndex,label,counts,description,input,muteLabel});
    }
    for (const program of prepared.programs) {const element=document.createElement('li');$('programs').append(element);programRows.push({...program,element});}
  }
  function stop() {clearClock();player?.stop();render();}
  function pause() {player?.pause();render();}
  function closed() {if (!active) return;active=false;stop();onActiveChange(false);for(const resolve of closedWaiters.splice(0))resolve();}
  function close() {if(dialog.open)dialog.close();closed();}
  function open() {
    if(active)return;
    pausePlayback(); if(importDialog.open)importDialog.close();
    active=true;dialog.showModal();onActiveChange(true);render();
  }
  async function choose(file) {
    if(!file)return;
    const token=++loadToken;stop();loading=true;errorCode=null;$('policy-accept').checked=false;render();
    try {
      if(!file.size || file.size>MAX_BYTES)throw {code:'source_limit'};
      if(!crypto?.subtle)throw {code:'live_rust_required'};
      const bytes=new Uint8Array(await file.arrayBuffer());
      if(token!==loadToken || destroyed)return;
      const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
      if(token!==loadToken || destroyed)return;
      player=null;source={name:file.name,bytes,hash,prepared:null};rebuildSourceRows();render();
      const prepared=await loadMidiReference({originalBytes:bytes,expectedSourceSha256:hash,request,crypto});
      if(token!==loadToken || destroyed)return;
      source.prepared=prepared;
      if(prepared.playable)player=createMidiReferencePlayer(prepared,{timers,onState:()=>render(),contextFactory:async()=>{
        if(!getSoundEnabled())throw {code:'sound_off'};
        await synth.unlock();
        if(!getSoundEnabled())throw {code:'sound_off'};
        return {context:synth.context,output:synth.output};
      }});
      rebuildSourceRows();
    } catch(error) {if(token===loadToken&&!destroyed)errorCode=error.code || 'generic';}
    finally {if(token===loadToken&&!destroyed){loading=false;render();}}
  }
  entry.addEventListener('click',open);
  $('close').addEventListener('click',close);dialog.addEventListener('close',closed);
  dialog.addEventListener('cancel',event=>{if(event.target===dialog)stop();});
  $('choose-file').addEventListener('click',()=>{pause();$('file').click();});
  $('file').addEventListener('change',event=>{const file=event.target.files?.[0];event.target.value='';void choose(file);});
  $('policy-accept').addEventListener('change',()=>{if(!$('policy-accept').checked)stop();render();});
  $('sound').addEventListener('change',()=>onSoundChange($('sound').checked));
  $('play').addEventListener('click',async()=>{
    if(!active||!player||!getSoundEnabled()||!$('policy-accept').checked||loading)return;
    errorCode=null;
    try {const starting=player.play({userGesture:true,acceptedPolicyId:source.prepared.policy.id});render();await starting;} catch(error) {errorCode=error.code||'generic';}
    if(!destroyed)render();
  });
  $('pause').addEventListener('click',pause);$('stop').addEventListener('click',stop);
  $('download').addEventListener('click',()=>{
    if(!source?.bytes)return;
    const url=urls.createObjectURL(new Blob([source.bytes],{type:'audio/midi'})),link=document.createElement('a');
    link.href=url;link.download=source.name;link.click();timers.setTimeout(()=>urls.revokeObjectURL(url),1000);
  });
  const unsubscribe=i18n.subscribe(render);render();
  return {open,close,stop,pause,isOpen:()=>active,whenClosed:()=>active?new Promise(resolve=>closedWaiters.push(resolve)):Promise.resolve(),soundChanged(){if(!getSoundEnabled())stop();else render();},
    destroy(){close();destroyed=true;loadToken++;unsubscribe();entry.remove();dialog.remove();}};
}

import {FreePracticeRecorder} from './free-practice-recorder.js';
import {openPerformanceLibrary, validatePerformanceRecord, describePerformance, comparePerformances} from './performance-library.js';

const copy = value => value === null ? null : structuredClone(value);
const fail = code => Object.assign(new Error(code), {code});
const active = state => state === 'recording' || state === 'paused';

/** Independent of score transport, assessment, MIDI permissions and audio.
 * Capture owner() with each recording contact: it remains valid until Stop.
 * liveOwner() is a separate cancellation epoch for async sound admission.
 * Previously owned delayed evidence survives pause/resume; it never authorizes sound.
 */
export function createFreePracticeSession({now = () => performance.now(), dateNow = () => new Date().toISOString(),
  newId = () => crypto.randomUUID(), openLibrary = () => openPerformanceLibrary(),
  onChange = () => {}, onBoundary = () => {}, onViewError = () => {}, recorderOptions = {}} = {}) {
  let entered = false, recorder = null, ownership = null, liveOwnership = null, draft = null, saveStatus = 'none', saved = null;
  let libraryPromise = null, saving = null, rows = [], selected = null, baseline = null, error = null, loadVersion = 0;
  const metadata = value => value ? Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'record')) : null;
  const listeners = new Set();
  const state = () => recorder?.state ?? 'idle';
  const snapshot = () => ({entered, state:state(), saveStatus, saved:copy(saved), hasDraft:!!draft,
    hasUnsavedDraft:!!draft && saveStatus !== 'saved', eventCount:recorder?.evidence.events.length ?? 0,
    omitted:recorder?.evidence.omitted ?? 0, truncated:!!recorder?.evidence.omitted,
    records:copy(rows), selected:copy(metadata(selected)), baseline:copy(metadata(baseline)), error});
  function emit() { const value = snapshot(); for(const listener of [onChange,...listeners]){try{listener(value);}catch(caught){try{onViewError(caught);}catch{/* View failures cannot change a committed storage result. */}}} }
  function boundary(reason) { onBoundary(reason); }
  function rotateLive() { liveOwnership = Object.freeze({}); }
  function rotate() { ownership = Object.freeze({}); rotateLive(); }
  async function library() {
    if (!libraryPromise) libraryPromise = Promise.resolve().then(openLibrary).catch(caught => {libraryPromise=null;throw caught;});
    return libraryPromise;
  }
  async function refresh() { rows = await (await library()).list(); if(error==='performance.refresh_failed')error=null;emit(); return copy(rows); }
  function enter() { if (!entered) {entered=true;rotateLive();emit();} return snapshot(); }
  function leave(wallTime = now()) {
    if (state() === 'recording') recorder.pause(wallTime,'free_leave');
    entered=false;liveOwnership=null;boundary('free_leave');emit();
  }
  function start({configuration = {}} = {}, wallTime = now()) {
    if (!entered || active(state()) || saving || (draft && saveStatus !== 'saved')) throw fail('free.invalid_state');
    // Prepare off to the side: a rejected configuration cannot replace the saved take.
    const next = new FreePracticeRecorder({...recorderOptions,id:newId(),createdAt:dateNow(),onLimit:()=>{recorderOptions.onLimit?.();}});
    next.start(wallTime);
    for (const [key,value] of Object.entries(configuration)) next.configure(key,value,wallTime);
    boundary('free_start');recorder=next;draft=null;saved=null;saveStatus='none';error=null;rotate();emit();
    return ownership;
  }
  function pause(wallTime = now(), reason = 'free_pause') {
    if (!recorder?.pause(wallTime,reason)) return false;
    rotateLive();boundary(reason);emit();return true;
  }
  function resume(wallTime = now()) {
    if (!entered || state() !== 'paused') return false;
    recorder.resume(wallTime);error=null;rotateLive();boundary('free_resume');emit();return true;
  }
  function stop(wallTime = now()) {
    if (draft) return copy(draft);
    if (!active(state())) throw fail('free.invalid_state');
    draft=recorder.stop(wallTime,dateNow());ownership=null;rotateLive();saveStatus='unsaved';error=null;boundary('free_stop');emit();
    return copy(draft);
  }
  function observe(kind, observation, owner) {
    if (!ownership || owner !== ownership || !active(state())) return {accepted:false,reason:'free.stale_owner'};
    const result=recorder.observe(kind,observation);emit();return result;
  }
  function cleanup(wallTime = now(), reason = 'input_cleanup', selector = {}, owner = ownership) {
    if(owner !== ownership)return false;
    const changed=recorder?.cleanup(wallTime,reason,selector) ?? false;
    if (changed) emit();return changed;
  }
  function configure(key,value,wallTime = now()) {
    if (!active(state())) return false;
    try{const changed=recorder.configure(key,value,wallTime);if(changed===false)return false;error=null;rotateLive();boundary('configuration_change');emit();return true;}
    catch(caught){
      if(key==='keyboard_configuration' && recorder.state==='recording'){try{recorder.pause(now(),'configuration_failed');}catch{/* Admission remains blocked until a truthful boundary can be recorded. */}}
      rotateLive();boundary('configuration_failed');error=caught.code || 'free.invalid_configuration';emit();throw caught;
    }
  }
  function discardDraft() {
    if (active(state()) || saving) throw fail('free.invalid_state');
    draft=null;recorder=null;saved=null;saveStatus='none';error=null;ownership=null;emit();
  }
  function save({label} = {}) {
    if (saving) return saving;
    if (!draft) return Promise.reject(fail('free.invalid_state'));
    if (saveStatus === 'saved') return Promise.resolve(copy(saved));
    saveStatus='pending';error=null;emit();
    saving=(async()=> {
      try {
        saved=await (await library()).save(copy(draft),label === undefined ? {} : {label});
        saveStatus='saved';loadVersion++;selected={...copy(saved),record:copy(draft)};emit();
        // A failed list refresh must not turn a committed save into a failed save.
        try {await refresh();} catch (caught) {error='performance.refresh_failed';emit();}
        return copy(saved);
      } catch(caught) {saveStatus='failed';error=caught.code || 'performance.unavailable';emit();throw caught;}
      finally {saving=null;}
    })();
    return saving;
  }
  async function load(key) {
    const request=++loadVersion, value=await (await library()).get(key);
    if (!value) throw fail('performance.not_found');
    if(request !== loadVersion) return null;
    selected=copy(value);error=null;emit();return copy(selected);
  }
  function chooseBaseline() {
    if(!selected) throw fail('free.no_selection');
    baseline=copy(selected);emit();return copy(baseline);
  }
  function comparison() {return baseline && selected ? {baseline_selection:{key:baseline.key,revision:baseline.revision,label:baseline.label},current_selection:{key:selected.key,revision:selected.revision,label:selected.label},...comparePerformances(baseline.record,selected.record)} : null;}
  return {snapshot,enter,leave,start,pause,resume,stop,owner:()=>entered?ownership:null,liveOwner:()=>entered?liveOwnership:null,observe,cleanup,configure,discardDraft,save,
    subscribe(listener){listeners.add(listener);return()=>listeners.delete(listener);},refresh,load,chooseBaseline,comparison,
    draft:()=>copy(draft),selectedRecord:()=>copy(selected?.record ?? null),
    describe:()=>selected ? describePerformance(selected.record) : null,
    exportDraft(){if(!draft)throw fail('free.invalid_state');return JSON.stringify(draft);},
    async exportRecord(key=selected?.key){if(!key)throw fail('free.no_selection');return (await library()).exportRecord(key);},
    async importRecord(text){const item=await (await library()).importRecord(text);try{await refresh();await load(item.key);}catch(caught){error='performance.refresh_failed';emit();}return item;},
    async exportBackup(){return (await library()).exportBackup();},
    async restoreBackup(text){const items=await (await library()).restoreBackup(text);try{await refresh();}catch(caught){error='performance.refresh_failed';emit();}return items;},
    async close(){ownership=null;liveOwnership=null;entered=false;loadVersion++;boundary('free_close');(await libraryPromise)?.close();libraryPromise=null;}
  };
}

export const FREE_PREVIEW_LIMITS = Object.freeze({tones:4096, spanMs:120000, toneMs:160, perTick:64, tickMs:16, lateMs:100});

/** Fixed short tones from eligible observed onsets. No releases or durations are inferred. */
export function createFreePracticePreview({audio, soundEnabled=()=>false, now=()=>performance.now(),
  schedule=(callback,delay)=>setTimeout(callback,delay), cancel=timer=>clearTimeout(timer), onChange=()=>{}} = {}) {
  let generation=0,timer=null,status='idle',error=null,tones=[],cursor=0,startWall=0,scheduled=0,skipped=0,excluded=0,timbre='piano';
  const voices=new Set(),listeners=new Set();
  const snapshot=()=>({status,error,planned:tones.length,scheduled,skipped,excluded,timbre,toneMs:FREE_PREVIEW_LIMITS.toneMs});
  const emit=()=>{const value=snapshot();onChange(value);for(const listener of listeners)listener(value);};
  function silence(){for(const id of voices){try{audio?.stop?.(id);}catch{/* Continue releasing the remaining owned voices. */}}voices.clear();}
  function stop(reason='stopped'){generation++;if(timer!==null)cancel(timer);timer=null;silence();status=reason;emit();}
  function tick(token) {
    if(token!==generation)return;
    if(!soundEnabled()){stop('muted');return;}
    const elapsed=Math.max(0,now()-startWall);let count=0;
    while(cursor<tones.length && tones[cursor].at<=elapsed){
      const tone=tones[cursor++];
      if(elapsed-tone.at>FREE_PREVIEW_LIMITS.lateMs || count>=FREE_PREVIEW_LIMITS.perTick){skipped++;continue;}
      const id=`free-preview:${token}:${cursor}`;voices.add(id);
      // Retire old IDs even if the audio adapter does not report ended voices.
      if(voices.size>FREE_PREVIEW_LIMITS.perTick){const first=voices.values().next().value;audio.stop?.(first);voices.delete(first);}
      try{audio.play(id,tone.midi,FREE_PREVIEW_LIMITS.toneMs,0,timbre,tone.velocity);}catch(caught){error=caught.code || 'free.audio_unavailable';stop('failed');return;}scheduled++;count++;
    }
    if(cursor===tones.length && elapsed>=(tones.at(-1)?.at ?? 0)+FREE_PREVIEW_LIMITS.toneMs){stop('finished');return;}
    emit();timer=schedule(()=>tick(token),FREE_PREVIEW_LIMITS.tickMs);
  }
  async function start(record,{instrument='piano'}={}) {
    validatePerformanceRecord(record);
    if(!['piano','guitar'].includes(instrument))throw fail('free.invalid_timbre');
    stop();const token=generation;tones=[];cursor=0;scheduled=0;skipped=0;excluded=0;error=null;timbre=instrument;
    let first=null,previous=-Infinity;
    for(const event of record.observations.events){
      if(event.kind!=='note_on')continue;
      if(event.segment_id===null || event.event_ms<previous){excluded++;continue;}
      previous=event.event_ms;first ??= event.event_ms;
      if(tones.length>=FREE_PREVIEW_LIMITS.tones || event.event_ms-first>FREE_PREVIEW_LIMITS.spanMs){excluded++;continue;}
      tones.push({at:event.event_ms-first,midi:event.midi,velocity:event.velocity ?? 90});
    }
    if(!soundEnabled()){status='muted';emit();return false;}
    if(!tones.length){status='empty';emit();return false;}
    status='preparing';emit();
    try {
      if(!audio?.unlock || !audio?.play)throw fail('free.audio_unavailable');
      await audio.unlock();
      if(token!==generation)return false;
      if(!soundEnabled()){stop('muted');return false;}
      status='playing';startWall=now();emit();tick(token);return true;
    }catch(caught){if(token!==generation)return false;error=caught.code || 'free.audio_unavailable';stop('failed');return false;}
  }
  return {start,stop,snapshot,subscribe(listener){listeners.add(listener);return()=>listeners.delete(listener);}};
}

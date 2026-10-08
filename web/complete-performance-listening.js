import {isPerformanceSong} from './clean-song-package.js';
import {createCleanPerformancePlayer} from './clean-performance-player.js';
import {cleanLogicalDeviceMapping,cleanLogicalDeviceRouteError} from './clean-song-text.js';
import referenceSchema from './locales/reference-listening-schema.js';

// A bounded, failure-only data projection. Never enumerate arbitrary error
// details or invoke their accessors; no player/context objects leave this view.
export function serializeReferenceFailure(error,source) {
  const own=(value,key)=>value&&typeof value==='object'?Object.getOwnPropertyDescriptor(value,key)?.value:undefined;
  const token=(value,max,pattern)=>typeof value==='string'&&value.length<=max&&pattern.test(value)?value:undefined;
  try {
    const code=token(own(error,'code'),64,/^[a-z][a-z0-9_]*$/);if(!code)return null;
    const result={version:1,code},detail=own(error,'detail');
    for(const key of ['sourceSha256','scoreSha256']){const value=token(own(source,key),64,/^[a-f0-9]{64}$/);if(value)result[key]=value;}
    const phase=own(detail,'phase');if(['pump-deadline','source-allocation'].includes(phase))result.phase=phase;
    const eventId=token(own(detail,'eventId'),160,/^midi:[a-f0-9]{64}:t[0-9]{1,3}:e[0-9]{1,6}$/);if(eventId)result.eventId=eventId;
    const kind=token(own(detail,'commandKind'),64,/^[a-z][a-z0-9_]*$/);if(kind)result.commandKind=kind;
    for(const [key,max]of [['eventIndex',249999],['sourceTrackIndex',127],['sourceEventIndex',249999],['generation',Number.MAX_SAFE_INTEGER]]){
      const value=own(detail,key);if(Number.isSafeInteger(value)&&value>=0&&value<=max)result[key]=value;
    }
    for(const key of ['anchorSeconds','scheduledAudioTimeSeconds','observedAudioTimeSeconds','latenessObservedAudioTimeSeconds','lateSeconds']){
      const value=own(detail,key);if(typeof value==='number'&&Number.isFinite(value)&&Math.abs(value)<=Number.MAX_SAFE_INTEGER&&(key==='anchorSeconds'||value>=0))result[key]=value;
    }
    const exact=own(detail,'exactMicroseconds'),numerator=token(own(exact,'numerator'),20,/^(0|[1-9][0-9]*)$/),denominator=own(exact,'denominator');
    if(numerator!==undefined&&BigInt(numerator)<=18446744073709551615n&&Number.isSafeInteger(denominator)&&denominator>=1&&denominator<=1000000)result.exactMicroseconds={numerator,denominator};
    const serialized=JSON.stringify(result);return serialized.length<=2048?serialized:null;
  }catch{return null;}
}

const clock = seconds => {
  const value=Math.max(0,Number(seconds)||0),whole=Math.floor(value);
  return `${Math.floor(whole/60)}:${String(whole%60).padStart(2,'0')}.${Math.floor((value-whole)*10)}`;
};

/** Saved complete events stay in the existing lobby. The opaque native runtime
 * is consumed only by the reference receiver, never by notation or grading. */
export function setupCompletePerformanceListening({document,i18n,synth,host,
  isVisible=()=>true,allowed=()=>true,onBeforePlay=()=>{},onActiveChange=()=>{},
  getSoundEnabled=()=>!synth.muted,onSoundChange=()=>{},
  timers={setTimeout:(fn,ms)=>globalThis.setTimeout(fn,ms),clearTimeout:id=>globalThis.clearTimeout(id)},
}) {
  const panel=document.createElement('section');panel.id='complete-performance-listening';panel.hidden=true;
  panel.dataset.keyboardInput='off';panel.setAttribute('aria-labelledby','complete-performance-title');
  panel.innerHTML=`<h3 id="complete-performance-title"></h3>
    <p id="complete-performance-counts"></p><p id="complete-performance-coverage"></p><p id="complete-performance-media"></p>
    <details id="complete-performance-policy" open><summary id="complete-performance-policy-title"></summary>
      <p id="complete-performance-policy-tone"></p><p id="complete-performance-policy-percussion"></p>
      <p id="complete-performance-policy-events"></p><p id="complete-performance-policy-gates"></p>
      <p id="complete-performance-policy-resume"></p><p id="complete-performance-policy-limits"></p>
      <p id="complete-performance-policy-controls"></p><p id="complete-performance-policy-pitch" hidden></p><p id="complete-performance-policy-routing" hidden></p>
      <ul id="complete-performance-programs"></ul>
    </details>
    <label class="reference-choice"><input id="complete-performance-policy-accept" type="checkbox"><span id="complete-performance-policy-label"></span></label>
    <p id="complete-performance-mute-help"></p><ul id="complete-performance-tracks"></ul>
    <p id="complete-performance-problems" role="alert" hidden></p>
    <label class="reference-choice"><input id="complete-performance-sound" type="checkbox"><span id="complete-performance-sound-label"></span></label>
    <div class="reference-actions"><button id="complete-performance-play" type="button" class="button primary" disabled></button><button id="complete-performance-pause" type="button" class="button secondary" disabled></button><button id="complete-performance-stop" type="button" class="button secondary" disabled></button><output id="complete-performance-clock"></output></div>
    <p id="complete-performance-status" role="status" aria-live="polite"></p>`;
  host.append(panel);
  const $=id=>document.getElementById(`complete-performance-${id}`);
  const t=(key,params)=>i18n.t(`reference.${key}`,params);
  const text=(en,zh)=>i18n.locale==='en'?en:zh;
  let song=null,player=null,active=false,destroyed=false,errorCode=null,clockTimer=null,trackRows=[],programRows=[];
  const closedWaiters=[];let diagnosticError=null;
  const snapshot=()=>player?.snapshot()??{state:'stopped',positionSeconds:0,mutedTracks:[],error:null};
  function clearClock(){if(clockTimer!==null)timers.clearTimeout(clockTimer);clockTimer=null;}
  function refreshClock(){
    clearClock();if(destroyed)return;
    const current=snapshot();$('clock').textContent=`${clock(current.positionSeconds)} / ${clock(song?.reference.durationSeconds)}`;
    if(active&&current.state==='playing')clockTimer=timers.setTimeout(refreshClock,100);
  }
  function updateActive(){
    const next=Boolean(song&&isVisible()&&!destroyed);if(next===active)return;
    active=next;onActiveChange(active);
    if(!active)for(const resolve of closedWaiters.splice(0))resolve();
  }
  function render(){
    if(destroyed)return;
    panel.hidden=!song;
    for(const[id,key]of Object.entries({title:'entry','policy-title':'policyTitle','policy-tone':'policyTone','policy-percussion':'policyPercussion','policy-events':'policyEvents','policy-resume':'policyResume','policy-limits':'policyLimits','policy-label':'policyAccept','mute-help':'muteHelp','sound-label':'sound',pause:'pause',stop:'stop'}))$(id).textContent=t(key);
    $('coverage').textContent=text('Notation unavailable · Practice targets and grades unavailable. Every independent attack and release is preserved.','记谱不可用 · 练习目标与评分不可用。完整保留每次独立起音与释放。');
    $('media').hidden=!song?.media.some(item=>['full_mix','stem'].includes(item.role));
    $('media').textContent=text('Recorded mixes and stems are retained for export. This playback uses only the declared reference synthesizer.','录音混音与分轨音频完整保留供导出；当前播放仅使用上述参考合成器。');
    $('policy-gates').textContent=text('FIFO lengths are reference sound gates only, never written note lengths or practice targets. Original release timing is preserved; release velocity is retained without changing the reference envelope.','先进先出时长仅用于参考发声，不是记谱音长或练习目标。保留原始释放时序；释放力度保留，但不改变参考包络。');
    const prepared=song?.reference,current=snapshot(),ready=Boolean(prepared?.playable&&player),stopped=current.state==='stopped';
    $('policy-routing').hidden=!prepared?.logical_device_mapping;
    $('policy-routing').textContent=cleanLogicalDeviceMapping(i18n.locale,prepared?.logical_device_mapping);
    if(prepared?.logical_device_mapping)$('policy-label').textContent=text('I select this reference sound, event playback and logical device mapping policy','我选择此参考声音、事件播放与逻辑设备映射策略');
    $('policy-controls').hidden=!prepared?.extendedControls;
    $('policy-pitch').hidden=!prepared?.pitchBends;
    $('policy-pitch').textContent=text('Pitch-bend reference: every retained 14-bit value sets pitch at its original time for all sounding channel layers, including pedal-held layers. The declared default range is two semitones; only the reviewed initial twelve-semitone setup changes it. Values use (value − 8192) / 8192, with no invented curve between events. Original keys stay unchanged. This is a procedural interpretation, not proof of original tuning, timbre, voice fidelity or complete playability. Percussion bends and melodic oscillator ranges outside 20–18000 Hz remain unavailable; frequencies are never clamped. Pause and resume restore channel state; arbitrary seek is unavailable.','弯音参考：每个保留的 14 位数值都在原始时刻调整该通道所有发声层，包括踏板保持的声音。明确采用默认 2 半音范围；只有已验证的起音前 12 半音设置可改变它。数值按 (值 − 8192) / 8192 换算，不虚构事件之间的曲线，原始按键音高不变。这是程序化参考解释，不证明原始调音、音色、声部还原或完整可演奏性。打击乐弯音以及超出 20–18000 Hz 的旋律振荡器范围仍不可播放，不会截断频率。暂停与继续重建通道状态；不支持任意跳转。');
    $('policy-controls').textContent=text('Controller reference: volume × expression set channel level (defaults 100/127); pan is stereo. Sustain defers FIFO sound release until pedal-up, including repeated keys. Reverb uses WMH Reference Room v1. Pause, Stop and song end cut sound and effect tails. Resume restores channel state and restarts remaining gates. Only bank zero and chorus zero are supported; original timbre is unverified.','控制器参考演奏：通道音量乘以表情值设置音量（默认 100/127），声像为立体声。延音踏板把先进先出释放推迟到抬踏板，包括重复按键。混响使用 WMH 参考房间 v1。暂停、停止和歌曲结束会切断声音及效果尾音；恢复时还原通道状态并重新触发剩余发声。仅支持音色库零和合唱零；未验证原始音色。');
    if(prepared?.extendedControls)$('policy-events').textContent=text('Every attack creates a layer. Key releases select the oldest still-key-held layer (FIFO); sustain values 64–127 hold its sound until the next value 0–63. These are receiver choices, not recovered note durations.','每次起音创建一层声音；按键释放选择最早仍按住的层（先进先出）。延音值 64–127 保持声音至下一个 0–63 值。此为合成器策略，不是恢复出的记谱音长。');
    $('counts').textContent=prepared?t('counts',{tracks:prepared.trackCount,events:prepared.eventCount,onsets:song.runtime.coverage.performance.key_attacks}):'';
    for(const[key,value]of Object.entries({trackCount:prepared?.trackCount??'',eventCount:prepared?.eventCount??'',onsetCount:song?.runtime.coverage.performance.key_attacks??''}))$('counts').dataset[key]=String(value);
    $('policy').dataset.policyId=prepared?.policy.id||'';
    $('policy-accept').disabled=!ready||['playing','starting'].includes(current.state);
    $('play').textContent=t(current.state==='paused'?'resume':'play');
    $('play').disabled=!ready||!active||!allowed()||!$('policy-accept').checked||!getSoundEnabled()||Boolean(errorCode)||['playing','starting','error'].includes(current.state);
    $('pause').disabled=!['playing','starting'].includes(current.state);
    $('stop').disabled=!player||(stopped&&!errorCode);
    $('sound').checked=getSoundEnabled();$('clock').setAttribute('aria-label',t('elapsed'));
    for(const row of trackRows){
      row.label.textContent=t('track',{track:row.index+1,name:row.name||t('unnamed')});
      row.counts.textContent=t('trackCounts',{events:row.events,onsets:row.onsets});
      row.description.textContent=t(row.independent?'independent':'shared');row.muteLabel.textContent=t('mute');
      row.input.disabled=!ready||!stopped||!row.independent;row.input.checked=current.mutedTracks.includes(row.index);
    }
    for(const row of programRows)row.element.textContent=t('program',{channel:row.channel,program:row.program,family:t(row.channel===9?'percussionName':`family${row.program>>3}`)});
    // Healthy renders neither serialize nor mutate diagnostic DOM. Reuse the
    // already-read snapshot; exposing an error adds no clock/callback activity.
    if(current.error!==diagnosticError){
      if(current.error){const value=serializeReferenceFailure(current.error,prepared);if(value)$('status').setAttribute('data-reference-failure',value);else $('status').removeAttribute('data-reference-failure');}
      else if(diagnosticError)$('status').removeAttribute('data-reference-failure');
      diagnosticError=current.error??null;
    }
    const codes=[...new Set([errorCode,current.error?.code,...(prepared?.blockers.map(item=>item.code)||[])].filter(Boolean))];
    $('problems').hidden=!codes.length;
    $('problems').textContent=codes.map(code=>`${t('problem')} ${code}: ${code==='unresolved_logical_device_route'?cleanLogicalDeviceRouteError(i18n.locale,prepared?.logical_device_route_reason):Object.hasOwn(referenceSchema,`reference.error.${code}`)&&code!=='generic'?t(`error.${code}`):text('This reference receiver cannot apply the required command or start audio. Complete source data remains saved; stop and retry only when supported.','此参考合成器无法执行所需指令或启动音频。完整来源仍已保存；仅在支持后停止并重试。')}`).join('\n');
    const status=codes.length?'error':!getSoundEnabled()?'muted':current.state;
    $('status').dataset.state=status;
    $('status').textContent=status==='error'?text('Reference playback unavailable. All source events remain saved.','参考播放不可用。所有源事件仍完整保存。'):t(`state.${status}`);
    refreshClock();
  }
  function stop({revokePolicy=false}={}){if(destroyed)return;clearClock();errorCode=null;player?.stop();if(revokePolicy)$('policy-accept').checked=false;render();}
  function pause(){if(destroyed)return;player?.pause();render();}
  function rebuild(){
    $('tracks').replaceChildren();$('programs').replaceChildren();trackRows=[];programRows=[];
    if(!song)return;
    const attacks=Array(song.reference.trackCount).fill(0);
    for(const event of song.runtime.events)if(event.command.kind==='key_attack')attacks[event.origin.track]++;
    for(const [index,track]of song.reference.tracks.entries()){
      const li=document.createElement('li'),label=document.createElement('strong'),counts=document.createElement('p'),description=document.createElement('p');
      const choice=document.createElement('label'),input=document.createElement('input'),muteLabel=document.createElement('span');
      li.dataset.trackIndex=String(index);li.dataset.eventCount=String(track.source_event_count);li.dataset.onsetCount=String(attacks[index]);
      input.type='checkbox';input.id=`complete-performance-mute-${index}`;choice.className='reference-choice';choice.append(input,muteLabel);
      li.append(label,counts,description,choice);$('tracks').append(li);
      input.addEventListener('change',()=>{
        if(!song?.reference.playable||!player||snapshot().state!=='stopped'||!track.independent){render();return;}
        try{player.setTrackMuted(index,input.checked);}catch(error){player.stop();errorCode=error.code||'generic';render();}
      });
      trackRows.push({index,name:track.name,events:track.source_event_count,onsets:attacks[index],independent:track.independent,label,counts,description,input,muteLabel});
    }
    for(const program of song.reference.programs){const element=document.createElement('li');$('programs').append(element);programRows.push({...program,element});}
  }
  function select(value){
    if(destroyed)return;
    const next=isPerformanceSong(value)?value:null;
    if(next===song){updateActive();render();return;}
    stop({revokePolicy:true});player=null;song=next;errorCode=null;
    if(song?.reference.playable){
      try{player=createCleanPerformancePlayer(song.reference,{timers,onState:render,contextFactory:async()=>{
        if(!getSoundEnabled())throw{code:'sound_off'};
        await synth.unlock();
        if(!getSoundEnabled())throw{code:'sound_off'};
        return{context:synth.context,output:synth.output};
      }});}catch(error){errorCode=error.code||'generic';}
    }
    rebuild();updateActive();render();
  }
  $('policy-accept').addEventListener('change',()=>{if(!$('policy-accept').checked)stop();render();});
  $('sound').addEventListener('change',()=>onSoundChange($('sound').checked));
  $('play').addEventListener('click',async()=>{
    if(!active||!allowed()||!player||!song.reference.playable||!getSoundEnabled()||!$('policy-accept').checked||errorCode||['playing','starting','error'].includes(snapshot().state))return;
    const owner=player,selected=song;onBeforePlay();
    try{const starting=owner.play({userGesture:true,acceptedPolicyId:selected.reference.policy.id});render();await starting;}
    catch(error){if(owner===player&&selected===song){owner.stop();errorCode=error.code||'generic';}}
    render();
  });
  $('pause').addEventListener('click',pause);$('stop').addEventListener('click',()=>stop());
  // A native panel can close after a package load has finished underneath it.
  // Re-enable only explicit controls; closing a panel never starts audio.
  document.addEventListener('close',render,true);
  document.addEventListener('visibilitychange',render);
  const unsubscribe=i18n.subscribe(render);render();
  return{select,stop,pause,snapshot,isActive:()=>active,
    whenClosed:()=>active?new Promise(resolve=>closedWaiters.push(resolve)):Promise.resolve(),
    screenChanged(){stop({revokePolicy:true});updateActive();render();},
    soundChanged(){if(!getSoundEnabled())stop();else render();},
    destroy(){if(destroyed)return;stop({revokePolicy:true});destroyed=true;song=null;updateActive();document.removeEventListener('close',render,true);document.removeEventListener('visibilitychange',render);unsubscribe();panel.remove();},
  };
}

import {isPerformanceSong} from './clean-song-package.js';
import {createCleanPerformancePlayer} from './clean-performance-player.js';
import referenceSchema from './locales/reference-listening-schema.js';

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
  const closedWaiters=[];
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
    const codes=[...new Set([errorCode,current.error?.code,...(prepared?.blockers.map(item=>item.code)||[])].filter(Boolean))];
    $('problems').hidden=!codes.length;
    $('problems').textContent=codes.map(code=>`${t('problem')} ${code}: ${Object.hasOwn(referenceSchema,`reference.error.${code}`)&&code!=='generic'?t(`error.${code}`):text('This reference receiver cannot apply the required command or start audio. Complete source data remains saved; stop and retry only when supported.','此参考合成器无法执行所需指令或启动音频。完整来源仍已保存；仅在支持后停止并重试。')}`).join('\n');
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

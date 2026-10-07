import {pitchModSemitones,pitchModRange,pitchModConfiguration,pitchModSupported} from './pitch-mod.js';
import {midiName} from './music.js';
const messages={
  spelling:[
    'This shift cannot use the supported note spellings and key signatures. The whole shift was rejected; your draft and current song are unchanged. Choose another shift or restore 0. This notation constraint is separate from your instrument’s key count.',
    '此移动无法使用当前支持的音名拼写和调号表示，因此整次移调已被拒绝；草稿与当前歌曲均保持不变。请选择其他半音数，或恢复为 0。这是记谱限制，与实体乐器的键数无关。',
  ],
  midi:[
    'The whole shift was rejected because a melodic note would leave MIDI 0–127. Your draft and current song are unchanged. Choose another shift or restore 0. This MIDI limit is separate from your instrument’s playable range.',
    '有旋律音符会超出 MIDI 0–127，因此整次移调已被拒绝；草稿与当前歌曲均保持不变。请选择其他半音数，或恢复为 0。MIDI 音高边界与实体乐器的可演奏音域是两项独立限制。',
  ],
  budget:[
    'The complete pitch view exceeds a processing or response-size limit. The whole operation was rejected; your draft and current song are unchanged. Restore 0 to use the original pitches. Changing the instrument’s key count does not increase this limit.',
    '完整音高视图超出处理资源或响应大小限制，因此整次操作已被拒绝；草稿与当前歌曲均保持不变。可恢复为 0，继续使用原始音高。更改乐器键数不会提高此限制。',
  ],
  renderer:[
    'Whole-song pitch shifting is unavailable for this source renderer. Keep 0 to use its original playback. Changing the instrument’s key count does not enable this renderer feature.',
    '此来源渲染器暂不支持整首歌曲移调。保持为 0 可继续使用原有播放；更改乐器键数不会启用此渲染功能。',
  ],
  shift:[
    'Choose a whole-number shift from −12 to +12 half steps, or restore 0. Your current song is unchanged.',
    '请选择 −12 到 +12 之间的整数半音数，或恢复为 0。当前歌曲保持不变。',
  ],
  unpitched:[
    'This source has no pitched notes to shift. Percussion stays original; keep 0. Changing the instrument’s key count does not add pitched notes.',
    '此来源没有可移调的有音高音符。打击乐保持原样，请保持为 0；更改乐器键数不会增加有音高音符。',
  ],
};
const kinds={pitch_mod_spelling:'spelling',pitch_mod_midi_range:'midi',pitch_mod_renderer:'renderer',pitch_mod_shift:'shift',pitch_mod_configuration:'shift',pitch_mod_no_pitched_notes:'unpitched',response_body_limit:'budget',request_body_limit:'budget',library_response_limit:'budget',library_progression_response_limit:'budget',pitch_mod_budget:'budget',audio_plan_limit:'budget',canonical_audio_profile_limit:'budget'};

/** Typed projection failures never imply a physical-keyboard range diagnosis.
 * Do not echo source-specific backend details for the supported categories. */
export function pitchModErrorText(locale,error){
  const kind=kinds[error?.code];
  return kind?messages[kind][locale==='en'?0:1]:error?.message||(locale==='en'?'The pitch check failed. Your current song is unchanged.':'音高检查失败，当前歌曲保持不变。');
}


/** Draft-only control. Checking prepares a source-bound view and never stores,
 * installs, plays, or edits a take. Closing invalidates in-flight checks. */
export function setupPitchModView({document,parent,i18n,onCheck,onPrepared=()=>{},onChange=()=>{}}){
  const make=(tag,id,owner=parent)=>{const node=document.createElement(tag);node.id=id;owner.append(node);return node;};
  const root=make('section','song-mod-pitch'),title=make('h3','song-mod-pitch-title',root),label=make('label','song-mod-pitch-label',root),name=make('span','song-mod-pitch-name',label),input=make('input','song-mod-pitch-shift',label),zero=make('button','song-mod-pitch-zero',root),check=make('button','song-mod-pitch-check',root),summary=make('p','song-mod-pitch-summary',root),status=make('p','song-mod-pitch-status',root),help=make('p','song-mod-pitch-help',root),resetLabel=make('label','song-mod-pitch-reset-label',root),reset=make('input','song-mod-pitch-reset',resetLabel),resetText=make('span','song-mod-pitch-reset-text',resetLabel);
  root.className='song-mod-pitch';root.setAttribute('aria-labelledby',title.id);input.type='number';input.min='-12';input.max='12';input.step='1';input.setAttribute('aria-describedby',help.id);zero.type=check.type='button';zero.className=check.className='button secondary compact';reset.type='checkbox';status.setAttribute('role','status');status.setAttribute('aria-live','polite');resetLabel.className='warning';
  let context=null,origin='preview',prepared=null,checking=false,busy=false,error=null,generation=0;
  const text=(en,zh)=>i18n.locale==='en'?en:zh;
  const value=()=>input.value.trim()===''?NaN:Number(input.value);
  const changed=()=>Boolean(context)&&value()!==pitchModSemitones(context);
  const resetRequired=()=>changed()&&origin==='stage'&&context.hasTakes;
  const checked=()=>prepared&&prepared.configuration.semitones===value()?prepared:null;
  const rangeText=range=>range?`${midiName(range[0])}–${midiName(range[1])} (MIDI ${range[0]}–${range[1]})`:text('no pitched targets','无有音高目标');
  function render(){
    title.textContent=text('Whole-song pitch','整首歌曲音高');name.textContent=text('Half-step shift (−12 to +12)','半音移动（−12 到 +12）');zero.textContent=text('Restore pitch · 0','恢复原音高 · 0');check.textContent=text(checking?'Checking pitch…':'Check pitch',checking?'正在检查音高…':'检查音高');
    help.textContent=text('All melodic parts shift together; explicit percussion stays original. Input-device transpose is separate. A note outside MIDI 0–127 rejects the entire shift. Instrument range is checked separately. Source and exports stay original.','全部旋律声部一起移动；明确的打击乐保持原样。输入设备移调独立设置。任何音符超出 MIDI 0–127 都会拒绝整次操作；乐器音域另行检查。源数据与导出保持原样。');
    const current=pitchModSemitones(context),view=checked(),range=view?.range||pitchModRange(context?.compiled);
    summary.textContent=context?text(`Current shift ${current>=0?'+':''}${current} · Current effective range ${rangeText(pitchModRange(context.compiled))}`,`当前移动 ${current>=0?'+':''}${current} · 当前有效音域 ${rangeText(pitchModRange(context.compiled))}`):'';
    summary.dataset.pitchModSemitones=String(current);summary.dataset.pitchModDigest=context?.pitchView?.identity.digest||'';
    const phase=checking?'checking':error?'rejected':!changed()?'current':view?'checked':'unchecked';status.dataset.pitchModStatus=phase;
    status.textContent=error?pitchModErrorText(i18n.locale,error):checking?text('Checking every source note…','正在检查每个源音符…'):view&&changed()?text(`Checked ${value()>=0?'+':''}${value()} half steps · Effective range ${rangeText(range)}. Apply to use it.`,`已检查移动 ${value()>=0?'+':''}${value()} 半音 · 有效音域 ${rangeText(range)}。应用后生效。`):changed()?text('Check this shift before applying.','应用前请检查此移动。'):text('Current pitch is unchanged.','当前音高未更改。');
    resetLabel.hidden=!resetRequired();resetText.textContent=text('Restart this session and clear its in-memory takes when I apply this pitch change','应用音高更改时重新开始本次演奏，并清除内存中的演奏记录');
    const supported=pitchModSupported(context);if(!supported)status.textContent=pitchModErrorText(i18n.locale,{code:'pitch_mod_renderer'});
    input.disabled=zero.disabled=busy||!supported;check.disabled=busy||checking||!changed()||!supported;reset.disabled=busy;
  }
  function edit(){generation++;checking=false;prepared=null;error=null;reset.checked=false;try{pitchModConfiguration(value());}catch(failure){error=failure;}render();onChange();}
  input.addEventListener('input',edit);input.addEventListener('change',edit);zero.addEventListener('click',()=>{input.value='0';edit();});reset.addEventListener('change',onChange);
  check.addEventListener('click',async()=>{if(!context||busy||checking)return;const current=++generation,captured=context;error=null;checking=true;render();onChange();try{const result=await onCheck(captured,value());if(current===generation&&context===captured){prepared=result.view||result;onPrepared(result);}}catch(failure){if(current===generation)error=failure;}finally{if(current===generation){checking=false;render();onChange();}}});
  return {root,changed,prepared:checked,resetConfirmed:()=>!resetRequired()||reset.checked,canApply:()=>!checking&&!error&&(!changed()||Boolean(checked()))&&(!resetRequired()||reset.checked),
    open(next,{where='preview'}={}){generation++;context=next;origin=where;prepared=null;checking=busy=false;error=null;input.value=String(pitchModSemitones(next));reset.checked=false;render();},
    restore(){input.value='0';edit();},update({busy:next=false}={}){busy=next;render();},close(){generation++;context=null;prepared=null;checking=false;error=null;},
  };
}

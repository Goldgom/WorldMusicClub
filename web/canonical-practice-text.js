const text=(locale,en,zh)=>locale==='en'?en:zh;
export function canonicalAudioPolicyText(locale) {
  return text(locale,'Play uses a basic synthesized reference of the compiled score, including ties and repeats. The default is sine; explicit Mod choices replace only the selected machine parts. It does not reproduce the original instruments. Rust millisecond times become sample-frame note boundaries. Practice accompanies only the parts you have not selected; silent or all-human practice keeps the full source clock.','播放使用已编译乐谱的基础合成参考，保留连音和反复。默认正弦音；明确选择的 Mod 音色仅替换对应机器声部，不再现原始乐器音色。Rust 毫秒时间转换为采样帧音符边界。练习时只为未选择的声部伴奏；静音或全部声部由人演奏时仍保留完整来源时钟。');
}
export function canonicalLoopBudgetText(locale,budget,{ended=false}={}) {
  if(!budget)return text(locale,'Each loop generation has a finite audio audit budget: at most 4096 passes and 500000 machine gate records. It stops at a complete-pass boundary; the prepared limit is shown when playback starts.','每轮循环具有有限音频审计容量：最多 4096 次演奏和 500000 个机器音符门限记录。播放会在完整轮次边界停止，准备后的具体上限在开始播放时显示。');
  return text(locale,`${ended?'The loop stopped at its complete-pass limit. Press Play to start another generation.':'Loop playback stops at a complete-pass boundary within its audio audit budget.'} This generation: at most ${budget.max_passes} passes, ${budget.record_capacity} machine gate records.`,`${ended?'循环已在完整轮次上限处停止。点击播放可开始新一轮。':'循环播放会在音频审计容量内的完整轮次边界停止。'}本轮最多 ${budget.max_passes} 次演奏，记录 ${budget.record_capacity} 个机器音符门限。`);
}
export function canonicalAudioErrorText(locale,error) {
  const code=error?.code||'canonical_audio_error';
  const messages={
    canonical_audio_profile:['The score’s audio evidence could not be prepared. Retry playback.','未能准备乐谱的音频依据，请重试播放。'],
    invalid_canonical_audio_plan:['The score and audio evidence do not match. Reload this score before retrying.','乐谱与音频依据不匹配，请重新载入此乐谱后重试。'],
    canonical_audio_fingerprint:['The audio acknowledgement belongs to a different source or selection. Playback stopped; retry from the current score.','音频确认不属于当前来源或选择。播放已停止，请从当前乐谱重试。'],
    canonical_audio_budget:['This source or loop exceeds the complete audio audit budget. Use a smaller reviewed range or fewer repeat passes.','此来源或循环超出完整音频审计容量。请缩小已确认范围或减少循环次数。'],
    voice_budget_exceeded:['This selection exceeds the simultaneous audio voice limit. Choose a smaller audible set.','此选择超出同时发声音符上限，请减少发声声部。'],
    canonical_audio_timing:['A compiled note cannot be represented at this device’s sample rate. Playback stopped without changing the score.','已编译音符无法在此设备的采样率下表示，播放已停止，乐谱未被改动。'],
    canonical_audio_loop_unavailable:['The required audio-thread loop is unavailable. This loop cannot start until that renderer is available.','所需音频线程循环不可用，此循环需待对应渲染器可用后才能开始。'],
    clean_clock_unavailable:['The audio device interrupted the source clock. Playback is paused; press Play when the device is available.','音频设备中断了来源时钟。播放已暂停，设备可用后请重新点击播放。'],
    clean_late_start:['The audio start confirmation arrived too late. Playback was canceled; press Play to retry.','音频开始确认未及时到达，本次播放已取消，请点击播放重试。'],
    notation_audio_reload_required:['Notation loading did not finish. Playback is blocked. Export any practice takes you want to keep, then reload the page or reopen the app.','谱面加载未完成，已阻止播放。请先导出需要保留的练习记录，再刷新页面或重新打开应用。'],
    reference_policy_required:['Review the canonical sine-tone interpretation before starting playback.','请先查看规范乐谱的正弦音参考解释，再开始播放。'],
    unsupported_audio_sample_rate:['This audio device cannot represent every retained pitch. Use another supported output device or silent practice.','此音频设备无法表示全部保留音高，请使用另一支持的输出设备或静音练习。'],
  };
  const pair=messages[code];return (pair?text(locale,...pair):text(locale,'Canonical-score audio stopped. Check the score and audio device, then retry.','规范乐谱音频已停止，请检查乐谱和音频设备后重试。'))+` (${code})`;
}

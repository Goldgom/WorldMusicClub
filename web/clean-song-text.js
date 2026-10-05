const families=['击弦键盘','明亮槌击','持续风琴','拨弦','低音弦乐','弓弦','合奏','铜管','簧管','管笛','主奏','铺底','效果','民族弦乐','敲击效果','声音效果'];
export const cleanText=(locale,en,zh)=>locale==='en'?en:zh;
export function cleanFamily(locale,program){const en=['struck keys','bright mallets','sustained organ','plucked strings','low strings','bowed strings','ensemble','brass','reed','pipe','lead','pad','effects','world strings','struck effects','sound effects'];return cleanText(locale,`reference ${en[program>>3]}`,`参考${families[program>>3]}`);}
export function cleanErrorText(locale,error){
 const unavailable=['clean_audio_worklet_unavailable','audio_worklet_unavailable','live_audio_worklet_unavailable'].includes(error?.code),phase=error?.details?.phase;
 const missing=error?.code==='clean_audio_worklet_unavailable'||phase==='capability';
 const base=error?.liveAudioTerminal&&!missing?cleanText(locale,`Live input audio stopped (${error?.code||'live_audio_error'}). Reopen the app before trying sound again, or turn sound off for silent practice.`,`实时输入音频已停止（${error?.code||'live_audio_error'}）。请重新打开应用后再尝试发声，或关闭声音进行静音练习。`):unavailable?(missing?cleanText(locale,'Complete-song sound requires AudioWorklet in this browser. Use a current browser with audio worklet support, or turn sound off for silent practice.','完整曲目声音需要浏览器支持 AudioWorklet。请使用支持音频工作线程的新版浏览器，或关闭声音进行静音练习。'):cleanText(locale,'Complete-song audio could not initialize. Check the details below and retry.','完整曲目音频初始化失败。请检查以下详细信息后重试。')):cleanText(locale,`Complete-song playback stopped (${error?.code||'clean_error'}). Retry after checking the song and audio settings.`,`完整曲目播放已停止（${error?.code||'clean_error'}）。请检查曲包和声音设置后重试。`);
 if(!unavailable||!error?.message)return base;
 const names={'capability':['browser capability','浏览器能力'],'module-load':['audio module loading','音频模块加载'],'node-construction':['audio processor construction','音频处理器创建'],'receiver-initialization':['audio output initialization','音频输出初始化'],'node-initialization':['live audio processor initialization','实时音频处理器初始化']},details=error.details||{},parts=[];
 if(phase)parts.push(cleanText(locale,`Stage: ${names[phase]?.[0]||phase}`,`阶段：${names[phase]?.[1]||phase}`));
 // The wrapper phase is ours and already localized. Keep the original browser
 // cause below, while avoiding a second English wrapper in the Chinese UI.
 if(locale==='en'||!names[phase])parts.push(String(error.message).slice(0,1024));
 if(details.causeMessage||details.cause)parts.push(`${details.causeName?String(details.causeName).slice(0,128)+': ':''}${String(details.causeMessage||details.cause).slice(0,1024)}`);
 if(details.outcome==='timeout')parts.push(cleanText(locale,`Deadline: ${details.timeoutMs} ms`,`等待期限：${details.timeoutMs} 毫秒`));
 if(details.moduleUrl)parts.push(cleanText(locale,`Module: ${String(details.moduleUrl).slice(0,1024)}`,`模块：${String(details.moduleUrl).slice(0,1024)}`));
 return `${base} ${parts.join(' · ')}`;
}

export function cleanMediaError(locale,role){const labels={cover:['Cover','封面'],background:['Background','背景'],pv:['Video','视频']};return cleanText(locale,`${labels[role]?.[0]||'Media'} could not be displayed. Music remains available; reimport a supported, readable asset or retry.`,`${labels[role]?.[1]||'媒体'}无法显示。乐谱与音乐仍可使用；请重新导入可读取的受支持媒体，或重试。`);}

export function cleanLogicalDeviceMapping(locale,mapping){return mapping?cleanText(locale,`Logical destination “${mapping.device_name}” is mapped to the selected procedural reference receiver. The source device and timbre are unverified.`,`逻辑目标“${mapping.device_name}”映射到所选程序合成参考接收器。未验证源设备与原始音色。`):'';}
const logicalDeviceRouteReasons={
  unsupported_route_command:['Another routing mechanism is present','存在其他路由机制'],
  source_runtime_binding:['Source events and playback data do not establish the same route','源事件与播放数据无法确定同一路由'],
  empty_or_invalid_name:['The device name is empty or invalid','设备名称为空或无效'],
  duplicate_name:['A track repeats its device name','同一音轨重复声明设备名称'],
  late_name:['The device name is late or follows channel/program data','设备名称不在起点，或位于通道／程序数据之后'],
  multiple_names:['Tracks name different logical destinations','音轨声明了不同的逻辑目标'],
  shared_channel:['Multiple tracks share a channel','多条音轨共用一个通道'],
  mixed_named_default_routes:['Named and default destinations are mixed','混用了具名目标与默认目标'],
};
const logicalDeviceRouteReason=(locale,reason)=>logicalDeviceRouteReasons[reason]?.[locale==='en'?0:1]||'';
export function cleanLogicalDeviceRouteError(locale,reason){const detail=logicalDeviceRouteReason(locale,reason);return cleanText(locale,`Logical device routing is unresolved.${detail?' '+detail+'.':''} Playback is blocked; all source events and device names remain saved.`,`逻辑设备路由无法解析。${detail?detail+'。':''}已阻止播放；所有源事件与设备名称仍完整保存。`);}

export function cleanCommand(locale,kind,reason){const names={unresolved_logical_device_route:['unresolved logical device route; playback is blocked','逻辑设备路由无法解析；已阻止播放'],bank_select:['bank selection','音色库选择'],chorus_send:['chorus send','合唱发送'],key_pressure:['key pressure','单键压力'],channel_pressure:['channel pressure','通道压力'],part_budget_exceeded:['part capacity exceeded','声部数量超限']};const label=names[kind]?.[locale==='en'?0:1]||kind,detail=kind==='unresolved_logical_device_route'?logicalDeviceRouteReason(locale,reason):'';return label+(detail?cleanText(locale,` (${detail})`,`（${detail}）`):'');}

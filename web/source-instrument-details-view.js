/** Source evidence and independently analyzed identities are display-only, never practice policy. */
export const SOURCE_DETAIL_PAGE_SIZE = 20;
export const SOURCE_DETAIL_TEXT_PAGE_SIZE = 500;

// Localize analysis statuses/reasons; instrument labels come unchanged from Rust.
const IDENTITY_REASONS = {
  missing_gm_declaration: ['No admitted General MIDI declaration', '没有可采纳的 General MIDI 声明'],
  gm_off: ['General MIDI declaration was turned off', 'General MIDI 声明已关闭'],
  missing_program: ['No explicit Program Change in this declaration epoch', '此声明阶段没有显式 Program Change'],
  missing_explicit_bank: ['An explicit bank pair is missing', '缺少显式 Bank 选择对'],
  unknown_tuple: ['Program/bank combination is outside the reviewed identity subset', 'Program/Bank 组合不在已核对的识别子集中'],
  explicit_routing_out_of_scope: ['Explicit port or device routing is outside this analysis', '显式端口或设备路由超出此分析范围'],
  targeted_sysex: ['Device-targeted SysEx is outside this analysis', '面向特定设备的 SysEx 超出此分析范围'],
  fragment_or_escape: ['Fragmented or escaped SysEx cannot establish identity', '分段或转义 SysEx 不能确定身份'],
  opaque_sound_boundary: ['An uninterpreted sound-changing event prevents identification', '未解释的音色更改事件使身份无法确定'],
  cross_track_order_uncertain: ['Identity depends on uncertain cross-track event order', '身份取决于不确定的跨轨事件顺序'],
  invalid_program: ['Invalid program evidence', 'Program 证据无效'],
  optional_drum_channel_behavior: ['Optional percussion-channel behavior is unresolved', '可选的打击乐通道行为尚未解析'],
  non_basic_profile: ['Only Basic MIDI sources are analyzed', '仅分析 Basic MIDI 来源'],
  analysis_limit: ['Identity analysis exceeded its safety limit', '身份分析超出安全限制'],
};

function identityFacts(part, options, text) {
  const entry = options.identityIndex?.parts?.get(part.id), rows = [], segments = [];
  if (!entry && !options.identityStatus && !options.identityError) return {entry, rows, segments};
  if (entry) {
    const classifications = {
      supported: text('Supported by the provisional product list', '在临时产品支持列表内'),
      known_unsupported: text('Known unsupported by the provisional product list', '已识别，但在临时产品支持列表外'),
      unresolved: text('Unresolved', '未解析'),
    };
    rows.push([text('Identity analysis classification', '身份分析分类'), (entry.mixed ? text('Mixed · ', '混合 · ') : '') + (classifications[entry.classification] || classifications.unresolved)]);
    rows.push([text('Analyzed source attacks', '已分析源起音数'), String(entry.attack_count)]);
    rows.push([text('Attack classification counts', '起音分类计数'), text(`${entry.supported_count} supported · ${entry.known_unsupported_count} known unsupported · ${entry.unresolved_count} unresolved`, `${entry.supported_count} 个在支持列表内 · ${entry.known_unsupported_count} 个已知不支持 · ${entry.unresolved_count} 个未解析`)]);
    if (!entry.attack_count) rows.push([text('Identity evidence', '身份依据'), text('No source note attacks; no instrument identity was inferred from file or part names.', '没有源音符起音；未根据文件名或声部名推测乐器身份。')]);
    const identities = entry.identities || [], reasons = entry.reasons || [];
    const attackCount = count => text(` · ${count} source attacks`, ` · ${count} 个源起音`);
    segments.push({length: identities.length, get: index => [text('Analyzed original identity', '分析所得原始乐器身份'), identities[index].label, attackCount(identities[index].count)]});
    segments.push({length: reasons.length, get: index => {
      const reason = reasons[index], copy = Object.hasOwn(IDENTITY_REASONS,reason.code) ? IDENTITY_REASONS[reason.code] : null;
      return [text('Unresolved identity reason', '身份未解析原因'), copy ? text(...copy) : text('Unrecognized analysis reason', '未识别的分析原因'), attackCount(reason.count)];
    }});
  } else {
    const status = options.identityStatus;
    rows.push([text('Identity analysis', '身份分析'), status === 'loading' ? text('Loading…', '加载中…') : status === 'unsupported' ? text('Available only for Basic MIDI sources.', '仅适用于 Basic MIDI 来源。') : status === 'error' ? text('Identity analysis could not be loaded.', '无法加载身份分析。') : text('No analyzed identity is available for this part.', '此声部没有可用的已分析身份。')]);
    if (status === 'error' && options.identityError) rows.push([text('Identity analysis error', '身份分析错误'), String(options.identityError)]);
  }
  rows.push([text('Identity analysis scope', '身份分析范围'), text('Basic MIDI only, using a limited reviewed identity subset. Unreviewed entries remain unresolved. Informational only: these classifications do not decide practice support or change playback, assignment or scoring.', '仅分析 Basic MIDI，并使用有限的已核对身份子集；未核对的条目保留为未解析。仅供参考：这些分类不决定练习支持，也不改变播放、演奏者分配或评分。')]);
  return {entry, rows, segments};
}

function paginateSegments(segments, requestedPage) {
  const totalRows=segments.reduce((sum,segment)=>sum+segment.length,0),pageCount=Math.max(1,Math.ceil(totalRows/SOURCE_DETAIL_PAGE_SIZE)),page=Math.max(0,Math.min(pageCount-1,Number.isSafeInteger(requestedPage)?requestedPage:0));
  const start=page*SOURCE_DETAIL_PAGE_SIZE,end=Math.min(totalRows,start+SOURCE_DETAIL_PAGE_SIZE),visible=[];
  let offset=0;
  for(const segment of segments){
    for(let index=Math.max(0,start-offset);index<Math.min(segment.length,end-offset);index++)visible.push(segment.get(index));
    offset+=segment.length;
  }
  return {rows:visible,totalRows,page,pageCount};
}

export function sourceInstrumentDetailPage(part, details, locale = 'en', status = 'absent', error = null, requestedPage = 0, identityOptions = {}) {
  const text = (en, zh) => locale === 'en' ? en : zh;
  const unknown = text('Unknown', '未知');
  const segments = [];
  const identity = identityFacts(part, identityOptions, text);
  const rows = [[text('Original instrument', '原始乐器'), identity.entry?.identities?.length ? text('See analyzed original identities below', '见下方分析所得原始乐器身份') : text('Not identified', '未识别')], ...identity.rows];
  const sourcePart = details?.parts?.find(value => value.part_id === part.id);
  if (!sourcePart) {
    rows.push([text('Source details', '源文件详情'), status === 'loading' ? text('Loading…', '加载中…') : status === 'unsupported' ? text('This source format does not provide instrument details. This does not determine practice support.', '此来源格式暂不提供乐器详情；这不代表不支持演奏。') : status === 'error' ? text('Instrument details could not be loaded.', '无法加载乐器详情。') : text('Unavailable for this source. The part name is not an instrument identification.', '此来源的详细信息不可用；声部名称不能作为乐器识别依据。')]);
    if (status === 'error' && error) rows.push([text('Details error', '详情错误'), String(error)]);
    rows.push([text('Notated notes', '记谱音符数'), String((part.notes || []).filter(note => note.pitch != null).length)]);
    return paginateSegments([{length:rows.length,get:index=>rows[index]},...identity.segments],requestedPage);
  }
  const track = details.tracks?.find(value => value.id === sourcePart.track_id);
  const channel = details.channels?.find(value => value.id === sourcePart.channel_id);
  const route = details.routes?.find(value => value.id === sourcePart.route_id);
  rows.push([text('Source track', '源轨道'), track ? `${track.source_track_index + 1}` : unknown]);
  const roles = {track_name: text('Track name in file', '文件中的轨道名称'), instrument_name: text('Instrument name in file', '文件中的乐器名称'), program_name: text('Program name in file', '文件中的音色名称')};
  const names=track?.names||[];
  const nameSegment={length:names.length,get:index=>{
    const name=names[index];
    const scope = name.channel_prefix_scope === 'declared_channel' ? text(` · channel ${name.channel_prefix + 1}`, ` · 通道 ${name.channel_prefix + 1}`) : name.channel_prefix_scope === 'invalid_declaration' ? text(' · invalid channel association', ' · 通道关联无效') : text(' · track-wide declaration', ' · 轨道级声明');
    const value = typeof name.utf8 === 'string' ? name.utf8 : text('Name encoding unknown', '名称编码未知');
    const routeScope=Number.isInteger(name.source_route_index)?text(` · source route index ${name.source_route_index}`,` · 源路由索引 ${name.source_route_index}`):text(' · route has no channel events',' · 此路由无通道事件');
    return [roles[name.role] || text('Name in file', '文件中的名称'), value, scope+routeScope];
  }};
  const middle=[];
  middle.push([text('MIDI channel (1–16)', 'MIDI 通道（1–16）'), channel ? String(channel.channel + 1) : unknown]);
  middle.push([text('Logical route', '逻辑路由'), route?.id || sourcePart.route_id || unknown]);
  const summary = sourcePart.selection_summary;
  const statuses = {known: text('Declared numeric selection', '已声明数字音色选择'), changes: text('Changes during this part', '此声部中途变化'), mixed: text('Partly unknown', '部分未知'), ambiguous: text('Ambiguous', '存在歧义'), unknown};
  middle.push([text('Source sound selection', '源音色选择'), statuses[summary?.status] || unknown]);
  const selections=summary?.observed_selections||[];
  const selectionSegment={length:selections.length,get:index=>{
    const selection=selections[index];
    return [text('MIDI program / bank MSB / LSB (0–127)', 'MIDI Program / Bank MSB / LSB（0–127）'), `${selection.program ?? unknown} / ${selection.bank_most_significant ?? unknown} / ${selection.bank_least_significant ?? unknown}`];
  }};
  const tail=[];
  if (!summary?.observed_selections?.length) tail.push([text('MIDI program / bank', 'MIDI Program / Bank'), unknown]);
  tail.push([text('Instrument namespace', '乐器音色标准'), identity.entry ? text('Unknown in numeric-only evidence. Independent identity analysis is shown separately; numeric values alone do not identify an acoustic instrument or confirm General MIDI.', '仅数字证据中的音色标准未知。独立身份分析单独列出；数字本身不能证明原始声学乐器或确认 General MIDI 标准。') : text('Unknown; numeric program values do not identify an acoustic instrument or confirm General MIDI.', '未知；数字 Program 不能证明原始声学乐器或确认 General MIDI 标准。')]);
  tail.push([text('Source note attacks / notated notes', '源起音数 / 记谱音符数'), `${sourcePart.source_attack_count} / ${sourcePart.notated_note_count}`]);
  tail.push([text('MIDI key range', 'MIDI 键范围'), sourcePart.key_range ? `${sourcePart.key_range.lowest}–${sourcePart.key_range.highest}` : unknown]);
  if (summary?.attacks_without_declared_program) tail.push([text('Attacks without a declared program', '未声明 Program 的起音数'), String(summary.attacks_without_declared_program)]);
  if (summary?.attacks_with_ambiguous_selection) tail.push([text('Attacks with ambiguous selection', '音色选择存在歧义的起音数'), String(summary.attacks_with_ambiguous_selection)]);
  const counts=[text('Declared names / observed numeric selections','声明名称数 / 已观察数字选择数'),`${names.length} / ${selections.length}`];
  // Keep short source facts on the first page, before potentially huge lists.
  segments.push({length:rows.length,get:index=>rows[index]},{length:1,get:()=>counts},{length:middle.length,get:index=>middle[index]},{length:tail.length,get:index=>tail[index]},...identity.segments,nameSegment,selectionSegment);
  return paginateSegments(segments,requestedPage);
}

/** Bounded plain rows for tests and non-DOM consumers. Full evidence stays in details. */
export function sourceInstrumentDetailRows(part,details,locale='en',status='absent',error=null,page=0,identityOptions={}){
  return sourceInstrumentDetailPage(part,details,locale,status,error,page,identityOptions).rows.map(([label,value,suffix=''])=>[label,String(value).slice(0,SOURCE_DETAIL_TEXT_PAGE_SIZE)+suffix]);
}

const views=new WeakMap();
export function renderSourceInstrumentDetails(options) {
  const {document,root,part,details,locale,status,error,identityIndex,identityStatus,identityError}=options;
  let state=views.get(root);
  if(!state||state.details!==details||state.identityIndex!==identityIndex||state.identityStatus!==identityStatus||state.identityError!==identityError||state.partId!==part.id){state={details,identityIndex,identityStatus,identityError,partId:part.id,page:0,textPages:new Map()};views.set(root,state);}
  const text=(en,zh)=>locale==='en'?en:zh;
  const page=sourceInstrumentDetailPage(part,details,locale,status,error,state.page,{identityIndex,identityStatus,identityError});state.page=page.page;
  root.replaceChildren();
  const repaint=()=>renderSourceInstrumentDetails(options);
  const button=(parent,label,disabled,action)=>{const node=document.createElement('button');node.type='button';node.className='button secondary compact';node.textContent=label;node.disabled=disabled;node.addEventListener('click',action);parent.append(node);return node;};
  for(const [index,[label,raw,suffix='']] of page.rows.entries()){
    const term=document.createElement('dt'),description=document.createElement('dd'),value=String(raw),key=page.page*SOURCE_DETAIL_PAGE_SIZE+index;
    term.textContent=label;root.append(term,description);
    const textPages=Math.max(1,Math.ceil(value.length/SOURCE_DETAIL_TEXT_PAGE_SIZE)),textPage=Math.min(state.textPages.get(key)||0,textPages-1),start=textPage*SOURCE_DETAIL_TEXT_PAGE_SIZE,end=Math.min(value.length,start+SOURCE_DETAIL_TEXT_PAGE_SIZE);
    const boundary=index=>index>0&&index<value.length&&/[\uDC00-\uDFFF]/.test(value[index])&&/[\uD800-\uDBFF]/.test(value[index-1])?index+1:index;
    const content=document.createElement('span');content.textContent=value.slice(boundary(start),boundary(end))+suffix;description.append(content);
    if(textPages>1){
      const controls=document.createElement('div');controls.className='song-mod-detail-text-pages';description.append(controls);
      const counter=document.createElement('span');counter.textContent=text(`Text positions ${start+1}–${end} of ${value.length} (UTF-16). Remaining text is on other pages.`,`文本位置 ${start+1}–${end} / ${value.length}（UTF-16）；其余文本在其他页。`);counter.setAttribute('role','status');controls.append(counter);
      const move=delta=>{state.textPages.set(key,textPage+delta);repaint();root.querySelector(`[data-text-page="${key}"]`)?.focus();};
      const previous=button(controls,text('Previous text','上一段文本'),textPage===0,()=>move(-1)),next=button(controls,text('Next text','下一段文本'),textPage===textPages-1,()=>move(1));
      (textPage<textPages-1?next:previous).dataset.textPage=String(key);
      const jumpLabel=document.createElement('label'),jump=document.createElement('input');jumpLabel.textContent=text(`Text page (1–${textPages})`,`文本页码（1–${textPages}）`);jump.type='number';jump.min='1';jump.max=String(textPages);jump.step='1';jump.value=String(textPage+1);jumpLabel.append(jump);controls.append(jumpLabel);
      const go=()=>{const requested=Number(jump.value);if(Number.isSafeInteger(requested)&&requested>=1&&requested<=textPages){state.textPages.set(key,requested-1);repaint();root.querySelector(`[data-text-page="${key}"]`)?.focus();}};
      jump.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();go();}});button(controls,text('Go to text page','转到文本页'),false,go);
    }
  }
  if(page.pageCount>1){
    const term=document.createElement('dt'),controls=document.createElement('dd');term.textContent=text('Detail pages','详情分页');controls.className='song-mod-detail-pages';root.append(term,controls);
    const counter=document.createElement('span');counter.textContent=text(`Details ${page.page*SOURCE_DETAIL_PAGE_SIZE+1}–${Math.min(page.totalRows,(page.page+1)*SOURCE_DETAIL_PAGE_SIZE)} of ${page.totalRows}. Other details are on other pages.`,`详情 ${page.page*SOURCE_DETAIL_PAGE_SIZE+1}–${Math.min(page.totalRows,(page.page+1)*SOURCE_DETAIL_PAGE_SIZE)} / ${page.totalRows}；其余详情在其他页。`);counter.setAttribute('role','status');controls.append(counter);
    const move=delta=>{state.page+=delta;state.textPages.clear();repaint();root.querySelector('[data-detail-page-focus]')?.focus();};
    const previous=button(controls,text('Previous details','上一页详情'),page.page===0,()=>move(-1)),next=button(controls,text('Next details','下一页详情'),page.page===page.pageCount-1,()=>move(1));
    (page.page<page.pageCount-1?next:previous).dataset.detailPageFocus='';
    const jumpLabel=document.createElement('label'),jump=document.createElement('input');jumpLabel.textContent=text(`Page (1–${page.pageCount})`, `页码（1–${page.pageCount}）`);jump.type='number';jump.min='1';jump.max=String(page.pageCount);jump.step='1';jump.value=String(page.page+1);jumpLabel.append(jump);controls.append(jumpLabel);
    const go=()=>{const requested=Number(jump.value);if(Number.isSafeInteger(requested)&&requested>=1&&requested<=page.pageCount){state.page=requested-1;state.textPages.clear();repaint();root.querySelector('[data-detail-page-focus]')?.focus();}};
    jump.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();go();}});button(controls,text('Go to page','转到此页'),false,go);
  }
}

const summaryIndexes=new WeakMap();
/** Source-declared names are not an acoustic identity or an eligibility decision. */
function sourceDeclaredNameSummary(part,details,locale='en'){
  const text=(en,zh)=>locale==='en'?en:zh,unknown=text('Original instrument: not identified · Source details','原始乐器：未识别 · 源文件详情');
  if(!details)return unknown;
  let index=summaryIndexes.get(details);
  if(!index){
    index={parts:new Map((details.parts||[]).map(value=>[value.part_id,value])),tracks:new Map((details.tracks||[]).map(value=>[value.id,value])),channels:new Map((details.channels||[]).map(value=>[value.id,value])),routes:new Map((details.routes||[]).map(value=>[value.id,value])),names:new Map()};summaryIndexes.set(details,index);
  }
  const sourcePart=index.parts.get(part.id);if(!sourcePart)return unknown;
  const track=index.tracks.get(sourcePart.track_id),channel=index.channels.get(sourcePart.channel_id)?.channel,route=index.routes.get(sourcePart.route_id)?.source_route_index;
  if(!Number.isInteger(route)||route<0)return unknown;
  let groups=index.names.get(sourcePart.track_id);
  if(!groups){
    groups=new Map();index.names.set(sourcePart.track_id,groups);
    for(const name of track?.names||[]){
      // Null means this declaration's route has no channel events, not every route.
      if(!Number.isInteger(name.source_route_index)||name.source_route_index<0)continue;
      if(name.role!=='instrument_name'||!['unscoped','declared_channel'].includes(name.channel_prefix_scope))continue;
      if(name.channel_prefix_scope==='declared_channel'&&(!Number.isInteger(name.channel_prefix)||name.channel_prefix<0||name.channel_prefix>15))continue;
      const key=`${name.source_route_index}:${name.channel_prefix_scope==='declared_channel'?name.channel_prefix:'*'}`,group=groups.get(key);
      if(group)group.count++;else groups.set(key,{count:1,first:name.utf8});
    }
  }
  const keys=new Set([`${route}:*`]);if(Number.isInteger(channel))keys.add(`${route}:${channel}`);
  let count=0,first;
  for(const key of keys){const group=groups.get(key);if(group){count+=group.count;first=group.first;}}
  if(!count)return unknown;
  const label=text('Instrument name in file','文件中的乐器名称'),suffix=text(' · Source details',' · 源文件详情');
  if(count>1)return label+text(`: ${count} declarations`, `：${count} 条声明`)+suffix;
  if(typeof first!=='string')return label+text(': name encoding unknown','：名称编码未知')+suffix;
  // A summary has a strict text budget; full source text remains paginated below.
  const limit=100,end=first.length>limit&&/[\uD800-\uDBFF]/.test(first[limit-1])&&/[\uDC00-\uDFFF]/.test(first[limit])?limit-1:limit;
  return label+text(': ','：')+first.slice(0,end)+(first.length>end?text('… (continued in details)','…（详见详情）'):'')+suffix;
}

function boundedSummaryLabel(value, text, limit=100) {
  const label=String(value),end=label.length>limit&&/[\uD800-\uDBFF]/.test(label[limit-1])&&/[\uDC00-\uDFFF]/.test(label[limit])?limit-1:limit;
  return label.slice(0,end)+(label.length>end?text('… (continued in details)','…（详见详情）'):'');
}

/** The trusted, source-bound index is supplied by the loader, never reconstructed from metadata. */
export function sourceInstrumentSummary(part,details,locale='en',identityIndex=null){
  const declared=sourceDeclaredNameSummary(part,details,locale),entry=identityIndex?.parts?.get(part.id);
  if(!entry)return declared;
  const text=(en,zh)=>locale==='en'?en:zh,identities=entry.identities||[],shown=identities.slice(0,3);
  const labels=shown.map(value=>`${boundedSummaryLabel(value.label,text)} × ${value.count}`).join(' · ');
  const more=identities.length>shown.length?text(` · ${identities.length-shown.length} more identities in details`,` · 详情中另有 ${identities.length-shown.length} 种身份`):'';
  const heading=text('Analyzed original instrument: ','分析所得原始乐器：');
  const status=entry.attack_count?text(`${entry.supported_count} supported · ${entry.known_unsupported_count} known unsupported · ${entry.unresolved_count} unresolved`,`${entry.supported_count} 个在支持列表内 · ${entry.known_unsupported_count} 个已知不支持 · ${entry.unresolved_count} 个未解析`):text('No source note attacks; identity unresolved','没有源音符起音；身份未解析');
  // Keep declared file metadata separate, including its literal text and existing bounds.
  const fileName=declared.startsWith(text('Instrument name in file','文件中的乐器名称'))?' · '+declared:text(' · Source details',' · 源文件详情');
  return heading+(labels||text('not identified','未识别'))+more+(entry.mixed?text(' · Mixed',' · 混合'):'')+' · '+status+text(' · Informational only',' · 仅供参考')+fileName;
}

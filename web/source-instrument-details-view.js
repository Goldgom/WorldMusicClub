/** Source evidence is display-only. Never infer eligibility or a GM sound from it. */
export const SOURCE_DETAIL_PAGE_SIZE = 20;
export const SOURCE_DETAIL_TEXT_PAGE_SIZE = 500;

export function sourceInstrumentDetailPage(part, details, locale = 'en', status = 'absent', error = null, requestedPage = 0) {
  const text = (en, zh) => locale === 'en' ? en : zh;
  const unknown = text('Unknown', '未知');
  const segments = [];
  const rows = [[text('Original instrument', '原始乐器'), text('Not identified', '未识别')]];
  const sourcePart = details?.parts?.find(value => value.part_id === part.id);
  if (!sourcePart) {
    rows.push([text('Source details', '源文件详情'), status === 'loading' ? text('Loading…', '加载中…') : status === 'unsupported' ? text('This source format does not provide instrument details. This does not determine practice support.', '此来源格式暂不提供乐器详情；这不代表不支持演奏。') : status === 'error' ? text('Instrument details could not be loaded.', '无法加载乐器详情。') : text('Unavailable for this source. The part name is not an instrument identification.', '此来源的详细信息不可用；声部名称不能作为乐器识别依据。')]);
    if (status === 'error' && error) rows.push([text('Details error', '详情错误'), String(error)]);
    rows.push([text('Notated notes', '记谱音符数'), String((part.notes || []).filter(note => note.pitch != null).length)]);
    return {rows,totalRows:rows.length,page:0,pageCount:1};
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
    return [roles[name.role] || text('Name in file', '文件中的名称'), value, scope];
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
  tail.push([text('Instrument namespace', '乐器音色标准'), text('Unknown; numeric program values do not identify an acoustic instrument or confirm General MIDI.', '未知；数字 Program 不能证明原始声学乐器或确认 General MIDI 标准。')]);
  tail.push([text('Source note attacks / notated notes', '源起音数 / 记谱音符数'), `${sourcePart.source_attack_count} / ${sourcePart.notated_note_count}`]);
  tail.push([text('MIDI key range', 'MIDI 键范围'), sourcePart.key_range ? `${sourcePart.key_range.lowest}–${sourcePart.key_range.highest}` : unknown]);
  if (summary?.attacks_without_declared_program) tail.push([text('Attacks without a declared program', '未声明 Program 的起音数'), String(summary.attacks_without_declared_program)]);
  if (summary?.attacks_with_ambiguous_selection) tail.push([text('Attacks with ambiguous selection', '音色选择存在歧义的起音数'), String(summary.attacks_with_ambiguous_selection)]);
  const counts=[text('Declared names / observed numeric selections','声明名称数 / 已观察数字选择数'),`${names.length} / ${selections.length}`];
  // Keep short source facts on the first page, before potentially huge lists.
  segments.push({length:rows.length,get:index=>rows[index]},{length:1,get:()=>counts},{length:middle.length,get:index=>middle[index]},{length:tail.length,get:index=>tail[index]},nameSegment,selectionSegment);
  const totalRows=segments.reduce((sum,segment)=>sum+segment.length,0),pageCount=Math.max(1,Math.ceil(totalRows/SOURCE_DETAIL_PAGE_SIZE)),page=Math.max(0,Math.min(pageCount-1,Number.isSafeInteger(requestedPage)?requestedPage:0));
  const start=page*SOURCE_DETAIL_PAGE_SIZE,end=Math.min(totalRows,start+SOURCE_DETAIL_PAGE_SIZE),visible=[];
  let offset=0;
  for(const segment of segments){
    for(let index=Math.max(0,start-offset);index<Math.min(segment.length,end-offset);index++)visible.push(segment.get(index));
    offset+=segment.length;
  }
  return {rows:visible,totalRows,page,pageCount};
}

/** Bounded plain rows for tests and non-DOM consumers. Full evidence stays in details. */
export function sourceInstrumentDetailRows(part,details,locale='en',status='absent',error=null,page=0){
  return sourceInstrumentDetailPage(part,details,locale,status,error,page).rows.map(([label,value,suffix=''])=>[label,String(value).slice(0,SOURCE_DETAIL_TEXT_PAGE_SIZE)+suffix]);
}

const views=new WeakMap();
export function renderSourceInstrumentDetails(options) {
  const {document,root,part,details,locale,status,error}=options;
  let state=views.get(root);
  if(!state||state.details!==details||state.partId!==part.id){state={details,partId:part.id,page:0,textPages:new Map()};views.set(root,state);}
  const text=(en,zh)=>locale==='en'?en:zh;
  const page=sourceInstrumentDetailPage(part,details,locale,status,error,state.page);state.page=page.page;
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

/** Source evidence is display-only. Never infer eligibility or a GM sound from it. */
export function sourceInstrumentDetailRows(part, details, locale = 'en', status = 'absent', error = null) {
  const text = (en, zh) => locale === 'en' ? en : zh;
  const unknown = text('Unknown', '未知');
  const rows = [[text('Original instrument', '原始乐器'), text('Not identified', '未识别')]];
  const sourcePart = details?.parts?.find(value => value.part_id === part.id);
  if (!sourcePart) {
    rows.push([text('Source details', '源文件详情'), status === 'loading' ? text('Loading…', '加载中…') : status === 'unsupported' ? text('This source format does not provide instrument details. This does not determine practice support.', '此来源格式暂不提供乐器详情；这不代表不支持演奏。') : status === 'error' ? text('Instrument details could not be loaded.', '无法加载乐器详情。') : text('Unavailable for this source. The part name is not an instrument identification.', '此来源的详细信息不可用；声部名称不能作为乐器识别依据。')]);
    if (status === 'error' && error) rows.push([text('Details error', '详情错误'), String(error)]);
    rows.push([text('Notated notes', '记谱音符数'), String((part.notes || []).filter(note => note.pitch != null).length)]);
    return rows;
  }
  const track = details.tracks?.find(value => value.id === sourcePart.track_id);
  const channel = details.channels?.find(value => value.id === sourcePart.channel_id);
  const route = details.routes?.find(value => value.id === sourcePart.route_id);
  rows.push([text('Source track', '源轨道'), track ? `${track.source_track_index + 1}` : unknown]);
  const roles = {track_name: text('Track name in file', '文件中的轨道名称'), instrument_name: text('Instrument name in file', '文件中的乐器名称'), program_name: text('Program name in file', '文件中的音色名称')};
  for (const name of track?.names || []) {
    const scope = name.channel_prefix_scope === 'declared_channel' ? text(` · channel ${name.channel_prefix + 1}`, ` · 通道 ${name.channel_prefix + 1}`) : name.channel_prefix_scope === 'invalid_declaration' ? text(' · invalid channel association', ' · 通道关联无效') : text(' · track-wide declaration', ' · 轨道级声明');
    const value = typeof name.utf8 === 'string' ? name.utf8 : text('Name encoding unknown', '名称编码未知');
    rows.push([roles[name.role] || text('Name in file', '文件中的名称'), value + scope]);
  }
  rows.push([text('MIDI channel (1–16)', 'MIDI 通道（1–16）'), channel ? String(channel.channel + 1) : unknown]);
  rows.push([text('Logical route', '逻辑路由'), route?.id || sourcePart.route_id || unknown]);
  const summary = sourcePart.selection_summary;
  const statuses = {known: text('Declared numeric selection', '已声明数字音色选择'), changes: text('Changes during this part', '此声部中途变化'), mixed: text('Partly unknown', '部分未知'), ambiguous: text('Ambiguous', '存在歧义'), unknown};
  rows.push([text('Source sound selection', '源音色选择'), statuses[summary?.status] || unknown]);
  for (const selection of summary?.observed_selections || []) {
    rows.push([text('MIDI program / bank MSB / LSB (0–127)', 'MIDI Program / Bank MSB / LSB（0–127）'), `${selection.program ?? unknown} / ${selection.bank_most_significant ?? unknown} / ${selection.bank_least_significant ?? unknown}`]);
  }
  if (!summary?.observed_selections?.length) rows.push([text('MIDI program / bank', 'MIDI Program / Bank'), unknown]);
  rows.push([text('Instrument namespace', '乐器音色标准'), text('Unknown; numeric program values do not identify an acoustic instrument or confirm General MIDI.', '未知；数字 Program 不能证明原始声学乐器或确认 General MIDI 标准。')]);
  rows.push([text('Source note attacks / notated notes', '源起音数 / 记谱音符数'), `${sourcePart.source_attack_count} / ${sourcePart.notated_note_count}`]);
  rows.push([text('MIDI key range', 'MIDI 键范围'), sourcePart.key_range ? `${sourcePart.key_range.lowest}–${sourcePart.key_range.highest}` : unknown]);
  if (summary?.attacks_without_declared_program) rows.push([text('Attacks without a declared program', '未声明 Program 的起音数'), String(summary.attacks_without_declared_program)]);
  if (summary?.attacks_with_ambiguous_selection) rows.push([text('Attacks with ambiguous selection', '音色选择存在歧义的起音数'), String(summary.attacks_with_ambiguous_selection)]);
  return rows;
}

export function renderSourceInstrumentDetails({document, root, part, details, locale, status, error}) {
  const rows = sourceInstrumentDetailRows(part, details, locale, status, error);
  root.replaceChildren();
  for (const [label, value] of rows) {
    const term = document.createElement('dt'), description = document.createElement('dd');
    term.textContent = label; description.textContent = value;
    root.append(term, description);
  }
}

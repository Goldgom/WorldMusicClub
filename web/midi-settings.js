import {keyboardGeometry, midiName} from './music.js';

export const MIDI_CHOICE_KEY = 'worldmusichub.midi-choice';
const keys = keyboardGeometry(128, 0);
const pitch = value => Number.isInteger(value) && value >= 0 && value <= 127;
const range = value => value && pitch(value.low) && pitch(value.high) && value.low <= value.high;
const pitchLabel = value => `${midiName(value)} · MIDI ${value}`;
const rangeLabel = value => `${midiName(value.low)}–${midiName(value.high)} · ${value.low}–${value.high}`;
const none = () => ({mode:'none', id:null});

export function normalizeMidiChoice(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (value.mode === 'all' || value.mode === 'none') return value.id == null ? {mode:value.mode, id:null} : null;
  if (value.mode === 'single' && typeof value.id === 'string' && value.id.length) return {mode:'single', id:value.id};
  return null;
}
export function readMidiChoice(storage) {
  let stored;
  try { stored = (storage ?? globalThis.localStorage).getItem(MIDI_CHOICE_KEY); }
  catch { return {choice:none(), message:'MIDI choice could not be read. No input is selected; changes apply to this tab. · 无法读取 MIDI 选择，本次不接收输入'}; }
  if (stored === null) return {choice:{mode:'all', id:null}, message:''};
  try {
    const parsed = JSON.parse(stored), choice = parsed?.version === 1 ? normalizeMidiChoice(parsed) : null;
    if (choice) return {choice, message:''};
  } catch { /* Corrupt storage must not broaden the selected inputs. */ }
  return {choice:none(), message:'Saved MIDI choice is invalid. No input is selected; choose an input to replace it. · MIDI 选择无效，请重新选择输入'};
}
export function saveMidiChoice(value, storage) {
  const choice = normalizeMidiChoice(value);
  if (!choice) return {saved:false, message:'MIDI choice was invalid and was not saved. · MIDI 选择无效，未保存'};
  try { (storage ?? globalThis.localStorage).setItem(MIDI_CHOICE_KEY, JSON.stringify({version:1, ...choice})); return {saved:true, message:''}; }
  catch { return {saved:false, message:'MIDI choice applies to this tab but could not be saved. · MIDI 选择仅用于本次，无法保存'}; }
}

/** Display only. Observed extrema and configured pitch range are independent. */
export function midiTestReadout(snapshot = {}) {
  const test = snapshot.test || {}, last = test.last;
  const validLast = last && ['on','off'].includes(last.kind) && pitch(last.midi);
  const configured = snapshot.configuredRange;
  const held = test.active && Array.isArray(test.held) ? test.held.filter(note => note && pitch(note.midi)) : [];
  const heldPitches = [...new Set(held.map(note => note.midi))].sort((a,b) => a-b);
  const rangeState = !validLast || !range(configured) ? 'unknown' : last.midi >= configured.low && last.midi <= configured.high ? 'inside' : 'outside';
  const device = validLast && Array.isArray(snapshot.devices) ? snapshot.devices.find(input => input?.id === last.inputId) : null;
  return {
    active:Boolean(test.active), heldPitches,
    lastNote:validLast ? `${last.kind === 'on' ? 'Note on · 按下' : 'Note off · 松开'}: ${pitchLabel(last.midi)}` : 'No note received · 尚未收到音符',
    device:validLast ? device?.name || 'MIDI input · MIDI 输入' : '—',
    channel:validLast && Number.isInteger(last.channel) && last.channel >= 0 && last.channel < 16 ? String(last.channel + 1) : '—',
    velocity:validLast && pitch(last.velocity) ? String(last.velocity) : '—',
    observedRange:range(test.range) ? rangeLabel(test.range) : 'No note-on received · 尚未收到按键',
    configuredRange:range(configured) ? rangeLabel(configured) : 'Not configured · 未设置',
    rangeState,
    rangeStatus:rangeState === 'inside' ? 'Inside configured pitch range · 在设置音域内' : rangeState === 'outside' ? 'Outside configured pitch range · 超出设置音域' : 'Awaiting a note and configured range · 等待音符及音域设置',
    heldText:heldPitches.length ? `${heldPitches.length} held pitches / ${held.length} input contacts · 保持: ${heldPitches.map(midiName).join(', ')}` : 'No held keys · 无保持按键',
  };
}

const stateLabels = {connected:'Connected · 已连接', disconnected:'Disconnected · 已断开'};
const connectionLabels = {open:'Open · 已打开', closed:'Closed · 未打开', pending:'Pending · 挂起'};
const accessLabels = {
  idle:'MIDI access has not been requested. · 尚未请求 MIDI 访问',
  requesting:'Waiting for MIDI access. · 正在等待 MIDI 访问',
  ready:'MIDI access is enabled. Connection and open state are shown separately. · 已启用 MIDI，连接和打开状态分别显示',
  unsupported:'MIDI input is unavailable in this browser. · 当前浏览器不支持 MIDI 输入',
  error:'MIDI input could not be enabled. You can retry Connect MIDI. · 无法启用 MIDI，可重试连接',
};
const choiceValue = choice => choice.mode === 'single' ? `device:${choice.id}` : choice.mode;

/** Call after setupPerformanceView. The controller remains the sole MIDI owner. */
export function setupMidiSettings({document:doc = globalThis.document, onSelection = () => {}, onTest = () => {}} = {}) {
  const $ = id => doc.getElementById(id), content = $('settings-dialog')?.querySelector('.shell-dialog-content');
  if (!content || !$('midi-button') || !$('midi-help')) throw new Error('Set up the Settings panel before its MIDI view.');
  if ($('midi-settings')) throw new Error('The MIDI Settings view is already initialized.');
  const button = $('midi-button'), help = $('midi-help');
  const original = [button,help].map(node => ({node, parent:node.parentNode, next:node.nextSibling}));
  const section = doc.createElement('section');
  section.id = 'midi-settings'; section.className = 'midi-settings'; section.setAttribute('aria-labelledby','midi-settings-title');
  section.innerHTML = `
    <div class="midi-settings-heading"><h3 id="midi-settings-title">MIDI device &amp; key test · MIDI 设备与按键测试</h3><div id="midi-connect-slot"></div></div>
    <p id="midi-access-status" role="status"></p>
    <label class="midi-device-label">Receive from · 输入设备<select id="midi-device-select" aria-describedby="midi-choice-help midi-storage-status"></select></label>
    <p id="midi-choice-help" class="midi-settings-note">All accepts every available input; a saved single-device choice stays selected if it disconnects. Device identities stay in this browser. · 可选择全部、单个或不接收输入</p>
    <p id="midi-storage-status" class="notice" role="status" hidden></p>
    <ul id="midi-device-list" aria-label="MIDI input connection states"></ul>
    <p id="midi-timing-status" class="notice" role="status" hidden></p>
    <div class="midi-test-controls"><button id="midi-test-toggle" type="button" class="button secondary" aria-controls="midi-test-view">Start visual key test · 开始按键测试</button><p id="midi-test-status" role="status"></p></div>
    <div id="midi-test-view" aria-live="off" hidden>
      <p class="midi-settings-note">Visual input only: no sound, practice recording or scoring. Observed range describes notes received in this test, not the device's full range or key count. · 仅显示输入，不发声、不记录练习、不评分</p>
      <dl class="midi-test-readouts">
        <div><dt>Last message · 最近输入</dt><dd id="midi-test-last-note"></dd></div>
        <div><dt>Input · 输入设备</dt><dd id="midi-test-input"></dd></div>
        <div><dt>Channel · 通道 (1–16)</dt><dd id="midi-test-channel"></dd></div>
        <div><dt>Velocity · 力度 (0–127)</dt><dd id="midi-test-velocity"></dd></div>
        <div><dt>Observed range · 已收到音域</dt><dd id="midi-test-range"></dd></div>
        <div><dt>Configured pitch range · 设置音域</dt><dd id="midi-test-configured-range"></dd></div>
      </dl>
      <p id="midi-test-range-status"></p>
      <p class="midi-settings-note">Range comparison checks pitch endpoints only; it does not validate fingering, an arrangement or hardware. · 音域对比不验证指法、编配或设备</p>
      <p id="midi-test-held"></p>
      <div id="midi-test-scroll" class="midi-test-scroll" tabindex="0" role="region" aria-label="MIDI pitch map, C minus 1 to G9; scroll to inspect all pitches"><div id="midi-test-keyboard" aria-hidden="true"></div></div>
      <p class="midi-settings-note">MIDI pitch map · 0–127. The strip displays possible MIDI pitches, not a detected hardware keyboard. · 此图不是检测出的设备键数</p>
    </div>`;
  content.prepend(section);
  $('midi-connect-slot').append(button); section.append(help);
  const select = $('midi-device-select'), toggle = $('midi-test-toggle'), keyboard = $('midi-test-keyboard'), scroller = $('midi-test-scroll');
  const keyNodes = new Map(), markers = new Map();
  for (const key of keys) {
    const node = doc.createElement('span'); node.className = `midi-test-key${key.black ? ' black' : ''}`;
    node.dataset.midiTestPitch = String(key.midi); node.style.left = `${key.x * 100}%`; node.style.width = `${key.width * 100}%`; node.title = pitchLabel(key.midi);
    keyboard.append(node); keyNodes.set(key.midi,node);
  }
  for (const key of keys.filter(key => key.midi % 12 === 0)) {
    const marker = doc.createElement('span'); marker.className = 'midi-test-marker'; marker.style.left = `${key.x * 100}%`; marker.textContent = midiName(key.midi); keyboard.append(marker); markers.set(key.midi,marker);
  }
  let model = {}, renderedDevices = '', currentChoice = {mode:'all',id:null}, choices = new Map(), held = new Set(), lastFollowed = null, disposed = false;
  const text = (id,value) => { if ($(id).textContent !== value) $(id).textContent = value; };
  function renderDevices(devices, choice) {
    const signature = JSON.stringify([devices,choice]);
    if (signature === renderedDevices) return;
    renderedDevices = signature; choices = new Map();
    const options = [], rows = [];
    function option(value,label,unavailable=false) {
      const node = doc.createElement('option'); node.value = choiceValue(value); node.textContent = label; node.disabled = unavailable; options.push(node); choices.set(node.value,value);
    }
    option({mode:'all',id:null},'All MIDI inputs · 所有 MIDI 输入'); option(none(),'No MIDI input · 不接收 MIDI');
    devices.forEach((device,index) => {
      const name = typeof device.name === 'string' && device.name ? device.name : `MIDI input ${index+1}`;
      const state = stateLabels[device.state] || 'Connection unknown · 连接未知';
      const connection = connectionLabels[device.connection] || 'Open state unknown · 打开状态未知';
      const opening = device.opening ? ' · Opening requested · 正在请求打开' : '';
      const selected = choice.mode === 'all' || (choice.mode === 'single' && choice.id === device.id);
      option({mode:'single',id:device.id},`${name} — ${state} · ${connection}`,false);
      const row = doc.createElement('li'), title = doc.createElement('strong'), detail = doc.createElement('span');
      row.classList.toggle('is-selected',selected); row.dataset.connection = device.connection || 'unknown'; row.dataset.state = device.state || 'unknown';
      title.textContent = name; detail.textContent = `${state} · ${connection}${opening}${selected ? ' · Selected · 已选择' : ''}`;
      row.append(title,detail);
      if (device.error) { const error = doc.createElement('span'); error.className = 'midi-device-error'; error.textContent = `Open error · 打开失败: ${device.error}`; row.append(error); }
      rows.push(row);
    });
    if (choice.mode === 'single' && !devices.some(device => device.id === choice.id)) option(choice,'Saved device unavailable · 已选设备当前不可用',true);
    if (!rows.length) { const row = doc.createElement('li'); row.textContent = 'No MIDI inputs reported. · 尚无 MIDI 输入设备'; rows.push(row); }
    select.replaceChildren(...options); select.value = choiceValue(choice); $('midi-device-list').replaceChildren(...rows);
  }
  function render(snapshot = {}) {
    if (disposed) return;
    model = snapshot; currentChoice = normalizeMidiChoice(snapshot.choice) || none();
    const devices = Array.isArray(snapshot.devices) ? snapshot.devices.filter(device => device && typeof device.id === 'string' && device.id.length) : [];
    renderDevices(devices,currentChoice);
    text('midi-access-status',`${accessLabels[snapshot.phase] || accessLabels.idle}${snapshot.message ? ` ${snapshot.message}` : ''}`);
    text('midi-storage-status',snapshot.storageMessage || ''); $('midi-storage-status').hidden = !snapshot.storageMessage;
    const omitted = Number.isSafeInteger(snapshot.omittedTimingEvents) && snapshot.omittedTimingEvents > 0 ? snapshot.omittedTimingEvents : 0;
    text('midi-timing-status',omitted ? `${omitted} timing-ambiguous MIDI messages excluded from practice · 已排除 ${omitted} 条时间不明的 MIDI 输入` : ''); $('midi-timing-status').hidden = !omitted;
    const display = midiTestReadout({...snapshot,devices});
    toggle.disabled = !display.active && !snapshot.canTest;
    text('midi-test-toggle',display.active ? 'Stop key test · 停止按键测试' : 'Start visual key test · 开始按键测试');
    text('midi-test-status',snapshot.test?.message || (display.active ? 'Key test on; practice input is excluded. · 按键测试中，不计入练习' : snapshot.test?.last ? 'Key test stopped; last readings are retained. · 已停止测试，保留最近读数' : snapshot.canTest ? 'Start the test, then press keys on your selected device. · 开始测试后按下所选设备的按键' : 'Connect and open a selected input to test. · 请连接并打开所选输入设备'));
    $('midi-test-view').hidden = !display.active && !snapshot.test?.last && !range(snapshot.test?.range);
    section.dataset.testing = String(display.active);
    for (const [id,value] of Object.entries({'midi-test-last-note':display.lastNote,'midi-test-input':display.device,'midi-test-channel':display.channel,'midi-test-velocity':display.velocity,'midi-test-range':display.observedRange,'midi-test-configured-range':display.configuredRange,'midi-test-range-status':display.rangeStatus,'midi-test-held':display.heldText})) text(id,value);
    $('midi-test-range-status').dataset.range = display.rangeState;
    const nextHeld = new Set(display.heldPitches);
    for (const midi of new Set([...held,...nextHeld])) {
      keyNodes.get(midi)?.classList.toggle('is-held',nextHeld.has(midi)); markers.get(midi)?.classList.toggle('is-held',nextHeld.has(midi));
    }
    held = nextHeld;
    const last = snapshot.test?.last, signature = display.active && last?.kind === 'on' && pitch(last.midi) ? JSON.stringify(last) : null;
    if (signature && signature !== lastFollowed && scroller.clientWidth > 0 && keyboard.clientWidth > 0) {
      const key = keys[last.midi], left = key.x * keyboard.clientWidth, right = (key.x+key.width) * keyboard.clientWidth, scrollLeft = scroller.scrollLeft || 0;
      if (left < scrollLeft) scroller.scrollLeft = Math.max(0,left-10);
      else if (right > scrollLeft+scroller.clientWidth) scroller.scrollLeft = right-scroller.clientWidth+10;
    }
    lastFollowed = signature;
  }
  function selectionChanged() {
    const requested = choices.get(select.value);
    select.value = choiceValue(currentChoice);
    if (requested) onSelection({...requested});
  }
  function testRequested() { onTest(!Boolean(model.test?.active)); }
  select.addEventListener('change',selectionChanged); toggle.addEventListener('click',testRequested);
  render({phase:'idle',choice:{mode:'all',id:null},devices:[],canTest:false,configuredRange:null,test:{active:false,held:[],last:null,range:null}});
  return {render,destroy() {
    if (disposed) return; disposed = true;
    select.removeEventListener('change',selectionChanged); toggle.removeEventListener('click',testRequested);
    for (const {node,parent,next} of original) if (parent) parent.insertBefore(node,next?.parentNode === parent ? next : null);
    section.remove();
  }};
}

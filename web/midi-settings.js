import {keyboardGeometry, midiName} from './music.js';
import {getAppI18n} from './app-locale.js';

export const MIDI_CHOICE_KEY = 'worldmusichub.midi-choice';
const keys = keyboardGeometry(128, 0);
const pitch = value => Number.isInteger(value) && value >= 0 && value <= 127;
const range = value => value && pitch(value.low) && pitch(value.high) && value.low <= value.high;
const pitchLabel = value => `${midiName(value)} · MIDI ${value}`;
const rangeLabel = value => `${midiName(value.low)}–${midiName(value.high)} · ${value.low}–${value.high}`;
const none = () => ({mode:'none', id:null});
const storageKeys = Object.freeze({midi_choice_read_failed:'input.midi.storageRead',midi_choice_invalid:'input.midi.storageInvalid',midi_choice_not_saved:'input.midi.choiceInvalid',midi_choice_save_failed:'input.midi.storageSave'});
const messageKeys = Object.freeze({midi_access_failed:'input.midi.permissionDenied',midi_open_failed:'input.midi.openFailed'});
const knownMessageCodes = new Set([...Object.keys(messageKeys),'midi_timing_ambiguous']);
const knownTestCodes = new Set(['midi_test_active','midi_test_stopped']);
const stopReasons = new Set(['user','settings_closed','page_hidden','window_blur','input_open_failed','device_changed','input_unavailable','selection_changed','pagehide']);
const literal = value => typeof value === 'string' ? value : '';
const mapped = (map,code) => typeof code === 'string' && Object.hasOwn(map,code) ? map[code] : null;

export function normalizeMidiChoice(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (value.mode === 'all' || value.mode === 'none') return value.id == null ? {mode:value.mode, id:null} : null;
  if (value.mode === 'single' && typeof value.id === 'string' && value.id.length) return {mode:'single', id:value.id};
  return null;
}
export function readMidiChoice(storage, i18n = getAppI18n()) {
  const failure = code => ({choice:none(),code,message:i18n.t(storageKeys[code])});
  let stored;
  try { stored = (storage ?? globalThis.localStorage).getItem(MIDI_CHOICE_KEY); }
  catch { return failure('midi_choice_read_failed'); }
  if (stored === null) return {choice:{mode:'all', id:null}, message:''};
  try {
    const parsed = JSON.parse(stored), choice = parsed?.version === 1 ? normalizeMidiChoice(parsed) : null;
    if (choice) return {choice, message:''};
  } catch { /* Corrupt storage must not broaden the selected inputs. */ }
  return failure('midi_choice_invalid');
}
export function saveMidiChoice(value, storage, i18n = getAppI18n()) {
  const failure = code => ({saved:false,code,message:i18n.t(storageKeys[code])});
  const choice = normalizeMidiChoice(value);
  if (!choice) return failure('midi_choice_not_saved');
  try { (storage ?? globalThis.localStorage).setItem(MIDI_CHOICE_KEY, JSON.stringify({version:1, ...choice})); return {saved:true, message:''}; }
  catch { return failure('midi_choice_save_failed'); }
}

/** Display only. Observed extrema and configured pitch range are independent. */
export function midiTestReadout(snapshot = {}, i18n = getAppI18n()) {
  const t = (key,params) => i18n.t(`input.midi.${key}`,params);
  const test = snapshot.test || {}, last = test.last;
  const validLast = last && ['on','off'].includes(last.kind) && pitch(last.midi);
  const configured = snapshot.configuredRange;
  const held = test.active && Array.isArray(test.held) ? test.held.filter(note => note && pitch(note.midi)) : [];
  const heldPitches = [...new Set(held.map(note => note.midi))].sort((a,b) => a-b);
  const rangeState = !validLast || !range(configured) ? 'unknown' : last.midi >= configured.low && last.midi <= configured.high ? 'inside' : 'outside';
  const device = validLast && Array.isArray(snapshot.devices) ? snapshot.devices.find(input => input?.id === last.inputId) : null;
  return {
    active:Boolean(test.active), heldPitches,
    lastNote:validLast ? t(last.kind === 'on' ? 'noteOn' : 'noteOff',{pitch:pitchLabel(last.midi)}) : t('noNote'),
    device:validLast ? literal(device?.name) || t('inputFallback') : '—',
    channel:validLast && Number.isInteger(last.channel) && last.channel >= 0 && last.channel < 16 ? i18n.formatNumber(last.channel + 1) : '—',
    velocity:validLast && pitch(last.velocity) ? i18n.formatNumber(last.velocity) : '—',
    observedRange:range(test.range) ? rangeLabel(test.range) : t('noNoteOn'),
    configuredRange:range(configured) ? rangeLabel(configured) : t('notConfigured'),
    rangeState,rangeStatus:t(`range.${rangeState}`),
    heldText:heldPitches.length ? t('held',{pitches:heldPitches.length,contacts:held.length,notes:heldPitches.map(midiName).join(', ')}) : t('noHeld'),
  };
}
const choiceValue = choice => choice.mode === 'single' ? `device:${choice.id}` : choice.mode;

/** Call after setupPerformanceView. The controller remains the sole MIDI owner. */
export function setupMidiSettings({document:doc = globalThis.document, i18n = getAppI18n(doc), onSelection = () => {}, onTest = () => {}} = {}) {
  const $ = id => doc.getElementById(id), t = (key,params) => i18n.t(`input.midi.${key}`,params);
  const content = $('settings-dialog')?.querySelector('.shell-dialog-content');
  if (!content || !$('midi-button') || !$('midi-help')) throw new Error('Set up the Settings panel before its MIDI view.');
  if ($('midi-settings')) throw new Error('The MIDI Settings view is already initialized.');
  const button = $('midi-button'), help = $('midi-help');
  const original = [button,help].map(node => ({node, parent:node.parentNode, next:node.nextSibling}));
  const section = doc.createElement('section');
  section.id = 'midi-settings'; section.className = 'midi-settings'; section.setAttribute('aria-labelledby','midi-settings-title');
  section.style.overflowWrap = 'anywhere';
  // Static structure only. All localized and external strings use textContent.
  section.innerHTML = `
    <div class="midi-settings-heading"><h3 id="midi-settings-title"></h3><div id="midi-connect-slot"></div></div>
    <p id="midi-access-status" role="status"></p><details id="midi-access-details" hidden><summary></summary><p></p></details>
    <label class="midi-device-label"><span id="midi-receive-label"></span><select id="midi-device-select" aria-describedby="midi-choice-help midi-storage-status"></select></label>
    <p id="midi-choice-help" class="midi-settings-note"></p>
    <p id="midi-storage-status" class="notice" role="status" hidden></p><details id="midi-storage-details" hidden><summary></summary><p></p></details>
    <ul id="midi-device-list"></ul>
    <p id="midi-timing-status" class="notice" role="status" hidden></p>
    <div class="midi-test-controls"><button id="midi-test-toggle" type="button" class="button secondary" aria-controls="midi-test-view"></button><p id="midi-test-status" role="status"></p></div>
    <details id="midi-test-details" hidden><summary></summary><p></p></details>
    <div id="midi-test-view" aria-live="off" hidden>
      <p id="midi-test-help" class="midi-settings-note"></p>
      <dl class="midi-test-readouts">
        <div><dt id="midi-last-label"></dt><dd id="midi-test-last-note"></dd></div>
        <div><dt id="midi-input-label"></dt><dd id="midi-test-input"></dd></div>
        <div><dt id="midi-channel-label"></dt><dd id="midi-test-channel"></dd></div>
        <div><dt id="midi-velocity-label"></dt><dd id="midi-test-velocity"></dd></div>
        <div><dt id="midi-range-label"></dt><dd id="midi-test-range"></dd></div>
        <div><dt id="midi-configured-label"></dt><dd id="midi-test-configured-range"></dd></div>
      </dl>
      <p id="midi-test-range-status"></p><p id="midi-range-help" class="midi-settings-note"></p><p id="midi-test-held"></p>
      <div id="midi-test-scroll" class="midi-test-scroll" tabindex="0" role="region"><div id="midi-test-keyboard" aria-hidden="true"></div></div>
      <p id="midi-pitch-help" class="midi-settings-note"></p>
    </div>`;
  content.prepend(section);
  $('midi-connect-slot').append(button); section.append(help);
  const select = $('midi-device-select'), toggle = $('midi-test-toggle'), keyboard = $('midi-test-keyboard'), scroller = $('midi-test-scroll');
  select.style.maxWidth = '100%'; select.style.minWidth = '0';
  toggle.style.whiteSpace = 'normal'; button.style.whiteSpace = 'normal';
  const keyNodes = new Map(), markers = new Map(), optionNodes = new Map(), rowNodes = new Map();
  const emptyRow = doc.createElement('li');
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
  function details(node,value) {
    node.hidden = !value; node.querySelector('summary').textContent = i18n.t('input.details');
    const detail = node.querySelector('p'); if (detail.textContent !== value) detail.textContent = value;
    detail.style.whiteSpace = 'pre-wrap'; detail.style.overflowWrap = 'anywhere';
  }
  function renderLabels() {
    for (const [id,key] of Object.entries({'midi-settings-title':'title','midi-receive-label':'receive','midi-choice-help':'choiceHelp','midi-test-help':'testHelp','midi-last-label':'lastMessage','midi-input-label':'device','midi-channel-label':'channel','midi-velocity-label':'velocity','midi-range-label':'observedRange','midi-configured-label':'configuredRange','midi-range-help':'rangeHelp','midi-pitch-help':'pitchMapHelp','midi-help':'help'})) text(id,t(key));
    select.setAttribute('aria-label',t('receive')); toggle.setAttribute('aria-label',toggle.textContent);
    $('midi-device-list').setAttribute('aria-label',t('deviceListAria'));scroller.setAttribute('aria-label',t('pitchMapAria'));
  }
  function renderDevices(devices, choice, localeOnly) {
    const signature = JSON.stringify([devices,choice,i18n.revision]);
    if (signature === renderedDevices) return;
    renderedDevices = signature; choices = new Map();
    const draft = select.value, options = [], rows = [];
    function option(value,label,unavailable=false) {
      const id = choiceValue(value), node = optionNodes.get(id) || doc.createElement('option');
      optionNodes.set(id,node); node.value = id; node.textContent = label; node.disabled = unavailable; options.push(node); choices.set(id,value);
    }
    option({mode:'all',id:null},t('all')); option(none(),t('none'));
    devices.forEach((device,index) => {
      const name = literal(device.name) || t('unnamed',{count:index+1});
      const state = t(['connected','disconnected'].includes(device.state) ? device.state : 'connectionUnknown');
      const connection = t(['open','closed','pending'].includes(device.connection) ? device.connection : 'openUnknown');
      const selected = choice.mode === 'all' || (choice.mode === 'single' && choice.id === device.id);
      option({mode:'single',id:device.id},`${name} — ${state} · ${connection}`);
      let nodes = rowNodes.get(device.id);
      if (!nodes) {
        const row = doc.createElement('li'), title = doc.createElement('strong'), detail = doc.createElement('span'), error = doc.createElement('span'), disclosure = doc.createElement('details');
        error.className = 'midi-device-error';disclosure.append(doc.createElement('summary'),doc.createElement('p'));row.append(title,detail,error,disclosure);
        nodes = {row,title,detail,error,disclosure};rowNodes.set(device.id,nodes);
      }
      const {row,title,detail,error,disclosure} = nodes;
      row.classList.toggle('is-selected',selected); row.dataset.connection = device.connection || 'unknown'; row.dataset.state = device.state || 'unknown';
      title.textContent = name; detail.textContent = [state,connection,device.opening ? t('openingRequested') : '',selected ? t('selected') : ''].filter(Boolean).join(' · ');
      const failed = Boolean(device.error || device.errorCode || device.errorDetails);
      error.hidden = !failed;error.textContent = failed ? t('openError') : '';
      const raw = literal(device.errorDetails) || (device.errorCode !== 'midi_open_failed' ? literal(device.error) : '');details(disclosure,raw);
      rows.push(row);
    });
    if (choice.mode === 'single' && !devices.some(device => device.id === choice.id)) option(choice,t('unavailable'),true);
    if (!rows.length) { emptyRow.textContent = t('noDevices'); rows.push(emptyRow); }
    // Retain option and select identities so language changes cannot reset focus or a pending choice.
    for (const node of [...select.children]) if (!options.includes(node)) node.remove();
    for (let index=0;index<options.length;index++) if (select.children[index] !== options[index]) select.insertBefore(options[index],select.children[index] || null);
    for (const id of optionNodes.keys()) if (!choices.has(id)) optionNodes.delete(id);
    select.value = localeOnly && choices.has(draft) ? draft : choiceValue(choice);
    const list = $('midi-device-list');
    for (const row of [...list.children]) if (!rows.includes(row)) row.remove();
    for (let index=0;index<rows.length;index++) if (list.children[index] !== rows[index]) list.insertBefore(rows[index],list.children[index] || null);
    for (const id of rowNodes.keys()) if (!devices.some(device => device.id === id)) rowNodes.delete(id);
  }
  function render(snapshot = {}, localeOnly = false) {
    if (disposed) return;
    model = snapshot; currentChoice = normalizeMidiChoice(snapshot.choice) || none();
    const devices = Array.isArray(snapshot.devices) ? snapshot.devices.filter(device => device && typeof device.id === 'string' && device.id.length) : [];
    renderDevices(devices,currentChoice,localeOnly);
    const phase = ['idle','requesting','ready','unsupported','error'].includes(snapshot.phase) ? snapshot.phase : 'idle';
    text('midi-access-status',[t(`access.${phase}`),mapped(messageKeys,snapshot.messageCode) ? i18n.t(mapped(messageKeys,snapshot.messageCode)) : ''].filter(Boolean).join(' '));
    details($('midi-access-details'),literal(snapshot.messageDetails) || (!knownMessageCodes.has(snapshot.messageCode) ? literal(snapshot.message) : ''));
    const storage = mapped(storageKeys,snapshot.storageCode) ? i18n.t(mapped(storageKeys,snapshot.storageCode)) : snapshot.storageMessage ? i18n.t('input.externalDiagnostic') : '';
    text('midi-storage-status',storage); $('midi-storage-status').hidden = !storage;
    details($('midi-storage-details'),mapped(storageKeys,snapshot.storageCode) ? '' : literal(snapshot.storageMessage));
    const omitted = Number.isSafeInteger(snapshot.omittedTimingEvents) && snapshot.omittedTimingEvents > 0 ? snapshot.omittedTimingEvents : 0;
    text('midi-timing-status',omitted ? t('timingOmitted',{count:omitted}) : ''); $('midi-timing-status').hidden = !omitted;
    const display = midiTestReadout({...snapshot,devices},i18n);
    toggle.disabled = !display.active && !snapshot.canTest;
    text('midi-test-toggle',t(display.active ? 'testStop' : 'testStart'));
    const test = snapshot.test || {};
    const testKey = display.active ? 'testActive' : test.code === 'midi_test_stopped' && stopReasons.has(test.reason) ? `stopReason.${test.reason}` : test.last || test.code === 'midi_test_stopped' ? 'testRetained' : snapshot.canTest ? 'testReady' : 'testUnavailable';
    text('midi-test-status',t(testKey)); details($('midi-test-details'),!knownTestCodes.has(test.code) ? literal(test.message) : '');
    $('midi-test-view').hidden = !display.active && !test.last && !range(test.range);
    section.dataset.testing = String(display.active);
    for (const [id,value] of Object.entries({'midi-test-last-note':display.lastNote,'midi-test-input':display.device,'midi-test-channel':display.channel,'midi-test-velocity':display.velocity,'midi-test-range':display.observedRange,'midi-test-configured-range':display.configuredRange,'midi-test-range-status':display.rangeStatus,'midi-test-held':display.heldText})) text(id,value);
    $('midi-test-range-status').dataset.range = display.rangeState;
    const nextHeld = new Set(display.heldPitches);
    for (const midi of new Set([...held,...nextHeld])) {
      keyNodes.get(midi)?.classList.toggle('is-held',nextHeld.has(midi)); markers.get(midi)?.classList.toggle('is-held',nextHeld.has(midi));
    }
    held = nextHeld;
    const last = test.last, signature = display.active && last?.kind === 'on' && pitch(last.midi) ? JSON.stringify(last) : null;
    if (!localeOnly && signature && signature !== lastFollowed && scroller.clientWidth > 0 && keyboard.clientWidth > 0) {
      const key = keys[last.midi], left = key.x * keyboard.clientWidth, right = (key.x+key.width) * keyboard.clientWidth, scrollLeft = scroller.scrollLeft || 0;
      if (left < scrollLeft) scroller.scrollLeft = Math.max(0,left-10);
      else if (right > scrollLeft+scroller.clientWidth) scroller.scrollLeft = right-scroller.clientWidth+10;
    }
    lastFollowed = signature; renderLabels();
  }
  function selectionChanged() {
    const requested = choices.get(select.value); select.value = choiceValue(currentChoice);
    if (requested) onSelection({...requested});
  }
  function testRequested() { onTest(!Boolean(model.test?.active)); }
  select.addEventListener('change',selectionChanged); toggle.addEventListener('click',testRequested);
  render({phase:'idle',choice:{mode:'all',id:null},devices:[],canTest:false,configuredRange:null,test:{active:false,held:[],last:null,range:null}});
  const unsubscribe = i18n.subscribe(() => render(model,true));
  return {render,destroy() {
    if (disposed) return; disposed = true; unsubscribe();
    select.removeEventListener('change',selectionChanged); toggle.removeEventListener('click',testRequested);
    for (const {node,parent,next} of original) if (parent) parent.insertBefore(node,next?.parentNode === parent ? next : null);
    section.remove();
  }};
}

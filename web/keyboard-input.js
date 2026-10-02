import {midiName} from './music.js';
import {stageShortcutAllowed} from './score-preview.js';
import {eventTimeEvidence} from './midi-messages.js';

/** Physical US-position labels, not characters reported by the current OS layout. */
const ROWS = [
  ['bottom', ['KeyZ','KeyX','KeyC','KeyV','KeyB','KeyN','KeyM','Comma','Period','Slash'], 'Z X C V B N M , . /'.split(' ')],
  ['home', ['KeyA','KeyS','KeyD','KeyF','KeyG','KeyH','KeyJ','KeyK','KeyL','Semicolon','Quote'], "A S D F G H J K L ; '".split(' ')],
  ['upper', ['KeyQ','KeyW','KeyE','KeyR','KeyT','KeyY','KeyU','KeyI','KeyO','KeyP','BracketLeft','BracketRight','Backslash'], 'Q W E R T Y U I O P [ ] \\'.split(' ')],
  ['number', ['Backquote','Digit1','Digit2','Digit3','Digit4','Digit5','Digit6','Digit7','Digit8','Digit9','Digit0','Minus','Equal'], '` 1 2 3 4 5 6 7 8 9 0 - ='.split(' ')],
];
const PHYSICAL_LABELS = new Map(ROWS.flatMap(([,codes,labels]) => codes.map((code,index) => [code,labels[index]])));
let nextOffset = 0;
let controllerSequence = 0;
export const DEFAULT_KEYBOARD_MAPPING = Object.freeze(ROWS.flatMap(([row,codes,labels]) => codes.map((code,index) => Object.freeze({code,offset:nextOffset++,label:labels[index],row}))));
export const LEGACY_KEYBOARD_MAPPING = Object.freeze(['KeyA','KeyW','KeyS','KeyE','KeyD','KeyF','KeyT','KeyG','KeyY','KeyH','KeyU','KeyJ','KeyK','KeyO','KeyL','KeyP','Semicolon'].map((code,offset) => Object.freeze({code,offset,label:PHYSICAL_LABELS.get(code),row:'piano'})));
export const KEYBOARD_TRANSPOSE_SHORTCUTS = Object.freeze({ArrowDown:-12,ArrowUp:12,ArrowLeft:-1,ArrowRight:1});
export const KEYBOARD_CONFIGURATION_LIMIT = 512;
export class KeyboardConfigurationError extends Error {
  constructor(code, message) { super(message); this.name = 'KeyboardConfigurationError'; this.code = code; }
}
const invalid = (code, message) => { throw new KeyboardConfigurationError(code,message); };
const RESERVED = new Set(Object.keys(KEYBOARD_TRANSPOSE_SHORTCUTS));
const CODE_PATTERN = /^(?:Key[A-Z]|Digit[0-9]|Backquote|Minus|Equal|BracketLeft|BracketRight|Backslash|Semicolon|Quote|Comma|Period|Slash|IntlBackslash|IntlRo|IntlYen|Numpad[0-9]|NumpadDecimal|NumpadAdd|NumpadSubtract|NumpadMultiply|NumpadDivide)$/;
const EDITABLE = 'input,textarea,select,a,summary,dialog,[contenteditable]:not([contenteditable="false"]),[role="textbox"],[role="searchbox"],[role="combobox"],[role="spinbutton"],[role="slider"],[role="listbox"],[role="tree"],[role="menu"],[data-keyboard-input="off"],#notice,#instrument-settings,#settings-dialog';
const INTERACTIVE = 'button,[role="button"],[role="checkbox"],[role="switch"],[role="radio"],[role="tab"],[role="option"],[role="menuitem"]';
const CONTROL = `${INTERACTIVE},[tabindex]`;
const PERFORMANCE = '[data-keyboard-performance],#keyboard,#fretboard';
const FREE_PERFORMANCE = '#free-practice-screen [data-keyboard-performance]';

function matches(target, selector) { return Boolean(target?.closest?.(selector)); }
/** Free practice captures only its explicit performance surfaces; other guards are shared with the stage. */
export function keyboardInputAllowed(event = {}, context = {}, {control = false} = {}) {
  const target = event.composedPath?.().find(node => node?.tagName) ?? event.target ?? context.target;
  if (context.hidden || context.settingsOpen || context.composing || event.isComposing || event.keyCode === 229 || ['Dead','Process','Unidentified'].includes(event.key)) return false;
  const freePerformance = context.screen === 'free' && matches(target,FREE_PERFORMANCE);
  if (context.screen === 'free' && !freePerformance) return false;
  if (!stageShortcutAllowed({...context,screen:freePerformance ? 'stage' : context.screen,target,defaultPrevented:event.defaultPrevented,repeat:event.repeat,ctrlKey:event.ctrlKey,metaKey:event.metaKey,altKey:event.altKey})) return false;
  if (matches(target,EDITABLE) || target?.isContentEditable) return false;
  const musicalButton = target?.closest?.('button[data-midi]');
  if (control) {
    if (matches(target,INTERACTIVE) || (matches(target,'[tabindex]') && !target?.matches?.('[data-keyboard-performance]'))) return false;
    return /^(BODY|HTML)$/.test(target?.tagName || '') || matches(target,PERFORMANCE);
  }
  return !matches(target,CONTROL) || Boolean(musicalButton && matches(musicalButton,PERFORMANCE)) || Boolean(target?.matches?.('[data-keyboard-performance]'));
}

export function validateKeyboardConfiguration({mapping = DEFAULT_KEYBOARD_MAPPING, baseMidi = 36, transpose = 0, allowDuplicatePitches = false} = {}) {
  if (!Array.isArray(mapping) || !mapping.length || mapping.length > 128) invalid('keyboard_mapping_size','Keyboard mapping must contain 1–128 bindings.');
  if (!Number.isInteger(baseMidi) || baseMidi < 0 || baseMidi > 127) invalid('keyboard_base_range','Keyboard base MIDI must be 0–127.');
  if (!Number.isInteger(transpose) || transpose < -127 || transpose > 127) invalid('keyboard_transpose_range','Keyboard input transpose must be an integer from −127 to +127.');
  if (typeof allowDuplicatePitches !== 'boolean') invalid('keyboard_duplicate_permission','Duplicate pitch permission must be explicit.');
  const codes = new Set(), offsets = new Set();
  const bindings = Array.from(mapping).map(binding => {
    if (!binding || typeof binding.code !== 'string' || RESERVED.has(binding.code) || !CODE_PATTERN.test(binding.code)) invalid('keyboard_code_reserved','Use a supported physical musical key code; navigation and system keys are reserved.');
    if (codes.has(binding.code)) invalid('keyboard_duplicate_code',`Duplicate physical key binding: ${binding.code}`);
    if (!Number.isInteger(binding.offset) || binding.offset < -127 || binding.offset > 127) invalid('keyboard_offset_range','Keyboard note offsets must be integers from −127 to +127.');
    if (offsets.has(binding.offset) && !allowDuplicatePitches) invalid('keyboard_duplicate_pitch','Duplicate pitches require allowDuplicatePitches: true.');
    codes.add(binding.code); offsets.add(binding.offset);
    const label = binding.label ?? PHYSICAL_LABELS.get(binding.code) ?? binding.code;
    const row = binding.row ?? 'custom';
    if (typeof label !== 'string' || !label.trim() || label.length > 24 || typeof row !== 'string' || !row.trim() || row.length > 24) invalid('keyboard_label_invalid','Keyboard labels and row names must be 1–24 characters.');
    return Object.freeze({code:binding.code,offset:binding.offset,label,row});
  });
  if (!bindings.some(binding => baseMidi + transpose + binding.offset >= 0 && baseMidi + transpose + binding.offset <= 127)) invalid('keyboard_no_playable_notes','At least one mapped note must remain inside MIDI 0–127.');
  return Object.freeze({mapping:Object.freeze(bindings),baseMidi,transpose,allowDuplicatePitches});
}

/**
 * Pure input ownership and mapping controller. It neither attaches DOM listeners nor
 * creates audio. The app keeps its existing pressNote/releaseNote/releaseMatching
 * adapters and InputEvidence; callbacks observe musical events only after gating.
 */
export function createKeyboardInput({pressNote = () => {}, releaseNote = () => {}, releaseMatching = () => {},
  getContext = () => ({}), onChange = () => {}, onConfiguration = () => {},
  now = () => performance.now(), timeOrigin = () => performance.timeOrigin,
  configuration = {}, configurationLimit = KEYBOARD_CONFIGURATION_LIMIT} = {}) {
  if (!Number.isInteger(configurationLimit) || configurationLimit < 1 || configurationLimit > KEYBOARD_CONFIGURATION_LIMIT) invalid('keyboard_history_limit','Invalid keyboard configuration history limit.');
  let config = validateKeyboardConfiguration(configuration), composing = false, serial = 0, omitted = 0, firstOmitted = null;
  const controllerId = ++controllerSequence;
  let contactSerial = 0;
  const held = new Map(), awaitingRelease = new Map(), shortcutHeld = new Set(), history = [];
  const context = () => { const current = getContext(); return {...current,composing:composing || current.composing}; };
  function snapshot() {
    const bindings = config.mapping.map(binding => {
      const requestedMidi = config.baseMidi + config.transpose + binding.offset;
      const enabled = requestedMidi >= 0 && requestedMidi <= 127;
      return {...binding,requestedMidi,midi:enabled ? requestedMidi : null,note:enabled ? midiName(requestedMidi) : null,enabled,held:held.has(binding.code)};
    });
    const pitches = [...new Set(bindings.filter(binding => binding.enabled).map(binding => binding.midi))].sort((a,b) => a-b);
    const rows = [...new Set(bindings.map(binding => binding.row))].map(row => {
      const keys = bindings.filter(binding => binding.row === row), playable = keys.filter(binding => binding.enabled);
      return {id:row,bindings:keys,range:playable.length ? {low:Math.min(...playable.map(key => key.midi)),high:Math.max(...playable.map(key => key.midi))} : null};
    });
    return {baseMidi:config.baseMidi,transpose:config.transpose,allowDuplicatePitches:config.allowDuplicatePitches,
      configurationId:serial,bindings,rows,range:{low:pitches[0],high:pitches.at(-1)},noteCount:pitches.length,
      keyCount:bindings.length,playableKeyCount:bindings.filter(binding => binding.enabled).length,
      disabledKeyCount:bindings.filter(binding => !binding.enabled).length,
      held:[...held.values()].map(value => ({...value})),shortcuts:{...KEYBOARD_TRANSPOSE_SHORTCUTS},
      pitchAliases:pitches.flatMap(midi => { const codes = bindings.filter(key => key.midi === midi).map(key => key.code); return codes.length > 1 ? [{midi,codes}] : []; }),
      labelBasis:'physical US key positions; actual printed labels may differ',
      rollover:'Hardware rollover is unknown; missing browser events cannot identify keyboard ghosting.'};
  }
  const emit = () => onChange(snapshot());
  function recordConfiguration(reason, eventTime) {
    const time = eventTimeEvidence(eventTime,{now:now(),timeOrigin:timeOrigin()});
    const event = Object.freeze({configuration_id:++serial,kind:'keyboard_configuration',reason,
      event_wall_ms:time.eventWall,received_wall_ms:time.receivedWall,timestamp_basis:time.timestampBasis,
      raw_timestamp_ms:time.rawTimestamp,base_midi:config.baseMidi,transpose_semitones:config.transpose,
      scope:'performance_input_only',duplicate_pitch_policy:config.allowDuplicatePitches ? 'explicit_aliases' : 'reject',
      mapping:config.mapping});
    if (history.length < configurationLimit) history.push(event);
    else { omitted++; if (firstOmitted === null) firstOmitted = time.receivedWall; }
    onConfiguration(event);
  }
  function releaseAll(reason = 'keyboard_cleanup', eventTime = now()) {
    const count = held.size;
    for (const [code,owned] of held) awaitingRelease.set(code,owned);
    held.clear(); shortcutHeld.clear();
    if (count) releaseMatching('key:',eventTime,{reason,inputKind:'typing_keyboard'});
    if (count) emit();
    return count;
  }
  function configure(next = {}, {reason = 'keyboard_configuration_changed', eventTime = now()} = {}) {
    const checked = validateKeyboardConfiguration({...config,...next});
    if (JSON.stringify(checked) === JSON.stringify(config)) return false;
    // Validation precedes cleanup: an invalid setting never silences current input.
    releaseAll(reason,eventTime); config = checked;
    recordConfiguration(reason,eventTime); emit(); return true;
  }
  function transposeBy(semitones, eventTime = now()) {
    if (!Number.isInteger(semitones)) invalid('keyboard_transpose_integer','Transpose step must be an integer.');
    return configure({transpose:config.transpose + semitones},{reason:'keyboard_input_transpose',eventTime});
  }
  function keydown(event) {
    if (event.isComposing || event.keyCode === 229) { releaseAll('keyboard_composition',event.timeStamp); return false; }
    if (composing || event.repeat || held.has(event.code)) return false;
    if (Object.hasOwn(KEYBOARD_TRANSPOSE_SHORTCUTS,event.code)) {
      if (shortcutHeld.has(event.code) || event.shiftKey || !keyboardInputAllowed(event,context(),{control:true})) return false;
      event.preventDefault?.();
      try { transposeBy(KEYBOARD_TRANSPOSE_SHORTCUTS[event.code],event.timeStamp); }
      catch (error) { if (!['keyboard_no_playable_notes','keyboard_transpose_range'].includes(error.code)) throw error; }
      shortcutHeld.add(event.code); return true;
    }
    if (!keyboardInputAllowed(event,context())) return false;
    const binding = config.mapping.find(item => item.code === event.code);
    if (!binding) return false;
    const midi = config.baseMidi + config.transpose + binding.offset;
    if (midi < 0 || midi > 127) return false;
    event.preventDefault?.();
    const owned = Object.freeze({code:event.code,source:`key:keyboard-${controllerId}:${++contactSerial}:${event.code}`,midi,configurationId:serial});
    // A fresh non-repeat keydown after blur is a new contact, even if the
    // previous physical keyup happened outside this document. No off is invented.
    awaitingRelease.delete(event.code); held.set(event.code,owned);
    pressNote(owned.source,midi,90,event.timeStamp,{inputKind:'typing_keyboard',encoding:'key_down'});
    emit(); return true;
  }
  function keyup(event) {
    shortcutHeld.delete(event.code);
    const owned = held.get(event.code) ?? awaitingRelease.get(event.code);
    if (!owned) return false;
    // Release ownership survives focus, modifier, layout and mapping changes.
    held.delete(event.code); awaitingRelease.delete(event.code);
    releaseNote(owned.source,event.timeStamp,{inputKind:'typing_keyboard',encoding:'key_up'});
    emit(); return true;
  }
  function compositionStart(event = {}) { composing = true; return releaseAll('keyboard_composition',event.timeStamp); }
  function compositionEnd() { composing = false; }
  function contextChanged(reason = 'keyboard_context_changed', eventTime = now()) {
    return releaseAll(reason,eventTime);
  }
  function exportConfigurationData() {
    return {version:1,scope:'PC keyboard performance input configuration; score pitches are unchanged',
      event_order:'receipt_order',label_basis:'physical US key positions',initial_configuration:history[0],
      current_configuration:{configuration_id:serial,base_midi:config.baseMidi,transpose_semitones:config.transpose,
        duplicate_pitch_policy:config.allowDuplicatePitches ? 'explicit_aliases' : 'reject',mapping:config.mapping},
      events:[...history],limit:configurationLimit,truncated:omitted > 0,omitted_configurations:omitted,
      first_omitted_received_wall_ms:firstOmitted,hardware_rollover:'unknown; not detected'};
  }
  recordConfiguration('keyboard_initial_configuration',now());
  return {keydown,keyup,configure,transposeBy,releaseAll,contextChanged,compositionStart,compositionEnd,snapshot,exportConfigurationData};
}

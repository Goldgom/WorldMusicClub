import {DEFAULT_KEYBOARD_MAPPING, LEGACY_KEYBOARD_MAPPING} from './keyboard-input.js';
import {midiName} from './music.js';

/** Display-only controls: configuration never changes the score or starts audio. */
export function setupKeyboardInputView({document, controller, i18n, getVisualRange = () => null, onConfigure = () => {}}) {
  const $ = id => document.getElementById(id);
  const element = (tag, id, className) => { const node = document.createElement(tag); if (id) node.id = id; if (className) node.className = className; return node; };
  const textNodes = [];
  const accessibleLabels = [];
  const localized = (tag, id, key, className) => { const node = element(tag,id,className); textNodes.push([node,key]); return node; };
  const button = (id, key) => { const node = localized('button',id,key,'button secondary compact'); node.type = 'button'; return node; };
  const transposeButton = (id, key, step) => { const node = element('button',id,'button secondary compact'); node.type = 'button'; node.textContent = step > 0 ? `+${step}` : `−${-step}`; accessibleLabels.push([node,key]); return node; };
  const labeled = (id, key, input) => { const label = element('label',id); label.append(localized('span',null,key),input); return label; };
  const panel = element('section','keyboard-input-settings','keyboard-input-settings');
  panel.dataset.keyboardInput = 'off'; panel.setAttribute('aria-labelledby','keyboard-input-title');
  panel.append(localized('h3','keyboard-input-title','keyboard.title'),localized('p',null,'keyboard.inputOnly'));
  const fields = element('div',null,'keyboard-input-fields');
  const preset = element('select','keyboard-preset');
  for (const [value,key] of [['wide','keyboard.presetWide'],['legacy','keyboard.presetLegacy'],['custom','keyboard.presetCustom']]) { const option = localized('option',null,key); option.value = value; preset.append(option); }
  const base = element('input','keyboard-base-midi'); base.type = 'number'; base.min = '0'; base.max = '127'; base.step = '1';
  const offset = element('input','keyboard-input-offset'); offset.type = 'number'; offset.min = '-127'; offset.max = '127'; offset.step = '1';
  fields.append(labeled(null,'keyboard.preset',preset),labeled(null,'keyboard.baseMidi',base),labeled(null,'keyboard.offsetLabel',offset),button('keyboard-settings-apply','keyboard.apply'));
  const baseNote = element('p','keyboard-base-note');
  const error = element('p','keyboard-configuration-error','warning'); error.hidden = true; error.setAttribute('role','status');
  const editorDetails = element('details','keyboard-mapping-details'); editorDetails.append(localized('summary',null,'keyboard.configure'));
  const editor = element('textarea','keyboard-mapping-editor'); editor.rows = 12; editor.maxLength = 50000; editor.spellcheck = false; editor.setAttribute('aria-describedby','keyboard-mapping-help');
  const aliases = element('input','keyboard-allow-aliases'); aliases.type = 'checkbox';
  editorDetails.append(labeled(null,'keyboard.editor',editor),localized('p','keyboard-mapping-help','keyboard.editorHelp'),labeled(null,'keyboard.aliases',aliases));
  const editorActions = element('div',null,'keyboard-input-actions'); editorActions.append(button('keyboard-mapping-apply','keyboard.mappingApply'),button('keyboard-mapping-reset','keyboard.mappingReset')); editorDetails.append(editorActions);
  panel.append(fields,baseNote,error,editorDetails,localized('p',null,'keyboard.rangeHelp'),localized('p',null,'keyboard.positionHelp'),localized('p',null,'keyboard.rollover'));
  const host = document.querySelector('#settings-dialog .shell-dialog-content') || $('instrument-settings')?.parentElement;
  host?.append(panel);
  const footer = document.querySelector('.keyboard-footer') || element('div',null,'keyboard-footer');
  if (!footer.parentElement) $('keyboard')?.parentElement?.append(footer);
  footer.replaceChildren(); footer.classList.add('keyboard-input-footer');
  const status = element('div',null,'keyboard-input-status');
  const range = element('strong','keyboard-active-range'); range.setAttribute('role','status');
  const counts = element('span','keyboard-key-counts'); const currentOffset = element('output','keyboard-current-offset'); const visualRange = element('span','keyboard-visual-range');
  status.append(range,currentOffset);
  const actions = element('div',null,'keyboard-input-actions keyboard-transpose-actions'); actions.dataset.keyboardInput = 'off';
  for (const [id,key,step] of [['keyboard-octave-down','keyboard.octaveDown',-12],['keyboard-semitone-down','keyboard.transposeDown',-1],['keyboard-semitone-up','keyboard.transposeUp',1],['keyboard-octave-up','keyboard.octaveUp',12]]) {
    const control = transposeButton(id,key,step); control.addEventListener('click',event=>apply(()=>controller.transposeBy(step,event.timeStamp))); actions.append(control);
  }
  const mapDetails = element('details','keyboard-performance-details','keyboard-performance-details');
  mapDetails.append(localized('summary','keyboard-map-label','keyboard.map'));
  const mapStatus = element('div',null,'keyboard-map-status'); mapStatus.append(counts,visualRange);
  const mapActions = element('div',null,'keyboard-input-actions'); mapActions.dataset.keyboardInput = 'off';
  const reset = button('keyboard-offset-reset','keyboard.resetOffset'); reset.addEventListener('click',event=>apply(()=>controller.configure({transpose:0},{reason:'keyboard_input_reset',eventTime:event.timeStamp}))); mapActions.append(reset);
  const openKeyboardSettings = () => { onConfigure(); panel.scrollIntoView?.({block:'start'}); };
  const configure = button('keyboard-open-settings','keyboard.configure'); configure.addEventListener('click',openKeyboardSettings); mapActions.append(configure);
  const map = element('div','keyboard-map','keyboard-map'); map.setAttribute('role','list'); map.setAttribute('aria-labelledby','keyboard-map-label');
  const limit = localized('p','keyboard-configuration-limit','keyboard.historyLimit','warning'); limit.hidden = true;
  mapDetails.append(mapStatus,localized('p','keyboard-input-shortcuts','keyboard.shortcuts'),map,mapActions);
  footer.append(status,actions,mapDetails,limit);
  // Short landscape and narrow portrait cannot afford a second permanent toolbar: it
  // takes space from the falling notes and the complete first guitar row. Keep
  // the same controls in Settings there, with an anchor for their stage home.
  // Moving existing nodes retains their handlers, disclosure state and map.
  const footerHome = document.createComment('Keyboard input stage position');
  footer.before(footerHome);
  const subtitle = $('stage-subtitle'), stageMeta = subtitle ? element('div',null,'keyboard-stage-meta') : null;
  const compactStatus = element('button','keyboard-compact-status','keyboard-compact-status'); compactStatus.type = 'button'; compactStatus.hidden = true;
  compactStatus.setAttribute('aria-controls','settings-dialog'); compactStatus.setAttribute('aria-haspopup','dialog'); compactStatus.dataset.keyboardInput = 'off';
  compactStatus.addEventListener('click',openKeyboardSettings);
  if (stageMeta) { subtitle.replaceWith(stageMeta); stageMeta.append(subtitle,compactStatus); }
  const shortLandscape = document.defaultView?.matchMedia?.('(max-height:600px) and (min-width:651px), (max-width:650px)');
  let activeScreen=document.body?.dataset.screen||'stage';
  function arrangeFooter() {
    const compact = Boolean(shortLandscape?.matches && host && stageMeta);
    const freeStage=activeScreen==='free'?$('free-piano-stage'):null;
    const badgeHost=compact&&freeStage?$('free-practice-title')?.parentElement:stageMeta;
    compactStatus.hidden = !compact;
    if(badgeHost&&compactStatus.parentElement!==badgeHost)badgeHost.append(compactStatus);
    if (compact) {
      if (footer.parentElement !== panel) panel.insertBefore(footer,fields);
    } else if(freeStage?.parentNode){
      if(footer.previousSibling!==freeStage)freeStage.after(footer);
    } else if (footerHome.parentNode && footer.previousSibling !== footerHome) footerHome.after(footer);
  }
  // Screen ownership and release boundaries stay in the app. Reparenting this
  // one view preserves all IDs, mapping nodes, handlers and disclosure state.
  function setScreen(screen){activeScreen=screen;arrangeFooter();refreshRange();}
  shortLandscape?.addEventListener('change',arrangeFooter); arrangeFooter();
  let snapshot = controller.snapshot(), lastConfiguration = null, issue = null, editorDirty = false;
  const signature = mapping => JSON.stringify(mapping.map(({code,offset,label,row})=>({code,offset,label,row})));
  const presetValue = current => signature(current.bindings) === signature(DEFAULT_KEYBOARD_MAPPING) ? 'wide' : signature(current.bindings) === signature(LEGACY_KEYBOARD_MAPPING) ? 'legacy' : 'custom';
  const editorValue = () => JSON.stringify(snapshot.bindings.map(({code,offset,label,row})=>({code,offset,label,row})),null,2);
  function showError(value) { issue = value; error.hidden = !value; error.textContent = !value ? '' : value === 'mapping_json' ? i18n.t('keyboard.mappingJsonError') : i18n.message(value); }
  function apply(change) { try { change(); showError(null); render(controller.snapshot()); } catch (caught) { showError(caught.code || 'keyboard_invalid_settings'); } }
  preset.addEventListener('change',event=> {
    if (preset.value === 'custom') { editorDetails.open = true; editor.focus(); return; }
    const legacy = preset.value === 'legacy';
    apply(()=>controller.configure({mapping:legacy ? LEGACY_KEYBOARD_MAPPING : DEFAULT_KEYBOARD_MAPPING,baseMidi:legacy ? 60 : 36,transpose:0,allowDuplicatePitches:false},{reason:'keyboard_preset_changed',eventTime:event.timeStamp}));
  });
  $('keyboard-settings-apply').addEventListener('click',event=>apply(()=>controller.configure({baseMidi:base.value.trim() ? Number(base.value) : NaN,transpose:offset.value.trim() ? Number(offset.value) : NaN},{reason:'keyboard_settings_changed',eventTime:event.timeStamp})));
  editor.addEventListener('input',()=>{editorDirty = true;}); aliases.addEventListener('change',()=>{editorDirty = true;});
  $('keyboard-mapping-reset').addEventListener('click',()=>{editorDirty = false; editor.value = editorValue(); aliases.checked = snapshot.allowDuplicatePitches; showError(null);});
  $('keyboard-mapping-apply').addEventListener('click',event=> {
    let mapping; try { mapping = JSON.parse(editor.value); } catch { showError('mapping_json'); return; }
    apply(()=>{controller.configure({mapping,allowDuplicatePitches:aliases.checked},{reason:'keyboard_mapping_changed',eventTime:event.timeStamp});editorDirty=false;editor.value=editorValue();});
  });
  function refreshRange() {
    const displayed = getVisualRange(); visualRange.hidden = !displayed;
    visualRange.textContent = displayed ? i18n.t('keyboard.visualRange',{low:midiName(displayed.low),high:midiName(displayed.high)}) : '';
    const labels = new Map(); for (const binding of snapshot.bindings) if (binding.enabled) { const list = labels.get(binding.midi) || []; list.push(binding.label); labels.set(binding.midi,list); }
    for (const key of document.querySelectorAll('#keyboard [data-midi]')) {
      const matches = labels.get(Number(key.dataset.midi)) || [];
      const shortcut = key.querySelector('.key-shortcut'); if (shortcut) shortcut.textContent = matches.join(' / ');
      key.dataset.keyboardLabels = JSON.stringify(matches);
    }
  }
  function render(next = controller.snapshot()) {
    snapshot = next;
    for (const [node,key] of textNodes) node.textContent = i18n.t(key);
    for (const [node,key] of accessibleLabels) { node.setAttribute('aria-label',i18n.t(key)); node.title = i18n.t(key); }
    range.textContent = `${midiName(next.range.low)}–${midiName(next.range.high)}`;
    range.title = i18n.t('keyboard.span',{low:midiName(next.range.low),high:midiName(next.range.high)}); range.setAttribute('aria-label',range.title);
    range.dataset.lowMidi = String(next.range.low); range.dataset.highMidi = String(next.range.high);
    counts.textContent = i18n.t('keyboard.counts',{playable:next.playableKeyCount,total:next.keyCount,disabled:next.disabledKeyCount});
    currentOffset.textContent = next.transpose >= 0 ? `+${next.transpose}` : `−${-next.transpose}`;
    currentOffset.title = i18n.t('keyboard.offset',{semitones:next.transpose}); currentOffset.setAttribute('aria-label',currentOffset.title);
    compactStatus.textContent = `⌨ ${range.textContent} ${currentOffset.textContent}`;
    compactStatus.title = [i18n.t('keyboard.title'),range.title,currentOffset.title,i18n.t('keyboard.configure')].join(' · ');
    compactStatus.setAttribute('aria-label',compactStatus.title);
    baseNote.textContent = i18n.t('keyboard.baseNote',{note:midiName(next.baseMidi)});
    if (lastConfiguration !== next.configurationId) {
      base.value = String(next.baseMidi); offset.value = String(next.transpose); preset.value = presetValue(next);
      if (!editorDirty) {editor.value = editorValue();aliases.checked = next.allowDuplicatePitches;}
      lastConfiguration = next.configurationId;
    }
    // Reuse map nodes while notes are held so focus/scroll never changes on input.
    if (map.dataset.configurationId !== String(next.configurationId)) {
      map.replaceChildren(); map.dataset.configurationId = String(next.configurationId);
      for (const row of next.rows) {
        const rowElement = element('div',null,'keyboard-map-row'); rowElement.dataset.row = row.id;
        for (const binding of row.bindings) {
          const cell = element('span',null,'keyboard-map-key'); cell.setAttribute('role','listitem'); cell.dataset.code = binding.code; cell.dataset.noteMidi = binding.enabled ? String(binding.midi) : ''; cell.dataset.enabled = String(binding.enabled);
          const label = element('kbd'); label.textContent = binding.label; const note = element('small'); note.textContent = binding.note || i18n.t('keyboard.disabled'); cell.append(label,note); rowElement.append(cell);
        }
        map.append(rowElement);
      }
    }
    for (const binding of next.bindings) { const cell = map.querySelector(`[data-code="${binding.code}"]`); cell?.classList.toggle('held',binding.held); if (cell && !binding.enabled) cell.querySelector('small').textContent=i18n.t('keyboard.disabled'); }
    limit.hidden = !controller.exportConfigurationData().truncated;
    showError(issue); refreshRange();
  }
  const unsubscribe = i18n.subscribe?.(()=>render()); render(snapshot);
  return {render,refreshRange,setScreen,destroy(){unsubscribe?.();shortLandscape?.removeEventListener('change',arrangeFooter);if(footerHome.parentNode)footerHome.replaceWith(footer);compactStatus.remove();if(stageMeta?.parentNode)stageMeta.replaceWith(subtitle);panel.remove();footer.replaceChildren();}};
}

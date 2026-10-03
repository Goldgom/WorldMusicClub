import {getAppI18n} from './app-locale.js';
import {midiName,keyboardGeometry} from './music.js';
import {mountPianoStage,createPianoToolbar,renderPianoKeybed,renderPianoRails,pianoMinimumWidth} from './piano-stage-view.js';
import {PERFORMANCE_LIBRARY_LIMITS, describePerformance} from './performance-library.js';

/** Separate accessible screen. Global MIDI/PC ownership and normalized clocks belong to the app. */
export function setupFreePracticeView({document,session,preview=null,i18n=getAppI18n(document),host=document.body,
  onExit=()=>{},onConnectMidi=()=>{},onConfigureKeyboard=()=>{},onSoundChange=()=>{},
  getSoundEnabled=()=>false,getPianoRange=()=>({keyCount:61,lowestMidi:null}),getConfiguration=()=>({}),onInput=()=>{},
  download=(text,filename)=>{
    const url=URL.createObjectURL(new Blob([text],{type:'application/json'}));
    const link=document.createElement('a');link.href=url;link.download=filename;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }}={}) {
  const elements={},translations=[],summaryTexts=[],contacts=new Map();let contactSerial=0,busy=false,composing=false,issue=null,notice=null,lastList='',lastDetail='',lastComparison='',lastKeyboard='',keyboardBindings=[],heldNotes=[];
  const el=(tag,id,className)=>{const node=document.createElement(tag);if(id){node.id=id;elements[id]=node;}if(className)node.className=className;return node;};
  const text=(tag,id,key,className)=>{const node=el(tag,id,className);translations.push([node,key]);return node;};
  const button=(id,key,action)=>{const node=text('button',id,key,'button secondary');node.type='button';if(action)node.addEventListener('click',action);return node;};
  const label=(key,input)=>{const node=el('label');node.append(text('span',null,key),input);return node;};
  const screen=el('section','free-practice-screen','free-practice-screen free-piano-workspace piano-workspace');screen.hidden=true;screen.setAttribute('aria-labelledby','free-practice-title');
  const heading=el('div',null,'free-practice-heading piano-workspace-heading');const title=text('h1','free-practice-title','free.title');title.tabIndex=-1;title.dataset.keyboardPerformance='';
  const headingText=el('div',null,'stage-heading');headingText.append(title);heading.append(button('free-exit','free.exit',()=>{leave();onExit();}),headingText);screen.append(heading);
  const controls=el('div',null,'free-practice-actions');controls.dataset.keyboardInput='off';
  controls.append(button('free-start','free.start',()=>run(()=>{preview?.stop();clearContacts('free_start');session.start({configuration:getConfiguration()});})),
    button('free-pause','common.pause',()=>run(()=>session.pause())),button('free-resume','common.resume',()=>run(()=>session.resume())),button('free-stop','free.stop',()=>run(()=>session.stop())));
  const state=el('strong','free-state');state.setAttribute('role','status');state.setAttribute('aria-live','polite');
  const count=el('span','free-event-count');const full=text('p','free-capture-full','free.captureFull','warning');full.hidden=true;full.setAttribute('role','status');
  screen.append(controls,state,count,full);
  const modePanel=el('div',null,'free-performance-panel free-input-section');
  const inputSection=el('section','free-piano-stage','free-stage');inputSection.setAttribute('aria-labelledby','free-input-title');
  const inputActions=el('div',null,'free-practice-actions');inputActions.dataset.keyboardInput='off';
  inputActions.append(button('free-connect-midi','free.connectMidi',()=>boundaryAction(onConnectMidi)),button('free-keyboard-settings','keyboard.configure',()=>boundaryAction(onConfigureKeyboard)),button('free-sound','settings.soundOff',()=>{try{const enabled=!getSoundEnabled();if(!enabled)preview?.stop('muted');onSoundChange(enabled);render();}catch(error){report(error);}}));
  const keys=el('div','free-practice-keys','free-practice-keys');keys.dataset.keyboardPerformance='';keys.setAttribute('role','group');keys.setAttribute('aria-labelledby','free-input-title');
  const mappingStatus=el('p','free-mapping-status');
  const stageHeader=createPianoToolbar({document,title:text('h2','free-input-title','free.pianoTitle'),actions:inputActions});stageHeader.classList.add('free-stage-header');
  const keyboardScroll=el('div','free-keyboard-scroll','free-keyboard-scroll');keyboardScroll.tabIndex=0;keyboardScroll.dataset.keyboardPerformance='';keyboardScroll.setAttribute('aria-labelledby','free-input-title');
  const pianoSurface=el('div',null,'free-piano-surface');
  const liveField=el('div','free-live-field','free-live-field');liveField.setAttribute('aria-hidden','true');
  const rails=el('div','free-piano-rails','free-piano-rails piano-rails-shared'),liveCopy=el('div',null,'free-live-copy');
  const liveCaption=text('span',null,'free.stageCaption'),liveNotes=el('strong','free-live-notes'),liveHint=text('span',null,'free.stageHint');
  liveCopy.append(liveCaption,liveNotes,liveHint);liveCopy.setAttribute('aria-hidden','true');liveField.append(rails);
  const keybed=el('div',null,'free-keybed-wrap');keybed.append(keys);pianoSurface.append(liveField,keybed);keyboardScroll.append(pianoSurface);
  mountPianoStage({document,stage:inputSection,scroll:keyboardScroll,surface:pianoSurface,keyboard:keys,lane:liveField});
  const stageFooter=el('div',null,'free-stage-footer');const inputHelp=el('details','free-input-help','free-input-help');inputHelp.dataset.keyboardInput='off';
  inputHelp.append(text('summary',null,'free.inputGuide'),mappingStatus,text('p',null,'free.inputHelp'),text('p',null,'free.defaultVelocity'),text('p',null,'keyboard.rollover'),text('p',null,'free.noAudioCapture'));
  stageFooter.append(text('span',null,'free.scrollHint','free-scroll-hint'),inputHelp);inputSection.append(stageHeader,keyboardScroll,liveCopy);
  modePanel.append(inputSection,stageFooter);screen.append(modePanel);
  const recordings=el('details','free-recordings','free-recordings');recordings.dataset.keyboardInput='off';recordings.append(text('summary','free-recordings-toggle','free.recordings'));
  const savePanel=el('section','free-save-panel','free-save-panel');savePanel.dataset.keyboardInput='off';
  const name=el('input','free-record-label');name.type='text';name.maxLength=200;name.autocomplete='off';
  const saveState=el('p','free-save-status');saveState.setAttribute('role','status');
  const saveActions=el('div',null,'free-practice-actions');saveActions.append(button('free-save','common.save',()=>run(()=>session.save({label:name.value}))),button('free-export-draft','free.exportDraft',()=>run(()=>download(session.exportDraft(),'worldmusichub-free-performance.json'))));
  const discard=el('input','free-discard-confirm');discard.type='checkbox';discard.addEventListener('change',()=>render());
  const discardAction=button('free-discard','free.discard',()=>run(()=>{session.discardDraft();discard.checked=false;render();}));
  const saveInfo=el('details',null,'free-save-info');saveInfo.append(text('summary',null,'free.recordOptions'),text('p',null,'free.saveHelp'),label('free.discardConfirm',discard),discardAction,text('p',null,'free.localStorageNote'));
  savePanel.append(label('free.titleLabel',name),saveActions,saveState,saveInfo);recordings.append(savePanel);
  const library=el('section','free-performance-library','free-performance-library');library.dataset.keyboardInput='off';library.setAttribute('aria-labelledby','free-library-title');
  const records=el('select','free-record-select');records.addEventListener('change',()=>render());
  const libraryActions=el('div',null,'free-practice-actions');libraryActions.append(button('free-refresh','free.refresh',()=>run(()=>session.refresh())),button('free-load','free.load',()=>run(async()=>{preview?.stop();await session.load(records.value);notice='free.loaded';})),button('free-export-record','common.export',()=>run(async()=>download(await session.exportRecord(),'worldmusichub-free-performance.json'))),button('free-export-backup','free.exportBackup',()=>run(async()=>download(await session.exportBackup(),'worldmusichub-performance-backup.json'))));
  const file=el('input','free-import-file');file.type='file';file.accept='.json,application/json';
  const importActions=el('div',null,'free-practice-actions');importActions.append(button('free-import-record','free.importRecord',()=>run(()=>importFile(false))),button('free-restore-backup','free.restoreBackup',()=>run(()=>importFile(true))));
  const recordCount=el('p','free-record-count');
  library.append(text('h2','free-library-title','free.libraryTitle'),recordCount,label('free.recordSelect',records),libraryActions,label('free.importFile',file),importActions);recordings.append(library);
  const detail=el('section','free-performance-detail','free-performance-detail');detail.setAttribute('aria-labelledby','free-summary-title');
  const summary=el('div','free-summary');detail.append(text('h2','free-summary-title','free.summaryTitle'),summary);
  const previewControls=el('div',null,'free-practice-actions');previewControls.dataset.keyboardInput='off';
  const timbre=el('select','free-preview-timbre');for(const value of ['piano','guitar']){const option=text('option',null,`free.timbre.${value}`);option.value=value;timbre.append(option);}timbre.addEventListener('change',()=>{preview?.stop();render();});
  previewControls.append(label('free.previewTimbre',timbre),button('free-preview','free.preview',()=>{try{preview?.start(session.selectedRecord(),{instrument:timbre.value}).catch(report);}catch(error){report(error);}}),button('free-preview-stop','free.previewStop',()=>preview?.stop()));
  const previewState=el('p','free-preview-status');previewState.setAttribute('role','status');
  const replayHelp=el('details',null,'free-replay-help');replayHelp.append(text('summary',null,'free.previewGuide'),text('p',null,'free.previewHelp'));
  detail.append(previewControls,previewState,replayHelp,button('free-choose-baseline','free.baseline',()=>run(()=>session.chooseBaseline())));recordings.append(detail);
  const comparison=el('section','free-comparison','free-comparison');comparison.setAttribute('aria-labelledby','free-comparison-title');
  const comparisonBody=el('div','free-comparison-body','free-comparison-columns');comparison.append(text('h2','free-comparison-title','free.compareTitle'),text('p',null,'free.compareHelp'),comparisonBody);recordings.append(comparison);screen.append(recordings);
  const status=el('p','free-operation-status');status.setAttribute('role','status');status.setAttribute('aria-live','polite');screen.append(status);host.append(screen);

  function report(error){issue=error?.code || 'free.operation_failed';notice=null;render();}
  function errorKey(code){
    if(code?.startsWith('free.configuration') || ['free.invalid_configuration','free.keyboard_configuration_required'].includes(code))return 'free.error.configuration';
    if(code==='performance.refresh_failed')return 'free.error.refresh';
    if(code==='free.file_required')return 'free.fileRequired';if(code==='free.file_too_large')return 'free.fileTooLarge';
    if(['performance.invalid_record','performance.unsupported_version','performance.invalid_json','performance.invalid_backup'].includes(code))return 'free.error.invalidRecord';
    if(['performance.record_limit','performance.total_bytes'].includes(code))return 'free.error.recordLimit';
    if(code?.startsWith('performance.'))return 'free.error.storage';return 'free.operationFailed';
  }
  async function run(action){if(busy)return;busy=true;issue=null;notice=null;render();try{await action();}catch(error){report(error);}finally{busy=false;render();}}
  async function importFile(backup){
    const selectedFile=file.files?.[0];if(!selectedFile)throw Object.assign(new Error(),{code:'free.file_required'});
    const max=backup?PERFORMANCE_LIBRARY_LIMITS.backupBytes:PERFORMANCE_LIBRARY_LIMITS.recordBytes;
    if(selectedFile.size>max)throw Object.assign(new Error(),{code:'free.file_too_large'});
    const content=await selectedFile.text();preview?.stop();const result=backup?await session.restoreBackup(content):await session.importRecord(content);
    notice={key:'free.imported',params:{count:backup?result.length:1}};file.value='';
  }
  function boundaryAction(action){run(()=>{interrupt('free_panel');action();});}
  function clearContacts(reason){
    for(const contact of contacts.values())onInput('cleanup',{...contact,reason,eventTime:undefined});contacts.clear();
  }
  function interrupt(reason='free_focus_loss'){
    clearContacts(reason);preview?.stop();if(session.snapshot().state==='recording'){session.pause(undefined,reason);notice='free.boundaryPause';render();}
  }
  function leave(){interrupt('free_leave');session.leave();screen.hidden=true;}
  function enter(){session.enter();screen.hidden=false;render();title.focus();return session.refresh().catch(report);}
  function permitted(event){return !screen.hidden && !document.hidden && !busy && !['preparing','playing'].includes(preview?.snapshot().status) && !document.querySelector('dialog[open]') && !composing && event.keyCode!==229 && !event.ctrlKey && !event.metaKey && !event.altKey && !event.isComposing;}
  function press(slot,target,event,inputKind,encoding){
    if(!target || target.disabled || contacts.has(slot) || !permitted(event))return false;
    const contact={source:`free-input:${++contactSerial}:${slot}`,midi:Number(target.dataset.midi),velocity:90,inputKind,owner:session.owner(),liveOwner:session.liveOwner()};
    contacts.set(slot,contact);event.preventDefault();onInput('note_on',{...contact,eventTime:event.timeStamp,encoding});return true;
  }
  function release(slot,event,synthetic=false){const contact=contacts.get(slot);if(!contact)return;contacts.delete(slot);onInput(synthetic?'cleanup':'note_off',{...contact,eventTime:event.timeStamp,encoding:contact.inputKind==='on_screen_pointer'?'pointer_up':'key_up',reason:synthetic?'free_input_cancel':undefined});}
  keys.addEventListener('pointerdown',event=>{const target=event.target.closest('button[data-midi]');if(event.button!==undefined && event.button!==0)return;if(press(`pointer:${event.pointerId}`,target,event,'on_screen_pointer','pointer_down')){try{target.setPointerCapture(event.pointerId);}catch{/* Capture may be unavailable for synthetic or expired events. */}}});
  keys.addEventListener('pointerup',event=>release(`pointer:${event.pointerId}`,event));
  for(const type of ['pointercancel','lostpointercapture'])keys.addEventListener(type,event=>release(`pointer:${event.pointerId}`,event,true));
  keys.addEventListener('keydown',event=>{if(['Enter',' '].includes(event.key) && !event.repeat){event.stopPropagation();press('accessible',event.target.closest('button[data-midi]'),event,'on_screen_keyboard','key_down');}});
  keys.addEventListener('keyup',event=>{if(['Enter',' '].includes(event.key)){event.stopPropagation();release('accessible',event);}});
  keys.addEventListener('focusout',event=>release('accessible',event,true));
  const onBlur=()=>{composing=false;if(!screen.hidden)interrupt('free_focus_loss');};
  const compositionStart=()=>{composing=true;if(!screen.hidden)clearContacts('free_composition');},compositionEnd=()=>{composing=false;};
  document.addEventListener('compositionstart',compositionStart);document.addEventListener('compositionend',compositionEnd);
  const onVisibility=()=>{if(document.hidden)onBlur();};
  document.defaultView?.addEventListener('blur',onBlur);document.defaultView?.addEventListener('pagehide',onBlur);document.addEventListener('visibilitychange',onVisibility);

  function setKeyboard(next){
    const signature=JSON.stringify(next ? [getPianoRange(),next.configurationId,next.bindings.map(({code,midi,label,enabled})=>({code,midi,label,enabled}))] : null);
    if(signature===lastKeyboard)return;lastKeyboard=signature;
    clearContacts('free_keyboard_change');keys.replaceChildren();rails.replaceChildren();
    keyboardBindings=(next?.bindings ?? []).filter(binding=>binding.enabled&&Number.isInteger(binding.midi)&&binding.midi>=0&&binding.midi<=127);
    const range=getPianoRange(),geometry=keyboardGeometry(range.keyCount,range.lowestMidi);
    pianoSurface.style.minWidth=`${pianoMinimumWidth(geometry)}px`;
    renderPianoKeybed({document,keyboard:keys,geometry,bindings:keyboardBindings,labelForNote:note=>i18n.t('stage.pianoKey',{note:midiName(note)}),decorateKey:key=>key.classList.add('free-practice-key')});
    renderPianoRails({document,rails,geometry});
    renderKeyLabels();setHeldNotes(heldNotes);
  }
  function renderKeyLabels(){
    const pitches=keyboardBindings.map(binding=>binding.midi);
    mappingStatus.textContent=pitches.length?i18n.t('free.mappingStatus',{low:midiName(Math.min(...pitches)),high:midiName(Math.max(...pitches)),count:pitches.length}):i18n.t('free.screenOnly');
    for(const key of keys.querySelectorAll('[data-midi]'))key.setAttribute('aria-label',i18n.t('stage.pianoKey',{note:midiName(Number(key.dataset.midi))}));
    liveNotes.textContent=heldNotes.length?heldNotes.map(midiName).join(' · '):i18n.t('free.stageReady');
  }
  function setHeldNotes(notes=[]){
    heldNotes=[...new Set(notes)].filter(note=>Number.isInteger(note)&&note>=0&&note<=127).sort((a,b)=>a-b);const held=new Set(heldNotes);
    for(const key of keys.querySelectorAll('[data-midi]')){const pressed=held.has(Number(key.dataset.midi));key.classList.toggle('held',pressed);key.classList.toggle('pressed',pressed);key.setAttribute('aria-pressed',String(pressed));}
    for(const rail of rails.children)rail.classList.toggle('held',held.has(Number(rail.dataset.pitch)));
    inputSection.classList.toggle('has-held-notes',held.size>0);liveNotes.textContent=heldNotes.length?heldNotes.map(midiName).join(' · '):i18n.t('free.stageReady');
  }
  function description(parent,record){
    const data=describePerformance(record);const bind=(node,key,params)=>{const update=()=>{node.textContent=i18n.t(key,typeof params==='function'?params():params);};summaryTexts.push(update);update();return node;};const p=(key,params)=>parent.append(bind(el('p'),key,params));
    p('free.countSummary',{onsets:data.event_counts.note_on,releases:data.event_counts.note_off,synthetic:data.event_counts.synthetic_release});
    p('free.activeDuration',()=>({duration:i18n.formatDuration(record.segments.reduce((sum,segment)=>sum+segment.end_wall_ms-segment.start_wall_ms,0))}));
    if(data.pitch_onsets.range)p('free.pitchRange',{low:midiName(data.pitch_onsets.range.min),high:midiName(data.pitch_onsets.range.max)});else p('free.noOnsets');
    p('free.gaps',{count:data.preserved_gaps.length});p('free.omissions',{count:data.omissions.count});
    const excluded=data.inter_onset_intervals.excluded;p('free.intervalSummary',{count:data.inter_onset_intervals.distribution.reduce((sum,row)=>sum+row.count,0),reordered:excluded.reordered,unassigned:excluded.unassigned,boundaries:excluded.across_boundaries});
    const details=el('details');const heading=bind(el('summary'),'free.distribution');details.append(heading);const list=el('ul');
    for(const row of data.pitch_onsets.distribution){const li=el('li');bind(li,'free.pitchCount',{note:midiName(row.midi),count:row.count});list.append(li);}
    for(const row of data.input_onsets){const kind={pointer:'on_screen_pointer',accessible_keyboard:'on_screen_keyboard'}[row.input_kind]||row.input_kind;const li=el('li');bind(li,'free.inputCount',()=>({kind:i18n.t(`free.input.${kind}`),count:row.count}));list.append(li);}details.append(list);parent.append(details);
  }
  function render(){
    const value=session.snapshot(), replay=preview?.snapshot() ?? {status:'idle',scheduled:0,skipped:0,excluded:0};
    const active=['recording','paused'].includes(value.state),playing=['preparing','playing'].includes(replay.status);
    for(const [node,key]of translations)node.textContent=i18n.t(key);
    screen.dataset.state=value.state;screen.setAttribute('aria-busy',String(busy));state.textContent=i18n.t(`free.state.${value.state}`);count.textContent=i18n.t('free.eventCount',{count:value.eventCount});full.hidden=!value.truncated;
    elements['free-start'].disabled=busy||active||value.hasUnsavedDraft;
    elements['free-pause'].disabled=busy||value.state!=='recording';elements['free-resume'].disabled=busy||value.state!=='paused';elements['free-stop'].disabled=busy||!active;
    elements['free-save'].disabled=busy||!value.hasUnsavedDraft||value.saveStatus==='pending';elements['free-export-draft'].disabled=busy||!value.hasDraft;
    elements['free-discard'].disabled=busy||!value.hasUnsavedDraft||!discard.checked;discard.disabled=busy||!value.hasUnsavedDraft;
    savePanel.hidden=!value.hasDraft;saveState.textContent=value.hasDraft?i18n.t(`free.save.${value.saveStatus}`):'';
    elements['free-sound'].textContent=i18n.t(getSoundEnabled()?'settings.soundOn':'settings.soundOff');elements['free-sound'].setAttribute('aria-pressed',String(getSoundEnabled()));
    recordCount.textContent=i18n.t('free.recordCount',{count:value.records.length});
    const listSignature=JSON.stringify([i18n.revision,value.records]);
    if(lastList!==listSignature){lastList=listSignature;const chosen=records.value;records.replaceChildren();
      if(!value.records.length){const option=el('option');option.value='';option.textContent=i18n.t('free.emptyLibrary');records.append(option);}
      for(const item of value.records){const option=el('option');option.value=item.key;option.textContent=i18n.t('free.recordOption',{label:item.label||i18n.t('free.unnamed'),date:i18n.formatDateTime(item.saved_at)});records.append(option);}if(value.records.some(row=>row.key===chosen))records.value=chosen;
    }
    for(const id of ['free-refresh','free-export-backup','free-import-record','free-restore-backup'])elements[id].disabled=busy;
    elements['free-load'].disabled=busy||!records.value;elements['free-export-record'].disabled=busy||!value.selected;
    detail.hidden=!value.selected;comparison.hidden=!value.baseline||!value.selected;
    const detailSignature=JSON.stringify([value.selected?.key,value.selected?.revision]);
    if(detailSignature!==lastDetail){if(value.selected)recordings.open=true;lastDetail=detailSignature;summaryTexts.length=0;summary.replaceChildren();const record=session.selectedRecord();if(record)description(summary,record);}
    elements['free-preview'].disabled=busy||active||!preview||!value.selected||!getSoundEnabled()||playing;
    elements['free-preview-stop'].disabled=!playing;elements['free-choose-baseline'].disabled=busy||!value.selected;
    previewState.textContent=i18n.t('free.previewStatus',{state:i18n.t(`free.preview.state.${replay.status}`),scheduled:replay.scheduled,skipped:replay.skipped,excluded:replay.excluded});
    const compareSignature=JSON.stringify([value.baseline?.key,value.baseline?.revision,value.selected?.key,value.selected?.revision,i18n.revision]);
    if(compareSignature!==lastComparison){lastComparison=compareSignature;comparisonBody.replaceChildren();const comparisonData=session.comparison();
      if(comparisonData){for(const [position,meta,data]of [['a',comparisonData.a,value.baseline],['b',comparisonData.b,value.selected]]){
        const column=el('section');const heading=el('h3');heading.textContent=i18n.t(position==='a'?'free.baselineName':'free.selectedName',{label:data.label||i18n.t('free.unnamed')});column.append(heading);
        for(const [key,params]of [['free.countSummary',{onsets:meta.event_counts.note_on,releases:meta.event_counts.note_off,synthetic:meta.event_counts.synthetic_release}],['free.gaps',{count:meta.preserved_gaps.length}],['free.omissions',{count:meta.omissions.count}]]){const p=el('p');p.textContent=i18n.t(key,params);column.append(p);}
        const pitch=el('p');pitch.textContent=meta.pitch_onsets.range?i18n.t('free.pitchRange',{low:midiName(meta.pitch_onsets.range.min),high:midiName(meta.pitch_onsets.range.max)}):i18n.t('free.noOnsets');column.append(pitch);comparisonBody.append(column);
      }}
    }
    const displayedIssue=issue||value.error;status.textContent=displayedIssue?i18n.t(errorKey(displayedIssue)):typeof notice==='string'?i18n.t(notice):notice?i18n.t(notice.key,notice.params):'';
    for(const update of summaryTexts)update();renderKeyLabels();
  }
  const unsubscribe=session.subscribe(render),unsubscribePreview=preview?.subscribe(render),unsubscribeLocale=i18n.subscribe(render);
  setKeyboard(null);render();
  return {enter,leave,interrupt,render,setKeyboard,setHeldNotes,element:screen,
    destroy(){clearContacts('free_close');preview?.stop();unsubscribe();unsubscribePreview?.();unsubscribeLocale?.();document.defaultView?.removeEventListener('blur',onBlur);document.defaultView?.removeEventListener('pagehide',onBlur);document.removeEventListener('visibilitychange',onVisibility);document.removeEventListener('compositionstart',compositionStart);document.removeEventListener('compositionend',compositionEnd);screen.remove();}};
}

/* Hosted Windows only: exercise unchanged app controls, actual native files, and real profile storage. */
(() => {
  const phase = globalThis.__WMH_ACCEPTANCE_PHASE__;
  const $ = id => document.getElementById(id);
  const errors = [], requests = [];
  const midi = {apiAvailable:typeof navigator.requestMIDIAccess==='function',calls:0,outcome:'not-requested'};
  if(midi.apiAvailable) {
    const requestMidi=navigator.requestMIDIAccess.bind(navigator);
    Object.defineProperty(navigator,'requestMIDIAccess',{configurable:true,value:options=>{
      midi.calls++;midi.sysexRequested=options?.sysex;
      return requestMidi(options).then(access=>{midi.outcome='ready';midi.sysexEnabled=access.sysexEnabled;midi.inputCount=access.inputs.size;return access;},error=>{midi.outcome='denied-or-unavailable';midi.errorName=String(error.name);midi.error=String(error.message).slice(0,250);throw error;});
    }});
  }
  const originalFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = (...args) => {
    const result = originalFetch(...args), path = String(args[0]);
    if (path.startsWith('/api/')) result.then(response => {
      response.clone().json().then(body => requests.push({path,status:response.status,body})).catch(() => {});
    }).catch(() => {});
    return result;
  };
  addEventListener('error', event => errors.push(String(event.message || 'script error')));
  addEventListener('unhandledrejection', event => errors.push(String(event.reason)));
  const assert = (condition, message) => { if (!condition) throw Error(message); };
  const delay = milliseconds => new Promise(resolve => setTimeout(resolve,milliseconds));
  async function until(condition,label) {
    const deadline=performance.now()+25000;
    while (!await condition()) { if(performance.now()>deadline)throw Error(`Timed out: ${label}`); await delay(100); }
  }
  async function json(path,options) {
    const response=await originalFetch(path,options), value=await response.json();
    if(!response.ok)throw Error(`${path}: ${value.error || response.status}`); return value;
  }
  async function digest(value) {
    const bytes=new TextEncoder().encode(JSON.stringify(value));
    return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(byte=>byte.toString(16).padStart(2,'0')).join('');
  }
  let sequence=0;
  async function native(kind,node,file) {
    node.scrollIntoView({block:'center',inline:'center'}); node.focus(); await delay(150);
    const bounds=node.getBoundingClientRect();
    assert(bounds.width>0 && bounds.height>0,'Native target is not visible');
    const action={version:1,sequence:++sequence,kind,x:bounds.x+bounds.width/2,y:bounds.y+bounds.height/2,width:innerWidth,height:innerHeight,...(file?{file}:{})};
    await json('/__desktop_smoke/action',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(action)});
    let result;
    await until(async()=>{const response=await originalFetch(`/__desktop_smoke/result/${sequence}`);if(response.status===404)return false;result=await response.json();return true;},`native ${kind}`);
    assert(result.ok,result.error || `Native ${kind} failed`);
  }
  const click=id=>{assert($(id) && !$(id).disabled,`Control ${id} unavailable`);$(id).click();};
  const closeDialogs=()=>{for(const dialog of document.querySelectorAll('dialog[open]'))dialog.close();};
  async function download(id) {
    const before=(await json('/__desktop_smoke/state')).downloads.length;
    await native('click',$(id));
    let row;
    await until(async()=>{row=(await json('/__desktop_smoke/state')).downloads[before];return row?.complete;},`actual ${id} download`);
    assert(row.success,`Windows download failed: ${id}`); return row.file;
  }
  async function importScore(file,{cancel=false,malformed=false}={}) {
    closeDialogs();click('import-tools-button');
    const before=requests.length,previousTitle=$('score-title').textContent;
    let pickerEvent=null;
    const listener=event=>{pickerEvent=event.type;};
    $('score-file').addEventListener('change',listener,{once:true,capture:true});
    $('score-file').addEventListener('cancel',listener,{once:true});
    await native(cancel?'cancel-picker':'picker',$('import-button'),cancel?undefined:file);
    await until(()=>pickerEvent!==null,'file picker result');
    $('score-file').removeEventListener('change',listener,true);$('score-file').removeEventListener('cancel',listener);
    if(cancel){assert(pickerEvent==='cancel','Picker did not cancel');assert($('score-title').textContent===previousTitle,'Cancel replaced the current score');}
    else if(malformed){await until(()=>$('notice-message')?.textContent.includes(file),'invalid file message');assert($('score-title').textContent===previousTitle,'Malformed import replaced score');}
    else {await until(()=>requests.slice(before).some(request=>request.path==='/api/compile'&&request.status===200)&&!$('export-button').disabled,`compile selected ${file}`);}
    closeDialogs();
  }
  async function saveScore(label,library) {
    closeDialogs();click('library-button');await until(()=>$('score-library').getAttribute('aria-busy')==='false','library ready');
    const before=(await library.list()).length;$('library-label').value=label;click('library-save-copy');
    await until(async()=>!$('library-save-copy').disabled&&(await library.list()).length===before+1,'score transaction');
    const row=(await library.list()).find(row=>row.label===label); assert(row,'Saved score missing');
    const saved=await library.get(row.key); click('library-close'); return saved.score;
  }
  async function navigation() {
    closeDialogs();
    for(let pass=0;pass<3;pass++) {
      for(const name of ['settings','score-tools','results','import-tools']) {
        if($(`${name}-button`).disabled)continue;click(`${name}-button`);assert($(`${name}-dialog`).open,`${name} failed to open`);
        await native('escape',$(`${name}-dialog`).querySelector('button'));
        assert(!$(`${name}-dialog`).open,`${name} did not close with Escape`);
      }
      if(document.body.dataset.screen==='stage'){click('back-to-library');click('resume-session');}
    }
  }
  addEventListener('DOMContentLoaded',async()=>{
    const report={version:1,phase,ok:false,origin:location.origin,userAgent:navigator.userAgent,checks:[],physicalMidi:false,audioOutput:false};
    let scores,performances;
    try {
      await until(()=>$('start-listen')&&!$('start-listen').disabled,'catalog preview');
      ({openScoreLibrary:scores}=await import('/local-library.js'));scores=await scores();
      ({openPerformanceLibrary:performances}=await import('/performance-library.js'));performances=await performances();
      report.health=await json('/api/health');assert(report.health.network==='native-protocol-no-listener','Unexpected transport');
      if(phase==='seed') {
        assert((await scores.list()).length===0 && (await performances.list()).length===0,'Acceptance needs a fresh profile');
        $('interface-language').value='en';$('interface-language').dispatchEvent(new Event('change',{bubbles:true}));
        if($('sound-button').getAttribute('aria-pressed')!=='true')click('sound-button');
        click('start-listen');await until(()=>$('export-button')&&!$('export-button').disabled,'stage activation');click('reset-button');
        if($('notation-toggle').getAttribute('aria-expanded')!=='true')click('notation-toggle');
        await until(()=>$('engraved-staff').querySelector('svg'),'offline OSMD');
        report.checks.push('catalog-stage-offline-engraving');
        click('settings-button');await native('click',$('midi-button'));
        await until(()=>!$('midi-button').disabled && (!midi.apiAvailable || midi.outcome!=='not-requested'),'explicit MIDI outcome');
        const {getAppI18n}=await import('/app-locale.js'),i18n=getAppI18n(document);
        if(midi.apiAvailable)assert(midi.calls===1 && midi.sysexRequested===false,'MIDI request changed scope');
        if(midi.outcome==='ready')assert(midi.sysexEnabled===false,'Unexpected SysEx access');
        else {
          const key=midi.apiAvailable?'input.midi.access.error':'input.midi.access.unsupported';
          assert($('midi-access-status').textContent.includes(i18n.t(key)),'Missing localized MIDI failure status');
          $('interface-language').value='zh-CN';$('interface-language').dispatchEvent(new Event('change',{bubbles:true}));
          assert($('midi-access-status').textContent.includes(i18n.t(key)),'MIDI failure did not follow Chinese locale');
          assert($('notice-message').textContent.includes(i18n.t(midi.apiAvailable?'input.midi.permissionDenied':key)),'MIDI failure notice did not follow selected locale');
          $('interface-language').value='en';$('interface-language').dispatchEvent(new Event('change',{bubbles:true}));
        }
        report.midi=midi;report.checks.push('explicit-midi-api-outcome-and-localized-failure');closeDialogs();
        for(const file of ['original-duet.mxl','midi-original-ppq.mid','jianpu-original-steps.jianpu','original-duet.musicxml'])await importScore(file);
        report.checks.push('actual-windows-file-picker-mxl-midi-jianpu-musicxml');
        const original=await saveScore('Native exact source',scores), scoreHash=await digest(original);
        closeDialogs();click('score-tools-button');const canonicalFile=await download('export-button');closeDialogs();
        for(let i=0;i<2;i++)await importScore(undefined,{cancel:true});
        await importScore('malformed.json',{malformed:true});
        await importScore(canonicalFile);
        const roundtrip=await saveScore('Native canonical roundtrip',scores);
        assert(await digest(roundtrip)===scoreHash,'Canonical download/reimport changed source, metadata or rational times');
        report.checks.push('canonical-written-file-picker-roundtrip-exact','repeated-picker-cancel-and-invalid-import');
        click('library-button');await until(()=>!$('library-export-backup').disabled,'library ready');
        const backup=await download('library-export-backup');
        const before=(await scores.list()).length;await native('picker',$('library-import-backup'),backup);
        await until(async()=>(await scores.list()).length===before*2&&!$('library-import-backup').disabled,'restore real score backup');click('library-close');
        report.checks.push('score-library-save-and-actual-backup-restore');
        await navigation();report.checks.push('repeated-settings-score-results-import-escape-navigation');
        if(document.body.dataset.screen==='stage')click('back-to-library');click('start-free-practice');
        if($('free-sound').getAttribute('aria-pressed')==='true')click('free-sound');click('free-start');
        await native('key-r',$('free-practice-title'));
        click('free-pause');await until(()=>!$('free-resume').disabled,'pause settled');assert($('free-practice-screen').dataset.state==='paused','Pause failed');click('free-resume');
        await native('key-r',$('free-practice-title'));
        await native('minimize-restore',$('free-practice-title'));assert($('free-practice-screen').dataset.state==='paused','Native focus loss did not pause recording');
        click('free-resume');await native('key-r',$('free-practice-title'));click('free-stop');
        await until(()=>!$('free-save').disabled,'stop sealed its draft');assert($('free-practice-screen').dataset.state==='stopped','Stop failed');
        $('free-record-label').value='Native keyboard history';click('free-save');
        await until(async()=>(await performances.list()).length===1&&$('free-practice-screen').getAttribute('aria-busy')==='false','performance transaction');
        const first=(await performances.list())[0],record=(await performances.get(first.key)).record;
        assert(record.observations.events.filter(event=>event.kind==='note_on'&&event.input_kind==='typing_keyboard').length===3,'Expected three Windows keyboard onsets');
        assert(record.segments.length===3,'Pause/resume/minimize segments were not retained');
        report.performanceHash=await digest(record);report.performanceOnsets=3;
        const recordFile=await download('free-export-record'),performanceBackup=await download('free-export-backup');
        await native('picker',$('free-import-file'),performanceBackup);
        await until(()=>$('free-import-file').files?.[0]?.name===performanceBackup,'performance backup file selection');
        click('free-restore-backup');
        await until(async()=>(await performances.list()).length===2&&!$('free-restore-backup').disabled,'restore actual performance backup');
        assert((await Promise.all((await performances.list()).map(async row=>digest((await performances.get(row.key)).record)))).every(hash=>hash===report.performanceHash),'Performance backup changed sealed observations');
        click('free-load');await until(()=>!$('free-export-record').disabled,'saved history load');
        report.checks.push('windows-keyboard-free-pause-resume-minimize-stop','performance-save-history-exact-backup-restore');
        report.files={canonicalFile,scoreBackup:backup,recordFile,performanceBackup};report.scoreHash=scoreHash;
        const expected={scoreHash,performanceHash:report.performanceHash,scoreCount:(await scores.list()).length,performanceCount:(await performances.list()).length};
        localStorage.setItem('wmh.desktop.acceptance.v1',JSON.stringify(expected));
        click('free-exit');
      } else {
        const expected=JSON.parse(localStorage.getItem('wmh.desktop.acceptance.v1')||'null');assert(expected,'Previous process did not persist its acceptance marker');
        assert(document.documentElement.lang==='en','Language setting did not persist');
        const scoreRows=await scores.list(),performanceRows=await performances.list();
        assert(scoreRows.length===expected.scoreCount && performanceRows.length===expected.performanceCount,'Database records did not persist exactly');
        for(const row of scoreRows)assert(await digest((await scores.get(row.key)).score)===expected.scoreHash,'Saved canonical score changed after restart');
        for(const row of performanceRows)assert(await digest((await performances.get(row.key)).record)===expected.performanceHash,'Sealed performance changed after restart');
        report.scoreCount=scoreRows.length;report.performanceCount=performanceRows.length;report.checks.push('same-profile-restart-indexeddb-exact-records-and-locale');
        click('library-button');await until(()=>$('library-list').querySelector('[data-library-open]')&&!$('library-refresh').disabled,'saved score list');
        $('library-list').querySelector('[data-library-open]').click();await until(()=>!$('score-library').open&&!$('export-button').disabled,'saved score open');
        if(document.body.dataset.screen==='stage')click('back-to-library');click('start-free-practice');
        await until(()=>!$('free-load').disabled,'saved history list');click('free-load');await until(()=>!$('free-export-record').disabled,'saved history open');
        report.checks.push('restart-saved-score-open-and-history-load');
        if(phase==='close-active') {
          if($('free-sound').getAttribute('aria-pressed')==='true')click('free-sound');click('free-start');await native('key-r',$('free-practice-title'));
          assert($('free-practice-screen').dataset.state==='recording','Close-active gate did not start recording');report.activeAtClose='recording';
        } else {click('free-exit');}
      }
      report.downloads=(await json('/__desktop_smoke/state')).downloads;
      report.errors=errors;assert(errors.length===0,errors.join('; '));report.ok=true;
    } catch(error) { report.error=String(error);report.errors=errors; }
    finally {scores?.close?.();performances?.close?.();}
    await originalFetch('/__desktop_smoke/report',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(report)});
  },{once:true});
})();

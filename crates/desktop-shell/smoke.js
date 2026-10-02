/* Injected only when the process owner requests native CI evidence. */
/* Original, tiny fixtures used only by the process-owner native evidence script. */
function nativeSongApiFixture() {
  const beat = numerator => ({numerator, denominator:1});
  const note = (id, at) => ({id,at:beat(at),duration:beat(1),pitch:{step:'C',alter:0,octave:4},voice:'1',staff:1,velocity:90,tie_start:false,tie_stop:false});
  const score = {
    version:1,id:'original-native-song-contract',title:'Original native contract fixture',composer:'WorldMusicHub',
    provenance:{kind:'original_exercise',attribution:'Original synthetic acceptance fixture',source_url:null,license:null},
    parts:[{id:'piano',name:'Original fixture',instrument:'piano',notes:[note('machine-note',0),note('human-note',1)]}],
    tempo:[{at:beat(0),bpm:120}],meters:[{at:beat(0),numerator:4,denominator:4}],keys:[{at:beat(0),fifths:0,mode:'major'}],
    measures:[{number:1,at:beat(0),length:beat(4)}],repeats:[],source:null
  };
  // Format 0, PPQ 96: tempo, program, percussion on/off, EOT. One tick is
  // exactly 15625/3 microseconds. These inspection events are never played.
  const midi = new Uint8Array([
    77,84,104,100,0,0,0,6,0,0,0,1,0,96,77,84,114,107,0,0,0,22,
    0,255,81,3,7,161,32, 0,192,5, 0,153,36,80, 1,137,36,12, 0,255,47,0
  ]);
  return {score,midi};
}

async function checkNativeSongApi({fetch,crypto,milliseconds=8000,setTimer=setTimeout,clearTimer=clearTimeout}) {
  const assert = (condition,message) => {if(!condition)throw Error(`Song API smoke: ${message}`);};
  const request = async (path,body,type,status) => {
    const controller=new AbortController();let timer;
    try {
      return await Promise.race([
        (async()=>{
          const response=await fetch(path,{method:'POST',headers:{'Content-Type':type},body,signal:controller.signal});
          const text=await response.text();
          assert(new TextEncoder().encode(text).byteLength<=128*1024,`${path} response exceeds fixture evidence bound`);
          const value=JSON.parse(text);
          assert(response.status===status,`${path} expected ${status}, got ${response.status}: ${value.error || 'unexpected response'}`);
          return value;
        })(),
        new Promise((_,reject)=>{timer=setTimer(()=>{reject(Error(`Song API smoke: timed out reading ${path}`));controller.abort();},milliseconds);})
      ]);
    } finally {clearTimer(timer);}
  };
  const {score,midi}=nativeSongApiFixture();
  const originalScore=JSON.stringify(score),originalMidi=[...midi];
  const create={score,selected_part_ids:['piano'],profile:{kind:'piano',key_count:88,lowest_midi:null},human_source_note_ids:['human-note']};
  const checked=await request('/api/assistance/create',JSON.stringify(create),'application/json',200);
  assert(checked.plan?.schema_version===1&&checked.plan.revision===1&&/^[0-9a-f]{64}$/.test(checked.plan.source_binding?.digest),'create must return a bound revision-1 plan');
  assert(checked.human_targets?.timeline?.notes?.length===1&&checked.human_targets.timeline.notes[0].source_note_id==='human-note','human target ownership changed');
  assert(checked.machine_timeline?.notes?.length===1&&checked.machine_timeline.notes[0].source_note_id==='machine-note','machine accompaniment was lost or treated as a human target');
  assert(checked.coverage?.human_target_count===1&&checked.coverage.machine_occurrence_count===1&&checked.scored_mode_allowed===true,'ownership coverage or scored-mode gate changed');
  const validated=await request('/api/assistance/validate',JSON.stringify({score,plan:checked.plan}),'application/json',200);
  assert(JSON.stringify(validated)===JSON.stringify(checked),'validation must regenerate the same complete checked plan');
  const mismatch=await request('/api/assistance/validate',JSON.stringify({score:{...score,title:'Changed original fixture'},plan:checked.plan}),'application/json',400);
  assert(mismatch.code==='assistance_source_mismatch'&&typeof mismatch.error==='string'&&Array.isArray(mismatch.source_note_ids)&&mismatch.source_note_ids.length===0,'source mismatch must preserve structured error/code/IDs');
  const sourceHash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',midi))].map(byte=>byte.toString(16).padStart(2,'0')).join('');
  // An actual ArrayBuffer exercises WebView's raw-byte custom-protocol request.
  const raw=await request('/api/midi/events',midi.buffer.slice(0),'audio/midi',200);
  assert(raw.source_sha256===sourceHash&&raw.format===0&&raw.track_count===1&&raw.ppq===96&&raw.end_tick===1,'raw source identity or container changed');
  assert(raw.relative_clock_available===true&&raw.events?.length===5,'raw inspection must retain all five events and its exact clock');
  const ranges=[[22,29],[29,32],[32,36],[36,40],[40,44]];
  for(const [index,event] of raw.events.entries()) {
    assert(event.id?.source_sha256===sourceHash&&event.id.track_index===0&&event.id.event_index===index,`raw event ${index} source identity changed`);
    assert(event.source_range?.start===ranges[index][0]&&event.source_range.end===ranges[index][1],`raw event ${index} original byte range changed`);
    assert(event.tick===(index<3?0:1)&&event.delta_ticks===(index===3?1:0)&&event.beat?.numerator===(index<3?0:1)&&event.beat.denominator===(index<3?1:96),`raw event ${index} tick/beat timing changed`);
    const time=event.relative_microseconds;
    assert(typeof time?.numerator==='string'&&time.numerator===(index<3?'0':'15625')&&time.denominator===(index<3?1:3),`raw event ${index} decimal-string rational clock changed`);
    assert(BigInt(time.numerator)*BigInt(index<3?1:3)===(index<3?0n:15625n)*BigInt(time.denominator),`raw event ${index} exact clock mismatch`);
  }
  assert(raw.events[0].kind.kind==='tempo'&&raw.events[0].kind.microseconds_per_quarter===500000,'tempo event changed');
  assert(raw.events[1].kind.channel===0&&raw.events[1].kind.message.kind==='program_change'&&raw.events[1].kind.message.program===5,'program event changed');
  assert(raw.events[2].kind.channel===9&&raw.events[2].kind.message.kind==='note_on'&&raw.events[2].kind.message.key===36&&raw.events[2].kind.message.velocity===80,'percussion attack bytes changed');
  assert(raw.events[3].kind.channel===9&&raw.events[3].kind.message.kind==='note_off'&&raw.events[3].kind.message.key===36&&raw.events[3].kind.message.velocity===12,'percussion release bytes changed');
  assert(raw.events[4].kind.kind==='meta'&&raw.events[4].kind.meta_type===47&&raw.events[4].kind.data.length===0,'end-of-track was lost');
  assert(raw.diagnostics?.some(item=>item.code==='percussion_mapping_unresolved'),'inspection must disclose unresolved percussion mapping');
  assert(!('notes' in raw)&&!('timeline' in raw)&&!('human_targets' in raw),'inspection must not claim playable or gradeable targets');
  const strict=await request('/api/import/midi',midi.buffer.slice(0),'audio/midi',400);
  assert(typeof strict.error==='string'&&strict.error.includes('percussion'),'strict notation importer must still reject percussion');
  assert(JSON.stringify(score)===originalScore&&JSON.stringify([...midi])===JSON.stringify(originalMidi),'original acceptance sources changed');
  return {version:1,scope:'engine-contract-only',create_status:200,validate_status:200,source_mismatch_status:400,source_mismatch_code:mismatch.code,
    human_targets:1,machine_occurrences:1,raw_status:200,source_bytes:midi.byteLength,source_sha256:sourceHash,raw_events:raw.events.length,
    exact_clock:{numerator:'15625',denominator:3},strict_percussion_status:400,playback_validated:false};
}


(() => {
  const errors = [];
  addEventListener('error', event => errors.push(String(event.message || 'script error')));
  addEventListener('unhandledrejection', event => errors.push(String(event.reason)));
  const waitFor = async (condition, label) => {
    const deadline = performance.now() + 25000;
    while (!condition()) {
      if (performance.now() > deadline) throw Error(`Timed out: ${label}`);
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  };
  const json = async (path, options) => {
    const response = await fetch(path, options);
    const data = await response.json();
    if (!response.ok) throw Error(`${path}: ${data.error || response.status}`);
    return data;
  };
  addEventListener('DOMContentLoaded', async () => {
    const report = {version: 1, ok: false, origin: location.origin, userAgent: navigator.userAgent};
    try {
      await waitFor(() => document.querySelectorAll('#catalog .catalog-item').length > 0, 'unchanged app catalog');
      await waitFor(() => document.querySelector('#start-listen') && !document.querySelector('#start-listen').disabled, 'app catalog preview');
      document.querySelector('#sound-button').click();
      if (document.querySelector('#sound-button').getAttribute('aria-pressed') !== 'true') throw Error('Silent smoke mode did not activate');
      document.querySelector('#start-listen').click();
      await waitFor(() => !document.querySelector('#export-button')?.disabled, 'app score activation');
      // The app intentionally starts with its notation dock closed. Exercise
      // the real display control before requiring the lazily rendered SVG.
      if (document.querySelector('#notation-toggle').getAttribute('aria-expanded') !== 'true') document.querySelector('#notation-toggle').click();
      await waitFor(() => document.querySelector('#notation-toggle').getAttribute('aria-expanded') === 'true', 'visible notation dock');
      await waitFor(() => document.querySelector('#engraved-staff svg'), 'offline notation SVG');
      document.querySelector('#reset-button').click();
      report.health = await json('/api/health');
      if (report.health.engine !== 'rust' || report.health.network !== 'native-protocol-no-listener') throw Error('Wrong engine transport');
      const index = await json('/api/catalog/index');
      report.catalogCount = document.querySelectorAll('#catalog .catalog-item').length;
      report.indexVersion = index.version;
      const scoreId = document.querySelector('#catalog .catalog-item').dataset.scoreId;
      const score = await json(`/api/catalog/score/${encodeURIComponent(scoreId)}`);
      const compiled = await json('/api/compile', {method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(score)});
      report.compiledNotes = compiled.timeline.notes.length;
      if (!report.compiledNotes) throw Error('No compiled Rust notes');
      const malformed = await fetch('/api/import/musicxml', {method:'POST',headers:{'Content-Type':'application/xml'},body:'invalid musicxml'});
      if (malformed.status !== 400 || !(await malformed.json()).error) throw Error('Raw import/error path failed');
      report.songApi = await checkNativeSongApi({fetch:globalThis.fetch.bind(globalThis),crypto:globalThis.crypto});
      report.engraving = await json('/vendor/engraving-manifest.json');
      // Keep only small manifest evidence, never aggregate third-party notices.
      report.engraving = {version: report.engraving.version};
      if (report.engraving.version !== '2.1.3') throw Error('Wrong offline notation bundle');
      report.svgCount = document.querySelectorAll('#engraved-staff svg').length;
      report.canvas = [...document.querySelectorAll('canvas')].map(canvas => ({id:canvas.id,width:canvas.width,height:canvas.height}));
      report.scoreTitle = document.querySelector('#score-title').textContent;
      report.moduleLoaded = [...document.scripts].some(script => script.src.endsWith('/app.js'));
      report.errors = errors;
      if (errors.length) throw Error(errors.join('; '));
      report.ok = true;
    } catch (error) { report.error = String(error); report.errors = errors; }
    await fetch('/__desktop_smoke/report', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(report)});
  }, {once:true});
})();

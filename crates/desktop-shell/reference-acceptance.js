/* Process-owner hosted Windows acceptance only. All audio calls below forward to
 * the real native WebView AudioContext; no parser, audio, file input or API mock. */
const NATIVE_REFERENCE_FIXTURE=Object.freeze({name:'original-reference-overlap.mid',sha256:'c2d487c1044c31ab520afce4ffa06c0513ca7250ec129cf96d71f7a671a46f66',tracks:3,events:26,onsets:8});

function observeNativeReferenceAudio(root=globalThis) {
  const rows=[],restores=[];let sourceStarts=0;
  const prototypes=new Set([root.AudioContext?.prototype,root.webkitAudioContext?.prototype].filter(Boolean));
  if(!prototypes.size)throw Error('Native reference acceptance requires real AudioContext');
  for(const prototype of prototypes)for(const method of ['createOscillator','createBufferSource']) {
    const original=prototype[method];
    if(typeof original!=='function')throw Error(`Missing native audio method ${method}`);
    prototype[method]=function(...args) {
      const source=original.apply(this,args);
      if(rows.length>=512)throw Error('Native reference audio observation exceeded its finite source bound');
      const row={context:this,kind:method,start:null,stop:Infinity,disconnected:false};rows.push(row);
      const start=source.start,stop=source.stop,disconnect=source.disconnect;
      source.start=function(...values){const result=start.apply(this,values);row.start=Math.max(row.context.currentTime,Number(values[0])||0);sourceStarts++;return result;};
      source.stop=function(...values){const result=stop.apply(this,values);row.stop=Math.max(row.context.currentTime,Number(values[0])||0);return result;};
      source.disconnect=function(...values){const result=disconnect.apply(this,values);if(values.length===0)row.disconnected=true;return result;};
      return source;
    };
    restores.push(()=>{prototype[method]=original;});
  }
  return {snapshot(){return {sourceStarts,oscillatorStarts:rows.filter(row=>row.kind==='createOscillator'&&row.start!==null).length,
    activeSources:rows.filter(row=>!row.disconnected&&row.start!==null&&row.start<=row.context.currentTime&&row.stop>row.context.currentTime).length,
    pendingSources:rows.filter(row=>!row.disconnected&&row.start!==null&&row.start>row.context.currentTime&&row.stop>row.start).length};},restore(){for(const restore of restores)restore();}};
}

async function checkNativeReferenceListening({document,native,click,closeDialogs,download,until,delay,requests}) {
  const $=id=>document.getElementById(id),f=NATIVE_REFERENCE_FIXTURE,checks=[],files={};
  const assert=(value,message)=>{if(!value)throw Error(`Native reference: ${message}`);};
  const state=value=>until(()=>$('reference-status').dataset.state===value,`reference ${value}`);
  const play=async()=>{await native('click',$('reference-play'));await state('playing');};
  const open=async()=>{closeDialogs();click('import-tools-button');await native('click',$('reference-listening-entry'));assert($('reference-listening-dialog').open,'actual Import entry did not open');};
  const snapshot=()=>({title:$('score-title').textContent,stage:$('stage-title').textContent,mode:$('session-mode').value,clock:$('progress').value,captured:$('hud-captured').textContent,pass:document.querySelector('.performance-status').dataset.passId,revision:document.querySelector('.performance-status').dataset.revision});
  async function scoreDownload(){closeDialogs();click('score-tools-button');const file=await download('export-button');closeDialogs();return file;}
  async function takeDownload(){closeDialogs();click('results-button');const file=await download('export-takes');closeDialogs();return file;}
  closeDialogs();if(document.body.dataset.screen!=='stage')click('resume-session');
  if($('sound-button').getAttribute('aria-pressed')!=='true')click('sound-button');
  click('settings-button');$('session-mode').value='practice';$('session-mode').dispatchEvent(new Event('change',{bubbles:true}));$('count-in').checked=false;closeDialogs();
  await until(()=>!$('play-button').disabled,'score practice ready');
  await native('click',$('play-button'));await native('key-r',$('stage-title'));
  await until(()=>$('hud-captured').textContent==='1','one actual Windows keyboard input');await native('click',$('play-button'));
  assert($('play-button').textContent.includes('Play'),'prior scored take did not pause');
  files.beforeScore=await scoreDownload();files.beforeTake=await takeDownload();
  const before=JSON.stringify(snapshot()),requestStart=requests.length,probe=observeNativeReferenceAudio();let cleanupChecks=0;
  function unchanged(label){assert(JSON.stringify(snapshot())===before,`${label}: score/take display changed`);}
  function clean(label){const current=probe.snapshot();assert(current.activeSources===0&&current.pendingSources===0,`${label}: native voices remain scheduled or active`);cleanupChecks++;return current;}
  try {
    await open();let pickerEvent=null;
    const pickerListener=event=>{pickerEvent=event.type;};
    $('reference-file').addEventListener('change',pickerListener,{once:true});
    await native('picker',$('reference-choose-file'),f.name);
    await until(()=>pickerEvent==='change'&&$('reference-counts').dataset.eventCount==='26'&&requests.slice(requestStart).some(row=>row.path==='/api/midi/events'&&row.status===200),'actual native MIDI selection and Rust inspection');
    $('reference-file').removeEventListener('change',pickerListener);
    const parsed=requests.slice(requestStart).filter(row=>row.path==='/api/midi/events');
    assert(parsed.length===1,'source must pass through one live Rust load');
    const timeline=parsed[0].body;
    assert(timeline.source_sha256===f.sha256&&timeline.track_count===f.tracks&&timeline.events.length===f.events,'Rust complete source identity/counts');
    assert(timeline.events.filter(row=>row.kind.kind==='channel'&&row.kind.message.kind==='note_on'&&row.kind.message.velocity>0).length===f.onsets,'all independent onsets retained');
    assert(timeline.events.some(row=>row.kind.kind==='channel'&&row.kind.channel===9&&row.kind.message.kind==='program_change'&&row.kind.message.program===118),'source percussion program 118 was lost');
    assert($('reference-source-name').textContent===f.name,'original selected filename');
    assert($('reference-counts').dataset.trackCount==='3'&&$('reference-counts').dataset.onsetCount==='8','visible total track/onset counts');
    assert(JSON.stringify([...$('reference-tracks').children].map(row=>[Number(row.dataset.eventCount),Number(row.dataset.onsetCount)]))===JSON.stringify([[10,3],[7,2],[9,3]]),'visible per-track counts');
    assert($('reference-programs').textContent.includes('118'),'visible source program');
    assert($('reference-play').disabled&&!$('reference-policy-accept').checked,'explicit policy required');
    assert(probe.snapshot().sourceStarts===0,'loading source started audio');files.original=await download('reference-download');
    checks.push('native-filechooser','complete-original-source','explicit-rendition-policy');
    await native('click',$('reference-policy-accept'));await native('click',$('reference-sound'));
    assert($('sound-button').getAttribute('aria-pressed')==='false','reference uses the global sound preference');
    assert(probe.snapshot().sourceStarts===0,'policy or sound preference started audio');
    await play();await until(()=>probe.snapshot().sourceStarts>0&&!$('reference-clock').textContent.startsWith('0:00.0 /'),'real reference sources and elapsed time');
    await native('key-r',$('reference-source-name'));unchanged('native keyboard inside listener');checks.push('reference-input-isolated');
    await native('click',$('reference-pause'));await state('paused');clean('Pause');
    const pausedClock=$('reference-clock').textContent,controls=[...$('reference-listening-dialog').querySelectorAll('input,button')];
    const {getAppI18n}=await import('/app-locale.js'),i18n=getAppI18n(document);
    for(const locale of ['zh-CN','en']){i18n.setLocale(locale);assert($('reference-clock').textContent===pausedClock&&controls.every(node=>document.getElementById(node.id)===node),'locale replaced controls or moved paused clock');assert($('reference-source-name').textContent===f.name,'locale changed source filename');}
    checks.push('live-locale-preserved');unchanged('live locale');
    await play();await state('playing');
    let cancelEvent=false;const cancelListener=()=>{cancelEvent=true;};$('reference-file').addEventListener('cancel',cancelListener,{once:true});
    await native('cancel-picker',$('reference-choose-file'));await until(()=>cancelEvent,'native reference picker cancellation');$('reference-file').removeEventListener('cancel',cancelListener);
    await state('paused');assert(!$('reference-clock').textContent.startsWith('0:00.0 /'),'cancelled chooser reset paused clock');assert($('reference-source-name').textContent===f.name,'cancelled chooser replaced source');clean('native picker cancel');
    await native('click',$('reference-stop'));await state('stopped');clean('Stop');assert($('reference-clock').textContent==='0:00.0 / 0:06.0','Stop did not reset clock');
    checks.push('play-pause-resume-stop');
    const beforeComplete=probe.snapshot();await play();await state('ended');const afterComplete=clean('all tracks complete');
    assert(afterComplete.oscillatorStarts-beforeComplete.oscillatorStarts===14,'complete reference run lost or invented source onsets');
    checks.push('all-tracks-complete');await native('click',$('reference-stop'));
    await native('click',$('reference-mute-1'));assert($('reference-mute-1').checked&&!$('reference-mute-1').disabled,'independent mute unavailable while stopped');
    const beforeMuted=probe.snapshot();await play();await state('ended');const afterMuted=clean('muted track complete');
    assert(afterMuted.oscillatorStarts-beforeMuted.oscillatorStarts===10,'independent track mute lost or invented reference onsets');
    assert($('reference-counts').dataset.eventCount==='26'&&$('reference-counts').dataset.onsetCount==='8','muting changed source counts');checks.push('independent-track-mute');
    await native('click',$('reference-stop'));await native('click',$('reference-mute-1'));
    await play();await native('click',$('reference-sound'));await state('muted');clean('global sound off');
    assert($('sound-button').getAttribute('aria-pressed')==='true'&&$('reference-play').disabled,'global mute state incoherent');
    const mutedStarts=probe.snapshot().sourceStarts;await native('click',$('reference-sound'));await state('stopped');assert(probe.snapshot().sourceStarts===mutedStarts,'unmute auto-started sound');checks.push('shared-sound-mute');
    await play();await native('click',$('reference-close'));assert(!$('reference-listening-dialog').open,'native Close did not dismiss');clean('Close');
    const closedStarts=probe.snapshot().sourceStarts;await delay(200);assert(probe.snapshot().sourceStarts===closedStarts,'old timer scheduled after Close');
    await open();await state('stopped');assert($('reference-source-name').textContent===f.name&&$('reference-counts').dataset.eventCount==='26','Close discarded retained source');click('reference-close');checks.push('close-cleanup');
    unchanged('reference playback complete');files.afterScore=await scoreDownload();files.afterTake=await takeDownload();
    assert(!requests.slice(requestStart).some(row=>['/api/compile','/api/import/midi','/api/assess','/api/practice-targets'].includes(row.path)),'reference operations entered score import, compilation or assessment');
    checks.push('canonical-score-unchanged','scored-take-unchanged');
    return {ok:true,fixture:f.name,sourceSha256:f.sha256,eventCount:f.events,trackCount:f.tracks,onsetCount:f.onsets,files,checks,audio:{...clean('final'),cleanupChecks}};
  } finally {if($('reference-listening-dialog')?.open)click('reference-close');probe.restore();}
}

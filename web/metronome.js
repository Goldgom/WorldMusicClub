import {getAppI18n} from './app-locale.js';

export const MIN_CLICK_GAP_MS = 100;
const failure = (code,message) => Object.assign(new Error(message),{code});
const MAX_LATE_MS = 100;
const MODES = new Set(['notated_unit','quarter','dotted_quarter']);

export function validateMetronomeGrid(grid, pulse, duration) {
  if(!grid||!MODES.has(pulse)||grid.pulse!==pulse||grid.accent_policy!=='written_measure_boundary'||!Array.isArray(grid.ticks)||grid.ticks.length>100000||!Array.isArray(grid.diagnostics)||!Number.isFinite(grid.duration_ms)||Math.abs(grid.duration_ms-duration)>0.001)throw failure('metronome_invalid_response','The Rust metronome response is incomplete or belongs to a different score.');
  const ids=new Set();let previous=-Infinity;
  for(const tick of grid.ticks){if(typeof tick.id!=='string'||!tick.id||ids.has(tick.id)||!Number.isFinite(tick.start_ms)||tick.start_ms<0||tick.start_ms>=grid.duration_ms||tick.start_ms<previous||typeof tick.accent!=='boolean')throw failure('metronome_invalid_timing','The metronome response has invalid or duplicate pulse timing.');ids.add(tick.id);previous=tick.start_ms}
  return grid;
}
export function scopedClicks(grid,{from=0,to=grid.duration_ms,loop=false,countInMs=0}={}) {
  if(![from,to,countInMs].every(Number.isFinite)||from<0||to<from||to>grid.duration_ms+0.001||countInMs<0)throw failure('metronome_invalid_window','The metronome window is invalid. Recheck the score or loop.');
  const ticks=grid.ticks.filter(tick=>tick.start_ms>=from&&tick.start_ms<to);
  const gaps=ticks.slice(1).map((tick,index)=>tick.start_ms-ticks[index].start_ms);
  if(loop&&ticks.length)gaps.push(to-ticks.at(-1).start_ms+ticks[0].start_ms-from+countInMs);
  if(gaps.some(gap=>gap<MIN_CLICK_GAP_MS-0.000001))throw failure('metronome_too_dense','These subdivisions exceed 10 clicks per second, including the loop join. Choose a coarser pulse, slower tempo or longer loop; no clicks were silently dropped.');
  return ticks;
}
function lowerBound(ticks,position){let low=0,high=ticks.length;while(low<high){const mid=(low+high)>>>1;if(ticks[mid].start_ms<position)low=mid+1;else high=mid}return low}
export class ClickScheduler {
  constructor(ticks){this.ticks=ticks;this.reset()}
  reset(){this.segment=null;this.cursor=0}
  prime(position,segment){this.segment=segment;this.cursor=lowerBound(this.ticks,position)}
  due({position,segment,startPosition,lookAhead=100}){
    if(this.segment!==segment)this.prime(startPosition,segment);
    const result=[];
    while(this.cursor<this.ticks.length&&this.ticks[this.cursor].start_ms<=position+lookAhead){
      const tick=this.ticks[this.cursor];
      if(position-tick.start_ms>MAX_LATE_MS)throw failure('metronome_late','The browser fell behind the click schedule by more than 100 ms. Clicks were stopped instead of replayed or skipped; re-enable the metronome when ready.');
      this.cursor++;result.push({...tick,delay_ms:Math.max(0,tick.start_ms-position)});
    }
    return result;
  }
}

const errorKeys = Object.freeze({metronome_invalid_response:'response',metronome_invalid_timing:'timing',metronome_invalid_window:'window',metronome_too_dense:'density',metronome_late:'late'});
const diagnosticKeys = Object.freeze({metronome_irregular_measures:'irregularMeasures',metronome_compound_policy:'compoundPolicy'});
const literal = value => typeof value === 'string' ? value : '';
const mapped = (map,code) => typeof code === 'string' && Object.hasOwn(map,code) ? map[code] : null;

export function setupMetronome({api,getScore,getDuration,getWindow,getPlayback,getCountInMs,synth,document:doc=globalThis.document,i18n=getAppI18n(doc)}) {
  const $=id=>doc.getElementById(id),t=(key,params)=>i18n.t(`input.metronome.${key}`,params);
  let controller=null,request=0,grid=null,scheduler=null,ready=false,display={kind:'off'},diagnostics=[],diagnosticNodes=[];
  const statusNode=$('metronome-status'),diagnosticList=$('metronome-diagnostics');
  const errorDetails=doc.createElement('details'),errorSummary=doc.createElement('summary'),errorBody=doc.createElement('p');
  errorDetails.id='metronome-error-details';errorDetails.hidden=true;errorDetails.append(errorSummary,errorBody);statusNode.after(errorDetails);
  errorBody.style.whiteSpace='pre-wrap';errorBody.style.overflowWrap='anywhere';statusNode.style.overflowWrap='anywhere';
  const percent=()=>i18n.formatNumber(Number($('metronome-level').value)/100,{style:'percent'});
  function label(node,key) {
    if(!node)return;
    const textNodes=[...node.childNodes].filter(child=>child.nodeType===3);
    if(textNodes.length){textNodes[0].textContent=i18n.t(key);for(const extra of textNodes.slice(1))extra.textContent='';}
    else node.append(doc.createTextNode(i18n.t(key)));
  }
  function renderControls() {
    label($('metronome-enabled').closest('label'),'ui.click-track');
    label($('metronome-pulse').closest('label'),'ui.pulse');
    label($('metronome-level').closest('label'),'ui.click-level');
    for(const [value,key] of Object.entries({notated_unit:'ui.notated-unit-6-8-six-eighth-clicks',quarter:'ui.quarter-note-one-quarter-per-click',dotted_quarter:'ui.dotted-quarter-6-8-two-compound-clicks'})) {
      const option=$('metronome-pulse').querySelector(`option[value="${value}"]`);if(option)option.textContent=i18n.t(key);
    }
    $('metronome-enabled').setAttribute('aria-label',i18n.t('ui.click-track'));
    $('metronome-pulse').setAttribute('aria-label',i18n.t('ui.pulse'));
    $('metronome-level').setAttribute('aria-label',i18n.t('ui.click-level'));
    $('metronome-level-value').textContent=percent();
    $('metronome-enabled').closest('section')?.setAttribute('aria-label',i18n.t('ui.optional-metronome.aria-label'));
    $('metronome-pulse').style.maxWidth='100%';
  }
  function renderStatus() {
    const reason=display.kind==='disabled'?t(`error.${mapped(errorKeys,display.code) || 'external'}`):'';
    const message=display.kind==='ready'?[t('ready',{count:display.count}),synth.muted?t('muted'):''].filter(Boolean).join(' '):display.kind==='disabled'?t('disabled',{reason}):t(display.kind);
    statusNode.textContent=message;statusNode.classList.toggle('error',display.kind==='disabled');
    errorDetails.hidden=!display.details;errorSummary.textContent=i18n.t('input.details');errorBody.textContent=display.details || '';
  }
  function status(kind,extra={}){display={kind,...extra};renderStatus()}
  function renderDiagnostics() {
    const shown=diagnostics.slice(0,100);
    while(diagnosticNodes.length>shown.length)diagnosticNodes.pop().li.remove();
    for(let index=0;index<shown.length;index++) {
      const diagnostic=shown[index];let nodes=diagnosticNodes[index];
      if(!nodes) {
        const li=doc.createElement('li'),summary=doc.createElement('span'),details=doc.createElement('details'),heading=doc.createElement('summary'),body=doc.createElement('p');
        details.append(heading,body);li.append(summary,details);diagnosticList.append(li);nodes={li,summary,details,heading,body};diagnosticNodes.push(nodes);
        body.style.whiteSpace='pre-wrap';body.style.overflowWrap='anywhere';
      }
      nodes.summary.textContent=t(mapped(diagnosticKeys,diagnostic?.code) || 'diagnostic');
      nodes.heading.textContent=i18n.t('input.details');nodes.body.textContent=literal(diagnostic?.message);nodes.details.hidden=!nodes.body.textContent;
      if(typeof diagnostic?.code==='string')nodes.li.dataset.code=diagnostic.code;else delete nodes.li.dataset.code;
    }
    let more=$('metronome-more-diagnostics');
    if(diagnostics.length>100){if(!more){more=doc.createElement('li');more.id='metronome-more-diagnostics';diagnosticList.append(more);}more.textContent=t('moreDiagnostics',{count:diagnostics.length-100});}
    else more?.remove();
  }
  function clearDiagnostics(){diagnostics=[];renderDiagnostics()}
  function cancel(){request++;controller?.abort();controller=null;grid=null;scheduler=null;ready=false;synth.silenceClicks()}
  function disable(error){cancel();$('metronome-enabled').checked=false;status('disabled',{code:error?.code,details:mapped(errorKeys,error?.code)?'':literal(error?.message) || literal(error)})}
  function windowOptions(){const range=getWindow();return range?{from:range.start_ms,to:range.end_ms,loop:true,countInMs:getCountInMs()}:{from:0,to:getDuration()}}
  function readyStatus(){if(ready)status('ready',{count:scheduler.ticks.length})}
  function rescope(){
    synth.silenceClicks();if(!grid||!$('metronome-enabled').checked)return;
    try{scheduler=new ClickScheduler(scopedClicks(grid,windowOptions()));const clock=getPlayback();if(clock.running)scheduler.prime(clock.position,clock.segment);ready=true;readyStatus()}
    catch(error){disable(error)}
  }
  async function prepare(){
    cancel();clearDiagnostics();
    if(!$('metronome-enabled').checked){status('off');return}
    const score=getScore();if(!score){status('noScore');return}
    const current=request,pulse=$('metronome-pulse').value;controller=new AbortController();const signal=controller.signal;
    status('preparing');
    try{
      const result=await api('/api/metronome',{score,pulse},signal);
      if(current!==request||signal.aborted||getScore()!==score)return;
      grid=validateMetronomeGrid(result,pulse,getDuration());diagnostics=grid.diagnostics;renderDiagnostics();rescope();
    }catch(error){if(current===request&&!signal.aborted)disable(error)}
    finally{if(current===request)controller=null}
  }
  function levelChanged(){$('metronome-level-value').textContent=percent();rescope()}
  $('metronome-enabled').addEventListener('change',prepare);
  $('metronome-pulse').addEventListener('change',prepare);
  $('metronome-level').addEventListener('input',levelChanged);
  $('count-in').addEventListener('change',rescope);
  // The locale observer only changes presentation. It never rebuilds a click grid or scheduler.
  const unsubscribe=i18n.subscribe(()=>{renderControls();renderStatus();renderDiagnostics()});
  renderControls();renderStatus();
  return{
    cancelForScore(){cancel();clearDiagnostics();status($('metronome-enabled').checked?'waiting':'off')},
    setScore(){if($('metronome-enabled').checked&&!grid&&!controller)prepare()},
    reset:rescope,
    pause(){synth.silenceClicks();scheduler?.reset()},
    updateMute:readyStatus,
    advance(clock){
      if(!ready||!scheduler||!$('metronome-enabled').checked||!clock.running)return;
      try{for(const tick of scheduler.due(clock))synth.click(`click:${clock.segment}:${tick.id}`,tick.accent,tick.delay_ms,Number($('metronome-level').value)/100)}
      catch(error){disable(error)}
    },
    destroy(){unsubscribe();cancel();$('metronome-enabled').removeEventListener('change',prepare);$('metronome-pulse').removeEventListener('change',prepare);$('metronome-level').removeEventListener('input',levelChanged);$('count-in').removeEventListener('change',rescope);errorDetails.remove()}
  };
}

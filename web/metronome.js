export const MIN_CLICK_GAP_MS = 100;
const MAX_LATE_MS = 100;
const MODES = new Set(['notated_unit','quarter','dotted_quarter']);

export function validateMetronomeGrid(grid, pulse, duration) {
  if(!grid||!MODES.has(pulse)||grid.pulse!==pulse||grid.accent_policy!=='written_measure_boundary'||!Array.isArray(grid.ticks)||grid.ticks.length>100000||!Array.isArray(grid.diagnostics)||!Number.isFinite(grid.duration_ms)||Math.abs(grid.duration_ms-duration)>0.001)throw Error('The Rust metronome response is incomplete or belongs to a different score.');
  const ids=new Set();let previous=-Infinity;
  for(const tick of grid.ticks){if(typeof tick.id!=='string'||!tick.id||ids.has(tick.id)||!Number.isFinite(tick.start_ms)||tick.start_ms<0||tick.start_ms>=grid.duration_ms||tick.start_ms<previous||typeof tick.accent!=='boolean')throw Error('The metronome response has invalid or duplicate pulse timing.');ids.add(tick.id);previous=tick.start_ms}
  return grid;
}
export function scopedClicks(grid,{from=0,to=grid.duration_ms,loop=false,countInMs=0}={}) {
  if(![from,to,countInMs].every(Number.isFinite)||from<0||to<from||to>grid.duration_ms+0.001||countInMs<0)throw Error('The metronome window is invalid. Recheck the score or loop.');
  const ticks=grid.ticks.filter(tick=>tick.start_ms>=from&&tick.start_ms<to);
  const gaps=ticks.slice(1).map((tick,index)=>tick.start_ms-ticks[index].start_ms);
  if(loop&&ticks.length)gaps.push(to-ticks.at(-1).start_ms+ticks[0].start_ms-from+countInMs);
  if(gaps.some(gap=>gap<MIN_CLICK_GAP_MS-0.000001))throw Error('These subdivisions exceed 10 clicks per second, including the loop join. Choose a coarser pulse, slower tempo or longer loop; no clicks were silently dropped.');
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
      if(position-tick.start_ms>MAX_LATE_MS)throw Error('The browser fell behind the click schedule by more than 100 ms. Clicks were stopped instead of replayed or skipped; re-enable the metronome when ready.');
      this.cursor++;result.push({...tick,delay_ms:Math.max(0,tick.start_ms-position)});
    }
    return result;
  }
}

export function setupMetronome({api,getScore,getDuration,getWindow,getPlayback,getCountInMs,synth}) {
  const $=id=>document.getElementById(id);
  let controller=null,request=0,grid=null,scheduler=null,ready=false;
  function status(message,error=false){$('metronome-status').textContent=message;$('metronome-status').classList.toggle('error',error)}
  function cancel(){request++;controller?.abort();controller=null;grid=null;scheduler=null;ready=false;synth.silenceClicks()}
  function disable(message){cancel();$('metronome-enabled').checked=false;status(`Click track disabled: ${message} Ordinary playback and scoring remain available.`,true)}
  function windowOptions(){const range=getWindow();return range?{from:range.start_ms,to:range.end_ms,loop:true,countInMs:getCountInMs()}:{from:0,to:getDuration()}}
  function readyStatus(){if(!ready)return;status(`${scheduler.ticks.length} Rust-timed clicks in this selection. Accents mark written measure boundaries, not inferred strong beats.${synth.muted?' Global sound is muted.':''}`)}
  function rescope(){
    synth.silenceClicks();if(!grid||!$('metronome-enabled').checked)return;
    try{scheduler=new ClickScheduler(scopedClicks(grid,windowOptions()));const clock=getPlayback();if(clock.running)scheduler.prime(clock.position,clock.segment);ready=true;readyStatus()}
    catch(error){disable(error.message)}
  }
  async function prepare(){
    cancel();$('metronome-diagnostics').replaceChildren();
    if(!$('metronome-enabled').checked){status('Off. Enable an explicit pulse when you want a click track.');return}
    const score=getScore();if(!score){status('Choose a score before enabling the click track.');return}
    const current=request,pulse=$('metronome-pulse').value;controller=new AbortController();const signal=controller.signal;
    status('Preparing optional clicks from the complete Rust score clock… Playback remains available.');
    try{
      const result=await api('/api/metronome',{score,pulse},signal);
      if(current!==request||signal.aborted||getScore()!==score)return;
      grid=validateMetronomeGrid(result,pulse,getDuration());
      for(const diagnostic of grid.diagnostics.slice(0,100)){const li=document.createElement('li');li.textContent=diagnostic.message;$('metronome-diagnostics').append(li)}
      if(grid.diagnostics.length>100){const li=document.createElement('li');li.textContent=`${grid.diagnostics.length-100} further score diagnostics are not shown here.`;$('metronome-diagnostics').append(li)}
      rescope();
    }catch(error){if(current===request&&!signal.aborted)disable(error.message)}
    finally{if(current===request)controller=null}
  }
  $('metronome-enabled').addEventListener('change',prepare);
  $('metronome-pulse').addEventListener('change',prepare);
  $('metronome-level').addEventListener('input',()=>{$('metronome-level-value').textContent=`${$('metronome-level').value}%`;rescope()});
  $('count-in').addEventListener('change',rescope);
  return{
    cancelForScore(){cancel();$('metronome-diagnostics').replaceChildren();status($('metronome-enabled').checked?'Waiting for the new score and instrument checks before preparing optional clicks…':'Off. Enable an explicit pulse when you want a click track.')},
    setScore(){if($('metronome-enabled').checked&&!grid&&!controller)prepare()},
    reset:rescope,
    pause(){synth.silenceClicks();scheduler?.reset()},
    updateMute:readyStatus,
    advance(clock){
      if(!ready||!scheduler||!$('metronome-enabled').checked||!clock.running)return;
      try{for(const tick of scheduler.due(clock))synth.click(`click:${clock.segment}:${tick.id}`,tick.accent,tick.delay_ms,Number($('metronome-level').value)/100)}
      catch(error){disable(error.message)}
    }
  };
}

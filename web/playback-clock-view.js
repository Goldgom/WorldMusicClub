/** The range is an input surface, not a lossless clock. Blink can serialize its
 * fractional value to 15 significant digits even with step="any". Publish the
 * transport's displayed time separately; retain the raw control value as-is. */
export function createPlaybackClock({positionMs,durationMs,rangeStartMs=0,rangeEndMs=durationMs,available=true,running=false,completed=false,hasStarted=false,preparing=false}) {
  const fail=()=>{throw new Error('The displayed playback clock is missing or invalid.');};
  if([positionMs,durationMs,rangeStartMs,rangeEndMs].some(value=>!Number.isFinite(value))||[available,running,completed,hasStarted,preparing].some(value=>typeof value!=='boolean'))return fail();
  if(durationMs<0||rangeStartMs<0||rangeEndMs<rangeStartMs||rangeEndMs>durationMs||running&&completed||preparing&&(running||completed)||!available&&(running||completed||preparing)||completed&&positionMs!==rangeEndMs)return fail();
  const phase=!available?'unavailable':preparing?'preparing':running?'playing':completed?'ended':hasStarted?'paused':'ready';
  return Object.freeze({version:1,available,positionMs:Math.min(durationMs,Math.max(0,positionMs)),transportPositionMs:positionMs,durationMs,rangeStartMs,rangeEndMs,running,completed,phase});
}

export function publishPlaybackClock(element,context) {
  const clock=createPlaybackClock(context);
  element.setAttribute('data-playback-clock',JSON.stringify(clock));
  return clock;
}

/** Deliberately self-contained: browser acceptance can serialize this function
 * into its page context. Missing data never falls back to range.value or zero.
 * positionMs is the legacy displayed [0, full-duration] clamp; the signed raw
 * transport sample remains available for count-in and input-grace inspection.
 * completed/phase are published transport state, never derived from position. */
export function readPlaybackClock(root=globalThis.document) {
  const element=typeof root?.getAttribute==='function'?root:root?.getElementById?.('progress');
  const raw=element?.getAttribute('data-playback-clock');
  const fail=()=>{throw new Error('The displayed playback clock is missing or invalid.');};
  if(typeof raw!=='string'||!raw.length||raw.length>1024)return fail();
  let value;try{value=JSON.parse(raw);}catch{return fail();}
  const fields=['version','available','positionMs','transportPositionMs','durationMs','rangeStartMs','rangeEndMs','running','completed','phase'];
  if(!value||Array.isArray(value)||Object.keys(value).length!==fields.length||fields.some(key=>!Object.hasOwn(value,key))||value.version!==1)return fail();
  if(['positionMs','transportPositionMs','durationMs','rangeStartMs','rangeEndMs'].some(key=>!Number.isFinite(value[key]))||['available','running','completed'].some(key=>typeof value[key]!=='boolean'))return fail();
  if(value.durationMs<0||value.rangeStartMs<0||value.rangeEndMs<value.rangeStartMs||value.rangeEndMs>value.durationMs||value.positionMs!==Math.min(value.durationMs,Math.max(0,value.transportPositionMs)))return fail();
  if(!['unavailable','preparing','playing','paused','ready','ended'].includes(value.phase)||value.running&&value.completed)return fail();
  if(!value.available?(value.phase!=='unavailable'||value.running||value.completed):value.phase==='unavailable')return fail();
  if(value.available&&((value.phase==='playing')!==value.running||(value.phase==='ended')!==value.completed))return fail();
  if(value.completed&&value.transportPositionMs!==value.rangeEndMs)return fail();
  return Object.freeze(value);
}

/** Only an actual native range endpoint maps back to the exact selected bound.
 * A detached native range supplies this browser's serialization; no fixed
 * epsilon, fixture endpoint, or decimal precision is assumed. */
export function nativeRangeSeekPosition(element,{start,end}) {
  const raw=element.value,position=Number(raw);
  if(!Number.isFinite(position)||!Number.isFinite(start)||!Number.isFinite(end)||end<start)return NaN;
  const probe=element.ownerDocument.createElement('input');
  probe.type='range';probe.min=String(start);probe.max=String(end);probe.step='any';
  probe.value=String(end);const serializedEnd=probe.value;
  probe.value=String(start);const serializedStart=probe.value;
  // Extremely short ranges may have indistinguishable native endpoints. In
  // that case only explicit Home/End can disambiguate; do not invent a side.
  if(serializedStart!==serializedEnd){
    if(raw===serializedEnd)return end;
    if(raw===serializedStart)return start;
  }
  return Math.max(start,Math.min(end,position));
}

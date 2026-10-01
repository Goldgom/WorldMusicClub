/** Convert browser event timestamps to performance.now()'s monotonic clock. */
export function normalizeEventTime(value, {now = performance.now(), timeOrigin = performance.timeOrigin} = {}) {
  return eventTimeEvidence(value, {now, timeOrigin}).eventWall;
}
export function eventTimeEvidence(value, {now = performance.now(), timeOrigin = performance.timeOrigin} = {}) {
  const fallback = {eventWall:now, receivedWall:now, rawTimestamp:Number.isFinite(value) ? value : null, timestampBasis:'receipt_fallback'};
  if (!Number.isFinite(value) || value <= 0) return fallback;
  let candidate = value;
  let timestampBasis = 'event_monotonic';
  if (value > now + 50 && Number.isFinite(timeOrigin)) { candidate = value - timeOrigin; timestampBasis = 'event_epoch'; }
  if (!Number.isFinite(candidate) || candidate < 0 || candidate > now + 50) return fallback;
  if (candidate > now) timestampBasis = 'event_clamped';
  return {eventWall:Math.min(candidate, now), receivedWall:now, rawTimestamp:value, timestampBasis};
}
export function decodeMidi(data) {
  if (!data || data.length < 3 || ![data[0],data[1],data[2]].every(value=>Number.isInteger(value)&&value>=0&&value<=255)) return null;
  const type = data[0] & 0xf0; const channel = data[0] & 0x0f;
  if(type===0xb0&&(data[1]===120||data[1]===123)&&data[2]<=127)return{kind:'panic',channel,controller:data[1]};
  if ((type !== 0x80 && type !== 0x90) || data[1] > 127 || data[2] > 127) return null;
  return {kind: type === 0x80 || data[2] === 0 ? 'off' : 'on', channel, midi: data[1], velocity: data[2]};
}

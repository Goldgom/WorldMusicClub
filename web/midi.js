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
export function setupMidi({pressNote, releaseNote, releaseMatching, notice}) {
  const button = document.getElementById('midi-button');
  let access = null; const bound = new Map();
  function attach(event) {
    const inputs = [...access.inputs.values()].filter(input => input.state !== 'disconnected');
    for (const [id, binding] of bound) if (!inputs.some(i => i.id === id)) { binding.input.onmidimessage = null; bound.delete(id); releaseMatching(`midi:${encodeURIComponent(id)}:`,event?.timeStamp,{reason:'midi_disconnected',generationToken:binding.token,inputKind:'midi'}); }
    for (const input of inputs) if (bound.get(input.id)?.input !== input) {
      if (bound.has(input.id)) { const old=bound.get(input.id);old.input.onmidimessage = null; releaseMatching(`midi:${encodeURIComponent(input.id)}:`,event?.timeStamp,{reason:'midi_replaced',generationToken:old.token,inputKind:'midi'}); }
      const token = {};
      input.onmidimessage = event => {
        const note = decodeMidi(event.data); if (!note) return;
        const identity = {generationToken:token,inputKind:'midi',channel:note.channel};
        if(note.kind==='panic'){releaseMatching(`midi:${encodeURIComponent(input.id)}:${note.channel}:`,event.timeStamp,{...identity,reason:`midi_cc${note.controller}`});return}
        const source = `midi:${encodeURIComponent(input.id)}:${note.channel}:${note.midi}`;
        const encoding=(event.data[0]&0xf0)===0x80?'midi_note_off':note.kind==='off'?'midi_zero_velocity_note_on':'midi_note_on';
        if (note.kind === 'on') pressNote(source, note.midi, note.velocity, event.timeStamp, {...identity,encoding,retrigger:true});
        else releaseNote(source,event.timeStamp,{...identity,encoding,midi:note.midi,velocity:note.velocity});
      };
      bound.set(input.id, {input,token});
    }
    button.textContent = inputs.length ? `MIDI connected · ${inputs.length}` : 'MIDI ready · Connect a device';
    button.title = inputs.map(input => input.name || 'MIDI input').join(', ');
  }
  button.addEventListener('click', async () => {
    if (access) { attach(); return; }
    if (!navigator.requestMIDIAccess) { notice('MIDI input is not available in this browser. Try a current Chrome or Edge on desktop, or use the on-screen keyboard.', true); return; }
    button.disabled = true;
    try { access = await navigator.requestMIDIAccess({sysex: false}); access.onstatechange = attach; attach(); document.getElementById('midi-help').hidden = false; }
    catch { notice('MIDI permission was not granted or the device is unavailable. You can retry with Connect MIDI or keep using the keyboard.', true); }
    finally { button.disabled = false; }
  });
  window.addEventListener('pageshow', event => { if (event.persisted && access) { access.onstatechange = attach; attach(); } });
  window.addEventListener('pagehide', event => { if (access) access.onstatechange = null; for (const {input,token} of bound.values()) { input.onmidimessage = null; releaseMatching(`midi:${encodeURIComponent(input.id)}:`,event.timeStamp,{reason:'pagehide',generationToken:token,inputKind:'midi'}); } bound.clear(); });
}

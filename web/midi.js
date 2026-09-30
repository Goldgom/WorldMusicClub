export function decodeMidi(data) {
  if (!data || data.length < 3) return null;
  const type = data[0] & 0xf0; const channel = data[0] & 0x0f;
  if ((type !== 0x80 && type !== 0x90) || data[1] > 127 || data[2] > 127) return null;
  return {kind: type === 0x80 || data[2] === 0 ? 'off' : 'on', channel, midi: data[1], velocity: data[2]};
}
export function setupMidi({pressNote, releaseNote, silenceHeld, notice}) {
  const button = document.getElementById('midi-button');
  let access = null; const bound = new Map();
  function attach() {
    const inputs = [...access.inputs.values()].filter(input => input.state !== 'disconnected');
    for (const [id, input] of bound) if (!inputs.some(i => i.id === id)) { input.onmidimessage = null; bound.delete(id); silenceHeld(); }
    for (const input of inputs) if (!bound.has(input.id)) {
      input.onmidimessage = event => { const note = decodeMidi(event.data); if (!note) return; const source = `midi:${input.id}:${note.channel}:${note.midi}`; if (note.kind === 'on') pressNote(source, note.midi, note.velocity); else releaseNote(source); };
      bound.set(input.id, input);
    }
    button.textContent = inputs.length ? `MIDI connected · ${inputs.length}` : 'MIDI ready · Connect a device';
    button.title = inputs.map(input => input.name || 'MIDI input').join(', ');
  }
  button.addEventListener('click', async () => {
    if (access) { attach(); return; }
    if (!navigator.requestMIDIAccess) { notice('MIDI input is not available in this browser. Try a current Chrome or Edge on desktop, or use the on-screen keyboard.', true); return; }
    button.disabled = true;
    try { access = await navigator.requestMIDIAccess({sysex: false}); access.onstatechange = attach; attach(); }
    catch { notice('MIDI permission was not granted or the device is unavailable. You can retry with Connect MIDI or keep using the keyboard.', true); }
    finally { button.disabled = false; }
  });
  window.addEventListener('pagehide', () => { if (access) access.onstatechange = null; for (const input of bound.values()) input.onmidimessage = null; bound.clear(); });
}

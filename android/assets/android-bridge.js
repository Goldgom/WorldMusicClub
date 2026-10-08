(() => {
  'use strict';
  const host = window.WorldMusicClubAndroid;
  if (!host || location.origin !== 'https://wmh.localhost') throw new Error('Android host unavailable');
  const originalFetch = window.fetch.bind(window), pending = new Map();
  const limit = 8 * 1024 * 1024;
  let sequence = 0;
  function encode(bytes) {
    let text = '';
    for (let i = 0; i < bytes.length; i += 8192) text += String.fromCharCode(...bytes.subarray(i, i + 8192));
    return btoa(text);
  }
  function decode(text) {
    const binary = atob(text), bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }
  Object.defineProperty(window, '__worldMusicClubReply', {value(id, wire) {
    const task = pending.get(id);
    if (!task) return;
    pending.delete(id); task.cleanup();
    try { task.resolve(new Response(decode(wire.body), {status:wire.status, headers:wire.headers})); }
    catch (error) { task.reject(error); }
  }});
  window.fetch = async (input, options) => {
    const request = input instanceof Request ? input : new Request(new URL(input, location.href));
    const normalized = new Request(request, options);
    const url = new URL(normalized.url);
    if (url.origin !== location.origin) throw new TypeError('External network requests are unavailable');
    if (!url.pathname.startsWith('/api/')) return originalFetch(normalized);
    normalized.signal.throwIfAborted();
    const bytes = new Uint8Array(await normalized.arrayBuffer());
    if (bytes.length > limit) return new Response(JSON.stringify({code:'android_request_limit',error:'Android request exceeds 8 MiB; no source was discarded'}), {status:413,headers:{'content-type':'application/json'}});
    normalized.signal.throwIfAborted();
    if (pending.size >= 16) return new Response(JSON.stringify({error:'The local engine is busy; retry shortly'}), {status:503});
    return new Promise((resolve, reject) => {
      const id = String(++sequence);
      const abort = () => { pending.delete(id); cleanup(); reject(normalized.signal.reason); };
      const cleanup = () => normalized.signal.removeEventListener('abort', abort);
      pending.set(id, {resolve,reject,cleanup});
      normalized.signal.addEventListener('abort', abort, {once:true});
      try { host.request(id, normalized.method, normalized.url, JSON.stringify(Object.fromEntries(normalized.headers)), encode(bytes)); }
      catch (error) { pending.delete(id); cleanup(); reject(error); }
    });
  };
  // Browser blob downloads become explicit Android document saves.
  const downloadable = anchor => anchor?.hasAttribute('download') && anchor.href.startsWith('blob:https://wmh.localhost/');
  async function save(anchor) {
    try {
      const response = await originalFetch(anchor.href), blob = await response.blob();
      if (blob.size > 32 * 1024 * 1024) throw new Error('Android export exceeds 32 MiB');
      host.saveFile(anchor.download || 'worldmusicclub-export', blob.type || 'application/octet-stream', encode(new Uint8Array(await blob.arrayBuffer())));
    } catch (error) { alert(error.message); }
  }
  const click = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    if (downloadable(this)) { void save(this); return; }
    return click.call(this);
  };
  document.addEventListener('click', event => {
    const anchor = event.target.closest?.('a[download]');
    if (!downloadable(anchor)) return;
    event.preventDefault(); void save(anchor);
  }, true);
})();

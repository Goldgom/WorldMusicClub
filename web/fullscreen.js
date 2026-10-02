import {getAppI18n} from './app-locale.js';

const icons = {
  enter: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false"><path d="M9 4H4v5m11-5h5v5M4 15v5h5m11-5v5h-5"/></svg>',
  exit: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false"><path d="M4 9h5V4m6 0v5h5M9 20v-5H4m16 0h-5v5"/></svg>',
};

/** Browser presentation only: this controller never starts, pauses or resets a take. */
export function setupFullscreen({document: doc = globalThis.document, button, status, timeoutMs = 8000, setTimer = setTimeout, clearTimer = clearTimeout, i18n = getAppI18n(doc)}) {
  const root = doc.documentElement, view = doc.defaultView;
  let pending = null, entry = null, messageTimer = null, away = false, disposed = false, lastFullscreen = doc.fullscreenElement, messageCode = null;
  const capable = () => typeof root.requestFullscreen === 'function' && typeof doc.exitFullscreen === 'function' && doc.fullscreenEnabled === true;
  const modalOpen = () => Boolean(doc.querySelector('dialog[open]'));

  function message(code) {
    clearTimer(messageTimer);
    messageCode = code || null;
    status.textContent = messageCode ? i18n.t(messageCode) : '';
    messageTimer = messageCode ? setTimer(() => { messageCode = null; status.textContent = ''; }, 6000) : null;
  }
  function render() {
    const active = Boolean(doc.fullscreenElement), action = active ? 'exit' : 'enter';
    const available = active ? typeof doc.exitFullscreen === 'function' : capable();
    const label = i18n.t(active ? 'fullscreen.exit' : 'fullscreen.enter');
    if (button.dataset.fullscreenAction !== action) {
      button.innerHTML = icons[action];
      button.dataset.fullscreenAction = action;
    }
    button.setAttribute('aria-label', label);
    button.setAttribute('aria-disabled', String(Boolean(pending) || !available));
    button.setAttribute('aria-busy', String(Boolean(pending)));
    button.title = i18n.t(available ? active ? 'fullscreen.exitTitle' : 'fullscreen.enter' : 'fullscreen.unavailable');
    status.textContent = messageCode ? i18n.t(messageCode) : '';
  }
  function release(operation) {
    clearTimer(operation.timer);
    if (pending === operation) pending = null;
  }
  function sync() {
    if (disposed) return;
    if (lastFullscreen !== doc.fullscreenElement) {
      lastFullscreen = doc.fullscreenElement;
      message('');
    }
    // A modal opened before a late fullscreen entry can otherwise end up below
    // the new fullscreen top-layer item. Preserve it and undo only our entry.
    if (entry && doc.fullscreenElement === root) {
      const operation = entry;
      entry = null;
      release(operation);
      if (operation.cancelled || away || doc.hidden || modalOpen()) {
        start('exit', true);
        return;
      }
    }
    if (pending?.kind === 'exit' && !doc.fullscreenElement) release(pending);
    render();
  }
  function finish(operation, error) {
    if (disposed) return;
    const current = pending === operation || entry === operation;
    release(operation);
    sync();
    if (entry === operation) entry = null;
    if (current && error && !operation.cancelled) {
      // Escape can complete an exit before that exit promise rejects.
      if (operation.kind === 'enter' && !doc.fullscreenElement) message('fullscreen.enterFailed');
      if (operation.kind === 'exit' && doc.fullscreenElement) message('fullscreen.exitFailed');
    }
    render();
  }
  function start(kind, recovery = false) {
    const operation = {kind, cancelled: false, timer: null};
    pending = operation;
    if (kind === 'enter') entry = operation;
    operation.timer = setTimer(() => {
      if (pending !== operation || disposed) return;
      operation.cancelled = true;
      release(operation);
      message(kind === 'enter'
        ? 'fullscreen.enterTimeout'
        : 'fullscreen.exitTimeout');
      sync();
    }, timeoutMs);
    render();
    if (recovery) message('fullscreen.recovery');
    try {
      // Keep the browser call in the native click stack: no fetch/audio/await
      // precedes it and no keyboard or orientation lock is requested.
      const result = kind === 'enter' ? root.requestFullscreen() : doc.exitFullscreen();
      Promise.resolve(result).then(() => finish(operation), error => finish(operation, error));
    } catch (error) { finish(operation, error); }
  }
  function toggle() {
    if (disposed || away) return;
    sync();
    if (pending) return;
    message('');
    if (doc.fullscreenElement && typeof doc.exitFullscreen === 'function') { start('exit'); return; }
    // A timed-out request cannot be aborted. Do not overlap it with a second
    // entry whose browser events would be indistinguishable from the old one.
    if (entry) { message('fullscreen.earlierPending'); return; }
    if (!capable()) { message('fullscreen.unavailable'); return; }
    if (doc.hidden || modalOpen()) return;
    start('enter');
  }
  function escape(event) {
    if (event.key !== 'Escape' || !entry) return;
    entry.cancelled = true;
    release(entry);
    message('fullscreen.cancelled');
    sync();
    // Never prevent Escape: the browser and any open native dialog keep it.
  }
  function hidden() { if (doc.hidden && entry) entry.cancelled = true; sync(); }
  function pagehide() {
    away = true;
    if (entry) entry.cancelled = true;
    if (pending) { pending.cancelled = true; release(pending); }
    message('');
    render();
  }
  function pageshow() { away = false; sync(); }
  button.addEventListener('click', toggle);
  doc.addEventListener('fullscreenchange', sync);
  doc.addEventListener('keydown', escape);
  doc.addEventListener('visibilitychange', hidden);
  view?.addEventListener('pagehide', pagehide);
  view?.addEventListener('pageshow', pageshow);
  render();
  // A locale redraw reads browser state only; it must never call sync/start.
  const unsubscribe = i18n.subscribe(render);
  return {destroy() {
    if (disposed) return;
    disposed = true;
    unsubscribe();
    if (pending) release(pending);
    clearTimer(messageTimer);
    button.removeEventListener('click', toggle);
    doc.removeEventListener('fullscreenchange', sync);
    doc.removeEventListener('keydown', escape);
    doc.removeEventListener('visibilitychange', hidden);
    view?.removeEventListener('pagehide', pagehide);
    view?.removeEventListener('pageshow', pageshow);
  }};
}

const icons = {
  enter: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false"><path d="M9 4H4v5m11-5h5v5M4 15v5h5m11-5v5h-5"/></svg>',
  exit: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false"><path d="M4 9h5V4m6 0v5h5M9 20v-5H4m16 0h-5v5"/></svg>',
};

/** Browser presentation only: this controller never starts, pauses or resets a take. */
export function setupFullscreen({document: doc = globalThis.document, button, status, timeoutMs = 8000, setTimer = setTimeout, clearTimer = clearTimeout}) {
  const root = doc.documentElement, view = doc.defaultView;
  let pending = null, entry = null, messageTimer = null, away = false, disposed = false, lastFullscreen = doc.fullscreenElement;
  const capable = () => typeof root.requestFullscreen === 'function' && typeof doc.exitFullscreen === 'function' && doc.fullscreenEnabled === true;
  const modalOpen = () => Boolean(doc.querySelector('dialog[open]'));

  function message(text) {
    clearTimer(messageTimer);
    status.textContent = text;
    messageTimer = text ? setTimer(() => { status.textContent = ''; }, 6000) : null;
  }
  function render() {
    const active = Boolean(doc.fullscreenElement), action = active ? 'exit' : 'enter';
    const available = active ? typeof doc.exitFullscreen === 'function' : capable();
    const label = active ? 'Exit fullscreen · 退出全屏' : 'Enter fullscreen · 进入全屏';
    if (button.dataset.fullscreenAction !== action) {
      button.innerHTML = icons[action];
      button.dataset.fullscreenAction = action;
    }
    button.setAttribute('aria-label', label);
    button.setAttribute('aria-disabled', String(Boolean(pending) || !available));
    button.setAttribute('aria-busy', String(Boolean(pending)));
    button.title = available ? `${label}${active ? ' (Esc)' : ''}` : 'Fullscreen is unavailable in this browser or window · 当前浏览器或窗口不支持全屏';
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
      if (operation.kind === 'enter' && !doc.fullscreenElement) message('Could not enter fullscreen. You can keep playing and try again. · 无法进入全屏，可继续演奏或重试');
      if (operation.kind === 'exit' && doc.fullscreenElement) message('Could not exit fullscreen. Press Esc or try again. · 无法退出全屏，请按 Esc 或重试');
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
        ? 'Fullscreen did not finish. You can keep using the app. · 全屏请求未完成，可继续使用'
        : 'Fullscreen exit did not finish. Press Esc or try again. · 退出全屏未完成，请按 Esc 或重试');
      sync();
    }, timeoutMs);
    render();
    if (recovery) message('Fullscreen entry cancelled; your current view is preserved. · 已取消全屏，保留当前界面');
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
    if (entry) { message('The earlier fullscreen request is still finishing. You can keep using the app. · 上次全屏请求仍在处理，可继续使用'); return; }
    if (!capable()) { message('Fullscreen is unavailable in this browser or window. · 当前浏览器或窗口不支持全屏'); return; }
    if (doc.hidden || modalOpen()) return;
    start('enter');
  }
  function escape(event) {
    if (event.key !== 'Escape' || !entry) return;
    entry.cancelled = true;
    release(entry);
    message('Fullscreen entry cancelled. · 已取消进入全屏');
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
  return {destroy() {
    disposed = true;
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

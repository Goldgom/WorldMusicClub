/** Yield between indivisible OSMD phases. Resolving inside requestAnimationFrame
 * would run the next phase as a microtask before the browser can finish its frame.
 * A task queued by that frame leaves animation callbacks and paint a turn first.
 *
 * One foreground renderer owns at most one pending frame OR timer. There is no
 * speculative queue/cache and no audio-clock dependency. Hidden tabs naturally
 * defer visual work; disposing still settles a pending wait immediately.
 */
export function createEngravingRenderScheduler(view = globalThis) {
  const hasFrames = typeof view.requestAnimationFrame === 'function' && typeof view.cancelAnimationFrame === 'function';
  const setTimer = typeof view.setTimeout === 'function' ? view.setTimeout.bind(view) : setTimeout;
  const clearTimer = typeof view.clearTimeout === 'function' ? view.clearTimeout.bind(view) : clearTimeout;
  let pending = null, disposed = false;
  function finish(value) {
    const wait = pending;
    if (!wait) return;
    pending = null;
    if (wait.frame !== null) view.cancelAnimationFrame(wait.frame);
    if (wait.timer !== null) clearTimer(wait.timer);
    wait.resolve(value);
  }
  return {
    yield() {
      if (disposed) return Promise.resolve(false);
      if (pending) return pending.promise;
      const wait = {frame: null, timer: null, resolve: null, promise: null};
      wait.promise = new Promise(resolve => { wait.resolve = resolve; });
      pending = wait;
      const queueTask = () => {
        wait.frame = null;
        if (pending !== wait || disposed) return;
        wait.timer = setTimer(() => { wait.timer = null; finish(true); }, 0);
      };
      if (hasFrames) wait.frame = view.requestAnimationFrame(queueTask);
      else queueTask();
      return wait.promise;
    },
    dispose() { disposed = true; finish(false); },
  };
}

// Main-thread ownership only. This gate never chooses or advances an audio
// clock: pending audio admission takes priority over new notation work.
const coordinators = new WeakMap();
const failure = message => Object.assign(new Error(message), {code: 'clean_audio_unavailable'});
export function notationAudioAdmission(view = globalThis) {
  if (coordinators.has(view)) return coordinators.get(view);
  const visuals = new Set(), audioQueue = [], visualQueue = [];
  let audio = null;
  function visualLease() {
    if (visuals.size >= 256) throw failure('The bounded notation preparation ownership limit is full.');
    let released = false;
    const lease = {
      error: null,
      fail(error) { if (!released) { lease.error = error; pump(); } },
      release() { if (released) return; released = true; visuals.delete(lease); pump(); },
      retainUntil(promise) {
        if (released) throw failure('The notation preparation is no longer owned.');
        const retained = visualLease();
        Promise.resolve(promise).then(retained.release, retained.release);
        return retained;
      },
    };
    visuals.add(lease); return lease;
  }
  function settle(wait, value, error) {
    wait.signal?.removeEventListener('abort', wait.abort);
    if (error) wait.reject(error); else wait.resolve(value);
  }
  function pump() {
    const blocked = [...visuals].find(lease => lease.error)?.error;
    if (blocked) while (audioQueue.length) settle(audioQueue.shift(), null, blocked);
    if (audio) return;
    if (audioQueue.length) {
      if (visuals.size) return;
      const wait = audioQueue.shift(); let released = false;
      const lease = {release() { if (released) return; released = true; wait.signal?.removeEventListener('abort', lease.release); audio = null; pump(); }};
      audio = lease; settle(wait, lease); wait.signal?.addEventListener('abort', lease.release, {once: true});
      if (wait.signal?.aborted) lease.release();
      return;
    }
    while (visualQueue.length && visuals.size < 256) settle(visualQueue.shift(), visualLease());
  }
  function acquire(queue, signal, limit) {
    if (signal?.aborted) return Promise.resolve(null);
    if (queue.length >= limit) return Promise.reject(failure('The bounded notation/audio admission queue is full.'));
    return new Promise((resolve, reject) => {
      const wait = {resolve, reject, signal, abort: null};
      wait.abort = () => { const index = queue.indexOf(wait); if (index >= 0) { queue.splice(index, 1); settle(wait, null); pump(); } };
      queue.push(wait); signal?.addEventListener('abort', wait.abort, {once: true}); pump();
    });
  }
  const coordinator = {
    acquireAudio: signal => acquire(audioQueue, signal, 32),
    acquireVisual: signal => acquire(visualQueue, signal, 256),
    tryVisual: () => audio || audioQueue.length || visuals.size >= 256 ? null : visualLease(),
    async prepareVisual(operation, signal) {
      const lease = coordinator.tryVisual() ?? await coordinator.acquireVisual(signal);
      if (!lease) return null;
      try { if (signal?.aborted) return null; return await operation(); }
      finally { lease.release(); }
    },
  };
  coordinators.set(view, coordinator); return coordinator;
}

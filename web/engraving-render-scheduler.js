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

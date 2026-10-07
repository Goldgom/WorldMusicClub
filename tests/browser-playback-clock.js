import {readPlaybackClock} from '../web/playback-clock-view.js';

export {readPlaybackClock};

// Install the production reader itself: Playwright callbacks cannot capture an
// imported lexical binding. The init script also preserves the reader on reload.
export async function installPlaybackClockReader(page) {
  const content = `globalThis.__wmhReadPlaybackClock = (${readPlaybackClock.toString()});`;
  await page.addInitScript({content});
  await page.evaluate(content);
}

// Navigation can finish before the app publishes its first observation. Missing
// metadata is pending; published metadata must satisfy the strict reader now.
export async function waitForPlaybackClock(page) {
  const ready = await page.waitForFunction(() => {
    const progress = document.getElementById('progress');
    if (!progress || progress.getAttribute('data-playback-clock') === null) return false;
    globalThis.__wmhReadPlaybackClock(progress);
    return true;
  });
  await ready.dispose();
}

// A successful Play click may still precede the renderer's 50 ms start anchor.
// Input fixtures must observe actual source-clock progress before capturing an
// in-take event; resume callers pass the position observed before clicking Play.
export async function waitForPlaybackClockAdvance(page, previousPositionMs = 0) {
  const advanced = await page.waitForFunction(previous => {
    const clock = globalThis.__wmhReadPlaybackClock();
    return clock.available && clock.running && clock.phase === 'playing' && clock.positionMs > previous;
  }, previousPositionMs);
  await advanced.dispose();
}

// Sample the real wall timestamp alongside the published in-range clock in
// one page turn. A later evaluate() can run after a short take has ended, and
// an advancing display may be in post-end grace. The exported pass segments
// remain the final ownership proof; a display snapshot is not a fresh audio read.
export async function capturePlaybackEventTime(page) {
  const captured = await page.waitForFunction(() => {
    const clock = globalThis.__wmhReadPlaybackClock();
    if (!clock.available || !clock.running || clock.phase !== 'playing'
      || clock.transportPositionMs <= clock.rangeStartMs || clock.transportPositionMs >= clock.rangeEndMs) return false;
    return {eventWall:performance.now(),clock};
  });
  try { return await captured.jsonValue(); }
  finally { await captured.dispose(); }
}

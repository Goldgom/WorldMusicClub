import {readPlaybackClock} from '../web/playback-clock-view.js';

export {readPlaybackClock};

// Install the production reader itself: Playwright callbacks cannot capture an
// imported lexical binding. The init script also preserves the reader on reload.
export async function installPlaybackClockReader(page) {
  const content = `globalThis.__wmhReadPlaybackClock = (${readPlaybackClock.toString()});`;
  await page.addInitScript({content});
  await page.evaluate(content);
}

import assert from 'node:assert/strict';

// Import compiles the active source without leaving Home. The global Settings
// dialog also preserves that screen. Reach the imported session through visible
// navigation before using stage Mod; Start would activate the preview instead.
export async function resumePartActivityStage(page, title) {
  if (await page.locator('#game-home').isVisible()) await page.locator('#home-single-player').click();
  if (await page.locator('#song-lobby').isVisible()) await page.locator('#resume-session').click();
  await page.locator('#edit-song-mod').waitFor({state:'visible'});
  assert.equal(await page.locator('#stage-title').textContent(), title, 'Resume must preserve the imported activity source');
}

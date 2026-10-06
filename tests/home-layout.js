import assert from 'node:assert/strict';

export const homeModeIds = ['home-single-player', 'home-song-authoring', 'home-collaboration', 'home-online', 'home-appearance', 'home-settings'];
export const homeFocusIds = ['home-single-player', 'home-song-authoring', 'home-appearance', 'home-settings', 'start-free-practice'];
export const HOME_LAYOUT_PREVIEW_CASE = 'real home cards stay reachable without footer overlap at native, compact and long-label sizes';
const sizes = [
  {width:1024, height:689}, // Native 1040x728 PNG: 8px sides, 31px title, 8px bottom.
  {width:1024, height:697}, {width:1280, height:720}, {width:844, height:390},
  {width:390, height:844}, {width:1920, height:1080},
  {width:512, height:345, reflow:'200%-equivalent CSS viewport, not native WebView zoom'},
];
export const HOME_LAYOUT_CASES = [
  ...sizes.flatMap(viewport => ['zh-CN', 'en'].map(locale => ({viewport, locale, theme:locale === 'en' ? 'dark' : 'light', reducedMotion:'no-preference'}))),
  ...['zh-CN', 'en'].map(locale => ({viewport:{width:390,height:844}, locale, theme:'custom', reducedMotion:'reduce', longLabels:true})),
];
export const homeLayoutScreenshotNames = config => ['top', 'settings', 'footer'].map(phase => `worldmusichub-home-layout-${config.viewport.width}x${config.viewport.height}-${config.locale}${config.longLabels ? '-long' : ''}-${phase}.png`);

const intersects = (a, b) => a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;
const finiteRect = value => {
  for (const key of ['left', 'top', 'right', 'bottom']) assert.ok(Number.isFinite(value[key]), `Rectangle ${key} must be finite`);
  assert.ok(value.right > value.left && value.bottom > value.top, 'Rectangle must have positive area');
};

// Consumes observed browser rectangles, including offscreen content in the home
// scroller. Model fixtures test this assertion; they are not pixel acceptance.
export function assertHomeLayout(row) {
  assert.equal(row.screen, 'home');
  finiteRect(row.intro); finiteRect(row.free);
  assert.deepEqual(row.cards.map(card => card.id), homeModeIds);
  assert.deepEqual(row.cards.filter(card => card.disabled).map(card => card.id), ['home-collaboration', 'home-online']);
  assert.ok(row.home.scrollWidth <= row.home.clientWidth + 1, 'Home must not require horizontal scrolling');
  assert.ok(row.documentWidth <= row.viewport.width + 1, 'Home must not widen the document');
  assert.ok(row.free.top >= row.intro.bottom + 1, 'Free Practice follows the full intro in normal flow');
  for (const card of row.cards) {
    finiteRect(card);
    assert.ok(card.width >= 44 && card.height >= 40, `${card.id} retains its complete target`);
    assert.ok(card.top >= row.intro.top - 1 && card.bottom <= row.intro.bottom + 1, `${card.id} fits inside the intro`);
    assert.ok(!intersects(card, row.free), `${card.id} is not covered by Free Practice`);
    assert.equal(card.text.length, 2, `${card.id} retains title and description geometry`);
    assert.equal(Boolean(card.badge), card.disabled, `${card.id} retains its planned status`);
    if (card.badge) finiteRect(card.badge);
    for (const text of card.text) {
      finiteRect(text);
      assert.ok(text.left >= card.left - 1 && text.right <= card.right + 1 && text.top >= card.top - 1 && text.bottom <= card.bottom + 1, `${card.id} shows its complete label`);
      if (card.badge) assert.ok(!intersects(text, card.badge), `${card.id} label does not collide with its planned badge`);
    }
  }
  for (let a = 0; a < row.cards.length; a++) for (let b = a + 1; b < row.cards.length; b++) {
    assert.ok(!intersects(row.cards[a], row.cards[b]), `${row.cards[a].id} and ${row.cards[b].id} do not overlap`);
  }
}

export function assertHomeTargetVisible(target) {
  assert.equal(target.hits.length, 5, `${target.id} requires four corner samples and one center sample`);
  assert.ok(target.hits.every(hit => hit === true), `${target.id} owns its corners and center after scrolling`);
  finiteRect(target); finiteRect(target.clip);
  assert.ok(target.right-target.left >= 44 && target.bottom-target.top >= 40, `${target.id} retains a usable target after scrolling`);
  assert.ok(target.top >= target.clip.top - 1 && target.bottom <= target.clip.bottom + 1, `${target.id} is fully reachable vertically`);
  assert.ok(target.left >= target.clip.left - 1 && target.right <= target.clip.right + 1, `${target.id} is fully reachable horizontally`);
}

export function assertHomeLayoutReport(report) {
  assert.equal(report.version, 1); assert.equal(report.ok, true);
  assert.equal(report.scope, 'actual-hosted-home-layout'); assert.equal(report.originalFixturesOnly, true);
  assert.equal(report.nativeWebviewZoomVerified, false); assert.equal(report.error, undefined);
  assert.deepEqual(report.evidence.map(row => row.config), HOME_LAYOUT_CASES, 'Require the complete ordered sixteen-configuration matrix');
  for (const row of report.evidence) {
    const {width, height} = row.config.viewport;
    assert.deepEqual(row.viewport, {width, height});
    assert.deepEqual(row.observed, {locale:row.config.locale, theme:row.config.theme, reducedMotion:row.config.reducedMotion});
    assert.deepEqual(row.targets.map(target => target.id), [...homeModeIds, 'start-free-practice']);
    assert.deepEqual(row.keyboard.map(target => target.id), homeFocusIds);
    assertHomeLayout(row);
    for (const target of row.targets) assertHomeTargetVisible(target);
    for (const focus of row.keyboard) {
      assert.equal(focus.visible, true); assert.ok(Number.isFinite(focus.outlineWidth) && focus.outlineWidth >= 3);
      assert.equal(focus.target.id, focus.id); assertHomeTargetVisible(focus.target);
    }
    assert.equal(row.settingsOpened, true);
    assert.deepEqual(row.settingsActivation, {control:'home-settings', trusted:true, dialog:'settings-dialog', open:true});
    assert.deepEqual(row.screenshots.map(shot => shot.name), homeLayoutScreenshotNames(row.config));
    for (const shot of row.screenshots) {
      assert.ok(Number.isSafeInteger(shot.bytes) && shot.bytes > 0); assert.match(shot.sha256, /^[0-9a-f]{64}$/);
      assert.equal(shot.width, width); assert.equal(shot.height, height);
    }
    if (row.config.longLabels) for (const card of row.cards) for (const text of card.text) {
      assert.ok(text.content.endsWith(row.config.locale === 'en' ? ' · extended appearance and performance configuration' : ' · 更多外观与音乐演奏配置选项'), 'Long-label rows must contain the actual stress labels');
    }
  }
}

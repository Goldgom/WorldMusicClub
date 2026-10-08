import assert from 'node:assert/strict';
import {originalBrowserSkin, originalSkinScore} from './skin-browser-fixture.js';
import {validateLiveToneNavigation} from './live-tone-navigation-proof.js';
import {validateLiveToneCleanup} from '../scripts/live-tone-proof.mjs';

export const SKIN_BROWSER_CASES = Object.freeze([
  Object.freeze({name: 'real skin UI import preserves paused input and finite live worklet silence', file: 'worldmusichub-skin-interaction.json'}),
  Object.freeze({name: 'real skin selection survives closing and reopening the same browser profile', file: 'worldmusichub-skin-persistence.json'}),
]);
export const SKIN_SCREENSHOTS = Object.freeze([
  'worldmusichub-skin-stage-builtin.png', 'worldmusichub-skin-settings-en.png', 'worldmusichub-skin-settings-zh-CN.png',
  'worldmusichub-skin-stage-active-en.png', 'worldmusichub-skin-profile-imported.png', 'worldmusichub-skin-profile-default.png',
]);
const digest = value => assert.match(value, /^[0-9a-f]{64}$/);
const skin = originalBrowserSkin();

export function assertStoredBrowserSkin(record, selected = 'imported') {
  assert.equal(record.version, 1);assert.equal(record.selected, selected);
  assert.equal(record.manifest, skin.json.toString());assert.equal(record.manifestSha256, skin.jsonSha256);
  assert.deepEqual(record.resources, [{path: 'assets/checker.png', bytes: skin.png.length, sha256: skin.pngSha256}]);
}
function selected(settings, value = 'imported') {
  assert.equal(settings.selected, value);assert.equal(settings.choice, value);
  assert.equal(settings.active, value === 'imported' ? skin.manifest.id : null);assert.equal(settings.importedDisabled, false);
}
function screenshotRows(rows, names) {
  assert.deepEqual(rows.map(row => row.name), names);
  for (const row of rows) { digest(row.sha256);assert.ok(Number.isSafeInteger(row.bytes) && row.bytes > 1000);assert.equal(row.width, 1280);assert.ok(row.height >= 720); }
}
function header(report, kind) {
  assert.equal(report.version, 1);assert.equal(report.kind, kind);assert.equal(report.ok, true);
  assert.equal(report.originalFixturesOnly, true);assert.equal(report.physicalAudio, false);
  assert.equal(report.error, undefined);assert.equal(report.failedAudio, undefined);
}

export function assertSkinPresentation(report) {
  assert.deepEqual(report.fixture, {id: skin.manifest.id, manifestSha256: skin.jsonSha256, pngSha256: skin.pngSha256});
  assert.equal(report.imported.locale, 'en');assert.equal(report.imported.title, 'Piano skin');selected(report.imported);
  assert.match(report.imported.status, /selected and saved/);assert.match(report.imported.scope, /home artwork only/);
  assert.match(report.imported.diagnostics, /Stage background images are unsupported/);assert.match(report.imported.diagnostics, /layout settings are unsupported/);
  assert.deepEqual(report.imported.legend, [{role:'human',marker:'square',pattern:'solid'},{role:'machine',marker:'triangle',pattern:'solid'}]);
  selected(report.invalid);assert.match(report.invalid.status, /not changed.*JSON/);
  selected(report.storageFailure);assert.match(report.storageFailure.status, /not changed.*storage/);
  const replacement = originalBrowserSkin({replacement:true});
  assert.deepEqual(report.attemptedReplacement, {id:replacement.manifest.id,manifestSha256:replacement.jsonSha256,pngSha256:replacement.pngSha256});
  assert.notEqual(report.attemptedReplacement.id, report.fixture.id);assert.notEqual(report.attemptedReplacement.pngSha256, report.fixture.pngSha256);
  assert.equal(report.imported.presentation['--skin-human-fill'], '#FBBF24');assert.equal(report.imported.presentation['--skin-machine-fill'], '#67E8F9');
  assert.equal(report.imported.presentation['--skin-key-white'], '#F8FAFC');assert.match(report.imported.presentation['--skin-background-image'], /^url\("blob:/);
  assert.deepEqual(report.invalid.presentation, report.imported.presentation);assert.deepEqual(report.storageFailure.presentation, report.imported.presentation);
  assert.deepEqual(report.fault, {method: 'native-indexeddb-write-transaction-abort', aborted: 1});
  for (const key of ['storedImported','storedAfterInvalid','storedAfterFailure']) assertStoredBrowserSkin(report[key]);
  selected(report.reset, 'default');assert.match(report.reset.status, /imported skin is still available/);assertStoredBrowserSkin(report.storedReset, 'default');selected(report.reselected);
  selected(report.chinese);assert.equal(report.chinese.locale, 'zh-CN');assert.equal(report.chinese.title, '钢琴皮肤');
  assert.match(report.chinese.status, /已使用导入皮肤/);assert.match(report.chinese.scope, /背景图片仅用于首页装饰/);assert.match(report.chinese.diagnostics, /不支持谱面区域背景图片/);
  assert.equal(report.themeBefore, report.themeAfter);assert.equal(JSON.parse(report.themeBefore).mode, 'custom');
  for (const key of ['imported','invalid','storageFailure','reset','reselected','chinese']) assert.equal(report[key].theme, report.themeBefore);
  assert.deepEqual(report.skinRequests, [], 'Skin controls and locale must not recompile, import, or replay the source');
  assert.deepEqual(report.readyGeometryAfter, report.readyGeometryBefore);assert.equal(report.readyGeometryAfter.sameKeyNodes, true);
  assert.equal(report.readyGeometryBefore.activity, null, 'Before first Play there is no admitted activity slot');
  assert.deepEqual(report.readyGeometryBefore.activityRows, []);
  for(const [geometry,phase]of [[report.readyGeometryBefore,'ready'],[report.geometryBefore,'paused']]){
    assert.equal(geometry.clock.phase,phase);assert.equal(geometry.clock.running,false);assert.equal(geometry.clock.completed,false);assert.equal(geometry.clock.available,true);
    assert.ok(Number.isFinite(geometry.clock.positionMs));assert.ok(phase==='ready'?geometry.clock.positionMs===0:geometry.clock.positionMs>0);
  }
  assert.ok(report.geometryBefore.activityRows.length>0);assert.ok(report.geometryBefore.activityRows.every(row=>typeof row.partId==='string'&&row.partId.length>0&&row.state==='paused'));
  assert.deepEqual(report.geometryAfter, report.geometryBefore);assert.equal(report.geometryAfter.sameKeyNodes, true);
  const activity=report.geometryBefore.activity;assert.ok(activity&&activity.width>0&&activity.height>0&&activity.x>=0&&activity.y>=0&&activity.x+activity.width<=1281&&activity.y+activity.height<=721, 'Paused admitted activity remains visible for both skins');
  assert.deepEqual(report.geometryAfter.viewport, {width: 1280, height: 720});assert.ok(report.geometryAfter.keys.length >= 49);
  for (const name of ['canvas','keyboard','transport']) { const r = report.geometryAfter[name];assert.ok(r.width > 0 && r.height > 0 && r.x >= -1 && r.y >= -1 && r.x+r.width <= 1281 && r.y+r.height <= 721, `${name} must remain visible`); }
  const paint = report.paint;assert.equal(paint.skin, skin.manifest.id);assert.equal(paint.labels, 'true');
  assert.equal(paint.humanIds.length, 1);assert.equal(paint.machineIds.length, 1);assert.notEqual(paint.humanIds[0], paint.machineIds[0]);
  for (const color of ['#fbbf24','#67e8f9']) assert.ok(paint.fillPixels[color] >= 50, `${color} must be painted by real canvas notes`);
  assert.equal(paint.keys.find(key => key.midi === 62).background, 'rgb(248, 250, 252)');
  assert.equal(paint.keys.find(key => key.midi === 61).background, 'rgb(17, 17, 17)');
  assert.deepEqual(report.pressed, {pressed: 'true', background: 'rgb(37, 99, 235)'});
  assert.deepEqual(paint.markers.map(row => row.midi), [60,67]);
  for (const marker of paint.markers) {
    assert.equal(marker.pixels.length, 49);assert.equal(new Set(marker.pixels.map(pixel => `${pixel.x},${pixel.y}`)).size,49);
    assert.equal(marker.foregroundPixels, marker.pixels.filter(pixel => pixel.alpha === 255 && pixel.color === '#111111').length);
    assert.ok(marker.foregroundPixels >= 10, 'Each role marker must have visible opaque pixels');
  }
  assert.ok(paint.markers[0].foregroundPixels >= 40, 'The human square keeps its independent marker band');
  assert.ok(paint.markers[1].foregroundPixels < paint.markers[0].foregroundPixels - 5, 'The accompaniment triangle is visibly distinct from the human square');
  assert.equal(paint.laneBackground, 'none');assert.match(paint.homeImage, /^url\("blob:/);assert.equal(paint.homeAriaHidden, 'true');
  assert.deepEqual(report.homeDecoration, {image:true,width:16,height:16,opacity:'0.2',pointerEvents:'none',ariaHidden:'true'});
  screenshotRows(report.screenshots, SKIN_SCREENSHOTS.slice(0,4));
}

export function validateSkinInteractionReport(report) {
  header(report, 'interaction');assert.equal(report.audioScope, 'finite-checkpoint-windows');assert.equal(report.route, 'settings');assert.equal(report.release, 'keyup');
  assertSkinPresentation(report);
  assert.deepEqual(report.scoreBefore, originalSkinScore());assert.deepEqual(report.scoreAfter, report.scoreBefore);
  assert.ok(Number.isFinite(report.pausedBefore.position) && report.pausedBefore.position > 0 && report.pausedBefore.position < 8000);
  assert.equal(report.pausedBefore.mode, 'practice');assert.equal(report.pausedBefore.captured, '1');assert.deepEqual(report.pausedAfter, report.pausedBefore);
  validateLiveToneNavigation(report.audio, report);validateLiveToneCleanup(report.cleanup?.live);
  assert.deepEqual(report.cleanup?.source, {restored:true,overflow:false,errors:[],cleanupErrors:[]});
  return report;
}

export function validateSkinPersistenceReport(report) {
  header(report, 'persistence');assert.equal(report.scope, 'same-origin-same-Chromium-user-data-directory');digest(report.profileId);
  assert.deepEqual(report.pageErrors, []);assert.deepEqual(report.apiFailures, []);assert.equal(report.rounds.length, 3);
  assert.equal(new Set(report.rounds.map(round => round.origin)).size, 1);
  const [first, second, third] = report.rounds;
  for (const [i, round] of report.rounds.entries()) {
    assert.match(round.origin, /^http:\/\/127\.0\.0\.1:\d+$/);assert.equal(round.profileId, report.profileId);
    assert.equal(round.newContext, true);assert.equal(round.pageClosed, true);assert.equal(round.priorPageClosed, i === 0 ? null : true);
    selected(round.settings, i === 2 ? 'default' : 'imported');assertStoredBrowserSkin(round.stored, i === 2 ? 'default' : 'imported');
  }
  assert.equal(first.settings.locale, 'en');assert.equal(second.settings.locale, 'en');assert.equal(third.settings.locale, 'zh-CN');
  assert.deepEqual(second.decoration, {image:true,width:16,height:16,opacity:'0.2',pointerEvents:'none',ariaHidden:'true'});
  selected(second.afterReset, 'default');assertStoredBrowserSkin(second.storedReset, 'default');
  assert.deepEqual(third.decoration, {image:false,ariaHidden:'true'});selected(third.reselected);assertStoredBrowserSkin(third.storedReselected);
  screenshotRows(report.screenshots, SKIN_SCREENSHOTS.slice(4));return report;
}

export function assertExecutedSkinCases(tap) {
  for (const {name} of SKIN_BROWSER_CASES) {
    const rows = tap.split('\n').filter(line => /^(?:not )?ok \d+ - /.test(line) && line.replace(/^(?:not )?ok \d+ - /,'').split(/\s+#/)[0] === name);
    assert.ok(rows.length === 1 && /^ok \d+ - /.test(rows[0]) && !/\s+#\s*(?:SKIP|TODO)\b/i.test(rows[0]), `Missing executed passing skin case: ${name}`);
  }
}

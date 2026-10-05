// Pure evidence checks only. These checks do not establish native/window acceptance.
import assert from 'node:assert/strict';
import {CATALOG_ACCEPTANCE_PHASES} from './prepare-library-catalog-acceptance.mjs';

export const CATALOG_REQUESTED_VIEWPORT = Object.freeze({width: 1280, height: 720});
export const CATALOG_MINIMUM_VIEWPORT = Object.freeze({width: 900, height: 640});
export const CATALOG_NATIVE_VIEWPORT_CONTRACT = Object.freeze({kind: 'native-work-area', requested: CATALOG_REQUESTED_VIEWPORT, minimum: CATALOG_MINIMUM_VIEWPORT});
export const CATALOG_HOSTED_VIEWPORT_CONTRACT = Object.freeze({kind: 'hosted-fixed', requested: CATALOG_REQUESTED_VIEWPORT});
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const positiveInteger = value => Number.isSafeInteger(value) && value > 0;
const finitePositive = value => Number.isFinite(value) && value > 0;
const close = (a, b) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= 1e-7 * Math.max(1, Math.abs(a), Math.abs(b));
const pair = (value, label) => assert.ok(Array.isArray(value) && value.length === 2 && value.every(Number.isSafeInteger), `${label} must contain two integer coordinates`);
function rect(value, label) {
  assert.ok(Array.isArray(value) && value.length === 4 && value.every(Number.isSafeInteger), `${label} must contain four integer coordinates`);
  assert.ok(value[2] > value[0] && value[3] > value[1], `${label} must have positive dimensions`);
}
function contained(inner, outer, label) {
  assert.ok(inner[0] >= outer[0] && inner[1] >= outer[1] && inner[2] <= outer[2] && inner[3] <= outer[3], `${label} is outside its observed bounds`);
}

export function validateCatalogNativeRenderer(renderer) {
  assert.ok(object(renderer), 'Native renderer geometry is required');
  for (const axis of ['width', 'height']) {
    assert.ok(positiveInteger(renderer[axis]) && renderer[axis] >= CATALOG_MINIMUM_VIEWPORT[axis] && renderer[axis] <= CATALOG_REQUESTED_VIEWPORT[axis], `Native CSS ${axis} is outside the bounded viewport contract`);
  }
  assert.ok(finitePositive(renderer.device_pixel_ratio), 'Native device pixel ratio must be finite and positive');
  const documentClient = renderer.document_client;
  assert.ok(object(documentClient), 'Native document client observation is required');
  for (const axis of ['width', 'height']) {
    assert.ok(positiveInteger(documentClient[axis]) && documentClient[axis] >= CATALOG_MINIMUM_VIEWPORT[axis] && documentClient[axis] <= renderer[axis], `Native document client ${axis} must fit the bounded visible viewport`);
  }
  const visual = renderer.visual_viewport;
  assert.ok(visual === null || object(visual), 'Native visual viewport observation is required, or null when unavailable');
  if (visual !== null) {
    assert.ok(finitePositive(visual.width) && finitePositive(visual.height), 'Native visual viewport dimensions must be finite and positive');
    // Document client dimensions exclude root scrollbars, unlike innerWidth
    // and the physical client bitmap. Only integer CSS rounding is allowed.
    for (const axis of ['width', 'height']) assert.ok(Math.abs(visual[axis] - documentClient[axis]) <= 0.5 + 1e-7, `Native visual viewport ${axis} differs from the recorded document client`);
    assert.ok(close(visual.scale, 1) && close(visual.offset_left, 0) && close(visual.offset_top, 0), 'Native visual viewport must be unzoomed and unshifted');
  }
  return {width: renderer.width, height: renderer.height, device_pixel_ratio: renderer.device_pixel_ratio};
}

/** Bind independently observed Win32 client pixels to one actual renderer and process. */
export function validateCatalogNativeGeometry(geometry, {phase, processId, renderer, layout, stage, capture = false, reportedViewport} = {}) {
  assert.ok(CATALOG_ACCEPTANCE_PHASES.includes(phase) && positiveInteger(processId), 'Independent native phase/process identity is required');
  assert.ok(object(geometry), 'Independent native geometry is required');
  assert.equal(geometry.version, 1); assert.equal(geometry.kind, 'native-window-geometry');
  assert.equal(geometry.phase, phase, 'Native geometry belongs to another phase');
  if (stage !== undefined) assert.equal(geometry.stage, stage, 'Native geometry belongs to another capture');
  assert.equal(geometry.process_id, processId, 'Native geometry belongs to another process');
  assert.equal(geometry.owner_process_id, processId, 'Native window belongs to another process');
  for (const field of ['hwnd', 'root_hwnd', 'foreground_hwnd']) assert.ok(positiveInteger(geometry[field]), `Native ${field} is invalid`);
  assert.equal(geometry.root_hwnd, geometry.hwnd, 'Native geometry window is not the owned root');
  assert.equal(geometry.foreground_hwnd, geometry.hwnd, 'Native geometry lost foreground ownership');
  const css = validateCatalogNativeRenderer(renderer);
  assert.deepEqual(layout, {width: css.width, height: css.height, locale: 'zh-CN'}, 'Native layout differs from the actual renderer geometry');
  if (capture) {
    assert.equal(geometry.renderer, null, 'Action geometry must not invent a renderer report');
    assert.deepEqual(geometry.reported_viewport, reportedViewport, 'Action geometry viewport differs from the actual action');
    if (reportedViewport !== null) assert.deepEqual(reportedViewport, [css.width, css.height], 'Action viewport differs from the phase renderer');
  } else assert.deepEqual(geometry.renderer, renderer, 'Native geometry differs from the actual renderer report');
  for (const field of ['client_rect', 'window_rect', 'monitor_rect', 'work_area']) rect(geometry[field], `Native ${field}`);
  pair(geometry.client_origin, 'Native client origin');
  assert.deepEqual(geometry.client_rect.slice(0, 2), [0, 0], 'Win32 client rectangle must use its own origin');
  const width = geometry.client_rect[2], height = geometry.client_rect[3], [left, top] = geometry.client_origin;
  const screen = [left, top, left + width, top + height];
  assert.ok(screen.every(Number.isSafeInteger), 'Native screen coordinates overflow');
  contained(geometry.work_area, geometry.monitor_rect, 'Native work area');
  contained(screen, geometry.window_rect, 'Native client in its window');
  // Window borders may be invisible and extend beyond the work area. The whole
  // client, including every control, must fit both the work area and monitor.
  contained(screen, geometry.work_area, 'Native client in work area');
  contained(screen, geometry.monitor_rect, 'Native client in monitor');
  assert.equal(geometry.monitor_scale_hresult, 0, 'Native monitor scale API did not succeed');
  assert.ok(positiveInteger(geometry.window_dpi) && positiveInteger(geometry.monitor_scale_percent), 'Native window DPI and successful monitor scale observations are required');
  for (const field of ['window_awareness', 'caller_awareness']) assert.ok(Number.isInteger(geometry[field]) && [0, 1, 2].includes(geometry[field]), `Native ${field} is invalid`);
  assert.ok(close(css.device_pixel_ratio, geometry.window_dpi / 96), 'Native DPR differs from window DPI');
  assert.ok(close(css.device_pixel_ratio, geometry.monitor_scale_percent / 100), 'Native DPR differs from monitor scale');
  // The only allowance is integer CSS layout rounding: at most half a CSS
  // pixel expressed in physical pixels. There is no viewport-size slack.
  for (const [axis, pixels] of [['width', width], ['height', height]]) {
    assert.ok(Math.abs(pixels - css[axis] * css.device_pixel_ratio) <= css.device_pixel_ratio / 2 + 1e-7, `Native physical ${axis} differs from CSS pixels and DPR`);
  }
  return {width, height, css_width: css.width, css_height: css.height, device_pixel_ratio: css.device_pixel_ratio};
}

/** Independent captures within one phase must describe the same visible window. */
export function validateCatalogNativeCaptureStable(capture, phaseGeometry) {
  for (const field of ['phase', 'process_id', 'owner_process_id', 'hwnd', 'root_hwnd', 'foreground_hwnd', 'client_rect', 'client_origin', 'window_rect', 'monitor_rect', 'work_area', 'window_dpi', 'monitor_scale_percent', 'window_awareness', 'caller_awareness']) {
    assert.deepEqual(capture[field], phaseGeometry[field], `Native capture changed ${field} within the phase`);
  }
}

/** Recompute the exact native click from independent geometry and CSS target. */
export function validateCatalogNativeClick(point, action, geometry) {
  assert.ok(object(point), 'Native action lacks a client click observation');
  assert.ok([action.x, action.y, action.width, action.height].every(Number.isFinite), 'Native action coordinates must be finite');
  assert.ok(action.width > 0 && action.height > 0 && action.x >= 0 && action.x < action.width && action.y >= 0 && action.y < action.height, 'Native target is outside the CSS viewport');
  assert.deepEqual(point.client, geometry.client_rect, 'Native click client differs from independent geometry');
  assert.deepEqual(point.origin, geometry.client_origin, 'Native click origin differs from independent geometry');
  assert.deepEqual(point.viewport, [action.width, action.height], 'Native click viewport differs from actual action');
  assert.deepEqual(point.viewport, geometry.renderer === null ? geometry.reported_viewport : [geometry.renderer.width, geometry.renderer.height], 'Native click viewport differs from independent geometry');
  assert.deepEqual(point.work_area, geometry.work_area, 'Native click work area differs from independent geometry');
  assert.equal(point.app_hwnd, geometry.hwnd, 'Native click belongs to another window');
  assert.equal(point.foreground, geometry.foreground_hwnd, 'Native click lost foreground ownership');
  assert.ok(positiveInteger(point.hit_hwnd), 'Native action lacks a hit window');
  assert.equal(point.hit_root, geometry.root_hwnd, 'Native click hit another root window');
  const requested = [geometry.client_origin[0] + Math.floor(action.x * geometry.client_rect[2] / action.width), geometry.client_origin[1] + Math.floor(action.y * geometry.client_rect[3] / action.height)];
  pair(point.requested, 'Native requested point'); pair(point.actual, 'Native actual point');
  assert.deepEqual(point.requested, requested, 'Native requested point does not map the actual CSS target');
  assert.deepEqual(point.actual, requested, 'Native actual pointer was clipped or moved');
  assert.ok(requested[0] >= geometry.work_area[0] && requested[0] < geometry.work_area[2] && requested[1] >= geometry.work_area[1] && requested[1] < geometry.work_area[3], 'Native click is outside the work area');
}

/** Hosted callers keep their exact fixed layout unless native witnesses are supplied. */
export function validateCatalogPhaseSequence(reports, {nativeGeometries, nativeProcesses} = {}) {
  assert.deepEqual(reports.map(row => row.phase), CATALOG_ACCEPTANCE_PHASES, 'Catalog renderer phases are missing, reordered or duplicated');
  if (nativeGeometries === undefined) {
    assert.equal(nativeProcesses, undefined, 'Native process identities require native geometry');
    for (const report of reports) assert.deepEqual(report.layout, {...CATALOG_REQUESTED_VIEWPORT, locale: 'zh-CN'}, 'Hosted catalog layout must remain exactly 1280×720');
    return null;
  }
  assert.ok(Array.isArray(nativeGeometries) && nativeGeometries.length === reports.length, 'All three independent native phase geometries are required');
  assert.ok(Array.isArray(nativeProcesses) && nativeProcesses.length === reports.length && nativeProcesses.every(positiveInteger) && new Set(nativeProcesses).size === reports.length, 'All three independent fresh native process identities are required');
  const validated = reports.map((report, index) => validateCatalogNativeGeometry(nativeGeometries[index], {phase: report.phase, processId: nativeProcesses[index], renderer: report.geometry, layout: report.layout, stage: `native-${report.phase}`}));
  for (const geometry of validated.slice(1)) assert.deepEqual(geometry, validated[0], 'Native CSS/client dimensions and DPR must remain stable across all three phases');
  return validated;
}

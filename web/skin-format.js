// WorldMusicClub skin v1 reference reader. No DOM, network, filesystem or score access.
export const SKIN_LIMITS = Object.freeze({manifest_bytes: 65_536, assets: 4,
  asset_bytes: 2_097_152, total_bytes: 8_388_608, axis: 2048,
  asset_pixels: 4_194_304, total_pixels: 8_388_608});
export const SKIN_FEATURES = Object.freeze(['background_image', 'marker_shapes', 'note_patterns', 'layout_bands']);
const MARKERS = ['circle', 'diamond', 'square', 'triangle'];
const textEncoder = new TextEncoder();
const idPattern = /^[a-z][a-z0-9-]{0,63}(?![\s\S])/;
const pathPattern = /^assets\/(?:[a-z0-9][a-z0-9_-]*\/)*[a-z0-9][a-z0-9_-]*\.png(?![\s\S])/;
const colorPattern = /^#[0-9A-Fa-f]{6}(?![\s\S])/;

export class SkinValidationError extends Error {
  constructor(code, path, message) { super(`${path}: ${message}`); this.name = 'SkinValidationError'; this.code = code; this.path = path; }
}
function fail(code, path, message) { throw new SkinValidationError(code, path, message); }
function keys(value, fields, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail('skin_structure', path, 'expected an object');
  for (const field of Object.keys(value)) if (!fields.includes(field)) fail('skin_unknown_field', `${path}.${field}`, 'unsupported field');
  for (const field of fields) if (!Object.hasOwn(value, field)) fail('skin_missing_field', `${path}.${field}`, 'required field');
}
function string(value, limit, path) {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim() || /[\u0000-\u001f\u007f]/u.test(value) || [...value].length > limit) fail('skin_structure', path, `expected trimmed, nonempty text up to ${limit} characters`);
}
function number(value, min, max, path, integer = false) {
  if (!Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) fail('skin_bounds', path, `expected ${integer ? 'integer ' : ''}${min}..${max}`);
}
function choice(value, allowed, path) { if (!allowed.includes(value)) fail('skin_structure', path, `expected one of ${allowed.join(', ')}`); }
function colors(value, fields, path) {
  keys(value, fields, path);
  for (const field of fields) if (typeof value[field] !== 'string' || !colorPattern.test(value[field])) fail('skin_color', `${path}.${field}`, 'expected opaque #RRGGBB');
}
export function contrastRatio(first, second) {
  const luminance = color => {
    if (typeof color !== 'string' || !colorPattern.test(color)) fail('skin_color', '$', 'expected opaque #RRGGBB');
    const linear = [1, 3, 5].map(offset => parseInt(color.slice(offset, offset + 2), 16) / 255)
      .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
    return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
  };
  const a = luminance(first), b = luminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
function contrast(first, second, minimum, path) {
  if (contrastRatio(first, second) < minimum) fail('skin_contrast', path, `requires contrast of at least ${minimum}:1`);
}
export function safeSkinAssetPath(path) {
  if (typeof path !== 'string' || path.length > 160 || !pathPattern.test(path)) return false;
  return path.split('/').every(segment => !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(segment));
}
function deepFreeze(value) {
  for (const child of Object.values(value)) if (child && typeof child === 'object') deepFreeze(child);
  return Object.freeze(value);
}

// Refuse duplicate JSON members instead of accepting JSON.parse's last-value wins.
function uniqueJson(text) {
  let cursor = 0;
  const whitespace = () => { while (/[\t\n\r ]/.test(text[cursor] ?? 'x')) cursor++; };
  const readString = () => {
    const start = cursor++;
    while (cursor < text.length) {
      const char = text[cursor++];
      if (char === '\\') cursor++;
      else if (char === '"') return JSON.parse(text.slice(start, cursor));
    }
    fail('skin_json', '$', 'unterminated string');
  };
  const value = depth => {
    whitespace();
    if (depth > 12) fail('skin_json', '$', 'JSON nesting exceeds 12');
    const current = text[cursor];
    if (current === '{') {
      cursor++; whitespace(); const seen = new Set();
      if (text[cursor] === '}') { cursor++; return; }
      while (cursor < text.length) {
        whitespace(); if (text[cursor] !== '"') fail('skin_json', '$', 'expected object member');
        const name = readString();
        if (seen.has(name)) fail('skin_duplicate_field', '$', `duplicate member ${name}`);
        seen.add(name); whitespace();
        if (text[cursor++] !== ':') fail('skin_json', '$', 'expected colon');
        value(depth + 1); whitespace();
        const end = text[cursor++]; if (end === '}') return;
        if (end !== ',') fail('skin_json', '$', 'expected comma');
      }
    } else if (current === '[') {
      cursor++; whitespace();
      if (text[cursor] === ']') { cursor++; return; }
      while (cursor < text.length) {
        value(depth + 1); whitespace(); const end = text[cursor++];
        if (end === ']') return;
        if (end !== ',') fail('skin_json', '$', 'expected comma');
      }
    } else if (current === '"') { readString(); return; }
    else {
      const start = cursor;
      while (cursor < text.length && !/[\s,}\]]/.test(text[cursor])) cursor++;
      if (cursor > start) { JSON.parse(text.slice(start, cursor)); return; }
    }
    fail('skin_json', '$', 'incomplete JSON value');
  };
  value(0); whitespace();
  if (cursor !== text.length) fail('skin_json', '$', 'trailing JSON content');
  return JSON.parse(text);
}

export function parseSkinManifest(input) {
  if (typeof input !== 'string' && !(input instanceof Uint8Array)) fail('skin_structure', '$', 'expected UTF-8 JSON bytes or text');
  const bytes = typeof input === 'string' ? textEncoder.encode(input) : input;
  if (bytes.byteLength > SKIN_LIMITS.manifest_bytes) fail('skin_bounds', '$', 'manifest exceeds 64 KiB');
  let manifest;
  try { manifest = uniqueJson(new TextDecoder('utf-8', {fatal: true}).decode(bytes)); }
  catch (error) { if (error instanceof SkinValidationError) throw error; fail('skin_json', '$', 'invalid UTF-8 JSON'); }
  validateSkinManifest(manifest);
  return deepFreeze(manifest);
}

export function validateSkinManifest(skin) {
  keys(skin, ['format', 'version', 'id', 'name', 'author', 'license', 'attribution', 'palette', 'notes', 'keyboard', 'notation', 'layout', 'background', 'assets', 'fallback'], '$');
  choice(skin.format, ['worldmusicclub-skin'], '$.format');
  if (skin.version !== 1) fail('skin_version', '$.version', 'only version 1 is supported');
  if (typeof skin.id !== 'string' || !idPattern.test(skin.id)) fail('skin_structure', '$.id', 'invalid skin identifier');
  for (const [field, limit] of [['name', 96], ['author', 128], ['license', 256], ['attribution', 512]]) string(skin[field], limit, `$.${field}`);
  colors(skin.palette, ['background', 'surface', 'foreground', 'muted', 'outline', 'judgment'], '$.palette');
  for (const backdrop of ['background', 'surface']) {
    for (const field of ['foreground', 'muted']) contrast(skin.palette[field], skin.palette[backdrop], 4.5, `$.palette.${field}`);
  }
  for (const field of ['outline', 'judgment']) contrast(skin.palette[field], skin.palette.surface, 3, `$.palette.${field}`);
  keys(skin.notes, ['human', 'machine'], '$.notes');
  for (const role of ['human', 'machine']) {
    const note = skin.notes[role], path = `$.notes.${role}`;
    keys(note, ['fill', 'foreground', 'outline', 'marker', 'pattern'], path);
    colors({fill: note.fill, foreground: note.foreground, outline: note.outline}, ['fill', 'foreground', 'outline'], path);
    choice(note.marker, MARKERS, `${path}.marker`); choice(note.pattern, ['solid', 'stripes'], `${path}.pattern`);
    contrast(note.fill, skin.palette.surface, 3, `${path}.fill`);
    contrast(note.foreground, note.fill, 4.5, `${path}.foreground`);
    contrast(note.outline, note.fill, 3, `${path}.outline`);
  }
  if (skin.notes.human.marker === skin.notes.machine.marker || skin.notes.human.fill.toLowerCase() === skin.notes.machine.fill.toLowerCase()) fail('skin_role_distinction', '$.notes', 'human and machine need different colors AND markers');
  colors(skin.keyboard, ['white', 'white_foreground', 'black', 'black_foreground', 'pressed', 'pressed_foreground', 'border'], '$.keyboard');
  for (const key of ['white', 'black', 'pressed']) contrast(skin.keyboard[`${key}_foreground`], skin.keyboard[key], 4.5, `$.keyboard.${key}_foreground`);
  contrast(skin.keyboard.white, skin.keyboard.black, 3, '$.keyboard');
  for (const key of ['white', 'black']) {
    contrast(skin.keyboard.border, skin.keyboard[key], 3, '$.keyboard.border');
    contrast(skin.keyboard.pressed, skin.keyboard[key], 3, '$.keyboard.pressed');
  }
  colors(skin.notation, ['background', 'foreground'], '$.notation');
  contrast(skin.notation.foreground, skin.notation.background, 7, '$.notation.foreground');
  // Notation lives behind falling notes inside the SAME lane. Every note must
  // remain readable over its background as well as the plain gameplay surface.
  for (const role of ['human', 'machine']) contrast(skin.notes[role].fill, skin.notation.background, 3, `$.notes.${role}.fill`);
  keys(skin.layout, ['notation_height', 'piano_height', 'side_margin', 'note_width_scale'], '$.layout');
  number(skin.layout.notation_height, 0.15, 0.35, '$.layout.notation_height');
  number(skin.layout.piano_height, 0.15, 0.30, '$.layout.piano_height');
  number(skin.layout.side_margin, 0, 0.06, '$.layout.side_margin');
  number(skin.layout.note_width_scale, 0.6, 0.95, '$.layout.note_width_scale');
  keys(skin.background, ['asset', 'fit', 'opacity'], '$.background');
  choice(skin.background.fit, ['cover', 'contain', 'tile'], '$.background.fit');
  number(skin.background.opacity, 0, 0.25, '$.background.opacity');
  if (!Array.isArray(skin.assets) || skin.assets.length > SKIN_LIMITS.assets) fail('skin_bounds', '$.assets', 'at most 4 assets are allowed');
  const ids = new Set(), paths = new Set(); let bytes = 0, pixels = 0;
  for (const [index, asset] of skin.assets.entries()) {
    const path = `$.assets[${index}]`;
    keys(asset, ['id', 'path', 'media_type', 'bytes', 'width', 'height'], path);
    if (typeof asset.id !== 'string' || !idPattern.test(asset.id) || ids.has(asset.id)) fail('skin_asset_id', `${path}.id`, 'invalid or duplicate asset identifier');
    if (!safeSkinAssetPath(asset.path) || paths.has(asset.path)) fail('skin_asset_path', `${path}.path`, 'unsafe or duplicate relative PNG path');
    choice(asset.media_type, ['image/png'], `${path}.media_type`);
    number(asset.bytes, 57, SKIN_LIMITS.asset_bytes, `${path}.bytes`, true);
    for (const axis of ['width', 'height']) number(asset[axis], 1, SKIN_LIMITS.axis, `${path}.${axis}`, true);
    if (asset.width * asset.height > SKIN_LIMITS.asset_pixels) fail('skin_bounds', path, 'asset exceeds pixel limit');
    ids.add(asset.id); paths.add(asset.path); bytes += asset.bytes; pixels += asset.width * asset.height;
  }
  if (bytes > SKIN_LIMITS.total_bytes || pixels > SKIN_LIMITS.total_pixels) fail('skin_bounds', '$.assets', 'total resource budget exceeded');
  if (skin.background.asset !== null && !ids.has(skin.background.asset)) fail('skin_asset_reference', '$.background.asset', 'must reference a declared asset or null');
  keys(skin.fallback, ['missing_asset', 'unsupported_feature', 'invalid_skin'], '$.fallback');
  choice(skin.fallback.missing_asset, ['solid_background'], '$.fallback.missing_asset');
  for (const field of ['unsupported_feature', 'invalid_skin']) choice(skin.fallback[field], ['builtin_default'], `$.fallback.${field}`);
  return skin;
}

export const DEFAULT_SKIN = deepFreeze({
  format: 'worldmusicclub-skin', version: 1, id: 'wmc-default', name: 'WorldMusicClub Default',
  author: 'WorldMusicClub contributors', license: 'MIT', attribution: 'Original WorldMusicClub presentation defaults.',
  palette: {background: '#0B1220', surface: '#111C2E', foreground: '#F8FAFC', muted: '#B8C6DA', outline: '#94A3B8', judgment: '#F8FAFC'},
  notes: {
    human: {fill: '#FBBF24', foreground: '#111111', outline: '#111111', marker: 'circle', pattern: 'solid'},
    machine: {fill: '#67E8F9', foreground: '#111111', outline: '#111111', marker: 'diamond', pattern: 'stripes'},
  },
  keyboard: {white: '#F8FAFC', white_foreground: '#111111', black: '#111111', black_foreground: '#F8FAFC', pressed: '#2563EB', pressed_foreground: '#FFFFFF', border: '#727272'},
  notation: {background: '#111C2E', foreground: '#F8FAFC'},
  layout: {notation_height: 0.25, piano_height: 0.22, side_margin: 0.03, note_width_scale: 0.85},
  background: {asset: null, fit: 'cover', opacity: 0}, assets: [],
  fallback: {missing_asset: 'solid_background', unsupported_feature: 'builtin_default', invalid_skin: 'builtin_default'},
});

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// Strict static PNG subset, including checksums. Pixel decompression is bounded below.
export function inspectSkinPng(bytes, asset) {
  for (const axis of ['width', 'height']) number(asset[axis], 1, SKIN_LIMITS.axis, `${asset.path}.${axis}`, true);
  if (asset.width * asset.height > SKIN_LIMITS.asset_pixels) fail('skin_bounds', asset.path, 'asset exceeds pixel limit');
  if (!(bytes instanceof Uint8Array) || bytes.length !== asset.bytes || bytes.length > SKIN_LIMITS.asset_bytes) fail('skin_asset_bytes', asset.path, 'actual byte count differs from the bounded declaration');
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (!signature.every((byte, index) => bytes[index] === byte)) fail('skin_png', asset.path, 'expected actual PNG bytes');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8, channels = 0, ended = false, dataLength = 0;
  const chunks = [];
  while (offset + 12 <= bytes.length) {
    const length = view.getUint32(offset), end = offset + length + 12;
    if (end > bytes.length) fail('skin_png', asset.path, 'truncated PNG chunk');
    const kind = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    if (crc32(bytes.subarray(offset + 4, end - 4)) !== view.getUint32(end - 4)) fail('skin_png', asset.path, 'PNG checksum mismatch');
    if (kind === 'IHDR') {
      if (offset !== 8 || length !== 13 || view.getUint32(offset + 8) !== asset.width || view.getUint32(offset + 12) !== asset.height) fail('skin_png', asset.path, 'PNG dimensions/header differ from manifest');
      if (bytes[offset + 16] !== 8 || ![2, 6].includes(bytes[offset + 17]) || bytes[offset + 18] || bytes[offset + 19] || bytes[offset + 20]) fail('skin_png', asset.path, 'only noninterlaced 8-bit RGB/RGBA PNG is supported');
      channels = bytes[offset + 17] === 6 ? 4 : 3;
    } else if (kind === 'IDAT') {
      if (!channels || !length) fail('skin_png', asset.path, 'missing header or empty image data');
      chunks.push(bytes.subarray(offset + 8, end - 4)); dataLength += length;
    } else if (kind === 'IEND') {
      if (length || !chunks.length || end !== bytes.length) fail('skin_png', asset.path, 'missing image data or trailing PNG content');
      ended = true; break;
    } else fail('skin_png', asset.path, `unsupported PNG chunk ${kind}; export a metadata-free still PNG`);
    offset = end;
  }
  if (!ended) fail('skin_png', asset.path, 'missing PNG end');
  const compressed = new Uint8Array(dataLength); let position = 0;
  for (const chunk of chunks) { compressed.set(chunk, position); position += chunk.length; }
  return {width: asset.width, height: asset.height, channels, compressed};
}

async function verifyPixels(image, path) {
  if (typeof DecompressionStream !== 'function') fail('skin_decoder_unavailable', path, 'bounded deflate decoder is unavailable');
  const expected = (image.width * image.channels + 1) * image.height;
  const stride = image.width * image.channels + 1;
  const stream = new ReadableStream({start(controller) { controller.enqueue(image.compressed); controller.close(); }});
  const reader = stream.pipeThrough(new DecompressionStream('deflate')).getReader();
  let length = 0;
  try {
    while (true) {
      const {done, value} = await reader.read(); if (done) break;
      if (length + value.length > expected) fail('skin_png_pixels', path, 'decompressed bytes exceed declared dimensions');
      for (let index = (stride - length % stride) % stride; index < value.length; index += stride) if (value[index] > 4) fail('skin_png_pixels', path, 'invalid PNG scanline filter');
      length += value.length;
    }
    if (length !== expected) fail('skin_png_pixels', path, 'decompressed bytes do not match declared dimensions');
  } catch (error) {
    if (error instanceof SkinValidationError) throw error;
    fail('skin_png_pixels', path, 'invalid PNG compressed data');
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

// Resource input is an in-memory Map; this module never fetches a path or URL.
// Missing/invalid optional images cannot replace the validated solid-color surfaces.
export async function validateSkinResources(skin, resources = new Map()) {
  validateSkinManifest(skin);
  skin = deepFreeze(structuredClone(skin));
  if (!(resources instanceof Map)) fail('skin_structure', '$.resources', 'expected a Map of package-relative paths to Uint8Array bytes');
  const declared = new Set(skin.assets.map(asset => asset.path));
  if (resources.size > SKIN_LIMITS.assets) fail('skin_bounds', '$.resources', 'too many supplied resources');
  let actualBytes = 0;
  const snapshots = new Map();
  for (const [path, bytes] of resources) {
    if (!safeSkinAssetPath(path) || !declared.has(path)) fail('skin_asset_path', path, 'undeclared or unsafe resource');
    if (!(bytes instanceof Uint8Array) || bytes.length > SKIN_LIMITS.asset_bytes) fail('skin_asset_bytes', path, 'invalid or oversized supplied resource');
    actualBytes += bytes.length;
    // Snapshot every resource before the first asynchronous decoder read. Hosts
    // may replace a Map entry or mutate a caller-owned buffer while we await.
    // Uint8Array construction also copies Node Buffer input; Buffer.slice() aliases.
    snapshots.set(path, new Uint8Array(bytes));
  }
  if (actualBytes > SKIN_LIMITS.total_bytes) fail('skin_bounds', '$.resources', 'actual resource budget exceeded');
  const assets = new Map(), diagnostics = [];
  for (const asset of skin.assets) {
    if (!snapshots.has(asset.path)) { diagnostics.push({code: 'skin_asset_missing', path: asset.path, fallback: 'solid_background'}); continue; }
    try {
      const bytes = snapshots.get(asset.path);
      const image = inspectSkinPng(bytes, asset); await verifyPixels(image, asset.path);
      assets.set(asset.id, bytes);
    } catch (error) {
      if (!(error instanceof SkinValidationError)) throw error;
      diagnostics.push({code: error.code, path: asset.path, fallback: 'solid_background'});
    }
  }
  return {assets, diagnostics};
}

export function skinLayoutBands(layout = DEFAULT_SKIN.layout) {
  // Apply the same semantic constraints even if a host calls this helper directly.
  validateSkinManifest({...DEFAULT_SKIN, layout});
  const {notation_height: notation, piano_height: piano, side_margin: margin} = layout;
  const band = (y, height) => ({x: margin, y, width: 1 - margin * 2, height});
  return {notation: band(0, notation), judgment: band(0, 1 - piano),
    piano: band(1 - piano, piano), judgment_line_y: 1 - piano};
}

export async function resolveSkin(input, {resources = new Map(), features = []} = {}) {
  if (!Array.isArray(features) || features.some(feature => !SKIN_FEATURES.includes(feature))) fail('skin_feature', '$.features', 'unknown renderer feature');
  let skin, diagnostics = [];
  try { skin = parseSkinManifest(input); }
  catch (error) {
    if (!(error instanceof SkinValidationError)) throw error;
    diagnostics.push({code: error.code, path: error.path, fallback: 'builtin_default'});
    skin = DEFAULT_SKIN; resources = new Map();
  }
  const checked = await validateSkinResources(skin, resources);
  diagnostics.push(...checked.diagnostics);
  const resolved = structuredClone(skin);
  for (const feature of SKIN_FEATURES) {
    if (features.includes(feature)) continue;
    let changed = false;
    if (feature === 'background_image' && resolved.background.asset !== null) { resolved.background = structuredClone(DEFAULT_SKIN.background); changed = true; }
    if (feature === 'marker_shapes') for (const role of ['human', 'machine']) {
      if (resolved.notes[role].marker !== DEFAULT_SKIN.notes[role].marker) changed = true;
      resolved.notes[role].marker = DEFAULT_SKIN.notes[role].marker;
    }
    if (feature === 'note_patterns') for (const role of ['human', 'machine']) {
      if (resolved.notes[role].pattern !== 'solid') changed = true;
      resolved.notes[role].pattern = 'solid';
    }
    if (feature === 'layout_bands' && JSON.stringify(resolved.layout) !== JSON.stringify(DEFAULT_SKIN.layout)) { resolved.layout = structuredClone(DEFAULT_SKIN.layout); changed = true; }
    if (changed) diagnostics.push({code: 'skin_feature_unsupported', path: feature, fallback: 'builtin_default'});
  }
  const backgroundBytes = resolved.background.asset === null ? null : checked.assets.get(resolved.background.asset) ?? null;
  if (!backgroundBytes) resolved.background = structuredClone(DEFAULT_SKIN.background);
  return {skin: deepFreeze(resolved), bands: deepFreeze(skinLayoutBands(resolved.layout)), background_bytes: backgroundBytes,
    // Semantic role labels are host-localized; a skin can never rename or suppress them.
    legend: deepFreeze(['human', 'machine'].map(role => ({role, label_key: `performer.${role}`, fill: resolved.notes[role].fill, marker: resolved.notes[role].marker}))), diagnostics};
}

// Reset is explicit and stateless: no score, instrument, performer, input, or storage mutation.
export function resetSkin() { return DEFAULT_SKIN; }

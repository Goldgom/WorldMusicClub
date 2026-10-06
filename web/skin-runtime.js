// This adapter owns presentation only. It never accepts a score, transport,
// performer assignment, keyboard binding, or executable skin content.
export function createSkinRuntime({document = globalThis.document, urls = globalThis.URL} = {}) {
  const root = document.documentElement;
  let active = null, imageUrl = null;
  const owned = new Set();
  const set = (key, value) => { root.style.setProperty(key, value); owned.add(key); };
  function clear() {
    delete root.dataset.skin;
    for (const key of owned) root.style.removeProperty(key);
    owned.clear(); active = null;
    if (imageUrl) { urls.revokeObjectURL(imageUrl); imageUrl = null; }
  }
  function apply(resolved) {
    clear();
    if (!resolved) return [];
    active = resolved.skin;
    root.dataset.skin = active.id;
    for (const [key, value] of Object.entries(active.keyboard)) set(`--skin-key-${key.replaceAll('_', '-')}`, value);
    for (const [key, value] of Object.entries(active.palette)) set(`--skin-${key}`, value);
    for (const role of ['human', 'machine']) for (const key of ['fill', 'foreground', 'outline']) set(`--skin-${role}-${key}`, active.notes[role][key]);
    const diagnostics = [...resolved.diagnostics];
    if (resolved.homeDecoration) {
      try {
        const decoration = resolved.homeDecoration;
        imageUrl = urls.createObjectURL(new Blob([decoration.bytes], {type: 'image/png'}));
        set('--skin-background-image', `url("${imageUrl}")`);
        set('--skin-background-opacity', String(decoration.opacity));
        set('--skin-background-size', decoration.fit === 'tile' ? 'auto' : decoration.fit);
        set('--skin-background-repeat', decoration.fit === 'tile' ? 'repeat' : 'no-repeat');
      } catch { diagnostics.push({code: 'skin_image_unavailable', path: 'background_image', fallback: 'solid_background'}); }
    }
    return diagnostics;
  }
  return {apply, current: () => active, destroy: clear};
}

function markerPath(ctx, marker, x, y, size) {
  const half = size / 2;
  ctx.beginPath();
  if (marker === 'circle') ctx.arc(x, y, half, 0, Math.PI * 2);
  else if (marker === 'square') ctx.rect(x - half, y - half, size, size);
  else {
    ctx.moveTo(x, y - half);
    if (marker === 'diamond') { ctx.lineTo(x + half, y); ctx.lineTo(x, y + half); ctx.lineTo(x - half, y); }
    else { ctx.lineTo(x + half, y + half); ctx.lineTo(x - half, y + half); }
    ctx.closePath();
  }
}

// Geometry and time come from the existing app unchanged. Every custom note
// has an opaque surface backplate, preserving validated contrast above both
// shared notation and the built-in lane. Decoration work is viewport-bounded.
export function paintSkinNote(ctx, skin, {x, y, width, height, viewportHeight, role, label = null, labelY = null}) {
  if (!skin) return false;
  if (![x, y, width, height, viewportHeight].every(Number.isFinite) || width <= 0 || height <= 0 || viewportHeight <= 0) return true;
  const note = skin.notes[role === 'machine' ? 'machine' : 'human'];
  const top = Math.max(0, y), bottom = Math.min(viewportHeight, y + height);
  if (bottom <= top) return true;
  ctx.save();
  ctx.shadowBlur = 0;
  ctx.fillStyle = skin.palette.surface;
  ctx.fillRect(x - 1, top, width + 2, bottom - top);
  ctx.beginPath();ctx.roundRect(x, y, width, height, Math.min(5, width / 2, height / 2));
  ctx.fillStyle = note.fill;ctx.fill();ctx.strokeStyle = note.outline;ctx.lineWidth = 1;ctx.setLineDash([]);ctx.stroke();
  ctx.clip();
  if (note.pattern === 'stripes') {
    ctx.strokeStyle = note.outline;ctx.lineWidth = 1;ctx.globalAlpha = .3;
    // At most one stripe per eight visible pixels, independent of note duration.
    for (let stripe = top - width; stripe < bottom; stripe += 8) {
      ctx.beginPath();ctx.moveTo(x, stripe);ctx.lineTo(x + width, stripe + width);ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
  const size = Math.min(8, width - 2, bottom - top - 2);
  if (size > 1) {
    markerPath(ctx, note.marker, x + width / 2, bottom - size / 2 - 1, size);
    ctx.fillStyle = note.foreground;ctx.fill();
  }
  // The role marker is mandatory; the note-name label is optional. Keep the
  // entire opaque label plate inside the visible body and above the marker's
  // reserved band. Short/clipped notes omit the label instead of erasing the
  // independent performer cue (including when both role patterns are solid).
  const markerTop = size > 1 ? bottom - size - 1 : bottom;
  if (label && Number.isFinite(labelY) && labelY - 13 >= top && labelY + 3 <= markerTop - 1) {
    ctx.fillStyle = note.fill;ctx.fillRect(x, labelY - 13, width, 16);
    ctx.fillStyle = note.foreground;ctx.font = '12px sans-serif';ctx.textAlign = 'center';ctx.fillText(label, x + width / 2, labelY);
  }
  ctx.restore();
  return true;
}

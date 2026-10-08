import {PART_ACTIVITY_STATES, partActivityText} from './part-activity-locales.js';

export const PART_ACTIVITY_VIEW_LIMIT = 128;
export const PART_ACTIVITY_PAGE_SIZE = 1;
export function partActivityEligible(context = {}) {
  return context.screen === 'stage' && context.layout === 'complete' && context.mode === 'practice' && context.showOtherParts === true;
}

// Source evidence stays literal and bounded, including hostile markup and bidi controls.
function safeText(value, limit) {
  if (typeof value !== 'string') return '';
  const clean = value.replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, ' ').trim();
  const end = clean.length > limit && /[\uD800-\uDBFF]/.test(clean[limit - 1]) ? limit - 1 : limit;
  return clean.slice(0, end);
}

/** Display-only: consumes admitted machine activity; never infers audio from score time. */
export function createPartActivityView({document, parent, i18n}) {
  const make = (tag, className, owner) => {
    const node = document.createElement(tag); node.className = className; owner?.append(node); return node;
  };
  const root = make('section', 'part-activity-strip', parent);
  root.hidden = true; root.setAttribute('data-keyboard-input', 'off');
  const title = make('span', 'part-activity-title', root);
  const row = make('div', 'part-activity-row', root);
  const label = make('span', 'part-activity-label', row);
  const summary = make('span', 'part-activity-source', row);
  const subset = make('span', 'part-activity-subset', row);
  const status = make('span', 'part-activity-state', row);
  const pages = make('div', 'part-activity-pages', root);
  const previous = make('button', 'part-activity-previous', pages);
  const counter = make('span', 'part-activity-page', pages);
  const next = make('button', 'part-activity-next', pages);
  const limit = make('span', 'part-activity-limit', root);
  previous.type = next.type = 'button';
  counter.setAttribute('aria-live', 'polite'); counter.setAttribute('aria-atomic', 'true');
  let snapshot = null, context = {}, page = 0, disposed = false;
  let sourceCache = new Map();
  const ownedKeys = new Set();
  const setText = (node, value) => { if (node.textContent !== value) node.textContent = value; };
  const setHidden = (node, value) => { if (node.hidden !== value) node.hidden = value; };
  const setAttribute = (node, key, value) => { if (node.getAttribute(key) !== value) node.setAttribute(key, value); };
  const setDisabled = (node, value) => { if (node.disabled !== value) node.disabled = value; };
  function cached(value, budget) {
    if (typeof value !== 'string') return '';
    const key = budget + ':' + value;
    if (!sourceCache.has(key)) {
      if (sourceCache.size >= PART_ACTIVITY_VIEW_LIMIT * 2) sourceCache = new Map();
      sourceCache.set(key, safeText(value, budget));
    }
    return sourceCache.get(key);
  }
  function paint() {
    if (disposed) return;
    const rows = [];
    if (Array.isArray(snapshot?.rows)) for (const candidate of snapshot.rows) {
      if (candidate?.owner !== 'machine' || candidate.visible === false) continue;
      rows.push(candidate); if (rows.length > PART_ACTIVITY_VIEW_LIMIT) break;
    }
    const overflow = rows.length > PART_ACTIVITY_VIEW_LIMIT;
    if (overflow) rows.length = PART_ACTIVITY_VIEW_LIMIT;
    const visible = partActivityEligible(context) && rows.length > 0;
    setHidden(root, !visible);
    if (!visible) { page = 0; return; }
    page = Math.min(page, rows.length - 1);
    const selected = rows[page], t = (key, values) => partActivityText(i18n?.locale || 'en', key, values);
    const state = PART_ACTIVITY_STATES.includes(selected.state) ? selected.state : 'unavailable';
    setText(title, t('title')); setAttribute(root, 'aria-label', t('title'));
    setText(label, cached(selected.label, 160) || t('part', {number: page + 1}));
    setText(summary, cached(selected.sourceInstrumentSummary, 300) || t('unidentified'));
    setText(subset, selected.machineSubset ? t('subset') : ''); setHidden(subset, !selected.machineSubset);
    setText(status, t(state)); setAttribute(row, 'data-state', state);
    setAttribute(row, 'data-part-id', safeText(selected.partId, 160));
    setText(previous, t('previous')); setText(next, t('next'));
    setText(counter, t('page', {current: page + 1, total: rows.length}));
    setDisabled(previous, page === 0); setDisabled(next, page === rows.length - 1);
    setHidden(pages, rows.length < 2);
    setText(limit, overflow ? t('limit') : ''); setHidden(limit, !overflow);
  }
  const back = () => { if (!previous.disabled) { page--; paint(); } };
  const forward = () => { if (!next.disabled) { page++; paint(); } };
  const navigationKey = event => event.key === 'Enter' || event.key === ' ' || event.code === 'Space';
  const keyIdentity = event => event.code || event.key;
  const keydown = event => {
    if (navigationKey(event)) {
      // A repeat can have started on a musical surface before focus moved here.
      if (!event.repeat) ownedKeys.add(keyIdentity(event));
      event.stopPropagation();
    }
  };
  const keyup = event => {
    // Unmatched releases belong to the existing musical input lifecycle.
    if (navigationKey(event) && ownedKeys.delete(keyIdentity(event))) event.stopPropagation();
  };
  previous.addEventListener('click', back); next.addEventListener('click', forward);
  pages.addEventListener('keydown', keydown); pages.addEventListener('keyup', keyup);
  return {
    root, element: root,
    update(value, nextContext = context) { snapshot = value; context = nextContext; paint(); },
    destroy() {
      if (disposed) return; disposed = true; ownedKeys.clear(); sourceCache.clear();
      previous.removeEventListener('click', back); next.removeEventListener('click', forward);
      pages.removeEventListener('keydown', keydown); pages.removeEventListener('keyup', keyup); root.remove();
    },
  };
}

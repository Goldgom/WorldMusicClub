import {PART_ACTIVITY_STATES, partActivityText} from './part-activity-locales.js';

export const PART_ACTIVITY_VIEW_LIMIT = 128;
export const PART_ACTIVITY_PAGE_SIZE = 1;
export function partActivityEligible(context = {}) {
  return context.screen === 'stage' && context.layout === 'complete' && context.mode === 'practice' && context.showOtherParts === true && context.hideOtherParts !== true;
}

// Source evidence stays literal and bounded, including hostile markup and bidi controls.
function safeText(value, limit) {
  if (typeof value !== 'string') return '';
  const clean = value.slice(0, limit + 1).replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, ' ').trim();
  const end = clean.length > limit && /[\uD800-\uDBFF]/.test(clean[limit - 1]) ? limit - 1 : limit;
  return clean.slice(0, end);
}

/** Display-only: consumes admitted machine activity; never infers audio from score time. */
export function createPartActivityView({document, parent, i18n}) {
  const make = (tag, className, owner) => {
    const node = document.createElement(tag); node.className = className; owner?.append(node); return node;
  };
  const root = make('section', 'part-activity-strip', parent);
  root.hidden = true; root.setAttribute('aria-live', 'off'); root.setAttribute('data-keyboard-input', 'off');
  const title = make('span', 'part-activity-title', root);
  const row = make('div', 'part-activity-row', root);
  const label = make('span', 'part-activity-label part-activity-name', row);
  const machine = make('span', 'part-activity-machine', row);
  const summary = make('span', 'part-activity-source', row);
  const subset = make('span', 'part-activity-subset', row);
  const status = make('span', 'part-activity-state', row);
  const pages = make('div', 'part-activity-pages', root);
  const previous = make('button', 'part-activity-previous', pages);
  const counter = make('span', 'part-activity-page part-activity-page-label', pages);
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
    const bounded = value.slice(0, budget + 1);
    const key = budget + ':' + bounded;
    if (!sourceCache.has(key)) {
      if (sourceCache.size >= PART_ACTIVITY_VIEW_LIMIT * 2) sourceCache = new Map();
      sourceCache.set(key, safeText(bounded, budget));
    }
    return sourceCache.get(key);
  }
  function paint() {
    if (disposed) return;
    const t = (key, values) => partActivityText(i18n?.locale || 'en', key, values);
    setAttribute(root, 'aria-label', t('title'));
    const rows = [], seen = new Set();
    const supplied = Array.isArray(snapshot?.rows) ? snapshot.rows : [];
    for (let index = 0; index < Math.min(supplied.length, PART_ACTIVITY_VIEW_LIMIT); index++) {
      const candidate = supplied[index];
      if (candidate?.owner !== 'machine' || candidate.visible === false || typeof candidate.partId !== 'string' || !candidate.partId || seen.has(candidate.partId)) continue;
      seen.add(candidate.partId); rows.push(candidate);
    }
    const overflow = supplied.length > PART_ACTIVITY_VIEW_LIMIT;
    const visible = partActivityEligible(context) && rows.length > 0;
    setHidden(root, !visible);
    if (!visible) { page = 0; return; }
    page = Math.min(page, rows.length - 1);
    const selected = rows[page];
    const state = PART_ACTIVITY_STATES.includes(selected.state) ? selected.state : 'unavailable';
    setText(title, t('title'));
    setText(label, cached(selected.label, 160) || cached(selected.partId, 160) || t('part', {number: page + 1}));
    setText(machine, t('machine')); setAttribute(label, 'title', label.textContent);
    setText(summary, cached(selected.sourceInstrumentSummary, 300) || t('unidentified'));
    setAttribute(summary, 'title', summary.textContent);
    setText(subset, selected.machineSubset ? t('subset') : ''); setHidden(subset, !selected.machineSubset);
    setText(status, t(state)); setAttribute(row, 'data-state', state);
    setAttribute(row, 'data-part-id', safeText(selected.partId, 160));
    setText(previous, '‹'); setText(next, '›');
    setAttribute(previous, 'title', t('previous')); setAttribute(next, 'title', t('next'));
    setAttribute(previous, 'aria-label', t('previous')); setAttribute(next, 'aria-label', t('next'));
    setText(counter, t('page', {page: page + 1, pages: rows.length}));
    const focused = document.activeElement;
    setDisabled(previous, page === 0); setDisabled(next, page === rows.length - 1);
    setHidden(pages, rows.length < 2);
    if (focused === previous && previous.disabled && !next.disabled) next.focus();
    else if (focused === next && next.disabled && !previous.disabled) previous.focus();
    setText(limit, overflow ? t('limit') : ''); setHidden(limit, !overflow);
  }
  const back = () => { if (!previous.disabled) { page--; paint(); } };
  const forward = () => { if (!next.disabled) { page++; paint(); } };
  const pagingKeys = new Set(['ArrowLeft', 'ArrowRight', 'Home', 'End']);
  const navigationKey = event => pagingKeys.has(event.key) || event.key === 'Enter' || event.key === ' ' || event.code === 'Space';
  const keyIdentity = event => event.code || event.key;
  const keydown = event => {
    if (navigationKey(event)) {
      // A repeat can have started on a musical surface before focus moved here.
      if (!event.repeat) ownedKeys.add(keyIdentity(event));
      event.stopPropagation();
      if (pagingKeys.has(event.key)) {
        event.preventDefault();
        if (event.key === 'Home') page = 0;
        else if (event.key === 'End') page = PART_ACTIVITY_VIEW_LIMIT - 1;
        else page = Math.max(0, page + (event.key === 'ArrowRight' ? 1 : -1));
        paint();
      }
    }
  };
  const keyup = event => {
    // Unmatched releases belong to the existing musical input lifecycle.
    if (navigationKey(event) && ownedKeys.delete(keyIdentity(event))) event.stopPropagation();
  };
  previous.addEventListener('click', back); next.addEventListener('click', forward);
  pages.addEventListener('keydown', keydown); pages.addEventListener('keyup', keyup);
  paint();
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

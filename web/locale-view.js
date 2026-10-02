import {getAppI18n} from './app-locale.js';

const attributes = ['aria-label', 'aria-description', 'title', 'placeholder'];
const selector = ['[data-i18n]', ...attributes.map(name => `[data-i18n-${name}]`)].join(',');
const bindings = new WeakMap();
const views = new WeakMap();

/** Translate only explicit, app-owned keys. Never parse markup or source strings. */
export function localizeStatic(root, i18n = getAppI18n(root.ownerDocument || root)) {
  const nodes = [...(root.matches?.(selector) ? [root] : []), ...root.querySelectorAll(selector)];
  for (const element of nodes) {
    let records = bindings.get(element);
    if (!records) { records = new Map(); bindings.set(element, records); }
    for (const attribute of ['text', ...attributes]) {
      const key = element.getAttribute(attribute === 'text' ? 'data-i18n' : `data-i18n-${attribute}`);
      if (!key) continue;
      let binding = records.get(attribute);
      if (!binding || binding.key !== key) {
        // A direct text node may sit before or after a nested input, icon or link.
        // Updating it preserves every descendant, handler, value and focus target.
        const groups = []; let group = [];
        for (const child of element.childNodes) {
          if (child.nodeType === 3) group.push(child);
          else { if (group.some(node => /[\p{L}\p{N}]/u.test(node.textContent))) groups.push(group); group = []; }
        }
        if (group.some(node => /[\p{L}\p{N}]/u.test(node.textContent))) groups.push(group);
        if (attribute === 'text' && groups.length !== 1) continue;
        const nodes = groups[0] || [], node = nodes[0];
        binding = {key, node, nodes, last: attribute === 'text' ? nodes.map(node => node.textContent).join('') : element.getAttribute(attribute), retired: false};
        records.set(attribute, binding);
      }
      if (binding.retired) continue;
      const current = attribute === 'text' ? binding.nodes.map(node => node.textContent).join('') : element.getAttribute(attribute);
      // Runtime/source owners can replace a placeholder without it being clobbered
      // by a later language change. They then own explicit dynamic localization.
      if ((attribute === 'text' && binding.nodes.some(node => node.parentNode !== element)) || current !== binding.last) { binding.retired = true; continue; }
      const translated = i18n.t(key);
      if (attribute === 'text') binding.nodes.forEach((node, index) => { node.textContent = index === 0 ? translated : ''; });
      else element.setAttribute(attribute, translated);
      binding.last = translated;
    }
  }
}

/** One static subscription and one selector listener per application document. */
export function setupLocaleView({document = globalThis.document, i18n = getAppI18n(document)} = {}) {
  const previous = views.get(document);
  if (previous) {
    if (previous.i18n !== i18n) throw new TypeError('A document must use one display-locale service.');
    previous.refresh();
    return previous;
  }
  let disposed = false;
  const picker = () => document.getElementById('interface-language');
  const refresh = () => {
    if (disposed) return;
    document.documentElement.lang = i18n.locale;
    localizeStatic(document, i18n);
    const select = picker();
    if (select) for (const option of select.options) option.selected = option.value === i18n.locale;
    const notice = document.getElementById('locale-storage-status');
    if (notice) {
      const failed = i18n.preferenceStatus === 'failed';
      notice.hidden = !failed;
      notice.textContent = failed ? i18n.t('error.preferenceStorage') : '';
    }
  };
  const change = event => {
    if (event.target !== picker()) return;
    i18n.setLocale(event.target.value);
    refresh(); // Also show a failed persistence attempt for an unchanged choice.
  };
  document.addEventListener('change', change);
  const unsubscribe = i18n.subscribe(refresh);
  const view = {i18n, refresh, subscribe: listener => i18n.subscribe(listener), destroy() {
    if (disposed) return;
    disposed = true; unsubscribe(); document.removeEventListener('change', change); views.delete(document);
  }};
  views.set(document, view);
  refresh();
  return view;
}

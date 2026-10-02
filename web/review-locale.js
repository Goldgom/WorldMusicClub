import {getAppI18n} from './app-locale.js';

const MESSAGE = Symbol('review display message');
/** Stable application error identity; the diagnostic message is retained unchanged. */
export function reviewError(key, message, params = {}) {
  return Object.assign(new Error(message), {reviewKey: key, reviewParams: params});
}

/** Retained text/attribute bindings. A locale notification never invokes workflow code. */
export function createReviewLocale(root, i18n = getAppI18n(root.ownerDocument)) {
  const bindings = new Map();
  const m = (key, params = {}) => ({[MESSAGE]: true, key, params});
  function render(value) {
    if (!value?.[MESSAGE]) return typeof value === 'string' ? value : '';
    const embedded = [];
    const params = Object.fromEntries(Object.entries(value.params).map(([key, parameter]) => {
      if (!parameter?.[MESSAGE]) return [key, parameter];
      const token = `\uE000review${embedded.length}\uE001`; embedded.push([token, render(parameter)]); return [key, token];
    }));
    let translated = i18n.t(value.key, params);
    const literals = new Map(embedded);
    translated = translated.replace(/\uE000review\d+\uE001/g, token => literals.get(token) ?? token);
    return typeof value.detail === 'string' ? `${translated} ${value.detail}` : translated;
  }
  function bind(node, name, value) {
    if (!node) return;
    let targets = bindings.get(node); if (!targets) bindings.set(node, targets = new Map());
    targets.set(name, value);
    const result = render(value);
    if (name === null) node.textContent = result; else node.setAttribute(name, result);
  }
  function redraw() {
    for (const [node, targets] of bindings) {
      if (node !== root && !root.contains(node)) { bindings.delete(node); continue; }
      for (const [name, value] of targets) {
        const result = render(value);
        if (name === null) node.textContent = result; else node.setAttribute(name, result);
      }
    }
  }
  for (const node of [root, ...root.querySelectorAll('*')]) {
    const key = node.getAttribute('data-review-i18n'); if (key) bind(node, null, m(key));
    for (const name of ['aria-label', 'aria-description', 'title', 'placeholder', 'alt']) {
      const attributeKey = node.getAttribute(`data-review-i18n-${name}`);
      if (attributeKey) bind(node, name, m(attributeKey));
    }
  }
  root.style.overflowWrap = 'anywhere';
  for (const button of root.querySelectorAll('button')) { button.style.whiteSpace = 'normal'; button.style.maxWidth = '100%'; }
  const unsubscribe = i18n.subscribe(redraw);
  return {
    m, render, text: (node, value) => bind(node, null, value), attr: (node, name, value) => bind(node, name, value),
    error(error) {
      if (typeof error?.reviewKey === 'string' && error.reviewKey.startsWith('review.')) return m(error.reviewKey, error.reviewParams || {});
      return {...m('review.technical'), detail: typeof error?.message === 'string' ? error.message : String(error)};
    },
    destroy() { unsubscribe(); bindings.clear(); },
  };
}

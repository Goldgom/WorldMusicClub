import {getAppI18n} from './app-locale.js';

/** Session-only presentation. This controller never receives score, transport,
 * admission or take objects, and cannot retry or resolve a reported problem. */
export function setupNoticeView({document, getScope = () => '', i18n = getAppI18n(document)}) {
  const $ = id => document.getElementById(id);
  const banner = $('notice'), message = $('notice-message'), dismiss = $('notice-dismiss');
  const limit = 20, entries = [];
  let sequence = 0, current = null, disposed = false;

  const history = document.createElement('details');
  history.id = 'notice-history';
  const summary = document.createElement('summary');
  summary.id = 'notice-history-summary';
  const explanation = document.createElement('p');
  const list = document.createElement('ol');
  list.id = 'notice-history-list';
  const empty = document.createElement('p');
  history.append(summary, explanation, list, empty);
  $('settings-dialog').querySelector('.shell-dialog-content').append(history);
  // This view now owns the dismiss chrome, including runtime locale redraws.
  dismiss.removeAttribute('data-i18n');
  dismiss.removeAttribute('data-i18n-title');

  function renderText(entry) {
    // Plain strings are original/literal notices. Only an explicit app-owned
    // callback may redraw display text. Its first text remains a safe fallback.
    if (!entry.renderMessage) return entry.message;
    try { const next = entry.renderMessage(); return typeof next === 'string' ? next : entry.message; }
    catch { return entry.message; }
  }
  function renderHistory({redrawMessages = false} = {}) {
    summary.textContent = i18n.t(sequence > limit ? 'notice.historyLimited' : 'notice.historyCount', {count:entries.length});
    empty.hidden = entries.length > 0;
    explanation.textContent = i18n.t('notice.historyExplanation');
    empty.textContent = i18n.t('notice.empty');
    dismiss.textContent = i18n.t('notice.dismiss');
    dismiss.title = i18n.t('notice.dismissTitle');
    for (const [index, entry] of [...entries].reverse().entries()) {
      if (!entry.row) {
        entry.row = document.createElement('li');
        entry.row.dataset.messageId = String(entry.id);
        entry.heading = document.createElement('strong');
        entry.body = document.createElement('p');
        entry.row.append(entry.heading, entry.body);
        if (entry.scope) {
          const scope = document.createElement('small');
          entry.scopeLabel = document.createElement('span');
          const source = document.createElement('span');
          source.textContent = entry.scope; // Original source, no display length bound.
          scope.append(entry.scopeLabel, document.createTextNode(' '), source);
          entry.row.append(scope);
        }
      }
      entry.row.dataset.presentation = entry.presentation;
      entry.row.classList.toggle('error', entry.error);
      entry.heading.textContent = i18n.t(entry.error ? 'notice.errorHeading' : 'notice.messageHeading', {id:entry.id,presentation:i18n.t(`notice.presentation.${entry.presentation}`)});
      if (redrawMessages) entry.displayText = renderText(entry);
      const text = entry.displayText;
      if (entry.body.textContent !== text) entry.body.textContent = text;
      if (entry.scopeLabel) entry.scopeLabel.textContent = i18n.t('notice.scopeLabel');
      if (list.children[index] !== entry.row) list.insertBefore(entry.row, list.children[index] || null);
    }
    while (list.children.length > entries.length) list.lastElementChild.remove();
    if (current) {
      const text = current.displayText;
      if (message.textContent !== text) message.textContent = text;
    }
  }

  function hide(presentation) {
    if (disposed) return;
    const hadFocus = banner.contains(document.activeElement);
    banner.hidden = true;
    if (current) current.presentation = presentation;
    current = null;
    renderHistory();
    // Removing a focused banner should not strand keyboard users on the body.
    // Do not steal focus from a panel or any control outside the banner.
    if (hadFocus) {
      const target = $(document.body.dataset.screen === 'stage' ? 'stage-title' : 'lobby-title');
      target?.focus({preventScroll:true});
    }
  }

  const onDismiss = () => hide('dismissed');
  dismiss.addEventListener('click', onDismiss);
  renderHistory();
  const unsubscribe = i18n.subscribe(() => renderHistory({redrawMessages:true}));
  return {
    /** Localized callbacks must capture immutable event-specific display data. */
    show(text, error = false) {
      if (disposed) return;
      const renderMessage = typeof text === 'function' ? text : null;
      let original;
      if (renderMessage) { try { original = renderMessage(); } catch { original = i18n.t('error.unknown'); } }
      else original = String(text ?? '');
      if (typeof original !== 'string') original = i18n.t('error.unknown');
      if (current) current.presentation = 'replaced';
      current = {id:++sequence, message:original, displayText:original, renderMessage, error:Boolean(error), scope:String(getScope() || ''), presentation:'shown'};
      entries.push(current);
      if (entries.length > limit) entries.shift();
      message.textContent = current.message;
      message.scrollTop = 0;
      banner.classList.toggle('error', current.error);
      banner.hidden = false;
      renderHistory();
    },
    // Existing successful score preparation may clear obsolete scoped messages.
    // Keep their text available as history; never label them resolved.
    clear() { hide('cleared'); },
    destroy() { if (disposed) return; disposed = true; unsubscribe(); dismiss.removeEventListener('click', onDismiss); },
  };
}

/** Session-only presentation. This controller never receives score, transport,
 * admission or take objects, and cannot retry or resolve a reported problem. */
export function setupNoticeView({document, getScope = () => ''}) {
  const $ = id => document.getElementById(id);
  const banner = $('notice'), message = $('notice-message'), dismiss = $('notice-dismiss');
  const limit = 20, entries = [];
  let sequence = 0, current = null;

  const history = document.createElement('details');
  history.id = 'notice-history';
  const summary = document.createElement('summary');
  summary.id = 'notice-history-summary';
  const explanation = document.createElement('p');
  explanation.textContent = 'The latest 20 messages from this tab, newest first. Earlier messages are omitted. Dismissing a message only hides its banner. Check Score, Settings and Results for current diagnostics. 最近消息仅保留于当前标签页。';
  const list = document.createElement('ol');
  list.id = 'notice-history-list';
  const empty = document.createElement('p');
  empty.textContent = 'No messages yet · 暂无消息';
  history.append(summary, explanation, list, empty);
  $('settings-dialog').querySelector('.shell-dialog-content').append(history);

  function renderHistory() {
    summary.textContent = `Recent messages · 最近消息 (${entries.length}${sequence > limit ? ' / latest 20' : ''})`;
    empty.hidden = entries.length > 0;
    list.replaceChildren();
    for (const entry of [...entries].reverse()) {
      const row = document.createElement('li');
      row.dataset.messageId = String(entry.id);
      row.dataset.presentation = entry.presentation;
      row.classList.toggle('error', entry.error);
      const heading = document.createElement('strong');
      const presentation = {shown:'Shown above', dismissed:'Dismissed', replaced:'Earlier message', cleared:'Cleared after score preparation'}[entry.presentation];
      heading.textContent = `${entry.error ? 'Error · 错误' : 'Message · 消息'} ${entry.id} · ${presentation}`;
      const body = document.createElement('p');
      body.textContent = entry.message;
      row.append(heading, body);
      if (entry.scope) {
        const scope = document.createElement('small');
        scope.textContent = `Active score when reported: ${entry.scope}`;
        row.append(scope);
      }
      list.append(row);
    }
  }

  function hide(presentation) {
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

  dismiss.addEventListener('click', () => hide('dismissed'));
  renderHistory();
  return {
    show(text, error = false) {
      if (current) current.presentation = 'replaced';
      current = {id:++sequence, message:String(text ?? ''), error:Boolean(error), scope:String(getScope() || ''), presentation:'shown'};
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
  };
}

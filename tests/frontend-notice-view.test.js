import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseHTML} from 'linkedom';
import {setupNoticeView} from '../web/notice-view.js';

const html = await readFile(new URL('../web/index.html', import.meta.url), 'utf8');

function noticeFixture() {
  const {document, window} = parseHTML(html);
  const $ = id => document.getElementById(id);
  const settings = document.createElement('dialog');
  settings.id = 'settings-dialog';
  settings.innerHTML = '<div class="shell-dialog-content"></div>';
  const headings = document.createElement('div');
  headings.innerHTML = '<h1 id="stage-title" tabindex="-1">Stage</h1><h1 id="lobby-title" tabindex="-1">Library</h1>';
  document.body.append(settings, headings);
  let active = null, scope = 'Original source';
  Object.defineProperty(document, 'activeElement', {get:()=>active});
  window.HTMLElement.prototype.focus = function() { active = this; };
  const view = setupNoticeView({document, getScope:()=>scope});
  return {document, window, $, view, setScope:value=>{scope=value;}};
}

test('notice keeps complete literal text and an accessible explicit dismissal without a timer', t => {
  const f = noticeFixture();
  const timer = t.mock.method(globalThis, 'setTimeout', () => assert.fail('Notices must not schedule automatic hiding or retries'));
  const full = 'Could not check this take. <img src=x onerror="bad()">\nIts inputs are retained. 请查看完整消息。\n' + 'Long retained explanation. '.repeat(70);
  assert.equal(f.$('notice').hidden, true);
  f.view.show(full, true);
  assert.equal(f.$('notice').hidden, false);
  assert.equal(f.$('notice-message').textContent, full);
  assert.equal(f.$('notice-message').getAttribute('role'), 'status');
  assert.equal(f.$('notice-message').getAttribute('aria-live'), 'polite');
  assert.equal(f.$('notice-message').getAttribute('aria-atomic'), 'true');
  assert.equal(f.$('notice-message').getAttribute('tabindex'), '0', 'Long text can receive keyboard scrolling focus');
  assert.equal(f.$('notice-dismiss').getAttribute('type'), 'button');
  assert.match(f.$('notice-dismiss').textContent, /Dismiss message/);
  assert.equal(f.$('notice').classList.contains('error'), true);
  assert.equal(f.$('notice').querySelector('img'), null);
  assert.equal(f.$('notice-history-list').querySelector('img'), null);
  assert.equal(f.$('notice-history-list').querySelector('p').textContent, full);
  assert.equal(timer.mock.callCount(), 0);
});

test('explicit dismissal changes only presentation and returns banner focus to the current screen', () => {
  for (const screen of ['stage', 'library']) {
    const f = noticeFixture();
    f.document.body.dataset.screen = screen;
    f.$('practice-gate').hidden = false;
    f.$('practice-gate-reason').textContent = 'Failed instrument check; retry is still needed';
    f.$('play-button').disabled = true;
    f.$('retry-assessments').hidden = false;
    f.$('diagnostic-list').textContent = 'Retained source warning';
    f.$('transport-status').textContent = 'Paused · 已暂停';
    const preserved = ['score-title', 'practice-gate', 'play-button', 'retry-assessments', 'diagnostic-list', 'transport-status'].map(id=>f.$(id).outerHTML);
    f.view.show('An error is still pending', true);
    f.$('notice-dismiss').focus();
    f.$('notice-dismiss').click();
    assert.equal(f.$('notice').hidden, true);
    assert.equal(f.document.activeElement.id, screen === 'stage' ? 'stage-title' : 'lobby-title');
    assert.deepEqual(['score-title', 'practice-gate', 'play-button', 'retry-assessments', 'diagnostic-list', 'transport-status'].map(id=>f.$(id).outerHTML), preserved);
    assert.equal(f.$('notice-history-list').firstElementChild.dataset.presentation, 'dismissed');
    assert.match(f.$('notice-history-list').textContent, /An error is still pending/);
    f.$('notice-dismiss').click();
    assert.equal(f.$('notice-history-list').children.length, 1, 'Repeated dismissal does not invent another message');
  }
});

test('showing messages and clearing an old score notice never steal outside focus or erase history', () => {
  const f = noticeFixture();
  f.$('tempo').focus();
  f.view.show('Score preparation failed', true);
  assert.equal(f.document.activeElement.id, 'tempo');
  f.view.clear();
  assert.equal(f.$('notice').hidden, true);
  assert.equal(f.document.activeElement.id, 'tempo');
  assert.equal(f.$('notice-history-list').firstElementChild.dataset.presentation, 'cleared');
  assert.match(f.$('notice-history-list').textContent, /Cleared after score preparation/);
  assert.match(f.$('notice-history-list').textContent, /Active score when reported: Original source/);
  f.setScope('Different score');
  f.view.show('Complete score download requested.');
  assert.equal(f.$('notice').hidden, false);
  assert.equal(f.$('notice').classList.contains('error'), false);
  assert.match(f.$('notice-history-list').firstElementChild.textContent, /Different score/);
  assert.match(f.$('notice-history-list').lastElementChild.textContent, /Original source/);
  f.$('notice-dismiss').click();
  assert.equal(f.document.activeElement.id, 'tempo', 'Pointer dismissal cannot redirect focus from outside the banner');
});

test('session message history is newest-first, bounded, clearly historical and keeps exact error text', () => {
  const f = noticeFixture();
  for (let n=1; n<=23; n++) f.view.show(`Message ${n} · 完整内容`, n%2 === 0);
  const rows = [...f.$('notice-history-list').children];
  assert.equal(rows.length, 20);
  assert.equal(rows[0].dataset.messageId, '23');
  assert.equal(rows.at(-1).dataset.messageId, '4');
  assert.equal(rows[0].dataset.presentation, 'shown');
  assert.equal(rows[1].dataset.presentation, 'replaced');
  assert.equal(rows[1].classList.contains('error'), true);
  assert.equal(rows[1].querySelector('p').textContent, 'Message 22 · 完整内容');
  assert.match(f.$('notice-history-summary').textContent, /latest 20/);
  assert.match(f.$('notice-history').textContent, /from this tab.*Earlier messages are omitted/);
  assert.equal(f.$('notice-history').closest('dialog').id, 'settings-dialog');
  assert.equal(f.document.querySelectorAll('#notice-dismiss').length, 1);
  assert.equal(f.document.querySelectorAll('#notice-history').length, 1);
  assert.equal(noticeFixture().$('notice-history-list').children.length, 0, 'New sessions never inherit message history');
});

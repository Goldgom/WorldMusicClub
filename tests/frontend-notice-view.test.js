import {createI18n} from '../web/i18n.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseHTML} from 'linkedom';
import {setupNoticeView} from '../web/notice-view.js';

const html = await readFile(new URL('../web/index.html', import.meta.url), 'utf8');

function noticeFixture({i18n=createI18n({onReport(){}})}={}) {
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
  const view = setupNoticeView({document, i18n, getScope:()=>scope});
  return {document, window, $, view, i18n, setScope:value=>{scope=value;}};
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
  assert.equal(f.$('notice-dismiss').textContent, '关闭消息');
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
  assert.match(f.$('notice-history-list').textContent, /乐谱准备后已清除横幅/);
  assert.match(f.$('notice-history-list').textContent, /消息出现时的当前乐谱： Original source/);
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
  assert.match(f.$('notice-history-summary').textContent, /仅保留最近 20 条/);
  assert.match(f.$('notice-history').textContent, /当前标签页最近的 20 条消息.*较早消息会被省略/);
  assert.equal(f.$('notice-history').closest('dialog').id, 'settings-dialog');
  assert.equal(f.document.querySelectorAll('#notice-dismiss').length, 1);
  assert.equal(f.document.querySelectorAll('#notice-history').length, 1);
  assert.equal(noticeFixture().$('notice-history-list').children.length, 0, 'New sessions never inherit message history');
});


test('notice locale switches translate only chrome and preserve exact long literal history, scope and focus',()=>{
 const f=noticeFixture();
 try{
  const full='Original external error <script> 不翻译 '+ 'details '.repeat(1600),scope='Source <img> 原稿 '+ 'title '.repeat(1800);
  f.setScope(scope);f.view.show(full,true);f.$('notice-history').setAttribute('open','');f.$('notice-message').focus();
  const row=f.$('notice-history-list').firstElementChild,body=row.querySelector('p'),source=row.querySelector('small').lastElementChild,dismiss=f.$('notice-dismiss');f.$('notice-message').scrollTop=75;
  f.i18n.setLocale('en');assert.equal(dismiss.textContent,'Dismiss message');assert.equal(dismiss.title,'Keep this message in Settings → Recent messages');assert.equal(f.$('notice-history-summary').textContent,'Recent messages (1)');assert.equal(f.$('notice-message').textContent,full);assert.equal(body.textContent,full);assert.equal(source.textContent,scope);assert.equal(f.$('notice-history-list').firstElementChild,row);assert.equal(row.querySelector('p'),body);assert.equal(row.querySelector('small').lastElementChild,source);assert.equal(f.document.activeElement,f.$('notice-message'));assert.equal(f.$('notice-message').scrollTop,75);assert.equal(f.$('notice-history').hasAttribute('open'),true);assert.equal(f.$('notice').querySelector('script'),null);
  f.i18n.setLocale('zh-CN');assert.equal(dismiss.textContent,'关闭消息');assert.equal(f.$('notice-message').textContent,full);assert.equal(f.$('notice').hidden,false);assert.equal(row.dataset.presentation,'shown');
  f.view.destroy();const header=f.$('notice-history-summary').textContent;f.i18n.setLocale('en');assert.equal(f.$('notice-history-summary').textContent,header);dismiss.click();assert.equal(f.$('notice').hidden,false);
 }finally{f.view.destroy()}
});

test('explicit app-owned notice callbacks redraw while literal history and first-text fallback remain intact',()=>{
 const f=noticeFixture();let broken=false,calls=0;
 try{
  f.view.show('Literal original error.');
  f.view.show(()=>{calls++;if(broken)throw Error('render unavailable');return f.i18n.t('common.retry');},true);assert.equal(calls,1,'Initial app-owned notice renders once');
  const row=f.$('notice-history-list').firstElementChild,literal=f.$('notice-history-list').lastElementChild;
  assert.equal(f.$('notice-message').textContent,'重试');f.i18n.setLocale('en');assert.equal(f.$('notice-message').textContent,'Retry');assert.equal(row.querySelector('p').textContent,'Retry');assert.equal(calls,2,'A locale redraw renders each app-owned notice once');assert.equal(literal.querySelector('p').textContent,'Literal original error.');assert.equal(literal.dataset.presentation,'replaced');
  broken=true;f.i18n.setLocale('zh-CN');assert.equal(f.$('notice-message').textContent,'重试');assert.equal(row.querySelector('p').textContent,'重试');assert.equal(f.$('notice-history-list').children.length,2);
 }finally{f.view.destroy()}
});

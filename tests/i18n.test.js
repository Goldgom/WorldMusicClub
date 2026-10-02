import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {
  createI18n, createDocumentLanguageAdapter, validateLocaleCatalogs,
  DEFAULT_LOCALE, SUPPORTED_LOCALES, LOCALE_STORAGE_KEY, LOCALE_CATALOGS,
  MESSAGE_SCHEMA, ERROR_MESSAGE_KEYS, isSupportedLocale
} from '../web/i18n.js';

const make = options => createI18n({onReport: () => {}, ...options});
function memoryStorage(initial = null) {
  let saved = initial;
  const writes = [], reads = [];
  return {writes, reads, getItem(key) { reads.push(key); return saved; }, setItem(key, value) { writes.push([key, value]); saved = value; }};
}
const sampleParams = schema => Object.fromEntries(Object.entries(schema.params).map(([key, type]) => [key, type === 'text' ? 'source-原名' : 2]));

test('both immutable bundled catalogs have exact schema/key/parameter/plural parity', () => {
  assert.deepEqual(validateLocaleCatalogs(), []);
  assert.equal(DEFAULT_LOCALE, 'zh-CN');
  assert.deepEqual(SUPPORTED_LOCALES, ['zh-CN', 'en']);
  for (const locale of SUPPORTED_LOCALES) {
    assert.deepEqual(Object.keys(LOCALE_CATALOGS[locale]).sort(), Object.keys(MESSAGE_SCHEMA).sort());
    assert.equal(Object.isFrozen(LOCALE_CATALOGS[locale]), true);
    const i18n = make({locale});
    for (const [key, schema] of Object.entries(MESSAGE_SCHEMA)) {
      assert.equal(Object.isFrozen(schema), true, key);
      assert.equal(Object.isFrozen(schema.params), true, key);
      const text = i18n.t(key, sampleParams(schema));
      assert.equal(typeof text, 'string', key);
      assert.ok(text.length > 0, key);
      assert.doesNotMatch(text, /\{[A-Za-z]+\}/, key);
    }
    assert.deepEqual(i18n.getReports(), []);
  }
  for (const key of Object.values(ERROR_MESSAGE_KEYS)) assert.ok(Object.hasOwn(MESSAGE_SCHEMA, key), key);
});

test('catalog validator reports missing/extra keys and incompatible parameter contracts', () => {
  const catalogs = structuredClone(LOCALE_CATALOGS);
  delete catalogs.en['common.stop'];
  catalogs.en.untracked = 'Untracked';
  catalogs.en['keyboard.span'] = 'From {low} to {unexpected}';
  catalogs['zh-CN']['free.duration'] = '时长：{duration';
  const issues = validateLocaleCatalogs(catalogs);
  for (const code of ['catalog_missing_key', 'catalog_extra_key', 'catalog_parameters_mismatch']) assert.ok(issues.some(issue => issue.code === code));
  assert.ok(issues.some(issue => issue.locale === 'zh-CN' && issue.key === 'free.duration'));
});

test('catalog validator rejects malformed/missing plural branches, empty text and absent locales', () => {
  const catalogs = structuredClone(LOCALE_CATALOGS);
  delete catalogs.en['free.eventCount'].one;
  catalogs.en['free.eventCount'].few = '{count} events';
  catalogs.en['free.recordCount'] = 'Not a plural message';
  catalogs.en['common.save'] = '';
  delete catalogs['zh-CN'];
  const codes = validateLocaleCatalogs(catalogs).map(issue => issue.code);
  for (const code of ['catalog_missing', 'catalog_plural_missing', 'catalog_plural_extra', 'catalog_plural_required', 'catalog_invalid_text']) assert.ok(codes.includes(code), code);
});

test('Chinese is the default; a valid exact saved choice is honored without a startup write', () => {
  assert.equal(make().locale, 'zh-CN');
  for (const locale of SUPPORTED_LOCALES) {
    const storage = memoryStorage(locale), i18n = make({storage});
    assert.equal(i18n.locale, locale);
    assert.deepEqual(storage.reads, [LOCALE_STORAGE_KEY]);
    assert.deepEqual(storage.writes, []);
  }
  const storage = memoryStorage('en');
  assert.equal(make({locale: 'zh-CN', storage}).locale, 'zh-CN');
  assert.equal(make({locale: 'fr', storage}).locale, 'en');
});

test('stored choices are bounded exact allowlisted strings, never parsed as arbitrary objects', () => {
  for (const value of ['en-US', 'zh', 'zh-TW', 'EN', ' en ', '"en"', '{"locale":"en"}', '__proto__', '<script>en</script>', 'e'.repeat(100000), 1, {}, ['en']]) {
    const i18n = make({storage: memoryStorage(value)});
    assert.equal(i18n.locale, 'zh-CN');
    assert.equal(i18n.getReports()[0].code, 'locale_storage_invalid');
    assert.equal(JSON.stringify(i18n.getReports()).includes('<script>'), false);
  }
  for (const value of [null, undefined]) assert.deepEqual(make({storage: memoryStorage(value)}).getReports(), []);
  assert.equal(isSupportedLocale('en'), true);
  assert.equal(isSupportedLocale({toString: () => 'en'}), false);
});

test('locale selection persists only the validated locale and survives recreation', () => {
  const storage = memoryStorage(), i18n = make({storage});
  assert.equal(i18n.setLocale('en'), true);
  assert.deepEqual(storage.writes, [[LOCALE_STORAGE_KEY, 'en']]);
  assert.equal(make({storage}).locale, 'en');
  assert.equal(i18n.setLocale('zh-TW'), false);
  assert.equal(i18n.locale, 'en');
  assert.equal(storage.writes.length, 1);
  assert.equal(i18n.setLocale('en'), true, 'A same-language explicit selection can retry saving');
  assert.equal(i18n.revision, 1);
});

test('storage read/write/getter failures leave in-tab switching operational and diagnosable', () => {
  for (const storage of [
    {getItem() { throw Error('Denied'); }, setItem() { throw Error('Quota'); }},
    () => { throw Error('localStorage getter denied'); }
  ]) {
    const languages = [], i18n = make({storage, setDocumentLanguage: locale => languages.push(locale)});
    assert.equal(i18n.locale, 'zh-CN');
    i18n.setLocale('en');
    assert.equal(i18n.t('common.stop'), 'Stop');
    assert.deepEqual(languages, ['zh-CN', 'en']);
    assert.ok(i18n.getReports().some(issue => issue.code === 'locale_storage_read_failed'));
    assert.ok(i18n.getReports().some(issue => issue.code === 'locale_storage_write_failed'));
  }
  let writable = false;
  const storage = memoryStorage(), i18n = make({storage: () => { if (!writable) throw Error('Temporarily unavailable'); return storage; }});
  i18n.setLocale('en');
  writable = true;
  i18n.setLocale('en');
  assert.deepEqual(storage.writes, [[LOCALE_STORAGE_KEY, 'en']]);
});

test('document language adapter updates only lang while nodes, source text and active draft survive', () => {
  const {document} = parseHTML('<html lang="en"><body><button id="control">Original control</button><input id="draft" value="半成品"><p id="source">初见 · First Steps</p></body></html>');
  const control = document.getElementById('control'), draft = document.getElementById('draft'), source = document.getElementById('source');
  const i18n = make({setDocumentLanguage: createDocumentLanguageAdapter(document)});
  assert.equal(document.documentElement.lang, 'zh-CN');
  i18n.setLocale('en');
  assert.equal(document.documentElement.lang, 'en');
  assert.equal(document.getElementById('control'), control);
  assert.equal(document.getElementById('draft'), draft);
  assert.equal(draft.value, '半成品');
  assert.equal(source.textContent, '初见 · First Steps');
  assert.throws(() => createDocumentLanguageAdapter(document)('en-US'), TypeError);
});

test('locale subscriptions and explicit invalidation supply cache revisions without duplicate callbacks', () => {
  const i18n = make(), events = [], listener = event => events.push(event);
  const unsubscribe = i18n.subscribe(listener);
  i18n.subscribe(listener);
  assert.equal(events.length, 0);
  i18n.setLocale('en');
  i18n.setLocale('en');
  i18n.invalidate();
  i18n.setLocale('zh-CN');
  assert.deepEqual(events, [
    {type: 'locale', locale: 'en', previousLocale: 'zh-CN', revision: 1},
    {type: 'invalidate', locale: 'en', previousLocale: 'en', revision: 2},
    {type: 'locale', locale: 'zh-CN', previousLocale: 'en', revision: 3}
  ]);
  assert.equal(events.every(Object.isFrozen), true);
  unsubscribe(); unsubscribe();
  i18n.setLocale('en');
  assert.equal(events.length, 3);
  assert.equal(i18n.revision, 4);
  assert.throws(() => i18n.subscribe(null), TypeError);
});

test('subscriber/adapter/reporting failures do not block other listeners or locale changes', () => {
  const i18n = createI18n({setDocumentLanguage() { throw Error('No DOM'); }, onReport() { throw Error('Reporter failed'); }}), events = [];
  i18n.subscribe(() => { throw Error('Failed redraw'); });
  i18n.subscribe(event => events.push(event));
  assert.doesNotThrow(() => i18n.setLocale('en'));
  assert.equal(events.length, 1);
  assert.equal(i18n.locale, 'en');
  assert.ok(i18n.getReports().some(issue => issue.code === 'document_language_failed'));
  assert.ok(i18n.getReports().some(issue => issue.code === 'locale_subscriber_failed'));
});

test('nested locale changes notify all listeners in revision order', () => {
  const i18n = make(), received = [];
  i18n.subscribe(event => { if (event.locale === 'en') i18n.setLocale('zh-CN'); });
  i18n.subscribe(event => received.push([event.locale, event.revision]));
  i18n.setLocale('en');
  assert.deepEqual(received, [['en', 1], ['zh-CN', 2]]);
  assert.equal(i18n.locale, 'zh-CN');
});

test('missing keys and params return selected-language neutral fallback and report exact contracts', () => {
  for (const locale of SUPPORTED_LOCALES) {
    const i18n = make({locale}), fallback = i18n.t('i18n.unavailable');
    for (const key of ['not.registered', '__proto__', 'constructor', null]) assert.equal(i18n.t(key), fallback);
    assert.equal(i18n.t('keyboard.span', {low: 'C3'}), fallback);
    assert.equal(i18n.t('common.stop', {unused: 'Do not leak this'}), fallback);
    assert.equal(i18n.t('free.eventCount', {count: '1'}), fallback);
    assert.ok(i18n.getReports().some(issue => issue.code === 'message_param_missing' && issue.param === 'high'));
    assert.ok(i18n.getReports().some(issue => issue.code === 'message_param_unexpected'));
    assert.doesNotMatch(JSON.stringify(i18n.getReports()), /Do not leak this/);
  }
});

test('parameters are own typed data, with no object coercion, inherited interpolation or getter execution', () => {
  const i18n = make(), fallback = i18n.t('i18n.unavailable');
  let accesses = 0;
  const object = {toString() { accesses++; return '<img>'; }}, accessor = {get title() { accesses++; return 'Getter'; }};
  for (const params of [{title: object}, accessor, Object.create({title: 'Inherited'}), null, [], 'text']) assert.equal(i18n.t('results.recordTitle', params), fallback);
  assert.equal(accesses, 0);
  for (const count of [-1, 0.5, Infinity, NaN, 9007199254740992, 1n, true]) assert.equal(i18n.t('free.eventCount', {count}), fallback);
  assert.equal(i18n.t('keyboard.offset', {semitones: -12}), '输入移调：-12 个半音');
});

test('untrusted parameters stay literal text, including markup, braces and replacement symbols', () => {
  const i18n = make({locale: 'en'}), title = '<img src=x onerror="throw 1"> & {count} $& $1 中文';
  const {document} = parseHTML('<html><body><div id="label"></div><button id="key"></button></body></html>');
  const label = document.getElementById('label'), button = document.getElementById('key');
  label.textContent = i18n.t('results.recordTitle', {title});
  button.setAttribute('aria-label', i18n.t('stage.pianoKey', {note: title}));
  assert.equal(label.textContent, `Performance: ${title}`);
  assert.equal(label.children.length, 0);
  assert.equal(document.querySelector('img'), null);
  assert.equal(button.getAttribute('aria-label'), `Piano key ${title}`);
  assert.equal(button.hasAttribute('onerror'), false);
});

test('long labels and expanded translations are preserved within a documented bounded text contract', () => {
  const title = '长标题《Study & Variations》 '.repeat(100), i18n = make();
  assert.equal(i18n.t('results.recordTitle', {title}), `演奏记录：${title}`);
  i18n.setLocale('en');
  assert.equal(i18n.t('results.recordTitle', {title}), `Performance: ${title}`);
  assert.equal(i18n.t('keyboard.rollover'), LOCALE_CATALOGS.en['keyboard.rollover']);
  assert.equal(i18n.t('results.recordTitle', {title: 'a'.repeat(8193)}), i18n.t('i18n.unavailable'));
});

test('explicit count plural selection uses Intl and locale formatting without English suffix logic', () => {
  const i18n = make({locale: 'en'});
  assert.equal(i18n.t('free.eventCount', {count: 0}), '0 input events');
  assert.equal(i18n.t('free.eventCount', {count: 1}), '1 input event');
  assert.equal(i18n.t('free.eventCount', {count: 2}), '2 input events');
  assert.equal(i18n.t('free.recordCount', {count: 1000}), '1,000 performances');
  assert.equal(i18n.t('keyboard.offset', {semitones: -1}), 'Input transposition: -1 semitone');
  assert.equal(i18n.t('keyboard.offset', {semitones: 1}), 'Input transposition: 1 semitone');
  assert.equal(i18n.t('keyboard.offset', {semitones: 0}), 'Input transposition: 0 semitones');
  i18n.setLocale('zh-CN');
  assert.equal(i18n.t('free.eventCount', {count: 1}), '1 条输入事件');
  assert.equal(i18n.t('free.eventCount', {count: 1000}), '1,000 条输入事件');
});

test('number and date display use the chosen locale without modifying canonical values', () => {
  const canonical = Object.freeze({created_at: '2026-10-01T12:34:56.789Z', midi: 60, part_id: '钢琴-1', duration_ms: 90123});
  const before = JSON.stringify(canonical), options = {timeZone: 'UTC', dateStyle: 'long', timeStyle: 'short'};
  const i18n = make();
  for (const locale of SUPPORTED_LOCALES) {
    i18n.setLocale(locale);
    assert.equal(i18n.formatNumber(1234.5, {minimumFractionDigits: 2}), new Intl.NumberFormat(locale, {minimumFractionDigits: 2}).format(1234.5));
    const expected = new Intl.DateTimeFormat(locale, options).format(new Date(canonical.created_at));
    assert.equal(i18n.formatDateTime(canonical.created_at, options), expected);
    assert.equal(i18n.formatDateTime(new Date(canonical.created_at), options), expected);
    assert.equal(i18n.formatDateTime(Date.parse(canonical.created_at), options), expected);
  }
  assert.equal(JSON.stringify(canonical), before);
});

test('invalid numbers, ambiguous dates and invalid Intl options are reported without coercion', () => {
  const i18n = make(), fallback = i18n.t('i18n.unavailable');
  for (const value of [NaN, Infinity, '12', null, {}]) assert.equal(i18n.formatNumber(value), fallback);
  for (const value of ['10/01/2026', '2026-10-01', '2026-99-99T12:00:00Z', '2026-02-30T12:00:00Z', '2026-10-01T24:00:00Z', new Date(NaN), {}, null, Infinity]) assert.equal(i18n.formatDateTime(value), fallback);
  assert.equal(i18n.formatNumber(2, {style: 'unrecognized'}), fallback);
  assert.equal(i18n.formatDateTime(0, {timeZone: 'Invalid/Zone'}), fallback);
  assert.equal(i18n.getReports().length, 4);
});

test('elapsed duration is independent of dates/zones, preserves long minutes and floors fractions', () => {
  const i18n = make();
  for (const locale of SUPPORTED_LOCALES) {
    i18n.setLocale(locale);
    for (const [milliseconds, expected] of [[0, '0:00'], [999, '0:00'], [1000, '0:01'], [59999, '0:59'], [60000, '1:00'], [5400123, '90:00'], [86400000, '1440:00']]) assert.equal(i18n.formatDuration(milliseconds), expected);
    assert.equal(i18n.formatDuration(59999.999, {fractionDigits: 3}), '0:59.999');
    assert.equal(i18n.formatDuration(60001, {fractionDigits: 3}), '1:00.001');
    assert.equal(i18n.formatDuration(61599, {fractionDigits: 1}), '1:01.5');
  }
  const fallback = i18n.t('i18n.unavailable');
  for (const value of [-1, NaN, Infinity, '1000', Number.MAX_SAFE_INTEGER + 1]) assert.equal(i18n.formatDuration(value), fallback);
  for (const fractionDigits of [-1, 4, 0.5, '2']) assert.equal(i18n.formatDuration(1000, {fractionDigits}), fallback);
});

test('stable error codes use mapped messages; unknown codes never promote external English prose', () => {
  const i18n = make();
  for (const [code, key] of Object.entries(ERROR_MESSAGE_KEYS)) assert.equal(i18n.message(code), i18n.t(key));
  const external = {code: 'unknown_server_code', message: 'English detail, source IDs and original XML stay unchanged'};
  const before = JSON.stringify(external);
  assert.equal(i18n.message(external.code), i18n.t('error.unknown'));
  assert.equal(i18n.message(external), i18n.t('error.unknown'));
  assert.equal(i18n.message('constructor'), i18n.t('error.unknown'));
  assert.equal(JSON.stringify(external), before);
  assert.doesNotMatch(i18n.message(external.code), /English detail/);
  i18n.setLocale('en');
  assert.equal(i18n.message('keyboard_duplicate_code'), 'A physical key cannot be assigned more than once.');
});

test('reports are bounded, deduplicated, immutable and exclude parameter values', () => {
  const delivered = [], i18n = make({onReport: issue => delivered.push(issue)});
  i18n.t('missing'); i18n.t('missing');
  assert.equal(delivered.length, 1);
  for (let i = 0; i < 100; i++) i18n.t(`missing.${i}`);
  assert.equal(i18n.getReports().length, 64);
  const copy = i18n.getReports(); copy.length = 0;
  assert.equal(i18n.getReports().length, 64);
  assert.equal(i18n.getReports().every(Object.isFrozen), true);
  i18n.t('results.recordTitle', {title: {privateData: 'not for diagnostics'}});
  assert.doesNotMatch(JSON.stringify(i18n.getReports()), /privateData|not for diagnostics/);
});


test('current preference status recovers after a successful retry without erasing diagnostic history', () => {
  assert.equal(make().preferenceStatus, 'memory');
  let blocked = true;
  const storage = {getItem() { throw Error('Read unavailable'); }, setItem() { if (blocked) throw Error('Write unavailable'); }};
  const i18n = make({storage});
  assert.equal(i18n.preferenceStatus, 'failed');
  i18n.setLocale('en');
  assert.equal(i18n.preferenceStatus, 'failed');
  blocked = false;
  i18n.setLocale('en');
  assert.equal(i18n.preferenceStatus, 'ready');
  assert.ok(i18n.getReports().some(issue => issue.code === 'locale_storage_write_failed'));
});

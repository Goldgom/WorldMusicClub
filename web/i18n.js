import preferencesRuntimeSchema from './locales/preferences-runtime-schema.js';
import beginnerSchema from './locales/beginner-schema.js';
import notationRuntimeSchema from './locales/notation-runtime-schema.js';
import instrumentRuntimeSchema from './locales/instrument-runtime-schema.js';
import reviewRuntimeSchema from './locales/review-runtime-schema.js';
import externalReviewSchema from './locales/external-review-schema.js';
import pitchReviewSchema from './locales/pitch-review-schema.js';
import sourceDirectorySchema from './locales/source-directory-schema.js';
import librarySchema from './locales/library-schema.js';
import guitarPhraseSchema from './locales/guitar-phrase-schema.js';
import inputSchema from './locales/input-schema.js';
import freeSchema from './locales/free-schema.js';
import appSchema from './locales/app-schema.js';
import feedbackSchema from './locales/feedback-schema.js';
import shellSchema from './locales/shell-schema.js';
import staticSchema from './locales/static-schema.js';
import zhCN from './locales/zh-CN.js';
import en from './locales/en.js';

export const DEFAULT_LOCALE = 'zh-CN';
export const SUPPORTED_LOCALES = Object.freeze(['zh-CN', 'en']);
export const LOCALE_STORAGE_KEY = 'worldmusichub.locale.v1';
export const LOCALE_CATALOGS = Object.freeze({'zh-CN': zhCN, en});
const MAX_REPORTS = 64, MAX_TEXT_LENGTH = 8192;
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const plain = Object.freeze({params: Object.freeze({})});
const parameterized = (params, plural) => Object.freeze({params: Object.freeze(params), ...(plural ? {plural} : {})});

/** Explicit display contracts. A machine code/identifier is never inferred from prose. */
export const MESSAGE_SCHEMA = Object.freeze({
  ...preferencesRuntimeSchema,
  ...beginnerSchema,
  ...notationRuntimeSchema,
  ...instrumentRuntimeSchema,
  ...reviewRuntimeSchema,
  ...externalReviewSchema,
  ...pitchReviewSchema,
  ...sourceDirectorySchema,
  ...librarySchema,
  ...guitarPhraseSchema,
  ...inputSchema,
  ...freeSchema,
  ...appSchema,
  ...feedbackSchema,
  ...staticSchema,
  ...shellSchema,
  'i18n.unavailable': plain,
  'common.start': plain,
  'common.pause': plain,
  'common.resume': plain,
  'common.stop': plain,
  'common.close': plain,
  'common.cancel': plain,
  'common.retry': plain,
  'common.save': plain,
  'common.export': plain,
  'common.remove': plain,
  'nav.library': plain,
  'nav.freePractice': plain,
  'nav.settings': plain,
  'nav.results': plain,
  'nav.import': plain,
  'nav.score': plain,
  'nav.notation': plain,
  'nav.help': plain,
  'nav.resumeSession': plain,
  'nav.skipLibrary': plain,
  'nav.skipStage': plain,
  'nav.sessionTools': plain,
  'settings.language': plain,
  'settings.chinese': plain,
  'settings.english': plain,
  'settings.sound': plain,
  'settings.soundOn': plain,
  'settings.soundOff': plain,
  'free.title': plain,
  'free.description': plain,
  'free.start': plain,
  'free.stop': plain,
  'free.state.idle': plain,
  'free.state.recording': plain,
  'free.state.paused': plain,
  'free.state.stopping': plain,
  'free.state.stopped': plain,
  'free.save.pending': plain,
  'free.save.saved': plain,
  'free.save.failed': plain,
  'free.eventCount': parameterized({count: 'count'}, 'count'),
  'free.recordCount': parameterized({count: 'count'}, 'count'),
  'free.duration': parameterized({duration: 'text'}),
  'free.titleLabel': plain,
  'free.defaultVelocity': plain,
  'free.noAudioCapture': plain,
  'free.localStorageNote': plain,
  'keyboard.title': plain,
  'keyboard.help': plain,
  'keyboard.rollover': plain,
  'keyboard.map': plain,
  'keyboard.octaveDown': plain,
  'keyboard.octaveUp': plain,
  'keyboard.transposeDown': plain,
  'keyboard.transposeUp': plain,
  'keyboard.resetOffset': plain,
  'keyboard.offset': parameterized({semitones: 'integer'}, 'semitones'),
  'keyboard.span': parameterized({low: 'text', high: 'text'}),
  'keyboard.noPlayableKeys': plain,
  'keyboard.configure': plain,
  'stage.empty': plain,
  'stage.reducedMotion': plain,
  'stage.aria': plain,
  'stage.pianoKey': parameterized({note: 'text'}),
  'notation.staffVoice': parameterized({staff: 'count', voice: 'text'}),
  'notation.empty': plain,
  'notation.eventLimit': plain,
  'notation.description': plain,
  'notation.ariaFixed': plain,
  'notation.ariaMovable': plain,
  'notation.noteDetail': parameterized({id: 'text', staff: 'count', voice: 'text', onset: 'text', duration: 'text'}),
  'notation.tonicMajor': parameterized({tonic: 'text'}),
  'notation.tonicMinor': parameterized({tonic: 'text'}),
  'notation.tonicUnknown': plain,
  'guitar.title': plain,
  'guitar.sourcePreserved': plain,
  'guitar.choice': parameterized({string: 'count', fret: 'count'}),
  'guitar.noRoute': plain,
  'guitar.notScored': plain,
  'follow.label': plain,
  'follow.preparing': plain,
  'follow.enabled': plain,
  'follow.paused': plain,
  'follow.disabled': plain,
  'follow.unavailable': plain,
  'follow.manual': plain,
  'results.title': plain,
  'results.empty': plain,
  'results.noAssessment': plain,
  'results.recordTitle': parameterized({title: 'text'}),
  'error.unknown': plain,
  'error.audioUnavailable': plain,
  'error.storageUnavailable': plain,
  'error.storageFull': plain,
  'error.recordLimit': plain,
  'error.invalidRecord': plain,
  'error.invalidState': plain,
  'error.keyboardMapping': plain,
  'error.technicalDetails': plain,
  'error.preferenceStorage': plain,
  'error.keyboard.mappingSize': plain,
  'error.keyboard.baseRange': plain,
  'error.keyboard.transposeRange': plain,
  'error.keyboard.duplicatePermission': plain,
  'error.keyboard.codeReserved': plain,
  'error.keyboard.duplicateCode': plain,
  'error.keyboard.offsetRange': plain,
  'error.keyboard.duplicatePitch': plain,
  'error.keyboard.labelInvalid': plain,
  'error.keyboard.noPlayableNotes': plain,
  'error.keyboard.historyLimit': plain,
  'error.keyboard.transposeInteger': plain
});

/** Only callers with an actual stable code use this map; do not match error.message. */
export const ERROR_MESSAGE_KEYS = Object.freeze({
  audio_unavailable: 'error.audioUnavailable',
  storage_unavailable: 'error.storageUnavailable',
  storage_quota_exceeded: 'error.storageFull',
  performance_limit_reached: 'error.recordLimit',
  performance_invalid_record: 'error.invalidRecord',
  performance_invalid_state: 'error.invalidState',
  keyboard_invalid_settings: 'error.keyboardMapping',
  keyboard_mapping_size: 'error.keyboard.mappingSize',
  keyboard_base_range: 'error.keyboard.baseRange',
  keyboard_transpose_range: 'error.keyboard.transposeRange',
  keyboard_duplicate_permission: 'error.keyboard.duplicatePermission',
  keyboard_code_reserved: 'error.keyboard.codeReserved',
  keyboard_duplicate_code: 'error.keyboard.duplicateCode',
  keyboard_offset_range: 'error.keyboard.offsetRange',
  keyboard_duplicate_pitch: 'error.keyboard.duplicatePitch',
  keyboard_label_invalid: 'error.keyboard.labelInvalid',
  keyboard_no_playable_notes: 'error.keyboard.noPlayableNotes',
  keyboard_history_limit: 'error.keyboard.historyLimit',
  keyboard_transpose_integer: 'error.keyboard.transposeInteger'
});

export function isSupportedLocale(locale) {
  return typeof locale === 'string' && SUPPORTED_LOCALES.includes(locale);
}

/** For bundled/maintainer-authored catalogs, not for arbitrary executable objects. */
export function validateLocaleCatalogs(catalogs = LOCALE_CATALOGS) {
  const issues = [];
  for (const locale of SUPPORTED_LOCALES) {
    const catalog = catalogs?.[locale];
    if (!catalog || typeof catalog !== 'object') {
      issues.push({code: 'catalog_missing', locale});
      continue;
    }
    for (const key of Object.keys(catalog)) if (!own(MESSAGE_SCHEMA, key)) issues.push({code: 'catalog_extra_key', locale, key});
    for (const [key, schema] of Object.entries(MESSAGE_SCHEMA)) {
      if (!own(catalog, key)) { issues.push({code: 'catalog_missing_key', locale, key}); continue; }
      const value = catalog[key];
      let templates;
      if (schema.plural) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) { issues.push({code: 'catalog_plural_required', locale, key}); continue; }
        const categories = new Intl.PluralRules(locale).resolvedOptions().pluralCategories;
        for (const category of categories) if (!own(value, category)) issues.push({code: 'catalog_plural_missing', locale, key, category});
        for (const category of Object.keys(value)) if (!categories.includes(category)) issues.push({code: 'catalog_plural_extra', locale, key, category});
        templates = Object.values(value);
      } else templates = [value];
      for (const template of templates) {
        if (typeof template !== 'string' || !template.length || template.length > MAX_TEXT_LENGTH) { issues.push({code: 'catalog_invalid_text', locale, key}); continue; }
        const tokens = [...template.matchAll(/\{([A-Za-z][A-Za-z0-9_]*)\}/g)].map(match => match[1]);
        const remaining = template.replace(/\{([A-Za-z][A-Za-z0-9_]*)\}/g, '');
        if (/[{}]/.test(remaining) || tokens.some(token => !own(schema.params, token)) || Object.keys(schema.params).some(param => !tokens.includes(param))) {
          issues.push({code: 'catalog_parameters_mismatch', locale, key});
        }
      }
    }
  }
  return issues;
}

/** Explicit DOM adapter. It changes only <html lang>, never markup or input state. */
export function createDocumentLanguageAdapter(document) {
  return locale => {
    if (!isSupportedLocale(locale)) throw new TypeError('Unsupported display locale');
    if (!document?.documentElement) throw new TypeError('Document root is unavailable');
    document.documentElement.setAttribute('lang', locale);
  };
}

/**
 * Text-only, dependency-free display service. Use t() with textContent, text nodes,
 * Canvas.fillText, or safe text attributes such as aria-label. Never use innerHTML.
 * storage is an optional Storage adapter or () => Storage; the latter also catches
 * browsers that throw while accessing window.localStorage itself. No browser APIs
 * or persistence are touched at import time. The service never changes musical data.
 */
export function createI18n({locale: requestedLocale, storage = null, onReport = issue => console.warn('[i18n]', issue), setDocumentLanguage = null} = {}) {
  const reports = [], listeners = new Set(), eventQueue = [];
  let locale = DEFAULT_LOCALE, revision = 0, notifying = false, preferenceStatus = 'memory';
  const report = (code, details = {}) => {
    // Report names, never source text, parameter values, storage contents or errors.
    const issue = Object.freeze({code, locale, ...details});
    const signature = JSON.stringify(issue);
    if (reports.some(previous => JSON.stringify(previous) === signature)) return;
    if (reports.length === MAX_REPORTS) reports.shift();
    reports.push(issue);
    try { onReport?.(issue); } catch { /* Diagnostics cannot break a recording. */ }
  };
  const safeName = value => typeof value === 'string' ? value.slice(0, 160) : '(invalid)';
  const getStorage = () => typeof storage === 'function' ? storage() : storage;
  try {
    const adapter = getStorage();
    if (adapter) {
      preferenceStatus = 'ready';
      const saved = adapter.getItem(LOCALE_STORAGE_KEY);
      if (saved !== null && saved !== undefined) {
        if (typeof saved === 'string' && saved.length <= 16 && isSupportedLocale(saved)) locale = saved;
        else { preferenceStatus = 'failed'; report('locale_storage_invalid'); }
      }
    }
  } catch { preferenceStatus = 'failed'; report('locale_storage_read_failed'); }
  if (requestedLocale !== undefined) {
    if (isSupportedLocale(requestedLocale)) locale = requestedLocale;
    else report('locale_unsupported');
  }
  const reflectLanguage = () => {
    try { setDocumentLanguage?.(locale); } catch { report('document_language_failed'); }
  };
  reflectLanguage();
  const unavailable = () => LOCALE_CATALOGS[locale]['i18n.unavailable'];

  function notify(type, previousLocale) {
    eventQueue.push(Object.freeze({type, locale, previousLocale, revision}));
    if (notifying) return;
    notifying = true;
    try {
      while (eventQueue.length) {
        const event = eventQueue.shift();
        for (const listener of [...listeners]) {
          if (!listeners.has(listener)) continue;
          try { listener(event); } catch { report('locale_subscriber_failed'); }
        }
      }
    } finally { notifying = false; }
  }

  function formatNumber(value, options = {}) {
    if (typeof value !== 'number' || !Number.isFinite(value)) { report('number_invalid'); return unavailable(); }
    try { return new Intl.NumberFormat(locale, options).format(value); }
    catch { report('number_format_invalid'); return unavailable(); }
  }

  function t(key, params = {}) {
    if (typeof key !== 'string' || !own(MESSAGE_SCHEMA, key)) {
      report('message_key_missing', {key: safeName(key)});
      return unavailable();
    }
    const schema = MESSAGE_SCHEMA[key];
    if (!params || typeof params !== 'object' || Array.isArray(params)) {
      report('message_params_invalid', {key}); return unavailable();
    }
    const values = Object.create(null);
    for (const name of Object.keys(params)) if (!own(schema.params, name)) {
      report('message_param_unexpected', {key, param: safeName(name)}); return unavailable();
    }
    for (const [name, type] of Object.entries(schema.params)) {
      // Do not coerce objects, evaluate getters, or interpolate inherited values.
      const descriptor = Object.getOwnPropertyDescriptor(params, name);
      if (!descriptor) { report('message_param_missing', {key, param: name}); return unavailable(); }
      const value = descriptor.value;
      const valid = own(descriptor, 'value') && (type === 'text'
        ? typeof value === 'string' && value.length <= MAX_TEXT_LENGTH
        : Number.isSafeInteger(value) && (type !== 'count' || value >= 0));
      if (!valid) { report('message_param_invalid', {key, param: name}); return unavailable(); }
      values[name] = value;
    }
    let template = LOCALE_CATALOGS[locale][key];
    if (schema.plural) template = template[new Intl.PluralRules(locale).select(values[schema.plural])] ?? template.other;
    return template.replace(/\{([A-Za-z][A-Za-z0-9_]*)\}/g, (_, name) => typeof values[name] === 'number' ? formatNumber(values[name]) : values[name]);
  }

  return Object.freeze({
    get locale() { return locale; },
    get revision() { return revision; },
    get preferenceStatus() { return preferenceStatus; },
    t,
    message(code, params = {}) {
      if (typeof code !== 'string' || !own(ERROR_MESSAGE_KEYS, code)) {
        report('message_code_unknown', {errorCode: safeName(code)});
        return t('error.unknown');
      }
      return t(ERROR_MESSAGE_KEYS[code], params);
    },
    /** Returns whether the locale was accepted; a valid unchanged choice also saves. */
    setLocale(next) {
      if (!isSupportedLocale(next)) { report('locale_unsupported'); return false; }
      const previousLocale = locale;
      locale = next;
      try { const adapter = getStorage(); adapter?.setItem(LOCALE_STORAGE_KEY, locale); preferenceStatus = adapter ? 'ready' : 'memory'; }
      catch { preferenceStatus = 'failed'; report('locale_storage_write_failed'); }
      reflectLanguage();
      if (locale !== previousLocale) { revision++; notify('locale', previousLocale); }
      return true;
    },
    /** Explicit redraw request; cache keys should include this service's revision. */
    invalidate() { revision++; notify('invalidate', locale); },
    /** No implicit initial callback. Returns an idempotent unsubscribe function. */
    subscribe(listener) {
      if (typeof listener !== 'function') throw new TypeError('Locale subscriber must be a function');
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getReports() { return reports.slice(); },
    formatNumber,
    /** Dates are chronology only. Zone defaults to the browser; pass timeZone if needed. */
    formatDateTime(value, options = {dateStyle: 'medium', timeStyle: 'short'}) {
      let timestamp;
      if (value instanceof Date) timestamp = Date.prototype.getTime.call(value);
      else if (typeof value === 'number') timestamp = value;
      else if (typeof value === 'string' && value.length <= 32 && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) {
        timestamp = Date.parse(value);
        // Date.parse normalizes some impossible dates (for example February 30).
        const canonical = value.replace(/(?:\.(\d{1,3}))?Z$/, (_, digits = '') => `.${digits.padEnd(3, '0')}Z`);
        if (Number.isFinite(timestamp) && new Date(timestamp).toISOString() !== canonical) timestamp = NaN;
      }
      if (!Number.isFinite(timestamp)) { report('date_invalid'); return unavailable(); }
      try { return new Intl.DateTimeFormat(locale, options).format(timestamp); }
      catch { report('date_format_invalid'); return unavailable(); }
    },
    /** Elapsed m:ss, never wall time: minutes may exceed 59; fractions round down. */
    formatDuration(milliseconds, {fractionDigits = 0} = {}) {
      if (typeof milliseconds !== 'number' || !Number.isFinite(milliseconds) || milliseconds < 0 || milliseconds > Number.MAX_SAFE_INTEGER || !Number.isInteger(fractionDigits) || fractionDigits < 0 || fractionDigits > 3) {
        report('duration_invalid'); return unavailable();
      }
      const factor = 10 ** fractionDigits, ticks = Math.floor(milliseconds / (1000 / factor));
      const minutes = Math.floor(ticks / (60 * factor)), seconds = (ticks % (60 * factor)) / factor;
      return `${formatNumber(minutes, {useGrouping: false})}:${formatNumber(seconds, {useGrouping: false, minimumIntegerDigits: 2, minimumFractionDigits: fractionDigits, maximumFractionDigits: fractionDigits})}`;
    }
  });
}

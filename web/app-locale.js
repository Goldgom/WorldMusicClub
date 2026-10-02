import {createI18n, createDocumentLanguageAdapter} from './i18n.js';

// Explicitly requested at bootstrap; importing this module has no browser effects.
const documents = new WeakMap();
let memoryLocale;
export function getAppI18n(document = globalThis.document) {
  if (!document?.documentElement) return memoryLocale ||= createI18n();
  if (!documents.has(document)) documents.set(document, createI18n({
    storage: () => document.defaultView?.localStorage,
    setDocumentLanguage: createDocumentLanguageAdapter(document),
  }));
  return documents.get(document);
}

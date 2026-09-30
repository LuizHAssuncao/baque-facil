import type { Locale } from "./messages";

export const LANGUAGE_STORAGE_KEY = "baque-facil-language";
export const LANGUAGE_CHANGE_EVENT = "baque-facil-language-change";
export const DEFAULT_LOCALE: Locale = "en-CA";

export function isLocale(value: unknown): value is Locale {
  return value === "en-CA" || value === "pt-BR";
}

export function readLanguagePreference(): Locale | null {
  if (typeof window === "undefined") return null;
  try {
    const saved = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
    return isLocale(saved) ? saved : null;
  } catch {
    return null;
  }
}

export function getLocale(): Locale {
  if (typeof document === "undefined") return DEFAULT_LOCALE;
  const locale = document.documentElement.lang;
  return isLocale(locale) ? locale : DEFAULT_LOCALE;
}

export function applyLocale(locale: Locale) {
  document.documentElement.lang = locale;
  window.dispatchEvent(new Event(LANGUAGE_CHANGE_EVENT));
}

export function setLanguagePreference(locale: Locale) {
  try {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, locale);
  } catch {
    // The selection still works for this page when browser storage is unavailable.
  }
  applyLocale(locale);
}

export function subscribeLocale(listener: () => void) {
  window.addEventListener(LANGUAGE_CHANGE_EVENT, listener);
  return () => window.removeEventListener(LANGUAGE_CHANGE_EVENT, listener);
}

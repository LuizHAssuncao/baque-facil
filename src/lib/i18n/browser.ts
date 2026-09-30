import { translate, type Message } from "./messages";
import {
  applyLocale,
  DEFAULT_LOCALE,
  getLocale,
  isLocale,
  LANGUAGE_STORAGE_KEY,
  readLanguagePreference,
  setLanguagePreference,
  subscribeLocale,
} from "./preference";

export function initLanguageControls() {
  const dialog = document.querySelector<HTMLDialogElement>(".language-dialog");
  const choices = document.querySelectorAll<HTMLButtonElement>("[data-set-language]");
  const attributes = ["aria-label", "title", "content", "text"];
  const marked = document.querySelectorAll<HTMLElement>(
    attributes.map((name) => `[data-i18n-${name}]`).join(","),
  );

  function update() {
    const locale = getLocale();
    choices.forEach((choice) => {
      choice.setAttribute("aria-pressed", String(choice.dataset.setLanguage === locale));
    });
    marked.forEach((element) => {
      attributes.forEach((attribute) => {
        const message = element.getAttribute(`data-i18n-${attribute}`);
        if (!message) return;
        const value = translate(locale, JSON.parse(message) as Message);
        if (attribute === "text") element.textContent = value;
        else element.setAttribute(attribute, value);
      });
    });
  }

  function closeDialog() {
    if (!dialog?.open) return;
    dialog.close();
    document.querySelector<HTMLButtonElement>(`.language-bar [data-set-language="${getLocale()}"]`)?.focus();
  }

  choices.forEach((choice) => choice.addEventListener("click", () => {
    const locale = choice.dataset.setLanguage;
    if (!isLocale(locale)) return;
    setLanguagePreference(locale);
    closeDialog();
  }));
  dialog?.addEventListener("keydown", (event) => {
    if (event.key !== "Tab") return;
    const buttons = dialog.querySelectorAll<HTMLButtonElement>("[data-set-language]");
    const first = buttons[0];
    const last = buttons[buttons.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  });
  subscribeLocale(update);
  window.addEventListener("storage", (event) => {
    if (event.key !== LANGUAGE_STORAGE_KEY && event.key !== null) return;
    try {
      if (event.storageArea !== window.localStorage) return;
    } catch {
      return;
    }
    applyLocale(isLocale(event.newValue) ? event.newValue : DEFAULT_LOCALE);
    if (isLocale(event.newValue)) closeDialog();
  });
  // Also refresh an already-open page restored from the back/forward cache.
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) applyLocale(readLanguagePreference() ?? getLocale());
  });
  update();
  if (!readLanguagePreference()) dialog?.showModal();
}

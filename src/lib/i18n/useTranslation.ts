import { useMemo, useSyncExternalStore } from "react";
import { DEFAULT_LOCALE, getLocale, subscribeLocale } from "./preference";
import { translate, type Message, type MessageValues } from "./messages";

const serverLocale = () => DEFAULT_LOCALE;

export function useTranslation() {
  // The server snapshot must match Astro's English SSR markup during hydration.
  const locale = useSyncExternalStore(subscribeLocale, getLocale, serverLocale);
  return useMemo(() => ({
    locale,
    t: (message: Message, values?: MessageValues) => translate(locale, message, values),
  }), [locale]);
}

export const HAND_SYMBOL_REVERSE_STORAGE_KEY = "baque-facil-reverse-hand-symbols";
export const HAND_SYMBOL_REVERSE_EVENT = "baque-facil-hand-symbol-reverse-change";

export type HandSymbolReverseEventDetail = {
  reverseHandSymbols: boolean;
};

export function readHandSymbolReversePreference() {
  if (typeof window === "undefined") {
    return false;
  }

  try {
    return window.localStorage.getItem(HAND_SYMBOL_REVERSE_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

export function writeHandSymbolReversePreference(reverseHandSymbols: boolean) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(
      HAND_SYMBOL_REVERSE_STORAGE_KEY,
      reverseHandSymbols ? "true" : "false",
    );
  } catch {
    // Storage can be unavailable in private browsing modes. The UI still updates for this page.
  }

  window.dispatchEvent(
    new CustomEvent<HandSymbolReverseEventDetail>(HAND_SYMBOL_REVERSE_EVENT, {
      detail: { reverseHandSymbols },
    }),
  );
}

export function displayHandSymbol(symbol: string, reverseHandSymbols: boolean) {
  if (!reverseHandSymbols) {
    return symbol;
  }

  if (symbol === "R") {
    return "L";
  }

  if (symbol === "L") {
    return "R";
  }

  return symbol;
}

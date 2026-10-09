import type { Locale, Message } from "./i18n/messages";

export function normalizeHandSymbol(symbol: string) {
  return symbol === "E" ? "L" : symbol === "D" ? "R" : symbol;
}

export function localizeHandSymbol(symbol: string, locale: Locale) {
  const canonical = normalizeHandSymbol(symbol);
  if (locale !== "pt-BR") return canonical;
  return canonical === "L" ? "E" : canonical === "R" ? "D" : canonical;
}

export function localizeRhythmTranscription(transcription: string, locale: Locale) {
  const localizeBlock = (block: string) => {
    let track = "";
    return block.split(/(\r?\n)/).map((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) return line;
      if (trimmed.endsWith(":")) {
        track = trimmed.slice(0, -1).trim();
        return line;
      }
      return track === "Alfaia"
        ? line.replace(/\S+/g, (symbol) => localizeHandSymbol(symbol, locale))
        : line;
    }).join("");
  };

  // Translate only notation, preserving authored metadata, prose, and comments.
  if (/```rhythm/i.test(transcription)) {
    return transcription.replace(
      /(```rhythm[^\n]*\n)([\s\S]*?)(```|$)/gi,
      (_match, opening: string, block: string, closing: string) =>
        `${opening}${localizeBlock(block)}${closing}`,
    );
  }
  return localizeBlock(transcription);
}

export function localizeRhythmIssue(message: Message, locale: Locale): Message {
  if (typeof message === "string") return message;
  const values = message.values;
  if (values?.track !== "Alfaia" ||
      message.key !== 'Unknown symbol "{symbol}" in {track}. Allowed symbols for {track} are {allowed}.') {
    return message;
  }
  return {
    ...message,
    values: {
      ...values,
      symbol: localizeHandSymbol(String(values.symbol), locale),
      allowed: String(values.allowed).split(", ").map((symbol) => localizeHandSymbol(symbol, locale)).join(", "),
    },
  };
}

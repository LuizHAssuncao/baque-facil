import type { CollectionEntry } from "astro:content";
import { isRadioSequence } from "./radio/sequence";

export function getRhythmCategory(entry: CollectionEntry<"rhythms">) {
  return entry.data.category ?? (
    isRadioSequence({ slug: entry.slug, title: entry.data.title })
      ? "sequence"
      : "rhythm"
  );
}

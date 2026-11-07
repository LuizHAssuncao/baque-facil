import type { CollectionEntry } from "astro:content";

export function compareRhythms(a: CollectionEntry<"rhythms">, b: CollectionEntry<"rhythms">) {
  // Keep Afoxé last without changing its visible "# - Afoxé" title.
  return Number(a.slug === "afoxe") - Number(b.slug === "afoxe") ||
    a.data.title.localeCompare(b.data.title);
}

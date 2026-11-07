import type { Rhythm } from "../rhythmTypes";

export function isRadioSequence(rhythm: Pick<Rhythm, "slug" | "title">): boolean {
  return rhythm.slug.startsWith("combo") || rhythm.title.toLowerCase().startsWith("combo");
}

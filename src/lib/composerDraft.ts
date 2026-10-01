import { z } from "zod";
import { MAX_TEMPO, MIN_TEMPO } from "./tempo";
import { validateRhythmIssues } from "./validateRhythm";
import type { Subdivision } from "./rhythmTypes";

const track = z.object({ name: z.string().max(100), steps: z.array(z.string().max(8)).min(1).max(20000) });
const snapshot = z.object({
  title: z.string().max(200),
  tempo: z.number().int().min(MIN_TEMPO).max(MAX_TEMPO),
  transcription: z.string().max(500000),
  tracks: z.array(track).min(1).max(20),
  baseline: z.array(track).min(1).max(20),
});
const draft = snapshot.extend({ version: z.literal(1), subdivision: z.union([z.literal(8), z.literal(16), z.literal(32)]) });

export type ComposerSnapshot = z.infer<typeof snapshot>;

export function readComposerDraft(raw: string | null, subdivision: Subdivision): ComposerSnapshot | null {
  if (!raw) return null;
  try {
    const result = draft.safeParse(JSON.parse(raw));
    if (!result.success || result.data.subdivision !== subdivision) return null;
    const data = result.data;
    for (const tracks of [data.tracks, data.baseline]) {
      if (validateRhythmIssues({ title: data.title, slug: "draft", tempo: data.tempo, subdivision, tracks }).length) return null;
    }
    return data;
  } catch {
    return null;
  }
}

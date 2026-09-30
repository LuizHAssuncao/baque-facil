import { extractRhythmBlock } from "./extractRhythmBlock";
import { parseRhythm } from "./parseRhythm";
import type { Rhythm } from "./rhythmTypes";
import type { SampleMap } from "./sampleMap";
import { validateRhythm } from "./validateRhythm";

export const QUIZ_TEMPO = 90;

export type QuizLibrary = {
  rhythms: Rhythm[];
  samples: SampleMap;
};

export type QuizRound = {
  prompt: Rhythm;
  options: Rhythm[];
};

type LibraryEntry = {
  slug: string;
  body: string;
  data: Pick<Rhythm, "title" | "tempo" | "subdivision">;
};

/** Derive eligibility from the same content and validation used by rhythm pages. */
export function buildQuizRhythms(entries: LibraryEntry[]): Rhythm[] {
  return entries.flatMap((entry) => {
    const block = extractRhythmBlock(entry.body);
    if (!entry.data.title.trim() || !block) return [];

    try {
      const rhythm: Rhythm = {
        title: entry.data.title,
        slug: entry.slug,
        tempo: entry.data.tempo,
        subdivision: entry.data.subdivision,
        tracks: parseRhythm(block),
      };
      if (validateRhythm(rhythm).length > 0) return [];
      if (!rhythm.tracks.some((track) => track.steps.some((step) => step !== "."))) return [];
      const duration = (60 / QUIZ_TEMPO) * (4 / rhythm.subdivision) * rhythm.tracks[0].steps.length;
      if (duration > 180) return [];
      return [rhythm];
    } catch {
      // Invalid lessons remain editable in the library, but cannot become quiz answers.
      return [];
    }
  });
}

function shuffled<T>(items: T[]): T[] {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const other = Math.floor(Math.random() * (index + 1));
    [result[index], result[other]] = [result[other], result[index]];
  }
  return result;
}

/** Compare audible events, regardless of track order, names, or subdivision notation. */
function soundKey(rhythm: Rhythm, samples: SampleMap): string {
  const stepSize = 32 / rhythm.subdivision;
  const events = rhythm.tracks.flatMap((track) => track.steps.flatMap((step, index) =>
    step === "." ? [] : [JSON.stringify([index * stepSize, samples[`${track.name}.${step}`]])],
  )).sort();
  return JSON.stringify([rhythm.tracks[0].steps.length * stepSize, events]);
}

export function createQuizRound(library: QuizLibrary, previousSlug?: string): QuizRound | null {
  const rhythms = shuffled(library.rhythms);
  const keys = new Map(rhythms.map((rhythm) => [rhythm.slug, soundKey(rhythm, library.samples)]));
  if (new Set(keys.values()).size < 3) return null;

  const prompt = rhythms.find((rhythm) => rhythm.slug !== previousSlug)!;
  const usedSounds = new Set([keys.get(prompt.slug)]);
  const alternatives = rhythms.filter((rhythm) => {
    const key = keys.get(rhythm.slug);
    if (usedSounds.has(key)) return false;
    usedSounds.add(key);
    return true;
  });

  // Prefer comparisons with the same instruments and length when the library allows it.
  const similarity = (rhythm: Rhythm) =>
    Number(rhythm.tracks.map((track) => track.name).sort().join() ===
      prompt.tracks.map((track) => track.name).sort().join()) +
    Number(rhythm.tracks[0].steps.length / rhythm.subdivision ===
      prompt.tracks[0].steps.length / prompt.subdivision);
  alternatives.sort((a, b) => similarity(b) - similarity(a));

  return { prompt, options: shuffled([prompt, ...alternatives.slice(0, 2)]) };
}

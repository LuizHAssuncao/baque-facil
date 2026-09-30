import { TranslatableError } from "../i18n/messages";
import type { Rhythm } from "../rhythmTypes";
import { clampTempo } from "../tempo";

export const RADIO_SAMPLE_RATE = 44_100;
export const RADIO_BITRATE = 128_000;
export const RADIO_CHUNK_FRAMES = RADIO_SAMPLE_RATE * 2;
export const RADIO_PREFERENCES_KEY = "baque-facil-radio-v1";

export type RadioEntry = { rhythm: Rhythm; difficulty: string; combo: boolean };
export type RadioSettings = {
  slugs: string[];
  tempo: number;
  repetitions: number;
  minutes: number;
};
export type RadioSegment = {
  slug: string;
  startFrame: number;
  endFrame: number;
  cycleFrames: number;
  stepCount: number;
  repetitions: number;
};
export type RadioTimeline = {
  segments: RadioSegment[];
  totalFrames: number;
  tempo: number;
};

export function defaultRadioSettings(entries: RadioEntry[]): RadioSettings {
  return {
    slugs: entries
      .filter((entry) => !entry.combo)
      .map((entry) => entry.rhythm.slug),
    tempo: 90,
    repetitions: 8,
    minutes: 20,
  };
}

export function normalizeRadioSettings(
  value: unknown,
  entries: RadioEntry[],
): RadioSettings {
  const defaults = defaultRadioSettings(entries);
  if (!value || typeof value !== "object") return defaults;
  const input = value as Partial<RadioSettings>;
  const validSlugs = new Set(entries.map((entry) => entry.rhythm.slug));
  return {
    slugs: Array.isArray(input.slugs)
      ? [
          ...new Set(
            input.slugs.filter(
              (slug) => typeof slug === "string" && validSlugs.has(slug),
            ),
          ),
        ]
      : defaults.slugs,
    tempo:
      typeof input.tempo === "number"
        ? clampTempo(input.tempo)
        : defaults.tempo,
    repetitions: [4, 8, 16].includes(input.repetitions ?? 0)
      ? input.repetitions!
      : defaults.repetitions,
    minutes: [2, 5, 10, 20].includes(input.minutes ?? 0)
      ? input.minutes!
      : defaults.minutes,
  };
}

/** One complete bag at a time; the first item never repeats the previous bag's last. */
export function shuffleBag(
  slugs: string[],
  previous?: string,
  random = Math.random,
): string[] {
  const bag = [...new Set(slugs)];
  for (let index = bag.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1));
    [bag[index], bag[other]] = [bag[other], bag[index]];
  }
  if (bag.length > 1 && bag[0] === previous)
    [bag[0], bag[1]] = [bag[1], bag[0]];
  return bag;
}

export function buildRadioTimeline(
  rhythms: Rhythm[],
  tempo: number,
  repetitions: number,
  durationSeconds: number,
  random = Math.random,
  previousSlug?: string,
): RadioTimeline {
  if (!rhythms.length) throw new TranslatableError("Select at least one rhythm.");
  if (
    !Number.isInteger(repetitions) ||
    repetitions < 1 ||
    repetitions > 16 ||
    !Number.isFinite(durationSeconds) ||
    durationSeconds <= 0 ||
    durationSeconds > 1200
  ) {
    throw new TranslatableError(
      "Choose a recording of up to 20 minutes and 1–16 repetitions.",
    );
  }
  const actualTempo = clampTempo(tempo);
  const bySlug = new Map(rhythms.map((rhythm) => [rhythm.slug, rhythm]));
  const slugs = [...bySlug.keys()];
  let bag: string[] = [];
  const segments: RadioSegment[] = [];
  let totalFrames = 0;
  const targetFrames = Math.ceil(durationSeconds * RADIO_SAMPLE_RATE);
  const framesPerRound = rhythms.reduce((sum, rhythm) => {
    const cycles =
      rhythm.slug.startsWith("combo") ||
      rhythm.title.toLowerCase().startsWith("combo")
        ? 1
        : repetitions;
    return (
      sum +
      Math.round(
        (60 / actualTempo) *
          (4 / rhythm.subdivision) *
          (rhythm.tracks[0]?.steps.length ?? 0) *
          RADIO_SAMPLE_RATE,
      ) *
        cycles
    );
  }, 0);
  if (framesPerRound <= 0 || framesPerRound > 1800 * RADIO_SAMPLE_RATE) {
    throw new TranslatableError(
      "Choose fewer rhythms or repetitions for a mix of up to 30 minutes per round.",
    );
  }
  const rounds = Math.max(1, Math.round(targetFrames / framesPerRound));
  // Finish the nearest whole round: every selected rhythm gets equal turns,
  // including across the native file loop. Combos already contain repetitions.
  while (segments.length < rounds * slugs.length) {
    if (!bag.length) {
      bag = shuffleBag(slugs, segments.at(-1)?.slug ?? previousSlug, random);
      if (bag.length > 2 && bag.at(-1) === segments[0]?.slug) {
        [bag[1], bag[bag.length - 1]] = [bag[bag.length - 1], bag[1]];
      }
    }
    const slug = bag.shift()!;
    const rhythm = bySlug.get(slug)!;
    const stepCount = rhythm.tracks[0]?.steps.length ?? 0;
    if (
      !stepCount ||
      rhythm.tracks.some((track) => track.steps.length !== stepCount)
    ) {
      throw new TranslatableError({ key: "{title} needs equally sized, nonempty tracks.", values: { title: rhythm.title } });
    }
    const cycleFrames = Math.round(
      (60 / actualTempo) *
        (4 / rhythm.subdivision) *
        stepCount *
        RADIO_SAMPLE_RATE,
    );
    if (cycleFrames / RADIO_SAMPLE_RATE > 180)
      throw new TranslatableError({ key: "{title} is too long at this tempo.", values: { title: rhythm.title } });
    const groupRepetitions =
      rhythm.slug.startsWith("combo") ||
      rhythm.title.toLowerCase().startsWith("combo")
        ? 1
        : repetitions;
    const endFrame = totalFrames + cycleFrames * groupRepetitions;
    segments.push({
      slug,
      startFrame: totalFrames,
      endFrame,
      cycleFrames,
      stepCount,
      repetitions: groupRepetitions,
    });
    totalFrames = endFrame;
  }
  return { segments, totalFrames, tempo: actualTempo };
}

export function radioPosition(timeline: RadioTimeline, seconds: number) {
  // Media clocks may round a seek to microseconds. Round back to the nearest
  // sample so an exact group boundary cannot appear as the previous group.
  const frame =
    Math.round(Math.max(0, seconds) * RADIO_SAMPLE_RATE) % timeline.totalFrames;
  // Find the last segment whose start is at or before the current media frame.
  let low = 0;
  let high = timeline.segments.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (timeline.segments[middle].startFrame <= frame) low = middle;
    else high = middle - 1;
  }
  const segment = timeline.segments[low];
  const offset = frame - segment.startFrame;
  return {
    index: low,
    segment,
    activeStep: Math.min(
      segment.stepCount - 1,
      Math.floor(
        ((offset % segment.cycleFrames) * segment.stepCount) /
          segment.cycleFrames,
      ),
    ),
    repetition: Math.floor(offset / segment.cycleFrames) + 1,
  };
}

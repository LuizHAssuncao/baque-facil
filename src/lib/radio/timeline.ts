import { TranslatableError, type Locale } from "../i18n/messages";
import type { Rhythm, RhythmTrack } from "../rhythmTypes";
import { clampTempo } from "../tempo";
import { RADIO_TRANSITION_STEPS, radioTransitionTracks } from "./transitions";
import { isRadioSequence } from "./sequence";

import { MP3_SAMPLE_RATE as RADIO_SAMPLE_RATE } from "../audio/mp3Constants";
export { MP3_SAMPLE_RATE as RADIO_SAMPLE_RATE, MP3_BITRATE as RADIO_BITRATE, PCM_CHUNK_FRAMES as RADIO_CHUNK_FRAMES } from "../audio/mp3Constants";
export const RADIO_PREFERENCES_KEY = "baque-facil-radio-v1";

export type RadioEntry = {
  rhythm: Rhythm;
  difficulty: string;
  combo: boolean;
  gesture?: { src: string; description: Record<Locale, string> };
};
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
  transitionTracks?: RhythmTrack[];
  transitionStartFrame?: number;
};
export type RadioTimeline = {
  segments: RadioSegment[];
  totalFrames: number;
  tempo: number;
  countInFrames?: number;
};

export function defaultRadioSettings(entries: RadioEntry[]): RadioSettings {
  return {
    slugs: entries.map((entry) => entry.rhythm.slug),
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

/** Repeat selected regular rhythms as needed so sequences never touch. */
function interleaveSequences(
  bag: string[],
  sequenceSlugs: ReadonlySet<string>,
  startsWithSequence: boolean,
  random: () => number,
): string[] {
  const sequences = bag.filter((slug) => sequenceSlugs.has(slug));
  const regulars = bag.filter((slug) => !sequenceSlugs.has(slug));
  const selectedRegulars = [...regulars];
  while (regulars.length < sequences.length) {
    regulars.push(...shuffleBag(selectedRegulars, undefined, random)
      .slice(0, sequences.length - regulars.length));
  }
  const first = startsWithSequence ? sequences : regulars;
  const last = startsWithSequence ? regulars : sequences;
  const groupCount = Math.min(first.length, last.length);
  const groups = Array.from({ length: groupCount }, (_, index) => ({
    first: [first[index]],
    last: [last[index]],
  }));
  // Any remaining regular rhythms share the gaps between sequences.
  for (const slug of first.slice(groupCount))
    groups[Math.floor(random() * groupCount)].first.push(slug);
  for (const slug of last.slice(groupCount))
    groups[Math.floor(random() * groupCount)].last.push(slug);
  return groups.flatMap((group) => [...group.first, ...group.last]);
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
  const sequenceSlugs = new Set(rhythms.filter(isRadioSequence).map((rhythm) => rhythm.slug));
  const mixedSelection = sequenceSlugs.size > 0 && sequenceSlugs.size < slugs.length;
  let startsWithSequence: boolean | undefined;
  let bag: string[] = [];
  const segments: RadioSegment[] = [];
  let totalFrames = 0;
  const targetFrames = Math.ceil(durationSeconds * RADIO_SAMPLE_RATE);
  const groupFrames = new Map([...bySlug.values()].map((rhythm) => {
    const cycles = isRadioSequence(rhythm) ? 1 : repetitions;
    return [
      rhythm.slug,
      Math.round(
        (60 / actualTempo) *
          (4 / rhythm.subdivision) *
          (rhythm.tracks[0]?.steps.length ?? 0) *
          RADIO_SAMPLE_RATE,
      ) *
        cycles,
    ] as const;
  }));
  // Finish the nearest complete round, including any repeated separator rhythms.
  // Their lengths can differ, so use each shuffled round's actual duration.
  while (true) {
    if (!bag.length) {
      if (totalFrames >= targetFrames) break;
      bag = shuffleBag(slugs, segments.at(-1)?.slug ?? previousSlug, random);
      if (mixedSelection) {
        // Keep opposite kinds at the two ends of every round, in the same order.
        // This also separates sequences across rounds and the native file loop.
        startsWithSequence ??= previousSlug
          ? !(sequenceSlugs.has(previousSlug) || previousSlug.startsWith("combo"))
          : sequenceSlugs.has(bag[0]);
        bag = interleaveSequences(bag, sequenceSlugs, startsWithSequence, random);
      } else if (bag.length > 2 && bag.at(-1) === segments[0]?.slug) {
        [bag[1], bag[bag.length - 1]] = [bag[bag.length - 1], bag[1]];
      }
      const roundFrames = bag.reduce((sum, slug) => sum + groupFrames.get(slug)!, 0);
      if (!Number.isFinite(roundFrames) || roundFrames <= 0 || roundFrames > 1800 * RADIO_SAMPLE_RATE) {
        throw new TranslatableError(
          "Choose fewer rhythms or repetitions for a mix of up to 30 minutes per round.",
        );
      }
      if (segments.length && totalFrames + roundFrames - targetFrames > targetFrames - totalFrames) break;
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
    const groupRepetitions = isRadioSequence(rhythm) ? 1 : repetitions;
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
  // Resolve exits after the shuffle is complete, including the native file loop.
  // A solo/held rhythm has no change to announce, even across repeated segments.
  segments.forEach((segment, index) => {
    const next = segments[(index + 1) % segments.length];
    if (next.slug !== segment.slug) {
      const tracks = radioTransitionTracks(bySlug.get(segment.slug)!);
      if (tracks) {
        segment.transitionTracks = tracks;
        segment.transitionStartFrame = segment.endFrame - segment.cycleFrames + Math.round(
          (segment.stepCount - RADIO_TRANSITION_STEPS) * segment.cycleFrames / segment.stepCount,
        );
      }
    }
  });
  return { segments, totalFrames, tempo: actualTempo };
}

/** Prepend one whistle-only bar to a full mix; held patterns keep their own loop. */
export function withRadioCountIn(timeline: RadioTimeline): RadioTimeline {
  if (timeline.countInFrames) return timeline;
  const countInFrames = Math.round(4 * 60 / timeline.tempo * RADIO_SAMPLE_RATE);
  return {
    ...timeline,
    countInFrames,
    totalFrames: timeline.totalFrames + countInFrames,
    segments: timeline.segments.map((segment) => ({
      ...segment,
      startFrame: segment.startFrame + countInFrames,
      endFrame: segment.endFrame + countInFrames,
      ...(segment.transitionStartFrame === undefined ? {} : {
        transitionStartFrame: segment.transitionStartFrame + countInFrames,
      }),
    })),
  };
}

/** Repetitions are one-based, matching the position shown by the player. */
export function transitionTracksForRepetition(
  segment: RadioSegment,
  repetition: number,
): RhythmTrack[] | null {
  return repetition === segment.repetitions ? segment.transitionTracks ?? null : null;
}

export function radioPosition(timeline: RadioTimeline, seconds: number) {
  // Media clocks may round a seek to microseconds. Round back to the nearest
  // sample so an exact group boundary cannot appear as the previous group.
  const frame =
    Math.round(Math.max(0, seconds) * RADIO_SAMPLE_RATE) % timeline.totalFrames;
  if (timeline.countInFrames && frame < timeline.countInFrames) {
    return {
      index: -1,
      segment: timeline.segments[0],
      nextSegment: timeline.segments[0],
      activeStep: Math.min(RADIO_TRANSITION_STEPS - 1, Math.floor(frame * RADIO_TRANSITION_STEPS / timeline.countInFrames)),
      repetition: 0,
      signalDue: true,
      countingIn: true,
      transitionTracks: null,
    };
  }
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
  const repetition = Math.floor(offset / segment.cycleFrames) + 1;
  return {
    index: low,
    segment,
    nextSegment: timeline.segments[(low + 1) % timeline.segments.length],
    activeStep: Math.min(
      segment.stepCount - 1,
      Math.floor(
        ((offset % segment.cycleFrames) * segment.stepCount) /
          segment.cycleFrames,
      ),
    ),
    repetition,
    countingIn: false,
    // Visual calls lead the existing audio transition. Sequences run once, so
    // use their elapsed frames instead of showing the call for the whole pass.
    signalDue: segment.repetitions === 1
      ? offset >= Math.ceil(segment.cycleFrames * 0.7)
      : repetition >= segment.repetitions - 1,
    transitionTracks:
      segment.transitionStartFrame !== undefined && frame >= segment.transitionStartFrame
        ? transitionTracksForRepetition(segment, repetition)
        : null,
  };
}

import { allowedSymbolsForTrack, sampleMap, type SampleMap } from "./sampleMap";
import type { Rhythm } from "./rhythmTypes";
import { translate, type Message } from "./i18n/messages";

const SUPPORTED_SUBDIVISIONS = new Set([8, 16, 32]);

export function validateRhythm(
  rhythm: Rhythm,
  samples: SampleMap = sampleMap,
): string[] {
  return validateRhythmIssues(rhythm, samples).map((issue) => translate("en-CA", issue));
}

export function validateRhythmIssues(
  rhythm: Rhythm,
  samples: SampleMap = sampleMap,
): Message[] {
  const errors: Message[] = [];
  const trackNames = new Set<string>();
  const duplicateNames = new Set<string>();
  const unknownSymbols = new Set<string>();
  const expectedStepCount = rhythm.tracks[0]?.steps.length ?? 0;
  const expectedTrackName = rhythm.tracks[0]?.name ?? "the first track";

  if (!Number.isFinite(rhythm.tempo) || rhythm.tempo <= 0) {
    errors.push("Tempo must be a positive number.");
  }

  if (!SUPPORTED_SUBDIVISIONS.has(rhythm.subdivision)) {
    errors.push("Subdivision must be 8, 16, or 32.");
  }

  if (rhythm.tracks.length === 0) {
    errors.push("Rhythm block must contain at least one track.");
  }

  rhythm.tracks.forEach((track) => {
    if (trackNames.has(track.name)) {
      duplicateNames.add(track.name);
    }

    trackNames.add(track.name);

    if (track.steps.length === 0) {
      errors.push({ key: "{track} must have at least one step.", values: { track: track.name } });
    }

    if (track.steps.length !== expectedStepCount) {
      errors.push({
        key: "{track} has {count} steps, but {expectedTrack} has {expectedCount}. Each track must have the same number of steps.",
        values: { track: track.name, count: track.steps.length, expectedTrack: expectedTrackName, expectedCount: expectedStepCount },
      });
    }

    track.steps.forEach((symbol) => {
      if (symbol === ".") {
        return;
      }

      const key = `${track.name}.${symbol}`;

      if (!samples[key]) {
        const errorKey = `${track.name}.${symbol}`;
        if (unknownSymbols.has(errorKey)) {
          return;
        }

        unknownSymbols.add(errorKey);
        errors.push({
          key: 'Unknown symbol "{symbol}" in {track}. Allowed symbols for {track} are {allowed}.',
          values: { symbol, track: track.name, allowed: allowedSymbolsForTrack(track.name, samples).join(", ") },
        });
      }
    });
  });

  duplicateNames.forEach((trackName) => {
    errors.push({ key: 'Track "{track}" is duplicated.', values: { track: trackName } });
  });

  return errors;
}

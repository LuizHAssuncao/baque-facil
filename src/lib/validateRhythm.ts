import { allowedSymbolsForTrack, sampleMap, type SampleMap } from "./sampleMap";
import type { Rhythm } from "./rhythmTypes";

export function validateRhythm(
  rhythm: Rhythm,
  samples: SampleMap = sampleMap,
): string[] {
  const errors: string[] = [];
  const trackNames = new Set<string>();
  const duplicateNames = new Set<string>();
  const unknownSymbols = new Set<string>();
  const expectedStepCount = rhythm.tracks[0]?.steps.length ?? 0;
  const expectedTrackName = rhythm.tracks[0]?.name ?? "the first track";

  if (!Number.isFinite(rhythm.tempo) || rhythm.tempo <= 0) {
    errors.push("Tempo must be a positive number.");
  }

  if (rhythm.subdivision !== 16) {
    errors.push("Only subdivision 16 is supported in this prototype.");
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
      errors.push(`${track.name} must have at least one step.`);
    }

    if (track.steps.length !== expectedStepCount) {
      errors.push(
        `${track.name} has ${track.steps.length} steps, but ${expectedTrackName} has ${expectedStepCount}. Each track must have the same number of steps.`,
      );
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
        errors.push(
          `Unknown symbol "${symbol}" in ${track.name}. Allowed symbols for ${track.name} are ${allowedSymbolsForTrack(track.name, samples).join(", ")}.`,
        );
      }
    });
  });

  duplicateNames.forEach((trackName) => {
    errors.push(`Track "${trackName}" is duplicated.`);
  });

  return errors;
}

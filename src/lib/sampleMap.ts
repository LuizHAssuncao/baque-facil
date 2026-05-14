import type { Rhythm } from "./rhythmTypes";

export type SampleMap = Record<string, string>;

export const sampleMap: SampleMap = {
  "Alfaia.R": "/samples/alfaia/right-accent.wav",
  "Alfaia.L": "/samples/alfaia/left-ghost.wav",
  "Gongue.X": "/samples/gongue/high-loud.wav",
  "Gongue.x": "/samples/gongue/low-light.wav",
};

export function allowedSymbolsForTrack(
  trackName: string,
  samples: SampleMap = sampleMap,
): string[] {
  const prefix = `${trackName}.`;
  const playableSymbols = Object.keys(samples)
    .filter((key) => key.startsWith(prefix))
    .map((key) => key.slice(prefix.length));

  return [...new Set([...playableSymbols, ".", "-"])];
}

export function sampleEntriesForRhythm(
  rhythm: Rhythm,
  samples: SampleMap = sampleMap,
): SampleMap {
  const entries: SampleMap = {};

  rhythm.tracks.forEach((track) => {
    track.steps.forEach((symbol) => {
      if (symbol === ".") {
        return;
      }

      const key = `${track.name}.${symbol}`;
      if (samples[key]) {
        entries[key] = samples[key];
      }
    });
  });

  return entries;
}

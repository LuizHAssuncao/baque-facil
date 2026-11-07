import type { Rhythm } from "./rhythmTypes";

export type SampleMap = Record<string, string>;

export const sampleMap: SampleMap = {
  "Alfaia.R": "/samples/alfaia/right-accent.wav",
  "Alfaia.L": "/samples/alfaia/left-ghost.wav",
  "Alfaia.B": "/samples/alfaia/border-hit.wav",
  "Caixa.X": "/samples/caixa/snare-hit.wav",
  "Gongue.X": "/samples/gongue/high-loud.wav",
  "Gongue.x": "/samples/gongue/low-light.wav",
  "Whistle.X": "/samples/whistle/whistle.wav",
};

export function sampleVolumeDb(sampleKey: string): number {
  // Keep the whistle cue slightly behind the drums in every playback path.
  return sampleKey.startsWith("Whistle.") ? -2 : 0;
}

export function sampleGain(sampleKey: string): number {
  return 10 ** (sampleVolumeDb(sampleKey) / 20);
}

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
  const trackPrefixes = rhythm.tracks.map((track) => `${track.name}.`);

  Object.entries(samples).forEach(([key, url]) => {
    if (trackPrefixes.some((prefix) => key.startsWith(prefix))) {
      entries[key] = url;
    }
  });

  return entries;
}

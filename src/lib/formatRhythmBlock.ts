import type { RhythmTrack } from "./rhythmTypes";

export function formatStepGroups(steps: readonly string[], groupSize: number) {
  const groups: string[] = [];

  for (let index = 0; index < steps.length; index += groupSize) {
    groups.push(steps.slice(index, index + groupSize).join(" "));
  }

  return groups.join(" | ");
}

export function formatRhythmBlock(tracks: readonly RhythmTrack[], groupSize: number) {
  return tracks
    .map((track) => `${track.name}:\n${formatStepGroups(track.steps, groupSize)}`)
    .join("\n\n");
}

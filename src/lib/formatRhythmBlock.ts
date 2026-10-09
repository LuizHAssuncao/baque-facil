import type { RhythmTrack } from "./rhythmTypes";
import type { Locale } from "./i18n/messages";
import { localizeHandSymbol } from "./rhythmNotation";

export function formatStepGroups(steps: readonly string[], groupSize: number) {
  const groups: string[] = [];

  for (let index = 0; index < steps.length; index += groupSize) {
    groups.push(steps.slice(index, index + groupSize).join(" "));
  }

  return groups.join(" | ");
}

export function formatRhythmBlock(
  tracks: readonly RhythmTrack[],
  groupSize: number,
  locale: Locale = "en-CA",
) {
  return tracks
    .map((track) => {
      const steps = track.name === "Alfaia"
        ? track.steps.map((symbol) => localizeHandSymbol(symbol, locale))
        : track.steps;
      return `${track.name}:\n${formatStepGroups(steps, groupSize)}`;
    })
    .join("\n\n");
}

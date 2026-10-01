import type { Subdivision } from "./rhythmTypes";

export function stepsPerBeat(subdivision: Subdivision) {
  return subdivision / 4;
}

export function countLabels(stepCount: number, subdivision: Subdivision, includeSubdivisions = false): string[] {
  const beatStepCount = stepsPerBeat(subdivision);

  return Array.from({ length: stepCount }, (_, index) => {
    if (index % beatStepCount === 0) return String(Math.floor(index / beatStepCount) + 1);
    if (!includeSubdivisions) return "";
    const syllables = subdivision === 8 ? ["", "&"] : subdivision === 16 ? ["", "e", "&", "a"] : ["", "ta", "e", "ta", "&", "ta", "a", "ta"];
    return syllables[index % beatStepCount];
  });
}

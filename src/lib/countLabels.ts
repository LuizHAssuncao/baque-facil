import type { Subdivision } from "./rhythmTypes";

export function stepsPerBeat(subdivision: Subdivision) {
  return subdivision / 4;
}

export function countLabels(stepCount: number, subdivision: Subdivision): string[] {
  const beatStepCount = stepsPerBeat(subdivision);

  return Array.from({ length: stepCount }, (_, index) => {
    return index % beatStepCount === 0 ? String(Math.floor(index / beatStepCount) + 1) : "";
  });
}

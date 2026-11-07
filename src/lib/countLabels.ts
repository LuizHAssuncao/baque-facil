import type { Subdivision } from "./rhythmTypes";
import type { Message } from "./i18n/messages";

export function stepsPerBeat(subdivision: Subdivision) {
  return subdivision / 4;
}

export function beatSeekMessage(step: number, subdivision: Subdivision): Message {
  const perBeat = stepsPerBeat(subdivision);
  const beat = Math.floor(step / perBeat) + 1;
  return step % perBeat === 0
    ? { key: "Jump to beat {beat}", values: { beat } }
    : { key: "Jump to beat {beat}, subdivision {subdivision}", values: { beat, subdivision: step % perBeat + 1 } };
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

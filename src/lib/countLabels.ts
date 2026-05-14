import type { Subdivision } from "./rhythmTypes";

const LABELS_BY_SUBDIVISION: Record<Subdivision, string[]> = {
  8: ["1", "&"],
  16: ["1", "e", "&", "a"],
  32: ["1", "", "e", "", "&", "", "a", ""],
};

export function stepsPerBeat(subdivision: Subdivision) {
  return subdivision / 4;
}

export function countLabels(stepCount: number, subdivision: Subdivision): string[] {
  const labels = LABELS_BY_SUBDIVISION[subdivision];

  return Array.from({ length: stepCount }, (_, index) => {
    const label = labels[index % labels.length];
    return label === "1" ? String(Math.floor(index / labels.length) + 1) : label;
  });
}

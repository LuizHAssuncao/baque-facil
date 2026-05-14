const SIXTEENTH_LABELS = ["1", "e", "&", "a"];

export function countLabels(stepCount: number): string[] {
  return Array.from({ length: stepCount }, (_, index) => {
    const label = SIXTEENTH_LABELS[index % SIXTEENTH_LABELS.length];
    return label === "1" ? String(Math.floor(index / 4) + 1) : label;
  });
}

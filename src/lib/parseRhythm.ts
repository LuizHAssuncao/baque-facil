import type { RhythmTrack } from "./rhythmTypes";

export function parseRhythm(input: string): RhythmTrack[] {
  const tracks: RhythmTrack[] = [];
  let activeTrack: RhythmTrack | null = null;

  input.split(/\r?\n/).forEach((rawLine, index) => {
    const line = rawLine.trim();

    if (!line || line.startsWith("#")) {
      return;
    }

    if (line.endsWith(":")) {
      const name = line.slice(0, -1).trim();

      if (!name) {
        throw new Error(`Line ${index + 1} has an empty track name.`);
      }

      activeTrack = { name, steps: [] };
      tracks.push(activeTrack);
      return;
    }

    if (!activeTrack) {
      throw new Error(`Line ${index + 1} has steps before any track header.`);
    }

    const steps = line
      .split(/\s+/)
      .filter((token) => token !== "|")
      .map((token) => (token === "-" ? "." : token));

    activeTrack.steps.push(...steps);
  });

  return tracks;
}

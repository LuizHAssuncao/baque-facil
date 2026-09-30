import type { RhythmTrack } from "./rhythmTypes";
import { TranslatableError } from "./i18n/messages";

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
        throw new TranslatableError({ key: "Line {line} has an empty track name.", values: { line: index + 1 } });
      }

      activeTrack = { name, steps: [] };
      tracks.push(activeTrack);
      return;
    }

    if (!activeTrack) {
      throw new TranslatableError({ key: "Line {line} has steps before any track header.", values: { line: index + 1 } });
    }

    const steps = line
      .split(/\s+/)
      .filter((token) => token !== "|")
      .map((token) => (token === "-" ? "." : token));

    activeTrack.steps.push(...steps);
  });

  return tracks;
}

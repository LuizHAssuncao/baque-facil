import { parseRhythm } from "../parseRhythm";
import type { Rhythm, RhythmTrack } from "../rhythmTypes";
import { isRadioSequence } from "./sequence";

export const RADIO_TRANSITION_STEPS = 16;

const [alfaia, whistle] = parseRhythm(`Alfaia:
R . . . | . . . . | L R . R | L . R .

Whistle:
X . . . | . . . . | X X . X | X . X .`);

/** Add a final-bar whistle; only marcação and imalê change their alfaia notes. */
export function radioTransitionTracks(rhythm: Rhythm): RhythmTrack[] | undefined {
  const stepCount = rhythm.tracks[0]?.steps.length ?? 0;
  if (
    isRadioSequence(rhythm) ||
    rhythm.subdivision !== 16 ||
    stepCount < RADIO_TRANSITION_STEPS ||
    rhythm.tracks.some((track) => track.steps.length !== stepCount)
  ) return undefined;

  const start = stepCount - RADIO_TRANSITION_STEPS;
  const changeAlfaia = rhythm.slug === "marcacao" || rhythm.slug === "imale";
  const tracks = rhythm.tracks.map((track) => {
    const replacement = track.name === "Whistle"
      ? whistle
      : changeAlfaia && track.name === "Alfaia" ? alfaia : null;
    return replacement
      ? { ...track, steps: [...track.steps.slice(0, start), ...replacement.steps] }
      : track;
  });
  if (!tracks.some((track) => track.name === "Whistle")) {
    tracks.push({ name: "Whistle", steps: [...Array<string>(start).fill("."), ...whistle.steps] });
  }
  return tracks;
}

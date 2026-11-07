import { parseRhythm } from "../parseRhythm";
import type { Rhythm, RhythmTrack } from "../rhythmTypes";

const transition = parseRhythm(`Alfaia:
R . . . | . . . . | L R . R | L . R .

Whistle:
X . . . | . . . . | X X . X | X . X .`);

/** The outgoing bar for these two rhythms; lesson/composer tracks stay untouched. */
export function radioTransitionTracks(rhythm: Rhythm): RhythmTrack[] | undefined {
  if (
    (rhythm.slug !== "marcacao" && rhythm.slug !== "imale") ||
    rhythm.subdivision !== 16 ||
    !rhythm.tracks.some((track) => track.name === "Alfaia") ||
    rhythm.tracks.some((track) => track.steps.length !== 16)
  ) return undefined;

  return [
    ...rhythm.tracks.map((track) =>
      transition.find((replacement) => replacement.name === track.name) ?? track,
    ),
    ...transition.filter((track) =>
      !rhythm.tracks.some((original) => original.name === track.name),
    ),
  ];
}

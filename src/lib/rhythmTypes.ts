export type Subdivision = 8 | 16 | 32;

export type Rhythm = {
  title: string;
  slug: string;
  tempo: number;
  subdivision: Subdivision;
  tracks: RhythmTrack[];
};

export type RhythmTrack = {
  name: string;
  steps: string[];
};

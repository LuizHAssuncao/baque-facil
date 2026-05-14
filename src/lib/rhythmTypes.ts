export type Rhythm = {
  title: string;
  slug: string;
  tempo: number;
  subdivision: 16;
  tracks: RhythmTrack[];
};

export type RhythmTrack = {
  name: string;
  steps: string[];
};

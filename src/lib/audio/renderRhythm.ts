import type { Rhythm } from "../rhythmTypes";
import { clampTempo } from "../tempo";
import { RENDER_SAMPLE_RATE, SampleCache } from "./sampleCache";

export type RenderRequest = {
  rhythm: Rhythm;
  samples: Record<string, string>;
  tempo: number;
  loop: boolean;
  mutedTracks: string[];
};

export type RenderedRhythm = {
  buffer: AudioBuffer;
  tempo: number;
  loop: boolean;
  stepCount: number;
  cycleDuration: number;
};

export function renderRequestKey(request: RenderRequest): string {
  return JSON.stringify([
    request.rhythm.tracks,
    request.rhythm.subdivision,
    request.samples,
    clampTempo(request.tempo),
    request.loop,
    [...request.mutedTracks].sort(),
  ]);
}

export async function renderRhythm(
  request: RenderRequest,
  cache: SampleCache,
): Promise<RenderedRhythm> {
  const { rhythm, samples, loop, mutedTracks } = request;
  const tempo = clampTempo(request.tempo);
  const stepCount = rhythm.tracks[0]?.steps.length ?? 0;
  if (!stepCount || rhythm.tracks.some((track) => track.steps.length !== stepCount)) {
    throw new Error("The rhythm needs equally sized, nonempty tracks.");
  }
  const cycleFrames = Math.round((60 / tempo) * (4 / rhythm.subdivision) * stepCount * RENDER_SAMPLE_RATE);
  const cycleDuration = cycleFrames / RENDER_SAMPLE_RATE;
  // Web Audio repeats this single cycle without reopening a media file.
  if (cycleDuration > 180) {
    throw new Error("This rhythm is too long to prepare on this device.");
  }

  const hits: { frame: number; buffer: AudioBuffer }[] = [];
  await Promise.all(rhythm.tracks.filter((track) => !mutedTracks.includes(track.name)).map(async (track) => {
    await Promise.all(track.steps.map(async (symbol, index) => {
      if (symbol === "." || symbol === "-") return;
      const url = samples[`${track.name}.${symbol}`];
      if (!url) throw new Error(`Missing sample for ${track.name}.${symbol}.`);
      hits.push({ frame: Math.round(index * cycleFrames / stepCount), buffer: await cache.load(url) });
    }));
  }));

  const tailFrames = hits.reduce((end, hit) => Math.max(end, hit.frame + hit.buffer.length), cycleFrames);
  const length = loop ? cycleFrames : tailFrames;
  const context = new OfflineAudioContext(2, length, RENDER_SAMPLE_RATE);
  const history = loop ? Math.ceil(Math.max(0, ...hits.map((hit) => hit.buffer.duration)) / cycleDuration) : 0;

  for (let cycle = -history; cycle < 1; cycle += 1) {
    for (const hit of hits) {
      const startTime = (cycle * cycleFrames + hit.frame) / RENDER_SAMPLE_RATE;
      if (startTime + hit.buffer.duration <= 0) continue;
      const source = context.createBufferSource();
      source.buffer = hit.buffer;
      source.connect(context.destination);
      // Include the previous repetition's decay at the beginning of a loop.
      source.start(Math.max(0, startTime), Math.max(0, -startTime));
    }
  }

  const buffer = await context.startRendering();
  // Keep the float buffer and attenuate only mixes that would clip.
  let peak = 0;
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    for (const value of buffer.getChannelData(channel)) peak = Math.max(peak, Math.abs(value));
  }
  if (peak > 0.98) {
    const gain = 0.98 / peak;
    for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
      const data = buffer.getChannelData(channel);
      for (let frame = 0; frame < data.length; frame += 1) data[frame] *= gain;
    }
  }
  return { buffer, tempo, loop, stepCount, cycleDuration };
}

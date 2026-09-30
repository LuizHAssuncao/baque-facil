import { TranslatableError } from "../i18n/messages";
import type { Rhythm } from "../rhythmTypes";
import type { SampleMap } from "../sampleMap";
import { clampTempo } from "../tempo";
import { validateRhythmIssues } from "../validateRhythm";
import { MP3_SAMPLE_RATE } from "./mp3Constants";
import type { PcmHit, PcmSample } from "./pcmMixer";
import { SampleCache } from "./sampleCache";

export const EXPORT_REPETITIONS = [1, 4, 8, 16] as const;
export const MAX_EXPORT_FRAMES = 20 * 60 * MP3_SAMPLE_RATE;

export type Mp3ExportRequest = {
  rhythm: Rhythm;
  samples: SampleMap;
  tempo: number;
  mutedTracks: string[];
  repetitions: number;
};

export function mp3ExportKey(request: Mp3ExportRequest): string {
  return JSON.stringify([
    request.rhythm.title, request.rhythm.tracks, request.rhythm.subdivision,
    request.samples, request.tempo, [...request.mutedTracks].sort(), request.repetitions,
  ]);
}

export function planMp3Export(request: Mp3ExportRequest) {
  const { rhythm, samples, mutedTracks, repetitions } = request;
  // Normalize the accepted rest alias before using the shared validator.
  const tracks = rhythm.tracks.map((track) => ({
    ...track, steps: track.steps.map((symbol) => symbol === "-" ? "." : symbol),
  }));
  const issues = validateRhythmIssues({ ...rhythm, tracks, tempo: request.tempo }, samples);
  if (issues.length) throw new TranslatableError(issues[0]);
  if (!(EXPORT_REPETITIONS as readonly number[]).includes(repetitions)) {
    throw new TranslatableError("Choose 1, 4, 8, or 16 repetitions.");
  }
  const tempo = clampTempo(request.tempo);
  const stepCount = tracks[0].steps.length;
  const cycleFrames = Math.round((60 / tempo) * (4 / rhythm.subdivision) * stepCount * MP3_SAMPLE_RATE);
  if (cycleFrames > 180 * MP3_SAMPLE_RATE) {
    throw new TranslatableError("This rhythm is too long to prepare on this device.");
  }
  const totalFrames = cycleFrames * repetitions;
  if (totalFrames > MAX_EXPORT_FRAMES) {
    throw new TranslatableError("Choose fewer repetitions. MP3 downloads can be up to 20 minutes.");
  }
  const hits: PcmHit[] = [];
  for (let repeat = 0; repeat < repetitions; repeat += 1) {
    for (const track of tracks) {
      if (mutedTracks.includes(track.name)) continue;
      track.steps.forEach((symbol, step) => {
        if (symbol !== ".") hits.push({
          frame: repeat * cycleFrames + Math.round(step * cycleFrames / stepCount),
          sample: `${track.name}.${symbol}`,
        });
      });
    }
  }
  if (!hits.length) throw new TranslatableError("Add a note or unmute a track to prepare an MP3.");
  hits.sort((a, b) => a.frame - b.frame);
  return { hits, totalFrames, cycleFrames, tempo };
}

export function exportFramesWithDecay(hits: PcmHit[], samples: Record<string, PcmSample>, musicalFrames: number) {
  const totalFrames = hits.reduce((end, hit) => Math.max(end, hit.frame + samples[hit.sample].left.length), musicalFrames);
  if (totalFrames > MAX_EXPORT_FRAMES) {
    throw new TranslatableError("Choose fewer repetitions. MP3 downloads can be up to 20 minutes.");
  }
  return totalFrames;
}

export async function exportMp3(
  request: Mp3ExportRequest,
  signal: AbortSignal,
  onProgress: (progress: number) => void,
): Promise<{ blob: Blob; duration: number }> {
  signal.throwIfAborted();
  const plan = planMp3Export(request);
  const cache = new SampleCache();
  const loading = new AbortController();
  const abort = () => loading.abort(signal.reason);
  signal.addEventListener("abort", abort, { once: true });
  try {
    const [encoder, decoded] = await Promise.all([
      import("./encodeMp3"),
      Promise.all([...new Set(plan.hits.map((hit) => hit.sample))].map(async (key) => {
        const buffer = await cache.load(request.samples[key], loading.signal);
        return [key, {
          left: buffer.getChannelData(0),
          right: buffer.getChannelData(Math.min(1, buffer.numberOfChannels - 1)),
        }] as const;
      })),
    ]);
    signal.throwIfAborted();
    const samples = Object.fromEntries(decoded);
    cache.clear();
    const totalFrames = exportFramesWithDecay(plan.hits, samples, plan.totalFrames);
    const blob = await encoder.encodeMp3({ ...plan, samples, totalFrames, boundary: "finite" }, onProgress, signal);
    return { blob, duration: totalFrames / MP3_SAMPLE_RATE };
  } finally {
    loading.abort();
    signal.removeEventListener("abort", abort);
    cache.clear();
  }
}

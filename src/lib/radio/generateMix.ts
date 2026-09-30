import { TranslatableError } from "../i18n/messages";
import { SampleCache } from "../audio/sampleCache";
import type { Rhythm } from "../rhythmTypes";
import type { SampleMap } from "../sampleMap";
import type { PcmSample } from "./mixer";
import type { RadioTimeline } from "./timeline";

export async function generateMix(
  timeline: RadioTimeline,
  rhythms: Rhythm[],
  sampleMap: SampleMap,
  signal: AbortSignal,
  onProgress: (progress: number) => void,
): Promise<Blob> {
  const cache = new SampleCache();
  const keys = [
    ...new Set(
      rhythms.flatMap((rhythm) =>
        rhythm.tracks.flatMap((track) =>
          track.steps
            .filter((symbol) => symbol !== "." && symbol !== "-")
            .map((symbol) => `${track.name}.${symbol}`),
        ),
      ),
    ),
  ];
  try {
    signal.throwIfAborted();
    const [encoder, decoded] = await Promise.all([
      import("./encodeMix"),
      Promise.all(
        keys.map(async (key) => {
          const url = sampleMap[key];
          if (!url) throw new TranslatableError({ key: "Missing drum sample for {sample}.", values: { sample: key } });
          const buffer = await cache.load(url, signal);
          return [
            key,
            {
              left: buffer.getChannelData(0),
              right: buffer.getChannelData(
                Math.min(1, buffer.numberOfChannels - 1),
              ),
            },
          ] as const;
        }),
      ),
    ]);
    signal.throwIfAborted();
    const samples: Record<string, PcmSample> = Object.fromEntries(decoded);
    cache.clear();
    return await encoder.encodeMix(
      { timeline, rhythms, samples },
      onProgress,
      signal,
    );
  } finally {
    cache.clear();
  }
}

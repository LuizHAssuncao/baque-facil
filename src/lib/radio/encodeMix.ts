import type { Rhythm } from "../rhythmTypes";
import { encodeMp3 } from "../audio/encodeMp3";
import { buildRadioHits, type PcmSample } from "./mixer";
import type { RadioTimeline } from "./timeline";

export type EncodeMixRequest = {
  timeline: RadioTimeline;
  rhythms: Rhythm[];
  samples: Record<string, PcmSample>;
};

export function encodeMix(
  request: EncodeMixRequest,
  onProgress: (progress: number) => void,
  signal: AbortSignal,
): Promise<Blob> {
  return encodeMp3({
    hits: buildRadioHits(request.timeline, request.rhythms),
    totalFrames: request.timeline.totalFrames,
    samples: request.samples,
    // A full mix must start with only the whistle, without the last drum's decay.
    // Held patterns still wrap their tails for continuous repetition.
    boundary: request.timeline.countInFrames ? "finite" : "wrapped",
  }, onProgress, signal);
}

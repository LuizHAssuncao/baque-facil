import { TranslatableError } from "../i18n/messages";
import type { Rhythm } from "../rhythmTypes";
import type { RadioTimeline } from "./timeline";

import type { PcmHit as RadioHit } from "../audio/pcmMixer";
export { PcmMixer as RadioMixer } from "../audio/pcmMixer";
export type { PcmHit as RadioHit, PcmSample } from "../audio/pcmMixer";

export function buildRadioHits(
  timeline: RadioTimeline,
  rhythms: Rhythm[],
): RadioHit[] {
  const bySlug = new Map(rhythms.map((rhythm) => [rhythm.slug, rhythm]));
  const hits: RadioHit[] = [];
  for (const segment of timeline.segments) {
    const rhythm = bySlug.get(segment.slug);
    if (!rhythm) throw new TranslatableError("A selected rhythm is no longer available.");
    for (let repeat = 0; repeat < segment.repetitions; repeat += 1) {
      for (const track of rhythm.tracks) {
        track.steps.forEach((symbol, step) => {
          if (symbol !== "." && symbol !== "-") {
            hits.push({
              frame:
                segment.startFrame +
                repeat * segment.cycleFrames +
                Math.round((step * segment.cycleFrames) / segment.stepCount),
              sample: `${track.name}.${symbol}`,
            });
          }
        });
      }
    }
  }
  return hits.sort((left, right) => left.frame - right.frame);
}

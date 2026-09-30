import type { Rhythm } from "../rhythmTypes";
import type { RadioTimeline } from "./timeline";

export type PcmSample = { left: Float32Array; right: Float32Array };
export type RadioHit = { frame: number; sample: string };

export function buildRadioHits(
  timeline: RadioTimeline,
  rhythms: Rhythm[],
): RadioHit[] {
  const bySlug = new Map(rhythms.map((rhythm) => [rhythm.slug, rhythm]));
  const hits: RadioHit[] = [];
  for (const segment of timeline.segments) {
    const rhythm = bySlug.get(segment.slug);
    if (!rhythm) throw new Error("A selected rhythm is no longer available.");
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

/** A sequential, bounded mixer. Negative hits carry the last cycle's decay into the first. */
export class RadioMixer {
  private events: RadioHit[];
  private nextEvent = 0;
  private active: RadioHit[] = [];

  constructor(
    hits: RadioHit[],
    private samples: Record<string, PcmSample>,
    totalFrames: number,
  ) {
    const wrapped: RadioHit[] = [];
    for (const hit of hits) {
      const sample = samples[hit.sample];
      if (!sample) throw new Error(`Missing sample for ${hit.sample}.`);
      // Usually zero or one; also correct for an unusually long sample on a short loop.
      for (
        let frame = hit.frame - totalFrames;
        frame + sample.left.length > 0;
        frame -= totalFrames
      ) {
        wrapped.push({ ...hit, frame });
      }
    }
    this.events = [...wrapped, ...hits].sort((a, b) => a.frame - b.frame);
  }

  chunk(startFrame: number, frames: number, gain = 1): Float32Array {
    const data = new Float32Array(frames * 2);
    const endFrame = startFrame + frames;
    while (
      this.nextEvent < this.events.length &&
      this.events[this.nextEvent].frame < endFrame
    ) {
      this.active.push(this.events[this.nextEvent++]);
    }
    for (const hit of this.active) {
      const sample = this.samples[hit.sample];
      const from = Math.max(startFrame, hit.frame);
      const to = Math.min(endFrame, hit.frame + sample.left.length);
      for (let frame = from; frame < to; frame += 1) {
        const source = frame - hit.frame;
        const target = frame - startFrame;
        data[target] += sample.left[source] * gain;
        data[frames + target] += sample.right[source] * gain;
      }
    }
    this.active = this.active.filter(
      (hit) => hit.frame + this.samples[hit.sample].left.length > endFrame,
    );
    return data;
  }
}

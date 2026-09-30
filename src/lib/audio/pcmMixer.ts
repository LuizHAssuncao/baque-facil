import { TranslatableError } from "../i18n/messages";

export type PcmSample = { left: Float32Array; right: Float32Array };
export type PcmHit = { frame: number; sample: string };

/** A sequential, bounded mixer. Negative hits carry the last cycle's decay into the first. */
export class PcmMixer {
  private events: PcmHit[];
  private nextEvent = 0;
  private active: PcmHit[] = [];

  constructor(
    hits: PcmHit[],
    private samples: Record<string, PcmSample>,
    totalFrames: number,
    boundary: "finite" | "wrapped" = "wrapped",
  ) {
    const wrapped: PcmHit[] = [];
    for (const hit of hits) {
      const sample = samples[hit.sample];
      if (!sample) throw new TranslatableError({ key: "Missing sample for {sample}.", values: { sample: hit.sample } });
      // Usually zero or one; also correct for an unusually long sample on a short loop.
      for (
        let frame = hit.frame - totalFrames;
        boundary === "wrapped" && frame + sample.left.length > 0;
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

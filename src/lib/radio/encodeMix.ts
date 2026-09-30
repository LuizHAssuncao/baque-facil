import {
  AudioSample,
  AudioSampleSource,
  BufferTarget,
  Mp3OutputFormat,
  Output,
  Quality,
} from "mediabunny";
import { registerMp3Encoder } from "@mediabunny/mp3-encoder";
import type { Rhythm } from "../rhythmTypes";
import { RadioMixer, buildRadioHits, type PcmSample } from "./mixer";
import { addGaplessMetadata } from "./mp3Metadata";
import {
  RADIO_BITRATE,
  RADIO_CHUNK_FRAMES,
  RADIO_SAMPLE_RATE,
  type RadioTimeline,
} from "./timeline";

export type EncodeMixRequest = {
  timeline: RadioTimeline;
  rhythms: Rhythm[];
  samples: Record<string, PcmSample>;
};

/** Mix only two seconds of PCM at a time; the encoder runs in its own worker. */
export async function encodeMix(
  request: EncodeMixRequest,
  onProgress: (progress: number) => void,
  signal: AbortSignal,
): Promise<Blob> {
  registerMp3Encoder();
  const { timeline, rhythms, samples } = request;
  const hits = buildRadioHits(timeline, rhythms);
  const target = new BufferTarget();
  const output = new Output({ format: new Mp3OutputFormat(), target });
  const source = new AudioSampleSource({
    codec: "mp3",
    quality: new Quality({ bitrate: RADIO_BITRATE, bitrateMode: "constant" }),
  });
  output.addAudioTrack(source);
  const cancel = () => {
    void output.cancel().catch(() => {});
  };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    signal.throwIfAborted();
    // A bounded analysis pass gives the entire recording one gain, avoiding pumping.
    let mixer = new RadioMixer(hits, samples, timeline.totalFrames);
    let peak = 0;
    for (
      let frame = 0;
      frame < timeline.totalFrames;
      frame += RADIO_CHUNK_FRAMES
    ) {
      signal.throwIfAborted();
      const chunk = mixer.chunk(
        frame,
        Math.min(RADIO_CHUNK_FRAMES, timeline.totalFrames - frame),
      );
      for (const value of chunk) peak = Math.max(peak, Math.abs(value));
      onProgress(
        0.1 * Math.min(1, (frame + RADIO_CHUNK_FRAMES) / timeline.totalFrames),
      );
      // Yield so cancellation, playback, and the UI remain responsive during analysis.
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    const gain = peak > 0.9 ? 0.9 / peak : 1;
    mixer = new RadioMixer(hits, samples, timeline.totalFrames);
    await output.start();
    for (
      let frame = 0;
      frame < timeline.totalFrames;
      frame += RADIO_CHUNK_FRAMES
    ) {
      signal.throwIfAborted();
      const chunk = mixer.chunk(
        frame,
        Math.min(RADIO_CHUNK_FRAMES, timeline.totalFrames - frame),
        gain,
      );
      const sample = new AudioSample({
        format: "f32-planar",
        sampleRate: RADIO_SAMPLE_RATE,
        numberOfChannels: 2,
        timestamp: frame / RADIO_SAMPLE_RATE,
        data: chunk,
      });
      try {
        await source.add(sample);
      } finally {
        sample.close();
      }
      onProgress(
        0.1 +
          0.88 *
            Math.min(1, (frame + RADIO_CHUNK_FRAMES) / timeline.totalFrames),
      );
    }
    signal.throwIfAborted();
    await output.finalize();
    signal.throwIfAborted();
    if (!target.buffer)
      throw new Error("Unable to finish the radio recording.");
    const recording = addGaplessMetadata(target.buffer, timeline.totalFrames);
    onProgress(1);
    return new Blob([recording], { type: "audio/mpeg" });
  } catch (error) {
    await output.cancel().catch(() => {});
    throw error;
  } finally {
    signal.removeEventListener("abort", cancel);
  }
}

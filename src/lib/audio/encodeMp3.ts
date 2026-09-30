import { TranslatableError } from "../i18n/messages";
import {
  AudioSample,
  AudioSampleSource,
  BufferTarget,
  Mp3OutputFormat,
  Output,
  Quality,
} from "mediabunny";
import { registerMp3Encoder } from "@mediabunny/mp3-encoder";
import { PcmMixer, type PcmSample, type PcmHit } from "./pcmMixer";
import { addGaplessMetadata } from "./mp3Metadata";
import {
  MP3_BITRATE,
  PCM_CHUNK_FRAMES,
  MP3_SAMPLE_RATE,
} from "./mp3Constants";

export type EncodeMp3Request = {
  hits: PcmHit[];
  totalFrames: number;
  boundary: "finite" | "wrapped";
  samples: Record<string, PcmSample>;
};

/** Mix only two seconds of PCM at a time; the encoder runs in its own worker. */
export async function encodeMp3(
  request: EncodeMp3Request,
  onProgress: (progress: number) => void,
  signal: AbortSignal,
): Promise<Blob> {
  registerMp3Encoder();
  const { hits, totalFrames, samples, boundary } = request;
  const target = new BufferTarget();
  const output = new Output({ format: new Mp3OutputFormat(), target });
  const source = new AudioSampleSource({
    codec: "mp3",
    quality: new Quality({ bitrate: MP3_BITRATE, bitrateMode: "constant" }),
  });
  output.addAudioTrack(source);
  const cancel = () => {
    void output.cancel().catch(() => {});
  };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    signal.throwIfAborted();
    // A bounded analysis pass gives the entire recording one gain, avoiding pumping.
    let mixer = new PcmMixer(hits, samples, totalFrames, boundary);
    let peak = 0;
    for (
      let frame = 0;
      frame < totalFrames;
      frame += PCM_CHUNK_FRAMES
    ) {
      signal.throwIfAborted();
      const chunk = mixer.chunk(
        frame,
        Math.min(PCM_CHUNK_FRAMES, totalFrames - frame),
      );
      for (const value of chunk) peak = Math.max(peak, Math.abs(value));
      onProgress(
        0.1 * Math.min(1, (frame + PCM_CHUNK_FRAMES) / totalFrames),
      );
      // Yield so cancellation, playback, and the UI remain responsive during analysis.
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    const gain = peak > 0.9 ? 0.9 / peak : 1;
    mixer = new PcmMixer(hits, samples, totalFrames, boundary);
    await output.start();
    for (
      let frame = 0;
      frame < totalFrames;
      frame += PCM_CHUNK_FRAMES
    ) {
      signal.throwIfAborted();
      const chunk = mixer.chunk(
        frame,
        Math.min(PCM_CHUNK_FRAMES, totalFrames - frame),
        gain,
      );
      const sample = new AudioSample({
        format: "f32-planar",
        sampleRate: MP3_SAMPLE_RATE,
        numberOfChannels: 2,
        timestamp: frame / MP3_SAMPLE_RATE,
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
            Math.min(1, (frame + PCM_CHUNK_FRAMES) / totalFrames),
      );
    }
    signal.throwIfAborted();
    await output.finalize();
    signal.throwIfAborted();
    if (!target.buffer)
      throw new TranslatableError("Unable to finish the MP3. Please try again.");
    const recording = addGaplessMetadata(target.buffer, totalFrames);
    onProgress(1);
    return new Blob([recording], { type: "audio/mpeg" });
  } catch (error) {
    await output.cancel().catch(() => {});
    throw error;
  } finally {
    signal.removeEventListener("abort", cancel);
  }
}

import { TranslatableError } from "../i18n/messages";

export const RENDER_SAMPLE_RATE = 44_100;

/** Per-player cache. Decoding uses an offline context, never a live audio graph. */
export class SampleCache {
  private buffers = new Map<string, Promise<AudioBuffer>>();

  load(url: string): Promise<AudioBuffer> {
    const existing = this.buffers.get(url);
    if (existing) return existing;

    const promise = (async () => {
      const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
      if (!response.ok) throw new TranslatableError("Unable to load a drum sample. Please try again.");
      const decoder = new OfflineAudioContext(2, 1, RENDER_SAMPLE_RATE);
      return decoder.decodeAudioData(await response.arrayBuffer());
    })();
    this.buffers.set(url, promise);
    void promise.catch(() => this.buffers.delete(url));
    return promise;
  }

  clear() {
    this.buffers.clear();
  }
}

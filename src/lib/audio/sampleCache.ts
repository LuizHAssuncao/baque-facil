export const RENDER_SAMPLE_RATE = 44_100;

/** Per-player cache. Decoding uses an offline context, never a live audio graph. */
export class SampleCache {
  private buffers = new Map<string, Promise<AudioBuffer>>();

  load(url: string, signal?: AbortSignal): Promise<AudioBuffer> {
    const existing = this.buffers.get(url);
    if (existing) return existing;

    const promise = (async () => {
      const request = new AbortController();
      const abort = () => request.abort(signal?.reason);
      const timeout = setTimeout(() => request.abort(), 15_000);
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) abort();
      try {
        const response = await fetch(url, { signal: request.signal });
        if (!response.ok) throw new Error("Unable to load a drum sample. Please try again.");
        const decoder = new OfflineAudioContext(2, 1, RENDER_SAMPLE_RATE);
        const bytes = await response.arrayBuffer();
        request.signal.throwIfAborted();
        return await decoder.decodeAudioData(bytes);
      } finally {
        clearTimeout(timeout);
        signal?.removeEventListener("abort", abort);
      }
    })();
    this.buffers.set(url, promise);
    void promise.catch(() => this.buffers.delete(url));
    return promise;
  }

  clear() {
    this.buffers.clear();
  }
}

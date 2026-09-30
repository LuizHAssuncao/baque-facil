import { renderRequestKey, renderRhythm, type RenderRequest, type RenderedRhythm } from "./renderRhythm";
import { SampleCache } from "./sampleCache";

export type PlaybackSnapshot = {
  ready: boolean;
  preparing: boolean;
  pending: boolean;
  playing: boolean;
  activeStep: number | null;
  playingTempo: number | null;
  error: string | null;
};

export const INITIAL_PLAYBACK: PlaybackSnapshot = {
  ready: false,
  preparing: true,
  pending: false,
  playing: false,
  activeStep: null,
  playingTempo: null,
  error: null,
};

type Clip = RenderedRhythm & { key: string; url: string };

/** Audio playback belongs to the media element. RAF is only for visible UI and edits. */
export class RenderedPlayback {
  private cache = new SampleCache();
  private current: Clip | null = null;
  private pending: Clip | null = null;
  private desired: { request: RenderRequest; key: string; version: number } | null = null;
  private version = 0;
  private running = false;
  private disposed = false;
  private switching = false;
  private wantsPlayback = false;
  private playAttempt = 0;
  private debounce: ReturnType<typeof setTimeout> | undefined;
  private animation = 0;
  private boundary = Infinity;
  private previousTime = 0;
  private snapshot = { ...INITIAL_PLAYBACK };
  private mediaActions: MediaSessionAction[] = [];

  constructor(
    private audio: HTMLAudioElement,
    private title: string,
    private onChange: (snapshot: PlaybackSnapshot) => void,
  ) {
    audio.preload = "auto";
    audio.addEventListener("playing", this.onPlaying);
    audio.addEventListener("pause", this.onPause);
    audio.addEventListener("ended", this.onEnded);
    audio.addEventListener("error", this.onError);
    document.addEventListener("visibilitychange", this.onVisibility);
    window.addEventListener("pagehide", this.onPageHide);
    this.tick();
  }

  private emit(update: Partial<PlaybackSnapshot>) {
    if (this.disposed) return;
    const next = { ...this.snapshot, ...update };
    if (Object.keys(next).every((key) => next[key as keyof PlaybackSnapshot] === this.snapshot[key as keyof PlaybackSnapshot])) return;
    this.snapshot = next;
    this.onChange(next);
  }

  update(request: RenderRequest) {
    const key = renderRequestKey(request);
    if (key === this.desired?.key) return;
    clearTimeout(this.debounce);
    this.version += 1;
    this.desired = { request, key, version: this.version };
    this.releasePending();
    this.emit({ error: null, pending: false, preparing: key !== this.current?.key });
    if (key !== this.current?.key) {
      this.debounce = setTimeout(() => void this.prepare(), this.current ? 200 : 0);
    }
  }

  private async prepare() {
    if (this.running || this.disposed || !this.desired || this.desired.key === this.current?.key) return;
    const desired = this.desired;
    this.running = true;
    try {
      const rendered = await renderRhythm(desired.request, this.cache);
      if (this.disposed || desired.version !== this.version) return;
      const clip: Clip = { ...rendered, key: desired.key, url: URL.createObjectURL(rendered.blob) };
      if (this.current && !this.audio.paused) {
        this.pending = clip;
        this.setBoundary();
        this.emit({ preparing: false, pending: true });
      } else {
        this.install(clip, false);
      }
    } catch (cause) {
      if (desired.version === this.version) {
        this.emit({ preparing: false, error: cause instanceof Error ? cause.message : "Unable to prepare audio. Press Play to try again." });
      }
    } finally {
      this.running = false;
      // Serialize renders and discard obsolete results when the slider moves quickly.
      if (!this.disposed && desired.version !== this.version) void this.prepare();
    }
  }

  private install(clip: Clip, resume: boolean) {
    this.switching = true;
    this.playAttempt += 1;
    const previous = this.current;
    this.current = clip;
    this.pending = null;
    this.audio.pause();
    this.audio.src = clip.url;
    this.audio.loop = clip.loop;
    this.audio.load();
    this.previousTime = 0;
    this.boundary = Infinity;
    this.emit({ ready: true, preparing: false, pending: false, playing: false, activeStep: null, playingTempo: clip.tempo, error: null });
    if (previous) URL.revokeObjectURL(previous.url);
    if (resume) {
      this.play();
    } else {
      this.wantsPlayback = false;
      this.switching = false;
    }
  }

  play = () => {
    if (this.disposed) return;
    if (this.pending) this.install(this.pending, false);
    if (!this.current) {
      this.emit({ error: null, preparing: true });
      void this.prepare();
      return;
    }
    // Feature detection only: this improves media routing, not JS lifetime.
    try {
      const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
      if (session) session.type = "playback";
    } catch { /* Optional API; direct media playback remains available. */ }
    this.configureMediaSession();
    this.wantsPlayback = true;
    const attempt = ++this.playAttempt;
    this.emit({ error: null });
    // Call synchronously from the user's tap; don't await rendering before play().
    void this.audio.play().then(() => {
      if (this.disposed || attempt !== this.playAttempt) return;
      this.switching = false;
      this.onPlaying();
    }).catch((cause: unknown) => {
      if (this.disposed || attempt !== this.playAttempt) return;
      this.switching = false;
      this.wantsPlayback = false;
      const blocked = cause instanceof DOMException && cause.name === "NotAllowedError";
      this.emit({ playing: false, error: blocked ? "Audio is ready. Tap Play to start." : "Playback was interrupted. Tap Play to try again." });
    });
    if (this.desired?.key !== this.current.key && !this.running && !this.pending) {
      this.emit({ preparing: true });
      void this.prepare();
    }
  };

  pause = () => {
    this.wantsPlayback = false;
    this.switching = false;
    this.playAttempt += 1;
    this.audio.pause();
    this.emit({ playing: false, activeStep: null });
    this.updateMediaState();
  };

  stop = () => {
    this.pause();
    if (this.current) this.audio.currentTime = 0;
    if (this.pending) this.install(this.pending, false);
    this.previousTime = 0;
  };

  restart = () => {
    this.stop();
    this.play();
  };

  private onPlaying = () => {
    if (!this.audio.paused) {
      this.wantsPlayback = true;
      this.emit({ playing: true, error: null });
      this.updateMediaState();
    }
  };

  private onPause = () => {
    if (this.audio.paused && !this.switching) {
      this.wantsPlayback = false;
      this.emit({ playing: false, activeStep: null });
      this.updateMediaState();
    }
  };

  private onEnded = () => {
    // A new tempo requested near the end of a one-shot starts the new rhythm.
    if (this.pending && this.wantsPlayback && !document.hidden) {
      this.install(this.pending, true);
    } else {
      this.pause();
    }
  };

  private onError = () => {
    if (this.audio.error) {
      this.pause();
      this.emit({ error: "Unable to play this audio. Reload the page and try again." });
    }
  };

  private setBoundary() {
    if (!this.current) return;
    this.boundary = (Math.floor(this.audio.currentTime / this.current.cycleDuration) + 1) * this.current.cycleDuration;
    this.previousTime = this.audio.currentTime;
  }

  private onVisibility = () => {
    if (!document.hidden) {
      this.setBoundary();
      this.emit({ playing: !this.audio.paused && !this.audio.ended });
    }
  };

  private onPageHide = () => this.stop();

  private tick = () => {
    if (this.disposed) return;
    if (!document.hidden && this.current && !this.audio.paused) {
      const time = this.audio.currentTime;
      const crossedBoundary = time >= this.boundary || time < this.previousTime - 0.1;
      if (this.pending && this.wantsPlayback && crossedBoundary) {
        this.install(this.pending, true);
      } else {
        const { cycleDuration, stepCount, loop } = this.current;
        const activeStep = !loop && time >= cycleDuration ? null : Math.min(stepCount - 1, Math.floor((time % cycleDuration) / cycleDuration * stepCount));
        this.emit({ activeStep });
        this.previousTime = time;
      }
    }
    this.animation = requestAnimationFrame(this.tick);
  };

  private configureMediaSession() {
    if (!("mediaSession" in navigator)) return;
    navigator.mediaSession.metadata = new MediaMetadata({ title: this.title, artist: "Baque Fácil" });
    const handlers: [MediaSessionAction, () => void][] = [["play", this.play], ["pause", this.pause], ["stop", this.stop]];
    for (const [action, handler] of handlers) {
      try {
        navigator.mediaSession.setActionHandler(action, handler);
        if (!this.mediaActions.includes(action)) this.mediaActions.push(action);
      } catch { /* Not all browsers expose all media controls. */ }
    }
  }

  private updateMediaState() {
    if (this.mediaActions.length) {
      navigator.mediaSession.playbackState = this.audio.paused ? "paused" : "playing";
    }
  }

  private releasePending() {
    if (this.pending) URL.revokeObjectURL(this.pending.url);
    this.pending = null;
    this.boundary = Infinity;
  }

  dispose() {
    this.stop();
    this.disposed = true;
    this.version += 1;
    clearTimeout(this.debounce);
    cancelAnimationFrame(this.animation);
    this.audio.removeEventListener("playing", this.onPlaying);
    this.audio.removeEventListener("pause", this.onPause);
    this.audio.removeEventListener("ended", this.onEnded);
    this.audio.removeEventListener("error", this.onError);
    document.removeEventListener("visibilitychange", this.onVisibility);
    window.removeEventListener("pagehide", this.onPageHide);
    this.audio.removeAttribute("src");
    this.audio.load();
    if (this.current) URL.revokeObjectURL(this.current.url);
    this.releasePending();
    this.cache.clear();
    for (const action of this.mediaActions) navigator.mediaSession.setActionHandler(action, null);
    if (this.mediaActions.length) {
      navigator.mediaSession.metadata = null;
      navigator.mediaSession.playbackState = "none";
    }
  }
}

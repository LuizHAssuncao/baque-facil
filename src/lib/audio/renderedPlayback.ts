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

type Clip = RenderedRhythm & { key: string };
type Voice = {
  clip: Clip;
  source: AudioBufferSourceNode;
  gain: GainNode;
  when: number;
  offset: number;
};
type Transition = { voice: Voice; at: number; end: number };
const SCHEDULE_AHEAD = 0.03;
const CROSSFADE = 0.005;

/** Native audio nodes own repetition and scheduled changes; RAF only updates the UI/cleanup. */
export class RenderedPlayback {
  private cache = new SampleCache();
  private context: AudioContext | null = null;
  private current: Clip | null = null;
  private voice: Voice | null = null;
  private transition: Transition | null = null;
  private pending: Clip | null = null;
  private offset = 0;
  private desired: { request: RenderRequest; key: string; version: number } | null = null;
  private version = 0;
  private rendering = false;
  private disposed = false;
  private wantsPlayback = false;
  private playAttempt = 0;
  private debounce: ReturnType<typeof setTimeout> | undefined;
  private animation = 0;
  private snapshot = { ...INITIAL_PLAYBACK };
  private mediaActions: MediaSessionAction[] = [];
  private audioSession: { type: string } | undefined;
  private originalSessionType: string | undefined;

  constructor(
    private title: string,
    private onChange: (snapshot: PlaybackSnapshot) => void,
  ) {
    document.addEventListener("visibilitychange", this.onVisibility);
    window.addEventListener("pagehide", this.stop);
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
    this.cancelTransition();
    this.pending = null;
    this.emit({ error: null, pending: false, preparing: key !== this.current?.key });
    if (key !== this.current?.key) {
      this.debounce = setTimeout(() => void this.prepare(), this.current ? 200 : 0);
    }
  }

  private async prepare() {
    if (this.rendering || this.disposed || !this.desired || this.desired.key === this.current?.key) return;
    const desired = this.desired;
    this.rendering = true;
    try {
      const rendered = await renderRhythm(desired.request, this.cache);
      if (this.disposed || desired.version !== this.version) return;
      const clip: Clip = { ...rendered, key: desired.key };
      if (this.voice && this.wantsPlayback) {
        this.pending = clip;
        this.emit({ preparing: false, pending: true });
        this.schedulePending();
      } else {
        this.install(clip);
      }
    } catch (cause) {
      if (desired.version === this.version) {
        this.emit({ preparing: false, error: cause instanceof Error ? cause.message : "Unable to prepare audio. Press Play to try again." });
      }
    } finally {
      this.rendering = false;
      // Serialize renders and discard obsolete results when the slider moves quickly.
      if (!this.disposed && desired.version !== this.version) void this.prepare();
    }
  }

  private install(clip: Clip) {
    this.current = clip;
    this.pending = null;
    this.offset = 0;
    this.emit({ ready: true, preparing: false, pending: false, activeStep: null, playingTempo: clip.tempo, error: null });
  }

  private createVoice(clip: Clip, when: number, offset = 0, volume = 1): Voice {
    const context = this.context!;
    const source = context.createBufferSource();
    const gain = context.createGain();
    const voice = { clip, source, gain, when, offset };
    source.buffer = clip.buffer;
    source.loop = clip.loop;
    source.loopEnd = clip.cycleDuration;
    // Tempo is baked into the buffer, so drum samples always retain their pitch.
    source.playbackRate.value = 1;
    gain.gain.value = volume;
    source.connect(gain);
    gain.connect(context.destination);
    source.onended = () => this.onEnded(voice);
    try {
      source.start(when, offset);
    } catch (error) {
      this.releaseVoice(voice);
      throw error;
    }
    return voice;
  }

  private releaseVoice(voice: Voice | null) {
    if (!voice) return;
    voice.source.onended = null;
    try { voice.source.stop(); } catch { /* A failed start may leave an unstarted node. */ }
    voice.source.disconnect();
    voice.gain.disconnect();
  }

  private finishTransition() {
    if (!this.transition) return;
    this.releaseVoice(this.voice);
    this.voice = this.transition.voice;
    this.current = this.voice.clip;
    this.transition = null;
    this.emit({ pending: false, playingTempo: this.current.tempo });
  }

  private syncTransition() {
    if (this.transition && this.context!.currentTime >= this.transition.end) this.finishTransition();
  }

  private cancelTransition() {
    if (!this.transition || !this.context) return;
    const now = this.context.currentTime;
    if (now >= this.transition.at) {
      // The new bar is already audible. Finish its short fade before handling another edit.
      const gain = this.transition.voice.gain.gain;
      gain.cancelScheduledValues(now);
      gain.setValueAtTime(1, now);
      this.finishTransition();
    } else {
      this.releaseVoice(this.transition.voice);
      this.transition = null;
      this.voice!.gain.gain.cancelScheduledValues(now);
      this.voice!.gain.gain.setValueAtTime(1, now);
    }
  }

  private schedulePending() {
    this.syncTransition();
    if (!this.pending || this.transition || !this.voice || !this.wantsPlayback ||
      this.context?.state !== "running" || document.hidden) return;
    const current = this.voice;
    const now = this.context.currentTime;
    const origin = current.when - current.offset;
    const duration = current.clip.cycleDuration;
    let at = origin + (Math.floor((now + SCHEDULE_AHEAD - origin) / duration) + 1) * duration;
    if (!current.clip.loop) {
      at = Math.max(now + SCHEDULE_AHEAD, origin + duration);
      // If the one-shot is almost over, leave the new clip ready for the next Play tap.
      if (at + CROSSFADE >= origin + current.clip.buffer.duration) return;
    }
    const next = this.pending;
    this.pending = null;
    try {
      const voice = this.createVoice(next, at, 0, 0);
      voice.gain.gain.setValueAtTime(0, at);
      voice.gain.gain.linearRampToValueAtTime(1, at + CROSSFADE);
      current.gain.gain.setValueAtTime(1, at);
      current.gain.gain.linearRampToValueAtTime(0, at + CROSSFADE);
      // Keep the old source muted until cleanup, so a later edit can cancel this change.
      // Even with JS suspended, the new source starts and loops at the scheduled audio time.
      this.transition = { voice, at, end: at + CROSSFADE };
    } catch {
      this.emit({ pending: false, error: "Unable to apply the audio change. Tap Stop, then Play to try again." });
    }
  }

  play = () => {
    if (this.disposed || (this.wantsPlayback && this.context?.state === "running" && this.voice)) return;
    this.syncTransition();
    if (this.pending) {
      this.releaseVoice(this.voice);
      this.voice = null;
      this.install(this.pending);
    }
    if (!this.current) {
      this.emit({ error: null, preparing: true });
      void this.prepare();
      return;
    }
    const attempt = ++this.playAttempt;
    try {
      // Request the same session category as the iPhone-tested diagnostic, before resuming.
      try {
        this.audioSession = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
        if (this.audioSession) {
          this.originalSessionType ??= this.audioSession.type;
          this.audioSession.type = "playback";
        }
      } catch { /* Optional API; Web Audio is still usable in other browsers. */ }
      if (!this.context || this.context.state === "closed") {
        this.releaseVoice(this.voice);
        this.voice = null;
        this.context?.removeEventListener("statechange", this.onStateChange);
        this.context = new AudioContext();
        this.context.addEventListener("statechange", this.onStateChange);
      }
      this.wantsPlayback = true;
      if (!this.voice) this.voice = this.createVoice(this.current, this.context.currentTime, this.offset);
      this.configureMediaSession();
      this.emit({ error: null });
      // Called synchronously from the Play tap; rendering has already finished.
      void this.context.resume().then(() => {
        if (this.disposed || attempt !== this.playAttempt) return;
        this.onStateChange();
        this.schedulePending();
      }).catch(() => {
        if (this.disposed || attempt !== this.playAttempt) return;
        this.pause();
        this.emit({ error: "Playback was interrupted. Tap Play to try again." });
      });
      this.onStateChange();
    } catch {
      this.pause();
      this.emit({ error: "Unable to start audio. Tap Play to try again." });
    }
    if (this.desired?.key !== this.current.key && !this.rendering && !this.pending && !this.transition) {
      this.emit({ preparing: true });
      void this.prepare();
    }
  };

  pause = () => {
    this.syncTransition();
    const replacement = this.pending ?? this.transition?.voice.clip;
    this.cancelTransition();
    if (this.voice && this.context) {
      const time = Math.max(0, this.context.currentTime - this.voice.when + this.voice.offset);
      this.offset = this.voice.clip.loop ? time % this.voice.clip.cycleDuration : time;
      if (this.offset >= this.voice.clip.buffer.duration) this.offset = 0;
    }
    this.wantsPlayback = false;
    this.playAttempt += 1;
    this.releaseVoice(this.voice);
    this.voice = null;
    if (replacement) this.install(replacement);
    if (this.context && this.context.state !== "closed") void this.context.suspend().catch(() => {});
    if (this.audioSession && this.originalSessionType !== undefined) {
      try { this.audioSession.type = this.originalSessionType; } catch { /* Optional API. */ }
    }
    this.emit({ playing: false, activeStep: null });
    this.updateMediaState();
  };

  stop = () => {
    this.pause();
    this.offset = 0;
  };

  restart = () => {
    this.stop();
    this.play();
  };

  private onEnded(voice: Voice) {
    this.syncTransition();
    if (this.voice !== voice || this.disposed) return;
    this.stop();
  }

  private onStateChange = () => {
    if (this.disposed) return;
    const playing = this.wantsPlayback && this.voice !== null && this.context?.state === "running";
    const interrupted = this.snapshot.playing && this.wantsPlayback && !playing;
    this.emit({
      playing,
      ...(!playing ? { activeStep: null } : {}),
      ...(interrupted ? { error: "Playback was interrupted. Tap Play to resume." } : playing ? { error: null } : {}),
    });
    if (playing) this.schedulePending();
    this.updateMediaState();
  };

  private onVisibility = () => {
    if (!document.hidden) {
      this.syncTransition();
      this.schedulePending();
      // Do not resume a suspended context without a user gesture.
      this.onStateChange();
    }
  };

  private tick = () => {
    if (this.disposed) return;
    if (!document.hidden) {
      this.syncTransition();
      if (this.voice && this.wantsPlayback && this.context?.state === "running") {
        const voice = this.transition && this.context.currentTime >= this.transition.at ? this.transition.voice : this.voice;
        const time = Math.max(0, this.context.currentTime - voice.when + voice.offset);
        const { cycleDuration, stepCount, loop } = voice.clip;
        const activeStep = !loop && time >= cycleDuration ? null : Math.min(stepCount - 1, Math.floor((time % cycleDuration) / cycleDuration * stepCount));
        this.emit({ activeStep });
      }
    }
    this.animation = requestAnimationFrame(this.tick);
  };

  private configureMediaSession() {
    if (!("mediaSession" in navigator)) return;
    try {
      if (typeof MediaMetadata !== "undefined") {
        navigator.mediaSession.metadata = new MediaMetadata({ title: this.title, artist: "Baque Fácil" });
      }
      const handlers: [MediaSessionAction, () => void][] = [["play", this.play], ["pause", this.pause], ["stop", this.stop]];
      for (const [action, handler] of handlers) {
        try {
          navigator.mediaSession.setActionHandler(action, handler);
          if (!this.mediaActions.includes(action)) this.mediaActions.push(action);
        } catch { /* Not all browsers expose all media controls. */ }
      }
    } catch { /* Lock-screen metadata must not prevent playback. */ }
  }

  private updateMediaState() {
    if (this.mediaActions.length) {
      try { navigator.mediaSession.playbackState = this.snapshot.playing ? "playing" : "paused"; } catch { /* Optional API. */ }
    }
  }

  dispose() {
    this.stop();
    this.disposed = true;
    this.version += 1;
    clearTimeout(this.debounce);
    cancelAnimationFrame(this.animation);
    document.removeEventListener("visibilitychange", this.onVisibility);
    window.removeEventListener("pagehide", this.stop);
    this.context?.removeEventListener("statechange", this.onStateChange);
    if (this.context && this.context.state !== "closed") void this.context.close().catch(() => {});
    this.context = null;
    this.current = null;
    this.pending = null;
    this.cache.clear();
    for (const action of this.mediaActions) {
      try { navigator.mediaSession.setActionHandler(action, null); } catch { /* Optional API. */ }
    }
    if (this.mediaActions.length) {
      try {
        navigator.mediaSession.metadata = null;
        navigator.mediaSession.playbackState = "none";
      } catch { /* Optional API. */ }
    }
  }
}

import { errorMessage, translate, type Message } from "../i18n/messages";
import { getLocale } from "../i18n/preference";
import type { SampleMap } from "../sampleMap";
import { generateMix } from "./generateMix";
import {
  buildRadioTimeline,
  radioPosition,
  RADIO_SAMPLE_RATE,
  type RadioEntry,
  type RadioSettings,
  type RadioTimeline,
} from "./timeline";

type Recording = {
  url: string;
  timeline: RadioTimeline;
  bytes: number;
  settings: RadioSettings;
};
export type RadioSnapshot = {
  ready: boolean;
  canSkip: boolean;
  playing: boolean;
  preparing: "mix" | "hold" | null;
  progress: number;
  held: boolean;
  slug: string | null;
  activeStep: number | null;
  repetition: number;
  repetitions: number;
  tempo: number;
  seconds: number;
  duration: number;
  bytes: number;
  settingsKey: string | null;
  error: Message | null;
};
export const INITIAL_RADIO: RadioSnapshot = {
  ready: false,
  canSkip: false,
  playing: false,
  preparing: null,
  progress: 0,
  held: false,
  slug: null,
  activeStep: null,
  repetition: 1,
  repetitions: 8,
  tempo: 90,
  seconds: 0,
  duration: 0,
  bytes: 0,
  settingsKey: null,
  error: null,
};

export function radioSettingsKey(settings: RadioSettings) {
  return JSON.stringify({ ...settings, slugs: [...settings.slugs].sort() });
}

/** All automatic rhythm changes and file looping belong to the native media player. */
export class RadioPlayback {
  private mix: Recording | null = null;
  private hold: Recording | null = null;
  private returnTime = 0;
  private generation: AbortController | null = null;
  private version = 0;
  private wantsPlayback = false;
  private switching = false;
  private pendingSeek = 0;
  private playAttempt = 0;
  private animation = 0;
  private disposed = false;
  private snapshot = { ...INITIAL_RADIO };
  private mediaActions: MediaSessionAction[] = [];
  private metadataKey: string | null = null;

  constructor(
    private audio: HTMLAudioElement,
    private entries: RadioEntry[],
    private samples: SampleMap,
    private onChange: (state: RadioSnapshot) => void,
  ) {
    audio.preload = "auto";
    audio.loop = true;
    audio.addEventListener("playing", this.onPlaying);
    audio.addEventListener("pause", this.onPause);
    audio.addEventListener("loadedmetadata", this.onMetadata);
    audio.addEventListener("timeupdate", this.refresh);
    audio.addEventListener("error", this.onError);
    document.addEventListener("visibilitychange", this.onVisibility);
    window.addEventListener("pagehide", this.onPageHide);
    this.tick();
  }

  private get current() {
    return this.hold ?? this.mix;
  }

  private emit(change: Partial<RadioSnapshot>) {
    if (this.disposed) return;
    const next = { ...this.snapshot, ...change };
    if (
      Object.keys(next).every(
        (key) =>
          next[key as keyof RadioSnapshot] ===
          this.snapshot[key as keyof RadioSnapshot],
      )
    )
      return;
    this.snapshot = next;
    this.onChange(next);
  }

  prepare = async (settings: RadioSettings) => {
    this.cancelPreparation();
    this.wantsPlayback = this.mix ? !this.audio.paused : true;
    const controller = new AbortController();
    this.generation = controller;
    const version = ++this.version;
    this.emit({ preparing: "mix", progress: 0, error: null });
    try {
      const rhythms = this.entries
        .filter((entry) => settings.slugs.includes(entry.rhythm.slug))
        .map((entry) => entry.rhythm);
      const previous =
        this.snapshot.slug ?? this.mix?.timeline.segments[0].slug;
      const timeline = buildRadioTimeline(
        rhythms,
        settings.tempo,
        settings.repetitions,
        settings.minutes * 60,
        Math.random,
        previous,
      );
      const blob = await generateMix(
        timeline,
        rhythms,
        this.samples,
        controller.signal,
        (progress) => {
          if (version === this.version)
            this.emit({ progress: Math.round(progress * 100) });
        },
      );
      if (
        this.disposed ||
        controller.signal.aborted ||
        version !== this.version
      )
        return;
      const oldMix = this.mix;
      const oldHold = this.hold;
      this.mix = {
        url: URL.createObjectURL(blob),
        timeline,
        bytes: blob.size,
        settings: { ...settings, slugs: [...settings.slugs] },
      };
      this.hold = null;
      this.generation = null;
      this.install(this.mix, 0, this.wantsPlayback);
      if (oldMix) URL.revokeObjectURL(oldMix.url);
      if (oldHold) URL.revokeObjectURL(oldHold.url);
    } catch (cause) {
      if (
        version === this.version &&
        !controller.signal.aborted &&
        !this.disposed
      ) {
        this.generation = null;
        this.emit({
          preparing: null,
          error:
            errorMessage(cause, "Unable to prepare radio. Please try again."),
        });
      }
    }
  };

  cancelPreparation = () => {
    this.version += 1;
    this.generation?.abort();
    this.generation = null;
    this.emit({ preparing: null, progress: 0 });
  };

  toggleHold = async () => {
    if (!this.mix) return;
    if (this.hold) {
      const oldHold = this.hold;
      this.hold = null;
      this.install(this.mix, this.returnTime, !this.audio.paused);
      URL.revokeObjectURL(oldHold.url);
      return;
    }
    this.cancelPreparation();
    const position = radioPosition(this.mix.timeline, this.audio.currentTime);
    const rhythm = this.entries.find(
      (entry) => entry.rhythm.slug === position.segment.slug,
    )!.rhythm;
    this.returnTime =
      (this.mix.timeline.segments[position.index + 1]?.startFrame ?? 0) /
      RADIO_SAMPLE_RATE;
    const controller = new AbortController();
    this.generation = controller;
    const version = ++this.version;
    this.wantsPlayback = !this.audio.paused;
    this.emit({ preparing: "hold", progress: 0, error: null });
    try {
      const timeline = buildRadioTimeline(
        [rhythm],
        this.mix.timeline.tempo,
        1,
        24,
      );
      const blob = await generateMix(
        timeline,
        [rhythm],
        this.samples,
        controller.signal,
        (progress) => {
          if (version === this.version)
            this.emit({ progress: Math.round(progress * 100) });
        },
      );
      if (
        this.disposed ||
        controller.signal.aborted ||
        version !== this.version
      )
        return;
      this.hold = {
        url: URL.createObjectURL(blob),
        timeline,
        bytes: blob.size,
        settings: this.mix.settings,
      };
      this.generation = null;
      this.install(this.hold, 0, this.wantsPlayback);
    } catch (cause) {
      if (
        version === this.version &&
        !controller.signal.aborted &&
        !this.disposed
      ) {
        this.generation = null;
        this.emit({
          preparing: null,
          error:
            errorMessage(cause, "Unable to repeat this rhythm. Please try again."),
        });
      }
    }
  };

  private install(recording: Recording, seconds: number, resume: boolean) {
    this.switching = true;
    this.playAttempt += 1;
    this.audio.pause();
    this.pendingSeek = seconds;
    this.audio.src = recording.url;
    this.audio.loop = true;
    this.audio.load();
    this.emit({
      ready: true,
      canSkip:
        new Set(this.mix!.timeline.segments.map((segment) => segment.slug))
          .size > 1,
      playing: false,
      preparing: null,
      progress: 100,
      held: Boolean(this.hold),
      error: null,
      tempo: recording.timeline.tempo,
      bytes: this.mix!.bytes,
      duration: this.mix!.timeline.totalFrames / RADIO_SAMPLE_RATE,
      settingsKey: radioSettingsKey(this.mix!.settings),
      seconds,
    });
    this.refresh();
    if (resume) this.play();
    else {
      this.wantsPlayback = false;
      this.switching = false;
    }
  }

  play = () => {
    if (!this.current || this.disposed) return;
    this.wantsPlayback = true;
    const attempt = ++this.playAttempt;
    try {
      const audioSession = (
        navigator as Navigator & { audioSession?: { type: string } }
      ).audioSession;
      if (audioSession) audioSession.type = "playback";
    } catch {
      /* Optional routing hint. */
    }
    this.configureMediaSession();
    this.emit({ error: null });
    void this.audio
      .play()
      .then(() => {
        if (attempt !== this.playAttempt || this.disposed) return;
        this.switching = false;
        this.onPlaying();
      })
      .catch(() => {
        if (attempt !== this.playAttempt || this.disposed) return;
        this.switching = false;
        this.wantsPlayback = false;
        this.emit({
          playing: false,
          error: "Your recording is ready. Tap Play to listen.",
        });
      });
  };

  pause = () => {
    this.wantsPlayback = false;
    this.switching = false;
    this.playAttempt += 1;
    this.audio.pause();
    this.emit({ playing: false });
    this.updateMediaState();
  };

  skip = () => {
    if (
      !this.mix ||
      new Set(this.mix.timeline.segments.map((segment) => segment.slug)).size <
        2
    )
      return;
    if (this.snapshot.preparing === "hold") this.cancelPreparation();
    if (this.hold) {
      void this.toggleHold();
      return;
    }
    const { index } = radioPosition(this.mix.timeline, this.audio.currentTime);
    this.audio.currentTime =
      (this.mix.timeline.segments[index + 1]?.startFrame ?? 0) /
      RADIO_SAMPLE_RATE;
    this.refresh();
  };

  private onPlaying = () => {
    if (this.audio.paused) return;
    this.wantsPlayback = true;
    this.emit({ playing: true, error: null });
    this.updateMediaState();
    this.refresh();
  };

  private onPause = () => {
    if (!this.switching && this.audio.paused) {
      this.wantsPlayback = false;
      this.emit({ playing: false });
      this.updateMediaState();
    }
  };

  private onMetadata = () => {
    if (this.pendingSeek) this.audio.currentTime = this.pendingSeek;
    this.pendingSeek = 0;
    this.refresh();
  };

  private onError = () => {
    if (this.audio.error) {
      this.pause();
      this.emit({
        error:
          "This recording could not play. Try Shuffle again to prepare a new one.",
      });
    }
  };

  private onPageHide = () => {
    this.pause();
    this.cancelPreparation();
  };

  private onVisibility = () => {
    cancelAnimationFrame(this.animation);
    if (!document.hidden) this.tick();
  };

  private tick = () => {
    if (this.disposed || document.hidden) return;
    this.refresh();
    this.animation = requestAnimationFrame(this.tick);
  };

  private refresh = () => {
    const recording = this.current;
    if (!recording || this.disposed || document.hidden) return;
    const seconds = this.pendingSeek || this.audio.currentTime;
    const position = radioPosition(recording.timeline, seconds);
    this.emit({
      slug: position.segment.slug,
      activeStep: position.activeStep,
      repetition: position.repetition,
      repetitions: position.segment.repetitions,
      seconds: Math.floor(seconds),
      playing: !this.audio.paused,
    });
    const locale = getLocale();
    const metadataKey = `${locale}:${position.segment.slug}`;
    if (
      this.mediaActions.length &&
      this.metadataKey !== metadataKey
    ) {
      this.metadataKey = metadataKey;
      const title =
        this.entries.find(
          (entry) => entry.rhythm.slug === position.segment.slug,
        )?.rhythm.title ?? translate(locale, "Baque Radio");
      navigator.mediaSession.metadata = new MediaMetadata({
        title,
        artist: "Baque Fácil",
        album: translate(locale, "Baque Radio"),
      });
    }
  };

  private configureMediaSession() {
    if (!("mediaSession" in navigator)) return;
    const handlers: [MediaSessionAction, () => void][] = [
      ["play", this.play],
      ["pause", this.pause],
      ["stop", this.pause],
      ["nexttrack", this.skip],
    ];
    for (const [action, handler] of handlers) {
      try {
        navigator.mediaSession.setActionHandler(action, handler);
        if (!this.mediaActions.includes(action)) this.mediaActions.push(action);
      } catch {
        /* Optional media actions differ across browsers. */
      }
    }
    this.metadataKey = null;
    this.refresh();
  }

  private updateMediaState() {
    if (this.mediaActions.length)
      navigator.mediaSession.playbackState = this.audio.paused
        ? "paused"
        : "playing";
  }

  dispose() {
    this.disposed = true;
    this.pause();
    this.cancelPreparation();
    cancelAnimationFrame(this.animation);
    this.audio.removeEventListener("playing", this.onPlaying);
    this.audio.removeEventListener("pause", this.onPause);
    this.audio.removeEventListener("loadedmetadata", this.onMetadata);
    this.audio.removeEventListener("timeupdate", this.refresh);
    this.audio.removeEventListener("error", this.onError);
    document.removeEventListener("visibilitychange", this.onVisibility);
    window.removeEventListener("pagehide", this.onPageHide);
    this.audio.removeAttribute("src");
    this.audio.load();
    if (this.mix) URL.revokeObjectURL(this.mix.url);
    if (this.hold) URL.revokeObjectURL(this.hold.url);
    this.mix = null;
    this.hold = null;
    for (const action of this.mediaActions)
      navigator.mediaSession.setActionHandler(action, null);
    if (this.mediaActions.length) {
      navigator.mediaSession.metadata = null;
      navigator.mediaSession.playbackState = "none";
    }
  }
}

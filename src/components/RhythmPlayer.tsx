import { useTranslation } from "../lib/i18n/useTranslation";
import { errorMessage, TranslatableError, type Message } from "../lib/i18n/messages";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ForwardedRef,
} from "react";
import {
  ClipboardCopy,
  Keyboard,
  Pencil,
  Play,
  Repeat,
  RepeatOff,
  RotateCcw,
  Square,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { countLabels, stepsPerBeat as getStepsPerBeat } from "../lib/countLabels";
import {
  HAND_SYMBOL_REVERSE_EVENT,
  HAND_SYMBOL_REVERSE_STORAGE_KEY,
  displayHandSymbol,
  readHandSymbolReversePreference,
  type HandSymbolReverseEventDetail,
} from "../lib/handPreference";
import {
  blurPointerActivatedButton,
  shouldIgnoreKeyboardShortcut,
} from "../lib/keyboardShortcuts";
import { formatRhythmBlock } from "../lib/formatRhythmBlock";
import { rhythmGridColumns, rhythmGridMinWidth } from "../lib/rhythmGridLayout";
import { MAX_TEMPO, MIN_TEMPO, clampTempo } from "../lib/tempo";
import type { Rhythm, RhythmTrack } from "../lib/rhythmTypes";
import { useRenderedPlayback } from "../lib/audio/useRenderedPlayback";

type ToneModule = typeof import("tone");

type RhythmPlayerProps = {
  rhythm: Rhythm;
  samples: Record<string, string>;
  autoPlay?: boolean;
  playbackMode?: "live" | "rendered";
  editableNotes?: boolean;
  customizeHref?: string;
  enableKeyboardShortcuts?: boolean;
  patternBaseline?: RhythmTrack[];
  patternDirty?: boolean;
  onPatternChange?: (tracks: RhythmTrack[]) => void;
  onPatternReset?: () => void;
  onTempoChange?: (tempo: number) => void;
};

export type RhythmPlayerHandle = {
  toggleLoop: () => void;
  togglePlayback: () => void;
};

const AUTOPLAY_START_TIMEOUT_MS = 400;
const IOS_SILENT_MODE_HELP_KEY = "baque-facil-ios-silent-mode-help-seen";
const IOS_AUDIO_HELP_PATH = "/help/ios-audio/";
const PLAYHEAD_SCROLL_MARGIN_PX = 24;
const PLAYHEAD_RIGHT_LIMIT_RATIO = 0.55;
const PLAYHEAD_TARGET_RATIO = 0.35;
const TEMPO_KEYBOARD_STEP = 1;
const TRACK_COLUMN_MIN_REM = 8;
const TRACK_COLUMN_MAX_REM = 9;
const COPY_FEEDBACK_TIMEOUT_MS = 2_000;

const NOTE_CYCLES: Record<string, string[]> = {
  Alfaia: ["L", "R", "B", "."],
  Caixa: ["X", "."],
  Gongue: ["X", "."],
};

function cloneTracks(tracks: RhythmTrack[]) {
  return tracks.map((track) => ({
    ...track,
    steps: [...track.steps],
  }));
}

function tracksEqual(leftTracks: RhythmTrack[], rightTracks: RhythmTrack[]) {
  if (leftTracks.length !== rightTracks.length) {
    return false;
  }

  return leftTracks.every((leftTrack, trackIndex) => {
    const rightTrack = rightTracks[trackIndex];

    return (
      rightTrack !== undefined &&
      leftTrack.name === rightTrack.name &&
      leftTrack.steps.length === rightTrack.steps.length &&
      leftTrack.steps.every((symbol, stepIndex) => symbol === rightTrack.steps[stepIndex])
    );
  });
}

function nextEditableSymbol(trackName: string, symbol: string) {
  if (trackName === "Gongue" && symbol === "x") {
    return ".";
  }

  const cycle = NOTE_CYCLES[trackName];
  const symbolIndex = cycle?.indexOf(symbol) ?? -1;

  if (!cycle || symbolIndex === -1) {
    return null;
  }

  return cycle[(symbolIndex + 1) % cycle.length];
}

function hasEditableSymbol(trackName: string, symbol: string) {
  return nextEditableSymbol(trackName, symbol) !== null;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: Message) {
  let timeoutId: number | undefined;

  const timeout = new Promise<never>((_, reject) => {
    timeoutId = window.setTimeout(() => reject(new TranslatableError(message)), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timeoutId !== undefined) {
      window.clearTimeout(timeoutId);
    }
  }
}

function isIosDevice() {
  const userAgent = navigator.userAgent;
  const isTouchMac = navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;

  return /iPad|iPhone|iPod/.test(userAgent) || isTouchMac;
}

function hasSeenIosSilentModeHelp() {
  try {
    return window.localStorage.getItem(IOS_SILENT_MODE_HELP_KEY) === "true";
  } catch {
    return false;
  }
}

function markIosSilentModeHelpSeen() {
  try {
    window.localStorage.setItem(IOS_SILENT_MODE_HELP_KEY, "true");
  } catch {
    // Browsers can disable storage in private modes. The modal still dismisses for this session.
  }
}

function scrollPlayheadIntoView(
  container: HTMLDivElement,
  cell: HTMLDivElement,
  hasFutureSteps: boolean,
) {
  const containerRect = container.getBoundingClientRect();
  const cellRect = cell.getBoundingClientRect();
  const stickyColumnWidth =
    cell.parentElement?.querySelector<HTMLElement>(".track-name")?.offsetWidth ?? 0;
  const visibleLeft = containerRect.left + stickyColumnWidth;
  const visibleRight = containerRect.right;
  const visibleWidth = visibleRight - visibleLeft;
  const maxScrollLeft = Math.max(0, container.scrollWidth - container.clientWidth);

  if (cellRect.left < visibleLeft + PLAYHEAD_SCROLL_MARGIN_PX) {
    container.scrollLeft = Math.max(
      0,
      container.scrollLeft + cellRect.left - visibleLeft - PLAYHEAD_SCROLL_MARGIN_PX,
    );
    return;
  }

  if (hasFutureSteps && visibleWidth > 0 && container.scrollLeft < maxScrollLeft) {
    const rightLimit = visibleLeft + visibleWidth * PLAYHEAD_RIGHT_LIMIT_RATIO;

    if (cellRect.right > rightLimit) {
      const targetLeft = visibleLeft + visibleWidth * PLAYHEAD_TARGET_RATIO;

      container.scrollLeft = Math.min(
        maxScrollLeft,
        Math.max(0, container.scrollLeft + cellRect.left - targetLeft),
      );
      return;
    }
  }

  if (cellRect.right > visibleRight - PLAYHEAD_SCROLL_MARGIN_PX) {
    container.scrollLeft = Math.min(
      maxScrollLeft,
      container.scrollLeft + cellRect.right - visibleRight + PLAYHEAD_SCROLL_MARGIN_PX,
    );
  }
}

function RhythmPlayer(
  {
    rhythm,
    samples,
    autoPlay = false,
    playbackMode = "live",
    editableNotes = false,
    customizeHref,
    enableKeyboardShortcuts = true,
    patternBaseline,
    patternDirty,
    onPatternChange,
    onPatternReset,
    onTempoChange,
  }: RhythmPlayerProps,
  ref: ForwardedRef<RhythmPlayerHandle>,
) {
  const { t, locale } = useTranslation();
  const isPatternControlled = onPatternChange !== undefined;
  const [localTracks, setLocalTracks] = useState(() => cloneTracks(rhythm.tracks));
  const currentTracks = isPatternControlled ? rhythm.tracks : localTracks;
  const trackNamesKey = JSON.stringify(currentTracks.map((track) => track.name));
  const defaultMutedTrackNames = useMemo<string[]>(() => [], [trackNamesKey]);
  const [tempo, setTempo] = useState(() => clampTempo(rhythm.tempo));
  const [loop, setLoop] = useState(true);
  const [toneActiveStep, setActiveStep] = useState<number | null>(null);
  const [toneIsPlaying, setIsPlaying] = useState(false);
  const [toneStatus, setStatus] = useState("idle");
  const [toneError, setError] = useState<Message | null>(null);
  const [copyFeedback, setCopyFeedback] = useState<Message | null>(null);
  const [mutedTracks, setMutedTracks] = useState<string[]>(() => defaultMutedTrackNames);
  const [isIos, setIsIos] = useState(false);
  const [showIosSilentModeHelp, setShowIosSilentModeHelp] = useState(false);
  const [showShortcutHelp, setShowShortcutHelp] = useState(false);
  const [reverseHandSymbols, setReverseHandSymbols] = useState(false);

  const toneRef = useRef<ToneModule | null>(null);
  const playersRef = useRef<Record<string, any>>({});
  const playersLoadedRef = useRef<Promise<void> | null>(null);
  const scheduledEventRef = useRef<number | null>(null);
  const tempoRef = useRef(tempo);
  const loopRef = useRef(loop);
  const mutedTracksRef = useRef(new Set(defaultMutedTrackNames));
  const hasAutoPlayedRef = useRef(false);
  const playAttemptRef = useRef(0);
  const iosSilentModeButtonRef = useRef<HTMLButtonElement | null>(null);
  const shortcutHelpTriggerRef = useRef<HTMLButtonElement | null>(null);
  const shortcutHelpCloseButtonRef = useRef<HTMLButtonElement | null>(null);
  const gridScrollRef = useRef<HTMLDivElement | null>(null);
  const countCellRefs = useRef<(HTMLDivElement | null)[]>([]);
  const currentTracksRef = useRef<RhythmTrack[]>(cloneTracks(currentTracks));
  const copyFeedbackTimeoutRef = useRef<number | null>(null);

  const stepCount = currentTracks[0]?.steps.length ?? 0;
  const stepCountRef = useRef(stepCount);
  const beatStepCount = getStepsPerBeat(rhythm.subdivision);
  const stepDuration = `${rhythm.subdivision}n` as "8n" | "16n" | "32n";
  const useRenderedAudio = playbackMode === "rendered";
  const rendered = useRenderedPlayback(useRenderedAudio, {
    rhythm,
    samples,
    tempo,
    loop,
    mutedTracks,
  });
  const activeStep = useRenderedAudio ? rendered.snapshot.activeStep : toneActiveStep;
  const isPlaying = useRenderedAudio ? rendered.snapshot.playing : toneIsPlaying;
  const status = useRenderedAudio
    ? rendered.snapshot.ready ? "ready" : rendered.snapshot.preparing ? "loading" : "idle"
    : toneStatus;
  const error = useRenderedAudio ? rendered.snapshot.error : toneError;
  const labels = useMemo(
    () => countLabels(stepCount, rhythm.subdivision),
    [rhythm.subdivision, stepCount],
  );
  const gridStyle = {
    gridTemplateColumns: rhythmGridColumns(
      TRACK_COLUMN_MIN_REM,
      TRACK_COLUMN_MAX_REM,
      stepCount,
    ),
  } as CSSProperties;
  const gridShellStyle = {
    minWidth: rhythmGridMinWidth(TRACK_COLUMN_MIN_REM, stepCount),
  } as CSSProperties;
  const resetBaselineTracks = patternBaseline ?? rhythm.tracks;
  const isPatternDirty =
    patternDirty ?? (editableNotes && !tracksEqual(currentTracks, resetBaselineTracks));

  useEffect(() => {
    if (isPatternControlled) {
      return;
    }

    const nextTracks = cloneTracks(rhythm.tracks);
    currentTracksRef.current = nextTracks;
    setLocalTracks(nextTracks);
  }, [isPatternControlled, rhythm.slug, rhythm.tracks]);

  useEffect(() => {
    currentTracksRef.current = cloneTracks(currentTracks);
  }, [currentTracks]);

  useEffect(() => {
    stepCountRef.current = stepCount;
  }, [stepCount]);

  useEffect(() => {
    setTempo(clampTempo(rhythm.tempo));
  }, [rhythm.tempo]);

  useEffect(() => {
    tempoRef.current = tempo;

    const Tone = toneRef.current;
    if (Tone) {
      Tone.Transport.bpm.rampTo(tempo, 0.05);
    }
  }, [tempo]);

  useEffect(() => {
    loopRef.current = loop;
  }, [loop]);

  useEffect(() => {
    mutedTracksRef.current = new Set(mutedTracks);
  }, [mutedTracks]);

  useEffect(() => {
    setMutedTracks(defaultMutedTrackNames);
    mutedTracksRef.current = new Set(defaultMutedTrackNames);
  }, [defaultMutedTrackNames]);

  useEffect(() => {
    const deviceIsIos = isIosDevice();
    setIsIos(deviceIsIos);

    if (!useRenderedAudio && deviceIsIos && !hasSeenIosSilentModeHelp()) {
      setShowIosSilentModeHelp(true);
    }
  }, []);

  useEffect(() => {
    setReverseHandSymbols(readHandSymbolReversePreference());

    function handleStorage(event: StorageEvent) {
      if (event.key === HAND_SYMBOL_REVERSE_STORAGE_KEY) {
        setReverseHandSymbols(readHandSymbolReversePreference());
      }
    }

    function handlePreferenceChange(event: Event) {
      const preferenceEvent = event as CustomEvent<HandSymbolReverseEventDetail>;

      setReverseHandSymbols(preferenceEvent.detail.reverseHandSymbols);
    }

    window.addEventListener("storage", handleStorage);
    window.addEventListener(HAND_SYMBOL_REVERSE_EVENT, handlePreferenceChange);

    return () => {
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener(HAND_SYMBOL_REVERSE_EVENT, handlePreferenceChange);
    };
  }, []);

  useEffect(() => {
    if (showIosSilentModeHelp) {
      iosSilentModeButtonRef.current?.focus();
    }
  }, [showIosSilentModeHelp]);

  useEffect(() => {
    if (showShortcutHelp) {
      shortcutHelpCloseButtonRef.current?.focus();
    }
  }, [showShortcutHelp]);

  useEffect(() => {
    countCellRefs.current = countCellRefs.current.slice(0, stepCount);
  }, [stepCount]);

  useImperativeHandle(ref, () => ({
    toggleLoop: () => setLoop((currentLoop) => !currentLoop),
    togglePlayback: () => {
      if (status === "loading") {
        return;
      }

      void togglePlayback();
    },
  }));

  useEffect(() => {
    if (activeStep === null) {
      return;
    }

    const container = gridScrollRef.current;
    const activeCell = countCellRefs.current[activeStep];

    if (!container || !activeCell) {
      return;
    }

    scrollPlayheadIntoView(container, activeCell, activeStep < stepCount - 1);
  }, [activeStep, stepCount]);

  useEffect(() => {
    if (useRenderedAudio || !autoPlay || hasAutoPlayedRef.current) {
      return;
    }

    hasAutoPlayedRef.current = true;
    void play({ isAutoPlay: true });
  }, [autoPlay, rhythm.slug]);

  useEffect(() => {
    if (!enableKeyboardShortcuts) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }

      if (showShortcutHelp) {
        if (event.key === "Escape") {
          event.preventDefault();
          closeShortcutHelp();
        }

        return;
      }

      if (shouldIgnoreKeyboardShortcut(event)) {
        return;
      }

      if (event.code === "Space" || event.key === " ") {
        event.preventDefault();

        if (event.repeat || status === "loading") {
          return;
        }

        void togglePlayback();
        return;
      }

      if (event.key === "Backspace") {
        event.preventDefault();

        if (event.repeat || status === "loading") {
          return;
        }

        void restart();
        return;
      }

      const key = event.key.toLowerCase();

      if (key === "l") {
        event.preventDefault();

        if (!event.repeat) {
          setLoop((currentLoop) => !currentLoop);
        }

        return;
      }

      if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        changeTempo(tempoRef.current + TEMPO_KEYBOARD_STEP);
        return;
      }

      if (event.key === "-" || event.key === "_") {
        event.preventDefault();
        changeTempo(tempoRef.current - TEMPO_KEYBOARD_STEP);
      }
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [enableKeyboardShortcuts, isPlaying, showShortcutHelp, status]);

  useEffect(() => {
    return () => {
      if (copyFeedbackTimeoutRef.current !== null) {
        window.clearTimeout(copyFeedbackTimeoutRef.current);
      }

      const Tone = toneRef.current;

      if (Tone) {
        Tone.Transport.stop();
        Tone.Transport.cancel();
      }

      Object.values(playersRef.current).forEach((player) => player.dispose?.());
    };
  }, []);

  async function ensureAudio(options: { isAutoPlay?: boolean } = {}) {
    if (!options.isAutoPlay) {
      setStatus("loading");
    }

    setError(null);
    setCopyFeedback(null);

    const Tone = toneRef.current ?? (await import("tone"));
    toneRef.current = Tone;

    const startPromise = Tone.start();
    if (options.isAutoPlay) {
      await withTimeout(
        startPromise,
        AUTOPLAY_START_TIMEOUT_MS,
        "Audio context could not start without user interaction.",
      );
    } else {
      await startPromise;
    }

    if (Tone.getContext().state !== "running") {
      throw new TranslatableError("Audio context could not start.");
    }

    const missingSamples = Object.entries(samples).filter(
      ([key]) => !playersRef.current[key],
    );

    if (missingSamples.length > 0) {
      missingSamples.forEach(([key, url]) => {
        playersRef.current[key] = new Tone.Player(url).toDestination();
      });
      playersLoadedRef.current = Tone.loaded();
    }

    if (playersLoadedRef.current) {
      await playersLoadedRef.current;
    }

    setStatus("ready");
    return Tone;
  }

  function clearTransport(Tone: ToneModule) {
    if (scheduledEventRef.current !== null) {
      Tone.Transport.clear(scheduledEventRef.current);
      scheduledEventRef.current = null;
    }

    Tone.Transport.cancel();
  }

  function toggleTrackMute(trackName: string) {
    setMutedTracks((currentTracks) => {
      const nextTracks = currentTracks.includes(trackName)
        ? currentTracks.filter((name) => name !== trackName)
        : [...currentTracks, trackName];

      mutedTracksRef.current = new Set(nextTracks);
      return nextTracks;
    });
  }

  function changeTempo(nextTempo: number) {
    const clampedTempo = clampTempo(nextTempo, tempoRef.current);

    tempoRef.current = clampedTempo;
    setTempo(clampedTempo);
    onTempoChange?.(clampedTempo);
  }

  function applyTrackEdit(nextTracks: RhythmTrack[]) {
    const clonedTracks = cloneTracks(nextTracks);

    currentTracksRef.current = clonedTracks;

    if (isPatternControlled) {
      onPatternChange?.(clonedTracks);
      return;
    }

    setLocalTracks(clonedTracks);
  }

  function cycleNote(trackIndex: number, stepIndex: number) {
    if (!editableNotes) {
      return;
    }

    const nextTracks = cloneTracks(currentTracksRef.current);
    const track = nextTracks[trackIndex];
    const symbol = track?.steps[stepIndex];

    if (!track || symbol === undefined) {
      return;
    }

    const nextSymbol = nextEditableSymbol(track.name, symbol);

    if (nextSymbol === null) {
      return;
    }

    track.steps[stepIndex] = nextSymbol;
    applyTrackEdit(nextTracks);
  }

  function resetPattern() {
    const nextTracks = cloneTracks(resetBaselineTracks);

    currentTracksRef.current = nextTracks;

    if (onPatternReset) {
      onPatternReset();
      return;
    }

    if (isPatternControlled) {
      onPatternChange?.(nextTracks);
      return;
    }

    setLocalTracks(nextTracks);
  }

  function acknowledgeIosSilentModeHelp() {
    markIosSilentModeHelpSeen();
    setShowIosSilentModeHelp(false);
  }

  function closeShortcutHelp(restoreFocus = true) {
    setShowShortcutHelp(false);
    if (restoreFocus) {
      window.setTimeout(() => shortcutHelpTriggerRef.current?.focus(), 0);
    }
  }

  function showCopyFeedback(message: Message) {
    if (copyFeedbackTimeoutRef.current !== null) {
      window.clearTimeout(copyFeedbackTimeoutRef.current);
    }

    setCopyFeedback(message);
    copyFeedbackTimeoutRef.current = window.setTimeout(() => {
      setCopyFeedback(null);
      copyFeedbackTimeoutRef.current = null;
    }, COPY_FEEDBACK_TIMEOUT_MS);
  }

  async function copyTranscription() {
    try {
      await navigator.clipboard.writeText(
        formatRhythmBlock(currentTracksRef.current, beatStepCount),
      );
      setError(null);
      showCopyFeedback("Copied transcription.");
    } catch {
      showCopyFeedback("Unable to copy transcription.");
    }
  }

  async function play(options: { isAutoPlay?: boolean } = {}) {
    if (useRenderedAudio) {
      rendered.controller.current?.play();
      return;
    }
    const attemptId = ++playAttemptRef.current;

    try {
      const Tone = await ensureAudio(options);
      let nextStep = 0;

      if (attemptId !== playAttemptRef.current) {
        return;
      }

      clearTransport(Tone);
      Tone.Transport.bpm.value = tempoRef.current;
      Tone.Transport.position = 0;

      scheduledEventRef.current = Tone.Transport.scheduleRepeat((time) => {
        const currentStepCount = stepCountRef.current;

        if (currentStepCount <= 0) {
          return;
        }

        const currentStep = nextStep % currentStepCount;

        currentTracksRef.current.forEach((track) => {
          const symbol = track.steps[currentStep];

          if (symbol === "." || mutedTracksRef.current.has(track.name)) {
            return;
          }

          playersRef.current[`${track.name}.${symbol}`]?.start(time);
        });

        Tone.Draw.schedule(() => setActiveStep(currentStep), time);
        nextStep += 1;

        if (!loopRef.current && nextStep >= currentStepCount) {
          const stopAt = time + Tone.Time(stepDuration).toSeconds();

          Tone.Transport.stop(stopAt);
          Tone.Draw.schedule(() => {
            setIsPlaying(false);
            setActiveStep(null);
          }, stopAt);
        }
      }, stepDuration);

      setIsPlaying(true);
      Tone.Transport.start("+0.05");
    } catch (cause) {
      if (attemptId !== playAttemptRef.current) {
        return;
      }

      setIsPlaying(false);
      setActiveStep(null);

      if (options.isAutoPlay) {
        setStatus("idle");
        setError(null);
        return;
      }

      setStatus("error");
      setError(errorMessage(cause, "Playback failed."));
    }
  }

  function stop() {
    if (useRenderedAudio) {
      rendered.controller.current?.stop();
      return;
    }
    playAttemptRef.current += 1;

    const Tone = toneRef.current;

    if (Tone) {
      Tone.Transport.stop();
      clearTransport(Tone);
    }

    setIsPlaying(false);
    setActiveStep(null);
  }

  async function restart() {
    stop();
    await play();
  }

  async function togglePlayback() {
    if (isPlaying) {
      stop();
      return;
    }

    await play();
  }

  return (
    <section
      className="player-panel"
      data-rendered-locale={locale}
      aria-label={t("{title} player", { title: rhythm.title })}
      onClickCapture={(event) => blurPointerActivatedButton(event.target, event.detail)}
    >
      {showIosSilentModeHelp ? (
        <div className="audio-help-backdrop">
          <div
            className="audio-help-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby={`${rhythm.slug}-ios-silent-mode-title`}
            aria-describedby={`${rhythm.slug}-ios-silent-mode-description`}
          >
            <p className="eyebrow">{t("iOS audio")}</p>
            <h2 id={`${rhythm.slug}-ios-silent-mode-title`}>{t("Make sure Silent Mode is off")}</h2>
            <p id={`${rhythm.slug}-ios-silent-mode-description`}>{t("On iPhone and iPad, Silent Mode can prevent browser audio from playing. Turn Silent Mode off, raise the volume, then press Play.")}</p>
            <div className="audio-help-actions">
              <a href={IOS_AUDIO_HELP_PATH} onClick={acknowledgeIosSilentModeHelp}>{t("Troubleshooting steps")}</a>
              <button
                type="button"
                ref={iosSilentModeButtonRef}
                onClick={acknowledgeIosSilentModeHelp}
              >{t("Got it")}</button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="controls">
        <button
          type="button"
          onClick={togglePlayback}
          disabled={status === "loading"}
          aria-label={t(isPlaying ? "Stop" : "Play")}
          title={t(isPlaying ? "Stop" : "Play")}
        >
          {isPlaying ? (
            <Square aria-hidden="true" size={18} />
          ) : (
            <Play aria-hidden="true" size={18} />
          )}
          {t(isPlaying ? "Stop" : "Play")}
        </button>
        <button
          type="button"
          onClick={restart}
          disabled={status === "loading"}
          aria-label={t("Restart")}
          title={t("Restart")}
        >
          <RotateCcw aria-hidden="true" size={18} />{t("Restart")}</button>
        {isPatternDirty ? (
          <button
            type="button"
            className="reset-pattern-button"
            onClick={resetPattern}
            aria-label={t("Reset pattern")}
            title={t("Reset pattern")}
          >
            <RotateCcw aria-hidden="true" size={16} />{t("Reset")}</button>
        ) : null}
        <button
          type="button"
          className="loop-toggle"
          aria-pressed={loop}
          aria-label={t(loop ? "Disable loop" : "Enable loop")}
          title={t(loop ? "Loop on" : "Loop off")}
          onClick={() => setLoop((currentLoop) => !currentLoop)}
        >
          {loop ? (
            <Repeat aria-hidden="true" size={18} />
          ) : (
            <RepeatOff aria-hidden="true" size={18} />
          )}
          {t("Loop")}
        </button>
        <label className="tempo-control">
          <span>{t("Tempo")}</span>
          <input
            type="range"
            min={MIN_TEMPO}
            max={MAX_TEMPO}
            value={tempo}
            suppressHydrationWarning
            onChange={(event) => changeTempo(Number(event.target.value))}
          />
          <output>{tempo} BPM</output>
        </label>
      </div>

      <div className="grid-scroll" aria-label={t("Parsed rhythm grid")} ref={gridScrollRef}>
        <div className="rhythm-grid" style={gridShellStyle}>
          <div className="grid-row count-row" style={gridStyle}>
            <div className="track-name">{t("Count")}</div>
            {labels.map((label, index) => (
              <div
                className={`step-cell count-cell ${activeStep === index ? "active" : ""}`}
                key={`${label}-${index}`}
                ref={(element) => {
                  countCellRefs.current[index] = element;
                }}
              >
                {label}
              </div>
            ))}
          </div>

          {currentTracks.map((track, trackIndex) => {
            const isMuted = mutedTracks.includes(track.name);

            return (
              <div
                className={`grid-row ${isMuted ? "muted-row" : ""}`}
                style={gridStyle}
                key={track.name}
              >
                <div className="track-name">
                  <span className="track-name-action">
                    <span className="track-label">{track.name}</span>
                    <button
                      type="button"
                      className="track-mute-button"
                      aria-pressed={isMuted}
                      aria-label={t(isMuted ? "Unmute {track}" : "Mute {track}", { track: track.name })}
                      title={t(isMuted ? "Unmute {track}" : "Mute {track}", { track: track.name })}
                      onClick={() => toggleTrackMute(track.name)}
                    >
                      {isMuted ? (
                        <VolumeX aria-hidden="true" size={16} />
                      ) : (
                        <Volume2 aria-hidden="true" size={16} />
                      )}
                    </button>
                  </span>
                </div>
                {track.steps.map((symbol, index) => {
                  const cellClassName = `step-cell ${
                    symbol === "." ? "rest-cell" : "hit-cell"
                  } ${activeStep === index ? "active" : ""} ${
                    index % beatStepCount === 0 ? "beat-start" : ""
                  }`;
                  const displayedSymbol = displayHandSymbol(symbol, reverseHandSymbols);
                  const canEditCell = editableNotes && hasEditableSymbol(track.name, symbol);

                  return canEditCell ? (
                    <button
                      type="button"
                      className={cellClassName}
                      aria-label={t("{track} step {step}: {symbol}", { track: track.name, step: index + 1, symbol: displayedSymbol })}
                      title={t("{track} step {step}: {symbol}", { track: track.name, step: index + 1, symbol: displayedSymbol })}
                      onClick={() => cycleNote(trackIndex, index)}
                      key={`${track.name}-${index}`}
                    >
                      {displayedSymbol}
                    </button>
                  ) : (
                    <div className={cellClassName} key={`${track.name}-${index}`}>
                      {displayedSymbol}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>

      <div className="player-secondary-actions">
        {customizeHref ? (
          <a className="customize-rhythm-button" href={customizeHref}>
            <Pencil aria-hidden="true" size={14} />{t("Customize")}</a>
        ) : null}
        <button
          type="button"
          className="copy-transcription-button"
          onClick={copyTranscription}
          aria-label={t("Copy transcription")}
          title={t("Copy transcription")}
        >
          <ClipboardCopy aria-hidden="true" size={14} />{t("Copy")}</button>
        <div
          className="player-status"
          data-tone={error ? "error" : copyFeedback ? "success" : "idle"}
          aria-live="polite"
        >
          {copyFeedback ? t(copyFeedback) : error ? t(error) : null}
        </div>
      </div>

      {isIos ? (
        <p className="ios-audio-help-link">
          {t("Still no sound on iPhone or iPad?")}{" "}
          <a href={IOS_AUDIO_HELP_PATH}>{t("Try iOS audio troubleshooting")}</a>.
        </p>
      ) : null}

      {enableKeyboardShortcuts ? (
        <>
          <button
            type="button"
            className="shortcut-help-trigger"
            aria-haspopup="dialog"
            aria-expanded={showShortcutHelp}
            aria-controls={`${rhythm.slug}-shortcut-help`}
            ref={shortcutHelpTriggerRef}
            onClick={() => setShowShortcutHelp(true)}
          >
            <Keyboard aria-hidden="true" size={15} />{t("Shortcuts")}</button>

          {showShortcutHelp ? (
            <div
              className="shortcut-help-backdrop"
              onClick={(event) => closeShortcutHelp(event.detail === 0)}
            >
              <div
                className="shortcut-help-modal"
                role="dialog"
                aria-modal="true"
                aria-labelledby={`${rhythm.slug}-shortcut-help-title`}
                id={`${rhythm.slug}-shortcut-help`}
                onClick={(event) => event.stopPropagation()}
              >
                <div className="shortcut-help-header">
                  <h2 id={`${rhythm.slug}-shortcut-help-title`}>{t("Keyboard shortcuts")}</h2>
                  <button
                    type="button"
                    aria-label={t("Close keyboard shortcuts")}
                    ref={shortcutHelpCloseButtonRef}
                    onClick={(event) => closeShortcutHelp(event.detail === 0)}
                  >
                    <X aria-hidden="true" size={18} />
                  </button>
                </div>

                <dl className="shortcut-list">
                  <div>
                    <dt>
                      <kbd>{t("Space")}</kbd>
                    </dt>
                    <dd>{t("Play or stop")}</dd>
                  </div>
                  <div>
                    <dt>
                      <kbd>{t("Backspace")}</kbd>
                    </dt>
                    <dd>{t("Restart")}</dd>
                  </div>
                  <div>
                    <dt>
                      <kbd>L</kbd>
                    </dt>
                    <dd>{t("Enable or disable loop")}</dd>
                  </div>
                  <div>
                    <dt>
                      <kbd>+</kbd>
                      <kbd>=</kbd>
                    </dt>
                    <dd>{t("Increase tempo")}</dd>
                  </div>
                  <div>
                    <dt>
                      <kbd>-</kbd>
                    </dt>
                    <dd>{t("Decrease tempo")}</dd>
                  </div>
                </dl>
              </div>
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

export default forwardRef(RhythmPlayer);

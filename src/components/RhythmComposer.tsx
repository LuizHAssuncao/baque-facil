import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { CircleDot, Keyboard, Lightbulb, SquareStop, X } from "lucide-react";
import RhythmPlayer, { type RhythmPlayerHandle } from "./RhythmPlayer";
import { countLabels, stepsPerBeat as getStepsPerBeat } from "../lib/countLabels";
import {
  blurPointerActivatedButton,
  shouldIgnoreKeyboardShortcut,
} from "../lib/keyboardShortcuts";
import { extractRhythmBlock } from "../lib/extractRhythmBlock";
import { formatRhythmBlock } from "../lib/formatRhythmBlock";
import { parseRhythm } from "../lib/parseRhythm";
import { rhythmGridColumns, rhythmGridMinWidth } from "../lib/rhythmGridLayout";
import { sampleEntriesForRhythm, sampleMap } from "../lib/sampleMap";
import { MAX_TEMPO, MIN_TEMPO, clampTempo } from "../lib/tempo";
import { validateRhythm } from "../lib/validateRhythm";
import type { Rhythm, RhythmTrack, Subdivision } from "../lib/rhythmTypes";

type ComposerSymbol = "." | "L" | "R" | "B";
type HitSymbol = "L" | "R";
type HitInputSource = "touchstart" | "pointerdown" | "keyboard" | "click";
type BrowserWindowWithAudio = Window &
  typeof globalThis & {
    webkitAudioContext?: typeof AudioContext;
  };

const DEFAULT_SUBDIVISION: Subdivision = 16;
const DEFAULT_STEP_COUNT = getStepsPerBeat(DEFAULT_SUBDIVISION) * 4;
const DEFAULT_TITLE = "Untitled Alfaia Rhythm";
const DEFAULT_DESCRIPTION = "A description.";
const DEFAULT_DIFFICULTY = "beginner";
const DEFAULT_TEMPO = 50;
const COMPOSER_TRACK_NAME = "Alfaia";
const COMPOSER_TRACK_COLUMN_MIN_REM = 6;
const COMPOSER_TRACK_COLUMN_MAX_REM = 7;
const PLAYHEAD_SCROLL_MARGIN_PX = 24;
const PLAYHEAD_RIGHT_LIMIT_RATIO = 0.55;
const PLAYHEAD_TARGET_RATIO = 0.35;
const PREVIEW_SAMPLES = {
  "Alfaia.L": sampleMap["Alfaia.L"],
  "Alfaia.R": sampleMap["Alfaia.R"],
  "Alfaia.B": sampleMap["Alfaia.B"],
};
const HIT_SAMPLE_URLS: Record<HitSymbol, string> = {
  L: sampleMap["Alfaia.L"],
  R: sampleMap["Alfaia.R"],
};
const TEMPO_KEYBOARD_STEP = 1;
const MEDIA_HAS_CURRENT_DATA = 2;
const TOUCH_POINTER_DEDUPLICATION_WINDOW_MS = 120;
const PLAYER_TIP_ID = "composer-player-tip";

function emptySteps(stepCount: number) {
  return Array.from({ length: stepCount }, () => "." as ComposerSymbol);
}

function resizeSteps(steps: ComposerSymbol[], stepCount: number) {
  const nextSteps = emptySteps(stepCount);

  steps.slice(0, stepCount).forEach((step, index) => {
    nextSteps[index] = step;
  });

  return nextSteps;
}

function resizeTrackSteps(steps: string[], stepCount: number) {
  const nextSteps = Array.from({ length: stepCount }, () => ".");

  steps.slice(0, stepCount).forEach((step, index) => {
    nextSteps[index] = step;
  });

  return nextSteps;
}

function moveIndex(index: number, offset: number, stepCount: number) {
  return (index + offset + stepCount) % stepCount;
}

function recordingStepDuration(tempo: number, subdivision: Subdivision) {
  return 60_000 / tempo / getStepsPerBeat(subdivision);
}

function recordingBeatDuration(tempo: number) {
  return 60_000 / tempo;
}

function escapeYamlString(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function formatMarkdown(tracks: RhythmTrack[], tempo: number, subdivision: Subdivision) {
  return [
    "---",
    `title: "${escapeYamlString(DEFAULT_TITLE)}"`,
    `tempo: ${tempo}`,
    `subdivision: ${subdivision}`,
    `difficulty: "${DEFAULT_DIFFICULTY}"`,
    "instruments:",
    '  - "Alfaia"',
    "---",
    "",
    DEFAULT_DESCRIPTION,
    "",
    "```rhythm",
    formatRhythmBlock(tracks, getStepsPerBeat(subdivision)),
    "```",
    "",
  ].join("\n");
}

function formatTranscriptionWithTracks(
  transcription: string,
  tracks: RhythmTrack[],
  tempo: number,
  subdivision: Subdivision,
) {
  const rhythmBlock = formatRhythmBlock(tracks, getStepsPerBeat(subdivision));
  const rhythmFencePattern = /(```rhythm[^\n]*\n)([\s\S]*?)(```)/i;

  if (rhythmFencePattern.test(transcription)) {
    return transcription.replace(
      rhythmFencePattern,
      (_match, openingFence: string, _content: string, closingFence: string) =>
        `${openingFence}${rhythmBlock}\n${closingFence}`,
    );
  }

  if (transcription.trim()) {
    return `${rhythmBlock}\n`;
  }

  return formatMarkdown(tracks, tempo, subdivision);
}

function formatTranscriptionWithTempo(transcription: string, tempo: number) {
  const tempoPattern = /^tempo:\s*.+$/m;

  if (!tempoPattern.test(transcription)) {
    return transcription;
  }

  return transcription.replace(tempoPattern, `tempo: ${tempo}`);
}

function defaultTracks() {
  return [
    {
      name: COMPOSER_TRACK_NAME,
      steps: emptySteps(DEFAULT_STEP_COUNT),
    },
  ];
}

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

function rhythmInputFromTranscription(transcription: string) {
  const closedBlock = extractRhythmBlock(transcription);

  if (closedBlock !== null) {
    return closedBlock;
  }

  const openFenceMatch = transcription.match(/```rhythm[^\n]*\n([\s\S]*)$/i);

  if (openFenceMatch) {
    return openFenceMatch[1]?.trim() ?? "";
  }

  return transcription.trim();
}

function parseTranscriptionTracks(
  transcription: string,
  tempo: number,
  subdivision: Subdivision,
) {
  try {
    const tracks = parseRhythm(rhythmInputFromTranscription(transcription));
    const errors = validateRhythm({
      title: DEFAULT_TITLE,
      slug: "compose-preview",
      tempo,
      subdivision,
      tracks,
    });

    return { tracks, errors };
  } catch (cause) {
    return {
      tracks: [],
      errors: [cause instanceof Error ? cause.message : "Unable to parse rhythm block."],
    };
  }
}

function isComposerSymbol(symbol: string): symbol is ComposerSymbol {
  return symbol === "." || symbol === "L" || symbol === "R" || symbol === "B";
}

function composerStepsFromTracks(tracks: RhythmTrack[]) {
  const composerTrack = tracks.find((track) => track.name === COMPOSER_TRACK_NAME);

  if (!composerTrack || !composerTrack.steps.every(isComposerSymbol)) {
    return null;
  }

  return [...composerTrack.steps] as ComposerSymbol[];
}

function tracksWithComposerSteps(tracks: RhythmTrack[], steps: ComposerSymbol[]) {
  const composerTrackIndex = tracks.findIndex((track) => track.name === COMPOSER_TRACK_NAME);

  if (composerTrackIndex === -1) {
    return [{ name: COMPOSER_TRACK_NAME, steps }];
  }

  return tracks.map((track, index) => {
    if (index === composerTrackIndex) {
      return {
        ...track,
        steps,
      };
    }

    return {
      ...track,
      steps: resizeTrackSteps(track.steps, steps.length),
    };
  });
}

function hitSymbolForKeyboardKey(key: string): HitSymbol | null {
  if (key === "f" || key === "F") {
    return "L";
  }

  if (key === "j" || key === "J") {
    return "R";
  }

  return null;
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

function eventTimestampToPerformanceTime(timeStamp: number) {
  const now = performance.now();

  if (!Number.isFinite(timeStamp)) {
    return now;
  }

  if (Math.abs(timeStamp - now) < 60_000) {
    return timeStamp;
  }

  const timeOrigin = performance.timeOrigin ?? Date.now() - now;
  const highResolutionTimeStamp = timeStamp - timeOrigin;

  if (Math.abs(highResolutionTimeStamp - now) < 60_000) {
    return highResolutionTimeStamp;
  }

  return now;
}

export default function RhythmComposer() {
  const [tempo, setTempo] = useState(DEFAULT_TEMPO);
  const [recordedTracks, setRecordedTracks] = useState<RhythmTrack[]>(defaultTracks);
  const [currentTracks, setCurrentTracks] = useState<RhythmTrack[]>(defaultTracks);
  const [recordingSteps, setRecordingSteps] = useState<ComposerSymbol[]>(() =>
    emptySteps(1),
  );
  const [transcription, setTranscription] = useState(() =>
    formatMarkdown(defaultTracks(), DEFAULT_TEMPO, DEFAULT_SUBDIVISION),
  );
  const [transcriptionErrors, setTranscriptionErrors] = useState<string[]>([]);
  const [selectedStep, setSelectedStep] = useState(0);
  const [isRecording, setIsRecording] = useState(false);
  const [countIn, setCountIn] = useState<number | null>(null);
  const [metronomeEnabled, setMetronomeEnabled] = useState(false);
  const [recordStatus, setRecordStatus] = useState("Ready");
  const [showShortcutHelp, setShowShortcutHelp] = useState(false);
  const [showPlayerTip, setShowPlayerTip] = useState(false);
  const [pressedHands, setPressedHands] = useState<Record<HitSymbol, boolean>>({
    L: false,
    R: false,
  });
  const recordedTracksRef = useRef(recordedTracks);
  const currentTracksRef = useRef(currentTracks);
  const recordingStepsRef = useRef(recordingSteps);
  const transcriptionRef = useRef(transcription);
  const selectedStepRef = useRef(selectedStep);
  const tempoRef = useRef(tempo);
  const metronomeEnabledRef = useRef(metronomeEnabled);
  const shortcutHelpTriggerRef = useRef<HTMLButtonElement | null>(null);
  const shortcutHelpCloseButtonRef = useRef<HTMLButtonElement | null>(null);
  const previewPlayerRef = useRef<RhythmPlayerHandle | null>(null);
  const leftHitButtonRef = useRef<HTMLButtonElement | null>(null);
  const rightHitButtonRef = useRef<HTMLButtonElement | null>(null);
  const handleHitTouchStartRef = useRef<
    (symbol: HitSymbol, event: TouchEvent) => void
  >(() => undefined);
  const releaseHitTouchRef = useRef<(symbol: HitSymbol, event: TouchEvent) => void>(
    () => undefined,
  );
  const gridScrollRef = useRef<HTMLDivElement | null>(null);
  const countCellRefs = useRef<(HTMLDivElement | null)[]>([]);
  const composerAudioContextRef = useRef<AudioContext | null>(null);
  const hitBuffersRef = useRef<Partial<Record<HitSymbol, AudioBuffer>>>({});
  const hitBufferLoadPromiseRef = useRef<Promise<void> | null>(null);
  const hitAudioElementsRef = useRef<Partial<Record<HitSymbol, HTMLAudioElement>>>({});
  const activeHitPointerRef = useRef<Record<HitSymbol, number | null>>({ L: null, R: null });
  const activeHitPressRef = useRef<Record<HitSymbol, boolean>>({ L: false, R: false });
  const lastHitInputRef = useRef<
    Record<HitSymbol, { source: HitInputSource; inputTime: number } | null>
  >({ L: null, R: null });
  const suppressNextHitClickRef = useRef<Record<HitSymbol, boolean>>({ L: false, R: false });
  const suppressHitClickTimeoutRef = useRef<Record<HitSymbol, number | null>>({
    L: null,
    R: null,
  });
  const recordingTimerRef = useRef<number | null>(null);
  const countInTimerRef = useRef<number | null>(null);
  const elapsedRecordingStepsRef = useRef(0);
  const recordingStartTimeRef = useRef<number | null>(null);

  const subdivision = DEFAULT_SUBDIVISION;
  const beatStepCount = getStepsPerBeat(subdivision);
  const displayTitle = DEFAULT_TITLE;
  const isRecordLocked = isRecording || countIn !== null;
  const recordedSteps = useMemo(
    () => composerStepsFromTracks(recordedTracks) ?? emptySteps(DEFAULT_STEP_COUNT),
    [recordedTracks],
  );
  const displaySteps = isRecordLocked ? recordingSteps : recordedSteps;
  const stepCount = displaySteps.length;
  const labels = useMemo(() => countLabels(stepCount, subdivision), [stepCount, subdivision]);
  const gridStyle = useMemo(
    () =>
      ({
        gridTemplateColumns: rhythmGridColumns(
          COMPOSER_TRACK_COLUMN_MIN_REM,
          COMPOSER_TRACK_COLUMN_MAX_REM,
          stepCount,
        ),
      }) as CSSProperties,
    [stepCount],
  );
  const gridShellStyle = useMemo(
    () =>
      ({
        minWidth: rhythmGridMinWidth(COMPOSER_TRACK_COLUMN_MIN_REM, stepCount),
      }) as CSSProperties,
    [stepCount],
  );
  const hasTranscriptionErrors = transcriptionErrors.length > 0;
  const isPatternDirty =
    hasTranscriptionErrors || !tracksEqual(currentTracks, recordedTracks);

  const rhythm = useMemo<Rhythm>(
    () => ({
      title: displayTitle,
      slug: "compose-preview",
      tempo,
      subdivision,
      tracks: currentTracks,
    }),
    [currentTracks, displayTitle, subdivision, tempo],
  );
  const previewSamples = useMemo(
    () => ({
      ...sampleEntriesForRhythm(rhythm),
      ...PREVIEW_SAMPLES,
    }),
    [rhythm],
  );

  function clampSelectedStepToSteps(nextSteps: ComposerSymbol[]) {
    const nextSelectedStep = Math.min(
      selectedStepRef.current,
      Math.max(0, nextSteps.length - 1),
    );

    if (nextSelectedStep !== selectedStepRef.current) {
      selectedStepRef.current = nextSelectedStep;
      setSelectedStep(nextSelectedStep);
    }
  }

  function applyCurrentTracks(
    nextTracks: RhythmTrack[],
    options: { syncTranscription?: boolean; clearErrors?: boolean } = {},
  ) {
    const { syncTranscription = true, clearErrors = true } = options;
    const clonedTracks = cloneTracks(nextTracks);

    currentTracksRef.current = clonedTracks;
    setCurrentTracks(clonedTracks);

    if (syncTranscription) {
      const nextTranscription = formatTranscriptionWithTracks(
        transcriptionRef.current,
        clonedTracks,
        tempoRef.current,
        subdivision,
      );

      transcriptionRef.current = nextTranscription;
      setTranscription(nextTranscription);
    }

    if (clearErrors) {
      setTranscriptionErrors([]);
    }
  }

  function applyRecordedTracks(nextTracks: RhythmTrack[]) {
    const clonedTracks = cloneTracks(nextTracks);

    recordedTracksRef.current = clonedTracks;
    setRecordedTracks(clonedTracks);

    const nextSteps = composerStepsFromTracks(clonedTracks);
    if (nextSteps) {
      clampSelectedStepToSteps(nextSteps);
    }
  }

  function commitRecordingTracks(nextTracks: RhythmTrack[]) {
    applyRecordedTracks(nextTracks);
    applyCurrentTracks(nextTracks);
  }

  function applyCurrentComposerSteps(nextSteps: ComposerSymbol[]) {
    const normalizedSteps = nextSteps.length > 0 ? nextSteps : emptySteps(1);
    const nextTracks = tracksWithComposerSteps(currentTracksRef.current, normalizedSteps);

    applyCurrentTracks(nextTracks);
  }

  function updateRecordingSteps(nextSteps: ComposerSymbol[]) {
    const normalizedSteps = nextSteps.length > 0 ? nextSteps : emptySteps(1);

    recordingStepsRef.current = normalizedSteps;
    setRecordingSteps(normalizedSteps);
    clampSelectedStepToSteps(normalizedSteps);
  }

  function resetCurrentPattern() {
    applyCurrentTracks(recordedTracksRef.current);
  }

  function handlePreviewPatternChange(nextTracks: RhythmTrack[]) {
    applyCurrentTracks(nextTracks);
  }

  function handleTranscriptionChange(event: ChangeEvent<HTMLTextAreaElement>) {
    const nextTranscription = event.target.value;
    const { tracks, errors } = parseTranscriptionTracks(
      nextTranscription,
      tempoRef.current,
      subdivision,
    );

    transcriptionRef.current = nextTranscription;
    setTranscription(nextTranscription);

    if (errors.length > 0) {
      setTranscriptionErrors(errors);
      return;
    }

    applyCurrentTracks(tracks, { syncTranscription: false });
  }

  function getComposerAudioContext() {
    const AudioContextConstructor =
      window.AudioContext ?? (window as BrowserWindowWithAudio).webkitAudioContext;

    if (!AudioContextConstructor) {
      return null;
    }

    const currentContext = composerAudioContextRef.current;
    if (currentContext && currentContext.state !== "closed") {
      return currentContext;
    }

    try {
      const context = new AudioContextConstructor();
      composerAudioContextRef.current = context;

      return context;
    } catch {
      return null;
    }
  }

  async function ensureComposerAudioContext() {
    const context = getComposerAudioContext();

    if (!context) {
      return null;
    }

    if (context.state === "suspended") {
      await context.resume();
    }

    return context;
  }

  function getHitAudioElement(symbol: HitSymbol) {
    const currentAudio = hitAudioElementsRef.current[symbol];
    if (currentAudio) {
      return currentAudio;
    }

    try {
      const audio = new Audio(HIT_SAMPLE_URLS[symbol]);
      audio.preload = "auto";
      audio.load();
      hitAudioElementsRef.current[symbol] = audio;

      return audio;
    } catch {
      return null;
    }
  }

  function prepareHitAudioElements() {
    getHitAudioElement("L");
    getHitAudioElement("R");
  }

  async function prepareHitSamples(options: { resume?: boolean } = {}) {
    prepareHitAudioElements();

    const context = options.resume
      ? await ensureComposerAudioContext()
      : getComposerAudioContext();

    if (!context) {
      return;
    }

    if (hitBufferLoadPromiseRef.current) {
      await hitBufferLoadPromiseRef.current;
      return;
    }

    const loadPromise = Promise.all(
      Object.entries(HIT_SAMPLE_URLS).map(async ([symbol, url]) => {
        const hitSymbol = symbol as HitSymbol;

        if (hitBuffersRef.current[hitSymbol]) {
          return;
        }

        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`Could not load ${url}.`);
        }

        const arrayBuffer = await response.arrayBuffer();
        hitBuffersRef.current[hitSymbol] = await context.decodeAudioData(arrayBuffer);
      }),
    ).then(() => undefined);

    hitBufferLoadPromiseRef.current = loadPromise.catch((cause) => {
      hitBufferLoadPromiseRef.current = null;
      throw cause;
    });

    await hitBufferLoadPromiseRef.current;
  }

  function playMetronomeClick(isFirstBeat = false, options: { force?: boolean } = {}) {
    if (!options.force && !metronomeEnabledRef.current) {
      return;
    }

    const context = composerAudioContextRef.current;
    if (!context || context.state === "closed") {
      return;
    }

    const now = context.currentTime;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const duration = isFirstBeat ? 0.095 : 0.06;

    oscillator.type = "square";
    oscillator.frequency.setValueAtTime(isFirstBeat ? 1100 : 740, now);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(isFirstBeat ? 0.2 : 0.12, now + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(now);
    oscillator.stop(now + duration + 0.01);
  }

  function playCountInClick() {
    playMetronomeClick(false, { force: true });
  }

  function startHitBuffer(context: AudioContext, symbol: HitSymbol) {
    const buffer = hitBuffersRef.current[symbol];

    if (!buffer || context.state !== "running") {
      return false;
    }

    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    source.start();

    return true;
  }

  function playHitAudioElement(symbol: HitSymbol) {
    const audio = getHitAudioElement(symbol);

    if (!audio || audio.readyState < MEDIA_HAS_CURRENT_DATA) {
      return false;
    }

    try {
      audio.pause();
      audio.currentTime = 0;
      void audio.play()?.catch(() => undefined);

      return true;
    } catch {
      return false;
    }
  }

  function playHitSound(
    symbol: HitSymbol,
    options: {
      resume?: boolean;
      onlyWhilePressed?: boolean;
      allowMediaElementFallback?: boolean;
    } = {},
  ) {
    const context = getComposerAudioContext();

    if (context && startHitBuffer(context, symbol)) {
      return true;
    }

    if (options.allowMediaElementFallback && playHitAudioElement(symbol)) {
      return true;
    }

    if (!context || !options.resume || context.state !== "suspended") {
      return false;
    }

    void context.resume().then(() => {
      if (options.onlyWhilePressed && !activeHitPressRef.current[symbol]) {
        return;
      }

      startHitBuffer(context, symbol);
    }).catch(() => undefined);

    return false;
  }

  function clearRecordingTimer() {
    if (recordingTimerRef.current !== null) {
      window.clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
  }

  function clearCountInTimer() {
    if (countInTimerRef.current !== null) {
      window.clearInterval(countInTimerRef.current);
      countInTimerRef.current = null;
    }
  }

  function stopRecording(
    status = "Stopped",
    shouldTrimTake = false,
    trimThroughStep = selectedStepRef.current,
  ) {
    clearCountInTimer();
    clearRecordingTimer();
    recordingStartTimeRef.current = null;

    if (shouldTrimTake) {
      const trimmedStepCount = Math.max(1, trimThroughStep + 1);
      const nextSelectedStep = Math.max(0, trimmedStepCount - 1);
      const trimmedSteps = resizeSteps(recordingStepsRef.current, trimmedStepCount);
      const nextTracks = [{ name: COMPOSER_TRACK_NAME, steps: trimmedSteps }];

      recordingStepsRef.current = trimmedSteps;
      setRecordingSteps(trimmedSteps);
      commitRecordingTracks(nextTracks);
      selectedStepRef.current = nextSelectedStep;
      setSelectedStep(nextSelectedStep);
    }

    setCountIn(null);
    setIsRecording(false);
    setRecordStatus(status);
  }

  function stopActiveRecording() {
    if (countIn !== null) {
      stopRecording("Count-in canceled");
      return;
    }

    if (isRecording) {
      stopRecording("Stopped", true, getHitTargetStep());
    }
  }

  function beginRecordingTake() {
    const recordingStepsPerBeat = beatStepCount;

    clearCountInTimer();
    setCountIn(null);
    setSelectedStep(0);
    selectedStepRef.current = 0;
    elapsedRecordingStepsRef.current = 0;
    recordingStartTimeRef.current = performance.now();
    setIsRecording(true);
    setRecordStatus("Recording");
    playMetronomeClick(true);

    recordingTimerRef.current = window.setInterval(() => {
      elapsedRecordingStepsRef.current += 1;

      const nextStep = elapsedRecordingStepsRef.current;
      selectedStepRef.current = nextStep;
      setSelectedStep(nextStep);

      if (nextStep >= recordingStepsRef.current.length) {
        updateRecordingSteps(resizeSteps(recordingStepsRef.current, nextStep + 1));
      }

      if (nextStep % recordingStepsPerBeat === 0) {
        playMetronomeClick(false);
      }
    }, recordingStepDuration(tempo, subdivision));
  }

  async function startRecording() {
    if (isRecordLocked) {
      return;
    }

    clearRecordingTimer();
    clearCountInTimer();
    updateRecordingSteps(emptySteps(1));
    setSelectedStep(0);
    selectedStepRef.current = 0;
    elapsedRecordingStepsRef.current = 0;
    recordingStartTimeRef.current = null;
    setIsRecording(false);
    setCountIn(1);
    setRecordStatus("Count-in");

    void prepareHitSamples({ resume: true }).catch(() => undefined);
    void ensureComposerAudioContext().then(() => playCountInClick()).catch(() => undefined);

    let nextCount = 2;
    countInTimerRef.current = window.setInterval(() => {
      if (nextCount <= 3) {
        setCountIn(nextCount);
        playCountInClick();
        nextCount += 1;
        return;
      }

      beginRecordingTake();
    }, recordingBeatDuration(tempo));
  }

  function toggleRecording() {
    if (isRecordLocked) {
      stopActiveRecording();
      return;
    }

    void startRecording();
  }

  function getHitTargetStep(inputTime = performance.now()) {
    if (!isRecording || recordingStartTimeRef.current === null) {
      return selectedStepRef.current;
    }

    const elapsedMilliseconds = Math.max(0, inputTime - recordingStartTimeRef.current);
    const targetStep = Math.floor(
      elapsedMilliseconds / recordingStepDuration(tempoRef.current, subdivision),
    );

    return Math.max(0, targetStep);
  }

  function writeHit(symbol: HitSymbol, inputTime = performance.now()) {
    if (countIn !== null) {
      return;
    }

    const targetStep = getHitTargetStep(inputTime);

    if (targetStep < 0) {
      return;
    }

    if (isRecording) {
      const nextRecordingSteps =
        targetStep < recordingStepsRef.current.length
          ? [...recordingStepsRef.current]
          : resizeSteps(recordingStepsRef.current, targetStep + 1);

      nextRecordingSteps[targetStep] = symbol;
      updateRecordingSteps(nextRecordingSteps);
      return;
    }

    const currentComposerSteps =
      composerStepsFromTracks(currentTracksRef.current) ?? emptySteps(DEFAULT_STEP_COUNT);
    const nextSteps =
      targetStep < currentComposerSteps.length
        ? [...currentComposerSteps]
        : resizeSteps(currentComposerSteps, targetStep + 1);

    nextSteps[targetStep] = symbol;
    applyCurrentComposerSteps(nextSteps);
  }

  function moveSelectedStep(offset: number) {
    if (stepCount === 0) {
      return;
    }

    setSelectedStep((currentStep) => {
      const nextStep = moveIndex(currentStep, offset, stepCount);
      selectedStepRef.current = nextStep;
      return nextStep;
    });
  }

  function clearSelectedStep() {
    if (isRecordLocked) {
      return;
    }

    const currentComposerSteps =
      composerStepsFromTracks(currentTracksRef.current) ?? emptySteps(DEFAULT_STEP_COUNT);
    const nextSteps = [...currentComposerSteps];
    nextSteps[selectedStepRef.current] = ".";
    applyCurrentComposerSteps(nextSteps);
  }

  function clearGrid() {
    if (isRecordLocked) {
      return;
    }

    applyCurrentComposerSteps(emptySteps(stepCount || DEFAULT_STEP_COUNT));
    setSelectedStep(0);
    selectedStepRef.current = 0;
    setRecordStatus("Ready");
  }

  function updateTempo(value: number) {
    const clampedTempo = clampTempo(value, tempoRef.current);

    tempoRef.current = clampedTempo;
    setTempo(clampedTempo);

    const nextTranscription = formatTranscriptionWithTempo(
      transcriptionRef.current,
      clampedTempo,
    );

    if (nextTranscription !== transcriptionRef.current) {
      transcriptionRef.current = nextTranscription;
      setTranscription(nextTranscription);
    }
  }

  function selectStep(index: number) {
    if (isRecordLocked) {
      return;
    }

    setSelectedStep(index);
    selectedStepRef.current = index;
  }

  function toggleMetronome(enabled: boolean) {
    setMetronomeEnabled(enabled);
    metronomeEnabledRef.current = enabled;

    if (enabled) {
      void ensureComposerAudioContext().catch(() => undefined);
    }
  }

  function setHandPressed(symbol: HitSymbol, isPressed: boolean) {
    activeHitPressRef.current[symbol] = isPressed;

    setPressedHands((currentHands) => {
      if (currentHands[symbol] === isPressed) {
        return currentHands;
      }

      return {
        ...currentHands,
        [symbol]: isPressed,
      };
    });
  }

  function releasePressedHands() {
    activeHitPressRef.current.L = false;
    activeHitPressRef.current.R = false;

    setPressedHands((currentHands) => {
      if (!currentHands.L && !currentHands.R) {
        return currentHands;
      }

      return { L: false, R: false };
    });
  }

  function clearHitClickSuppressionTimeout(symbol: HitSymbol) {
    const timeout = suppressHitClickTimeoutRef.current[symbol];

    if (timeout !== null) {
      window.clearTimeout(timeout);
      suppressHitClickTimeoutRef.current[symbol] = null;
    }
  }

  function suppressNextHitClick(symbol: HitSymbol, timeoutMilliseconds = 5_000) {
    clearHitClickSuppressionTimeout(symbol);
    suppressNextHitClickRef.current[symbol] = true;
    suppressHitClickTimeoutRef.current[symbol] = window.setTimeout(() => {
      suppressNextHitClickRef.current[symbol] = false;
      suppressHitClickTimeoutRef.current[symbol] = null;
    }, timeoutMilliseconds);
  }

  function shouldSuppressHitClick(symbol: HitSymbol) {
    if (!suppressNextHitClickRef.current[symbol]) {
      return false;
    }

    suppressNextHitClickRef.current[symbol] = false;
    clearHitClickSuppressionTimeout(symbol);
    return true;
  }

  function shouldIgnoreDuplicateHitInput(
    symbol: HitSymbol,
    inputTime: number,
    source: HitInputSource,
  ) {
    const previousInput = lastHitInputRef.current[symbol];

    if (!previousInput) {
      return false;
    }

    const isTouchPointerPair =
      (source === "touchstart" && previousInput.source === "pointerdown") ||
      (source === "pointerdown" && previousInput.source === "touchstart");

    return (
      isTouchPointerPair &&
      Math.abs(inputTime - previousInput.inputTime) <= TOUCH_POINTER_DEDUPLICATION_WINDOW_MS
    );
  }

  function triggerHit(
    symbol: HitSymbol,
    inputTime: number,
    source: HitInputSource,
    options: { onlyWhilePressed?: boolean; allowMediaElementFallback?: boolean } = {},
  ) {
    if (countIn !== null) {
      return false;
    }

    if (shouldIgnoreDuplicateHitInput(symbol, inputTime, source)) {
      return false;
    }

    lastHitInputRef.current[symbol] = { source, inputTime };
    playHitSound(symbol, {
      resume: true,
      onlyWhilePressed: options.onlyWhilePressed ?? source === "touchstart",
      allowMediaElementFallback:
        options.allowMediaElementFallback ?? (source === "keyboard" || source === "click"),
    });
    writeHit(symbol, inputTime);

    return true;
  }

  function releaseHitPointer(symbol: HitSymbol, event: ReactPointerEvent<HTMLButtonElement>) {
    setHandPressed(symbol, false);
    if (activeHitPointerRef.current[symbol] === event.pointerId) {
      activeHitPointerRef.current[symbol] = null;
      suppressNextHitClick(symbol, 700);
    }

    try {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    } catch {
      // Pointer capture can already be released by the browser.
    }
  }

  function handleHitPointerDown(
    symbol: HitSymbol,
    event: ReactPointerEvent<HTMLButtonElement>,
  ) {
    if (!event.isPrimary || event.button !== 0) {
      return;
    }

    if (event.pointerType === "touch" && event.cancelable) {
      event.preventDefault();
    }

    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Some older touch browsers do not support pointer capture on buttons.
    }

    activeHitPointerRef.current[symbol] = event.pointerId;
    suppressNextHitClick(symbol);
    setHandPressed(symbol, true);
    triggerHit(symbol, eventTimestampToPerformanceTime(event.timeStamp), "pointerdown", {
      onlyWhilePressed: event.pointerType !== "mouse",
      allowMediaElementFallback: event.pointerType === "mouse",
    });
  }

  function handleHitTouchStart(symbol: HitSymbol, event: TouchEvent) {
    if (event.changedTouches.length === 0) {
      return;
    }

    if (event.cancelable) {
      event.preventDefault();
    }
    event.stopPropagation();
    suppressNextHitClick(symbol);
    setHandPressed(symbol, true);
    triggerHit(symbol, eventTimestampToPerformanceTime(event.timeStamp), "touchstart", {
      onlyWhilePressed: true,
      allowMediaElementFallback: false,
    });
  }

  function releaseHitTouch(symbol: HitSymbol, event: TouchEvent) {
    if (event.cancelable) {
      event.preventDefault();
    }
    event.stopPropagation();
    setHandPressed(symbol, false);
    suppressNextHitClick(symbol, 700);
  }

  function handleHitClick(symbol: HitSymbol, event: ReactMouseEvent<HTMLButtonElement>) {
    if (shouldSuppressHitClick(symbol)) {
      return;
    }

    triggerHit(symbol, eventTimestampToPerformanceTime(event.timeStamp), "click");
  }

  handleHitTouchStartRef.current = handleHitTouchStart;
  releaseHitTouchRef.current = releaseHitTouch;

  useEffect(() => {
    const touchListenerOptions = { capture: true, passive: false };
    const touchListeners: Array<[HTMLButtonElement | null, HitSymbol]> = [
      [leftHitButtonRef.current, "L"],
      [rightHitButtonRef.current, "R"],
    ];
    const cleanupCallbacks: Array<() => void> = [];

    touchListeners.forEach(([button, symbol]) => {
      if (!button) {
        return;
      }

      const handleTouchStart = (event: TouchEvent) => {
        handleHitTouchStartRef.current(symbol, event);
      };
      const handleTouchRelease = (event: TouchEvent) => {
        releaseHitTouchRef.current(symbol, event);
      };

      button.addEventListener("touchstart", handleTouchStart, touchListenerOptions);
      button.addEventListener("touchend", handleTouchRelease, touchListenerOptions);
      button.addEventListener("touchcancel", handleTouchRelease, touchListenerOptions);

      cleanupCallbacks.push(() => {
        button.removeEventListener("touchstart", handleTouchStart, touchListenerOptions);
        button.removeEventListener("touchend", handleTouchRelease, touchListenerOptions);
        button.removeEventListener("touchcancel", handleTouchRelease, touchListenerOptions);
      });
    });

    return () => {
      cleanupCallbacks.forEach((cleanup) => cleanup());
    };
  }, []);

  useEffect(() => {
    selectedStepRef.current = selectedStep;
  }, [selectedStep]);

  useEffect(() => {
    recordedTracksRef.current = cloneTracks(recordedTracks);
  }, [recordedTracks]);

  useEffect(() => {
    currentTracksRef.current = cloneTracks(currentTracks);
  }, [currentTracks]);

  useEffect(() => {
    recordingStepsRef.current = recordingSteps;
  }, [recordingSteps]);

  useEffect(() => {
    transcriptionRef.current = transcription;
  }, [transcription]);

  useEffect(() => {
    countCellRefs.current = countCellRefs.current.slice(0, stepCount);
  }, [stepCount]);

  useEffect(() => {
    const container = gridScrollRef.current;
    const selectedCell = countCellRefs.current[selectedStep];

    if (!container || !selectedCell) {
      return;
    }

    scrollPlayheadIntoView(container, selectedCell, selectedStep < stepCount - 1);
  }, [selectedStep, stepCount]);

  useEffect(() => {
    tempoRef.current = tempo;
  }, [tempo]);

  useEffect(() => {
    metronomeEnabledRef.current = metronomeEnabled;
  }, [metronomeEnabled]);

  useEffect(() => {
    if (showShortcutHelp) {
      shortcutHelpCloseButtonRef.current?.focus();
    }
  }, [showShortcutHelp]);

  useEffect(() => {
    void prepareHitSamples().catch(() => undefined);
  }, []);

  useEffect(() => {
    return () => {
      clearCountInTimer();
      clearRecordingTimer();

      const context = composerAudioContextRef.current;
      if (context && context.state !== "closed") {
        void context.close();
      }

      clearHitClickSuppressionTimeout("L");
      clearHitClickSuppressionTimeout("R");
    };
  }, []);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
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

      if (event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }

      const hitSymbol = hitSymbolForKeyboardKey(event.key);
      if (hitSymbol) {
        event.preventDefault();
        setHandPressed(hitSymbol, true);
        triggerHit(hitSymbol, performance.now(), "keyboard");
        return;
      }

      const key = event.key.toLowerCase();

      if (event.code === "Space" || event.key === " ") {
        event.preventDefault();

        if (!event.repeat) {
          previewPlayerRef.current?.togglePlayback();
        }

        return;
      }

      if (key === "r") {
        event.preventDefault();

        if (!event.repeat) {
          toggleRecording();
        }

        return;
      }

      if (key === "m") {
        event.preventDefault();

        if (!event.repeat) {
          toggleMetronome(!metronomeEnabledRef.current);
        }

        return;
      }

      if (key === "l") {
        event.preventDefault();

        if (!event.repeat) {
          previewPlayerRef.current?.toggleLoop();
        }

        return;
      }

      if (key === "c") {
        event.preventDefault();

        if (!event.repeat) {
          clearGrid();
        }

        return;
      }

      if (event.key === "+" || event.key === "=") {
        event.preventDefault();

        if (!isRecordLocked) {
          updateTempo(tempoRef.current + TEMPO_KEYBOARD_STEP);
        }

        return;
      }

      if (event.key === "-" || event.key === "_") {
        event.preventDefault();

        if (!isRecordLocked) {
          updateTempo(tempoRef.current - TEMPO_KEYBOARD_STEP);
        }

        return;
      }

      if (event.key === "Backspace") {
        event.preventDefault();
        clearSelectedStep();
        return;
      }

      if (event.key === "ArrowLeft") {
        event.preventDefault();
        if (isRecordLocked) {
          return;
        }
        moveSelectedStep(-1);
        return;
      }

      if (event.key === "ArrowRight") {
        event.preventDefault();
        if (isRecordLocked) {
          return;
        }
        moveSelectedStep(1);
        return;
      }

      if (event.key === "ArrowUp") {
        event.preventDefault();
        if (isRecordLocked) {
          return;
        }
        moveSelectedStep(-beatStepCount);
        return;
      }

      if (event.key === "ArrowDown") {
        event.preventDefault();
        if (isRecordLocked) {
          return;
        }
        moveSelectedStep(beatStepCount);
      }
    }

    function handleKeyUp(event: KeyboardEvent) {
      const hitSymbol = hitSymbolForKeyboardKey(event.key);

      if (hitSymbol) {
        setHandPressed(hitSymbol, false);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", releasePressedHands);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", releasePressedHands);
    };
  }, [
    beatStepCount,
    isRecordLocked,
    selectedStep,
    showShortcutHelp,
    stepCount,
    tempo,
  ]);

  function closeShortcutHelp(restoreFocus = true) {
    setShowShortcutHelp(false);
    if (restoreFocus) {
      window.setTimeout(() => shortcutHelpTriggerRef.current?.focus(), 0);
    }
  }

  return (
    <section
      className="composer-panel"
      aria-label="Alfaia rhythm composer"
      onClickCapture={(event) => blurPointerActivatedButton(event.target, event.detail)}
    >
      <div className="composer-meta">
        <label>
          <span>Tempo</span>
          <div className="composer-slider-row">
            <input
              type="range"
              min={MIN_TEMPO}
              max={MAX_TEMPO}
              step="1"
              disabled={isRecordLocked}
              value={tempo}
              suppressHydrationWarning
              onChange={(event) => updateTempo(Number(event.target.value))}
            />
            <output>{tempo} BPM</output>
          </div>
        </label>
      </div>

      <div className="composer-actions" aria-label="Composer controls">
        <button
          type="button"
          className="metronome-toggle"
          aria-label={metronomeEnabled ? "Turn metronome off" : "Turn metronome on"}
          aria-pressed={metronomeEnabled}
          title={metronomeEnabled ? "Turn metronome off" : "Turn metronome on"}
          onClick={() => toggleMetronome(!metronomeEnabled)}
        >
          Metronome {metronomeEnabled ? "On" : "Off"}
        </button>
        <button
          type="button"
          className={isRecordLocked ? "record-button recording" : "record-button"}
          aria-label={isRecordLocked ? "Stop recording" : "Record"}
          onClick={toggleRecording}
        >
          {isRecordLocked ? (
            <SquareStop aria-hidden="true" size={18} />
          ) : (
            <CircleDot aria-hidden="true" size={18} />
          )}
          {isRecordLocked ? "Stop" : "Record"}
        </button>
        <span aria-live="polite">{recordStatus}</span>
      </div>

      {countIn !== null ? (
        <div className="count-in" aria-live="assertive">
          {countIn}
        </div>
      ) : null}

      <div className="hand-keys" aria-label="Keyboard input controls">
        <button
          type="button"
          className="hand-key left-hand"
          data-pressed={pressedHands.L ? "true" : "false"}
          ref={leftHitButtonRef}
          onClick={(event) => handleHitClick("L", event)}
          onPointerDown={(event) => handleHitPointerDown("L", event)}
          onPointerUp={(event) => releaseHitPointer("L", event)}
          onPointerCancel={(event) => releaseHitPointer("L", event)}
          onPointerLeave={(event) => releaseHitPointer("L", event)}
          title="Left hand"
        >
          <span>Press F key</span>
          <strong>Left</strong>
        </button>
        <button
          type="button"
          className="hand-key right-hand"
          data-pressed={pressedHands.R ? "true" : "false"}
          ref={rightHitButtonRef}
          onClick={(event) => handleHitClick("R", event)}
          onPointerDown={(event) => handleHitPointerDown("R", event)}
          onPointerUp={(event) => releaseHitPointer("R", event)}
          onPointerCancel={(event) => releaseHitPointer("R", event)}
          onPointerLeave={(event) => releaseHitPointer("R", event)}
          title="Right hand"
        >
          <span>Press J key</span>
          <strong>Right</strong>
        </button>
      </div>

      <div className="grid-scroll" aria-label="Editable rhythm grid" ref={gridScrollRef}>
        <div className="rhythm-grid composer-grid" style={gridShellStyle}>
          <div className="grid-row count-row composer-count-row" style={gridStyle}>
            <div className="track-name">Count</div>
            {labels.map((label, index) => (
              <div
                className={`step-cell count-cell ${selectedStep === index ? "active" : ""} ${
                  index % beatStepCount === 0 ? "beat-start" : ""
                }`}
                key={`${label}-${index}`}
                ref={(element) => {
                  countCellRefs.current[index] = element;
                }}
              >
                {label}
              </div>
            ))}
          </div>

          <div className="grid-row composer-step-row" style={gridStyle}>
            <div className="track-name">Alfaia</div>
            {displaySteps.map((symbol, index) => (
              <button
                type="button"
                className={`step-cell composer-cell ${
                  symbol === "." ? "rest-cell" : "hit-cell"
                } ${selectedStep === index ? "active" : ""} ${
                  index % beatStepCount === 0 ? "beat-start" : ""
                }`}
                aria-label={`Step ${index + 1}: ${symbol}`}
                aria-pressed={selectedStep === index}
                disabled={isRecordLocked}
                onClick={() => selectStep(index)}
                key={`${symbol}-${index}`}
              >
                {symbol}
              </button>
            ))}
          </div>
        </div>
      </div>

      <RhythmPlayer
        ref={previewPlayerRef}
        rhythm={rhythm}
        samples={previewSamples}
        editableNotes={!isRecordLocked}
        enableKeyboardShortcuts={false}
        patternBaseline={recordedTracks}
        patternDirty={!isRecordLocked && isPatternDirty}
        onPatternChange={handlePreviewPatternChange}
        onPatternReset={resetCurrentPattern}
        onTempoChange={updateTempo}
      />

      <div className="player-tip">
        <button
          type="button"
          className="player-tip-trigger"
          aria-expanded={showPlayerTip}
          aria-controls={PLAYER_TIP_ID}
          onClick={() => setShowPlayerTip((isVisible) => !isVisible)}
        >
          <Lightbulb aria-hidden="true" size={15} />
          <span>Tip</span>
        </button>
        <div
          className="player-tip-popover"
          id={PLAYER_TIP_ID}
          role="note"
          hidden={!showPlayerTip}
        >
          Try clicking on a note in the player. This will toggle the note.
        </div>
      </div>

      <label className="markdown-output">
        <span>Transcription</span>
        <textarea
          value={transcription}
          rows={15}
          aria-invalid={hasTranscriptionErrors}
          aria-describedby={
            hasTranscriptionErrors ? "composer-transcription-errors" : undefined
          }
          suppressHydrationWarning
          onChange={handleTranscriptionChange}
        />
      </label>

      {hasTranscriptionErrors ? (
        <div
          className="transcription-errors"
          id="composer-transcription-errors"
          role="alert"
        >
          <ul>
            {transcriptionErrors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <button
        type="button"
        className="shortcut-help-trigger"
        aria-haspopup="dialog"
        aria-expanded={showShortcutHelp}
        aria-controls="composer-shortcut-help"
        ref={shortcutHelpTriggerRef}
        onClick={() => setShowShortcutHelp(true)}
      >
        <Keyboard aria-hidden="true" size={15} />
        Shortcuts
      </button>

      {showShortcutHelp ? (
        <div
          className="shortcut-help-backdrop"
          onClick={(event) => closeShortcutHelp(event.detail === 0)}
        >
          <div
            className="shortcut-help-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="composer-shortcut-help-title"
            id="composer-shortcut-help"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="shortcut-help-header">
              <h2 id="composer-shortcut-help-title">Composer shortcuts</h2>
              <button
                type="button"
                aria-label="Close composer shortcuts"
                ref={shortcutHelpCloseButtonRef}
                onClick={(event) => closeShortcutHelp(event.detail === 0)}
              >
                <X aria-hidden="true" size={18} />
              </button>
            </div>

            <dl className="shortcut-list">
              <div>
                <dt>
                  <kbd>Space</kbd>
                </dt>
                <dd>Play or stop</dd>
              </div>
              <div>
                <dt>
                  <kbd>L</kbd>
                </dt>
                <dd>Toggle loop</dd>
              </div>
              <div>
                <dt>
                  <kbd>R</kbd>
                </dt>
                <dd>Start or stop recording</dd>
              </div>
              <div>
                <dt>
                  <kbd>M</kbd>
                </dt>
                <dd>Toggle metronome</dd>
              </div>
              <div>
                <dt>
                  <kbd>C</kbd>
                </dt>
                <dd>Clear grid</dd>
              </div>
              <div>
                <dt>
                  <kbd>+</kbd>
                  <kbd>=</kbd>
                </dt>
                <dd>Increase tempo</dd>
              </div>
              <div>
                <dt>
                  <kbd>-</kbd>
                </dt>
                <dd>Decrease tempo</dd>
              </div>
              <div>
                <dt>
                  <kbd>F</kbd>
                  <kbd>J</kbd>
                </dt>
                <dd>Add left or right hit</dd>
              </div>
              <div>
                <dt>
                  <kbd>Backspace</kbd>
                </dt>
                <dd>Clear selected step</dd>
              </div>
            </dl>
          </div>
        </div>
      ) : null}
    </section>
  );
}

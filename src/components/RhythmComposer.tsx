import { useTranslation } from "../lib/i18n/useTranslation";
import { errorMessage, type Message, type MessageKey } from "../lib/i18n/messages";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { Check, CircleDot, Keyboard, Pencil, Redo2, SquareStop, Undo2, X } from "lucide-react";
import ComposerGrid, { type ComposerSelection } from "./ComposerGrid";
import ShareRhythmControl from "./ShareRhythmControl";
import { readComposerDraft, type ComposerSnapshot } from "../lib/composerDraft";
import RhythmPlayer, { type RhythmPlayerHandle } from "./RhythmPlayer";
import { stepsPerBeat as getStepsPerBeat } from "../lib/countLabels";
import {
  blurPointerActivatedButton,
  shouldIgnoreKeyboardShortcut,
} from "../lib/keyboardShortcuts";
import { extractRhythmBlock } from "../lib/extractRhythmBlock";
import { formatRhythmBlock } from "../lib/formatRhythmBlock";
import { parseRhythm } from "../lib/parseRhythm";
import { sampleEntriesForRhythm, sampleMap } from "../lib/sampleMap";
import { MAX_TEMPO, MIN_TEMPO, clampTempo } from "../lib/tempo";
import { validateRhythmIssues } from "../lib/validateRhythm";
import type { Rhythm, RhythmTrack, Subdivision } from "../lib/rhythmTypes";

type RhythmComposerProps = {
  initialRhythm?: Rhythm;
  initialTranscription?: string;
  exampleRhythm: Rhythm;
  sharedSnapshot?: boolean;
};

type ComposerSymbol = "." | "L" | "R" | "B";
type HitSymbol = "L" | "R" | "B";
type HitInputSource = "touchstart" | "pointerdown" | "keyboard" | "click";
type BrowserWindowWithAudio = Window &
  typeof globalThis & {
    webkitAudioContext?: typeof AudioContext;
  };

const DEFAULT_SUBDIVISION: Subdivision = 16;
const DEFAULT_STEP_COUNT = getStepsPerBeat(DEFAULT_SUBDIVISION) * 4;
const DEFAULT_TITLE = "My rhythm";
const DEFAULT_DESCRIPTION = "A description.";
const DEFAULT_DIFFICULTY = "beginner";
const DEFAULT_TEMPO = 90;
const COMPOSER_TRACK_NAME = "Alfaia";
const PREVIEW_SAMPLES = {
  "Alfaia.L": sampleMap["Alfaia.L"],
  "Alfaia.R": sampleMap["Alfaia.R"],
  "Alfaia.B": sampleMap["Alfaia.B"],
};
const HIT_SAMPLE_URLS: Record<HitSymbol, string> = {
  L: sampleMap["Alfaia.L"],
  R: sampleMap["Alfaia.R"],
  B: sampleMap["Alfaia.B"],
};
const TEMPO_KEYBOARD_STEP = 1;
const MEDIA_HAS_CURRENT_DATA = 2;
const TOUCH_POINTER_DEDUPLICATION_WINDOW_MS = 120;


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

function formatMarkdown(
  tracks: RhythmTrack[],
  tempo: number,
  subdivision: Subdivision,
  title = DEFAULT_TITLE,
  description = DEFAULT_DESCRIPTION,
) {
  return [
    "---",
    `title: "${escapeYamlString(title)}"`,
    `tempo: ${tempo}`,
    `subdivision: ${subdivision}`,
    `difficulty: "${DEFAULT_DIFFICULTY}"`,
    "instruments:",
    ...tracks.map((track) => `  - "${escapeYamlString(track.name)}"`),
    "---",
    "",
    description,
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
    const errors = validateRhythmIssues({
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
      errors: [errorMessage(cause, "Unable to parse rhythm block.")],
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
    return [...tracks.map((track) => ({ ...track, steps: resizeTrackSteps(track.steps, steps.length) })), { name: COMPOSER_TRACK_NAME, steps }];
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

  if (key.toLowerCase() === "b") return "B";
  return null;
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

export default function RhythmComposer({
  initialRhythm,
  initialTranscription,
  exampleRhythm,
  sharedSnapshot = false,
}: RhythmComposerProps) {
  const { t, locale } = useTranslation();
  const initialTempo = clampTempo(initialRhythm?.tempo ?? DEFAULT_TEMPO);
  const subdivision = initialRhythm?.subdivision ?? exampleRhythm.subdivision;
  const [customTitle, setCustomTitle] = useState(initialRhythm?.title ?? "");
  const displayTitle = customTitle || t(DEFAULT_TITLE);
  const titleRef = useRef(customTitle);
  const [renaming, setRenaming] = useState(false);
  const [showPads, setShowPads] = useState(false);
  const [selectedTrack, setSelectedTrack] = useState(0);
  const selectedTrackRef = useRef(0);
  const [draftReady, setDraftReady] = useState(false);
  const [draftStatus, setDraftStatus] = useState<MessageKey>("Saving…");
  const draftKey = `baque-facil-composer-draft:${initialRhythm?.slug ?? "new"}`;
  const history = useRef<{ past: ComposerSnapshot[]; future: ComposerSnapshot[] }>({ past: [], future: [] });
  const [historyCounts, setHistoryCounts] = useState({ past: 0, future: 0 });
  const [tempo, setTempo] = useState(initialTempo);
  const [recordedTracks, setRecordedTracks] = useState<RhythmTrack[]>(() =>
    cloneTracks(initialRhythm?.tracks ?? defaultTracks()),
  );
  const [currentTracks, setCurrentTracks] = useState<RhythmTrack[]>(() =>
    cloneTracks(initialRhythm?.tracks ?? defaultTracks()),
  );
  const [recordingSteps, setRecordingSteps] = useState<ComposerSymbol[]>(() =>
    emptySteps(1),
  );
  const [transcription, setTranscription] = useState(() =>
    initialTranscription ??
    formatMarkdown(initialRhythm?.tracks ?? defaultTracks(), initialTempo, subdivision, displayTitle),
  );
  const [transcriptionErrors, setTranscriptionErrors] = useState<Message[]>([]);
  const [selectedStep, setSelectedStep] = useState(0);
  const [isRecording, setIsRecording] = useState(false);
  const [countIn, setCountIn] = useState<number | null>(null);
  const [metronomeEnabled, setMetronomeEnabled] = useState(false);
  const [recordStatus, setRecordStatus] = useState<MessageKey>("Ready");
  const [showShortcutHelp, setShowShortcutHelp] = useState(false);
  const [pressedHands, setPressedHands] = useState<Record<HitSymbol, boolean>>({
    L: false,
    R: false,
    B: false,
  });
  const recordedTracksRef = useRef(recordedTracks);
  const currentTracksRef = useRef(currentTracks);
  const recordingStepsRef = useRef(recordingSteps);
  const transcriptionRef = useRef(transcription);
  const generatedTemplateRef = useRef(formatMarkdown(defaultTracks(), initialTempo, subdivision));
  useEffect(() => {
    if (initialRhythm || initialTranscription) return;
    // Only translate a pristine generated template; never rewrite user-authored content.
    if (locale !== document.documentElement.lang) return;
    if (transcriptionRef.current !== generatedTemplateRef.current) return;
    const localized = formatMarkdown(defaultTracks(), initialTempo, subdivision, t(DEFAULT_TITLE), t(DEFAULT_DESCRIPTION));
    generatedTemplateRef.current = localized;
    transcriptionRef.current = localized;
    setTranscription(localized);
  }, [locale, t, initialRhythm, initialTranscription, initialTempo, subdivision]);
  const selectedStepRef = useRef(selectedStep);
  const tempoRef = useRef(tempo);
  const metronomeEnabledRef = useRef(metronomeEnabled);
  const shortcutHelpTriggerRef = useRef<HTMLButtonElement | null>(null);
  const shortcutHelpCloseButtonRef = useRef<HTMLButtonElement | null>(null);
  const previewPlayerRef = useRef<RhythmPlayerHandle | null>(null);
  const leftHitButtonRef = useRef<HTMLButtonElement | null>(null);
  const rightHitButtonRef = useRef<HTMLButtonElement | null>(null);
  const borderHitButtonRef = useRef<HTMLButtonElement | null>(null);
  const recordPanelRef = useRef<HTMLDivElement | null>(null);
  const handleHitTouchStartRef = useRef<
    (symbol: HitSymbol, event: TouchEvent) => void
  >(() => undefined);
  const releaseHitTouchRef = useRef<(symbol: HitSymbol, event: TouchEvent) => void>(
    () => undefined,
  );
  const composerAudioContextRef = useRef<AudioContext | null>(null);
  const hitBuffersRef = useRef<Partial<Record<HitSymbol, AudioBuffer>>>({});
  const hitBufferLoadPromiseRef = useRef<Promise<void> | null>(null);
  const hitAudioElementsRef = useRef<Partial<Record<HitSymbol, HTMLAudioElement>>>({});
  const activeHitPointerRef = useRef<Record<HitSymbol, number | null>>({ L: null, R: null, B: null });
  const activeHitPressRef = useRef<Record<HitSymbol, boolean>>({ L: false, R: false, B: false });
  const lastHitInputRef = useRef<
    Record<HitSymbol, { source: HitInputSource; inputTime: number } | null>
  >({ L: null, R: null, B: null });
  const suppressNextHitClickRef = useRef<Record<HitSymbol, boolean>>({ L: false, R: false, B: false });
  const suppressHitClickTimeoutRef = useRef<Record<HitSymbol, number | null>>({
    L: null,
    R: null,
    B: null,
  });
  const recordingTimerRef = useRef<number | null>(null);
  const countInTimerRef = useRef<number | null>(null);
  const elapsedRecordingStepsRef = useRef(0);
  const recordingStartTimeRef = useRef<number | null>(null);

  const beatStepCount = getStepsPerBeat(subdivision);
  const isRecordLocked = isRecording || countIn !== null;
  const stepCount = isRecordLocked ? recordingSteps.length : currentTracks[0]?.steps.length ?? DEFAULT_STEP_COUNT;
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
    options: { syncTranscription?: boolean; clearErrors?: boolean; remember?: boolean } = {},
  ) {
    const { syncTranscription = true, clearErrors = true, remember = true } = options;
    if (remember) rememberChange();
    const clonedTracks = cloneTracks(nextTracks);

    currentTracksRef.current = clonedTracks;
    setCurrentTracks(clonedTracks);
    const nextTrack = Math.min(selectedTrackRef.current, Math.max(0, clonedTracks.length - 1));
    const nextStep = Math.min(selectedStepRef.current, Math.max(0, (clonedTracks[nextTrack]?.steps.length ?? 1) - 1));
    selectedTrackRef.current = nextTrack;
    selectedStepRef.current = nextStep;
    setSelectedTrack(nextTrack);
    setSelectedStep(nextStep);

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
    rememberChange();
    applyRecordedTracks(nextTracks);
    applyCurrentTracks(nextTracks, { remember: false });
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
    if (isRecordLocked) return;
    rememberChange();
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

    applyCurrentTracks(tracks, { syncTranscription: false, remember: false });
  }

  function snapshot(): ComposerSnapshot {
    return { title: titleRef.current, tempo: tempoRef.current, transcription: transcriptionRef.current, tracks: cloneTracks(currentTracksRef.current), baseline: cloneTracks(recordedTracksRef.current) };
  }

  function rememberChange() {
    history.current.past = [...history.current.past.slice(-79), snapshot()];
    history.current.future = [];
    setHistoryCounts({ past: history.current.past.length, future: 0 });
  }

  function restoreSnapshot(value: ComposerSnapshot) {
    previewPlayerRef.current?.stop();
    titleRef.current = value.title;
    setCustomTitle(value.title);
    tempoRef.current = value.tempo;
    setTempo(value.tempo);
    applyRecordedTracks(value.baseline);
    applyCurrentTracks(value.tracks, { syncTranscription: false, remember: false });
    transcriptionRef.current = value.transcription;
    setTranscription(value.transcription);
    setTranscriptionErrors(parseTranscriptionTracks(value.transcription, value.tempo, subdivision).errors);
    selectedStepRef.current = 0;
    selectedTrackRef.current = 0;
    setSelectedStep(0);
    setSelectedTrack(0);
  }

  function travelHistory(direction: "past" | "future") {
    if (isRecordLocked) return;
    const value = history.current[direction].pop();
    if (!value) return;
    history.current[direction === "past" ? "future" : "past"].push(snapshot());
    restoreSnapshot(value);
    setHistoryCounts({ past: history.current.past.length, future: history.current.future.length });
  }

  useEffect(() => {
    if (sharedSnapshot) return;
    try {
      const value = readComposerDraft(localStorage.getItem(draftKey), subdivision);
      if (value) restoreSnapshot(value);
    } catch { /* Storage can be unavailable; saving below reports the failure. */ }
    setDraftReady(true);
    return () => {
      // A same-page shared link unmounts this editor without pagehide. Flush the
      // latest edit before the debounced save is canceled, preserving the draft.
      try {
        localStorage.setItem(draftKey, JSON.stringify({ ...snapshot(), version: 1, subdivision }));
      } catch { /* The save indicator already reports unavailable storage. */ }
    };
  }, [draftKey, sharedSnapshot]);

  useEffect(() => {
    if (!draftReady || sharedSnapshot) return;
    setDraftStatus("Saving…");
    const save = () => {
      try {
        localStorage.setItem(draftKey, JSON.stringify({ ...snapshot(), version: 1, subdivision }));
        setDraftStatus("Saved on this device");
      } catch { setDraftStatus("Changes could not be saved on this device."); }
    };
    const timer = window.setTimeout(save, 250);
    window.addEventListener("pagehide", save);
    return () => { window.clearTimeout(timer); window.removeEventListener("pagehide", save); };
  }, [draftReady, draftKey, transcription, tempo, customTitle, recordedTracks, subdivision, sharedSnapshot]);

  function renameTitle(value: string) {
    if (value === titleRef.current || isRecordLocked) return;
    rememberChange();
    titleRef.current = value;
    setCustomTitle(value);
    const line = `title: "${escapeYamlString(value || t(DEFAULT_TITLE))}"`;
    const next = /^title:.*$/m.test(transcriptionRef.current) ? transcriptionRef.current.replace(/^title:.*$/m, () => line) : transcriptionRef.current;
    transcriptionRef.current = next;
    setTranscription(next);
  }

  function selectCell(value: ComposerSelection) {
    selectedTrackRef.current = value.track;
    setSelectedTrack(value.track);
    selectStep(value.step);
  }

  function changeNote(value: ComposerSelection, symbol: string) {
    if (isRecordLocked) return;
    const tracks = cloneTracks(currentTracksRef.current);
    const track = tracks[value.track];
    if (!track || value.step >= track.steps.length) return;
    if (track.steps[value.step] !== symbol) {
      track.steps[value.step] = symbol;
      applyCurrentTracks(tracks);
    }
    previewPlayerRef.current?.previewNote(track.name, symbol);
  }

  function addBeat() {
    if (isRecordLocked) return;
    applyCurrentTracks(currentTracksRef.current.map((track) => ({ ...track, steps: [...track.steps, ...emptySteps(beatStepCount)] })));
  }

  function useExample() {
    if (isRecordLocked) return;
    rememberChange();
    restoreSnapshot({
      ...snapshot(),
      title: exampleRhythm.title,
      tempo: exampleRhythm.tempo,
      tracks: exampleRhythm.tracks,
      transcription: formatMarkdown(
        exampleRhythm.tracks,
        exampleRhythm.tempo,
        exampleRhythm.subdivision,
        exampleRhythm.title,
        "",
      ),
    });
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
    getHitAudioElement("B");
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
    status: MessageKey = "Stopped",
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
      const otherLength = Math.max(0, ...currentTracksRef.current.filter((track) => track.name !== COMPOSER_TRACK_NAME).map((track) => track.steps.length));
      const nextTracks = tracksWithComposerSteps(currentTracksRef.current, resizeSteps(trimmedSteps, Math.max(trimmedStepCount, otherLength)));

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

    previewPlayerRef.current?.stop();
    setShowPads(true);
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
      composerStepsFromTracks(currentTracksRef.current) ?? emptySteps(currentTracksRef.current[0]?.steps.length ?? DEFAULT_STEP_COUNT);
    const nextSteps =
      targetStep < currentComposerSteps.length
        ? [...currentComposerSteps]
        : resizeSteps(currentComposerSteps, targetStep + 1);

    nextSteps[targetStep] = symbol;
    selectedTrackRef.current = Math.max(0, currentTracksRef.current.findIndex((track) => track.name === COMPOSER_TRACK_NAME));
    setSelectedTrack(selectedTrackRef.current);
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

    const tracks = cloneTracks(currentTracksRef.current);
    const track = tracks[selectedTrackRef.current];
    if (!track || selectedStepRef.current >= track.steps.length) return;
    track.steps[selectedStepRef.current] = ".";
    applyCurrentTracks(tracks);
  }

  function clearGrid() {
    if (isRecordLocked) return;
    applyCurrentTracks(currentTracksRef.current.map((track) => ({ ...track, steps: emptySteps(track.steps.length) })));
    setSelectedStep(0);
    selectedStepRef.current = 0;
    setRecordStatus("Ready");
  }

  function updateTempo(value: number) {
    const clampedTempo = clampTempo(value, tempoRef.current);
    if (isRecordLocked || clampedTempo === tempoRef.current) return;
    rememberChange();

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
    activeHitPressRef.current.B = false;

    setPressedHands((currentHands) => {
      if (!currentHands.L && !currentHands.R && !currentHands.B) {
        return currentHands;
      }

      return { L: false, R: false, B: false };
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
    if (isRecording || !showPads) writeHit(symbol, inputTime);

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
      [borderHitButtonRef.current, "B"],
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
    if (showPads) recordPanelRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [showPads]);

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
      clearHitClickSuppressionTimeout("B");
    };
  }, []);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || document.querySelector(".composer-note-dialog[open]")) return;
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

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (!isRecordLocked) travelHistory(event.shiftKey ? "future" : "past");
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      const hitSymbol = hitSymbolForKeyboardKey(event.key);
      if (hitSymbol) {
        if (event.repeat) return;
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
    showPads,
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
      data-rendered-locale={locale}
      aria-label={t("Alfaia rhythm composer")}
      onClickCapture={(event) => blurPointerActivatedButton(event.target, event.detail)}
    >
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
        controlsLocked={isRecordLocked}
        exportRepetitions={1}
        exportDisabledReason={isRecordLocked
          ? "Stop recording before preparing an MP3."
          : hasTranscriptionErrors ? "Fix the transcription errors before preparing an MP3." : undefined}
        composerHeading={<div className="composer-heading">
          <p className="eyebrow">{t("Composer")}</p>
          <div className="composer-title-row">
            {renaming ? <input className="composer-title-input" aria-label={t("Rhythm name")} defaultValue={customTitle || t(DEFAULT_TITLE)} maxLength={200} autoFocus disabled={isRecordLocked}
              onBlur={(event) => { renameTitle(event.target.value.trim()); setRenaming(false); }}
              onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); if (event.key === "Escape") setRenaming(false); }} /> :
              <h1 aria-label={displayTitle}><button type="button" disabled={isRecordLocked} onClick={() => setRenaming(true)} aria-label={t("Rename rhythm")}>{displayTitle}<Pencil size={18} /></button></h1>}
            {!initialRhythm ? <button type="button" className="composer-example" disabled={isRecordLocked} onClick={useExample}>{t("Use an example")}</button> : null}
          </div>
          <p className="composer-save-status" role="status">{!sharedSnapshot && draftStatus === "Saved on this device" ? <Check size={16} /> : null}{t(sharedSnapshot ? "Shared snapshot. Share again to keep your changes." : draftStatus)}</p>
        </div>}
        toolbarExtra={<div className="composer-actions">
          <button type="button" className={isRecordLocked ? "record-button recording" : "record-button"}
            aria-label={t(countIn !== null ? "Cancel count-in" : isRecording ? "Stop recording" : showPads ? "Record" : "Record with pads")}
            onClick={() => { if (!showPads) setShowPads(true); else toggleRecording(); }}>
            {isRecordLocked ? <SquareStop size={18} /> : <CircleDot size={18} />}
            {t(countIn !== null ? "Cancel count-in" : isRecording ? "Stop recording" : showPads ? "Record" : "Record with pads")}
          </button>
        </div>}
        renderEditor={({ activeStep, reversed, mutedTracks, toggleMute }) => <>
          <div className="composer-edit-toolbar">
            <span aria-live="polite" className={isRecording ? "recording-status" : "composer-record-status"}>{isRecordLocked ? t(recordStatus) : t("Your rhythm")}{isRecording ? ` · ${Math.floor(selectedStep / beatStepCount)} ${t("beats")}` : ""}</span>
            <div className="composer-history">
              <button type="button" disabled={isRecordLocked || historyCounts.past === 0} onClick={() => travelHistory("past")}><Undo2 size={16} />{t("Undo")}</button>
              <button type="button" disabled={isRecordLocked || historyCounts.future === 0} onClick={() => travelHistory("future")}><Redo2 size={16} />{t("Redo")}</button>
              <details className="composer-more"><summary>{t("More")}</summary><div>
                <button type="button" disabled={isRecordLocked} onClick={clearGrid}>{t("Clear rhythm")}</button>
                <button type="button" disabled={isRecordLocked || !isPatternDirty} aria-label={t("Reset pattern")} onClick={resetCurrentPattern}>{t("Restore last take")}</button>
                {initialRhythm ? <button type="button" disabled={isRecordLocked} onClick={() => applyCurrentTracks(initialRhythm.tracks)}>{t("Restore original")}</button> : null}
              </div></details>
            </div>
          </div>
          {countIn !== null ? <div className="count-in" role="status"><span>{t("Get ready")}</span><strong>{countIn}</strong><span>{t("Recording starts after 3")}</span></div> : null}
          <ComposerGrid tracks={isRecordLocked ? tracksWithComposerSteps(currentTracks, resizeSteps(recordingSteps, Math.max(recordingSteps.length, currentTracks[0]?.steps.length ?? DEFAULT_STEP_COUNT))) : currentTracks}
            subdivision={subdivision} selection={{ track: selectedTrack, step: selectedStep }} activeStep={isRecording ? selectedStep : activeStep}
            recording={isRecording} locked={isRecordLocked} reversed={reversed} mutedTracks={mutedTracks} onMute={toggleMute}
            onSelect={selectCell} onChange={changeNote} onAddBeat={addBeat} />
          <div className="composer-record-panel" ref={recordPanelRef} hidden={!showPads}>
            <div className="composer-record-heading"><strong>{t("Record Alfaia")}</strong>
              <button type="button" className="metronome-toggle" aria-label={t(metronomeEnabled ? "Turn metronome off" : "Turn metronome on")} aria-pressed={metronomeEnabled} onClick={() => toggleMetronome(!metronomeEnabled)}>{t(metronomeEnabled ? "Metronome On" : "Metronome Off")}</button>
              <button type="button" disabled={isRecordLocked} aria-label={t("Close recording pads")} onClick={() => setShowPads(false)}><X size={18} /></button>
            </div>
            <div className="hand-keys" aria-label={t("Recording pads")}>
              {(["L", "R", "B"] as const).map((symbol) => <button key={symbol} type="button" className="hand-key" data-symbol={symbol} data-pressed={pressedHands[symbol] ? "true" : "false"}
                aria-label={t(symbol === "L" ? "Left hit" : symbol === "R" ? "Right hit" : "Border hit")}
                ref={symbol === "L" ? leftHitButtonRef : symbol === "R" ? rightHitButtonRef : borderHitButtonRef}
                onClick={(event) => handleHitClick(symbol, event)} onPointerDown={(event) => handleHitPointerDown(symbol, event)}
                onPointerUp={(event) => releaseHitPointer(symbol, event)} onPointerCancel={(event) => releaseHitPointer(symbol, event)} onPointerLeave={(event) => releaseHitPointer(symbol, event)}>
                <strong>{symbol}</strong><span>{t(symbol === "L" ? "Left" : symbol === "R" ? "Right" : "Border")}</span><kbd>{symbol === "L" ? "F" : symbol === "R" ? "J" : "B"}</kbd>
              </button>)}
            </div>
            <p>{t(isRecordLocked ? "Leave a gap for a rest." : "Try the pads, then press Record. Your previous take stays in Undo.")}</p>
          </div>
        </>}
      />
      <div className="composer-bottom-row">
        <ShareRhythmControl rhythm={rhythm} disabledReason={isRecordLocked
          ? "Stop recording before sharing a rhythm."
          : hasTranscriptionErrors ? "Fix the transcription errors before sharing a rhythm." : undefined} />
        <details className="composer-transcription">
          <summary>{t("Transcription")}</summary>
          <label className="markdown-output"><span className="sr-only">{t("Transcription")}</span><textarea value={transcription} rows={12} aria-invalid={hasTranscriptionErrors}
            aria-describedby={hasTranscriptionErrors ? "composer-transcription-errors" : undefined} disabled={isRecordLocked} suppressHydrationWarning onChange={handleTranscriptionChange} /></label>
        </details>
      </div>
      {hasTranscriptionErrors ? <div className="transcription-errors" id="composer-transcription-errors" role="alert"><p>{t("The grid and playback show your last valid transcription.")}</p><ul>{transcriptionErrors.map((error, index) => <li key={index}>{t(error)}</li>)}</ul></div> : null}

      <button
        type="button"
        className="shortcut-help-trigger"
        aria-haspopup="dialog"
        aria-expanded={showShortcutHelp}
        aria-controls="composer-shortcut-help"
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
            aria-labelledby="composer-shortcut-help-title"
            id="composer-shortcut-help"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="shortcut-help-header">
              <h2 id="composer-shortcut-help-title">{t("Composer shortcuts")}</h2>
              <button
                type="button"
                aria-label={t("Close composer shortcuts")}
                ref={shortcutHelpCloseButtonRef}
                onClick={(event) => closeShortcutHelp(event.detail === 0)}
              >
                <X aria-hidden="true" size={18} />
              </button>
            </div>

            <dl className="shortcut-list">
              <div><dt><kbd>Ctrl / ⌘ + Z</kbd></dt><dd>{t("Undo")}</dd></div>
              <div><dt><kbd>Ctrl / ⌘ + Shift + Z</kbd></dt><dd>{t("Redo")}</dd></div>
              <div>
                <dt>
                  <kbd>{t("Space")}</kbd>
                </dt>
                <dd>{t("Play or stop")}</dd>
              </div>
              <div>
                <dt>
                  <kbd>L</kbd>
                </dt>
                <dd>{t("Toggle loop")}</dd>
              </div>
              <div>
                <dt>
                  <kbd>R</kbd>
                </dt>
                <dd>{t("Start or stop recording")}</dd>
              </div>
              <div>
                <dt>
                  <kbd>M</kbd>
                </dt>
                <dd>{t("Toggle metronome")}</dd>
              </div>
              <div>
                <dt>
                  <kbd>C</kbd>
                </dt>
                <dd>{t("Clear grid")}</dd>
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
              <div>
                <dt>
                  <kbd>F</kbd>
                  <kbd>J</kbd>
                  <kbd>B</kbd>
                </dt>
                <dd>{t("Add left, right or border hit")}</dd>
              </div>
              <div>
                <dt>
                  <kbd>{t("Backspace")}</kbd>
                </dt>
                <dd>{t("Clear selected step")}</dd>
              </div>
            </dl>
          </div>
        </div>
      ) : null}
    </section>
  );
}

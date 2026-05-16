import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Keyboard, X } from "lucide-react";
import RhythmPlayer from "./RhythmPlayer";
import { countLabels, stepsPerBeat as getStepsPerBeat } from "../lib/countLabels";
import { sampleMap } from "../lib/sampleMap";
import { MAX_TEMPO, MIN_TEMPO, clampTempo } from "../lib/tempo";
import type { Rhythm, Subdivision } from "../lib/rhythmTypes";

type ComposerSymbol = "." | "L" | "R";
type HitSymbol = Exclude<ComposerSymbol, ".">;
type Difficulty = "beginner" | "intermediate" | "advanced";
type BrowserWindowWithAudio = Window &
  typeof globalThis & {
    webkitAudioContext?: typeof AudioContext;
  };

const DEFAULT_RECORDING_BEATS = 4;
const MIN_RECORDING_BEATS = 1;
const MAX_RECORDING_BEATS = 64;
const DEFAULT_SUBDIVISION: Subdivision = 16;
const SUBDIVISIONS: Subdivision[] = [8, 16, 32];
const DEFAULT_TITLE = "Untitled Alfaia Rhythm";
const DEFAULT_DESCRIPTION = "Short teacher-facing description.";
const PREVIEW_SAMPLES = {
  "Alfaia.L": sampleMap["Alfaia.L"],
  "Alfaia.R": sampleMap["Alfaia.R"],
};
const HIT_SAMPLE_URLS: Record<HitSymbol, string> = {
  L: sampleMap["Alfaia.L"],
  R: sampleMap["Alfaia.R"],
};
const HIT_SAMPLE_POOL_SIZE = 4;
const TEMPO_KEYBOARD_STEP = 1;

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

function formatStepGroups(steps: ComposerSymbol[], groupSize: number) {
  const groups: string[] = [];

  for (let index = 0; index < steps.length; index += groupSize) {
    groups.push(steps.slice(index, index + groupSize).join(" "));
  }

  return groups.join(" | ");
}

function shouldIgnoreKeyboardTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return (
    target.isContentEditable ||
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT"
  );
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

function clampRecordingBeats(value: number) {
  if (!Number.isFinite(value)) {
    return DEFAULT_RECORDING_BEATS;
  }

  return Math.min(MAX_RECORDING_BEATS, Math.max(MIN_RECORDING_BEATS, Math.round(value)));
}

function isSubdivision(value: number): value is Subdivision {
  return SUBDIVISIONS.includes(value as Subdivision);
}

export default function RhythmComposer() {
  const [title, setTitle] = useState(DEFAULT_TITLE);
  const [tempo, setTempo] = useState(90);
  const [difficulty, setDifficulty] = useState<Difficulty>("beginner");
  const [recordingBeats, setRecordingBeats] = useState(DEFAULT_RECORDING_BEATS);
  const [subdivision, setSubdivision] = useState<Subdivision>(DEFAULT_SUBDIVISION);
  const [steps, setSteps] = useState<ComposerSymbol[]>(() =>
    emptySteps(DEFAULT_RECORDING_BEATS * getStepsPerBeat(DEFAULT_SUBDIVISION)),
  );
  const [selectedStep, setSelectedStep] = useState(0);
  const [isRecording, setIsRecording] = useState(false);
  const [countIn, setCountIn] = useState<number | null>(null);
  const [metronomeEnabled, setMetronomeEnabled] = useState(false);
  const [recordStatus, setRecordStatus] = useState("Ready");
  const [copyStatus, setCopyStatus] = useState("");
  const [showShortcutHelp, setShowShortcutHelp] = useState(false);
  const [pressedHands, setPressedHands] = useState<Record<HitSymbol, boolean>>({
    L: false,
    R: false,
  });
  const selectedStepRef = useRef(selectedStep);
  const tempoRef = useRef(tempo);
  const metronomeEnabledRef = useRef(metronomeEnabled);
  const shortcutHelpTriggerRef = useRef<HTMLButtonElement | null>(null);
  const shortcutHelpCloseButtonRef = useRef<HTMLButtonElement | null>(null);
  const metronomeContextRef = useRef<AudioContext | null>(null);
  const hitAudioRef = useRef<Record<HitSymbol, HTMLAudioElement[]> | null>(null);
  const hitAudioIndexRef = useRef<Record<HitSymbol, number>>({ L: 0, R: 0 });
  const recordingTimerRef = useRef<number | null>(null);
  const countInTimerRef = useRef<number | null>(null);
  const elapsedRecordingStepsRef = useRef(0);

  const stepCount = steps.length;
  const beatStepCount = getStepsPerBeat(subdivision);
  const allocatedStepCount = recordingBeats * beatStepCount;
  const labels = useMemo(() => countLabels(stepCount, subdivision), [stepCount, subdivision]);
  const gridStyle = useMemo(
    () =>
      ({
        gridTemplateColumns: `minmax(6rem, 7rem) repeat(${stepCount}, minmax(2.5rem, 1fr))`,
      }) as CSSProperties,
    [stepCount],
  );
  const displayTitle = title.trim() || DEFAULT_TITLE;
  const isRecordLocked = isRecording || countIn !== null;

  const rhythm = useMemo<Rhythm>(
    () => ({
      title: displayTitle,
      slug: "compose-preview",
      tempo,
      subdivision,
      tracks: [
        {
          name: "Alfaia",
          steps,
        },
      ],
    }),
    [displayTitle, subdivision, tempo, steps],
  );

  const markdown = useMemo(
    () =>
      [
        "---",
        `title: "${escapeYamlString(displayTitle)}"`,
        `tempo: ${tempo}`,
        `subdivision: ${subdivision}`,
        `difficulty: "${difficulty}"`,
        "instruments:",
        '  - "Alfaia"',
        "---",
        "",
        DEFAULT_DESCRIPTION,
        "",
        "```rhythm",
        "Alfaia:",
        formatStepGroups(steps, beatStepCount),
        "```",
        "",
      ].join("\n"),
    [beatStepCount, difficulty, displayTitle, steps, subdivision, tempo],
  );

  async function ensureMetronomeContext() {
    const AudioContextConstructor =
      window.AudioContext ?? (window as BrowserWindowWithAudio).webkitAudioContext;

    if (!AudioContextConstructor) {
      return null;
    }

    const context = metronomeContextRef.current ?? new AudioContextConstructor();
    metronomeContextRef.current = context;

    if (context.state === "suspended") {
      await context.resume();
    }

    return context;
  }

  async function prepareMetronome() {
    if (!metronomeEnabledRef.current) {
      return;
    }

    try {
      await ensureMetronomeContext();
    } catch {
      setMetronomeEnabled(false);
      metronomeEnabledRef.current = false;
    }
  }

  function playMetronomeClick(isFirstBeat = false) {
    if (!metronomeEnabledRef.current) {
      return;
    }

    const context = metronomeContextRef.current;
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

  function getHitAudioPool(symbol: HitSymbol) {
    if (!hitAudioRef.current) {
      hitAudioRef.current = { L: [], R: [] };
    }

    if (hitAudioRef.current[symbol].length === 0) {
      hitAudioRef.current[symbol] = Array.from({ length: HIT_SAMPLE_POOL_SIZE }, () => {
        const audio = new Audio(HIT_SAMPLE_URLS[symbol]);
        audio.preload = "auto";
        audio.load();
        return audio;
      });
    }

    return hitAudioRef.current[symbol];
  }

  function playHitSound(symbol: HitSymbol) {
    const pool = getHitAudioPool(symbol);
    const audioIndex = hitAudioIndexRef.current[symbol] % pool.length;
    const audio = pool[audioIndex];

    hitAudioIndexRef.current[symbol] = audioIndex + 1;

    try {
      audio.currentTime = 0;
    } catch {
      // The sample can still play even if the browser has not exposed seekable metadata yet.
    }

    void audio.play().catch(() => undefined);
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

  function stopRecording(status = "Stopped", shouldTrimTake = false) {
    clearCountInTimer();
    clearRecordingTimer();

    if (shouldTrimTake) {
      const trimmedStepCount = Math.min(selectedStepRef.current + 1, allocatedStepCount);
      const nextSelectedStep = Math.max(0, trimmedStepCount - 1);

      setSteps((currentSteps) => currentSteps.slice(0, trimmedStepCount));
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
      stopRecording("Stopped", true);
    }
  }

  function beginRecordingTake() {
    const recordingStepCount = allocatedStepCount;
    const recordingStepsPerBeat = beatStepCount;

    clearCountInTimer();
    setSteps(emptySteps(recordingStepCount));
    setCountIn(null);
    setSelectedStep(0);
    selectedStepRef.current = 0;
    elapsedRecordingStepsRef.current = 0;
    setIsRecording(true);
    setRecordStatus("Recording");
    playMetronomeClick(true);

    recordingTimerRef.current = window.setInterval(() => {
      elapsedRecordingStepsRef.current += 1;

      if (elapsedRecordingStepsRef.current >= recordingStepCount) {
        selectedStepRef.current = 0;
        setSelectedStep(0);
        stopRecording("Take complete");
        return;
      }

      const nextStep = elapsedRecordingStepsRef.current;
      selectedStepRef.current = nextStep;
      setSelectedStep(nextStep);

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
    elapsedRecordingStepsRef.current = 0;
    setIsRecording(false);
    setCountIn(1);
    setRecordStatus("Count-in");

    void prepareMetronome().then(() => playMetronomeClick(false));

    let nextCount = 2;
    countInTimerRef.current = window.setInterval(() => {
      if (nextCount <= 3) {
        setCountIn(nextCount);
        playMetronomeClick(false);
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

  function writeHit(symbol: HitSymbol) {
    if (countIn !== null) {
      return;
    }

    const targetStep = selectedStepRef.current;

    if (targetStep < 0 || targetStep >= stepCount) {
      return;
    }

    playHitSound(symbol);

    setSteps((currentSteps) => {
      if (targetStep >= currentSteps.length) {
        return currentSteps;
      }

      const nextSteps = [...currentSteps];
      nextSteps[targetStep] = symbol;
      return nextSteps;
    });
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

    setSteps((currentSteps) => {
      const nextSteps = [...currentSteps];
      nextSteps[selectedStep] = ".";
      return nextSteps;
    });
  }

  function updateTempo(value: number) {
    const clampedTempo = clampTempo(value, tempoRef.current);

    tempoRef.current = clampedTempo;
    setTempo(clampedTempo);
  }

  function resizeGrid(nextStepCount: number) {
    setSteps((currentSteps) => resizeSteps(currentSteps, nextStepCount));
    setSelectedStep((currentStep) => {
      const nextStep = Math.min(currentStep, nextStepCount - 1);
      selectedStepRef.current = nextStep;
      return nextStep;
    });
  }

  function updateRecordingBeats(value: number) {
    if (isRecordLocked) {
      return;
    }

    const nextRecordingBeats = clampRecordingBeats(value);
    setRecordingBeats(nextRecordingBeats);
    resizeGrid(nextRecordingBeats * beatStepCount);
  }

  function updateSubdivision(value: number) {
    if (isRecordLocked || !isSubdivision(value)) {
      return;
    }

    setSubdivision(value);
    resizeGrid(recordingBeats * getStepsPerBeat(value));
  }

  function clearGrid() {
    if (isRecordLocked) {
      return;
    }

    setSteps(emptySteps(allocatedStepCount));
    setSelectedStep(0);
    selectedStepRef.current = 0;
    setRecordStatus("Ready");
  }

  function selectStep(index: number) {
    if (isRecordLocked) {
      return;
    }

    setSelectedStep(index);
    selectedStepRef.current = index;
  }

  async function copyMarkdown() {
    try {
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(markdown);
      } else {
        const textarea = document.createElement("textarea");
        textarea.value = markdown;
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.append(textarea);
        textarea.select();
        document.execCommand("copy");
        textarea.remove();
      }

      setCopyStatus("Copied");
    } catch {
      setCopyStatus("Copy failed");
    }
  }

  function toggleMetronome(enabled: boolean) {
    setMetronomeEnabled(enabled);
    metronomeEnabledRef.current = enabled;

    if (enabled) {
      void ensureMetronomeContext();
    }
  }

  function setHandPressed(symbol: HitSymbol, isPressed: boolean) {
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
    setPressedHands((currentHands) => {
      if (!currentHands.L && !currentHands.R) {
        return currentHands;
      }

      return { L: false, R: false };
    });
  }

  useEffect(() => {
    if (!copyStatus) {
      return;
    }

    const timeout = window.setTimeout(() => setCopyStatus(""), 1800);
    return () => window.clearTimeout(timeout);
  }, [copyStatus]);

  useEffect(() => {
    selectedStepRef.current = selectedStep;
  }, [selectedStep]);

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
    return () => {
      clearCountInTimer();
      clearRecordingTimer();

      const context = metronomeContextRef.current;
      if (context && context.state !== "closed") {
        void context.close();
      }

      if (hitAudioRef.current) {
        Object.values(hitAudioRef.current)
          .flat()
          .forEach((audio) => {
            audio.pause();
            audio.removeAttribute("src");
            audio.load();
          });
      }
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

      if (shouldIgnoreKeyboardTarget(event.target)) {
        return;
      }

      if (event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }

      const hitSymbol = hitSymbolForKeyboardKey(event.key);
      if (hitSymbol) {
        event.preventDefault();
        setHandPressed(hitSymbol, true);
        writeHit(hitSymbol);
        return;
      }

      const key = event.key.toLowerCase();

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
    allocatedStepCount,
    beatStepCount,
    isRecordLocked,
    selectedStep,
    showShortcutHelp,
    stepCount,
    subdivision,
    tempo,
  ]);

  function closeShortcutHelp() {
    setShowShortcutHelp(false);
    window.setTimeout(() => shortcutHelpTriggerRef.current?.focus(), 0);
  }

  return (
    <section className="composer-panel" aria-label="Alfaia rhythm composer">
      <div className="composer-meta">
        <label>
          <span>Title</span>
          <input
            type="text"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>

        <label>
          <span>Tempo</span>
          <input
            type="number"
            min={MIN_TEMPO}
            max={MAX_TEMPO}
            disabled={isRecordLocked}
            value={tempo}
            onChange={(event) => updateTempo(Number(event.target.value))}
          />
        </label>

        <label>
          <span>Beats</span>
          <input
            type="number"
            min={MIN_RECORDING_BEATS}
            max={MAX_RECORDING_BEATS}
            disabled={isRecordLocked}
            value={recordingBeats}
            onChange={(event) => updateRecordingBeats(Number(event.target.value))}
          />
        </label>

        <label>
          <span>Subdivision</span>
          <select
            disabled={isRecordLocked}
            value={subdivision}
            onChange={(event) => updateSubdivision(Number(event.target.value))}
          >
            {SUBDIVISIONS.map((value) => (
              <option value={value} key={value}>
                {value}th notes
              </option>
            ))}
          </select>
        </label>

        <label>
          <span>Difficulty</span>
          <select
            value={difficulty}
            onChange={(event) => setDifficulty(event.target.value as Difficulty)}
          >
            <option value="beginner">beginner</option>
            <option value="intermediate">intermediate</option>
            <option value="advanced">advanced</option>
          </select>
        </label>
      </div>

      <div className="composer-actions" aria-label="Composer controls">
        <button
          type="button"
          className="metronome-toggle"
          aria-pressed={metronomeEnabled}
          onClick={() => toggleMetronome(!metronomeEnabled)}
        >
          Metronome {metronomeEnabled ? "on" : "off"}
        </button>
        <button
          type="button"
          className={isRecording ? "record-button recording" : "record-button"}
          onClick={startRecording}
          disabled={isRecordLocked}
        >
          {isRecording ? "Recording" : countIn === null ? "Record take" : "Counting in"}
        </button>
        <button
          type="button"
          onClick={stopActiveRecording}
          disabled={!isRecordLocked}
        >
          Stop recording
        </button>
        <button type="button" onClick={clearGrid} disabled={isRecordLocked}>
          Clear grid
        </button>
        <button type="button" onClick={copyMarkdown}>
          Copy Markdown
        </button>
        <span aria-live="polite">{copyStatus || recordStatus}</span>
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
          onClick={() => writeHit("L")}
          onPointerDown={() => setHandPressed("L", true)}
          onPointerUp={() => setHandPressed("L", false)}
          onPointerCancel={() => setHandPressed("L", false)}
          onPointerLeave={() => setHandPressed("L", false)}
          title="Left hand"
        >
          <span>Press F key</span>
          <strong>Left</strong>
        </button>
        <button
          type="button"
          className="hand-key right-hand"
          data-pressed={pressedHands.R ? "true" : "false"}
          onClick={() => writeHit("R")}
          onPointerDown={() => setHandPressed("R", true)}
          onPointerUp={() => setHandPressed("R", false)}
          onPointerCancel={() => setHandPressed("R", false)}
          onPointerLeave={() => setHandPressed("R", false)}
          title="Right hand"
        >
          <span>Press J key</span>
          <strong>Right</strong>
        </button>
      </div>

      <div className="grid-scroll" aria-label="Editable rhythm grid">
        <div className="rhythm-grid composer-grid">
          <div className="grid-row count-row composer-count-row" style={gridStyle}>
            <div className="track-name">Count</div>
            {labels.map((label, index) => (
              <div
                className={`step-cell count-cell ${selectedStep === index ? "active" : ""} ${
                  index % beatStepCount === 0 ? "beat-start" : ""
                }`}
                key={`${label}-${index}`}
              >
                {label}
              </div>
            ))}
          </div>

          <div className="grid-row composer-step-row" style={gridStyle}>
            <div className="track-name">Alfaia</div>
            {steps.map((symbol, index) => (
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
        rhythm={rhythm}
        samples={PREVIEW_SAMPLES}
        enableKeyboardShortcuts={false}
        onTempoChange={updateTempo}
      />

      <label className="markdown-output">
        <span>Markdown</span>
        <textarea readOnly value={markdown} rows={15} />
      </label>

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
        <div className="shortcut-help-backdrop" onClick={closeShortcutHelp}>
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
                onClick={closeShortcutHelp}
              >
                <X aria-hidden="true" size={18} />
              </button>
            </div>

            <dl className="shortcut-list">
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

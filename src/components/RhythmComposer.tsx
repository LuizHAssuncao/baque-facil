import { useEffect, useMemo, useRef, useState } from "react";
import RhythmPlayer from "./RhythmPlayer";
import { countLabels } from "../lib/countLabels";
import { sampleMap } from "../lib/sampleMap";
import type { Rhythm } from "../lib/rhythmTypes";

type ComposerSymbol = "." | "L" | "R";
type Difficulty = "beginner" | "intermediate" | "advanced";

const STEP_COUNT = 16;
const DEFAULT_TITLE = "Untitled Alfaia Rhythm";
const DEFAULT_DESCRIPTION = "Short teacher-facing description.";
const PREVIEW_SAMPLES = {
  "Alfaia.L": sampleMap["Alfaia.L"],
  "Alfaia.R": sampleMap["Alfaia.R"],
};

function emptySteps() {
  return Array.from({ length: STEP_COUNT }, () => "." as ComposerSymbol);
}

function moveIndex(index: number, offset: number) {
  return (index + offset + STEP_COUNT) % STEP_COUNT;
}

function recordingStepDuration(tempo: number) {
  return 60_000 / tempo / 4;
}

function escapeYamlString(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function formatStepGroups(steps: ComposerSymbol[]) {
  const groups: string[] = [];

  for (let index = 0; index < steps.length; index += 4) {
    groups.push(steps.slice(index, index + 4).join(" "));
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

function clampTempo(value: number) {
  if (!Number.isFinite(value)) {
    return 90;
  }

  return Math.min(150, Math.max(50, Math.round(value)));
}

export default function RhythmComposer() {
  const [title, setTitle] = useState(DEFAULT_TITLE);
  const [tempo, setTempo] = useState(90);
  const [difficulty, setDifficulty] = useState<Difficulty>("beginner");
  const [steps, setSteps] = useState<ComposerSymbol[]>(() => emptySteps());
  const [selectedStep, setSelectedStep] = useState(0);
  const [isRecording, setIsRecording] = useState(false);
  const [recordStatus, setRecordStatus] = useState("Ready");
  const [copyStatus, setCopyStatus] = useState("");
  const selectedStepRef = useRef(selectedStep);
  const recordingTimerRef = useRef<number | null>(null);
  const elapsedRecordingStepsRef = useRef(0);

  const labels = useMemo(() => countLabels(STEP_COUNT), []);
  const displayTitle = title.trim() || DEFAULT_TITLE;

  const rhythm = useMemo<Rhythm>(
    () => ({
      title: displayTitle,
      slug: "compose-preview",
      tempo,
      subdivision: 16,
      tracks: [
        {
          name: "Alfaia",
          steps,
        },
      ],
    }),
    [displayTitle, tempo, steps],
  );

  const markdown = useMemo(
    () =>
      [
        "---",
        `title: "${escapeYamlString(displayTitle)}"`,
        `tempo: ${tempo}`,
        "subdivision: 16",
        `difficulty: "${difficulty}"`,
        "instruments:",
        '  - "Alfaia"',
        "---",
        "",
        DEFAULT_DESCRIPTION,
        "",
        "```rhythm",
        "Alfaia:",
        formatStepGroups(steps),
        "```",
        "",
      ].join("\n"),
    [difficulty, displayTitle, steps, tempo],
  );

  function clearRecordingTimer() {
    if (recordingTimerRef.current !== null) {
      window.clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
  }

  function stopRecording(status = "Stopped") {
    clearRecordingTimer();
    setIsRecording(false);
    setRecordStatus(status);
  }

  function startRecording() {
    clearRecordingTimer();
    setSteps(emptySteps());
    setSelectedStep(0);
    selectedStepRef.current = 0;
    elapsedRecordingStepsRef.current = 0;
    setIsRecording(true);
    setRecordStatus("Recording");

    recordingTimerRef.current = window.setInterval(() => {
      elapsedRecordingStepsRef.current += 1;

      if (elapsedRecordingStepsRef.current >= STEP_COUNT) {
        selectedStepRef.current = 0;
        setSelectedStep(0);
        stopRecording("Take complete");
        return;
      }

      setSelectedStep((currentStep) => {
        const nextStep = moveIndex(currentStep, 1);
        selectedStepRef.current = nextStep;
        return nextStep;
      });
    }, recordingStepDuration(tempo));
  }

  function writeHit(symbol: Exclude<ComposerSymbol, ".">) {
    const targetStep = selectedStepRef.current;

    setSteps((currentSteps) => {
      const nextSteps = [...currentSteps];
      nextSteps[targetStep] = symbol;
      return nextSteps;
    });
  }

  function moveSelectedStep(offset: number) {
    setSelectedStep((currentStep) => {
      const nextStep = moveIndex(currentStep, offset);
      selectedStepRef.current = nextStep;
      return nextStep;
    });
  }

  function clearSelectedStep() {
    if (isRecording) {
      return;
    }

    setSteps((currentSteps) => {
      const nextSteps = [...currentSteps];
      nextSteps[selectedStep] = ".";
      return nextSteps;
    });
  }

  function updateTempo(value: number) {
    setTempo(clampTempo(value));
  }

  function clearGrid() {
    if (isRecording) {
      return;
    }

    setSteps(emptySteps());
    setSelectedStep(0);
    selectedStepRef.current = 0;
    setRecordStatus("Ready");
  }

  function selectStep(index: number) {
    if (isRecording) {
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
    return () => clearRecordingTimer();
  }, []);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (shouldIgnoreKeyboardTarget(event.target)) {
        return;
      }

      if (event.key === "f" || event.key === "F") {
        event.preventDefault();
        writeHit("L");
        return;
      }

      if (event.key === "j" || event.key === "J") {
        event.preventDefault();
        writeHit("R");
        return;
      }

      if (event.key === "Backspace") {
        event.preventDefault();
        clearSelectedStep();
        return;
      }

      if (event.key === "ArrowLeft") {
        event.preventDefault();
        if (isRecording) {
          return;
        }
        moveSelectedStep(-1);
        return;
      }

      if (event.key === "ArrowRight") {
        event.preventDefault();
        if (isRecording) {
          return;
        }
        moveSelectedStep(1);
        return;
      }

      if (event.key === "ArrowUp") {
        event.preventDefault();
        if (isRecording) {
          return;
        }
        moveSelectedStep(-4);
        return;
      }

      if (event.key === "ArrowDown") {
        event.preventDefault();
        if (isRecording) {
          return;
        }
        moveSelectedStep(4);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isRecording, selectedStep]);

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
            min="50"
            max="150"
            disabled={isRecording}
            value={tempo}
            onChange={(event) => updateTempo(Number(event.target.value))}
          />
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
          className={isRecording ? "record-button recording" : "record-button"}
          onClick={startRecording}
          disabled={isRecording}
        >
          {isRecording ? "Recording" : "Record take"}
        </button>
        <button
          type="button"
          onClick={() => stopRecording()}
          disabled={!isRecording}
        >
          Stop recording
        </button>
        <button type="button" onClick={clearGrid} disabled={isRecording}>
          Clear grid
        </button>
        <button type="button" onClick={copyMarkdown}>
          Copy Markdown
        </button>
        <span aria-live="polite">{copyStatus || recordStatus}</span>
      </div>

      <div className="hand-keys" aria-label="Keyboard input controls">
        <button
          type="button"
          className="hand-key left-hand"
          onClick={() => writeHit("L")}
          title="Left hand"
        >
          <span>F</span>
          <strong>L</strong>
        </button>
        <button
          type="button"
          className="hand-key right-hand"
          onClick={() => writeHit("R")}
          title="Right hand"
        >
          <span>J</span>
          <strong>R</strong>
        </button>
      </div>

      <div className="grid-scroll" aria-label="Editable rhythm grid">
        <div className="rhythm-grid composer-grid">
          <div className="grid-row count-row composer-count-row">
            <div className="track-name">Count</div>
            {labels.map((label, index) => (
              <div
                className={`step-cell count-cell ${selectedStep === index ? "active" : ""} ${
                  index % 4 === 0 ? "beat-start" : ""
                }`}
                key={`${label}-${index}`}
              >
                {label}
              </div>
            ))}
          </div>

          <div className="grid-row composer-step-row">
            <div className="track-name">Alfaia</div>
            {steps.map((symbol, index) => (
              <button
                type="button"
                className={`step-cell composer-cell ${
                  symbol === "." ? "rest-cell" : "hit-cell"
                } ${selectedStep === index ? "active" : ""} ${
                  index % 4 === 0 ? "beat-start" : ""
                }`}
                aria-label={`Step ${index + 1}: ${symbol}`}
                aria-pressed={selectedStep === index}
                disabled={isRecording}
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
        onTempoChange={updateTempo}
      />

      <label className="markdown-output">
        <span>Markdown</span>
        <textarea readOnly value={markdown} rows={15} />
      </label>
    </section>
  );
}

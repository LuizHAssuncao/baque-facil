import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Check, Headphones, Play, RotateCcw, SkipForward, Square } from "lucide-react";
import { useRenderedPlayback } from "../lib/audio/useRenderedPlayback";
import type { RenderedPlayback } from "../lib/audio/renderedPlayback";
import { createQuizRound, QUIZ_TEMPO, type QuizLibrary, type QuizRound } from "../lib/rhythmQuiz";
import type { Rhythm } from "../lib/rhythmTypes";
import type { SampleMap } from "../lib/sampleMap";

type OptionProps = {
  rhythm: Rhythm;
  samples: SampleMap;
  label: string;
  answered: boolean;
  result: "correct" | "retry" | undefined;
  onPlay: (player: RenderedPlayback) => void;
  onChoose: () => void;
};

function AudioOption({ rhythm, samples, label, answered, result, onPlay, onChoose }: OptionProps) {
  const request = useMemo(() => ({
    // Media controls must not reveal the rhythm's name either.
    rhythm: { ...rhythm, title: `Option ${label}` },
    samples,
    tempo: QUIZ_TEMPO,
    loop: false,
    mutedTracks: [],
  }), [rhythm, samples, label]);
  const { controller, snapshot } = useRenderedPlayback(true, request);
  const [hasPlayed, setHasPlayed] = useState(false);
  const preparing = snapshot.preparing && !snapshot.ready;
  const action = preparing ? "Preparing" : snapshot.playing ? "Stop" : snapshot.error ? "Retry" : hasPlayed ? "Replay" : "Play";
  const Icon = snapshot.playing ? Square : snapshot.error || hasPlayed ? RotateCcw : Play;

  return (
    <li className="quiz-option" data-result={result} data-playing={snapshot.playing || undefined}>
      <span className="quiz-option-label" aria-hidden="true">{label}</span>
      <button
        className="quiz-button quiz-play"
        type="button"
        aria-label={`${action} audio ${label}`}
        disabled={preparing}
        onClick={() => {
          const player = controller.current;
          if (!player) return;
          if (snapshot.playing) player.stop();
          else {
            onPlay(player);
            player.play();
            if (snapshot.ready) setHasPlayed(true);
          }
        }}
      >
        <Icon size={19} aria-hidden="true" />
        {action}
      </button>
      <button
        className="quiz-button quiz-choose"
        type="button"
        aria-label={result === "correct" ? `Option ${label} is correct` : `Choose option ${label}`}
        disabled={answered || !snapshot.ready || Boolean(snapshot.error)}
        onClick={onChoose}
      >
        {result === "correct" ? <><Check size={18} aria-hidden="true" /> Matched</> : "Choose this"}
      </button>
      {snapshot.error && <p className="quiz-audio-error" role="alert">Audio {label} couldn’t play. Tap Retry to try again.</p>}
    </li>
  );
}

function PracticeRound({ round, samples, focusPrompt, onNext, onPlay, onStop }: {
  round: QuizRound;
  samples: SampleMap;
  focusPrompt: boolean;
  onNext: () => void;
  onPlay: (player: RenderedPlayback) => void;
  onStop: () => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const prompt = useRef<HTMLHeadingElement>(null);
  const answered = selected === round.prompt.slug;

  useEffect(() => {
    if (focusPrompt) prompt.current?.focus({ preventScroll: true });
  }, [focusPrompt]);

  return (
    <section className="quiz-practice" aria-labelledby="quiz-prompt">
      <div className="quiz-prompt-panel">
        <Headphones size={24} aria-hidden="true" />
        <p className="eyebrow">Which audio matches?</p>
        <h2 id="quiz-prompt" ref={prompt} tabIndex={-1}>{round.prompt.title}</h2>
      </div>
      <p className="quiz-listen-hint">Listen as often as you like, then choose.</p>
      <ol className="quiz-options" aria-label="Audio options">
        {round.options.map((rhythm, index) => (
          <AudioOption
            key={rhythm.slug}
            rhythm={rhythm}
            samples={samples}
            label={String.fromCharCode(65 + index)}
            answered={answered}
            result={selected === rhythm.slug ? answered ? "correct" : "retry" : undefined}
            onPlay={onPlay}
            onChoose={() => { onStop(); setSelected(rhythm.slug); }}
          />
        ))}
      </ol>
      <div className="quiz-footer">
        <p className="quiz-feedback" role="status" data-correct={answered || undefined}>
          {answered ? <><Check size={20} aria-hidden="true" /> That’s it!</> : selected ? "Give it another listen." : "Take your time."}
        </p>
        <button className={`quiz-button ${answered ? "quiz-next" : "quiz-skip"}`} type="button" onClick={onNext}>
          {answered ? <>Next rhythm <ArrowRight size={18} aria-hidden="true" /></> : <>Skip <SkipForward size={17} aria-hidden="true" /></>}
        </button>
      </div>
    </section>
  );
}

export default function RhythmQuiz() {
  const [round, setRound] = useState<QuizRound | null>(null);
  const [samples, setSamples] = useState<SampleMap>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const previousSlug = useRef<string>();
  const focusNextPrompt = useRef(false);
  const request = useRef<AbortController | null>(null);
  const activePlayer = useRef<RenderedPlayback | null>(null);

  const stopPlayback = useCallback(() => {
    activePlayer.current?.stop();
    activePlayer.current = null;
  }, []);

  const loadRound = useCallback(async (focusPrompt = false) => {
    focusNextPrompt.current = focusPrompt;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    const timeout = setTimeout(() => controller.abort(), 15_000);
    stopPlayback();
    setLoading(true);
    setError(false);
    try {
      // Re-read the library each round so an open quiz picks up library deployments.
      const response = await fetch("/quiz/rhythms.json", { cache: "no-store", signal: controller.signal });
      if (!response.ok) throw new Error("Unable to load rhythms.");
      const library: QuizLibrary = await response.json();
      if (request.current !== controller) return;
      const nextRound = createQuizRound(library, previousSlug.current);
      setSamples(library.samples);
      setRound(nextRound);
      previousSlug.current = nextRound?.prompt.slug;
    } catch {
      if (request.current === controller) setError(true);
    } finally {
      clearTimeout(timeout);
      if (request.current === controller) setLoading(false);
    }
  }, [stopPlayback]);

  useEffect(() => {
    void loadRound();
    return () => {
      const controller = request.current;
      request.current = null;
      controller?.abort();
      stopPlayback();
    };
  }, [loadRound, stopPlayback]);

  if (loading) return <div className="quiz-empty" role="status">Finding a rhythm…</div>;
  if (error || !round) return (
    <section className="quiz-empty">
      <Headphones size={28} aria-hidden="true" />
      <h2>{error ? "The rhythms couldn’t load" : "More rhythms needed"}</h2>
      <p role="status">{error ? "Try again when you’re connected." : "This practice needs at least three different playable rhythms in the library."}</p>
      <button className="quiz-button" type="button" onClick={() => void loadRound(true)}>
        <RotateCcw size={18} aria-hidden="true" /> Try again
      </button>
    </section>
  );

  return (
    <PracticeRound
      key={round.prompt.slug}
      round={round}
      samples={samples}
      focusPrompt={focusNextPrompt.current}
      onNext={() => void loadRound(true)}
      onStop={stopPlayback}
      onPlay={(player) => { stopPlayback(); activePlayer.current = player; }}
    />
  );
}

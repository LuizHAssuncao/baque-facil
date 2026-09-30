import { useTranslation } from "../lib/i18n/useTranslation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Check, Headphones, Play, RotateCcw, SkipForward, Square, X } from "lucide-react";
import { useRenderedPlayback } from "../lib/audio/useRenderedPlayback";
import type { RenderedPlayback } from "../lib/audio/renderedPlayback";
import { createQuizRound, QUIZ_PLAY_COUNT, QUIZ_TEMPO, type QuizLibrary, type QuizRound } from "../lib/rhythmQuiz";
import type { Rhythm } from "../lib/rhythmTypes";
import type { SampleMap } from "../lib/sampleMap";

const AUTO_ADVANCE_DELAY_MS = 2_000;

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
  const { t } = useTranslation();
  const request = useMemo(() => ({
    // Media controls must not reveal the rhythm's name either.
    rhythm: {
      ...rhythm,
      title: t("Option {label}", { label }),
      // Render both passes together so drum tails overlap the repeat naturally.
      tracks: rhythm.tracks.map((track) => ({
        ...track,
        steps: Array.from({ length: QUIZ_PLAY_COUNT }, () => track.steps).flat(),
      })),
    },
    samples,
    tempo: QUIZ_TEMPO,
    loop: false,
    mutedTracks: [],
  }), [rhythm, samples, label, t]);
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
        aria-label={t("{action} audio {label}", { action: t(action), label })}
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
        {t(action)}
      </button>
      <button
        className="quiz-button quiz-choose"
        type="button"
        aria-label={t(result === "correct" ? "Option {label} is correct" : "Choose option {label}", { label })}
        disabled={answered || !snapshot.ready || Boolean(snapshot.error)}
        onClick={onChoose}
      >
        {result === "correct" ? <><Check size={18} aria-hidden="true" /> {t("Correct")}</> : t("Choose this")}
      </button>
      {result === "retry" && (
        <p className="quiz-option-result"><X size={18} aria-hidden="true" /> {t("Not a match")}</p>
      )}
      {snapshot.error && <p className="quiz-audio-error" role="alert">{t("Audio {label} couldn’t play. Tap Retry to try again.", { label })}</p>}
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
  const { t, locale } = useTranslation();
  const [selected, setSelected] = useState<string | null>(null);
  const prompt = useRef<HTMLHeadingElement>(null);
  const feedback = useRef<HTMLDivElement>(null);
  const answered = selected === round.prompt.slug;
  const selectedIndex = round.options.findIndex((rhythm) => rhythm.slug === selected);
  const selectedRhythm = round.options[selectedIndex];
  const selectedLabel = selectedRhythm ? String.fromCharCode(65 + selectedIndex) : null;

  useEffect(() => {
    if (focusPrompt) prompt.current?.focus();
  }, [focusPrompt]);

  useEffect(() => {
    if (selected) feedback.current?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  useEffect(() => {
    if (!answered) return;
    const timeout = setTimeout(onNext, AUTO_ADVANCE_DELAY_MS);
    return () => clearTimeout(timeout);
  }, [answered, onNext]);

  return (
    <section data-rendered-locale={locale} className="quiz-practice" aria-labelledby="quiz-prompt">
      <div className="quiz-prompt-panel">
        <Headphones size={24} aria-hidden="true" />
        <p className="eyebrow">{t("Which audio matches?")}</p>
        <h2 id="quiz-prompt" ref={prompt} tabIndex={-1}>{round.prompt.title}</h2>
      </div>
      <p className="quiz-listen-hint">{t("Each option plays twice. Replay as often as you like.")}</p>
      <ol className="quiz-options" aria-label={t("Audio options")}>
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
        <div
          className="quiz-feedback"
          ref={feedback}
          role="status"
          aria-label={t("Answer feedback")}
          aria-atomic="true"
          data-result={selected ? answered ? "correct" : "incorrect" : undefined}
        >
          {selectedRhythm ? (
            <>
              <span className="quiz-feedback-icon" aria-hidden="true">
                {answered ? <Check size={25} /> : <X size={25} />}
              </span>
              <div>
                <strong>{t(answered ? "Correct!" : "Incorrect — try again")}</strong>
                <p>{answered
                  ? t("Option {label} matches {title}. Moving to the next rhythm…", { label: selectedLabel!, title: round.prompt.title })
                  : t("Option {label} is {title}. Listen again and choose another.", { label: selectedLabel!, title: selectedRhythm.title })}</p>
              </div>
            </>
          ) : t("Take your time.")}
        </div>
        <button className={`quiz-button ${answered ? "quiz-next" : "quiz-skip"}`} type="button" onClick={onNext}>
          {answered ? <>{t("Next rhythm")}<ArrowRight size={18} aria-hidden="true" /></> : <>{t("Skip")}<SkipForward size={17} aria-hidden="true" /></>}
        </button>
      </div>
    </section>
  );
}

export default function RhythmQuiz() {
  const { t, locale } = useTranslation();
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

  const nextRound = useCallback(() => { void loadRound(true); }, [loadRound]);

  useEffect(() => {
    void loadRound();
    return () => {
      const controller = request.current;
      request.current = null;
      controller?.abort();
      stopPlayback();
    };
  }, [loadRound, stopPlayback]);

  if (loading) return <div data-rendered-locale={locale} className="quiz-empty" role="status">{t("Finding a rhythm…")}</div>;
  if (error || !round) return (
    <section data-rendered-locale={locale} className="quiz-empty">
      <Headphones size={28} aria-hidden="true" />
      <h2>{t(error ? "The rhythms couldn’t load" : "More rhythms needed")}</h2>
      <p role="status">{t(error ? "Try again when you’re connected." : "This practice needs at least three different playable rhythms in the library.")}</p>
      <button className="quiz-button" type="button" onClick={() => void loadRound(true)}>
        <RotateCcw size={18} aria-hidden="true" />{t("Try again")}</button>
    </section>
  );

  return (
    <PracticeRound
      key={round.prompt.slug}
      round={round}
      samples={samples}
      focusPrompt={focusNextPrompt.current}
      onNext={nextRound}
      onStop={stopPlayback}
      onPlay={(player) => { stopPlayback(); activePlayer.current = player; }}
    />
  );
}

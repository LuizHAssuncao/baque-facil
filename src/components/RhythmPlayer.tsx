import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Play, RotateCcw, Square } from "lucide-react";
import { countLabels, stepsPerBeat as getStepsPerBeat } from "../lib/countLabels";
import { MAX_TEMPO, MIN_TEMPO, clampTempo } from "../lib/tempo";
import type { Rhythm } from "../lib/rhythmTypes";

type ToneModule = typeof import("tone");

type RhythmPlayerProps = {
  rhythm: Rhythm;
  samples: Record<string, string>;
  autoPlay?: boolean;
  onTempoChange?: (tempo: number) => void;
};

const DEFAULT_AUDIBLE_TRACK = "Alfaia";
const AUTOPLAY_START_TIMEOUT_MS = 400;

function defaultMutedTracks(trackNames: string[]) {
  return trackNames.filter((name) => name !== DEFAULT_AUDIBLE_TRACK);
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string) {
  let timeoutId: ReturnType<typeof window.setTimeout> | undefined;

  const timeout = new Promise<never>((_, reject) => {
    timeoutId = window.setTimeout(() => reject(new Error(message)), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timeoutId !== undefined) {
      window.clearTimeout(timeoutId);
    }
  }
}

export default function RhythmPlayer({
  rhythm,
  samples,
  autoPlay = false,
  onTempoChange,
}: RhythmPlayerProps) {
  const trackNamesKey = JSON.stringify(rhythm.tracks.map((track) => track.name));
  const defaultMutedTrackNames = useMemo(
    () => defaultMutedTracks(JSON.parse(trackNamesKey) as string[]),
    [trackNamesKey],
  );
  const [tempo, setTempo] = useState(() => clampTempo(rhythm.tempo));
  const [loop, setLoop] = useState(true);
  const [activeStep, setActiveStep] = useState<number | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState<string | null>(null);
  const [mutedTracks, setMutedTracks] = useState<string[]>(() => defaultMutedTrackNames);

  const toneRef = useRef<ToneModule | null>(null);
  const playersRef = useRef<Record<string, any>>({});
  const playersLoadedRef = useRef<Promise<void> | null>(null);
  const scheduledEventRef = useRef<number | null>(null);
  const tempoRef = useRef(tempo);
  const loopRef = useRef(loop);
  const mutedTracksRef = useRef(new Set(defaultMutedTrackNames));
  const hasAutoPlayedRef = useRef(false);
  const playAttemptRef = useRef(0);

  const stepCount = rhythm.tracks[0]?.steps.length ?? 0;
  const beatStepCount = getStepsPerBeat(rhythm.subdivision);
  const stepDuration = `${rhythm.subdivision}n` as "8n" | "16n" | "32n";
  const labels = useMemo(
    () => countLabels(stepCount, rhythm.subdivision),
    [rhythm.subdivision, stepCount],
  );
  const gridStyle = {
    gridTemplateColumns: `minmax(6rem, 7rem) repeat(${stepCount}, minmax(2.5rem, 1fr))`,
  } as CSSProperties;

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
    if (!autoPlay || hasAutoPlayedRef.current) {
      return;
    }

    hasAutoPlayedRef.current = true;
    void play({ isAutoPlay: true });
  }, [autoPlay, rhythm.slug]);

  useEffect(() => {
    return () => {
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
      throw new Error("Audio context could not start.");
    }

    if (!playersLoadedRef.current) {
      playersRef.current = Object.fromEntries(
        Object.entries(samples).map(([key, url]) => [
          key,
          new Tone.Player(url).toDestination(),
        ]),
      );

      playersLoadedRef.current = Tone.loaded();
    }

    await playersLoadedRef.current;
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

    setTempo(clampedTempo);
    onTempoChange?.(clampedTempo);
  }

  async function play(options: { isAutoPlay?: boolean } = {}) {
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
        const currentStep = nextStep % stepCount;

        rhythm.tracks.forEach((track) => {
          const symbol = track.steps[currentStep];

          if (symbol === "." || mutedTracksRef.current.has(track.name)) {
            return;
          }

          playersRef.current[`${track.name}.${symbol}`]?.start(time);
        });

        Tone.Draw.schedule(() => setActiveStep(currentStep), time);
        nextStep += 1;

        if (!loopRef.current && nextStep >= stepCount) {
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
      setError(cause instanceof Error ? cause.message : "Playback failed.");
    }
  }

  function stop() {
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
    <section className="player-panel" aria-label={`${rhythm.title} player`}>
      <div className="controls">
        <button
          type="button"
          onClick={togglePlayback}
          disabled={status === "loading"}
          aria-label={isPlaying ? "Stop" : "Play"}
          title={isPlaying ? "Stop" : "Play"}
        >
          {isPlaying ? (
            <Square aria-hidden="true" size={18} />
          ) : (
            <Play aria-hidden="true" size={18} />
          )}
          {isPlaying ? "Stop" : "Play"}
        </button>
        <button
          type="button"
          onClick={restart}
          disabled={status === "loading"}
          aria-label="Restart"
          title="Restart"
        >
          <RotateCcw aria-hidden="true" size={18} />
          Restart
        </button>
        <label className="loop-toggle">
          <input
            type="checkbox"
            checked={loop}
            onChange={(event) => setLoop(event.target.checked)}
          />
          Loop
        </label>
        <label className="tempo-control">
          <span>Tempo</span>
          <input
            type="range"
            min={MIN_TEMPO}
            max={MAX_TEMPO}
            value={tempo}
            onChange={(event) => changeTempo(Number(event.target.value))}
          />
          <output>{tempo} BPM</output>
        </label>
      </div>

      <div className="mute-controls" aria-label="Instrument mute controls">
        {rhythm.tracks.map((track) => {
          const isMuted = mutedTracks.includes(track.name);

          return (
            <button
              type="button"
              className={isMuted ? "muted" : ""}
              aria-pressed={isMuted}
              onClick={() => toggleTrackMute(track.name)}
              key={track.name}
            >
              {isMuted ? `Unmute ${track.name}` : `Mute ${track.name}`}
            </button>
          );
        })}
      </div>

      <div className="player-status" aria-live="polite">
        {status === "loading" ? "Loading samples..." : null}
        {error ? error : null}
      </div>

      <div className="grid-scroll" aria-label="Parsed rhythm grid">
        <div className="rhythm-grid">
          <div className="grid-row count-row" style={gridStyle}>
            <div className="track-name">Count</div>
            {labels.map((label, index) => (
              <div
                className={`step-cell count-cell ${activeStep === index ? "active" : ""}`}
                key={`${label}-${index}`}
              >
                {label}
              </div>
            ))}
          </div>

          {rhythm.tracks.map((track) => (
            <div
              className={`grid-row ${mutedTracks.includes(track.name) ? "muted-row" : ""}`}
              style={gridStyle}
              key={track.name}
            >
              <div className="track-name">{track.name}</div>
              {track.steps.map((symbol, index) => (
                <div
                  className={`step-cell ${symbol === "." ? "rest-cell" : "hit-cell"} ${
                    activeStep === index ? "active" : ""
                  } ${index % beatStepCount === 0 ? "beat-start" : ""}`}
                  key={`${track.name}-${index}`}
                >
                  {symbol}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

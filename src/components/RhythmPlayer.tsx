import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { countLabels, stepsPerBeat as getStepsPerBeat } from "../lib/countLabels";
import type { Rhythm } from "../lib/rhythmTypes";

type ToneModule = typeof import("tone");

type RhythmPlayerProps = {
  rhythm: Rhythm;
  samples: Record<string, string>;
  onTempoChange?: (tempo: number) => void;
};

const DEFAULT_AUDIBLE_TRACK = "Alfaia";

function defaultMutedTracks(trackNames: string[]) {
  return trackNames.filter((name) => name !== DEFAULT_AUDIBLE_TRACK);
}

export default function RhythmPlayer({
  rhythm,
  samples,
  onTempoChange,
}: RhythmPlayerProps) {
  const trackNamesKey = JSON.stringify(rhythm.tracks.map((track) => track.name));
  const defaultMutedTrackNames = useMemo(
    () => defaultMutedTracks(JSON.parse(trackNamesKey) as string[]),
    [trackNamesKey],
  );
  const [tempo, setTempo] = useState(rhythm.tempo);
  const [loop, setLoop] = useState(true);
  const [activeStep, setActiveStep] = useState<number | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState<string | null>(null);
  const [mutedTracks, setMutedTracks] = useState<string[]>(() => defaultMutedTrackNames);

  const toneRef = useRef<ToneModule | null>(null);
  const playersRef = useRef<Record<string, any>>({});
  const scheduledEventRef = useRef<number | null>(null);
  const tempoRef = useRef(tempo);
  const loopRef = useRef(loop);
  const mutedTracksRef = useRef(new Set(defaultMutedTrackNames));

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
    setTempo(rhythm.tempo);
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
    return () => {
      const Tone = toneRef.current;

      if (Tone) {
        Tone.Transport.stop();
        Tone.Transport.cancel();
      }

      Object.values(playersRef.current).forEach((player) => player.dispose?.());
    };
  }, []);

  async function ensureAudio() {
    setStatus("loading");
    setError(null);

    const Tone = toneRef.current ?? (await import("tone"));
    toneRef.current = Tone;

    await Tone.start();

    if (Object.keys(playersRef.current).length === 0) {
      playersRef.current = Object.fromEntries(
        Object.entries(samples).map(([key, url]) => [
          key,
          new Tone.Player(url).toDestination(),
        ]),
      );

      await Tone.loaded();
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
    setTempo(nextTempo);
    onTempoChange?.(nextTempo);
  }

  async function play() {
    try {
      const Tone = await ensureAudio();
      let nextStep = 0;

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
      setIsPlaying(false);
      setStatus("error");
      setError(cause instanceof Error ? cause.message : "Playback failed.");
    }
  }

  function stop() {
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

  return (
    <section className="player-panel" aria-label={`${rhythm.title} player`}>
      <div className="controls">
        <button type="button" onClick={play} disabled={status === "loading"}>
          Play
        </button>
        <button type="button" onClick={stop} disabled={!isPlaying}>
          Stop
        </button>
        <button type="button" onClick={restart} disabled={status === "loading"}>
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
            min="50"
            max="150"
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

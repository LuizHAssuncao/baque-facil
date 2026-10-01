import { useTranslation } from "../lib/i18n/useTranslation";
import type { MessageKey } from "../lib/i18n/messages";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Download,
  Headphones,
  Pause,
  Play,
  Radio,
  Repeat,
  Shuffle,
  SkipForward,
  X,
} from "lucide-react";
import { shouldIgnoreKeyboardShortcut } from "../lib/keyboardShortcuts";
import type { SampleMap } from "../lib/sampleMap";
import { MAX_TEMPO, MIN_TEMPO } from "../lib/tempo";
import { radioSettingsKey } from "../lib/radio/playback";
import { useRadioPlayback } from "../lib/radio/useRadioPlayback";
import {
  buildRadioTimeline,
  defaultRadioSettings,
  normalizeRadioSettings,
  RADIO_PREFERENCES_KEY,
  RADIO_SAMPLE_RATE,
  type RadioEntry,
} from "../lib/radio/timeline";
import { RadioRhythmGrid } from "./RadioRhythmGrid";
import { Mp3SaveActions } from "./Mp3SaveActions";
import { formatAudioDuration } from "../lib/audio/downloadMp3";

function formatTime(seconds: number) {
  const rounded = Math.floor(seconds);
  return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, "0")}`;
}

export default function RhythmRadio({
  entries,
  samples,
}: {
  entries: RadioEntry[];
  samples: SampleMap;
}) {
  const { t, locale } = useTranslation();
  const sizeFormat = useMemo(() => new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }), [locale]);
  const [settings, setSettings] = useState(() => defaultRadioSettings(entries));
  const [preferencesLoaded, setPreferencesLoaded] = useState(false);
  const { audioRef, controller, snapshot } = useRadioPlayback(entries, samples);
  const latest = useRef({ settings, snapshot });
  latest.current = { settings, snapshot };
  const selected = entries.filter((entry) =>
    settings.slugs.includes(entry.rhythm.slug),
  );
  const current = entries.find((entry) => entry.rhythm.slug === snapshot.slug);
  const changed =
    snapshot.ready && snapshot.settingsKey !== radioSettingsKey(settings);
  const combos = entries.filter((entry) => entry.combo);
  const includeCombos = combos.some((entry) =>
    settings.slugs.includes(entry.rhythm.slug),
  );

  const estimate = useMemo(() => {
    try {
      const rhythms = entries
        .filter((entry) => settings.slugs.includes(entry.rhythm.slug))
        .map((entry) => entry.rhythm);
      return (
        buildRadioTimeline(
          rhythms,
          settings.tempo,
          settings.repetitions,
          settings.minutes * 60,
          () => 0.5,
        ).totalFrames / RADIO_SAMPLE_RATE
      );
    } catch {
      return null;
    }
  }, [entries, settings]);

  useEffect(() => {
    if (!settings.slugs.length) controller.current?.pause();
  }, [settings.slugs.length, controller]);
  useEffect(() => {
    try {
      setSettings(
        normalizeRadioSettings(
          JSON.parse(localStorage.getItem(RADIO_PREFERENCES_KEY) ?? "null"),
          entries,
        ),
      );
    } catch {
      /* Defaults work without storage. */
    }
    setPreferencesLoaded(true);
  }, [entries]);
  useEffect(() => {
    if (!preferencesLoaded) return;
    try {
      localStorage.setItem(RADIO_PREFERENCES_KEY, JSON.stringify(settings));
    } catch {
      /* Storage is optional. */
    }
  }, [settings, preferencesLoaded]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (
        event.repeat ||
        shouldIgnoreKeyboardShortcut(event) ||
        (event.code !== "Space" && event.key !== " ")
      )
        return;
      event.preventDefault();
      const { settings: selectedSettings, snapshot: state } = latest.current;
      if (state.playing) controller.current?.pause();
      else if (state.ready && selectedSettings.slugs.length)
        controller.current?.play();
      else if (!state.preparing && selectedSettings.slugs.length)
        void controller.current?.prepare(selectedSettings);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [controller]);

  return (
    <section className="radio-studio" data-rendered-locale={locale} aria-label={t("Baque Radio player")}>
      <audio ref={audioRef} data-radio-player hidden />
      <div className="radio-player">
        <div className="radio-now" aria-live="polite" aria-atomic="true">
          <span
            className={`radio-signal ${snapshot.playing ? "is-playing" : ""}`}
            aria-hidden="true"
          >
            <Radio size={26} />
          </span>
          <div>
            <p className="eyebrow">
              {t(snapshot.held
                ? "Staying on this rhythm"
                : snapshot.playing
                  ? "Now playing"
                  : snapshot.ready
                    ? "Ready to listen"
                    : "Your rhythm, on repeat")}
            </p>
            <h2>{current?.rhythm.title ?? t("Settle into the baque")}</h2>
          </div>
        </div>
        <p className="radio-caption">
          {snapshot.ready
            ? `${snapshot.tempo} BPM · ${snapshot.held ? t("Repeating this pattern") : current?.combo ? t("One pass through this combo") : t("{count} repetitions per rhythm", { count: snapshot.repetitions })}`
            : t("A shuffled mix of familiar patterns. Listen closely, or pick up your alfaia and play along.")}
        </p>
        <div className="radio-controls">
          <button
            className="radio-button radio-primary"
            type="button"
            disabled={
              !preferencesLoaded ||
              !selected.length ||
              (!snapshot.ready && Boolean(snapshot.preparing))
            }
            onClick={() => {
              if (snapshot.playing) controller.current?.pause();
              else if (snapshot.ready) controller.current?.play();
              else void controller.current?.prepare(settings);
            }}
          >
            {snapshot.playing ? (
              <Pause size={20} aria-hidden="true" />
            ) : (
              <Play size={20} aria-hidden="true" />
            )}
            {t(snapshot.playing ? "Pause" : "Play")}
          </button>
          <button
            className="radio-button"
            type="button"
            disabled={!snapshot.canSkip}
            onClick={() => controller.current?.skip()}
          >
            <SkipForward size={18} aria-hidden="true" />{t("Skip")}</button>
          <button
            className="radio-button"
            type="button"
            aria-pressed={snapshot.held}
            disabled={!snapshot.ready || Boolean(snapshot.preparing)}
            onClick={() => void controller.current?.toggleHold()}
          >
            <Repeat size={18} aria-hidden="true" />{" "}
            {t(snapshot.held ? "Back to mix" : "Stay on this rhythm")}
          </button>
          <button
            className="radio-button"
            type="button"
            disabled={
              !snapshot.ready || !selected.length || Boolean(snapshot.preparing)
            }
            onClick={() => void controller.current?.prepare(settings)}
          >
            <Shuffle size={18} aria-hidden="true" />{" "}
            {t(changed ? "Apply settings" : "Shuffle again")}
          </button>
        </div>
        <div className="radio-download">
          {snapshot.download ? <>
            <Mp3SaveActions download={snapshot.download} label="Download mix MP3" />
            <p className="mp3-note">{t("Full prepared mix · {duration} · {size} MB", {
              duration: formatAudioDuration(snapshot.download.duration),
              size: sizeFormat.format(snapshot.download.blob.size / 1_000_000),
            })}</p>
          </> : <>
            <button className="mp3-button" type="button" disabled aria-describedby="radio-download-reason">
              <Download size={17} aria-hidden="true" />{t("Download mix MP3")}
            </button>
            <p id="radio-download-reason" className="mp3-note">{t("Prepare a mix first.")}</p>
          </>}
        </div>
        {snapshot.preparing ? (
          <div className="radio-preparation">
            <div className="radio-preparation-label">
              <span role="status">
                {t(snapshot.preparing === "hold"
                  ? "Preparing this rhythm"
                  : "Preparing your mix")}{" "}
                · {snapshot.progress}%
              </span>
              <button
                type="button"
                className="radio-cancel"
                onClick={() => controller.current?.cancelPreparation()}
              >
                <X size={16} aria-hidden="true" />{t("Cancel")}</button>
            </div>
            <progress
              max={100}
              value={snapshot.progress}
              aria-label={t("Recording preparation")}
            />
            <small>{t("Keep this page open while your recording is prepared.")}</small>
          </div>
        ) : null}
        {snapshot.error ? (
          <p className="radio-error" role="alert">
            {t(snapshot.error)}
          </p>
        ) : null}
        {changed && !snapshot.preparing ? (
          <p className="radio-pending" role="status">{t("Your new settings are ready. Apply them to prepare a new mix.")}</p>
        ) : null}
        {snapshot.ready ? (
          <div className="radio-recording-info">
            <span>
              {snapshot.held
                ? t("Repeat is on")
                : `${formatTime(snapshot.seconds)} / ${formatTime(snapshot.duration)}`}
            </span>
            <span>
              {t("{size} MB · loops continuously", { size: sizeFormat.format(snapshot.bytes / 1_000_000) })}
            </span>
          </div>
        ) : (
          <p className="radio-listening-hint">
            <Headphones size={17} aria-hidden="true" /> {t("First, choose your practice settings below. Preparation starts when you press Play.")}
          </p>
        )}
      </div>

      {current ? (
        <section className="radio-pattern" aria-label={t("Now playing pattern")}>
          <div className="radio-pattern-heading">
            <p>
              {snapshot.held
                ? t("Take your time with this pattern")
                : t("Repetition {current} of {total}", { current: snapshot.repetition, total: snapshot.repetitions })}
            </p>
            <a href={`/rhythms/${current.rhythm.slug}/`}>{t("Open rhythm lesson →")}</a>
          </div>
          <RadioRhythmGrid
            rhythm={current.rhythm}
            activeStep={snapshot.playing ? snapshot.activeStep : null}
          />
        </section>
      ) : null}

      <section
        className="radio-settings"
        aria-labelledby="radio-settings-heading"
      >
        <div className="radio-section-heading">
          <h2 id="radio-settings-heading">{t("Make it your practice")}</h2>
          <span>{t(selected.length === 1 ? "{count} rhythm selected" : "{count} rhythms selected", { count: selected.length })}</span>
        </div>
        <div className="radio-setting-fields">
          <label className="radio-tempo">
            <span>{t("Tempo")}<output>{settings.tempo} BPM</output>
            </span>
            <input
              type="range"
              aria-label={t("Radio tempo")}
              min={MIN_TEMPO}
              max={MAX_TEMPO}
              value={settings.tempo}
              onChange={(event) =>
                setSettings({ ...settings, tempo: Number(event.target.value) })
              }
            />
          </label>
          <label>{t("Repetitions per rhythm")}<select
              value={settings.repetitions}
              onChange={(event) =>
                setSettings({
                  ...settings,
                  repetitions: Number(event.target.value),
                })
              }
            >
              {[4, 8, 16].map((number) => (
                <option key={number} value={number}>
                  {t("{count} repetitions", { count: number })}
                </option>
              ))}
            </select>
          </label>
          <label>{t("Recording length")}<select
              value={settings.minutes}
              onChange={(event) =>
                setSettings({
                  ...settings,
                  minutes: Number(event.target.value),
                })
              }
            >
              {[2, 5, 10, 20].map((minutes) => (
                <option key={minutes} value={minutes}>
                  {t("About {minutes} minutes", { minutes })}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="radio-selection-heading">
          <h3>{t("Choose your rhythms")}</h3>
          <label className="radio-combo-toggle">
            <input
              type="checkbox"
              checked={includeCombos}
              onChange={(event) =>
                setSettings({
                  ...settings,
                  slugs: event.target.checked
                    ? [
                        ...new Set([
                          ...settings.slugs,
                          ...combos.map((entry) => entry.rhythm.slug),
                        ]),
                      ]
                    : settings.slugs.filter(
                        (slug) =>
                          !combos.some((entry) => entry.rhythm.slug === slug),
                      ),
                })
              }
            />{" "}
            {t("Include combos")}
          </label>
        </div>
        <fieldset className="radio-selection">
          <legend className="radio-sr-only">{t("Rhythms in the recording")}</legend>
          {entries
            .filter((entry) => !entry.combo || includeCombos)
            .map((entry) => (
              <label key={entry.rhythm.slug} className="radio-rhythm-choice">
                <input
                  type="checkbox"
                  checked={settings.slugs.includes(entry.rhythm.slug)}
                  onChange={(event) =>
                    setSettings({
                      ...settings,
                      slugs: event.target.checked
                        ? [...settings.slugs, entry.rhythm.slug]
                        : settings.slugs.filter(
                            (slug) => slug !== entry.rhythm.slug,
                          ),
                    })
                  }
                />
                <span>
                  <strong>{entry.rhythm.title}</strong>
                  <small>{t(entry.combo ? "Combo" : entry.difficulty as MessageKey)}</small>
                </span>
              </label>
            ))}
        </fieldset>
        {!selected.length ? (
          <p className="radio-error" role="status">{t("Select at least one rhythm to prepare a mix.")}</p>
        ) : null}
        <p className="radio-footnote">
          {estimate
            ? t("This mix will last {duration} (about {size} MB).", { duration: formatTime(estimate), size: sizeFormat.format((estimate * 16000) / 1_000_000) })
            : ""}{" "}
          {t("Mixes finish on a full round of your selection. Combos play once per turn.")}
        </p>
        <p className="radio-footnote">{t("Each new mix has a fresh shuffle. The complete recording repeats until you shuffle again. Shorter recordings prepare faster.")}</p>
      </section>
    </section>
  );
}

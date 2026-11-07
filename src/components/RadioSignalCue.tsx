import { memo, useEffect, useState } from "react";
import { Hand, Repeat } from "lucide-react";
import { useTranslation } from "../lib/i18n/useTranslation";
import type { MessageKey } from "../lib/i18n/messages";
import type { RadioEntry } from "../lib/radio/timeline";

export const RadioSignalCue = memo(function RadioSignalCue({
  next,
  currentSlug,
  ready,
  held,
  signalDue,
  showRhythmNames,
}: {
  next: RadioEntry | undefined;
  currentSlug: string | null;
  ready: boolean;
  held: boolean;
  signalDue: boolean;
  showRhythmNames: boolean;
}) {
  const { t, locale } = useTranslation();
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const nextImage = next?.gesture?.src;
  useEffect(() => {
    if (!ready || !nextImage) return;
    // Fetch before the call so the gesture can appear on time.
    const image = new Image();
    image.src = nextImage;
  }, [ready, nextImage]);
  const repeating = ready && (held || next?.rhythm.slug === currentSlug);
  const active = ready && !repeating && signalDue && Boolean(next);
  const phase = active ? "call" : repeating ? "repeating" : ready ? "waiting" : "idle";
  const gesture = active ? next?.gesture : undefined;
  const imageAvailable = gesture && failedSource !== gesture.src;
  const showNextTitle = showRhythmNames || (active && !imageAvailable);
  const nextTitle = next ? t(next.rhythm.title as MessageKey) : "";

  return (
    <section className="radio-cue" data-phase={phase} aria-label={t("Next rhythm signal")}>
      <div className="radio-cue-art">
        {imageAvailable ? (
          <img
            key={gesture.src}
            src={gesture.src}
            alt={gesture.description[locale]}
            width={180}
            height={180}
            decoding="async"
            onError={() => setFailedSource(gesture.src)}
          />
        ) : (
          <div className="radio-cue-placeholder">
            {repeating ? <Repeat size={42} aria-hidden="true" /> : <Hand size={42} aria-hidden="true" />}
            {active ? <span>{t("Signal unavailable")}</span> : null}
          </div>
        )}
      </div>
      <div className="radio-cue-copy">
        <p className="eyebrow">{t("Mestre's call")}</p>
        <p className="radio-cue-instruction">
          {t(active ? "Get ready for the next rhythm" : repeating ? "Repeating this pattern" : "Listen for the next call")}
        </p>
        {ready && next && showNextTitle ? (
          <p className="radio-next">
            {t(held ? "When you return to the mix" : "Next rhythm")}: <strong>{nextTitle}</strong>
          </p>
        ) : null}
        {!active && !repeating ? (
          <p className="radio-cue-hint">{t("The signal appears in the last two repetitions, or after 70% of a sequence.")}</p>
        ) : null}
      </div>
      <span className="radio-sr-only" role="status" aria-atomic="true">
        {active && next
          ? showNextTitle
            ? t("Next rhythm: {title}", { title: nextTitle })
            : t("Get ready for the next rhythm")
          : ""}
      </span>
    </section>
  );
});

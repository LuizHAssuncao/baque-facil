import { useTranslation } from "../lib/i18n/useTranslation";
import { memo, useEffect, useRef, useState, type CSSProperties } from "react";
import { countLabels, stepsPerBeat } from "../lib/countLabels";
import {
  displayHandSymbol,
  HAND_SYMBOL_REVERSE_EVENT,
  readHandSymbolReversePreference,
} from "../lib/handPreference";
import { rhythmGridColumns, rhythmGridMinWidth } from "../lib/rhythmGridLayout";
import type { Rhythm } from "../lib/rhythmTypes";

/** Read-only radio view reuses the existing player's grid styles and notation helpers. */
export const RadioRhythmGrid = memo(function RadioRhythmGrid({
  rhythm,
  activeStep,
}: {
  rhythm: Rhythm;
  activeStep: number | null;
}) {
  const { t } = useTranslation();
  const [reverse, setReverse] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const cells = useRef<(HTMLDivElement | null)[]>([]);
  const steps = rhythm.tracks[0].steps.length;
  const rowStyle: CSSProperties = {
    gridTemplateColumns: rhythmGridColumns(8, 9, steps),
  };
  const shellStyle: CSSProperties = { minWidth: rhythmGridMinWidth(8, steps) };
  useEffect(() => {
    const read = () => setReverse(readHandSymbolReversePreference());
    read();
    window.addEventListener("storage", read);
    window.addEventListener(HAND_SYMBOL_REVERSE_EVENT, read);
    return () => {
      window.removeEventListener("storage", read);
      window.removeEventListener(HAND_SYMBOL_REVERSE_EVENT, read);
    };
  }, []);
  useEffect(() => {
    if (activeStep === null) return;
    const container = scroller.current;
    const cell = cells.current[activeStep];
    if (!container || !cell) return;
    const outer = container.getBoundingClientRect();
    const inner = cell.getBoundingClientRect();
    if (inner.left < outer.left + 150 || inner.right > outer.right - 20) {
      container.scrollLeft +=
        inner.left - outer.left - Math.min(180, outer.width * 0.55);
    }
  }, [activeStep, rhythm.slug]);
  return (
    <div
      className="grid-scroll"
      aria-label={t("Current rhythm grid")}
      ref={scroller}
    >
      <div className="rhythm-grid" style={shellStyle}>
        <div className="grid-row count-row" style={rowStyle}>
          <div className="track-name">{t("Count")}</div>
          {countLabels(steps, rhythm.subdivision).map((label, index) => (
            <div
              key={index}
              className={`step-cell count-cell ${activeStep === index ? "active" : ""}`}
              ref={(cell) => {
                cells.current[index] = cell;
              }}
            >
              {label}
            </div>
          ))}
        </div>
        {rhythm.tracks.map((track) => (
          <div className="grid-row" style={rowStyle} key={track.name}>
            <div className="track-name">{track.name}</div>
            {track.steps.map((symbol, index) => (
              <div
                key={index}
                className={`step-cell ${symbol === "." ? "rest-cell" : "hit-cell"} ${activeStep === index ? "active" : ""} ${index % stepsPerBeat(rhythm.subdivision) === 0 ? "beat-start" : ""}`}
              >
                {displayHandSymbol(symbol, reverse)}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
});

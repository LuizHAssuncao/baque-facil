import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Check, ChevronLeft, ChevronRight, Plus, Volume2, VolumeX, X } from "lucide-react";
import { countLabels, stepsPerBeat } from "../lib/countLabels";
import { displayHandSymbol } from "../lib/handPreference";
import { sampleMap } from "../lib/sampleMap";
import { useTranslation } from "../lib/i18n/useTranslation";
import type { MessageKey } from "../lib/i18n/messages";
import type { RhythmTrack, Subdivision } from "../lib/rhythmTypes";

const GRID_SCROLL_MARGIN_PX = 12;

export type ComposerSelection = { track: number; step: number };
type Props = {
  tracks: RhythmTrack[];
  subdivision: Subdivision;
  selection: ComposerSelection;
  activeStep: number | null;
  recording: boolean;
  locked: boolean;
  reversed: boolean;
  mutedTracks: string[];
  onMute: (track: string) => void;
  onSelect: (selection: ComposerSelection) => void;
  onChange: (selection: ComposerSelection, symbol: string) => void;
  onAddBeat: () => void;
};

function noteLabel(track: string, symbol: string): MessageKey {
  if (symbol === ".") return "Rest";
  if (track === "Alfaia") return symbol === "L" ? "Left" : symbol === "R" ? "Right" : "Border";
  if (track === "Gongue") return symbol === "x" ? "Low hit" : "High hit";
  return "Hit";
}

export default function ComposerGrid(props: Props) {
  const { tracks, subdivision, selection, activeStep, recording, locked, reversed, mutedTracks, onMute, onSelect, onChange, onAddBeat } = props;
  const { t } = useTranslation();
  const scroll = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const [picker, setPicker] = useState<ComposerSelection | null>(null);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const [visibleBeat, setVisibleBeat] = useState(1);
  const [scrollable, setScrollable] = useState(false);
  const perBeat = stepsPerBeat(subdivision);
  const length = tracks[0]?.steps.length ?? 0;
  const beats = Math.ceil(length / perBeat);
  const labels = countLabels(length, subdivision, true);
  const pickedTrack = picker ? tracks[picker.track] : undefined;
  const symbols = pickedTrack?.name === "Alfaia" ? ["L", "R", "B", "."] :
    [...Object.keys(sampleMap).filter((key) => key.startsWith(`${pickedTrack?.name}.`)).map((key) => key.split(".")[1]), "."];
  const empty = tracks.every((track) => track.steps.every((symbol) => symbol === "."));
  const columns = { "--composer-steps": length, "--steps-per-beat": perBeat } as CSSProperties;

  function closePicker() {
    dialog.current?.close();
    setPicker(null);
    trigger.current?.focus({ preventScroll: true });
  }

  useEffect(() => {
    const container = scroll.current;
    if (!container) return;
    const measure = () => setScrollable(container.scrollWidth > container.clientWidth + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    return () => observer.disconnect();
  }, [length]);

  useEffect(() => {
    if (!picker || !dialog.current || !trigger.current) return;
    let rect = trigger.current.getBoundingClientRect();
    if (window.matchMedia("(max-width: 760px)").matches && rect.bottom > window.innerHeight - 290) {
      window.scrollBy(0, rect.bottom - window.innerHeight + 320);
      rect = trigger.current.getBoundingClientRect();
    }
    setPosition({ left: Math.max(12, Math.min(rect.left - 130, window.innerWidth - 352)), top: Math.max(12, Math.min(rect.bottom + 12, window.innerHeight - 180)) });
    dialog.current.showModal();
    dialog.current.querySelector<HTMLButtonElement>('[aria-pressed="true"]')?.focus();
  }, [picker]);

  useEffect(() => {
    if (locked) closePicker();
  }, [locked]);

  useEffect(() => {
    const step = activeStep ?? selection.step;
    const cell = scroll.current?.querySelector<HTMLElement>(`[data-count="${step}"]`);
    const container = scroll.current;
    if (!cell || !container) return;
    const rect = cell.getBoundingClientRect();
    const bounds = container.getBoundingClientRect();
    if (rect.right > bounds.right - GRID_SCROLL_MARGIN_PX || rect.left < bounds.left + GRID_SCROLL_MARGIN_PX) {
      container.scrollLeft += rect.left - bounds.left - GRID_SCROLL_MARGIN_PX;
    }
  }, [activeStep, selection.step, length]);

  function moveBeat(offset: number) {
    const beat = Math.max(1, Math.min(beats, visibleBeat + offset));
    const container = scroll.current;
    const cell = container?.querySelector<HTMLElement>(`[data-count="${(beat - 1) * perBeat}"]`);
    if (cell && container) {
      const left = beat === 1 ? 0 : container.scrollLeft + cell.getBoundingClientRect().left
        - container.getBoundingClientRect().left - GRID_SCROLL_MARGIN_PX;
      container.scrollTo({ left, behavior: "smooth" });
    }
  }

  function updateVisibleBeat() {
    const container = scroll.current;
    const cell = container?.querySelector<HTMLElement>("[data-count]");
    if (!cell || !container) return;
    const rect = cell.getBoundingClientRect();
    // Use the column spacing, including cell margins, after the labels scroll away.
    const stepWidth = cell.nextElementSibling
      ? cell.nextElementSibling.getBoundingClientRect().left - rect.left
      : rect.width;
    const hiddenWidth = Math.max(0, container.getBoundingClientRect().left + GRID_SCROLL_MARGIN_PX - rect.left);
    // Allow for rounding of scrollLeft to a whole CSS pixel.
    setVisibleBeat(Math.min(beats, Math.floor((hiddenWidth + 1) / (stepWidth * perBeat)) + 1));
  }

  return (
    <div className="composer-editor">
      {empty && !locked ? <p className="composer-empty-hint">{t("Tap a space to add a hit.")}</p> : null}
      <div className="grid-scroll composer-grid-scroll" aria-label={t("Editable rhythm grid")} ref={scroll}
        onScroll={updateVisibleBeat}>
        <div className="rhythm-grid composer-unified-grid" style={columns}>
          <div className="composer-beat-row" aria-hidden="true">
            <div className="track-name" />
            {Array.from({ length: beats }, (_, index) => <div className="composer-beat-label" style={{ gridColumn: `span ${Math.min(perBeat, length - index * perBeat)}` }} key={index}>{t("Beat {beat}", { beat: index + 1 })}</div>)}
          </div>
          <div className="grid-row count-row">
            <div className="track-name">{t("Count")}</div>
            {labels.map((label, step) => <div key={step} data-count={step} className={`step-cell count-cell ${step % perBeat === 0 ? "beat-start" : ""} ${activeStep === step ? "playhead" : ""}`}>{label}</div>)}
          </div>
          {tracks.map((track, trackIndex) => <div key={track.name} className={`grid-row composer-note-row ${mutedTracks.includes(track.name) ? "muted-row" : ""}`}>
            <div className="track-name"><span>{track.name}</span><button className="track-mute-button" type="button" disabled={locked} aria-label={t(mutedTracks.includes(track.name) ? "Unmute {track}" : "Mute {track}", { track: track.name })} aria-pressed={mutedTracks.includes(track.name)} onClick={() => onMute(track.name)}>{mutedTracks.includes(track.name) ? <VolumeX size={16} /> : <Volume2 size={16} />}</button></div>
            {track.steps.map((symbol, step) => {
              const shown = displayHandSymbol(symbol, reversed);
              const selected = selection.track === trackIndex && selection.step === step;
              return <button type="button" key={step} data-note={`${trackIndex}-${step}`} data-symbol={shown}
                className={`step-cell ${symbol === "." ? "rest-cell" : "hit-cell"} ${step % perBeat === 0 ? "beat-start" : ""} ${selected && !locked ? "selected-note" : ""} ${activeStep === step ? recording ? "recording-playhead" : "playhead" : ""}`}
                disabled={locked} aria-pressed={selected && !locked} aria-haspopup="dialog"
                aria-label={t("{track} step {step}: {symbol}", { track: track.name, step: step + 1, symbol: shown })}
                onKeyDown={(event) => {
                  const offset = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : event.key === "ArrowDown" ? perBeat : event.key === "ArrowUp" ? -perBeat : 0;
                  if (!offset) return;
                  event.preventDefault(); event.stopPropagation();
                  const next = (step + offset + length) % length;
                  onSelect({ track: trackIndex, step: next });
                  scroll.current?.querySelector<HTMLButtonElement>(`[data-note="${trackIndex}-${next}"]`)?.focus({ preventScroll: true });
                }}
                onClick={(event) => {
                  trigger.current = event.currentTarget;
                  const next = { track: trackIndex, step };
                  onSelect(next); setPicker(next);
                }}>{shown === "." ? "·" : shown}</button>;
            })}
          </div>)}
        </div>
      </div>
      <div className="composer-grid-navigation">
        {scrollable ? <div><button type="button" aria-label={t("Previous beat")} disabled={visibleBeat <= 1} onClick={() => moveBeat(-1)}><ChevronLeft size={18} /></button><span>{t("Beat {beat} of {total}", { beat: visibleBeat, total: beats })}</span><button type="button" aria-label={t("Next beat")} disabled={visibleBeat >= beats} onClick={() => moveBeat(1)}><ChevronRight size={18} /></button></div> : <span className="composer-beat-total">{t("{count} beats", { count: beats })}</span>}
        <button type="button" disabled={locked} onClick={onAddBeat}><Plus size={15} />{t("Add beat")}</button>
      </div>
      <dialog className="composer-note-dialog" ref={dialog} style={position} aria-label={t("Change hit")}
        onCancel={(event) => { event.preventDefault(); closePicker(); }}
        onKeyDown={(event) => event.stopPropagation()}
        onClick={(event) => { if (event.target === event.currentTarget) { const rect = event.currentTarget.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) closePicker(); } }}>
        <div className="composer-picker-title"><strong>{t("Change hit")}</strong><button type="button" aria-label={t("Close note picker")} onClick={closePicker}><X size={18} /></button></div>
        <div className="composer-note-choices">
          {pickedTrack ? symbols.map((symbol) => {
            const shown = displayHandSymbol(symbol, reversed);
            const selected = pickedTrack.steps[picker!.step] === symbol;
            return <button type="button" key={symbol} data-symbol={shown} aria-label={t(noteLabel(pickedTrack.name, shown))} aria-pressed={selected} onClick={() => { onChange(picker!, symbol); closePicker(); }}>
              {selected ? <Check className="note-choice-check" size={15} /> : null}<strong>{shown === "." ? "·" : shown}</strong><span>{t(noteLabel(pickedTrack.name, shown))}</span>
            </button>;
          }) : null}
        </div>
      </dialog>
    </div>
  );
}

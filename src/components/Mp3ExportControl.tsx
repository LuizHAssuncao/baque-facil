import { useEffect, useId, useMemo, useRef, useState } from "react";
import { errorMessage, type Message } from "../lib/i18n/messages";
import { useTranslation } from "../lib/i18n/useTranslation";
import { EXPORT_REPETITIONS, mp3ExportKey, planMp3Export, type Mp3ExportRequest } from "../lib/audio/exportMp3";
import { MP3_SAMPLE_RATE } from "../lib/audio/mp3Constants";
import { formatAudioDuration } from "../lib/audio/downloadMp3";
import { useMp3Export } from "../lib/audio/useMp3Export";
import { Mp3SaveActions } from "./Mp3SaveActions";

export function Mp3ExportControl({ rhythm, samples, tempo, mutedTracks, defaultRepetitions, disabledReason, open, panelId }: Omit<Mp3ExportRequest, "repetitions"> & {
  defaultRepetitions: number;
  disabledReason?: Message;
  open: boolean;
  panelId: string;
}) {
  const { t, locale } = useTranslation();
  const id = useId();
  const [repetitions, setRepetitions] = useState(defaultRepetitions);
  const request = useMemo(() => ({ rhythm, samples, tempo, mutedTracks, repetitions }), [rhythm, samples, tempo, mutedTracks, repetitions]);
  const planned = useMemo(() => {
    try { return { plan: planMp3Export(request), error: null }; }
    catch (cause) { return { plan: null, error: errorMessage(cause, "Unable to prepare the MP3. Please try again.") }; }
  }, [request]);
  const reason = disabledReason ?? planned.error;
  const exporting = useMp3Export();
  const preparing = exporting.status === "preparing";
  const prepareButton = useRef<HTMLButtonElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  // Cancel stays mounted, allowing focus to return when preparation completes.
  useEffect(() => {
    if (!preparing && document.activeElement === cancelButton.current) prepareButton.current?.focus();
  }, [preparing]);
  const sizeFormat = useMemo(() => new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }), [locale]);
  const stale = exporting.result && (exporting.result.key !== mp3ExportKey(request) || Boolean(disabledReason));

  return (
    <div className="mp3-export" id={panelId} hidden={!open}>
      <div className="mp3-panel">
        <div className="mp3-repetitions">
          <label htmlFor={`${id}-repetitions`}>{t("Repetitions")}</label>
          <select id={`${id}-repetitions`} value={repetitions} disabled={preparing} onChange={(event) => setRepetitions(Number(event.target.value))}>
            {EXPORT_REPETITIONS.map((count) => <option key={count} value={count}>{count}</option>)}
          </select>
        </div>
        {planned.plan ? <p>{t("{tempo} BPM · about {duration}, plus final drum decay", {
          tempo: planned.plan.tempo, duration: formatAudioDuration(planned.plan.totalFrames / MP3_SAMPLE_RATE),
        })}</p> : null}
        <p className="mp3-note">{t("Exports the whole pattern with your current tempo and unmuted tracks. One repetition includes the entire sequence.")}</p>
        {reason ? <p id={`${id}-reason`} className="mp3-error">{t(reason)}</p> : null}
        <div className="mp3-actions">
          <button ref={prepareButton} className="mp3-button" type="button" disabled={preparing || Boolean(reason)} aria-describedby={reason ? `${id}-reason` : undefined} onClick={() => void exporting.prepare(request)}>
            {t("Prepare MP3")}
          </button>
          <button ref={cancelButton} className="mp3-button" type="button" hidden={!preparing} onClick={() => {
            exporting.cancel();
            requestAnimationFrame(() => prepareButton.current?.focus());
          }}>{t("Cancel")}</button>
        </div>
        <p role="status" className="mp3-status">
          {preparing ? t("Preparing MP3…") : exporting.status === "ready" ? t("Your MP3 is ready.") : exporting.status === "cancelled" ? t("MP3 preparation cancelled.") : ""}
        </p>
        {preparing ? <div className="mp3-progress">
          <progress max={100} value={exporting.progress} aria-label={t("MP3 preparation")} />
          <span aria-hidden="true">{exporting.progress}%</span>
        </div> : null}
        {exporting.error ? <p className="mp3-error" role="alert">{t(exporting.error)}</p> : null}
        {exporting.result ? <div className="mp3-result">
          <p className="mp3-filename">{exporting.result.filename}</p>
          <p>{t("{tempo} BPM · {count} repetitions · {duration} · {size} MB", {
            tempo: exporting.result.tempo, count: exporting.result.repetitions,
            duration: formatAudioDuration(exporting.result.duration), size: sizeFormat.format(exporting.result.blob.size / 1_000_000),
          })}</p>
          {stale ? <p>{t("The pattern or settings changed. This file uses the settings captured when preparation started. Prepare again to include your changes.")}</p> : null}
          <Mp3SaveActions download={exporting.result} />
        </div> : null}
      </div>
    </div>
  );
}

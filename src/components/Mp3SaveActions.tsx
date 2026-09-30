import { useEffect, useState } from "react";
import { Download, Share2 } from "lucide-react";
import { useTranslation } from "../lib/i18n/useTranslation";
import type { MessageKey } from "../lib/i18n/messages";
import { saveMp3, type Mp3Download } from "../lib/audio/downloadMp3";

export function Mp3SaveActions({ download, label = "Save MP3" }: {
  download: Mp3Download;
  label?: MessageKey;
}) {
  const { t } = useTranslation();
  const [canShare, setCanShare] = useState(false);
  const [error, setError] = useState<MessageKey | null>(null);
  useEffect(() => {
    setError(null);
    try {
      const file = new File([download.blob], download.filename, { type: "audio/mpeg" });
      setCanShare(Boolean(navigator.canShare?.({ files: [file] })));
    } catch {
      setCanShare(false);
    }
  }, [download]);

  async function share() {
    setError(null);
    try {
      await navigator.share({ files: [new File([download.blob], download.filename, { type: "audio/mpeg" })] });
    } catch (cause) {
      if (!(cause instanceof DOMException && cause.name === "AbortError")) {
        setError("Unable to share the MP3. Try Save MP3 instead.");
      }
    }
  }

  return (
    <div className="mp3-save">
      <div className="mp3-actions">
        <button type="button" className="mp3-button" onClick={() => {
          setError(null);
          try { saveMp3(download); }
          catch { setError("Unable to save the MP3. Please try again."); }
        }}>
          <Download size={17} aria-hidden="true" />{t(label)}
        </button>
        {canShare ? (
          <button type="button" className="mp3-button" onClick={() => void share()}>
            <Share2 size={17} aria-hidden="true" />{t("Share MP3")}
          </button>
        ) : null}
      </div>
      {error ? <p role="alert" className="mp3-error">{t(error)}</p> : null}
    </div>
  );
}

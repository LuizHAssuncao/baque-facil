import { useId, useState } from "react";
import { Share2 } from "lucide-react";
import { errorMessage, type Message } from "../lib/i18n/messages";
import { useTranslation } from "../lib/i18n/useTranslation";
import type { Rhythm } from "../lib/rhythmTypes";
import { createRhythmShareUrl } from "../lib/shareRhythm";

type Props = { rhythm: Rhythm; disabledReason?: Message };
type ShareResult = { rhythm: Rhythm; url?: string; message?: Message; error?: Message };

export default function ShareRhythmControl({ rhythm, disabledReason }: Props) {
  const { t } = useTranslation();
  const id = useId();
  const [result, setResult] = useState<ShareResult | null>(null);
  // Editing invalidates the displayed snapshot and any pending clipboard result.
  const current = !disabledReason && result?.rhythm === rhythm ? result : null;

  async function share() {
    if (disabledReason) return;
    let url: string;
    try {
      url = createRhythmShareUrl(rhythm, window.location.origin);
    } catch (cause) {
      setResult({ rhythm, error: errorMessage(cause, "This rhythm link is invalid or incomplete.") });
      return;
    }
    const next = { rhythm, url };
    setResult(next);
    let message: Message;
    try {
      await navigator.clipboard.writeText(url);
      message = "Rhythm link copied.";
    } catch {
      message = "Copy unavailable. Select and copy the link below.";
    }
    setResult((previous) => previous === next ? { ...next, message } : previous);
  }

  return <div className="composer-share">
    <button type="button" onClick={() => void share()} disabled={Boolean(disabledReason)}
      aria-describedby={disabledReason ? `${id}-reason` : undefined}>
      <Share2 size={16} aria-hidden="true" />{t("Share rhythm")}
    </button>
    {disabledReason ? <p id={`${id}-reason`}>{t(disabledReason)}</p> : null}
    {current?.error ? <p role="alert">{t(current.error)}</p> : null}
    {current?.url ? <div className="composer-share-link">
      <p role="status">{current.message ? t(current.message) : t("Rhythm link ready.")}</p>
      <label htmlFor={`${id}-link`}>{t("Rhythm link")}</label>
      <input id={`${id}-link`} type="text" readOnly value={current.url} onFocus={(event) => event.currentTarget.select()} />
      <p>{t("This link opens this version of your rhythm. After editing, share again to create a new link.")}</p>
    </div> : null}
  </div>;
}

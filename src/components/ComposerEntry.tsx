import { useEffect, useState, type ComponentProps } from "react";
import { errorMessage, type Message } from "../lib/i18n/messages";
import { useTranslation } from "../lib/i18n/useTranslation";
import type { Rhythm } from "../lib/rhythmTypes";
import { readRhythmShareUrl } from "../lib/shareRhythm";
import RhythmComposer from "./RhythmComposer";

// Resolve a shared snapshot before mounting: the ordinary composer restores and
// saves local drafts on mount, which must never replace data from a shared link.
export default function ComposerEntry(props: ComponentProps<typeof RhythmComposer>) {
  const { t } = useTranslation();
  const [entry, setEntry] = useState<{ key: string; rhythm?: Rhythm; error?: Message } | null>(null);
  useEffect(() => {
    function load() {
      try {
        const rhythm = readRhythmShareUrl(window.location.href);
        setEntry({ key: rhythm ? window.location.hash : "local", rhythm: rhythm ?? undefined });
      } catch (cause) {
        setEntry({ key: window.location.hash, error: errorMessage(cause, "This rhythm link is invalid or incomplete.") });
      }
    }
    load();
    window.addEventListener("hashchange", load);
    return () => window.removeEventListener("hashchange", load);
  }, []);
  if (!entry) return <p role="status">{t("Loading rhythm…")}</p>;
  if (entry.error) return <section className="error-panel" role="alert">
    <h1>{t("Unable to open shared rhythm")}</h1>
    <p>{t(entry.error)}</p>
    <a href="/compose/">{t("Open my composer")}</a>
  </section>;
  return <RhythmComposer
    {...props}
    key={entry.key}
    initialRhythm={entry.rhythm ?? props.initialRhythm}
    initialTranscription={entry.rhythm ? undefined : props.initialTranscription}
    sharedSnapshot={Boolean(entry.rhythm)}
  />;
}

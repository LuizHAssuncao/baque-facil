export type Mp3Download = Readonly<{
  blob: Blob;
  filename: string;
  duration: number;
}>;

export function mp3Filename(title: string, suffix: string): string {
  const name = title.normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);
  return `${name || "baque-facil-composition"}-${suffix}.mp3`;
}

export function formatAudioDuration(seconds: number): string {
  const rounded = Math.ceil(seconds);
  return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, "0")}`;
}

/** Give the browser its own URL so replacing playback or export state cannot revoke it. */
export function saveMp3(download: Mp3Download): void {
  const url = URL.createObjectURL(download.blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = download.filename;
  document.body.append(link);
  try {
    link.click();
  } finally {
    link.remove();
    // Safari may consume the URL after the click handler has returned.
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}

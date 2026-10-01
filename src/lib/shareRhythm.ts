import { z } from "zod";
import { TranslatableError } from "./i18n/messages";
import type { Rhythm } from "./rhythmTypes";
import { sampleMap } from "./sampleMap";
import { MAX_TEMPO, MIN_TEMPO } from "./tempo";
import { validateRhythmIssues } from "./validateRhythm";

// A conservative sharing budget, not a browser URL limit. Keep v1 readable forever.
export const MAX_SHARE_URL_LENGTH = 2000;
const sharedRhythm = z.object({
  v: z.literal(1),
  name: z.string().trim().min(1).max(200).regex(/^[^\u0000-\u001f\u007f]*$/),
  tempo: z.number().int().min(MIN_TEMPO).max(MAX_TEMPO),
  subdivision: z.union([z.literal(8), z.literal(16), z.literal(32)]),
  tracks: z.array(z.object({
    name: z.string().min(1).max(100),
    steps: z.string().min(1).max(MAX_SHARE_URL_LENGTH),
  }).strict()).min(1).max(20),
}).strict();

function invalidLink(): never {
  throw new TranslatableError("This rhythm link is invalid or incomplete.");
}

function validatePayload(value: unknown): Rhythm {
  const result = sharedRhythm.safeParse(value);
  if (!result.success) return invalidLink();
  const data = result.data;
  const rhythm: Rhythm = {
    title: data.name,
    slug: "shared-rhythm",
    tempo: data.tempo,
    subdivision: data.subdivision,
    tracks: data.tracks.map((track) => ({ name: track.name, steps: [...track.steps] })),
  };
  const instruments = new Set(Object.keys(sampleMap).map((key) => key.split(".")[0]));
  if (rhythm.tracks.some((track) => !instruments.has(track.name)) || validateRhythmIssues(rhythm).length) {
    return invalidLink();
  }
  return rhythm;
}

export function createRhythmShareUrl(rhythm: Rhythm, origin: string): string {
  const payload = {
    v: 1,
    name: rhythm.title,
    tempo: rhythm.tempo,
    subdivision: rhythm.subdivision,
    tracks: rhythm.tracks.map((track) => ({ name: track.name, steps: track.steps.join("") })),
  };
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  const prefix = `${new URL("/compose/", origin).href}#rhythm=`;
  if (prefix.length + Math.ceil(bytes.length * 4 / 3) > MAX_SHARE_URL_LENGTH) {
    throw new TranslatableError("This rhythm is too large for a share link. You can keep editing or export the transcription.");
  }
  if (rhythm.tracks.some((track) => track.steps.some((step) => step.length !== 1))) return invalidLink();
  validatePayload(payload);
  const encoded = btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return prefix + encoded;
}

export function readRhythmShareUrl(url: string): Rhythm | null {
  const hash = new URL(url).hash;
  if (!hash.startsWith("#rhythm=")) return null;
  if (url.length > MAX_SHARE_URL_LENGTH) return invalidLink();
  const encoded = hash.slice("#rhythm=".length);
  if (!/^[A-Za-z0-9_-]+$/.test(encoded)) return invalidLink();
  let payload: unknown;
  try {
    const binary = atob(encoded.replace(/-/g, "+").replace(/_/g, "/"));
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    payload = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return invalidLink();
  }
  if (payload && typeof payload === "object" && "v" in payload && payload.v !== 1) {
    throw new TranslatableError("This rhythm link uses an unsupported version. Try updating the app.");
  }
  return validatePayload(payload);
}

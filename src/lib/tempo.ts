export const MIN_TEMPO = 30;
export const MAX_TEMPO = 130;
export const DEFAULT_TEMPO = 90;

export function clampTempo(value: number, fallback = DEFAULT_TEMPO) {
  if (!Number.isFinite(value)) {
    return fallback;
  }

  return Math.min(MAX_TEMPO, Math.max(MIN_TEMPO, Math.round(value)));
}

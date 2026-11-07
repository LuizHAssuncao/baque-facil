export const RADIO_DISPLAY_PREFERENCES_KEY = "baque-facil-radio-display-v1";

export type RadioDisplayPreferences = {
  showRhythmNames: boolean;
  showNotes: boolean;
};

export function normalizeRadioDisplayPreferences(value: unknown): RadioDisplayPreferences {
  const input = value && typeof value === "object"
    ? value as Partial<RadioDisplayPreferences>
    : {};
  return {
    showRhythmNames: typeof input.showRhythmNames === "boolean" ? input.showRhythmNames : true,
    showNotes: typeof input.showNotes === "boolean" ? input.showNotes : true,
  };
}

export function readRadioDisplayPreferences(): RadioDisplayPreferences {
  try {
    return normalizeRadioDisplayPreferences(JSON.parse(
      window.localStorage.getItem(RADIO_DISPLAY_PREFERENCES_KEY) ?? "null",
    ));
  } catch {
    return normalizeRadioDisplayPreferences(null);
  }
}

export function writeRadioDisplayPreferences(preferences: RadioDisplayPreferences) {
  try {
    window.localStorage.setItem(RADIO_DISPLAY_PREFERENCES_KEY, JSON.stringify(preferences));
  } catch {
    // The controls still work when browser storage is unavailable.
  }
}

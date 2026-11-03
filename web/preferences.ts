import { useState } from "react";
import { parseSavedPreferences, type Preferences } from "../src/domain/preferences";
import { api } from "./api";

/** The server fills this element in index.html with the preferences saved by earlier runs. */
export const PREFERENCES_ELEMENT_ID = "reviewonator-preferences";

export function readPreferences(): Preferences {
  try {
    return parseSavedPreferences(JSON.parse(document.getElementById(PREFERENCES_ELEMENT_ID)?.textContent || "{}"));
  } catch {
    return parseSavedPreferences({});
  }
}

export function usePreference<K extends keyof Preferences>(
  key: K,
): [Preferences[K], (next: Preferences[K]) => void] {
  const [value, setValue] = useState<Preferences[K]>(() => readPreferences()[key]);

  function change(next: Preferences[K]) {
    setValue(next);
    const element = document.getElementById(PREFERENCES_ELEMENT_ID);
    if (element) element.textContent = JSON.stringify({ ...readPreferences(), [key]: next });
    // A failed save only costs the choice on the next run; it still applies now.
    api.savePreferences({ [key]: next }).catch(() => {});
  }

  return [value, change];
}

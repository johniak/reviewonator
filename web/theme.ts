import { createElement, useEffect, useState } from "react";

export type ThemePreference = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

export const THEME_STORAGE_KEY = "reviewonator-theme";

const preferences: ThemePreference[] = ["system", "light", "dark"];
const labels: Record<ThemePreference, string> = { system: "System", light: "Light", dark: "Dark" };

export function readThemePreference(): ThemePreference {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return stored === "light" || stored === "dark" ? stored : "system";
  } catch {
    return "system";
  }
}

export function resolveTheme(preference: ThemePreference): ResolvedTheme {
  if (preference !== "system") return preference;
  const prefersDark = typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-color-scheme: dark)").matches;
  return prefersDark ? "dark" : "light";
}

export function applyTheme(preference: ThemePreference): ResolvedTheme {
  const resolved = resolveTheme(preference);
  document.documentElement.dataset.theme = resolved;
  return resolved;
}

/** Mirrors the inline script in index.html so tests and late renders agree with the first paint. */
export function applyStoredTheme(): ResolvedTheme {
  return applyTheme(readThemePreference());
}

export function useTheme(): [ThemePreference, ResolvedTheme, (next: ThemePreference) => void] {
  const [preference, setPreferenceState] = useState<ThemePreference>(readThemePreference);
  const [resolved, setResolved] = useState<ResolvedTheme>(() => applyTheme(preference));

  useEffect(() => {
    setResolved(applyTheme(preference));
    if (preference !== "system" || typeof window.matchMedia !== "function") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => setResolved(applyTheme("system"));
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [preference]);

  function setPreference(next: ThemePreference) {
    try {
      if (next === "system") window.localStorage.removeItem(THEME_STORAGE_KEY);
      else window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Storage can be unavailable; the choice still applies for this session.
    }
    setPreferenceState(next);
  }

  return [preference, resolved, setPreference];
}

export function ThemeSwitcher({
  preference,
  onChange,
}: {
  preference: ThemePreference;
  onChange: (next: ThemePreference) => void;
}) {
  return createElement(
    "div",
    { className: "theme-switcher", role: "group", "aria-label": "Colour theme" },
    preferences.map((value) => createElement(
      "button",
      {
        key: value,
        type: "button",
        className: value === preference ? "active" : "",
        "aria-pressed": value === preference,
        onClick: () => onChange(value),
      },
      labels[value],
    )),
  );
}

import { createElement, useEffect, useState } from "react";
import type { ThemePreference } from "../src/domain/preferences";
import { readPreferences, usePreference } from "./preferences";

export type { ThemePreference };
export type ResolvedTheme = "light" | "dark";

const preferences: ThemePreference[] = ["system", "light", "dark"];
const labels: Record<ThemePreference, string> = { system: "System", light: "Light", dark: "Dark" };

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
  return applyTheme(readPreferences().theme);
}

export function useTheme(): [ThemePreference, ResolvedTheme, (next: ThemePreference) => void] {
  const [preference, setPreference] = usePreference("theme");
  const [resolved, setResolved] = useState<ResolvedTheme>(() => applyTheme(preference));

  useEffect(() => {
    setResolved(applyTheme(preference));
    if (preference !== "system" || typeof window.matchMedia !== "function") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => setResolved(applyTheme("system"));
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [preference]);

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

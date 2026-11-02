import { createElement } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyStoredTheme, resolveTheme, THEME_STORAGE_KEY, ThemeSwitcher, useTheme } from "../../web/theme";

function ThemedSwitcher() {
  const [preference, , setPreference] = useTheme();
  return createElement(ThemeSwitcher, { preference, onChange: setPreference });
}

function stubSystemScheme(dark: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: dark && query.includes("dark"),
    media: query,
    addEventListener() {},
    removeEventListener() {},
  }));
}

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("theme preference", () => {
  it("follows the system colour scheme by default", () => {
    stubSystemScheme(true);
    expect(resolveTheme("system")).toBe("dark");
    stubSystemScheme(false);
    expect(resolveTheme("system")).toBe("light");
  });

  it("applies the stored preference to the document before React renders", () => {
    stubSystemScheme(true);
    window.localStorage.setItem(THEME_STORAGE_KEY, "light");

    applyStoredTheme();

    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("ignores an invalid stored value and falls back to the system scheme", () => {
    stubSystemScheme(false);
    window.localStorage.setItem(THEME_STORAGE_KEY, "sepia");

    applyStoredTheme();

    expect(document.documentElement.dataset.theme).toBe("light");
  });
});

describe("ThemeSwitcher", () => {
  it("remembers a manual choice and lets the user return to the system setting", async () => {
    stubSystemScheme(true);
    applyStoredTheme();
    render(createElement(ThemedSwitcher));

    expect(screen.getByRole("button", { name: "System" })).toHaveAttribute("aria-pressed", "true");
    expect(document.documentElement.dataset.theme).toBe("dark");

    await userEvent.click(screen.getByRole("button", { name: "Light" }));

    expect(screen.getByRole("button", { name: "Light" })).toHaveAttribute("aria-pressed", "true");
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");

    await userEvent.click(screen.getByRole("button", { name: "System" }));

    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
  });
});

import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createElement } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GitHubGateway, LoadedPullRequest, PublishedReview } from "../../src/github/client";
import { createApp } from "../../src/server/app";
import { FilePreferenceStore } from "../../src/server/preferences";
import { ReviewSession } from "../../src/server/session";
import { applyStoredTheme, resolveTheme, ThemeSwitcher, useTheme } from "../../web/theme";
import { discussion, patch, pullRequest, review } from "../fixtures";
import { closePage, indexHtml, openPage, runFirstPaintScript } from "./page";

class ThemeGateway implements GitHubGateway {
  async verifyPrerequisites() {}
  async loadPullRequest(): Promise<LoadedPullRequest> { return { pullRequest, patch, discussion, viewedFiles: [] }; }
  async setFileViewed() {}
  async getHeadSha() { return pullRequest.headRefOid; }
  async loadFileContext() { return { oldContent: "", newContent: "" }; }
  async publishReview(): Promise<PublishedReview> { throw new Error("Not used."); }
}

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

function showSavedPreferences(json: string) {
  closePage();
  const element = document.createElement("script");
  element.id = "reviewonator-preferences";
  element.type = "application/json";
  element.textContent = json;
  document.head.append(element);
}

async function serveThemePreferences() {
  const preferences = new FilePreferenceStore({
    REVIEWONATOR_STATE_DIR: await mkdtemp(join(tmpdir(), "reviewonator-theme-preferences-")),
  });
  const session = new ReviewSession(pullRequest, patch, review, new ThemeGateway(), discussion);
  const serverApp = createApp({ html: indexHtml, favicon: "<svg></svg>", token: "secret", session, preferences });
  vi.stubGlobal("fetch", (input: string | URL | Request, init?: RequestInit) => {
    const value = input instanceof Request ? input.url : input.toString();
    const url = new URL(value, "http://reviewonator.local");
    return serverApp.request(`${url.pathname}${url.search}`, init);
  });
  window.location.hash = "secret";
  return { preferences, serverApp };
}

beforeEach(() => {
  closePage();
  document.documentElement.removeAttribute("data-theme");
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.location.hash = "";
});

describe("theme preference", () => {
  it("follows the system colour scheme by default", () => {
    stubSystemScheme(true);
    expect(resolveTheme("system")).toBe("dark");
    stubSystemScheme(false);
    expect(resolveTheme("system")).toBe("light");
  });

  it("applies the saved theme before the first paint and again when React starts", () => {
    stubSystemScheme(true);
    showSavedPreferences('{"theme":"light","viewMode":"single","diffStyle":"unified"}');

    runFirstPaintScript();
    expect(document.documentElement.dataset.theme).toBe("light");

    document.documentElement.removeAttribute("data-theme");
    applyStoredTheme();
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it.each([
    ["an unknown theme", '{"theme":"sepia"}'],
    ["a corrupt preferences element", "{"],
  ])("follows the system scheme for %s", (_case, json) => {
    stubSystemScheme(true);
    showSavedPreferences(json);

    runFirstPaintScript();
    expect(document.documentElement.dataset.theme).toBe("dark");

    document.documentElement.removeAttribute("data-theme");
    applyStoredTheme();
    expect(document.documentElement.dataset.theme).toBe("dark");
  });
});

describe("ThemeSwitcher", () => {
  it("remembers a manual choice for the next run and lets the user return to the system setting", async () => {
    stubSystemScheme(true);
    const { preferences, serverApp } = await serveThemePreferences();
    await openPage(serverApp);
    applyStoredTheme();
    render(createElement(ThemedSwitcher));

    expect(screen.getByRole("button", { name: "System" })).toHaveAttribute("aria-pressed", "true");
    expect(document.documentElement.dataset.theme).toBe("dark");

    await userEvent.click(screen.getByRole("button", { name: "Light" }));

    expect(screen.getByRole("button", { name: "Light" })).toHaveAttribute("aria-pressed", "true");
    expect(document.documentElement.dataset.theme).toBe("light");
    await waitFor(async () => expect((await preferences.read()).theme).toBe("light"));

    await openPage(serverApp);
    document.documentElement.removeAttribute("data-theme");
    runFirstPaintScript();
    expect(document.documentElement.dataset.theme).toBe("light");

    await userEvent.click(screen.getByRole("button", { name: "System" }));

    expect(document.documentElement.dataset.theme).toBe("dark");
    await waitFor(async () => expect((await preferences.read()).theme).toBe("system"));
  });
});

import { readFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createElement } from "react";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GitHubGateway, LoadedPullRequest, PublishedReview } from "../../src/github/client";
import { createApp } from "../../src/server/app";
import { FilePreferenceStore } from "../../src/server/preferences";
import { ReviewSession } from "../../src/server/session";
import { App } from "../../web/App";
import { applyStoredTheme } from "../../web/theme";
import { discussion, patch, pullRequest, review } from "../fixtures";
import { closePage, indexHtml, openPage, runFirstPaintScript } from "./page";

class SettingsGateway implements GitHubGateway {
  async verifyPrerequisites() {}
  async loadPullRequest(): Promise<LoadedPullRequest> { return { pullRequest, patch, discussion, viewedFiles: [] }; }
  async setFileViewed() {}
  async getHeadSha() { return pullRequest.headRefOid; }
  async loadFileContext() { return { oldContent: "", newContent: "" }; }
  async publishReview(): Promise<PublishedReview> { throw new Error("Not used."); }
}

async function serveWorkspace() {
  const preferences = new FilePreferenceStore({
    REVIEWONATOR_STATE_DIR: await mkdtemp(join(tmpdir(), "reviewonator-palette-preferences-")),
  });
  const session = new ReviewSession(pullRequest, patch, review, new SettingsGateway(), discussion);
  const serverApp = createApp({ html: indexHtml, favicon: "<svg></svg>", token: "secret", session, preferences });
  vi.stubGlobal("fetch", (input: string | URL | Request, init?: RequestInit) => {
    const value = input instanceof Request ? input.url : input.toString();
    const url = new URL(value, "http://reviewonator.local");
    return serverApp.request(`${url.pathname}${url.search}`, init);
  });
  window.location.hash = "secret";
  return { preferences, serverApp, session };
}

function showSavedPreferences(json: string) {
  closePage();
  const element = document.createElement("script");
  element.id = "reviewonator-preferences";
  element.type = "application/json";
  element.textContent = json;
  document.head.append(element);
}

/** The `--pc-*` names declared by the stylesheet block whose selector is exactly `selector`. */
function declaredTokens(selector: string): string[] {
  const styles = readFileSync("web/styles.css", "utf8");
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const block = styles.match(new RegExp(`\\n${escaped} \\{([^}]*)\\}`))?.[1];
  if (!block) throw new Error(`web/styles.css has no ${selector} block.`);
  return [...block.matchAll(/(--pc-[a-z0-9-]+):/g)].map((match) => match[1]).sort();
}

beforeEach(() => {
  closePage();
  document.documentElement.removeAttribute("data-palette");
  document.documentElement.removeAttribute("data-theme");
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.location.hash = "";
  closePage();
});

describe("colour theme stylesheet", () => {
  it("gives Slate a value for every Paper Copper colour, in light and in dark", () => {
    const copperLight = declaredTokens(":root,\n[data-theme=\"light\"]");
    const copperDark = declaredTokens("[data-theme=\"dark\"]");

    expect(copperLight.length).toBeGreaterThan(40);
    expect(copperDark).toEqual(copperLight);
    expect(declaredTokens("[data-palette=\"slate\"][data-theme=\"light\"]")).toEqual(copperLight);
    expect(declaredTokens("[data-palette=\"slate\"][data-theme=\"dark\"]")).toEqual(copperLight);
  });
});

describe("colour theme preference", () => {
  it("applies the saved colour theme before the first paint and again when React starts", () => {
    showSavedPreferences('{"theme":"dark","palette":"slate"}');

    runFirstPaintScript();
    expect(document.documentElement.dataset.palette).toBe("slate");
    expect(document.documentElement.dataset.theme).toBe("dark");

    document.documentElement.removeAttribute("data-palette");
    applyStoredTheme();
    expect(document.documentElement.dataset.palette).toBe("slate");
  });

  it.each([
    ["nothing saved", "{}"],
    ["an unknown colour theme", '{"palette":"neon"}'],
    ["a corrupt preferences element", "{"],
  ])("uses Paper Copper for %s", (_case, json) => {
    showSavedPreferences(json);

    runFirstPaintScript();
    expect(document.documentElement.dataset.palette).toBe("copper");

    document.documentElement.removeAttribute("data-palette");
    applyStoredTheme();
    expect(document.documentElement.dataset.palette).toBe("copper");
  });
});

describe("Settings", () => {
  it("shows the colours of each theme and remembers the chosen one for the next run", async () => {
    const { preferences, serverApp, session } = await serveWorkspace();
    await openPage(serverApp);
    applyStoredTheme();
    render(createElement(App));
    await screen.findByRole("heading", { name: pullRequest.title });

    await userEvent.click(screen.getByRole("button", { name: "Settings" }));
    const dialog = screen.getByRole("dialog", { name: "Settings" });
    const copper = within(dialog).getByRole("radio", { name: /^Paper Copper/ });
    const slate = within(dialog).getByRole("radio", { name: /^Slate/ });
    expect(copper).toBeChecked();
    expect(document.documentElement.dataset.palette).toBe("copper");

    for (const [radio, palette] of [[copper, "copper"], [slate, "slate"]] as const) {
      const previews = [...radio.closest("label")!.querySelectorAll<HTMLElement>(".palette-preview")];
      const label = (preview: HTMLElement) => preview.querySelector(".palette-preview-label")?.textContent;
      expect(previews.map((preview) => [preview.dataset.palette, preview.dataset.theme, label(preview)]))
        .toEqual([[palette, "light", "Light"], [palette, "dark", "Dark"]]);
      expect(previews[0].querySelectorAll(".palette-swatch").length).toBeGreaterThanOrEqual(10);
    }

    await userEvent.click(slate);

    expect(slate).toBeChecked();
    expect(document.documentElement.dataset.palette).toBe("slate");
    await waitFor(async () => expect((await preferences.read()).palette).toBe("slate"));

    await userEvent.click(within(dialog).getByRole("button", { name: "Close settings" }));
    expect(screen.queryByRole("dialog", { name: "Settings" })).not.toBeInTheDocument();

    await openPage(serverApp);
    document.documentElement.removeAttribute("data-palette");
    runFirstPaintScript();
    expect(document.documentElement.dataset.palette).toBe("slate");
    session.cancel();
  });
});

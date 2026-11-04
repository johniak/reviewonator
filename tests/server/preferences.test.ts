// @vitest-environment node

import { mkdir, mkdtemp, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FilePreferenceStore } from "../../src/server/preferences";

const defaults = { theme: "system", palette: "copper", viewMode: "single", diffStyle: "unified", collapsedBriefings: [] };

async function stateDirectory(): Promise<string> {
  return mkdtemp(join(tmpdir(), "reviewonator-preferences-test-"));
}

function storeIn(directory: string): FilePreferenceStore {
  return new FilePreferenceStore({ REVIEWONATOR_STATE_DIR: directory });
}

async function savedFile(directory: string, content: string): Promise<void> {
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "preferences.json"), content);
}

describe("FilePreferenceStore", () => {
  it("starts from the defaults before anything is saved", async () => {
    expect(await storeIn(await stateDirectory()).read()).toEqual(defaults);
  });

  it("keeps each saved choice for the next Reviewonator run", async () => {
    const directory = await stateDirectory();

    expect(await storeIn(directory).update({ theme: "dark" })).toEqual({ ...defaults, theme: "dark" });
    await storeIn(directory).update({ viewMode: "all" });

    expect(await storeIn(directory).read()).toEqual({ ...defaults, theme: "dark", viewMode: "all" });
  });

  it("keeps both of two changes made at the same time", async () => {
    const directory = await stateDirectory();
    const store = storeIn(directory);

    await Promise.all([store.update({ viewMode: "all" }), store.update({ diffStyle: "split" })]);

    expect(await storeIn(directory).read()).toEqual({ ...defaults, viewMode: "all", diffStyle: "split" });
  });

  it("writes a file only the user can read", async () => {
    const directory = await stateDirectory();

    await storeIn(directory).update({ theme: "light" });

    expect((await stat(join(directory, "preferences.json"))).mode & 0o777).toBe(0o600);
  });

  it("falls back to the defaults when the saved file is corrupt and replaces it on the next change", async () => {
    const directory = await stateDirectory();
    await savedFile(directory, "{");

    expect(await storeIn(directory).read()).toEqual(defaults);
    await storeIn(directory).update({ diffStyle: "split" });
    expect(await storeIn(directory).read()).toEqual({ ...defaults, diffStyle: "split" });
  });

  it("keeps the valid choices when one saved value is unknown", async () => {
    const directory = await stateDirectory();
    await savedFile(directory, JSON.stringify({ theme: "sepia", viewMode: "all", columns: 3 }));

    expect(await storeIn(directory).read()).toEqual({ ...defaults, viewMode: "all" });
  });

  it("remembers which pull requests have their briefing collapsed", async () => {
    const directory = await stateDirectory();
    const collapsedBriefings = ["https://github.com/acme/widgets/pull/42"];

    await storeIn(directory).update({ collapsedBriefings });

    expect(await storeIn(directory).read()).toEqual({ ...defaults, collapsedBriefings });
  });

  it("forgets a malformed list of collapsed briefings without losing the other choices", async () => {
    const directory = await stateDirectory();
    await savedFile(directory, JSON.stringify({ viewMode: "all", collapsedBriefings: "all of them" }));

    expect(await storeIn(directory).read()).toEqual({ ...defaults, viewMode: "all" });
  });

  it("remembers the colour theme and falls back to Paper Copper for an unknown one", async () => {
    const directory = await stateDirectory();

    await storeIn(directory).update({ palette: "slate" });
    expect(await storeIn(directory).read()).toEqual({ ...defaults, palette: "slate" });

    await savedFile(directory, JSON.stringify({ palette: "neon", theme: "dark" }));
    expect(await storeIn(directory).read()).toEqual({ ...defaults, theme: "dark" });
  });
});

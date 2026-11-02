// @vitest-environment node

import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { UpdateChecker } from "../../src/update/update-check";

const now = new Date("2026-11-02T12:00:00.000Z");
const hoursAgo = (hours: number) => new Date(now.getTime() - hours * 3_600_000).toISOString();

class Releases {
  calls = 0;
  signal: AbortSignal | undefined;

  constructor(private readonly answer: () => Promise<string>) {}

  latestVersion(signal?: AbortSignal) {
    this.calls += 1;
    this.signal = signal;
    return this.answer();
  }
}

async function checkerFixture(
  answer: () => Promise<string> = async () => "0.8.0",
  extraEnv: NodeJS.ProcessEnv = {},
  timeoutMs?: number,
) {
  const stateDir = await mkdtemp(join(tmpdir(), "reviewonator-update-check-"));
  const env = { REVIEWONATOR_STATE_DIR: stateDir, ...extraEnv };
  const releases = new Releases(answer);
  const cachePath = join(stateDir, "update-check.json");
  const create = () => new UpdateChecker({ version: "0.7.0", env, releases, now: () => now, timeoutMs });
  const writeCache = async (cache: unknown) => {
    await mkdir(stateDir, { recursive: true });
    await writeFile(cachePath, typeof cache === "string" ? cache : JSON.stringify(cache));
  };
  return { env, releases, cachePath, create, writeCache };
}

const notice08 = {
  current: "0.7.0",
  latest: "0.8.0",
  releaseUrl: "https://github.com/johniak/reviewonator/releases/tag/v0.8.0",
};

describe("UpdateChecker", () => {
  it("uses a fresh cache without asking for the latest release", async () => {
    const fixture = await checkerFixture(async () => { throw new Error("must not be called"); });
    await fixture.writeCache({ checkedAt: hoursAgo(1), latestVersion: "0.8.0" });

    expect(await fixture.create().notice()).toEqual(notice08);
    expect(fixture.releases.calls).toBe(0);
  });

  it("refreshes a stale cache and returns a notice for a newer version", async () => {
    const fixture = await checkerFixture(async () => "0.8.0");
    await fixture.writeCache({ checkedAt: hoursAgo(25), latestVersion: "0.7.5" });
    const checker = fixture.create();

    checker.start();

    expect(await checker.notice()).toEqual(notice08);
    expect(fixture.releases.calls).toBe(1);
    expect(JSON.parse(await readFile(fixture.cachePath, "utf8"))).toEqual({
      checkedAt: now.toISOString(),
      latestVersion: "0.8.0",
    });
  });

  it("returns null when the latest version is not newer", async () => {
    const same = await checkerFixture(async () => "0.7.0");
    expect(await same.create().notice()).toBeNull();
    const older = await checkerFixture(async () => "0.6.9");
    expect(await older.create().notice()).toBeNull();
  });

  it("hides a dismissed version but shows a newer one", async () => {
    const fixture = await checkerFixture(async () => "0.8.0");
    const checker = fixture.create();
    expect(await checker.notice()).toEqual(notice08);

    await checker.dismiss("0.8.0");

    expect(await checker.notice()).toBeNull();
    expect(await fixture.create().notice()).toBeNull();
    await fixture.writeCache({ checkedAt: hoursAgo(1), latestVersion: "0.9.0", dismissedVersion: "0.8.0" });
    expect((await fixture.create().notice())?.latest).toBe("0.9.0");
  });

  it("stays silent when the release lookup fails", async () => {
    const stderr = vi.spyOn(process.stderr, "write");
    const fixture = await checkerFixture(async () => { throw new Error("gh: not logged in"); });

    expect(await fixture.create().notice()).toBeNull();
    expect(stderr).not.toHaveBeenCalled();
  });

  it("does not wait longer than the cap for a slow lookup", async () => {
    const fixture = await checkerFixture(() => new Promise<string>(() => {}));
    const started = Date.now();

    expect(await fixture.create().notice(50)).toBeNull();
    expect(Date.now() - started).toBeLessThan(500);
  });

  it("aborts a slow lookup once the timeout passes", async () => {
    const fixture = await checkerFixture(() => new Promise<string>(() => {}), {}, 50);
    const checker = fixture.create();

    checker.start();
    await new Promise((resolve) => setTimeout(resolve, 150));

    expect(fixture.releases.signal?.aborted).toBe(true);
    expect(await checker.notice(10)).toBeNull();
  });

  it("stop aborts an in-flight lookup", async () => {
    const fixture = await checkerFixture(() => new Promise<string>(() => {}), {}, 60_000);
    const checker = fixture.create();
    checker.start();
    await new Promise((resolve) => setTimeout(resolve, 20));

    checker.stop();

    expect(fixture.releases.signal?.aborted).toBe(true);
  });

  it("does nothing when REVIEWONATOR_NO_UPDATE_CHECK is set", async () => {
    const fixture = await checkerFixture(async () => "0.8.0", { REVIEWONATOR_NO_UPDATE_CHECK: "1" });
    const checker = fixture.create();

    checker.start();

    expect(await checker.notice()).toBeNull();
    expect(fixture.releases.calls).toBe(0);
  });

  it("treats a corrupt cache as stale", async () => {
    const fixture = await checkerFixture(async () => "0.8.0");
    await fixture.writeCache("{ nope");

    expect(await fixture.create().notice()).toEqual(notice08);
    expect(fixture.releases.calls).toBe(1);
  });
});

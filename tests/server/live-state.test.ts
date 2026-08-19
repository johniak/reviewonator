// @vitest-environment node

import { mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  liveStatePath,
  readLiveState,
  removeLiveState,
  writeLiveState,
} from "../../src/server/live-state";

describe("live session state", () => {
  it("finds a session by PR URL and stores its local secret with owner-only permissions", async () => {
    const directory = await mkdtemp(join(tmpdir(), "reviewonator-state-"));
    const env = { REVIEWONATOR_STATE_DIR: directory };
    const state = {
      prUrl: "https://github.com/acme/widgets/pull/42",
      baseUrl: "http://127.0.0.1:1234",
      token: "local-secret",
      pid: 123,
      startedAt: "2026-08-12T00:00:00.000Z",
    };

    await writeLiveState(state, env);

    expect(await readLiveState(`${state.prUrl}/`, env)).toEqual(state);
    expect((await stat(liveStatePath(state.prUrl, env))).mode & 0o777).toBe(0o600);
    expect((await stat(directory)).mode & 0o777).toBe(0o700);
  });

  it("removes completed session state without failing when called twice", async () => {
    const directory = await mkdtemp(join(tmpdir(), "reviewonator-state-"));
    const env = { REVIEWONATOR_STATE_DIR: directory };
    const prUrl = "https://github.com/acme/widgets/pull/42";
    await writeLiveState({
      prUrl,
      baseUrl: "http://127.0.0.1:1234",
      token: "local-secret",
      pid: 123,
      startedAt: "2026-08-12T00:00:00.000Z",
    }, env);

    await removeLiveState(prUrl, env);
    await removeLiveState(prUrl, env);

    await expect(readLiveState(prUrl, env)).rejects.toThrow(/No live Reviewonator session/);
  });
});

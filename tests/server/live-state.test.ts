// @vitest-environment node

import { mkdtemp, stat, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  findActiveLiveSession,
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

  it("finds an active live session and ignores finished, unreachable and non-session files", async () => {
    const directory = await mkdtemp(join(tmpdir(), "reviewonator-state-"));
    const env = { REVIEWONATOR_STATE_DIR: directory };
    expect(await findActiveLiveSession(env)).toBeNull();
    const server = await listen();
    const closed = await listen();
    await new Promise((resolve) => closed.server.close(resolve));
    const base = { token: "secret", pid: 1, startedAt: "2026-11-02T00:00:00.000Z" };
    await writeLiveState({ ...base, prUrl: "https://github.com/acme/widgets/pull/1", baseUrl: closed.url }, env);
    await writeLiveState({
      ...base,
      prUrl: "https://github.com/acme/widgets/pull/2",
      baseUrl: server.url,
      result: { status: "cancelled" },
    }, env);
    await writeFile(join(directory, "update-check.json"), JSON.stringify({ baseUrl: server.url }));
    expect(await findActiveLiveSession(env)).toBeNull();

    await writeLiveState({ ...base, prUrl: "https://github.com/acme/widgets/pull/3", baseUrl: server.url }, env);

    expect((await findActiveLiveSession(env))?.prUrl).toBe("https://github.com/acme/widgets/pull/3");
    server.server.close();
  });
});

async function listen(): Promise<{ server: Server; url: string }> {
  const server = createServer((request, response) => {
    response.writeHead(request.url === "/health" ? 200 : 404).end("{}");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No server address.");
  return { server, url: `http://127.0.0.1:${address.port}` };
}

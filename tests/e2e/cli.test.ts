// @vitest-environment node

import { execFile, spawn } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import type { ReviewDocument } from "../../src/domain/review";
import { liveStatePath, writeLiveState } from "../../src/server/live-state";

const fixtureDir = resolve("tests/e2e/fixtures");
const reviewFile = join(fixtureDir, "review.json");
const prUrl = "https://github.com/acme/widgets/pull/42";
const activeChildren = new Set<ReturnType<typeof spawn>>();
const run = promisify(execFile);

afterEach(() => {
  for (const child of activeChildren) child.kill();
  activeChildren.clear();
});

async function startReviewonator(
  extraEnv: NodeJS.ProcessEnv = {},
  live = false,
  options: { early?: boolean; reviewFile?: string } = {},
) {
  const args = [
    "src/cli.ts",
    prUrl,
    "--review-file", options.reviewFile ?? reviewFile,
    "--no-open",
    "--port", "0",
  ];
  if (live) args.push("--live");
  if (options.early) args.push("--early");
  const child = spawn("bun", [
    ...args,
  ], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      REVIEWONATOR_NO_UPDATE_CHECK: "1",
      REVIEWONATOR_STATE_DIR: join(tmpdir(), `reviewonator-e2e-state-${process.pid}`),
      ...extraEnv,
      PATH: `${fixtureDir}${delimiter}${process.env.PATH}`,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  activeChildren.add(child);
  child.once("exit", () => activeChildren.delete(child));

  let stderr = "";
  const ready = new Promise<{ baseUrl: string; token: string }>((resolveReady, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Reviewonator did not start. ${stderr}`)), 10_000);
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
      const match = stderr.match(/(http:\/\/127\.0\.0\.1:\d+\/)#([\w-]+)/);
      if (match) {
        clearTimeout(timeout);
        resolveReady({ baseUrl: match[1], token: match[2] });
      }
    });
    child.once("exit", (code) => {
      if (code && !stderr.includes("Reviewonator is ready")) {
        clearTimeout(timeout);
        reject(new Error(`Reviewonator exited with ${code}. ${stderr}`));
      }
    });
  });

  const stdoutChunks: Buffer[] = [];
  child.stdout.on("data", (chunk) => stdoutChunks.push(chunk));
  return {
    child,
    ready,
    output: () => Buffer.concat(stdoutChunks).toString(),
  };
}

async function authenticatedFetch(baseUrl: string, token: string, path: string, init?: RequestInit) {
  return fetch(new URL(path, baseUrl), {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      ...init?.headers,
    },
  });
}

async function writeStartingFile(directory: string, overrides: Partial<ReviewDocument> = {}): Promise<string> {
  const original = JSON.parse(await readFile(reviewFile, "utf8")) as ReviewDocument;
  const path = join(directory, "starting.json");
  await writeFile(path, JSON.stringify({
    version: 2,
    prUrl: original.prUrl,
    languages: original.languages,
    summary: "",
    recommendation: "COMMENT",
    comments: [],
    userThreads: [],
    ...overrides,
  }));
  return path;
}

function waitForExit(child: ReturnType<typeof spawn>): Promise<number | null> {
  return new Promise((resolveExit) => child.once("exit", resolveExit));
}

async function readSseEvent(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  event: string,
): Promise<string> {
  const decoder = new TextDecoder();
  let content = "";
  while (!content.includes(`event: ${event}`)) {
    const next = await reader.read();
    if (next.done) throw new Error(`SSE stream ended before ${event}.`);
    content += decoder.decode(next.value, { stream: true });
  }
  return content;
}

describe("Reviewonator CLI end-to-end", () => {
  it("reports the packaged application version", async () => {
    const packageJson = JSON.parse(await readFile("package.json", "utf8")) as { version: string };
    const { stdout } = await run("bun", ["src/cli.ts", "--version"], { cwd: process.cwd() });

    expect(stdout).toBe(`Reviewonator ${packageJson.version}\n`);
  });

  it("does not offer updates from a development run", async () => {
    const stateDirectory = await mkdtemp(join(tmpdir(), "reviewonator-update-notice-"));
    const process = await startReviewonator({ REVIEWONATOR_NO_UPDATE_CHECK: "", REVIEWONATOR_STATE_DIR: stateDirectory });
    const { baseUrl, token } = await process.ready;

    const response = await authenticatedFetch(baseUrl, token, "/api/update-notice");

    expect(await response.json()).toEqual({ notice: null });
  });

  it("opens the next run with the preferences saved in the previous one", async () => {
    const stateDirectory = await mkdtemp(join(tmpdir(), "reviewonator-e2e-preferences-"));
    const first = await startReviewonator({ REVIEWONATOR_STATE_DIR: stateDirectory });
    const firstRun = await first.ready;

    const saved = await authenticatedFetch(firstRun.baseUrl, firstRun.token, "/api/preferences", {
      method: "POST",
      body: JSON.stringify({ theme: "dark", palette: "slate", viewMode: "all" }),
    });
    expect(saved.status).toBe(200);
    await authenticatedFetch(firstRun.baseUrl, firstRun.token, "/api/cancel", { method: "POST", body: "{}" });
    await waitForExit(first.child);

    const second = await startReviewonator({ REVIEWONATOR_STATE_DIR: stateDirectory });
    const secondRun = await second.ready;
    const page = await (await fetch(secondRun.baseUrl)).text();

    const embedded = page.match(/<script id="reviewonator-preferences" type="application\/json">([^<]*)<\/script>/)?.[1];

    expect(secondRun.baseUrl).not.toBe(firstRun.baseUrl);
    expect(JSON.parse(embedded ?? "null")).toEqual({ theme: "dark", palette: "slate", viewMode: "all", diffStyle: "unified", collapsedBriefings: [] });
  }, 20_000);

  it("exits right after its result even when the release lookup hangs", async () => {
    const stateDirectory = await mkdtemp(join(tmpdir(), "reviewonator-slow-release-"));
    const process = await startReviewonator({
      REVIEWONATOR_NO_UPDATE_CHECK: "",
      REVIEWONATOR_STATE_DIR: stateDirectory,
      REVIEWONATOR_TEST_SLOW_RELEASE: "1",
    });
    const { baseUrl, token } = await process.ready;

    const started = Date.now();
    await authenticatedFetch(baseUrl, token, "/api/cancel", { method: "POST", body: "{}" });
    await waitForExit(process.child);

    expect(JSON.parse(process.output())).toEqual({ status: "cancelled" });
    expect(Date.now() - started).toBeLessThan(3_000);
  }, 15_000);

  it("returns human revision requests to the AI agent as structured JSON", async () => {
    const process = await startReviewonator();
    const { baseUrl, token } = await process.ready;
    const session = await authenticatedFetch(baseUrl, token, "/api/session");
    expect(session.status).toBe(200);
    const snapshot = await session.json();
    expect(snapshot.discussion).toHaveLength(3);
    expect(snapshot.viewedFiles).toEqual(["src/config.ts"]);

    const viewed = await authenticatedFetch(baseUrl, token, "/api/viewed-files", {
      method: "POST",
      body: JSON.stringify({ path: "src/payments/retry.ts", viewed: true }),
    });
    expect(await viewed.json()).toEqual({ viewedFiles: ["src/config.ts", "src/payments/retry.ts"] });

    const revision = await authenticatedFetch(baseUrl, token, "/api/revision", {
      method: "POST",
      body: JSON.stringify({
        selectedCommentIds: ["G1"],
        rejectedCommentIds: ["S2"],
        requests: [{ commentId: "S1", message: "Verify provider idempotency." }],
        newThreads: [{
          id: "U3",
          path: "src/payments/retry.ts",
          line: 8,
          side: "RIGHT",
          message: "Check whether this retry can run forever and rewrite my comment.",
        }],
        threadReplies: [{
          threadId: "U1",
          message: "The provider docs say a timeout can happen after acceptance.",
        }],
        dismissedThreads: [{
          threadId: "U2",
          reason: "The external worker deadline does bound this path.",
        }],
      }),
    });
    expect(revision.status).toBe(200);
    expect(await waitForExit(process.child)).toBe(0);
    expect(JSON.parse(process.output())).toEqual({
      status: "revision_requested",
      review: expect.objectContaining({
        comments: expect.arrayContaining([expect.objectContaining({ id: "S1" }), expect.objectContaining({ id: "G1" })]),
      }),
      selectedCommentIds: ["G1"],
      rejectedCommentIds: ["S2"],
      requests: [{ commentId: "S1", message: "Verify provider idempotency." }],
      newThreads: [{
        id: "U3",
        path: "src/payments/retry.ts",
        line: 8,
        side: "RIGHT",
        message: "Check whether this retry can run forever and rewrite my comment.",
      }],
      threadReplies: [{
        threadId: "U1",
        message: "The provider docs say a timeout can happen after acceptance.",
      }],
      dismissedThreads: [{
        threadId: "U2",
        reason: "The external worker deadline does bound this path.",
      }],
    });
  }, 15_000);

  it("publishes the confirmed selection as one GitHub review", async () => {
    const temp = await mkdtemp(join(tmpdir(), "reviewonator-publish-test-"));
    const capture = join(temp, "payload.json");
    const process = await startReviewonator({ REVIEWONATOR_PUBLISH_CAPTURE: capture });
    const { baseUrl, token } = await process.ready;

    const response = await authenticatedFetch(baseUrl, token, "/api/publish", {
      method: "POST",
      body: JSON.stringify({
        confirmed: true,
        event: "REQUEST_CHANGES",
        body: "Confirmed review body",
        selectedCommentIds: ["S1"],
      }),
    });
    expect(response.status).toBe(200);
    expect(await waitForExit(process.child)).toBe(0);

    const payload = JSON.parse(await readFile(capture, "utf8"));
    expect(payload.event).toBe("REQUEST_CHANGES");
    expect(payload.comments).toHaveLength(1);
    expect(payload.comments[0]).toMatchObject({ path: "src/payments/retry.ts", line: 8, side: "RIGHT" });
    expect(JSON.stringify(payload)).not.toContain("Wszystkie próby muszą używać");
    expect(JSON.stringify(payload)).not.toContain("Ticket prosi");
    expect(JSON.stringify(payload)).not.toContain("ACME-142");
    expect(JSON.parse(process.output()).status).toBe("published");
  }, 15_000);

  it("keeps one browser session open for a live user-agent discussion", async () => {
    const temp = await mkdtemp(join(tmpdir(), "reviewonator-live-test-"));
    const stateDirectory = join(temp, "state");
    const env = { REVIEWONATOR_STATE_DIR: stateDirectory };
    const liveProcess = await startReviewonator(env, true);
    const liveExit = waitForExit(liveProcess.child);
    const { baseUrl, token } = await liveProcess.ready;
    await expect(run("bun", [
      "src/cli.ts", prUrl, "--review-file", reviewFile, "--live", "--no-open", "--port", "0",
    ], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        ...env,
        PATH: `${fixtureDir}${delimiter}${process.env.PATH}`,
      },
    })).rejects.toMatchObject({ stderr: expect.stringContaining("already open") });
    const events = await fetch(`${baseUrl}api/events?token=${encodeURIComponent(token)}`);
    expect(events.status).toBe(200);
    const eventReader = events.body!.getReader();
    expect(await readSseEvent(eventReader, "ready")).toContain("data: 0");

    const waited = run("bun", ["src/cli.ts", "wait", prUrl], {
      cwd: process.cwd(),
      env: { ...process.env, ...env },
    });
    await new Promise((resolve) => setTimeout(resolve, 11_000));
    expect((await authenticatedFetch(baseUrl, token, "/health")).status).toBe(200);

    const revision = await authenticatedFetch(baseUrl, token, "/api/revision", {
      method: "POST",
      body: JSON.stringify({
        newThreads: [{
          id: "U-live",
          path: "src/payments/retry.ts",
          line: 8,
          side: "RIGHT",
          message: "Can this charge the customer twice?",
        }],
      }),
    });
    expect(revision.status).toBe(200);
    expect((await revision.json()).session.live).toBe(true);
    expect(await readSseEvent(eventReader, "session")).toContain("data: 1");

    expect(JSON.parse((await waited).stdout)).toMatchObject({
      status: "revision_requested",
      newThreads: [{ id: "U-live", message: "Can this charge the customer twice?" }],
    });

    const current = await authenticatedFetch(baseUrl, token, "/api/session");
    const snapshot = await current.json() as { review: ReviewDocument };
    const responseFile = join(temp, "response.json");
    await writeFile(responseFile, JSON.stringify({
      ...snapshot.review,
      userThreads: snapshot.review.userThreads.map((thread) => thread.id === "U-live" ? {
        ...thread,
        messages: [...thread.messages, {
          id: "U-live-M2",
          author: "agent",
          body: "Yes. A retry needs the same idempotency key, so I linked this to S1.",
        }],
        findingId: "S1",
      } : thread),
    }));

    const responded = await run("bun", [
      "src/cli.ts", "respond", prUrl, "--review-file", responseFile,
    ], {
      cwd: process.cwd(),
      env: { ...process.env, ...env },
    });
    expect(JSON.parse(responded.stdout)).toEqual({ status: "accepted" });
    expect(await readSseEvent(eventReader, "session")).toContain("data: 2");

    const updated = await authenticatedFetch(baseUrl, token, "/api/session");
    const updatedSnapshot = await updated.json() as { review: { userThreads: Array<{ id: string; findingId?: string }> } };
    expect(updatedSnapshot.review.userThreads.find(({ id }) => id === "U-live")?.findingId).toBe("S1");

    const findingRevision = await authenticatedFetch(baseUrl, token, "/api/revision", {
      method: "POST",
      body: JSON.stringify({
        requests: [{ commentId: "S1", message: "Did you verify the provider documentation?" }],
      }),
    });
    expect(findingRevision.status).toBe(200);
    expect(await readSseEvent(eventReader, "session")).toContain("data: 3");
    const findingWait = await run("bun", ["src/cli.ts", "wait", prUrl], {
      cwd: process.cwd(),
      env: { ...process.env, ...env },
    });
    const findingRequest = JSON.parse(findingWait.stdout) as { review: ReviewDocument };
    expect(findingRequest.review.comments.find(({ id }) => id === "S1")?.discussion).toMatchObject([
      { author: "user", body: "Did you verify the provider documentation?" },
    ]);
    await writeFile(responseFile, JSON.stringify({
      ...findingRequest.review,
      comments: findingRequest.review.comments.map((comment) => comment.id === "S1" ? {
        ...comment,
        discussion: [...(comment.discussion ?? []), {
          id: "S1-D2",
          author: "agent",
          body: "Yes. The installed provider client requires an explicit idempotency key.",
        }],
      } : comment),
    }));
    await run("bun", ["src/cli.ts", "respond", prUrl, "--review-file", responseFile], {
      cwd: process.cwd(),
      env: { ...process.env, ...env },
    });
    expect(await readSseEvent(eventReader, "session")).toContain("data: 4");
    const afterFindingReply = await authenticatedFetch(baseUrl, token, "/api/session");
    const afterFindingSnapshot = await afterFindingReply.json() as { review: ReviewDocument };
    expect(afterFindingSnapshot.review.comments.find(({ id }) => id === "S1")?.discussion?.at(-1)).toMatchObject({
      author: "agent",
      body: "Yes. The installed provider client requires an explicit idempotency key.",
    });
    await eventReader.cancel();

    const finalWait = run("bun", ["src/cli.ts", "wait", prUrl], {
      cwd: process.cwd(),
      env: { ...process.env, ...env },
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect((await authenticatedFetch(baseUrl, token, "/api/cancel", {
      method: "POST",
      body: "{}",
    })).status).toBe(200);
    expect(JSON.parse((await finalWait).stdout)).toEqual({ status: "cancelled" });
    expect(await liveExit).toBe(0);
  }, 30_000);

  it("accepts an agent response that drops the author of the user's own comment", async () => {
    const temp = await mkdtemp(join(tmpdir(), "reviewonator-live-owned-"));
    const env = { REVIEWONATOR_STATE_DIR: join(temp, "state") };
    const liveProcess = await startReviewonator(env, true);
    const liveExit = waitForExit(liveProcess.child);
    const { baseUrl, token } = await liveProcess.ready;
    const cliOptions = { cwd: process.cwd(), env: { ...process.env, ...env } };

    const created = await authenticatedFetch(baseUrl, token, "/api/comments", {
      method: "POST",
      body: JSON.stringify({ path: "src/payments/retry.ts", line: 8, side: "RIGHT", body: "Name the retry limit." }),
    });
    expect(created.status).toBe(200);
    await authenticatedFetch(baseUrl, token, "/api/revision", {
      method: "POST",
      body: JSON.stringify({ requests: [{ commentId: "S1", message: "Is this right?" }] }),
    });
    const waited = JSON.parse((await run("bun", ["src/cli.ts", "wait", prUrl], cliOptions)).stdout) as { review: ReviewDocument };
    const responseFile = join(temp, "response.json");
    await writeFile(responseFile, JSON.stringify({
      ...waited.review,
      comments: waited.review.comments.map(({ author: _author, ...comment }) => comment.id === "S1" ? {
        ...comment,
        discussion: [...(comment.discussion ?? []), { id: "S1-D2", author: "agent", body: "Checked." }],
      } : comment),
    }));

    const responded = await run("bun", ["src/cli.ts", "respond", prUrl, "--review-file", responseFile], cliOptions);

    expect(JSON.parse(responded.stdout)).toEqual({ status: "accepted" });
    const snapshot = await (await authenticatedFetch(baseUrl, token, "/api/session")).json() as { review: ReviewDocument };
    expect(snapshot.review.comments.find(({ id }) => id === "H1")).toMatchObject({ author: "user", body: "Name the retry limit." });
    await authenticatedFetch(baseUrl, token, "/api/cancel", { method: "POST", body: "{}" });
    await liveExit;
  }, 30_000);

  it("distinguishes a stale saved session from a dropped wait connection", async () => {
    const stateDirectory = await mkdtemp(join(tmpdir(), "reviewonator-stale-test-"));
    const env = { REVIEWONATOR_STATE_DIR: stateDirectory };
    await writeLiveState({
      prUrl,
      baseUrl: "http://127.0.0.1:1",
      token: "stale-token",
      pid: 999_999,
      startedAt: new Date().toISOString(),
    }, env);

    await expect(run("bun", ["src/cli.ts", "wait", prUrl], {
      cwd: process.cwd(),
      env: { ...process.env, ...env },
    })).rejects.toMatchObject({
      stderr: expect.stringContaining("No running Reviewonator server was found"),
    });

    const droppedDirectory = await mkdtemp(join(tmpdir(), "reviewonator-dropped-test-"));
    const droppedEnv = { REVIEWONATOR_STATE_DIR: droppedDirectory };
    const server = createServer((request, response) => {
      if (request.url === "/health") {
        response.writeHead(200).end("ok");
        return;
      }
      request.socket.destroy();
    });
    await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Test server did not bind a TCP port.");
    await writeLiveState({
      prUrl,
      baseUrl: `http://127.0.0.1:${address.port}`,
      token: "dropped-token",
      pid: process.pid,
      startedAt: new Date().toISOString(),
    }, droppedEnv);

    try {
      await expect(run("bun", ["src/cli.ts", "wait", prUrl], {
        cwd: process.cwd(),
        env: { ...process.env, ...droppedEnv },
      })).rejects.toMatchObject({
        stderr: expect.stringContaining("wait connection ended unexpectedly"),
      });
    } finally {
      await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
    }
  });

  describe("early review", () => {
    async function startEarly(prefix: string) {
      const temp = await mkdtemp(join(tmpdir(), prefix));
      const env = { REVIEWONATOR_STATE_DIR: join(temp, "state") };
      const startingFile = await writeStartingFile(temp);
      const early = await startReviewonator(env, false, { early: true, reviewFile: startingFile });
      const exit = waitForExit(early.child);
      const { baseUrl, token } = await early.ready;
      const cli = (...args: string[]) => run("bun", ["src/cli.ts", ...args], { cwd: process.cwd(), env: { ...process.env, ...env } });
      const session = async () => await (await authenticatedFetch(baseUrl, token, "/api/session")).json() as {
        live: boolean;
        reviewing: { startedAt: string } | null;
        review: ReviewDocument;
      };
      return { temp, env, early, exit, baseUrl, token, cli, session };
    }

    it("delivers About this PR, then the final review, and releases a request queued meanwhile", async () => {
      const { temp, early, exit, baseUrl, token, cli, session } = await startEarly("reviewonator-early-");
      const original = JSON.parse(await readFile(reviewFile, "utf8")) as ReviewDocument;
      expect(early.output()).toBe("");
      const started = await session();
      expect(started.live).toBe(true);
      expect(started.reviewing).toMatchObject({ startedAt: expect.any(String) });

      const briefingFile = await writeStartingFile(temp, { briefing: original.briefing });
      const first = await cli("deliver", prUrl, "--review-file", briefingFile);
      expect(JSON.parse(first.stdout)).toEqual({ status: "accepted" });
      const afterBriefing = await session();
      expect(afterBriefing.reviewing).not.toBeNull();
      expect(afterBriefing.review.briefing?.text).toBe(original.briefing?.text);

      const queued = await authenticatedFetch(baseUrl, token, "/api/revision", {
        method: "POST",
        body: JSON.stringify({
          newThreads: [{ id: "U-early", path: "src/payments/retry.ts", line: 8, side: "RIGHT", message: "Is this safe?" }],
        }),
      });
      expect(queued.status).toBe(200);

      const finalFile = join(temp, "final.json");
      await writeFile(finalFile, JSON.stringify({ ...original, userThreads: [] }));
      const final = await cli("deliver", prUrl, "--review-file", finalFile, "--final");
      expect(JSON.parse(final.stdout)).toEqual({ status: "accepted" });
      const afterFinal = await session();
      expect(afterFinal.reviewing).toBeNull();
      expect(afterFinal.review.comments.map(({ id }) => id)).toEqual(["S1", "S2", "G1"]);

      const waited = JSON.parse((await cli("wait", prUrl)).stdout) as { status: string; newThreads: Array<{ id: string }>; review: ReviewDocument };
      expect(waited.status).toBe("revision_requested");
      expect(waited.newThreads.map(({ id }) => id)).toEqual(["U-early"]);
      expect(waited.review.comments).toHaveLength(3);

      await authenticatedFetch(baseUrl, token, "/api/cancel", { method: "POST", body: "{}" });
      await exit;
    }, 30_000);

    it("tells the agent that the review was cancelled and removes the saved session", async () => {
      const { temp, env, exit, baseUrl, token, cli } = await startEarly("reviewonator-early-cancel-");
      expect((await authenticatedFetch(baseUrl, token, "/api/cancel", { method: "POST", body: "{}" })).status).toBe(200);
      expect(await exit).toBe(0);
      const statePath = liveStatePath(prUrl, env);
      expect(JSON.parse(await readFile(statePath, "utf8")).result).toEqual({ status: "cancelled" });

      const delivered = await cli("deliver", prUrl, "--review-file", await writeStartingFile(temp));
      expect(JSON.parse(delivered.stdout)).toEqual({ status: "cancelled" });
      await expect(readFile(statePath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    }, 30_000);

    it("prints the session's error when the delivery is refused", async () => {
      const { temp, early, exit, baseUrl, token, cli } = await startEarly("reviewonator-early-refused-");
      const original = JSON.parse(await readFile(reviewFile, "utf8")) as ReviewDocument;
      const withFindings = join(temp, "findings.json");
      await writeFile(withFindings, JSON.stringify({ ...original, userThreads: [] }));
      await expect(cli("deliver", prUrl, "--review-file", withFindings)).rejects.toMatchObject({
        stderr: expect.stringContaining("A delivery before the final one cannot contain findings."),
      });
      expect(early.output()).toBe("");
      await authenticatedFetch(baseUrl, token, "/api/cancel", { method: "POST", body: "{}" });
      await exit;
    }, 30_000);

    it("refuses to start with findings already in the file", async () => {
      const temp = await mkdtemp(join(tmpdir(), "reviewonator-early-findings-"));
      await expect(run("bun", ["src/cli.ts", prUrl, "--review-file", reviewFile, "--early", "--no-open"], {
        cwd: process.cwd(),
        env: { ...process.env, REVIEWONATOR_STATE_DIR: join(temp, "state"), PATH: `${fixtureDir}${delimiter}${process.env.PATH}` },
      })).rejects.toMatchObject({ stderr: expect.stringContaining("An early review must start without findings.") });
    });

    it("lets a new start replace a cancelled leftover but not a published one", async () => {
      const temp = await mkdtemp(join(tmpdir(), "reviewonator-early-leftover-"));
      const env = { REVIEWONATOR_STATE_DIR: join(temp, "state") };
      const leftover = {
        prUrl,
        baseUrl: "http://127.0.0.1:1",
        token: "old",
        pid: 999_999,
        startedAt: new Date().toISOString(),
      };
      await writeLiveState({ ...leftover, result: { status: "published" } as never }, env);
      await expect(run("bun", ["src/cli.ts", prUrl, "--review-file", reviewFile, "--live", "--no-open"], {
        cwd: process.cwd(),
        env: { ...process.env, ...env, PATH: `${fixtureDir}${delimiter}${process.env.PATH}` },
      })).rejects.toMatchObject({ stderr: expect.stringContaining("A completed live session is waiting for the agent.") });

      await writeLiveState({ ...leftover, result: { status: "cancelled" } }, env);
      const restarted = await startReviewonator(env, true);
      const exit = waitForExit(restarted.child);
      const { baseUrl, token } = await restarted.ready;
      expect((await authenticatedFetch(baseUrl, token, "/health")).status).toBe(200);
      await authenticatedFetch(baseUrl, token, "/api/cancel", { method: "POST", body: "{}" });
      await exit;
    }, 30_000);

    it("lists deliver and --early in the help text", async () => {
      const { stdout } = await run("bun", ["src/cli.ts", "--help"], { cwd: process.cwd() });
      expect(stdout).toContain("reviewonator deliver <PR_URL> --review-file <PATH> [--final]");
      expect(stdout).toContain("[--early]");
    });
  });
});

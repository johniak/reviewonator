// @vitest-environment node

import { execFile, spawn } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import type { ReviewDocument } from "../../src/domain/review";
import { writeLiveState } from "../../src/server/live-state";

const fixtureDir = resolve("tests/e2e/fixtures");
const reviewFile = join(fixtureDir, "review.json");
const prUrl = "https://github.com/acme/widgets/pull/42";
const activeChildren = new Set<ReturnType<typeof spawn>>();
const run = promisify(execFile);

afterEach(() => {
  for (const child of activeChildren) child.kill();
  activeChildren.clear();
});

async function startReviewonator(extraEnv: NodeJS.ProcessEnv = {}, live = false) {
  const args = [
    "src/cli.ts",
    prUrl,
    "--review-file", reviewFile,
    "--no-open",
    "--port", "0",
  ];
  if (live) args.push("--live");
  const child = spawn("bun", [
    ...args,
  ], {
    cwd: process.cwd(),
    env: {
      ...process.env,
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

  it("returns human revision requests to the AI agent as structured JSON", async () => {
    const process = await startReviewonator();
    const { baseUrl, token } = await process.ready;
    const session = await authenticatedFetch(baseUrl, token, "/api/session");
    expect(session.status).toBe(200);
    expect((await session.json()).discussion).toHaveLength(3);

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
});

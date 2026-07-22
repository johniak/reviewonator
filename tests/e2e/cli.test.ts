// @vitest-environment node

import { execFile, spawn } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

const fixtureDir = resolve("tests/e2e/fixtures");
const reviewFile = join(fixtureDir, "review.json");
const prUrl = "https://github.com/acme/widgets/pull/42";
const activeChildren = new Set<ReturnType<typeof spawn>>();
const run = promisify(execFile);

afterEach(() => {
  for (const child of activeChildren) child.kill();
  activeChildren.clear();
});

async function startReviewonator(extraEnv: NodeJS.ProcessEnv = {}) {
  const child = spawn("bun", [
    "src/cli.ts",
    prUrl,
    "--review-file", reviewFile,
    "--no-open",
    "--port", "0",
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
        newComments: [{
          path: "src/payments/retry.ts",
          line: 8,
          side: "RIGHT",
          message: "Check whether this retry can run forever and rewrite my comment.",
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
      newComments: [{
        path: "src/payments/retry.ts",
        line: 8,
        side: "RIGHT",
        message: "Check whether this retry can run forever and rewrite my comment.",
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
});

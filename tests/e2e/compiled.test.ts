// @vitest-environment node

import { execFile, spawn } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

const run = promisify(execFile);
const fixtureDir = resolve("tests/e2e/fixtures");
const children = new Set<ReturnType<typeof spawn>>();
let root = "";
let executable = "";

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "reviewonator-compiled-"));
  await mkdir(join(root, "bin"));
  executable = join(root, "bin", "reviewonator");
  await run("bun", ["build", "--compile", "--target=bun", "src/cli.ts", "--outfile", executable], { cwd: process.cwd() });
  await writeFile(`${executable}.reviewonator-managed`, "Installed by Reviewonator\n");
}, 120_000);

afterEach(() => {
  for (const child of children) child.kill();
  children.clear();
});

describe("compiled executable installed by the install script", () => {
  it("offers an update found through gh", async () => {
    const child = spawn(executable, [
      "https://github.com/acme/widgets/pull/42",
      "--review-file", join(fixtureDir, "review.json"),
      "--no-open",
      "--port", "0",
    ], {
      env: {
        ...process.env,
        PATH: `${fixtureDir}${delimiter}${process.env.PATH}`,
        REVIEWONATOR_NO_UPDATE_CHECK: "",
        REVIEWONATOR_STATE_DIR: join(root, "state"),
        REVIEWONATOR_CONFIG_DIR: join(root, "config"),
        REVIEWONATOR_CLAUDE_SKILL_DIR: join(root, "claude"),
        REVIEWONATOR_CODEX_SKILL_DIR: join(root, "codex"),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    children.add(child);
    let stderr = "";
    const ready = await new Promise<{ baseUrl: string; token: string }>((resolveReady, reject) => {
      const timer = setTimeout(() => reject(new Error(`The compiled executable did not start. ${stderr}`)), 15_000);
      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
        const match = stderr.match(/(http:\/\/127\.0\.0\.1:\d+\/)#([\w-]+)/);
        if (match) {
          clearTimeout(timer);
          resolveReady({ baseUrl: match[1], token: match[2] });
        }
      });
    });

    const response = await fetch(new URL("/api/update-notice", ready.baseUrl), {
      headers: { authorization: `Bearer ${ready.token}` },
    });

    expect((await response.json()).notice).toMatchObject({
      latest: "99.0.0",
      releaseUrl: "https://github.com/johniak/reviewonator/releases/tag/v99.0.0",
    });
  }, 30_000);
});

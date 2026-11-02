// @vitest-environment node

import { execFile } from "node:child_process";
import { mkdtemp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const run = promisify(execFile);

async function listFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true, recursive: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => relative(directory, join(entry.parentPath, entry.name)))
    .sort();
}

async function isolatedEnv() {
  const root = await mkdtemp(join(tmpdir(), "reviewonator-e2e-setup-"));
  return {
    root,
    env: {
      ...process.env,
      REVIEWONATOR_CONFIG_DIR: join(root, "config"),
      REVIEWONATOR_CLAUDE_SKILL_DIR: join(root, "claude"),
      REVIEWONATOR_CODEX_SKILL_DIR: join(root, "codex"),
      REVIEWONATOR_STATE_DIR: join(root, "state"),
      REVIEWONATOR_NO_UPDATE_CHECK: "1",
    },
  };
}

describe("reviewonator setup end-to-end", () => {
  it("setup installs the embedded skill identical to skills/reviewonator", async () => {
    const { root, env } = await isolatedEnv();
    const packageJson = JSON.parse(await readFile("package.json", "utf8")) as { version: string };
    const target = join(root, "custom-claude");

    const { stdout } = await run("bun", [
      "src/cli.ts", "setup",
      "--targets", "claude",
      "--claude-skill-dir", target,
      "--comment-language", "English",
      "--reviewer-language", "English",
    ], { cwd: process.cwd(), env });

    expect(stdout).toContain(`Installed Claude Code skill: ${join(target, "reviewonator")}`);
    const sourceFiles = await listFiles("skills/reviewonator");
    expect(sourceFiles.length).toBeGreaterThan(0);
    expect(await listFiles(join(target, "reviewonator"))).toEqual([...sourceFiles, ".reviewonator-managed"].sort());
    for (const file of sourceFiles) {
      expect(await readFile(join(target, "reviewonator", file)), file)
        .toEqual(await readFile(join("skills/reviewonator", file)));
    }
    expect(await readFile(join(target, "reviewonator", ".reviewonator-managed"), "utf8"))
      .toBe(`Installed by Reviewonator ${packageJson.version}\n`);
  });
});

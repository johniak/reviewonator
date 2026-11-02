// @vitest-environment node

import { execFile, spawn } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
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

  it("a development run never syncs the installed skill", async () => {
    const { root, env } = await isolatedEnv();
    const skill = join(root, "claude", "reviewonator");
    await mkdir(skill, { recursive: true });
    await writeFile(join(skill, ".reviewonator-managed"), "Installed by Reviewonator 0.0.1\n");
    await writeFile(join(skill, "SKILL.md"), "outdated skill");
    await mkdir(env.REVIEWONATOR_CONFIG_DIR, { recursive: true });
    await writeFile(join(env.REVIEWONATOR_CONFIG_DIR, "config.json"), JSON.stringify({
      version: 1,
      targets: ["claude"],
      skillRoots: { claude: join(root, "claude") },
      languages: { comments: "English", reviewerNotes: "English" },
    }));

    await expect(run("bun", ["src/cli.ts", "wait", "https://github.com/acme/widgets/pull/42"], { cwd: process.cwd(), env }))
      .rejects.toMatchObject({ stderr: expect.stringContaining("No live Reviewonator session") });

    expect(await readFile(join(skill, "SKILL.md"), "utf8")).toBe("outdated skill");
    expect(await readFile(join(skill, ".reviewonator-managed"), "utf8")).toBe("Installed by Reviewonator 0.0.1\n");
  });

  it("update refuses to touch a development run", async () => {
    const { env } = await isolatedEnv();

    await expect(run("bun", ["src/cli.ts", "update"], { cwd: process.cwd(), env })).rejects.toMatchObject({
      stderr: expect.stringContaining("Reviewonator can only update installations made with Homebrew or the install script."),
    });
  });

  it("prompts through stdin on first setup and exits when done", async () => {
    const { root, env } = await isolatedEnv();
    const child = spawn("bun", ["src/cli.ts", "setup"], {
      cwd: process.cwd(),
      env: { ...env, REVIEWONATOR_INTERACTIVE: "1" },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.stdin.write("1,2\nGerman\nFrench\n");

    const exitCode = await new Promise<number | null>((resolveExit, reject) => {
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error(`setup did not exit after answering every prompt. ${stderr}`));
      }, 10_000);
      child.once("exit", (code) => { clearTimeout(timer); resolveExit(code); });
    });

    expect(exitCode).toBe(0);
    expect(stderr).toContain("Select one or more targets (comma-separated, for example 1,2): ");
    expect(stderr).toContain("Language for comments published to GitHub [English]: ");
    expect(stderr).toContain("Language for private reviewer notes [English]: ");
    expect(JSON.parse(await readFile(join(root, "config", "config.json"), "utf8"))).toMatchObject({
      targets: ["claude", "codex"],
      languages: { comments: "German", reviewerNotes: "French" },
    });
  }, 15_000);
});

// @vitest-environment node

import { execFile } from "node:child_process";
import { access, chmod, lstat, mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { removeOtherExecutables } from "../../src/install/other-executables";
import type { Prompter } from "../../src/install/prompt";
import type { CommandResult, CommandRunner, RunOptions } from "../../src/platform/command";

const execFileAsync = promisify(execFile);

/** Runs real processes, as BunCommandRunner does in the compiled executable. */
const processRunner: CommandRunner = {
  async run(command: string, args: string[], _input?: string, options: RunOptions = {}): Promise<CommandResult> {
    try {
      const { stdout, stderr } = await execFileAsync(command, args, { signal: options.signal });
      return { stdout, stderr, exitCode: 0 };
    } catch (error) {
      const failure = error as { stdout?: string; stderr?: string; code?: unknown };
      return { stdout: failure.stdout ?? "", stderr: failure.stderr ?? "", exitCode: typeof failure.code === "number" ? failure.code : 1 };
    }
  },
};

class ScriptedPrompter implements Prompter {
  readonly questions: string[] = [];

  constructor(private readonly answers: string[]) {}

  async ask(question: string): Promise<string> {
    this.questions.push(question);
    return this.answers.shift() ?? "";
  }
}

const exists = (path: string) => lstat(path).then(() => true, () => false);

async function executable(path: string, body: string) {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, `#!/bin/sh\n${body}\n`);
  await chmod(path, 0o755);
}

const reviewonator = (version: string) => `[ "$1" = "--version" ] && printf 'Reviewonator ${version}\\n'`;

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "reviewonator-other-executables-"));
  const self = join(root, "Cellar", "reviewonator", "0.9.0", "bin", "reviewonator");
  await executable(self, reviewonator("0.9.0"));
  const pathDir = join(root, "path-bin");
  const defaultBinDir = join(root, "default-bin");
  await mkdir(pathDir);
  const env: NodeJS.ProcessEnv = { PATH: [pathDir, "/usr/bin", "/bin"].join(delimiter), REVIEWONATOR_BIN_DIR: defaultBinDir };
  const lines: string[] = [];
  const remove = (prompter = new ScriptedPrompter([]), interactive = true, versionTimeoutMs?: number) =>
    removeOtherExecutables({
      executablePath: self,
      env,
      runner: processRunner,
      interactive,
      prompter,
      log: (line) => lines.push(line),
      versionTimeoutMs,
    });
  return { root, self, pathDir, defaultBinDir, lines, remove };
}

async function scriptInstall(directory: string) {
  await executable(join(directory, "reviewonator"), reviewonator("0.8.0"));
  await writeFile(join(directory, "reviewonator.reviewonator-managed"), "Installed by Reviewonator\n");
}

describe("removeOtherExecutables", () => {
  it("removes the install script's executable from PATH and from its default directory", async () => {
    const context = await fixture();
    await scriptInstall(context.pathDir);
    await scriptInstall(context.defaultBinDir);
    const prompter = new ScriptedPrompter([]);

    await context.remove(prompter);

    for (const directory of [context.pathDir, context.defaultBinDir]) {
      expect(await exists(join(directory, "reviewonator"))).toBe(false);
      expect(await exists(join(directory, "reviewonator.reviewonator-managed"))).toBe(false);
    }
    expect(prompter.questions).toEqual([]);
    expect(context.lines).toEqual([
      `Removed the Reviewonator executable installed by the install script: ${join(context.pathDir, "reviewonator")}`,
      `Removed the Reviewonator executable installed by the install script: ${join(context.defaultBinDir, "reviewonator")}`,
    ]);
  });

  it("leaves its own executable alone when PATH reaches it through a symlink", async () => {
    const context = await fixture();
    await symlink(context.self, join(context.pathDir, "reviewonator"));

    await context.remove();

    expect(await exists(join(context.pathDir, "reviewonator"))).toBe(true);
    expect(context.lines).toEqual([]);
  });

  it("asks before removing a Reviewonator executable without the install script's marker", async () => {
    const context = await fixture();
    const path = join(context.pathDir, "reviewonator");
    await executable(path, reviewonator("0.7.0"));
    const prompter = new ScriptedPrompter(["y"]);

    await context.remove(prompter);

    expect(prompter.questions).toEqual([`Remove Reviewonator 0.7.0 at ${path}, which Homebrew did not install? [y/N] `]);
    expect(await exists(path)).toBe(false);
    expect(context.lines).toEqual([`Removed the Reviewonator executable: ${path}`]);
  });

  it("removes only the symlink when the person agrees", async () => {
    const context = await fixture();
    const build = join(context.root, "checkout", "dist", "reviewonator");
    await executable(build, reviewonator("0.9.1"));
    await symlink(build, join(context.pathDir, "reviewonator"));

    await context.remove(new ScriptedPrompter(["yes"]));

    expect(await exists(join(context.pathDir, "reviewonator"))).toBe(false);
    expect(await exists(build)).toBe(true);
  });

  it("keeps it when the answer is no, and only reports it without a terminal", async () => {
    const context = await fixture();
    const path = join(context.pathDir, "reviewonator");
    await executable(path, reviewonator("0.7.0"));
    const kept = `Kept the Reviewonator executable at ${path}. Remove it so that the Homebrew installation is the one that runs.`;

    await context.remove(new ScriptedPrompter([""]));
    await context.remove(new ScriptedPrompter(["y"]), false);

    expect(await exists(path)).toBe(true);
    expect(context.lines).toEqual([kept, kept]);
  });

  it("ignores other programs named reviewonator", async () => {
    const context = await fixture();
    await executable(join(context.pathDir, "reviewonator"), "printf 'something else\\n'");
    await mkdir(context.defaultBinDir);
    await writeFile(join(context.defaultBinDir, "reviewonator"), "not executable");
    const prompter = new ScriptedPrompter(["y"]);

    await context.remove(prompter);

    expect(prompter.questions).toEqual([]);
    expect(context.lines).toEqual([]);
    await expect(access(join(context.pathDir, "reviewonator"))).resolves.toBeUndefined();
  });

  it("gives up on an executable that does not answer --version", async () => {
    const context = await fixture();
    await executable(join(context.pathDir, "reviewonator"), "exec sleep 30");
    const started = Date.now();

    await context.remove(new ScriptedPrompter(["y"]), true, 200);

    expect(Date.now() - started).toBeLessThan(5_000);
    expect(await exists(join(context.pathDir, "reviewonator"))).toBe(true);
    expect(context.lines).toEqual([]);
  });
});

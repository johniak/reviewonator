import { access, constants, lstat, realpath, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import type { CommandRunner } from "../platform/command";
import type { Prompter } from "./prompt";

export type OtherExecutablesContext = {
  /** The Homebrew executable running setup. */
  executablePath: string;
  env: NodeJS.ProcessEnv;
  runner: CommandRunner;
  interactive: boolean;
  prompter: Prompter;
  log: (line: string) => void;
  versionTimeoutMs?: number;
};

const SCRIPT_MARKER = ".reviewonator-managed";
const VERSION_LINE = /^Reviewonator (\d+\.\d+\.\d+)$/m;

/**
 * Homebrew was installed last, so it wins: removes the executable the install script put on PATH or in its
 * default directory, and asks before removing any other Reviewonator executable.
 */
export async function removeOtherExecutables(context: OtherExecutablesContext): Promise<void> {
  const self = await realpath(context.executablePath).catch(() => resolve(context.executablePath));
  for (const path of candidates(context.env)) {
    if (!(await exists(path))) continue;
    if ((await realpath(path).catch(() => path)) === self) continue;

    if (await exists(`${path}${SCRIPT_MARKER}`)) {
      await rm(path, { force: true });
      await rm(`${path}${SCRIPT_MARKER}`, { force: true });
      context.log(`Removed the Reviewonator executable installed by the install script: ${path}`);
      continue;
    }

    const version = await reviewonatorVersion(path, context);
    if (!version) continue;
    const answer = context.interactive
      ? await context.prompter.ask(`Remove Reviewonator ${version} at ${path}, which Homebrew did not install? [y/N] `)
      : "";
    if (/^y(es)?$/i.test(answer.trim())) {
      await rm(path, { force: true });
      context.log(`Removed the Reviewonator executable: ${path}`);
    } else {
      context.log(`Kept the Reviewonator executable at ${path}. Remove it so that the Homebrew installation is the one that runs.`);
    }
  }
}

function candidates(env: NodeJS.ProcessEnv): string[] {
  const directories = (env.PATH ?? "").split(delimiter).filter(Boolean);
  directories.push(env.REVIEWONATOR_BIN_DIR || join(homedir(), ".local", "bin"));
  return [...new Set(directories.map((directory) => join(resolve(directory), "reviewonator")))];
}

async function reviewonatorVersion(path: string, context: OtherExecutablesContext): Promise<string | null> {
  try {
    await access(path, constants.X_OK);
    const result = await context.runner.run(path, ["--version"], undefined, {
      signal: AbortSignal.timeout(context.versionTimeoutMs ?? 5_000),
    });
    return result.exitCode === 0 ? result.stdout.match(VERSION_LINE)?.[1] ?? null : null;
  } catch {
    return null;
  }
}

async function exists(path: string): Promise<boolean> {
  return lstat(path).then(() => true, () => false);
}

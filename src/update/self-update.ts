import { createHash } from "node:crypto";
import { access, chmod, constants, copyFile, mkdtemp, readFile, realpath, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import type { InstallMethod } from "../install/install-method";
import { compareVersions } from "../install/version";
import type { CommandRunner } from "../platform/command";
import { findActiveLiveSession } from "../server/live-state";
import { platformName, type ReleaseSource } from "./releases";

export type UpdateContext = {
  installMethod: InstallMethod;
  runner: CommandRunner;
  releases: ReleaseSource;
  version: string;
  env: NodeJS.ProcessEnv;
  log: (line: string) => void;
  platform?: string;
};

export async function runUpdate(options: { force: boolean }, context: UpdateContext): Promise<void> {
  const { installMethod, env } = context;
  if (installMethod.kind === "unmanaged") {
    throw new Error("Reviewonator can only update installations made with Homebrew or the install script.");
  }
  if (!options.force) {
    const active = await findActiveLiveSession(env);
    if (active) throw new Error(`Finish the open live review for ${active.prUrl} before updating, or pass --force.`);
  }
  const updatedPath = installMethod.kind === "homebrew"
    ? await updateWithHomebrew(context)
    : await updateScriptInstall(installMethod.executablePath, options.force, context);
  if (updatedPath) await warnAboutShadowing(updatedPath, context);
}

async function updateWithHomebrew(context: UpdateContext): Promise<string> {
  const { runner, log } = context;
  const upgrade = await runner.run("brew", ["upgrade", "reviewonator"]);
  logLines(upgrade.stdout, log);
  logLines(upgrade.stderr, log);
  if (upgrade.exitCode !== 0) throw new Error("brew upgrade reviewonator failed.");
  const prefix = await runner.run("brew", ["--prefix", "reviewonator"]);
  if (prefix.exitCode !== 0) throw new Error(`Could not locate the Homebrew installation: ${prefix.stderr.trim()}`);
  const executable = join(prefix.stdout.trim(), "bin", "reviewonator");
  await refreshSkills(executable, context);
  return executable;
}

async function updateScriptInstall(executablePath: string, force: boolean, context: UpdateContext): Promise<string | null> {
  const { log, version } = context;
  const latest = await context.releases.latestVersion();
  const comparison = compareVersions(version, latest);
  if (!force && comparison === 0) {
    log(`Reviewonator ${version} is already up to date.`);
    return null;
  }
  if (!force && comparison > 0) {
    log(`Installed Reviewonator ${version} is newer than the latest release ${latest}; keeping it.`);
    return null;
  }

  const directory = dirname(executablePath);
  try {
    await access(directory, constants.W_OK);
  } catch {
    throw new Error(`Cannot update ${executablePath}: ${directory} is not writable.`);
  }

  const archive = `reviewonator-${context.platform ?? platformName()}.tar.gz`;
  const workspace = await mkdtemp(join(tmpdir(), "reviewonator-update-"));
  const staged = join(directory, `.reviewonator-update-${process.pid}`);
  try {
    await context.releases.download(latest, [archive, `${archive}.sha256`], workspace);
    const expected = (await readFile(join(workspace, `${archive}.sha256`), "utf8")).trim().split(/\s+/)[0];
    const actual = createHash("sha256").update(await readFile(join(workspace, archive))).digest("hex");
    if (!expected || expected !== actual) throw new Error(`Checksum verification failed for ${archive}.`);
    const extracted = await context.runner.run("tar", ["-xzf", join(workspace, archive), "-C", workspace]);
    if (extracted.exitCode !== 0) throw new Error(`Could not extract ${archive}: ${extracted.stderr.trim()}`);
    try {
      await access(join(workspace, "reviewonator"), constants.X_OK);
    } catch {
      throw new Error(`The downloaded ${archive} does not contain the Reviewonator executable.`);
    }
    await copyFile(join(workspace, "reviewonator"), staged);
    await chmod(staged, 0o755);
    await rename(staged, executablePath);
  } finally {
    await rm(staged, { force: true });
    await rm(workspace, { recursive: true, force: true });
  }
  await refreshSkills(executablePath, context);
  log(`Updated Reviewonator ${version} to ${latest}.`);
  return executablePath;
}

async function refreshSkills(executable: string, context: UpdateContext): Promise<void> {
  const setup = await context.runner.run(executable, ["setup"]);
  logLines(setup.stdout, context.log);
  if (setup.exitCode !== 0) {
    context.log("Run reviewonator setup to install the Reviewonator skill for Claude Code or Codex.");
  }
}

async function warnAboutShadowing(updatedPath: string, context: UpdateContext): Promise<void> {
  const target = await realpath(updatedPath).catch(() => updatedPath);
  for (const directory of (context.env.PATH ?? "").split(delimiter).filter(Boolean)) {
    const candidate = join(directory, "reviewonator");
    try {
      await access(candidate, constants.X_OK);
    } catch {
      continue;
    }
    if ((await realpath(candidate).catch(() => candidate)) !== target) {
      context.log(`Another reviewonator at ${candidate} comes first on PATH.`);
    }
    return;
  }
}

function logLines(output: string, log: (line: string) => void): void {
  for (const line of output.split("\n")) if (line.trim()) log(line.trimEnd());
}

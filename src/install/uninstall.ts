import { rm } from "node:fs/promises";
import {
  defaultSkillRoots,
  parseTargets,
  readConfig,
  removeConfig,
  targetLabels,
  writeConfig,
  type Target,
} from "./config";
import type { InstallMethod } from "./install-method";
import { readSkillMarker, removeSkill, skillDirectory } from "./skill";

export type UninstallOptions = { targets?: string };
export type UninstallContext = {
  env: NodeJS.ProcessEnv;
  installMethod: InstallMethod;
  log: (line: string) => void;
};

const ALL_TARGETS: Target[] = ["claude", "codex"];

export async function runUninstall(options: UninstallOptions, context: UninstallContext): Promise<void> {
  const { env, log } = context;
  const config = await readConfig(env);
  const defaults = defaultSkillRoots(env);
  const directoryOf = (target: Target) => skillDirectory(config?.skillRoots[target] ?? defaults[target]);

  const given = options.targets ?? env.REVIEWONATOR_TARGETS;
  const selected = given
    ? parseTargets(given)
    : config?.targets ?? await managedTargets(directoryOf);

  const handled = new Set<string>();
  for (const target of selected) {
    const directory = directoryOf(target);
    if (handled.has(directory)) continue;
    handled.add(directory);
    const outcome = await removeSkill(directory);
    if (outcome === "removed") log(`Removed ${targetLabels[target]} skill: ${directory}`);
    if (outcome === "unmanaged") log(`Kept unmanaged skill: ${directory}`);
  }

  if (config) {
    const remaining = config.targets.filter((target) => !selected.includes(target));
    if (remaining.length === 0) {
      await removeConfig(env);
    } else {
      await writeConfig({
        ...config,
        targets: remaining,
        skillRoots: Object.fromEntries(remaining.map((target) => [target, config.skillRoots[target]])),
      }, env);
    }
  }

  if ((await managedTargets(directoryOf)).length > 0) {
    log("Kept Reviewonator executable because another installed integration still uses it.");
    return;
  }
  const { kind, executablePath } = context.installMethod;
  if (kind === "script") {
    await rm(executablePath, { force: true });
    await rm(`${executablePath}.reviewonator-managed`, { force: true });
    log(`Removed Reviewonator executable: ${executablePath}`);
  } else if (kind === "homebrew") {
    log("Run brew uninstall reviewonator to remove the executable.");
  }
}

async function managedTargets(directoryOf: (target: Target) => string): Promise<Target[]> {
  const targets: Target[] = [];
  for (const target of ALL_TARGETS) {
    if ((await readSkillMarker(directoryOf(target)))?.managed) targets.push(target);
  }
  return targets;
}

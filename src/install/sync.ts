import {
  defaultSkillRoots,
  readConfig,
  targetLabels,
  writeConfig,
  type InstallConfig,
  type Target,
} from "./config";
import { readInstalledLanguages, readSkillMarker, skillDirectory, writeSkill, type SkillFile } from "./skill";
import { compareVersions } from "./version";

export type SyncResult = { updated: Target[]; migrated: boolean; warnings: string[] };
export type SyncContext = { env: NodeJS.ProcessEnv; files: SkillFile[]; version: string };

const NOTHING_FOUND = "No Reviewonator skill was found. Run reviewonator setup, and pass --claude-skill-dir or --codex-skill-dir if your skill lives in a custom directory.";

export async function syncSkills(context: SyncContext): Promise<SyncResult> {
  const result: SyncResult = { updated: [], migrated: false, warnings: [] };
  let config: InstallConfig | null;
  try {
    config = await readConfig(context.env);
    if (!config) {
      config = await migrateLegacyInstall(context.env);
      if (!config) {
        result.warnings.push(NOTHING_FOUND);
        return result;
      }
      result.migrated = true;
    }
  } catch (error) {
    result.warnings.push(messageOf(error));
    return result;
  }

  const synced = new Set<string>();
  for (const target of config.targets) {
    const root = config.skillRoots[target];
    if (!root) continue;
    const directory = skillDirectory(root);
    if (synced.has(directory)) continue;
    synced.add(directory);
    try {
      const marker = await readSkillMarker(directory);
      if (marker && !marker.managed) {
        result.warnings.push(
          `Skipped the unmanaged skill at ${directory}; Reviewonator does not overwrite files it did not install.`,
        );
        continue;
      }
      if (marker && marker.version && compareVersions(context.version, marker.version) <= 0) continue;
      await writeSkill(directory, context.files, config.languages, context.version);
      result.updated.push(target);
    } catch (error) {
      result.warnings.push(`Could not update the ${targetLabels[target]} skill at ${directory}: ${messageOf(error)}`);
    }
  }
  return result;
}

export function skillUpdateHint(result: SyncResult): string | null {
  return result.updated.length > 0 ? "The Reviewonator skill was just updated. Start /reviewonator again." : null;
}

async function migrateLegacyInstall(env: NodeJS.ProcessEnv): Promise<InstallConfig | null> {
  const roots = defaultSkillRoots(env);
  const targets: Target[] = [];
  let languages = null;
  for (const target of ["claude", "codex"] as const) {
    const directory = skillDirectory(roots[target]);
    const marker = await readSkillMarker(directory);
    if (!marker?.managed) continue;
    targets.push(target);
    languages ??= await readInstalledLanguages(directory);
  }
  if (targets.length === 0) return null;
  const config: InstallConfig = {
    version: 1,
    targets,
    skillRoots: Object.fromEntries(targets.map((target) => [target, roots[target]])),
    languages: languages ?? { comments: "English", reviewerNotes: "English" },
  };
  await writeConfig(config, env);
  return config;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

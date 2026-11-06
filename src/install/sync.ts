import { readConfig, targetLabels, writeConfig, type InstallConfig, type Target } from "./config";
import { deriveLegacyConfig } from "./legacy";
import { aliasDirectory, isCurrent, readSkillMarker, skillDirectory, writeAlias, writeSkill, type SkillFile } from "./skill";

export type SyncResult = { updated: Target[]; migrated: boolean; warnings: string[] };
export type SyncContext = { env: NodeJS.ProcessEnv; files: SkillFile[]; aliasFiles: SkillFile[]; version: string };

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
      if (!isCurrent(marker, context.version)) {
        await writeSkill(directory, context.files, { languages: config.languages, mode: config.mode ?? "full" }, context.version);
        result.updated.push(target);
      }
    } catch (error) {
      result.warnings.push(`Could not update the ${targetLabels[target]} skill at ${directory}: ${messageOf(error)}`);
      continue;
    }
    const alias = aliasDirectory(root);
    try {
      await syncAlias(alias, context);
    } catch (error) {
      result.warnings.push(`Could not update the ${targetLabels[target]} rr alias at ${alias}: ${messageOf(error)}`);
    }
  }
  return result;
}

/** A user's own `rr` skill is theirs to keep, so every run skips it without a warning. */
async function syncAlias(directory: string, context: SyncContext): Promise<void> {
  const marker = await readSkillMarker(directory);
  if (marker && !marker.managed) return;
  if (!isCurrent(marker, context.version)) await writeAlias(directory, context.aliasFiles, context.version);
}

export function skillUpdateHint(result: SyncResult): string | null {
  return result.updated.length > 0 ? "The Reviewonator skill was just updated. Start /reviewonator again." : null;
}

async function migrateLegacyInstall(env: NodeJS.ProcessEnv): Promise<InstallConfig | null> {
  const config = await deriveLegacyConfig(env);
  if (config) await writeConfig(config, env);
  return config;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

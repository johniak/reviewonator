import { lstat, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Languages, ReviewMode } from "./config";
import { compareVersions } from "./version";

export type SkillFile = { path: string; content: string };
export type SkillMarker = { managed: false } | { managed: true; version: string | null };

export class UnmanagedSkillError extends Error {}

const MARKER = ".reviewonator-managed";
/** Hidden, so an interrupted write never looks like a second skill to Claude Code or Codex. */
const STAGING_PREFIX = ".reviewonator-staging-";
const LANGUAGE_LINE = /^Review language configuration: write public pull request comments and the review summary in (.+); write private reviewer explanations in (.+)\.$/m;
const MODE_LINE = /^Review mode configuration: the default review mode is (full|early)\.$/m;
const LEGACY_COMMENTS = /^- Write public pull request comments and the review summary in (.+)\.$/m;
const LEGACY_REVIEWER = /^- Write private reviewer explanations in (.+)\.$/m;

export function skillDirectory(root: string): string {
  return join(root, "reviewonator");
}

/** The short `rr` skill installed next to the main skill; it only points at `../reviewonator/SKILL.md`. */
export function aliasDirectory(root: string): string {
  return join(root, "rr");
}

export function languageLine(languages: Languages): string {
  return `Review language configuration: write public pull request comments and the review summary in ${languages.comments}; write private reviewer explanations in ${languages.reviewerNotes}.`;
}

export function modeLine(mode: ReviewMode): string {
  return `Review mode configuration: the default review mode is ${mode}.`;
}

export async function readSkillMarker(skillDir: string): Promise<SkillMarker | null> {
  const marker = await readOptional(join(skillDir, MARKER));
  if (marker !== null) {
    const version = marker.match(/^Installed by Reviewonator (\d+\.\d+\.\d+)\s*$/)?.[1] ?? null;
    return { managed: true, version };
  }
  return (await exists(skillDir)) ? { managed: false } : null;
}

export async function writeSkill(
  skillDir: string,
  files: SkillFile[],
  settings: { languages: Languages; mode: ReviewMode },
  version: string,
): Promise<void> {
  const skill = files.find((file) => file.path === "SKILL.md");
  if (!skill || !LANGUAGE_LINE.test(skill.content)) {
    throw new Error("The Reviewonator skill is missing its language configuration marker.");
  }
  if (!MODE_LINE.test(skill.content)) {
    throw new Error("The Reviewonator skill is missing its review mode marker.");
  }
  const configured = files.map((file) =>
    file === skill
      ? {
        ...file,
        content: file.content
          .replace(LANGUAGE_LINE, () => languageLine(settings.languages))
          .replace(MODE_LINE, () => modeLine(settings.mode)),
      }
      : file
  );
  await writeManagedDirectory(skillDir, configured, version);
}

export async function writeAlias(aliasDir: string, files: SkillFile[], version: string): Promise<void> {
  await writeManagedDirectory(aliasDir, files, version);
}

/** True when a managed marker is at least the given version, so there is nothing to update. */
export function isCurrent(marker: SkillMarker | null, version: string): boolean {
  return Boolean(marker?.managed && marker.version && compareVersions(version, marker.version) <= 0);
}

async function writeManagedDirectory(directory: string, files: SkillFile[], version: string): Promise<void> {
  const marker = await readSkillMarker(directory);
  if (marker && !marker.managed) {
    throw new UnmanagedSkillError(`Refusing to replace unmanaged skill: ${directory}`);
  }

  const root = dirname(directory);
  await removeStaleStaging(root);
  const staging = join(root, `${STAGING_PREFIX}${process.pid}`);
  try {
    for (const file of files) {
      const destination = join(staging, file.path);
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, file.content);
    }
    await writeFile(join(staging, MARKER), `Installed by Reviewonator ${version}\n`);
    await rm(directory, { recursive: true, force: true });
    await rename(staging, directory);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

export async function readInstalledLanguages(skillDir: string): Promise<Languages | null> {
  const skill = await readOptional(join(skillDir, "SKILL.md"));
  const current = skill?.match(LANGUAGE_LINE);
  if (current) return { comments: current[1], reviewerNotes: current[2] };

  const legacy = await readOptional(join(skillDir, "references", "languages.md"));
  const comments = legacy?.match(LEGACY_COMMENTS)?.[1];
  const reviewerNotes = legacy?.match(LEGACY_REVIEWER)?.[1];
  return comments && reviewerNotes ? { comments, reviewerNotes } : null;
}

export async function removeSkill(skillDir: string): Promise<"removed" | "unmanaged" | "absent"> {
  const marker = await readSkillMarker(skillDir);
  if (!marker) return "absent";
  if (!marker.managed) return "unmanaged";
  await rm(skillDir, { recursive: true, force: true });
  return "removed";
}

async function removeStaleStaging(root: string): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(root);
  } catch {
    return;
  }
  for (const entry of entries.filter((name) => name.startsWith(STAGING_PREFIX))) {
    if (isRunning(Number(entry.slice(STAGING_PREFIX.length)))) continue;
    await rm(join(root, entry), { recursive: true, force: true });
  }
}

function isRunning(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error instanceof Error && "code" in error && error.code === "EPERM";
  }
}

async function readOptional(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && (error.code === "ENOENT" || error.code === "ENOTDIR")) return null;
    throw error;
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch {
    return false;
  }
}

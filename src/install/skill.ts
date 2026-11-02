import { lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Languages } from "./config";

export type SkillFile = { path: string; content: string };
export type SkillMarker = { managed: false } | { managed: true; version: string | null };

export class UnmanagedSkillError extends Error {}

const MARKER = ".reviewonator-managed";
const LANGUAGE_LINE = /^Review language configuration: write public pull request comments and the review summary in (.+); write private reviewer explanations in (.+)\.$/m;
const LEGACY_COMMENTS = /^- Write public pull request comments and the review summary in (.+)\.$/m;
const LEGACY_REVIEWER = /^- Write private reviewer explanations in (.+)\.$/m;

export function skillDirectory(root: string): string {
  return join(root, "reviewonator");
}

export function languageLine(languages: Languages): string {
  return `Review language configuration: write public pull request comments and the review summary in ${languages.comments}; write private reviewer explanations in ${languages.reviewerNotes}.`;
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
  languages: Languages,
  version: string,
): Promise<void> {
  const marker = await readSkillMarker(skillDir);
  if (marker && !marker.managed) {
    throw new UnmanagedSkillError(`Refusing to replace unmanaged skill: ${skillDir}`);
  }
  const skill = files.find((file) => file.path === "SKILL.md");
  if (!skill || !LANGUAGE_LINE.test(skill.content)) {
    throw new Error("The Reviewonator skill is missing its language configuration marker.");
  }

  const staging = `${skillDir}.${process.pid}.tmp`;
  await rm(staging, { recursive: true, force: true });
  try {
    for (const file of files) {
      const destination = join(staging, file.path);
      const content = file === skill ? file.content.replace(LANGUAGE_LINE, languageLine(languages)) : file.content;
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, content);
    }
    await writeFile(join(staging, MARKER), `Installed by Reviewonator ${version}\n`);
    await rm(skillDir, { recursive: true, force: true });
    await rename(staging, skillDir);
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

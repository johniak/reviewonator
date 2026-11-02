import { resolve } from "node:path";
import {
  defaultSkillRoots,
  parseTargets,
  readConfig,
  targetLabels,
  writeConfig,
  type InstallConfig,
  type Languages,
  type Target,
} from "./config";
import { deriveLegacyConfig } from "./legacy";
import type { Prompter } from "./prompt";
import { readInstalledLanguages, readSkillMarker, removeSkill, skillDirectory, writeSkill, type SkillFile } from "./skill";

export type SetupOptions = {
  targets?: string;
  commentLanguage?: string;
  reviewerLanguage?: string;
  claudeSkillDir?: string;
  codexSkillDir?: string;
  reconfigure?: boolean;
};

export type SetupContext = {
  env: NodeJS.ProcessEnv;
  files: SkillFile[];
  version: string;
  interactive: boolean;
  prompter: Prompter;
  log: (line: string) => void;
};

const TARGET_PROMPT = "Install the Reviewonator skill for:\n  1) Claude Code\n  2) Codex\nSelect one or more targets (comma-separated, for example 1,2)";
const MISSING_TARGETS = "No installation target was provided. Pass --targets claude, --targets codex, or --targets claude,codex.";

export async function runSetup(options: SetupOptions, context: SetupContext): Promise<InstallConfig> {
  const { env, prompter } = context;
  const existing = await readConfig(env) ?? await deriveLegacyConfig(env);
  const defaults = defaultSkillRoots(env);
  const skillRoots: Record<Target, string> = {
    claude: resolve(options.claudeSkillDir || existing?.skillRoots.claude || defaults.claude),
    codex: resolve(options.codexSkillDir || existing?.skillRoots.codex || defaults.codex),
  };
  const givenTargets = options.targets || env.REVIEWONATOR_TARGETS;
  const givenComments = options.commentLanguage?.trim() || env.REVIEWONATOR_COMMENT_LANGUAGE?.trim() || undefined;
  const givenReviewer = options.reviewerLanguage?.trim() || env.REVIEWONATOR_REVIEWER_LANGUAGE?.trim() || undefined;
  const ask = context.interactive && (!existing || Boolean(options.reconfigure));

  let targets: Target[];
  if (givenTargets) {
    targets = parseTargets(givenTargets);
  } else if (ask) {
    const current = existing ? ` [${existing.targets.map((target) => (target === "claude" ? "1" : "2")).join(",")}]` : "";
    const answer = await prompter.ask(`${TARGET_PROMPT}${current}: `);
    targets = answer || !existing ? parseTargets(answer) : existing.targets;
  } else if (existing) {
    targets = existing.targets;
  } else {
    throw new Error(MISSING_TARGETS);
  }

  const fallback = existing?.languages ?? await installedLanguages(targets.map((target) => skillDirectory(skillRoots[target])));
  const languages: Languages = {
    comments: givenComments
      ?? (ask ? await promptLanguage(prompter, "Language for comments published to GitHub", fallback.comments) : fallback.comments),
    reviewerNotes: givenReviewer
      ?? (ask ? await promptLanguage(prompter, "Language for private reviewer notes", fallback.reviewerNotes) : fallback.reviewerNotes),
  };

  const installed = new Set<string>();
  for (const target of targets) {
    const directory = skillDirectory(skillRoots[target]);
    if (installed.has(directory)) continue;
    await writeSkill(directory, context.files, languages, context.version);
    installed.add(directory);
    context.log(`Installed ${targetLabels[target]} skill: ${directory}`);
  }
  for (const target of existing?.targets ?? []) {
    const root = existing?.skillRoots[target];
    if (targets.includes(target) || !root) continue;
    const directory = skillDirectory(root);
    if (installed.has(directory)) continue;
    if (await removeSkill(directory) === "removed") context.log(`Removed ${targetLabels[target]} skill: ${directory}`);
  }

  const config: InstallConfig = {
    version: 1,
    targets,
    skillRoots: Object.fromEntries(targets.map((target) => [target, skillRoots[target]])),
    languages,
  };
  await writeConfig(config, env);
  context.log(`GitHub comment language: ${languages.comments}`);
  context.log(`Private reviewer note language: ${languages.reviewerNotes}`);
  return config;
}

async function promptLanguage(prompter: Prompter, label: string, fallback: string): Promise<string> {
  return (await prompter.ask(`${label} [${fallback}]: `)) || fallback;
}

async function installedLanguages(directories: string[]): Promise<Languages> {
  for (const directory of directories) {
    const marker = await readSkillMarker(directory);
    if (!marker?.managed) continue;
    const languages = await readInstalledLanguages(directory);
    if (languages) return languages;
  }
  return { comments: "English", reviewerNotes: "English" };
}

import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { z } from "zod";

export type Target = "claude" | "codex";
export type Languages = { comments: string; reviewerNotes: string };

export const targetLabels: Record<Target, string> = { claude: "Claude Code", codex: "Codex" };

const configSchema = z.object({
  version: z.literal(1),
  targets: z.array(z.enum(["claude", "codex"])).min(1),
  skillRoots: z.object({ claude: z.string().min(1).optional(), codex: z.string().min(1).optional() }),
  languages: z.object({ comments: z.string().min(1), reviewerNotes: z.string().min(1) }),
});

export type InstallConfig = z.infer<typeof configSchema>;

export class InvalidConfigError extends Error {}

export function configPath(env: NodeJS.ProcessEnv = process.env): string {
  if (env.REVIEWONATOR_CONFIG_DIR) return join(env.REVIEWONATOR_CONFIG_DIR, "config.json");
  return join(env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "reviewonator", "config.json");
}

export function defaultSkillRoots(env: NodeJS.ProcessEnv = process.env): Record<Target, string> {
  return {
    claude: env.REVIEWONATOR_CLAUDE_SKILL_DIR ?? env.REVIEWONATOR_SKILL_DIR ?? join(homedir(), ".claude", "skills"),
    codex: env.REVIEWONATOR_CODEX_SKILL_DIR ?? join(homedir(), ".agents", "skills"),
  };
}

export function parseTargets(input: string): Target[] {
  const selected = new Set<Target>();
  for (const raw of input.toLowerCase().replace(/\s/g, "").split(",")) {
    if (!raw) continue;
    switch (raw) {
      case "1": case "claude": case "claude-code": selected.add("claude"); break;
      case "2": case "codex": selected.add("codex"); break;
      case "both": case "all": selected.add("claude"); selected.add("codex"); break;
      default: throw new Error(`Unknown installation target: ${raw}. Use claude, codex, or both.`);
    }
  }
  if (selected.size === 0) throw new Error("Select at least one installation target.");
  return (["claude", "codex"] as const).filter((target) => selected.has(target));
}

export async function readConfig(env: NodeJS.ProcessEnv = process.env): Promise<InstallConfig | null> {
  const path = configPath(env);
  let content: string;
  try {
    content = await readFile(path, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
    throw error;
  }
  try {
    return configSchema.parse(JSON.parse(content));
  } catch {
    throw new InvalidConfigError(
      `The Reviewonator configuration at ${path} is invalid. Fix it or run reviewonator setup --reconfigure after removing it.`,
    );
  }
}

export async function writeConfig(config: InstallConfig, env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const path = configPath(env);
  const temporary = `${path}.${process.pid}.tmp`;
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(temporary, `${JSON.stringify(configSchema.parse(config), null, 2)}\n`, { mode: 0o600 });
  await chmod(temporary, 0o600);
  await rename(temporary, path);
}

export async function removeConfig(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  await rm(configPath(env), { force: true });
}

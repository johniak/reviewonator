import { defaultSkillRoots, type InstallConfig, type Languages, type Target } from "./config";
import { readInstalledLanguages, readSkillMarker, skillDirectory } from "./skill";

/** Rebuilds the choices of a v0.7 install, which kept them only inside the installed skills. */
export async function deriveLegacyConfig(env: NodeJS.ProcessEnv): Promise<InstallConfig | null> {
  const roots = defaultSkillRoots(env);
  const targets: Target[] = [];
  let languages: Languages | null = null;
  for (const target of ["claude", "codex"] as const) {
    const directory = skillDirectory(roots[target]);
    if (!(await readSkillMarker(directory))?.managed) continue;
    targets.push(target);
    languages ??= await readInstalledLanguages(directory);
  }
  if (targets.length === 0) return null;
  return {
    version: 1,
    targets,
    skillRoots: Object.fromEntries(targets.map((target) => [target, roots[target]])),
    languages: languages ?? { comments: "English", reviewerNotes: "English" },
  };
}

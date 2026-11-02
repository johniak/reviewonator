// @vitest-environment node

import { access, chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readConfig, writeConfig } from "../../src/install/config";
import type { InstallMethod } from "../../src/install/install-method";
import { readSkillMarker, writeSkill, type SkillFile } from "../../src/install/skill";
import { runUninstall } from "../../src/install/uninstall";

const files: SkillFile[] = [{
  path: "SKILL.md",
  content: "Review language configuration: write public pull request comments and the review summary in English; write private reviewer explanations in English.\n",
}];
const english = { comments: "English", reviewerNotes: "English" };

async function uninstallFixture(kind: InstallMethod["kind"] = "script") {
  const root = await mkdtemp(join(tmpdir(), "reviewonator-uninstall-test-"));
  const claudeRoot = join(root, "claude");
  const codexRoot = join(root, "codex");
  const env: NodeJS.ProcessEnv = {
    REVIEWONATOR_CONFIG_DIR: join(root, "config"),
    REVIEWONATOR_CLAUDE_SKILL_DIR: claudeRoot,
    REVIEWONATOR_CODEX_SKILL_DIR: codexRoot,
    REVIEWONATOR_STATE_DIR: join(root, "state"),
  };
  await mkdir(join(root, "state"));
  await writeFile(join(root, "state", "update-check.json"), "{}");
  const executablePath = join(root, "bin", "reviewonator");
  await mkdir(join(root, "bin"));
  await writeFile(executablePath, "#!/bin/sh\n");
  await chmod(executablePath, 0o755);
  if (kind === "script") await writeFile(`${executablePath}.reviewonator-managed`, "Installed by Reviewonator\n");
  await writeSkill(join(claudeRoot, "reviewonator"), files, english, "0.8.0");
  await writeSkill(join(codexRoot, "reviewonator"), files, english, "0.8.0");
  await writeConfig({
    version: 1,
    targets: ["claude", "codex"],
    skillRoots: { claude: claudeRoot, codex: codexRoot },
    languages: english,
  }, env);
  const lines: string[] = [];
  const uninstall = (targets?: string) => runUninstall({ targets }, {
    env,
    installMethod: { kind, executablePath },
    log: (line) => lines.push(line),
  });
  return { root, env, claudeRoot, codexRoot, executablePath, lines, uninstall };
}

const exists = (path: string) => access(path).then(() => true, () => false);

describe("reviewonator uninstall", () => {
  it("removes the selected managed skill and keeps the executable while another integration remains", async () => {
    const fixture = await uninstallFixture();

    await fixture.uninstall("claude");

    expect(await readSkillMarker(join(fixture.claudeRoot, "reviewonator"))).toBeNull();
    expect(await readSkillMarker(join(fixture.codexRoot, "reviewonator"))).toEqual({ managed: true, version: "0.8.0" });
    expect(await exists(fixture.executablePath)).toBe(true);
    expect((await readConfig(fixture.env))?.targets).toEqual(["codex"]);
    expect(await exists(join(fixture.root, "state", "update-check.json"))).toBe(true);
    expect(fixture.lines).toEqual([
      `Removed Claude Code skill: ${join(fixture.claudeRoot, "reviewonator")}`,
      "Kept Reviewonator executable because another installed integration still uses it.",
    ]);
  });

  it("removes the script-installed executable and marker after the last integration", async () => {
    const fixture = await uninstallFixture();

    await fixture.uninstall();

    expect(await exists(fixture.executablePath)).toBe(false);
    expect(await exists(`${fixture.executablePath}.reviewonator-managed`)).toBe(false);
    expect(fixture.lines).toContain(`Removed Reviewonator executable: ${fixture.executablePath}`);
  });

  it("tells Homebrew users to run brew uninstall", async () => {
    const fixture = await uninstallFixture("homebrew");

    await fixture.uninstall();

    expect(await exists(fixture.executablePath)).toBe(true);
    expect(fixture.lines.at(-1)).toBe("Run brew uninstall reviewonator to remove the executable.");
  });

  it("keeps unmanaged skills", async () => {
    const fixture = await uninstallFixture();
    const codexSkill = join(fixture.codexRoot, "reviewonator");
    await rm(join(codexSkill, ".reviewonator-managed"));
    await writeFile(join(codexSkill, "SKILL.md"), "user-owned");

    await fixture.uninstall("codex");

    expect(await readFile(join(codexSkill, "SKILL.md"), "utf8")).toBe("user-owned");
    expect(fixture.lines).toContain(`Kept unmanaged skill: ${codexSkill}`);
  });

  it("removes the config and update cache after the last integration", async () => {
    const fixture = await uninstallFixture("unmanaged");

    await fixture.uninstall("claude,codex");

    expect(await readConfig(fixture.env)).toBeNull();
    expect(await exists(join(fixture.root, "state", "update-check.json"))).toBe(false);
    expect(await exists(fixture.executablePath)).toBe(true);
  });

  it("falls back to managed skills in the default roots when no config exists", async () => {
    const fixture = await uninstallFixture();
    await rm(join(fixture.env.REVIEWONATOR_CONFIG_DIR!, "config.json"));

    await fixture.uninstall();

    expect(await readSkillMarker(join(fixture.claudeRoot, "reviewonator"))).toBeNull();
    expect(await readSkillMarker(join(fixture.codexRoot, "reviewonator"))).toBeNull();
    expect(await exists(fixture.executablePath)).toBe(false);
  });
});

// @vitest-environment node

import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readConfig, writeConfig, type InstallConfig } from "../../src/install/config";
import { readSkillMarker, writeSkill, type SkillFile } from "../../src/install/skill";
import { skillUpdateHint, syncSkills } from "../../src/install/sync";

const files: SkillFile[] = [
  {
    path: "SKILL.md",
    content: "---\nname: reviewonator\n---\n\nReview language configuration: write public pull request comments and the review summary in English; write private reviewer explanations in English.\n\nVersion two instructions.\n",
  },
];
const germanFrench = { comments: "German", reviewerNotes: "French" };

async function syncFixture() {
  const root = await mkdtemp(join(tmpdir(), "reviewonator-sync-test-"));
  const claudeRoot = join(root, "claude");
  const codexRoot = join(root, "codex");
  const env: NodeJS.ProcessEnv = {
    REVIEWONATOR_CONFIG_DIR: join(root, "config"),
    REVIEWONATOR_CLAUDE_SKILL_DIR: claudeRoot,
    REVIEWONATOR_CODEX_SKILL_DIR: codexRoot,
  };
  const claudeSkill = join(claudeRoot, "reviewonator");
  const config: InstallConfig = {
    version: 1,
    targets: ["claude"],
    skillRoots: { claude: claudeRoot },
    languages: germanFrench,
  };
  const sync = (version = "0.8.0") => syncSkills({ env, files, version });
  return { root, env, claudeRoot, codexRoot, claudeSkill, config, sync };
}

async function oldSkill(directory: string, marker: string) {
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, ".reviewonator-managed"), marker);
  await writeFile(
    join(directory, "SKILL.md"),
    "Review language configuration: write public pull request comments and the review summary in German; write private reviewer explanations in French.\n\nVersion one instructions.\n",
  );
}

describe("syncSkills", () => {
  it("upgrades a managed skill whose marker is older and keeps the configured languages", async () => {
    const fixture = await syncFixture();
    await writeConfig(fixture.config, fixture.env);
    await oldSkill(fixture.claudeSkill, "Installed by Reviewonator 0.7.0\n");

    const result = await fixture.sync();

    expect(result).toEqual({ updated: ["claude"], migrated: false, warnings: [] });
    const skill = await readFile(join(fixture.claudeSkill, "SKILL.md"), "utf8");
    expect(skill).toContain("Version two instructions.");
    expect(skill).toContain("review summary in German; write private reviewer explanations in French.");
    expect(await readSkillMarker(fixture.claudeSkill)).toEqual({ managed: true, version: "0.8.0" });
  });

  it("upgrades a legacy unversioned marker", async () => {
    const fixture = await syncFixture();
    await writeConfig(fixture.config, fixture.env);
    await oldSkill(fixture.claudeSkill, "Installed by Reviewonator\n");

    expect((await fixture.sync()).updated).toEqual(["claude"]);
    expect(await readSkillMarker(fixture.claudeSkill)).toEqual({ managed: true, version: "0.8.0" });
  });

  it("never downgrades a newer marker", async () => {
    const fixture = await syncFixture();
    await writeConfig(fixture.config, fixture.env);
    await oldSkill(fixture.claudeSkill, "Installed by Reviewonator 0.9.0\n");

    expect(await fixture.sync()).toEqual({ updated: [], migrated: false, warnings: [] });
    expect(await readFile(join(fixture.claudeSkill, "SKILL.md"), "utf8")).toContain("Version one instructions.");
  });

  it("leaves a current skill untouched", async () => {
    const fixture = await syncFixture();
    await writeConfig(fixture.config, fixture.env);
    await writeSkill(fixture.claudeSkill, files, germanFrench, "0.8.0");
    await writeFile(join(fixture.claudeSkill, "local-note.md"), "kept");

    expect((await fixture.sync()).updated).toEqual([]);
    expect(await readFile(join(fixture.claudeSkill, "local-note.md"), "utf8")).toBe("kept");
  });

  it("skips and warns about an unmanaged skill directory", async () => {
    const fixture = await syncFixture();
    await writeConfig(fixture.config, fixture.env);
    await mkdir(fixture.claudeSkill, { recursive: true });
    await writeFile(join(fixture.claudeSkill, "SKILL.md"), "user-owned");

    const result = await fixture.sync();

    expect(result.updated).toEqual([]);
    expect(result.warnings).toEqual([
      `Skipped the unmanaged skill at ${fixture.claudeSkill}; Reviewonator does not overwrite files it did not install.`,
    ]);
    expect(await readFile(join(fixture.claudeSkill, "SKILL.md"), "utf8")).toBe("user-owned");
  });

  it("recreates a configured skill directory that was deleted", async () => {
    const fixture = await syncFixture();
    await writeConfig(fixture.config, fixture.env);

    expect((await fixture.sync()).updated).toEqual(["claude"]);
    expect(await readSkillMarker(fixture.claudeSkill)).toEqual({ managed: true, version: "0.8.0" });
  });

  it("migrates a v0.7 install without a config", async () => {
    const fixture = await syncFixture();
    await oldSkill(fixture.claudeSkill, "Installed by Reviewonator\n");

    const result = await fixture.sync();

    expect(result).toEqual({ updated: ["claude"], migrated: true, warnings: [] });
    expect(await readConfig(fixture.env)).toEqual({
      version: 1,
      targets: ["claude"],
      skillRoots: { claude: fixture.claudeRoot },
      languages: germanFrench,
    });
    expect(await readFile(join(fixture.claudeSkill, "SKILL.md"), "utf8"))
      .toContain("review summary in German; write private reviewer explanations in French.");
  });

  it("warns once and continues when config.json is corrupt", async () => {
    const fixture = await syncFixture();
    await mkdir(fixture.env.REVIEWONATOR_CONFIG_DIR!, { recursive: true });
    await writeFile(join(fixture.env.REVIEWONATOR_CONFIG_DIR!, "config.json"), "{");
    await oldSkill(fixture.claudeSkill, "Installed by Reviewonator 0.7.0\n");

    const result = await fixture.sync();

    expect(result.updated).toEqual([]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain(join(fixture.env.REVIEWONATOR_CONFIG_DIR!, "config.json"));
  });

  it("warns how to point setup at a custom directory when nothing is found", async () => {
    const fixture = await syncFixture();

    expect(await fixture.sync()).toEqual({
      updated: [],
      migrated: false,
      warnings: [
        "No Reviewonator skill was found. Run reviewonator setup, and pass --claude-skill-dir or --codex-skill-dir if your skill lives in a custom directory.",
      ],
    });
    expect(await readConfig(fixture.env)).toBeNull();
  });

  it("turns a write failure into a warning", async () => {
    const fixture = await syncFixture();
    await writeConfig(fixture.config, fixture.env);
    await rm(fixture.claudeRoot, { recursive: true, force: true });
    await writeFile(fixture.claudeRoot, "a file where a directory should be");

    const result = await fixture.sync();

    expect(result.updated).toEqual([]);
    expect(result.warnings[0]).toMatch(/^Could not update the Claude Code skill at /);
  });

  it("returns the restart hint only after an update", () => {
    expect(skillUpdateHint({ updated: ["claude"], migrated: false, warnings: [] }))
      .toBe("The Reviewonator skill was just updated. Start /reviewonator again.");
    expect(skillUpdateHint({ updated: [], migrated: true, warnings: [] })).toBeNull();
  });
});

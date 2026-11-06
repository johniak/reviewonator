// @vitest-environment node

import { mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  languageLine,
  modeLine,
  readInstalledLanguages,
  readSkillMarker,
  removeSkill,
  skillDirectory,
  UnmanagedSkillError,
  writeSkill,
  type SkillFile,
} from "../../src/install/skill";

const files: SkillFile[] = [
  {
    path: "SKILL.md",
    content: "---\nname: reviewonator\n---\n\nReview language configuration: write public pull request comments and the review summary in English; write private reviewer explanations in English.\nReview mode configuration: the default review mode is full.\n\nBody.\n",
  },
  { path: "references/review-schema.md", content: "# Schema\n" },
  { path: "agents/openai.yaml", content: "interface: {}\n" },
];
const languages = { comments: "German", reviewerNotes: "French" };
const settings = { languages, mode: "full" as const };

async function skillRoot() {
  return mkdtemp(join(tmpdir(), "reviewonator-skill-test-"));
}

describe("managed skill files", () => {
  it("writes every skill file, the language line and a versioned marker", async () => {
    const directory = skillDirectory(await skillRoot());

    await writeSkill(directory, files, settings, "0.8.0");

    expect(await readFile(join(directory, ".reviewonator-managed"), "utf8")).toBe("Installed by Reviewonator 0.8.0\n");
    const skill = await readFile(join(directory, "SKILL.md"), "utf8");
    expect(skill).toContain(
      "Review language configuration: write public pull request comments and the review summary in German; write private reviewer explanations in French.",
    );
    expect(skill).not.toContain("in English");
    expect(skill).toBe(files[0].content.replace(/^Review language configuration:.*$/m, languageLine(languages)));
    expect(await readFile(join(directory, "references", "review-schema.md"), "utf8")).toBe("# Schema\n");
    expect(await readFile(join(directory, "agents", "openai.yaml"), "utf8")).toBe("interface: {}\n");
    expect(await readSkillMarker(directory)).toEqual({ managed: true, version: "0.8.0" });
  });

  it("replaces an existing managed skill without leaving old files behind", async () => {
    const root = await skillRoot();
    const directory = skillDirectory(root);
    await writeSkill(directory, [...files, { path: "references/old.md", content: "old" }], settings, "0.7.0");

    await writeSkill(directory, files, settings, "0.8.0");

    expect((await readdir(join(directory, "references"))).sort()).toEqual(["review-schema.md"]);
    expect(await readSkillMarker(directory)).toEqual({ managed: true, version: "0.8.0" });
    expect(await readdir(root)).toEqual(["reviewonator"]);
  });

  it("refuses to overwrite an unmanaged skill directory", async () => {
    const directory = skillDirectory(await skillRoot());
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, "SKILL.md"), "user-owned");

    await expect(writeSkill(directory, files, settings, "0.8.0")).rejects.toBeInstanceOf(UnmanagedSkillError);

    expect(await readFile(join(directory, "SKILL.md"), "utf8")).toBe("user-owned");
    expect(await readSkillMarker(directory)).toEqual({ managed: false });
  });

  it("writes language names literally, even with replacement patterns", async () => {
    const directory = skillDirectory(await skillRoot());

    await writeSkill(directory, files, { languages: { comments: "C$& one", reviewerNotes: "R$1 two" }, mode: "full" }, "0.8.0");

    expect(await readFile(join(directory, "SKILL.md"), "utf8")).toContain(
      "review summary in C$& one; write private reviewer explanations in R$1 two.",
    );
  });

  it("stages hidden and removes a staging directory left by an interrupted write", async () => {
    const root = await skillRoot();
    await mkdir(join(root, ".reviewonator-staging-2147483646"), { recursive: true });
    await writeFile(join(root, ".reviewonator-staging-2147483646", "SKILL.md"), "half-written");

    await writeSkill(skillDirectory(root), files, settings, "0.8.0");

    expect(await readdir(root)).toEqual(["reviewonator"]);
  });

  it("keeps the staging directory of another running process", async () => {
    const root = await skillRoot();
    const live = `.reviewonator-staging-${process.ppid}`;
    await mkdir(join(root, live), { recursive: true });

    await writeSkill(skillDirectory(root), files, settings, "0.8.0");

    expect((await readdir(root)).sort()).toEqual([live, "reviewonator"]);
  });

  it("refuses a skill without the language configuration marker", async () => {
    const directory = skillDirectory(await skillRoot());

    await expect(writeSkill(directory, [{ path: "SKILL.md", content: "no marker\n" }], settings, "0.8.0"))
      .rejects.toThrow(/language configuration marker/);
  });

  it("writes the default review mode into the mode line", async () => {
    const directory = skillDirectory(await skillRoot());

    await writeSkill(directory, files, { languages, mode: "early" }, "0.8.0");

    const skill = await readFile(join(directory, "SKILL.md"), "utf8");
    expect(skill).toContain("Review mode configuration: the default review mode is early.");
    expect(skill).not.toContain("default review mode is full");
    expect(modeLine("full")).toBe("Review mode configuration: the default review mode is full.");
  });

  it("refuses a skill without the review mode marker", async () => {
    const directory = skillDirectory(await skillRoot());
    const noMode = [{ path: "SKILL.md", content: files[0].content.replace(/^Review mode configuration:.*\n/m, "") }];

    await expect(writeSkill(directory, noMode, settings, "0.8.0"))
      .rejects.toThrow("The Reviewonator skill is missing its review mode marker.");
  });

  it("reads a legacy unversioned marker as managed with version null", async () => {
    const directory = skillDirectory(await skillRoot());
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, ".reviewonator-managed"), "Installed by Reviewonator\n");

    expect(await readSkillMarker(directory)).toEqual({ managed: true, version: null });
    expect(await readSkillMarker(join(directory, "missing"))).toBeNull();
  });

  it("reads installed languages from the language line and from legacy references/languages.md", async () => {
    const current = skillDirectory(await skillRoot());
    await writeSkill(current, files, { languages: { comments: "Brazilian Portuguese", reviewerNotes: "Polish" }, mode: "full" }, "0.8.0");
    expect(await readInstalledLanguages(current)).toEqual({ comments: "Brazilian Portuguese", reviewerNotes: "Polish" });

    const legacy = skillDirectory(await skillRoot());
    await mkdir(join(legacy, "references"), { recursive: true });
    await writeFile(join(legacy, "SKILL.md"), "Read [references/languages.md](references/languages.md) before producing review text.\n");
    await writeFile(
      join(legacy, "references", "languages.md"),
      "# Review languages\n\n- Write public pull request comments and the review summary in German.\n- Write private reviewer explanations in French.\n",
    );
    expect(await readInstalledLanguages(legacy)).toEqual({ comments: "German", reviewerNotes: "French" });

    expect(await readInstalledLanguages(skillDirectory(await skillRoot()))).toBeNull();
  });

  it("removes only managed skills", async () => {
    const managed = skillDirectory(await skillRoot());
    await writeSkill(managed, files, settings, "0.8.0");
    const unmanaged = skillDirectory(await skillRoot());
    await mkdir(unmanaged, { recursive: true });
    await writeFile(join(unmanaged, "SKILL.md"), "user-owned");

    expect(await removeSkill(managed)).toBe("removed");
    expect(await readSkillMarker(managed)).toBeNull();
    expect(await removeSkill(unmanaged)).toBe("unmanaged");
    expect(await readFile(join(unmanaged, "SKILL.md"), "utf8")).toBe("user-owned");
    expect(await removeSkill(managed)).toBe("absent");
  });
});

// @vitest-environment node

import { mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  languageLine,
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
    content: "---\nname: reviewonator\n---\n\nReview language configuration: write public pull request comments and the review summary in English; write private reviewer explanations in English.\n\nBody.\n",
  },
  { path: "references/review-schema.md", content: "# Schema\n" },
  { path: "agents/openai.yaml", content: "interface: {}\n" },
];
const languages = { comments: "German", reviewerNotes: "French" };

async function skillRoot() {
  return mkdtemp(join(tmpdir(), "reviewonator-skill-test-"));
}

describe("managed skill files", () => {
  it("writes every skill file, the language line and a versioned marker", async () => {
    const directory = skillDirectory(await skillRoot());

    await writeSkill(directory, files, languages, "0.8.0");

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
    await writeSkill(directory, [...files, { path: "references/old.md", content: "old" }], languages, "0.7.0");

    await writeSkill(directory, files, languages, "0.8.0");

    expect((await readdir(join(directory, "references"))).sort()).toEqual(["review-schema.md"]);
    expect(await readSkillMarker(directory)).toEqual({ managed: true, version: "0.8.0" });
    expect(await readdir(root)).toEqual(["reviewonator"]);
  });

  it("refuses to overwrite an unmanaged skill directory", async () => {
    const directory = skillDirectory(await skillRoot());
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, "SKILL.md"), "user-owned");

    await expect(writeSkill(directory, files, languages, "0.8.0")).rejects.toBeInstanceOf(UnmanagedSkillError);

    expect(await readFile(join(directory, "SKILL.md"), "utf8")).toBe("user-owned");
    expect(await readSkillMarker(directory)).toEqual({ managed: false });
  });

  it("refuses a skill without the language configuration marker", async () => {
    const directory = skillDirectory(await skillRoot());

    await expect(writeSkill(directory, [{ path: "SKILL.md", content: "no marker\n" }], languages, "0.8.0"))
      .rejects.toThrow(/language configuration marker/);
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
    await writeSkill(current, files, { comments: "Brazilian Portuguese", reviewerNotes: "Polish" }, "0.8.0");
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
    await writeSkill(managed, files, languages, "0.8.0");
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

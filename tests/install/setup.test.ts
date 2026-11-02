// @vitest-environment node

import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readConfig, type InstallConfig } from "../../src/install/config";
import type { Prompter } from "../../src/install/prompt";
import { runSetup, type SetupContext } from "../../src/install/setup";
import { readSkillMarker, type SkillFile } from "../../src/install/skill";

const files: SkillFile[] = [
  {
    path: "SKILL.md",
    content: "---\nname: reviewonator\n---\n\nReview language configuration: write public pull request comments and the review summary in English; write private reviewer explanations in English.\n",
  },
  { path: "references/review-schema.md", content: "# Schema\n" },
];

class ScriptedPrompter implements Prompter {
  readonly questions: string[] = [];

  constructor(private readonly answers: string[] = []) {}

  async ask(question: string): Promise<string> {
    this.questions.push(question);
    const answer = this.answers.shift();
    if (answer === undefined) throw new Error(`Unexpected prompt: ${question}`);
    return answer;
  }
}

async function setupFixture() {
  const root = await mkdtemp(join(tmpdir(), "reviewonator-setup-test-"));
  const claudeRoot = join(root, "claude-skills");
  const codexRoot = join(root, "codex-skills");
  const env: NodeJS.ProcessEnv = {
    REVIEWONATOR_CONFIG_DIR: join(root, "config"),
    REVIEWONATOR_CLAUDE_SKILL_DIR: claudeRoot,
    REVIEWONATOR_CODEX_SKILL_DIR: codexRoot,
  };
  const lines: string[] = [];
  const context = (prompter: Prompter, interactive = true, extraEnv: NodeJS.ProcessEnv = {}): SetupContext => ({
    env: { ...env, ...extraEnv },
    files,
    version: "0.8.0",
    interactive,
    prompter,
    log: (line) => lines.push(line),
  });
  return { root, claudeRoot, codexRoot, env, lines, context };
}

const skillText = (root: string) => readFile(join(root, "reviewonator", "SKILL.md"), "utf8");
const languagesIn = (comments: string, reviewer: string) =>
  `review summary in ${comments}; write private reviewer explanations in ${reviewer}.`;

async function existingConfig(fixture: Awaited<ReturnType<typeof setupFixture>>): Promise<InstallConfig> {
  await runSetup(
    { targets: "claude,codex", commentLanguage: "German", reviewerLanguage: "French" },
    fixture.context(new ScriptedPrompter(), false),
  );
  return (await readConfig(fixture.env))!;
}

describe("reviewonator setup", () => {
  it("prompts for targets and both languages on first interactive setup", async () => {
    const fixture = await setupFixture();
    const prompter = new ScriptedPrompter(["1,2", "German", "French"]);

    await runSetup({}, fixture.context(prompter));

    expect(prompter.questions).toEqual([
      "Install the Reviewonator skill for:\n  1) Claude Code\n  2) Codex\nSelect one or more targets (comma-separated, for example 1,2): ",
      "Language for comments published to GitHub [English]: ",
      "Language for private reviewer notes [English]: ",
    ]);
    expect(await readConfig(fixture.env)).toEqual({
      version: 1,
      targets: ["claude", "codex"],
      skillRoots: { claude: fixture.claudeRoot, codex: fixture.codexRoot },
      languages: { comments: "German", reviewerNotes: "French" },
    });
    expect(await skillText(fixture.claudeRoot)).toContain(languagesIn("German", "French"));
    expect(await skillText(fixture.codexRoot)).toContain(languagesIn("German", "French"));
    expect(fixture.lines).toContain(`Installed Claude Code skill: ${join(fixture.claudeRoot, "reviewonator")}`);
    expect(fixture.lines).toContain(`Installed Codex skill: ${join(fixture.codexRoot, "reviewonator")}`);
    expect(fixture.lines).toContain("GitHub comment language: German");
    expect(fixture.lines).toContain("Private reviewer note language: French");
  });

  it("never prompts when a config exists", async () => {
    const fixture = await setupFixture();
    await existingConfig(fixture);
    await writeFile(join(fixture.claudeRoot, "reviewonator", "references", "review-schema.md"), "stale");

    await runSetup({}, fixture.context(new ScriptedPrompter()));

    expect(await readFile(join(fixture.claudeRoot, "reviewonator", "references", "review-schema.md"), "utf8")).toBe("# Schema\n");
    expect(await skillText(fixture.codexRoot)).toContain(languagesIn("German", "French"));
  });

  it("reconfigure prompts with the current values as defaults", async () => {
    const fixture = await setupFixture();
    await existingConfig(fixture);
    const prompter = new ScriptedPrompter(["", "", ""]);

    await runSetup({ reconfigure: true }, fixture.context(prompter));

    expect(prompter.questions[0]).toMatch(/Select one or more targets \(comma-separated, for example 1,2\) \[1,2\]: $/);
    expect(prompter.questions[1]).toBe("Language for comments published to GitHub [German]: ");
    expect(prompter.questions[2]).toBe("Language for private reviewer notes [French]: ");
    expect((await readConfig(fixture.env))?.targets).toEqual(["claude", "codex"]);
    expect((await readConfig(fixture.env))?.languages).toEqual({ comments: "German", reviewerNotes: "French" });
  });

  it("requires targets when not interactive and no config exists", async () => {
    const fixture = await setupFixture();

    await expect(runSetup({}, fixture.context(new ScriptedPrompter(), false)))
      .rejects.toThrow(/No installation target was provided/);
    expect(await readConfig(fixture.env)).toBeNull();
  });

  it("reads targets and languages from the documented environment variables", async () => {
    const fixture = await setupFixture();

    await runSetup({}, fixture.context(new ScriptedPrompter(), false, {
      REVIEWONATOR_TARGETS: "codex",
      REVIEWONATOR_COMMENT_LANGUAGE: "Polish",
    }));

    expect(await readConfig(fixture.env)).toMatchObject({
      targets: ["codex"],
      languages: { comments: "Polish", reviewerNotes: "English" },
    });
    expect(await readSkillMarker(join(fixture.claudeRoot, "reviewonator"))).toBeNull();
  });

  it("flags override the config without prompting", async () => {
    const fixture = await setupFixture();
    await existingConfig(fixture);

    await runSetup({ reviewerLanguage: "Japanese" }, fixture.context(new ScriptedPrompter()));

    expect((await readConfig(fixture.env))?.languages).toEqual({ comments: "German", reviewerNotes: "Japanese" });
    expect(await skillText(fixture.claudeRoot)).toContain(languagesIn("German", "Japanese"));
  });

  it("removes the managed skill of a deselected target", async () => {
    const fixture = await setupFixture();
    await existingConfig(fixture);

    await runSetup({ targets: "claude" }, fixture.context(new ScriptedPrompter()));

    expect((await readConfig(fixture.env))?.targets).toEqual(["claude"]);
    expect(await readSkillMarker(join(fixture.codexRoot, "reviewonator"))).toBeNull();
    expect(fixture.lines).toContain(`Removed Codex skill: ${join(fixture.codexRoot, "reviewonator")}`);
  });

  it("adopts a v0.7 install without prompting again", async () => {
    const fixture = await setupFixture();
    const legacy = join(fixture.claudeRoot, "reviewonator");
    await mkdir(legacy, { recursive: true });
    await writeFile(join(legacy, ".reviewonator-managed"), "Installed by Reviewonator\n");
    await writeFile(join(legacy, "SKILL.md"), files[0].content.replace(languagesIn("English", "English"), languagesIn("German", "French")));

    await runSetup({}, fixture.context(new ScriptedPrompter()));

    expect(await readConfig(fixture.env)).toEqual({
      version: 1,
      targets: ["claude"],
      skillRoots: { claude: fixture.claudeRoot },
      languages: { comments: "German", reviewerNotes: "French" },
    });
    expect(await readSkillMarker(legacy)).toEqual({ managed: true, version: "0.8.0" });
    expect(await skillText(fixture.claudeRoot)).toContain(languagesIn("German", "French"));
  });

  it("fails with the config path when config.json is corrupt", async () => {
    const fixture = await setupFixture();
    await mkdir(fixture.env.REVIEWONATOR_CONFIG_DIR!, { recursive: true });
    await writeFile(join(fixture.env.REVIEWONATOR_CONFIG_DIR!, "config.json"), "{");

    await expect(runSetup({ targets: "claude" }, fixture.context(new ScriptedPrompter(), false)))
      .rejects.toThrow(join(fixture.env.REVIEWONATOR_CONFIG_DIR!, "config.json"));
  });

  it("installs once when Claude Code and Codex share a skill root", async () => {
    const fixture = await setupFixture();

    await runSetup(
      { targets: "both", codexSkillDir: fixture.claudeRoot },
      fixture.context(new ScriptedPrompter(), false),
    );

    expect(await readSkillMarker(join(fixture.claudeRoot, "reviewonator"))).toEqual({ managed: true, version: "0.8.0" });
    expect(fixture.lines.filter((line) => line.startsWith("Installed "))).toEqual([
      `Installed Claude Code skill: ${join(fixture.claudeRoot, "reviewonator")}`,
    ]);
  });
});

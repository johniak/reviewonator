// @vitest-environment node

import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { readConfig, type InstallConfig } from "../../src/install/config";
import type { Prompter } from "../../src/install/prompt";
import { runSetup, type SetupContext } from "../../src/install/setup";
import { readSkillMarker, type SkillFile } from "../../src/install/skill";

const files: SkillFile[] = [
  {
    path: "SKILL.md",
    content: "---\nname: reviewonator\n---\n\nReview language configuration: write public pull request comments and the review summary in English; write private reviewer explanations in English.\nReview mode configuration: the default review mode is full.\n",
  },
  { path: "references/review-schema.md", content: "# Schema\n" },
];
const aliasFiles: SkillFile[] = [{ path: "SKILL.md", content: "---\nname: rr\n---\n\nFollow the reviewonator skill.\n" }];

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
    aliasFiles,
    version: "0.8.0",
    interactive,
    prompter,
    log: (line) => lines.push(line),
  });
  return { root, claudeRoot, codexRoot, env, lines, context };
}

const MODE_PROMPT = [
  "Default review mode:",
  "  1) Full: the agent reviews the whole pull request first, and Reviewonator",
  "     opens when every finding is ready.",
  "  2) Early: Reviewonator opens right away with the diff. The About this PR",
  "     note appears after a moment and the AI findings when the agent finishes.",
  "     Meanwhile you can read the code and write comments; questions to the AI",
  "     wait until it finishes, and publishing waits too.",
  "Select a mode [1]: ",
].join("\n");
const HINT = "New: early review mode. Choose it with reviewonator setup --reconfigure";

const skillText = (root: string) => readFile(join(root, "reviewonator", "SKILL.md"), "utf8");
const languagesIn = (comments: string, reviewer: string) =>
  `review summary in ${comments}; write private reviewer explanations in ${reviewer}.`;

async function existingConfig(fixture: Awaited<ReturnType<typeof setupFixture>>): Promise<InstallConfig> {
  await runSetup(
    { targets: "claude,codex", commentLanguage: "German", reviewerLanguage: "French", mode: "full" },
    fixture.context(new ScriptedPrompter(), false),
  );
  return (await readConfig(fixture.env))!;
}

describe("reviewonator setup", () => {
  it("prompts for targets and both languages on first interactive setup", async () => {
    const fixture = await setupFixture();
    const prompter = new ScriptedPrompter(["1,2", "German", "French", "2"]);

    await runSetup({}, fixture.context(prompter));

    expect(prompter.questions).toEqual([
      "Install the Reviewonator skill for:\n  1) Claude Code\n  2) Codex\nSelect one or more targets (comma-separated, for example 1,2): ",
      "Language for comments published to GitHub [English]: ",
      "Language for private reviewer notes [English]: ",
      MODE_PROMPT,
    ]);
    expect(await readConfig(fixture.env)).toEqual({
      version: 1,
      targets: ["claude", "codex"],
      skillRoots: { claude: fixture.claudeRoot, codex: fixture.codexRoot },
      languages: { comments: "German", reviewerNotes: "French" },
      mode: "early",
    });
    expect(await skillText(fixture.claudeRoot)).toContain(languagesIn("German", "French"));
    expect(await skillText(fixture.codexRoot)).toContain(languagesIn("German", "French"));
    expect(await skillText(fixture.claudeRoot)).toContain("Review mode configuration: the default review mode is early.");
    expect(await skillText(fixture.codexRoot)).toContain("Review mode configuration: the default review mode is early.");
    expect(fixture.lines).toContain("Default review mode: Early");
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
    const prompter = new ScriptedPrompter(["", "", "", ""]);

    await runSetup({ reconfigure: true }, fixture.context(prompter));

    expect(prompter.questions[0]).toMatch(/Select one or more targets \(comma-separated, for example 1,2\) \[1,2\]: $/);
    expect(prompter.questions[1]).toBe("Language for comments published to GitHub [German]: ");
    expect(prompter.questions[2]).toBe("Language for private reviewer notes [French]: ");
    expect(prompter.questions[3]).toBe(MODE_PROMPT);
    expect((await readConfig(fixture.env))?.targets).toEqual(["claude", "codex"]);
    expect((await readConfig(fixture.env))?.languages).toEqual({ comments: "German", reviewerNotes: "French" });
    expect((await readConfig(fixture.env))?.mode).toBe("full");
  });

  it("offers the saved mode as the default when reconfiguring", async () => {
    const fixture = await setupFixture();
    await runSetup({ targets: "claude", mode: "early" }, fixture.context(new ScriptedPrompter(), false));
    const prompter = new ScriptedPrompter(["", "", "", ""]);

    await runSetup({ reconfigure: true }, fixture.context(prompter));

    expect(prompter.questions[3]).toBe(MODE_PROMPT.replace("[1]", "[2]"));
    expect((await readConfig(fixture.env))?.mode).toBe("early");
  });

  it.each([
    ["", "full"],
    ["1", "full"],
    ["full", "full"],
    ["2", "early"],
    ["early", "early"],
    ["EARLY", "early"],
  ])("accepts the mode answer %j as %s", async (answer, mode) => {
    const fixture = await setupFixture();

    await runSetup({ targets: "claude", commentLanguage: "German", reviewerLanguage: "French" }, fixture.context(new ScriptedPrompter([answer])));

    expect((await readConfig(fixture.env))?.mode).toBe(mode);
    expect(await skillText(fixture.claudeRoot)).toContain(`Review mode configuration: the default review mode is ${mode}.`);
  });

  it("rejects an unknown mode answer", async () => {
    const fixture = await setupFixture();

    await expect(runSetup({ targets: "claude" }, fixture.context(new ScriptedPrompter(["", "", "fast"]))))
      .rejects.toThrow("Unknown review mode: fast. Use full or early.");
    expect(await readConfig(fixture.env)).toBeNull();
  });

  it("rejects an unknown --mode option", async () => {
    const fixture = await setupFixture();

    await expect(runSetup({ targets: "claude", mode: "fast" }, fixture.context(new ScriptedPrompter(), false)))
      .rejects.toThrow("Unknown review mode: fast. Use full or early.");
  });

  it("asks only the mode question when the saved configuration has no mode", async () => {
    const fixture = await setupFixture();
    await runSetup({ targets: "claude,codex", commentLanguage: "German", reviewerLanguage: "French" }, fixture.context(new ScriptedPrompter(), false));
    const prompter = new ScriptedPrompter(["2"]);

    await runSetup({}, fixture.context(prompter));

    expect(prompter.questions).toEqual([MODE_PROMPT]);
    const config = await readConfig(fixture.env);
    expect(config).toMatchObject({
      targets: ["claude", "codex"],
      languages: { comments: "German", reviewerNotes: "French" },
      mode: "early",
    });
    expect(await skillText(fixture.codexRoot)).toContain("Review mode configuration: the default review mode is early.");
  });

  it("asks nothing when the saved configuration has a mode", async () => {
    const fixture = await setupFixture();
    await existingConfig(fixture);
    const prompter = new ScriptedPrompter();

    await runSetup({}, fixture.context(prompter));

    expect(prompter.questions).toEqual([]);
    expect((await readConfig(fixture.env))?.mode).toBe("full");
  });

  it("takes the mode from --mode or REVIEWONATOR_MODE without prompting", async () => {
    const fixture = await setupFixture();

    await runSetup({ targets: "claude", mode: "early" }, fixture.context(new ScriptedPrompter(), true, { REVIEWONATOR_COMMENT_LANGUAGE: "German", REVIEWONATOR_REVIEWER_LANGUAGE: "French" }));
    expect((await readConfig(fixture.env))?.mode).toBe("early");
    expect(fixture.lines).not.toContain(HINT);

    await runSetup({ mode: "full" }, fixture.context(new ScriptedPrompter(), false, { REVIEWONATOR_MODE: "early" }));
    expect((await readConfig(fixture.env))?.mode).toBe("full");

    const other = await setupFixture();
    await runSetup({ targets: "claude" }, other.context(new ScriptedPrompter(), false, { REVIEWONATOR_MODE: "early" }));
    expect((await readConfig(other.env))?.mode).toBe("early");
    expect(await skillText(other.claudeRoot)).toContain("the default review mode is early.");
    expect(other.lines).not.toContain(HINT);
  });

  it("saves no mode and prints a hint when it cannot ask", async () => {
    const fixture = await setupFixture();

    await runSetup({ targets: "claude" }, fixture.context(new ScriptedPrompter(), false));

    expect((await readConfig(fixture.env))?.mode).toBeUndefined();
    expect(await skillText(fixture.claudeRoot)).toContain("Review mode configuration: the default review mode is full.");
    expect(fixture.lines).toContain(HINT);
    expect(fixture.lines.some((line) => line.startsWith("Default review mode:"))).toBe(false);
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
    expect(await readSkillMarker(join(fixture.codexRoot, "rr"))).toBeNull();
    expect(fixture.lines).toContain(`Removed Codex skill: ${join(fixture.codexRoot, "reviewonator")}`);
    expect(fixture.lines).toContain(`Removed Codex rr alias: ${join(fixture.codexRoot, "rr")}`);
  });

  it("adopts a v0.7 install without prompting again", async () => {
    const fixture = await setupFixture();
    const legacy = join(fixture.claudeRoot, "reviewonator");
    await mkdir(legacy, { recursive: true });
    await writeFile(join(legacy, ".reviewonator-managed"), "Installed by Reviewonator\n");
    await writeFile(join(legacy, "SKILL.md"), files[0].content.replace(languagesIn("English", "English"), languagesIn("German", "French")));

    await runSetup({}, fixture.context(new ScriptedPrompter(), false));

    expect(await readConfig(fixture.env)).toEqual({
      version: 1,
      targets: ["claude"],
      skillRoots: { claude: fixture.claudeRoot },
      languages: { comments: "German", reviewerNotes: "French" },
    });
    expect(await readSkillMarker(legacy)).toEqual({ managed: true, version: "0.8.0" });
    expect(await skillText(fixture.claudeRoot)).toContain(languagesIn("German", "French"));
  });

  it("saves an absolute skill root when given a relative one", async () => {
    const fixture = await setupFixture();
    const target = join(fixture.root, "relative-claude");

    await runSetup(
      { targets: "claude", claudeSkillDir: relative(process.cwd(), target) },
      fixture.context(new ScriptedPrompter(), false),
    );

    expect((await readConfig(fixture.env))?.skillRoots.claude).toBe(target);
    expect(await readSkillMarker(join(target, "reviewonator"))).toEqual({ managed: true, version: "0.8.0" });
  });

  it("treats empty languages as unset", async () => {
    const fixture = await setupFixture();

    await runSetup(
      { targets: "claude", commentLanguage: "" },
      fixture.context(new ScriptedPrompter(), false, { REVIEWONATOR_REVIEWER_LANGUAGE: "" }),
    );

    expect((await readConfig(fixture.env))?.languages).toEqual({ comments: "English", reviewerNotes: "English" });
    expect(await skillText(fixture.claudeRoot)).toContain(languagesIn("English", "English"));
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
      `Installed Claude Code rr alias: ${join(fixture.claudeRoot, "rr")}`,
    ]);
  });

  it("installs the managed rr alias next to every selected skill", async () => {
    const fixture = await setupFixture();

    await runSetup({ targets: "claude,codex" }, fixture.context(new ScriptedPrompter(), false));

    for (const [label, root] of [["Claude Code", fixture.claudeRoot], ["Codex", fixture.codexRoot]]) {
      const alias = join(root, "rr");
      expect(await readFile(join(alias, "SKILL.md"), "utf8")).toBe(aliasFiles[0].content);
      expect(await readSkillMarker(alias)).toEqual({ managed: true, version: "0.8.0" });
      expect(fixture.lines).toContain(`Installed ${label} rr alias: ${alias}`);
    }
  });

  it("keeps a user's own rr skill and still installs Reviewonator", async () => {
    const fixture = await setupFixture();
    const own = join(fixture.claudeRoot, "rr");
    await mkdir(own, { recursive: true });
    await writeFile(join(own, "SKILL.md"), "user-owned");

    await runSetup({ targets: "claude" }, fixture.context(new ScriptedPrompter(), false));

    expect(await readFile(join(own, "SKILL.md"), "utf8")).toBe("user-owned");
    expect(await readSkillMarker(join(fixture.claudeRoot, "reviewonator"))).toEqual({ managed: true, version: "0.8.0" });
    expect(fixture.lines).toContain(`Kept your own skill at ${own}; the rr alias was not installed.`);
  });
});

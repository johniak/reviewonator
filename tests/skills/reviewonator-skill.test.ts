import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("Reviewonator skill", () => {
  it("inherits repository review expertise and requires adversarial boundary analysis", async () => {
    const skill = await readFile("skills/reviewonator/SKILL.md", "utf8");

    expect(skill).toContain(".claude/skills/review/SKILL.md");
    expect(skill).toContain("gh pr diff <PR_URL> --color never");
    expect(skill).toContain("Do not use `--patch`");
    expect(skill).toContain("read the complete final version of every changed production file");
    expect(skill).toContain("Trust boundaries and data flow");
    expect(skill).toContain("trace the payload field by field from source to destination");
    expect(skill).toContain("Serialization safety is not confidentiality or authorization");
    expect(skill).toContain("fully enabled and fully configured production path");
    expect(skill).toContain("Coverage of helpers, stubs, obsolete dispatch tables");
  });

  it("keeps the human confirmation workflow and avoids premature review narration", async () => {
    const skill = await readFile("skills/reviewonator/SKILL.md", "utf8");

    expect(skill).toContain("Run `reviewonator <PR_URL> --review-file <JSON_PATH>` in the foreground");
    expect(skill).toContain("do not dump the verdict, findings, or a second review summary into chat");
    expect(skill).toContain("Never publish with `gh pr review` or `gh api` from the skill");
    expect(skill).toContain("requires explicit user confirmation in its UI");
  });

  it("uses the languages selected during installation", async () => {
    const skill = await readFile("skills/reviewonator/SKILL.md", "utf8");
    const languages = await readFile("skills/reviewonator/references/languages.md", "utf8");

    expect(skill).toContain("Read [references/languages.md]");
    expect(skill).toContain("configured comment language");
    expect(skill).toContain("configured reviewer-note language");
    expect(languages).toContain("review summary in English");
    expect(languages).toContain("reviewer explanations in English");
  });
});

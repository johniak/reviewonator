import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("Reviewonator skill", () => {
  it("can be discovered and invoked by both Claude Code and Codex", async () => {
    const skill = await readFile("skills/reviewonator/SKILL.md", "utf8");

    expect(skill).toContain("Claude Code or Codex");
    expect(skill).toContain("/reviewonator or $reviewonator");
  });

  it("handles Codex sandbox isolation without exposing GitHub credentials", async () => {
    const skill = await readFile("skills/reviewonator/SKILL.md", "utf8");

    expect(skill.match(/Only in Codex on macOS, never in Claude Code/g)).toHaveLength(3);
    expect(skill).toContain("sandbox cannot read GitHub CLI credentials from Keychain");
    expect(skill).toContain("retry the check outside the sandbox with escalated permissions");
    expect(skill).toContain("request escalated execution for authenticated `gh` commands");
    expect(skill).toContain("Do not introduce `GH_TOKEN` or `GITHUB_TOKEN`");
    expect(skill).toContain("Reviewonator's child `gh` process");
    expect(skill).toContain("execution approval does not authorize publication");
  });

  it("inherits repository review expertise and requires adversarial boundary analysis", async () => {
    const skill = await readFile("skills/reviewonator/SKILL.md", "utf8");

    expect(skill).toContain(".claude/skills/review/SKILL.md");
    expect(skill).toContain("gh pr diff <PR_URL> --color never");
    expect(skill).toContain("Do not use `--patch`");
    expect(skill).toContain("read the complete final version of every changed source, test, migration, configuration, and fixture file");
    expect(skill).toContain("Trust boundaries and data flow");
    expect(skill).toContain("trace the payload field by field from source to destination");
    expect(skill).toContain("Serialization safety is not confidentiality or authorization");
    expect(skill).toContain("fully enabled and fully configured production path");
    expect(skill).toContain("Coverage of helpers, stubs, obsolete dispatch tables");
    expect(skill).toContain("identify the exact installed version from the manifest or lockfile");
    expect(skill).toContain("consult its official documentation for that version");
    expect(skill).toContain("Do not rely on remembered API behavior");
    expect(skill).toContain("follow them with the same depth as a direct invocation");
    expect(skill).toContain("overrides only the final output shape");
    expect(skill).toContain("Do not weaken, shorten, or suppress the repository skill's verified findings");
  });

  it("finishes the complete review instead of stopping after one strong finding", async () => {
    const skill = await readFile("skills/reviewonator/SKILL.md", "utf8");

    expect(skill).toContain("read the complete final version of every changed source, test, migration, configuration, and fixture file");
    expect(skill).toContain("Give each candidate a disposition");
    expect(skill).toContain("Do not stop after finding the first serious issue");
    expect(skill).toContain("Write every verified, actionable, non-duplicate finding");
    expect(skill).toContain("the human, not the agent, decides whether to include, revise, or reject them");
    expect(skill).toContain("There is no preferred, minimum, or maximum finding count");
    expect(skill).toContain("never optimize for fewer comments");
    expect(skill).not.toContain("Prefer a small number of high-confidence findings");
  });

  it("checks regressions in existing callers and implicit framework side effects", async () => {
    const skill = await readFile("skills/reviewonator/SKILL.md", "utf8");

    expect(skill).toContain("every existing and new caller");
    expect(skill).toContain("compare that caller's base and head behavior explicitly");
    expect(skill).toContain("Existing-caller regression");
    expect(skill).toContain("caught exceptions used to escape");
    expect(skill).toContain("an atomic operation used to roll back");
    expect(skill).toContain("Framework lifecycle and cardinality");
    expect(skill).toContain("ORM cascades, signals, hooks, middleware");
    expect(skill).toContain("external work performed while database locks or transactions remain open");
  });

  it("enforces explicit repository conventions as review findings", async () => {
    const skill = await readFile("skills/reviewonator/SKILL.md", "utf8");

    expect(skill).toContain("Repository conventions");
    expect(skill).toContain("fixture and factory use");
    expect(skill).toContain("transaction markers");
    expect(skill).toContain("query-count requirements");
    expect(skill).toContain("passing tests do not override an authoritative project rule");
  });

  it("requires evidence for every omitted candidate and preserves lower-severity findings", async () => {
    const skill = await readFile("skills/reviewonator/SKILL.md", "utf8");

    expect(skill).toContain("with the evidence that justifies that disposition");
    expect(skill).toContain("lower severity is never a reason to discard");
    expect(skill).toContain("audit every ledger disposition once more");
    expect(skill).toContain("Every `verified finding` must appear in JSON");
    expect(skill).toContain("Do not silently downgrade a behavioral regression");
  });

  it("does not downgrade destructive defects or merge separate findings for brevity", async () => {
    const skill = await readFile("skills/reviewonator/SKILL.md", "utf8");

    expect(skill).toContain("shared root cause alone is not enough");
    expect(skill).toContain("Unauthorized destructive behavior, deletion or corruption of data");
    expect(skill).toContain("Recommend `REQUEST_CHANGES` whenever such a defect remains unresolved");
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

    expect(skill).toContain(
      "Review language configuration: write public pull request comments and the review summary in English; write private reviewer explanations in English.",
    );
    expect(skill).not.toContain("Read [references/languages.md]");
    expect(skill).toContain("configured comment language");
    expect(skill).toContain("configured reviewer-note language");
    expect(skill).toContain("Copy both language names literally");
    expect(skill).toContain("never infer or restore defaults");
    expect(skill).toContain("inspect the completed JSON and correct it");
  });

  it("keeps public review comments compact without dropping the actionable content", async () => {
    const skill = await readFile("skills/reviewonator/SKILL.md", "utf8");

    expect(skill).toContain("normally 2–4 sentences and at most about 80 words");
    expect(skill).toContain("problem, consequence, and required change once");
    expect(skill).toContain("Go longer only when shortening it would make the fix ambiguous");
    expect(skill).toContain("a thoughtful human teammate would write it");
    expect(skill).toContain("rewrite anything that sounds generated, templated, or like a linter message");
  });

  it("verifies and improves user-authored line comments in the next review round", async () => {
    const skill = await readFile("skills/reviewonator/SKILL.md", "utf8");

    expect(skill).toContain("For each item in `newComments`");
    expect(skill).toContain("Verify the concern instead of trusting it blindly");
    expect(skill).toContain("turn each valid concern into a new finding");
    expect(skill).toContain("preserve every unaffected finding");
  });

  it("preserves explicit human decisions across revision rounds", async () => {
    const skill = await readFile("skills/reviewonator/SKILL.md", "utf8");

    expect(skill).toContain("Treat `selectedCommentIds` and `rejectedCommentIds` as the human's carried decisions");
    expect(skill).toContain("set `included: true`");
    expect(skill).toContain("set `rejected: true`");
    expect(skill).toContain("Never set both flags");
    expect(skill).toContain("New comments start pending");
  });

  it("never requires or invents a review summary", async () => {
    const skill = await readFile("skills/reviewonator/SKILL.md", "utf8");

    expect(skill).toContain("`summary` is always optional");
    expect(skill).toContain("Use an empty string whenever no separate overall message adds value");
    expect(skill).toContain("Never manufacture a summary merely to justify");
  });
});

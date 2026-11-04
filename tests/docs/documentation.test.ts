import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const overviewAsset = "docs/assets/reviewonator-overview.png";
const discussionAsset = "docs/assets/pr-discussion.png";
const mainAsset = "docs/assets/reviewonator-diff.png";
const liveDiscussionAsset = "docs/assets/live-finding-discussion.png";

describe("project documentation", () => {
  it("links the README screenshot and feature guide", () => {
    const readme = readFileSync("README.md", "utf8");

    expect(readme).toContain(`src="${mainAsset}"`);
    expect(readme).toContain("[feature guide](docs/features.md)");
  });

  it("documents the main review workflows with screenshots", () => {
    const guide = readFileSync("docs/features.md", "utf8");

    expect(guide).toContain("Nothing is included by default");
    expect(guide).toContain("PR discussion");
    expect(guide).toContain("**About this PR**");
    expect(guide).toContain("**Viewed** is the same per-user flag as on GitHub");
    expect(guide).toContain("Comment**, **Approve**, or **Request changes");
    expect(guide).toContain("assets/pr-discussion.png");
    expect(guide).toContain("assets/reviewonator-overview.png");
    expect(guide).toContain("The workspace stays open while you talk to the agent");
    expect(guide).toContain("AI working");
    expect(guide).toContain("Each proposed finding also supports a private live discussion");
    expect(guide).toContain("Use **Send to AI** on the finding card");
    expect(guide).toContain("Use **Send to AI** on your comment to send just that comment");
    expect(guide).toContain("In every message to the agent, **Enter** sends it and **Shift+Enter** starts a new line.");
    expect(guide).toContain("Comments, private explanations, and replies render Markdown the way GitHub does, including code blocks");
    expect(guide).toContain("assets/live-finding-discussion.png");
    expect(guide).toContain("assets/reviewonator-diff.png");
  });

  it("documents the live wait and respond workflow", () => {
    const readme = readFileSync("README.md", "utf8");

    expect(readme).toContain("reviewonator wait https://github.com/owner/repository/pull/123");
    expect(readme).toContain("reviewonator respond https://github.com/owner/repository/pull/123");
    expect(readme).toContain("stays open for follow-up rounds");
  });

  it("introduces the private briefing and viewed files in the README", () => {
    const readme = readFileSync("README.md", "utf8");

    expect(readme).toContain("Start from **About this PR**: a short private note on what the change really does");
    expect(readme).toContain("Mark files **Viewed**, in sync with GitHub");
  });

  it("trusts the tap before installing with Homebrew", () => {
    const readme = readFileSync("README.md", "utf8");

    expect(readme).toContain("brew trust johniak/tap\nbrew install johniak/tap/reviewonator");
  });

  it("asks for a changelog section in every release", () => {
    const readme = readFileSync("README.md", "utf8");
    const workflow = readFileSync(".github/workflows/release.yml", "utf8");

    expect(readme).toContain("The GitHub release notes come from that CHANGELOG.md section, and the release fails when it is missing.");
    expect(workflow).toContain('bun scripts/release-notes.ts "$GITHUB_REF_NAME" > release-notes.md');
    expect(workflow).toContain("--notes-file release-notes.md");
  });

  it("documents hand-written and edited comments", () => {
    const readme = readFileSync("README.md", "utf8");
    const guide = readFileSync("docs/features.md", "utf8");

    expect(readme).toContain(
      "Click **+** beside a diff line, write your comment, and choose **Add comment** to put it straight into the review, or **Send to AI** to have the agent check it first.",
    );
    expect(guide).toContain("**Send to AI** turns it into a private conversation with the agent");
    expect(guide).toContain(
      "Edit any comment with the pencil on its card. Reviewonator keeps your wording across agent rounds unless you discuss that comment with the agent.",
    );
  });

  it("documents the rr alias", () => {
    const readme = readFileSync("README.md", "utf8");

    expect(readme).toContain("- the `rr` alias next to each selected skill;");
    expect(readme).toContain("/rr https://github.com/owner/repository/pull/123");
    expect(readme).toContain("$rr https://github.com/owner/repository/pull/123");
    expect(readme).toContain("If you already have your own `rr` skill, setup keeps it and skips the alias.");
  });

  it("documents project review rules and the project review skill", () => {
    const readme = readFileSync("README.md", "utf8");

    expect(readme).toContain("## Project review rules");
    expect(readme).toContain("`.claude/skills/review/SKILL.md`");
    expect(readme).toContain("`.agents/skills/review/SKILL.md`");
    expect(readme).toContain("You do not need to invoke it: run `/reviewonator` or `/rr` as usual and the agent reads it.");
    expect(readme).toContain("Reviewonator updates never touch these files.");
    expect(readme).toContain("### Add a project review skill");
    expect(readme).toContain(
      "- Review against your project's own rules: add a `review` skill to the repository and every review follows it.",
    );
    expect(readme).toContain("> [!TIP]\n> Add a `review` skill to your repository");
  });

  it("documents Homebrew, the install script, update and uninstall", () => {
    const readme = readFileSync("README.md", "utf8");

    expect(readme).toContain('brew install johniak/tap/reviewonator\n"$(brew --prefix)/bin/reviewonator" setup');
    expect(readme).toContain(
      "Setup removes the executable that the install script installed and asks before removing any other `reviewonator`.",
    );
    expect(readme).toContain(
      "If Reviewonator is installed with Homebrew, the script removes that installation once the download is verified.",
    );
    expect(readme).toContain(
      "Before it replaces a `reviewonator` that it did not install, the script asks for confirmation; `--force` replaces it without asking.",
    );
    expect(readme).toContain(
      'sh -c "$(curl -fsSL https://github.com/johniak/reviewonator/releases/latest/download/install.sh)"',
    );
    expect(readme).toContain(
      'sh -c "$(wget -qO- https://github.com/johniak/reviewonator/releases/latest/download/install.sh)"',
    );
    expect(readme).toContain('install.sh)" "" --targets claude,codex');
    expect(readme).toContain("Updates never ask for your targets or languages again.");
    expect(readme).toContain("reviewonator update");
    expect(readme).toContain("this runs `brew update` and then `brew upgrade reviewonator`");
    expect(readme).toContain("reviewonator setup --reconfigure");
    expect(readme).toContain(
      "`--targets` is the complete selection: setup removes the managed skill of any agent you leave out.",
    );
    expect(readme).toContain("reviewonator uninstall");
    expect(readme).toContain("./scripts/install.sh --local");
    expect(readme).toContain("REVIEWONATOR_NO_UPDATE_CHECK=1");
    expect(readme).not.toContain("gh repo clone johniak/reviewonator");
    expect(readme).not.toContain("uninstall.sh");
  });

  it.each([mainAsset, overviewAsset, discussionAsset, liveDiscussionAsset])("ships a substantial PNG at %s", (asset) => {
    const image = readFileSync(asset);

    expect([...image.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(image.readUInt32BE(16)).toBe(1920);
    expect(image.readUInt32BE(20)).toBe(1080);
    expect(image.length).toBeGreaterThan(20_000);
  });
});

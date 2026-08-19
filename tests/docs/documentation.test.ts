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
    expect(guide).toContain("Comment**, **Approve**, or **Request changes");
    expect(guide).toContain("assets/pr-discussion.png");
    expect(guide).toContain("assets/reviewonator-overview.png");
    expect(guide).toContain("The workspace stays open while you talk to the agent");
    expect(guide).toContain("AI working");
    expect(guide).toContain("Each proposed finding also supports a private live discussion");
    expect(guide).toContain("Use **Send to AI** on the finding card");
    expect(guide).toContain("assets/live-finding-discussion.png");
    expect(guide).toContain("assets/reviewonator-diff.png");
  });

  it("documents the live wait and respond workflow", () => {
    const readme = readFileSync("README.md", "utf8");

    expect(readme).toContain("reviewonator wait https://github.com/owner/repository/pull/123");
    expect(readme).toContain("reviewonator respond https://github.com/owner/repository/pull/123");
    expect(readme).toContain("stays open for follow-up rounds");
  });

  it.each([mainAsset, overviewAsset, discussionAsset, liveDiscussionAsset])("ships a substantial PNG at %s", (asset) => {
    const image = readFileSync(asset);

    expect([...image.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(image.readUInt32BE(16)).toBe(1920);
    expect(image.readUInt32BE(20)).toBe(1080);
    expect(image.length).toBeGreaterThan(20_000);
  });
});

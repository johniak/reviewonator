import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const overviewAsset = "docs/assets/reviewonator-overview.jpg";
const discussionAsset = "docs/assets/pr-discussion.jpg";
const mainAsset = "docs/assets/reviewonator-main.jpg";

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
    expect(guide).toContain("assets/pr-discussion.jpg");
    expect(guide).toContain("assets/reviewonator-overview.jpg");
  });

  it.each([mainAsset, overviewAsset, discussionAsset])("ships a substantial JPEG at %s", (asset) => {
    const image = readFileSync(asset);

    expect([...image.subarray(0, 3)]).toEqual([255, 216, 255]);
    expect([...image.subarray(-2)]).toEqual([255, 217]);
    expect(image.length).toBeGreaterThan(20_000);
  });
});

import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("rr alias skill", () => {
  it("is a short name that runs the reviewonator skill", async () => {
    const skill = await readFile("skills/rr/SKILL.md", "utf8");

    expect(skill).toMatch(/^---\nname: rr\n/);
    expect(skill).toContain("Use only when the user invokes /rr or $rr");
    expect(skill).toContain("Read `../reviewonator/SKILL.md`");
    expect(skill).toContain("from the `reviewonator` skill directory");
  });
});

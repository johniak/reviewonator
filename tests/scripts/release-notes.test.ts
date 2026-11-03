// @vitest-environment node

import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { releaseNotes } from "../../scripts/release-notes";

const run = promisify(execFile);
const changelog = `# Changelog

Intro.

## 0.2.0 - 2026-02-01

### Added

- Second feature.

## 0.1.0 - 2026-01-01

- First feature.
`;

describe("release notes", () => {
  it("takes only the section of the requested version", () => {
    expect(releaseNotes(changelog, "0.2.0")).toBe("### Added\n\n- Second feature.\n");
    expect(releaseNotes(changelog, "0.1.0")).toBe("- First feature.\n");
  });

  it("refuses a version without notes so a release cannot ship without them", () => {
    expect(() => releaseNotes(changelog, "0.3.0")).toThrow("CHANGELOG.md has no section for 0.3.0.");
    expect(() => releaseNotes("## 0.3.0 - 2026-03-01\n\n", "0.3.0")).toThrow("The CHANGELOG.md section for 0.3.0 is empty.");
  });

  it("has notes in CHANGELOG.md for the current package version, printed for the release tag", async () => {
    const { version } = JSON.parse(readFileSync("package.json", "utf8")) as { version: string };

    const { stdout } = await run("bun", ["scripts/release-notes.ts", `v${version}`]);

    expect(stdout).toBe(releaseNotes(readFileSync("CHANGELOG.md", "utf8"), version));
    await expect(run("bun", ["scripts/release-notes.ts", "v0.0.0"])).rejects.toMatchObject({
      stderr: "CHANGELOG.md has no section for 0.0.0.\n",
    });
  });
});

// @vitest-environment node

import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { renderFormula } from "../../scripts/render-formula";

const run = promisify(execFile);
const checksums = {
  "darwin-arm64": "a".repeat(64),
  "darwin-x64": "b".repeat(64),
  "linux-arm64": "c".repeat(64),
  "linux-x64": "d".repeat(64),
};
const hasRuby = await run("ruby", ["--version"]).then(() => true, () => false);

describe("Homebrew formula", () => {
  it("renders a formula with every platform URL and checksum", () => {
    const formula = renderFormula({ version: "0.8.0", checksums });

    for (const [platform, checksum] of Object.entries(checksums)) {
      const url = `url "https://github.com/johniak/reviewonator/releases/download/v0.8.0/reviewonator-${platform}.tar.gz"`;
      expect(formula).toContain(`${url}\n      sha256 "${checksum}"`);
    }
    expect(formula).toContain('version "0.8.0"');
    expect(formula).toMatch(/on_macos do\n\s+on_arm do\n\s+url "[^"]+darwin-arm64/);
    expect(formula).toMatch(/on_linux do\n\s+on_arm do\n\s+url "[^"]+linux-arm64/);
  });

  it("declares the gh dependency, binary install, setup caveat and version test", () => {
    const formula = renderFormula({ version: "0.8.0", checksums });

    expect(formula).toContain('depends_on "gh"');
    expect(formula.indexOf('depends_on "gh"')).toBeLessThan(formula.indexOf("on_macos do"));
    expect(formula).toContain('bin.install "reviewonator"');
    expect(formula).toContain("Run `#{opt_bin}/reviewonator setup` to install the Reviewonator skill for Claude Code or Codex.");
    expect(formula).toContain("The full path runs this installation even when another reviewonator comes first on your PATH.");
    expect(formula).toContain('assert_match "Reviewonator #{version}", shell_output("#{bin}/reviewonator --version")');
  });

  it("rejects a missing or malformed checksum", () => {
    expect(() => renderFormula({ version: "0.8.0", checksums: { ...checksums, "linux-x64": "nope" } }))
      .toThrow("Invalid SHA-256 checksum for linux-x64.");
    expect(() => renderFormula({ version: "v0.8.0", checksums })).toThrow("Invalid version: v0.8.0");
  });

  it.skipIf(!hasRuby)("produces valid Ruby syntax", async () => {
    const directory = await mkdtemp(join(tmpdir(), "reviewonator-formula-"));
    const path = join(directory, "reviewonator.rb");
    await writeFile(path, renderFormula({ version: "0.8.0", checksums }));

    const { stdout } = await run("ruby", ["-c", path]);

    expect(stdout).toContain("Syntax OK");
  });

  it("reads checksums from a release directory", async () => {
    const directory = await mkdtemp(join(tmpdir(), "reviewonator-checksums-"));
    for (const [platform, checksum] of Object.entries(checksums)) {
      await writeFile(join(directory, `reviewonator-${platform}.tar.gz.sha256`), `${checksum}  reviewonator-${platform}.tar.gz\n`);
    }

    const { stdout } = await run("bun", ["scripts/render-formula.ts", "0.8.0", directory]);

    expect(stdout).toBe(renderFormula({ version: "0.8.0", checksums }));
    await writeFile(join(directory, "reviewonator-linux-x64.tar.gz.sha256"), "");
    await expect(run("bun", ["scripts/render-formula.ts", "0.8.0", directory]))
      .rejects.toMatchObject({ stderr: expect.stringContaining("Invalid SHA-256 checksum for linux-x64.") });
  });
});

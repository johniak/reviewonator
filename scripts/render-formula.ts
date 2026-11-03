import { readFileSync } from "node:fs";
import { join } from "node:path";

const PLATFORMS = ["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64"] as const;
type Platform = (typeof PLATFORMS)[number];

export function renderFormula(input: { version: string; checksums: Record<Platform, string> }): string {
  const { version, checksums } = input;
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`Invalid version: ${version}`);
  for (const platform of PLATFORMS) {
    if (!/^[0-9a-f]{64}$/.test(checksums[platform] ?? "")) {
      throw new Error(`Invalid SHA-256 checksum for ${platform}.`);
    }
  }
  const asset = (platform: Platform) => `      url "https://github.com/johniak/reviewonator/releases/download/v${version}/reviewonator-${platform}.tar.gz"
      sha256 "${checksums[platform]}"`;

  return `class Reviewonator < Formula
  desc "Local human-in-the-loop interface for AI-generated GitHub pull request reviews"
  homepage "https://github.com/johniak/reviewonator"
  version "${version}"
  license "MIT"

  depends_on "gh"

  on_macos do
    on_arm do
${asset("darwin-arm64")}
    end
    on_intel do
${asset("darwin-x64")}
    end
  end

  on_linux do
    on_arm do
${asset("linux-arm64")}
    end
    on_intel do
${asset("linux-x64")}
    end
  end

  def install
    bin.install "reviewonator"
  end

  def caveats
    <<~EOS
      Run \`#{opt_bin}/reviewonator setup\` to install the Reviewonator skill for Claude Code or Codex.
      The full path runs this installation even when another reviewonator comes first on your PATH.
    EOS
  end

  test do
    assert_match "Reviewonator #{version}", shell_output("#{bin}/reviewonator --version")
  end
end
`;
}

function readChecksums(directory: string): Record<Platform, string> {
  return Object.fromEntries(PLATFORMS.map((platform) => [
    platform,
    readFileSync(join(directory, `reviewonator-${platform}.tar.gz.sha256`), "utf8").trim().split(/\s+/)[0] ?? "",
  ])) as Record<Platform, string>;
}

if (import.meta.main) {
  const [version, directory] = process.argv.slice(2);
  if (!version || !directory) {
    process.stderr.write("Usage: bun scripts/render-formula.ts <version> <checksum-directory>\n");
    process.exit(2);
  }
  try {
    process.stdout.write(renderFormula({ version, checksums: readChecksums(directory) }));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
}

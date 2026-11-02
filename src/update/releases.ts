import type { CommandRunner } from "../platform/command";

export const REPOSITORY = "johniak/reviewonator";

export interface ReleaseSource {
  latestVersion(): Promise<string>;
  download(version: string, assets: string[], directory: string): Promise<void>;
}

export class GhReleaseSource implements ReleaseSource {
  constructor(private readonly runner: CommandRunner) {}

  async latestVersion(): Promise<string> {
    const result = await this.runner.run("gh", ["api", `repos/${REPOSITORY}/releases/latest`, "--jq", ".tag_name"]);
    if (result.exitCode !== 0) {
      throw new Error(`Could not read the latest Reviewonator release: ${result.stderr.trim()}`);
    }
    const tag = result.stdout.trim();
    const version = tag.replace(/^v/, "");
    if (!/^\d+\.\d+\.\d+$/.test(version)) {
      throw new Error(`The latest Reviewonator release has an unsupported version tag: ${tag}`);
    }
    return version;
  }

  async download(version: string, assets: string[], directory: string): Promise<void> {
    const result = await this.runner.run("gh", [
      "release", "download", `v${version}`, "--repo", REPOSITORY,
      ...assets.flatMap((asset) => ["--pattern", asset]),
      "--dir", directory, "--clobber",
    ]);
    if (result.exitCode !== 0) {
      throw new Error(`Could not download Reviewonator ${version}: ${result.stderr.trim()}`);
    }
  }
}

export function platformName(platform: string = process.platform, arch: string = process.arch): string {
  const name = `${platform}-${arch}`;
  if (["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64"].includes(name)) return name;
  throw new Error(`Unsupported platform: ${name}`);
}

export function releaseUrl(version: string): string {
  return `https://github.com/${REPOSITORY}/releases/tag/v${version}`;
}

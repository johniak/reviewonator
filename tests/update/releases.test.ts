import { describe, expect, it } from "vitest";
import type { CommandResult, CommandRunner } from "../../src/platform/command";
import { GhReleaseSource, platformName, releaseUrl } from "../../src/update/releases";

class RecordingRunner implements CommandRunner {
  readonly calls: Array<{ command: string; args: string[] }> = [];

  constructor(private readonly results: CommandResult[]) {}

  async run(command: string, args: string[]): Promise<CommandResult> {
    this.calls.push({ command, args });
    const result = this.results.shift();
    if (!result) throw new Error("No command result was prepared for this call.");
    return result;
  }
}

const result = (stdout: string, exitCode = 0, stderr = ""): CommandResult => ({ stdout, stderr, exitCode });

describe("GitHub release source", () => {
  it("reads the latest tag through gh api", async () => {
    const runner = new RecordingRunner([result("v0.8.0\n")]);

    expect(await new GhReleaseSource(runner).latestVersion()).toBe("0.8.0");
    expect(runner.calls).toEqual([
      { command: "gh", args: ["api", "repos/johniak/reviewonator/releases/latest", "--jq", ".tag_name"] },
    ]);
  });

  it("rejects an unexpected tag or a failed lookup", async () => {
    await expect(new GhReleaseSource(new RecordingRunner([result("nightly\n")])).latestVersion())
      .rejects.toThrow(/unsupported version tag: nightly/);
    await expect(new GhReleaseSource(new RecordingRunner([result("", 1, "HTTP 401")])).latestVersion())
      .rejects.toThrow(/HTTP 401/);
  });

  it("downloads release assets through gh release download", async () => {
    const runner = new RecordingRunner([result("")]);

    await new GhReleaseSource(runner).download("0.8.0", ["a.tar.gz", "a.tar.gz.sha256"], "/tmp/target");

    expect(runner.calls).toEqual([{
      command: "gh",
      args: [
        "release", "download", "v0.8.0", "--repo", "johniak/reviewonator",
        "--pattern", "a.tar.gz", "--pattern", "a.tar.gz.sha256", "--dir", "/tmp/target", "--clobber",
      ],
    }]);
    await expect(new GhReleaseSource(new RecordingRunner([result("", 1, "not found")])).download("0.8.0", ["a"], "/x"))
      .rejects.toThrow(/Could not download Reviewonator 0.8.0: not found/);
  });

  it("maps supported platforms and rejects others", () => {
    expect(platformName("darwin", "arm64")).toBe("darwin-arm64");
    expect(platformName("darwin", "x64")).toBe("darwin-x64");
    expect(platformName("linux", "arm64")).toBe("linux-arm64");
    expect(platformName("linux", "x64")).toBe("linux-x64");
    expect(() => platformName("win32", "x64")).toThrow("Unsupported platform: win32-x64");
  });

  it("links the release notes of a version", () => {
    expect(releaseUrl("0.8.0")).toBe("https://github.com/johniak/reviewonator/releases/tag/v0.8.0");
  });
});

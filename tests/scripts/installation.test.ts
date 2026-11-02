// @vitest-environment node

import { execFile } from "node:child_process";
import { access, chmod, constants, cp, mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const run = promisify(execFile);
const platform = `${process.platform === "darwin" ? "darwin" : "linux"}-${process.arch === "arm64" ? "arm64" : "x64"}`;
/** System tools only: no real brew, gh, or reviewonator from the developer's PATH. */
const systemPath = ["/usr/bin", "/bin", "/usr/sbin", "/sbin"].join(delimiter);
const coreTools = [
  "sh", "uname", "mktemp", "tar", "gzip", "shasum", "sha256sum", "perl", "awk", "sed",
  "mkdir", "rm", "install", "chmod", "cat", "dirname", "cp", "head", "tr", "grep", "cut",
];

function stubExecutable(version: string): string {
  return `#!/bin/sh
if [ "\${1:-}" = "--version" ]; then
  printf 'Reviewonator ${version}\\n'
  exit 0
fi
if [ "\${1:-}" = "setup" ]; then
  for argument in "$@"; do printf '%s\\n' "$argument"; done > "$REVIEWONATOR_TEST_SETUP_LOG"
  exit 0
fi
exit 3
`;
}

async function writeExecutable(path: string, content: string) {
  await writeFile(path, content);
  await chmod(path, 0o755);
}

async function findTool(name: string): Promise<string | null> {
  for (const directory of (process.env.PATH ?? "").split(delimiter)) {
    const candidate = join(directory, name);
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Keep searching PATH.
    }
  }
  return null;
}

async function releaseFixture(releaseVersion = "0.8.0") {
  const root = await mkdtemp(join(tmpdir(), "reviewonator-bootstrap-test-"));
  const release = join(root, "release");
  const stubDir = join(root, "stub");
  await mkdir(stubDir);
  await writeExecutable(join(stubDir, "reviewonator"), stubExecutable(releaseVersion));
  await run("scripts/package-release.sh", [platform, join(stubDir, "reviewonator"), release]);
  const binDir = join(root, "bin");
  const setupLog = join(root, "setup.log");
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: systemPath,
    REVIEWONATOR_DOWNLOAD_URL: `file://${release}`,
    REVIEWONATOR_TEST_SETUP_LOG: setupLog,
  };
  const script = await readFile("scripts/install.sh", "utf8");
  const install = (args: string[], overrides: NodeJS.ProcessEnv = {}) =>
    run("sh", ["-c", script, "", "--bin-dir", binDir, ...args], { env: { ...env, ...overrides } });
  const setupArguments = async () => (await readFile(setupLog, "utf8")).trimEnd().split("\n");
  const installed = async (version: string, managed = true) => {
    await mkdir(binDir, { recursive: true });
    await writeExecutable(join(binDir, "reviewonator"), stubExecutable(version));
    if (managed) await writeFile(join(binDir, "reviewonator.reviewonator-managed"), "Installed by Reviewonator\n");
  };
  return { root, release, binDir, env, install, setupArguments, installed };
}

async function minimalPath(root: string, extra: Record<string, string> = {}): Promise<string> {
  const directory = join(root, "minimal-bin");
  await mkdir(directory);
  for (const tool of coreTools) {
    const source = await findTool(tool);
    if (source) await symlink(source, join(directory, tool));
  }
  for (const [name, content] of Object.entries(extra)) await writeExecutable(join(directory, name), content);
  return directory;
}

const fakeWget = `#!/bin/sh
set -eu
destination=""
url=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    -qO) destination=$2; shift 2 ;;
    *) url=$1; shift ;;
  esac
done
cp "\${url#file://}" "$destination"
`;

describe("bootstrap installer", { timeout: 20_000 }, () => {
  it("installs from the release under sh -c and forwards setup arguments", async () => {
    const fixture = await releaseFixture();

    const { stdout } = await fixture.install(["--targets", "claude", "--comment-language", "Brazilian Portuguese"]);

    expect(stdout).toContain("Installing Reviewonator 0.8.0…");
    expect(await readFile(join(fixture.binDir, "reviewonator"), "utf8")).toContain("Reviewonator 0.8.0");
    expect(await readFile(join(fixture.binDir, "reviewonator.reviewonator-managed"), "utf8")).toBe("Installed by Reviewonator\n");
    expect(await fixture.setupArguments()).toEqual([
      "setup", "--targets", "claude", "--comment-language", "Brazilian Portuguese",
    ]);
  });

  it("updates an older managed install", async () => {
    const fixture = await releaseFixture("0.8.0");
    await fixture.installed("0.7.0");

    const { stdout } = await fixture.install(["--targets", "claude"]);

    expect(stdout).toContain("Updating Reviewonator 0.7.0 to 0.8.0…");
    expect(await readFile(join(fixture.binDir, "reviewonator"), "utf8")).toContain("Reviewonator 0.8.0");
  });

  it("downloads with wget when curl is unavailable", async () => {
    const fixture = await releaseFixture();
    const path = await minimalPath(fixture.root, { wget: fakeWget });

    await fixture.install(["--targets", "codex"], { PATH: path });

    expect(await readFile(join(fixture.binDir, "reviewonator"), "utf8")).toContain("Reviewonator 0.8.0");
    expect(await fixture.setupArguments()).toEqual(["setup", "--targets", "codex"]);
  });

  it("fails clearly when neither curl nor wget exists", async () => {
    const fixture = await releaseFixture();
    const path = await minimalPath(fixture.root);

    await expect(fixture.install(["--targets", "claude"], { PATH: path })).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining("curl or wget is required to install Reviewonator."),
    });
    await expect(access(join(fixture.binDir, "reviewonator"))).rejects.toThrow();
  });

  it("aborts on a checksum mismatch without installing", async () => {
    const fixture = await releaseFixture();
    const checksum = join(fixture.release, `reviewonator-${platform}.tar.gz.sha256`);
    await writeFile(checksum, `${"0".repeat(64)}  reviewonator-${platform}.tar.gz\n`);

    await expect(fixture.install(["--targets", "claude"])).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining(`Checksum verification failed for reviewonator-${platform}.tar.gz.`),
    });
    await expect(access(join(fixture.binDir, "reviewonator"))).rejects.toThrow();
  });

  it("refuses to replace an unmanaged executable", async () => {
    const fixture = await releaseFixture();
    await mkdir(fixture.binDir, { recursive: true });
    await writeFile(join(fixture.binDir, "reviewonator"), "user-owned");

    await expect(fixture.install(["--targets", "claude"])).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining(`Refusing to replace unmanaged executable: ${join(fixture.binDir, "reviewonator")}`),
    });
    expect(await readFile(join(fixture.binDir, "reviewonator"), "utf8")).toBe("user-owned");
  });

  it("reports an up-to-date install and still runs setup", async () => {
    const fixture = await releaseFixture("0.8.0");
    await fixture.installed("0.8.0");

    const { stdout } = await fixture.install([]);

    expect(stdout).toContain("Reviewonator 0.8.0 is already up to date.");
    expect(await fixture.setupArguments()).toEqual(["setup"]);
  });

  it("does not downgrade a newer managed version without --force", async () => {
    const fixture = await releaseFixture("0.8.0");
    await fixture.installed("0.9.0");

    const kept = await fixture.install([]);
    expect(kept.stdout).toContain("Installed Reviewonator 0.9.0 is newer than the latest release 0.8.0; keeping it.");
    expect(await readFile(join(fixture.binDir, "reviewonator"), "utf8")).toContain("Reviewonator 0.9.0");

    await fixture.install(["--force"]);
    expect(await readFile(join(fixture.binDir, "reviewonator"), "utf8")).toContain("Reviewonator 0.8.0");
  });

  it("refuses when Reviewonator is installed with Homebrew", async () => {
    const fixture = await releaseFixture();
    const prefix = join(fixture.root, "homebrew");
    const brewBin = join(fixture.root, "brew-command");
    await mkdir(join(prefix, "bin"), { recursive: true });
    await mkdir(brewBin);
    await writeExecutable(join(prefix, "bin", "reviewonator"), stubExecutable("0.8.0"));
    await writeExecutable(join(brewBin, "brew"), `#!/bin/sh\n[ "$1" = "--prefix" ] && printf '%s\\n' '${prefix}'\n`);

    await expect(fixture.install(["--targets", "claude"], {
      PATH: [join(prefix, "bin"), brewBin, systemPath].join(delimiter),
    })).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining("Reviewonator is installed with Homebrew. Run brew upgrade reviewonator instead."),
    });
    await expect(access(join(fixture.binDir, "reviewonator"))).rejects.toThrow();
  });

  it("updates a managed script install that lives under the Homebrew prefix", async () => {
    const fixture = await releaseFixture("0.8.0");
    const brewBin = join(fixture.root, "brew-command");
    await mkdir(brewBin);
    await fixture.installed("0.7.0");
    await writeExecutable(join(brewBin, "brew"), `#!/bin/sh\n[ "$1" = "--prefix" ] && printf '%s\\n' '${fixture.root}'\n`);

    const { stdout } = await fixture.install(["--targets", "claude"], {
      PATH: [fixture.binDir, brewBin, systemPath].join(delimiter),
    });

    expect(stdout).toContain("Updating Reviewonator 0.7.0 to 0.8.0…");
    expect(await readFile(join(fixture.binDir, "reviewonator"), "utf8")).toContain("Reviewonator 0.8.0");
  });

  it("installs the local build with --local", async () => {
    const fixture = await releaseFixture();
    const project = join(fixture.root, "project");
    await mkdir(join(project, "scripts"), { recursive: true });
    await mkdir(join(project, "dist"));
    await cp("scripts/install.sh", join(project, "scripts", "install.sh"));
    await writeExecutable(join(project, "dist", "reviewonator"), stubExecutable("0.8.1"));
    await fixture.installed("0.9.0");

    await run(join(project, "scripts", "install.sh"), ["--local", "--bin-dir", fixture.binDir, "--targets", "claude"], {
      env: fixture.env,
    });

    expect(await readFile(join(fixture.binDir, "reviewonator"), "utf8")).toContain("Reviewonator 0.8.1");
    expect(await fixture.setupArguments()).toEqual(["setup", "--targets", "claude"]);
  });
});

describe("release packaging", () => {
  it("packages the executable, skill, license, notices, and checksum", async () => {
    const root = await mkdtemp(join(tmpdir(), "reviewonator-release-test-"));
    const binary = join(root, "reviewonator");
    const output = join(root, "release");
    await writeFile(binary, "#!/bin/sh\nprintf reviewonator\n");
    await chmod(binary, 0o755);

    await run("scripts/package-release.sh", ["linux-x64", binary, output]);

    const archive = join(output, "reviewonator-linux-x64.tar.gz");
    const { stdout } = await run("tar", ["-tzf", archive]);
    expect(stdout.split("\n")).toEqual(expect.arrayContaining([
      "./reviewonator",
      "./reviewonator-skill/SKILL.md",
      "./LICENSE",
      "./THIRD_PARTY_NOTICES.md",
      "./third-party-licenses/pierre-diffs-Apache-2.0.txt",
      "./third-party-licenses/lucide-react-ISC-and-MIT.txt",
      "./third-party-licenses/react-markdown-MIT.txt",
      "./third-party-licenses/remark-gfm-MIT.txt",
    ]));
    expect(await readFile(`${archive}.sha256`, "utf8")).toContain("reviewonator-linux-x64.tar.gz");
  });

  it("rejects an unsupported release platform", async () => {
    const root = await mkdtemp(join(tmpdir(), "reviewonator-release-test-"));
    const binary = join(root, "reviewonator");
    await writeFile(binary, "#!/bin/sh\nprintf reviewonator\n");
    await chmod(binary, 0o755);

    await expect(run("scripts/package-release.sh", ["windows-x64", binary, root]))
      .rejects.toMatchObject({ code: 2 });
  });
});

// @vitest-environment node

import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { access, chmod, cp, mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import type { InstallMethod } from "../../src/install/install-method";
import type { CommandResult, CommandRunner, RunOptions } from "../../src/platform/command";
import { writeLiveState } from "../../src/server/live-state";
import { platformName, type ReleaseSource } from "../../src/update/releases";
import { runUpdate } from "../../src/update/self-update";

const run = promisify(execFile);
const platform = platformName();
const systemPath = ["/usr/bin", "/bin", "/usr/sbin", "/sbin"].join(delimiter);
const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

/** Runs real processes; output requested as inherited lands in `terminal`, as it would on screen. */
class ProcessRunner implements CommandRunner {
  constructor(private readonly env: NodeJS.ProcessEnv, private readonly terminal: string[]) {}

  run(command: string, args: string[], _input?: string, options: RunOptions = {}): Promise<CommandResult> {
    return new Promise((resolve, reject) => {
      // No update command reads stdin. Like BunCommandRunner without input, never open it:
      // ending the stdin of a child that already exited raises an unhandled EPIPE on Linux.
      const child = spawn(command, args, { env: this.env, stdio: ["ignore", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => { if (options.inheritOutput) this.terminal.push(String(chunk)); else stdout += chunk; });
      child.stderr.on("data", (chunk) => { if (options.inheritOutput) this.terminal.push(String(chunk)); else stderr += chunk; });
      child.once("error", reject);
      child.once("close", (exitCode) => resolve({ stdout, stderr, exitCode: exitCode ?? 1 }));
    });
  }
}

class FixtureReleases implements ReleaseSource {
  readonly downloads: string[] = [];

  constructor(private readonly latest: string, private readonly releaseDir: string) {}

  async latestVersion() {
    return this.latest;
  }

  async download(_version: string, assets: string[], directory: string) {
    this.downloads.push(directory);
    for (const asset of assets) await cp(join(this.releaseDir, asset), join(directory, asset));
  }
}

function stubExecutable(version: string): string {
  return `#!/bin/sh
if [ "\${1:-}" = "--version" ]; then printf 'Reviewonator ${version}\\n'; exit 0; fi
if [ "\${1:-}" = "setup" ]; then
  printf '%s\\n' "$0 $*" > "$REVIEWONATOR_TEST_SETUP_LOG"
  if [ "\${REVIEWONATOR_TEST_SETUP_FAIL:-}" = "1" ]; then printf 'config broken\\n' >&2; exit 1; fi
  printf 'setup done\\n'
  exit 0
fi
exit 3
`;
}

async function writeExecutable(path: string, content: string) {
  await writeFile(path, content);
  await chmod(path, 0o755);
}

async function updateFixture(options: { current?: string; latest?: string; kind?: InstallMethod["kind"] } = {}) {
  const current = options.current ?? "0.7.0";
  const latest = options.latest ?? "0.8.0";
  const root = await mkdtemp(join(tmpdir(), "reviewonator-update-test-"));
  const stubDir = join(root, "stub");
  const releaseDir = join(root, "release");
  const binDir = join(root, "bin");
  await mkdir(stubDir);
  await mkdir(binDir);
  await writeExecutable(join(stubDir, "reviewonator"), stubExecutable(latest));
  await run("scripts/package-release.sh", [platform, join(stubDir, "reviewonator"), releaseDir]);
  const executablePath = join(binDir, "reviewonator");
  await writeExecutable(executablePath, stubExecutable(current));
  await writeFile(`${executablePath}.reviewonator-managed`, "Installed by Reviewonator\n");
  const setupLog = join(root, "setup.log");
  const env: NodeJS.ProcessEnv = {
    PATH: systemPath,
    REVIEWONATOR_STATE_DIR: join(root, "state"),
    REVIEWONATOR_TEST_SETUP_LOG: setupLog,
  };
  const releases = new FixtureReleases(latest, releaseDir);
  const lines: string[] = [];
  const terminal: string[] = [];
  const update = (force = false, overrides: { env?: NodeJS.ProcessEnv; installMethod?: InstallMethod } = {}) => {
    const updateEnv = overrides.env ?? env;
    return runUpdate({ force }, {
      installMethod: overrides.installMethod ?? { kind: options.kind ?? "script", executablePath },
      runner: new ProcessRunner(updateEnv, terminal),
      releases,
      version: current,
      env: updateEnv,
      log: (line) => lines.push(line),
      platform,
    });
  };
  return { root, releaseDir, binDir, executablePath, env, setupLog, releases, lines, terminal, update };
}

const exists = (path: string) => access(path).then(() => true, () => false);
const sha256 = async (path: string) => createHash("sha256").update(await readFile(path)).digest("hex");
const stagedFiles = async (directory: string) =>
  (await readdir(directory)).filter((name) => name.startsWith(".reviewonator-update-"));

describe("reviewonator update", () => {
  it("replaces a script-installed binary and runs setup with the new binary", async () => {
    const fixture = await updateFixture();

    await fixture.update();

    expect(await readFile(fixture.executablePath, "utf8")).toContain("Reviewonator 0.8.0");
    expect(await readFile(fixture.setupLog, "utf8")).toBe(`${fixture.executablePath} setup\n`);
    expect(fixture.lines).toContain("Updated Reviewonator 0.7.0 to 0.8.0.");
    expect(await stagedFiles(fixture.binDir)).toEqual([]);
    expect(await exists(fixture.releases.downloads[0])).toBe(false);
  });

  it("shows setup errors after an update", async () => {
    const fixture = await updateFixture();

    await fixture.update(false, { env: { ...fixture.env, REVIEWONATOR_TEST_SETUP_FAIL: "1" } });

    expect(await readFile(fixture.executablePath, "utf8")).toContain("Reviewonator 0.8.0");
    expect(fixture.terminal.join("")).toContain("config broken");
    expect(fixture.lines).toContain("Run reviewonator setup to install the Reviewonator skill for Claude Code or Codex.");
  });

  it("reports an up-to-date install without downloading", async () => {
    const fixture = await updateFixture({ current: "0.8.0", latest: "0.8.0" });

    await fixture.update();

    expect(fixture.lines).toEqual(["Reviewonator 0.8.0 is already up to date."]);
    expect(fixture.releases.downloads).toEqual([]);
  });

  it("keeps a newer local version unless forced", async () => {
    const fixture = await updateFixture({ current: "0.9.0", latest: "0.8.0" });

    await fixture.update();
    expect(fixture.lines).toEqual(["Installed Reviewonator 0.9.0 is newer than the latest release 0.8.0; keeping it."]);
    expect(await readFile(fixture.executablePath, "utf8")).toContain("Reviewonator 0.9.0");

    await fixture.update(true);
    expect(await readFile(fixture.executablePath, "utf8")).toContain("Reviewonator 0.8.0");
  });

  it("aborts on a checksum mismatch and leaves the old binary and no staged file", async () => {
    const fixture = await updateFixture();
    await writeFile(
      join(fixture.releaseDir, `reviewonator-${platform}.tar.gz.sha256`),
      `${"0".repeat(64)}  reviewonator-${platform}.tar.gz\n`,
    );

    await expect(fixture.update()).rejects.toThrow(`Checksum verification failed for reviewonator-${platform}.tar.gz.`);

    expect(await readFile(fixture.executablePath, "utf8")).toContain("Reviewonator 0.7.0");
    expect(await stagedFiles(fixture.binDir)).toEqual([]);
    expect(await exists(fixture.releases.downloads[0])).toBe(false);
  });

  it("fails clearly when the downloaded archive cannot be extracted", async () => {
    const fixture = await updateFixture();
    const archive = join(fixture.releaseDir, `reviewonator-${platform}.tar.gz`);
    await writeFile(archive, "not a gzip archive");
    await writeFile(`${archive}.sha256`, `${await sha256(archive)}  reviewonator-${platform}.tar.gz\n`);

    await expect(fixture.update()).rejects.toThrow(`Could not extract reviewonator-${platform}.tar.gz`);

    expect(await readFile(fixture.executablePath, "utf8")).toContain("Reviewonator 0.7.0");
    expect(await stagedFiles(fixture.binDir)).toEqual([]);
    expect(await exists(fixture.releases.downloads[0])).toBe(false);
  });

  it("fails clearly when the archive has no executable", async () => {
    const fixture = await updateFixture();
    const payload = join(fixture.root, "empty-payload");
    const archive = join(fixture.releaseDir, `reviewonator-${platform}.tar.gz`);
    await mkdir(payload);
    await writeFile(join(payload, "LICENSE"), "MIT");
    await run("tar", ["-czf", archive, "-C", payload, "."]);
    await writeFile(`${archive}.sha256`, `${await sha256(archive)}  reviewonator-${platform}.tar.gz\n`);

    await expect(fixture.update()).rejects.toThrow(
      `The downloaded reviewonator-${platform}.tar.gz does not contain the Reviewonator executable.`,
    );
    expect(await readFile(fixture.executablePath, "utf8")).toContain("Reviewonator 0.7.0");
  });

  it.skipIf(process.getuid?.() === 0)("fails clearly when the binary directory is not writable", async () => {
    const fixture = await updateFixture();
    await chmod(fixture.binDir, 0o555);
    cleanups.push(() => { void chmod(fixture.binDir, 0o755); });

    await expect(fixture.update()).rejects.toThrow(`Cannot update ${fixture.executablePath}: ${fixture.binDir} is not writable.`);

    expect(await readFile(fixture.executablePath, "utf8")).toContain("Reviewonator 0.7.0");
    expect(await stagedFiles(fixture.binDir)).toEqual([]);
  });

  it("updates Homebrew, then delegates to brew upgrade and runs setup from the Homebrew prefix", async () => {
    const fixture = await updateFixture({ kind: "homebrew" });
    const prefix = join(fixture.root, "homebrew", "opt", "reviewonator");
    const brewDir = join(fixture.root, "brew-command");
    await mkdir(join(prefix, "bin"), { recursive: true });
    await mkdir(brewDir);
    await writeExecutable(join(prefix, "bin", "reviewonator"), stubExecutable("0.8.0"));
    await writeExecutable(join(brewDir, "brew"), `#!/bin/sh
printf '%s\\n' "$*" >> '${join(fixture.root, "brew.log")}'
case "$*" in
  "update") printf 'Updated 1 tap (johniak/tap).\\n' ;;
  "upgrade reviewonator") printf 'Upgrading reviewonator 0.7.0 -> 0.8.0\\n' ;;
  "--prefix reviewonator") printf '%s\\n' '${prefix}' ;;
  *) exit 9 ;;
esac
`);
    const env = { ...fixture.env, PATH: [join(prefix, "bin"), brewDir, systemPath].join(delimiter) };

    await fixture.update(false, { env });

    expect(await readFile(join(fixture.root, "brew.log"), "utf8")).toBe("update\nupgrade reviewonator\n--prefix reviewonator\n");
    expect(fixture.terminal.join("")).toContain("Updated 1 tap (johniak/tap).");
    expect(fixture.terminal.join("")).toContain("Upgrading reviewonator 0.7.0 -> 0.8.0");
    expect(fixture.terminal.join("")).toContain("setup done");
    expect(await readFile(fixture.setupLog, "utf8")).toBe(`${join(prefix, "bin", "reviewonator")} setup\n`);
    expect(fixture.lines.some((line) => line.startsWith("Another reviewonator"))).toBe(false);
  });

  it("stops when brew update fails", async () => {
    const fixture = await updateFixture({ kind: "homebrew" });
    const brewDir = join(fixture.root, "brew-command");
    await mkdir(brewDir);
    await writeExecutable(join(brewDir, "brew"), `#!/bin/sh
printf '%s\\n' "$*" >> '${join(fixture.root, "brew.log")}'
[ "$1" = update ] && exit 1
exit 0
`);
    const env = { ...fixture.env, PATH: [brewDir, systemPath].join(delimiter) };

    await expect(fixture.update(false, { env })).rejects.toThrow("brew update failed.");
    expect(await readFile(join(fixture.root, "brew.log"), "utf8")).toBe("update\n");
  });

  it("refuses an unmanaged executable", async () => {
    const fixture = await updateFixture();

    await expect(fixture.update(false, { installMethod: { kind: "unmanaged", executablePath: process.execPath } }))
      .rejects.toThrow("Reviewonator can only update installations made with Homebrew or the install script.");
    expect(fixture.releases.downloads).toEqual([]);
  });

  it("refuses during an active live session unless forced", async () => {
    const fixture = await updateFixture();
    const server = createServer((_request, response) => response.writeHead(200).end("{}"));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    cleanups.push(() => server.close());
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("No server address.");
    await writeLiveState({
      prUrl: "https://github.com/acme/widgets/pull/42",
      baseUrl: `http://127.0.0.1:${address.port}`,
      token: "secret",
      pid: 1,
      startedAt: "2026-11-02T00:00:00.000Z",
    }, fixture.env);

    await expect(fixture.update()).rejects.toThrow(
      "Finish the open live review for https://github.com/acme/widgets/pull/42 before updating, or pass --force.",
    );
    expect(await readFile(fixture.executablePath, "utf8")).toContain("Reviewonator 0.7.0");

    await fixture.update(true);
    expect(await readFile(fixture.executablePath, "utf8")).toContain("Reviewonator 0.8.0");
  });

  it("warns when another reviewonator comes first on PATH", async () => {
    const fixture = await updateFixture();
    const shadow = join(fixture.root, "shadow");
    await mkdir(shadow);
    await writeExecutable(join(shadow, "reviewonator"), stubExecutable("0.6.0"));
    const env = { ...fixture.env, PATH: [shadow, fixture.binDir, systemPath].join(delimiter) };

    await fixture.update(false, { env });

    expect(fixture.lines).toContain(`Another reviewonator at ${join(shadow, "reviewonator")} comes first on PATH.`);
  });
});

import { execFile, spawn } from "node:child_process";
import { chmod, cp, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const run = promisify(execFile);

function runWithInput(file: string, args: string[], input: string): Promise<{ stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, {
      env: { ...process.env, REVIEWONATOR_INTERACTIVE: "1" },
      stdio: ["pipe", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve({ stderr });
      else reject(new Error(`Installer exited with ${code}: ${stderr}`));
    });
    child.stdin.end(input);
  });
}

async function installationFixture() {
  const root = await mkdtemp(join(tmpdir(), "reviewonator-install-test-"));
  const project = join(root, "project");
  await mkdir(join(project, "scripts"), { recursive: true });
  await mkdir(join(project, "dist"), { recursive: true });
  await mkdir(join(project, "skills", "reviewonator"), { recursive: true });
  await cp("scripts/install.sh", join(project, "scripts", "install.sh"));
  await cp("scripts/uninstall.sh", join(project, "scripts", "uninstall.sh"));
  await writeFile(join(project, "dist", "reviewonator"), "#!/bin/sh\nprintf reviewonator\n");
  await chmod(join(project, "dist", "reviewonator"), 0o755);
  await writeFile(
    join(project, "skills", "reviewonator", "SKILL.md"),
    "---\nname: reviewonator\n---\n\nReview language configuration: write public pull request comments and the review summary in English; write private reviewer explanations in English.\n",
  );
  const binDir = join(root, "bin");
  const skillDir = join(root, "skills");
  const codexSkillDir = join(root, "codex-skills");
  return { root, project, binDir, skillDir, codexSkillDir };
}

async function updateFixture(installedVersion: string, releaseVersion: string) {
  const fixture = await installationFixture();
  const platform = `${process.platform === "darwin" ? "darwin" : "linux"}-${process.arch === "arm64" ? "arm64" : "x64"}`;
  const payload = join(fixture.root, "payload");
  const releaseSkill = join(payload, "reviewonator-skill");
  await mkdir(releaseSkill, { recursive: true });
  await writeFile(join(payload, "reviewonator"), versionedExecutable(releaseVersion));
  await chmod(join(payload, "reviewonator"), 0o755);
  await writeFile(
    join(releaseSkill, "SKILL.md"),
    "---\nname: reviewonator\n---\n\nReview language configuration: write public pull request comments and the review summary in English; write private reviewer explanations in English.\n",
  );
  const archive = join(fixture.root, `reviewonator-${platform}.tar.gz`);
  await run("tar", ["-czf", archive, "-C", payload, "."]);

  await mkdir(fixture.binDir, { recursive: true });
  await mkdir(join(fixture.skillDir, "reviewonator", "references"), { recursive: true });
  await writeFile(join(fixture.binDir, "reviewonator"), versionedExecutable(installedVersion));
  await chmod(join(fixture.binDir, "reviewonator"), 0o755);
  await writeFile(join(fixture.binDir, "reviewonator.reviewonator-managed"), "managed\n");
  await writeFile(join(fixture.skillDir, "reviewonator", ".reviewonator-managed"), "managed\n");
  await writeFile(
    join(fixture.skillDir, "reviewonator", "SKILL.md"),
    "---\nname: reviewonator\n---\n\nRead [references/languages.md](references/languages.md) before producing review text and follow the installed language configuration throughout the review.\n",
  );
  await writeFile(
    join(fixture.skillDir, "reviewonator", "references", "languages.md"),
    "# Review languages\n\n- Write public pull request comments and the review summary in German.\n- Write private reviewer explanations in French.\n",
  );

  const fakeBin = join(fixture.root, "fake-bin");
  await mkdir(fakeBin);
  await writeFile(join(fakeBin, "gh"), `#!/bin/sh
set -eu
if [ "$1 $2" = "release view" ]; then
  printf 'v%s\\n' "$REVIEWONATOR_TEST_RELEASE_VERSION"
  exit 0
fi
if [ "$1 $2" = "release download" ]; then
  if [ "\${REVIEWONATOR_TEST_FAIL_DOWNLOAD:-}" = "1" ]; then exit 99; fi
  pattern=""
  destination=""
  shift 3
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --pattern) pattern=$2; shift 2 ;;
      --dir) destination=$2; shift 2 ;;
      *) shift ;;
    esac
  done
  cp "$REVIEWONATOR_TEST_ARCHIVE" "$destination/$pattern"
  exit 0
fi
printf 'Unexpected gh arguments: %s\\n' "$*" >&2
exit 2
`);
  await chmod(join(fakeBin, "gh"), 0o755);

  return {
    ...fixture,
    env: {
      ...process.env,
      PATH: `${fakeBin}:${process.env.PATH}`,
      REVIEWONATOR_TEST_ARCHIVE: archive,
      REVIEWONATOR_TEST_RELEASE_VERSION: releaseVersion,
    },
  };
}

function versionedExecutable(version: string): string {
  return `#!/bin/sh
if [ "\${1:-}" = "--version" ]; then
  printf 'Reviewonator ${version}\\n'
else
  printf 'reviewonator ${version}\\n'
fi
`;
}

describe("installation scripts", () => {
  it("installs and uninstalls only Reviewonator-managed files", async () => {
    const fixture = await installationFixture();
    const options = [
      "--targets", "claude",
      "--bin-dir", fixture.binDir,
      "--skill-dir", fixture.skillDir,
      "--codex-skill-dir", fixture.codexSkillDir,
    ];
    await run(join(fixture.project, "scripts", "install.sh"), [...options, "--local"]);

    expect(await readFile(join(fixture.binDir, "reviewonator"), "utf8")).toContain("reviewonator");
    const skill = await readFile(join(fixture.skillDir, "reviewonator", "SKILL.md"), "utf8");
    expect(skill).toContain("name: reviewonator");
    expect(skill).toContain("review summary in English; write private reviewer explanations in English");

    await run(join(fixture.project, "scripts", "uninstall.sh"), options);
    await expect(readFile(join(fixture.binDir, "reviewonator"))).rejects.toThrow();
    await expect(readFile(join(fixture.skillDir, "reviewonator", "SKILL.md"))).rejects.toThrow();
  });

  it("refuses to overwrite an unmanaged executable", async () => {
    const fixture = await installationFixture();
    await mkdir(fixture.binDir, { recursive: true });
    await writeFile(join(fixture.binDir, "reviewonator"), "user-owned");
    await expect(run(join(fixture.project, "scripts", "install.sh"), [
      "--targets", "claude",
      "--bin-dir", fixture.binDir,
      "--skill-dir", fixture.skillDir,
      "--local",
    ])).rejects.toMatchObject({ code: 1 });
    expect(await readFile(join(fixture.binDir, "reviewonator"), "utf8")).toBe("user-owned");
  });

  it("writes non-interactive language choices into the installed skill", async () => {
    const fixture = await installationFixture();
    await run(join(fixture.project, "scripts", "install.sh"), [
      "--targets", "claude",
      "--bin-dir", fixture.binDir,
      "--skill-dir", fixture.skillDir,
      "--local",
      "--comment-language", "German",
      "--reviewer-language", "French",
    ]);

    const skill = await readFile(join(fixture.skillDir, "reviewonator", "SKILL.md"), "utf8");
    expect(skill).toContain("review summary in German; write private reviewer explanations in French");
  });

  it("prompts for both languages during an interactive installation", async () => {
    const fixture = await installationFixture();
    const result = await runWithInput(join(fixture.project, "scripts", "install.sh"), [
      "--targets", "claude",
      "--bin-dir", fixture.binDir,
      "--skill-dir", fixture.skillDir,
      "--local",
    ], "Spanish\nUkrainian\n");

    expect(result.stderr).toContain("Language for comments published to GitHub [English]");
    expect(result.stderr).toContain("Language for private reviewer notes [English]");
    const skill = await readFile(join(fixture.skillDir, "reviewonator", "SKILL.md"), "utf8");
    expect(skill).toContain("review summary in Spanish; write private reviewer explanations in Ukrainian");
  });

  it("offers a multi-select target prompt and installs both agent integrations", async () => {
    const fixture = await installationFixture();
    const result = await runWithInput(join(fixture.project, "scripts", "install.sh"), [
      "--bin-dir", fixture.binDir,
      "--claude-skill-dir", fixture.skillDir,
      "--codex-skill-dir", fixture.codexSkillDir,
      "--local",
    ], "1,2\nPolish\nEnglish\n");

    expect(result.stderr).toContain("Install the Reviewonator skill for:");
    expect(result.stderr).toContain("1) Claude Code");
    expect(result.stderr).toContain("2) Codex");
    expect(await readFile(join(fixture.skillDir, "reviewonator", "SKILL.md"), "utf8"))
      .toContain("review summary in Polish; write private reviewer explanations in English");
    expect(await readFile(join(fixture.codexSkillDir, "reviewonator", "SKILL.md"), "utf8"))
      .toContain("review summary in Polish; write private reviewer explanations in English");
  });

  it("supports deterministic Codex-only installation", async () => {
    const fixture = await installationFixture();
    await run(join(fixture.project, "scripts", "install.sh"), [
      "--targets", "codex",
      "--bin-dir", fixture.binDir,
      "--claude-skill-dir", fixture.skillDir,
      "--codex-skill-dir", fixture.codexSkillDir,
      "--local",
    ]);

    await expect(readFile(join(fixture.skillDir, "reviewonator", "SKILL.md"))).rejects.toThrow();
    expect(await readFile(join(fixture.codexSkillDir, "reviewonator", "SKILL.md"), "utf8"))
      .toContain("name: reviewonator");
  });

  it("requires an explicit target in non-interactive installations", async () => {
    const fixture = await installationFixture();
    await expect(run(join(fixture.project, "scripts", "install.sh"), [
      "--bin-dir", fixture.binDir,
      "--skill-dir", fixture.skillDir,
      "--local",
    ])).rejects.toMatchObject({
      code: 2,
      stderr: expect.stringContaining("No installation target was provided"),
    });
  });

  it("keeps the executable until every selected agent integration is removed", async () => {
    const fixture = await installationFixture();
    const options = [
      "--targets", "claude,codex",
      "--bin-dir", fixture.binDir,
      "--claude-skill-dir", fixture.skillDir,
      "--codex-skill-dir", fixture.codexSkillDir,
    ];
    await run(join(fixture.project, "scripts", "install.sh"), [...options, "--local"]);

    await run(join(fixture.project, "scripts", "uninstall.sh"), [
      "--targets", "claude",
      "--bin-dir", fixture.binDir,
      "--claude-skill-dir", fixture.skillDir,
      "--codex-skill-dir", fixture.codexSkillDir,
    ]);
    await expect(readFile(join(fixture.skillDir, "reviewonator", "SKILL.md"))).rejects.toThrow();
    expect(await readFile(join(fixture.binDir, "reviewonator"), "utf8")).toContain("reviewonator");

    await run(join(fixture.project, "scripts", "uninstall.sh"), [
      "--targets", "codex",
      "--bin-dir", fixture.binDir,
      "--claude-skill-dir", fixture.skillDir,
      "--codex-skill-dir", fixture.codexSkillDir,
    ]);
    await expect(readFile(join(fixture.codexSkillDir, "reviewonator", "SKILL.md"))).rejects.toThrow();
    await expect(readFile(join(fixture.binDir, "reviewonator"))).rejects.toThrow();
  });

  it("updates an older managed release and preserves its language choices", async () => {
    const fixture = await updateFixture("0.3.1", "0.4.0");
    const options = [
      "--targets", "claude",
      "--bin-dir", fixture.binDir,
      "--skill-dir", fixture.skillDir,
      "--repository", "acme/reviewonator",
    ];
    const first = await run(join(fixture.project, "scripts", "install.sh"), options, { env: fixture.env });

    expect(first.stdout).toContain("Updating Reviewonator 0.3.1 to 0.4.0");
    expect(await run(join(fixture.binDir, "reviewonator"), ["--version"]))
      .toMatchObject({ stdout: "Reviewonator 0.4.0\n" });
    const skill = await readFile(join(fixture.skillDir, "reviewonator", "SKILL.md"), "utf8");
    expect(skill).toContain("review summary in German; write private reviewer explanations in French");
    await expect(readFile(join(fixture.skillDir, "reviewonator", "references", "languages.md")))
      .rejects.toThrow();

    const second = await run(join(fixture.project, "scripts", "install.sh"), options, {
      env: { ...fixture.env, REVIEWONATOR_TEST_FAIL_DOWNLOAD: "1" },
    });
    expect(second.stdout).toContain("Reviewonator 0.4.0 is already up to date");
  });

  it("does not downgrade a newer managed version without --force", async () => {
    const fixture = await updateFixture("0.5.0", "0.4.0");
    const options = [
      "--targets", "claude",
      "--bin-dir", fixture.binDir,
      "--skill-dir", fixture.skillDir,
      "--repository", "acme/reviewonator",
    ];
    const kept = await run(join(fixture.project, "scripts", "install.sh"), [...options, "--comment-language", "Spanish"], {
      env: { ...fixture.env, REVIEWONATOR_TEST_FAIL_DOWNLOAD: "1" },
    });
    expect(kept.stdout).toContain("Installed Reviewonator 0.5.0 is newer");
    expect(await readFile(join(fixture.skillDir, "reviewonator", "SKILL.md"), "utf8"))
      .toContain("review summary in Spanish; write private reviewer explanations in French");

    await run(join(fixture.project, "scripts", "install.sh"), [...options, "--force"], { env: fixture.env });
    expect(await run(join(fixture.binDir, "reviewonator"), ["--version"]))
      .toMatchObject({ stdout: "Reviewonator 0.4.0\n" });
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

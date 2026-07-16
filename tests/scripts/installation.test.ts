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
  await writeFile(join(project, "skills", "reviewonator", "SKILL.md"), "---\nname: reviewonator\n---\n");
  const binDir = join(root, "bin");
  const skillDir = join(root, "skills");
  return { root, project, binDir, skillDir };
}

describe("installation scripts", () => {
  it("installs and uninstalls only Reviewonator-managed files", async () => {
    const fixture = await installationFixture();
    const options = ["--bin-dir", fixture.binDir, "--skill-dir", fixture.skillDir];
    await run(join(fixture.project, "scripts", "install.sh"), options);

    expect(await readFile(join(fixture.binDir, "reviewonator"), "utf8")).toContain("reviewonator");
    expect(await readFile(join(fixture.skillDir, "reviewonator", "SKILL.md"), "utf8")).toContain("name: reviewonator");
    expect(await readFile(join(fixture.skillDir, "reviewonator", "references", "languages.md"), "utf8"))
      .toContain("review summary in English");
    expect(await readFile(join(fixture.skillDir, "reviewonator", "references", "languages.md"), "utf8"))
      .toContain("reviewer explanations in English");

    await run(join(fixture.project, "scripts", "uninstall.sh"), options);
    await expect(readFile(join(fixture.binDir, "reviewonator"))).rejects.toThrow();
    await expect(readFile(join(fixture.skillDir, "reviewonator", "SKILL.md"))).rejects.toThrow();
  });

  it("refuses to overwrite an unmanaged executable", async () => {
    const fixture = await installationFixture();
    await mkdir(fixture.binDir, { recursive: true });
    await writeFile(join(fixture.binDir, "reviewonator"), "user-owned");
    await expect(run(join(fixture.project, "scripts", "install.sh"), [
      "--bin-dir", fixture.binDir,
      "--skill-dir", fixture.skillDir,
    ])).rejects.toMatchObject({ code: 1 });
    expect(await readFile(join(fixture.binDir, "reviewonator"), "utf8")).toBe("user-owned");
  });

  it("writes non-interactive language choices into the installed skill", async () => {
    const fixture = await installationFixture();
    await run(join(fixture.project, "scripts", "install.sh"), [
      "--bin-dir", fixture.binDir,
      "--skill-dir", fixture.skillDir,
      "--comment-language", "German",
      "--reviewer-language", "French",
    ]);

    const languages = await readFile(
      join(fixture.skillDir, "reviewonator", "references", "languages.md"),
      "utf8",
    );
    expect(languages).toContain("review summary in German");
    expect(languages).toContain("reviewer explanations in French");
  });

  it("prompts for both languages during an interactive installation", async () => {
    const fixture = await installationFixture();
    const result = await runWithInput(join(fixture.project, "scripts", "install.sh"), [
      "--bin-dir", fixture.binDir,
      "--skill-dir", fixture.skillDir,
    ], "Spanish\nUkrainian\n");

    expect(result.stderr).toContain("Language for comments published to GitHub [English]");
    expect(result.stderr).toContain("Language for private reviewer notes [English]");
    const languages = await readFile(
      join(fixture.skillDir, "reviewonator", "references", "languages.md"),
      "utf8",
    );
    expect(languages).toContain("review summary in Spanish");
    expect(languages).toContain("reviewer explanations in Ukrainian");
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
      "./reviewonator-skill/references/languages.md",
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

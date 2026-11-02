// @vitest-environment node

import { chmod, mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { detectInstallMethod } from "../../src/install/install-method";

async function executable(path: string) {
  await writeFile(path, "#!/bin/sh\n");
  await chmod(path, 0o755);
}

describe("detectInstallMethod", () => {
  it("detects a Homebrew Cellar path through a symlink", async () => {
    const root = await mkdtemp(join(tmpdir(), "reviewonator-method-"));
    const cellar = join(root, "Cellar", "reviewonator", "0.8.0", "bin");
    await mkdir(cellar, { recursive: true });
    await mkdir(join(root, "bin"));
    await executable(join(cellar, "reviewonator"));
    await symlink(join(cellar, "reviewonator"), join(root, "bin", "reviewonator"));

    const method = await detectInstallMethod(join(root, "bin", "reviewonator"));

    expect(method.kind).toBe("homebrew");
  });

  it("detects a script install by its binary marker", async () => {
    const root = await mkdtemp(join(tmpdir(), "reviewonator-method-"));
    await executable(join(root, "reviewonator"));
    await writeFile(join(root, "reviewonator.reviewonator-managed"), "Installed by Reviewonator\n");

    expect(await detectInstallMethod(join(root, "reviewonator"))).toEqual({
      kind: "script",
      executablePath: join(root, "reviewonator"),
    });
  });

  it("treats any other executable, including Bun, as unmanaged", async () => {
    const root = await mkdtemp(join(tmpdir(), "reviewonator-method-"));
    await executable(join(root, "reviewonator"));

    expect((await detectInstallMethod(join(root, "reviewonator"))).kind).toBe("unmanaged");
    expect((await detectInstallMethod(process.execPath)).kind).toBe("unmanaged");
  });
});

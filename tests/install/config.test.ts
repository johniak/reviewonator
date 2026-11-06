// @vitest-environment node

import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  configPath,
  defaultSkillRoots,
  InvalidConfigError,
  parseTargets,
  readConfig,
  removeConfig,
  writeConfig,
  type InstallConfig,
} from "../../src/install/config";

const config: InstallConfig = {
  version: 1,
  targets: ["claude", "codex"],
  skillRoots: { claude: "/skills/claude", codex: "/skills/codex" },
  languages: { comments: "German", reviewerNotes: "French" },
};

async function temporaryDirectory() {
  return mkdtemp(join(tmpdir(), "reviewonator-config-test-"));
}

describe("install config", () => {
  it("round-trips the default review mode and still parses a config without one", async () => {
    const directory = await temporaryDirectory();
    const env = { REVIEWONATOR_CONFIG_DIR: directory };

    await writeConfig({ ...config, mode: "early" }, env);
    expect(await readConfig(env)).toEqual({ ...config, mode: "early" });

    await writeFile(configPath(env), JSON.stringify(config));
    expect((await readConfig(env))?.mode).toBeUndefined();
  });

  it("rejects an unknown review mode", async () => {
    const directory = await temporaryDirectory();
    const env = { REVIEWONATOR_CONFIG_DIR: directory };
    await writeFile(configPath(env), JSON.stringify({ ...config, mode: "fast" }));

    await expect(readConfig(env)).rejects.toBeInstanceOf(InvalidConfigError);
  });

  it("resolves the config path from REVIEWONATOR_CONFIG_DIR, then XDG_CONFIG_HOME, then ~/.config", () => {
    expect(configPath({ REVIEWONATOR_CONFIG_DIR: "/custom", XDG_CONFIG_HOME: "/xdg" })).toBe("/custom/config.json");
    expect(configPath({ XDG_CONFIG_HOME: "/xdg" })).toBe("/xdg/reviewonator/config.json");
    expect(configPath({})).toBe(join(homedir(), ".config", "reviewonator", "config.json"));
  });

  it("resolves Claude and Codex skill roots from the documented environment variables", () => {
    expect(defaultSkillRoots({})).toEqual({
      claude: join(homedir(), ".claude", "skills"),
      codex: join(homedir(), ".agents", "skills"),
    });
    expect(defaultSkillRoots({ REVIEWONATOR_SKILL_DIR: "/legacy" }).claude).toBe("/legacy");
    expect(defaultSkillRoots({
      REVIEWONATOR_CLAUDE_SKILL_DIR: "/claude",
      REVIEWONATOR_SKILL_DIR: "/legacy",
      REVIEWONATOR_CODEX_SKILL_DIR: "/codex",
    })).toEqual({ claude: "/claude", codex: "/codex" });
  });

  it("resolves relative skill roots against the current directory", () => {
    expect(defaultSkillRoots({ REVIEWONATOR_CLAUDE_SKILL_DIR: "relative/claude", REVIEWONATOR_CODEX_SKILL_DIR: "codex" }))
      .toEqual({ claude: resolve("relative/claude"), codex: resolve("codex") });
  });

  it("parses every accepted target spelling", () => {
    expect(parseTargets(" Claude-Code,2 ")).toEqual(["claude", "codex"]);
    expect(parseTargets("both")).toEqual(["claude", "codex"]);
    expect(parseTargets("all")).toEqual(["claude", "codex"]);
    expect(parseTargets("1")).toEqual(["claude"]);
    expect(parseTargets("codex,codex")).toEqual(["codex"]);
  });

  it("rejects unknown and empty targets", () => {
    expect(() => parseTargets("vim")).toThrow(/Unknown installation target: vim/);
    expect(() => parseTargets(" , ")).toThrow(/Select at least one installation target/);
  });

  it("round-trips a config file with mode 0600", async () => {
    const env = { REVIEWONATOR_CONFIG_DIR: await temporaryDirectory() };

    await writeConfig(config, env);

    expect(await readConfig(env)).toEqual(config);
    expect((await stat(configPath(env))).mode & 0o777).toBe(0o600);
    await removeConfig(env);
    expect(await readConfig(env)).toBeNull();
  });

  it("returns null for a missing config and throws InvalidConfigError naming the path for corrupt JSON", async () => {
    const env = { REVIEWONATOR_CONFIG_DIR: await temporaryDirectory() };
    expect(await readConfig(env)).toBeNull();

    await writeFile(configPath(env), "{ not json");
    const corrupt = readConfig(env);
    await expect(corrupt).rejects.toBeInstanceOf(InvalidConfigError);
    await expect(readConfig(env)).rejects.toThrow(configPath(env));

    await writeFile(configPath(env), JSON.stringify({ ...config, targets: [] }));
    await expect(readConfig(env)).rejects.toThrow(configPath(env));
    expect(await readFile(configPath(env), "utf8")).toContain("\"targets\":[]");
  });
});

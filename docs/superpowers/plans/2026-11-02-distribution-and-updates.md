# Distribution and Updates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reviewonator can be installed with Homebrew or a one-line `curl`/`wget` installer and updated with `reviewonator update`, and its skills stay in sync without asking again. The web UI shows when a newer version exists.

**Architecture:** Skill installation moves from `scripts/install.sh` into the compiled binary:
- The skill files are embedded in the binary.
- New commands: `setup`, `uninstall` and `update`.
- Skills sync silently on start, and choices persist in a config file.

`install.sh` becomes a thin bootstrap that downloads a release and runs `reviewonator setup`. A Homebrew tap formula is generated in the release workflow. An `UpdateChecker` in the CLI process feeds a new authenticated API route that the web UI reads once on load.

**Tech Stack:** Bun 1.3.13 (runtime, compiler), TypeScript, zod, Hono, React, Vitest + Testing Library, POSIX sh, GitHub Actions, Homebrew formula (Ruby DSL).

**Spec:** `docs/superpowers/specs/2026-11-02-distribution-and-updates-design.md`

## Global Constraints

- Repository slug is hard-coded as `johniak/reviewonator`. The tap is `johniak/homebrew-tap`, and the formula path is `Formula/reviewonator.rb`.
- Supported platforms: `darwin-arm64`, `darwin-x64`, `linux-arm64`, `linux-x64`.
- Config file: `$REVIEWONATOR_CONFIG_DIR/config.json`, else `$XDG_CONFIG_HOME/reviewonator/config.json`, else `~/.config/reviewonator/config.json`. Mode 0600, written atomically (temp file + rename).
- Skill roots:
  - Claude: `REVIEWONATOR_CLAUDE_SKILL_DIR`, else `REVIEWONATOR_SKILL_DIR`, else `~/.claude/skills`.
  - Codex: `REVIEWONATOR_CODEX_SKILL_DIR`, else `~/.agents/skills`.
  - The skill directory is `<root>/reviewonator`.
- Skill marker: `<skill>/.reviewonator-managed`, content `Installed by Reviewonator <version>\n`. A marker without a version (v0.7) counts as outdated. The binary marker `<bin>.reviewonator-managed` keeps its current path.
- Language line, exact: `Review language configuration: write public pull request comments and the review summary in <COMMENTS>; write private reviewer explanations in <REVIEWER>.`
- Targets are never chosen silently. With no TTY, no config and no `--targets`/`REVIEWONATOR_TARGETS`, the command fails. Interactive means the stdin is a TTY or `REVIEWONATOR_INTERACTIVE=1`.
- Files without a marker are never overwritten or removed.
- Version check:
  - Command: `gh api repos/johniak/reviewonator/releases/latest --jq .tag_name`.
  - Cache: `<liveStateDirectory()>/update-check.json`, TTL 24 h.
  - Background timeout: 5000 ms. Route wait cap: 3000 ms.
  - Opt-out: `REVIEWONATOR_NO_UPDATE_CHECK=1`.
- Release notes URL: `https://github.com/johniak/reviewonator/releases/tag/v<latest>`.
- Bootstrap download base: `https://github.com/johniak/reviewonator/releases/latest/download`, overridable with `REVIEWONATOR_DOWNLOAD_URL`.
- All user-facing text is in English. UI follows `docs/paper-copper-design-language.md`: `--pc-*` tokens, light shadow allowed only because the notice is a floating panel, no text under 12px, no gradients, no uppercase micro-labels.
- Tests use real file systems in temp dirs and real executables (fake `gh`/`brew`/`wget` scripts on `PATH`). In-process fakes are allowed only for the injected interfaces `CommandRunner` and `ReleaseSource`. Tests never touch the real `$HOME`: set `REVIEWONATOR_CONFIG_DIR`, `REVIEWONATOR_CLAUDE_SKILL_DIR`, `REVIEWONATOR_CODEX_SKILL_DIR` and `REVIEWONATOR_STATE_DIR`.
- Every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- `bun run check` must pass at the end of every task.

## Review Focus

1. **The binary's directory is not writable during `reviewonator update`**, for example `/usr/local/bin` owned by root. Expect a clear error, the old binary unchanged and no staged file left (Task 6 test).
2. **A corrupt or hand-edited `config.json`.** Sync warns once and the review still runs. `setup` fails with a message naming the file (Task 3 test).
3. **A managed skill directory replaced by the user, so the marker is gone.** Sync skips it with a warning and never overwrites it (Task 3 test).
4. **Offline or unauthenticated `gh` during the background check.** No notice, nothing on stderr, and opening the page is not delayed (Task 7 test).
5. **An interrupted self-update** (checksum mismatch or failed extraction). Temp files are removed and the old binary is intact (Task 6 test).

---

### Task 0: Homebrew spike (manual, blocks Task 9)

**Files:** none committed.

- [ ] **Step 1: Create a throwaway local tap with a formula for v0.7.0.**

Run `brew tap-new reviewonator/spike --no-git`. Write `$(brew --repository reviewonator/spike)/Formula/reviewonator.rb` with:
- `url "https://github.com/johniak/reviewonator/releases/download/v0.7.0/reviewonator-darwin-arm64.tar.gz"`
- `sha256` taken from that release's `.sha256` asset (`gh release download v0.7.0 --repo johniak/reviewonator --pattern 'reviewonator-darwin-arm64.tar.gz.sha256' -O -`)
- `version "0.7.0"`
- `def install; bin.install "reviewonator"; end`

- [ ] **Step 2: Install it and run the binary.**

Run `brew install reviewonator/spike/reviewonator`, then `"$(brew --prefix)/opt/reviewonator/bin/reviewonator" --version` and `"$(brew --prefix)/opt/reviewonator/bin/reviewonator" --help`.
Expected: `Reviewonator 0.7.0` and the help text, with no `Killed: 9` and no code-signing error.

- [ ] **Step 3: Clean up.**

Run `brew uninstall reviewonator && brew untap reviewonator/spike`.

- [ ] **Step 4: Decide.**

If Step 2 passed, continue with the plan. If it failed, stop and report to the user before Task 9; the fallback is a Cask, which the spec says needs the user's input.

---

### Task 1: Install config and skill files on disk

**Files:**
- Create: `src/install/config.ts`, `src/install/skill.ts`
- Test: `tests/install/config.test.ts`, `tests/install/skill.test.ts`

**Interfaces:**
- Produces (`src/install/config.ts`):
  - `type Target = "claude" | "codex"`
  - `type Languages = { comments: string; reviewerNotes: string }`
  - `type InstallConfig = { version: 1; targets: Target[]; skillRoots: Partial<Record<Target, string>>; languages: Languages }`
  - `configPath(env?: NodeJS.ProcessEnv): string`
  - `defaultSkillRoots(env?: NodeJS.ProcessEnv): Record<Target, string>`
  - `parseTargets(input: string): Target[]`. Accepts `1`, `2`, `claude`, `claude-code`, `codex`, `both` and `all`, comma-separated, case-insensitive, spaces ignored. Throws on unknown or empty input with the messages from today's `install.sh`.
  - `readConfig(env?): Promise<InstallConfig | null>`. Returns `null` when the file is missing. Throws `InvalidConfigError`, whose message contains the path, when the content is not valid JSON or fails the zod schema.
  - `writeConfig(config: InstallConfig, env?): Promise<void>`
  - `removeConfig(env?): Promise<void>`
- Produces (`src/install/skill.ts`):
  - `type SkillFile = { path: string; content: string }`, where `path` is POSIX and relative.
  - `type SkillMarker = { managed: false } | { managed: true; version: string | null }`
  - `skillDirectory(root: string): string`, which returns `join(root, "reviewonator")`.
  - `readSkillMarker(skillDir: string): Promise<SkillMarker | null>`, which returns `null` when the directory is absent.
  - `languageLine(languages: Languages): string`
  - `writeSkill(skillDir: string, files: SkillFile[], languages: Languages, version: string): Promise<void>`. Throws `UnmanagedSkillError` when the directory exists without a marker. Otherwise it writes all files into a sibling temp directory, replaces the `Review language configuration:` line in `SKILL.md`, writes the marker, removes the old directory and renames the temp directory into place. Throws if `SKILL.md` has no marker line.
  - `readInstalledLanguages(skillDir: string): Promise<Languages | null>`. Reads the language line, or the legacy `references/languages.md` lines `- Write public pull request comments and the review summary in X.` and `- Write private reviewer explanations in Y.`
  - `removeSkill(skillDir: string): Promise<"removed" | "unmanaged" | "absent">`

- [ ] **Step 1: Write failing tests.**
  - `config.test.ts`:
    - `"resolves the config path from REVIEWONATOR_CONFIG_DIR, then XDG_CONFIG_HOME, then ~/.config"`
    - `"resolves Claude and Codex skill roots from the documented environment variables"`
    - `"parses every accepted target spelling"`: `parseTargets(" Claude-Code,2 ")` is `["claude","codex"]` and `parseTargets("both")` is `["claude","codex"]`.
    - `"rejects unknown and empty targets"`: `parseTargets("vim")` throws `/Unknown installation target: vim/`.
    - `"round-trips a config file with mode 0600"`
    - `"returns null for a missing config and throws InvalidConfigError naming the path for corrupt JSON"`
  - `skill.test.ts`:
    - `"writes every skill file, the language line and a versioned marker"`: the marker content is `Installed by Reviewonator 0.8.0\n`, and `SKILL.md` contains `languageLine({comments:"German",reviewerNotes:"French"})`.
    - `"replaces an existing managed skill without leaving old files behind"`
    - `"refuses to overwrite an unmanaged skill directory"`: the original files are unchanged.
    - `"reads a legacy unversioned marker as managed with version null"`
    - `"reads installed languages from the language line and from legacy references/languages.md"`
    - `"removes only managed skills"`: returns `removed`, `unmanaged` or `absent`.

- [ ] **Step 2: Run the tests and confirm they fail.**

Run `bunx vitest run tests/install`. Expected: FAIL, module not found.

- [ ] **Step 3: Implement `src/install/config.ts` and `src/install/skill.ts`.**

Use the signatures above. Write the config through the zod schema `z.object({ version: z.literal(1), targets: z.array(z.enum(["claude","codex"])).min(1), skillRoots: z.record(...), languages: z.object({ comments: z.string().min(1), reviewerNotes: z.string().min(1) }) })`. Port the atomic-write pattern from `src/server/live-state.ts`.

- [ ] **Step 4: Run the tests and confirm they pass.**

Run `bunx vitest run tests/install`. Expected: PASS.

- [ ] **Step 5: Commit** with the message "Add install config and managed skill files".

---

### Task 2: `reviewonator setup` with the embedded skill

**Files:**
- Create: `src/install/embedded-skill.ts`, `src/install/prompt.ts`, `src/install/setup.ts`
- Modify: `src/types.d.ts` (declare `*.md` and `*.yaml` as text modules); `src/cli.ts` (add the `setup` command, new flags and help text)
- Test: `tests/install/setup.test.ts`, `tests/e2e/setup.test.ts` (`// @vitest-environment node`)

**Interfaces:**
- Consumes: everything from Task 1.
- Produces:
  - `embeddedSkillFiles: SkillFile[]` in `embedded-skill.ts`. It uses text imports of `skills/reviewonator/SKILL.md`, `references/review-schema.md` and `agents/openai.yaml` with `with { type: "text" }`. Only `src/cli.ts` imports this module, because Vite cannot load these imports.
  - `interface Prompter { ask(question: string): Promise<string> }` and `createStdinPrompter(): Prompter`. It reads lines from stdin through `node:readline` and writes the question to stderr.
  - `type SetupOptions = { targets?: string; commentLanguage?: string; reviewerLanguage?: string; claudeSkillDir?: string; codexSkillDir?: string; reconfigure?: boolean }`
  - `type SetupContext = { env: NodeJS.ProcessEnv; files: SkillFile[]; version: string; interactive: boolean; prompter: Prompter; log: (line: string) => void }`
  - `runSetup(options: SetupOptions, context: SetupContext): Promise<InstallConfig>`
- CLI flags added to `parseArgs`: `targets`, `comment-language`, `reviewer-language`, `claude-skill-dir`, `codex-skill-dir`, `skill-dir` (an alias of `claude-skill-dir`), `reconfigure`, `force`.

**Rules for `runSetup`:**
- Each value comes from the flag, else the env var (`REVIEWONATOR_TARGETS`, `REVIEWONATOR_COMMENT_LANGUAGE`, `REVIEWONATOR_REVIEWER_LANGUAGE`), else the config.
- **A config exists and `reconfigure` is not set:** no prompts. Merge any given values over the config, rewrite the skills for all targets and save the config.
- **No config, or `reconfigure`, interactive:** prompt with exactly today's `install.sh` texts:
  - `Install the Reviewonator skill for:` / `  1) Claude Code` / `  2) Codex` / `Select one or more targets (comma-separated, for example 1,2): `
  - `Language for comments published to GitHub [<default>]: `
  - `Language for private reviewer notes [<default>]: `

  The language defaults come from the config, else from `readInstalledLanguages` of an existing managed skill, else `English`.
- **No config, not interactive:** require targets, and use the language defaults above.
- Managed skills of targets that are no longer selected are removed with `removeSkill`.
- Log lines: `Installed Claude Code skill: <dir>`, `Installed Codex skill: <dir>`, `GitHub comment language: <C>`, `Private reviewer note language: <R>`.

- [ ] **Step 1: Write failing tests.**
  - `tests/install/setup.test.ts`, using a scripted `Prompter` that returns queued answers:
    - `"prompts for targets and both languages on first interactive setup"`: answers `1,2`, `German`, `French`. Both skills are written, and the config is `{targets:["claude","codex"], languages:{comments:"German", reviewerNotes:"French"}}`.
    - `"never prompts when a config exists"`: the prompter throws if called, and the skills are rewritten with the config languages.
    - `"reconfigure prompts with the current values as defaults"`: empty answers keep `German`/`French`.
    - `"requires targets when not interactive and no config exists"`: rejects with `/No installation target was provided/`.
    - `"flags override the config without prompting"`
    - `"removes the managed skill of a deselected target"`
    - `"reuses languages from a legacy v0.7 skill as prompt defaults"`
    - `"fails with the config path when config.json is corrupt"`: rejects with a message containing `config.json`.
  - `tests/e2e/setup.test.ts`: `"setup installs the embedded skill identical to skills/reviewonator"`. Spawn `bun src/cli.ts setup --targets claude --claude-skill-dir <tmp> --comment-language English --reviewer-language English` with `REVIEWONATOR_CONFIG_DIR=<tmp>`. Walk `skills/reviewonator` and assert that every file exists in `<tmp>/reviewonator` with byte-identical content. The marker must contain the `package.json` version.

- [ ] **Step 2: Run the tests and confirm they fail.**

Run `bunx vitest run tests/install/setup.test.ts tests/e2e/setup.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement** `embedded-skill.ts`, `prompt.ts`, `setup.ts` and the `setup` branch in `src/cli.ts`.

In `src/cli.ts`, `interactive` is `process.stdin.isTTY || env.REVIEWONATOR_INTERACTIVE === "1"`. Add these lines to `help`:
- `reviewonator setup [--targets claude,codex] [--comment-language L] [--reviewer-language L] [--reconfigure]`
- `reviewonator update [--force]`
- `reviewonator uninstall [--targets claude,codex]`

- [ ] **Step 4: Run the tests and confirm they pass.**

Run `bunx vitest run tests/install tests/e2e/setup.test.ts`. Expected: PASS.

- [ ] **Step 5: Commit** with the message "Add reviewonator setup with the embedded skill".

---

### Task 3: Install method, silent skill sync and v0.7 migration

**Files:**
- Create: `src/install/version.ts`, `src/install/install-method.ts`, `src/install/sync.ts`
- Modify: `src/cli.ts` (run sync before the review, `wait` and `respond` commands; add the hint to review-file parse errors)
- Test: `tests/install/version.test.ts`, `tests/install/install-method.test.ts`, `tests/install/sync.test.ts`, `tests/e2e/setup.test.ts` (add the guard test)

**Interfaces:**
- Consumes: Task 1, plus `SkillFile` from Task 2.
- Produces:
  - `compareVersions(left: string, right: string): -1 | 0 | 1`. Accepts only numeric `x.y.z` and throws otherwise.
  - `type InstallMethod = { kind: "homebrew" | "script" | "unmanaged"; executablePath: string }`
  - `detectInstallMethod(executablePath: string): Promise<InstallMethod>`. Applies `realpath`, then returns `homebrew` if the path contains `/Cellar/reviewonator/`, `script` if `<original path>.reviewonator-managed` or `<realpath>.reviewonator-managed` exists, and `unmanaged` otherwise.
  - `type SyncResult = { updated: Target[]; migrated: boolean; warnings: string[] }`
  - `syncSkills(context: { env: NodeJS.ProcessEnv; files: SkillFile[]; version: string }): Promise<SyncResult>`. It never throws; every failure becomes a warning.
  - `skillUpdateHint(result: SyncResult): string | null`. Returns `"The Reviewonator skill was just updated. Start /reviewonator again."` when `updated` is non-empty.

**Sync rules:**
- **The config is invalid:** add a warning with the error message and return.
- **The config is missing:** migrate. Collect targets whose default root has a managed skill and take the languages from the first one through `readInstalledLanguages`, falling back to English. Write the config and set `migrated: true`.
  - If no managed skill is found, add the warning `No Reviewonator skill was found. Run reviewonator setup, and pass --claude-skill-dir or --codex-skill-dir if your skill lives in a custom directory.` and return.
- **For each configured target:**
  - Absent directory: `writeSkill`.
  - Unmanaged directory: add a warning naming the directory and skip it.
  - Managed with version `null`, or `compareVersions(version, marker) > 0`: `writeSkill`.
  - Otherwise leave it alone. Sync never downgrades.
- **In the CLI:** sync runs only when `detectInstallMethod(process.execPath)` is not `unmanaged`. Warnings go to stderr, one line each. When parsing `--review-file` throws, the CLI appends `skillUpdateHint` on a new line if it is non-null.

- [ ] **Step 1: Write failing tests.**
  - `version.test.ts`:
    - `"compares numeric semantic versions"`: `("0.10.0","0.9.9")` is `1` and `("0.7.0","0.7.0")` is `0`.
    - `"rejects non-numeric versions"`
  - `install-method.test.ts`:
    - `"detects a Homebrew Cellar path through a symlink"`: create `<tmp>/Cellar/reviewonator/0.8.0/bin/reviewonator` and a symlink `<tmp>/bin/reviewonator`.
    - `"detects a script install by its binary marker"`
    - `"treats any other executable, including Bun, as unmanaged"`: pass `process.execPath`.
  - `sync.test.ts`:
    - `"upgrades a managed skill whose marker is older and keeps the configured languages"`
    - `"upgrades a legacy unversioned marker"`
    - `"never downgrades a newer marker"`
    - `"skips and warns about an unmanaged skill directory"` (Review Focus 3)
    - `"recreates a configured skill directory that was deleted"`
    - `"migrates a v0.7 install without a config"`: managed skill, no marker version, German/French language line. The config is written, `migrated` is `true` and the skill is upgraded.
    - `"warns once and continues when config.json is corrupt"` (Review Focus 2)
    - `"warns how to point setup at a custom directory when nothing is found"`
    - `"returns the restart hint only after an update"`
  - `tests/e2e/setup.test.ts`: `"a development run never syncs the installed skill"`. Set up a config and an outdated managed skill in temp dirs, run `bun src/cli.ts wait https://github.com/acme/widgets/pull/42` (it fails because there is no live session), and assert the skill files and marker are byte-identical.

- [ ] **Step 2: Run the tests and confirm they fail.**

Run `bunx vitest run tests/install tests/e2e/setup.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement** the three modules and the CLI wiring.

- [ ] **Step 4: Run the tests and confirm they pass.** Expected: PASS.

- [ ] **Step 5: Commit** with the message "Sync managed skills on start and migrate v0.7 installs".

---

### Task 4: `reviewonator uninstall` replaces `scripts/uninstall.sh`

**Files:**
- Create: `src/install/uninstall.ts`
- Modify: `src/cli.ts`
- Delete: `scripts/uninstall.sh`
- Test: `tests/install/uninstall.test.ts`, `tests/scripts/installation.test.ts` (drop its uninstall cases)

**Interfaces:**
- Consumes: Tasks 1 and 3.
- Produces: `runUninstall(options: { targets?: string }, context: { env: NodeJS.ProcessEnv; installMethod: InstallMethod; log: (line: string) => void }): Promise<void>`.

**Rules:**
- Targets come from `options.targets`, else `REVIEWONATOR_TARGETS`, else the config targets, else every target with a managed skill in its default root.
- Each selected skill goes through `removeSkill`, with these logs: `Removed <label> skill: <dir>` or `Kept unmanaged skill: <dir>`.
- The removed targets are taken out of the config. When none are left, the config is removed.
- **No managed skills left:**
  - `script`: remove `executablePath` and its marker, and log `Removed Reviewonator executable: <path>`.
  - `homebrew`: log `Run brew uninstall reviewonator to remove the executable.`
  - `unmanaged`: nothing more.
- **Some managed skills remain:** log `Kept Reviewonator executable because another installed integration still uses it.`

- [ ] **Step 1: Write failing tests.**
  - `"removes the selected managed skill and keeps the executable while another integration remains"`
  - `"removes the script-installed executable and marker after the last integration"`
  - `"tells Homebrew users to run brew uninstall"`
  - `"keeps unmanaged skills"`
  - `"removes the config after the last integration"`

- [ ] **Step 2: Run the tests and confirm they fail.**

Run `bunx vitest run tests/install/uninstall.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement it, wire up `uninstall` in the CLI and delete `scripts/uninstall.sh`.**

- [ ] **Step 4: Run the tests and confirm they pass.**

Run `bunx vitest run tests/install tests/scripts`. Expected: PASS.

- [ ] **Step 5: Commit** with the message "Replace uninstall.sh with reviewonator uninstall".

---

### Task 5: Thin bootstrap `scripts/install.sh`

**Files:**
- Rewrite: `scripts/install.sh`
- Rewrite: `tests/scripts/installation.test.ts` (keep the `release packaging` describe block)

**Behavior, in order:**
1. **Own options:** `--bin-dir DIR` (default `REVIEWONATOR_BIN_DIR` or `~/.local/bin`), `--force`, `--local` and `--help`. Every other argument is forwarded verbatim to `reviewonator setup`, including values with spaces.
2. **Prerequisites:** if `gh` is missing, warn `GitHub CLI is required to use Reviewonator. Install it from https://cli.github.com/` and continue.
3. **Homebrew conflict:** if `brew` exists and `command -v reviewonator` is under `$(brew --prefix)/`, exit 1 with `Reviewonator is installed with Homebrew. Run brew upgrade reviewonator instead.`
4. **Payload source:**
   - With `--local`: `dist/reviewonator` resolved from `$0`. This is only valid when run as a file.
   - Otherwise download into `mktemp -d`. Use `curl -fsSL -o FILE URL` if curl exists, else `wget -qO FILE URL`, else exit 1 with `curl or wget is required to install Reviewonator.`
   - Fetch `$REVIEWONATOR_DOWNLOAD_URL/reviewonator-<platform>.tar.gz` and its `.sha256`, verify with `shasum -a 256` or `sha256sum`, and exit 1 with `Checksum verification failed for <archive>.` on a mismatch. Then extract.
5. **Versions:** `new=$(payload --version)` and `installed=$(BIN_PATH --version)` if the binary is managed.
   - If `BIN_PATH` exists without a marker: exit 1 with `Refusing to replace unmanaged executable: <path>`.
   - If the installed version is newer and there is no `--force`: print today's "keeping it" message and run setup.
   - If they are equal and there is no `--force`: print `Reviewonator <v> is already up to date.` and run setup.
   - Otherwise install the binary with `install -m 755` plus the marker, and print `Installing Reviewonator <v>…` or `Updating Reviewonator <old> to <new>…`.
6. Run `"$BIN_PATH" setup <forwarded args>`, then print today's PATH hint if `BIN_DIR` is not on `PATH`.

Under `sh -c "$(…)"`, `$0` is `sh`. Nothing except `--local` may depend on `$0`.

- [ ] **Step 1: Write failing tests.**

The fixture builds a real release directory with `scripts/package-release.sh <platform> <stub> <dir>`. The stub binary is a shell script that answers `--version` with `Reviewonator <v>` and on `setup` appends its arguments to `$REVIEWONATOR_TEST_SETUP_LOG`. Point `REVIEWONATOR_DOWNLOAD_URL` at `file://<dir>`, so the real curl is used.

Tests:
- `"installs from the release under sh -c and forwards setup arguments"`. Run `sh -c "$(cat scripts/install.sh)" "" --bin-dir B --targets claude --comment-language "Brazilian Portuguese"`. The binary and marker exist, and the setup log equals `setup --targets claude --comment-language Brazilian Portuguese` with the value kept as one argument.
- `"downloads with wget when curl is unavailable"`. Use a PATH dir of symlinked core tools plus a fake `wget` that copies from the release dir.
- `"fails clearly when neither curl nor wget exists"`
- `"aborts on a checksum mismatch without installing"`
- `"refuses to replace an unmanaged executable"`
- `"reports an up-to-date install and still runs setup"`
- `"does not downgrade a newer managed version without --force"`
- `"refuses when Reviewonator is installed with Homebrew"`. Use a fake `brew` that prints a prefix, and a fake `reviewonator` under `<prefix>/bin` on PATH.
- `"installs the local build with --local"`

- [ ] **Step 2: Run the tests and confirm they fail.**

Run `bunx vitest run tests/scripts/installation.test.ts`. Expected: FAIL.

- [ ] **Step 3: Rewrite `scripts/install.sh`** as POSIX sh with `set -eu` and a cleanup trap for the temp dir.

- [ ] **Step 4: Run the tests and confirm they pass.** Expected: PASS.

- [ ] **Step 5: Commit** with the message "Turn install.sh into a curl/wget bootstrap".

---

### Task 6: `reviewonator update`

**Files:**
- Create: `src/update/releases.ts`, `src/update/self-update.ts`
- Modify: `src/server/live-state.ts` (add `findActiveLiveSession`), `src/cli.ts`
- Test: `tests/update/releases.test.ts`, `tests/update/self-update.test.ts` (`// @vitest-environment node`), `tests/server/live-state.test.ts`

**Interfaces:**
- Consumes: `InstallMethod` and `compareVersions` (Task 3), `CommandRunner`.
- Produces:
  - `REPOSITORY = "johniak/reviewonator"`
  - `interface ReleaseSource { latestVersion(): Promise<string>; download(version: string, assets: string[], directory: string): Promise<void> }`
  - `class GhReleaseSource implements ReleaseSource { constructor(runner: CommandRunner) }`
    - `latestVersion` runs `gh api repos/johniak/reviewonator/releases/latest --jq .tag_name`, then strips `v` and validates `x.y.z`.
    - `download` runs `gh release download v<version> --repo johniak/reviewonator --pattern <a> --pattern <b> --dir <directory> --clobber`.
  - `platformName(platform?: NodeJS.Platform, arch?: string): string` returns one of the four platform names and throws `Unsupported platform: …` otherwise.
  - `releaseUrl(version: string): string`
  - `findActiveLiveSession(env?: NodeJS.ProcessEnv): Promise<LiveSessionState | null>`. Considers only files matching `/^[0-9a-f]{24}\.json$/` in `liveStateDirectory(env)`, skips states with a `result`, and returns the first whose `/health` answers within 1000 ms.
  - `runUpdate(options: { force: boolean }, context: { installMethod: InstallMethod; runner: CommandRunner; releases: ReleaseSource; version: string; env: NodeJS.ProcessEnv; log: (line: string) => void; platform?: string }): Promise<void>`

**Rules for `runUpdate`:**
- **`unmanaged`:** throw `Reviewonator can only update installations made with Homebrew or the install script.`
- **An active live session and no `force`:** throw `Finish the open live review for <prUrl> before updating, or pass --force.`
- **`homebrew`:** run `brew upgrade reviewonator`; a non-zero exit throws with stderr. Log stdout. Then run `brew --prefix reviewonator` and `<prefix>/bin/reviewonator setup`, and log that output.
- **`script`:**
  1. `latest = releases.latestVersion()`.
  2. Equal versions and no `force`: log `Reviewonator <v> is already up to date.` Current is newer and no `force`: log `Installed Reviewonator <cur> is newer than the latest release <latest>; keeping it.`
  3. Download `reviewonator-<platform>.tar.gz` and `.sha256` into `mkdtemp`.
  4. Verify SHA-256 with `node:crypto`. On a mismatch, throw `Checksum verification failed for <archive>.`
  5. Extract with `runner.run("tar", ["-xzf", archive, "-C", dir])`.
  6. Copy to `<dirname(executablePath)>/.reviewonator-update-<pid>`, `chmod 755`, and `rename` over `executablePath`.
  7. Run `<executablePath> setup` and log `Updated Reviewonator <cur> to <latest>.`
  8. In a `finally` block, remove the temp dir and any staged file.
- **After a successful update, either method:** if the first `reviewonator` on `env.PATH` resolves (`realpath`) to a different file than `executablePath`, log `Another reviewonator at <path> comes first on PATH.`
- **CLI:** `update` builds `GhReleaseSource(new BunCommandRunner())` and `detectInstallMethod(process.execPath)`.

- [ ] **Step 1: Write failing tests.**

`self-update.test.ts` uses a real `node:child_process` `CommandRunner` helper and a `ReleaseSource` whose `download` copies a fixture tarball built with real `tar` around a stub binary. That stub records `setup` calls.

- `releases.test.ts`:
  - `"reads the latest tag through gh api"` (RecordingRunner, as in `tests/github/client.test.ts`)
  - `"downloads release assets through gh release download"`
  - `"maps supported platforms and rejects others"`
- `live-state.test.ts`: `"finds an active live session and ignores finished, unreachable and non-session files"`. Put an `update-check.json` in the same dir.
- `self-update.test.ts`:
  - `"replaces a script-installed binary and runs setup with the new binary"`
  - `"reports an up-to-date install without downloading"`
  - `"keeps a newer local version unless forced"`
  - `"aborts on a checksum mismatch and leaves the old binary and no staged file"` (Review Focus 5)
  - `"fails clearly when the binary directory is not writable"` (Review Focus 1). `chmod 0o555` on the directory; skip when running as root.
  - `"delegates to brew upgrade and runs setup from the Homebrew prefix"`. Use a fake `brew` script on PATH, with the real runner.
  - `"refuses an unmanaged executable"`
  - `"refuses during an active live session unless forced"`. Use a real `node:http` server answering `/health`.
  - `"warns when another reviewonator comes first on PATH"`

- [ ] **Step 2: Run the tests and confirm they fail.**

Run `bunx vitest run tests/update tests/server/live-state.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement** the modules and the `update` command.

- [ ] **Step 4: Run the tests and confirm they pass.** Expected: PASS.

- [ ] **Step 5: Commit** with the message "Add reviewonator update for Homebrew and script installs".

---

### Task 7: Background update check and API routes

**Files:**
- Create: `src/domain/update.ts`, `src/update/update-check.ts`
- Modify: `src/server/app.ts`, `src/cli.ts`, `tests/e2e/cli.test.ts` (add `REVIEWONATOR_NO_UPDATE_CHECK: "1"` and a temp `REVIEWONATOR_STATE_DIR` to the spawned env)
- Test: `tests/update/update-check.test.ts`, `tests/server/app.test.ts`

**Interfaces:**
- Consumes: `ReleaseSource` and `releaseUrl` (Task 6), `compareVersions` (Task 3), `liveStateDirectory`.
- Produces:
  - `type UpdateNotice = { current: string; latest: string; releaseUrl: string }` in `src/domain/update.ts`.
  - `class UpdateChecker` in `src/update/update-check.ts`:
    - `constructor(context: { version: string; env: NodeJS.ProcessEnv; releases: Pick<ReleaseSource, "latestVersion">; now?: () => Date; timeoutMs?: number })`
    - `start(): void`
    - `notice(waitMs?: number): Promise<UpdateNotice | null>`, defaulting to 3000.
    - `dismiss(version: string): Promise<void>`
  - `createApp` deps gain `updates?: { notice(): Promise<UpdateNotice | null>; dismiss(version: string): Promise<void> }`.
  - Routes behind the bearer middleware:
    - `GET /api/update-notice` returns `{ notice: UpdateNotice | null }`. It returns `{ notice: null }` when `updates` is absent.
    - `POST /api/update-notice/dismiss` takes the body `{ version: string }` (zod, 400 on invalid) and returns `{ status: "dismissed" }`.

**Rules:**
- **Opt-out** (`REVIEWONATOR_NO_UPDATE_CHECK=1`): `start` and `notice` do nothing and resolve `null`.
- **Cache:** `update-check.json` with `{ checkedAt, latestVersion, dismissedVersion? }`. A missing, corrupt or older-than-24-h cache counts as stale.
- **Stale cache:** fetch `latestVersion()` with a `timeoutMs` race (default 5000), then write the cache.
- **Errors:** swallowed silently, never written to stderr.
- **`notice`:** waits for the in-flight check up to `waitMs`. It returns a notice only when `latest > current` and `latest !== dismissedVersion`.
- **CLI:** for the review command only, create the checker with `new GhReleaseSource(runner)`, call `start()` before `verifyPrerequisites()` and pass it to `createApp`.

- [ ] **Step 1: Write failing tests.**
  - `update-check.test.ts`:
    - `"uses a fresh cache without asking for the latest release"`
    - `"refreshes a stale cache and returns a notice for a newer version"`. The notice is `{ current:"0.7.0", latest:"0.8.0", releaseUrl:"https://github.com/johniak/reviewonator/releases/tag/v0.8.0" }`.
    - `"returns null when the latest version is not newer"`
    - `"hides a dismissed version but shows a newer one"`
    - `"stays silent when the release lookup fails"` (Review Focus 4). Assert no stderr write by spying on `process.stderr.write`.
    - `"does not wait longer than the cap for a slow lookup"`. `notice(50)` resolves `null` in under 500 ms while `latestVersion` never resolves.
    - `"does nothing when REVIEWONATOR_NO_UPDATE_CHECK is set"`
    - `"treats a corrupt cache as stale"`
  - `app.test.ts`:
    - `"requires the session token for the update notice"`
    - `"returns the update notice and records a dismissal"`
    - `"rejects a dismissal without a version"`
    - `"returns no notice when no checker is configured"`

- [ ] **Step 2: Run the tests and confirm they fail.**

Run `bunx vitest run tests/update/update-check.test.ts tests/server/app.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement** the modules and routes and wire up the CLI.

- [ ] **Step 4: Run the tests and confirm they pass.**

Run `bunx vitest run tests/update tests/server tests/e2e`. Expected: PASS.

- [ ] **Step 5: Commit** with the message "Check for new releases in the background and expose an update notice".

---

### Task 8: Update notice in the web UI

**Files:**
- Create: `web/components/UpdateNotice.tsx`
- Modify: `web/api.ts`, `web/App.tsx`, `web/styles.css`
- Test: `tests/web/UpdateNotice.test.tsx`, `tests/web/App.test.ts`

**Interfaces:**
- Consumes: `UpdateNotice` from `src/domain/update.ts`, and the routes from Task 7.
- Produces:
  - `api.loadUpdateNotice(): Promise<{ notice: UpdateNotice | null }>`
  - `api.dismissUpdateNotice(version: string): Promise<{ status: string }>`
  - `UpdateNoticeToast({ notice, onDismiss }: { notice: UpdateNotice; onDismiss: () => void })`

**UI:**
- A custom component; no toast library, since there is only one notice.
- A fixed panel at the bottom right with `role="status"`. Text: `Reviewonator {latest} is available — you have {current}.`
- A `<code>reviewonator update</code>` with a button labelled `Copy` (`aria-label="Copy update command"`). It calls `navigator.clipboard.writeText("reviewonator update")` and shows `Copied` for 2 s.
- A `Release notes` link to `releaseUrl` with `target="_blank" rel="noreferrer"`, and a dismiss icon button with `aria-label="Dismiss update notice"`.
- `App` calls `api.loadUpdateNotice()` once after the session loads and ignores errors. Dismissing hides the notice immediately and calls `api.dismissUpdateNotice(latest)`, ignoring errors.
- Style class `.update-notice`:
  - surface `--pc-bg-elevated`, 1 px `--pc-border` border, copper accent for the command chip;
  - the light floating-panel shadow from the design language;
  - text ≥ 12px;
  - it must not cover the publish actions at a 1280×800 viewport.

- [ ] **Step 1: Write failing tests.**
  - `UpdateNotice.test.tsx`:
    - `"announces the available version and links the release notes"`
    - `"copies the update command"`. Stub `navigator.clipboard.writeText` with `vi.stubGlobal` or `Object.defineProperty`, and assert it is called with `"reviewonator update"` and that `Copied` appears.
    - `"calls onDismiss from the dismiss button"`
  - `App.test.ts`: `"shows the update notice from the server and dismisses it"`. Follow the existing pattern that serves `createApp` through a stubbed `fetch`, and pass `updates` with a fixed notice plus a recorded `dismiss`.

- [ ] **Step 2: Run the tests and confirm they fail.**

Run `bunx vitest run tests/web/UpdateNotice.test.tsx tests/web/App.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement** the component, the API methods, the App wiring and the CSS.

- [ ] **Step 4: Run the tests and confirm they pass.** Expected: PASS.

- [ ] **Step 5: Check it visually.** Run `bun run build:web`, then open the built `web-dist/index.html` through a dev session (`bun run dev` needs a real `gh`; otherwise check in the browser companion) in light and dark themes.

- [ ] **Step 6: Commit** with the message "Show an update notice in the workspace".

---

### Task 9: Homebrew formula and release workflow

**Files:**
- Create: `scripts/render-formula.ts`
- Modify: `.github/workflows/release.yml`
- Test: `tests/scripts/render-formula.test.ts` (`// @vitest-environment node`)

**Interfaces:**
- Produces: `renderFormula(input: { version: string; checksums: Record<"darwin-arm64" | "darwin-x64" | "linux-arm64" | "linux-x64", string> }): string`. When `import.meta.main` is set, it reads `<version> <checksumDir>`, takes the first token of each `reviewonator-<platform>.tar.gz.sha256` and prints the formula to stdout. It throws on a missing file or a checksum that is not 64 hex characters.

**Exact formula output** (`URL` is `https://github.com/johniak/reviewonator/releases/download/v#{version}/reviewonator-<platform>.tar.gz`, written with the literal version):

```ruby
class Reviewonator < Formula
  desc "Local human-in-the-loop interface for AI-generated GitHub pull request reviews"
  homepage "https://github.com/johniak/reviewonator"
  version "<version>"
  license "MIT"

  on_macos do
    on_arm do
      url "<URL darwin-arm64>"
      sha256 "<sha>"
    end
    on_intel do
      url "<URL darwin-x64>"
      sha256 "<sha>"
    end
  end

  on_linux do
    on_arm do
      url "<URL linux-arm64>"
      sha256 "<sha>"
    end
    on_intel do
      url "<URL linux-x64>"
      sha256 "<sha>"
    end
  end

  depends_on "gh"

  def install
    bin.install "reviewonator"
  end

  def caveats
    <<~EOS
      Run `reviewonator setup` to install the Reviewonator skill for Claude Code or Codex.
    EOS
  end

  test do
    assert_match "Reviewonator #{version}", shell_output("#{bin}/reviewonator --version")
  end
end
```

**Workflow changes:**
- In the `release` job, append `scripts/install.sh` to the `gh release create` asset list, so it is published as `install.sh`.
- New job `homebrew` (`needs: release`, `ubuntu-latest`, `contents: read`):
  1. Fail with `HOMEBREW_TAP_TOKEN secret is required.` if `secrets.HOMEBREW_TAP_TOKEN` is empty.
  2. Check out the repo, then set up Bun 1.3.13.
  3. Run `gh release download "$GITHUB_REF_NAME" --pattern '*.sha256' --dir checksums`.
  4. Run `bun scripts/render-formula.ts "${GITHUB_REF_NAME#v}" checksums > reviewonator.rb`.
  5. `actions/checkout@v7` with `repository: johniak/homebrew-tap`, `token: ${{ secrets.HOMEBREW_TAP_TOKEN }}`, `path: tap`.
  6. Copy to `tap/Formula/reviewonator.rb`, then commit `reviewonator ${GITHUB_REF_NAME}` and push.

- [ ] **Step 1: Write failing tests.**
  - `"renders a formula with every platform URL and checksum"`. It contains `https://github.com/johniak/reviewonator/releases/download/v0.8.0/reviewonator-darwin-arm64.tar.gz` and its checksum, and the same for all four platforms.
  - `"declares the gh dependency, binary install, setup caveat and version test"`
  - `"rejects a missing or malformed checksum"`
  - `"produces valid Ruby syntax"`. Write the output to a temp file and run `ruby -c`; skip when `ruby` is not on PATH.
  - `"reads checksums from a release directory"`. Spawn `bun scripts/render-formula.ts 0.8.0 <dir>`.

- [ ] **Step 2: Run the tests and confirm they fail.**

Run `bunx vitest run tests/scripts/render-formula.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement** the renderer and the workflow changes.

- [ ] **Step 4: Run the tests and confirm they pass.** Expected: PASS. Also check that the workflow YAML parses: `bun -e 'Bun.YAML.parse(await Bun.file(".github/workflows/release.yml").text())'` succeeds, or use another available YAML parser.

- [ ] **Step 5: Commit** with the message "Publish install.sh and a Homebrew formula from the release workflow".

---

### Task 10: Documentation

**Files:**
- Modify: `README.md` (Install, Update and uninstall), `docs/features.md` (the installer paragraph at line 70), `CLAUDE.md` (Commands, Architecture, Release), `tests/docs/documentation.test.ts`

**README content to pin:**
- `### Homebrew` with `brew install johniak/tap/reviewonator` followed by `reviewonator setup`.
- `### Install script` with:
  - `sh -c "$(curl -fsSL https://github.com/johniak/reviewonator/releases/latest/download/install.sh)"`
  - `sh -c "$(wget -qO- https://github.com/johniak/reviewonator/releases/latest/download/install.sh)"`
  - the non-interactive example `sh -c "$(curl -fsSL …)" "" --targets claude,codex`.
- The sentence `Updates never ask for your targets or languages again.`
- `## Update and uninstall` with `reviewonator update`, `reviewonator setup --reconfigure` and `reviewonator uninstall`.
- `From a source checkout: bun install --frozen-lockfile && bun run build && ./scripts/install.sh --local`.
- `REVIEWONATOR_NO_UPDATE_CHECK=1` disables the update notice.

**CLAUDE.md:**
- Add `src/install/` and `src/update/` to the architecture list.
- Release section: the tag also updates `johniak/homebrew-tap` and needs the `HOMEBREW_TAP_TOKEN` secret, and `install.sh` is published as a release asset.

- [ ] **Step 1: Write failing assertions** in `tests/docs/documentation.test.ts`: `"documents Homebrew, the install script, update and uninstall"`, asserting each pinned line above.

- [ ] **Step 2: Run the test and confirm it fails.**

Run `bunx vitest run tests/docs`. Expected: FAIL.

- [ ] **Step 3: Update the docs.**

- [ ] **Step 4: Run the full check.**

Run `bun run check`. Expected: typecheck, all tests and the build pass.

- [ ] **Step 5: Smoke-test the compiled binary.**
  - Run `REVIEWONATOR_CONFIG_DIR=<tmp> REVIEWONATOR_CLAUDE_SKILL_DIR=<tmp>/skills ./dist/reviewonator setup --targets claude --comment-language English --reviewer-language English`, then `./dist/reviewonator --help`. Expected: the skill is installed and help lists `setup`, `update` and `uninstall`.
  - Then a migration dry run on a copy of the owner's real v0.7 skill:
    1. Copy `~/.claude/skills/reviewonator` to `<tmp>/skills/reviewonator`.
    2. Copy `dist/reviewonator` to `<tmp>/bin/reviewonator` and create `<tmp>/bin/reviewonator.reviewonator-managed`, so it counts as a script install and sync runs.
    3. Run `<tmp>/bin/reviewonator wait https://github.com/acme/widgets/pull/42` with `REVIEWONATOR_CLAUDE_SKILL_DIR=<tmp>/skills`, `REVIEWONATOR_CODEX_SKILL_DIR=<tmp>/codex`, a temp `REVIEWONATOR_CONFIG_DIR` and `REVIEWONATOR_STATE_DIR`.

    Expected: the config is derived with the existing languages and the skill marker becomes versioned. Do not touch the real `~/.claude`.

- [ ] **Step 6: Commit** with the message "Document Homebrew, the install script and reviewonator update".

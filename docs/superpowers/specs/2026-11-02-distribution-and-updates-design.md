# Distribution and updates — design

Status: draft for approval. Branch: `distribution-and-updates` (cut from `paper-copper-design`, because the update notice must use the Paper Copper tokens that are not on `main` yet).

## Intent

Today Reviewonator is installed by cloning the repository and running `./scripts/install.sh`, which needs an authenticated `gh` just to download a release. The owner wants Reviewonator to install and update like a normal developer tool:

1. `brew install` through a Homebrew tap.
2. A one-line `curl`/`wget` installer, in the style of oh-my-zsh, with no clone.
3. `reviewonator update` to move to the latest release.
4. A notice in the web UI when a newer version exists.

## Goals

- A new user installs with one command (brew or the one-liner), then answers the existing questions once: Claude Code / Codex and the two languages.
- Updating never asks those questions again. The installed skills are refreshed automatically and keep the user's targets and languages.
- A user who opens the review page while running an old version sees a short, dismissible notice with the command to update.
- The installed skill version always matches the binary version.

## Non-goals

- homebrew-core. It requires notability (75 stars, 30 forks or 30 watchers per `brew audit --new`), discourages self-submission and wants source builds. Revisit later.
- FreeBSD and `fetch`. No FreeBSD binary is built, so the installer supports only `curl` and `wget`.
- Windows.
- Pinning or installing a specific older version from the one-liner.
- Update notices outside the web UI, such as stderr lines or agent messages.

## Anti-goals

These would make the work a failure even if every command works:

- Any installer or update path that picks Claude Code or Codex without the user choosing. The existing rule "the installer never guesses" stays.
- Re-asking languages or targets on every update.
- A startup that is slower, or fails, because GitHub is slow or offline.
- The browser page calling anything outside `127.0.0.1`.
- Overwriting or deleting files Reviewonator does not manage.
- A new binary running against an old skill without noticing.

## Constraints

- Safety invariants in `CLAUDE.md` stay intact. Version checks and self-update downloads inside the binary go through `gh` over `CommandRunner`. Only the bootstrap shell script uses `curl`/`wget`, because it runs before Reviewonator exists and must not need `gh`.
- Homebrew cannot write to `$HOME`: formula code is sandboxed on macOS, and `brew upgrade` never runs our code. Everything that touches `~/.claude/skills`, `~/.agents/skills` or the config must therefore be done by the binary itself.
- The random server port means a new browser origin on every run, so `localStorage` does not survive between runs. Anything that must be remembered across runs, such as notice dismissal, lives server-side.
- Platforms stay `darwin-arm64`, `darwin-x64`, `linux-arm64`, `linux-x64`.
- AGENTS.md testing rules apply: real behavior, real file systems in temp dirs, fake `gh`/`curl` executables on `PATH` rather than in-process mocks.
- `tests/docs/` and `tests/skills/` assert literal sentences. The README install/update sections will be rewritten, and those tests are updated, not weakened.

## Design

### 1. The binary owns skill installation (foundation)

- The files under `skills/reviewonator/` are embedded in the binary, the same way `web-dist/index.txt` and `web/favicon.svg` are today. A test asserts that the embedded set equals the directory contents, so a new skill file cannot be forgotten.
- New command `reviewonator setup`:
  - Asks the same questions as today's `install.sh`: a multi-select of targets, the comment language and the reviewer-note language, both defaulting to English. It accepts the same flags and environment variables: `--targets`, `--comment-language`, `--reviewer-language`, `--claude-skill-dir`, `--codex-skill-dir`, `REVIEWONATOR_TARGETS`, `REVIEWONATOR_COMMENT_LANGUAGE`, `REVIEWONATOR_REVIEWER_LANGUAGE`, `REVIEWONATOR_INTERACTIVE`.
  - Writes the answers to a config file. **(My call)** The file is `$XDG_CONFIG_HOME/reviewonator/config.json`, defaulting to `~/.config/reviewonator/config.json`, overridable with `REVIEWONATOR_CONFIG_DIR`. It holds the targets, the skill directory for each target and both languages.
  - Writes the skill for each selected target and rewrites the `Review language configuration:` line exactly as `install.sh` does today.
  - Writes `.reviewonator-managed`, which now records the binary version.
  - When a config already exists and no flags are given, it does not ask anything and only re-syncs. `setup --reconfigure` asks again, with the current values as defaults.
  - Without a TTY and without a config, it requires `--targets` and never guesses.
  - It refuses to overwrite an unmanaged skill directory, as today.
- **Skill sync**: at the start of every command except `--help` and `--version`, the binary compares each configured target's marker version with its own version.
  - It rewrites the skill from the embedded copy only when the binary is newer than the marker, or the marker has no version. It keeps the languages from the config. **(My call)** It never downgrades, so an older brew or script copy cannot fight a newer one.
  - Sync runs only when the install method (section 3) is Homebrew or script. Dev runs through `bun src/cli.ts` never touch the real skills. **(My call)**
  - A failed sync prints one warning on stderr and never blocks a review.
  - This is how `brew upgrade` users get new skills, because brew cannot run our code.
  - **Accepted limitation (my call):** the session in which an agent first runs the new binary already has the old SKILL.md loaded. The new skill takes effect from the next `/reviewonator` invocation. If the review file then fails validation and sync rewrote the skill during this run, the error adds one line: the skill was just updated, start `/reviewonator` again. There is no protocol handshake.
- **Migration from v0.7 installs**: the old marker has no version and there is no config. If managed skills exist but no config does, the binary derives the config from them silently: targets from where managed skills exist, languages from the `Review language configuration:` line. Then it syncs.
  - Discovery looks only at the default directories and the `REVIEWONATOR_*_SKILL_DIR` variables. If the old binary marker exists but no managed skill is found, it prints one note explaining how to point `setup` at a custom skill directory. **(My call)**
  - The owner's own `~/.local/bin` install (unversioned marker, no config) is a real migration case. Test it manually before release.
- New command `reviewonator uninstall [--targets …]`:
  - Removes the managed skills and, when none are left, the config.
  - For a script install, it also removes the binary and its marker.
  - For a Homebrew install, it removes the skills and tells the user to run `brew uninstall reviewonator`.
  - It replaces `scripts/uninstall.sh` **(my call)**, because one-liner users have no checkout to run a script from.

### 2. One-line installer

- `scripts/install.sh` becomes a thin POSIX bootstrap and is uploaded as a release asset named `install.sh`. **(My call)** Serving it from the release keeps the script and the binary from the same release; `raw/main` could drift ahead of the latest release. Documented commands:

  ```sh
  sh -c "$(curl -fsSL https://github.com/johniak/reviewonator/releases/latest/download/install.sh)"
  sh -c "$(wget -qO- https://github.com/johniak/reviewonator/releases/latest/download/install.sh)"
  ```

  The `sh -c "$(…)"` form keeps stdin attached to the terminal, so the setup questions work. Arguments are passed as `sh -c "$(curl …)" "" --targets claude`.
- What the script does, in order:
  1. Pick `curl` or `wget`, or fail with a clear message if neither exists.
  2. Detect the platform.
  3. Download `reviewonator-<platform>.tar.gz` and its `.sha256` from `https://github.com/johniak/reviewonator/releases/latest/download/`. The base URL can be overridden with `REVIEWONATOR_DOWNLOAD_URL` for tests.
  4. Verify the checksum with `shasum -a 256` or `sha256sum`.
  5. Install the binary with its marker into `--bin-dir`, defaulting to `~/.local/bin`.
  6. Exec `reviewonator setup`, forwarding the remaining arguments.
- The repository is hard-coded as `johniak/reviewonator`. Under `sh -c`, `$0` is `sh`, so today's detection from the checkout's git remote cannot work.
- A missing `gh` is a warning, not a failure. `gh` is still required to use Reviewonator.
- If `reviewonator` on `PATH` resolves into a Homebrew Cellar, the script refuses and points to `brew upgrade`.
- Behavior kept from today's script:
  - It refuses to replace an unmanaged binary.
  - It says "already up to date" when the version matches, and still runs `setup` so skills sync.
  - It refuses to downgrade without `--force`.
  - `--local` installs `dist/reviewonator` from a checkout, for the development loop in `CLAUDE.md`.
- The release tarball keeps its `reviewonator-skill/` directory, so old checkouts running the old `install.sh` can still update.

### 3. `reviewonator update`

- **Install method detection**, from `realpath(process.execPath)`:
  - **Homebrew**: the path is under `/Cellar/reviewonator/`.
  - **Script**: a sibling `reviewonator.reviewonator-managed` marker exists.
  - **Unmanaged**: anything else, including a dev run through `bun src/cli.ts`, where `execPath` is Bun itself. `update` then refuses with an explanation. It must never touch the Bun executable.
- **Homebrew**: run `brew upgrade reviewonator` with inherited stdio, then run the new binary at `$(brew --prefix)/opt/reviewonator/bin/reviewonator setup` so the skills sync right away.
- **Script**:
  1. Get the latest tag with `gh api repos/johniak/reviewonator/releases/latest`.
  2. Stop with "already up to date" when it is not newer.
  3. Download the platform tarball and checksum with `gh release download`.
  4. Verify the checksum and extract into a temp directory.
  5. Write the new binary next to the old one, then `rename` it over the old one. This is atomic and safe while the old binary is running.
  6. Run the new binary's `setup` to sync the skills.
- If another `reviewonator` appears earlier on `PATH` than the one being updated, print a warning.
- While a live session is active (a live-state file whose server answers `/health`), `update` refuses and asks the user to finish the review first. `--force` overrides this. **(My call)** This keeps the agent's `wait`/`respond` from talking to an old server with a new binary.
- Install method detection is shared by `update`, skill sync (section 1) and the update notice.
- The update logic is a module that takes the executable path, a `CommandRunner` and the config. It is tested on temp files, never on `process.execPath`.

### 4. Homebrew tap

- New public repository `johniak/homebrew-tap` with `Formula/reviewonator.rb`. Users run `brew install johniak/tap/reviewonator`.
- The formula has URL and `sha256` blocks for `on_macos`/`on_linux` × `on_arm`/`on_intel`, built from the existing release assets.
  - It runs `bin.install "reviewonator"`.
  - `depends_on "gh"` **(my call)** gives brew users `gh` automatically.
  - `caveats` say to run `reviewonator setup`.
  - `test do` checks `reviewonator --version`.
- `scripts/render-formula.ts` takes the version and the downloaded `.sha256` files and prints the formula. It is unit-tested.
- A new `homebrew` job in `release.yml`, after `release`, renders the formula and pushes it to the tap using the secret `HOMEBREW_TAP_TOKEN`, a fine-grained PAT with contents write on the tap repo. The default `GITHUB_TOKEN` cannot push to another repository. The job fails loudly if the secret is missing.
- `release.yml` also uploads `scripts/install.sh` as the `install.sh` asset.
- **One-time manual steps for the owner:** create `johniak/homebrew-tap`, create the PAT, add the secret.
- **Risk, checked first (step 0 of the plan):** Homebrew applies Mach-O fixups and ad-hoc re-signing to installed binaries, and Bun-compiled executables carry an appended bundle. Before building the release job, install a hand-written formula from a test tap on Apple Silicon and confirm the binary starts. If it breaks, fall back to a Cask in the same tap for macOS and report back before continuing.

### 5. Update notice in the UI

- **Check, in the CLI process, only for the review command (not `wait`/`respond`):**
  - A cached result younger than 24 hours is used directly.
  - Otherwise the CLI runs `gh api repos/johniak/reviewonator/releases/latest` in the background with a short timeout. It never delays opening the page.
  - The cache lives in the existing state directory (`liveStateDirectory()`), for example `update-check.json` holding `checkedAt`, `latestVersion` and `dismissedVersion`.
  - Errors and offline runs are silent.
  - `REVIEWONATOR_NO_UPDATE_CHECK=1` disables the check **(my call)**.
- **Exposure:** a new authenticated `GET /api/update-notice` returns `{ current, latest, releaseUrl }`, or `null` when there is no newer version, it was dismissed, or the check is off. If the check is still running, the route waits for it, capped at about 3 seconds. The page calls it once after load. **(My call)** This works the same in one-shot and live mode. The SSE stream is subscribed only in live mode (`web/App.tsx`), so it cannot carry the notice.
- **UI:** a non-modal, dismissible notice that reads roughly "Reviewonator 0.8.0 is available — you have 0.7.0".
  - It shows the command `reviewonator update` with a copy button. That one command works for brew and script installs, because `update` delegates to brew.
  - It links to the release notes.
  - Dismissing it calls a new authenticated `POST /api/update-notice/dismiss` with the version. The server stores `dismissedVersion`, and the notice stays hidden for that version on later runs.
  - It follows `docs/paper-copper-design-language.md`: copper accent, no shadow on resting surfaces, nothing under 12px.
  - Whether to use a toast library (Sonner) or a small component is left to the builder.

## Left to the builder

- Module layout for setup, sync, update and the update check. They must stay unit-testable with temp directories and an injected `CommandRunner`.
- How the skill files are embedded: per-file text imports or a generated module.
- How prompts are read in TypeScript, as long as the existing interactive tests can drive them through stdin with `REVIEWONATOR_INTERACTIVE=1`.
- Exact wording of messages and of the README and `docs/features.md` sections, in English.
- Toast library versus custom component.
- Order of work, except that step 0 is the Homebrew risk check and section 1 comes before sections 2, 3 and 5.

## Testing

- **Setup, sync, migration, uninstall:** TypeScript tests on temp directories, covering first install, re-run without prompts, `--reconfigure`, the v0.7 migration, unmanaged-directory refusal and the target rules.
- **Update:** module tests with a fake `gh` that serves fixture tarballs built by `scripts/package-release.sh` around a stub binary. Cover the brew, script and unmanaged paths. Add a guard test that the dev path never resolves to Bun's executable.
- **Bootstrap script:** run the real `install.sh` with fake `curl` and `wget` on `PATH`, covering a checksum mismatch, a missing downloader, the brew conflict and argument forwarding to `setup`.
- **Formula:** unit test of `render-formula.ts`, plus `ruby -c` when Ruby is available.
- **Update check and notice:** server tests for `/api/update-notice`, including the wait cap, plus dismissal and the cache TTL. A web test that the notice renders, copies and dismisses.
- **Sync guards:** tests that a dev run never syncs, an older binary never overwrites a newer marker, and `update` refuses during an active live session.
- **Docs and skill tests:** updated to the new install, update and uninstall sentences.

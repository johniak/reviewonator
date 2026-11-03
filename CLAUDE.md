# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

`AGENT_TASK_PROMPT.md` is the original product specification and the best source for intent behind the design.

`docs/paper-copper-design-language.md` is the visual design language for the web UI: semantic `--pc-*` color tokens for separate light and dark themes, warm paper surfaces with a copper accent, green/red/amber reserved for diff and review semantics. Follow it for any UI work. Sections on a PR list and PR overview describe a broader product than Reviewonator has; apply the tokens, diff, thread, and review-dialog guidance.

## Commands

Bun 1.3.13 is the runtime, package manager, bundler, and compiler. There is no npm/node path.

```sh
bun install --frozen-lockfile
bun run check            # typecheck + test + build; this is exactly what CI runs
bun run typecheck        # tsc --noEmit
bun run test             # bun run build:web, then vitest run
bun run test:watch       # vitest in watch mode (no web build)
bun run build            # single-file web app + compiled binary in dist/reviewonator
bun run dev -- https://github.com/owner/repo/pull/123 --review-file review.json [--live]
```

Run a single test file or test name:

```sh
bunx vitest run tests/domain/review.test.ts
bunx vitest run tests/server/session.test.ts -t "rejects"
```

`tests/e2e/cli.test.ts` spawns `bun src/cli.ts`, and `src/cli.ts` imports `web-dist/index.txt` at module load. Run `bun run build:web` once before running e2e tests directly through vitest; `bun run test` does this for you.

Install the local build as the real skill and binary to try it from Claude Code: `bun run build && ./scripts/install.sh --local`.

Release: bump `version` in `package.json`, push a tag `v<version>`. The release workflow refuses a tag that does not match the package version. It publishes `scripts/install.sh` as the `install.sh` release asset and then pushes a formula rendered by `scripts/render-formula.ts` to `johniak/homebrew-tap`, which needs the `HOMEBREW_TAP_TOKEN` secret.

## Architecture

Reviewonator is a human-in-the-loop gate between an AI agent and GitHub. Four pieces talk to each other, plus the install and update layer described below:

1. **Agent skill** (`skills/reviewonator/SKILL.md`) runs inside Claude Code or Codex. It reviews the PR with `gh`, writes a review JSON, launches the CLI, and later answers `wait`/`respond` rounds. It is the distributed artifact, not the app's input.
2. **CLI** (`src/cli.ts`) validates the JSON, loads the PR through `gh`, starts a loopback Hono server, prints the UI URL on stderr, opens the browser, and finally prints one JSON result line on stdout. The agent parses that stdout.
3. **Server** (`src/server/`) is a single in-memory `ReviewSession` behind `createApp`. All human and agent interaction is mediated by that session object.
4. **Web UI** (`web/`) is a React SPA. It imports types straight from `src/domain`, so the schema is the only contract between backend and frontend.

### Install, update, and skill sync

The binary owns skill installation, because Homebrew cannot write to `$HOME`. `src/install/embedded-skill.ts` embeds `skills/reviewonator/**` and the `skills/rr/SKILL.md` alias (only `src/cli.ts` imports it; Vite cannot load those text imports). `reviewonator setup` (`src/install/setup.ts`) writes the skills and saves targets and languages to `~/.config/reviewonator/config.json` (`REVIEWONATOR_CONFIG_DIR`); it prompts only on first install or with `--reconfigure`, and adopts a v0.7 install (managed skills, no config) without asking. Each skill directory carries `.reviewonator-managed` with the binary version. Before the review, `wait`, and `respond` commands, `src/install/sync.ts` rewrites managed skills that are older than the binary, but only when `detectInstallMethod(process.execPath)` says Homebrew (`/Cellar/reviewonator/`) or install script (binary marker); `bun src/cli.ts` is unmanaged and never touches installed skills. `reviewonator update` (`src/update/self-update.ts`) delegates to `brew upgrade` or downloads the release through `gh`, verifies its checksum, renames it over itself, and runs the new binary's `setup`. `src/update/update-check.ts` looks up the latest release in the background (cached for 24 hours in the state directory, off with `REVIEWONATOR_NO_UPDATE_CHECK=1`) and feeds `/api/update-notice`, which the UI reads once after load. `scripts/install.sh` is a POSIX bootstrap for `sh -c "$(curl …)"`: it downloads with `curl` or `wget`, verifies the checksum, installs the binary, and runs `reviewonator setup` with every option it does not handle itself.

### Two session modes

- **One-shot** (no `--live`): the first `/api/revision`, `/api/publish`, or `/api/cancel` closes the session, the server stops, and the CLI exits with the result. The skill restarts the CLI for the next round.
- **Live** (`--live`): the browser stays open across rounds. The CLI writes a state file (`src/server/live-state.ts`, under `$XDG_STATE_HOME/reviewonator` or `REVIEWONATOR_STATE_DIR`, keyed by a hash of the PR URL) holding the base URL and token. `reviewonator wait <PR_URL>` long-polls `/api/agent/wait`; `reviewonator respond <PR_URL> --review-file` posts a full replacement review to `/api/agent/respond`. The browser learns about changes over SSE on `/api/events` and refetches `/api/session`. Final results in live mode are persisted to the state file so a late `wait` can still pick them up.

### Review document and protocol rules

`src/domain/review.ts` is the canonical schema (zod, `version: 2`). Key constraints the rest of the code depends on:

- Every finding has `body` (public English comment) and `reviewerExplanation` (private, must contain two localized `What:`/`Why:`-style sections). Only `body` is ever sent to GitHub.
- Line findings must target an **added** line on the `RIGHT` side. `validateReviewLocations` parses the patch with `@pierre/diffs` and rejects anything else, both at startup and on every agent response.
- `userThreads` are private user-to-agent discussions on diff lines. They are never published.
- `ReviewSession.validateAgentResponse` enforces what the agent may change between rounds: new findings start pending, user `included`/`rejected` decisions are immutable, discussion history is append-only with exactly one agent reply per requested item, only the user can dismiss a thread.

The same rules are documented for the agent in `skills/reviewonator/references/review-schema.md` and `SKILL.md`. A protocol change touches all three places plus the session tests. `tests/skills/` and `tests/docs/` assert literal sentences from `SKILL.md`, `README.md`, and `docs/features.md`, so wording edits there fail tests by design; update the test, do not weaken the sentence.

The line starting with `Review language configuration:` in `SKILL.md` is a marker that `reviewonator setup` (`src/install/skill.ts`) rewrites with the user's chosen languages. Keep its exact shape.

### Safety invariants (do not relax)

- Server binds `127.0.0.1` only. The session token is in the URL fragment and required as `Bearer` on every `/api/*` route (query param on the SSE route). The agent CLI reuses the same token from the state file.
- All GitHub access goes through `gh` over `CommandRunner` (`GitHubClient` for pull requests, `GhReleaseSource` for releases). No token is read, passed, or sent to the browser. Only the bootstrap `scripts/install.sh` downloads public release assets with `curl`/`wget`, because it runs before Reviewonator exists.
- `publish` re-reads the PR head SHA and throws `StalePullRequestError` (HTTP 409) if it moved since the review was generated. The payload is built only from `body`, `path`, `line`, `side` of the selected comments.
- Nothing is included by default. Publishing requires `confirmed: true` in the request, which the UI sets only from the confirmation dialog.

### Web styling

`web/styles.css` holds the Paper Copper tokens (`--pc-*`, light under `:root`/`[data-theme="light"]`, dark under `[data-theme="dark"]`) and all component CSS; components use plain class names, not Tailwind utilities. UI preferences (theme, single/all files, unified/split diff) cannot live in localStorage, because every run serves the page from a new port and so a new origin. `FilePreferenceStore` (`src/server/preferences.ts`) keeps them in `preferences.json` in the state directory, `GET /` fills the `reviewonator-preferences` JSON element in `web/index.html` with them, and `POST /api/preferences` saves a change; `usePreference` in `web/preferences.ts` reads that element and saves through the API. `web/theme.ts` resolves the System/Light/Dark preference and an inline script in `web/index.html` applies it before first paint, so keep the two in sync. The diff library takes its surface from `--diffs-light-bg`/`--diffs-dark-bg` set on the `diffs-container` host in `.diff-surface`, derives the add/delete line tints from that surface itself, and gets `themeType` from the resolved theme. No gradients, shadows on resting surfaces, uppercase micro-labels, or text under 12px.

### Build pipeline

`vite build` (root `web/`, `vite-plugin-singlefile`) emits one `web-dist/index.html`; `scripts/prepare-web.ts` copies it to `index.txt`; `src/cli.ts` imports that file as text. `bun build --compile` then produces a single self-contained executable with the UI embedded. `web-dist/` and `dist/` are gitignored, so a fresh clone cannot run the CLI until `build:web` has run.

### Tests

Vitest with `happy-dom` by default; node-only files opt out with `// @vitest-environment node`. The seams for GitHub are the `GitHubGateway` and `CommandRunner` interfaces: e2e tests run the real `GitHubClient` against a fake `gh` shell script placed first on `PATH` (`tests/e2e/fixtures/gh`), while server and client unit tests pass an in-memory gateway or runner. `tests/scripts/installation.test.ts` runs the real `install.sh` under `sh -c` against a release built by `package-release.sh` and served over `file://`. Install and update tests use temp directories through `REVIEWONATOR_CONFIG_DIR`, `REVIEWONATOR_CLAUDE_SKILL_DIR`, `REVIEWONATOR_CODEX_SKILL_DIR`, and `REVIEWONATOR_STATE_DIR`; never let them touch the real `$HOME`. Web tests use Testing Library against real components with a stubbed `ResizeObserver` (`tests/setup.ts`).

`bun run dev` needs a real, authenticated `gh` because the CLI verifies it at startup; the test suite does not.

# Early Review Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an `early` review mode in which Reviewonator opens before the agent's review, the agent delivers About this PR first and all findings at the end, and the user's work in the meantime is kept and queued.

**Architecture:** The mode is a setup setting (config + a skill marker line). The live `ReviewSession` gains a reviewing state, a `deliver` operation that merges the agent's document into the session, and a single queued request released after the final delivery. The CLI gets `--early` and `reviewonator deliver`, and the web UI shows the reviewing state.

**Tech Stack:** Bun 1.3.13, TypeScript, zod, Hono, React 19, vitest + happy-dom + Testing Library.

**Spec:** `docs/superpowers/specs/2026-11-05-early-review-mode-design.md` (read it first; it is the source for every behavior below).

## Global Constraints

- Mode values are exactly `full` and `early`; a missing mode means `full`.
- All UI text is English. Exact copy from the spec: "The AI is reading the pull request", "The AI is reviewing this pull request", "If the agent has stopped, cancel this review and run the skill again." (after 15 minutes), "AI reviewing" (badge), "Queue for AI" (send buttons), "Queued, sent when the AI finishes its review" (queued label), "Available when the AI finishes its review" (publish disabled reason).
- Setup prompt text is copied verbatim from the spec's "Choosing the mode" block. The hint line is exactly `New: early review mode. Choose it with reviewonator setup --reconfigure`.
- Skill marker line is exactly `Review mode configuration: the default review mode is <mode>.`
- Safety invariants in CLAUDE.md stay: nothing included by default, publish needs `confirmed: true`, loopback only, token on every `/api/*` route.
- Web styling follows `docs/paper-copper-design-language.md`: tokens only, no text under 12px.
- `bun run check` passes after every task. Commit after every task on the current branch.

## Review Focus

- The user deletes their own comment whose discussion is queued → the released request must not name it (otherwise the agent's `respond` fails validation). Test in Task 2.
- The user dismisses a thread whose message is queued → refused with a clear message while reviewing. Test in Task 2.
- A browser reload during the review → the spinner and the timer continue from the server's `startedAt`, not from page load. Test in Task 4.
- A second `deliver --final`, or `deliver` after `respond` became possible → clear error "The AI agent has already delivered its review." Test in Task 2.
- The agent delivers a finding ID that collides with a user comment (`H…`) → rejected. Test in Task 2.

---

### Task 1: Review mode in config, setup, and the installed skill

**Files:**
- Modify: `src/install/config.ts`, `src/install/setup.ts`, `src/install/skill.ts`, `src/install/sync.ts`, `src/install/legacy.ts` (only if types require), `src/cli.ts` (setup flags and help), `skills/reviewonator/SKILL.md` (add the marker line directly under the `Review language configuration:` line, value `full`)
- Test: `tests/install/config.test.ts`, `tests/install/setup.test.ts`, `tests/install/skill.test.ts`, `tests/install/sync.test.ts`

**Interfaces:**
- Produces: `export type ReviewMode = "full" | "early"` in `config.ts`; `InstallConfig.mode?: ReviewMode` (zod `z.enum(["full","early"]).optional()`, config `version` stays `1`).
- Produces: `SetupOptions.mode?: string`; env `REVIEWONATOR_MODE`; CLI `reviewonator setup --mode full|early`.
- Produces: `writeSkill(skillDir, files, settings: { languages: Languages; mode: ReviewMode }, version)` replacing the `languages` parameter; `modeLine(mode: ReviewMode): string`; `readInstalledMode(skillDir): Promise<ReviewMode | null>` is not needed (config is the source).

- [ ] **Step 1: Write the failing tests**
  - config: a config with `mode: "early"` round-trips; a config without `mode` still parses; `mode: "fast"` is invalid.
  - setup, interactive first install: answering `2` saves `mode: "early"`, the prompt output contains the full spec prompt text (assert `"Default review mode:"`, `"1) Full: the agent reviews the whole pull request first"`, `"2) Early: Reviewonator opens right away with the diff."`), and the installed SKILL.md contains `Review mode configuration: the default review mode is early.`
  - setup, empty answer → `full`; `early`/`full` words accepted; unknown answer throws `Unknown review mode: fast. Use full or early.`
  - setup, existing config without `mode`, interactive, no `--reconfigure`: asks only the mode question (prompter receives exactly one question), keeps targets and languages.
  - setup, existing config with `mode`, interactive, no `--reconfigure`: asks nothing.
  - setup `--mode early` and `REVIEWONATOR_MODE=early`: no prompt, saved.
  - setup non-interactive, no saved mode, no option: config has no `mode`, the skill says `full`, and the log contains `New: early review mode. Choose it with reviewonator setup --reconfigure`. With a saved mode or an option the hint is absent.
  - sync: an outdated managed skill is rewritten with the config's mode (`early`), and with `full` when the config has none.
  - skill: `writeSkill` throws when SKILL.md lacks the mode marker (`The Reviewonator skill is missing its review mode marker.`).

- [ ] **Step 2: Run them and see them fail**

Run: `bunx vitest run tests/install`
Expected: the new tests FAIL.

- [ ] **Step 3: Implement**
  - `skill.ts`: `MODE_LINE = /^Review mode configuration: the default review mode is (full|early)\.$/m`; `writeSkill` replaces both markers.
  - `setup.ts`: a separate `askMode = context.interactive && (!existing || options.reconfigure || !existing.mode)`; resolution order: option/env → prompt → existing → none. Prompt text verbatim from the spec, default shown as `[1]` or `[2]` from the current mode. Log `Default review mode: <Full|Early>` next to the language lines when a mode is saved; log the hint when none is saved.
  - `sync.ts`: pass `{ languages: config.languages, mode: config.mode ?? "full" }`.
  - `cli.ts`: parse `--mode`, pass to `runSetup`, add it to the help line for setup.

- [ ] **Step 4: Run the tests and `bun run check`**

Expected: all PASS.

- [ ] **Step 5: Commit** — `Choose a default review mode in setup`

---

### Task 2: Reviewing state, deliver, and the queue in the session

**Files:**
- Modify: `src/server/session.ts`, `src/server/app.ts`, `web/types.ts` (snapshot type only)
- Test: `tests/server/session.test.ts`, `tests/server/app.test.ts`

**Interfaces:**
- Produces: `ReviewSession` constructor gains an 8th parameter `options: { early?: boolean } = {}`. `early` requires `live` (throw `Early review mode requires a live session.` otherwise).
- Produces: `snapshot().reviewing: { startedAt: string } | null` (ISO time captured in the constructor) and `snapshot().agentPending` is `false` while reviewing.
- Produces: `deliver(input: unknown, final: boolean): void`. Route `POST /api/agent/deliver` with body `{ review: unknown, final: boolean }`, returns `{ status: "accepted" }`.
- Produces: errors with exact messages — `deliver` when not reviewing: `The AI agent has already delivered its review.`; `respond` while reviewing: `The AI agent has not delivered its review yet.`; `publish` while reviewing: `Publishing is available when the AI finishes its review.` (use `CommentChangeError` so the route returns 400).

- [ ] **Step 1: Write the failing tests** (session level, plus one app-route test for `/api/agent/deliver` auth and body)
  - an early session snapshot has `reviewing.startedAt` and no findings; `wait` stays pending.
  - `deliver(doc, false)` with a briefing and no comments sets the briefing and keeps reviewing; with comments it throws `A delivery before the final one cannot contain findings.`
  - `deliver(doc, true)` sets summary, recommendation, findings, keeps the earlier briefing when the doc has none, ends reviewing (`snapshot().reviewing === null`).
  - a delivery is rejected for: `author: "user"`, `edited`, an ID starting with `H`, an included/rejected finding, a finding with discussion, non-empty `userThreads`, a different `prUrl` or `languages`, a line finding outside the added lines.
  - user comments added before each delivery, their include/reject state sent with a request, and user threads survive both deliveries.
  - while reviewing, two `requestRevision` calls (a new thread, then a discussion on the user's own comment) are both accepted, write the user messages into the review at once, and `wait` returns nothing; after `deliver(…, true)`, `wait` returns one request naming both, with the full current review.
  - while reviewing, a second message to a discussion whose last message is the user's is refused (`The AI agent has not replied to this discussion yet.`); dismissing a thread whose last message is the user's is refused with the same message.
  - deleting a user comment with a queued discussion removes it from the released request (Review Focus).
  - `respond` and `publish` are refused while reviewing; `cancel` works and a waiting `wait` gets `cancelled`.
  - a second `deliver(…, true)` is refused.

- [ ] **Step 2: Run them and see them fail**

Run: `bunx vitest run tests/server`
Expected: the new tests FAIL.

- [ ] **Step 3: Implement** in `session.ts`
  - a `reviewing` flag and `startedAt`; a single `queuedAgentRequest` merged on each send: selected/rejected IDs from the latest send, all other lists concatenated.
  - the extra send checks above apply only while reviewing; outside reviewing the existing "already working" rule stays.
  - `deliver` parses with `reviewDocumentSchema`, runs `validateReviewLocations`, applies the rejections above, then builds the new review from the session's user comments and threads plus the agent's findings. On `final`: filter the queued request against current comments and threads, push it to `pendingAgentRequests` when it names anything, `releaseAgentWaiter()`, `notifyChanged()`.

- [ ] **Step 4: Run the tests and `bun run check`** — all PASS.

- [ ] **Step 5: Commit** — `Hold an early review open until the agent delivers it`

---

### Task 3: CLI `--early` and `reviewonator deliver`

**Files:**
- Modify: `src/cli.ts`
- Test: `tests/e2e/cli.test.ts` (fake `gh` on PATH, as the existing live tests do)

**Interfaces:**
- Consumes: Task 2's constructor option, route, and errors.
- Produces: `reviewonator <PR_URL> --review-file <PATH> --early` (implies `--live`); `reviewonator deliver <PR_URL> --review-file <PATH> [--final]` posting `{ review, final }` to `/api/agent/deliver` and printing `{"status":"accepted"}`.

- [ ] **Step 1: Write the failing e2e tests**
  - start with `--early --no-open` and a starting file (empty summary, `COMMENT`, no comments); `deliver` with a briefing; the session API shows it and `reviewing` is set; `deliver --final` with a finding; a browser-side `/api/revision` sent before the final delivery is returned by `wait` after it.
  - cancel during reviewing, then `deliver` prints `{"status":"cancelled"}`, exits 0, and removes the state file.
  - a leftover `cancelled` state file does not block a new start; a leftover `published` one still does (existing message).
  - help text lists `deliver` and `--early`.

- [ ] **Step 2: Run them and see them fail** — `bun run build:web && bunx vitest run tests/e2e/cli.test.ts`

- [ ] **Step 3: Implement** — `deliver` mirrors `respondToLiveRequest` (prUrl check, `withSkillUpdateHint`), except that a state file with a `result` prints that result, removes the state file, and returns. `ensureNoActiveLiveSession` removes a leftover `cancelled` result instead of throwing.

- [ ] **Step 4: `bun run check`** — PASS.

- [ ] **Step 5: Commit** — `Start an early review and deliver it from the CLI`

---

### Task 4: The reviewing state in the web UI

**Files:**
- Modify: `web/App.tsx`, `web/components/PrBriefing.tsx` (or a small placeholder next to it), `web/components/ReviewCommentCard.tsx`, `web/components/UserCommentThread.tsx`, `web/components/DiffPanel.tsx`, `web/styles.css`
- Test: `tests/web/App.test.ts` and the component tests

**Interfaces:**
- Consumes: `snapshot().reviewing`.
- Produces: a `queueing: boolean` prop (true while reviewing) passed with the existing `agentPending` to the cards and drafts.

- [ ] **Step 1: Write the failing tests**
  - App with an early session: the About this PR region shows "The AI is reading the pull request" until a briefing exists; the review panel shows "The AI is reviewing this pull request" and an elapsed time computed from `reviewing.startedAt` (with fake timers: a `startedAt` 4 min 12 s ago renders `4:12`); at 15 minutes the stop hint appears; the badge reads "AI reviewing".
  - "Review and publish" is disabled and "Available when the AI finishes its review" is visible.
  - send buttons read "Queue for AI"; after queueing a line comment, its thread shows "Queued, sent when the AI finishes its review" and has no reply field; another thread can still be queued.
  - after a session update with `reviewing: null` and findings, the findings render, the queued label becomes the usual waiting state, and publishing is enabled again.

- [ ] **Step 2: Run them and see them fail** — `bunx vitest run tests/web`

- [ ] **Step 3: Implement** — the timer is a 1-second interval in the review panel computing from `startedAt` (`m:ss`, `h:mm:ss` past an hour). Spinners use the existing loading style if there is one, otherwise a token-coloured CSS spinner with `prefers-reduced-motion` respected.

- [ ] **Step 4: `bun run check`** — PASS. Then look at it in a browser with a dev session (`bun run dev -- <PR> --review-file <starting file> --early`) in light and dark themes.

- [ ] **Step 5: Commit** — `Show the early review while the agent works`

---

### Task 5: Skill and documentation

**Files:**
- Modify: `skills/reviewonator/SKILL.md`, `skills/reviewonator/references/review-schema.md`, `README.md`, `docs/features.md`, `CLAUDE.md`
- Test: `tests/skills/reviewonator-skill.test.ts`, `tests/docs/documentation.test.ts`

- [ ] **Step 1: Write the failing literal-sentence tests** for:
  - SKILL.md: the mode word after the URL ("Accept an optional mode word, `full` or `early`, after the pull request URL; without one, use the mode in **Review mode configuration**."), the early workflow steps from the spec, "In early mode, deliver the About this PR note before you start the review.", "deliver every finding at once with `--final`", and "If `deliver` prints `cancelled`, report that nothing was published and stop."
  - review-schema.md: the starting file, both `deliver` calls, and "Reviewonator keeps the user's comments and threads; leave `userThreads` empty in a delivery."
  - README: both modes and `reviewonator setup --reconfigure` to change the default; features.md: what the user sees during an early review (spinner, queue, blocked publishing).

- [ ] **Step 2: Run them and see them fail** — `bunx vitest run tests/skills tests/docs`

- [ ] **Step 3: Write the text.** SKILL.md keeps the full-mode workflow unchanged; the early workflow is a short section that reuses its steps by number. CLAUDE.md: one paragraph on the reviewing state under "Two session modes".

- [ ] **Step 4: `bun run check`** — PASS.

- [ ] **Step 5: Commit** — `Document the early review mode`

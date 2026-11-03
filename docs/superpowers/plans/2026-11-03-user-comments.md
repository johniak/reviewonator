# User-written and User-edited Comments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user write review comments by hand on any diff line and edit any comment, with the server keeping the user's version across agent rounds unless the user discusses that comment.

**Architecture:** The review schema learns `author` and `edited`. `ReviewSession` owns user comments and edits (create, edit, delete through new `/api/comments` routes) and merges every agent response through one pure function that restores the user's state for user-owned comments. The web UI adds **Add comment** to the line draft card and edit/delete controls to the comment card.

**Tech Stack:** Bun 1.3.13, TypeScript, zod, Hono, React, Vitest with happy-dom and Testing Library, `@pierre/diffs`.

**Spec:** `docs/superpowers/specs/2026-11-03-user-comments-design.md`

## Global Constraints

- Work on branch `next`. No version bump, no tag.
- Review document stays `version: 2`; `author` and `edited` are optional and additive.
- `author` absent means `"agent"`. AI findings keep every current rule: required `severity`, required What/Why `reviewerExplanation`, `type: "line"` only on `RIGHT` added lines.
- Nothing is included by default: user comments start with neither `included` nor `rejected`.
- User comment IDs are server-assigned `H<n>` (first unused `H1`, `H2`, …). The skill reserves the `H` prefix for the user.
- Every `/api/*` route keeps the existing Bearer-token middleware (`src/server/app.ts`).
- All UI copy in English. Paper Copper tokens only (`--pc-*`), no gradients, no shadows on resting surfaces, no uppercase labels, no text under 12px.
- `tests/skills/` and `tests/docs/` assert literal sentences: write the test sentence first, then the doc.
- Run single files with `bunx vitest run <file>`; finish with `bun run check`.

## Review Focus

1. The agent's response omits a user comment the user added mid-round → the comment is still there afterwards (Task 3 test).
2. The user deletes their comment mid-round and the agent echoes it back → it stays deleted (Task 3 test).
3. The user edits a comment while the agent works on a different one, and the agent sends the stale body → the user's body stays (Task 3 test).
4. **Add comment** on a line outside the patch hunks (an expanded context line) → HTTP 400 with a clear message, the draft stays (Tasks 2 and 6 tests).
5. A user comment on a deleted line (`LEFT`) is published with `side: "LEFT"` (Task 5 test).

---

### Task 1: Schema and diff-line rules

**Files:**
- Modify: `src/domain/review.ts`
- Test: `tests/domain/review.test.ts`

**Interfaces:**
- Produces:
  - `reviewCommentSchema` with `author?: "agent" | "user"`, `edited?: boolean`, `severity` optional, `reviewerExplanation` optional, `side?: "LEFT" | "RIGHT"`.
  - `userCommentInputSchema` = `{ path: string; line: positive int; side: "LEFT" | "RIGHT"; body: string (trim, 1..65_535) }`, type `UserCommentInput`.
  - `commentEditSchema` = `{ body: string (trim, 1..65_535); severity?: Severity | null }`, type `CommentEdit`; `type Severity = (typeof severities)[number]`.
  - `diffLineRanges(patch: string): Map<string, { LEFT: [number, number][]; RIGHT: [number, number][]; added: Set<number> }>`: per file, inclusive hunk ranges `[deletionStart, deletionStart + deletionCount - 1]` and `[additionStart, additionStart + additionCount - 1]`, plus the added RIGHT lines (the set `validateReviewLocations` builds today).
  - `isLineInDiff(patch: string, location: { path: string; line: number; side: "LEFT" | "RIGHT" }): boolean`.

- [ ] **Step 1: Write the failing tests** in `tests/domain/review.test.ts` (fixture patch: LEFT lines 1–3, RIGHT lines 1–4, added RIGHT lines 2–3):
  - `it("requires severity and a What/Why explanation only from the agent")`: a comment with `author: "user"`, no `severity`, no `reviewerExplanation`, `side: "LEFT"` parses; the same object without `author` fails.
  - `it("accepts user comments on any diff line and agent findings only on added lines")`: `validateReviewLocations` accepts a user comment at `src/example.ts:2 LEFT` and `:1 RIGHT`; rejects a user comment at `:9 RIGHT` with a message containing `src/example.ts:9`; still rejects an agent finding at `:1 RIGHT`.
  - `it("rejects LEFT on agent findings")`: an agent finding with `side: "LEFT"` fails `reviewDocumentSchema`.
  - `it("knows which lines are inside the diff hunks")`: `isLineInDiff(patch, { path: "src/example.ts", line: 3, side: "LEFT" })` is true, `line: 4, side: "LEFT"` false, `line: 4, side: "RIGHT"` true, unknown path false.

- [ ] **Step 2: Run** `bunx vitest run tests/domain/review.test.ts`. Expected: the four new tests FAIL.

- [ ] **Step 3: Implement** the schema changes in the `superRefine` of `reviewCommentSchema` (agent: severity and explanation required, `side` must be `RIGHT` for line comments; user: `side` required for line comments), `diffLineRanges`, `isLineInDiff`, and make `validateReviewLocations` use `isLineInDiff` for `author: "user"` and the added-lines set otherwise. Keep the existing agent error message; user comments get `Review comments must target lines inside the pull request diff: <id> (<path>:<line>)`.

- [ ] **Step 4: Run** `bunx vitest run tests/domain` and `bun run typecheck`. Expected: PASS. Fix type fallout in `web/` from optional `severity`/`reviewerExplanation` minimally (for example `comment.severity ?? "user"` in class names); the real UI comes in Task 7.

- [ ] **Step 5: Commit** `git commit -m "Allow user-written comments on any diff line in the review schema"`

### Task 2: Session operations for user comments and edits

**Files:**
- Modify: `src/server/session.ts`
- Test: `tests/server/session.test.ts`

**Interfaces:**
- Consumes: `userCommentInputSchema`, `commentEditSchema`, `isLineInDiff` (Task 1).
- Produces on `ReviewSession`:
  - `addUserComment(input: unknown): ReviewComment`: new `{ id: "H<n>", type: "line", author: "user", path, line, side, body }`, appended to `review.comments`.
  - `editComment(id: string, input: unknown): ReviewComment`: sets `body`; sets `severity` (or removes it for `null`) only for `author: "user"`; sets `edited: true` for agent comments.
  - `deleteUserComment(id: string): void`: removes it and records the id in a private `deletedUserCommentIds: Set<string>`.
  - Each calls `assertOpen()` and `notifyChanged()`. All three work while an agent round is active.

- [ ] **Step 1: Write the failing tests:**
  - `it("adds a pending user comment on a deleted line with the next free H id")`: two calls return ids `H1`, `H2`; `review.comments` contains `H1` with `author: "user"`, `side: "LEFT"`, no `included`/`rejected`; `session.version` increased.
  - `it("rejects a user comment outside the diff hunks")`: `{ path: "src/example.ts", line: 9, side: "RIGHT", body: "x" }` throws `/inside the pull request diff/`.
  - `it("marks an edited agent finding and keeps its decision state")`: edit `S1` body → `edited: true`, `included` unchanged; `editComment("S1", { body: "x", severity: "nit" })` throws `/Only comments you wrote can change severity/`.
  - `it("changes and clears the severity of a user comment")`.
  - `it("locks a comment while it waits for the AI agent")`: in a live session, after `requestRevision({ requests: [{ commentId: "S1", message: "?" }] })`, `editComment("S1", …)` throws `/The AI agent is checking this comment/`; editing another comment still works.
  - `it("deletes only user-written comments")`: deleting `S1` throws `/Only comments you wrote can be deleted/`; deleting `H1` removes it.
  - `it("publishes the edited body")`: edit `S1`, publish with `selectedCommentIds: ["S1"]`; the gateway receives the new body.

- [ ] **Step 2: Run** `bunx vitest run tests/server/session.test.ts`. Expected: new tests FAIL.

- [ ] **Step 3: Implement** the three methods. "Waiting for the AI agent" means the comment's `discussion` ends with a `user` message. Error copy is exactly as in the tests: `Comments can only be placed on lines inside the pull request diff: <path>:<line>`, `Only comments you wrote can change severity.`, `Only comments you wrote can be deleted.`, `The AI agent is checking this comment. Edit it after the agent responds.`

- [ ] **Step 4: Run** the session tests. Expected: PASS.

- [ ] **Step 5: Commit** `git commit -m "Let the session create, edit, and delete user comments"`

### Task 3: Keep the user's version when the agent responds

**Files:**
- Create: `src/server/user-owned-comments.ts`
- Modify: `src/server/session.ts` (`respond`), `src/cli.ts` (one-shot result)
- Test: `tests/server/user-owned-comments.test.ts`, `tests/server/session.test.ts`, `tests/e2e/cli.test.ts`

**Interfaces:**
- Consumes: `ReviewComment` with `author`/`edited` (Task 1), `deletedUserCommentIds` (Task 2).
- Produces: `mergeAgentComments(current: ReviewComment[], next: ReviewComment[], discussedIds: Set<string>, deletedUserIds: Set<string>): ReviewComment[]`. A comment is user-owned when `author === "user"` or `edited === true`.
  - user-owned and in `discussedIds`: take the agent's version but force `author`, `edited`, `type`, `path`, `line`, `side` from `current`;
  - user-owned and not discussed: keep `current` unchanged;
  - user-owned and missing from `next`: append `current`;
  - in `next` with id in `deletedUserIds`: drop;
  - new id with `author: "user"`: throw `The agent cannot create comment <id> as written by the user.`;
  - new id with `edited: true`: throw `Only the user can mark comment <id> as edited.`

- [ ] **Step 1: Write the failing unit tests** in `tests/server/user-owned-comments.test.ts`, one per rule above, plus `it("lets the agent rewrite a user comment the user discussed")` (body changes, `author` stays `"user"`).

- [ ] **Step 2: Write the failing session tests** (live session) for the Review Focus cases 1–3:
  - `it("restores a user comment added while the agent was working")`
  - `it("does not bring back a user comment deleted while the agent was working")`
  - `it("keeps the user's edit when the agent answers a different comment")`

- [ ] **Step 3: Extend the one-shot e2e test** in `tests/e2e/cli.test.ts` (the `revision_requested` assertion near line 182) to expect a `review` field whose `comments` contain the fixture findings.

- [ ] **Step 4: Run** the three files. Expected: FAIL.

- [ ] **Step 5: Implement** `mergeAgentComments`; in `respond`, call it after `validateAgentResponse` with the active request's `requests` comment ids and store the merged review. The existing "cannot remove finding while responding to its discussion" check still applies. In `src/cli.ts`, print `{ ...result, review: session.review }` for a one-shot `revision_requested` result.

- [ ] **Step 6: Run** `bunx vitest run tests/server tests/e2e/cli.test.ts` (after `bun run build:web`). Expected: PASS.

- [ ] **Step 7: Commit** `git commit -m "Keep user-written and user-edited comments when the agent responds"`

### Task 4: HTTP routes and web API client

**Files:**
- Modify: `src/server/app.ts`, `web/api.ts`
- Test: `tests/server/app.test.ts`

**Interfaces:**
- Consumes: the three session methods (Task 2).
- Produces:
  - `POST /api/comments` (body `UserCommentInput`), `PATCH /api/comments/:id` (body `CommentEdit`), `DELETE /api/comments/:id`. Each returns `{ session: snapshot }`; errors use the app's existing error handling (400 with `{ error }`).
  - `api.addComment(input: UserCommentInput)`, `api.editComment(id: string, edit: CommentEdit)`, `api.deleteComment(id: string)`, each `Promise<{ session: SessionSnapshot }>`.

- [ ] **Step 1: Write the failing tests:** create, edit, and delete round-trips return the updated snapshot; requests without the Bearer token get 401; an out-of-diff create returns 400 with the Task 2 message.
- [ ] **Step 2: Run** `bunx vitest run tests/server/app.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the routes and client methods (`encodeURIComponent` the id).
- [ ] **Step 4: Run** the file. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "Expose user comment create, edit, and delete routes"`

### Task 5: Publish user comments with their own side

**Files:**
- Modify: `src/github/client.ts` (only if the payload needs it)
- Test: `tests/github/client.test.ts`

- [ ] **Step 1: Write the failing test** `it("publishes a user comment on a deleted line with side LEFT")`: `publishReview` with a selected `{ author: "user", side: "LEFT", line: 2, … }` sends a payload comment `{ path, line: 2, side: "LEFT", body }` and no `author`, `edited`, or `severity`.
- [ ] **Step 2: Run** `bunx vitest run tests/github/client.test.ts`. If it already passes, the existing `side: comment.side` mapping is enough; keep the test and skip Step 3.
- [ ] **Step 3: Implement** the fix if needed.
- [ ] **Step 4: Commit** `git commit -m "Publish user comments on either side of the diff"`

### Task 6: Add comment from the line draft card

**Files:**
- Modify: `web/types.ts`, `web/components/DiffPanel.tsx`, `web/App.tsx`, `web/styles.css`
- Test: `tests/web/DiffPanel.test.tsx`, `tests/web/App.test.ts`

**Interfaces:**
- Consumes: `api.addComment` (Task 4).
- Produces: `LineCommentDraftActions.onAddComment: (location: LineCommentLocation) => void`, threaded like `onSendDraft`.

- [ ] **Step 1: Write the failing tests:**
  - DiffPanel: `it("adds the line comment to the review without the AI agent")`: **Add comment** is disabled for blank text and calls `onAddComment(location)` otherwise. It stays enabled while `agentPending`.
  - App (live session, create the draft with the pointer-move plus gutter-click pattern used by `"sends one line comment from its own card…"`): clicking **Add comment** removes the draft, shows a pending comment card with the typed text, makes no agent request (`session.review.comments` has `H1`; no pending agent request), and does not mark it included.
  - App: when the server rejects the comment (call `session.cancel()` after typing and before clicking **Add comment**, so the real route answers with the closed-session error), the draft and its text stay and the error shows in the review panel `role="alert"`.
- [ ] **Step 2: Run** both files. Expected: FAIL.
- [ ] **Step 3: Implement** `addUserComment(location)` in `App.tsx` (on success `setSession` and `removeLineCommentDraft`; on failure `setActionError` and keep the draft) and the button in the draft footer: a secondary button labelled `Add comment`, placed before **Send to AI**.
- [ ] **Step 4: Run** both files. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "Add a hand-written comment straight from the line draft"`

### Task 7: Comment card for user comments and edits

**Files:**
- Modify: `web/components/ReviewCommentCard.tsx`, `web/components/SeverityBadge.tsx`, `web/components/ReviewFindingNavigation.tsx`, `web/components/PublishDialog.tsx`, `web/types.ts`, `web/App.tsx`, `web/styles.css`
- Test: `tests/web/ReviewCommentCard.test.tsx`, `tests/web/ReviewFindingNavigation.test.tsx`, `tests/web/App.test.ts`

**Interfaces:**
- Consumes: `api.editComment`, `api.deleteComment` (Task 4); `CommentEdit` (Task 1).
- Produces: `CommentActions.onEditComment: (id: string, edit: CommentEdit) => Promise<boolean>` (true on success) and `CommentActions.onDeleteComment: (id: string) => Promise<void>`.

- [ ] **Step 1: Write the failing tests:**
  - Card: a user comment shows a `You` badge (`UserRound` icon), no severity badge when it has none, and no "For reviewer only" block without `reviewerExplanation`.
  - Card: **Edit comment** (pencil button, `aria-label="Edit comment"`) opens a textarea labelled `Public comment`. For user comments it also shows a `Severity` select with `None` plus the five severities. **Save** is disabled for blank or unchanged text and calls `onEditComment(id, { body, severity })`. **Cancel** restores view mode.
  - Card: an edited agent finding shows `Edited`. **Edit comment** is disabled while the comment waits for the AI agent. **Delete comment** exists only for `author: "user"`.
  - Navigation: user comments show the `You` badge.
  - App: editing `S1` through the card persists (`session.review.comments` S1 has the new body and `edited: true`). Deleting a user comment removes it from the session and from the selection.
- [ ] **Step 2: Run** the three files. Expected: FAIL.
- [ ] **Step 3: Implement.** Use one `.author-badge` class built on the shared badge rule (`.severity-badge` group) with `color: var(--pc-accent); background: var(--pc-accent-subtle)`. `Edited` is muted text next to the id. In `App.tsx`, the delete handler also drops the id from `selectedIds`, `rejectedIds`, and `revisionMessages`.
- [ ] **Step 4: Run** `bunx vitest run tests/web` and `bun run typecheck`. Expected: PASS.
- [ ] **Step 5: Check it visually** with the headless Chrome screenshot approach (real `web/styles.css`, light and dark): user comment card, edit mode, edited finding.
- [ ] **Step 6: Commit** `git commit -m "Edit comments and show hand-written ones in the review"`

### Task 8: Agent protocol and user docs

**Files:**
- Modify: `skills/reviewonator/SKILL.md`, `skills/reviewonator/references/review-schema.md`, `README.md`, `docs/features.md`
- Test: `tests/skills/reviewonator-skill.test.ts`, `tests/docs/documentation.test.ts`

- [ ] **Step 1: Write the failing assertions.** The exact sentences:
  - SKILL.md: `Comments with "author": "user" or "edited": true belong to the user: keep them, and change their body or severity only when the user discussed that comment in this round.`
  - SKILL.md: `Never set "author": "user" or "edited" yourself, and never use IDs that start with H; Reviewonator restores the user's version of user-owned comments.`
  - review-schema.md: `` `author` is `"agent"` (default) or `"user"`. A user-written comment may omit `severity` and `reviewerExplanation`, and may target any line inside the diff on either side. ``
  - README: `Click **+** beside a diff line, write your comment, and choose **Add comment** to put it straight into the review, or **Send to AI** to have the agent check it first.`
  - features.md: `Edit any comment with the pencil on its card. Reviewonator keeps your wording across agent rounds unless you discuss that comment with the agent.`
- [ ] **Step 2: Run** `bunx vitest run tests/skills tests/docs`. Expected: FAIL.
- [ ] **Step 3: Write the docs** around those sentences. The README's "Edit the public comment if needed." step now describes the pencil.
- [ ] **Step 4: Run** `bun run check`. Expected: typecheck, every test, and the build PASS.
- [ ] **Step 5: Commit** `git commit -m "Document hand-written and edited comments for the agent and the user"`

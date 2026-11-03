# User-written and user-edited review comments

## Intent

Today every comment in the review comes from the AI agent, and the user can only include, reject, or discuss it. The user wants two more things:

1. **Write a review comment by hand** on any diff line, without the AI rewriting it first.
2. **Edit any comment by hand**, including an AI finding.

What the user writes or edits is theirs. The AI may change such a comment only through a discussion the user starts on that comment. If the user does not discuss it, the comment stays exactly as the user left it, across every agent round.

## Decisions made with the user

- A hand-written comment **starts pending**, like an AI finding. Nothing is included by default; the safety invariant stays.
- It **looks like every other comment card** and supports the same actions: Include, Reject, Discuss with AI. A subtle marker, consistent with the Paper Copper design language, shows that the user wrote it.
- It can be placed on **any line of the diff**: added, deleted, or context, on either side. GitHub accepts review comments on all of them.
- **Severity is optional.** By default the comment is labelled as the user's (no severity). The user may set one of the existing severities later.
- Edits are possible on **any** comment, AI or user.

## Behavior

### Creating

The line draft card (opened with **+**) gets a second action next to **Send to AI**: **Add comment**. It creates a review comment from the draft text immediately, with no agent round. The draft disappears; a pending comment card appears at that line.

### Editing

Every comment card has an edit action. Editing changes the public body. For a user-written comment the edit form also offers the severity (including "none"). An edited AI finding shows a small "Edited" marker. Editing is unavailable while that comment is waiting for an AI response.

A user-written comment can also be deleted by the user. AI findings cannot be deleted (Reject covers that).

### Ownership rule (the core of this change)

A comment is **user-owned** when the user wrote it or edited it. For a user-owned comment, the user's `body` and `severity` are authoritative:

- When the agent responds, the server keeps the user's current `body` and `severity` for every user-owned comment that was **not** part of a discussion request in that round, regardless of what the agent sent. This also covers edits the user made while the agent was working, which the agent could not have seen.
- When the user discussed that comment in the round, the agent's new `body` and `severity` are accepted (that is "changing it through discussion"). The comment stays user-owned afterwards.
- The agent cannot remove a user-owned comment (written **or** edited), cannot create a comment marked as user-written, and cannot set or clear the edited marker.

The user may add, edit, and delete comments while the agent is working on a round; only a comment that is itself waiting for an AI response is locked. Because the agent cannot see those changes, the server treats the user's state as authoritative instead of rejecting the response: it restores user-owned comments the agent left out, drops user comments the user deleted, and keeps the user's `body`, `severity`, `author`, `edited`, and location. The agent is never sent an error for this; the skill documents that Reviewonator restores the user's version. The agent may still append its reply to the discussion of a user-owned comment the user discussed in that round.

Include and Reject keep their current rules. An edit does not change the comment's Include/Reject state, and `edited` stays true after the agent rewrites the comment through discussion.

### Publishing

Publishing uses each selected comment's current body. User-written line comments carry their own `side` (`LEFT` or `RIGHT`), which goes into the GitHub payload.

## Data and protocol

`src/domain/review.ts` (review document `version: 2` stays, the fields are additive and optional):

- `author: "agent" | "user"`, absent means agent.
- `edited: true` when the user changed an AI finding.
- For `author: "user"`: `severity` and `reviewerExplanation` are optional; `side` may be `LEFT` or `RIGHT`; the location must be a line inside the diff hunks on that side. AI findings keep every current rule (required severity, required What/Why explanation, `RIGHT` added lines only).

The session owns user comments and edits: the browser sends each create, edit, severity change, or delete to the server immediately, and the session stores it. The agent sees them in the `review` it receives from `wait`. The one-shot revision result also includes the current `review`, so an agent restarting the CLI can carry user comments forward. The ownership rule is enforced by the live session; in one-shot mode (which the skill does not use) carrying them forward is the agent's job.

The agent-facing rules go into `skills/reviewonator/SKILL.md` and `skills/reviewonator/references/review-schema.md`: keep user-written comments, do not change the body or severity of user-owned comments unless the user discussed them in this round, never add `author: "user"` or `edited`.

## Goals, non-goals

- Goal: hand-written comments and hand edits that survive agent rounds.
- Non-goal: hand-written general (file-less) comments; the review summary in the publish dialog already covers that.
- Non-goal: changing the severity of AI findings by hand.
- Anti-goal: anything that lets the agent silently overwrite what the user wrote, or that publishes a comment the user did not explicitly include.

## Docs

README and `docs/features.md` describe writing and editing comments. The README's current "Edit the public comment if needed" step becomes true with this change.

## Left to the builder

- API shape for create, edit, and delete (one route per action is fine).
- IDs for user comments (server-assigned, distinct from agent IDs).
- Exact visual treatment of the user marker and the "Edited" marker, within `docs/paper-copper-design-language.md`.
- How the UI prevents **Add comment** on an expanded context line that lies outside the patch hunks (the server rejects it either way).

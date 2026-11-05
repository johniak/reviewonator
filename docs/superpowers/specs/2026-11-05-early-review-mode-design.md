# Early review mode

## Intent

Today the agent reviews the whole pull request first, and the human sees Reviewonator only when every finding is ready. That takes minutes, and the human waits on an empty terminal.

The new **early** mode opens Reviewonator right away with the diff. The human reads the code, writes their own comments, and asks the AI questions while the agent is still reviewing. The agent first sends the short **About this PR** note, and then all findings at once when its review is finished. Nothing the human did in the meantime is lost.

The current behavior stays and is called the **full** mode.

## Decisions made with the user

- Two modes: **full** (today's behavior) and **early** (the app opens at once and fills in).
- The user picks a default mode in `reviewonator setup`. A run of the skill may name a mode; without one, the default applies.
- The setup question describes both modes exactly, in plain words.
- `reviewonator update` asks the same question once, when the saved configuration has no mode yet. It still never asks again for targets or languages.
- When nobody can be asked (no terminal, the automatic skill sync before a review, or a plain `brew upgrade`), the mode is **full** until the user runs `reviewonator setup`.
- In early mode the agent **starts with the About this PR note**, so it appears as soon as possible. The place where it will appear shows a spinner until then.
- **Findings arrive once, at the end** of the agent's review, not in batches. The skill's rule that the whole review ledger is finished before any JSON is written stays.
- While the agent reviews, the user may write comments, start discussions, and reply. Those messages are **queued** and reach the agent only when it has delivered its findings. The UI says so clearly.
- **Publishing is blocked** until the agent has delivered its findings. Cancel stays available.
- The UI shows **how long the review has been running**, and says plainly what to do if the agent has stopped.

## Behavior

### Choosing the mode

`reviewonator setup` asks, after the languages:

```
Default review mode:
  1) Full: the agent reviews the whole pull request first, and Reviewonator
     opens when every finding is ready.
  2) Early: Reviewonator opens right away with the diff. The About this PR
     note appears after a moment and the AI findings when the agent finishes.
     Meanwhile you can read the code and write comments; questions to the AI
     wait until it finishes, and publishing waits too.
Select a mode [1]:
```

It asks on the first install, with `--reconfigure`, and whenever the saved configuration has no mode. A `--mode full|early` option and a `REVIEWONATOR_MODE` variable answer it without a prompt, as the language options do. A non-interactive setup with no saved mode and no option saves nothing for the mode, and the skill gets **full**.

`reviewonator update` runs the new executable's `setup`, so the missing-mode question appears there. Since 0.13.1 that child process gets the terminal's input, so `setup` sees itself as interactive.

`reviewonator update` runs the code of the version being replaced, so an update from 0.13.0 or earlier starts `setup` with closed input and cannot ask. For that case, a `setup` that has no saved mode and cannot ask prints one line: "New: early review mode. Choose it with reviewonator setup --reconfigure". *(Decided with the user.)*

The skill carries the default in a marker line, like the languages, which `setup` and the skill sync rewrite:

```
Review mode configuration: the default review mode is full.
```

The skill reads an optional mode word after the pull request URL: `/reviewonator <PR_URL> early` or `/rr <PR_URL> full`. Without one it uses the marker's mode.

### Starting an early review

The skill, in early mode:

1. Checks the prerequisites and loads the pull request metadata, the diff, and the ticket, as in steps 1 to 3 today.
2. Writes a starting review file with the configured languages, an empty summary, the `COMMENT` recommendation, and no comments, then starts `reviewonator <PR_URL> --review-file <JSON_PATH> --early` in the background. `--early` implies `--live`.
3. Writes the About this PR note into the file and runs `reviewonator deliver <PR_URL> --review-file <JSON_PATH>`.
4. Does the whole review exactly as today: every pass, the ledger, and verification.
5. Writes the summary, the recommendation, and every finding into the file and runs `reviewonator deliver <PR_URL> --review-file <JSON_PATH> --final`.
6. Continues with the usual `wait` and `respond` loop.

A full-mode run is unchanged.

### What the human sees while the agent reviews

- The diff, file list, commits, and PR discussion load at once.
- **About this PR** shows a spinner and "The AI is reading the pull request" until the first delivery. Then it shows the note, and the authors line, as usual.
- The review panel shows a spinner, "The AI is reviewing this pull request", and the elapsed time (for example `4:12`). After 15 minutes it adds: "If the agent has stopped, cancel this review and run the skill again." *(Builder's call: 15 minutes.)*
- The live badge reads "AI reviewing".
- The user can add their own comments, edit or delete them, include or reject them, and open a discussion on a diff line or on their own comment. Every **Send to AI** button reads **Queue for AI**. A message that was sent stays visible on its card with a "Queued, sent when the AI finishes its review" label. The review panel's send button sends all unsent messages to the queue the same way.
- **Publish review** is disabled, with the reason "Available when the AI finishes its review".
- **Cancel** works as today and ends the session.

When the final delivery arrives, the findings appear, sorted as usual, next to the user's own comments. The queued messages go to the agent at once, the labels change to the usual "AI agent is responding", and from then on the session behaves exactly like a live session today.

## Protocol

### Session state

`ReviewSession` gains a reviewing state, on only for an early session and only until the final delivery. `snapshot()` reports it, together with the time the session started, so the UI can show the spinner, the timer, and the queued labels. *(Field names are the builder's call.)*

### `reviewonator deliver`

A new agent command and endpoint (`POST /api/agent/deliver`), authenticated with the session token from the live state file, like `respond`.

It is accepted only while the session is reviewing. It reads a full review document and merges it into the session:

- `prUrl` and `languages` must match the session, as in `respond`.
- The agent's document may contain only agent findings: no `author: "user"`, no `edited`, no IDs starting with `H`, every finding pending, and no discussion. Its `userThreads` must be empty. Line findings pass `validateReviewLocations` as at startup.
- **Without `--final`**, the document must have no comments. The session takes its `briefing`, and its `summary` when not empty. It stays in the reviewing state.
- **With `--final`**, the session takes the `briefing` (keeping the earlier one when the document has none), the `summary`, the `recommendation`, and the agent's findings. Then the reviewing state ends.
- The session always keeps its own user comments, user threads, include and reject decisions, viewed files, and every message the user wrote. The agent cannot see those, so they are never an error.

`deliver` outside the reviewing state fails with a clear message. `respond` during the reviewing state fails too, because no request has been released yet.

### The queue while reviewing

Today a live session refuses a second **Send to AI** while one request is waiting. While reviewing, every send is accepted. The session writes the user's message into the review at once, as today, so it appears on its card, and merges the request into one queued request. `wait` does not return it during the reviewing state. After the final delivery, the queued request is released as the next agent request, and `wait` returns it with the full current review, as today. The usual rule then applies: one request at a time.

Each discussion keeps today's rule: once the user's message on a discussion is queued, that discussion takes no further message until the agent replies, and its reply field shows the queued label instead. Other discussions can still be queued. So the merged request names each discussion at most once, and the agent still appends exactly one reply to each. *(Our call: this keeps the alternating message schema and the agent rules unchanged. How to merge the request lists is the builder's call.)*

### Cancelling during the review

If the user cancels while the agent is still reviewing, the session closes as today and saves the `cancelled` result in the live state file.

- A later `deliver` on that session prints the `cancelled` result, clears the state file, and exits successfully. The skill then reports that nothing was published and stops.
- A new start of Reviewonator for the same pull request, in either mode, may replace a leftover `cancelled` result, because nothing is lost: there was nothing to publish. Any other leftover result still blocks a new start as today. This is what makes the 15-minute hint ("cancel this review and run the skill again") work after the agent has died. *(Our call.)*

### `wait` during the reviewing state

`wait` blocks during the reviewing state, as it does when there is no request. The skill never calls it before the final delivery.

## Documentation and skill

- `skills/reviewonator/SKILL.md`: the mode marker, the mode word after the URL, the early workflow above, and the rule that in early mode the About this PR note comes first.
- `skills/reviewonator/references/review-schema.md`: the starting file and both `deliver` calls, and the fact that Reviewonator keeps the user's comments and threads.
- `README.md` and `docs/features.md`: both modes, how to choose one, and what the human sees during an early review.
- `CLAUDE.md`: the reviewing state in the architecture section.
- The skill and docs tests assert the new sentences, as they do today.

## Goals, non-goals, anti-goals

Goals:

- The human sees the diff within seconds of starting the skill in early mode.
- No user action taken during the review is lost or overwritten by the agent's delivery.
- It is always clear whether a message has reached the agent or is waiting.

Non-goals:

- Findings in batches. They arrive once.
- Resuming an early review after the agent crashed. The user cancels and runs the skill again.
- Early mode without live mode.

Anti-goals:

- A shorter or shallower review because the app is already open. The agent's review process is exactly the same in both modes.
- Publishing anything before the agent's findings have arrived.

## Tests

- Config and setup: the mode question and its text, `--mode`, `REVIEWONATOR_MODE`, the question appearing only when the mode is missing, a non-interactive setup without a mode, and the marker line rewritten in the installed skill.
- Update: the new executable's `setup` asks for a missing mode.
- Session: the reviewing state; `deliver` with and without `--final`; the rejection of user-owned comments, threads, decisions, or discussions in a delivery; keeping user comments and threads made before each delivery; queued sends merged and released after the final delivery; `respond` and publish refused while reviewing.
- CLI end to end with the fake `gh`: `--early`, `deliver`, `deliver --final`, then `wait` returning the queued request.
- Web: the spinners, the timer and its 15-minute hint, **Queue for AI**, the queued labels, the disabled publish button, and the findings appearing after the final delivery.
- Skill and docs: the new literal sentences.

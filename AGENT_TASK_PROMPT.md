# Agent benchmark task: build Reviewonator

You are responsible for designing and implementing a complete, installable application called **Reviewonator**. Work autonomously: inspect the repository first, make reasonable product and technical decisions, implement the solution, test it, and provide concise instructions for running and verifying it.

Do not merely prepare a plan or a prototype. Deliver a working application.

## Product goal

Reviewonator is a local, human-in-the-loop interface for AI-generated GitHub pull request reviews. Its interaction model should be inspired by tools such as Planonator: an AI agent performs the analysis, then opens a polished browser UI where a human can inspect, edit, select, and explicitly publish the result.

The first supported agent is **Claude Code**. Keep future Codex support possible without implementing it now.

The workflow starts when a user invokes a Claude Code skill with a GitHub pull request URL. The user must already have an authenticated GitHub CLI (`gh`) installation.

## Required workflow

1. The Claude Code skill accepts a GitHub pull request URL.
2. It verifies that `gh` and Reviewonator are installed and that `gh` is authenticated.
3. The agent reviews the pull request according to strict review guidelines and produces a documented, validated structured result, such as JSON.
4. The skill launches Reviewonator and waits for its structured result.
5. Reviewonator opens a local browser UI showing the PR and the proposed review.
6. The user can either:
   - revise selected AI findings and return structured revision instructions to the agent;
   - cancel without publishing anything; or
   - explicitly confirm and publish a selected review to GitHub.
7. When revision is requested, the skill updates only the requested findings, re-validates them, and launches the UI again.

The skill must never publish a review directly. Only Reviewonator may publish, and only after explicit confirmation in the UI.

You may inspect an existing local review skill for ideas when one is available. Do not modify it. Create a new distributable Reviewonator skill inside this project.

## Review quality requirements

The skill must instruct the agent to:

- read repository instruction files and the complete PR context;
- inspect all changed files and enough surrounding code to understand the changes;
- review only behavior introduced or modified by the PR;
- check correctness, security, privacy, data integrity, concurrency, performance, compatibility, maintainability, and tests when relevant;
- verify findings against the base version and affected call sites;
- check existing PR discussion and avoid duplicate findings;
- report only actionable, high-confidence problems;
- attach inline findings only to valid added diff lines;
- use a general comment when a finding cannot be attached inline;
- explain the concrete consequence and the required change;
- write the canonical GitHub comment in natural, direct English;
- add a separate Polish explanation for the person performing the review.

Every specific and general finding must contain two distinct pieces of content:

1. **Canonical comment** — an English, colleague-to-colleague comment intended for the PR author. This is the only finding text that may be published to GitHub.
2. **Reviewer explanation** — a private Polish explanation intended for the person using Reviewonator, not for the PR author. It must explain **Co** jest nie tak lub co należy zmienić oraz **Dlaczego** ma to znaczenie, including the concrete consequence. It must add understanding rather than merely translate the English sentence.

Represent both values explicitly in the structured review schema. Do not concatenate them into one comment and do not rely on parsing presentation formatting such as emoji or `🇵🇱` prefixes.

Each finding needs a stable ID and a visible severity. Support at least:

- `security`
- `bug`
- `warning`
- `suggestion`
- `nit`

The structured review must also contain a summary and a recommended GitHub review decision.

## Browser UI requirements

The application must be visually polished, coherent, and entirely in English.

It must show:

- PR number, title, additions, deletions, and a link to the PR;
- the list of changed files;
- PR commits with links to GitHub;
- inline AI findings placed at the corresponding changed lines;
- general review comments;
- severity for every finding;
- the English canonical comment and the separate Polish reviewer explanation for every finding;
- the AI summary and recommended review decision.

The UI must visually distinguish the two texts and make it unambiguous that the Polish explanation is private context for the reviewer and will not be sent to the PR author. Interface labels and controls remain in English; only the generated reviewer-explanation content is in Polish.

The user must be able to:

- switch between a single-file view and an **All files** view where every changed file is stacked vertically for continuous scrolling;
- switch between **Unified** and side-by-side **Split** diffs;
- open the complete file on GitHub;
- include or exclude individual findings from the review;
- request a revision for an individual finding and provide a written instruction;
- edit the general review body before publishing;
- choose the final GitHub review event supported by GitHub: `COMMENT`, `APPROVE`, or `REQUEST_CHANGES`;
- see an exact final preview of the body, decision, and selected comments;
- publish only after a separate, unambiguous confirmation action.

The final publication preview must show only content that will actually be sent to GitHub. Polish reviewer explanations must never be included in a GitHub review payload.

## Expandable diff context

The patch returned by GitHub normally contains only a few surrounding lines. Add on-demand context expansion similar to GitHub:

- the user can reveal 10 additional lines above or below a diff hunk;
- expansion works in Unified and Split modes and in Single file and All files views;
- fetch exact old and new file contents through the authenticated `gh` CLI or GitHub API;
- do not ask the user to copy a token and do not expose a GitHub token to browser code;
- keep GitHub access in the local backend;
- load context lazily so a large PR does not immediately fetch every complete file;
- cache repeated context requests for the same file;
- handle renamed, added, deleted, missing, binary, and impractically large files gracefully;
- retain a direct GitHub link as the fallback for viewing the entire file.

Use an established diff library that already supports expandable hunks instead of implementing a diff engine from scratch.

## GitHub publication and safety

- Use the user's existing authenticated `gh` session.
- Bind the local application to loopback only.
- Protect local HTTP endpoints against unrelated local pages or processes making unauthorized requests.
- Validate all data received from the skill and the UI.
- Before publication, verify that the PR head revision has not changed since the review was generated.
- Publish the confirmed selection as one GitHub pull request review.
- Publish only canonical English comments; keep Polish reviewer explanations local to the Reviewonator session.
- Never publish on initial page load, selection, or the first publish button click.
- Fail safely: errors must leave the review unpublished and allow the user to understand what happened.

## Distribution

This must be installable by other users, not tied to one machine.

Provide:

- the Reviewonator application and CLI;
- the Claude Code skill as project source;
- an installation script that installs the executable and skill to user-selected destinations while offering sensible defaults;
- an uninstall script that removes only the files installed by Reviewonator;
- prerequisite checks and clear error messages;
- concise usage and verification instructions.

Do not silently modify an unrelated existing skill or overwrite user files without confirmation.

## Engineering rules

- Design for testability from the start.
- Prefer the smallest practical implementation while keeping the code clean, readable, and maintainable.
- Use mature libraries for solved problems instead of reinventing them.
- All user-facing content and the entire application UI must be in English.
- Cover all application behavior with tests.
- Prefer tests of real behavior and real boundaries. Mock only when there is no practical alternative, never for convenience.
- Do not weaken tests to make the implementation pass.
- Preserve unrelated user changes in the working tree.

## Definition of done

The task is complete only when:

- the end-to-end Claude Code → Reviewonator → revision/cancel/publish protocol works;
- publication cannot happen without explicit human confirmation;
- every general and inline finding has a tested English canonical comment and private Polish reviewer explanation, and only the English content can be published;
- all required diff modes and expandable context work together;
- installation and uninstallation are tested;
- the full automated test suite, type checking, and production build pass;
- the final UI has been exercised in a real browser, including the confirmation dialog and all combinations of file and diff modes;
- you provide exact commands for installing, running, testing, and uninstalling the result.

When finished, summarize the architecture, important safety decisions, test coverage, and any genuine limitations. Do not claim completion for behavior you have not verified.

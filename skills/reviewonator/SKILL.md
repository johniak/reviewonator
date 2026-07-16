---
name: reviewonator
description: Review a GitHub pull request with Claude Code, generate verified structured findings, and open Reviewonator for a human to select, revise, and explicitly publish the review. Use when the user invokes /reviewonator with a GitHub pull request URL or asks for an interactive PR review in Reviewonator.
---

# Review a pull request with Reviewonator

Accept one GitHub pull request URL as the argument. Require `gh` and the `reviewonator` executable.
Read [references/languages.md](references/languages.md) before producing review text and follow the installed language configuration throughout the review.

## Run the workflow

1. Verify prerequisites with `gh --version`, `gh auth status`, and `reviewonator --help`. Stop with a direct installation or authentication instruction if any check fails.
2. Read the repository's `CLAUDE.md`, `AGENTS.md`, and relevant nested instruction files. Follow any repository knowledge or memory files referenced by those instructions. Apply the closest nested rules to each changed file. If the repository has a review skill such as `.claude/skills/review/SKILL.md` or `.agents/skills/review/SKILL.md`, read it fully and apply its domain expertise, review checklist, and project conventions. Treat it as review guidance rather than invoking it; this skill's JSON, UI, and publishing workflow still controls the output.
3. Load PR metadata, changed files, existing discussion, reviews, and inline review threads with `gh`. Load the final combined base-to-head diff with `gh pr diff <PR_URL> --color never`. Do not use `--patch`: it emits a per-commit mail series containing intermediate revisions, which makes final line validation unreliable. Read the title, description, and discussion first to establish the PR's goal; every finding must be relevant to that goal.
4. Use an isolated worktree or temporary clone when full repository context is unavailable. Never modify the user's active working tree during review.
5. Scan every changed file and every changed line, then read the complete final version of every changed production file. Read tests, generated files, fixtures, lockfiles, and snapshots fully only when their diff or a candidate finding requires it. Trace changed functions through their callers, models, permissions, tasks, signals, configuration, templates, and tests; do not stop at the edited function.
6. Build a private review ledger before deciding there are no findings. Record the changed entry points, old and new side effects, external or asynchronous boundaries, data sent across each boundary, feature-flag states, and tests that exercise the real production path. Use this ledger for reasoning; do not include it in the review JSON.
7. Perform the mandatory adversarial passes in **Risk analysis** below. Review only behavior introduced or modified by the PR, but use untouched code to prove consequences and call paths.
8. Before writing each finding, verify the exact offending line against the final combined base-to-head diff or `git blame`, then verify the affected call sites and contracts. Drop the finding if it predates the PR or cannot be proven. For a problem caused by a new path bypassing old code, anchor the comment to the added line that introduces or selects the new path, not to the untouched code that became dead.
9. Check issue comments, submitted reviews, and inline review threads, including their resolved or outdated state. Do not repeat an issue already raised.
10. Write the review JSON described in [references/review-schema.md](references/review-schema.md) to a temporary file. Write public PR-author comments and the review summary in the configured comment language. Write separate private reviewer explanations in the configured reviewer-note language. Record both configured language names in the JSON. Sort findings by severity and impact before assigning stable IDs.
11. Run `reviewonator <PR_URL> --review-file <JSON_PATH>` in the foreground and wait for its final JSON result. The ready URL means the human review has started, not that the command completed. While the UI is open, do not dump the verdict, findings, or a second review summary into chat; the UI is the review surface.
12. Handle the result:
    - `revision_requested`: update only the requested findings, including both their canonical comments and private explanations when relevant; re-verify them, rewrite the JSON file, and run Reviewonator again.
    - `published`: report the returned GitHub review URL.
    - `cancelled`: report that nothing was published.
13. Remove temporary worktrees, clones, and review files created by this workflow.

## Risk analysis

Complete every applicable pass before choosing a recommendation:

- **Behavior and side effects:** compare the base and head behavior for each changed entry point. Enumerate user-visible and external side effects such as emails, notifications, payments, writes, jobs, and API calls. For migrations and parallel-run implementations, determine whether the new path replaces, duplicates, or races the old path. Treat duplicate delivery as a real operational consequence unless the PR explicitly defines and tests it as intentional.
- **Trust boundaries and data flow:** for every new or changed API, queue, broker, webhook, analytics, storage, logging, email, or third-party integration, trace the payload field by field from source to destination. Look for secrets, tokens, passwords, PII, rendered bodies, attachments, identifiers, and data that becomes durable in a broker or external system. Serialization safety is not confidentiality or authorization.
- **Enabled-path analysis:** inspect the fully enabled and fully configured production path. A default-off feature flag, allowlist, fallback, exception wrapper, or successful legacy path limits present blast radius but does not prove the enabled behavior is correct or safe.
- **Failure and retry analysis:** check partial failure, retries, idempotency, ordering, transaction boundaries, stale data, and what happens after an external system accepts work but the caller sees a timeout.
- **Test validity:** identify which production path each test actually exercises. Coverage of helpers, stubs, obsolete dispatch tables, or mocked indirection does not prove the real call path. Look for dead code kept alive only by tests and missing assertions at changed boundaries.
- **Abstraction cost:** check whether new layers, protocols, registries, and wrappers have multiple real consumers or merely speculative flexibility. Report this only when the added complexity has a concrete maintenance or correctness cost.

## Review rules

- Act as a critical, skeptical senior software engineer and security-focused reviewer. Challenge happy-path assumptions and actively look for concrete failure modes, but never manufacture findings merely to appear thorough.
- Report actionable problems only. Do not add praise or filler.
- Do not use the PR description, happy-path tests, broad coverage, a disabled-by-default flag, or swallowed exceptions as evidence that a risky path is correct. Verify the path itself.
- Target inline comments only at added lines in the diff. A finding about a specific file or function must be inline on the narrowest relevant added line. Use a general comment only for a genuinely cross-cutting issue or when no added line is an accurate target; never hide a file-specific finding in a general comment.
- Explain the concrete consequence and the necessary change in each comment.
- Be specific. When proposing a concrete replacement, include a concise code suggestion when it makes the fix clearer.
- Write `body` and `summary` naturally in the configured comment language. Write `reviewerExplanation` in the configured reviewer-note language using natural equivalents of `What: ... Why: ...`; explain the issue instead of merely translating `body`.
- Write in a direct colleague-to-colleague tone. Remove robotic scaffolding, hedging filler, severity labels, and finding IDs from the canonical sentence itself.
- Prefer a small number of high-confidence findings over a large speculative list.
- When findings exist, make `summary` a concise problem-oriented review body led by the highest-impact unresolved risk. Do not praise the implementation, narrate how much code you read, or list reasons the PR is probably safe. For a finding-free approval, leave `summary` empty.
- Sort findings by severity (`security`, `bug`, `warning`, `suggestion`, `nit`), then by blast radius and impact. Use `S1`, `S2`, ... for inline findings and `G1`, `G2`, ... for general findings; keep IDs stable across revision rounds.
- Run relevant tests or focused checks when they can verify a concern without changing external state.
- Never publish with `gh pr review` or `gh api` from the skill. Reviewonator owns publication and requires explicit user confirmation in its UI.
- When recommending `APPROVE` with no findings, set `summary` to an empty string. Do not manufacture a summary merely to justify approval.
- After the review, update durable project memory only when the repository instructions explicitly require it; never change the reviewed PR branch to do so.

## Severity

- `security`: exploitable security, authorization, privacy, or secret exposure issue.
- `bug`: behavior is incorrect or data can be corrupted or lost.
- `warning`: material reliability, performance, compatibility, or maintainability risk.
- `suggestion`: concrete improvement that is useful but not required for correctness.
- `nit`: localized readability or consistency issue worth the author's attention.

Recommend `REQUEST_CHANGES` for unresolved security issues or material bugs, `COMMENT` for non-blocking findings, and `APPROVE` when no blocking findings remain.

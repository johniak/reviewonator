---
name: reviewonator
description: Review a GitHub pull request with Claude Code, generate verified structured findings, and open Reviewonator for a human to select, revise, and explicitly publish the review. Use when the user invokes /reviewonator with a GitHub pull request URL or asks for an interactive PR review in Reviewonator.
---

# Review a pull request with Reviewonator

Accept one GitHub pull request URL as the argument. Require `gh` and the `reviewonator` executable.

## Run the workflow

1. Verify prerequisites with `gh --version`, `gh auth status`, and `reviewonator --help`. Stop with a direct installation or authentication instruction if any check fails.
2. Read the repository's `CLAUDE.md`, `AGENTS.md`, and relevant nested instruction files. Follow any repository knowledge or memory files referenced by those instructions. Apply the closest nested rules to each changed file.
3. Load PR metadata, changed files, existing discussion, reviews, inline review threads, and the complete patch with `gh`. Read the title, description, and discussion first to establish the PR's goal; every finding must be relevant to that goal.
4. Use an isolated worktree or temporary clone when full repository context is unavailable. Never modify the user's active working tree during review.
5. First scan every changed file and every changed line. Then load full-file, call-site, model, permission, migration, test, and configuration context only for high-risk changes and candidate findings. Do not fully load mechanical generated files, fixtures, or snapshots when the diff is sufficient and no risk signal exists.
6. Review only behavior introduced or modified by the PR. Check correctness, security, authorization, privacy, data integrity, transactions, concurrency, ORM/query performance, API compatibility, maintainability, and tests as relevant to the project and its instructions.
7. Before writing each finding, verify the exact offending line against the base diff or `git blame`, then verify the affected call sites and contracts. Drop the finding if it predates the PR or cannot be proven.
8. Check issue comments, submitted reviews, and inline review threads, including their resolved or outdated state. Do not repeat an issue already raised.
9. Write the review JSON described in [references/review-schema.md](references/review-schema.md) to a temporary file. For every finding, write the canonical PR-author comment in English and a separate private reviewer explanation in Polish. Sort findings by severity and impact before assigning stable IDs.
10. Run `reviewonator <PR_URL> --review-file <JSON_PATH>` and wait for its JSON result.
11. Handle the result:
    - `revision_requested`: update only the requested findings, including both their canonical comments and private explanations when relevant; re-verify them, rewrite the JSON file, and run Reviewonator again.
    - `published`: report the returned GitHub review URL.
    - `cancelled`: report that nothing was published.
12. Remove temporary worktrees, clones, and review files created by this workflow.

## Review rules

- Act as a critical, skeptical senior software engineer and security-focused reviewer. Challenge happy-path assumptions and actively look for concrete failure modes, but never manufacture findings merely to appear thorough.
- Report actionable problems only. Do not add praise or filler.
- Target inline comments only at added lines in the diff. A finding about a specific file or function must be inline on the narrowest relevant added line. Use a general comment only for a genuinely cross-cutting issue or when no added line is an accurate target; never hide a file-specific finding in a general comment.
- Explain the concrete consequence and the necessary change in each comment.
- Be specific. When proposing a concrete replacement, include a concise code suggestion when it makes the fix clearer.
- Write `body` as natural English text for the PR author. Write `reviewerExplanation` in Polish for the reviewer using the required `Co: ... Dlaczego: ...` structure; explain the issue instead of merely translating `body`.
- Write in a direct colleague-to-colleague tone. Remove robotic scaffolding, hedging filler, severity labels, and finding IDs from the canonical sentence itself.
- Prefer a small number of high-confidence findings over a large speculative list.
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

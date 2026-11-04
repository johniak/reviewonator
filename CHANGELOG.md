# Changelog

Each release's notes on GitHub come from its section below. Releases before 0.11.0 are listed on the [releases page](https://github.com/johniak/reviewonator/releases).

## 0.13.0 - 2026-11-04

### Added

- **Settings** (the gear button in the header) lets you pick the colour theme: **Paper Copper**, the default, or **Slate**, with cool grey surfaces, a blue accent, and classic green and red diffs. Each theme previews its light and dark colours, and Reviewonator remembers the choice for the next review.

### Changed

- The copper accent in the dark Paper Copper theme is softer, so primary buttons and links no longer glow.

## 0.12.1 - 2026-11-04

### Fixed

- `reviewonator update` runs `brew update` before `brew upgrade`, so a Homebrew installation finds a new release even when Homebrew has not refreshed the tap yet.

## 0.12.0 - 2026-11-03

### Added

- In every message to the AI agent, **Enter** sends it and **Shift+Enter** starts a new line.
- A reply in your own discussion has its own **Send to AI** button, so it no longer waits for the button in the review panel.
- Comments, private explanations, discussion messages, the review summary, and **About this PR** render Markdown the way GitHub does, including code blocks. A GitHub `suggestion` block is labelled **Suggested change**.

### Fixed

- The Homebrew instructions trust the tap before installing, which recent Homebrew versions require.

## 0.11.0 - 2026-11-03

### Added

- **About this PR**: a private note of at most 100 words, in your reviewer-note language, above the diff. The agent writes it from the ticket and the code that actually changed, not from the author's description, and says where the two differ. Collapse it to one line once you have read it; Reviewonator remembers that for the pull request.
- Write your own comments: click **+** beside any diff line, on either side, and choose **Add comment**. Your comments are marked **You** and are published like any selected finding.
- Edit any comment with the pencil on its card. The agent keeps your wording across rounds unless you discuss that comment with it, and an AI finding you changed is marked **Edited**.
- **Send to AI** on a single comment sends just that comment to the agent; other unsent messages wait for the button in the review panel.
- Reviewonator remembers the colour theme, the single-file or all-files view, and the unified or side-by-side diff between runs.

### Fixed

- Long file names no longer push the change counts out of the file list.
- The row under an inline comment has the same background as the code above it.

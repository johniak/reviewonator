# Feature guide

Reviewonator is a local, human-in-the-loop workspace for pull request reviews created by an AI agent. The agent investigates the change and proposes findings; you decide what, if anything, reaches GitHub.

## Review the change in context

The workspace keeps the pull request, changed files, findings, and commits in one place. Each inline finding opens the relevant file and line. Severity borders and labels make bugs, warnings, suggestions, security issues, and nits easy to distinguish.

You can:

- review one file at a time or scroll through every changed file;
- switch between unified and side-by-side diffs;
- expand ten lines of context above or below a patch;
- open the complete file or pull request on GitHub;
- navigate directly between findings from the left sidebar;
- start your own private discussion with the AI agent on any diff line.

Context expansion is handled by the local Reviewonator process through your authenticated GitHub CLI session. GitHub credentials are never sent to the browser.

![Changed code with inline AI findings and private reviewer context](assets/reviewonator-diff.png)

## Discuss your own concerns with the AI agent

Click **+** beside a diff line to add your own comment. Reviewonator keeps these conversations in a separate **My comments** section and never publishes them directly to GitHub.

The agent checks the exact code before responding. It can:

- agree, create a normal review finding, and link it to your discussion;
- disagree, explain why, and leave the discussion open for your next reply.

Only you can dismiss a discussion, and Reviewonator requires your reason. Drafts, replies, waiting discussions, linked findings, and dismissed discussions have distinct states in the sidebar, so it is clear who needs to act next.

The workspace stays open while you talk to the agent. After you send a comment, its status changes to **Waiting for agent** and the header shows **AI working**. The agent's reply appears in the same diff and browser session as soon as it is ready. You can continue the conversation for as many rounds as needed before publishing or cancelling the review.

## Decide what happens to every finding

Nothing is included by default. Every proposed comment has an explicit state:

- **Pending** — no decision has been made;
- **Included** — it will appear in the publication preview;
- **Revision requested** — your note is returned to the AI agent for another pass;
- **Rejected** — you consciously chose not to publish it.

These decisions persist when the AI agent returns a revised review, so accepted work is not lost. Public GitHub wording stays separate from the private reviewer note. The private note explains the issue in the configured reviewer language and is never published.

Each proposed finding also supports a private live discussion. Ask the agent about its evidence, challenge its conclusion, or request clearer wording. Your message and the agent's response remain visible below the finding, while the agent can update the proposed GitHub comment when the discussion changes the result. The browser stays open for every follow-up round, and the private conversation is never included in the published review.

Use **Send to AI** on the finding card to send only that reply. The bottom action remains available when you deliberately want to send several prepared discussions together.

![Live private discussion with the AI agent beside the changed code](assets/live-finding-discussion.png)

## Read the existing pull request discussion

The **PR discussion** tab brings the conversation already on GitHub into the workspace. It includes conversation comments, submitted reviews, and inline review comments, with direct links back to their GitHub locations.

![Existing GitHub pull request discussion beside the changed code](assets/pr-discussion.png)

## Preview and publish deliberately

The final dialog shows the exact review that Reviewonator is prepared to send. You can choose the GitHub event — **Comment**, **Approve**, or **Request changes** — and inspect the selected comments in a scrollable list. The review summary is optional, including for approvals.

Publication requires a separate confirmation checkbox. Closing the dialog or cancelling the review publishes nothing.

![Final Reviewonator publication confirmation](assets/reviewonator-overview.png)

## Use the same workflow with Claude Code or Codex

The installer can target Claude Code, Codex, or both. It also configures the language used for public comments and the separate language used for private reviewer notes; both default to English. The review schema and human confirmation flow remain the same across supported agents.

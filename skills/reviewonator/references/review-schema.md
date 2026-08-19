# Review JSON contract

Write UTF-8 JSON matching this shape:

```json
{
  "version": 2,
  "prUrl": "https://github.com/acme/widgets/pull/42",
  "languages": {
    "comments": "English",
    "reviewerNotes": "English"
  },
  "summary": "The retry change can duplicate successful payments after a timeout.",
  "recommendation": "REQUEST_CHANGES",
  "userThreads": [
    {
      "id": "U1",
      "path": "src/payments/retry.ts",
      "line": 87,
      "side": "RIGHT",
      "findingId": "S1",
      "messages": [
        {
          "id": "U1-M1",
          "author": "user",
          "body": "Can this retry charge the customer twice?"
        },
        {
          "id": "U1-M2",
          "author": "agent",
          "body": "Yes. A timeout can happen after the provider accepts the charge, so I added finding S1."
        }
      ]
    }
  ],
  "comments": [
    {
      "id": "S1",
      "type": "line",
      "severity": "bug",
      "included": true,
      "path": "src/payments/retry.ts",
      "line": 87,
      "side": "RIGHT",
      "body": "A timeout does not prove the charge failed. Retrying here without an idempotency key can create a second successful payment. Reuse a stable idempotency key across attempts.",
      "reviewerExplanation": "What: Every payment attempt must reuse the same idempotency key. Why: A timeout does not prove the first charge failed, so retrying without that safeguard can charge the customer twice.",
      "discussion": [
        {
          "id": "S1-D1",
          "author": "user",
          "body": "Did you check whether the provider already handles retries?"
        },
        {
          "id": "S1-D2",
          "author": "agent",
          "body": "Yes. This client does not send the provider's idempotency key, so the finding still applies."
        }
      ]
    },
    {
      "id": "G1",
      "type": "general",
      "severity": "warning",
      "body": "The PR changes the retry contract but does not add an integration test for a timeout after the provider accepts the charge.",
      "reviewerExplanation": "What: Add an integration test for a timeout after the provider accepts the payment. Why: Without it, the highest-risk duplicate-charge scenario remains unverified."
    }
  ]
}
```

## Constraints

- `version` must be `2`.
- `prUrl` must exactly identify the reviewed GitHub PR.
- `languages.comments` and `languages.reviewerNotes` must match the installed language configuration.
- `summary` becomes the editable review body shown on the final confirmation screen. It is always optional and may be an empty string for every recommendation.
- `recommendation` must be `COMMENT`, `APPROVE`, or `REQUEST_CHANGES`.
- `userThreads` contains private conversations started by the user on diff lines. It is never published to GitHub.
- User thread IDs and message IDs must be unique and stable across review rounds. Preserve every earlier message verbatim and append new messages in order.
- A user thread must start with a user message and alternate between `user` and `agent`. An open thread with a final user message requires an agent response in the next review round.
- When the user is correct, append a clear agent response, create a normal review finding, and set `findingId` to that finding's stable ID.
- When the agent disagrees, append a simple explanation and leave `findingId` unset so the user can reply again.
- Only set `dismissed: true` and copy `dismissalReason` for a thread listed in `dismissedThreads` by Reviewonator. The agent must never dismiss a thread itself and must not reply to a dismissal.
- A thread with `findingId` must link to an existing finding and end with an agent response.
- Comment IDs must be unique and stable across revision rounds.
- `type` must be `line` or `general`.
- `severity` must be `security`, `bug`, `warning`, `suggestion`, or `nit`.
- `included` and `rejected` are optional and default to `false`. A new comment with neither flag starts as pending. Set exactly one flag to `true` only when the comment ID appears in the corresponding `selectedCommentIds` or `rejectedCommentIds` returned by Reviewonator during the previous revision round. Never set both flags on one comment.
- A line comment must include `path`, `line`, and `side: "RIGHT"`. The line must be an added line in the current PR diff.
- A general comment must not contain `path`, `line`, or `side`.
- `body` is the exact canonical text proposed for GitHub in the configured comment language.
- `reviewerExplanation` is mandatory private context in the configured reviewer-note language. Use natural equivalents of `What: ... Why: ...` to explain what is wrong or should change and the concrete consequence. It is not a translation and is never published to GitHub.
- `discussion` is an optional private conversation about that finding. It starts with a user message and alternates between `user` and `agent`. Preserve all IDs and earlier messages verbatim. For every finding in `requests`, append exactly one agent response and keep the finding so its discussion remains visible. The agent may update `body` and `reviewerExplanation` when the new evidence changes the finding. Discussion messages are never published to GitHub.
- Use an empty `comments` array when there are no actionable findings.

Reviewonator validates the schema and diff locations before opening the browser. Invalid findings must be corrected, not bypassed.

## Live review rounds

`reviewonator wait <PR_URL>` returns a `revision_requested` object with an authoritative `review` field. That document already includes the user's newest finding-discussion messages, line-comment messages, dismissals, and finding decisions. Use it as the base for the response; do not reconstruct history from the separate request arrays.

Submit the updated document with `reviewonator respond <PR_URL> --review-file <PATH>`. Reviewonator rejects responses that edit or remove user messages, move or create user threads, change user-owned dismissals or finding decisions, or fail to answer a thread whose last message is from the user. A valid response appends exactly one agent message to each waiting thread. The browser receives the accepted document without closing or reopening the session.

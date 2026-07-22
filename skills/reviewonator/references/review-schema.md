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
      "reviewerExplanation": "What: Every payment attempt must reuse the same idempotency key. Why: A timeout does not prove the first charge failed, so retrying without that safeguard can charge the customer twice."
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
- Comment IDs must be unique and stable across revision rounds.
- `type` must be `line` or `general`.
- `severity` must be `security`, `bug`, `warning`, `suggestion`, or `nit`.
- `included` and `rejected` are optional and default to `false`. A new comment with neither flag starts as pending. Set exactly one flag to `true` only when the comment ID appears in the corresponding `selectedCommentIds` or `rejectedCommentIds` returned by Reviewonator during the previous revision round. Never set both flags on one comment.
- A line comment must include `path`, `line`, and `side: "RIGHT"`. The line must be an added line in the current PR diff.
- A general comment must not contain `path`, `line`, or `side`.
- `body` is the exact canonical text proposed for GitHub in the configured comment language.
- `reviewerExplanation` is mandatory private context in the configured reviewer-note language. Use natural equivalents of `What: ... Why: ...` to explain what is wrong or should change and the concrete consequence. It is not a translation and is never published to GitHub.
- Use an empty `comments` array when there are no actionable findings.

Reviewonator validates the schema and diff locations before opening the browser. Invalid findings must be corrected, not bypassed.

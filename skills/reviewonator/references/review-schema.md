# Review JSON contract

Write UTF-8 JSON matching this shape:

```json
{
  "version": 2,
  "prUrl": "https://github.com/acme/widgets/pull/42",
  "summary": "The retry change can duplicate successful payments after a timeout.",
  "recommendation": "REQUEST_CHANGES",
  "comments": [
    {
      "id": "S1",
      "type": "line",
      "severity": "bug",
      "path": "src/payments/retry.ts",
      "line": 87,
      "side": "RIGHT",
      "body": "A timeout does not prove the charge failed. Retrying here without an idempotency key can create a second successful payment. Reuse a stable idempotency key across attempts.",
      "reviewerExplanation": "Co: Ponowne wywołanie płatności musi używać tego samego klucza idempotencji. Dlaczego: Timeout nie oznacza odrzucenia pierwszej operacji, więc bez tego zabezpieczenia klient może zostać obciążony dwukrotnie."
    },
    {
      "id": "G1",
      "type": "general",
      "severity": "warning",
      "body": "The PR changes the retry contract but does not add an integration test for a timeout after the provider accepts the charge.",
      "reviewerExplanation": "Co: Należy dodać test integracyjny timeoutu występującego po przyjęciu płatności przez providera. Dlaczego: Bez niego najbardziej ryzykowny scenariusz podwójnego obciążenia pozostaje niezweryfikowany."
    }
  ]
}
```

## Constraints

- `version` must be `2`.
- `prUrl` must exactly identify the reviewed GitHub PR.
- `summary` becomes the editable review body shown on the final confirmation screen. It may be empty when `recommendation` is `APPROVE`; use an empty string for a finding-free approval.
- `recommendation` must be `COMMENT`, `APPROVE`, or `REQUEST_CHANGES`.
- Comment IDs must be unique and stable across revision rounds.
- `type` must be `line` or `general`.
- `severity` must be `security`, `bug`, `warning`, `suggestion`, or `nit`.
- A line comment must include `path`, `line`, and `side: "RIGHT"`. The line must be an added line in the current PR diff.
- A general comment must not contain `path`, `line`, or `side`.
- `body` is the exact canonical English text proposed for GitHub.
- `reviewerExplanation` is mandatory private Polish context for the reviewer. Use `Co: ... Dlaczego: ...` to explain what is wrong or should change and the concrete consequence. It is not a translation and is never published to GitHub.
- Use an empty `comments` array when there are no actionable findings.

Reviewonator validates the schema and diff locations before opening the browser. Invalid findings must be corrected, not bypassed.

import type { PullRequest } from "../src/domain/pull-request";
import type { ReviewDocument } from "../src/domain/review";

export const prUrl = "https://github.com/acme/widgets/pull/42";

export const patch = `diff --git a/src/example.ts b/src/example.ts
index 1111111..2222222 100644
--- a/src/example.ts
+++ b/src/example.ts
@@ -1,3 +1,4 @@
 export function answer() {
-  return 41;
+  const answer = 42;
+  return answer;
 }
`;

export const pullRequest: PullRequest = {
  additions: 2,
  author: { login: "octocat" },
  baseRefName: "main",
  baseRefOid: "base-sha",
  body: "Make the answer reusable.",
  changedFiles: 1,
  commits: [{
    oid: "head-sha",
    messageHeadline: "Return the correct answer",
    committedDate: "2026-07-14T12:00:00Z",
    authors: [{ login: "octocat" }],
  }],
  deletions: 1,
  files: [{ path: "src/example.ts", additions: 2, deletions: 1 }],
  headRefName: "fix-answer",
  headRefOid: "head-sha",
  number: 42,
  title: "Return the correct answer",
  url: prUrl,
};

export const review: ReviewDocument = {
  version: 2,
  prUrl,
  summary: "The change needs one correction before it is safe to merge.",
  recommendation: "REQUEST_CHANGES",
  comments: [
    {
      id: "S1",
      type: "line",
      severity: "bug",
      path: "src/example.ts",
      line: 2,
      side: "RIGHT",
      body: "This value should come from the caller instead of being hard-coded.",
      reviewerExplanation: "Co: Wartość powinna zostać przekazana przez wywołującego zamiast być wpisana na stałe. Dlaczego: Obecna implementacja zwraca ten sam wynik niezależnie od danych wejściowych.",
    },
    {
      id: "G1",
      type: "general",
      severity: "warning",
      body: "Add a regression test for the public behavior.",
      reviewerExplanation: "Co: Należy dodać test regresyjny publicznego zachowania. Dlaczego: Bez niego kolejna zmiana może ponownie wprowadzić błędny wynik bez wykrycia przez CI.",
    },
  ],
};

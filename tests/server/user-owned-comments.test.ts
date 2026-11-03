// @vitest-environment node

import { describe, expect, it } from "vitest";
import type { ReviewComment } from "../../src/domain/review";
import { mergeAgentComments } from "../../src/server/user-owned-comments";
import { review } from "../fixtures";

const [finding] = review.comments;
const mine: ReviewComment = {
  id: "H1",
  type: "line",
  author: "user",
  path: "src/example.ts",
  line: 2,
  side: "LEFT",
  body: "Keep the old constant for now.",
};
const edited: ReviewComment = { ...finding, body: "Take the value from the caller.", edited: true };
const nothing = new Set<string>();

describe("mergeAgentComments", () => {
  it("keeps a user comment the user did not discuss exactly as the user left it", () => {
    const agentVersion: ReviewComment = { ...mine, body: "Agent rewrite.", severity: "nit" };

    expect(mergeAgentComments([finding, mine], [finding, agentVersion], nothing, nothing)).toEqual([finding, mine]);
  });

  it("keeps the user's wording and edited marker of an edited agent finding", () => {
    const { edited: _edited, ...agentVersion } = { ...edited, body: "Agent wording." };

    expect(mergeAgentComments([edited], [agentVersion], nothing, nothing)).toEqual([edited]);
  });

  it("lets the agent rewrite a user comment the user discussed", () => {
    const discussed: ReviewComment = { ...mine, discussion: [{ id: "H1-D1", author: "user", body: "Is this clear?" }] };
    const { author: _author, ...answered } = {
      ...discussed,
      body: "Keep the old constant until every caller migrates.",
      severity: "warning" as const,
      path: "src/other.ts",
      discussion: [...discussed.discussion!, { id: "H1-D2", author: "agent" as const, body: "I made it more precise." }],
    };

    expect(mergeAgentComments([discussed], [answered], new Set(["H1"]), nothing)[0]).toMatchObject({
      author: "user",
      path: "src/example.ts",
      side: "LEFT",
      body: "Keep the old constant until every caller migrates.",
      severity: "warning",
    });
  });

  it("keeps the edited marker when the agent rewrites a discussed finding", () => {
    const { edited: _edited, ...answered } = { ...edited, body: "Agent wording after discussion." };

    expect(mergeAgentComments([edited], [answered], new Set(["S1"]), nothing)[0])
      .toMatchObject({ body: "Agent wording after discussion.", edited: true });
  });

  it("restores user-owned comments the agent left out", () => {
    expect(mergeAgentComments([edited, mine], [], nothing, nothing)).toEqual([edited, mine]);
  });

  it("drops a user comment the user deleted", () => {
    expect(mergeAgentComments([finding], [finding, mine], nothing, new Set(["H1"]))).toEqual([finding]);
  });

  it("rejects a new comment the agent marks as written by the user", () => {
    expect(() => mergeAgentComments([finding], [finding, mine], nothing, nothing))
      .toThrow("The agent cannot create comment H1 as written by the user.");
  });

  it("rejects a new comment the agent marks as edited", () => {
    expect(() => mergeAgentComments([], [{ ...finding, id: "N1", edited: true }], nothing, nothing))
      .toThrow("Only the user can mark comment N1 as edited.");
  });

  it("ignores author and edited set by the agent on its own existing finding", () => {
    expect(mergeAgentComments([finding], [{ ...finding, author: "user", edited: true }], nothing, nothing)).toEqual([finding]);
  });
});

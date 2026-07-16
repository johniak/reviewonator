import { describe, expect, it } from "vitest";
import { parsePullRequestDiscussion } from "../../src/domain/discussion";

describe("pull request discussion", () => {
  it("normalizes and chronologically combines paginated GitHub discussion sources", () => {
    const discussion = parsePullRequestDiscussion(
      JSON.stringify([[{
        id: 1,
        user: { login: "alice", avatar_url: "https://avatars.example/alice" },
        body: "Conversation comment",
        created_at: "2026-07-14T12:00:00Z",
        html_url: "https://github.com/acme/widgets/pull/42#issuecomment-1",
      }]]),
      JSON.stringify([[{
        id: 2,
        user: { login: "bob", avatar_url: null },
        body: "Please update this.",
        state: "CHANGES_REQUESTED",
        submitted_at: "2026-07-14T12:05:00Z",
        html_url: "https://github.com/acme/widgets/pull/42#pullrequestreview-2",
      }]]),
      JSON.stringify([[{
        id: 3,
        user: null,
        body: "Inline comment",
        created_at: "2026-07-14T12:10:00Z",
        html_url: "https://github.com/acme/widgets/pull/42#discussion_r3",
        path: "src/example.ts",
        line: null,
        original_line: 8,
        side: null,
        original_side: "RIGHT",
        position: null,
        in_reply_to_id: 1,
      }]]),
    );

    expect(discussion.map(({ id }) => id)).toEqual(["conversation-1", "review-2", "inline-3"]);
    expect(discussion[0].author).toEqual({ login: "alice", avatarUrl: "https://avatars.example/alice" });
    expect(discussion[1]).toMatchObject({ kind: "review", state: "CHANGES_REQUESTED" });
    expect(discussion[2]).toMatchObject({
      kind: "inline",
      author: { login: "ghost" },
      path: "src/example.ts",
      line: 8,
      side: "RIGHT",
      outdated: true,
      replyToId: 1,
    });
  });

  it("keeps a bodyless approval because the decision is useful review context", () => {
    const discussion = parsePullRequestDiscussion("[[]]", JSON.stringify([[{
      id: 4,
      user: { login: "alice", avatar_url: null },
      body: null,
      state: "APPROVED",
      submitted_at: "2026-07-14T12:00:00Z",
      html_url: "https://github.com/acme/widgets/pull/42#pullrequestreview-4",
    }]]), "[[]]");

    expect(discussion).toHaveLength(1);
    expect(discussion[0]).toMatchObject({ body: "", state: "APPROVED" });
  });

  it("accepts current inline comments when GitHub omits original_side", () => {
    const discussion = parsePullRequestDiscussion("[[]]", "[[]]", JSON.stringify([[
      {
        id: 3_588_389_185,
        user: { login: "reviewer", avatar_url: null },
        body: "Inline comment",
        created_at: "2026-07-16T09:00:00Z",
        html_url: "https://github.com/acme/widgets/pull/42#discussion_r3588389185",
        path: "src/components/SelectFilter.tsx",
        line: 35,
        original_line: 35,
        side: "RIGHT",
        position: 10,
      },
    ]]));

    expect(discussion).toHaveLength(1);
    expect(discussion[0]).toMatchObject({
      id: "inline-3588389185",
      path: "src/components/SelectFilter.tsx",
      line: 35,
      side: "RIGHT",
    });
  });
});

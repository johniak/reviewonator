import { describe, expect, it } from "vitest";
import type { PullRequest } from "../../src/domain/pull-request";
import type { PublishRequest, ReviewComment } from "../../src/domain/review";
import type { GitHubGateway, LoadedPullRequest, PublishedReview } from "../../src/github/client";
import { ClosedSessionError, ReviewSession, StalePullRequestError } from "../../src/server/session";
import { patch, pullRequest, review } from "../fixtures";

class FakeGitHub implements GitHubGateway {
  headSha = pullRequest.headRefOid;
  published?: { pr: PullRequest; request: PublishRequest; comments: ReviewComment[] };
  contextCalls = 0;

  async verifyPrerequisites() {}
  async loadPullRequest(): Promise<LoadedPullRequest> { return { pullRequest, patch, discussion: [] }; }
  async getHeadSha() { return this.headSha; }
  async loadFileContext() {
    this.contextCalls += 1;
    return { oldContent: "old", newContent: "new" };
  }
  async publishReview(pr: PullRequest, request: PublishRequest, comments: ReviewComment[]): Promise<PublishedReview> {
    this.published = { pr, request, comments };
    return { id: 99, url: "https://github.com/acme/widgets/pull/42#review-99", state: "COMMENTED" };
  }
}

describe("ReviewSession", () => {
  it("returns revision requests to the agent without publishing", async () => {
    const github = new FakeGitHub();
    const session = new ReviewSession(pullRequest, patch, review, github);
    session.requestRevision({ requests: [{ commentId: "S1", message: "Verify the actual caller contract." }] });
    await expect(session.waitForResult()).resolves.toEqual({
      status: "revision_requested",
      selectedCommentIds: [],
      rejectedCommentIds: [],
      requests: [{ commentId: "S1", message: "Verify the actual caller contract." }],
      newComments: [],
    });
    expect(github.published).toBeUndefined();
  });

  it("rejects revision requests for unknown comments", () => {
    const session = new ReviewSession(pullRequest, patch, review, new FakeGitHub());
    expect(() => session.requestRevision({ requests: [{ commentId: "missing", message: "Rewrite it." }] }))
      .toThrow(/Unknown review comment ids/);
  });

  it("returns the deduplicated selection so the next review round can preserve it", async () => {
    const session = new ReviewSession(pullRequest, patch, review, new FakeGitHub());
    session.requestRevision({
      selectedCommentIds: ["S1", "S1"],
      rejectedCommentIds: ["G1", "G1"],
      requests: [{ commentId: "G1", message: "Rewrite this finding." }],
    });

    await expect(session.waitForResult()).resolves.toMatchObject({
      status: "revision_requested",
      selectedCommentIds: ["S1"],
      rejectedCommentIds: ["G1"],
    });
  });

  it("rejects unknown selected comments", () => {
    const session = new ReviewSession(pullRequest, patch, review, new FakeGitHub());
    expect(() => session.requestRevision({
      selectedCommentIds: ["missing"],
      requests: [{ commentId: "S1", message: "Rewrite it." }],
    })).toThrow(/Unknown review comment ids/);
  });

  it("rejects unknown rejected comments", () => {
    const session = new ReviewSession(pullRequest, patch, review, new FakeGitHub());
    expect(() => session.requestRevision({
      rejectedCommentIds: ["missing"],
      requests: [{ commentId: "S1", message: "Rewrite it." }],
    })).toThrow(/Unknown review comment ids/);
  });

  it("returns a user-authored line comment to the agent", async () => {
    const session = new ReviewSession(pullRequest, patch, review, new FakeGitHub());
    const newComment = {
      path: "src/example.ts",
      line: 2,
      side: "RIGHT" as const,
      message: "Verify whether this constant is intentional and rewrite my comment.",
    };
    session.requestRevision({ newComments: [newComment] });

    await expect(session.waitForResult()).resolves.toEqual({
      status: "revision_requested",
      selectedCommentIds: [],
      rejectedCommentIds: [],
      requests: [],
      newComments: [newComment],
    });
  });

  it("rejects user-authored comments outside the pull request", () => {
    const session = new ReviewSession(pullRequest, patch, review, new FakeGitHub());
    expect(() => session.requestRevision({
      newComments: [{ path: "src/missing.ts", line: 1, side: "RIGHT", message: "Check this." }],
    })).toThrow(/outside this pull request/);
  });

  it("publishes only the comments explicitly selected by the user", async () => {
    const github = new FakeGitHub();
    const session = new ReviewSession(pullRequest, patch, review, github);
    const result = await session.publish({
      confirmed: true,
      event: "COMMENT",
      body: "Confirmed body",
      selectedCommentIds: ["S1"],
    });
    expect(result.id).toBe(99);
    expect(github.published?.comments.map(({ id }) => id)).toEqual(["S1"]);
    await expect(session.waitForResult()).resolves.toEqual({ status: "published", review: result });
  });

  it("requires the literal confirmation flag", async () => {
    const session = new ReviewSession(pullRequest, patch, review, new FakeGitHub());
    await expect(session.publish({
      confirmed: false,
      event: "COMMENT",
      body: "Body",
      selectedCommentIds: [],
    })).rejects.toThrow();
  });

  it("publishes an approval with an empty body", async () => {
    const github = new FakeGitHub();
    const session = new ReviewSession(pullRequest, patch, review, github);
    await session.publish({
      confirmed: true,
      event: "APPROVE",
      body: "",
      selectedCommentIds: [],
    });
    expect(github.published?.request.body).toBe("");
  });

  it("allows an empty user summary for a non-approval review", async () => {
    const github = new FakeGitHub();
    const session = new ReviewSession(pullRequest, patch, review, github);
    await expect(session.publish({
      confirmed: true,
      event: "REQUEST_CHANGES",
      body: "",
      selectedCommentIds: [],
    })).resolves.toBeDefined();
    expect(github.published?.request.body).toBe("");
  });

  it("blocks publication when the PR head changed", async () => {
    const github = new FakeGitHub();
    github.headSha = "new-head";
    const session = new ReviewSession(pullRequest, patch, review, github);
    await expect(session.publish({
      confirmed: true,
      event: "COMMENT",
      body: "Body",
      selectedCommentIds: [],
    })).rejects.toBeInstanceOf(StalePullRequestError);
    expect(github.published).toBeUndefined();
  });

  it("cannot complete a session twice", () => {
    const session = new ReviewSession(pullRequest, patch, review, new FakeGitHub());
    session.cancel();
    expect(() => session.cancel()).toThrow(ClosedSessionError);
  });

  it("loads and caches full file context only for changed files", async () => {
    const github = new FakeGitHub();
    const session = new ReviewSession(pullRequest, patch, review, github);
    await Promise.all([
      session.loadFileContext("src/example.ts"),
      session.loadFileContext("src/example.ts"),
    ]);
    expect(github.contextCalls).toBe(1);
    expect(() => session.loadFileContext("src/secret.ts")).toThrow(/not part of this pull request/);
  });
});

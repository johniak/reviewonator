import { describe, expect, it } from "vitest";
import type { PullRequest } from "../../src/domain/pull-request";
import { reviewDocumentSchema, type PublishRequest, type ReviewComment } from "../../src/domain/review";
import type { GitHubGateway, LoadedPullRequest, PublishedReview } from "../../src/github/client";
import { ClosedSessionError, CommentChangeError, ReviewSession, StalePullRequestError } from "../../src/server/session";
import { patch, pullRequest, review, userThread } from "../fixtures";

class FakeGitHub implements GitHubGateway {
  headSha = pullRequest.headRefOid;
  published?: { pr: PullRequest; request: PublishRequest; comments: ReviewComment[] };
  contextCalls = 0;

  async verifyPrerequisites() {}
  viewedCalls: Array<{ path: string; viewed: boolean }> = [];
  viewedError?: Error;

  async loadPullRequest(): Promise<LoadedPullRequest> { return { pullRequest, patch, discussion: [], viewedFiles: [] }; }
  async getHeadSha() { return this.headSha; }
  async loadFileContext() {
    this.contextCalls += 1;
    return { oldContent: "old", newContent: "new" };
  }
  async publishReview(pr: PullRequest, request: PublishRequest, comments: ReviewComment[]): Promise<PublishedReview> {
    this.published = { pr, request, comments };
    return { id: 99, url: "https://github.com/acme/widgets/pull/42#review-99", state: "COMMENTED" };
  }
  async setFileViewed(_pr: PullRequest, path: string, viewed: boolean) {
    if (this.viewedError) throw this.viewedError;
    this.viewedCalls.push({ path, viewed });
  }
}

describe("ReviewSession", () => {
  it("starts with the files GitHub already marks as viewed for this user", () => {
    const session = new ReviewSession(pullRequest, patch, review, new FakeGitHub(), [], false, ["src/example.ts"]);

    expect(session.snapshot().viewedFiles).toEqual(["src/example.ts"]);
  });

  it("marks and unmarks a file as viewed on GitHub", async () => {
    const github = new FakeGitHub();
    const session = new ReviewSession(pullRequest, patch, review, github);

    await expect(session.setFileViewed({ path: "src/example.ts", viewed: true })).resolves.toEqual(["src/example.ts"]);
    expect(session.snapshot().viewedFiles).toEqual(["src/example.ts"]);
    await expect(session.setFileViewed({ path: "src/example.ts", viewed: false })).resolves.toEqual([]);
    expect(github.viewedCalls).toEqual([
      { path: "src/example.ts", viewed: true },
      { path: "src/example.ts", viewed: false },
    ]);
  });

  it("keeps the previous viewed state when GitHub rejects the change", async () => {
    const github = new FakeGitHub();
    github.viewedError = new Error("GitHub said no.");
    const session = new ReviewSession(pullRequest, patch, review, github);

    await expect(session.setFileViewed({ path: "src/example.ts", viewed: true })).rejects.toThrow("GitHub said no.");
    expect(session.snapshot().viewedFiles).toEqual([]);
  });

  it("only marks files that belong to the pull request", async () => {
    const github = new FakeGitHub();
    const session = new ReviewSession(pullRequest, patch, review, github);

    await expect(session.setFileViewed({ path: "src/other.ts", viewed: true }))
      .rejects.toThrow("File is not part of this pull request: src/other.ts");
    expect(github.viewedCalls).toEqual([]);
  });

  it("returns revision requests to the agent without publishing", async () => {
    const github = new FakeGitHub();
    const session = new ReviewSession(pullRequest, patch, review, github);
    session.requestRevision({ requests: [{ commentId: "S1", message: "Verify the actual caller contract." }] });
    await expect(session.waitForResult()).resolves.toEqual({
      status: "revision_requested",
      selectedCommentIds: [],
      rejectedCommentIds: [],
      requests: [{ commentId: "S1", message: "Verify the actual caller contract." }],
      newThreads: [],
      threadReplies: [],
      dismissedThreads: [],
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

  it("returns a new private user comment thread to the agent", async () => {
    const session = new ReviewSession(pullRequest, patch, review, new FakeGitHub());
    const newThread = {
      id: "U2",
      path: "src/example.ts",
      line: 2,
      side: "RIGHT" as const,
      message: "Verify whether this constant is intentional and rewrite my comment.",
    };
    session.requestRevision({ newThreads: [newThread] });

    await expect(session.waitForResult()).resolves.toEqual({
      status: "revision_requested",
      selectedCommentIds: [],
      rejectedCommentIds: [],
      requests: [],
      newThreads: [newThread],
      threadReplies: [],
      dismissedThreads: [],
    });
  });

  it("rejects new user comment threads outside the pull request", () => {
    const session = new ReviewSession(pullRequest, patch, review, new FakeGitHub());
    expect(() => session.requestRevision({
      newThreads: [{ id: "U2", path: "src/missing.ts", line: 1, side: "RIGHT", message: "Check this." }],
    })).toThrow(/outside this pull request/);
  });

  it("returns a user reply and keeps the agent from dismissing the thread", async () => {
    const reviewWithThread = { ...review, userThreads: [userThread] };
    const session = new ReviewSession(pullRequest, patch, reviewWithThread, new FakeGitHub());
    session.requestRevision({
      threadReplies: [{ threadId: "U1", message: "The function gets its value through closure state." }],
    });

    await expect(session.waitForResult()).resolves.toMatchObject({
      status: "revision_requested",
      threadReplies: [{ threadId: "U1", message: "The function gets its value through closure state." }],
      dismissedThreads: [],
    });
  });

  it("lets only the user dismiss an existing thread with a reason", async () => {
    const reviewWithThread = { ...review, userThreads: [userThread] };
    const session = new ReviewSession(pullRequest, patch, reviewWithThread, new FakeGitHub());
    session.requestRevision({
      dismissedThreads: [{ threadId: "U1", reason: "The agent is right; there is no input contract." }],
    });

    await expect(session.waitForResult()).resolves.toMatchObject({
      status: "revision_requested",
      threadReplies: [],
      dismissedThreads: [{ threadId: "U1", reason: "The agent is right; there is no input contract." }],
    });
  });

  it("keeps a live session open while the agent answers a user discussion", async () => {
    const session = new ReviewSession(pullRequest, patch, review, new FakeGitHub(), [], true);
    session.requestRevision({
      newThreads: [{
        id: "U-live",
        path: "src/example.ts",
        line: 2,
        side: "RIGHT",
        message: "Does this ignore the caller value?",
      }],
    });

    await expect(session.waitForAgentRequest()).resolves.toMatchObject({
      status: "revision_requested",
      newThreads: [{ id: "U-live", message: "Does this ignore the caller value?" }],
    });
    expect(session.isOpen).toBe(true);
    const waiting = session.snapshot().review.userThreads.find(({ id }) => id === "U-live")!;
    expect(waiting.messages).toMatchObject([{ author: "user", body: "Does this ignore the caller value?" }]);

    session.respond({
      ...session.review,
      userThreads: session.review.userThreads.map((thread) => thread.id === "U-live" ? {
        ...thread,
        messages: [...thread.messages, {
          id: "U-live-M2",
          author: "agent" as const,
          body: "The value comes from the closure, so this line does not ignore an argument.",
        }],
      } : thread),
    });

    expect(session.isOpen).toBe(true);
    expect(session.review.userThreads.find(({ id }) => id === "U-live")?.messages.at(-1)).toMatchObject({
      author: "agent",
      body: "The value comes from the closure, so this line does not ignore an argument.",
    });
  });

  it("returns the same live request until the agent successfully responds", async () => {
    const session = new ReviewSession(pullRequest, patch, review, new FakeGitHub(), [], true);
    session.requestRevision({ requests: [{ commentId: "S1", message: "Check it again." }] });

    const first = await session.waitForAgentRequest();
    const retried = await session.waitForAgentRequest();

    expect(retried).toEqual(first);
    expect(first.status === "revision_requested"
      ? first.review.comments.find(({ id }) => id === "S1")
      : undefined).toMatchObject({
      id: "S1",
      discussion: [{ author: "user", body: "Check it again." }],
    });
  });

  it("keeps a live discussion on an agent finding and requires one agent reply", async () => {
    const session = new ReviewSession(pullRequest, patch, review, new FakeGitHub(), [], true);
    session.requestRevision({ requests: [{ commentId: "S1", message: "Did you check the closure caller?" }] });
    await session.waitForAgentRequest();
    const waitingComment = session.review.comments.find(({ id }) => id === "S1")!;

    expect(waitingComment.discussion).toMatchObject([
      { author: "user", body: "Did you check the closure caller?" },
    ]);
    expect(() => session.respond(session.review)).toThrow(/exactly one response/);

    session.respond({
      ...session.review,
      comments: session.review.comments.map((comment) => comment.id === "S1" ? {
        ...comment,
        body: "Read this value from the closure input instead of fixing it at 42.",
        discussion: [...(comment.discussion ?? []), {
          id: "S1-D2",
          author: "agent" as const,
          body: "Yes. I checked the caller and made the finding more precise.",
        }],
      } : comment),
    });

    expect(session.review.comments.find(({ id }) => id === "S1")).toMatchObject({
      body: "Read this value from the closure input instead of fixing it at 42.",
      discussion: [
        { author: "user", body: "Did you check the closure caller?" },
        { author: "agent", body: "Yes. I checked the caller and made the finding more precise." },
      ],
    });
  });

  it("serializes live rounds so the agent never responds to stale review state", async () => {
    const session = new ReviewSession(pullRequest, patch, review, new FakeGitHub(), [], true);
    session.requestRevision({ requests: [{ commentId: "S1", message: "Check it again." }] });

    expect(() => session.requestRevision({
      requests: [{ commentId: "G1", message: "Also check this." }],
    })).toThrow(/already working/);
  });

  it("prevents the agent from changing user-owned live discussion state", async () => {
    const session = new ReviewSession(
      pullRequest,
      patch,
      { ...review, userThreads: [userThread] },
      new FakeGitHub(),
      [],
      true,
    );
    session.requestRevision({
      threadReplies: [{ threadId: "U1", message: "Please check the closure again." }],
    });
    await session.waitForAgentRequest();

    expect(() => session.respond({
      ...session.review,
      userThreads: session.review.userThreads.map((thread) => ({
        ...thread,
        dismissed: true,
        dismissalReason: "Agent decided this is irrelevant.",
      })),
    })).toThrow(/Only the user can dismiss/);

    expect(() => session.respond({
      ...session.review,
      userThreads: session.review.userThreads.map((thread) => ({
        ...thread,
        messages: thread.messages.slice(0, -1),
      })),
    })).toThrow(/cannot edit discussion history/);
  });

  it("requires findings created by the agent during a live round to start pending", async () => {
    const session = new ReviewSession(pullRequest, patch, review, new FakeGitHub(), [], true);
    session.requestRevision({ requests: [{ commentId: "S1", message: "Check the wider path." }] });
    await session.waitForAgentRequest();

    expect(() => session.respond({
      ...session.review,
      comments: [...session.review.comments, {
        ...session.review.comments[0],
        id: "S2",
        included: true,
      }],
    })).toThrow(/must start pending/);
  });

  it("notifies the browser when live review state changes", async () => {
    const session = new ReviewSession(pullRequest, patch, review, new FakeGitHub(), [], true);
    const changed = session.waitForChange(0);

    session.requestRevision({ requests: [{ commentId: "S1", message: "Check it again." }] });

    await expect(changed).resolves.toBe(1);
    expect(session.snapshot()).toMatchObject({ live: true, version: 1 });
  });

  it("rejects replies before the agent answers and updates for unknown threads", () => {
    const waitingThread = { ...userThread, messages: [userThread.messages[0]] };
    const session = new ReviewSession(
      pullRequest,
      patch,
      { ...review, userThreads: [waitingThread] },
      new FakeGitHub(),
    );
    expect(() => session.requestRevision({
      threadReplies: [{ threadId: "U1", message: "Another message." }],
    })).toThrow(/before the agent responds/);
    expect(() => session.requestRevision({
      dismissedThreads: [{ threadId: "missing", reason: "Not relevant." }],
    })).toThrow(/Unknown user comment thread ids/);
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

describe("user comments and edits", () => {
  const onDeletedLine = { path: "src/example.ts", line: 2, side: "LEFT" as const, body: "Keep the old constant for now." };

  it("adds a pending user comment on a deleted line with the next free H id", () => {
    const session = new ReviewSession(pullRequest, patch, review, new FakeGitHub(), [], true);
    const before = session.version;

    expect(session.addUserComment(onDeletedLine).id).toBe("H1");
    expect(session.addUserComment({ ...onDeletedLine, line: 1, side: "RIGHT" }).id).toBe("H2");

    const created = session.review.comments.find(({ id }) => id === "H1")!;
    expect(created).toEqual({
      id: "H1",
      type: "line",
      author: "user",
      path: "src/example.ts",
      line: 2,
      side: "LEFT",
      body: "Keep the old constant for now.",
    });
    expect(session.version).toBeGreaterThan(before);
  });

  it("rejects a user comment outside the diff hunks", () => {
    const session = new ReviewSession(pullRequest, patch, review, new FakeGitHub(), [], true);

    expect(() => session.addUserComment({ ...onDeletedLine, line: 9, side: "RIGHT" }))
      .toThrow("Comments can only be placed on lines inside the pull request diff: src/example.ts:9");
  });

  it("marks an edited agent finding and keeps its decision state", () => {
    const session = new ReviewSession(
      pullRequest,
      patch,
      { ...review, comments: [{ ...review.comments[0], included: true }, review.comments[1]] },
      new FakeGitHub(),
      [],
      true,
    );

    session.editComment("S1", { body: "Take the value from the caller." });

    expect(session.review.comments[0]).toMatchObject({ body: "Take the value from the caller.", edited: true, included: true });
    expect(() => session.editComment("S1", { body: "x", severity: "nit" })).toThrow("Only comments you wrote can change severity.");
  });

  it("changes and clears the severity of a user comment", () => {
    const session = new ReviewSession(pullRequest, patch, review, new FakeGitHub(), [], true);
    session.addUserComment(onDeletedLine);

    session.editComment("H1", { body: "Keep it.", severity: "warning" });
    expect(session.review.comments.find(({ id }) => id === "H1")).toMatchObject({ body: "Keep it.", severity: "warning" });
    expect(session.review.comments.find(({ id }) => id === "H1")!.edited).toBeUndefined();

    session.editComment("H1", { body: "Keep it.", severity: null });
    expect(session.review.comments.find(({ id }) => id === "H1")).not.toHaveProperty("severity");
  });

  it("locks a comment while it waits for the AI agent", () => {
    const session = new ReviewSession(pullRequest, patch, review, new FakeGitHub(), [], true);
    session.requestRevision({ requests: [{ commentId: "S1", message: "Is this right?" }] });

    expect(() => session.editComment("S1", { body: "x" }))
      .toThrow("The AI agent is checking this comment. Edit it after the agent responds.");
    expect(session.editComment("G1", { body: "Edited while the agent works." }).body).toBe("Edited while the agent works.");
  });

  it("deletes only user-written comments", () => {
    const session = new ReviewSession(pullRequest, patch, review, new FakeGitHub(), [], true);
    session.addUserComment(onDeletedLine);

    expect(() => session.deleteUserComment("S1")).toThrow("Only comments you wrote can be deleted.");
    session.deleteUserComment("H1");
    expect(session.review.comments.map(({ id }) => id)).not.toContain("H1");
  });

  it("never reuses the id of a deleted user comment", () => {
    const session = new ReviewSession(pullRequest, patch, review, new FakeGitHub(), [], true);
    session.addUserComment(onDeletedLine);
    session.deleteUserComment("H1");

    expect(session.addUserComment(onDeletedLine).id).toBe("H2");
  });

  it("publishes the edited body", async () => {
    const github = new FakeGitHub();
    const session = new ReviewSession(pullRequest, patch, review, github);
    session.editComment("S1", { body: "Take the value from the caller." });

    await session.publish({ confirmed: true, event: "COMMENT", body: "", selectedCommentIds: ["S1"] });

    expect(github.published?.comments[0].body).toBe("Take the value from the caller.");
  });

  describe("while the agent is working", () => {
    const answerS1 = (seen: typeof review) => ({
      ...seen,
      comments: seen.comments.map((comment) => comment.id === "S1" ? {
        ...comment,
        discussion: [...(comment.discussion ?? []), { id: "S1-D2", author: "agent" as const, body: "Checked." }],
      } : comment),
    });

    async function workingSession() {
      const session = new ReviewSession(pullRequest, patch, review, new FakeGitHub(), [], true);
      return session;
    }

    it("restores a user comment added while the agent was working", async () => {
      const session = await workingSession();
      session.requestRevision({ requests: [{ commentId: "S1", message: "Is this right?" }] });
      const { review: seen } = await session.waitForAgentRequest() as { review: typeof review };
      session.addUserComment(onDeletedLine);

      session.respond(answerS1(seen));

      expect(session.review.comments.find(({ id }) => id === "H1")).toMatchObject({ body: "Keep the old constant for now." });
    });

    it("does not bring back a user comment deleted while the agent was working", async () => {
      const session = await workingSession();
      session.addUserComment(onDeletedLine);
      session.requestRevision({ selectedCommentIds: ["H1"], requests: [{ commentId: "S1", message: "Is this right?" }] });
      const { review: seen } = await session.waitForAgentRequest() as { review: typeof review };
      session.deleteUserComment("H1");

      session.respond(answerS1(seen));

      expect(session.review.comments.map(({ id }) => id)).not.toContain("H1");
    });

    it("keeps the user's comment when the agent drops its author or moves it", async () => {
      const session = await workingSession();
      session.addUserComment(onDeletedLine);
      session.requestRevision({ requests: [{ commentId: "S1", message: "Is this right?" }] });
      const { review: seen } = await session.waitForAgentRequest() as { review: typeof review };
      const answered = answerS1(seen);

      session.respond({
        ...answered,
        comments: answered.comments.map(({ author: _author, ...comment }) => comment.id === "H1"
          ? { ...comment, line: 99, body: "Agent rewrite." }
          : comment),
      });

      expect(session.review.comments.find(({ id }) => id === "H1")).toEqual({
        id: "H1",
        type: "line",
        author: "user",
        path: "src/example.ts",
        line: 2,
        side: "LEFT",
        body: "Keep the old constant for now.",
      });
    });

    it("accepts the agent's rewrite of a discussed user comment that omits its author", async () => {
      const session = await workingSession();
      session.addUserComment(onDeletedLine);
      session.requestRevision({ requests: [{ commentId: "H1", message: "Can you make this clearer?" }] });
      const { review: seen } = await session.waitForAgentRequest() as { review: typeof review };

      session.respond({
        ...seen,
        comments: seen.comments.map(({ author: _author, ...comment }) => comment.id === "H1" ? {
          ...comment,
          body: "Keep the old constant until every caller migrates.",
          discussion: [...(comment.discussion ?? []), { id: "H1-D2", author: "agent" as const, body: "Clarified." }],
        } : comment),
      });

      expect(session.review.comments.find(({ id }) => id === "H1")).toMatchObject({
        author: "user",
        side: "LEFT",
        body: "Keep the old constant until every caller migrates.",
      });
    });

    it("never stores an agent finding loosened by a forged author", async () => {
      const session = await workingSession();
      session.requestRevision({ requests: [{ commentId: "S1", message: "Is this right?" }] });
      const { review: seen } = await session.waitForAgentRequest() as { review: typeof review };
      const answered = answerS1(seen);

      expect(() => session.respond({
        ...answered,
        comments: answered.comments.map(({ severity: _severity, reviewerExplanation: _explanation, ...comment }) =>
          comment.id === "S1" ? { ...comment, author: "user", side: "LEFT" } : { ...comment, severity: _severity, reviewerExplanation: _explanation }),
      })).toThrow();
      expect(() => reviewDocumentSchema.parse(session.review)).not.toThrow();
      expect(session.review.comments.find(({ id }) => id === "S1")).toMatchObject({ side: "RIGHT", severity: "bug" });
    });

    it("keeps the user's edit when the agent answers a different comment", async () => {
      const session = await workingSession();
      session.requestRevision({ requests: [{ commentId: "S1", message: "Is this right?" }] });
      const { review: seen } = await session.waitForAgentRequest() as { review: typeof review };
      session.editComment("G1", { body: "My wording of the general comment." });

      session.respond(answerS1(seen));

      expect(session.review.comments.find(({ id }) => id === "G1"))
        .toMatchObject({ body: "My wording of the general comment.", edited: true });
    });
  });
});

describe("an early review", () => {
  const starting = { ...review, summary: "", recommendation: "COMMENT" as const, comments: [], userThreads: [] };
  const briefing = { text: "The pull request makes the answer reusable by storing it in a constant." };
  const findings = review.comments;
  const onDeletedLine = { path: "src/example.ts", line: 2, side: "LEFT" as const, body: "Keep the old constant for now." };
  const newThread = (id: string, message = "Why is this a constant?") => ({
    id,
    path: "src/example.ts",
    line: 2,
    side: "RIGHT" as const,
    message,
  });

  function earlySession(github = new FakeGitHub()) {
    return new ReviewSession(pullRequest, patch, starting, github, [], true, [], { early: true });
  }

  function track<T>(promise: Promise<T>) {
    const state: { settled: boolean; value?: T } = { settled: false };
    void promise.then((value) => {
      state.settled = true;
      state.value = value;
    });
    return state;
  }

  const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

  it("requires a live session", () => {
    expect(() => new ReviewSession(pullRequest, patch, starting, new FakeGitHub(), [], false, [], { early: true }))
      .toThrow("Early review mode requires a live session.");
  });

  it("starts in the reviewing state with no findings and keeps wait pending", async () => {
    const session = earlySession();
    const waiting = track(session.waitForAgentRequest());
    await tick();

    const snapshot = session.snapshot();
    expect(snapshot.reviewing).toEqual({ startedAt: expect.any(String) });
    expect(new Date(snapshot.reviewing!.startedAt).toISOString()).toBe(snapshot.reviewing!.startedAt);
    expect(snapshot.review.comments).toEqual([]);
    expect(snapshot.agentPending).toBe(false);
    expect(waiting.settled).toBe(false);
  });

  it("reports no reviewing state for a session that is not early", () => {
    expect(new ReviewSession(pullRequest, patch, review, new FakeGitHub(), [], true).snapshot().reviewing).toBeNull();
  });

  it("takes the briefing from a delivery before the final one and keeps reviewing", () => {
    const session = earlySession();

    session.deliver({ ...starting, briefing, summary: "Early summary." }, false);

    expect(session.review.briefing).toEqual(briefing);
    expect(session.review.summary).toBe("Early summary.");
    expect(session.review.recommendation).toBe("COMMENT");
    expect(session.snapshot().reviewing).not.toBeNull();
  });

  it("keeps the summary when a delivery before the final one has none", () => {
    const session = earlySession();
    session.deliver({ ...starting, summary: "Early summary." }, false);

    session.deliver({ ...starting, briefing }, false);

    expect(session.review.summary).toBe("Early summary.");
  });

  it("refuses findings in a delivery before the final one", () => {
    const session = earlySession();

    expect(() => session.deliver({ ...starting, briefing, comments: findings }, false))
      .toThrow("A delivery before the final one cannot contain findings.");
    expect(session.review.briefing).toBeUndefined();
  });

  it("takes the summary, recommendation, and findings from the final delivery and ends reviewing", () => {
    const session = earlySession();
    session.deliver({ ...starting, briefing }, false);

    session.deliver({ ...review, briefing: undefined }, true);

    expect(session.review).toMatchObject({
      briefing,
      summary: review.summary,
      recommendation: "REQUEST_CHANGES",
      comments: findings,
    });
    expect(session.snapshot().reviewing).toBeNull();
  });

  it.each([
    ["a comment written by the user", { comments: [{ ...findings[0], author: "user" }] },
      "The agent cannot deliver comment S1 as written by the user."],
    ["an edited comment", { comments: [{ ...findings[0], edited: true }] }, "Only the user can mark comment S1 as edited."],
    ["an id reserved for the user", { comments: [{ ...findings[0], id: "H7" }] },
      "Comment ids starting with H are reserved for the user's comments: H7"],
    ["an included finding", { comments: [{ ...findings[0], included: true }] }, "New finding S1 must start pending."],
    ["a rejected finding", { comments: [{ ...findings[0], rejected: true }] }, "New finding S1 must start pending."],
    ["a finding with discussion", {
      comments: [{ ...findings[0], discussion: [{ id: "D1", author: "user", body: "Is this right?" }] }],
    }, "The agent cannot start a discussion on new finding S1."],
    ["user threads", { userThreads: [userThread] }, "The agent cannot create user discussion threads."],
    ["a different pull request", { prUrl: "https://github.com/acme/widgets/pull/43" },
      "The agent response belongs to a different pull request."],
    ["different languages", { languages: { comments: "English", reviewerNotes: "English" } },
      "The agent cannot change review language settings during a live session."],
    ["a line finding outside the added lines", { comments: [{ ...findings[0], line: 1 }] },
      "Review comments must target added lines in the pull request diff: S1 (src/example.ts:1)"],
  ])("rejects a delivery with %s", (_name, change, message) => {
    const session = earlySession();

    expect(() => session.deliver({ ...review, ...change }, true)).toThrow(message);
    expect(session.review.comments).toEqual([]);
    expect(session.snapshot().reviewing).not.toBeNull();
  });

  it("keeps the user's comments, decisions, and threads through both deliveries", () => {
    const session = earlySession();
    session.addUserComment(onDeletedLine);
    session.requestRevision({ selectedCommentIds: ["H1"], newThreads: [newThread("U-a")] });
    session.deliver({ ...starting, briefing }, false);
    session.addUserComment({ ...onDeletedLine, body: "Rename this constant." });
    session.requestRevision({
      selectedCommentIds: ["H1"],
      rejectedCommentIds: ["H2"],
      newThreads: [newThread("U-b", "Is this tested?")],
    });

    session.deliver(review, true);

    expect(session.review.comments).toEqual([
      ...findings,
      { id: "H1", type: "line", author: "user", ...onDeletedLine, included: true },
      { id: "H2", type: "line", author: "user", ...onDeletedLine, body: "Rename this constant.", rejected: true },
    ]);
    expect(session.review.userThreads.map(({ id, messages }) => [id, messages.map(({ body }) => body)])).toEqual([
      ["U-a", ["Why is this a constant?"]],
      ["U-b", ["Is this tested?"]],
    ]);
    expect(session.review.briefing).toEqual(briefing);
  });

  it("queues every request while reviewing and releases them together after the final delivery", async () => {
    const session = earlySession();
    session.addUserComment(onDeletedLine);
    const waiting = track(session.waitForAgentRequest());

    session.requestRevision({ newThreads: [newThread("U-a")] });
    session.requestRevision({
      selectedCommentIds: ["H1"],
      requests: [{ commentId: "H1", message: "Can you make this clearer?" }],
    });
    await tick();

    expect(session.review.userThreads.find(({ id }) => id === "U-a")?.messages)
      .toMatchObject([{ author: "user", body: "Why is this a constant?" }]);
    expect(session.review.comments.find(({ id }) => id === "H1")?.discussion)
      .toMatchObject([{ author: "user", body: "Can you make this clearer?" }]);
    expect(session.snapshot().agentPending).toBe(false);
    expect(waiting.settled).toBe(false);

    session.deliver(review, true);
    await tick();

    expect(waiting.value).toEqual({
      status: "revision_requested",
      selectedCommentIds: ["H1"],
      rejectedCommentIds: [],
      requests: [{ commentId: "H1", message: "Can you make this clearer?" }],
      newThreads: [newThread("U-a")],
      threadReplies: [],
      dismissedThreads: [],
      review: session.review,
    });
    expect((waiting.value as { review: typeof review }).review.comments.map(({ id }) => id)).toEqual(["S1", "G1", "H1"]);
    expect(session.snapshot().agentPending).toBe(true);
    expect(() => session.requestRevision({ newThreads: [newThread("U-c")] }))
      .toThrow("The AI agent is already working on the previous request.");
  });

  it("refuses a second message to a discussion the agent has not answered", () => {
    const session = earlySession();
    session.addUserComment(onDeletedLine);
    session.requestRevision({ requests: [{ commentId: "H1", message: "Can you make this clearer?" }] });

    expect(() => session.requestRevision({ requests: [{ commentId: "H1", message: "And shorter?" }] }))
      .toThrow("The AI agent has not replied to this discussion yet.");
  });

  it("refuses to dismiss a thread the agent has not answered", () => {
    const session = earlySession();
    session.requestRevision({ newThreads: [newThread("U-a")] });

    expect(() => session.requestRevision({ dismissedThreads: [{ threadId: "U-a", reason: "Never mind." }] }))
      .toThrow("The AI agent has not replied to this discussion yet.");
    expect(session.review.userThreads[0].dismissed).toBeUndefined();
  });

  it("drops a queued discussion on a user comment deleted before the final delivery", async () => {
    const session = earlySession();
    session.addUserComment(onDeletedLine);
    session.requestRevision({
      selectedCommentIds: ["H1"],
      requests: [{ commentId: "H1", message: "Can you make this clearer?" }],
      newThreads: [newThread("U-a")],
    });
    session.deleteUserComment("H1");

    session.deliver(review, true);

    await expect(session.waitForAgentRequest()).resolves.toMatchObject({
      selectedCommentIds: [],
      requests: [],
      newThreads: [{ id: "U-a" }],
    });
  });

  it("releases nothing when every queued item was deleted", async () => {
    const session = earlySession();
    session.addUserComment(onDeletedLine);
    session.requestRevision({ requests: [{ commentId: "H1", message: "Can you make this clearer?" }] });
    session.deleteUserComment("H1");
    const waiting = track(session.waitForAgentRequest());

    session.deliver(review, true);
    await tick();

    expect(waiting.settled).toBe(false);
    expect(session.snapshot().agentPending).toBe(false);
  });

  it("refuses an agent response and publishing while reviewing", async () => {
    const github = new FakeGitHub();
    const session = earlySession(github);

    expect(() => session.respond(starting)).toThrow("The AI agent has not delivered its review yet.");
    const publishing = session.publish({ confirmed: true, event: "COMMENT", body: "", selectedCommentIds: [] });
    await expect(publishing).rejects.toBeInstanceOf(CommentChangeError);
    await expect(publishing).rejects.toThrow("Publishing is available when the AI finishes its review.");
    expect(github.published).toBeUndefined();
    expect(session.isOpen).toBe(true);
  });

  it("cancels while reviewing and tells a waiting agent", async () => {
    const session = earlySession();
    const waiting = session.waitForAgentRequest();

    session.cancel();

    await expect(waiting).resolves.toEqual({ status: "cancelled" });
    await expect(session.waitForResult()).resolves.toEqual({ status: "cancelled" });
  });

  it("refuses a delivery after the final one and outside an early review", () => {
    const session = earlySession();
    session.deliver(review, true);

    expect(() => session.deliver(review, true)).toThrow("The AI agent has already delivered its review.");
    expect(() => new ReviewSession(pullRequest, patch, review, new FakeGitHub(), [], true).deliver(review, true))
      .toThrow("The AI agent has already delivered its review.");
  });
});

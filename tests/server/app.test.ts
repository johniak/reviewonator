import { describe, expect, it } from "vitest";
import type { PullRequest } from "../../src/domain/pull-request";
import type { PublishRequest, ReviewComment } from "../../src/domain/review";
import type { GitHubGateway, LoadedPullRequest, PublishedReview } from "../../src/github/client";
import { createApp } from "../../src/server/app";
import { ReviewSession } from "../../src/server/session";
import { discussion, patch, pullRequest, review } from "../fixtures";

class AppGitHub implements GitHubGateway {
  async verifyPrerequisites() {}
  async loadPullRequest(): Promise<LoadedPullRequest> { return { pullRequest, patch, discussion }; }
  async getHeadSha() { return pullRequest.headRefOid; }
  async loadFileContext() { return { oldContent: "old file", newContent: "new file" }; }
  async publishReview(_pr: PullRequest, _request: PublishRequest, _comments: ReviewComment[]): Promise<PublishedReview> {
    return { id: 1, url: "https://github.com/acme/widgets/pull/42#review-1", state: "APPROVED" };
  }
}

function testApp() {
  const session = new ReviewSession(pullRequest, patch, review, new AppGitHub(), discussion);
  return { app: createApp({ html: "<html>Reviewonator</html>", favicon: "<svg>R</svg>", token: "secret", session }), session };
}

const authenticated = (body?: unknown) => ({
  method: "POST",
  headers: { authorization: "Bearer secret", "content-type": "application/json" },
  body: JSON.stringify(body ?? {}),
});

describe("Reviewonator HTTP API", () => {
  it("serves the app and health endpoint without exposing session data", async () => {
    const { app } = testApp();
    expect(await (await app.request("/")).text()).toContain("Reviewonator");
    expect(await (await app.request("/health")).json()).toEqual({ status: "ok" });
  });

  it("serves the application favicon", async () => {
    const response = await testApp().app.request("/favicon.svg");

    expect(response.headers.get("content-type")).toContain("image/svg+xml");
    expect(await response.text()).toBe("<svg>R</svg>");
  });

  it("requires the per-session bearer token for review data", async () => {
    const { app } = testApp();
    expect((await app.request("/api/session")).status).toBe(401);
    const response = await app.request("/api/session", { headers: { authorization: "Bearer secret" } });
    expect(response.status).toBe(200);
    expect((await response.json()).review.comments).toHaveLength(2);
    expect((await (await app.request("/api/session", { headers: { authorization: "Bearer secret" } })).json()).discussion)
      .toHaveLength(3);
  });

  it("rejects a publication without explicit confirmation", async () => {
    const { app } = testApp();
    const response = await app.request("/api/publish", authenticated({
      confirmed: false,
      event: "APPROVE",
      body: "Looks good.",
      selectedCommentIds: [],
    }));
    expect(response.status).toBe(400);
  });

  it("returns revision requests through the same session API", async () => {
    const { app, session } = testApp();
    const response = await app.request("/api/revision", authenticated({
      requests: [{ commentId: "S1", message: "Re-check this finding." }],
    }));
    expect(response.status).toBe(200);
    await expect(session.waitForResult()).resolves.toEqual({
      status: "revision_requested",
      selectedCommentIds: [],
      rejectedCommentIds: [],
      requests: [{ commentId: "S1", message: "Re-check this finding." }],
      newComments: [],
    });
  });

  it("serves authenticated surrounding file context", async () => {
    const { app } = testApp();
    const response = await app.request("/api/file-context?path=src%2Fexample.ts", {
      headers: { authorization: "Bearer secret" },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ oldContent: "old file", newContent: "new file" });
  });
});

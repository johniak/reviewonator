import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { PullRequest } from "../../src/domain/pull-request";
import type { PublishRequest, ReviewComment } from "../../src/domain/review";
import type { GitHubGateway, LoadedPullRequest, PublishedReview } from "../../src/github/client";
import { createApp } from "../../src/server/app";
import { FilePreferenceStore } from "../../src/server/preferences";
import { ReviewSession } from "../../src/server/session";
import { discussion, patch, pullRequest, review } from "../fixtures";

class AppGitHub implements GitHubGateway {
  async verifyPrerequisites() {}
  async loadPullRequest(): Promise<LoadedPullRequest> { return { pullRequest, patch, discussion, viewedFiles: [] }; }
  async setFileViewed() {}
  async getHeadSha() { return pullRequest.headRefOid; }
  async loadFileContext() { return { oldContent: "old file", newContent: "new file" }; }
  async publishReview(_pr: PullRequest, _request: PublishRequest, _comments: ReviewComment[]): Promise<PublishedReview> {
    return { id: 1, url: "https://github.com/acme/widgets/pull/42#review-1", state: "APPROVED" };
  }
}

function testApp(live = false, updates?: Parameters<typeof createApp>[0]["updates"]) {
  const session = new ReviewSession(pullRequest, patch, review, new AppGitHub(), discussion, live);
  return {
    app: createApp({ html: "<html>Reviewonator</html>", favicon: "<svg>R</svg>", token: "secret", session, updates }),
    session,
  };
}

const updateNotice = {
  current: "0.7.0",
  latest: "0.8.0",
  releaseUrl: "https://github.com/johniak/reviewonator/releases/tag/v0.8.0",
};

const authenticated = (body?: unknown) => ({
  method: "POST",
  headers: { authorization: "Bearer secret", "content-type": "application/json" },
  body: JSON.stringify(body ?? {}),
});

describe("Reviewonator HTTP API", () => {
  it("requires the session token for the update notice", async () => {
    const { app } = testApp(false, { notice: async () => updateNotice, dismiss: async () => {} });

    expect((await app.request("/api/update-notice")).status).toBe(401);
    expect((await app.request("/api/update-notice/dismiss", { method: "POST", body: "{}" })).status).toBe(401);
  });

  it("returns the update notice and records a dismissal", async () => {
    const dismissed: string[] = [];
    const { app } = testApp(false, { notice: async () => updateNotice, dismiss: async (version) => { dismissed.push(version); } });

    const notice = await app.request("/api/update-notice", { headers: { authorization: "Bearer secret" } });
    expect(await notice.json()).toEqual({ notice: updateNotice });

    const dismissal = await app.request("/api/update-notice/dismiss", authenticated({ version: "0.8.0" }));
    expect(await dismissal.json()).toEqual({ status: "dismissed" });
    expect(dismissed).toEqual(["0.8.0"]);
  });

  it("rejects a dismissal without a version", async () => {
    const dismissed: string[] = [];
    const { app } = testApp(false, { notice: async () => updateNotice, dismiss: async (version) => { dismissed.push(version); } });

    expect((await app.request("/api/update-notice/dismiss", authenticated({}))).status).toBe(400);
    expect(dismissed).toEqual([]);
  });

  it("returns no notice when no checker is configured", async () => {
    const response = await testApp().app.request("/api/update-notice", { headers: { authorization: "Bearer secret" } });

    expect(await response.json()).toEqual({ notice: null });
  });

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

  it("marks a file as viewed and returns the updated list", async () => {
    const { app, session } = testApp();

    expect((await app.request("/api/viewed-files", { ...authenticated({ path: "src/example.ts", viewed: true }), headers: {} })).status)
      .toBe(401);
    const response = await app.request("/api/viewed-files", authenticated({ path: "src/example.ts", viewed: true }));

    expect(await response.json()).toEqual({ viewedFiles: ["src/example.ts"] });
    expect(session.snapshot().viewedFiles).toEqual(["src/example.ts"]);
    expect((await app.request("/api/viewed-files", authenticated({ path: "src/example.ts" }))).status).toBe(400);
  });

  it("requires the session token before opening a live event stream", async () => {
    const { app } = testApp(true);

    expect((await app.request("/api/events?token=wrong")).status).toBe(401);
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
      newThreads: [],
      threadReplies: [],
      dismissedThreads: [],
    });
  });

  it("keeps live revisions in the same session and accepts an agent response", async () => {
    const { app, session } = testApp(true);
    const revision = await app.request("/api/revision", authenticated({
      newThreads: [{
        id: "U-live",
        path: "src/example.ts",
        line: 2,
        side: "RIGHT",
        message: "Does this ignore an input?",
      }],
    }));

    expect(revision.status).toBe(200);
    expect((await revision.json()).session).toMatchObject({ live: true, version: 1 });
    expect(await (await app.request("/api/agent/wait", {
      headers: { authorization: "Bearer secret" },
    })).json()).toMatchObject({ status: "revision_requested", newThreads: [{ id: "U-live" }] });

    const response = await app.request("/api/agent/respond", authenticated({
      ...session.review,
      userThreads: session.review.userThreads.map((thread) => thread.id === "U-live" ? {
        ...thread,
        messages: [...thread.messages, {
          id: "U-live-M2",
          author: "agent",
          body: "No. The value comes from the surrounding closure.",
        }],
      } : thread),
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "accepted" });
    expect(session.snapshot()).toMatchObject({ live: true, version: 2 });
  });

  it("accepts an authenticated delivery from the agent in an early review", async () => {
    const starting = { ...review, summary: "", recommendation: "COMMENT" as const, comments: [] };
    const session = new ReviewSession(pullRequest, patch, starting, new AppGitHub(), discussion, true, [], { early: true });
    const app = createApp({ html: "<html>Reviewonator</html>", favicon: "<svg>R</svg>", token: "secret", session });

    expect((await app.request("/api/agent/deliver", { method: "POST", body: JSON.stringify({ review, final: true }) })).status)
      .toBe(401);
    expect((await app.request("/api/agent/deliver", authenticated({ review }))).status).toBe(400);
    expect(session.snapshot().reviewing).not.toBeNull();

    const response = await app.request("/api/agent/deliver", authenticated({ review, final: true }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "accepted" });
    expect(session.snapshot()).toMatchObject({ reviewing: null, review: { comments: review.comments } });
  });

  it("refuses publishing with a clear reason while the agent reviews", async () => {
    const session = new ReviewSession(pullRequest, patch, review, new AppGitHub(), discussion, true, [], { early: true });
    const app = createApp({ html: "<html>Reviewonator</html>", favicon: "<svg>R</svg>", token: "secret", session });

    const response = await app.request("/api/publish", authenticated({
      confirmed: true,
      event: "COMMENT",
      body: "",
      selectedCommentIds: [],
    }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Publishing is available when the AI finishes its review." });
  });

  it("serves authenticated surrounding file context", async () => {
    const { app } = testApp();
    const response = await app.request("/api/file-context?path=src%2Fexample.ts", {
      headers: { authorization: "Bearer secret" },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ oldContent: "old file", newContent: "new file" });
  });

  describe("user comments", () => {
    const send = (method: string, body?: unknown) => ({
      method,
      headers: { authorization: "Bearer secret", "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const onDeletedLine = { path: "src/example.ts", line: 2, side: "LEFT", body: "Keep the old constant for now." };

    it("creates, edits, and deletes a user comment through the session", async () => {
      const { app, session } = testApp(true);

      const created = await app.request("/api/comments", send("POST", onDeletedLine));
      expect(created.status).toBe(200);
      expect((await created.json()).session.review.comments.at(-1)).toMatchObject({ id: "H1", author: "user" });

      const edited = await app.request("/api/comments/H1", send("PATCH", { body: "Keep it.", severity: "nit" }));
      expect((await edited.json()).session.review.comments.at(-1)).toMatchObject({ body: "Keep it.", severity: "nit" });

      const deleted = await app.request("/api/comments/H1", send("DELETE"));
      expect(deleted.status).toBe(200);
      expect(session.review.comments.map(({ id }) => id)).not.toContain("H1");
    });

    it("requires the session token for comment changes", async () => {
      const { app } = testApp(true);

      expect((await app.request("/api/comments", { method: "POST", body: JSON.stringify(onDeletedLine) })).status).toBe(401);
      expect((await app.request("/api/comments/S1", { method: "PATCH", body: "{}" })).status).toBe(401);
      expect((await app.request("/api/comments/S1", { method: "DELETE" })).status).toBe(401);
    });

    it("explains why a comment outside the diff cannot be added", async () => {
      const { app } = testApp(true);

      const response = await app.request("/api/comments", send("POST", { ...onDeletedLine, line: 9, side: "RIGHT" }));

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: "Comments can only be placed on lines inside the pull request diff: src/example.ts:9",
      });
    });
  });
});

describe("saved preferences", () => {
  const page = '<head><script id="reviewonator-preferences" type="application/json">{}</script><script>/* theme */</script></head>';

  async function preferencesApp() {
    const preferences = new FilePreferenceStore({
      REVIEWONATOR_STATE_DIR: await mkdtemp(join(tmpdir(), "reviewonator-app-preferences-")),
    });
    const session = new ReviewSession(pullRequest, patch, review, new AppGitHub(), discussion);
    return { preferences, app: createApp({ html: page, favicon: "<svg>R</svg>", token: "secret", session, preferences }) };
  }

  it("embeds the saved preferences in the page ahead of the theme script", async () => {
    const { app, preferences } = await preferencesApp();
    await preferences.update({ theme: "dark", viewMode: "all" });

    const html = await (await app.request("/")).text();

    expect(html).toBe(
      '<head><script id="reviewonator-preferences" type="application/json">'
        + '{"theme":"dark","palette":"copper","viewMode":"all","diffStyle":"unified","collapsedBriefings":[]}</script><script>/* theme */</script></head>',
    );
  });

  it("requires the session token to save a preference", async () => {
    const { app, preferences } = await preferencesApp();

    const response = await app.request("/api/preferences", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ theme: "dark" }),
    });

    expect(response.status).toBe(401);
    expect((await preferences.read()).theme).toBe("system");
  });

  it("saves a preference change for the next run", async () => {
    const { app, preferences } = await preferencesApp();

    const response = await app.request("/api/preferences", authenticated({ diffStyle: "split" }));

    expect(await response.json()).toEqual({ preferences: { theme: "system", palette: "copper", viewMode: "single", diffStyle: "split", collapsedBriefings: [] } });
    expect(await preferences.read()).toEqual({ theme: "system", palette: "copper", viewMode: "single", diffStyle: "split", collapsedBriefings: [] });
  });

  it("rejects an unknown preference or value", async () => {
    const { app, preferences } = await preferencesApp();

    expect((await app.request("/api/preferences", authenticated({ theme: "sepia" }))).status).toBe(400);
    expect((await app.request("/api/preferences", authenticated({ palette: "neon" }))).status).toBe(400);
    expect((await app.request("/api/preferences", authenticated({ fontSize: 20 }))).status).toBe(400);
    expect((await preferences.read()).theme).toBe("system");
    expect((await preferences.read()).palette).toBe("copper");
  });
});

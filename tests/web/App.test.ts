import { readFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createElement } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PullRequest } from "../../src/domain/pull-request";
import type { PublishRequest, ReviewComment } from "../../src/domain/review";
import type { GitHubGateway, LoadedPullRequest, PublishedReview } from "../../src/github/client";
import { createApp } from "../../src/server/app";
import { FilePreferenceStore } from "../../src/server/preferences";
import { ReviewSession } from "../../src/server/session";
import { App, buildPublishBody, CompletionScreen, describeFilePath } from "../../web/App";
import { discussion, patch, pullRequest, review, userThread } from "../fixtures";
import { closePage, indexHtml, openPage } from "./page";

class AppGateway implements GitHubGateway {
  async verifyPrerequisites() {}
  viewedCalls: Array<{ path: string; viewed: boolean }> = [];
  viewedError?: Error;

  async loadPullRequest(): Promise<LoadedPullRequest> { return { pullRequest, patch, discussion, viewedFiles: [] }; }
  async getHeadSha() { return pullRequest.headRefOid; }
  async loadFileContext() { return { oldContent: "export function answer() {\n  return 41;\n}", newContent: "export function answer() {\n  const answer = 42;\n  return answer;\n}" }; }
  async publishReview(_pr: PullRequest, _request: PublishRequest, _comments: ReviewComment[]): Promise<PublishedReview> {
    return { id: 1, url: "https://github.com/acme/widgets/pull/42#review-1", state: "COMMENTED" };
  }
  async setFileViewed(_pr: PullRequest, path: string, viewed: boolean) {
    if (this.viewedError) throw this.viewedError;
    this.viewedCalls.push({ path, viewed });
  }
}

function serveSession(session: ReviewSession, preferences?: FilePreferenceStore) {
  const serverApp = createApp({ html: indexHtml, favicon: "<svg></svg>", token: "secret", session, preferences });
  vi.stubGlobal("fetch", (input: string | URL | Request, init?: RequestInit) => {
    const value = input instanceof Request ? input.url : input.toString();
    const url = new URL(value, "http://reviewonator.local");
    return serverApp.request(`${url.pathname}${url.search}`, init);
  });
  window.location.hash = "secret";
  return serverApp;
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  window.location.hash = "";
  closePage();
});

describe("navigation panel layout", () => {
  it("sizes every navigation list to the panel instead of its longest entry", () => {
    const styles = readFileSync("web/styles.css", "utf8");
    const rule = styles.match(/\n\.file-list, \.my-comment-list, \.finding-list, \.commit-list \{([^}]*)\}/)?.[1];

    expect(rule).toContain("grid-template-columns: minmax(0, 1fr)");
  });
});

describe("GitHub review body", () => {
  it("shows a filename with the useful end of its parent path", () => {
    expect(describeFilePath("packages/web/src/components/review/FileCard.tsx")).toEqual({
      name: "FileCard.tsx",
      directory: "…/components/review",
    });
    expect(describeFilePath("README.md")).toEqual({ name: "README.md", directory: "Repository root" });
  });

  it("includes canonical general comments without private reviewer explanations", () => {
    const body = buildPublishBody(review.summary, review.comments);

    expect(body).toContain(review.comments[1].body);
    expect(body).not.toContain(review.comments[1].reviewerExplanation);
  });

  it("builds a general-comments body without requiring a summary", () => {
    expect(buildPublishBody("", [review.comments[1]])).toBe(
      `### General comments\n\n- **Warning:** ${review.comments[1].body}`,
    );
  });

  it("starts with every proposed comment pending and no implicit rejection", async () => {
    const session = new ReviewSession(pullRequest, patch, review, new AppGateway(), discussion);
    const serverApp = createApp({ html: "<html></html>", favicon: "<svg></svg>", token: "secret", session });
    vi.stubGlobal("fetch", (input: string | URL | Request, init?: RequestInit) => {
      const value = input instanceof Request ? input.url : input.toString();
      const url = new URL(value, "http://reviewonator.local");
      return serverApp.request(`${url.pathname}${url.search}`, init);
    });
    window.location.hash = "secret";

    render(createElement(App));

    await waitFor(() => expect(
      document.querySelector<HTMLImageElement>(".brand-mark")?.getAttribute("src"),
    ).toMatch(/mark-light\.png$/));
    expect(await screen.findByText((_content, element) => Boolean(
      element?.classList.contains("selection-summary")
      && element.textContent?.replace(/\s+/g, " ").includes("0 of 2 comments selected") === true
    ))).toBeVisible();
    await waitFor(() => expect(screen.getAllByRole("button", { name: "Include" })).toHaveLength(2));
    expect(screen.getAllByRole("button", { name: "Reject" })).toHaveLength(2);
    expect(screen.getByRole("button", { name: /Bug Pending S1/ })).toBeVisible();
    expect(screen.getByRole("button", { name: /Warning Pending G1/ })).toBeVisible();
    expect(screen.getByRole("button", { name: "Open src/example.ts" })).toHaveTextContent("example.ts");
    expect(screen.getByRole("button", { name: "Open src/example.ts" })).toHaveTextContent("src");
    expect(screen.getByRole("link", { name: "View pull request on GitHub" })).toHaveAttribute(
      "href",
      pullRequest.url,
    );
    expect(screen.getByRole("tab", { name: "PR discussion 3" })).toBeVisible();
  });

  it("shows the update notice from the server and dismisses it", async () => {
    const session = new ReviewSession(pullRequest, patch, review, new AppGateway(), discussion);
    const dismissed: string[] = [];
    const serverApp = createApp({
      html: "<html></html>",
      favicon: "<svg></svg>",
      token: "secret",
      session,
      updates: {
        notice: async () => (dismissed.length ? null : {
          current: "0.7.0",
          latest: "0.8.0",
          releaseUrl: "https://github.com/johniak/reviewonator/releases/tag/v0.8.0",
        }),
        dismiss: async (version) => { dismissed.push(version); },
      },
    });
    vi.stubGlobal("fetch", (input: string | URL | Request, init?: RequestInit) => {
      const value = input instanceof Request ? input.url : input.toString();
      const url = new URL(value, "http://reviewonator.local");
      return serverApp.request(`${url.pathname}${url.search}`, init);
    });
    window.location.hash = "secret";

    render(createElement(App));

    expect(await screen.findByText(/Reviewonator 0\.8\.0 is available/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss update notice" }));

    expect(screen.queryByText(/Reviewonator 0\.8\.0 is available/)).toBeNull();
    await waitFor(() => expect(dismissed).toEqual(["0.8.0"]));
  });

  it("shows the private briefing above the diff instead of in the review panel", async () => {
    const briefed = {
      ...review,
      briefing: { ticket: { key: "ACME-142" }, text: "Ticket prosi o ponawianie płatności. PR je dodaje." },
    };
    serveSession(new ReviewSession(pullRequest, patch, briefed, new AppGateway(), discussion));

    render(createElement(App));

    const briefing = await screen.findByRole("region", { name: "About this PR" });
    expect(briefing).toHaveTextContent("Ticket prosi o ponawianie płatności. PR je dodaje.");
    expect(briefing).toHaveTextContent("Private · Polish");
    expect(briefing.closest(".review-canvas")).not.toBeNull();
    expect(briefing.compareDocumentPosition(screen.getByLabelText("Diff view mode")))
      .toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it("remembers a collapsed briefing for this pull request on the next run", async () => {
    const preferences = new FilePreferenceStore({
      REVIEWONATOR_STATE_DIR: await mkdtemp(join(tmpdir(), "reviewonator-briefing-preferences-")),
    });
    const briefed = { ...review, briefing: { text: "PR zmienia nazwę zadania." } };
    await openPage(serveSession(new ReviewSession(pullRequest, patch, briefed, new AppGateway(), discussion), preferences));
    render(createElement(App));

    fireEvent.click(await screen.findByRole("button", { name: "About this PR" }));

    expect(screen.queryByText("PR zmienia nazwę zadania.")).not.toBeInTheDocument();
    await waitFor(async () => expect((await preferences.read()).collapsedBriefings).toEqual([review.prUrl]));

    cleanup();
    await openPage(serveSession(new ReviewSession(pullRequest, patch, briefed, new AppGateway(), discussion), preferences));
    render(createElement(App));

    expect(await screen.findByRole("button", { name: "About this PR" })).toHaveAttribute("aria-expanded", "false");
  });

  it("leaves the briefing out for reviews written before it existed", async () => {
    serveSession(new ReviewSession(pullRequest, patch, review, new AppGateway(), discussion));

    render(createElement(App));

    await screen.findByRole("heading", { name: "Review summary" });
    expect(screen.queryByRole("region", { name: "About this PR" })).not.toBeInTheDocument();
  });

  it("collapses files viewed on GitHub and keeps the Viewed checkbox in sync", async () => {
    const gateway = new AppGateway();
    const session = new ReviewSession(pullRequest, patch, review, gateway, discussion, false, ["src/example.ts"]);
    serveSession(session);

    render(createElement(App));

    const viewed = await screen.findByRole("checkbox", { name: "Viewed" });
    expect(viewed).toBeChecked();
    expect(screen.getByText("1 / 1 viewed")).toBeVisible();
    expect(screen.getByRole("button", { name: "Open src/example.ts" })).toHaveClass("viewed");
    expect(document.querySelector(".diff-surface")).toBeNull();

    const toggle = screen.getByRole("button", { name: "src/example.ts", expanded: false });
    fireEvent.click(toggle);
    expect(document.querySelector(".diff-surface")).not.toBeNull();
    expect(viewed).toBeChecked();

    fireEvent.click(viewed);
    await waitFor(() => expect(gateway.viewedCalls).toEqual([{ path: "src/example.ts", viewed: false }]));
    expect(viewed).not.toBeChecked();
    expect(screen.getByText("0 / 1 viewed")).toBeVisible();
    expect(screen.getByRole("button", { name: "Open src/example.ts" })).not.toHaveClass("viewed");

    fireEvent.click(viewed);
    await waitFor(() => expect(gateway.viewedCalls).toHaveLength(2));
    expect(gateway.viewedCalls[1]).toEqual({ path: "src/example.ts", viewed: true });
    expect(document.querySelector(".diff-surface")).toBeNull();
    expect(screen.getByRole("button", { name: "src/example.ts", expanded: false })).toBeVisible();
  });

  it("restores the Viewed checkbox and explains why when GitHub rejects the change", async () => {
    const gateway = new AppGateway();
    gateway.viewedError = new Error("GitHub said no.");
    serveSession(new ReviewSession(pullRequest, patch, review, gateway, discussion));

    render(createElement(App));

    const viewed = await screen.findByRole("checkbox", { name: "Viewed" });
    fireEvent.click(viewed);

    expect(await screen.findByText(/GitHub said no\./)).toBeVisible();
    expect(viewed).not.toBeChecked();
    expect(document.querySelector(".diff-surface")).not.toBeNull();
    expect(screen.getByText("0 / 1 viewed")).toBeVisible();
  });

  it("restores carried decisions and returns the remaining decisions with revision feedback", async () => {
    const carriedReview = {
      ...review,
      comments: [{ ...review.comments[0], included: true }, { ...review.comments[1], rejected: true }],
    };
    const session = new ReviewSession(pullRequest, patch, carriedReview, new AppGateway(), discussion);
    const serverApp = createApp({ html: "<html></html>", favicon: "<svg></svg>", token: "secret", session });
    vi.stubGlobal("fetch", (input: string | URL | Request, init?: RequestInit) => {
      const value = input instanceof Request ? input.url : input.toString();
      const url = new URL(value, "http://reviewonator.local");
      return serverApp.request(`${url.pathname}${url.search}`, init);
    });
    window.location.hash = "secret";

    render(createElement(App));

    expect(await screen.findByText((_content, element) => Boolean(
      element?.classList.contains("selection-summary")
      && element.textContent?.replace(/\s+/g, " ").includes("1 of 2 comments selected") === true
    ))).toBeVisible();
    expect(screen.getByRole("button", { name: /Bug Included S1 src\/example\.ts:2/ })).toBeVisible();
    expect(screen.getByRole("button", { name: /Warning Rejected G1 General comment/ })).toBeVisible();

    fireEvent.click(screen.getAllByRole("button", { name: "Discuss with AI" })[1]);
    fireEvent.change(screen.getByPlaceholderText("Explain what seems wrong, unclear, or worth checking…"), {
      target: { value: "Make the test recommendation concrete." },
    });
    expect(screen.getByRole("button", { name: /Warning Reply queued G1 General comment/ })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Send 1 request to AI agent" }));

    await expect(session.waitForResult()).resolves.toMatchObject({
      status: "revision_requested",
      selectedCommentIds: ["S1"],
      rejectedCommentIds: [],
      requests: [{ commentId: "G1", message: "Make the test recommendation concrete." }],
    });
  });

  it("shows existing conversation, review, and inline comments in the discussion tab", async () => {
    const session = new ReviewSession(pullRequest, patch, review, new AppGateway(), discussion);
    const serverApp = createApp({ html: "<html></html>", favicon: "<svg></svg>", token: "secret", session });
    vi.stubGlobal("fetch", (input: string | URL | Request, init?: RequestInit) => {
      const value = input instanceof Request ? input.url : input.toString();
      const url = new URL(value, "http://reviewonator.local");
      return serverApp.request(`${url.pathname}${url.search}`, init);
    });
    window.location.hash = "secret";
    render(createElement(App));

    fireEvent.click(await screen.findByRole("tab", { name: "PR discussion 3" }));

    expect(screen.getByRole("heading", { name: "Existing discussion" })).toBeVisible();
    expect(screen.getByText("maintainer")).toBeVisible();
    expect(screen.getByText("regression test")).toBeVisible();
    expect(screen.getByText("Requested changes")).toBeVisible();
    expect(screen.getByRole("button", { name: "src/example.ts:2" })).toBeVisible();
    expect(screen.getAllByRole("link", { name: /Open .* comment on GitHub/ })).toHaveLength(3);
  });

  it("shows user discussions separately and returns a follow-up reply to the agent", async () => {
    const session = new ReviewSession(
      pullRequest,
      patch,
      { ...review, userThreads: [userThread] },
      new AppGateway(),
      discussion,
    );
    const serverApp = createApp({ html: "<html></html>", favicon: "<svg></svg>", token: "secret", session });
    vi.stubGlobal("fetch", (input: string | URL | Request, init?: RequestInit) => {
      const value = input instanceof Request ? input.url : input.toString();
      const url = new URL(value, "http://reviewonator.local");
      return serverApp.request(`${url.pathname}${url.search}`, init);
    });
    window.location.hash = "secret";
    render(createElement(App));

    expect(await screen.findByRole("navigation", { name: "My comments" })).toBeVisible();
    expect(screen.getByRole("button", { name: /Needs your reply.*src\/example\.ts:2/ })).toBeVisible();
    fireEvent.change(screen.getByLabelText("Reply to the AI agent"), {
      target: { value: "The closure supplies the value, so please check that path." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send 1 request to AI agent" }));

    await expect(session.waitForResult()).resolves.toMatchObject({
      status: "revision_requested",
      threadReplies: [{
        threadId: "U1",
        message: "The closure supplies the value, so please check that path.",
      }],
      dismissedThreads: [],
    });
  });

  it("keeps the live workspace open while the agent handles a reply", async () => {
    const session = new ReviewSession(
      pullRequest,
      patch,
      { ...review, userThreads: [userThread] },
      new AppGateway(),
      discussion,
      true,
    );
    const serverApp = createApp({ html: "<html></html>", favicon: "<svg></svg>", token: "secret", session });
    vi.stubGlobal("fetch", (input: string | URL | Request, init?: RequestInit) => {
      const value = input instanceof Request ? input.url : input.toString();
      const url = new URL(value, "http://reviewonator.local");
      return serverApp.request(`${url.pathname}${url.search}`, init);
    });
    window.location.hash = "secret";
    render(createElement(App));

    expect(await screen.findByText("Live")).toBeVisible();
    fireEvent.change(screen.getByLabelText("Reply to the AI agent"), {
      target: { value: "The closure still accepts outside state. Please check it." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send 1 request to AI agent" }));

    expect(await screen.findByText("AI working")).toBeVisible();
    expect(screen.queryByRole("heading", { name: "Revision requested" })).not.toBeInTheDocument();
    expect(screen.getAllByText("Waiting for agent").length).toBeGreaterThan(0);
    await expect(session.waitForAgentRequest()).resolves.toMatchObject({
      status: "revision_requested",
      threadReplies: [{ threadId: "U1" }],
    });
    session.cancel();
  });

  it("keeps the draft discussion text when the colour theme changes", async () => {
    const session = new ReviewSession(pullRequest, patch, review, new AppGateway(), discussion);
    const serverApp = createApp({ html: "<html></html>", favicon: "<svg></svg>", token: "secret", session });
    vi.stubGlobal("fetch", (input: string | URL | Request, init?: RequestInit) => {
      const value = input instanceof Request ? input.url : input.toString();
      const url = new URL(value, "http://reviewonator.local");
      return serverApp.request(`${url.pathname}${url.search}`, init);
    });
    window.location.hash = "secret";
    render(createElement(App));

    await screen.findByRole("heading", { name: pullRequest.title });
    fireEvent.click(screen.getAllByRole("button", { name: "Discuss with AI" })[0]);
    fireEvent.change(screen.getByLabelText("What do you want to discuss with the AI agent?"), {
      target: { value: "Keep me across the theme switch" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Dark" }));

    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(document.querySelector<HTMLImageElement>(".brand-mark")?.getAttribute("src")).toMatch(/mark-dark\.png$/);
    expect(screen.getByLabelText("What do you want to discuss with the AI agent?")).toHaveValue("Keep me across the theme switch");
    fireEvent.click(screen.getByRole("button", { name: "System" }));
    session.cancel();
  });

  it("updates a finding discussion live without closing the workspace", async () => {
    let emitSessionUpdate: (() => void) | undefined;
    class TestEventSource {
      onerror: (() => void) | null = null;
      addEventListener(type: string, listener: EventListener) {
        if (type === "session") emitSessionUpdate = () => listener(new Event("session"));
      }
      close() {}
    }
    vi.stubGlobal("EventSource", TestEventSource);
    const session = new ReviewSession(pullRequest, patch, review, new AppGateway(), discussion, true);
    const serverApp = createApp({ html: "<html></html>", favicon: "<svg></svg>", token: "secret", session });
    vi.stubGlobal("fetch", (input: string | URL | Request, init?: RequestInit) => {
      const value = input instanceof Request ? input.url : input.toString();
      const url = new URL(value, "http://reviewonator.local");
      return serverApp.request(`${url.pathname}${url.search}`, init);
    });
    window.location.hash = "secret";
    render(createElement(App));

    await screen.findByText("Live");
    fireEvent.click(screen.getAllByRole("button", { name: "Discuss with AI" })[0]);
    fireEvent.change(screen.getByLabelText("What do you want to discuss with the AI agent?"), {
      target: { value: "Did you check the closure caller?" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send to AI" }));

    await waitFor(() => expect(screen.getByLabelText("Discussion about finding S1"))
      .toHaveTextContent("Did you check the closure caller?"));
    expect(screen.getByRole("button", { name: "Waiting for AI" })).toBeDisabled();
    await expect(session.waitForAgentRequest()).resolves.toMatchObject({
      requests: [{ commentId: "S1", message: "Did you check the closure caller?" }],
      newThreads: [],
      threadReplies: [],
      dismissedThreads: [],
    });
    session.respond({
      ...session.review,
      comments: session.review.comments.map((comment) => comment.id === "S1" ? {
        ...comment,
        discussion: [...(comment.discussion ?? []), {
          id: "S1-D2",
          author: "agent" as const,
          body: "Yes. I checked it and the finding still applies.",
        }],
      } : comment),
    });
    emitSessionUpdate?.();

    expect(await screen.findByText("Yes. I checked it and the finding still applies.")).toBeVisible();
    expect(screen.getByRole("button", { name: "Continue discussion" })).toBeEnabled();
    session.cancel();
  });

  it("sends one line comment from its own card and keeps other pending messages", async () => {
    vi.stubGlobal("EventSource", class { addEventListener() {} close() {} });
    const session = new ReviewSession(pullRequest, patch, review, new AppGateway(), discussion, true);
    const serverApp = createApp({ html: "<html></html>", favicon: "<svg></svg>", token: "secret", session });
    vi.stubGlobal("fetch", (input: string | URL | Request, init?: RequestInit) => {
      const value = input instanceof Request ? input.url : input.toString();
      const url = new URL(value, "http://reviewonator.local");
      return serverApp.request(`${url.pathname}${url.search}`, init);
    });
    window.location.hash = "secret";
    render(createElement(App));
    await screen.findByText("Live");
    fireEvent.click(screen.getAllByRole("button", { name: "Discuss with AI" })[0]);
    fireEvent.change(screen.getByLabelText("What do you want to discuss with the AI agent?"), {
      target: { value: "Keep this for later" },
    });

    const addedLine = [...document.querySelector("diffs-container")!.shadowRoot!.querySelectorAll("[data-line='3']")][0];
    addedLine.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, composed: true, pointerType: "mouse" }));
    fireEvent.click(screen.getByRole("button", { name: "Add a comment to this line" }));
    const draft = await screen.findByRole("region", { name: "Your comment for src/example.ts line 3" });
    fireEvent.change(within(draft).getByRole("textbox"), { target: { value: "This branch skips validation." } });
    fireEvent.click(within(draft).getByRole("button", { name: "Send to AI" }));

    await expect(session.waitForAgentRequest()).resolves.toMatchObject({
      requests: [],
      newThreads: [{ path: "src/example.ts", line: 3, side: "RIGHT", message: "This branch skips validation." }],
      threadReplies: [],
      dismissedThreads: [],
    });
    await waitFor(() => expect(screen.queryByRole("region", { name: "Your comment for src/example.ts line 3" })).toBeNull());
    expect((await screen.findByText("Your discussion")).closest("article"))
      .toHaveTextContent("This branch skips validation.");
    expect(screen.getByLabelText("What do you want to discuss with the AI agent?")).toHaveValue("Keep this for later");
    session.cancel();
  });

  async function liveApp(prepare?: (session: ReviewSession) => void) {
    vi.stubGlobal("EventSource", class { addEventListener() {} close() {} });
    const session = new ReviewSession(pullRequest, patch, review, new AppGateway(), discussion, true);
    prepare?.(session);
    const serverApp = createApp({ html: "<html></html>", favicon: "<svg></svg>", token: "secret", session });
    vi.stubGlobal("fetch", (input: string | URL | Request, init?: RequestInit) => {
      const value = input instanceof Request ? input.url : input.toString();
      const url = new URL(value, "http://reviewonator.local");
      return serverApp.request(`${url.pathname}${url.search}`, init);
    });
    window.location.hash = "secret";
    render(createElement(App));
    await screen.findByText("Live");
    return session;
  }

  it("edits a finding by hand and keeps the new wording in the session", async () => {
    const session = await liveApp();
    const card = screen.getByText(review.comments[0].body).closest("article")!;

    fireEvent.click(within(card).getByRole("button", { name: "Edit comment" }));
    fireEvent.change(within(card).getByRole("textbox", { name: "Public comment" }), {
      target: { value: "Take the value from the caller." },
    });
    fireEvent.click(within(card).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(session.review.comments.find(({ id }) => id === "S1"))
      .toMatchObject({ body: "Take the value from the caller.", edited: true }));
    expect(await within(card).findByText("Edited")).toBeVisible();
    session.cancel();
  });

  it("deletes a hand-written comment and drops it from the selection", async () => {
    const session = await liveApp((current) => current.addUserComment({
      path: "src/example.ts",
      line: 2,
      side: "LEFT",
      body: "Keep the old constant for now.",
    }));
    const card = screen.getByText("Keep the old constant for now.").closest("article")!;
    fireEvent.click(within(card).getByRole("button", { name: "Include" }));
    fireEvent.click(within(card).getByRole("button", { name: "Delete comment" }));
    await waitFor(() => expect(screen.queryByText("Keep the old constant for now.")).toBeNull());
    expect(session.review.comments.map(({ id }) => id)).not.toContain("H1");

    fireEvent.click(screen.getAllByRole("button", { name: "Discuss with AI" })[0]);
    fireEvent.change(screen.getByLabelText("What do you want to discuss with the AI agent?"), {
      target: { value: "Is this right?" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send to AI" }));
    await expect(session.waitForAgentRequest()).resolves.toMatchObject({ selectedCommentIds: [] });
    session.cancel();
  });

  async function liveAppWithDraft(line: number) {
    vi.stubGlobal("EventSource", class { addEventListener() {} close() {} });
    const session = new ReviewSession(pullRequest, patch, review, new AppGateway(), discussion, true);
    const serverApp = createApp({ html: "<html></html>", favicon: "<svg></svg>", token: "secret", session });
    vi.stubGlobal("fetch", (input: string | URL | Request, init?: RequestInit) => {
      const value = input instanceof Request ? input.url : input.toString();
      const url = new URL(value, "http://reviewonator.local");
      return serverApp.request(`${url.pathname}${url.search}`, init);
    });
    window.location.hash = "secret";
    render(createElement(App));
    await screen.findByText("Live");
    const target = [...document.querySelector("diffs-container")!.shadowRoot!.querySelectorAll(`[data-line='${line}']`)][0];
    target.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, composed: true, pointerType: "mouse" }));
    fireEvent.click(screen.getByRole("button", { name: "Add a comment to this line" }));
    const draft = await screen.findByRole("region", { name: `Your comment for src/example.ts line ${line}` });
    return { session, draft };
  }

  it("describes the line comment button without promising an AI review", async () => {
    const session = await liveApp();

    expect(screen.getByRole("button", { name: "Add a comment to this line" })).toHaveAttribute("title", "Comment on this line");
    session.cancel();
  });

  it("adds a hand-written comment from the line draft without the AI agent", async () => {
    const { session, draft } = await liveAppWithDraft(3);
    fireEvent.change(within(draft).getByRole("textbox"), { target: { value: "Rename this before release." } });
    fireEvent.click(within(draft).getByRole("button", { name: "Add comment" }));

    await waitFor(() => expect(screen.queryByRole("region", { name: "Your comment for src/example.ts line 3" })).toBeNull());
    expect(session.review.comments.find(({ id }) => id === "H1"))
      .toMatchObject({ author: "user", path: "src/example.ts", line: 3, side: "RIGHT", body: "Rename this before release." });
    expect(session.snapshot().agentPending).toBe(false);
    const card = (await screen.findByText("Rename this before release.")).closest("article")!;
    expect(within(card).getByRole("button", { name: "Include" })).toHaveAttribute("aria-pressed", "false");
    session.cancel();
  });

  it("keeps the draft when the server rejects the hand-written comment", async () => {
    const { session, draft } = await liveAppWithDraft(3);
    fireEvent.change(within(draft).getByRole("textbox"), { target: { value: "Rename this before release." } });
    session.cancel();
    fireEvent.click(within(draft).getByRole("button", { name: "Add comment" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("This review session is no longer open.");
    expect(within(screen.getByRole("region", { name: "Your comment for src/example.ts line 3" })).getByRole("textbox"))
      .toHaveValue("Rename this before release.");
  });

  it("lets the user dismiss their discussion with a reason", async () => {
    const session = new ReviewSession(
      pullRequest,
      patch,
      { ...review, userThreads: [userThread] },
      new AppGateway(),
      discussion,
    );
    const serverApp = createApp({ html: "<html></html>", favicon: "<svg></svg>", token: "secret", session });
    vi.stubGlobal("fetch", (input: string | URL | Request, init?: RequestInit) => {
      const value = input instanceof Request ? input.url : input.toString();
      const url = new URL(value, "http://reviewonator.local");
      return serverApp.request(`${url.pathname}${url.search}`, init);
    });
    window.location.hash = "secret";
    render(createElement(App));

    await screen.findByRole("navigation", { name: "My comments" });
    fireEvent.click(screen.getByRole("button", { name: "Dismiss discussion" }));
    fireEvent.change(screen.getByLabelText("Why are you dismissing this discussion?"), {
      target: { value: "The agent is right; this function has no input contract." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send 1 request to AI agent" }));

    await expect(session.waitForResult()).resolves.toMatchObject({
      status: "revision_requested",
      threadReplies: [],
      dismissedThreads: [{
        threadId: "U1",
        reason: "The agent is right; this function has no input contract.",
      }],
    });
  });
});

describe("completion screen", () => {
  it.each([
    [{ type: "published", url: "https://example.test/review", event: "APPROVE" } as const, "Pull request approved", "completion-approved"],
    [{ type: "published", url: "https://example.test/review", event: "REQUEST_CHANGES" } as const, "Changes requested", "completion-changes-requested"],
    [{ type: "published", url: "https://example.test/review", event: "COMMENT" } as const, "Review comment published", "completion-commented"],
    [{ type: "revision" } as const, "Revision requested", "completion-revision"],
    [{ type: "cancelled" } as const, "Review cancelled", "completion-cancelled"],
  ])("uses a distinct completion state for %s", (completion, title, className) => {
    const { container } = render(createElement(CompletionScreen, { completion }));
    expect(screen.getByRole("heading", { name: title })).toBeVisible();
    expect(container.querySelector(".completion-icon")).toHaveClass(className);
  });

  it("automatically closes the tab after 60 seconds", () => {
    vi.useFakeTimers();
    const onAutoClose = vi.fn();
    render(createElement(CompletionScreen, {
      completion: { type: "revision" },
      onAutoClose,
    }));

    expect(screen.getByText("This tab will close automatically in 60 seconds.")).toBeVisible();
    act(() => vi.advanceTimersByTime(59_000));
    expect(onAutoClose).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1_000));
    expect(onAutoClose).toHaveBeenCalledOnce();
  });

  it("keeps the tab open when automatic closing is cancelled", () => {
    vi.useFakeTimers();
    const onAutoClose = vi.fn();
    render(createElement(CompletionScreen, {
      completion: { type: "cancelled" },
      onAutoClose,
    }));

    fireEvent.click(screen.getByRole("button", { name: "Keep tab open" }));
    expect(screen.getByText("Automatic closing cancelled.")).toBeVisible();
    act(() => vi.advanceTimersByTime(60_000));
    expect(onAutoClose).not.toHaveBeenCalled();
  });
});

describe("saved view preferences", () => {
  it("opens in the file view and diff layout saved by an earlier run and saves a change for the next run", async () => {
    const preferences = new FilePreferenceStore({
      REVIEWONATOR_STATE_DIR: await mkdtemp(join(tmpdir(), "reviewonator-view-preferences-")),
    });
    await preferences.update({ viewMode: "all", diffStyle: "split" });
    await openPage(serveSession(new ReviewSession(pullRequest, patch, review, new AppGateway(), discussion), preferences));

    render(createElement(App));

    expect(await screen.findByRole("button", { name: "All files" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Split" })).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByRole("button", { name: "Single file" }));
    fireEvent.click(screen.getByRole("button", { name: "Unified" }));

    expect(screen.getByRole("button", { name: "Single file" })).toHaveAttribute("aria-pressed", "true");
    await waitFor(async () => expect(await preferences.read()).toEqual({
      theme: "system",
      viewMode: "single",
      diffStyle: "unified",
      collapsedBriefings: [],
    }));
  });
});

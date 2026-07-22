import { createElement } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PullRequest } from "../../src/domain/pull-request";
import type { PublishRequest, ReviewComment } from "../../src/domain/review";
import type { GitHubGateway, LoadedPullRequest, PublishedReview } from "../../src/github/client";
import { createApp } from "../../src/server/app";
import { ReviewSession } from "../../src/server/session";
import { App, buildPublishBody, CompletionScreen, describeFilePath } from "../../web/App";
import { discussion, patch, pullRequest, review } from "../fixtures";

class AppGateway implements GitHubGateway {
  async verifyPrerequisites() {}
  async loadPullRequest(): Promise<LoadedPullRequest> { return { pullRequest, patch, discussion }; }
  async getHeadSha() { return pullRequest.headRefOid; }
  async loadFileContext() { return { oldContent: "export function answer() {\n  return 41;\n}", newContent: "export function answer() {\n  const answer = 42;\n  return answer;\n}" }; }
  async publishReview(_pr: PullRequest, _request: PublishRequest, _comments: ReviewComment[]): Promise<PublishedReview> {
    return { id: 1, url: "https://github.com/acme/widgets/pull/42#review-1", state: "COMMENTED" };
  }
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  window.location.hash = "";
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
    ).toBe("/favicon.svg"));
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

    fireEvent.click(screen.getAllByRole("button", { name: "Request revision" })[1]);
    fireEvent.change(screen.getByPlaceholderText("Explain what is inaccurate, unclear, or missing…"), {
      target: { value: "Make the test recommendation concrete." },
    });
    expect(screen.getByRole("button", { name: /Warning Revision G1 General comment/ })).toBeVisible();
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

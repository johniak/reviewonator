import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { MyCommentNavigation } from "../../web/components/MyCommentNavigation";
import { userThread } from "../fixtures";

describe("MyCommentNavigation", () => {
  it("keeps drafts and existing user discussions in a separate sidebar category", async () => {
    const onSelectThread = vi.fn();
    const onSelectDraft = vi.fn();
    const draft = {
      id: "U-draft",
      path: "src/example.ts",
      line: 3,
      side: "RIGHT" as const,
      message: "Check the return value.",
    };
    render(
      <MyCommentNavigation
        threads={[userThread]}
        drafts={[draft]}
        activeThreadId="U1"
        replyMessages={{}}
        dismissalReasons={{}}
        onSelectThread={onSelectThread}
        onSelectDraft={onSelectDraft}
      />,
    );

    expect(screen.getByText("My comments")).toBeVisible();
    expect(screen.getByRole("navigation", { name: "My comments" })).toBeVisible();
    const threadButton = screen.getByRole("button", { name: /Needs your reply.*src\/example\.ts:2/ });
    expect(threadButton).toHaveAttribute("aria-current", "true");
    await userEvent.click(threadButton);
    await userEvent.click(screen.getByRole("button", { name: /Draft.*src\/example\.ts:3/ }));
    expect(onSelectThread).toHaveBeenCalledWith(userThread);
    expect(onSelectDraft).toHaveBeenCalledWith(draft);
  });

  it("explains how to create the first user discussion", () => {
    render(
      <MyCommentNavigation
        threads={[]}
        drafts={[]}
        activeThreadId={null}
        replyMessages={{}}
        dismissalReasons={{}}
        onSelectThread={() => {}}
        onSelectDraft={() => {}}
      />,
    );
    expect(screen.getByText(/Click.*beside a line to start a discussion/)).toBeVisible();
  });
});

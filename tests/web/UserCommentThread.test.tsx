import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { UserCommentThreadCard, userThreadStatus } from "../../web/components/UserCommentThread";
import { userThread } from "../fixtures";

const actions = {
  replyMessages: {},
  dismissalReasons: {},
  onReplyChange: vi.fn(),
  onDismissalChange: vi.fn(),
  onSelectFinding: vi.fn(),
};

describe("UserCommentThreadCard", () => {
  it("shows the user-agent conversation and lets the user continue it", async () => {
    const onReplyChange = vi.fn();
    render(<UserCommentThreadCard thread={userThread} {...actions} onReplyChange={onReplyChange} />);

    expect(screen.getByText("You")).toBeVisible();
    expect(screen.getByText("AI agent")).toBeVisible();
    expect(screen.getByText("Needs your reply")).toBeVisible();
    await userEvent.type(screen.getByLabelText("Reply to the AI agent"), "The closure supplies the input.");
    expect(onReplyChange).toHaveBeenCalled();
  });

  it("shows the finding created after the agent agrees", async () => {
    const onSelectFinding = vi.fn();
    const accepted = { ...userThread, findingId: "S1" };
    render(<UserCommentThreadCard thread={accepted} {...actions} onSelectFinding={onSelectFinding} />);

    await userEvent.click(screen.getByRole("button", { name: "Agent created finding S1" }));
    expect(onSelectFinding).toHaveBeenCalledWith("S1");
    expect(screen.queryByLabelText("Reply to the AI agent")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Dismiss discussion" })).not.toBeInTheDocument();
  });

  it("requires the user to provide a reason before a dismissal is queued", async () => {
    const onDismissalChange = vi.fn();
    render(<UserCommentThreadCard thread={userThread} {...actions} onDismissalChange={onDismissalChange} />);

    await userEvent.click(screen.getByRole("button", { name: "Dismiss discussion" }));
    expect(screen.getByLabelText("Why are you dismissing this discussion?")).toBeVisible();
    await userEvent.type(
      screen.getByLabelText("Why are you dismissing this discussion?"),
      "The agent is right.",
    );
    expect(onDismissalChange).toHaveBeenCalled();
  });

  it("does not offer agent replies or dismissal controls after the user dismissed the thread", () => {
    render(<UserCommentThreadCard
      thread={{ ...userThread, dismissed: true, dismissalReason: "The agent is right." }}
      {...actions}
    />);

    expect(screen.getByText("Dismissed")).toBeVisible();
    expect(screen.getByText("The agent is right.")).toBeVisible();
    expect(screen.queryByLabelText("Reply to the AI agent")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Dismiss discussion" })).not.toBeInTheDocument();
  });
});

describe("userThreadStatus", () => {
  it("derives ownership of every thread state without letting the agent dismiss it", () => {
    expect(userThreadStatus({ ...userThread, messages: [userThread.messages[0]] }).label).toBe("Waiting for agent");
    expect(userThreadStatus(userThread).label).toBe("Needs your reply");
    expect(userThreadStatus(userThread, "More evidence").label).toBe("Reply queued");
    expect(userThreadStatus(userThread, "", "No longer relevant").label).toBe("Dismiss queued");
    expect(userThreadStatus({ ...userThread, dismissed: true, dismissalReason: "No issue." }).label).toBe("Dismissed");
    expect(userThreadStatus({ ...userThread, findingId: "S1" }).label).toBe("Finding S1");
  });
});

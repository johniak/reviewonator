import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import type { ReviewComment } from "../../src/domain/review";
import { ReviewCommentCard } from "../../web/components/ReviewCommentCard";
import { review } from "../fixtures";

describe("ReviewCommentCard", () => {
  it("separates the canonical comment from private reviewer context in the configured language", () => {
    const comment = review.comments[0];
    render(
      <ReviewCommentCard
        comment={comment}
        reviewerLanguage="German"
        focused
        agentPending={false}
        selectedIds={new Set([comment.id])}
        rejectedIds={new Set()}
        revisionMessages={{}}
        onToggleSelected={vi.fn()}
        onToggleRejected={vi.fn()}
        onRevisionChange={vi.fn()}
        onSendRevision={vi.fn(async () => {})}
        onEditComment={vi.fn(async () => true)}
        onDeleteComment={vi.fn(async () => {})}
      />,
    );
    expect(screen.getByText(comment.body)).toBeVisible();
    expect(screen.getByText(comment.reviewerExplanation!)).toBeVisible();
    expect(screen.getByText("For reviewer only")).toBeVisible();
    expect(screen.getByText("Private · German")).toBeVisible();
    expect(screen.getByRole("article")).toHaveClass("comment-severity-bug");
    expect(screen.getByRole("article")).toHaveClass("comment-focused");
    expect(screen.getByRole("article")).toHaveAttribute("id", "review-comment-S1");
  });

  it("offers separate deliberate include and reject actions", async () => {
    const onToggleSelected = vi.fn();
    const onToggleRejected = vi.fn();
    render(
      <ReviewCommentCard
        comment={review.comments[0]}
        agentPending={false}
        selectedIds={new Set()}
        rejectedIds={new Set()}
        revisionMessages={{}}
        onToggleSelected={onToggleSelected}
        onToggleRejected={onToggleRejected}
        onRevisionChange={vi.fn()}
        onSendRevision={vi.fn(async () => {})}
        onEditComment={vi.fn(async () => true)}
        onDeleteComment={vi.fn(async () => {})}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Include" }));
    await userEvent.click(screen.getByRole("button", { name: "Reject" }));
    expect(onToggleSelected).toHaveBeenCalledWith("S1");
    expect(onToggleRejected).toHaveBeenCalledWith("S1");
  });

  it("starts a private discussion with the AI agent", async () => {
    const onRevisionChange = vi.fn();
    const onSendRevision = vi.fn(async () => {});
    function Harness() {
      const [message, setMessage] = useState("");
      return (
        <ReviewCommentCard
          comment={review.comments[0]}
          agentPending={false}
          selectedIds={new Set(["S1"])}
          rejectedIds={new Set()}
          revisionMessages={{ S1: message }}
          onToggleSelected={vi.fn()}
          onToggleRejected={vi.fn()}
          onRevisionChange={(id, value) => {
            setMessage(value);
            onRevisionChange(id, value);
          }}
          onSendRevision={onSendRevision}
          onEditComment={vi.fn(async () => true)}
          onDeleteComment={vi.fn(async () => {})}
        />
      );
    }
    render(<Harness />);
    await userEvent.click(screen.getByRole("button", { name: "Discuss with AI" }));
    await userEvent.type(
      screen.getByRole("textbox", { name: "What do you want to discuss with the AI agent?" }),
      "Check the caller.",
    );
    expect(onRevisionChange).toHaveBeenLastCalledWith("S1", "Check the caller.");
    await userEvent.click(screen.getByRole("button", { name: "Send to AI" }));
    expect(onSendRevision).toHaveBeenCalledWith("S1");
  });

  it("shows the full finding discussion and allows another live reply", async () => {
    const onRevisionChange = vi.fn();
    const comment = {
      ...review.comments[0],
      discussion: [
        { id: "S1-D1", author: "user" as const, body: "Did you check the caller?" },
        { id: "S1-D2", author: "agent" as const, body: "Yes. The caller still passes fixed state." },
      ],
    };
    render(<ReviewCommentCard
      comment={comment}
      agentPending={false}
      selectedIds={new Set()}
      rejectedIds={new Set()}
      revisionMessages={{}}
      onToggleSelected={vi.fn()}
      onToggleRejected={vi.fn()}
      onRevisionChange={onRevisionChange}
      onSendRevision={vi.fn(async () => {})}
      onEditComment={vi.fn(async () => true)}
      onDeleteComment={vi.fn(async () => {})}
    />);

    expect(screen.getByText("Did you check the caller?")).toBeVisible();
    expect(screen.getByText("Yes. The caller still passes fixed state.")).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Continue discussion" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Reply to the AI agent" }), {
      target: { value: "Check the other path too." },
    });
    expect(onRevisionChange).toHaveBeenLastCalledWith("S1", "Check the other path too.");
  });

  it("shows that the agent is working after the user sends a finding reply", () => {
    render(<ReviewCommentCard
      comment={{
        ...review.comments[0],
        discussion: [{ id: "S1-D1", author: "user", body: "Please check this again." }],
      }}
      agentPending
      selectedIds={new Set()}
      rejectedIds={new Set()}
      revisionMessages={{}}
      onToggleSelected={vi.fn()}
      onToggleRejected={vi.fn()}
      onRevisionChange={vi.fn()}
      onSendRevision={vi.fn(async () => {})}
      onEditComment={vi.fn(async () => true)}
      onDeleteComment={vi.fn(async () => {})}
    />);

    expect(screen.getByRole("button", { name: "Waiting for AI" })).toBeDisabled();
    expect(screen.getByText("The AI agent is checking this finding.")).toBeVisible();
  });

  describe("hand-written comments and edits", () => {
    const mine: ReviewComment = {
      id: "H1",
      type: "line",
      author: "user",
      path: "src/example.ts",
      line: 2,
      side: "LEFT",
      body: "Keep the old constant for now.",
    };
    const props = (comment: ReviewComment) => ({
      comment,
      agentPending: false,
      selectedIds: new Set<string>(),
      rejectedIds: new Set<string>(),
      revisionMessages: {},
      onToggleSelected: vi.fn(),
      onToggleRejected: vi.fn(),
      onRevisionChange: vi.fn(),
      onSendRevision: vi.fn(async () => {}),
      onEditComment: vi.fn(async () => true),
      onDeleteComment: vi.fn(async () => {}),
    });

    it("marks a hand-written comment as yours without severity or private explanation", () => {
      render(<ReviewCommentCard {...props(mine)} />);

      expect(screen.getByText("You")).toBeVisible();
      expect(screen.getByRole("article")).toHaveClass("comment-author-user");
      expect(screen.queryByText("For reviewer only")).not.toBeInTheDocument();
      expect(screen.queryByText(/^(Security|Bug|Warning|Suggestion|Nit)$/)).not.toBeInTheDocument();
    });

    it("edits the wording and severity of a hand-written comment", async () => {
      const cardProps = props(mine);
      render(<ReviewCommentCard {...cardProps} />);

      await userEvent.click(screen.getByRole("button", { name: "Edit comment" }));
      const field = screen.getByRole("textbox", { name: "Public comment" });
      expect(field).toHaveValue("Keep the old constant for now.");
      expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
      await userEvent.clear(field);
      await userEvent.type(field, "Keep the old constant until callers migrate.");
      await userEvent.selectOptions(screen.getByRole("combobox", { name: "Severity" }), "Warning");
      await userEvent.click(screen.getByRole("button", { name: "Save" }));

      expect(cardProps.onEditComment).toHaveBeenCalledWith("H1", {
        body: "Keep the old constant until callers migrate.",
        severity: "warning",
      });
      expect(screen.queryByRole("textbox", { name: "Public comment" })).not.toBeInTheDocument();
    });

    it("edits only the wording of an agent finding and shows that it was edited", async () => {
      const cardProps = props({ ...review.comments[0], edited: true });
      render(<ReviewCommentCard {...cardProps} />);

      expect(screen.getByText("Edited")).toBeVisible();
      await userEvent.click(screen.getByRole("button", { name: "Edit comment" }));
      expect(screen.queryByRole("combobox", { name: "Severity" })).not.toBeInTheDocument();
      await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
      expect(screen.queryByRole("textbox", { name: "Public comment" })).not.toBeInTheDocument();

      await userEvent.click(screen.getByRole("button", { name: "Edit comment" }));
      await userEvent.type(screen.getByRole("textbox", { name: "Public comment" }), " Please.");
      await userEvent.click(screen.getByRole("button", { name: "Save" }));
      expect(cardProps.onEditComment).toHaveBeenCalledWith("S1", { body: `${review.comments[0].body} Please.` });
    });

    it("locks editing while the AI agent checks the comment", () => {
      render(<ReviewCommentCard {...props({
        ...review.comments[0],
        discussion: [{ id: "S1-D1", author: "user", body: "Is this right?" }],
      })} />);

      expect(screen.getByRole("button", { name: "Edit comment" })).toBeDisabled();
    });

    it("deletes only hand-written comments", async () => {
      const { unmount } = render(<ReviewCommentCard {...props(review.comments[0])} />);
      expect(screen.queryByRole("button", { name: "Delete comment" })).not.toBeInTheDocument();
      unmount();

      const cardProps = props(mine);
      render(<ReviewCommentCard {...cardProps} />);
      await userEvent.click(screen.getByRole("button", { name: "Delete comment" }));
      expect(cardProps.onDeleteComment).toHaveBeenCalledWith("H1");
    });
  });
});

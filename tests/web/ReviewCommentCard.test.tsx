import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
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
        selectedIds={new Set([comment.id])}
        revisionMessages={{}}
        onToggleSelected={vi.fn()}
        onRevisionChange={vi.fn()}
      />,
    );
    expect(screen.getByText(comment.body)).toBeVisible();
    expect(screen.getByText(comment.reviewerExplanation)).toBeVisible();
    expect(screen.getByText("For reviewer only")).toBeVisible();
    expect(screen.getByText("Private · German")).toBeVisible();
    expect(screen.getByRole("article")).toHaveClass("comment-severity-bug");
    expect(screen.getByRole("article")).toHaveClass("comment-focused");
    expect(screen.getByRole("article")).toHaveAttribute("id", "review-comment-S1");
  });

  it("lets the user include or exclude an agent comment", async () => {
    const onToggleSelected = vi.fn();
    render(
      <ReviewCommentCard
        comment={review.comments[0]}
        selectedIds={new Set(["S1"])}
        revisionMessages={{}}
        onToggleSelected={onToggleSelected}
        onRevisionChange={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Included" }));
    expect(onToggleSelected).toHaveBeenCalledWith("S1");
  });

  it("collects a precise revision request for Claude", async () => {
    const onRevisionChange = vi.fn();
    function Harness() {
      const [message, setMessage] = useState("");
      return (
        <ReviewCommentCard
          comment={review.comments[0]}
          selectedIds={new Set(["S1"])}
          revisionMessages={{ S1: message }}
          onToggleSelected={vi.fn()}
          onRevisionChange={(id, value) => {
            setMessage(value);
            onRevisionChange(id, value);
          }}
        />
      );
    }
    render(<Harness />);
    await userEvent.click(screen.getByRole("button", { name: "Request revision" }));
    await userEvent.type(screen.getByRole("textbox", { name: "What should Claude change?" }), "Check the caller.");
    expect(onRevisionChange).toHaveBeenLastCalledWith("S1", "Check the caller.");
  });
});

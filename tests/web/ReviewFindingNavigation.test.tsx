import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ReviewFindingNavigation } from "../../web/components/ReviewFindingNavigation";
import { review } from "../fixtures";

describe("ReviewFindingNavigation", () => {
  it("navigates to line and general findings and marks the active one", async () => {
    const onSelect = vi.fn();
    render(
      <ReviewFindingNavigation
        comments={review.comments}
        activeCommentId="S1"
        selectedIds={new Set(["S1"])}
        rejectedIds={new Set()}
        revisionMessages={{ G1: "Rewrite this finding." }}
        onSelect={onSelect}
      />,
    );

    const lineFinding = screen.getByRole("button", { name: /Bug Included S1 src\/example\.ts:2/ });
    expect(lineFinding).toHaveAttribute("aria-current", "true");
    await userEvent.click(lineFinding);
    await userEvent.click(screen.getByRole("button", { name: /Warning Revision G1 General comment/ }));

    expect(onSelect).toHaveBeenNthCalledWith(1, review.comments[0]);
    expect(onSelect).toHaveBeenNthCalledWith(2, review.comments[1]);
  });

  it("distinguishes consciously rejected findings from pending ones", () => {
    render(
      <ReviewFindingNavigation
        comments={review.comments}
        activeCommentId={null}
        selectedIds={new Set()}
        rejectedIds={new Set(["S1"])}
        revisionMessages={{}}
        onSelect={() => {}}
      />,
    );

    expect(screen.getByRole("button", { name: /Bug Rejected S1/ })).toBeVisible();
    expect(screen.getByRole("button", { name: /Warning Pending G1/ })).toBeVisible();
  });
});

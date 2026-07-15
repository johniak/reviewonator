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
        onSelect={onSelect}
      />,
    );

    const lineFinding = screen.getByRole("button", { name: /Bug S1 src\/example\.ts:2/ });
    expect(lineFinding).toHaveAttribute("aria-current", "true");
    await userEvent.click(lineFinding);
    await userEvent.click(screen.getByRole("button", { name: /Warning G1 General comment/ }));

    expect(onSelect).toHaveBeenNthCalledWith(1, review.comments[0]);
    expect(onSelect).toHaveBeenNthCalledWith(2, review.comments[1]);
  });
});

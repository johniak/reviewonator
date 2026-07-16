import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { PublishDialog } from "../../web/components/PublishDialog";
import { review } from "../fixtures";

describe("PublishDialog", () => {
  it("shows the exact selected content and requires confirmation", async () => {
    const onPublish = vi.fn();
    render(
      <PublishDialog
        open
        comments={review.comments}
        reviewerLanguage="German"
        initialBody={review.summary}
        initialEvent="REQUEST_CHANGES"
        publishing={false}
        error={null}
        onOpenChange={vi.fn()}
        onPublish={onPublish}
      />,
    );

    const publish = screen.getByRole("button", { name: "Publish review" });
    expect(publish).toBeDisabled();
    expect(screen.getByText("src/example.ts:2")).toBeVisible();
    expect(screen.getByText("General comment")).toBeVisible();
    expect(screen.getByText(review.comments[0].body)).toBeVisible();
    expect(screen.queryByText(review.comments[0].reviewerExplanation)).not.toBeInTheDocument();
    expect(screen.getByText(/Private German explanations are excluded/)).toBeVisible();

    await userEvent.click(screen.getByRole("radio", { name: /Approve/ }));
    await userEvent.click(screen.getByRole("checkbox", { name: /I confirm/ }));
    await userEvent.click(publish);

    expect(onPublish).toHaveBeenCalledWith({ body: review.summary, event: "APPROVE" });
  });

  it("allows approval with an empty GitHub body", async () => {
    const onPublish = vi.fn();
    render(
      <PublishDialog
        open
        comments={[]}
        initialBody="Summary"
        initialEvent="APPROVE"
        publishing={false}
        error={null}
        onOpenChange={vi.fn()}
        onPublish={onPublish}
      />,
    );
    const body = screen.getByRole("textbox", { name: /Review summary posted to GitHub/ });
    await userEvent.clear(body);
    await userEvent.click(screen.getByRole("checkbox", { name: /I confirm/ }));
    await userEvent.click(screen.getByRole("button", { name: "Publish review" }));
    expect(onPublish).toHaveBeenCalledWith({ body: "", event: "APPROVE" });
  });

  it("keeps publishing disabled for an empty non-approval body", async () => {
    render(
      <PublishDialog
        open
        comments={[]}
        initialBody="Summary"
        initialEvent="REQUEST_CHANGES"
        publishing={false}
        error={null}
        onOpenChange={vi.fn()}
        onPublish={vi.fn()}
      />,
    );
    const body = screen.getByRole("textbox", { name: "Review summary posted to GitHub" });
    await userEvent.clear(body);
    await userEvent.click(screen.getByRole("checkbox", { name: /I confirm/ }));
    expect(screen.getByRole("button", { name: "Publish review" })).toBeDisabled();
  });
});

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { UpdateNoticeToast } from "../../web/components/UpdateNotice";

const notice = {
  current: "0.7.0",
  latest: "0.8.0",
  releaseUrl: "https://github.com/johniak/reviewonator/releases/tag/v0.8.0",
};

describe("UpdateNoticeToast", () => {
  it("announces the available version and links the release notes", () => {
    render(<UpdateNoticeToast notice={notice} onDismiss={() => {}} />);

    expect(screen.getByRole("status")).toHaveTextContent("Reviewonator 0.8.0 is available — you have 0.7.0.");
    expect(screen.getByText("reviewonator update")).toBeVisible();
    const link = screen.getByRole("link", { name: "Release notes" });
    expect(link).toHaveAttribute("href", notice.releaseUrl);
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noreferrer");
  });

  it("copies the update command", async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<UpdateNoticeToast notice={notice} onDismiss={() => {}} />);

    fireEvent.click(screen.getByRole("button", { name: "Copy update command" }));

    expect(writeText).toHaveBeenCalledWith("reviewonator update");
    await waitFor(() => expect(screen.getByRole("button", { name: "Copy update command" })).toHaveTextContent("Copied"));
  });

  it("calls onDismiss from the dismiss button", () => {
    const onDismiss = vi.fn();
    render(<UpdateNoticeToast notice={notice} onDismiss={onDismiss} />);

    fireEvent.click(screen.getByRole("button", { name: "Dismiss update notice" }));

    expect(onDismiss).toHaveBeenCalledOnce();
  });
});

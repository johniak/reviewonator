import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import type { Briefing } from "../../src/domain/review";
import { PrBriefing } from "../../web/components/PrBriefing";

function Briefed({ briefing, reviewerLanguage = "English" }: { briefing: Briefing; reviewerLanguage?: string }) {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <PrBriefing
      briefing={briefing}
      reviewerLanguage={reviewerLanguage}
      collapsed={collapsed}
      onCollapsedChange={setCollapsed}
    />
  );
}

describe("PrBriefing", () => {
  it("shows the private briefing with a link to the ticket it is based on", () => {
    render(
      <Briefed
        reviewerLanguage="Polish"
        briefing={{
          ticket: { key: "ACME-142", title: "Retry payments after timeouts", url: "https://acme.atlassian.net/browse/ACME-142" },
          text: "Ticket prosi o ponawianie płatności. PR je dodaje, ale bez limitu prób.",
        }}
      />,
    );

    const section = screen.getByRole("region", { name: "About this PR" });
    expect(section).toHaveTextContent("Private · Polish");
    expect(screen.getByRole("link", { name: /ACME-142 Retry payments after timeouts/ }))
      .toHaveAttribute("href", "https://acme.atlassian.net/browse/ACME-142");
    expect(screen.getByText("Ticket prosi o ponawianie płatności. PR je dodaje, ale bez limitu prób.")).toBeVisible();
  });

  it("names a ticket without a link as plain text", () => {
    render(<Briefed briefing={{ ticket: { key: "OPS-7" }, text: "The PR renames a job." }} />);

    expect(screen.getByText("OPS-7")).toBeVisible();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("says plainly when the briefing is based on the code alone", () => {
    render(<Briefed briefing={{ text: "The PR renames a job." }} />);

    expect(screen.getByText("No ticket found, based on the code only")).toBeVisible();
    expect(screen.getByText("The PR renames a job.")).toBeVisible();
  });

  it("collapses to one line that keeps the ticket and opens again", () => {
    render(<Briefed briefing={{ ticket: { key: "OPS-7" }, text: "The PR renames a job." }} />);

    fireEvent.click(screen.getByRole("button", { name: "About this PR" }));

    expect(screen.getByRole("button", { name: "About this PR" })).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("The PR renames a job.")).not.toBeInTheDocument();
    expect(screen.getByText("OPS-7")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "About this PR" }));

    expect(screen.getByRole("button", { name: "About this PR" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("The PR renames a job.")).toBeVisible();
  });
});

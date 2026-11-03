import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PrBriefing } from "../../web/components/PrBriefing";

describe("PrBriefing", () => {
  it("shows the private briefing with a link to the ticket it is based on", () => {
    render(
      <PrBriefing
        reviewerLanguage="Polish"
        briefing={{
          ticket: { key: "ACME-142", title: "Retry payments after timeouts", url: "https://acme.atlassian.net/browse/ACME-142" },
          text: "Ticket prosi o ponawianie płatności. PR je dodaje, ale bez limitu prób.",
        }}
      />,
    );

    const section = screen.getByRole("region", { name: "What this PR is about" });
    expect(section).toHaveTextContent("Private · Polish");
    expect(screen.getByRole("link", { name: /ACME-142 Retry payments after timeouts/ }))
      .toHaveAttribute("href", "https://acme.atlassian.net/browse/ACME-142");
    expect(screen.getByText("Ticket prosi o ponawianie płatności. PR je dodaje, ale bez limitu prób.")).toBeVisible();
  });

  it("names a ticket without a link as plain text", () => {
    render(<PrBriefing reviewerLanguage="English" briefing={{ ticket: { key: "OPS-7" }, text: "The PR renames a job." }} />);

    expect(screen.getByText("OPS-7")).toBeVisible();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("says plainly when the briefing is based on the code alone", () => {
    render(<PrBriefing reviewerLanguage="English" briefing={{ text: "The PR renames a job." }} />);

    expect(screen.getByText("No ticket found, based on the code only")).toBeVisible();
    expect(screen.getByText("The PR renames a job.")).toBeVisible();
  });
});

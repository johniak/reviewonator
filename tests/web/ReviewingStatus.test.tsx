import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { formatElapsed, ReviewingStatus } from "../../web/components/ReviewingStatus";

afterEach(() => vi.useRealTimers());

describe("ReviewingStatus", () => {
  it("formats the elapsed time as minutes and seconds, with hours past an hour", () => {
    expect(formatElapsed(0)).toBe("0:00");
    expect(formatElapsed(252)).toBe("4:12");
    expect(formatElapsed(3_599)).toBe("59:59");
    expect(formatElapsed(3_600)).toBe("1:00:00");
    expect(formatElapsed(3_600 + 5 * 60 + 9)).toBe("1:05:09");
    expect(formatElapsed(-3)).toBe("0:00");
  });

  it("counts up every second and adds the stop hint after 15 minutes", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-06T10:14:58Z"));
    render(<ReviewingStatus startedAt="2026-11-06T10:00:00Z" />);

    expect(screen.getByText("The AI is reviewing this pull request")).toBeVisible();
    expect(screen.getByText("14:58")).toBeVisible();
    expect(screen.queryByText(/If the agent has stopped/)).not.toBeInTheDocument();

    act(() => vi.advanceTimersByTime(2_000));
    expect(screen.getByText("15:00")).toBeVisible();
    expect(screen.getByText("If the agent has stopped, cancel this review and run the skill again.")).toBeVisible();
  });
});

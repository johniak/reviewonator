import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MarkdownText } from "../../web/components/MarkdownText";

describe("MarkdownText", () => {
  it("renders a fenced code block as code and keeps its lines", () => {
    const { container } = render(
      <MarkdownText>{"Use a guard:\n\n```ts\nif (!input) return;\nreturn input.trim();\n```"}</MarkdownText>,
    );

    const code = container.querySelector("pre > code.language-ts");
    expect(code).not.toBeNull();
    expect(code).toHaveTextContent("if (!input) return; return input.trim();");
    expect(code!.textContent).toBe("if (!input) return;\nreturn input.trim();\n");
    expect(screen.getByText("Use a guard:")).toBeVisible();
  });

  it("labels a GitHub suggestion block as a suggested change", () => {
    const { container } = render(<MarkdownText>{"```suggestion\nconst answer = 42;\n```"}</MarkdownText>);

    expect(screen.getByText("Suggested change")).toBeVisible();
    expect(container.querySelector(".markdown-suggestion pre code")).toHaveTextContent("const answer = 42;");
  });

  it("renders inline code, lists, and links the way GitHub does", () => {
    const { container } = render(
      <MarkdownText>{"Call `parse()` first.\n\n- one\n- two\n\nSee [the docs](https://example.com)."}</MarkdownText>,
    );

    expect(container.querySelector("p > code")).toHaveTextContent("parse()");
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByRole("link", { name: "the docs" })).toHaveAttribute("target", "_blank");
  });

  it("keeps a single new line as a line break, as GitHub comments do", () => {
    const { container } = render(<MarkdownText>{"Co: zła stała.\nDlaczego: ignoruje wejście."}</MarkdownText>);

    expect(container.querySelector("p br")).not.toBeNull();
    expect(container.querySelectorAll("p")).toHaveLength(1);
  });
});

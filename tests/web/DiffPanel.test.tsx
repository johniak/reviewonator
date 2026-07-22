import { readFileSync } from "node:fs";
import { parsePatchFiles } from "@pierre/diffs";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  buildExpandableDiff,
  buildLineAnnotations,
  DiffPanel,
  LineCommentDraftCard,
} from "../../web/components/DiffPanel";
import { review } from "../fixtures";

const patch = readFileSync("tests/e2e/fixtures/pr.patch", "utf8");
const fileUrls = {
  "src/payments/retry.ts": "https://github.com/acme/widgets/blob/head-sha/src/payments/retry.ts",
  "src/config.ts": "https://github.com/acme/widgets/blob/head-sha/src/config.ts",
};
const actions = {
  selectedIds: new Set(review.comments.map(({ id }) => id)),
  rejectedIds: new Set<string>(),
  revisionMessages: {},
  onToggleSelected: vi.fn(),
  onToggleRejected: vi.fn(),
  onRevisionChange: vi.fn(),
  drafts: [],
  onCreateDraft: vi.fn(),
  onChangeDraft: vi.fn(),
  onRemoveDraft: vi.fn(),
};
const loadFileContext = vi.fn(async () => ({ oldContent: "", newContent: "" }));

describe("DiffPanel view modes", () => {
  it("keeps the custom comment trigger clear of the line number", () => {
    const styles = readFileSync("web/styles.css", "utf8");
    const triggerRule = styles.match(/\.diff-comment-trigger \{([\s\S]*?)\n\}/)?.[1];

    expect(triggerRule).toContain("width: 1lh");
    expect(triggerRule).toContain("margin-right: calc(-1lh + 1ch)");
  });

  it("turns a partial GitHub patch into an expandable full-file diff", () => {
    const file = parsePatchFiles(patch, "test", true)[0].files[0];
    const oldContent = [
      "import { provider } from './provider';",
      "",
      "export async function charge(payment: Payment) {",
      "  try {",
      "    return await provider.charge(payment);",
      "  } catch (error) {",
      "    throw error;",
      "  }",
      "}",
    ].join("\n");
    const newContent = oldContent.replace(
      "    throw error;",
      "    if (error instanceof TimeoutError) {\n      while (true) {\n        return await provider.charge(payment);\n      }\n    }\n    throw error;",
    );
    const expanded = buildExpandableDiff(file, { oldContent, newContent });
    expect(expanded.isPartial).toBe(false);
    expect(expanded.additionLines.length).toBeGreaterThan(file.additionLines.length);
  });

  it("renders only the active file in single-file mode", () => {
    const { rerender } = render(
      <DiffPanel
        patch={patch}
        activePath="src/config.ts"
        fileUrls={fileUrls}
        comments={[]}
        focusedCommentId={null}
        viewMode="single"
        onViewModeChange={vi.fn()}
        diffStyle="unified"
        onDiffStyleChange={vi.fn()}
        loadFileContext={loadFileContext}
        {...actions}
      />,
    );
    expect(screen.getByRole("heading", { name: "src/config.ts" })).toBeVisible();
    expect(screen.queryByRole("heading", { name: "src/payments/retry.ts" })).not.toBeInTheDocument();

    rerender(
      <DiffPanel
        patch={patch}
        activePath="src/payments/retry.ts"
        fileUrls={fileUrls}
        comments={[]}
        focusedCommentId={null}
        viewMode="single"
        onViewModeChange={vi.fn()}
        diffStyle="unified"
        onDiffStyleChange={vi.fn()}
        loadFileContext={loadFileContext}
        {...actions}
      />,
    );
    expect(screen.getAllByRole("heading", { name: "src/payments/retry.ts" })).toHaveLength(1);
    expect(screen.queryByRole("heading", { name: "src/config.ts" })).not.toBeInTheDocument();
  });

  it("renders every changed file one below another in all-files mode", () => {
    render(
      <DiffPanel
        patch={patch}
        activePath="src/payments/retry.ts"
        fileUrls={fileUrls}
        comments={[]}
        focusedCommentId={null}
        viewMode="all"
        onViewModeChange={vi.fn()}
        diffStyle="unified"
        onDiffStyleChange={vi.fn()}
        loadFileContext={loadFileContext}
        {...actions}
      />,
    );
    expect(screen.getByRole("heading", { name: "src/payments/retry.ts" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "src/config.ts" })).toBeVisible();
    expect(screen.getAllByRole("link", { name: "View full file on GitHub" })).toHaveLength(2);
  });

  it("lets the user switch between unified and split diffs", async () => {
    const onDiffStyleChange = vi.fn();
    render(
      <DiffPanel
        patch={patch}
        activePath="src/config.ts"
        fileUrls={fileUrls}
        comments={[]}
        focusedCommentId={null}
        viewMode="single"
        onViewModeChange={vi.fn()}
        diffStyle="unified"
        onDiffStyleChange={onDiffStyleChange}
        loadFileContext={loadFileContext}
        {...actions}
      />,
    );
    expect(screen.getByRole("button", { name: "Unified" })).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(screen.getByRole("button", { name: "Split" }));
    expect(onDiffStyleChange).toHaveBeenCalledWith("split");
  });

  it("keeps an AI finding and a user draft together on the same line", () => {
    const draft = {
      path: "src/example.ts",
      line: 2,
      side: "RIGHT" as const,
      message: "Check whether this constant is intentional.",
    };
    const annotations = buildLineAnnotations("src/example.ts", review.comments, [draft]);

    expect(annotations).toHaveLength(1);
    expect(annotations[0]).toMatchObject({
      side: "additions",
      lineNumber: 2,
      metadata: { comments: [review.comments[0]], draft },
    });
  });

  it("lets the user edit and discard a line comment before sending it to the AI agent", async () => {
    const onChangeDraft = vi.fn();
    const onRemoveDraft = vi.fn();
    const draft = { path: "src/example.ts", line: 2, side: "RIGHT" as const, message: "" };
    render(
      <LineCommentDraftCard
        draft={draft}
        onChangeDraft={onChangeDraft}
        onRemoveDraft={onRemoveDraft}
      />,
    );

    await userEvent.type(screen.getByRole("textbox"), "This ignores the input.");
    expect(onChangeDraft).toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Discard this comment" }));
    expect(onRemoveDraft).toHaveBeenCalledWith({ path: "src/example.ts", line: 2, side: "RIGHT" });
  });
});

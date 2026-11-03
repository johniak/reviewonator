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
import { review, userThread } from "../fixtures";

const patch = readFileSync("tests/e2e/fixtures/pr.patch", "utf8");
const fileUrls = {
  "src/payments/retry.ts": "https://github.com/acme/widgets/blob/head-sha/src/payments/retry.ts",
  "src/config.ts": "https://github.com/acme/widgets/blob/head-sha/src/config.ts",
};
const actions = {
  agentPending: false,
  selectedIds: new Set(review.comments.map(({ id }) => id)),
  rejectedIds: new Set<string>(),
  revisionMessages: {},
  onToggleSelected: vi.fn(),
  onToggleRejected: vi.fn(),
  onRevisionChange: vi.fn(),
  onSendRevision: vi.fn(async () => {}),
  userThreads: [],
  focusedThreadId: null,
  replyMessages: {},
  dismissalReasons: {},
  onReplyChange: vi.fn(),
  onDismissalChange: vi.fn(),
  onSendReply: vi.fn(),
  onSelectFinding: vi.fn(),
  drafts: [],
  onCreateDraft: vi.fn(),
  onChangeDraft: vi.fn(),
  onRemoveDraft: vi.fn(),
  onSendDraft: vi.fn(),
  onAddComment: vi.fn(),
  onEditComment: vi.fn(async () => true),
  onDeleteComment: vi.fn(async () => {}),
  viewedPaths: new Set<string>(),
  onViewedChange: vi.fn(),
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

  it("keeps the GitHub patch when the loaded file contents do not contain the change", () => {
    const file = parsePatchFiles(patch, "test", true)[0].files[0];
    const unrelated = "export const unrelated = true;\n";

    const expanded = buildExpandableDiff(file, { oldContent: unrelated, newContent: unrelated });

    expect(expanded).toBe(file);
    expect(expanded.hunks).toHaveLength(1);
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

  it("keeps the user discussion, AI finding, and a new draft together on the same line", () => {
    const draft = {
      id: "U-draft",
      path: "src/example.ts",
      line: 2,
      side: "RIGHT" as const,
      message: "Check whether this constant is intentional.",
    };
    const annotations = buildLineAnnotations("src/example.ts", review.comments, [userThread], [draft]);

    expect(annotations).toHaveLength(1);
    expect(annotations[0]).toMatchObject({
      side: "additions",
      lineNumber: 2,
      metadata: { comments: [review.comments[0]], userThreads: [userThread], draft },
    });
  });

  it("anchors a user discussion to the selected side of the diff", () => {
    const deletedLineThread = { ...userThread, line: 1, side: "LEFT" as const };

    expect(buildLineAnnotations("src/example.ts", [], [deletedLineThread], [])[0]).toMatchObject({
      side: "deletions",
      lineNumber: 1,
      metadata: { userThreads: [deletedLineThread] },
    });
  });

  it("places a hand-written comment on a deleted line beside that deleted line", () => {
    const mine = {
      id: "H1",
      type: "line" as const,
      author: "user" as const,
      path: "src/example.ts",
      line: 2,
      side: "LEFT" as const,
      body: "Keep the old constant for now.",
    };

    expect(buildLineAnnotations("src/example.ts", [mine], [], [])).toEqual([{
      side: "deletions",
      lineNumber: 2,
      metadata: { comments: [mine], userThreads: [] },
    }]);
  });

  it("lets the user edit and discard a line comment before sending it to the AI agent", async () => {
    const onChangeDraft = vi.fn();
    const onRemoveDraft = vi.fn();
    const draft = { id: "U-draft", path: "src/example.ts", line: 2, side: "RIGHT" as const, message: "" };
    render(
      <LineCommentDraftCard
        draft={draft}
        agentPending={false}
        onChangeDraft={onChangeDraft}
        onRemoveDraft={onRemoveDraft}
        onSendDraft={vi.fn()}
        onAddComment={vi.fn()}
      />,
    );

    await userEvent.type(screen.getByRole("textbox"), "This ignores the input.");
    expect(onChangeDraft).toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Discard this comment" }));
    expect(onRemoveDraft).toHaveBeenCalledWith({ path: "src/example.ts", line: 2, side: "RIGHT" });
  });

  it("explains both ways to use a line comment", () => {
    render(
      <LineCommentDraftCard
        draft={{ id: "U-draft", path: "src/example.ts", line: 2, side: "RIGHT", message: "" }}
        agentPending={false}
        onChangeDraft={vi.fn()}
        onRemoveDraft={vi.fn()}
        onSendDraft={vi.fn()}
        onAddComment={vi.fn()}
      />,
    );

    expect(screen.getByPlaceholderText(
      "Write your comment. Add it as written, or send it to the AI agent to check it against the code first.",
    )).toBeVisible();
  });

  it("adds the line comment to the review without the AI agent", async () => {
    const onAddComment = vi.fn();
    const draft = { id: "U-draft", path: "src/example.ts", line: 2, side: "LEFT" as const, message: "" };
    const card = (message: string, agentPending = false) => (
      <LineCommentDraftCard
        draft={{ ...draft, message }}
        agentPending={agentPending}
        onChangeDraft={vi.fn()}
        onRemoveDraft={vi.fn()}
        onSendDraft={vi.fn()}
        onAddComment={onAddComment}
      />
    );
    const { rerender } = render(card("  "));

    expect(screen.getByRole("button", { name: "Add comment" })).toBeDisabled();
    rerender(card("Keep the old constant for now.", true));
    await userEvent.click(screen.getByRole("button", { name: "Add comment" }));
    expect(onAddComment).toHaveBeenCalledWith({ path: "src/example.ts", line: 2, side: "LEFT" });
  });

  it("sends only this line comment to the AI agent once it has text", async () => {
    const onSendDraft = vi.fn();
    const draft = { id: "U-draft", path: "src/example.ts", line: 2, side: "RIGHT" as const, message: "" };
    const card = (message: string, agentPending = false) => (
      <LineCommentDraftCard
        draft={{ ...draft, message }}
        agentPending={agentPending}
        onChangeDraft={vi.fn()}
        onRemoveDraft={vi.fn()}
        onSendDraft={onSendDraft}
        onAddComment={vi.fn()}
      />
    );
    const { rerender } = render(card("  "));

    expect(screen.getByRole("button", { name: "Send to AI" })).toBeDisabled();
    rerender(card("This ignores the input."));
    await userEvent.click(screen.getByRole("button", { name: "Send to AI" }));
    expect(onSendDraft).toHaveBeenCalledWith({ path: "src/example.ts", line: 2, side: "RIGHT" });

    rerender(card("This ignores the input.", true));
    expect(screen.getByRole("button", { name: "AI agent is responding" })).toBeDisabled();
  });

  it("sends the line comment to the AI agent on Enter, not on Shift+Enter", async () => {
    const onSendDraft = vi.fn();
    const onChangeDraft = vi.fn();
    const draft = { id: "U-draft", path: "src/example.ts", line: 2, side: "RIGHT" as const, message: "Check this." };
    render(
      <LineCommentDraftCard
        draft={draft}
        agentPending={false}
        onChangeDraft={onChangeDraft}
        onRemoveDraft={vi.fn()}
        onSendDraft={onSendDraft}
        onAddComment={vi.fn()}
      />,
    );

    await userEvent.type(screen.getByRole("textbox"), "{Shift>}{Enter}{/Shift}");
    expect(onSendDraft).not.toHaveBeenCalled();
    expect(onChangeDraft).toHaveBeenLastCalledWith({ path: "src/example.ts", line: 2, side: "RIGHT" }, "Check this.\n");

    await userEvent.type(screen.getByRole("textbox"), "{Enter}");
    expect(onSendDraft).toHaveBeenCalledWith({ path: "src/example.ts", line: 2, side: "RIGHT" });
  });
});

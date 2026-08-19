import { parsePatchFiles } from "@pierre/diffs";
import { z } from "zod";

export const severities = ["security", "bug", "warning", "suggestion", "nit"] as const;
export const reviewEvents = ["COMMENT", "APPROVE", "REQUEST_CHANGES"] as const;
const reviewerExplanationSchema = z.string().trim().min(1).max(65_535).refine(
  hasWhatAndWhySections,
  { message: "Reviewer explanations must use localized What: ... Why: ... sections." },
);

const languageSchema = z.string().trim().min(1).max(80).refine(
  (value) => !/[\r\n]/.test(value),
  { message: "Language names must fit on one line." },
);

const defaultLanguages = { comments: "English", reviewerNotes: "English" } as const;

export const reviewCommentSchema = z.object({
  id: z.string().trim().min(1).max(80),
  type: z.enum(["line", "general"]),
  severity: z.enum(severities),
  body: z.string().trim().min(1).max(65_535),
  reviewerExplanation: reviewerExplanationSchema,
  included: z.boolean().optional(),
  rejected: z.boolean().optional(),
  path: z.string().trim().min(1).optional(),
  line: z.int().positive().optional(),
  side: z.literal("RIGHT").optional(),
  discussion: z.array(z.object({
    id: z.string().trim().min(1).max(80),
    author: z.enum(["user", "agent"]),
    body: z.string().trim().min(1).max(4_000),
  })).max(100).optional(),
}).superRefine((comment, context) => {
  if (comment.type === "line" && (!comment.path || !comment.line || comment.side !== "RIGHT")) {
    context.addIssue({
      code: "custom",
      message: "Line comments require path, line, and side=RIGHT.",
    });
  }
  if (comment.type === "general" && (comment.path || comment.line || comment.side)) {
    context.addIssue({
      code: "custom",
      message: "General comments cannot include a file location.",
    });
  }
  if (comment.included && comment.rejected) {
    context.addIssue({
      code: "custom",
      message: "A review comment cannot be both included and rejected.",
    });
  }
  const messageIds = new Set<string>();
  for (const [index, message] of (comment.discussion ?? []).entries()) {
    if (messageIds.has(message.id)) {
      context.addIssue({ code: "custom", message: `Duplicate finding discussion message id: ${message.id}` });
    }
    messageIds.add(message.id);
    if (index === 0 && message.author !== "user") {
      context.addIssue({ code: "custom", message: "A finding discussion must start with a user message." });
    }
    if (index > 0 && message.author === comment.discussion?.[index - 1]?.author) {
      context.addIssue({ code: "custom", message: "User and agent messages must alternate in a finding discussion." });
    }
  }
});

export const userThreadMessageSchema = z.object({
  id: z.string().trim().min(1).max(80),
  author: z.enum(["user", "agent"]),
  body: z.string().trim().min(1).max(4_000),
});

export const userCommentThreadSchema = z.object({
  id: z.string().trim().min(1).max(80),
  path: z.string().trim().min(1),
  line: z.int().positive(),
  side: z.enum(["LEFT", "RIGHT"]),
  dismissed: z.boolean().optional(),
  dismissalReason: z.string().trim().min(1).max(4_000).optional(),
  findingId: z.string().trim().min(1).max(80).optional(),
  messages: z.array(userThreadMessageSchema).min(1).max(100),
}).superRefine((thread, context) => {
  if (thread.messages[0]?.author !== "user") {
    context.addIssue({ code: "custom", message: "A user comment thread must start with a user message." });
  }
  const messageIds = new Set<string>();
  for (const [index, message] of thread.messages.entries()) {
    if (messageIds.has(message.id)) {
      context.addIssue({ code: "custom", message: `Duplicate thread message id: ${message.id}` });
    }
    messageIds.add(message.id);
    if (index > 0 && message.author === thread.messages[index - 1]?.author) {
      context.addIssue({ code: "custom", message: "User and agent messages must alternate in a thread." });
    }
  }
  if (thread.findingId && thread.messages.at(-1)?.author !== "agent") {
    context.addIssue({ code: "custom", message: "A thread linked to a finding must end with an agent response." });
  }
  if (Boolean(thread.dismissed) !== Boolean(thread.dismissalReason)) {
    context.addIssue({ code: "custom", message: "A dismissed user comment thread requires its user's reason." });
  }
});

export const reviewDocumentSchema = z.object({
  version: z.literal(2),
  prUrl: z.url().refine((value) => /^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+\/?$/.test(value), {
    message: "Expected a GitHub pull request URL.",
  }),
  languages: z.object({
    comments: languageSchema,
    reviewerNotes: languageSchema,
  }).default(defaultLanguages),
  summary: z.string().trim().max(65_535),
  recommendation: z.enum(reviewEvents),
  comments: z.array(reviewCommentSchema).max(500),
  userThreads: z.array(userCommentThreadSchema).max(500).default([]),
}).superRefine((review, context) => {
  const ids = new Set<string>();
  for (const comment of review.comments) {
    if (ids.has(comment.id)) {
      context.addIssue({ code: "custom", message: `Duplicate comment id: ${comment.id}` });
    }
    ids.add(comment.id);
  }
  const threadIds = new Set<string>();
  for (const thread of review.userThreads) {
    if (threadIds.has(thread.id)) {
      context.addIssue({ code: "custom", message: `Duplicate user thread id: ${thread.id}` });
    }
    threadIds.add(thread.id);
    if (thread.findingId && !ids.has(thread.findingId)) {
      context.addIssue({
        code: "custom",
        message: `User thread ${thread.id} links to an unknown finding: ${thread.findingId}`,
      });
    }
  }
});

export const revisionRequestSchema = z.object({
  selectedCommentIds: z.array(z.string().min(1)).max(500).default([]),
  rejectedCommentIds: z.array(z.string().min(1)).max(500).default([]),
  requests: z.array(z.object({
    commentId: z.string().min(1),
    message: z.string().trim().min(1).max(4_000),
  })).max(500).default([]),
  newThreads: z.array(z.object({
    id: z.string().trim().min(1).max(80),
    path: z.string().trim().min(1),
    line: z.int().positive(),
    side: z.enum(["LEFT", "RIGHT"]),
    message: z.string().trim().min(1).max(4_000),
  })).max(500).default([]),
  threadReplies: z.array(z.object({
    threadId: z.string().trim().min(1).max(80),
    message: z.string().trim().min(1).max(4_000),
  })).max(500).default([]),
  dismissedThreads: z.array(z.object({
    threadId: z.string().trim().min(1).max(80),
    reason: z.string().trim().min(1).max(4_000),
  })).max(500).default([]),
}).superRefine((request, context) => {
  if (
    request.requests.length
    + request.newThreads.length
    + request.threadReplies.length
    + request.dismissedThreads.length === 0
  ) {
    context.addIssue({ code: "custom", message: "At least one revision or user comment update is required." });
  }
  const selectedIds = new Set(request.selectedCommentIds);
  const conflictingIds = [...new Set(request.rejectedCommentIds.filter((id) => selectedIds.has(id)))];
  if (conflictingIds.length > 0) {
    context.addIssue({
      code: "custom",
      message: `Comments cannot be both selected and rejected: ${conflictingIds.join(", ")}`,
    });
  }
  const newThreadIds = request.newThreads.map(({ id }) => id);
  if (new Set(newThreadIds).size !== newThreadIds.length) {
    context.addIssue({ code: "custom", message: "New user comment thread ids must be unique." });
  }
  const replyIds = request.threadReplies.map(({ threadId }) => threadId);
  if (new Set(replyIds).size !== replyIds.length) {
    context.addIssue({ code: "custom", message: "A user comment thread can have only one reply per round." });
  }
  const dismissedIds = request.dismissedThreads.map(({ threadId }) => threadId);
  if (new Set(dismissedIds).size !== dismissedIds.length) {
    context.addIssue({ code: "custom", message: "A user comment thread can be dismissed only once per round." });
  }
  const repliedIds = new Set(replyIds);
  const conflictingThreadIds = [...new Set(
    dismissedIds.filter((id) => repliedIds.has(id)),
  )];
  if (conflictingThreadIds.length > 0) {
    context.addIssue({
      code: "custom",
      message: `User comment threads cannot be replied to and dismissed together: ${conflictingThreadIds.join(", ")}`,
    });
  }
});

export const publishRequestSchema = z.object({
  confirmed: z.literal(true),
  event: z.enum(reviewEvents),
  body: z.string().trim().max(65_535),
  selectedCommentIds: z.array(z.string().min(1)).max(500),
});

export type ReviewComment = z.infer<typeof reviewCommentSchema>;
export type UserThreadMessage = z.infer<typeof userThreadMessageSchema>;
export type UserCommentThread = z.infer<typeof userCommentThreadSchema>;
export type ReviewDocument = z.infer<typeof reviewDocumentSchema>;
export type RevisionRequest = z.infer<typeof revisionRequestSchema>;
export type PublishRequest = z.infer<typeof publishRequestSchema>;
export type ReviewEvent = (typeof reviewEvents)[number];

function hasWhatAndWhySections(value: string): boolean {
  const localizedHeading = /(?:^|\s)[\p{L}\p{M}][\p{L}\p{M}\s'’-]{0,38}[:：]\s+\S/gu;
  return [...value.matchAll(localizedHeading)].length >= 2;
}

export function validateReviewLocations(review: ReviewDocument, patch: string): void {
  const changedLines = new Map<string, Set<number>>();

  for (const parsedPatch of parsePatchFiles(patch, "reviewonator", true)) {
    for (const file of parsedPatch.files) {
      const lines = new Set<number>();
      for (const hunk of file.hunks) {
        let additionLine = hunk.additionStart;
        for (const content of hunk.hunkContent) {
          if (content.type === "context") {
            additionLine += content.lines;
            continue;
          }
          for (let index = 0; index < content.additions; index += 1) {
            lines.add(additionLine + index);
          }
          additionLine += content.additions;
        }
      }
      changedLines.set(file.name, lines);
    }
  }

  const invalid = review.comments.filter((comment) => (
    comment.type === "line"
    && (!comment.path || !comment.line || !changedLines.get(comment.path)?.has(comment.line))
  ));

  if (invalid.length > 0) {
    const locations = invalid.map((comment) => `${comment.id} (${comment.path ?? "?"}:${comment.line ?? "?"})`);
    throw new Error(`Review comments must target added lines in the pull request diff: ${locations.join(", ")}`);
  }

  const invalidThreads = review.userThreads.filter((thread) => !changedLines.has(thread.path));
  if (invalidThreads.length > 0) {
    const locations = invalidThreads.map((thread) => `${thread.id} (${thread.path}:${thread.line})`);
    throw new Error(`User comment threads must target files in the pull request diff: ${locations.join(", ")}`);
  }
}

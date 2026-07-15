import { parsePatchFiles } from "@pierre/diffs";
import { z } from "zod";

export const severities = ["security", "bug", "warning", "suggestion", "nit"] as const;
export const reviewEvents = ["COMMENT", "APPROVE", "REQUEST_CHANGES"] as const;
const reviewerExplanationSchema = z.string().trim().min(1).max(65_535).refine(
  (value) => /^Co:\s+.+\s+Dlaczego:\s+.+$/s.test(value),
  { message: "Reviewer explanations must use: Co: ... Dlaczego: ..." },
);

export const reviewCommentSchema = z.object({
  id: z.string().trim().min(1).max(80),
  type: z.enum(["line", "general"]),
  severity: z.enum(severities),
  body: z.string().trim().min(1).max(65_535),
  reviewerExplanation: reviewerExplanationSchema,
  path: z.string().trim().min(1).optional(),
  line: z.int().positive().optional(),
  side: z.literal("RIGHT").optional(),
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
});

export const reviewDocumentSchema = z.object({
  version: z.literal(2),
  prUrl: z.url().refine((value) => /^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+\/?$/.test(value), {
    message: "Expected a GitHub pull request URL.",
  }),
  summary: z.string().trim().max(65_535),
  recommendation: z.enum(reviewEvents),
  comments: z.array(reviewCommentSchema).max(500),
}).superRefine((review, context) => {
  if (review.recommendation !== "APPROVE" && !review.summary) {
    context.addIssue({ code: "custom", path: ["summary"], message: "A summary is required unless approving." });
  }
  const ids = new Set<string>();
  for (const comment of review.comments) {
    if (ids.has(comment.id)) {
      context.addIssue({ code: "custom", message: `Duplicate comment id: ${comment.id}` });
    }
    ids.add(comment.id);
  }
});

export const revisionRequestSchema = z.object({
  requests: z.array(z.object({
    commentId: z.string().min(1),
    message: z.string().trim().min(1).max(4_000),
  })).min(1).max(500),
});

export const publishRequestSchema = z.object({
  confirmed: z.literal(true),
  event: z.enum(reviewEvents),
  body: z.string().trim().max(65_535),
  selectedCommentIds: z.array(z.string().min(1)).max(500),
}).superRefine((request, context) => {
  if (request.event !== "APPROVE" && !request.body) {
    context.addIssue({ code: "custom", path: ["body"], message: "A review body is required unless approving." });
  }
});

export type ReviewComment = z.infer<typeof reviewCommentSchema>;
export type ReviewDocument = z.infer<typeof reviewDocumentSchema>;
export type RevisionRequest = z.infer<typeof revisionRequestSchema>;
export type PublishRequest = z.infer<typeof publishRequestSchema>;
export type ReviewEvent = (typeof reviewEvents)[number];

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
}

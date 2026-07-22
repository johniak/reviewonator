import { describe, expect, it } from "vitest";
import {
  revisionRequestSchema,
  reviewDocumentSchema,
  validateReviewLocations,
} from "../../src/domain/review";
import { patch, review } from "../fixtures";

describe("review document", () => {
  it("accepts a valid structured review", () => {
    expect(reviewDocumentSchema.parse(review)).toEqual(review);
  });

  it("accepts a carried inclusion decision without changing older comments", () => {
    const parsed = reviewDocumentSchema.parse({
      ...review,
      comments: [{ ...review.comments[0], included: true }, review.comments[1]],
    });

    expect(parsed.comments[0].included).toBe(true);
    expect(parsed.comments[1].included).toBeUndefined();
  });

  it("rejects contradictory carried decisions", () => {
    expect(() => reviewDocumentSchema.parse({
      ...review,
      comments: [{ ...review.comments[0], included: true, rejected: true }],
    })).toThrow(/both included and rejected/);
  });

  it("defaults both review languages to English for older documents", () => {
    const { languages: _, ...withoutLanguages } = review;
    expect(reviewDocumentSchema.parse(withoutLanguages).languages).toEqual({
      comments: "English",
      reviewerNotes: "English",
    });
  });

  it("rejects duplicate comment ids", () => {
    expect(() => reviewDocumentSchema.parse({
      ...review,
      comments: [review.comments[0], { ...review.comments[1], id: "S1" }],
    })).toThrow(/Duplicate comment id/);
  });

  it("requires a private reviewer explanation for every comment", () => {
    const { reviewerExplanation: _, ...commentWithoutExplanation } = review.comments[0];
    expect(() => reviewDocumentSchema.parse({
      ...review,
      comments: [commentWithoutExplanation],
    })).toThrow();
  });

  it("requires the reviewer explanation to describe what and why in its configured language", () => {
    expect(() => reviewDocumentSchema.parse({
      ...review,
      comments: [{ ...review.comments[0], reviewerExplanation: "Tylko tłumaczenie komentarza." }],
    })).toThrow(/localized What:/);

    expect(() => reviewDocumentSchema.parse({
      ...review,
      languages: { comments: "German", reviewerNotes: "English" },
      comments: [{ ...review.comments[0], reviewerExplanation: "What: Pass the value from the caller. Why: A constant result ignores the input." }],
    })).not.toThrow();
  });

  it("rejects file locations on general comments", () => {
    expect(() => reviewDocumentSchema.parse({
      ...review,
      comments: [{ ...review.comments[1], path: "src/example.ts", line: 2, side: "RIGHT" }],
    })).toThrow(/General comments cannot include/);
  });

  it.each(["COMMENT", "APPROVE", "REQUEST_CHANGES"] as const)(
    "allows %s without a review summary",
    (recommendation) => {
      expect(reviewDocumentSchema.parse({ ...review, summary: "", recommendation }).summary).toBe("");
    },
  );

});

describe("revision request", () => {
  it("accepts a user-authored comment on either side of a diff line", () => {
    expect(revisionRequestSchema.parse({
      newComments: [{
        path: "src/example.ts",
        line: 2,
        side: "RIGHT",
        message: "This looks like it ignores the input. Check it and write a clear comment.",
      }],
    })).toEqual({
      selectedCommentIds: [],
      rejectedCommentIds: [],
      requests: [],
      newComments: [{
        path: "src/example.ts",
        line: 2,
        side: "RIGHT",
        message: "This looks like it ignores the input. Check it and write a clear comment.",
      }],
    });
  });

  it("rejects an empty request", () => {
    expect(() => revisionRequestSchema.parse({})).toThrow(/At least one revision or new comment/);
  });

  it("carries selected comment ids with a revision request", () => {
    expect(revisionRequestSchema.parse({
      selectedCommentIds: ["S1"],
      requests: [{ commentId: "G1", message: "Rewrite this comment." }],
    }).selectedCommentIds).toEqual(["S1"]);
  });

  it("carries rejected comment ids and rejects conflicting decisions", () => {
    expect(revisionRequestSchema.parse({
      rejectedCommentIds: ["G1"],
      requests: [{ commentId: "S1", message: "Rewrite this comment." }],
    }).rejectedCommentIds).toEqual(["G1"]);

    expect(() => revisionRequestSchema.parse({
      selectedCommentIds: ["S1"],
      rejectedCommentIds: ["S1"],
      requests: [{ commentId: "G1", message: "Rewrite this comment." }],
    })).toThrow(/both selected and rejected/);
  });
});

describe("review location validation", () => {
  it("accepts comments on added lines", () => {
    expect(() => validateReviewLocations(review, patch)).not.toThrow();
  });

  it("rejects comments on unchanged context lines", () => {
    const invalid = {
      ...review,
      comments: [{ ...review.comments[0], line: 1 }],
    };
    expect(() => validateReviewLocations(invalid, patch)).toThrow(/S1 \(src\/example.ts:1\)/);
  });

  it("rejects comments for files outside the patch", () => {
    const invalid = {
      ...review,
      comments: [{ ...review.comments[0], path: "src/missing.ts" }],
    };
    expect(() => validateReviewLocations(invalid, patch)).toThrow(/src\/missing.ts/);
  });
});

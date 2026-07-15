import { describe, expect, it } from "vitest";
import { reviewDocumentSchema, validateReviewLocations } from "../../src/domain/review";
import { patch, review } from "../fixtures";

describe("review document", () => {
  it("accepts a valid structured review", () => {
    expect(reviewDocumentSchema.parse(review)).toEqual(review);
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

  it("requires the Polish explanation to describe what and why", () => {
    expect(() => reviewDocumentSchema.parse({
      ...review,
      comments: [{ ...review.comments[0], reviewerExplanation: "Tylko tłumaczenie komentarza." }],
    })).toThrow(/Co: \.\.\. Dlaczego:/);
  });

  it("rejects file locations on general comments", () => {
    expect(() => reviewDocumentSchema.parse({
      ...review,
      comments: [{ ...review.comments[1], path: "src/example.ts", line: 2, side: "RIGHT" }],
    })).toThrow(/General comments cannot include/);
  });

  it("allows an approval without a summary", () => {
    expect(reviewDocumentSchema.parse({
      ...review,
      summary: "",
      recommendation: "APPROVE",
      comments: [],
    }).summary).toBe("");
  });

  it("requires a summary for non-approval recommendations", () => {
    expect(() => reviewDocumentSchema.parse({ ...review, summary: "", recommendation: "COMMENT" }))
      .toThrow(/summary is required unless approving/i);
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

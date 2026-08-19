import { describe, expect, it } from "vitest";
import {
  revisionRequestSchema,
  reviewDocumentSchema,
  validateReviewLocations,
} from "../../src/domain/review";
import { patch, review, userThread } from "../fixtures";

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

  it("preserves valid private discussions on agent findings", () => {
    const discussion = [
      { id: "S1-D1", author: "user" as const, body: "Did you check the closure caller?" },
      { id: "S1-D2", author: "agent" as const, body: "Yes. The closure still supplies a fixed value." },
    ];

    expect(reviewDocumentSchema.parse({
      ...review,
      comments: [{ ...review.comments[0], discussion }, review.comments[1]],
    }).comments[0]?.discussion).toEqual(discussion);
  });

  it("rejects edited or malformed finding discussion history", () => {
    expect(() => reviewDocumentSchema.parse({
      ...review,
      comments: [{
        ...review.comments[0],
        discussion: [{ id: "S1-D1", author: "agent", body: "I started this discussion." }],
      }],
    })).toThrow(/must start with a user message/);

    expect(() => reviewDocumentSchema.parse({
      ...review,
      comments: [{
        ...review.comments[0],
        discussion: [
          { id: "S1-D1", author: "user", body: "First" },
          { id: "S1-D2", author: "user", body: "Second" },
        ],
      }],
    })).toThrow(/must alternate/);
  });

  it("preserves a private user-agent discussion and links an accepted concern to a finding", () => {
    const linkedThread = {
      ...userThread,
      findingId: "S1",
      messages: [
        userThread.messages[0],
        { id: "U1-M2", author: "agent" as const, body: "You are right. I added finding S1." },
      ],
    };
    expect(reviewDocumentSchema.parse({ ...review, userThreads: [linkedThread] }).userThreads)
      .toEqual([linkedThread]);
  });

  it("rejects invalid user-agent thread history and unknown linked findings", () => {
    expect(() => reviewDocumentSchema.parse({
      ...review,
      userThreads: [{ ...userThread, messages: [{ id: "M1", author: "agent", body: "I started this." }] }],
    })).toThrow(/must start with a user message/);

    expect(() => reviewDocumentSchema.parse({
      ...review,
      userThreads: [{ ...userThread, findingId: "missing" }],
    })).toThrow(/unknown finding/);

    expect(() => reviewDocumentSchema.parse({
      ...review,
      userThreads: [{ ...userThread, dismissed: true }],
    })).toThrow(/requires its user's reason/i);

    expect(reviewDocumentSchema.parse({
      ...review,
      userThreads: [{
        ...userThread,
        dismissed: true,
        dismissalReason: "I checked the caller and this behavior is intentional.",
      }],
    }).userThreads[0]?.dismissed).toBe(true);
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
      newThreads: [{
        id: "U2",
        path: "src/example.ts",
        line: 2,
        side: "RIGHT",
        message: "This looks like it ignores the input. Check it and write a clear comment.",
      }],
    })).toEqual({
      selectedCommentIds: [],
      rejectedCommentIds: [],
      requests: [],
      newThreads: [{
        id: "U2",
        path: "src/example.ts",
        line: 2,
        side: "RIGHT",
        message: "This looks like it ignores the input. Check it and write a clear comment.",
      }],
      threadReplies: [],
      dismissedThreads: [],
    });
  });

  it("accepts a reply or a user-controlled dismissal, but not both for the same thread", () => {
    expect(revisionRequestSchema.parse({
      threadReplies: [{ threadId: "U1", message: "The caller contract still matters here." }],
    }).threadReplies).toHaveLength(1);
    expect(revisionRequestSchema.parse({
      dismissedThreads: [{ threadId: "U1", reason: "I checked the caller and this is intentional." }],
    }).dismissedThreads).toHaveLength(1);
    expect(() => revisionRequestSchema.parse({
      threadReplies: [{ threadId: "U1", message: "Keep discussing this." }],
      dismissedThreads: [{ threadId: "U1", reason: "Close it." }],
    })).toThrow(/cannot be replied to and dismissed together/);
  });

  it("rejects an empty request", () => {
    expect(() => revisionRequestSchema.parse({})).toThrow(/At least one revision or user comment update/);
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

  it("allows user threads on unchanged lines but rejects files outside the patch", () => {
    expect(() => validateReviewLocations({ ...review, userThreads: [{ ...userThread, line: 1 }] }, patch))
      .not.toThrow();
    expect(() => validateReviewLocations({
      ...review,
      userThreads: [{ ...userThread, path: "src/missing.ts" }],
    }, patch)).toThrow(/User comment threads must target files/);
  });
});

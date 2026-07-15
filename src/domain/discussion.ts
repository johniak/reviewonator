import { z } from "zod";

const actorSchema = z.object({
  login: z.string(),
  avatar_url: z.string().nullable().optional(),
}).nullable();

const conversationCommentSchema = z.object({
  id: z.number(),
  user: actorSchema,
  body: z.string(),
  created_at: z.string(),
  html_url: z.string(),
});

const reviewSchema = z.object({
  id: z.number(),
  user: actorSchema,
  body: z.string().nullable(),
  state: z.string(),
  submitted_at: z.string().nullable(),
  html_url: z.string(),
});

const inlineCommentSchema = z.object({
  id: z.number(),
  user: actorSchema,
  body: z.string(),
  created_at: z.string(),
  html_url: z.string(),
  path: z.string(),
  line: z.number().nullable(),
  original_line: z.number().nullable(),
  side: z.string().nullable(),
  original_side: z.string().nullable(),
  position: z.number().nullable().optional(),
  in_reply_to_id: z.number().optional(),
});

export type PullRequestDiscussionItem = {
  id: string;
  kind: "conversation" | "review" | "inline";
  author: {
    login: string;
    avatarUrl?: string;
  };
  body: string;
  createdAt: string;
  url: string;
  state?: string;
  path?: string;
  line?: number;
  side?: string;
  outdated?: boolean;
  replyToId?: number;
};

export function parsePullRequestDiscussion(
  conversationOutput: string,
  reviewsOutput: string,
  inlineOutput: string,
): PullRequestDiscussionItem[] {
  const conversation = parsePages(conversationOutput, conversationCommentSchema).map((comment) => ({
    id: `conversation-${comment.id}`,
    kind: "conversation" as const,
    author: normalizeActor(comment.user),
    body: comment.body,
    createdAt: comment.created_at,
    url: comment.html_url,
  }));
  const reviews = parsePages(reviewsOutput, reviewSchema).map((review) => ({
    id: `review-${review.id}`,
    kind: "review" as const,
    author: normalizeActor(review.user),
    body: review.body ?? "",
    createdAt: review.submitted_at ?? "",
    url: review.html_url,
    state: review.state,
  }));
  const inline = parsePages(inlineOutput, inlineCommentSchema).map((comment) => ({
    id: `inline-${comment.id}`,
    kind: "inline" as const,
    author: normalizeActor(comment.user),
    body: comment.body,
    createdAt: comment.created_at,
    url: comment.html_url,
    path: comment.path,
    line: comment.line ?? comment.original_line ?? undefined,
    side: comment.side ?? comment.original_side ?? undefined,
    ...(comment.position === null ? { outdated: true } : {}),
    ...(comment.in_reply_to_id !== undefined ? { replyToId: comment.in_reply_to_id } : {}),
  }));

  return [...conversation, ...reviews, ...inline]
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

function parsePages<T>(output: string, itemSchema: z.ZodType<T>): T[] {
  return z.array(z.array(itemSchema)).parse(JSON.parse(output)).flat();
}

function normalizeActor(actor: z.infer<typeof actorSchema>): PullRequestDiscussionItem["author"] {
  return {
    login: actor?.login ?? "ghost",
    ...(actor?.avatar_url ? { avatarUrl: actor.avatar_url } : {}),
  };
}

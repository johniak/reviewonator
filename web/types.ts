import type { PullRequest } from "../src/domain/pull-request";
import type { PullRequestDiscussionItem } from "../src/domain/discussion";
import type { ReviewComment, ReviewDocument, ReviewEvent } from "../src/domain/review";

export type SessionSnapshot = {
  pullRequest: PullRequest;
  patch: string;
  review: ReviewDocument;
  discussion: PullRequestDiscussionItem[];
  fileUrls: Record<string, string>;
};

export type CommentActions = {
  selectedIds: Set<string>;
  revisionMessages: Record<string, string>;
  onToggleSelected: (id: string) => void;
  onRevisionChange: (id: string, message: string) => void;
};

export type PublishDraft = {
  event: ReviewEvent;
  body: string;
};

export type { ReviewComment };

import type { PullRequest } from "../src/domain/pull-request";
import type { PullRequestDiscussionItem } from "../src/domain/discussion";
import type {
  CommentEdit,
  ReviewComment,
  ReviewDocument,
  ReviewEvent,
  UserCommentThread,
} from "../src/domain/review";

export type SessionSnapshot = {
  pullRequest: PullRequest;
  patch: string;
  review: ReviewDocument;
  discussion: PullRequestDiscussionItem[];
  viewedFiles: string[];
  fileUrls: Record<string, string>;
  live: boolean;
  version: number;
  agentPending: boolean;
  /** Set while an early review waits for the agent's final delivery. */
  reviewing: { startedAt: string } | null;
};

export type CommentActions = {
  agentPending: boolean;
  selectedIds: Set<string>;
  rejectedIds: Set<string>;
  revisionMessages: Record<string, string>;
  onToggleSelected: (id: string) => void;
  onToggleRejected: (id: string) => void;
  onRevisionChange: (id: string, message: string) => void;
  onSendRevision: (id: string) => Promise<void>;
  onEditComment: (id: string, edit: CommentEdit) => Promise<boolean>;
  onDeleteComment: (id: string) => Promise<void>;
};

export type LineCommentDraft = {
  id: string;
  path: string;
  line: number;
  side: "LEFT" | "RIGHT";
  message: string;
};

export type LineCommentLocation = Pick<LineCommentDraft, "path" | "line" | "side">;

export type LineCommentDraftActions = {
  drafts: LineCommentDraft[];
  onCreateDraft: (location: LineCommentLocation) => void;
  onChangeDraft: (location: LineCommentLocation, message: string) => void;
  onRemoveDraft: (location: LineCommentLocation) => void;
  onSendDraft: (location: LineCommentLocation) => void;
  onAddComment: (location: LineCommentLocation) => void;
};

export type UserThreadActions = {
  replyMessages: Record<string, string>;
  dismissalReasons: Record<string, string>;
  onReplyChange: (id: string, message: string) => void;
  onDismissalChange: (id: string, reason: string) => void;
  onSendReply: (id: string) => void;
  onSelectFinding: (id: string) => void;
};

export type PublishDraft = {
  event: ReviewEvent;
  body: string;
};

export type { ReviewComment, UserCommentThread };

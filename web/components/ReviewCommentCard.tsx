import { Check, EyeOff, RotateCcw, X } from "lucide-react";
import { useState } from "react";
import type { CommentActions, ReviewComment } from "../types";
import { SeverityBadge } from "./SeverityBadge";

type Props = CommentActions & {
  comment: ReviewComment;
  reviewerLanguage?: string;
  compact?: boolean;
  focused?: boolean;
};

export function ReviewCommentCard({
  comment,
  reviewerLanguage = "English",
  compact = false,
  focused = false,
  selectedIds,
  rejectedIds,
  revisionMessages,
  onToggleSelected,
  onToggleRejected,
  onRevisionChange,
}: Props) {
  const [showRevision, setShowRevision] = useState(Boolean(revisionMessages[comment.id]));
  const selected = selectedIds.has(comment.id);
  const rejected = rejectedIds.has(comment.id);
  const revision = revisionMessages[comment.id] ?? "";

  return (
    <article
      id={commentCardId(comment.id)}
      className={`comment-card comment-severity-${comment.severity} ${selected ? "comment-selected" : ""} ${rejected ? "comment-rejected" : ""} ${focused ? "comment-focused" : ""} ${compact ? "compact" : ""}`}
      tabIndex={focused ? -1 : undefined}
    >
      <div className="comment-heading">
        <SeverityBadge severity={comment.severity} />
        <span className="comment-id">{comment.id}</span>
      </div>
      <p className="comment-body">{comment.body}</p>
      <div className="reviewer-explanation">
        <div className="reviewer-explanation-heading">
          <span><EyeOff aria-hidden="true" size={13} /> For reviewer only</span>
          <small>Private · {reviewerLanguage}</small>
        </div>
        <p>{comment.reviewerExplanation}</p>
      </div>
      <div className="comment-actions">
        <button
          className={`selection-button ${selected ? "active" : ""}`}
          type="button"
          onClick={() => onToggleSelected(comment.id)}
          aria-pressed={selected}
        >
          <Check aria-hidden="true" size={14} />
          {selected ? "Included" : "Include"}
        </button>
        <button
          className={`rejection-button ${rejected ? "active" : ""}`}
          type="button"
          onClick={() => onToggleRejected(comment.id)}
          aria-pressed={rejected}
        >
          <X aria-hidden="true" size={14} />
          {rejected ? "Rejected" : "Reject"}
        </button>
        <button
          className={`revision-button ${showRevision ? "active" : ""}`}
          type="button"
          onClick={() => setShowRevision((value) => !value)}
          aria-expanded={showRevision}
        >
          <RotateCcw aria-hidden="true" size={14} />
          Request revision
        </button>
      </div>
      {showRevision && (
        <label className="revision-field">
          <span>What should the AI agent change?</span>
          <textarea
            value={revision}
            onChange={(event) => onRevisionChange(comment.id, event.target.value)}
            placeholder="Explain what is inaccurate, unclear, or missing…"
            rows={3}
            autoFocus
          />
        </label>
      )}
    </article>
  );
}

export function commentCardId(id: string): string {
  return `review-comment-${id.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

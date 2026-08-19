import { Bot, Check, EyeOff, MessageSquareReply, RotateCcw, Send, UserRound, X } from "lucide-react";
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
  agentPending,
  selectedIds,
  rejectedIds,
  revisionMessages,
  onToggleSelected,
  onToggleRejected,
  onRevisionChange,
  onSendRevision,
}: Props) {
  const [showRevision, setShowRevision] = useState(Boolean(revisionMessages[comment.id]));
  const selected = selectedIds.has(comment.id);
  const rejected = rejectedIds.has(comment.id);
  const revision = revisionMessages[comment.id] ?? "";
  const discussion = comment.discussion ?? [];
  const waitingForAgent = discussion.at(-1)?.author === "user";
  const fieldLabel = discussion.length > 0 ? "Reply to the AI agent" : "What do you want to discuss with the AI agent?";

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
      {discussion.length > 0 && (
        <div className="finding-discussion" aria-label={`Discussion about finding ${comment.id}`}>
          <div className="finding-discussion-heading">
            <MessageSquareReply aria-hidden="true" size={13} /> Private discussion
          </div>
          {discussion.map((message) => (
            <div key={message.id} className={`finding-discussion-message finding-discussion-${message.author}`}>
              <span>{message.author === "user"
                ? <UserRound aria-hidden="true" size={12} />
                : <Bot aria-hidden="true" size={12} />}</span>
              <div>
                <strong>{message.author === "user" ? "You" : "AI agent"}</strong>
                <p>{message.body}</p>
              </div>
            </div>
          ))}
        </div>
      )}
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
          onClick={() => { if (!waitingForAgent) setShowRevision((value) => !value); }}
          aria-expanded={showRevision && !waitingForAgent}
          disabled={waitingForAgent}
        >
          <RotateCcw aria-hidden="true" size={14} />
          {waitingForAgent ? "Waiting for AI" : discussion.length > 0 ? "Continue discussion" : "Discuss with AI"}
        </button>
      </div>
      {showRevision && !waitingForAgent && (
        <div className="revision-composer">
          <label className="revision-field" htmlFor={`finding-discussion-${comment.id}`}>
            <span>{fieldLabel}</span>
            <textarea
              id={`finding-discussion-${comment.id}`}
              aria-label={fieldLabel}
              value={revision}
              onChange={(event) => onRevisionChange(comment.id, event.target.value)}
              placeholder="Explain what seems wrong, unclear, or worth checking…"
              rows={3}
              autoFocus
            />
          </label>
          <button
            className="finding-discussion-send"
            type="button"
            disabled={!revision.trim() || agentPending}
            onClick={() => void onSendRevision(comment.id)}
          >
            {agentPending ? <RotateCcw aria-hidden="true" size={13} /> : <Send aria-hidden="true" size={13} />}
            {agentPending ? "AI agent is responding" : "Send to AI"}
          </button>
        </div>
      )}
      {waitingForAgent && (
        <p className="finding-discussion-waiting"><RotateCcw aria-hidden="true" size={12} /> The AI agent is checking this finding.</p>
      )}
    </article>
  );
}

export function commentCardId(id: string): string {
  return `review-comment-${id.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

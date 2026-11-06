import { Bot, Check, Clock, EyeOff, MessageSquareReply, Pencil, RotateCcw, Send, Trash2, UserRound, X } from "lucide-react";
import { useState } from "react";
import type { CommentEdit, Severity } from "../../src/domain/review";
import type { CommentActions, ReviewComment } from "../types";
import { MarkdownText } from "./MarkdownText";
import { SendHint, sendOnEnter } from "./SendOnEnter";
import { AuthorBadge, SeverityBadge, severityLabel, severityOrder } from "./SeverityBadge";

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
  queueing = false,
  selectedIds,
  rejectedIds,
  revisionMessages,
  onToggleSelected,
  onToggleRejected,
  onRevisionChange,
  onSendRevision,
  onEditComment,
  onDeleteComment,
}: Props) {
  const [showRevision, setShowRevision] = useState(Boolean(revisionMessages[comment.id]));
  const [editing, setEditing] = useState(false);
  const byUser = comment.author === "user";
  const selected = selectedIds.has(comment.id);
  const rejected = rejectedIds.has(comment.id);
  const revision = revisionMessages[comment.id] ?? "";
  const discussion = comment.discussion ?? [];
  const waitingForAgent = discussion.at(-1)?.author === "user";
  const queued = waitingForAgent && queueing;
  const fieldLabel = discussion.length > 0 ? "Reply to the AI agent" : "What do you want to discuss with the AI agent?";

  return (
    <article
      id={commentCardId(comment.id)}
      className={`comment-card comment-severity-${comment.severity ?? "none"} ${byUser ? "comment-author-user" : ""} ${selected ? "comment-selected" : ""} ${rejected ? "comment-rejected" : ""} ${focused ? "comment-focused" : ""} ${compact ? "compact" : ""}`}
      tabIndex={focused ? -1 : undefined}
    >
      <div className="comment-heading">
        <span className="comment-labels">
          {byUser && <AuthorBadge />}
          <SeverityBadge severity={comment.severity} />
          {comment.edited && <span className="comment-edited">Edited</span>}
        </span>
        <span className="comment-tools">
          <span className="comment-id">{comment.id}</span>
          <button
            type="button"
            aria-label="Edit comment"
            title={queued
              ? "Your message is queued for the AI agent"
              : waitingForAgent ? "The AI agent is checking this comment" : "Edit comment"}
            disabled={waitingForAgent || editing}
            onClick={() => setEditing(true)}
          >
            <Pencil aria-hidden="true" size={13} />
          </button>
          {byUser && (
            <button
              type="button"
              className="comment-delete"
              aria-label="Delete comment"
              title="Delete comment"
              onClick={() => void onDeleteComment(comment.id)}
            >
              <Trash2 aria-hidden="true" size={13} />
            </button>
          )}
        </span>
      </div>
      {editing ? (
        <CommentEditor
          comment={comment}
          onCancel={() => setEditing(false)}
          onSave={async (edit) => { if (await onEditComment(comment.id, edit)) setEditing(false); }}
        />
      ) : (
        <MarkdownText className="comment-body">{comment.body}</MarkdownText>
      )}
      {comment.reviewerExplanation && (
        <div className="reviewer-explanation">
          <div className="reviewer-explanation-heading">
            <span><EyeOff aria-hidden="true" size={13} /> For reviewer only</span>
            <small>Private · {reviewerLanguage}</small>
          </div>
          <MarkdownText>{comment.reviewerExplanation}</MarkdownText>
        </div>
      )}
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
                <MarkdownText>{message.body}</MarkdownText>
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
          className={`revision-button ${showRevision ? "active" : ""} ${queued ? "queued" : ""}`}
          type="button"
          onClick={() => { if (!waitingForAgent) setShowRevision((value) => !value); }}
          aria-expanded={showRevision && !waitingForAgent}
          disabled={waitingForAgent}
        >
          {queued ? <Clock aria-hidden="true" size={14} /> : <RotateCcw aria-hidden="true" size={14} />}
          {queued ? "Queued for AI" : waitingForAgent ? "Waiting for AI" : discussion.length > 0 ? "Continue discussion" : "Discuss with AI"}
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
              onKeyDown={sendOnEnter(() => {
                if (revision.trim() && !agentPending) void onSendRevision(comment.id);
              })}
              placeholder="Explain what seems wrong, unclear, or worth checking…"
              rows={3}
              autoFocus
            />
          </label>
          <SendHint />
          <button
            className="finding-discussion-send"
            type="button"
            disabled={!revision.trim() || agentPending}
            onClick={() => void onSendRevision(comment.id)}
          >
            {agentPending ? <RotateCcw aria-hidden="true" size={13} /> : <Send aria-hidden="true" size={13} />}
            {sendLabel(agentPending, queueing)}
          </button>
        </div>
      )}
      {waitingForAgent && (queued ? (
        <QueuedNote className="finding-discussion-waiting" />
      ) : (
        <p className="finding-discussion-waiting"><RotateCcw aria-hidden="true" size={12} /> The AI agent is checking this {byUser ? "comment" : "finding"}.</p>
      ))}
    </article>
  );
}

function CommentEditor({
  comment,
  onCancel,
  onSave,
}: {
  comment: ReviewComment;
  onCancel: () => void;
  onSave: (edit: CommentEdit) => Promise<void>;
}) {
  const byUser = comment.author === "user";
  const [body, setBody] = useState(comment.body);
  const [severity, setSeverity] = useState<Severity | "">(comment.severity ?? "");
  const changed = body.trim() !== comment.body || (byUser && severity !== (comment.severity ?? ""));
  const fieldId = `${commentCardId(comment.id)}-edit`;

  return (
    <form
      className="comment-editor"
      onSubmit={(event) => {
        event.preventDefault();
        void onSave(byUser ? { body: body.trim(), severity: severity || null } : { body: body.trim() });
      }}
    >
      <label className="revision-field" htmlFor={fieldId}>
        <span>Public comment</span>
        <textarea id={fieldId} rows={4} value={body} autoFocus onChange={(event) => setBody(event.target.value)} />
      </label>
      <div className="comment-editor-actions">
        {byUser && (
          <label className="comment-severity-field">
            <span>Severity</span>
            <select value={severity} onChange={(event) => setSeverity(event.target.value as Severity | "")}>
              <option value="">None</option>
              {severityOrder.map((value) => <option key={value} value={value}>{severityLabel(value)}</option>)}
            </select>
          </label>
        )}
        <button className="secondary-button" type="button" onClick={onCancel}>Cancel</button>
        <button className="finding-discussion-send" type="submit" disabled={!body.trim() || !changed}>Save</button>
      </div>
    </form>
  );
}

/** The label of a button that sends one message to the AI agent. */
export function sendLabel(agentPending: boolean, queueing: boolean): string {
  if (queueing) return "Queue for AI";
  return agentPending ? "AI agent is responding" : "Send to AI";
}

/** Marks a message that waits until the AI agent finishes its early review. */
export function QueuedNote({ className }: { className: string }) {
  return (
    <p className={`${className} discussion-queued`}>
      <Clock aria-hidden="true" size={12} /> Queued, sent when the AI finishes its review
    </p>
  );
}

export function commentCardId(id: string): string {
  return `review-comment-${id.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

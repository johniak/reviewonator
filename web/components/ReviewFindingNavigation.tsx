import { Check, Circle, MessageSquareReply, MessagesSquare, RotateCcw, X } from "lucide-react";
import type { ReviewComment } from "../types";
import { SeverityBadge } from "./SeverityBadge";

type Props = {
  comments: ReviewComment[];
  activeCommentId: string | null;
  selectedIds: Set<string>;
  rejectedIds: Set<string>;
  revisionMessages: Record<string, string>;
  onSelect: (comment: ReviewComment) => void;
};

export function ReviewFindingNavigation({
  comments,
  activeCommentId,
  selectedIds,
  rejectedIds,
  revisionMessages,
  onSelect,
}: Props) {
  return (
    <>
      <div className="panel-section-heading findings-heading">
        <span><MessagesSquare size={15} /> Review findings</span>
        <strong>{comments.length}</strong>
      </div>
      <nav className="finding-list" aria-label="Review findings">
        {comments.length === 0 ? (
          <p>No actionable findings.</p>
        ) : comments.map((comment) => {
          const status = findingStatus(
            selectedIds.has(comment.id),
            rejectedIds.has(comment.id),
            Boolean(revisionMessages[comment.id]?.trim()),
            comment.discussion ?? [],
          );
          return (
            <button
              key={comment.id}
              type="button"
              className={`finding-severity-${comment.severity} finding-${status.kind} ${activeCommentId === comment.id ? "active" : ""}`}
              aria-current={activeCommentId === comment.id ? "true" : undefined}
              onClick={() => onSelect(comment)}
            >
              <span className="finding-heading">
                <SeverityBadge severity={comment.severity} />
                <span className={`finding-status finding-status-${status.kind}`}>
                  {status.icon}
                  {status.label}
                </span>
                {(comment.discussion?.length ?? 0) > 0 && (
                  <span
                    className="finding-discussion-count"
                    aria-label={`${comment.discussion!.length} discussion messages`}
                  >
                    <MessageSquareReply aria-hidden="true" size={10} /> {comment.discussion!.length}
                  </span>
                )}
                <b>{comment.id}</b>
              </span>
              <small>{comment.type === "line" ? `${comment.path}:${comment.line}` : "General comment"}</small>
            </button>
          );
        })}
      </nav>
    </>
  );
}

function findingStatus(
  selected: boolean,
  rejected: boolean,
  revisionRequested: boolean,
  discussion: ReviewComment["discussion"],
) {
  if (revisionRequested) {
    return { kind: "revision", label: "Reply queued", icon: <RotateCcw aria-hidden="true" size={10} /> } as const;
  }
  if (discussion?.at(-1)?.author === "user") {
    return { kind: "revision", label: "AI working", icon: <RotateCcw aria-hidden="true" size={10} /> } as const;
  }
  if (selected) {
    return { kind: "included", label: "Included", icon: <Check aria-hidden="true" size={10} /> } as const;
  }
  if (rejected) {
    return { kind: "rejected", label: "Rejected", icon: <X aria-hidden="true" size={10} /> } as const;
  }
  return { kind: "pending", label: "Pending", icon: <Circle aria-hidden="true" size={9} /> } as const;
}

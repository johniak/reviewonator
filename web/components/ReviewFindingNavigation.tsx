import { MessagesSquare } from "lucide-react";
import type { ReviewComment } from "../types";
import { SeverityBadge } from "./SeverityBadge";

type Props = {
  comments: ReviewComment[];
  activeCommentId: string | null;
  onSelect: (comment: ReviewComment) => void;
};

export function ReviewFindingNavigation({ comments, activeCommentId, onSelect }: Props) {
  return (
    <>
      <div className="panel-section-heading findings-heading">
        <span><MessagesSquare size={15} /> Review findings</span>
        <strong>{comments.length}</strong>
      </div>
      <nav className="finding-list" aria-label="Review findings">
        {comments.length === 0 ? (
          <p>No actionable findings.</p>
        ) : comments.map((comment) => (
          <button
            key={comment.id}
            type="button"
            className={`finding-severity-${comment.severity} ${activeCommentId === comment.id ? "active" : ""}`}
            aria-current={activeCommentId === comment.id ? "true" : undefined}
            onClick={() => onSelect(comment)}
          >
            <span>
              <SeverityBadge severity={comment.severity} />
              <b>{comment.id}</b>
            </span>
            <small>{comment.type === "line" ? `${comment.path}:${comment.line}` : "General comment"}</small>
          </button>
        ))}
      </nav>
    </>
  );
}

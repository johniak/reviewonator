import * as Dialog from "@radix-ui/react-dialog";
import { CheckCircle2, EyeOff, ExternalLink, Send, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { ReviewEvent } from "../../src/domain/review";
import type { ReviewComment } from "../types";
import { SeverityBadge } from "./SeverityBadge";

type Props = {
  open: boolean;
  comments: ReviewComment[];
  reviewerLanguage?: string;
  initialBody: string;
  initialEvent: ReviewEvent;
  publishing: boolean;
  error: string | null;
  onOpenChange: (open: boolean) => void;
  onPublish: (input: { body: string; event: ReviewEvent }) => void;
};

const eventLabels: Record<ReviewEvent, { label: string; description: string }> = {
  COMMENT: { label: "Comment", description: "Submit feedback without a formal decision." },
  APPROVE: { label: "Approve", description: "Approve these pull request changes." },
  REQUEST_CHANGES: { label: "Request changes", description: "Block approval until issues are addressed." },
};

export function PublishDialog({
  open,
  comments,
  reviewerLanguage = "English",
  initialBody,
  initialEvent,
  publishing,
  error,
  onOpenChange,
  onPublish,
}: Props) {
  const [body, setBody] = useState(initialBody);
  const [event, setEvent] = useState(initialEvent);
  const [confirmed, setConfirmed] = useState(false);
  useEffect(() => {
    if (open) {
      setBody(initialBody);
      setEvent(initialEvent);
      setConfirmed(false);
    }
  }, [initialBody, initialEvent, open]);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="publish-dialog" aria-describedby="publish-description">
          <div className="dialog-heading">
            <div>
              <span className="eyebrow">Final confirmation</span>
              <Dialog.Title>Publish this review to GitHub?</Dialog.Title>
              <Dialog.Description id="publish-description">
                Nothing is sent until you confirm the exact review below.
              </Dialog.Description>
            </div>
            <Dialog.Close className="icon-button" aria-label="Close publish dialog">
              <X size={18} />
            </Dialog.Close>
          </div>

          <div className="publish-content">
            <fieldset className="event-options">
              <legend>Review decision</legend>
              {(Object.keys(eventLabels) as ReviewEvent[]).map((value) => (
                <label key={value} className={event === value ? "event-selected" : ""}>
                  <input
                    type="radio"
                    name="review-event"
                    checked={event === value}
                    onChange={() => setEvent(value)}
                  />
                  <span>
                    <strong>{eventLabels[value].label}</strong>
                    <small>{eventLabels[value].description}</small>
                  </span>
                </label>
              ))}
            </fieldset>

            <label className="publish-body-field">
              <span>Review summary posted to GitHub (optional)</span>
              <textarea rows={7} value={body} onChange={(event) => setBody(event.target.value)} />
            </label>

            <section className="publish-comments">
              <div className="section-title-row">
                <h3>Included comments</h3>
                <span>{comments.length}</span>
              </div>
              <p className="private-content-note">
                <EyeOff aria-hidden="true" size={14} />
                Private {reviewerLanguage} explanations are excluded from this GitHub review.
              </p>
              <div className="publish-comment-list" role="region" aria-label="Included comments list" tabIndex={0}>
                {comments.length === 0 ? (
                  <p className="muted-copy">No inline or general comments are selected.</p>
                ) : comments.map((comment) => (
                  <div className="publish-comment" key={comment.id}>
                    <div>
                      <SeverityBadge severity={comment.severity} />
                      <span className="comment-location">
                        {comment.type === "line" ? `${comment.path}:${comment.line}` : "General comment"}
                      </span>
                    </div>
                    <p>{comment.body}</p>
                  </div>
                ))}
              </div>
            </section>
          </div>

          <div className="dialog-footer">
            <label className="publish-confirmation">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(event) => setConfirmed(event.target.checked)}
              />
              <CheckCircle2 aria-hidden="true" size={17} />
              I confirm that Reviewonator may publish this review to GitHub.
            </label>
            {error && <p className="error-message" role="alert">{error}</p>}
            <button
              className="primary-button publish-button"
              type="button"
              disabled={!confirmed || publishing}
              onClick={() => onPublish({ body: body.trim(), event })}
            >
              {publishing ? "Publishing…" : "Publish review"}
              {publishing ? null : <Send aria-hidden="true" size={16} />}
            </button>
            <a href="https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/reviewing-changes-in-pull-requests" target="_blank" rel="noreferrer">
              About GitHub reviews <ExternalLink size={13} />
            </a>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

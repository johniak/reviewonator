import {
  Bot,
  CheckCircle2,
  CircleX,
  MessageSquareReply,
  Send,
  UserRound,
  X,
} from "lucide-react";
import { useState } from "react";
import type { UserCommentThread, UserThreadActions } from "../types";

type Props = UserThreadActions & {
  thread: UserCommentThread;
  focused?: boolean;
};

export function UserCommentThreadCard({
  thread,
  focused = false,
  replyMessages,
  dismissalReasons,
  onReplyChange,
  onDismissalChange,
  onSelectFinding,
}: Props) {
  const reply = replyMessages[thread.id] ?? "";
  const dismissalReason = dismissalReasons[thread.id] ?? "";
  const [showDismissal, setShowDismissal] = useState(Boolean(dismissalReason));
  const status = userThreadStatus(thread, reply, dismissalReason);
  const canReply = !thread.dismissed && !thread.findingId && thread.messages.at(-1)?.author === "agent";
  const replyFieldId = `${userThreadCardId(thread.id)}-reply`;
  const dismissalFieldId = `${userThreadCardId(thread.id)}-dismissal`;

  return (
    <article
      id={userThreadCardId(thread.id)}
      className={`user-thread user-thread-${status.kind} ${focused ? "user-thread-focused" : ""}`}
      tabIndex={focused ? -1 : undefined}
    >
      <div className="user-thread-heading">
        <span><MessageSquareReply aria-hidden="true" size={14} /> Your discussion</span>
        <strong className={`user-thread-status user-thread-status-${status.kind}`}>{status.label}</strong>
      </div>

      <div className="user-thread-timeline">
        {thread.messages.map((message) => (
          <div key={message.id} className={`user-thread-message user-thread-message-${message.author}`}>
            <span className="user-thread-avatar">
              {message.author === "user" ? <UserRound aria-hidden="true" size={13} /> : <Bot aria-hidden="true" size={13} />}
            </span>
            <div>
              <strong>{message.author === "user" ? "You" : "AI agent"}</strong>
              <p>{message.body}</p>
            </div>
          </div>
        ))}
      </div>

      {thread.dismissed && thread.dismissalReason && (
        <div className="thread-dismissed-reason">
          <CircleX aria-hidden="true" size={13} />
          <span><strong>You dismissed this discussion</strong>{thread.dismissalReason}</span>
        </div>
      )}

      {thread.findingId && (
        <button className="thread-finding-link" type="button" onClick={() => onSelectFinding(thread.findingId!)}>
          <CheckCircle2 aria-hidden="true" size={14} />
          Agent created finding {thread.findingId}
        </button>
      )}

      {!thread.dismissed && !thread.findingId && !canReply && (
        <p className="thread-waiting-note"><Send aria-hidden="true" size={12} /> Waiting for the AI agent to respond.</p>
      )}

      {canReply && !showDismissal && (
        <label className="thread-reply-field" htmlFor={replyFieldId}>
          <span>Reply to the AI agent</span>
          <textarea
            id={replyFieldId}
            aria-label="Reply to the AI agent"
            rows={3}
            value={reply}
            placeholder="Explain what the agent missed or add more evidence…"
            onChange={(event) => {
              onDismissalChange(thread.id, "");
              onReplyChange(thread.id, event.target.value);
            }}
          />
          <small>Your reply will return to the agent in the next review round.</small>
        </label>
      )}

      {!thread.dismissed && !thread.findingId && (
        <div className="thread-user-actions">
          {showDismissal ? (
            <div className="thread-dismissal-field">
              <label htmlFor={dismissalFieldId}>
                <span>Why are you dismissing this discussion?</span>
                <textarea
                  id={dismissalFieldId}
                  rows={2}
                  value={dismissalReason}
                  placeholder="Explain why this concern is incorrect or no longer useful…"
                  onChange={(event) => {
                    onReplyChange(thread.id, "");
                    onDismissalChange(thread.id, event.target.value);
                  }}
                  autoFocus
                />
              </label>
              <button
                type="button"
                onClick={() => {
                  onDismissalChange(thread.id, "");
                  setShowDismissal(false);
                }}
              >
                <X aria-hidden="true" size={13} /> Keep discussion
              </button>
            </div>
          ) : (
            <button className="thread-dismiss-button" type="button" onClick={() => setShowDismissal(true)}>
              <CircleX aria-hidden="true" size={13} /> Dismiss discussion
            </button>
          )}
        </div>
      )}
    </article>
  );
}

export function userThreadCardId(id: string): string {
  return `user-thread-${id.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

export function userThreadStatus(
  thread: UserCommentThread,
  reply = "",
  dismissalReason = "",
) {
  if (dismissalReason.trim()) return { kind: "dismissing", label: "Dismiss queued" } as const;
  if (thread.dismissed) return { kind: "dismissed", label: "Dismissed" } as const;
  if (thread.findingId) return { kind: "converted", label: `Finding ${thread.findingId}` } as const;
  if (reply.trim()) return { kind: "reply", label: "Reply queued" } as const;
  if (thread.messages.at(-1)?.author === "user") return { kind: "waiting", label: "Waiting for agent" } as const;
  return { kind: "needs-reply", label: "Needs your reply" } as const;
}

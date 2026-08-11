import {
  Bot,
  CheckCircle2,
  CircleDot,
  CircleX,
  MessageSquarePlus,
  MessagesSquare,
  Send,
} from "lucide-react";
import type { LineCommentDraft, UserCommentThread } from "../types";
import { userThreadStatus } from "./UserCommentThread";

type Props = {
  threads: UserCommentThread[];
  drafts: LineCommentDraft[];
  activeThreadId: string | null;
  replyMessages: Record<string, string>;
  dismissalReasons: Record<string, string>;
  onSelectThread: (thread: UserCommentThread) => void;
  onSelectDraft: (draft: LineCommentDraft) => void;
};

export function MyCommentNavigation({
  threads,
  drafts,
  activeThreadId,
  replyMessages,
  dismissalReasons,
  onSelectThread,
  onSelectDraft,
}: Props) {
  const total = threads.length + drafts.length;
  return (
    <>
      <div className="panel-section-heading my-comments-heading">
        <span><MessagesSquare size={15} /> My comments</span>
        <strong>{total}</strong>
      </div>
      <nav className="my-comment-list" aria-label="My comments">
        {total === 0 ? (
          <p>Click <b>+</b> beside a line to start a discussion with the AI agent.</p>
        ) : (
          <>
            {drafts.map((draft) => (
              <button
                key={`draft-${draft.id}`}
                type="button"
                className={activeThreadId === draft.id ? "active" : ""}
                aria-current={activeThreadId === draft.id ? "true" : undefined}
                onClick={() => onSelectDraft(draft)}
              >
                <span className="my-comment-item-heading">
                  <MessageSquarePlus aria-hidden="true" size={12} />
                  <strong>Draft</strong>
                </span>
                <span className="my-comment-preview">{draft.message || "New comment"}</span>
                <small>{draft.path}:{draft.line}</small>
              </button>
            ))}
            {threads.map((thread) => {
              const status = userThreadStatus(
                thread,
                replyMessages[thread.id],
                dismissalReasons[thread.id],
              );
              return (
                <button
                  key={thread.id}
                  type="button"
                  className={`my-comment-${status.kind} ${activeThreadId === thread.id ? "active" : ""}`}
                  aria-current={activeThreadId === thread.id ? "true" : undefined}
                  onClick={() => onSelectThread(thread)}
                >
                  <span className="my-comment-item-heading">
                    {statusIcon(status.kind)}
                    <strong>{status.label}</strong>
                  </span>
                  <span className="my-comment-preview">{thread.messages.at(-1)?.body}</span>
                  <small>{thread.path}:{thread.line}</small>
                </button>
              );
            })}
          </>
        )}
      </nav>
    </>
  );
}

function statusIcon(kind: ReturnType<typeof userThreadStatus>["kind"]) {
  if (kind === "converted") return <CheckCircle2 aria-hidden="true" size={12} />;
  if (kind === "dismissed" || kind === "dismissing") return <CircleX aria-hidden="true" size={12} />;
  if (kind === "reply") return <Send aria-hidden="true" size={12} />;
  if (kind === "needs-reply") return <Bot aria-hidden="true" size={12} />;
  return <CircleDot aria-hidden="true" size={12} />;
}

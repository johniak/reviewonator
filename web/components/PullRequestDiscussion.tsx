import {
  CheckCircle2,
  ExternalLink,
  FileCode2,
  MessageCircle,
  MessagesSquare,
  OctagonAlert,
} from "lucide-react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { PullRequestDiscussionItem } from "../../src/domain/discussion";

export function PullRequestDiscussion({
  items,
  onSelectFile,
}: {
  items: PullRequestDiscussionItem[];
  onSelectFile: (path: string) => void;
}) {
  if (items.length === 0) {
    return (
      <section className="discussion-empty">
        <MessagesSquare size={28} />
        <h2>No existing discussion</h2>
        <p>No one has commented on or reviewed this pull request yet.</p>
      </section>
    );
  }

  return (
    <section className="discussion-timeline" aria-label="Existing pull request discussion">
      <div className="discussion-intro">
        <span className="eyebrow">GitHub activity</span>
        <h2>Existing discussion</h2>
        <p>Comments and reviews already published on this pull request.</p>
      </div>
      <div className="discussion-list">
        {items.map((item) => (
          <article className={`discussion-card discussion-${item.kind}`} key={item.id}>
            <div className="discussion-card-header">
              <ActorAvatar item={item} />
              <div className="discussion-author">
                <strong>{item.author.login}</strong>
                <span>{describeItem(item)} · {formatDate(item.createdAt)}</span>
              </div>
              <a href={item.url} target="_blank" rel="noreferrer" aria-label={`Open ${item.author.login}'s comment on GitHub`}>
                <ExternalLink size={13} />
              </a>
            </div>

            {item.kind === "review" && <ReviewState state={item.state ?? "COMMENTED"} />}
            {item.path && (
              <button className="discussion-location" type="button" onClick={() => onSelectFile(item.path!)}>
                <FileCode2 size={13} />
                <span>{item.path}{item.line ? `:${item.line}` : ""}</span>
                {item.outdated && <small>Outdated</small>}
              </button>
            )}

            {item.body ? (
              <div className="discussion-body">
                <Markdown remarkPlugins={[remarkGfm]} components={{
                  a: ({ href, children }) => <a href={href} target="_blank" rel="noreferrer">{children}</a>,
                }}>
                  {item.body}
                </Markdown>
              </div>
            ) : (
              <p className="discussion-no-body">No review summary was provided.</p>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}

function ActorAvatar({ item }: { item: PullRequestDiscussionItem }) {
  if (item.author.avatarUrl) {
    return <img className="discussion-avatar" src={item.author.avatarUrl} alt="" />;
  }
  return <span className="discussion-avatar avatar-fallback">{item.author.login.slice(0, 1).toUpperCase()}</span>;
}

function ReviewState({ state }: { state: string }) {
  const normalized = state.toUpperCase();
  const content = normalized === "APPROVED"
    ? { className: "approved", icon: <CheckCircle2 size={13} />, label: "Approved" }
    : normalized === "CHANGES_REQUESTED"
      ? { className: "changes-requested", icon: <OctagonAlert size={13} />, label: "Requested changes" }
      : { className: "commented", icon: <MessageCircle size={13} />, label: formatState(state) };
  return <div className={`discussion-review-state ${content.className}`}>{content.icon}{content.label}</div>;
}

function describeItem(item: PullRequestDiscussionItem): string {
  if (item.kind === "inline") return item.replyToId ? "Inline reply" : "Inline comment";
  if (item.kind === "review") return "Pull request review";
  return "Conversation comment";
}

function formatState(state: string): string {
  const value = state.toLowerCase().replaceAll("_", " ");
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function formatDate(value: string): string {
  if (!value) return "Pending";
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

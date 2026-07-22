import {
  ArrowRight,
  CheckCircle2,
  CheckCheck,
  CircleX,
  CircleDot,
  ExternalLink,
  FileDiff,
  GitCommitHorizontal,
  GitPullRequest,
  LoaderCircle,
  MessageSquareText,
  OctagonAlert,
  RotateCcw,
  TimerOff,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { ReviewComment, ReviewEvent } from "../src/domain/review";
import { api } from "./api";
import { DiffPanel, fileSectionId } from "./components/DiffPanel";
import { PublishDialog } from "./components/PublishDialog";
import { PullRequestDiscussion } from "./components/PullRequestDiscussion";
import { commentCardId, ReviewCommentCard } from "./components/ReviewCommentCard";
import { ReviewFindingNavigation } from "./components/ReviewFindingNavigation";
import type { LineCommentDraft, SessionSnapshot } from "./types";

type Completion =
  | { type: "revision" }
  | { type: "published"; url: string; event: ReviewEvent }
  | { type: "cancelled" };

export function App() {
  const [session, setSession] = useState<SessionSnapshot | null>(null);
  const [loadingError, setLoadingError] = useState<string | null>(null);
  const [activePath, setActivePath] = useState("");
  const [viewMode, setViewMode] = useState<"single" | "all">("single");
  const [diffStyle, setDiffStyle] = useState<"unified" | "split">("unified");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [rejectedIds, setRejectedIds] = useState<Set<string>>(new Set());
  const [focusedCommentId, setFocusedCommentId] = useState<string | null>(null);
  const [pendingCommentId, setPendingCommentId] = useState<string | null>(null);
  const [revisionMessages, setRevisionMessages] = useState<Record<string, string>>({});
  const [lineCommentDrafts, setLineCommentDrafts] = useState<Record<string, LineCommentDraft>>({});
  const [publishOpen, setPublishOpen] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [completion, setCompletion] = useState<Completion | null>(null);
  const [panelTab, setPanelTab] = useState<"review" | "discussion">("review");

  useEffect(() => {
    api.loadSession()
      .then((loaded) => {
        setSession(loaded);
        setActivePath(loaded.pullRequest.files[0]?.path ?? "");
        setSelectedIds(new Set(
          loaded.review.comments.filter((comment) => comment.included).map((comment) => comment.id),
        ));
        setRejectedIds(new Set(
          loaded.review.comments.filter((comment) => comment.rejected).map((comment) => comment.id),
        ));
      })
      .catch((error: unknown) => setLoadingError(error instanceof Error ? error.message : "Could not load the review."));
  }, []);

  useEffect(() => {
    if (!pendingCommentId) return;
    let cancelled = false;
    let attempts = 0;
    let timer: number | undefined;
    const scrollToComment = () => {
      if (cancelled) return;
      const element = document.getElementById(commentCardId(pendingCommentId));
      if (element) {
        scrollWithinPanel(element, "center");
        element.focus({ preventScroll: true });
        setPendingCommentId(null);
        return;
      }
      if (attempts < 40) {
        attempts += 1;
        timer = window.setTimeout(scrollToComment, 50);
      } else {
        setPendingCommentId(null);
      }
    };
    scrollToComment();
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [activePath, pendingCommentId, viewMode]);

  const comments = session?.review.comments ?? [];
  const selectedComments = useMemo(
    () => comments.filter((comment) => selectedIds.has(comment.id)),
    [comments, selectedIds],
  );
  const pendingRevisions = Object.entries(revisionMessages)
    .filter(([, message]) => message.trim())
    .map(([commentId, message]) => ({ commentId, message: message.trim() }));
  const pendingNewComments = Object.values(lineCommentDrafts)
    .filter(({ message }) => message.trim())
    .map((draft) => ({ ...draft, message: draft.message.trim() }));
  const pendingAgentRequests = pendingRevisions.length + pendingNewComments.length;

  const actions = {
    selectedIds,
    rejectedIds,
    revisionMessages,
    onToggleSelected: toggleSelected,
    onToggleRejected: toggleRejected,
    onRevisionChange: changeRevision,
  };

  function clearRevision(id: string) {
    setRevisionMessages((current) => {
      if (!(id in current)) return current;
      const next = { ...current };
      delete next[id];
      return next;
    });
  }

  function toggleSelected(id: string) {
    const willSelect = !selectedIds.has(id);
    setSelectedIds((current) => {
      const next = new Set(current);
      if (willSelect) next.add(id);
      else next.delete(id);
      return next;
    });
    if (willSelect) {
      setRejectedIds((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
      clearRevision(id);
    }
  }

  function toggleRejected(id: string) {
    const willReject = !rejectedIds.has(id);
    setRejectedIds((current) => {
      const next = new Set(current);
      if (willReject) next.add(id);
      else next.delete(id);
      return next;
    });
    if (willReject) {
      setSelectedIds((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
      clearRevision(id);
    }
  }

  function changeRevision(id: string, message: string) {
    setRevisionMessages((current) => ({ ...current, [id]: message }));
    if (!message.trim()) return;
    setSelectedIds((current) => {
      const next = new Set(current);
      next.delete(id);
      return next;
    });
    setRejectedIds((current) => {
      const next = new Set(current);
      next.delete(id);
      return next;
    });
  }

  if (loadingError) return <LoadFailure message={loadingError} />;
  if (!session) return <LoadingScreen />;
  if (completion) return <CompletionScreen completion={completion} />;

  const { pullRequest, review } = session;
  const generalComments = comments.filter((comment) => comment.type === "general");
  const commitBaseUrl = pullRequest.url.replace(/\/pull\/\d+\/?$/, "/commit/");
  const publishBody = buildPublishBody(review.summary, selectedComments);

  async function sendRevisionRequests() {
    setActionError(null);
    try {
      await api.requestRevision({
        selectedCommentIds: [...selectedIds],
        rejectedCommentIds: [...rejectedIds],
        requests: pendingRevisions,
        newComments: pendingNewComments,
      });
      setCompletion({ type: "revision" });
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Could not send revision requests.");
    }
  }

  function createLineCommentDraft(location: Omit<LineCommentDraft, "message">) {
    const key = lineCommentDraftKey(location);
    setLineCommentDrafts((current) => current[key]
      ? current
      : { ...current, [key]: { ...location, message: "" } });
  }

  function changeLineCommentDraft(location: Omit<LineCommentDraft, "message">, message: string) {
    const key = lineCommentDraftKey(location);
    setLineCommentDrafts((current) => ({ ...current, [key]: { ...location, message } }));
  }

  function removeLineCommentDraft(location: Omit<LineCommentDraft, "message">) {
    const key = lineCommentDraftKey(location);
    setLineCommentDrafts((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
  }

  async function publish(input: { body: string; event: ReviewEvent }) {
    setPublishing(true);
    setActionError(null);
    try {
      const result = await api.publish({
        confirmed: true,
        event: input.event,
        body: input.body,
        selectedCommentIds: selectedComments.map((comment) => comment.id),
      });
      setCompletion({ type: "published", url: result.review.url, event: input.event });
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Could not publish the review.");
    } finally {
      setPublishing(false);
    }
  }

  async function cancel() {
    if (!window.confirm("Cancel this review session without publishing anything?")) return;
    await api.cancel();
    setCompletion({ type: "cancelled" });
  }

  function selectFile(path: string) {
    setActivePath(path);
    setFocusedCommentId(null);
    setPendingCommentId(null);
    if (viewMode === "all") {
      const section = document.getElementById(fileSectionId(path));
      if (section) scrollWithinPanel(section, "start");
    } else {
      const canvas = document.querySelector<HTMLElement>(".review-canvas");
      if (canvas) canvas.scrollTop = 0;
    }
  }

  function selectComment(comment: ReviewComment) {
    setFocusedCommentId(comment.id);
    if (comment.type === "line" && comment.path) setActivePath(comment.path);
    setPendingCommentId(comment.id);
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand-lockup">
          <img className="brand-mark" src="/favicon.svg" alt="" />
          <div><strong>Reviewonator</strong><span>AI review, human decision</span></div>
        </div>
        <div className="pr-heading">
          <span>#{pullRequest.number}</span>
          <h1>{pullRequest.title}</h1>
          <a href={pullRequest.url} target="_blank" rel="noreferrer" aria-label="View pull request on GitHub">
            <GitPullRequest size={16} />
            View PR on GitHub
            <ExternalLink size={13} />
          </a>
        </div>
        <div className="diff-stats">
          <span className="additions">+{pullRequest.additions}</span>
          <span className="deletions">−{pullRequest.deletions}</span>
        </div>
      </header>

      <div className="workspace">
        <aside className="navigation-panel">
          <div className="panel-section-heading">
            <span><FileDiff size={15} /> Files changed</span>
            <strong>{pullRequest.changedFiles}</strong>
          </div>
          <nav className="file-list" aria-label="Changed files">
            {pullRequest.files.map((file) => {
              const path = describeFilePath(file.path);
              return (
                <button
                  type="button"
                  key={file.path}
                  className={activePath === file.path ? "active" : ""}
                  aria-label={`Open ${file.path}`}
                  title={file.path}
                  onClick={() => selectFile(file.path)}
                >
                  <span className="file-identity">
                    <strong>{path.name}</strong>
                    <span>{path.directory}</span>
                  </span>
                  <small className="file-changes"><b>+{file.additions}</b><i>−{file.deletions}</i></small>
                </button>
              );
            })}
          </nav>

          <ReviewFindingNavigation
            comments={comments}
            activeCommentId={focusedCommentId}
            selectedIds={selectedIds}
            rejectedIds={rejectedIds}
            revisionMessages={revisionMessages}
            onSelect={selectComment}
          />

          <div className="panel-section-heading commits-heading">
            <span><GitCommitHorizontal size={15} /> Commits</span>
            <strong>{pullRequest.commits.length}</strong>
          </div>
          <div className="commit-list">
            {pullRequest.commits.map((commit) => (
              <a key={commit.oid} href={`${commitBaseUrl}${commit.oid}`} target="_blank" rel="noreferrer">
                <CircleDot size={13} />
                <span><strong>{commit.messageHeadline}</strong><small>{commit.oid.slice(0, 7)}</small></span>
                <ExternalLink size={12} />
              </a>
            ))}
          </div>
        </aside>

        <main className="review-canvas">
          <DiffPanel
            patch={session.patch}
            activePath={activePath}
            fileUrls={session.fileUrls}
            comments={comments}
            reviewerLanguage={review.languages.reviewerNotes}
            focusedCommentId={focusedCommentId}
            viewMode={viewMode}
            onViewModeChange={setViewMode}
            diffStyle={diffStyle}
            onDiffStyleChange={setDiffStyle}
            loadFileContext={api.loadFileContext}
            drafts={Object.values(lineCommentDrafts)}
            onCreateDraft={createLineCommentDraft}
            onChangeDraft={changeLineCommentDraft}
            onRemoveDraft={removeLineCommentDraft}
            {...actions}
          />
        </main>

        <aside className="review-panel">
          <div className="review-panel-tabs" role="tablist" aria-label="Review panel">
            <button
              type="button"
              role="tab"
              aria-selected={panelTab === "review"}
              className={panelTab === "review" ? "active" : ""}
              onClick={() => setPanelTab("review")}
            >
              Proposed review <span>{comments.length}</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={panelTab === "discussion"}
              className={panelTab === "discussion" ? "active" : ""}
              onClick={() => setPanelTab("discussion")}
            >
              PR discussion <span>{session.discussion.length}</span>
            </button>
          </div>

          <div className="review-panel-content">
            {panelTab === "review" ? (
              <>
                <section className="review-summary">
                  <span className="eyebrow">AI assessment</span>
                  <h2>Review summary</h2>
                  <p>{review.summary}</p>
                  <div className="recommendation">
                    <MessageSquareText size={16} />
                    Recommended decision
                    <strong>{formatEvent(review.recommendation)}</strong>
                  </div>
                </section>

                <section className="general-comments">
                  <div className="section-title-row">
                    <h3>General comments</h3>
                    <span>{generalComments.length}</span>
                  </div>
                  {generalComments.length === 0 ? (
                    <p className="muted-copy">The AI agent did not add any general comments.</p>
                  ) : generalComments.map((comment) => (
                    <ReviewCommentCard
                      key={comment.id}
                      comment={comment}
                      reviewerLanguage={review.languages.reviewerNotes}
                      compact
                      focused={comment.id === focusedCommentId}
                      {...actions}
                    />
                  ))}
                </section>
              </>
            ) : (
              <PullRequestDiscussion items={session.discussion} onSelectFile={selectFile} />
            )}
          </div>

          <footer className="review-actions-panel">
            <div className="selection-summary">
              <CheckCheck size={17} />
              <span><strong>{selectedComments.length}</strong> of {comments.length} comments selected</span>
            </div>
            {actionError && <p className="error-message" role="alert">{actionError}</p>}
            {pendingAgentRequests > 0 && (
              <button className="revision-submit-button" type="button" onClick={sendRevisionRequests}>
                <RotateCcw size={16} />
                Send {pendingAgentRequests} request{pendingAgentRequests === 1 ? "" : "s"} to AI agent
              </button>
            )}
            <button
              className="primary-button"
              type="button"
              disabled={pendingAgentRequests > 0}
              onClick={() => {
                setActionError(null);
                setPublishOpen(true);
              }}
            >
              Review and publish
              <ArrowRight size={16} />
            </button>
            <button className="cancel-button" type="button" onClick={cancel}>
              <X size={14} /> Cancel review
            </button>
          </footer>
        </aside>
      </div>

      <PublishDialog
        open={publishOpen}
        comments={selectedComments}
        reviewerLanguage={review.languages.reviewerNotes}
        initialBody={publishBody}
        initialEvent={review.recommendation}
        publishing={publishing}
        error={actionError}
        onOpenChange={setPublishOpen}
        onPublish={publish}
      />
    </div>
  );
}

export function buildPublishBody(summary: string, selectedComments: SessionSnapshot["review"]["comments"]): string {
  const general = selectedComments.filter((comment) => comment.type === "general");
  if (general.length === 0) return summary;
  const comments = `### General comments\n\n${general
    .map((comment) => `- **${capitalize(comment.severity)}:** ${comment.body}`)
    .join("\n")}`;
  return [summary, comments].filter(Boolean).join("\n\n");
}

export function describeFilePath(path: string): { name: string; directory: string } {
  const parts = path.split("/");
  const name = parts.pop() || path;
  const parentParts = parts.length > 2 ? parts.slice(-2) : parts;
  const directory = parentParts.join("/");
  return {
    name,
    directory: parts.length > 2 ? `…/${directory}` : directory || "Repository root",
  };
}

export function lineCommentDraftKey(location: Omit<LineCommentDraft, "message">): string {
  return `${location.path}:${location.side}:${location.line}`;
}

function scrollWithinPanel(element: HTMLElement, block: "start" | "center") {
  const container = element.closest<HTMLElement>(".review-canvas, .review-panel");
  if (!container) {
    element.scrollIntoView({ behavior: "smooth", block });
    return;
  }
  const elementRect = element.getBoundingClientRect();
  const containerRect = container.getBoundingClientRect();
  const offset = block === "center"
    ? (container.clientHeight - elementRect.height) / 2
    : 70;
  container.scrollTo({
    top: Math.max(0, container.scrollTop + elementRect.top - containerRect.top - offset),
    behavior: "smooth",
  });
}

function formatEvent(event: ReviewEvent): string {
  if (event === "REQUEST_CHANGES") return "Request changes";
  if (event === "APPROVE") return "Approve";
  return "Comment";
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function LoadingScreen() {
  return <div className="centered-screen"><LoaderCircle className="spin" /><h1>Loading pull request…</h1></div>;
}

function LoadFailure({ message }: { message: string }) {
  return <div className="centered-screen failure"><X /><h1>Could not open Reviewonator</h1><p>{message}</p></div>;
}

const closeCurrentTab = () => window.close();

export function CompletionScreen({
  completion,
  autoCloseSeconds = 60,
  onAutoClose = closeCurrentTab,
}: {
  completion: Completion;
  autoCloseSeconds?: number;
  onAutoClose?: () => void;
}) {
  const content = getCompletionContent(completion);
  const [remainingSeconds, setRemainingSeconds] = useState(autoCloseSeconds);
  const [autoCloseCancelled, setAutoCloseCancelled] = useState(false);
  const [closeAttempted, setCloseAttempted] = useState(false);

  useEffect(() => {
    if (autoCloseCancelled) return;
    const deadline = Date.now() + autoCloseSeconds * 1_000;
    const countdown = window.setInterval(() => {
      setRemainingSeconds(Math.max(0, Math.ceil((deadline - Date.now()) / 1_000)));
    }, 1_000);
    const closeTimer = window.setTimeout(() => {
      setRemainingSeconds(0);
      setCloseAttempted(true);
      onAutoClose();
    }, autoCloseSeconds * 1_000);
    return () => {
      window.clearInterval(countdown);
      window.clearTimeout(closeTimer);
    };
  }, [autoCloseCancelled, autoCloseSeconds, onAutoClose]);

  return (
    <div className="centered-screen completion-screen">
      <div className={`completion-icon ${content.className}`}>{content.icon}</div>
      <span className="eyebrow">Reviewonator</span>
      <h1>{content.title}</h1>
      <p>{content.body}</p>
      {completion.type === "published" && (
        <a className="primary-button" href={completion.url} target="_blank" rel="noreferrer">
          View review on GitHub <ExternalLink size={15} />
        </a>
      )}
      <div className="auto-close-panel" aria-live="polite">
        <small>
          {autoCloseCancelled
            ? "Automatic closing cancelled."
            : closeAttempted
              ? "If this tab stays open, your browser prevented automatic closing."
              : `This tab will close automatically in ${remainingSeconds} second${remainingSeconds === 1 ? "" : "s"}.`}
        </small>
        {!autoCloseCancelled && !closeAttempted && (
          <button type="button" className="cancel-auto-close" onClick={() => setAutoCloseCancelled(true)}>
            <TimerOff size={14} /> Keep tab open
          </button>
        )}
      </div>
    </div>
  );
}

function getCompletionContent(completion: Completion) {
  if (completion.type === "revision") {
    return {
      title: "Revision requested",
      body: "The AI agent will update the requested comments and reopen Reviewonator.",
      className: "completion-revision",
      icon: <RotateCcw />,
    };
  }
  if (completion.type === "cancelled") {
    return {
      title: "Review cancelled",
      body: "Nothing was published to GitHub.",
      className: "completion-cancelled",
      icon: <CircleX />,
    };
  }
  if (completion.event === "APPROVE") {
    return {
      title: "Pull request approved",
      body: "Your approval is now on GitHub.",
      className: "completion-approved",
      icon: <CheckCircle2 />,
    };
  }
  if (completion.event === "REQUEST_CHANGES") {
    return {
      title: "Changes requested",
      body: "Your change request is now on GitHub.",
      className: "completion-changes-requested",
      icon: <OctagonAlert />,
    };
  }
  return {
    title: "Review comment published",
    body: "Your review comment is now on GitHub.",
    className: "completion-commented",
    icon: <MessageSquareText />,
  };
}

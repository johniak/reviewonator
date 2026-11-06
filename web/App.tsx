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
  Radio,
  Settings,
  TimerOff,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { CommentEdit, ReviewComment, ReviewEvent, RevisionRequest } from "../src/domain/review";
import type { UpdateNotice } from "../src/domain/update";
import { api } from "./api";
import { DiffPanel, fileSectionId } from "./components/DiffPanel";
import { PublishDialog } from "./components/PublishDialog";
import { PullRequestDiscussion } from "./components/PullRequestDiscussion";
import { MyCommentNavigation } from "./components/MyCommentNavigation";
import { MarkdownText } from "./components/MarkdownText";
import { PrBriefing, PrBriefingPending, pullRequestPeople } from "./components/PrBriefing";
import { commentCardId, ReviewCommentCard } from "./components/ReviewCommentCard";
import { ReviewFindingNavigation } from "./components/ReviewFindingNavigation";
import { ReviewingStatus } from "./components/ReviewingStatus";
import { SettingsDialog } from "./components/SettingsDialog";
import { UpdateNoticeToast } from "./components/UpdateNotice";
import { userThreadCardId } from "./components/UserCommentThread";
import markDark from "./brand/mark-dark.png";
import markLight from "./brand/mark-light.png";
import { usePreference } from "./preferences";
import { maximumCollapsedBriefings } from "../src/domain/preferences";
import { ThemeSwitcher, usePalette, useTheme } from "./theme";
import type {
  LineCommentDraft,
  LineCommentLocation,
  SessionSnapshot,
  UserCommentThread,
} from "./types";

type Completion =
  | { type: "revision" }
  | { type: "published"; url: string; event: ReviewEvent }
  | { type: "cancelled" };

export function App() {
  const [session, setSession] = useState<SessionSnapshot | null>(null);
  const [loadingError, setLoadingError] = useState<string | null>(null);
  const [activePath, setActivePath] = useState("");
  const [viewMode, setViewMode] = usePreference("viewMode");
  const [diffStyle, setDiffStyle] = usePreference("diffStyle");
  const [collapsedBriefings, setCollapsedBriefings] = usePreference("collapsedBriefings");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [rejectedIds, setRejectedIds] = useState<Set<string>>(new Set());
  const [focusedCommentId, setFocusedCommentId] = useState<string | null>(null);
  const [pendingCommentId, setPendingCommentId] = useState<string | null>(null);
  const [focusedThreadId, setFocusedThreadId] = useState<string | null>(null);
  const [pendingThreadId, setPendingThreadId] = useState<string | null>(null);
  const [revisionMessages, setRevisionMessages] = useState<Record<string, string>>({});
  const [lineCommentDrafts, setLineCommentDrafts] = useState<Record<string, LineCommentDraft>>({});
  const [threadReplies, setThreadReplies] = useState<Record<string, string>>({});
  const [dismissalReasons, setDismissalReasons] = useState<Record<string, string>>({});
  const [publishOpen, setPublishOpen] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [completion, setCompletion] = useState<Completion | null>(null);
  const [viewedPaths, setViewedPaths] = useState<Set<string>>(new Set());
  const [panelTab, setPanelTab] = useState<"review" | "discussion">("review");
  const [themePreference, resolvedTheme, setThemePreference] = useTheme();
  const [palette, setPalette] = usePalette();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [updateNotice, setUpdateNotice] = useState<UpdateNotice | null>(null);

  useEffect(() => {
    api.loadSession()
      .then((loaded) => {
        setSession(loaded);
        api.loadUpdateNotice().then(({ notice }) => setUpdateNotice(notice)).catch(() => {});
        setActivePath(loaded.pullRequest.files[0]?.path ?? "");
        setViewedPaths(new Set(loaded.viewedFiles));
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
    if (!session?.live || typeof EventSource === "undefined") return;
    return api.subscribeToSession(
      () => {
        setActionError(null);
        api.loadSession().then(setSession).catch(() => {});
      },
      () => setActionError("Live connection lost. Reviewonator will reconnect automatically."),
    );
  }, [session?.live]);

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

  useEffect(() => {
    if (!pendingThreadId) return;
    let cancelled = false;
    let attempts = 0;
    let timer: number | undefined;
    const scrollToThread = () => {
      if (cancelled) return;
      const element = document.getElementById(userThreadCardId(pendingThreadId));
      if (element) {
        scrollWithinPanel(element, "center");
        element.focus({ preventScroll: true });
        setPendingThreadId(null);
        return;
      }
      if (attempts < 40) {
        attempts += 1;
        timer = window.setTimeout(scrollToThread, 50);
      } else {
        setPendingThreadId(null);
      }
    };
    scrollToThread();
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [activePath, pendingThreadId, viewMode]);

  const comments = session?.review.comments ?? [];
  const userThreads = session?.review.userThreads ?? [];
  const selectedComments = useMemo(
    () => comments.filter((comment) => selectedIds.has(comment.id)),
    [comments, selectedIds],
  );
  const pendingRevisions = Object.entries(revisionMessages)
    .filter(([, message]) => message.trim())
    .map(([commentId, message]) => ({ commentId, message: message.trim() }));
  const pendingNewThreads = Object.values(lineCommentDrafts)
    .filter(({ message }) => message.trim())
    .map((draft) => ({ ...draft, message: draft.message.trim() }));
  const pendingThreadReplies = Object.entries(threadReplies)
    .filter(([, message]) => message.trim())
    .map(([threadId, message]) => ({ threadId, message: message.trim() }));
  const pendingDismissedThreads = Object.entries(dismissalReasons)
    .filter(([, reason]) => reason.trim())
    .map(([threadId, reason]) => ({ threadId, reason: reason.trim() }));
  const pendingAgentRequests = pendingRevisions.length
    + pendingNewThreads.length
    + pendingThreadReplies.length
    + pendingDismissedThreads.length;

  const reviewing = session?.reviewing ?? null;
  const actions = {
    agentPending: session?.agentPending ?? false,
    queueing: Boolean(reviewing),
    selectedIds,
    rejectedIds,
    revisionMessages,
    onToggleSelected: toggleSelected,
    onToggleRejected: toggleRejected,
    onRevisionChange: changeRevision,
    onSendRevision: sendSingleRevisionRequest,
    onEditComment: editComment,
    onDeleteComment: deleteComment,
  };

  const threadActions = {
    replyMessages: threadReplies,
    dismissalReasons,
    onReplyChange: changeThreadReply,
    onDismissalChange: changeDismissalReason,
    onSendReply: sendThreadReply,
    onSelectFinding: selectFindingById,
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

  function changeThreadReply(id: string, message: string) {
    setThreadReplies((current) => ({ ...current, [id]: message }));
    if (!message.trim()) return;
    setDismissalReasons((current) => {
      if (!(id in current)) return current;
      const next = { ...current };
      delete next[id];
      return next;
    });
  }

  function changeDismissalReason(id: string, reason: string) {
    setDismissalReasons((current) => ({ ...current, [id]: reason }));
    if (!reason.trim()) return;
    setThreadReplies((current) => {
      if (!(id in current)) return current;
      const next = { ...current };
      delete next[id];
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

  const viewedCount = pullRequest.files.filter((file) => viewedPaths.has(file.path)).length;

  function setBriefingCollapsed(collapsed: boolean) {
    const others = collapsedBriefings.filter((url) => url !== review.prUrl);
    setCollapsedBriefings(collapsed ? [...others, review.prUrl].slice(-maximumCollapsedBriefings) : others);
  }

  async function setFileViewed(path: string, viewed: boolean) {
    setActionError(null);
    setViewedPaths((current) => withPath(current, path, viewed));
    try {
      await api.setFileViewed(path, viewed);
    } catch (error) {
      setViewedPaths((current) => withPath(current, path, !viewed));
      setActionError(error instanceof Error ? error.message : "Could not update the viewed state on GitHub.");
    }
  }

  async function sendRevisionRequests() {
    setActionError(null);
    try {
      const response = await api.requestRevision({
        selectedCommentIds: [...selectedIds],
        rejectedCommentIds: [...rejectedIds],
        requests: pendingRevisions,
        newThreads: pendingNewThreads,
        threadReplies: pendingThreadReplies,
        dismissedThreads: pendingDismissedThreads,
      });
      if (!response.session.live) {
        setCompletion({ type: "revision" });
        return;
      }
      setSession(response.session);
      setRevisionMessages({});
      setLineCommentDrafts({});
      setThreadReplies({});
      setDismissalReasons({});
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Could not send revision requests.");
    }
  }

  async function sendSingleRevisionRequest(commentId: string) {
    const message = revisionMessages[commentId]?.trim();
    if (!message) return;
    await sendOneAgentRequest(
      { requests: [{ commentId, message }] },
      () => clearRevision(commentId),
      "Could not send this discussion message.",
    );
  }

  async function sendLineCommentDraft(location: LineCommentLocation) {
    const draft = lineCommentDrafts[lineCommentDraftKey(location)];
    const message = draft?.message.trim();
    if (!draft || !message) return;
    await sendOneAgentRequest(
      { newThreads: [{ ...draft, message }] },
      () => removeLineCommentDraft(location),
      "Could not send this comment.",
    );
  }

  async function sendThreadReply(threadId: string) {
    const message = threadReplies[threadId]?.trim();
    if (!message) return;
    await sendOneAgentRequest(
      { threadReplies: [{ threadId, message }] },
      () => changeThreadReply(threadId, ""),
      "Could not send this reply.",
    );
  }

  async function editComment(id: string, edit: CommentEdit): Promise<boolean> {
    setActionError(null);
    try {
      setSession((await api.editComment(id, edit)).session);
      return true;
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Could not save this comment.");
      return false;
    }
  }

  async function deleteComment(id: string) {
    setActionError(null);
    try {
      setSession((await api.deleteComment(id)).session);
      setSelectedIds((current) => withoutId(current, id));
      setRejectedIds((current) => withoutId(current, id));
      clearRevision(id);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Could not delete this comment.");
    }
  }

  async function addUserComment(location: LineCommentLocation) {
    const body = lineCommentDrafts[lineCommentDraftKey(location)]?.message.trim();
    if (!body) return;
    setActionError(null);
    try {
      const response = await api.addComment({ ...location, body });
      setSession(response.session);
      removeLineCommentDraft(location);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Could not add this comment.");
    }
  }

  /** Sends a single message and leaves every other unsent message in place. */
  async function sendOneAgentRequest(
    item: Partial<Pick<RevisionRequest, "requests" | "newThreads" | "threadReplies">>,
    onSent: () => void,
    failure: string,
  ) {
    if (!session) return;
    setActionError(null);
    try {
      const response = await api.requestRevision({
        selectedCommentIds: [...selectedIds],
        rejectedCommentIds: [...rejectedIds],
        requests: [],
        newThreads: [],
        threadReplies: [],
        dismissedThreads: [],
        ...item,
      });
      if (!response.session.live) {
        setCompletion({ type: "revision" });
        return;
      }
      setSession(response.session);
      onSent();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : failure);
    }
  }

  function createLineCommentDraft(location: LineCommentLocation) {
    const key = lineCommentDraftKey(location);
    const id = lineCommentDrafts[key]?.id ?? createUserThreadId();
    setLineCommentDrafts((current) => current[key]
      ? current
      : { ...current, [key]: { id, ...location, message: "" } });
    setFocusedCommentId(null);
    setFocusedThreadId(id);
  }

  function changeLineCommentDraft(location: LineCommentLocation, message: string) {
    const key = lineCommentDraftKey(location);
    setLineCommentDrafts((current) => current[key]
      ? { ...current, [key]: { ...current[key], ...location, message } }
      : current);
  }

  function removeLineCommentDraft(location: LineCommentLocation) {
    const key = lineCommentDraftKey(location);
    setLineCommentDrafts((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
  }

  function dismissUpdateNotice() {
    if (!updateNotice) return;
    const { latest } = updateNotice;
    setUpdateNotice(null);
    api.dismissUpdateNotice(latest).catch(() => {});
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
    setFocusedThreadId(null);
    setPendingCommentId(null);
    setPendingThreadId(null);
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
    setFocusedThreadId(null);
    if (comment.type === "line" && comment.path) setActivePath(comment.path);
    setPendingCommentId(comment.id);
  }

  function selectFindingById(id: string) {
    const comment = comments.find((item) => item.id === id);
    if (comment) selectComment(comment);
  }

  function selectUserThread(thread: UserCommentThread) {
    setFocusedThreadId(thread.id);
    setFocusedCommentId(null);
    setActivePath(thread.path);
    setPendingThreadId(thread.id);
  }

  function selectDraft(draft: LineCommentDraft) {
    setFocusedThreadId(draft.id);
    setFocusedCommentId(null);
    setActivePath(draft.path);
    setPendingThreadId(draft.id);
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand-lockup">
          <img className="brand-mark" src={resolvedTheme === "dark" ? markDark : markLight} alt="" />
          <strong>Reviewonator</strong>
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
        <div className="header-tools">
          <div className="diff-stats">
            {session.live && (
              <span className={`live-session-badge ${reviewing || session.agentPending ? "working" : ""}`}>
                <Radio aria-hidden="true" size={12} />
                {reviewing ? "AI reviewing" : session.agentPending ? "AI working" : "Live"}
              </span>
            )}
            <span className="additions">+{pullRequest.additions}</span>
            <span className="deletions">−{pullRequest.deletions}</span>
          </div>
          <ThemeSwitcher preference={themePreference} onChange={setThemePreference} />
          <button type="button" className="icon-button" aria-label="Settings" onClick={() => setSettingsOpen(true)}>
            <Settings size={16} />
          </button>
        </div>
      </header>

      <div className="workspace">
        <aside className="navigation-panel">
          <div className="panel-section-heading">
            <span><FileDiff size={15} /> Files changed</span>
            <strong>{viewedCount} / {pullRequest.changedFiles} viewed</strong>
          </div>
          <nav className="file-list" aria-label="Changed files">
            {pullRequest.files.map((file) => {
              const path = describeFilePath(file.path);
              return (
                <button
                  type="button"
                  key={file.path}
                  className={[
                    activePath === file.path ? "active" : "",
                    viewedPaths.has(file.path) ? "viewed" : "",
                  ].filter(Boolean).join(" ")}
                  aria-label={`Open ${file.path}`}
                  title={file.path}
                  onClick={() => selectFile(file.path)}
                >
                  <span className="file-identity">
                    <strong>{path.name}</strong>
                    <span>{path.directory}</span>
                  </span>
                  <small className="file-changes">
                    {viewedPaths.has(file.path) && <CheckCircle2 className="file-viewed-mark" aria-hidden="true" size={13} />}
                    <b>+{file.additions}</b><i>−{file.deletions}</i>
                  </small>
                </button>
              );
            })}
          </nav>

          <MyCommentNavigation
            threads={userThreads}
            drafts={Object.values(lineCommentDrafts)}
            activeThreadId={focusedThreadId}
            replyMessages={threadReplies}
            dismissalReasons={dismissalReasons}
            onSelectThread={selectUserThread}
            onSelectDraft={selectDraft}
          />

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
          {!review.briefing && reviewing && <PrBriefingPending />}
          {review.briefing && (
            <PrBriefing
              briefing={review.briefing}
              people={pullRequestPeople(pullRequest)}
              reviewerLanguage={review.languages.reviewerNotes}
              collapsed={collapsedBriefings.includes(review.prUrl)}
              onCollapsedChange={setBriefingCollapsed}
            />
          )}
          <DiffPanel
            patch={session.patch}
            activePath={activePath}
            fileUrls={session.fileUrls}
            comments={comments}
            userThreads={userThreads}
            reviewerLanguage={review.languages.reviewerNotes}
            focusedCommentId={focusedCommentId}
            focusedThreadId={focusedThreadId}
            viewMode={viewMode}
            onViewModeChange={setViewMode}
            diffStyle={diffStyle}
            onDiffStyleChange={setDiffStyle}
            theme={resolvedTheme}
            loadFileContext={api.loadFileContext}
            viewedPaths={viewedPaths}
            onViewedChange={setFileViewed}
            drafts={Object.values(lineCommentDrafts)}
            onCreateDraft={createLineCommentDraft}
            onChangeDraft={changeLineCommentDraft}
            onRemoveDraft={removeLineCommentDraft}
            onSendDraft={(location) => void sendLineCommentDraft(location)}
            onAddComment={(location) => void addUserComment(location)}
            {...threadActions}
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
              reviewing ? <ReviewingStatus startedAt={reviewing.startedAt} /> : (
              <>
                <section className="review-summary">
                  <h2>Review summary</h2>
                  <MarkdownText>{review.summary}</MarkdownText>
                  <div className={`recommendation recommendation-${review.recommendation.toLowerCase()}`}>
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
              )
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
              <button
                className="revision-submit-button"
                type="button"
                disabled={session.agentPending}
                onClick={sendRevisionRequests}
              >
                <RotateCcw size={16} />
                {session.agentPending
                  ? "AI agent is responding"
                  : `${reviewing ? "Queue" : "Send"} ${pendingAgentRequests} request${pendingAgentRequests === 1 ? "" : "s"} ${reviewing ? "for AI" : "to AI agent"}`}
              </button>
            )}
            <button
              className="primary-button"
              type="button"
              disabled={pendingAgentRequests > 0 || Boolean(reviewing)}
              aria-describedby={reviewing ? "publish-unavailable" : undefined}
              onClick={() => {
                setActionError(null);
                setPublishOpen(true);
              }}
            >
              Review and publish
              <ArrowRight size={16} />
            </button>
            {reviewing && (
              <p id="publish-unavailable" className="publish-unavailable">Available when the AI finishes its review</p>
            )}
            <button className="cancel-button" type="button" onClick={cancel}>
              <X size={14} /> Cancel review
            </button>
          </footer>
        </aside>
      </div>

      <SettingsDialog
        open={settingsOpen}
        palette={palette}
        onOpenChange={setSettingsOpen}
        onPaletteChange={setPalette}
      />
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
      {updateNotice && <UpdateNoticeToast notice={updateNotice} onDismiss={dismissUpdateNotice} />}
    </div>
  );
}

export function buildPublishBody(summary: string, selectedComments: SessionSnapshot["review"]["comments"]): string {
  const general = selectedComments.filter((comment) => comment.type === "general");
  if (general.length === 0) return summary;
  const comments = `### General comments\n\n${general
    .map((comment) => `- ${comment.severity ? `**${capitalize(comment.severity)}:** ` : ""}${comment.body}`)
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

export function lineCommentDraftKey(location: LineCommentLocation): string {
  return `${location.path}:${location.side}:${location.line}`;
}

export function createUserThreadId(): string {
  return `U-${crypto.randomUUID()}`;
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

function withPath(paths: Set<string>, path: string, present: boolean): Set<string> {
  const next = new Set(paths);
  if (present) next.add(path);
  else next.delete(path);
  return next;
}

function withoutId(ids: Set<string>, id: string): Set<string> {
  if (!ids.has(id)) return ids;
  const next = new Set(ids);
  next.delete(id);
  return next;
}

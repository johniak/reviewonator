import { parsePatchFiles } from "@pierre/diffs";
import { buildFileUrl, type PullRequest } from "../domain/pull-request";
import type { PullRequestDiscussionItem } from "../domain/discussion";
import {
  publishRequestSchema,
  reviewDocumentSchema,
  revisionRequestSchema,
  validateReviewLocations,
  type PublishRequest,
  type ReviewDocument,
  type RevisionRequest,
} from "../domain/review";
import type { FileContext, FileRevision, GitHubGateway, PublishedReview } from "../github/client";

export type SessionResult =
  | {
      status: "revision_requested";
      selectedCommentIds: RevisionRequest["selectedCommentIds"];
      rejectedCommentIds: RevisionRequest["rejectedCommentIds"];
      requests: RevisionRequest["requests"];
      newThreads: RevisionRequest["newThreads"];
      threadReplies: RevisionRequest["threadReplies"];
      dismissedThreads: RevisionRequest["dismissedThreads"];
    }
  | { status: "published"; review: PublishedReview }
  | { status: "cancelled" };

export type AgentWaitResult =
  | (Extract<SessionResult, { status: "revision_requested" }> & { review: ReviewDocument })
  | Exclude<SessionResult, { status: "revision_requested" }>;

export class StalePullRequestError extends Error {}
export class ClosedSessionError extends Error {}

export class ReviewSession {
  private state: "open" | "publishing" | "closed" = "open";
  private currentReview: ReviewDocument;
  private readonly resultPromise: Promise<SessionResult>;
  private resolveResult!: (result: SessionResult) => void;
  private readonly fileRevisions = new Map<string, FileRevision>();
  private readonly fileContextCache = new Map<string, Promise<FileContext>>();
  private pendingAgentRequests: Extract<SessionResult, { status: "revision_requested" }>[] = [];
  private activeAgentRequest?: Extract<SessionResult, { status: "revision_requested" }>;
  private agentWaiters: ((result: AgentWaitResult) => void)[] = [];
  private changeVersion = 0;
  private changeWaiters: ((version: number | null) => void)[] = [];

  constructor(
    readonly pullRequest: PullRequest,
    readonly patch: string,
    review: ReviewDocument,
    private readonly github: GitHubGateway,
    readonly discussion: PullRequestDiscussionItem[] = [],
    readonly live = false,
  ) {
    this.currentReview = review;
    this.resultPromise = new Promise((resolve) => {
      this.resolveResult = resolve;
    });
    for (const file of parsePatchFiles(patch, "reviewonator-context", true).flatMap((item) => item.files)) {
      this.fileRevisions.set(file.name, {
        path: file.name,
        previousPath: file.prevName,
        oldObjectId: file.prevObjectId,
        newObjectId: file.newObjectId,
      });
    }
  }

  get review(): ReviewDocument {
    return this.currentReview;
  }

  get version(): number {
    return this.changeVersion;
  }

  get isOpen(): boolean {
    return this.state === "open";
  }

  snapshot() {
    return {
      pullRequest: this.pullRequest,
      patch: this.patch,
      review: this.review,
      live: this.live,
      version: this.version,
      agentPending: Boolean(this.activeAgentRequest || this.pendingAgentRequests.length),
      discussion: this.discussion,
      fileUrls: Object.fromEntries(
        this.pullRequest.files.map((file) => [file.path, buildFileUrl(this.pullRequest, file.path)]),
      ),
    };
  }

  requestRevision(input: unknown): void {
    this.assertOpen();
    if (this.live && (this.activeAgentRequest || this.pendingAgentRequests.length > 0)) {
      throw new Error("The AI agent is already working on the previous request.");
    }
    const request = revisionRequestSchema.parse(input);
    const knownIds = new Set(this.review.comments.map((comment) => comment.id));
    const threadsById = new Map(this.review.userThreads.map((thread) => [thread.id, thread]));
    const selectedCommentIds = [...new Set(request.selectedCommentIds)];
    const rejectedCommentIds = [...new Set(request.rejectedCommentIds)];
    const unknownIds = [
      ...request.requests.map(({ commentId }) => commentId),
      ...selectedCommentIds,
      ...rejectedCommentIds,
    ]
      .filter((id) => !knownIds.has(id));
    if (unknownIds.length > 0) {
      throw new Error(`Unknown review comment ids: ${unknownIds.join(", ")}`);
    }
    const duplicateThreadIds = request.newThreads
      .map(({ id }) => id)
      .filter((id) => threadsById.has(id));
    if (duplicateThreadIds.length > 0) {
      throw new Error(`User comment thread ids already exist: ${[...new Set(duplicateThreadIds)].join(", ")}`);
    }
    const unknownThreadIds = [
      ...request.threadReplies.map(({ threadId }) => threadId),
      ...request.dismissedThreads.map(({ threadId }) => threadId),
    ].filter((id) => !threadsById.has(id));
    if (unknownThreadIds.length > 0) {
      throw new Error(`Unknown user comment thread ids: ${[...new Set(unknownThreadIds)].join(", ")}`);
    }
    for (const { threadId } of request.threadReplies) {
      const thread = threadsById.get(threadId)!;
      if (thread.dismissed) throw new Error(`Cannot reply to dismissed user comment thread: ${threadId}`);
      if (thread.findingId) throw new Error(`Cannot reply to a user comment thread converted to a finding: ${threadId}`);
      if (thread.messages.at(-1)?.author !== "agent") {
        throw new Error(`Cannot reply before the agent responds to user comment thread: ${threadId}`);
      }
    }
    for (const { threadId } of request.dismissedThreads) {
      if (threadsById.get(threadId)!.dismissed) {
        throw new Error(`User comment thread is already dismissed: ${threadId}`);
      }
    }
    const unknownPaths = request.newThreads
      .map(({ path }) => path)
      .filter((path) => !this.fileRevisions.has(path));
    if (unknownPaths.length > 0) {
      throw new Error(`New user comment threads target files outside this pull request: ${[...new Set(unknownPaths)].join(", ")}`);
    }
    const result = {
      status: "revision_requested",
      selectedCommentIds,
      rejectedCommentIds,
      requests: request.requests,
      newThreads: request.newThreads,
      threadReplies: request.threadReplies,
      dismissedThreads: request.dismissedThreads,
    } as const;
    if (!this.live) {
      this.complete(result);
      return;
    }
    this.applyHumanRevision(result);
    this.pendingAgentRequests.push(result);
    this.releaseAgentWaiter();
    this.notifyChanged();
  }

  waitForAgentRequest(): Promise<AgentWaitResult> {
    if (this.state === "closed") {
      return this.resultPromise.then((result) => result.status === "revision_requested"
        ? this.agentResult(result)
        : result);
    }
    if (this.activeAgentRequest) return Promise.resolve(this.agentResult(this.activeAgentRequest));
    const next = this.pendingAgentRequests.shift();
    if (next) {
      this.activeAgentRequest = next;
      return Promise.resolve(this.agentResult(next));
    }
    return new Promise((resolve) => this.agentWaiters.push(resolve));
  }

  respond(input: unknown): void {
    this.assertOpen();
    if (!this.live) throw new Error("Agent responses require a live review session.");
    if (!this.activeAgentRequest) throw new Error("There is no user request waiting for an agent response.");
    const nextReview = reviewDocumentSchema.parse(input);
    validateReviewLocations(nextReview, this.patch);
    this.validateAgentResponse(nextReview);
    this.currentReview = nextReview;
    this.activeAgentRequest = undefined;
    this.notifyChanged();
    this.releaseAgentWaiter();
  }

  waitForChange(afterVersion: number): Promise<number | null> {
    if (this.changeVersion > afterVersion) return Promise.resolve(this.changeVersion);
    if (this.state === "closed") return Promise.resolve(null);
    return new Promise((resolve) => this.changeWaiters.push(resolve));
  }

  loadFileContext(path: string): Promise<FileContext> {
    const revision = this.fileRevisions.get(path);
    if (!revision) {
      throw new Error(`File is not part of this pull request: ${path}`);
    }
    const cached = this.fileContextCache.get(path);
    if (cached) return cached;
    const request = this.github.loadFileContext(this.pullRequest, revision);
    this.fileContextCache.set(path, request);
    request.catch(() => this.fileContextCache.delete(path));
    return request;
  }

  async publish(input: unknown): Promise<PublishedReview> {
    this.assertOpen();
    const request = publishRequestSchema.parse(input);
    const byId = new Map(this.review.comments.map((comment) => [comment.id, comment]));
    const selectedIds = [...new Set(request.selectedCommentIds)];
    const selectedComments = selectedIds.map((id) => {
      const comment = byId.get(id);
      if (!comment) {
        throw new Error(`Unknown review comment id: ${id}`);
      }
      return comment;
    });

    this.state = "publishing";
    try {
      const currentHead = await this.github.getHeadSha(this.pullRequest.url);
      if (currentHead !== this.pullRequest.headRefOid) {
        throw new StalePullRequestError(
          "The pull request changed after the review was generated. Run Reviewonator again before publishing.",
        );
      }
      const published = await this.github.publishReview(
        this.pullRequest,
        { ...request, selectedCommentIds: selectedIds },
        selectedComments,
      );
      this.complete({ status: "published", review: published });
      return published;
    } catch (error) {
      this.state = "open";
      throw error;
    }
  }

  cancel(): void {
    this.assertOpen();
    this.complete({ status: "cancelled" });
  }

  waitForResult(): Promise<SessionResult> {
    return this.resultPromise;
  }

  private assertOpen(): void {
    if (this.state !== "open") {
      throw new ClosedSessionError("This review session is no longer open.");
    }
  }

  private complete(result: SessionResult): void {
    this.state = "closed";
    this.resolveResult(result);
    const agentResult = result.status === "revision_requested" ? this.agentResult(result) : result;
    for (const resolve of this.agentWaiters.splice(0)) resolve(agentResult);
    for (const resolve of this.changeWaiters.splice(0)) resolve(null);
  }

  private applyHumanRevision(request: Extract<SessionResult, { status: "revision_requested" }>): void {
    const selected = new Set(request.selectedCommentIds);
    const rejected = new Set(request.rejectedCommentIds);
    const findingReplies = new Map(request.requests.map(({ commentId, message }) => [commentId, message]));
    const comments = this.review.comments.map((comment) => {
      const message = findingReplies.get(comment.id);
      return {
        ...comment,
        included: selected.has(comment.id) || undefined,
        rejected: rejected.has(comment.id) || undefined,
        discussion: message ? [
          ...(comment.discussion ?? []),
          { id: crypto.randomUUID(), author: "user" as const, body: message },
        ] : comment.discussion,
      };
    });
    const replies = new Map(request.threadReplies.map(({ threadId, message }) => [threadId, message]));
    const dismissals = new Map(request.dismissedThreads.map(({ threadId, reason }) => [threadId, reason]));
    const userThreads = this.review.userThreads.map((thread) => {
      const reply = replies.get(thread.id);
      const dismissalReason = dismissals.get(thread.id);
      if (reply) {
        return {
          ...thread,
          messages: [...thread.messages, { id: crypto.randomUUID(), author: "user" as const, body: reply }],
        };
      }
      if (dismissalReason) return { ...thread, dismissed: true, dismissalReason };
      return thread;
    });
    for (const thread of request.newThreads) {
      userThreads.push({
        id: thread.id,
        path: thread.path,
        line: thread.line,
        side: thread.side,
        messages: [{ id: crypto.randomUUID(), author: "user", body: thread.message }],
      });
    }
    this.currentReview = { ...this.review, comments, userThreads };
  }

  private validateAgentResponse(next: ReviewDocument): void {
    if (new URL(next.prUrl).href !== new URL(this.review.prUrl).href) {
      throw new Error("The agent response belongs to a different pull request.");
    }
    if (JSON.stringify(next.languages) !== JSON.stringify(this.review.languages)) {
      throw new Error("The agent cannot change review language settings during a live session.");
    }
    const nextComments = new Map(next.comments.map((comment) => [comment.id, comment]));
    const currentCommentIds = new Set(this.review.comments.map(({ id }) => id));
    const requestedCommentIds = new Set(this.activeAgentRequest!.requests.map(({ commentId }) => commentId));
    for (const comment of next.comments) {
      if (!currentCommentIds.has(comment.id) && (comment.included || comment.rejected)) {
        throw new Error(`New finding ${comment.id} must start pending.`);
      }
      if (!currentCommentIds.has(comment.id) && (comment.discussion?.length ?? 0) > 0) {
        throw new Error(`The agent cannot start a discussion on new finding ${comment.id}.`);
      }
    }
    for (const current of this.review.comments) {
      const updated = nextComments.get(current.id);
      if (!updated) {
        if (requestedCommentIds.has(current.id)) {
          throw new Error(`The agent cannot remove finding ${current.id} while responding to its discussion.`);
        }
        continue;
      }
      if (Boolean(updated.included) !== Boolean(current.included)
        || Boolean(updated.rejected) !== Boolean(current.rejected)) {
        throw new Error(`The agent cannot change the user's decision for finding ${current.id}.`);
      }
      const currentDiscussion = current.discussion ?? [];
      const updatedDiscussion = updated.discussion ?? [];
      for (const [index, message] of currentDiscussion.entries()) {
        if (JSON.stringify(updatedDiscussion[index]) !== JSON.stringify(message)) {
          throw new Error(`The agent cannot edit discussion history for finding ${current.id}.`);
        }
      }
      const additions = updatedDiscussion.slice(currentDiscussion.length);
      if (requestedCommentIds.has(current.id)) {
        if (additions.length !== 1 || additions[0]?.author !== "agent") {
          throw new Error(`The agent must add exactly one response to finding discussion ${current.id}.`);
        }
      } else if (additions.length > 0) {
        throw new Error(`Finding ${current.id} is not waiting for an agent response.`);
      }
    }
    const currentThreads = new Map(this.review.userThreads.map((thread) => [thread.id, thread]));
    const nextThreads = new Map(next.userThreads.map((thread) => [thread.id, thread]));
    const requestedThreadIds = new Set([
      ...this.activeAgentRequest!.newThreads.map(({ id }) => id),
      ...this.activeAgentRequest!.threadReplies.map(({ threadId }) => threadId),
    ]);
    for (const id of nextThreads.keys()) {
      if (!currentThreads.has(id)) throw new Error(`The agent cannot create user discussion thread ${id}.`);
    }
    for (const [id, current] of currentThreads) {
      const updated = nextThreads.get(id);
      if (!updated) throw new Error(`The agent cannot remove user discussion thread ${id}.`);
      if (updated.path !== current.path || updated.line !== current.line || updated.side !== current.side) {
        throw new Error(`The agent cannot move user discussion thread ${id}.`);
      }
      if (updated.dismissed !== current.dismissed || updated.dismissalReason !== current.dismissalReason) {
        throw new Error(`Only the user can dismiss discussion thread ${id}.`);
      }
      for (const [index, message] of current.messages.entries()) {
        if (JSON.stringify(updated.messages[index]) !== JSON.stringify(message)) {
          throw new Error(`The agent cannot edit discussion history in thread ${id}.`);
        }
      }
      const additions = updated.messages.slice(current.messages.length);
      const waitingForAgent = requestedThreadIds.has(id);
      if (waitingForAgent) {
        if (additions.length !== 1 || additions[0]?.author !== "agent") {
          throw new Error(`The agent must add exactly one response to discussion thread ${id}.`);
        }
      } else if (additions.length > 0) {
        throw new Error(`Discussion thread ${id} is not waiting for an agent response.`);
      }
      if (current.findingId && updated.findingId !== current.findingId) {
        throw new Error(`The agent cannot change the finding linked to discussion thread ${id}.`);
      }
      if (!current.findingId && updated.findingId && !waitingForAgent) {
        throw new Error(`The agent cannot link a finding to discussion thread ${id} without a user message.`);
      }
    }
  }

  private releaseAgentWaiter(): void {
    if (this.activeAgentRequest || this.pendingAgentRequests.length === 0 || this.agentWaiters.length === 0) return;
    this.activeAgentRequest = this.pendingAgentRequests.shift();
    const resolve = this.agentWaiters.shift();
    if (resolve && this.activeAgentRequest) resolve(this.agentResult(this.activeAgentRequest));
  }

  private agentResult(
    request: Extract<SessionResult, { status: "revision_requested" }>,
  ): Extract<AgentWaitResult, { status: "revision_requested" }> {
    return { ...request, review: this.review };
  }

  private notifyChanged(): void {
    this.changeVersion += 1;
    for (const resolve of this.changeWaiters.splice(0)) resolve(this.changeVersion);
  }
}

import { parsePatchFiles } from "@pierre/diffs";
import { buildFileUrl, type PullRequest } from "../domain/pull-request";
import type { PullRequestDiscussionItem } from "../domain/discussion";
import {
  publishRequestSchema,
  revisionRequestSchema,
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
      newComments: RevisionRequest["newComments"];
    }
  | { status: "published"; review: PublishedReview }
  | { status: "cancelled" };

export class StalePullRequestError extends Error {}
export class ClosedSessionError extends Error {}

export class ReviewSession {
  private state: "open" | "publishing" | "closed" = "open";
  private readonly resultPromise: Promise<SessionResult>;
  private resolveResult!: (result: SessionResult) => void;
  private readonly fileRevisions = new Map<string, FileRevision>();
  private readonly fileContextCache = new Map<string, Promise<FileContext>>();

  constructor(
    readonly pullRequest: PullRequest,
    readonly patch: string,
    readonly review: ReviewDocument,
    private readonly github: GitHubGateway,
    readonly discussion: PullRequestDiscussionItem[] = [],
  ) {
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

  snapshot() {
    return {
      pullRequest: this.pullRequest,
      patch: this.patch,
      review: this.review,
      discussion: this.discussion,
      fileUrls: Object.fromEntries(
        this.pullRequest.files.map((file) => [file.path, buildFileUrl(this.pullRequest, file.path)]),
      ),
    };
  }

  requestRevision(input: unknown): void {
    this.assertOpen();
    const request = revisionRequestSchema.parse(input);
    const knownIds = new Set(this.review.comments.map((comment) => comment.id));
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
    const unknownPaths = request.newComments
      .map(({ path }) => path)
      .filter((path) => !this.fileRevisions.has(path));
    if (unknownPaths.length > 0) {
      throw new Error(`New comments target files outside this pull request: ${[...new Set(unknownPaths)].join(", ")}`);
    }
    this.complete({
      status: "revision_requested",
      selectedCommentIds,
      rejectedCommentIds,
      requests: request.requests,
      newComments: request.newComments,
    });
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
  }
}

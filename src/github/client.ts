import { pullRequestSchema, parsePullRequestUrl, type PullRequest } from "../domain/pull-request";
import { parsePullRequestDiscussion, type PullRequestDiscussionItem } from "../domain/discussion";
import type { PublishRequest, ReviewComment } from "../domain/review";
import type { CommandRunner } from "../platform/command";

export type LoadedPullRequest = {
  pullRequest: PullRequest;
  patch: string;
  discussion: PullRequestDiscussionItem[];
};

export type PublishedReview = {
  id: number;
  url: string;
  state: string;
};

export type FileRevision = {
  path: string;
  previousPath?: string;
  oldObjectId?: string;
  newObjectId?: string;
};

export type FileContext = {
  oldContent: string | null;
  newContent: string | null;
};

export interface GitHubGateway {
  verifyPrerequisites(): Promise<void>;
  loadPullRequest(prUrl: string): Promise<LoadedPullRequest>;
  getHeadSha(prUrl: string): Promise<string>;
  loadFileContext(pr: PullRequest, revision: FileRevision): Promise<FileContext>;
  publishReview(
    pr: PullRequest,
    request: PublishRequest,
    comments: ReviewComment[],
  ): Promise<PublishedReview>;
}

export class GitHubClient implements GitHubGateway {
  constructor(private readonly runner: CommandRunner) {}

  async verifyPrerequisites(): Promise<void> {
    await this.runGh(["--version"], "GitHub CLI is required. Install it from https://cli.github.com/");
    await this.runGh(["auth", "status"], "GitHub CLI is not authenticated. Run: gh auth login");
  }

  async loadPullRequest(prUrl: string): Promise<LoadedPullRequest> {
    const repository = parsePullRequestUrl(prUrl);
    const fields = [
      "additions", "author", "baseRefName", "baseRefOid", "body", "changedFiles", "commits",
      "deletions", "files", "headRefName", "headRefOid", "number", "title", "url",
    ].join(",");
    const [metadata, patch, conversation, reviews, inline] = await Promise.all([
      this.runGh(["pr", "view", prUrl, "--json", fields], "Could not load pull request metadata."),
      this.runGh(["pr", "diff", prUrl, "--color", "never"], "Could not load the pull request diff."),
      this.loadDiscussionPage(
        `repos/${repository.owner}/${repository.name}/issues/${repository.number}/comments`,
        "Could not load pull request conversation comments.",
      ),
      this.loadDiscussionPage(
        `repos/${repository.owner}/${repository.name}/pulls/${repository.number}/reviews`,
        "Could not load existing pull request reviews.",
      ),
      this.loadDiscussionPage(
        `repos/${repository.owner}/${repository.name}/pulls/${repository.number}/comments`,
        "Could not load inline pull request comments.",
      ),
    ]);
    return {
      pullRequest: pullRequestSchema.parse(JSON.parse(metadata.stdout)),
      patch: patch.stdout,
      discussion: parsePullRequestDiscussion(conversation.stdout, reviews.stdout, inline.stdout),
    };
  }

  async getHeadSha(prUrl: string): Promise<string> {
    const result = await this.runGh(
      ["pr", "view", prUrl, "--json", "headRefOid", "--jq", ".headRefOid"],
      "Could not verify the latest pull request revision.",
    );
    return result.stdout.trim();
  }

  async loadFileContext(pr: PullRequest, revision: FileRevision): Promise<FileContext> {
    const repository = parsePullRequestUrl(pr.url);
    const [oldContent, newContent] = await Promise.all([
      this.loadFileVersion(
        repository,
        revision.oldObjectId,
        revision.previousPath ?? revision.path,
        pr.baseRefOid,
      ),
      this.loadFileVersion(repository, revision.newObjectId, revision.path, pr.headRefOid),
    ]);
    return { oldContent, newContent };
  }

  async publishReview(
    pr: PullRequest,
    request: PublishRequest,
    comments: ReviewComment[],
  ): Promise<PublishedReview> {
    const repository = parsePullRequestUrl(pr.url);
    const payload = {
      commit_id: pr.headRefOid,
      body: request.body,
      event: request.event,
      comments: comments
        .filter((comment) => comment.type === "line")
        .map((comment) => ({
          path: comment.path,
          line: comment.line,
          side: comment.side,
          body: comment.body,
        })),
    };
    const result = await this.runGh(
      [
        "api", "--method", "POST",
        `repos/${repository.owner}/${repository.name}/pulls/${pr.number}/reviews`,
        "--input", "-",
      ],
      "GitHub rejected the pull request review.",
      JSON.stringify(payload),
    );
    const response = JSON.parse(result.stdout) as { id: number; html_url: string; state: string };
    return { id: response.id, url: response.html_url, state: response.state };
  }

  private async runGh(args: string[], errorMessage: string, input?: string) {
    const result = await this.runner.run("gh", args, input);
    if (result.exitCode !== 0) {
      const detail = result.stderr.trim() || result.stdout.trim();
      throw new Error(`${errorMessage}${detail ? ` ${detail}` : ""}`);
    }
    return result;
  }

  private loadDiscussionPage(endpoint: string, errorMessage: string) {
    return this.runGh(["api", "--paginate", "--slurp", endpoint], errorMessage);
  }

  private async loadFileVersion(
    repository: { owner: string; name: string },
    objectId: string | undefined,
    path: string,
    ref: string,
  ): Promise<string | null> {
    if (!objectId || /^0+$/.test(objectId)) {
      return null;
    }

    if (/^[0-9a-f]{40}$/i.test(objectId)) {
      const blob = await this.runner.run("gh", [
        "api",
        "-H", "Accept: application/vnd.github.raw+json",
        "--cache", "1h",
        `repos/${repository.owner}/${repository.name}/git/blobs/${objectId}`,
      ]);
      if (blob.exitCode === 0) return validateTextFile(blob.stdout, path);
      if (!isNotFound(blob)) {
        throw new Error(`Could not load ${path} from GitHub. ${blob.stderr.trim()}`);
      }
    }

    const encodedPath = path.split("/").map(encodeURIComponent).join("/");
    const contents = await this.runner.run("gh", [
      "api",
      "-H", "Accept: application/vnd.github.raw+json",
      "--cache", "1h",
      `repos/${repository.owner}/${repository.name}/contents/${encodedPath}?ref=${encodeURIComponent(ref)}`,
    ]);
    if (contents.exitCode === 0) return validateTextFile(contents.stdout, path);
    if (isNotFound(contents)) return null;
    throw new Error(`Could not load ${path} from GitHub. ${contents.stderr.trim()}`);
  }
}

const maximumContextFileSize = 2 * 1024 * 1024;

function validateTextFile(contents: string, path: string): string {
  if (contents.includes("\0")) {
    throw new Error(`Surrounding context is unavailable for binary file ${path}.`);
  }
  if (new TextEncoder().encode(contents).byteLength > maximumContextFileSize) {
    throw new Error(`Surrounding context is limited to 2 MB per file (${path}).`);
  }
  return contents;
}

function isNotFound(result: { stdout: string; stderr: string }): boolean {
  return /HTTP 404|Not Found/i.test(`${result.stderr}\n${result.stdout}`);
}

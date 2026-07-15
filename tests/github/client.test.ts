import { describe, expect, it } from "vitest";
import { GitHubClient } from "../../src/github/client";
import type { CommandResult, CommandRunner } from "../../src/platform/command";
import { patch, pullRequest, review } from "../fixtures";

class RecordingRunner implements CommandRunner {
  readonly calls: Array<{ command: string; args: string[]; input?: string }> = [];

  constructor(private readonly results: CommandResult[]) {}

  async run(command: string, args: string[], input?: string): Promise<CommandResult> {
    this.calls.push({ command, args, input });
    const result = this.results.shift();
    if (!result) throw new Error("No command result was prepared for this call.");
    return result;
  }
}

const success = (stdout = ""): CommandResult => ({ stdout, stderr: "", exitCode: 0 });

describe("GitHubClient", () => {
  it("checks both the gh executable and authentication", async () => {
    const runner = new RecordingRunner([success(), success()]);
    await new GitHubClient(runner).verifyPrerequisites();
    expect(runner.calls).toEqual([
      { command: "gh", args: ["--version"], input: undefined },
      { command: "gh", args: ["auth", "status"], input: undefined },
    ]);
  });

  it("loads real PR fields and the complete patch through gh", async () => {
    const runner = new RecordingRunner([success(JSON.stringify(pullRequest)), success(patch)]);
    const loaded = await new GitHubClient(runner).loadPullRequest(pullRequest.url);
    expect(loaded).toEqual({ pullRequest, patch });
    expect(runner.calls[0].args.slice(0, 3)).toEqual(["pr", "view", pullRequest.url]);
    expect(runner.calls[1].args).toEqual(["pr", "diff", pullRequest.url, "--patch"]);
  });

  it("publishes one atomic GitHub review with selected inline comments", async () => {
    const runner = new RecordingRunner([
      success(JSON.stringify({ id: 99, html_url: "https://github.com/acme/widgets/pull/42#pullrequestreview-99", state: "CHANGES_REQUESTED" })),
    ]);
    const client = new GitHubClient(runner);
    const published = await client.publishReview(
      pullRequest,
      { confirmed: true, event: "REQUEST_CHANGES", body: review.summary, selectedCommentIds: ["S1"] },
      [review.comments[0]],
    );

    expect(published.id).toBe(99);
    expect(runner.calls[0].args).toEqual([
      "api", "--method", "POST", "repos/acme/widgets/pulls/42/reviews", "--input", "-",
    ]);
    const payload = JSON.parse(runner.calls[0].input!);
    expect(payload).toEqual({
      commit_id: "head-sha",
      body: review.summary,
      event: "REQUEST_CHANGES",
      comments: [{
        path: "src/example.ts",
        line: 2,
        side: "RIGHT",
        body: review.comments[0].body,
      }],
    });
    expect(JSON.stringify(payload)).not.toContain(review.comments[0].reviewerExplanation);
  });

  it("loads both exact blob versions without exposing an auth token", async () => {
    const runner = new RecordingRunner([success("old contents"), success("new contents")]);
    const context = await new GitHubClient(runner).loadFileContext(pullRequest, {
      path: "src/example.ts",
      oldObjectId: "1111111",
      newObjectId: "2222222",
    });

    expect(context).toEqual({ oldContent: "old contents", newContent: "new contents" });
    expect(runner.calls.map(({ args }) => args)).toEqual([
      [
        "api", "-H", "Accept: application/vnd.github.raw+json", "--cache", "1h",
        "repos/acme/widgets/git/blobs/1111111",
      ],
      [
        "api", "-H", "Accept: application/vnd.github.raw+json", "--cache", "1h",
        "repos/acme/widgets/git/blobs/2222222",
      ],
    ]);
    expect(runner.calls.flatMap(({ args }) => args)).not.toContain("auth");
  });

  it("surfaces gh stderr without hiding the actionable failure", async () => {
    const runner = new RecordingRunner([{ stdout: "", stderr: "not logged in", exitCode: 1 }]);
    await expect(new GitHubClient(runner).verifyPrerequisites()).rejects.toThrow(/not logged in/);
  });
});

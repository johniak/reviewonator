import { describe, expect, it } from "vitest";
import { GitHubClient } from "../../src/github/client";
import type { CommandResult, CommandRunner } from "../../src/platform/command";
import { discussion, patch, pullRequest, review } from "../fixtures";

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
    const runner = new RecordingRunner([
      success(JSON.stringify(pullRequest)),
      success(patch),
      success(JSON.stringify([[
        {
          id: 10,
          user: { login: "maintainer", avatar_url: "https://avatars.githubusercontent.com/u/1?v=4" },
          body: "Could we add a **regression test** for this?",
          created_at: "2026-07-14T12:20:00Z",
          html_url: `${pullRequest.url}#issuecomment-10`,
        },
      ]])),
      success(JSON.stringify([[
        {
          id: 11,
          user: { login: "reviewer", avatar_url: null },
          body: "The behavior still needs one correction.",
          state: "CHANGES_REQUESTED",
          submitted_at: "2026-07-14T12:25:00Z",
          html_url: `${pullRequest.url}#pullrequestreview-11`,
        },
      ]])),
      success(JSON.stringify([[
        {
          id: 12,
          user: { login: "reviewer", avatar_url: null },
          body: "This value should not be hard-coded.",
          created_at: "2026-07-14T12:26:00Z",
          html_url: `${pullRequest.url}#discussion_r12`,
          path: "src/example.ts",
          line: 2,
          original_line: 2,
          side: "RIGHT",
          original_side: "RIGHT",
          position: 1,
        },
      ]])),
    ]);
    const loaded = await new GitHubClient(runner).loadPullRequest(pullRequest.url);
    expect(loaded).toEqual({ pullRequest, patch, discussion });
    expect(runner.calls[0].args.slice(0, 3)).toEqual(["pr", "view", pullRequest.url]);
    expect(runner.calls[1].args).toEqual(["pr", "diff", pullRequest.url, "--color", "never"]);
    expect(runner.calls[1].args).not.toContain("--patch");
    expect(runner.calls.slice(2).map(({ args }) => args)).toEqual([
      ["api", "--paginate", "--slurp", "repos/acme/widgets/issues/42/comments"],
      ["api", "--paginate", "--slurp", "repos/acme/widgets/pulls/42/reviews"],
      ["api", "--paginate", "--slurp", "repos/acme/widgets/pulls/42/comments"],
    ]);
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

  it("keeps the GitHub review body empty when the optional user summary is empty", async () => {
    const runner = new RecordingRunner([
      success(JSON.stringify({ id: 100, html_url: "https://github.com/acme/widgets/pull/42#pullrequestreview-100", state: "CHANGES_REQUESTED" })),
    ]);

    await new GitHubClient(runner).publishReview(
      pullRequest,
      { confirmed: true, event: "REQUEST_CHANGES", body: "", selectedCommentIds: ["S1"] },
      [review.comments[0]],
    );

    expect(JSON.parse(runner.calls[0].input!).body).toBe("");
  });

  it("loads both exact blob versions without exposing an auth token", async () => {
    const runner = new RecordingRunner([success("old contents"), success("new contents")]);
    const context = await new GitHubClient(runner).loadFileContext(pullRequest, {
      path: "src/example.ts",
      oldObjectId: "1111111111111111111111111111111111111111",
      newObjectId: "2222222222222222222222222222222222222222",
    });

    expect(context).toEqual({ oldContent: "old contents", newContent: "new contents" });
    expect(runner.calls.map(({ args }) => args)).toEqual([
      [
        "api", "-H", "Accept: application/vnd.github.raw+json", "--cache", "1h",
        "repos/acme/widgets/git/blobs/1111111111111111111111111111111111111111",
      ],
      [
        "api", "-H", "Accept: application/vnd.github.raw+json", "--cache", "1h",
        "repos/acme/widgets/git/blobs/2222222222222222222222222222222222222222",
      ],
    ]);
    expect(runner.calls.flatMap(({ args }) => args)).not.toContain("auth");
  });

  it("loads abbreviated diff object ids through the contents endpoint", async () => {
    const runner = new RecordingRunner([success("old contents"), success("new contents")]);
    const context = await new GitHubClient(runner).loadFileContext(pullRequest, {
      path: "src/example file.ts",
      oldObjectId: "11111111111",
      newObjectId: "22222222222",
    });

    expect(context).toEqual({ oldContent: "old contents", newContent: "new contents" });
    expect(runner.calls.map(({ args }) => args)).toEqual([
      [
        "api", "-H", "Accept: application/vnd.github.raw+json", "--cache", "1h",
        "repos/acme/widgets/contents/src/example%20file.ts?ref=base-sha",
      ],
      [
        "api", "-H", "Accept: application/vnd.github.raw+json", "--cache", "1h",
        "repos/acme/widgets/contents/src/example%20file.ts?ref=head-sha",
      ],
    ]);
  });

  it("surfaces gh stderr without hiding the actionable failure", async () => {
    const runner = new RecordingRunner([{ stdout: "", stderr: "not logged in", exitCode: 1 }]);
    await expect(new GitHubClient(runner).verifyPrerequisites()).rejects.toThrow(/not logged in/);
  });
});

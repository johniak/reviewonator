import { parseArgs } from "node:util";
import favicon from "../web/favicon.svg" with { type: "text" };
import appHtml from "../web-dist/index.txt" with { type: "text" };
import { reviewDocumentSchema, validateReviewLocations } from "./domain/review";
import { GitHubClient } from "./github/client";
import { BunCommandRunner, openBrowser } from "./platform/command";
import { createApp } from "./server/app";
import { ReviewSession } from "./server/session";

const help = `Reviewonator — review a GitHub pull request visually

Usage:
  reviewonator <PR_URL> --review-file <PATH> [--no-open] [--port <PORT>]

Requirements:
  gh must be installed and authenticated.
`;

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    args: Bun.argv.slice(2),
    allowPositionals: true,
    options: {
      help: { type: "boolean", short: "h" },
      "review-file": { type: "string" },
      "no-open": { type: "boolean", default: false },
      port: { type: "string" },
    },
  });

  if (values.help) {
    process.stdout.write(help);
    return;
  }

  const prUrl = positionals[0];
  const reviewFile = values["review-file"];
  if (!prUrl || !reviewFile || positionals.length !== 1) {
    throw new Error(help);
  }

  const runner = new BunCommandRunner();
  const github = new GitHubClient(runner);
  await github.verifyPrerequisites();

  const review = reviewDocumentSchema.parse(await Bun.file(reviewFile).json());
  if (new URL(review.prUrl).href !== new URL(prUrl).href) {
    throw new Error("The review JSON belongs to a different pull request URL.");
  }

  const loaded = await github.loadPullRequest(prUrl);
  validateReviewLocations(review, loaded.patch);

  const session = new ReviewSession(loaded.pullRequest, loaded.patch, review, github);
  const token = crypto.randomUUID();
  const app = createApp({ html: appHtml, favicon, token, session });
  const requestedPort = values.port ? Number(values.port) : 0;
  if (!Number.isInteger(requestedPort) || requestedPort < 0 || requestedPort > 65_535) {
    throw new Error("--port must be an integer between 0 and 65535.");
  }
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: requestedPort,
    fetch: app.fetch,
  });
  const url = `http://127.0.0.1:${server.port}/#${token}`;
  process.stderr.write(`Reviewonator is ready at ${url}\n`);

  if (!values["no-open"]) {
    await openBrowser(url, runner);
  }

  const result = await session.waitForResult();
  await Bun.sleep(100);
  server.stop(true);
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});

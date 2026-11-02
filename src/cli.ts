import { parseArgs } from "node:util";
import packageJson from "../package.json" with { type: "json" };
import favicon from "../web/favicon.svg" with { type: "text" };
import appHtml from "../web-dist/index.txt" with { type: "text" };
import { reviewDocumentSchema, validateReviewLocations } from "./domain/review";
import { GitHubClient } from "./github/client";
import { BunCommandRunner, openBrowser } from "./platform/command";
import { createApp } from "./server/app";
import { ReviewSession } from "./server/session";
import { embeddedSkillFiles } from "./install/embedded-skill";
import { createStdinPrompter } from "./install/prompt";
import { runSetup } from "./install/setup";
import { detectInstallMethod } from "./install/install-method";
import { runUninstall } from "./install/uninstall";
import { GhReleaseSource } from "./update/releases";
import { runUpdate } from "./update/self-update";
import { UpdateChecker } from "./update/update-check";
import { skillUpdateHint, syncSkills, type SyncResult } from "./install/sync";
import type { ReviewDocument } from "./domain/review";
import {
  readLiveState,
  removeLiveState,
  writeLiveState,
  type LiveSessionState,
} from "./server/live-state";

const help = `Reviewonator — review a GitHub pull request visually

Usage:
  reviewonator <PR_URL> --review-file <PATH> [--live] [--no-open] [--port <PORT>]
  reviewonator wait <PR_URL>
  reviewonator respond <PR_URL> --review-file <PATH>
  reviewonator setup [--targets claude,codex] [--comment-language L] [--reviewer-language L] [--reconfigure]
                     [--claude-skill-dir DIR] [--codex-skill-dir DIR]
  reviewonator update [--force]
  reviewonator uninstall [--targets claude,codex]
  reviewonator --version

Requirements:
  gh must be installed and authenticated.
`;

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    args: Bun.argv.slice(2),
    allowPositionals: true,
    options: {
      help: { type: "boolean", short: "h" },
      version: { type: "boolean", short: "v" },
      "review-file": { type: "string" },
      live: { type: "boolean", default: false },
      "no-open": { type: "boolean", default: false },
      port: { type: "string" },
      targets: { type: "string" },
      "comment-language": { type: "string" },
      "reviewer-language": { type: "string" },
      "claude-skill-dir": { type: "string" },
      "skill-dir": { type: "string" },
      "codex-skill-dir": { type: "string" },
      reconfigure: { type: "boolean", default: false },
      force: { type: "boolean", default: false },
    },
  });

  if (values.help) {
    process.stdout.write(help);
    return;
  }

  if (values.version) {
    process.stdout.write(`Reviewonator ${packageJson.version}\n`);
    return;
  }

  if (positionals[0] === "setup") {
    if (positionals.length !== 1) throw new Error(help);
    const prompter = createStdinPrompter();
    try {
      await runSetup({
        targets: values.targets,
        commentLanguage: values["comment-language"],
        reviewerLanguage: values["reviewer-language"],
        claudeSkillDir: values["claude-skill-dir"] ?? values["skill-dir"],
        codexSkillDir: values["codex-skill-dir"],
        reconfigure: values.reconfigure,
      }, {
        env: process.env,
        files: embeddedSkillFiles,
        version: packageJson.version,
        interactive: Boolean(process.stdin.isTTY) || process.env.REVIEWONATOR_INTERACTIVE === "1",
        prompter,
        log: (line) => process.stdout.write(`${line}\n`),
      });
    } finally {
      prompter.close?.();
    }
    return;
  }

  if (positionals[0] === "update") {
    if (positionals.length !== 1) throw new Error(help);
    const runner = new BunCommandRunner();
    await runUpdate({ force: values.force }, {
      installMethod: await detectInstallMethod(process.execPath),
      runner,
      releases: new GhReleaseSource(runner),
      version: packageJson.version,
      env: process.env,
      log: (line) => process.stdout.write(`${line}\n`),
    });
    return;
  }

  if (positionals[0] === "uninstall") {
    if (positionals.length !== 1) throw new Error(help);
    await runUninstall({ targets: values.targets }, {
      env: process.env,
      installMethod: await detectInstallMethod(process.execPath),
      log: (line) => process.stdout.write(`${line}\n`),
    });
    return;
  }

  const sync = await syncInstalledSkills();

  if (positionals[0] === "wait") {
    if (!positionals[1] || positionals.length !== 2) throw new Error(help);
    await waitForLiveRequest(positionals[1]);
    return;
  }

  if (positionals[0] === "respond") {
    if (!positionals[1] || positionals.length !== 2 || !values["review-file"]) throw new Error(help);
    await respondToLiveRequest(positionals[1], values["review-file"], sync);
    return;
  }

  const prUrl = positionals[0];
  const reviewFile = values["review-file"];
  if (!prUrl || !reviewFile || positionals.length !== 1) {
    throw new Error(help);
  }

  if (values.live) await ensureNoActiveLiveSession(prUrl);

  const runner = new BunCommandRunner();
  // Only installs that `reviewonator update` can upgrade are offered an update.
  const updates = (await detectInstallMethod(process.execPath)).kind === "unmanaged"
    ? undefined
    : new UpdateChecker({ version: packageJson.version, env: process.env, releases: new GhReleaseSource(runner) });
  updates?.start();
  const github = new GitHubClient(runner);
  await github.verifyPrerequisites();

  const review = await readReviewFile(reviewFile, sync);
  if (new URL(review.prUrl).href !== new URL(prUrl).href) {
    throw new Error("The review JSON belongs to a different pull request URL.");
  }

  const loaded = await github.loadPullRequest(prUrl);
  validateReviewLocations(review, loaded.patch);

  const session = new ReviewSession(loaded.pullRequest, loaded.patch, review, github, loaded.discussion, values.live, loaded.viewedFiles);
  const token = crypto.randomUUID();
  const app = createApp({ html: appHtml, favicon, token, session, updates });
  const requestedPort = values.port ? Number(values.port) : 0;
  if (!Number.isInteger(requestedPort) || requestedPort < 0 || requestedPort > 65_535) {
    throw new Error("--port must be an integer between 0 and 65535.");
  }
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: requestedPort,
    idleTimeout: 0,
    fetch: app.fetch,
  });
  const url = `http://127.0.0.1:${server.port}/#${token}`;
  process.stderr.write(`Reviewonator is ready at ${url}\n`);

  let liveState: LiveSessionState | undefined;
  if (values.live) {
    liveState = {
      prUrl,
      baseUrl: `http://127.0.0.1:${server.port}`,
      token,
      pid: process.pid,
      startedAt: new Date().toISOString(),
    };
    await writeLiveState(liveState);
    process.stderr.write(`Live discussion is active for ${new URL(prUrl).href}\n`);
  }

  if (!values["no-open"]) {
    await openBrowser(url, runner);
  }

  const result = await session.waitForResult();
  updates?.stop();
  if (liveState && result.status !== "revision_requested") await writeLiveState({ ...liveState, result });
  await Bun.sleep(100);
  server.stop(true);
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

/** Refreshes managed skills after an upgrade; development runs never touch installed skills. */
async function syncInstalledSkills(): Promise<SyncResult | null> {
  const method = await detectInstallMethod(process.execPath);
  if (method.kind === "unmanaged") return null;
  const result = await syncSkills({ env: process.env, files: embeddedSkillFiles, version: packageJson.version });
  for (const warning of result.warnings) process.stderr.write(`${warning}\n`);
  return result;
}

async function readReviewFile(path: string, sync: SyncResult | null): Promise<ReviewDocument> {
  try {
    return reviewDocumentSchema.parse(await Bun.file(path).json());
  } catch (error) {
    const hint = sync && skillUpdateHint(sync);
    if (!hint) throw error;
    throw new Error(`${error instanceof Error ? error.message : String(error)}\n${hint}`);
  }
}

async function waitForLiveRequest(prUrl: string): Promise<void> {
  const state = await readLiveState(prUrl);
  if (state.result) {
    process.stdout.write(`${JSON.stringify(state.result)}\n`);
    await removeLiveState(prUrl);
    return;
  }
  await assertLiveServerReachable(state);
  const result = await liveRequest(state, "/api/agent/wait", undefined, "wait");
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (isFinalResult(result)) await removeLiveState(prUrl);
}

async function respondToLiveRequest(prUrl: string, reviewFile: string, sync: SyncResult | null): Promise<void> {
  const state = await readLiveState(prUrl);
  if (state.result) throw new Error("This live Reviewonator session has already finished.");
  await assertLiveServerReachable(state);
  const review = await readReviewFile(reviewFile, sync);
  if (new URL(review.prUrl).href !== new URL(prUrl).href) {
    throw new Error("The review JSON belongs to a different pull request URL.");
  }
  const result = await liveRequest(state, "/api/agent/respond", {
    method: "POST",
    body: JSON.stringify(review),
  }, "respond");
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

async function liveRequest(
  state: LiveSessionState,
  path: string,
  init?: RequestInit,
  operation = "request",
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(new URL(path, state.baseUrl), {
      ...init,
      headers: {
        authorization: `Bearer ${state.token}`,
        "content-type": "application/json",
        ...init?.headers,
      },
    });
  } catch {
    const retry = operation === "wait"
      ? `reviewonator wait ${state.prUrl}`
      : `the reviewonator ${operation} command for ${state.prUrl}`;
    throw new Error(
      `The live session was reachable, but the ${operation} connection ended unexpectedly. `
      + `Retry ${retry}.`,
    );
  }
  const payload = await response.json() as { error?: string };
  if (!response.ok) throw new Error(payload.error ?? "The live Reviewonator request failed.");
  return payload;
}

async function assertLiveServerReachable(state: LiveSessionState): Promise<void> {
  try {
    const response = await fetch(new URL("/health", state.baseUrl), { signal: AbortSignal.timeout(1_000) });
    if (response.ok) return;
  } catch {
    // Report the saved process as unavailable below.
  }
  throw new Error(
    `No running Reviewonator server was found for ${state.prUrl}. `
    + "The saved live session is stale; start the review again.",
  );
}

function isFinalResult(result: unknown): boolean {
  return typeof result === "object"
    && result !== null
    && "status" in result
    && (result.status === "published" || result.status === "cancelled");
}

async function ensureNoActiveLiveSession(prUrl: string): Promise<void> {
  let state: LiveSessionState;
  try {
    state = await readLiveState(prUrl);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("No live Reviewonator session")) return;
    throw error;
  }
  if (state.result) {
    throw new Error(`A completed live session is waiting for the agent. Run reviewonator wait ${prUrl} first.`);
  }
  try {
    const response = await fetch(new URL("/health", state.baseUrl), { signal: AbortSignal.timeout(1_000) });
    if (response.ok) throw new Error(`A live Reviewonator session is already open for ${prUrl}.`);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("A live Reviewonator session is already open")) {
      throw error;
    }
  }
  await removeLiveState(prUrl);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});

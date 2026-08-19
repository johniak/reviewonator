import { createHash } from "node:crypto";
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { SessionResult } from "./session";

export type LiveSessionState = {
  prUrl: string;
  baseUrl: string;
  token: string;
  pid: number;
  startedAt: string;
  result?: Exclude<SessionResult, { status: "revision_requested" }>;
};

export function liveStateDirectory(env: NodeJS.ProcessEnv = process.env): string {
  if (env.REVIEWONATOR_STATE_DIR) return env.REVIEWONATOR_STATE_DIR;
  return join(env.XDG_STATE_HOME ?? join(homedir(), ".local", "state"), "reviewonator");
}

export function liveStatePath(prUrl: string, env: NodeJS.ProcessEnv = process.env): string {
  const normalized = normalizePrUrl(prUrl);
  const key = createHash("sha256").update(normalized).digest("hex").slice(0, 24);
  return join(liveStateDirectory(env), `${key}.json`);
}

export async function writeLiveState(
  state: LiveSessionState,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const directory = liveStateDirectory(env);
  const destination = liveStatePath(state.prUrl, env);
  const temporary = `${destination}.${process.pid}.tmp`;
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  await writeFile(temporary, `${JSON.stringify(state)}\n`, { mode: 0o600 });
  await chmod(temporary, 0o600);
  await rename(temporary, destination);
}

export async function readLiveState(
  prUrl: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<LiveSessionState> {
  const path = liveStatePath(prUrl, env);
  try {
    const state = JSON.parse(await readFile(path, "utf8")) as LiveSessionState;
    if (normalizePrUrl(state.prUrl) !== normalizePrUrl(prUrl)) {
      throw new Error("The saved live session belongs to a different pull request.");
    }
    return state;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      throw new Error(`No live Reviewonator session was found for ${prUrl}.`);
    }
    throw error;
  }
}

function normalizePrUrl(prUrl: string): string {
  return new URL(prUrl).href.replace(/\/$/, "");
}

export async function removeLiveState(
  prUrl: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  await rm(liveStatePath(prUrl, env), { force: true });
}

import { z } from "zod";

const authorSchema = z.object({ login: z.string() }).passthrough();

export const pullRequestSchema = z.object({
  additions: z.number(),
  author: authorSchema,
  baseRefName: z.string(),
  baseRefOid: z.string(),
  body: z.string(),
  changedFiles: z.number(),
  commits: z.array(z.object({
    oid: z.string(),
    messageHeadline: z.string(),
    committedDate: z.string(),
    authors: z.array(authorSchema).default([]),
  }).passthrough()),
  deletions: z.number(),
  files: z.array(z.object({
    path: z.string(),
    additions: z.number(),
    deletions: z.number(),
  }).passthrough()),
  headRefName: z.string(),
  headRefOid: z.string(),
  number: z.number(),
  title: z.string(),
  url: z.url(),
}).passthrough();

export type PullRequest = z.infer<typeof pullRequestSchema>;

export type GitHubRepository = {
  owner: string;
  name: string;
};

export function parsePullRequestUrl(prUrl: string): GitHubRepository & { number: number } {
  const url = new URL(prUrl);
  const match = url.pathname.match(/^\/([^/]+)\/([^/]+)\/pull\/(\d+)\/?$/);
  if (url.hostname !== "github.com" || !match) {
    throw new Error("Expected a URL in the form https://github.com/owner/repository/pull/123");
  }
  return { owner: match[1], name: match[2], number: Number(match[3]) };
}

export function buildFileUrl(pr: PullRequest, path: string): string {
  const repository = parsePullRequestUrl(pr.url);
  const encodedPath = path.split("/").map(encodeURIComponent).join("/");
  return `https://github.com/${repository.owner}/${repository.name}/blob/${pr.headRefOid}/${encodedPath}`;
}

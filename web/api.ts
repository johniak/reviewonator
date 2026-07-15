import type { PublishRequest, RevisionRequest } from "../src/domain/review";
import type { FileContext } from "../src/github/client";
import type { SessionSnapshot } from "./types";

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

function sessionToken(): string {
  const token = window.location.hash.slice(1);
  if (!token) {
    throw new Error("This Reviewonator link is missing its session token.");
  }
  return token;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      authorization: `Bearer ${sessionToken()}`,
      "content-type": "application/json",
      ...init?.headers,
    },
  });
  const payload = await response.json() as { error?: string } & T;
  if (!response.ok) {
    throw new ApiError(payload.error ?? "Reviewonator request failed.", response.status);
  }
  return payload;
}

export const api = {
  loadSession: () => request<SessionSnapshot>("/api/session"),
  loadFileContext: (path: string) => request<FileContext>(`/api/file-context?path=${encodeURIComponent(path)}`),
  requestRevision: (input: RevisionRequest) => request<{ status: string }>("/api/revision", {
    method: "POST",
    body: JSON.stringify(input),
  }),
  publish: (input: PublishRequest) => request<{ status: string; review: { url: string } }>("/api/publish", {
    method: "POST",
    body: JSON.stringify(input),
  }),
  cancel: () => request<{ status: string }>("/api/cancel", { method: "POST", body: "{}" }),
};

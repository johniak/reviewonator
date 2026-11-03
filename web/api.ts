import type { PreferenceChange, Preferences } from "../src/domain/preferences";
import type { CommentEdit, PublishRequest, RevisionRequest, UserCommentInput } from "../src/domain/review";
import type { FileContext } from "../src/github/client";
import type { UpdateNotice } from "../src/domain/update";
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
  requestRevision: (input: RevisionRequest) => request<{ status: string; session: SessionSnapshot }>("/api/revision", {
    method: "POST",
    body: JSON.stringify(input),
  }),
  addComment: (input: UserCommentInput) => request<{ session: SessionSnapshot }>("/api/comments", {
    method: "POST",
    body: JSON.stringify(input),
  }),
  editComment: (id: string, edit: CommentEdit) => request<{ session: SessionSnapshot }>(
    `/api/comments/${encodeURIComponent(id)}`,
    { method: "PATCH", body: JSON.stringify(edit) },
  ),
  deleteComment: (id: string) => request<{ session: SessionSnapshot }>(
    `/api/comments/${encodeURIComponent(id)}`,
    { method: "DELETE" },
  ),
  setFileViewed: (path: string, viewed: boolean) => request<{ viewedFiles: string[] }>("/api/viewed-files", {
    method: "POST",
    body: JSON.stringify({ path, viewed }),
  }),
  publish: (input: PublishRequest) => request<{ status: string; review: { url: string } }>("/api/publish", {
    method: "POST",
    body: JSON.stringify(input),
  }),
  cancel: () => request<{ status: string }>("/api/cancel", { method: "POST", body: "{}" }),
  savePreferences: (change: PreferenceChange) => request<{ preferences: Preferences }>("/api/preferences", {
    method: "POST",
    body: JSON.stringify(change),
  }),
  loadUpdateNotice: () => request<{ notice: UpdateNotice | null }>("/api/update-notice"),
  dismissUpdateNotice: (version: string) => request<{ status: string }>("/api/update-notice/dismiss", {
    method: "POST",
    body: JSON.stringify({ version }),
  }),
  subscribeToSession: (onUpdate: () => void, onError: () => void) => {
    const events = new EventSource(`/api/events?token=${encodeURIComponent(sessionToken())}`);
    events.addEventListener("session", onUpdate);
    events.onerror = onError;
    return () => events.close();
  },
};

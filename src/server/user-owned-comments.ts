import type { ReviewComment } from "../domain/review";

/** A comment the user wrote or edited; the user's version wins unless they discussed it this round. */
export function isUserOwned(comment: ReviewComment): boolean {
  return comment.author === "user" || comment.edited === true;
}

/**
 * Brings the agent's raw response in line with the user's state before it is validated, so the
 * agent never gets an error for a user-owned field it could not have known about, and can never
 * loosen its own findings by claiming they were written by the user.
 */
export function reconcileAgentInput(
  input: unknown,
  current: ReviewComment[],
  discussedIds: Set<string>,
  deletedUserIds: Set<string>,
): unknown {
  if (!isRecord(input) || !Array.isArray(input.comments)) return input;
  const currentById = new Map(current.map((comment) => [comment.id, comment]));
  const comments = input.comments
    .filter((comment) => !(isRecord(comment) && typeof comment.id === "string" && deletedUserIds.has(comment.id)))
    .map((comment) => {
      if (!isRecord(comment) || typeof comment.id !== "string") return comment;
      const existing = currentById.get(comment.id);
      if (!existing) return comment;
      if (isUserOwned(existing) && !discussedIds.has(existing.id)) return existing;
      const { author: _author, edited: _edited, ...content } = comment;
      return {
        ...content,
        ...(existing.author ? { author: existing.author } : {}),
        ...(existing.edited ? { edited: true } : {}),
        ...(existing.author === "user"
          ? { type: existing.type, path: existing.path, line: existing.line, side: existing.side }
          : {}),
      };
    });
  return { ...input, comments };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Applies the agent's comments to the session's current ones. The agent never sees changes the user
 * makes while it works, so the user's state is authoritative: user-owned comments the user did not
 * discuss stay as they are, the ones the agent left out come back, and deleted ones stay deleted.
 */
export function mergeAgentComments(
  current: ReviewComment[],
  next: ReviewComment[],
  discussedIds: Set<string>,
  deletedUserIds: Set<string>,
): ReviewComment[] {
  const currentById = new Map(current.map((comment) => [comment.id, comment]));
  const merged: ReviewComment[] = [];
  for (const proposed of next) {
    if (deletedUserIds.has(proposed.id)) continue;
    const existing = currentById.get(proposed.id);
    if (!existing) {
      if (proposed.author === "user") {
        throw new Error(`The agent cannot create comment ${proposed.id} as written by the user.`);
      }
      if (proposed.edited) throw new Error(`Only the user can mark comment ${proposed.id} as edited.`);
      merged.push(proposed);
    } else if (isUserOwned(existing) && !discussedIds.has(existing.id)) {
      merged.push(existing);
    } else {
      merged.push(withOwnership(proposed, existing));
    }
  }
  const mergedIds = new Set(merged.map(({ id }) => id));
  return [...merged, ...current.filter((comment) => isUserOwned(comment) && !mergedIds.has(comment.id))];
}

function withOwnership(proposed: ReviewComment, existing: ReviewComment): ReviewComment {
  const { author: _author, edited: _edited, ...content } = proposed;
  const owned: ReviewComment = {
    ...content,
    ...(existing.author ? { author: existing.author } : {}),
    ...(existing.edited ? { edited: true } : {}),
  };
  if (existing.author !== "user") return owned;
  return { ...owned, type: existing.type, path: existing.path, line: existing.line, side: existing.side };
}

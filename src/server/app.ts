import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { z, ZodError } from "zod";
import { defaultPreferences, preferenceChangeSchema, type Preferences, type PreferenceStore } from "../domain/preferences";
import type { UpdateNoticeSource } from "../domain/update";
import { ClosedSessionError, CommentChangeError, ReviewSession, StalePullRequestError } from "./session";

type AppDependencies = {
  html: string;
  favicon: string;
  token: string;
  session: ReviewSession;
  updates?: UpdateNoticeSource;
  preferences?: PreferenceStore;
};

const dismissalSchema = z.object({ version: z.string().min(1) });
const deliverySchema = z.object({ review: z.unknown(), final: z.boolean() });
const preferencesElement = /(<script id="reviewonator-preferences" type="application\/json">)[^<]*(<\/script>)/;

/** Fills the placeholder in index.html so the page can apply the saved theme before its first paint. */
function withPreferences(html: string, preferences: Preferences): string {
  const json = JSON.stringify(preferences).replace(/</g, "\\u003c");
  return html.replace(preferencesElement, (_match, open: string, close: string) => `${open}${json}${close}`);
}

export function createApp({ html, favicon, token, session, updates, preferences }: AppDependencies): Hono {
  const app = new Hono();

  app.get("/", async (context) => context.html(withPreferences(html, (await preferences?.read()) ?? defaultPreferences)));
  app.get("/favicon.svg", (context) => context.body(favicon, 200, { "content-type": "image/svg+xml" }));
  app.get("/health", (context) => context.json({ status: "ok" }));

  app.get("/api/events", (context) => {
    if (context.req.query("token") !== token) return context.json({ error: "Unauthorized" }, 401);
    return streamSSE(context, async (stream) => {
      let version = session.version;
      await stream.writeSSE({ event: "ready", data: String(version) });
      while (session.isOpen) {
        const nextVersion = await session.waitForChange(version);
        if (nextVersion === null) break;
        version = nextVersion;
        await stream.writeSSE({ event: "session", data: String(version) });
      }
    });
  });

  app.use("/api/*", async (context, next) => {
    if (context.req.header("authorization") !== `Bearer ${token}`) {
      return context.json({ error: "Unauthorized" }, 401);
    }
    await next();
  });

  app.get("/api/session", (context) => context.json(session.snapshot()));

  app.get("/api/update-notice", async (context) => context.json({ notice: (await updates?.notice()) ?? null }));

  app.post("/api/update-notice/dismiss", async (context) => {
    const { version } = dismissalSchema.parse(await context.req.json());
    await updates?.dismiss(version);
    return context.json({ status: "dismissed" });
  });

  app.post("/api/preferences", async (context) => {
    const change = preferenceChangeSchema.parse(await context.req.json());
    const saved = preferences ? await preferences.update(change) : { ...defaultPreferences, ...change };
    return context.json({ preferences: saved });
  });

  app.get("/api/file-context", async (context) => {
    const path = context.req.query("path");
    if (!path) return context.json({ error: "Missing file path" }, 400);
    return context.json(await session.loadFileContext(path));
  });

  app.post("/api/viewed-files", async (context) => {
    return context.json({ viewedFiles: await session.setFileViewed(await context.req.json()) });
  });

  app.post("/api/revision", async (context) => {
    session.requestRevision(await context.req.json());
    return context.json({ status: "revision_requested", session: session.snapshot() });
  });

  app.post("/api/comments", async (context) => {
    session.addUserComment(await context.req.json());
    return context.json({ session: session.snapshot() });
  });

  app.patch("/api/comments/:id", async (context) => {
    session.editComment(context.req.param("id"), await context.req.json());
    return context.json({ session: session.snapshot() });
  });

  app.delete("/api/comments/:id", (context) => {
    session.deleteUserComment(context.req.param("id"));
    return context.json({ session: session.snapshot() });
  });

  app.get("/api/agent/wait", async (context) => context.json(await session.waitForAgentRequest()));

  app.post("/api/agent/respond", async (context) => {
    session.respond(await context.req.json());
    return context.json({ status: "accepted" });
  });

  app.post("/api/agent/deliver", async (context) => {
    const { review, final } = deliverySchema.parse(await context.req.json());
    session.deliver(review, final);
    return context.json({ status: "accepted" });
  });

  app.post("/api/publish", async (context) => {
    const review = await session.publish(await context.req.json());
    return context.json({ status: "published", review });
  });

  app.post("/api/cancel", (context) => {
    session.cancel();
    return context.json({ status: "cancelled" });
  });

  app.onError((error, context) => {
    if (error instanceof ZodError) {
      return context.json({ error: "Invalid request", details: error.issues }, 400);
    }
    if (error instanceof StalePullRequestError) {
      return context.json({ error: error.message }, 409);
    }
    if (error instanceof CommentChangeError) {
      return context.json({ error: error.message }, 400);
    }
    if (error instanceof ClosedSessionError) {
      return context.json({ error: error.message }, 410);
    }
    console.error(error);
    return context.json({ error: error instanceof Error ? error.message : "Unexpected error" }, 500);
  });

  return app;
}

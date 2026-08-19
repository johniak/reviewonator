import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { ZodError } from "zod";
import { ClosedSessionError, ReviewSession, StalePullRequestError } from "./session";

type AppDependencies = {
  html: string;
  favicon: string;
  token: string;
  session: ReviewSession;
};

export function createApp({ html, favicon, token, session }: AppDependencies): Hono {
  const app = new Hono();

  app.get("/", (context) => context.html(html));
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

  app.get("/api/file-context", async (context) => {
    const path = context.req.query("path");
    if (!path) return context.json({ error: "Missing file path" }, 400);
    return context.json(await session.loadFileContext(path));
  });

  app.post("/api/revision", async (context) => {
    session.requestRevision(await context.req.json());
    return context.json({ status: "revision_requested", session: session.snapshot() });
  });

  app.get("/api/agent/wait", async (context) => context.json(await session.waitForAgentRequest()));

  app.post("/api/agent/respond", async (context) => {
    session.respond(await context.req.json());
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
    if (error instanceof ClosedSessionError) {
      return context.json({ error: error.message }, 410);
    }
    console.error(error);
    return context.json({ error: error instanceof Error ? error.message : "Unexpected error" }, 500);
  });

  return app;
}

import { readFileSync } from "node:fs";
import type { Hono } from "hono";

export const indexHtml = readFileSync("web/index.html", "utf8");

/** Loads `/` from the real server and keeps the preferences it embeds, as the browser would. */
export async function openPage(serverApp: Hono): Promise<void> {
  closePage();
  const page = new DOMParser().parseFromString(await (await serverApp.request("/")).text(), "text/html");
  const preferences = page.getElementById("reviewonator-preferences");
  if (!preferences) throw new Error("The served page has no preferences element.");
  document.head.append(preferences);
}

export function closePage(): void {
  document.getElementById("reviewonator-preferences")?.remove();
}

/** Runs the inline script that applies the theme before the first paint. */
export function runFirstPaintScript(): void {
  const source = indexHtml.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  if (!source) throw new Error("web/index.html has no first-paint script.");
  new Function(source)();
}

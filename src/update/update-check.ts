import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { UpdateNotice, UpdateNoticeSource } from "../domain/update";
import { compareVersions } from "../install/version";
import { liveStateDirectory } from "../server/live-state";
import { releaseUrl, type ReleaseSource } from "./releases";

export type UpdateCheckContext = {
  version: string;
  env: NodeJS.ProcessEnv;
  releases: Pick<ReleaseSource, "latestVersion">;
  now?: () => Date;
  timeoutMs?: number;
};

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const cacheSchema = z.object({
  checkedAt: z.string(),
  latestVersion: z.string(),
  dismissedVersion: z.string().optional(),
});
type UpdateCache = z.infer<typeof cacheSchema>;

/** Looks up the latest release in the background; every failure stays silent. */
export class UpdateChecker implements UpdateNoticeSource {
  private pending: Promise<void> | null = null;
  private latest: string | null = null;
  private dismissed: string | undefined;

  constructor(private readonly context: UpdateCheckContext) {}

  private get disabled(): boolean {
    return this.context.env.REVIEWONATOR_NO_UPDATE_CHECK === "1";
  }

  private get cachePath(): string {
    return join(liveStateDirectory(this.context.env), "update-check.json");
  }

  private now(): Date {
    return this.context.now?.() ?? new Date();
  }

  start(): void {
    if (this.disabled || this.pending) return;
    this.pending = this.check().catch(() => {});
  }

  async notice(waitMs = 3_000): Promise<UpdateNotice | null> {
    if (this.disabled) return null;
    this.start();
    await raceTimeout(this.pending!, waitMs);
    const { latest, dismissed } = this;
    const current = this.context.version;
    try {
      if (!latest || latest === dismissed || compareVersions(latest, current) <= 0) return null;
    } catch {
      return null;
    }
    return { current, latest, releaseUrl: releaseUrl(latest) };
  }

  async dismiss(version: string): Promise<void> {
    this.dismissed = version;
    try {
      const cache = await this.readCache();
      await this.writeCache({
        checkedAt: cache?.checkedAt ?? new Date(0).toISOString(),
        latestVersion: cache?.latestVersion ?? this.latest ?? version,
        dismissedVersion: version,
      });
    } catch {
      // Dismissal still applies for this run when the state directory is not writable.
    }
  }

  private async check(): Promise<void> {
    const cache = await this.readCache();
    this.dismissed ??= cache?.dismissedVersion;
    if (cache) this.latest = cache.latestVersion;
    if (cache && this.now().getTime() - Date.parse(cache.checkedAt) < CACHE_TTL_MS) return;
    const latest = await raceTimeout(this.context.releases.latestVersion(), this.context.timeoutMs ?? 5_000);
    if (!latest) return;
    this.latest = latest;
    await this.writeCache({
      checkedAt: this.now().toISOString(),
      latestVersion: latest,
      ...(this.dismissed ? { dismissedVersion: this.dismissed } : {}),
    });
  }

  private async readCache(): Promise<UpdateCache | null> {
    try {
      return cacheSchema.parse(JSON.parse(await readFile(this.cachePath, "utf8")));
    } catch {
      return null;
    }
  }

  private async writeCache(cache: UpdateCache): Promise<void> {
    const directory = liveStateDirectory(this.context.env);
    const temporary = `${this.cachePath}.${process.pid}.tmp`;
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await writeFile(temporary, `${JSON.stringify(cache)}\n`, { mode: 0o600 });
    await chmod(temporary, 0o600);
    await rename(temporary, this.cachePath);
  }
}

async function raceTimeout<T>(promise: Promise<T>, milliseconds: number): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), milliseconds);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

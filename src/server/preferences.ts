import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseSavedPreferences, type PreferenceChange, type Preferences, type PreferenceStore } from "../domain/preferences";
import { liveStateDirectory } from "./live-state";

/**
 * Keeps UI choices in the state directory. The browser cannot keep them: every run serves the page
 * from a new port, so it is a new origin with empty localStorage.
 */
export class FilePreferenceStore implements PreferenceStore {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly env: NodeJS.ProcessEnv = process.env) {}

  private get path(): string {
    return join(liveStateDirectory(this.env), "preferences.json");
  }

  async read(): Promise<Preferences> {
    try {
      return parseSavedPreferences(JSON.parse(await readFile(this.path, "utf8")));
    } catch {
      return parseSavedPreferences({});
    }
  }

  update(change: PreferenceChange): Promise<Preferences> {
    const result = this.queue.then(() => this.write(change));
    this.queue = result.catch(() => {});
    return result;
  }

  private async write(change: PreferenceChange): Promise<Preferences> {
    const next = { ...(await this.read()), ...change };
    const temporary = `${this.path}.${process.pid}.tmp`;
    await mkdir(liveStateDirectory(this.env), { recursive: true, mode: 0o700 });
    await writeFile(temporary, `${JSON.stringify(next)}\n`, { mode: 0o600 });
    await rename(temporary, this.path);
    return next;
  }
}

import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Returns the body of the `## <version>` section of CHANGELOG.md, which becomes the GitHub release notes. */
export function releaseNotes(changelog: string, version: string): string {
  const lines = changelog.split("\n");
  const start = lines.findIndex((line) => line.match(/^## (\S+)/)?.[1] === version);
  if (start === -1) throw new Error(`CHANGELOG.md has no section for ${version}.`);
  const end = lines.findIndex((line, index) => index > start && line.startsWith("## "));
  const notes = lines.slice(start + 1, end === -1 ? undefined : end).join("\n").trim();
  if (!notes) throw new Error(`The CHANGELOG.md section for ${version} is empty.`);
  return `${notes}\n`;
}

if (import.meta.main) {
  const version = (process.argv[2] ?? "").replace(/^v/, "");
  try {
    process.stdout.write(releaseNotes(readFileSync(join(import.meta.dir, "..", "CHANGELOG.md"), "utf8"), version));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

import { access, realpath } from "node:fs/promises";

export type InstallMethod = { kind: "homebrew" | "script" | "unmanaged"; executablePath: string };

export async function detectInstallMethod(executablePath: string): Promise<InstallMethod> {
  const resolved = await realpath(executablePath).catch(() => executablePath);
  if (resolved.includes("/Cellar/reviewonator/")) return { kind: "homebrew", executablePath: resolved };
  for (const path of new Set([executablePath, resolved])) {
    if (await exists(`${path}.reviewonator-managed`)) return { kind: "script", executablePath: path };
  }
  return { kind: "unmanaged", executablePath };
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

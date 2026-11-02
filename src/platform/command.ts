export type CommandResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

/** `signal` kills the command; `inheritOutput` streams it to the terminal and returns empty output. */
export type RunOptions = { signal?: AbortSignal; inheritOutput?: boolean };

export interface CommandRunner {
  run(command: string, args: string[], input?: string, options?: RunOptions): Promise<CommandResult>;
}

export class BunCommandRunner implements CommandRunner {
  async run(command: string, args: string[], input?: string, options: RunOptions = {}): Promise<CommandResult> {
    const output = options.inheritOutput ? "inherit" : "pipe";
    const process = Bun.spawn([command, ...args], {
      stdin: input === undefined ? "ignore" : new Blob([input]),
      stdout: output,
      stderr: output,
      signal: options.signal,
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      process.stdout ? new Response(process.stdout).text() : "",
      process.stderr ? new Response(process.stderr).text() : "",
      process.exited,
    ]);
    return { stdout, stderr, exitCode };
  }
}

export async function openBrowser(url: string, runner: CommandRunner): Promise<void> {
  const platform = process.platform;
  const [command, args] = platform === "darwin"
    ? ["open", [url]]
    : platform === "win32"
      ? ["cmd", ["/c", "start", "", url]]
      : ["xdg-open", [url]];
  const result = await runner.run(command, args);
  if (result.exitCode !== 0) {
    throw new Error(`Could not open the browser: ${result.stderr.trim()}`);
  }
}

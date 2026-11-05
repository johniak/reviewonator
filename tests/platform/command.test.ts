// @vitest-environment node
import { spawn } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

async function runWithInput(script: string, input: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "reviewonator-command-"));
  const path = join(directory, "run.ts");
  await writeFile(path, `import { BunCommandRunner } from ${JSON.stringify(resolve("src/platform/command.ts"))};\n${script}`);
  const child = spawn("bun", [path], { stdio: ["pipe", "pipe", "inherit"] });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stdin.end(input);
  await new Promise((done) => child.on("close", done));
  return output;
}

describe("BunCommandRunner", () => {
  it("gives a command with inherited output the terminal's input too, so it can ask questions", async () => {
    const output = await runWithInput(
      `await new BunCommandRunner().run("sh", ["-c", "read answer; echo \\"answer: $answer\\""], undefined, { inheritOutput: true });`,
      "early\n",
    );

    expect(output).toBe("answer: early\n");
  });

  it("keeps the input closed for a command whose output is captured", async () => {
    const output = await runWithInput(
      `const result = await new BunCommandRunner().run("sh", ["-c", "read answer; echo \\"answer: $answer\\""]);\nprocess.stdout.write(result.stdout);`,
      "early\n",
    );

    expect(output).toBe("answer: \n");
  });
});

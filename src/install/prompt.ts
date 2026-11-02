import { createInterface } from "node:readline";

export interface Prompter {
  ask(question: string): Promise<string>;
  close?(): void;
}

export function createStdinPrompter(): Prompter {
  let lines: AsyncIterator<string> | undefined;
  let close = () => {};
  return {
    async ask(question) {
      if (!lines) {
        const reader = createInterface({ input: process.stdin, terminal: false });
        lines = reader[Symbol.asyncIterator]();
        close = () => reader.close();
      }
      process.stderr.write(question);
      const next = await lines.next();
      return next.done ? "" : next.value.trim();
    },
    close: () => close(),
  };
}

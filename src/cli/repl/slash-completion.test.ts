import { afterEach, describe, expect, test } from "bun:test";
import { attachSlashCompletion, type KeypressEvent } from "./slash-completion";
import type { CompletionEntry } from "./slash-commands";

type FakeReadline = {
  line: string;
  cursor: number;
  _refreshLine: () => void;
};

const entries: CompletionEntry[] = [
  { text: "/help", description: "Show available commands" },
  { text: "/pipeline", description: "Manage pipelines" },
  { text: "/providers", description: "Manage providers" },
];

const flushMicrotasks = () => new Promise<void>((resolve) => queueMicrotask(resolve));

describe("Slash Completion", () => {
  const originalWrite = process.stdout.write.bind(process.stdout);

  afterEach(() => {
    (process.stdout.write as unknown as typeof originalWrite) = originalWrite;
  });

  test("clears the menu before re-rendering on normal typing", async () => {
    const writes: string[] = [];
    (process.stdout.write as unknown as (chunk: string) => boolean) = ((chunk: string) => {
      writes.push(chunk);
      return true;
    }) as unknown as typeof originalWrite;

    const rl: FakeReadline = {
      line: "/",
      cursor: 1,
      _refreshLine: () => {},
    };

    const completion = attachSlashCompletion(rl as never, entries);

    // First keypress renders the menu for "/"
    const initialConsumed = completion.handleKeypress("/", { name: "/", sequence: "/" });
    await flushMicrotasks();

    expect(initialConsumed).toBe(false);
    expect(writes.join("")).toContain("/help");

    // Second keypress should clear the existing menu before rebuilding it.
    rl.line = "/p";
    rl.cursor = 2;

    const nextConsumed = completion.handleKeypress("p", { name: "p", sequence: "p" });
    await flushMicrotasks();

    expect(nextConsumed).toBe(false);
    const output = writes.join("");
    expect(output).toContain("\x1b[2K");
    expect(output).toContain("/pipeline");

    completion.destroy();
  });

  test("tab accepts the selected completion", async () => {
    (process.stdout.write as unknown as (chunk: string) => boolean) = (() => true) as unknown as typeof originalWrite;

    const rl: FakeReadline = {
      line: "/",
      cursor: 1,
      _refreshLine: () => {},
    };

    const completion = attachSlashCompletion(rl as never, entries);
    completion.handleKeypress("/", { name: "/", sequence: "/" } satisfies KeypressEvent);
    await flushMicrotasks();

    const consumed = completion.handleKeypress("\t", { name: "tab", sequence: "\t" });

    expect(consumed).toBe(true);
    expect(rl.line).toBe("/help");
    expect(rl.cursor).toBe("/help".length);

    completion.destroy();
  });
});

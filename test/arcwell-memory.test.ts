import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  createMemoryHandlers,
  MAX_WORKLOG_BYTES,
  registerMemoryHandlers,
  WORKLOG_TEMPLATE,
} from "../extensions/arcwell-memory.js";

const temporaryRoot = join(process.cwd(), ".tmp-tests");
mkdirSync(temporaryRoot, { recursive: true });

const scratch = (): string => mkdtempSync(join(temporaryRoot, "memory-"));

test("a worklog is created from the template once and reopened afterwards", () => {
  const root = scratch();
  try {
    const handlers = createMemoryHandlers(root);
    const first = handlers.openWorklog("/sessions/project/2026-09-01_abc.jsonl");
    assert.equal(first.created, true);
    assert.equal(first.content, WORKLOG_TEMPLATE);
    assert.match(first.path, /worklog\/2026-09-01_abc\.md$/);

    writeFileSync(first.path, "# Worklog\n\n## Open\n- finish the loop\n");
    const second = handlers.openWorklog("/sessions/project/2026-09-01_abc.jsonl");
    assert.equal(second.created, false);
    assert.match(second.content, /finish the loop/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("each session gets its own worklog and an ephemeral session still gets one", () => {
  const root = scratch();
  try {
    const handlers = createMemoryHandlers(root);
    assert.notEqual(handlers.worklogPath("/a/one.jsonl"), handlers.worklogPath("/a/two.jsonl"));
    assert.match(handlers.worklogPath(undefined), /worklog\/ephemeral\.md$/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("compaction restores the worklog, and refuses a truncated one", () => {
  const root = scratch();
  try {
    const handlers = createMemoryHandlers(root);
    const session = "/sessions/p/s.jsonl";
    assert.equal(handlers.restoreAfterCompaction(session), undefined, "nothing to restore yet");

    handlers.openWorklog(session);
    writeFileSync(handlers.worklogPath(session), "## Open\n- the one thing that matters\n");
    const restored = handlers.restoreAfterCompaction(session);
    assert.match(restored?.content ?? "", /the one thing that matters/);

    // Half a worklog reads as complete and is worse than none, so an oversized file is
    // reported as absent rather than truncated.
    writeFileSync(handlers.worklogPath(session), "x".repeat(MAX_WORKLOG_BYTES + 1));
    assert.equal(handlers.restoreAfterCompaction(session), undefined);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("lessons accumulate under one dated heading and reject an empty entry", () => {
  const root = scratch();
  try {
    const handlers = createMemoryHandlers(root);
    const day = new Date("2026-09-01T10:00:00Z");

    assert.deepEqual(handlers.recordLesson("   ", day), {
      error: "Usage: /lesson <what went wrong, and what to do instead>",
    });

    handlers.recordLesson("pi auth check reports ready for a provider that returns 400", day);
    handlers.recordLesson("a colon-space in a YAML description drops the skill", day);
    handlers.recordLesson("later thought", new Date("2026-09-02T10:00:00Z"));

    const text = readFileSync(handlers.lessonsPath(), "utf8");
    assert.equal(text.match(/## 2026-09-01/g)?.length, 1, "one heading per day");
    assert.match(text, /- pi auth check reports ready/);
    assert.match(text, /- a colon-space in a YAML description/);
    assert.match(text, /## 2026-09-02/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("registration wires both commands and re-injects on compaction", async () => {
  const root = scratch();
  try {
    const handlers = createMemoryHandlers(root);
    const commands = new Map<string, (args: string, ctx: unknown) => Promise<void>>();
    const events = new Map<string, (event: unknown, ctx: unknown) => void>();
    const sent: Array<{ customType: string; content: string }> = [];
    const notices: string[] = [];

    const pi = {
      registerCommand: (name: string, options: { handler: (args: string, ctx: unknown) => Promise<void> }) =>
        commands.set(name, options.handler),
      on: (event: string, handler: (event: unknown, ctx: unknown) => void) => events.set(event, handler),
      sendMessage: (message: { customType: string; content: string }) => sent.push(message),
    };
    registerMemoryHandlers(pi as never, handlers);

    const ctx = {
      sessionManager: { getSessionFile: () => "/sessions/p/live.jsonl" },
      ui: { notify: (message: string) => notices.push(message) },
    };

    assert.deepEqual([...commands.keys()].sort(), ["lesson", "worklog"]);
    await commands.get("worklog")!("", ctx);
    assert.match(notices.at(-1) ?? "", /Worklog created at/);

    writeFileSync(handlers.worklogPath("/sessions/p/live.jsonl"), "## Open\n- resume here\n");
    events.get("session_compact")!({ type: "session_compact" }, ctx);
    assert.equal(sent.length, 1);
    assert.equal(sent[0]?.customType, "arcwell-worklog");
    assert.match(sent[0]?.content ?? "", /resume here/);

    await commands.get("lesson")!("write it down", ctx);
    assert.match(readFileSync(handlers.lessonsPath(), "utf8"), /- write it down/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

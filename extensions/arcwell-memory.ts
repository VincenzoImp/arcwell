/**
 * Arcwell memory: what the system remembers, at two horizons.
 *
 * Worklog, per session: the goal, the plan, decisions taken and work still open, kept in a
 * file rather than in the conversation. Compaction summarises what was said; it cannot
 * summarise what was never said, so a worklog outside the context survives it intact and is
 * re-injected the moment compaction lands.
 *
 * Lessons, across sessions: what went wrong in a way worth not repeating.
 *
 * Why re-injection rather than custom compaction instructions: Pi hands
 * `customInstructions` to the hook as a value and then reads its own local variable
 * (core/agent-session.js), so an extension cannot extend them. `SessionBeforeCompactResult`
 * offers only `cancel` and a complete replacement summary, and producing that costs a model
 * call on every compaction. Re-injection costs none.
 *
 * The worklog is an ordinary markdown file: the agent reads and writes it with the tools it
 * already has. This extension supplies only what those tools cannot — surviving compaction,
 * and the two commands.
 */

import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { resolveArcwellAgentDir } from "../src/setup/agent-dir.js";
import { writeFileAtomic } from "../src/setup/atomic-file.js";

/** Past this size a worklog has stopped being an index, and re-injecting it would cost more
 * context than the summary it supplements. */
export const MAX_WORKLOG_BYTES = 32 * 1024;
export const MAX_LESSONS_BYTES = 64 * 1024;

export const WORKLOG_TEMPLATE = `# Worklog

## Goal

## Decisions

## Open

## Verified / assumed
`;

export interface MemoryHandlers {
  worklogPath(sessionFile?: string): string;
  lessonsPath(): string;
  /** Reads the worklog, creating it from the template when absent. */
  openWorklog(sessionFile?: string): { path: string; content: string; created: boolean };
  recordLesson(text: string, now: Date): { path: string } | { error: string };
  /** The content to put back after compaction, or undefined when there is nothing to restore. */
  restoreAfterCompaction(sessionFile?: string): { path: string; content: string } | undefined;
}

/** Reads at most `limit` bytes. A file past the limit is treated as absent rather than
 * truncated: half a worklog is worse than none, because it reads as complete. */
function readBounded(path: string, limit: number): string | undefined {
  if (!existsSync(path)) return undefined;
  const text = readFileSync(path, "utf8");
  return Buffer.byteLength(text) > limit ? undefined : text;
}

export function createMemoryHandlers(arcwellDir: string): MemoryHandlers {
  const write = (path: string, content: string, description: string): void => {
    writeFileAtomic(path, content, { targetDescription: description, defaultMode: 0o600 });
  };

  // Named after the session file so a resumed session finds its own worklog; an ephemeral
  // session (--no-session) still gets one stable place to write.
  const worklogPath = (sessionFile?: string): string => {
    const name = sessionFile ? basename(sessionFile).replace(/\.jsonl$/, "") : "ephemeral";
    return join(arcwellDir, "worklog", `${name}.md`);
  };
  const lessonsPath = (): string => join(arcwellDir, "lessons.md");

  return {
    worklogPath,
    lessonsPath,

    openWorklog(sessionFile) {
      const path = worklogPath(sessionFile);
      const existing = readBounded(path, MAX_WORKLOG_BYTES);
      if (existing !== undefined) return { path, content: existing, created: false };
      write(path, WORKLOG_TEMPLATE, "worklog");
      return { path, content: WORKLOG_TEMPLATE, created: true };
    },

    recordLesson(text, now) {
      const lesson = text.trim();
      if (!lesson) return { error: "Usage: /lesson <what went wrong, and what to do instead>" };
      const path = lessonsPath();
      const existing = readBounded(path, MAX_LESSONS_BYTES) ?? "# Lessons\n";
      const day = now.toISOString().slice(0, 10);
      const heading = existing.includes(`## ${day}`) ? "" : `\n## ${day}\n`;
      write(path, `${existing.trimEnd()}\n${heading}\n- ${lesson}\n`, "lessons");
      return { path };
    },

    restoreAfterCompaction(sessionFile) {
      const path = worklogPath(sessionFile);
      const content = readBounded(path, MAX_WORKLOG_BYTES);
      return content === undefined ? undefined : { path, content };
    },
  };
}

/**
 * The slice of Pi's context this file uses. Every member is required, so passing a real
 * `ExtensionContext` at each call site is itself the compatibility check: if `getSessionFile`
 * is renamed or dropped upstream, the build fails. Declared optional it would keep compiling
 * and every session would quietly share the `ephemeral` worklog.
 */
interface MemoryContext {
  sessionManager: { getSessionFile(): string | undefined };
  ui: { notify(message: string, type?: "info" | "warning" | "error"): void };
}

const sessionFileOf = (ctx: MemoryContext): string | undefined => ctx.sessionManager.getSessionFile();

export function registerMemoryHandlers(pi: ExtensionAPI, handlers: MemoryHandlers): void {
  pi.registerCommand("worklog", {
    description: "Show this session's worklog and its path",
    handler: async (_args, ctx) => {
      const { path, content, created } = handlers.openWorklog(sessionFileOf(ctx));
      ctx.ui.notify(created ? `Worklog created at ${path}` : `${path}\n\n${content}`, "info");
    },
  });

  pi.registerCommand("lesson", {
    description: "Append a lesson worth not repeating to arcwell/lessons.md",
    handler: async (args, ctx) => {
      const result = handlers.recordLesson(args, new Date());
      if ("error" in result) ctx.ui.notify(result.error, "warning");
      else ctx.ui.notify(`Recorded in ${result.path}`, "info");
    },
  });

  // The whole point of this file: compaction has just replaced the conversation with a
  // summary, so put the durable state back before the next turn reasons without it.
  pi.on("session_compact", (_event, ctx) => {
    const restored = handlers.restoreAfterCompaction(sessionFileOf(ctx));
    if (!restored) return;
    pi.sendMessage(
      {
        customType: "arcwell-worklog",
        content:
          `Worklog restored after compaction, from ${restored.path}. This is the durable state ` +
          `of the work; the conversation above is a summary.\n\n${restored.content}`,
        display: true,
      },
      { deliverAs: "nextTurn" },
    );
  });
}

export default function (pi: ExtensionAPI): void {
  registerMemoryHandlers(pi, createMemoryHandlers(join(resolveArcwellAgentDir(), "arcwell")));
}

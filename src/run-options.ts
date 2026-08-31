import { statSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

import { sanitizeDiagnostic } from "./diagnostic.js";
import type { CommandIo } from "./commands/types.js";

export interface ParsedRunOptions {
  goal: string;
  cwd: string;
  json: boolean;
  persist: boolean;
}

export function parseRunOptions(
  argv: string[],
  io: CommandIo,
  command: string,
  allowPersist = false,
): ParsedRunOptions | undefined {
  let values: { goal?: string; cwd?: string; json?: boolean; persist?: boolean };
  try {
    values = parseArgs({
      args: argv,
      allowPositionals: false,
      strict: true,
      options: {
        goal: { type: "string" },
        cwd: { type: "string", default: "." },
        json: { type: "boolean", default: false },
        ...(allowPersist ? { persist: { type: "boolean" as const, default: false } } : {}),
      },
    }).values as unknown as { goal?: string; cwd?: string; json?: boolean; persist?: boolean };
  } catch (error) {
    io.stderr(`arcwell: ${sanitizeDiagnostic(error)}\n`);
    return undefined;
  }
  const goal = values.goal?.trim();
  if (!goal) {
    io.stderr(`arcwell: ${command}: --goal must be non-empty\n`);
    return undefined;
  }
  const cwd = resolve(values.cwd ?? ".");
  try {
    if (!statSync(cwd).isDirectory()) throw new Error("not a directory");
  } catch {
    io.stderr(`arcwell: ${command}: --cwd must name an existing directory\n`);
    return undefined;
  }
  return { goal, cwd, json: values.json ?? false, persist: values.persist ?? false };
}

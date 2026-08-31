import { createInterface } from "node:readline/promises";
import type { Readable, Writable } from "node:stream";

import { createDefaultManifest } from "./manifest.js";
import { createSetupPlan } from "./plan.js";
import type { ModuleName, ProtectionName, SetupManifest } from "./types.js";

export interface SetupWizardIo {
  question(prompt: string, signal?: AbortSignal): Promise<string | undefined>;
  write(text: string): void;
}

export interface CloseableSetupWizardIo extends SetupWizardIo {
  close(): void;
}

export interface RunSetupWizardOptions {
  confirm?: boolean;
}

type Answer = boolean | "cancel";

const cancelAnswers = new Set(["cancel", "c", "quit", "q", "exit"]);

function normalized(answer: string): string {
  return answer.trim().toLowerCase();
}

async function ask(
  io: SetupWizardIo,
  prompt: string,
  allowed: ReadonlyMap<string, string>,
  defaultValue: string,
  signal?: AbortSignal,
): Promise<string | undefined> {
  while (!signal?.aborted) {
    const answer = await io.question(prompt, signal);
    if (answer === undefined || signal?.aborted) return undefined;
    const value = normalized(answer);
    if (cancelAnswers.has(value)) return undefined;
    if (value === "") return defaultValue;
    const selected = allowed.get(value);
    if (selected !== undefined) return selected;
    io.write("Please enter one of the displayed choices, or 'cancel'.\n");
  }
  return undefined;
}

async function askYesNo(
  io: SetupWizardIo,
  prompt: string,
  defaultValue: boolean,
  signal?: AbortSignal,
): Promise<Answer> {
  const answer = await ask(io, prompt, new Map([
    ["y", "yes"],
    ["yes", "yes"],
    ["true", "yes"],
    ["on", "yes"],
    ["n", "no"],
    ["no", "no"],
    ["false", "no"],
    ["off", "no"],
  ]), defaultValue ? "yes" : "no", signal);
  if (answer === undefined) return "cancel";
  return answer === "yes";
}

function setModules(manifest: SetupManifest, names: readonly ModuleName[], enabled: boolean): void {
  for (const name of names) manifest.modules[name] = enabled;
}

export function renderSetupPlan(manifest: SetupManifest, io: Pick<SetupWizardIo, "write">): void {
  const plan = createSetupPlan(manifest);
  io.write("\nExact manifest:\n");
  io.write(`${JSON.stringify(manifest, null, 2)}\n`);
  io.write(`Exact setup plan (${plan.manifestDigest.slice(0, 12)}):\n`);
  for (const operation of plan.operations) {
    io.write(`- ${operation.id} [${operation.kind}]: ${operation.description}\n`);
    if (operation.source) io.write(`  source: ${operation.source}\n`);
    if (operation.destination) io.write(`  destination: ${operation.destination}\n`);
  }

  io.write("Effects: installs the listed exact packages, merges the marked agreement block, and writes Arcwell config.\n");
  io.write("Network: applying package installs through Pi may access the npm registry");
  io.write(manifest.modules.web ? "; the selected web module permits network access during use.\n" : "; no web module is selected.\n");
  io.write("Warning: Web and MCP integrations may use network access and configured credentials when invoked.\n");
  io.write("Warning: Subagents and autonomous workflows invoke additional paid model calls when selected and used.\n");
  io.write("Listeners: Arcwell setup opens no listener; selected MCP integrations may use configured transports only when invoked.\n");
  const processImplications = ["applying invokes the Pi package process"];
  if (manifest.modules.subagents) processImplications.push("subagents may start child agent processes during use");
  if (manifest.modules.autonomousWorkflows) processImplications.push("autonomous workflows may run package-owned goal processes during use");
  io.write(`Processes: ${processImplications.join("; ")}.\n`);
  for (const note of plan.notes) io.write(`Note: ${note}\n`);
  for (const warning of plan.warnings) io.write(`Warning: ${warning}\n`);
}

async function confirmManifest(
  io: SetupWizardIo,
  manifest: SetupManifest,
  signal?: AbortSignal,
): Promise<SetupManifest | undefined> {
  renderSetupPlan(manifest, io);
  const confirmed = await askYesNo(io, "Apply this exact plan? [y/N] ", false, signal);
  return confirmed === true && !signal?.aborted ? manifest : undefined;
}

export async function runSetupWizard(
  io: SetupWizardIo,
  initialManifest?: SetupManifest,
  signal?: AbortSignal,
  options: RunSetupWizardOptions = {},
): Promise<SetupManifest | undefined> {
  if (signal?.aborted) return undefined;
  const shouldConfirm = options.confirm ?? true;
  if (initialManifest) return shouldConfirm ? confirmManifest(io, initialManifest, signal) : initialManifest;

  const manifest = createDefaultManifest();
  io.write("Arcwell interactive setup. Enter 'cancel' at any prompt to stop without applying.\n");
  const posture = await ask(
    io,
    "Posture: Guarded (recommended) or Host? [G/h] ",
    new Map([["g", "guarded"], ["guarded", "guarded"], ["h", "host"], ["host", "host"]]),
    "guarded",
    signal,
  );
  if (posture === undefined) return undefined;
  manifest.posture = posture as SetupManifest["posture"];

  if (manifest.posture === "host") {
    manifest.protections = { effects: false, secrets: false, redaction: false };
  } else {
    const protectionQuestions: ReadonlyArray<[ProtectionName, string]> = [
      ["effects", "Enable effects approval protection? [Y/n] "],
      ["secrets", "Enable secret-path protection? [Y/n] "],
      ["redaction", "Enable redaction protection? [Y/n] "],
    ];
    for (const [name, prompt] of protectionQuestions) {
      const enabled = await askYesNo(io, prompt, true, signal);
      if (enabled === "cancel") return undefined;
      manifest.protections[name] = enabled;
    }
  }

  const coreModules: readonly ModuleName[] = ["lsp", "context", "todo", "questionnaire", "planMode", "mcp"];
  const core = await askYesNo(
    io,
    "Use recommended Core modules (LSP, context, todo, questionnaire, plan mode, MCP)? [Y/n] ",
    true,
    signal,
  );
  if (core === "cancel") return undefined;
  setModules(manifest, coreModules, core);

  const advanced = await askYesNo(io, "Open Advanced module choices? [y/N] ", false, signal);
  if (advanced === "cancel") return undefined;
  if (advanced) {
    const advancedQuestions: ReadonlyArray<[ModuleName, string]> = [
      ["web", "Enable web access? [y/N] "],
      ["subagents", "Enable subagents? [y/N] "],
      ["autonomousWorkflows", "Enable autonomous workflows? [y/N] "],
    ];
    for (const [name, prompt] of advancedQuestions) {
      const enabled = await askYesNo(io, prompt, false, signal);
      if (enabled === "cancel") return undefined;
      manifest.modules[name] = enabled;
    }
  }

  return shouldConfirm ? confirmManifest(io, manifest, signal) : manifest;
}

export function createReadlineWizardIo(
  input: Readable = process.stdin,
  output: Writable = process.stdout,
): CloseableSetupWizardIo {
  const readline = createInterface({ input, output });
  const closed = new Promise<undefined>((resolve) => readline.once("close", () => resolve(undefined)));
  return {
    async question(prompt, signal) {
      try {
        const answer = signal
          ? readline.question(prompt, { signal })
          : readline.question(prompt);
        return await Promise.race([answer, closed]);
      } catch (error) {
        const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
        const name = error instanceof Error ? error.name : "";
        if (signal?.aborted || name === "AbortError" || code === "ABORT_ERR" || code === "ERR_USE_AFTER_CLOSE") {
          return undefined;
        }
        throw error;
      }
    },
    write: (text) => output.write(text),
    close: () => readline.close(),
  };
}

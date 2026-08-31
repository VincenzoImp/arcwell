#!/usr/bin/env node

import { handleConfigurationCommand } from "./commands/configuration.js";
import type { CommandIo } from "./commands/types.js";
import { handleWorkflowCommand } from "./commands/workflow.js";
import { sanitizeDiagnostic } from "./diagnostic.js";
import { handleSetupCommand } from "./setup/cli.js";
import { handleDoctorCommand } from "./setup/doctor.js";
import { handleUninstallCommand } from "./setup/uninstall.js";

const io: CommandIo = {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
};

function experimentalUsage(): string {
  return [
    "Usage:",
    "  arcwell experimental init [--profile core|full] [--posture host|guarded|isolated]",
    "  arcwell experimental plan --manifest <path> [--json]",
    "  arcwell experimental capabilities [--json]",
    "  arcwell experimental explain --manifest <path> [--json]",
    "  arcwell experimental schema",
    "  arcwell experimental run plan --goal <goal> [--cwd <directory>] [--json]",
    "  arcwell experimental run feature --goal <goal> [--cwd <directory>] [--persist] [--json]",
    "  arcwell experimental run feature resume --session <id> --checkpoint <entry> --checkpoint-digest <sha256>",
    "      --approve-plan [--cwd <directory>] [--json]",
    "  arcwell experimental run feature worker --session <id> --checkpoint <entry> --checkpoint-digest <sha256>",
    "      --approval <sha256> --task <id> [--cwd <directory>] [--json]",
    "  arcwell experimental workflows [--json]",
    "  arcwell experimental workflow explain <name> [--json]",
    "  arcwell experimental workflow validate --file <path> [--json]",
    "  arcwell experimental workflow schema",
    "",
    "Experimental commands:",
    "  init          Print an Experimental portable Core/guarded manifest",
    "  plan          Validate an Experimental manifest and print a read-only plan",
    "  capabilities  List Experimental capabilities, including optional modules",
    "  explain       Explain Experimental capabilities, ownership, and provenance",
    "  schema        Print the Experimental manifest JSON Schema",
    "  run plan      Run an Experimental bounded scout and planner through Pi",
    "  run feature   Run the Experimental feature preparation path at bounded gates",
    "  workflows     List Experimental bounded multi-agent workflows",
    "  workflow      Explain or validate Experimental workflow graphs",
  ].join("\n");
}

function experimentalMain(argv: string[]): void {
  const command = argv[0];
  if (command === "--help" || command === "-h") {
    io.stdout(`${experimentalUsage()}\n`);
    return;
  }
  if (handleWorkflowCommand(argv, io)) return;
  if (handleConfigurationCommand(argv, io, experimentalUsage())) return;
  throw new Error(command ? `experimental: unknown command: ${command}` : experimentalUsage());
}

function publicUsage(): string {
  return [
    "Usage:",
    "  arcwell setup [--manifest <file>] [--yes] [--dry-run] [--write-manifest <file>]",
    "  arcwell doctor [--json]",
    "  arcwell uninstall [--yes]",
    "  arcwell experimental <command> [arguments]",
    "",
    "Stable lifecycle commands are setup, doctor, and uninstall.",
    "The stable v1 setup manifest is canonical for setup only.",
    "Experimental manifest and workflow commands use separate legacy schemas.",
  ].join("\n");
}

async function publicMain(argv: string[], signal?: AbortSignal): Promise<0 | 1 | 2> {
  const command = argv[0];
  if (command === "--help" || command === "-h") {
    io.stdout(`${publicUsage()}\n`);
    return 0;
  }
  if (await handleSetupCommand(argv, io, undefined, signal)) return 0;
  const doctorStatus = await handleDoctorCommand(argv, io, undefined, signal);
  if (doctorStatus !== undefined) return doctorStatus;
  const uninstallStatus = await handleUninstallCommand(argv, io, undefined, signal);
  if (uninstallStatus !== undefined) return uninstallStatus;
  throw new Error(command ? `unknown command: ${command}` : publicUsage());
}

async function runAgentWorkflow(argv: string[]): Promise<void> {
  const workflow = argv[1];
  if (workflow !== "plan" && workflow !== "feature") throw new Error("run: expected workflow name plan or feature");
  const controller = new AbortController();
  const interrupt = () => controller.abort();
  process.once("SIGINT", interrupt);
  try {
    if (workflow === "feature" && argv[2] === "resume") {
      const { runFeatureResumeCommand } = await import("./run-feature-resume-cli.js");
      process.exitCode = await runFeatureResumeCommand(argv.slice(3), io, undefined, controller.signal);
      return;
    }
    if (workflow === "feature" && argv[2] === "worker") {
      const [{ runFeatureWorkerCommand }, { createPiSdkWorkerAgent }, { createPiSdkSessionFactory }] = await Promise.all([
        import("./run-feature-worker-cli.js"),
        import("./backends/pi-sdk-worker-agent.js"),
        import("./backends/pi-sdk-session-factory.js"),
      ]);
      process.exitCode = await runFeatureWorkerCommand(
        argv.slice(3), io, createPiSdkWorkerAgent(createPiSdkSessionFactory()), undefined, controller.signal,
      );
      return;
    }
    const [{ createBoundedPlanAgents }, { createPiSdkSessionFactory }] = await Promise.all([
      import("./backends/pi-sdk-plan-agents.js"),
      import("./backends/pi-sdk-session-factory.js"),
    ]);
    const agents = createBoundedPlanAgents(createPiSdkSessionFactory());
    if (workflow === "plan") {
      const { runPlanCommand } = await import("./run-cli.js");
      process.exitCode = await runPlanCommand(argv.slice(2), io, agents, controller.signal);
    } else {
      const { runFeatureCommand } = await import("./run-feature-cli.js");
      process.exitCode = await runFeatureCommand(argv.slice(2), io, agents, controller.signal);
    }
  } finally {
    process.removeListener("SIGINT", interrupt);
  }
}

try {
  const argv = process.argv.slice(2);
  if (argv[0] === "experimental") {
    const experimentalArgs = argv.slice(1);
    if (experimentalArgs[0] === "run") await runAgentWorkflow(experimentalArgs);
    else experimentalMain(experimentalArgs);
  } else {
    const controller = new AbortController();
    const interrupt = () => controller.abort();
    process.once("SIGINT", interrupt);
    try {
      process.exitCode = await publicMain(argv, controller.signal);
    } finally {
      process.removeListener("SIGINT", interrupt);
    }
  }
} catch (error) {
  io.stderr(`arcwell: ${sanitizeDiagnostic(error)}\n`);
  process.exitCode = 2;
}

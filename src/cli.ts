#!/usr/bin/env node

import type { CommandIo } from "./commands/types.js";
import { sanitizeDiagnostic } from "./diagnostic.js";
import { handleSetupCommand } from "./setup/cli.js";
import { handleDoctorCommand } from "./setup/doctor.js";
import { handleUninstallCommand } from "./setup/uninstall.js";

const io: CommandIo = {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
};

function usage(): string {
  return [
    "Usage:",
    "  arcwell setup [--manifest <file>] [--yes] [--dry-run] [--write-manifest <file>]",
    "  arcwell doctor [--json]",
    "  arcwell uninstall [--yes]",
    "",
    "setup composes this machine's Pi environment from a portable manifest.",
    "doctor reports the effective local state; uninstall restores what setup owned.",
  ].join("\n");
}

async function main(argv: string[], signal?: AbortSignal): Promise<0 | 1 | 2> {
  const command = argv[0];
  if (command === "--help" || command === "-h") {
    io.stdout(`${usage()}\n`);
    return 0;
  }
  if (await handleSetupCommand(argv, io, undefined, signal)) return 0;
  const doctorStatus = await handleDoctorCommand(argv, io, undefined, signal);
  if (doctorStatus !== undefined) return doctorStatus;
  const uninstallStatus = await handleUninstallCommand(argv, io, undefined, signal);
  if (uninstallStatus !== undefined) return uninstallStatus;
  throw new Error(command ? `unknown command: ${command}` : usage());
}

try {
  const controller = new AbortController();
  const interrupt = () => controller.abort();
  process.once("SIGINT", interrupt);
  try {
    process.exitCode = await main(process.argv.slice(2), controller.signal);
  } finally {
    process.removeListener("SIGINT", interrupt);
  }
} catch (error) {
  io.stderr(`arcwell: ${sanitizeDiagnostic(error)}\n`);
  process.exitCode = 2;
}

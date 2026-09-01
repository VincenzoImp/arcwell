import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import type { CommandIo } from "../commands/types.js";
import { resolveArcwellAgentDir } from "./agent-dir.js";
import { applySetup } from "./apply.js";
import { createDefaultManifest, loadSetupManifest } from "./manifest.js";
import { loadManagedResources } from "./managed-resources.js";
import { createPiClient } from "./pi-client.js";
import { createSetupPlan } from "./plan.js";
import type { SetupManifest } from "./types.js";
import {
  createReadlineWizardIo,
  renderSetupPlan,
  runSetupWizard,
  type SetupWizardIo,
} from "./wizard.js";

export interface SetupCommandDependencies {
  isTTY?: boolean;
  apply?: (manifest: SetupManifest, signal?: AbortSignal) => Promise<void>;
  wizardIo?: SetupWizardIo;
}

export function defaultSetupAgentDir(): string {
  return resolveArcwellAgentDir();
}

async function applyWithDefaults(manifest: SetupManifest, signal?: AbortSignal): Promise<void> {
  const agentDir = defaultSetupAgentDir();
  const packageRoot = fileURLToPath(new URL("../../../", import.meta.url));
  await applySetup(manifest, {
    agentDir,
    piClient: createPiClient({ executable: "pi" }),
    workingAgreement: readFileSync(join(packageRoot, "content", "AGENTS.md"), "utf8"),
    managedResources: loadManagedResources(packageRoot),
  }, signal);
}

export async function handleSetupCommand(
  argv: string[],
  io: CommandIo,
  dependencies: SetupCommandDependencies = {},
  signal?: AbortSignal,
): Promise<boolean> {
  if (argv[0] !== "setup") return false;
  const parsed = parseArgs({
    args: argv.slice(1),
    allowPositionals: false,
    strict: true,
    options: {
      manifest: { type: "string" },
      yes: { type: "boolean", default: false },
      "dry-run": { type: "boolean", default: false },
      "write-manifest": { type: "string" },
      help: { type: "boolean", short: "h", default: false },
    },
  });
  if (parsed.values.help) {
    io.stdout("Usage: arcwell setup [--manifest <file>] [--yes] [--dry-run] [--write-manifest <file>]\n");
    return true;
  }

  const isTTY = dependencies.isTTY ?? process.stdin.isTTY === true;
  let manifest = parsed.values.manifest
    ? loadSetupManifest(parsed.values.manifest)
    : createDefaultManifest();

  if (parsed.values["dry-run"] && !parsed.values.manifest && isTTY) {
    const defaultWizardIo = dependencies.wizardIo ? undefined : createReadlineWizardIo();
    const wizardIo = dependencies.wizardIo ?? defaultWizardIo!;
    try {
      const selected = await runSetupWizard(wizardIo, undefined, signal, { confirm: false });
      if (!selected) {
        io.stdout("Arcwell setup dry run canceled; no manifest written.\n");
        return true;
      }
      manifest = selected;
    } finally {
      defaultWizardIo?.close();
    }
  }

  if (parsed.values["write-manifest"]) {
    writeFileSync(parsed.values["write-manifest"], `${JSON.stringify(manifest, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  }
  if (parsed.values["dry-run"]) {
    io.stdout("Arcwell setup dry run\n");
    renderSetupPlan(manifest, { write: io.stdout });
    return true;
  }
  if (parsed.values["write-manifest"]) return true;

  if (!isTTY && (!parsed.values.manifest || !parsed.values.yes)) {
    throw new Error("setup: non-TTY mutation requires --manifest <file> --yes");
  }

  let selectedManifest: SetupManifest | undefined = manifest;
  if (!parsed.values.yes) {
    const defaultWizardIo = dependencies.wizardIo ? undefined : createReadlineWizardIo();
    const wizardIo = dependencies.wizardIo ?? defaultWizardIo!;
    try {
      selectedManifest = await runSetupWizard(wizardIo, parsed.values.manifest ? manifest : undefined, signal);
    } finally {
      defaultWizardIo?.close();
    }
    if (!selectedManifest) {
      io.stdout("Arcwell setup canceled; no changes applied.\n");
      return true;
    }
  }
  if (signal?.aborted) {
    io.stdout("Arcwell setup canceled; no changes applied.\n");
    return true;
  }

  await (dependencies.apply ?? applyWithDefaults)(selectedManifest, signal);
  io.stdout(`Arcwell setup complete (${createSetupPlan(selectedManifest).manifestDigest.slice(0, 12)})\n`);
  return true;
}

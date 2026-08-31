import { parseArgs } from "node:util";

import { listCapabilities } from "../catalog.js";
import { explainManifest } from "../explain.js";
import { createInitialManifest } from "../init.js";
import { loadManifest } from "../manifest.js";
import { createPlan } from "../planner.js";
import { manifestSchema } from "../schema.js";
import type { CommandIo } from "./types.js";

export function handleConfigurationCommand(argv: string[], io: CommandIo, usage: string): boolean {
  const command = argv[0];
  if (command === "init") {
    const parsed = parseArgs({
      args: argv.slice(1),
      allowPositionals: false,
      strict: true,
      options: {
        profile: { type: "string", default: "core" },
        posture: { type: "string", default: "guarded" },
      },
    });
    const profile = parsed.values.profile;
    const posture = parsed.values.posture;
    if (profile !== "core" && profile !== "full") throw new Error("init: --profile must be core or full");
    if (posture !== "host" && posture !== "guarded" && posture !== "isolated") {
      throw new Error("init: --posture must be host, guarded, or isolated");
    }
    io.stdout(`${JSON.stringify(createInitialManifest({ profile, posture }), null, 2)}\n`);
    return true;
  }
  if (command === "schema") {
    if (argv.length !== 1) throw new Error("schema: no arguments are accepted");
    io.stdout(`${JSON.stringify(manifestSchema, null, 2)}\n`);
    return true;
  }
  if (command === "capabilities") {
    const parsed = parseArgs({
      args: argv.slice(1),
      allowPositionals: false,
      strict: true,
      options: {
        json: { type: "boolean", default: false },
        help: { type: "boolean", short: "h", default: false },
      },
    });
    if (parsed.values.help) {
      io.stdout(`${usage}\n`);
      return true;
    }
    const capabilities = listCapabilities();
    if (parsed.values.json) io.stdout(`${JSON.stringify(capabilities, null, 2)}\n`);
    else {
      for (const capability of capabilities) {
        const flags = [
          capability.optional ? "optional" : "core",
          capability.lazy ? "lazy" : "startup",
          capability.requiresApproval ? "approval required" : "no approval",
          `platforms: ${capability.platforms.join("/")}`,
        ];
        io.stdout(`${capability.id} [${flags.join(", ")}] — ${capability.description}\n`);
      }
    }
    return true;
  }
  if (command !== "plan" && command !== "explain") return false;

  const parsed = parseArgs({
    args: argv.slice(1),
    allowPositionals: false,
    strict: true,
    options: {
      manifest: { type: "string" },
      json: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });
  if (parsed.values.help) {
    io.stdout(`${usage}\n`);
    return true;
  }
  if (!parsed.values.manifest) throw new Error(`${command}: --manifest <path> is required`);
  const manifest = loadManifest(parsed.values.manifest);

  if (command === "explain") {
    const explanation = explainManifest(manifest);
    if (parsed.values.json) io.stdout(`${JSON.stringify(explanation, null, 2)}\n`);
    else {
      io.stdout(`Experimental Arcwell explanation ${explanation.manifestDigest.slice(0, 12)}\n`);
      for (const item of explanation.capabilities) {
        io.stdout(`- ${item.id}: ${item.activation}, owner ${item.ownership.owner} (${item.ownership.lifecycle})\n`);
      }
      for (const guardrail of explanation.guardrails) io.stdout(`Guardrail: ${guardrail}\n`);
    }
    return true;
  }

  const plan = createPlan(manifest);
  if (parsed.values.json) {
    io.stdout(`${JSON.stringify(plan, null, 2)}\n`);
    return true;
  }
  io.stdout(`Experimental Arcwell plan ${plan.manifestDigest.slice(0, 12)}\n`);
  io.stdout(`Profile: ${plan.selection.profile}\n`);
  io.stdout(`Posture: ${plan.selection.posture}\n`);
  io.stdout(`Backend: ${plan.selection.executionBackend}\n\n`);
  for (const item of plan.operations) {
    const approval = item.requiresApproval ? " [approval required]" : "";
    io.stdout(`- ${item.id}: ${item.description}${approval} [${item.platforms.join("/")}]\n`);
  }
  for (const warning of plan.warnings) io.stdout(`\nWarning: ${warning}\n`);
  return true;
}

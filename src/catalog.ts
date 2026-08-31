import { packNames, workflowNames } from "./manifest.js";
import { compareText } from "./order.js";

export type CapabilityKind = "configure" | "integration" | "intelligence" | "policy";
export type Platform = "darwin" | "linux" | "win32";

export interface Capability {
  id: string;
  kind: CapabilityKind;
  description: string;
  optional: boolean;
  lazy: boolean;
  requiresApproval: boolean;
  platforms: Platform[];
}

const allPlatforms: Platform[] = ["darwin", "linux", "win32"];
const capability = (
  id: string,
  kind: CapabilityKind,
  description: string,
  options: Partial<Pick<Capability, "optional" | "lazy" | "requiresApproval" | "platforms">> = {},
): Capability => ({
  id,
  kind,
  description,
  optional: options.optional ?? false,
  lazy: options.lazy ?? false,
  requiresApproval: options.requiresApproval ?? false,
  platforms: options.platforms ?? allPlatforms,
});

const catalog: Capability[] = [
  capability("config.working-agreement", "configure", "Install Arcwell's minimal working agreement"),
  capability("integration.claude-code", "integration", "Enable the lazy Claude Code adapter", {
    optional: true,
    lazy: true,
  }),
  capability("integration.herdr", "integration", "Install the optional Herdr workflow backend", {
    optional: true,
    lazy: true,
    requiresApproval: true,
  }),
  capability("integration.herdr.pi", "integration", "Delegate Pi lifecycle integration to Herdr", {
    optional: true,
    lazy: true,
    requiresApproval: true,
  }),
  capability("integration.mcp", "integration", "Enable lazy MCP discovery", {
    optional: true,
    lazy: true,
  }),
  capability("policy.effects-guard", "policy", "Enable guarded remote effects"),
  capability("policy.sandbox", "policy", "Install the fail-closed OS sandbox", {
    optional: true,
    requiresApproval: true,
    platforms: ["darwin", "linux"],
  }),
  ...packNames.map((pack) =>
    capability(`intelligence.pack.${pack}`, "intelligence", `Install the ${pack} skill pack`, {
      optional: pack !== "core",
      lazy: true,
    }),
  ),
  ...workflowNames.map((workflow) =>
    capability(`intelligence.workflow.${workflow}`, "intelligence", `Install the ${workflow} workflow`, {
      optional: workflow === "release",
      lazy: true,
      requiresApproval: workflow === "release",
    }),
  ),
].sort((left, right) => compareText(left.id, right.id));

const byId = new Map(catalog.map((entry) => [entry.id, entry]));

export function listCapabilities(): Capability[] {
  return catalog.map((entry) => ({ ...entry, platforms: [...entry.platforms] }));
}

export function capabilityById(id: string): Capability {
  const entry = byId.get(id);
  if (!entry) throw new Error(`catalog: unknown capability ${id}`);
  return { ...entry, platforms: [...entry.platforms] };
}

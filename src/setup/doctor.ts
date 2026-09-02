import { existsSync, lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";

import type { CommandIo } from "../commands/types.js";
import { resolveArcwellAgentDir } from "./agent-dir.js";
import { PACKAGE_CATALOG } from "./catalog.js";
import { assertNoSymbolicLinkComponents, parseRuntimeConfigJson } from "./config.js";
import { ARCWELL_VERSION } from "./manifest.js";
import { readOwnership, type ArcwellOwnership } from "./ownership.js";
import { verifyManagedResources } from "./managed-resources.js";
import { assertArcwellPackageHealthy } from "./package-health.js";
import {
  ARCWELL_PACKAGE_SOURCE,
  packageSourceIdentity,
  packageSourcesEquivalent,
} from "./package-source.js";
import { createPiClient, type PiClient, type PiPackage } from "./pi-client.js";
import { moduleNames, protectionNames, type RuntimeConfig } from "./types.js";
import { integrityMismatches } from "./integrity.js";
import { COMPATIBLE_PI_VERSION, nestedPiVersion, normalizedPiVersion } from "./pi-version.js";
import { managedWorkingAgreementDigest } from "./working-agreement.js";

export { COMPATIBLE_PI_VERSION };

export type DoctorCheckStatus = "ok" | "warning" | "error";
export type DoctorExitStatus = 0 | 1 | 2;

export interface DoctorCheck {
  id: string;
  status: DoctorCheckStatus;
  message: string;
  path?: string;
}

export interface DoctorReport {
  schemaVersion: 1;
  status: "healthy" | "warnings" | "errors";
  exitStatus: DoctorExitStatus;
  checks: DoctorCheck[];
  guidance: string[];
}

export interface DoctorDependencies {
  agentDir: string;
  piClient: Pick<PiClient, "version" | "list">;
}

export interface DoctorCommandDependencies {
  run?: (signal?: AbortSignal) => Promise<DoctorReport>;
}

const CONFIG_LOGICAL_PATH = "$PI_CODING_AGENT_DIR/arcwell/config.json";
const OWNERSHIP_LOGICAL_PATH = "$PI_CODING_AGENT_DIR/arcwell/ownership.json";
const AGREEMENT_LOGICAL_PATH = "$PI_CODING_AGENT_DIR/AGENTS.md";
const knownOwnedSources = new Set([ARCWELL_PACKAGE_SOURCE, ...PACKAGE_CATALOG.map((entry) => entry.source)]);

function readRegularText(path: string): string {
  assertNoSymbolicLinkComponents(path);
  if (!existsSync(path)) throw new Error("missing");
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error("not a regular file");
  return readFileSync(path, "utf8");
}

/** The provider name pi-claude-cli registers, which is the package name rather than "claude". */
const CLAUDE_CLI_PROVIDER = "pi-claude-cli";

/** The provider selected in Pi's settings, or undefined when unreadable. Never auth state. */
function configuredProvider(agentDir: string): string | undefined {
  try {
    const settings: unknown = JSON.parse(readFileSync(join(agentDir, "settings.json"), "utf8"));
    const provider = (settings as { defaultProvider?: unknown }).defaultProvider;
    return typeof provider === "string" ? provider : undefined;
  } catch {
    return undefined;
  }
}

function sourceCheckId(source: string): string {
  if (source === ARCWELL_PACKAGE_SOURCE) return "package.arcwell";
  const entry = PACKAGE_CATALOG.find((candidate) => candidate.source === source);
  return `package.${entry?.capability ?? "unknown"}`;
}

function packageError(source: string, installed: readonly PiPackage[]): string {
  const equivalent = installed.find((item) =>
    item.scope === "user" && packageSourcesEquivalent(item.source, source));
  if (equivalent?.filtered) return `Required user package ${source} is filtered`;
  const identity = packageSourceIdentity(source);
  const conflict = identity && installed.find((item) =>
    item.scope === "user" && packageSourceIdentity(item.source) === identity);
  return conflict
    ? `Required user package ${source} has a version conflict`
    : `Required user package ${source} is missing`;
}

function reportFromChecks(checks: DoctorCheck[]): DoctorReport {
  const exitStatus: DoctorExitStatus = checks.some((check) => check.status === "error")
    ? 2
    : checks.some((check) => check.status === "warning") ? 1 : 0;
  return {
    schemaVersion: 1,
    status: exitStatus === 2 ? "errors" : exitStatus === 1 ? "warnings" : "healthy",
    exitStatus,
    checks,
    guidance: ["Claude subscription authentication is managed by Pi; use /login if desired."],
  };
}

export async function runDoctor(
  dependencies: DoctorDependencies,
  signal?: AbortSignal,
): Promise<DoctorReport> {
  const checks: DoctorCheck[] = [];
  const configPath = join(dependencies.agentDir, "arcwell", "config.json");
  const ownershipPath = join(dependencies.agentDir, "arcwell", "ownership.json");
  const agreementPath = join(dependencies.agentDir, "AGENTS.md");

  let hostPiVersion: string | undefined;
  try {
    hostPiVersion = normalizedPiVersion(await dependencies.piClient.version(signal));
    checks.push(hostPiVersion === COMPATIBLE_PI_VERSION
      ? { id: "pi.version", status: "ok", message: `Pi ${hostPiVersion} is compatible` }
      : { id: "pi.version", status: "error", message: `Pi ${COMPATIBLE_PI_VERSION} is required` });
  } catch {
    checks.push({ id: "pi.version", status: "error", message: "Unable to determine a compatible Pi version" });
  }

  let installed: PiPackage[] | undefined;
  try {
    installed = await dependencies.piClient.list(signal);
    checks.push({ id: "pi.packages", status: "ok", message: "Pi user package inventory was read" });
  } catch {
    checks.push({ id: "pi.packages", status: "error", message: "Unable to read Pi user package inventory" });
  }

  let config: RuntimeConfig | undefined;
  try {
    config = parseRuntimeConfigJson(readRegularText(configPath));
    checks.push({ id: "runtime.config", status: "ok", message: "Runtime config is exact and valid", path: CONFIG_LOGICAL_PATH });
  } catch {
    checks.push({ id: "runtime.config", status: "error", message: "Runtime config is missing or invalid", path: CONFIG_LOGICAL_PATH });
  }

  let ownership: ArcwellOwnership | undefined;
  try {
    ownership = readOwnership(ownershipPath);
    if (!ownership) throw new Error("missing");
    const unknownSource = [...ownership.installedPackageSources, ...ownership.selectedPackageSources]
      .find((source) => !knownOwnedSources.has(source));
    if (
      ownership.arcwellVersion !== ARCWELL_VERSION
      || unknownSource
      || !ownership.selectedPackageSources.includes(ARCWELL_PACKAGE_SOURCE)
    ) throw new Error("inconsistent");
    checks.push({ id: "ownership", status: "ok", message: "Ownership is strict and consistent", path: OWNERSHIP_LOGICAL_PATH });
  } catch {
    checks.push({ id: "ownership", status: "error", message: "Ownership is missing, invalid, or inconsistent", path: OWNERSHIP_LOGICAL_PATH });
    ownership = undefined;
  }

  try {
    const actualDigest = managedWorkingAgreementDigest(readRegularText(agreementPath));
    if (!ownership || !actualDigest || actualDigest !== ownership.workingAgreementDigest) throw new Error("mismatch");
    checks.push({ id: "agreement", status: "ok", message: "Working agreement markers and digest match ownership", path: AGREEMENT_LOGICAL_PATH });
  } catch {
    checks.push({ id: "agreement", status: "error", message: "Working agreement markers or digest do not match ownership", path: AGREEMENT_LOGICAL_PATH });
  }

  if (ownership) {
    const mismatched = verifyManagedResources(dependencies.agentDir, ownership.installedResources);
    checks.push(mismatched.length === 0
      ? {
        id: "resources",
        status: "ok",
        message: `All ${ownership.installedResources.length} managed files match ownership`,
      }
      : {
        id: "resources",
        status: "error",
        message: `Managed files no longer match ownership: ${mismatched.join(", ")}`,
      });
  }

  if (installed) {
    const effectiveUserPackages = installed.filter((item) => item.scope === "user" && !item.filtered);
    const effectivePackage = (source: string): PiPackage | undefined => effectiveUserPackages.find((item) =>
      packageSourcesEquivalent(item.source, source));
    const requiredSources = new Set([ARCWELL_PACKAGE_SOURCE, ...(ownership?.selectedPackageSources ?? [])]);
    if (config?.protections.redaction) {
      requiredSources.add(PACKAGE_CATALOG.find((entry) => entry.capability === "redaction")!.source);
    }
    let arcwellPackageHealthy = false;
    for (const source of [...requiredSources].sort()) {
      const installedPackage = effectivePackage(source);
      if (!installedPackage) {
        checks.push({ id: sourceCheckId(source), status: "error", message: packageError(source, installed) });
        continue;
      }
      if (source === ARCWELL_PACKAGE_SOURCE) {
        try {
          await assertArcwellPackageHealthy(installedPackage);
          arcwellPackageHealthy = true;
          checks.push({ id: "package.arcwell", status: "ok", message: `Required user package ${source} is present and loadable` });
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error);
          checks.push({ id: "package.arcwell", status: "error", message: `Required user package ${source} is invalid: ${detail}` });
        }
        // The extensions import values from Pi, and Node resolves those from the copy npm put
        // inside the package rather than from the host. Two versions there is two module
        // instances of the same class, which fails at render time and nowhere earlier.
        const nested = nestedPiVersion(installedPackage.installedPath);
        checks.push(nested === undefined || hostPiVersion === undefined || nested === hostPiVersion
          ? { id: "pi.nested", status: "ok", message: "Pi resolves to one version inside and outside the package" }
          : {
            id: "pi.nested",
            status: "error",
            message: `Pi ${hostPiVersion} is running the agent but the Arcwell package resolves Pi ${nested}`,
          });
        continue;
      }
      checks.push({ id: sourceCheckId(source), status: "ok", message: `Required user package ${source} is present` });
    }

    // A pin names a release; this asks whether the bytes on disk are the ones that were audited.
    // Unreadable is reported apart from mismatched: not knowing is not the same as tampering.
    if (ownership) {
      const selected = PACKAGE_CATALOG.filter((entry) => ownership.selectedPackageSources.includes(entry.source));
      const mismatches = integrityMismatches(dependencies.agentDir, selected);
      checks.push(mismatches === undefined
        ? { id: "integrity", status: "warning", message: "Package integrity could not be read from the npm lock file" }
        : mismatches.length === 0
          ? { id: "integrity", status: "ok", message: `All ${selected.length} installed packages match the audited integrity` }
          : {
            id: "integrity",
            status: "error",
            message: `Installed bytes differ from the audited catalog: ${mismatches
              .map((m) => `${m.source} (${m.actual ?? "no recorded integrity"})`).join(", ")}`,
          });
    }

    if (ownership) {
      const selectedIdentities = new Set(ownership.selectedPackageSources.map(packageSourceIdentity));
      const globalUserPackages = installed.filter((item) => item.scope === "user");
      for (const entry of PACKAGE_CATALOG) {
        const identity = packageSourceIdentity(entry.source);
        if (!identity || selectedIdentities.has(identity)) continue;
        const unowned = globalUserPackages.find((item) => packageSourceIdentity(item.source) === identity);
        if (unowned && !ownership.installedPackageSources.includes(unowned.source)) {
          checks.push({
            id: `package.unowned.${entry.capability}`,
            status: "error",
            message: `Unowned global package ${unowned.source} remains installed while ${entry.capability} is unselected`,
          });
        }
      }
    }

    for (const moduleName of moduleNames) {
      const entry = PACKAGE_CATALOG.find((candidate) => candidate.capability === moduleName);
      if (!entry || !ownership?.selectedPackageSources.includes(entry.source)) continue;
      checks.push(effectivePackage(entry.source)
        ? { id: `module.${moduleName}`, status: "ok", message: `Module ${moduleName} is effectively enabled` }
        : { id: `module.${moduleName}`, status: "error", message: `Selected module ${moduleName} is missing or filtered` });
    }

    // Configuration, not authentication state: which provider is selected, never whether or how
    // it is logged in. Both halves matter, and the second is the one that bit first: installing
    // the adapter changes nothing until the provider points at it, and until then a subscription
    // login is billed per token with nothing in the system saying so.
    const claudeCli = PACKAGE_CATALOG.find((entry) => entry.capability === "claudeCli")!;
    const provider = configuredProvider(dependencies.agentDir);
    if (effectivePackage(claudeCli.source)) {
      if (provider !== CLAUDE_CLI_PROVIDER) {
        checks.push({
          id: "provider.claudeCli",
          status: "warning",
          message: `modules.claudeCli is on but defaultProvider is ${provider ?? "unset"}; select ${CLAUDE_CLI_PROVIDER} for the adapter to route anything`,
        });
      }
    } else if (provider === "anthropic") {
      checks.push({
        id: "provider.claudeCli",
        status: "warning",
        message: "Provider is anthropic and modules.claudeCli is off; a subscription login is billed per token on this path",
      });
    }

    if (config) {
      for (const protection of protectionNames) {
        if (protection !== "redaction") {
          const packagePresent = arcwellPackageHealthy;
          checks.push(config.protections[protection] && packagePresent
            ? { id: `protection.${protection}`, status: "ok", message: `Protection ${protection} is effectively enabled by global runtime config` }
            : !config.protections[protection]
              ? { id: `protection.${protection}`, status: "warning", message: `Protection ${protection} is disabled` }
              : { id: `protection.${protection}`, status: "error", message: `Protection ${protection} config and effective package state disagree` });
          continue;
        }
        const redactionSource = PACKAGE_CATALOG.find((entry) => entry.capability === "redaction")!.source;
        const packagePresent = effectivePackage(redactionSource) !== undefined;
        checks.push(config.protections.redaction && packagePresent
          ? { id: "protection.redaction", status: "ok", message: "Protection redaction is effectively enabled" }
          : !config.protections.redaction && !packagePresent
            ? { id: "protection.redaction", status: "warning", message: "Protection redaction is disabled" }
            : { id: "protection.redaction", status: "error", message: "Protection redaction config and effective package state disagree" });
      }
    }
  }

  return reportFromChecks(checks);
}

function renderDoctor(report: DoctorReport, io: CommandIo): void {
  io.stdout(`Arcwell doctor: ${report.status}\n`);
  for (const check of report.checks) {
    io.stdout(`${check.status === "ok" ? "OK" : check.status.toUpperCase()}: ${check.message}${check.path ? ` (${check.path})` : ""}\n`);
  }
  for (const guidance of report.guidance) io.stdout(`Guidance: ${guidance}\n`);
}

export function defaultDoctorAgentDir(): string {
  return resolveArcwellAgentDir();
}

async function runDoctorWithDefaults(signal?: AbortSignal): Promise<DoctorReport> {
  return runDoctor({
    agentDir: defaultDoctorAgentDir(),
    piClient: createPiClient({ executable: "pi" }),
  }, signal);
}

export async function handleDoctorCommand(
  argv: string[],
  io: CommandIo,
  dependencies: DoctorCommandDependencies = {},
  signal?: AbortSignal,
): Promise<DoctorExitStatus | undefined> {
  if (argv[0] !== "doctor") return undefined;
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
    io.stdout("Usage: arcwell doctor [--json]\n");
    return 0;
  }
  const report = await (dependencies.run ?? runDoctorWithDefaults)(signal);
  if (parsed.values.json) io.stdout(`${JSON.stringify(report, null, 2)}\n`);
  else renderDoctor(report, io);
  return report.exitStatus;
}

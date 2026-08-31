import { existsSync, lstatSync, readFileSync, readdirSync, rmdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { parseArgs } from "node:util";

import type { CommandIo } from "../commands/types.js";
import { resolveArcwellAgentDir } from "./agent-dir.js";
import { PACKAGE_CATALOG } from "./catalog.js";
import { assertNoSymbolicLinkComponents, parseRuntimeConfigJson } from "./config.js";
import { ARCWELL_VERSION } from "./manifest.js";
import { readOwnership, writeOwnershipAtomic, type ArcwellOwnership } from "./ownership.js";
import { createPiClient, type PiClient, type PiPackage } from "./pi-client.js";
import { managedWorkingAgreementDigest, removeWorkingAgreement } from "./working-agreement.js";

export interface UninstallDependencies {
  agentDir: string;
  piClient: Pick<PiClient, "list" | "remove">;
}

export interface UninstallResult {
  removedPackageSources: string[];
}

export type ConfirmUninstall = (prompt: string, signal?: AbortSignal) => Promise<boolean>;

export interface UninstallCommandDependencies {
  isTTY?: boolean;
  confirm?: ConfirmUninstall;
  run?: (signal?: AbortSignal) => Promise<UninstallResult>;
}

const knownOwnedSources = new Set([
  `npm:arcwell@${ARCWELL_VERSION}`,
  ...PACKAGE_CATALOG.map((entry) => entry.source),
]);

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  throw signal.reason instanceof Error ? signal.reason : new Error("uninstall aborted");
}

function readOptionalRegularText(path: string): string | undefined {
  assertNoSymbolicLinkComponents(path);
  if (!existsSync(path)) return undefined;
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error("Arcwell state target is not a regular file");
  return readFileSync(path, "utf8");
}

function removeRegularFile(path: string): void {
  assertNoSymbolicLinkComponents(path);
  if (!existsSync(path)) return;
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error("Arcwell state target is not a regular file");
  rmSync(path);
  if (existsSync(path)) throw new Error("Arcwell state file remained after removal");
}

function removeCreatedArcwellDirectory(path: string, existedBeforeSetup: boolean): void {
  if (existedBeforeSetup || !existsSync(path)) return;
  assertNoSymbolicLinkComponents(path);
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error("Arcwell state directory is not a regular directory");
  if (readdirSync(path).length > 0) return;
  try {
    rmdirSync(path);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOTEMPTY" && code !== "EEXIST") throw error;
  }
}

function failureMessage(error: unknown, removed: readonly string[], remaining: readonly string[]): string {
  const detail = error instanceof Error ? error.message : String(error);
  return `uninstall cleanup failed: ${detail}; removed: ${removed.join(", ") || "none"}; remaining owned packages: ${remaining.join(", ") || "none"}; ownership was preserved for retry`;
}

function npmPackageIdentity(source: string): string | undefined {
  if (!source.startsWith("npm:")) return undefined;
  const specifier = source.slice(4);
  const match = /^(@?[^@]+(?:\/[^@]+)?)(?:@(.+))?$/.exec(specifier);
  return match?.[1] ?? (specifier || undefined);
}

function userSourceSet(packages: readonly PiPackage[]): Set<string> {
  return new Set(packages.filter((item) => item.scope === "user").map((item) => item.source));
}

function assertNoIdentityRemovalConflicts(
  ownedSources: readonly string[],
  packages: readonly PiPackage[],
): void {
  const userPackages = packages.filter((item) => item.scope === "user");
  for (const ownedSource of ownedSources) {
    const identity = npmPackageIdentity(ownedSource);
    const conflict = identity && userPackages.find((item) =>
      item.source !== ownedSource && npmPackageIdentity(item.source) === identity);
    if (conflict) {
      throw new Error(`uninstall package identity conflict for ${identity}: additional user source ${conflict.source}`);
    }
  }
}

async function reconcileRemovalFailure(
  error: unknown,
  ownershipPath: string,
  ownership: ArcwellOwnership,
  targets: readonly string[],
  piClient: Pick<PiClient, "list">,
): Promise<never> {
  let actualPackages: PiPackage[];
  try {
    actualPackages = await piClient.list();
  } catch (refreshError) {
    const detail = refreshError instanceof Error ? refreshError.message : String(refreshError);
    throw new Error(`${failureMessage(error, [], ownership.installedPackageSources)}; Pi inventory refresh failed: ${detail}`);
  }
  const actualUserSources = userSourceSet(actualPackages);
  const remaining = ownership.installedPackageSources.filter((source) => actualUserSources.has(source));
  const removed = targets.filter((source) => !actualUserSources.has(source));
  writeOwnershipAtomic(ownershipPath, { ...ownership, installedPackageSources: remaining });
  throw new Error(failureMessage(error, removed, remaining));
}

async function uninstallArcwellInternal(
  dependencies: UninstallDependencies,
  signal?: AbortSignal,
): Promise<UninstallResult> {
  throwIfAborted(signal);
  const arcwellDirectory = join(dependencies.agentDir, "arcwell");
  const ownershipPath = join(arcwellDirectory, "ownership.json");
  const configPath = join(arcwellDirectory, "config.json");
  const agreementPath = join(dependencies.agentDir, "AGENTS.md");
  const ownership = readOwnership(ownershipPath);
  if (!ownership) throw new Error("uninstall requires $PI_CODING_AGENT_DIR/arcwell/ownership.json");
  if (ownership.arcwellVersion !== ARCWELL_VERSION) {
    throw new Error(`uninstall ownership version mismatch: expected ${ARCWELL_VERSION}`);
  }
  const unknownSource = [...ownership.installedPackageSources, ...ownership.selectedPackageSources]
    .find((source) => !knownOwnedSources.has(source));
  if (unknownSource) throw new Error(`uninstall ownership contains an unrecognized package source: ${unknownSource}`);

  const configText = readOptionalRegularText(configPath);
  if (configText !== undefined) parseRuntimeConfigJson(configText);
  const agreementText = readOptionalRegularText(agreementPath);
  const agreementDigest = agreementText === undefined ? undefined : managedWorkingAgreementDigest(agreementText);
  if (agreementDigest !== ownership.workingAgreementDigest) {
    throw new Error("uninstall working agreement was modified; ownership was preserved for manual recovery");
  }

  throwIfAborted(signal);
  const installed = await dependencies.piClient.list(signal);
  assertNoIdentityRemovalConflicts(ownership.installedPackageSources, installed);
  const installedUserSources = userSourceSet(installed);
  const targets = ownership.installedPackageSources.filter((source) => installedUserSources.has(source));
  const removed: string[] = [];
  for (let index = 0; index < targets.length; index += 1) {
    const source = targets[index]!;
    try {
      throwIfAborted(signal);
      await dependencies.piClient.remove(source, signal);
      removed.push(source);
    } catch (error) {
      return reconcileRemovalFailure(error, ownershipPath, ownership, targets, dependencies.piClient);
    }
  }

  try {
    throwIfAborted(signal);
    const afterPackages = await dependencies.piClient.list(signal);
    const remaining = ownership.installedPackageSources.filter((source) =>
      afterPackages.some((item) => item.scope === "user" && item.source === source));
    if (remaining.length > 0) throw new Error(`package verification found ${remaining.join(", ")}`);

    removeWorkingAgreement(agreementPath, {
      existed: ownership.workingAgreementExisted,
      endedWithNewline: ownership.workingAgreementEndedWithNewline,
    });
    const afterAgreement = readOptionalRegularText(agreementPath);
    if (afterAgreement !== undefined && managedWorkingAgreementDigest(afterAgreement) !== undefined) {
      throw new Error("working agreement verification found a managed block");
    }

    throwIfAborted(signal);
    removeRegularFile(configPath);
    removeRegularFile(ownershipPath);
  } catch (error) {
    const remaining = ownership.installedPackageSources.filter((source) => !removed.includes(source));
    throw new Error(failureMessage(error, removed, remaining));
  }

  try {
    removeCreatedArcwellDirectory(arcwellDirectory, ownership.arcwellDirectoryExisted);
  } catch (error) {
    try {
      writeOwnershipAtomic(ownershipPath, { ...ownership, installedPackageSources: [] });
    } catch (restoreError) {
      const cleanupDetail = error instanceof Error ? error.message : String(error);
      const restoreDetail = restoreError instanceof Error ? restoreError.message : String(restoreError);
      throw new Error(`uninstall cleanup failed: ${cleanupDetail}; ownership restore failed: ${restoreDetail}`);
    }
    throw new Error(failureMessage(error, removed, []));
  }

  return { removedPackageSources: removed };
}

export async function uninstallArcwell(
  dependencies: UninstallDependencies,
  signal?: AbortSignal,
): Promise<UninstallResult> {
  try {
    return await uninstallArcwellInternal(dependencies, signal);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const agentDirVariants = [...new Set([resolve(dependencies.agentDir), dependencies.agentDir])]
      .filter(Boolean)
      .sort((left, right) => right.length - left.length);
    const redacted = agentDirVariants.reduce(
      (current, agentDir) => current.split(agentDir).join("$PI_CODING_AGENT_DIR"),
      message,
    );
    throw new Error(redacted);
  }
}

async function confirmUninstallWithReadline(prompt: string, signal?: AbortSignal): Promise<boolean> {
  const readline = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = signal ? await readline.question(prompt, { signal }) : await readline.question(prompt);
    return /^(?:y|yes)$/i.test(answer.trim());
  } catch (error) {
    if (signal?.aborted || (error instanceof Error && error.name === "AbortError")) return false;
    throw error;
  } finally {
    readline.close();
  }
}

export function defaultUninstallAgentDir(): string {
  return resolveArcwellAgentDir();
}

async function uninstallWithDefaults(signal?: AbortSignal): Promise<UninstallResult> {
  return uninstallArcwell({
    agentDir: defaultUninstallAgentDir(),
    piClient: createPiClient({ executable: "pi" }),
  }, signal);
}

export async function handleUninstallCommand(
  argv: string[],
  io: CommandIo,
  dependencies: UninstallCommandDependencies = {},
  signal?: AbortSignal,
): Promise<0 | undefined> {
  if (argv[0] !== "uninstall") return undefined;
  const parsed = parseArgs({
    args: argv.slice(1),
    allowPositionals: false,
    strict: true,
    options: {
      yes: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });
  if (parsed.values.help) {
    io.stdout("Usage: arcwell uninstall [--yes]\n");
    return 0;
  }
  const isTTY = dependencies.isTTY ?? process.stdin.isTTY === true;
  if (!parsed.values.yes && !isTTY) throw new Error("uninstall: non-TTY mutation requires --yes");
  if (!parsed.values.yes) {
    const confirmed = await (dependencies.confirm ?? confirmUninstallWithReadline)(
      "Remove Arcwell-owned packages and managed state? [y/N] ",
      signal,
    );
    if (!confirmed || signal?.aborted) {
      io.stdout("Arcwell uninstall canceled; no changes applied.\n");
      return 0;
    }
  }
  const result = await (dependencies.run ?? uninstallWithDefaults)(signal);
  io.stdout(`Arcwell uninstall complete (${result.removedPackageSources.length} owned packages removed)\n`);
  return 0;
}

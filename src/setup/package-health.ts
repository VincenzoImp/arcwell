import { randomUUID } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { join, normalize } from "node:path";
import { pathToFileURL } from "node:url";

import { ARCWELL_VERSION } from "./manifest.js";
import type { PiPackage } from "./pi-client.js";

const ARCWELL_EXTENSION_PATH = join("dist", "extensions", "arcwell-protections.js");

function assertRegularFile(path: string, label: string): void {
  try {
    if (!lstatSync(path).isFile()) throw new Error("not regular");
  } catch {
    throw new Error(`Arcwell package ${label} is missing or not a regular file`);
  }
}

export async function assertArcwellPackageHealthy(
  installedPackage: PiPackage,
): Promise<void> {
  try {
    if (!lstatSync(installedPackage.installedPath).isDirectory()) throw new Error("not directory");
  } catch {
    throw new Error("Arcwell package installed path is missing or not a directory");
  }

  const packageJsonPath = join(installedPackage.installedPath, "package.json");
  assertRegularFile(packageJsonPath, "package.json");
  let metadata: unknown;
  try {
    metadata = JSON.parse(readFileSync(packageJsonPath, "utf8")) as unknown;
  } catch {
    throw new Error("Arcwell package package.json is invalid JSON");
  }
  if (
    !metadata
    || typeof metadata !== "object"
    || Array.isArray(metadata)
    || (metadata as Record<string, unknown>).name !== "arcwell"
    || (metadata as Record<string, unknown>).version !== ARCWELL_VERSION
  ) {
    throw new Error("Arcwell package package.json name/version does not match Arcwell");
  }
  const manifest = (metadata as Record<string, unknown>).pi;
  const extensions = manifest && typeof manifest === "object" && !Array.isArray(manifest)
    ? (manifest as Record<string, unknown>).extensions
    : undefined;
  if (
    !Array.isArray(extensions)
    || !extensions.some((entry) => typeof entry === "string" && normalize(entry) === ARCWELL_EXTENSION_PATH)
  ) {
    throw new Error("Arcwell package package.json manifest does not declare the protection extension");
  }

  const extensionPath = join(installedPackage.installedPath, ARCWELL_EXTENSION_PATH);
  assertRegularFile(extensionPath, "protection extension");
  let extensionModule: Record<string, unknown>;
  try {
    const extensionUrl = pathToFileURL(extensionPath);
    extensionUrl.searchParams.set("arcwell-health", randomUUID());
    // Importing validates module syntax/linking. Pi registration occurs only when Pi
    // invokes the exported extension function, which this health check never calls.
    extensionModule = await import(extensionUrl.href) as Record<string, unknown>;
  } catch {
    throw new Error("Arcwell package protection extension could not be loaded");
  }
  if (typeof extensionModule.default !== "function") {
    throw new Error("Arcwell package protection extension default export is not a function");
  }
}
